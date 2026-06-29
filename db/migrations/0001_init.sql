-- ============================================================
--  RafineAI Self-Hosted — initial schema
--  Applied by the api migration runner on boot (idempotent).
-- ============================================================

-- UUID generation (pgcrypto ships with Postgres 15).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- Users ---------------------------------------------------
-- role: 'owner' (single, created by seed) | 'admin' | 'user'
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user'
                  CHECK (role IN ('owner', 'admin', 'user')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- LLM Providers ------------------------------------------
-- type:      openai | anthropic | gemini
-- auth_mode: 'api_key'  -> shared credential stored encrypted here
--            'oauth2'   -> each user authorizes individually
CREATE TABLE IF NOT EXISTS llm_providers (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                     TEXT NOT NULL,
    type                     TEXT NOT NULL
                             CHECK (type IN ('openai', 'anthropic', 'gemini')),
    auth_mode                TEXT NOT NULL DEFAULT 'api_key'
                             CHECK (auth_mode IN ('api_key', 'oauth2')),
    api_key_encrypted        TEXT,           -- AES-GCM, master-key encrypted
    oauth_client_id          TEXT,
    oauth_client_secret_enc  TEXT,
    oauth_auth_url           TEXT,
    oauth_token_url          TEXT,
    oauth_scopes             TEXT,
    base_url                 TEXT,           -- override default provider endpoint
    default_model            TEXT NOT NULL,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Per-user OAuth2 tokens ---------------------------------
CREATE TABLE IF NOT EXISTS user_provider_tokens (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id            UUID NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    expires_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider_id)
);

-- ---- Gateway signed keys (for revocation/blocklist) ---------
-- The signed key itself is stateless; we store only metadata so the
-- gateway can sync a revocation blocklist into RAM.
CREATE TABLE IF NOT EXISTS gateway_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kid        TEXT NOT NULL UNIQUE,        -- key id embedded in the signed token
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT,
    revoked    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Conversations ------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES llm_providers(id) ON DELETE SET NULL,
    model       TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'New conversation',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

-- ---- Messages -----------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    tokens          INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- ---- Audit logs (written asynchronously by the gateway) -----
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID,
    provider_id     UUID,
    conversation_id UUID,
    model           TEXT,
    request_tokens  INTEGER NOT NULL DEFAULT 0,
    response_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    status_code     INTEGER NOT NULL DEFAULT 0,
    applied_policies JSONB NOT NULL DEFAULT '[]'::jsonb,
    cost_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
