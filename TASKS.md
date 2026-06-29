# RafineAI Self-Hosted — Build Tasks

Bu dosya projenin görev listesidir (kaynak doğruluk). Durum: `[ ]` bekliyor, `[~]` devam ediyor, `[x]` tamamlandı.

## Blok 1 — Proje İskeleti
- [ ] **T-01** Monorepo yapısı, `.gitignore`, README
- [ ] **T-02** `docker-compose.yml` (prod) + `docker-compose.dev.yml` (dev) + `.env.example`
- [ ] **T-03** Nginx reverse proxy config

## Blok 2 — Veritabanı
- [ ] **T-04** PostgreSQL şema (users, llm_providers, user_provider_tokens, conversations, messages, audit_logs)
- [ ] **T-05** Migration altyapısı
- [ ] **T-06** Seed script (default owner)

## Blok 3 — Go Gateway
- [ ] **T-07** Go module + proje yapısı
- [ ] **T-08** HMAC-SHA256 imzalı API key (üret + doğrula)
- [ ] **T-09** Lock-free tenant/state cache (`atomic.Pointer`)
- [ ] **T-10** OpenAI adapter
- [ ] **T-11** Anthropic adapter
- [ ] **T-12** Gemini adapter
- [ ] **T-13** Async audit log writer (channel + batch)

## Blok 4 — Python FastAPI Backend
- [ ] **T-14** FastAPI proje yapısı + health
- [ ] **T-15** JWT auth (login/refresh, password hash)
- [ ] **T-16** User CRUD (owner/admin/user rolleri)
- [ ] **T-17** LLM Provider CRUD (api_key şifreleme)
- [ ] **T-18** Per-user OAuth2 flow
- [ ] **T-19** Conversation & Message API + chat proxy
- [ ] **T-20** Audit log query API

## Blok 5 — Next.js Panel
- [ ] **T-21** Next.js kurulumu (app router, Tailwind, auth context)
- [ ] **T-22** Login sayfası
- [ ] **T-23** Chat arayüzü (streaming)
- [ ] **T-24** Kullanıcı yönetimi ekranı
- [ ] **T-25** LLM provider ekranı
- [ ] **T-26** Audit log görüntüleyici

## Blok 6 — Kurulum & Dağıtım
- [ ] **T-27** `install.sh` (tek tuş kurulum)
- [ ] **T-28** Dockerfile'lar (gateway, api, panel)
- [ ] **T-29** End-to-end smoke test + dağıtım dokümanı
