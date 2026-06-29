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

## Phase 2 (MVP dışı, dokümante edildi)
- Streaming yanıtlar (şu an non-streaming)
- Smart routing (maliyet bazlı model seçimi)
- Gelişmiş policy kuralları (deny/route, özelleştirilebilir regex)
- Rate limiting / kota
- LDAP / SSO
- Ollama (lokal model) adapteri
