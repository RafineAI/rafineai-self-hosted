// Package provider contains adapters that translate a unified, OpenAI-shaped
// chat request to/from each upstream LLM provider (OpenAI, Anthropic, Gemini).
//
// MVP scope: non-streaming completions. The unified request/response use the
// OpenAI Chat Completions shape, which the panel and external clients speak.
package provider

import (
	"context"
	"io"
	"net/http"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

// Message is a single chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest is the unified inbound request (OpenAI-compatible).
type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature *float64  `json:"temperature,omitempty"`
	MaxTokens   *int      `json:"max_tokens,omitempty"`
	Stream      bool      `json:"stream,omitempty"`
}

// ChatResponse is the unified parsed response.
type ChatResponse struct {
	Content          string
	PromptTokens     int
	CompletionTokens int
}

// Usage holds token counts captured while streaming.
type Usage struct {
	PromptTokens     int
	CompletionTokens int
}

// StreamConsumer receives incremental text deltas during streaming.
type StreamConsumer func(textDelta string)

// Adapter builds upstream HTTP requests and parses their responses.
type Adapter interface {
	// Name returns the provider type ("openai" | "anthropic" | "gemini").
	Name() string
	// BuildRequest constructs the upstream HTTP request. credential is the
	// decrypted API key or OAuth access token.
	BuildRequest(ctx context.Context, p state.Provider, credential string, req ChatRequest) (*http.Request, error)
	// ParseResponse turns a successful upstream body into the unified shape.
	ParseResponse(body []byte) (ChatResponse, error)
	// BuildStreamRequest constructs an upstream request with streaming enabled.
	BuildStreamRequest(ctx context.Context, p state.Provider, credential string, req ChatRequest) (*http.Request, error)
	// DecodeStream reads the upstream SSE body, calling emit for each text
	// delta, and returns the captured token usage.
	DecodeStream(body io.Reader, emit StreamConsumer) (Usage, error)
}

// For returns the adapter for a provider type, or nil if unsupported.
func For(providerType string) Adapter {
	switch providerType {
	case "openai":
		return openAIAdapter{}
	case "anthropic":
		return anthropicAdapter{}
	case "gemini":
		return geminiAdapter{}
	default:
		return nil
	}
}

// defaultMaxTokens is used when a request omits max_tokens for providers that
// require it (Anthropic).
const defaultMaxTokens = 4096

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
