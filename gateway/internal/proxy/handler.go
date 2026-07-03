// Package proxy implements the gateway hot path: the OpenAI-compatible
// /v1/chat/completions endpoint.
package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/alert"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/audit"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/policy"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/provider"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/ratelimit"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/signing"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

// Handler holds the dependencies for the chat endpoint.
type Handler struct {
	MasterKey     string
	State         *state.Store
	Audit         *audit.Writer
	Alerts        *alert.Writer
	Client        *http.Client
	Limiter       *ratelimit.Limiter
	DefaultLimits ratelimit.Limits

	// In-process counters exposed at /metrics (Prometheus text format).
	mRequests atomic.Int64
	mErrors   atomic.Int64
	mTokens   atomic.Int64
}

// Metrics renders the in-process counters in Prometheus exposition format.
func (h *Handler) Metrics(c echo.Context) error {
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP rafine_requests_total Total chat requests handled.\n")
	fmt.Fprintf(&b, "# TYPE rafine_requests_total counter\n")
	fmt.Fprintf(&b, "rafine_requests_total %d\n", h.mRequests.Load())
	fmt.Fprintf(&b, "# HELP rafine_errors_total Total requests that ended in an error status.\n")
	fmt.Fprintf(&b, "# TYPE rafine_errors_total counter\n")
	fmt.Fprintf(&b, "rafine_errors_total %d\n", h.mErrors.Load())
	fmt.Fprintf(&b, "# HELP rafine_tokens_total Total prompt+completion tokens proxied.\n")
	fmt.Fprintf(&b, "# TYPE rafine_tokens_total counter\n")
	fmt.Fprintf(&b, "rafine_tokens_total %d\n", h.mTokens.Load())
	return c.String(http.StatusOK, b.String())
}

// New builds a Handler with a sane default HTTP client and rate limiter.
func New(masterKey string, st *state.Store, aw *audit.Writer, al *alert.Writer, defaults ratelimit.Limits) *Handler {
	return &Handler{
		MasterKey:     masterKey,
		State:         st,
		Audit:         aw,
		Alerts:        al,
		Client:        &http.Client{Timeout: 120 * time.Second},
		Limiter:       ratelimit.New(),
		DefaultLimits: defaults,
	}
}

