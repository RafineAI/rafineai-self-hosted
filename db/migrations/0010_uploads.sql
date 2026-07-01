-- File attachments stored with messages.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Logo URL in app settings
INSERT INTO app_settings (key, value) VALUES ('app_logo_url', '')
ON CONFLICT (key) DO NOTHING;
