-- App-wide key/value settings (admin-configurable).
-- NOTE: migration 0010_response_masking may have already created this table as
-- (key, value). CREATE ... IF NOT EXISTS is then a no-op, so we explicitly
-- ensure the updated_at column the settings API relies on exists either way.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Seed defaults
INSERT INTO app_settings (key, value) VALUES
    ('chat_theme', 'default')
ON CONFLICT (key) DO NOTHING;
