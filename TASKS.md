# RafineAI Self-Hosted — Build Tasks

Bu dosya projenin görev listesidir (kaynak doğruluk). Durum: `[ ]` bekliyor, `[~]` devam ediyor, `[x]` tamamlandı.

## Blok 1 — Proje İskeleti
- [x] **T-01** Monorepo yapısı, `.gitignore`, README
- [x] **T-02** `docker-compose.yml` (prod) + `docker-compose.dev.yml` (dev) + `.env.example`
- [x] **T-03** Nginx reverse proxy config

## Blok 2 — Veritabanı
- [x] **T-04** PostgreSQL şema (users, llm_providers, user_provider_tokens, conversations, messages, audit_logs)
- [x] **T-05** Migration altyapısı (idempotent runner)
- [x] **T-06** Seed script (default owner)

## Blok 3 — Go Gateway
- [x] **T-07** Go module + proje yapısı
- [x] **T-08** HMAC-SHA256 imzalı API key (üret + doğrula)
- [x] **T-09** Lock-free tenant/state cache (`atomic.Pointer`)
- [x] **T-10** OpenAI adapter
- [x] **T-11** Anthropic adapter
- [x] **T-12** Gemini adapter
- [x] **T-13** Async audit log writer (channel + batch)

## Blok 4 — Python FastAPI Backend
- [x] **T-14** FastAPI proje yapısı + health
- [x] **T-15** JWT auth (login/refresh, password hash)
- [x] **T-16** User CRUD (owner/admin/user rolleri)
- [x] **T-17** LLM Provider CRUD (api_key şifreleme)
- [x] **T-18** Per-user OAuth2 flow
- [x] **T-19** Conversation & Message API + chat proxy
- [x] **T-20** Audit log query API

## Blok 5 — Next.js Panel
- [x] **T-21** Next.js kurulumu (app router, Tailwind, auth client)
- [x] **T-22** Login sayfası
- [x] **T-23** Chat arayüzü
- [x] **T-24** Kullanıcı yönetimi ekranı
- [x] **T-25** LLM provider ekranı
- [x] **T-26** Audit log görüntüleyici

## Blok 6 — Kurulum & Dağıtım
- [x] **T-27** `install.sh` (tek tuş kurulum)
- [x] **T-28** Dockerfile'lar (gateway, api, panel) + CI/CD workflow'ları
- [x] **T-29** End-to-end smoke test + dağıtım dokümanı

---

## Test durumu
- **Gateway:** tüm unit testler `go test -race` ile geçiyor; `go vet` temiz.
- **API:** 13 pytest senaryosu gerçek Postgres'e karşı geçiyor.
- **Panel:** production build + lint + type-check temiz.
- **Cross-language:** Python↔Go crypto/signing uyumu regresyon testiyle kilitli.
- **End-to-end:** login → provider → conversation → chat → audit zinciri
  (Python imzalı key → Go doğrulama → upstream → PII redaction → audit) gerçek
  servislerle doğrulandı.

## Phase 2
- [x] **P2-A** `scripts/gen-env.sh` — .env secret/password alanlarını otomatik doldurur
- [x] **P2-B** Streaming yanıtlar (OpenAI/Anthropic/Gemini SSE → OpenAI formatı; uçtan uca)
- [x] **P2-C** Smart routing (prompt boyutuna göre light/heavy model seçimi)
- [x] **P2-D** Rate limiting / kota (per-user istek/dk + günlük token; gateway RAM sayaçları)
- [x] **P2-E** Panel UX cilalama (streaming chat, ikonlu navigasyon, tutarlı tasarım)

## Phase 3
- [x] **P3-A** policy_rules + alerts şeması (migration 0005)
- [x] **P3-B** Gateway policy engine v2: built-in detektörler + Türkçe NLP-lite
  (finansal/müşteri sözlükleri) + admin custom kuralları; mask/block/flag;
  async alert writer (kullanıcı maskeyi görmez, admin'e uyarı gider)
- [x] **P3-C** API: policy rules CRUD + alerts listele/çöz
- [x] **P3-D** Panel: Policy Rules & Alerts ekranları (Türkçe)
- [x] **P3-E** Tüm flow ekran görüntüleri (`docs/FLOW.md`, `docs/screenshots/`)

## Phase 4 (gelecek)
- Model-tabanlı NLP sınıflandırıcı (sözlük yerine/yanında)
- LDAP / SSO
- Ollama (lokal model) adapteri
- Verified (imzalı) commit'ler

## Phase 5 — Marketplace rehberli kurulum & entegrasyon-chat (PR #12)
Branch: `claude/rafineai-llm-marketplace-setup-8ruiak`

Yapılanlar:
- [x] **P5-A** Marketplace kurulum modalı: LLM bağlama (Bağlantılarım) akışındaki
      rehberli "adım adım + konsol linki → form" yapısı; katalogda `guide` bloğu
      (github/slack/sentry), `SetupGuide` tipi.
- [x] **P5-B** Slack: `@mention` → gateway üzerinden policy-kontrollü otomatik
      cevap (aynı thread). Events API webhook (`POST /api/tools/slack/events`),
      HMAC imza doğrulama + replay koruması, `slack_events_seen` dedup (0019).
- [x] **P5-C** Slack: `url_verification` challenge'ı imzadan önce yanıtla
      (kurulum tavuk-yumurta sorunu).
- [x] **P5-D** Sentry: `POST /api/tools/sentry/explain` — issue linki → son event
      stacktrace → LLM kök-neden + çözüm (panelde). Token rehberi düzeltildi.
- [x] **P5-E** Chat'e bağlam ekleme: `POST /api/tools/context` (sentry/github/slack)
      → `<document>` bloğu; chat'te 🧩 menü + bağlam çipleri.

Bekleyen (sonra bakılacak):
- [ ] **P5-F** Entegrasyon testleri: `/events` (imza + challenge + app_mention
      dedup), `/explain`, `/context` (kaynak dispatch + hatalı ref). CI gerçek
      Postgres'e karşı çalışıyor; bu oturumda test çalıştırılmadı.
- [ ] **P5-G** Deploy notu: bu özellikler çalışan instance'a deploy edilmeden
      görünmez (özellikle yeni Slack `/events` endpoint'i → aksi halde 404,
      challenge başarısız). api + panel bu branch'le yeniden build edilmeli.
- [ ] **P5-H** Slack kurulum gereksinimleri (kullanıcı aksiyonu): Bot scopes
      (`app_mentions:read`, `channels:read/history`, `chat:write`), Event
      Subscriptions + `app_mention`, Signing Secret'ın panele girilmesi, botun
      kanala `/invite` edilmesi.
- [ ] **P5-I** Policy `block` durumunda Slack/analiz yanıtını "içerik politikası
      engelledi" olarak netleştir (şu an `quick_complete` genel hata döndürüyor;
      alert yine basılıyor).
- [ ] **P5-J** `slack_events_seen` için periyodik temizlik (sınırsız büyümesin).
- [ ] **P5-K** (opsiyonel, ertelendi) PR #12'yi izleme: CI/otofix + review yanıtları.
