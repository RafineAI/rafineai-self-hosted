# RafineAI Self-Hosted — Görev Listesi

Durum: `[ ]` bekliyor, `[~]` devam ediyor, `[x]` tamamlandı.
Branch: `claude/rafineai-llm-marketplace-setup-8ruiak` · PR #12

## Marketplace rehberli kurulum & entegrasyon-chat

Yapılanlar:
- [x] **M-1** Marketplace kurulum modalı: LLM bağlama (Bağlantılarım) akışındaki
      rehberli "adım adım + konsol linki → form" yapısı; katalogda `guide` bloğu
      (github/slack/sentry), `SetupGuide` tipi.
- [x] **M-2** Slack: `@mention` → gateway üzerinden policy-kontrollü otomatik
      cevap (aynı thread). Events API webhook (`POST /api/tools/slack/events`),
      HMAC imza doğrulama + replay koruması, `slack_events_seen` dedup (0019).
- [x] **M-3** Slack: `url_verification` challenge'ı imzadan önce yanıtla
      (kurulum tavuk-yumurta sorunu).
- [x] **M-4** Sentry: `POST /api/tools/sentry/explain` — issue linki → son event
      stacktrace → LLM kök-neden + çözüm (panelde). Token rehberi düzeltildi.
- [x] **M-5** Chat'e bağlam ekleme: `POST /api/tools/context` (sentry/github/slack)
      → `<document>` bloğu; chat'te 🧩 menü + bağlam çipleri.

Bekleyen (sonra bakılacak):
- [ ] **M-6** Entegrasyon testleri: `/events` (imza + challenge + app_mention
      dedup), `/explain`, `/context` (kaynak dispatch + hatalı ref). CI gerçek
      Postgres'e karşı çalışıyor; bu oturumda test çalıştırılmadı.
- [ ] **M-7** Deploy notu: bu özellikler çalışan instance'a deploy edilmeden
      görünmez (özellikle yeni Slack `/events` endpoint'i → aksi halde 404,
      challenge başarısız). api + panel bu branch'le yeniden build edilmeli.
- [ ] **M-8** Slack kurulum gereksinimleri (kullanıcı aksiyonu): Bot scopes
      (`app_mentions:read`, `channels:read/history`, `chat:write`), Event
      Subscriptions + `app_mention`, Signing Secret'ın panele girilmesi, botun
      kanala `/invite` edilmesi.
- [ ] **M-9** Policy `block` durumunda Slack/analiz yanıtını "içerik politikası
      engelledi" olarak netleştir (şu an `quick_complete` genel hata döndürüyor;
      alert yine basılıyor).
- [ ] **M-10** `slack_events_seen` için periyodik temizlik (sınırsız büyümesin).
- [ ] **M-11** (opsiyonel, ertelendi) PR #12'yi izleme: CI/otofix + review yanıtları.
