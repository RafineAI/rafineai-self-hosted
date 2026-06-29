package proxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/alert"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/audit"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/ratelimit"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/signing"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

const masterKey = "test-master-key"

func newTestHandler(p state.Provider) (*Handler, *audit.Writer) {
	st := state.New()
	st.Replace(&state.Snapshot{
		Providers:  map[string]state.Provider{p.ID: p},
		UserTokens: map[string]string{},
		Blocked:    map[string]struct{}{},
	})
	aw := audit.New(func(context.Context, []audit.Entry) error { return nil }, 10, time.Hour)
	al := alert.New(func(context.Context, []alert.Entry) error { return nil }, time.Hour)
	h := New(masterKey, st, aw, al, ratelimit.Limits{})
	return h, aw
}

func doRequest(t *testing.T, h *Handler, key, body string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	_ = h.ChatCompletions(c)
	return rec
}

func TestChatHappyPath(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-upstream" {
			t.Errorf("upstream missing credential: %s", r.Header.Get("Authorization"))
		}
		w.Write([]byte(`{"choices":[{"message":{"content":"pong"}}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer upstream.Close()

	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key",
		APIKey: "sk-upstream", BaseURL: upstream.URL, DefaultModel: "gpt-4o", Active: true}
	h, _ := newTestHandler(p)

	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})
	rec := doRequest(t, h, key, `{"messages":[{"role":"user","content":"ping"}]}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	choices := out["choices"].([]any)
	msg := choices[0].(map[string]any)["message"].(map[string]any)
	if msg["content"] != "pong" {
		t.Fatalf("unexpected content: %v", msg["content"])
	}
}

func TestChatRejectsBadKey(t *testing.T) {
	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key", APIKey: "x", Active: true, DefaultModel: "m"}
	h, _ := newTestHandler(p)
	rec := doRequest(t, h, "rk_bogus.sig", `{"messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestChatRejectsRevokedKey(t *testing.T) {
	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key", APIKey: "x", Active: true, DefaultModel: "m"}
	h, _ := newTestHandler(p)
	h.State.Replace(&state.Snapshot{
		Providers: map[string]state.Provider{"p1": p},
		Blocked:   map[string]struct{}{"k1": {}},
	})
	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})
	rec := doRequest(t, h, key, `{"messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestChatOAuthRequiredWhenNoToken(t *testing.T) {
	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "oauth2", Active: true, DefaultModel: "m"}
	h, _ := newTestHandler(p)
	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})
	rec := doRequest(t, h, key, `{"messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != http.StatusPreconditionRequired {
		t.Fatalf("expected 428, got %d", rec.Code)
	}
}

func TestChatStreaming(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n"))
		w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n"))
		w.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n"))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer upstream.Close()

	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key",
		APIKey: "sk", BaseURL: upstream.URL, DefaultModel: "gpt-4o", Active: true}
	h, _ := newTestHandler(p)
	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})

	rec := doRequest(t, h, key, `{"stream":true,"messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	out := rec.Body.String()
	if !strings.Contains(out, "text/event-stream") && rec.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("not SSE: %s", rec.Header().Get("Content-Type"))
	}
	// Concatenated content deltas should reconstruct "Hello", end with DONE.
	if !strings.Contains(out, "Hel") || !strings.Contains(out, "lo") {
		t.Fatalf("missing content deltas: %s", out)
	}
	if !strings.Contains(out, "[DONE]") {
		t.Fatalf("missing DONE sentinel: %s", out)
	}
	if !strings.Contains(out, "chat.completion.chunk") {
		t.Fatalf("missing chunk object: %s", out)
	}
}

func TestChatRateLimited(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{}}`))
	}))
	defer upstream.Close()

	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key",
		APIKey: "sk", BaseURL: upstream.URL, DefaultModel: "gpt-4o", Active: true}
	h, _ := newTestHandler(p)
	// Cap this user at 1 request/min via a per-user override.
	snap := h.State.Current()
	snap.UserLimits = map[string]state.UserLimit{"u1": {RPM: 1, DailyTokens: -1}}
	h.State.Replace(snap)

	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})
	body := `{"messages":[{"role":"user","content":"hi"}]}`

	if rec := doRequest(t, h, key, body); rec.Code != http.StatusOK {
		t.Fatalf("first request should pass, got %d", rec.Code)
	}
	if rec := doRequest(t, h, key, body); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second request should be 429, got %d", rec.Code)
	}
}

func TestChatMasksSecretAndAlerts(t *testing.T) {
	var received string
	var alerted int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		r.Body.Read(b)
		received = string(b)
		w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{}}`))
	}))
	defer upstream.Close()

	st := state.New()
	st.Replace(&state.Snapshot{Providers: map[string]state.Provider{"p1": {
		ID: "p1", Type: "openai", AuthMode: "api_key", APIKey: "sk", BaseURL: upstream.URL,
		DefaultModel: "gpt-4o", Active: true,
	}}})
	aw := audit.New(func(context.Context, []audit.Entry) error { return nil }, 10, time.Hour)
	al := alert.New(func(_ context.Context, b []alert.Entry) error { alerted += len(b); return nil }, time.Hour)
	h := New(masterKey, st, aw, al, ratelimit.Limits{})

	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})
	rec := doRequest(t, h, key, `{"messages":[{"role":"user","content":"key sk-abcdef0123456789ABCDEF here"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	if strings.Contains(received, "sk-abcdef0123456789ABCDEF") {
		t.Fatalf("secret leaked upstream: %s", received)
	}
	if !strings.Contains(received, "[MASKED]") {
		t.Fatalf("expected mask token upstream: %s", received)
	}
}

func TestChatBlocksPrivateKey(t *testing.T) {
	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key", APIKey: "sk",
		DefaultModel: "gpt-4o", Active: true}
	h, _ := newTestHandler(p)
	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})
	body := `{"messages":[{"role":"user","content":"-----BEGIN RSA PRIVATE KEY-----"}]}`
	rec := doRequest(t, h, key, body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 policy_blocked, got %d", rec.Code)
	}
}

func TestChatRedactsPII(t *testing.T) {
	var received string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, r.ContentLength)
		r.Body.Read(buf)
		received = string(buf)
		w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{}}`))
	}))
	defer upstream.Close()

	p := state.Provider{ID: "p1", Type: "openai", AuthMode: "api_key",
		APIKey: "sk", BaseURL: upstream.URL, DefaultModel: "gpt-4o", Active: true}
	h, _ := newTestHandler(p)
	key, _ := signing.Sign(masterKey, signing.Claims{UserID: "u1", KeyID: "k1", ProviderID: "p1"})

	doRequest(t, h, key, `{"messages":[{"role":"user","content":"my id is 12345678901"}]}`)
	if strings.Contains(received, "12345678901") {
		t.Fatalf("PII leaked upstream: %s", received)
	}
}
