-- Migration 0006: user_own_keys
-- Lets users bring their own API key (BYOK) for any known provider type.
-- The gateway loads these alongside shared provider credentials and uses
-- the user's own key when present (highest priority).

CREATE TABLE IF NOT EXISTS user_own_keys (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type   TEXT        NOT NULL CHECK (provider_type IN ('openai', 'anthropic', 'gemini')),
    encrypted_key   TEXT        NOT NULL,
    label           TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, provider_type)
);
