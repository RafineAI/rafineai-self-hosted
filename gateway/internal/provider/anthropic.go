package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

type anthropicAdapter struct{}

func (anthropicAdapter) Name() string { return "anthropic" }

func (anthropicAdapter) BuildRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	base := firstNonEmpty(p.BaseURL, "https://api.anthropic.com")

	// Anthropic carries system prompts in a dedicated field and only accepts
	// user/assistant turns in messages.
	var systemParts []string
	msgs := make([]map[string]string, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemParts = append(systemParts, m.Content)
			continue
		}
		msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
	}

	maxTokens := defaultMaxTokens
	if req.MaxTokens != nil {
		maxTokens = *req.MaxTokens
	}
	body := map[string]any{
		"model":      firstNonEmpty(req.Model, p.DefaultModel),
		"messages":   msgs,
		"max_tokens": maxTokens,
	}
	if len(systemParts) > 0 {
		body["system"] = strings.Join(systemParts, "\n\n")
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/messages", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	if p.AuthMode == "oauth2" {
		httpReq.Header.Set("Authorization", "Bearer "+cred)
	} else {
		httpReq.Header.Set("x-api-key", cred)
	}
	return httpReq, nil
}

func (anthropicAdapter) ParseResponse(body []byte) (ChatResponse, error) {
	var r struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return ChatResponse{}, err
	}
	var sb strings.Builder
	for _, c := range r.Content {
		if c.Type == "text" {
			sb.WriteString(c.Text)
		}
	}
	if sb.Len() == 0 && len(r.Content) == 0 {
		return ChatResponse{}, errors.New("anthropic: empty content")
	}
	return ChatResponse{
		Content:          sb.String(),
		PromptTokens:     r.Usage.InputTokens,
		CompletionTokens: r.Usage.OutputTokens,
	}, nil
}
