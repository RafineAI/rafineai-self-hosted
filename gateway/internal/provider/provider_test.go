package provider

import (
	"context"
	"encoding/json"
	"io"
	"testing"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

func sampleReq() ChatRequest {
	return ChatRequest{
		Model: "",
		Messages: []Message{
			{Role: "system", Content: "be brief"},
			{Role: "user", Content: "hi"},
		},
	}
}

func TestForUnknownReturnsNil(t *testing.T) {
	if For("cohere") != nil {
		t.Fatal("expected nil for unsupported provider")
	}
}

func TestOpenAIBuildRequest(t *testing.T) {
	p := state.Provider{Type: "openai", AuthMode: "api_key", DefaultModel: "gpt-4o"}
	req, err := For("openai").BuildRequest(context.Background(), p, "sk-test", sampleReq())
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.String() != "https://api.openai.com/v1/chat/completions" {
		t.Fatalf("bad url: %s", req.URL)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer sk-test" {
		t.Fatalf("bad auth header: %s", got)
	}
	body, _ := io.ReadAll(req.Body)
	var parsed map[string]any
	json.Unmarshal(body, &parsed)
	if parsed["model"] != "gpt-4o" {
		t.Fatalf("default model not applied: %v", parsed["model"])
	}
}

func TestOpenAIParse(t *testing.T) {
	body := `{"choices":[{"message":{"content":"hello"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`
	resp, err := For("openai").ParseResponse([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != "hello" || resp.PromptTokens != 3 || resp.CompletionTokens != 1 {
		t.Fatalf("bad parse: %+v", resp)
	}
}

func TestAnthropicSplitsSystemAndUsesApiKeyHeader(t *testing.T) {
	p := state.Provider{Type: "anthropic", AuthMode: "api_key", DefaultModel: "claude-3-5-sonnet"}
	req, err := For("anthropic").BuildRequest(context.Background(), p, "ak-test", sampleReq())
	if err != nil {
		t.Fatal(err)
	}
	if req.Header.Get("x-api-key") != "ak-test" {
		t.Fatal("expected x-api-key header in api_key mode")
	}
	if req.Header.Get("anthropic-version") == "" {
		t.Fatal("missing anthropic-version header")
	}
	body, _ := io.ReadAll(req.Body)
	var parsed map[string]any
	json.Unmarshal(body, &parsed)
	if parsed["system"] != "be brief" {
		t.Fatalf("system not extracted: %v", parsed["system"])
	}
	if _, ok := parsed["max_tokens"]; !ok {
		t.Fatal("anthropic requires max_tokens")
	}
	msgs := parsed["messages"].([]any)
	if len(msgs) != 1 {
		t.Fatalf("expected system message removed from messages, got %d", len(msgs))
	}
}

func TestAnthropicParse(t *testing.T) {
	body := `{"content":[{"type":"text","text":"hi there"}],"usage":{"input_tokens":5,"output_tokens":2}}`
	resp, err := For("anthropic").ParseResponse([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != "hi there" || resp.PromptTokens != 5 || resp.CompletionTokens != 2 {
		t.Fatalf("bad parse: %+v", resp)
	}
}

func TestGeminiUsesQueryKeyAndMapsRoles(t *testing.T) {
	p := state.Provider{Type: "gemini", AuthMode: "api_key", DefaultModel: "gemini-1.5-pro"}
	req := ChatRequest{Messages: []Message{{Role: "assistant", Content: "prev"}, {Role: "user", Content: "now"}}}
	httpReq, err := For("gemini").BuildRequest(context.Background(), p, "gkey", req)
	if err != nil {
		t.Fatal(err)
	}
	if httpReq.URL.Query().Get("key") != "gkey" {
		t.Fatal("expected key in query for api_key mode")
	}
	body, _ := io.ReadAll(httpReq.Body)
	var parsed map[string]any
	json.Unmarshal(body, &parsed)
	contents := parsed["contents"].([]any)
	first := contents[0].(map[string]any)
	if first["role"] != "model" {
		t.Fatalf("assistant should map to model role, got %v", first["role"])
	}
}

func TestGeminiParse(t *testing.T) {
	body := `{"candidates":[{"content":{"parts":[{"text":"answer"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}`
	resp, err := For("gemini").ParseResponse([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != "answer" || resp.PromptTokens != 7 || resp.CompletionTokens != 3 {
		t.Fatalf("bad parse: %+v", resp)
	}
}
