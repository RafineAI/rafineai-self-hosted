package secretbox

import "testing"

func TestEncryptDecryptRoundTrip(t *testing.T) {
	const mk = "master-key-for-tests"
	const secret = "sk-proj-abc123-super-secret"

	blob, err := Encrypt(mk, secret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	got, err := Decrypt(mk, blob)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != secret {
		t.Fatalf("got %q want %q", got, secret)
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt("key-a", "hello")
	if _, err := Decrypt("key-b", blob); err == nil {
		t.Fatal("expected decryption failure with wrong key")
	}
}

func TestDecryptGarbageFails(t *testing.T) {
	if _, err := Decrypt("k", "!!!not-base64!!!"); err == nil {
		t.Fatal("expected error on garbage input")
	}
}

func TestNonceIsRandom(t *testing.T) {
	a, _ := Encrypt("k", "same")
	b, _ := Encrypt("k", "same")
	if a == b {
		t.Fatal("expected distinct ciphertexts due to random nonce")
	}
}
