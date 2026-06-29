package policy

import (
	"strings"
	"testing"
)

func TestRedactTCKN(t *testing.T) {
	r := Apply("kimlik no 12345678901 lütfen")
	if strings.Contains(r.Text, "12345678901") {
		t.Fatal("TCKN not redacted")
	}
	if !contains(r.Applied, RuleTCKN) {
		t.Fatal("RuleTCKN not reported")
	}
}

func TestRedactCreditCard(t *testing.T) {
	r := Apply("card 4111 1111 1111 1111 expires soon")
	if strings.Contains(r.Text, "4111") {
		t.Fatal("credit card not redacted")
	}
	if !contains(r.Applied, RuleCreditCard) {
		t.Fatal("RuleCreditCard not reported")
	}
}

func TestCleanTextUnchanged(t *testing.T) {
	in := "merhaba nasılsın bugün hava güzel"
	r := Apply(in)
	if r.Text != in {
		t.Fatalf("clean text altered: %q", r.Text)
	}
	if len(r.Applied) != 0 {
		t.Fatalf("no rules should fire, got %v", r.Applied)
	}
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
