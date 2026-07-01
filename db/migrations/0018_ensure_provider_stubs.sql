-- Ensure stub provider entries exist for every known BYOK-capable type.
-- is_active=TRUE so that BYOK users can reach them via the gateway.
-- If an entry of that type already exists (possibly added by admin), skip.
INSERT INTO llm_providers (name, type, auth_mode, default_model, is_active)
SELECT 'OpenAI', 'openai', 'api_key', 'gpt-4o', TRUE
WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE type = 'openai');

INSERT INTO llm_providers (name, type, auth_mode, default_model, is_active)
SELECT 'Anthropic (Claude)', 'anthropic', 'api_key', 'claude-sonnet-4-6', TRUE
WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE type = 'anthropic');

INSERT INTO llm_providers (name, type, auth_mode, default_model, is_active)
SELECT 'Google Gemini', 'gemini', 'api_key', 'gemini-2.0-flash', TRUE
WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE type = 'gemini');
