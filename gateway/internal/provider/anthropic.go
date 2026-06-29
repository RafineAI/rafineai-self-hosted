package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

type anthropicAdapter struct{}

func (anthropicAdapter) Name() string { return "anthropic" }

func (a anthropicAdapter) buildReq(ctx context.Context, p state.Provider, cred string, req ChatRequest, stream bool) (*http.Request, error) {
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
	if stream {
		body["stream"] = true
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

func (a anthropicAdapter) BuildRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	return a.buildReq(ctx, p, cred, req, false)
}

func (a anthropicAdapter) BuildStreamRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	return a.buildReq(ctx, p, cred, req, true)
}

func (anthropicAdapter) DecodeStream(body io.Reader, emit StreamConsumer) (Usage, error) {
	var usage Usage
	err := scanSSE(body, func(event, data string) bool {
		if data == "" {
			return true
		}
		switch event {
		case "message_start":
			var m struct {
				Message struct {
					Usage struct {
						InputTokens int `json:"input_tokens"`
					} `json:"usage"`
				} `json:"message"`
			}
			if json.Unmarshal([]byte(data), &m) == nil {
				usage.PromptTokens = m.Message.Usage.InputTokens
			}
		case "content_block_delta":
			var d struct {
				Delta struct {
					Text string `json:"text"`
				} `json:"delta"`
			}
			if json.Unmarshal([]byte(data), &d) == nil && d.Delta.Text != "" {
				emit(d.Delta.Text)
			}
		case "message_delta":
			var d struct {
				Usage struct {
					OutputTokens int `json:"output_tokens"`
				} `json:"usage"`
			}
			if json.Unmarshal([]byte(data), &d) == nil && d.Usage.OutputTokens > 0 {
				usage.CompletionTokens = d.Usage.OutputTokens
			}
		}
		return true
	})
	return usage, err
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
