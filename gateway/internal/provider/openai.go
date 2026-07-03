package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

type openAIAdapter struct{}

func (openAIAdapter) Name() string { return "openai" }

func (a openAIAdapter) buildBody(req ChatRequest, p state.Provider, stream bool) map[string]any {
	body := map[string]any{
		"model":    firstNonEmpty(req.Model, p.DefaultModel),
		"messages": req.Messages,
		"stream":   stream,
	}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		body["max_tokens"] = *req.MaxTokens
	}
	// Tool calling is forwarded on the non-streaming path only. Streaming
	// tool_call deltas would need dedicated handling in DecodeStream/the proxy
	// re-emitter; until that exists we don't advertise tools upstream while
	// streaming (avoids producing an empty text stream). Clients that need
	// tools should call with stream:false.
	if !stream && len(req.Tools) > 0 {
		body["tools"] = req.Tools
		if len(req.ToolChoice) > 0 {
			body["tool_choice"] = req.ToolChoice
		}
	}
	return body
}

func (a openAIAdapter) newRequest(ctx context.Context, p state.Provider, cred string, body map[string]any) (*http.Request, error) {
	base := firstNonEmpty(p.BaseURL, "https://api.openai.com")
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

func (a openAIAdapter) BuildRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	return a.newRequest(ctx, p, cred, a.buildBody(req, p, false))
}

func (a openAIAdapter) BuildStreamRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	return a.newRequest(ctx, p, cred, a.buildBody(req, p, true))
}

func (openAIAdapter) DecodeStream(body io.Reader, emit StreamConsumer) (Usage, error) {
	var usage Usage
	err := scanSSE(body, func(_, data string) bool {
		if data == "" || data == "[DONE]" {
			return data != "[DONE]"
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return true
		}
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			emit(chunk.Choices[0].Delta.Content)
		}
		if chunk.Usage != nil {
			usage.PromptTokens = chunk.Usage.PromptTokens
			usage.CompletionTokens = chunk.Usage.CompletionTokens
		}
		return true
	})
	return usage, err
}

func (openAIAdapter) ParseResponse(body []byte) (ChatResponse, error) {
	var r struct {
		Choices []struct {
			Message struct {
				Content   string          `json:"content"`
				ToolCalls json.RawMessage `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
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
		ToolCalls:        r.Choices[0].Message.ToolCalls,
		FinishReason:     r.Choices[0].FinishReason,
		PromptTokens:     r.Usage.PromptTokens,
		CompletionTokens: r.Usage.CompletionTokens,
	}, nil
}
