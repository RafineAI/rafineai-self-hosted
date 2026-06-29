// Package secretbox provides symmetric encryption for provider credentials.
//
// Scheme (must match the Python api in app/crypto.py):
//   - key   = SHA256(masterKey)            // 32 bytes -> AES-256
//   - nonce = 12 random bytes
//   - blob  = base64std( nonce || AES-GCM-seal(key, nonce, plaintext) )
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// ErrDecrypt is returned when a blob cannot be authenticated/decrypted.
var ErrDecrypt = errors.New("secretbox: decryption failed")

func deriveKey(masterKey string) []byte {
	sum := sha256.Sum256([]byte(masterKey))
	return sum[:]
}

// Encrypt seals plaintext and returns a base64 blob.
func Encrypt(masterKey, plaintext string) (string, error) {
	block, err := aes.NewCipher(deriveKey(masterKey))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt opens a base64 blob produced by Encrypt (Go or Python).
func Decrypt(masterKey, blob string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return "", ErrDecrypt
	}
	block, err := aes.NewCipher(deriveKey(masterKey))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns {
		return "", ErrDecrypt
	}
	nonce, ct := raw[:ns], raw[ns:]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", ErrDecrypt
	}
	return string(plain), nil
}
