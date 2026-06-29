// Package proxy implements the gateway hot path: the OpenAI-compatible
// /v1/chat/completions endpoint.
package proxy

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/audit"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/policy"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/provider"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/signing"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

// Handler holds the dependencies for the chat endpoint.
type Handler struct {
	MasterKey string
	State     *state.Store
	Audit     *audit.Writer
	Client    *http.Client
}

// New builds a Handler with a sane default HTTP client.
func New(masterKey string, st *state.Store, aw *audit.Writer) *Handler {
	return &Handler{
		MasterKey: masterKey,
		State:     st,
		Audit:     aw,
		Client:    &http.Client{Timeout: 120 * time.Second},
	}
}

// claimsFromRequest verifies the bearer token and returns the claims.
func (h *Handler) claimsFromRequest(c echo.Context) (signing.Claims, error) {
	authz := c.Request().Header.Get("Authorization")
	tok := strings.TrimPrefix(authz, "Bearer ")
	return signing.Verify(h.MasterKey, tok)
}

// ChatCompletions handles POST /v1/chat/completions.
func (h *Handler) ChatCompletions(c echo.Context) error {
	start := time.Now()

	claims, err := h.claimsFromRequest(c)
	if err != nil {
		return jsonError(c, http.StatusUnauthorized, "invalid_api_key", "API key verification failed")
	}

	snap := h.State.Current()
	if claims.KeyID != "" && snap.IsBlocked(claims.KeyID) {
		return jsonError(c, http.StatusForbidden, "key_revoked", "this API key has been revoked")
	}

	var req provider.ChatRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		return jsonError(c, http.StatusBadRequest, "bad_request", "invalid JSON body")
	}
	if len(req.Messages) == 0 {
		return jsonError(c, http.StatusBadRequest, "bad_request", "messages is required")
	}

	// Provider resolution: claim takes precedence, header is a fallback.
	providerID := claims.ProviderID
	if providerID == "" {
		providerID = c.Request().Header.Get("X-Rafine-Provider")
	}
	p, ok := snap.Provider(providerID)
	if !ok {
		return jsonError(c, http.StatusBadRequest, "unknown_provider", "provider not configured")
	}
	if !p.Active {
		return jsonError(c, http.StatusForbidden, "provider_disabled", "provider is disabled")
	}

	// Credential resolution.
	credential := p.APIKey
	if p.AuthMode == "oauth2" {
		tok, found := snap.UserToken(claims.UserID, p.ID)
		if !found || tok == "" {
			return jsonError(c, http.StatusPreconditionRequired, "oauth_required",
				"user has not connected this provider")
		}
		credential = tok
	}
	if credential == "" {
		return jsonError(c, http.StatusFailedDependency, "missing_credential",
			"provider has no usable credential")
	}

	// Pre-flight policy: redact PII in outgoing content.
	appliedSet := map[string]struct{}{}
	for i, m := range req.Messages {
		if m.Role == "assistant" {
			continue
		}
		res := policy.Apply(m.Content)
		req.Messages[i].Content = res.Text
		for _, r := range res.Applied {
			appliedSet[r] = struct{}{}
		}
	}

	adapter := provider.For(p.Type)
	if adapter == nil {
		return jsonError(c, http.StatusInternalServerError, "unsupported_provider", "no adapter for provider type")
	}

	ctx := c.Request().Context()
	upstreamReq, err := adapter.BuildRequest(ctx, p, credential, req)
	if err != nil {
		return jsonError(c, http.StatusInternalServerError, "build_failed", err.Error())
	}

	resp, err := h.Client.Do(upstreamReq)
	if err != nil {
		h.audit(claims, p, req.Model, 0, 0, http.StatusBadGateway, appliedSet, c, err.Error(), start)
		return jsonError(c, http.StatusBadGateway, "upstream_error", err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		h.audit(claims, p, req.Model, 0, 0, resp.StatusCode, appliedSet, c, string(body), start)
		// Pass the upstream error through transparently.
		return c.JSONBlob(resp.StatusCode, body)
	}

	parsed, err := adapter.ParseResponse(body)
	if err != nil {
		h.audit(claims, p, req.Model, 0, 0, http.StatusBadGateway, appliedSet, c, err.Error(), start)
		return jsonError(c, http.StatusBadGateway, "parse_error", err.Error())
	}

	h.audit(claims, p, firstNonEmpty(req.Model, p.DefaultModel),
		parsed.PromptTokens, parsed.CompletionTokens, http.StatusOK, appliedSet, c, "", start)

	return c.JSON(http.StatusOK, openAIResponse(firstNonEmpty(req.Model, p.DefaultModel), parsed))
}

func (h *Handler) audit(claims signing.Claims, p state.Provider, model string,
	promptTok, compTok, status int, appliedSet map[string]struct{}, c echo.Context, errMsg string, start time.Time) {

	policies := make([]string, 0, len(appliedSet))
	for k := range appliedSet {
		policies = append(policies, k)
	}
	polJSON, _ := json.Marshal(policies)

	h.Audit.Enqueue(audit.Entry{
		UserID:          claims.UserID,
		ProviderID:      p.ID,
		ConversationID:  c.Request().Header.Get("X-Rafine-Conversation"),
		Model:           model,
		RequestTokens:   promptTok,
		ResponseTokens:  compTok,
		LatencyMS:       int(time.Since(start).Milliseconds()),
		StatusCode:      status,
		AppliedPolicies: string(polJSON),
		Error:           errMsg,
	})
}

// openAIResponse renders the unified response in OpenAI Chat Completions shape.
func openAIResponse(model string, r provider.ChatResponse) map[string]any {
	return map[string]any{
		"id":      "chatcmpl-rafine",
		"object":  "chat.completion",
		"model":   model,
		"choices": []map[string]any{{
			"index":         0,
			"message":       map[string]string{"role": "assistant", "content": r.Content},
			"finish_reason": "stop",
		}},
		"usage": map[string]int{
			"prompt_tokens":     r.PromptTokens,
			"completion_tokens": r.CompletionTokens,
			"total_tokens":      r.PromptTokens + r.CompletionTokens,
		},
	}
}

func jsonError(c echo.Context, status int, code, msg string) error {
	return c.JSON(status, map[string]any{
		"error": map[string]string{"type": code, "message": msg},
	})
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
