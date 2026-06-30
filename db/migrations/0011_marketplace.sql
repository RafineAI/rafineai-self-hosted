-- Migration 0011: marketplace
-- Installed integrations. The catalog of available apps is defined in code
-- (app/marketplace.py); this table records which apps an org has installed and
-- their encrypted configuration (tokens, org slugs, etc.).

CREATE TABLE IF NOT EXISTS installed_integrations (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    app_slug         TEXT        NOT NULL UNIQUE,
    config_encrypted TEXT        NOT NULL DEFAULT '',   -- AES-GCM JSON blob
    enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
    installed_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved HTTP requests for the built-in API Client (Postman-like) tool.
CREATE TABLE IF NOT EXISTS api_requests (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL DEFAULT 'İsimsiz istek',
    method      TEXT        NOT NULL DEFAULT 'GET',
    url         TEXT        NOT NULL DEFAULT '',
    headers     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    body        TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_requests_owner ON api_requests(owner_id, created_at DESC);
