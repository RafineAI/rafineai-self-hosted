// Package policy implements the pre-flight content policy: built-in detectors
// for secrets and PII, Turkish lexicons for financial / customer-data
// categories, plus admin-defined custom rules. Matches are masked (the user
// never sees the mask — only the upstream copy is altered), blocked, or
// flagged, and every firing produces an admin alert upstream of this package.
//
// The category detection here is a lexicon/gazetteer NER ("NLP-lite"): it is
// deterministic, Turkish-aware, and extensible to a model-backed classifier.
package policy

import (
	"regexp"
	"strings"
)

// Actions.
const (
	ActionMask  = "mask"
	ActionBlock = "block"
	ActionFlag  = "flag"
)

// MaskToken replaces masked spans in the upstream payload.
const MaskToken = "[MASKED]"

// Rule is a compiled detector.
type Rule struct {
	Name     string
	Category string
	Action   string
	Severity string
	re       *regexp.Regexp
}

// Finding records that a rule matched.
type Finding struct {
	Rule     string
	Category string
	Action   string
	Severity string
}

// Result is the outcome of applying the policy to a piece of text.
type Result struct {
	Text     string    // possibly masked (for upstream only)
	Findings []Finding // one per distinct rule that fired
	Blocked  bool      // a block-action rule matched
}

// NewRegexRule compiles a regex rule. Returns nil if the pattern is invalid.
func NewRegexRule(name, category, action, severity, pattern string) *Rule {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil
	}
	return &Rule{Name: name, Category: category, Action: action, Severity: severity, re: re}
}

// NewKeywordRule compiles a case-insensitive, word-ish keyword matcher.
func NewKeywordRule(name, category, action, severity, keyword string) *Rule {
	// (?i) handles ASCII case; Turkish text is matched by also lower-casing
	// the keyword. Word boundaries kept loose to catch inflected forms.
	pat := "(?i)" + regexp.QuoteMeta(strings.TrimSpace(keyword))
	return NewRegexRule(name, category, action, severity, pat)
}

// Apply runs the given rules over text, masking/flagging as configured.
func Apply(text string, rules []*Rule) Result {
	res := Result{Text: text}
	seen := map[string]bool{}
	for _, r := range rules {
		if r == nil || r.re == nil || !r.re.MatchString(res.Text) {
			continue
		}
		if !seen[r.Name] {
			res.Findings = append(res.Findings, Finding{
				Rule: r.Name, Category: r.Category, Action: r.Action, Severity: r.Severity,
			})
			seen[r.Name] = true
		}
		switch r.Action {
		case ActionMask:
			res.Text = r.re.ReplaceAllString(res.Text, MaskToken)
		case ActionBlock:
			res.Text = r.re.ReplaceAllString(res.Text, MaskToken)
			res.Blocked = true
		}
	}
	return res
}

var builtins []*Rule

func init() {
	add := func(r *Rule) {
		if r != nil {
			builtins = append(builtins, r)
		}
	}
	// --- Secrets / credentials (mask, high) ---
	add(NewRegexRule("secret_openai_key", "secret", ActionMask, "high", `sk-[A-Za-z0-9_\-]{16,}`))
	add(NewRegexRule("secret_aws_key", "secret", ActionMask, "high", `AKIA[0-9A-Z]{16}`))
	add(NewRegexRule("secret_bearer", "secret", ActionMask, "high", `(?i)bearer\s+[A-Za-z0-9._\-]{20,}`))
	add(NewRegexRule("secret_private_key", "secret", ActionBlock, "high", `-----BEGIN [A-Z ]*PRIVATE KEY-----`))

	// --- PII / regulated identifiers (mask) ---
	add(NewRegexRule("tckn", "customer_data", ActionMask, "high", `\b\d{11}\b`))
	add(NewRegexRule("iban_tr", "financial", ActionMask, "high", `\bTR\d{24}\b`))
	add(NewRegexRule("credit_card", "financial", ActionMask, "high", `\b(?:\d[ -]?){13,16}\b`))
	add(NewRegexRule("phone_tr", "customer_data", ActionMask, "medium", `\b(?:\+90|0)?5\d{9}\b`))
	add(NewRegexRule("email", "customer_data", ActionFlag, "low", `[\w.+\-]+@[\w\-]+\.[\w.\-]+`))

	// --- Turkish financial lexicon (flag) ---
	for _, kw := range []string{"kredi kartı", "hesap numarası", "bakiye", "maaş", "fatura", "vergi numarası", "swift"} {
		add(NewKeywordRule("fin_"+slug(kw), "financial", ActionFlag, "medium", kw))
	}
	// --- Turkish customer-data lexicon (flag) ---
	for _, kw := range []string{"müşteri", "tc kimlik", "telefon numarası", "doğum tarihi", "ev adresi"} {
		add(NewKeywordRule("cust_"+slug(kw), "customer_data", ActionFlag, "low", kw))
	}
}

// Builtins returns the always-on detectors.
func Builtins() []*Rule { return builtins }

func slug(s string) string {
	return strings.ReplaceAll(strings.TrimSpace(s), " ", "_")
}
