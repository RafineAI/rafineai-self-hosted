// Package signing implements zero-network API key auth.
//
// A gateway key is a self-describing, HMAC-SHA256 signed token:
//
//	rk_<base64url(payloadJSON)>.<base64url(hmac)>
//
// The gateway verifies it with CPU math only — no database round-trip.
// The identical scheme is implemented in the Python api (app/signing.py)
// so the api can mint keys the gateway trusts.
package signing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

const prefix = "rk_"

// ErrInvalidKey is returned when a token is malformed or its signature fails.
var ErrInvalidKey = errors.New("invalid api key")

// Claims is the payload embedded in a signed key.
type Claims struct {
	UserID     string `json:"uid"`
	KeyID      string `json:"kid"`
	IssuedAt   int64  `json:"iat"`
	ProviderID string `json:"pid,omitempty"`
}

// Sign produces a signed key for the given claims using the master key.
func Sign(masterKey string, c Claims) (string, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	encPayload := base64.RawURLEncoding.EncodeToString(payload)
	sig := mac(masterKey, encPayload)
	return prefix + encPayload + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// Verify validates a signed key and returns its claims.
// It performs a constant-time signature comparison and never touches the DB.
func Verify(masterKey, token string) (Claims, error) {
	var c Claims
	if !strings.HasPrefix(token, prefix) {
		return c, ErrInvalidKey
	}
	body := token[len(prefix):]
	dot := strings.IndexByte(body, '.')
	if dot < 0 {
		return c, ErrInvalidKey
	}
	encPayload, encSig := body[:dot], body[dot+1:]

	gotSig, err := base64.RawURLEncoding.DecodeString(encSig)
	if err != nil {
		return c, ErrInvalidKey
	}
	wantSig := mac(masterKey, encPayload)
	if !hmac.Equal(gotSig, wantSig) {
		return c, ErrInvalidKey
	}

	payload, err := base64.RawURLEncoding.DecodeString(encPayload)
	if err != nil {
		return c, ErrInvalidKey
	}
	if err := json.Unmarshal(payload, &c); err != nil {
		return c, ErrInvalidKey
	}
	return c, nil
}

func mac(masterKey, msg string) []byte {
	h := hmac.New(sha256.New, []byte(masterKey))
	h.Write([]byte(msg))
	return h.Sum(nil)
}
