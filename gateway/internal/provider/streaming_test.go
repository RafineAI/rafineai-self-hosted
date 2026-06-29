package provider

import (
	"context"
	"strings"
	"testing"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

func collect(t *testing.T, a Adapter, sse string) (string, Usage) {
	t.Helper()
	var sb strings.Builder
	usage, err := a.DecodeStream(strings.NewReader(sse), func(d string) { sb.WriteString(d) })
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	return sb.String(), usage
}

func TestOpenAIDecodeStream(t *testing.T) {
	sse := "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n" +
		"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2}}\n\n" +
		"data: [DONE]\n\n"
	text, usage := collect(t, For("openai"), sse)
	if text != "Hello" {
		t.Fatalf("text=%q", text)
	}
	if usage.PromptTokens != 4 || usage.CompletionTokens != 2 {
		t.Fatalf("usage=%+v", usage)
	}
}

func TestAnthropicDecodeStream(t *testing.T) {
	sse := "event: message_start\ndata: {\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n" +
		"event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \"}}\n\n" +
		"event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"there\"}}\n\n" +
		"event: message_delta\ndata: {\"usage\":{\"output_tokens\":3}}\n\n"
	text, usage := collect(t, For("anthropic"), sse)
	if text != "Hi there" {
		t.Fatalf("text=%q", text)
	}
	if usage.PromptTokens != 5 || usage.CompletionTokens != 3 {
		t.Fatalf("usage=%+v", usage)
	}
}

func TestGeminiDecodeStream(t *testing.T) {
	sse := "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"foo\"}]}}]}\n\n" +
		"data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"bar\"}]}}],\"usageMetadata\":{\"promptTokenCount\":6,\"candidatesTokenCount\":2}}\n\n"
	text, usage := collect(t, For("gemini"), sse)
	if text != "foobar" {
		t.Fatalf("text=%q", text)
	}
	if usage.PromptTokens != 6 || usage.CompletionTokens != 2 {
		t.Fatalf("usage=%+v", usage)
	}
}

func TestBuildStreamRequestEnablesStreaming(t *testing.T) {
	p := state.Provider{Type: "gemini", AuthMode: "api_key", DefaultModel: "gemini-1.5-pro"}
	gReq, err := For("gemini").BuildStreamRequest(context.Background(), p, "k", sampleReq())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gReq.URL.Path, ":streamGenerateContent") {
		t.Fatalf("gemini stream path: %s", gReq.URL.Path)
	}
	if gReq.URL.Query().Get("alt") != "sse" {
		t.Fatal("gemini missing alt=sse")
	}

	// OpenAI sets stream:true in the body.
	oReq, _ := For("openai").BuildStreamRequest(context.Background(),
		state.Provider{Type: "openai", AuthMode: "api_key", DefaultModel: "gpt-4o"}, "k", sampleReq())
	buf := make([]byte, oReq.ContentLength)
	oReq.Body.Read(buf)
	if !strings.Contains(string(buf), "\"stream\":true") {
		t.Fatalf("openai stream flag missing: %s", buf)
	}
}
