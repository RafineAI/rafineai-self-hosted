-- Migration 0010: response_masking
-- Global app settings (key/value) + per-rule response toggle. When
-- mask_responses is on, the gateway runs mask/flag rules over the assistant
-- reply too (block actions are downgraded to mask on responses — we never
-- withhold an already-generated answer, we redact it).

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO app_settings (key, value) VALUES ('mask_responses', 'true')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE policy_rules
    ADD COLUMN IF NOT EXISTS apply_to_response BOOLEAN NOT NULL DEFAULT TRUE;
