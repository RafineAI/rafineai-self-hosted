package signing

import "testing"

func TestSignVerifyRoundTrip(t *testing.T) {
	const key = "test-master-key-0123456789abcdef"
	in := Claims{UserID: "u1", KeyID: "k1", IssuedAt: 1700000000, ProviderID: "p1"}

	tok, err := Sign(key, in)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	out, err := Verify(key, tok)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if out != in {
		t.Fatalf("claims mismatch: got %+v want %+v", out, in)
	}
}

func TestVerifyRejectsTamperedPayload(t *testing.T) {
	const key = "test-master-key"
	tok, _ := Sign(key, Claims{UserID: "u1", KeyID: "k1"})

	// Flip a character in the payload section.
	bad := []byte(tok)
	idx := len(prefix) + 2
	if bad[idx] == 'A' {
		bad[idx] = 'B'
	} else {
		bad[idx] = 'A'
	}
	if _, err := Verify(key, string(bad)); err == nil {
		t.Fatal("expected verification failure on tampered payload")
	}
}

func TestVerifyRejectsWrongKey(t *testing.T) {
	tok, _ := Sign("key-one", Claims{UserID: "u1", KeyID: "k1"})
	if _, err := Verify("key-two", tok); err == nil {
		t.Fatal("expected verification failure with wrong master key")
	}
}

func TestVerifyRejectsMalformed(t *testing.T) {
	cases := []string{"", "garbage", "rk_nodot", "rk_" + "abc.def"}
	for _, tc := range cases {
		if _, err := Verify("k", tc); err == nil {
			t.Fatalf("expected error for %q", tc)
		}
	}
}
