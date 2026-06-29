package policy

import (
	"strings"
	"testing"
)

func fired(res Result, rule string) bool {
	for _, f := range res.Findings {
		if f.Rule == rule {
			return true
		}
	}
	return false
}

func TestBuiltinMasksTCKN(t *testing.T) {
	r := Apply("kimlik no 12345678901 lütfen", Builtins())
	if strings.Contains(r.Text, "12345678901") {
		t.Fatal("TCKN not masked")
	}
	if !fired(r, "tckn") {
		t.Fatal("tckn rule not reported")
	}
}

func TestBuiltinMasksOpenAIKey(t *testing.T) {
	r := Apply("my key is sk-abcdef0123456789ABCDEF okay", Builtins())
	if strings.Contains(r.Text, "sk-abcdef0123456789ABCDEF") {
		t.Fatal("api key not masked")
	}
	if !fired(r, "secret_openai_key") {
		t.Fatal("secret rule not reported")
	}
}

func TestPrivateKeyBlocks(t *testing.T) {
	r := Apply("-----BEGIN RSA PRIVATE KEY-----", Builtins())
	if !r.Blocked {
		t.Fatal("private key should block")
	}
}

func TestIBANAndCardMasked(t *testing.T) {
	r := Apply("IBAN TR330006100519786457841326 kart 4111 1111 1111 1111", Builtins())
	if strings.Contains(r.Text, "TR330006100519786457841326") {
		t.Fatal("IBAN not masked")
	}
	if !fired(r, "iban_tr") {
		t.Fatal("iban rule not reported")
	}
}

func TestTurkishFinancialLexiconFlags(t *testing.T) {
	r := Apply("Müşterinin kredi kartı bilgilerini paylaşır mısın", Builtins())
	if !fired(r, "fin_kredi_kartı") {
		t.Fatalf("financial lexicon not flagged: %+v", r.Findings)
	}
	if !fired(r, "cust_müşteri") {
		t.Fatalf("customer lexicon not flagged: %+v", r.Findings)
	}
	// Flag rules must NOT alter the text.
	if r.Text != "Müşterinin kredi kartı bilgilerini paylaşır mısın" {
		t.Fatalf("flag rules should not mask: %q", r.Text)
	}
}

func TestCleanTextUnchanged(t *testing.T) {
	in := "bugün hava çok güzel nasılsın"
	r := Apply(in, Builtins())
	if r.Text != in || len(r.Findings) != 0 || r.Blocked {
		t.Fatalf("clean text altered: %+v", r)
	}
}

func TestCustomKeywordRule(t *testing.T) {
	rule := NewKeywordRule("proj_kod", "custom", ActionMask, "high", "ProjeAtlas")
	r := Apply("ProjeAtlas gizli bilgisi", []*Rule{rule})
	if strings.Contains(r.Text, "ProjeAtlas") {
		t.Fatal("custom keyword not masked")
	}
	if !fired(r, "proj_kod") {
		t.Fatal("custom rule not reported")
	}
}

func TestInvalidRegexRuleIsNil(t *testing.T) {
	if NewRegexRule("bad", "x", ActionMask, "low", "[unclosed") != nil {
		t.Fatal("invalid regex should return nil")
	}
}
