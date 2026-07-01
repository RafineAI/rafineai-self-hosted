-- Extended app_settings defaults for branding + chat UI customization.
INSERT INTO app_settings (key, value) VALUES
    ('app_name',              'RafineAI'),
    ('app_logo',              'R'),
    ('app_tagline',           'AI Gateway'),
    ('chat_welcome_title',    'Yeni bir sohbet başlat'),
    ('chat_welcome_subtitle', 'Yukarıdan modeli seç, mesajını yaz.'),
    ('chat_placeholder',      'Mesajını yaz…  (Enter ile gönder, Shift+Enter yeni satır)'),
    ('chat_send_label',       'Gönder')
ON CONFLICT (key) DO NOTHING;
