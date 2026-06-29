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

type geminiAdapter struct{}

func (geminiAdapter) Name() string { return "gemini" }

func (geminiAdapter) BuildRequest(ctx context.Context, p state.Provider, cred string, req ChatRequest) (*http.Request, error) {
	base := firstNonEmpty(p.BaseURL, "https://generativelanguage.googleapis.com")
	model := firstNonEmpty(req.Model, p.DefaultModel)

	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role"`
		Parts []part `json:"parts"`
	}

	var systemParts []string
	contents := make([]content, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemParts = append(systemParts, m.Content)
			continue
		}
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, content{Role: role, Parts: []part{{Text: m.Content}}})
	}

	body := map[string]any{"contents": contents}
	if len(systemParts) > 0 {
		body["systemInstruction"] = content{Parts: []part{{Text: strings.Join(systemParts, "\n\n")}}}
	}
	genCfg := map[string]any{}
	if req.Temperature != nil {
		genCfg["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		genCfg["maxOutputTokens"] = *req.MaxTokens
	}
	if len(genCfg) > 0 {
		body["generationConfig"] = genCfg
	}

	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := base + "/v1beta/models/" + model + ":generateContent"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	// Gemini accepts the credential either as a query key (api_key mode) or as
	// a Bearer token (OAuth2 mode).
	if p.AuthMode == "oauth2" {
		httpReq.Header.Set("Authorization", "Bearer "+cred)
	} else {
		q := httpReq.URL.Query()
		q.Set("key", cred)
		httpReq.URL.RawQuery = q.Encode()
	}
	return httpReq, nil
}

func (geminiAdapter) ParseResponse(body []byte) (ChatResponse, error) {
	var r struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return ChatResponse{}, err
	}
	if len(r.Candidates) == 0 {
		return ChatResponse{}, errors.New("gemini: empty candidates")
	}
	var sb strings.Builder
	for _, p := range r.Candidates[0].Content.Parts {
		sb.WriteString(p.Text)
	}
	return ChatResponse{
		Content:          sb.String(),
		PromptTokens:     r.UsageMetadata.PromptTokenCount,
		CompletionTokens: r.UsageMetadata.CandidatesTokenCount,
	}, nil
}
