// Package policy implements a minimal pre-flight content policy.
//
// MVP scope: regex-based redaction of obvious PII (credit-card-like numbers
// and Turkish national ID numbers). This is the hook where richer deny/route
// rules will plug in later; for now it demonstrates the redaction path and is
// fully covered by tests.
package policy

import "regexp"

// Rule names recorded in the audit trail.
const (
	RuleCreditCard = "redact_credit_card"
	RuleTCKN       = "redact_tckn"
)

var (
	// 13-16 digit runs, optionally separated by spaces/dashes.
	creditCard = regexp.MustCompile(`\b(?:\d[ -]?){13,16}\b`)
	// Turkish national ID: exactly 11 digits.
	tckn = regexp.MustCompile(`\b\d{11}\b`)
)

// Result is the outcome of applying the policy to some text.
type Result struct {
	Text    string   // possibly redacted
	Applied []string // rule names that fired
}

// Apply redacts PII in the input and reports which rules fired.
func Apply(input string) Result {
	applied := []string{}
	out := input

	if tckn.MatchString(out) {
		out = tckn.ReplaceAllString(out, "[REDACTED_TCKN]")
		applied = append(applied, RuleTCKN)
	}
	if creditCard.MatchString(out) {
		out = creditCard.ReplaceAllString(out, "[REDACTED_CARD]")
		applied = append(applied, RuleCreditCard)
	}
	return Result{Text: out, Applied: applied}
}
