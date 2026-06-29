package provider

import "github.com/rafineai/rafineai-self-hosted/gateway/internal/state"

// EstimateTokens is a cheap heuristic: ~4 characters per token across all
// message content. Good enough for routing decisions on the hot path.
func EstimateTokens(msgs []Message) int {
	chars := 0
	for _, m := range msgs {
		chars += len(m.Content)
	}
	return chars / 4
}

// ResolveModel applies smart routing. When a provider configures both a light
// and heavy model, the prompt size selects between them around the provider's
// threshold; otherwise the request's model (or the provider default) is used.
func ResolveModel(p state.Provider, req ChatRequest) string {
	if p.LightModel != "" && p.HeavyModel != "" {
		if EstimateTokens(req.Messages) >= p.RouteThreshold {
			return p.HeavyModel
		}
		return p.LightModel
	}
	return firstNonEmpty(req.Model, p.DefaultModel)
}
