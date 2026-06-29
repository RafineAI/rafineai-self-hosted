package internal_test

// Cross-language compatibility guard: these vectors were produced by the
// Python api (app/crypto.py and app/signing.py). If the Go and Python
// implementations ever diverge, these tests fail.
//
// Regenerate with:
//   python3 -c "from app import crypto, signing; \
//     print(crypto.encrypt('cross-lang-master-key','sk-cross-language-secret')); \
//     print(signing.sign('cross-lang-master-key','u-cross','k-cross','p-cross',1700000000))"

import (
	"testing"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/secretbox"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/signing"
)

const (
	crossMasterKey = "cross-lang-master-key"
	pythonBlob     = "stFobdlzb+kDra9946ABG9u/VCvjyOOwbuHQw4U7wTZsxWfIi1+JKBpGBdyftw0X8pK+pw=="
	pythonToken    = "rk_eyJ1aWQiOiJ1LWNyb3NzIiwia2lkIjoiay1jcm9zcyIsImlhdCI6MTcwMDAwMDAwMCwicGlkIjoicC1jcm9zcyJ9.mbK_ykrgyQt6b7h8RMd5bXcv3jo7Sm0GSUwIRPAGiME"
)

func TestGoDecryptsPythonSecretbox(t *testing.T) {
	got, err := secretbox.Decrypt(crossMasterKey, pythonBlob)
	if err != nil {
		t.Fatalf("decrypt python blob: %v", err)
	}
	if got != "sk-cross-language-secret" {
		t.Fatalf("got %q", got)
	}
}

func TestGoVerifiesPythonSignedKey(t *testing.T) {
	claims, err := signing.Verify(crossMasterKey, pythonToken)
	if err != nil {
		t.Fatalf("verify python token: %v", err)
	}
	if claims.UserID != "u-cross" || claims.KeyID != "k-cross" || claims.ProviderID != "p-cross" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if claims.IssuedAt != 1700000000 {
		t.Fatalf("unexpected iat: %d", claims.IssuedAt)
	}
}
