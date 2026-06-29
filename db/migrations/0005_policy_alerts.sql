-- ============================================================
--  Phase 3: admin-defined content policy rules + alerts.
-- ============================================================

-- Custom rules an admin defines on top of the gateway's built-in detectors.
--   kind:     'regex' | 'keyword'
--   category: free-form label (e.g. 'financial', 'customer_data', 'secret')
--   action:   'mask'  -> redact match before it reaches the LLM (+ alert)
--             'block' -> reject the request          (+ alert)
--             'flag'  -> allow, but alert the admin
--   severity: 'low' | 'medium' | 'high'
CREATE TABLE IF NOT EXISTS policy_rules (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,
    category   TEXT NOT NULL DEFAULT 'custom',
    kind       TEXT NOT NULL CHECK (kind IN ('regex', 'keyword')),
    pattern    TEXT NOT NULL,
    action     TEXT NOT NULL CHECK (action IN ('mask', 'block', 'flag')),
    severity   TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alerts raised when a detector/rule fires. The snippet is already masked, so
-- viewing alerts never exposes the original sensitive value.
CREATE TABLE IF NOT EXISTS alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    conversation_id UUID,
    rule_name       TEXT NOT NULL,
    category        TEXT NOT NULL,
    action          TEXT NOT NULL,
    severity        TEXT NOT NULL,
    snippet         TEXT NOT NULL DEFAULT '',
    resolved        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, created_at DESC);