// snippet returns the full masked text, capped at 4000 chars to protect against
// pathologically large messages filling the alerts table.
func snippet(masked string) string {
	const max = 4000
	s := strings.TrimSpace(masked)
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

// limitsFor resolves a user's effective limits. Precedence: a personal override
// wins; otherwise the most restrictive limit among the user's teams; otherwise
// the gateway default.
func (h *Handler) limitsFor(snap *state.Snapshot, userID string) ratelimit.Limits {
	lim := h.DefaultLimits
	if ul, ok := snap.UserLimitFor(userID); ok {
		if ul.RPM >= 0 {
			lim.RPM = ul.RPM
		}
		if ul.DailyTokens >= 0 {
			lim.DailyTokens = ul.DailyTokens
		}
		return lim
	}
	if tl, ok := snap.TeamLimitFor(userID); ok {
		if tl.RPM >= 0 {
			lim.RPM = tl.RPM
		}
		if tl.DailyTokens >= 0 {
			lim.DailyTokens = tl.DailyTokens
		}
	}
	return lim
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
	// Credential resolution: shared key → oauth2 token → user's own BYOK key.
	// Resolve the credential first so we can check BYOK before enforcing is_active.
	credential := p.APIKey
	if p.AuthMode == "oauth2" {
		if tok, found := snap.UserToken(claims.UserID, p.ID); found && tok != "" {
			credential = tok
		}
	}
	// BYOK: user's own API key always takes highest priority.
	hasBYOK := false
	if ownKey, ok := snap.UserOwnKey(claims.UserID, p.Type); ok && ownKey != "" {
		credential = ownKey
		hasBYOK = true
	}
	// Enforce is_active only when the user has no personal BYOK key — a disabled
	// provider still works for users who bring their own credential.
	if !p.Active && !hasBYOK {
		return jsonError(c, http.StatusForbidden, "provider_disabled", "provider is disabled")
	}
	if credential == "" {
		if p.AuthMode == "oauth2" {
			return jsonError(c, http.StatusPreconditionRequired, "oauth_required",
				"user has not connected this provider")
		}
		return jsonError(c, http.StatusFailedDependency, "missing_credential",
			"provider has no usable credential")
	}

	// Rate / quota enforcement (per user, in RAM).
	if ok, reason := h.Limiter.Allow(claims.UserID, h.limitsFor(snap, claims.UserID)); !ok {
		h.audit(claims, p, firstNonEmpty(req.Model, p.DefaultModel), 0, 0,
			http.StatusTooManyRequests, map[string]struct{}{}, c, reason, start)
		return jsonError(c, http.StatusTooManyRequests, reason, "rate limit or quota exceeded")
	}

	// Pre-flight policy: built-in detectors + admin custom rules. Masking is
	// applied only to the upstream copy (the user never sees the mask); every
	// firing raises an admin alert; a block-action match rejects the request.
	rules := append(policy.Builtins(), snap.Rules...)
	appliedSet := map[string]struct{}{}
	blocked := false
	convID := c.Request().Header.Get("X-Rafine-Conversation")
	for i, m := range req.Messages {
		if m.Role == "assistant" {
			continue
		}
		res := policy.Apply(m.Content, rules)
		req.Messages[i].Content = res.Text
		for _, f := range res.Findings {
			appliedSet[f.Rule] = struct{}{}
			h.Alerts.Enqueue(alert.Entry{
				UserID: claims.UserID, ConversationID: convID,
				RuleName: f.Rule, Category: f.Category, Action: f.Action,
				Severity: f.Severity, Snippet: snippet(res.Text),
			})
		}
		if res.Blocked {
			blocked = true
		}
	}
	if blocked {
		h.audit(claims, p, firstNonEmpty(req.Model, p.DefaultModel), 0, 0,
			http.StatusUnprocessableEntity, appliedSet, c, "blocked_by_policy", start)
		return jsonError(c, http.StatusUnprocessableEntity, "policy_blocked",
			"request blocked by content policy")
	}

	// Tool calling passthrough is currently implemented for OpenAI-type
	// providers only. Reject (rather than silently drop) tools for others so
	// clients get a clear signal instead of a confusingly tool-less answer.
	if len(req.Tools) > 0 && p.Type != "openai" {
		return jsonError(c, http.StatusBadRequest, "tools_unsupported",
			"tool calling is currently supported only for OpenAI-type providers")
	}

	adapter := provider.For(p.Type)
	if adapter == nil {
		return jsonError(c, http.StatusInternalServerError, "unsupported_provider", "no adapter for provider type")
	}

	// Smart routing: pick the effective model (light/heavy) before dispatch so
	// adapters and the audit log all see the same resolved model.
	req.Model = provider.ResolveModel(p, req)

	ctx := c.Request().Context()

	if req.Stream {
		return h.streamChat(c, adapter, p, credential, req, claims, appliedSet, rules, snap.MaskResponses, start)
	}

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
		return c.JSON(resp.StatusCode, map[string]any{
			"error": map[string]any{"type": "upstream_error", "message": extractUpstreamMsg(body)},
		})
	}

	parsed, err := adapter.ParseResponse(body)
	if err != nil {
		h.audit(claims, p, req.Model, 0, 0, http.StatusBadGateway, appliedSet, c, err.Error(), start)
		return jsonError(c, http.StatusBadGateway, "parse_error", err.Error())
	}

	// Response masking: redact sensitive spans in the assistant reply.
	if snap.MaskResponses {
		res := policy.ApplyResponse(parsed.Content, rules)
		parsed.Content = res.Text
		for _, f := range res.Findings {
			appliedSet["resp:"+f.Rule] = struct{}{}
			h.Alerts.Enqueue(alert.Entry{
				UserID: claims.UserID, ConversationID: convID,
				RuleName: "response:" + f.Rule, Category: f.Category, Action: f.Action,
				Severity: f.Severity, Snippet: snippet(res.Text),
			})
		}
	}

	h.Limiter.AddTokens(claims.UserID, parsed.PromptTokens+parsed.CompletionTokens)
	h.audit(claims, p, firstNonEmpty(req.Model, p.DefaultModel),
		parsed.PromptTokens, parsed.CompletionTokens, http.StatusOK, appliedSet, c, "", start)

	return c.JSON(http.StatusOK, openAIResponse(firstNonEmpty(req.Model, p.DefaultModel), parsed))
}

