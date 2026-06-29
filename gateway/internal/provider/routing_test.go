package provider

import (
	"strings"
	"testing"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

func TestResolveModelNoRoutingUsesRequestThenDefault(t *testing.T) {
	p := state.Provider{DefaultModel: "gpt-4o"}
	if got := ResolveModel(p, ChatRequest{}); got != "gpt-4o" {
		t.Fatalf("default not used: %s", got)
	}
	if got := ResolveModel(p, ChatRequest{Model: "gpt-4o-mini"}); got != "gpt-4o-mini" {
		t.Fatalf("request model not honored: %s", got)
	}
}

func TestResolveModelRoutesBySize(t *testing.T) {
	p := state.Provider{
		DefaultModel: "x", LightModel: "cheap", HeavyModel: "heavy", RouteThreshold: 100,
	}
	// Short prompt -> light.
	short := ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}}
	if got := ResolveModel(p, short); got != "cheap" {
		t.Fatalf("short prompt should route to light, got %s", got)
	}
	// Long prompt (>= 100 tokens ~ 400 chars) -> heavy.
	long := ChatRequest{Messages: []Message{{Role: "user", Content: strings.Repeat("a", 500)}}}
	if got := ResolveModel(p, long); got != "heavy" {
		t.Fatalf("long prompt should route to heavy, got %s", got)
	}
}

func TestEstimateTokens(t *testing.T) {
	got := EstimateTokens([]Message{{Content: "12345678"}}) // 8 chars / 4 = 2
	if got != 2 {
		t.Fatalf("estimate=%d", got)
	}
}
