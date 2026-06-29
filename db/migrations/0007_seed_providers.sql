-- Migration 0007: seed_providers
-- Insert a universal provider shell for each known LLM type when none exists.
-- These are active but have no shared API key (has_api_key=false), so they only
-- appear usable to users who add their own key via BYOK.
-- Admins can add a shared API key later to make them available to everyone.

INSERT INTO llm_providers (name, type, auth_mode, default_model, is_active)
SELECT 'OpenAI', 'openai', 'api_key', 'gpt-4o-mini', TRUE
WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE type = 'openai');

INSERT INTO llm_providers (name, type, auth_mode, default_model, is_active)
SELECT 'Anthropic (Claude)', 'anthropic', 'api_key', 'claude-haiku-4-5-20251001', TRUE
WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE type = 'anthropic');

INSERT INTO llm_providers (name, type, auth_mode, default_model, is_active)
SELECT 'Google Gemini', 'gemini', 'api_key', 'gemini-1.5-flash', TRUE
WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE type = 'gemini');