// streamChat proxies a streaming completion: it reads the upstream SSE,
// re-emits OpenAI-compatible chat.completion.chunk events to the client, and
// audits the captured usage at the end.
func (h *Handler) streamChat(c echo.Context, adapter provider.Adapter, p state.Provider,
	credential string, req provider.ChatRequest, claims signing.Claims,
	appliedSet map[string]struct{}, rules []*policy.Rule, maskResponses bool, start time.Time) error {

	ctx := c.Request().Context()
	model := firstNonEmpty(req.Model, p.DefaultModel)

	upstreamReq, err := adapter.BuildStreamRequest(ctx, p, credential, req)
	if err != nil {
		return jsonError(c, http.StatusInternalServerError, "build_failed", err.Error())
	}
	resp, err := h.Client.Do(upstreamReq)
	if err != nil {
		h.audit(claims, p, model, 0, 0, http.StatusBadGateway, appliedSet, c, err.Error(), start)
		return jsonError(c, http.StatusBadGateway, "upstream_error", err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		h.audit(claims, p, model, 0, 0, resp.StatusCode, appliedSet, c, string(body), start)
		return c.JSON(resp.StatusCode, map[string]any{
			"error": map[string]any{"type": "upstream_error", "message": extractUpstreamMsg(body)},
		})
	}

	// Switch the client connection into SSE mode.
	hdr := c.Response().Header()
	hdr.Set("Content-Type", "text/event-stream")
	hdr.Set("Cache-Control", "no-cache")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no") // disable nginx proxy buffering
	c.Response().WriteHeader(http.StatusOK)
	flusher, _ := c.Response().Writer.(http.Flusher)

	w := c.Response().Writer
	writeChunk := func(delta map[string]any, finish any) {
		chunk := map[string]any{
			"id":      "chatcmpl-rafine",
			"object":  "chat.completion.chunk",
			"model":   model,
			"choices": []map[string]any{{"index": 0, "delta": delta, "finish_reason": finish}},
		}
		b, _ := json.Marshal(chunk)
		w.Write([]byte("data: "))
		w.Write(b)
		w.Write([]byte("\n\n"))
		if flusher != nil {
			flusher.Flush()
		}
	}

	// Initial role delta (OpenAI convention).
	writeChunk(map[string]any{"role": "assistant"}, nil)

	emit := func(text string) {
		if text != "" {
			writeChunk(map[string]any{"content": text}, nil)
		}
	}

	var usage provider.Usage
	var decErr error
	if maskResponses {
		// Mask the reply as it streams, releasing redacted text on whitespace
		// boundaries (sensitive tokens are contiguous, so never split).
		masker := policy.NewStreamMasker(rules)
		usage, decErr = adapter.DecodeStream(resp.Body, func(textDelta string) {
			emit(masker.Push(textDelta))
		})
		emit(masker.Close())
		for _, f := range masker.Findings() {
			appliedSet["resp:"+f.Rule] = struct{}{}
			h.Alerts.Enqueue(alert.Entry{
				UserID:         claims.UserID,
				ConversationID: c.Request().Header.Get("X-Rafine-Conversation"),
				RuleName:       "response:" + f.Rule, Category: f.Category,
				Action: f.Action, Severity: f.Severity, Snippet: "[response masked]",
			})
		}
	} else {
		usage, decErr = adapter.DecodeStream(resp.Body, func(textDelta string) {
			emit(textDelta)
		})
	}

	// Final stop chunk, then a usage-only chunk (OpenAI include_usage style),
	// then the DONE sentinel.
	writeChunk(map[string]any{}, "stop")
	usageChunk := map[string]any{
		"id":      "chatcmpl-rafine",
		"object":  "chat.completion.chunk",
		"model":   model,
		"choices": []map[string]any{},
		"usage": map[string]int{
			"prompt_tokens":     usage.PromptTokens,
			"completion_tokens": usage.CompletionTokens,
			"total_tokens":      usage.PromptTokens + usage.CompletionTokens,
		},
	}
	ub, _ := json.Marshal(usageChunk)
	w.Write([]byte("data: "))
	w.Write(ub)
	w.Write([]byte("\n\n"))
	w.Write([]byte("data: [DONE]\n\n"))
	if flusher != nil {
		flusher.Flush()
	}

	status := http.StatusOK
	errMsg := ""
	if decErr != nil {
		status = http.StatusBadGateway
		errMsg = decErr.Error()
	}
	h.Limiter.AddTokens(claims.UserID, usage.PromptTokens+usage.CompletionTokens)
	h.audit(claims, p, model, usage.PromptTokens, usage.CompletionTokens, status, appliedSet, c, errMsg, start)
	return nil
}

func (h *Handler) audit(claims signing.Claims, p state.Provider, model string,
	promptTok, compTok, status int, appliedSet map[string]struct{}, c echo.Context, errMsg string, start time.Time) {

	h.mRequests.Add(1)
	h.mTokens.Add(int64(promptTok + compTok))
	if status >= 400 {
		h.mErrors.Add(1)
	}

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
	msg := map[string]any{"role": "assistant", "content": r.Content}
	if len(r.ToolCalls) > 0 {
		msg["tool_calls"] = r.ToolCalls
	}
	finish := r.FinishReason
	if finish == "" {
		finish = "stop"
	}
	return map[string]any{
		"id":      "chatcmpl-rafine",
		"object":  "chat.completion",
		"model":   model,
		"choices": []map[string]any{{
			"index":         0,
			"message":       msg,
			"finish_reason": finish,
		}},
		"usage": map[string]int{
			"prompt_tokens":     r.PromptTokens,
			"completion_tokens": r.CompletionTokens,
			"total_tokens":      r.PromptTokens + r.CompletionTokens,
		},
	}
}

// extractUpstreamMsg pulls a human-readable message out of a raw upstream
// error body, falling back to the raw text when parsing fails.
func extractUpstreamMsg(body []byte) string {
	var obj map[string]any
	if json.Unmarshal(body, &obj) == nil {
		if errObj, ok := obj["error"].(map[string]any); ok {
			if msg, ok := errObj["message"].(string); ok && msg != "" {
				return msg
			}
		}
		if msg, ok := obj["message"].(string); ok && msg != "" {
			return msg
		}
	}
	if len(body) > 300 {
		return string(body[:300])
	}
	return string(body)
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
