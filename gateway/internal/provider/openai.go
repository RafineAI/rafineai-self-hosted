package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

type openAIAdapter struct{}

func (openAIAdapter) Name() string { return "openai" }

func (openAIAdapter) BuildRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	base := firstNonEmpty(p.BaseURL, "https://api.openai.com")
	body := map[string]any{
		"model":    firstNonEmpty(req.Model, p.DefaultModel),
		"messages": req.Messages,
		"stream":   false,
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		body["max_tokens"] = *req.MaxTokens
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cred)
	return httpReq, nil
}

func (openAIAdapter) ParseResponse(body []byte) (ChatResponse, error) {
	var r struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return ChatResponse{}, err
	}
	if len(r.Choices) == 0 {
		return ChatResponse{}, errors.New("openai: empty choices")
	}
	return ChatResponse{
		Content:          r.Choices[0].Message.Content,
		PromptTokens:     r.Usage.PromptTokens,
		CompletionTokens: r.Usage.CompletionTokens,
	}, nil
}
