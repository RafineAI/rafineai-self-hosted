-- App-wide key/value settings (admin-configurable).
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults
INSERT INTO app_settings (key, value) VALUES
    ('chat_theme', 'default')
ON CONFLICT (key) DO NOTHING;
