# RafineAI Self-Hosted

> Open-source AI Governance & API Gateway — run it entirely on your own infrastructure.

RafineAI sits between your applications/users and LLM providers (OpenAI, Anthropic,
Gemini, …). It authenticates traffic, applies security policy, records a full audit
trail of every interaction, and serves a built-in chat panel — all from a single
`docker compose up`.

This repository is a **monorepo**: the Go gateway, the Python management API, the
Next.js panel, the database schema, and the deployment tooling all live here and are
released together as versioned container images.

> 📸 **See the full product flow with screenshots:** [`docs/FLOW.md`](./docs/FLOW.md)
> — login, chat, providers, users, policy rules, alerts (masking + admin alerts),
> and audit logs.

---

## Enterprise features (Phase 4)

Beyond the core gateway + chat, RafineAI ships an enterprise feature set:

| Feature | What it does |
|---------|--------------|
| 📁 **Document storage + preview** | Upload files to internal storage; inline preview for images/PDF/text/code. Pluggable backend (local volume, S3-ready). |
| 🧑‍🤝‍🧑 **Teams** | Group users; set team-level RPM/token limits and per-provider access. The gateway enforces the most restrictive limit; provider access is checked at conversation creation. |
| 📚 **RAG / NotebookLM** | Index documents (pgvector embeddings) and ask grounded questions; answers cite their source documents. |
| 🛡️ **Response masking** | Mask sensitive data (TCKN, IBAN, cards, API keys) in the *model's reply* too — works mid-stream via a whitespace-boundary masker. Toggle on the Policy page. |
| 📊 **Usage dashboard** | Requests, tokens, estimated cost, p95 latency, error rate; daily charts, model distribution, top users. Gateway also exposes Prometheus `/metrics`. |
| 🧩 **Marketplace** | Install integrations with encrypted config: **GitHub** (browse/read repos), **Slack** (follow channels, read & post; auto-reply to @-mentions in-thread, policy-checked via the gateway), **Sentry** (issues), **API Client** (Postman-like + "ask the LLM"), **Swagger/OpenAPI** (import endpoints), **Fine-tuning** (OpenAI jobs from a stored JSONL). |

All new tables are added by idempotent migrations `0008`–`0014`. The Postgres
image is `pgvector/pgvector:pg15` to support RAG. Document storage uses a
`storage` volume mounted at `/data/storage`.

---

## Architecture

```
                         ┌──────────────────────────────────────────┐
   Browser ──► :80 nginx ─┤                                          │
                         │   panel (Next.js)  ──►  api (FastAPI)     │
                         │        chat UI            JWT auth         │
                         │                           user/provider   │
                         │                           mgmt + chat      │
                         │                              │             │
                         │                              ▼             │
   External app ─────────────────────────────►  gateway (Go)        │
   (signed API key)      │                       OpenAI-compatible    │
                         │                       hot path:            │
                         │                        • HMAC key auth     │
                         │                        • RAM state (atomic)│
                         │                        • policy engine     │
                         │                        • provider adapters │
                         │                        • async audit       │
                         │                              │             │
                         │                              ▼             │
                         │                         postgres           │
                         └──────────────────────────────┼─────────────┘
                                                        ▼
                              LLM Providers (OpenAI / Anthropic / Gemini)
```

### Services

| Service    | Tech              | Responsibility                                              |
|------------|-------------------|-------------------------------------------------------------|
| `gateway`  | Go 1.24 + Echo    | OpenAI-compatible LLM proxy, HMAC key auth, RAM state, async audit |
| `api`      | Python 3.11 + FastAPI | User/provider management, JWT auth, OAuth2, chat persistence |
| `panel`    | Next.js 14        | Login, chat, user management, provider config, audit viewer |
| `postgres` | PostgreSQL 15     | All persistent data                                         |
| `nginx`    | Nginx             | Single-port reverse proxy (panel + api + gateway)           |

### Key architectural decisions

- **Zero-network auth** — Gateway API keys are HMAC-SHA256 signed. The gateway
  verifies them with CPU math only, no DB round-trip per request.
- **Lock-free local state** — Provider config and the ban/quota list live in RAM,
  swapped atomically (`atomic.Pointer`). No mutex on the hot path.
- **Background sync** — A worker refreshes that state from PostgreSQL every N seconds,
  so the gateway keeps serving even if the DB blips.
- **Async audit logging** — Logs go to a buffered channel and are batch-written by a
  worker; the request/response path is never blocked.

---

## Quick Start

### Prerequisites
- Docker & Docker Compose v2
- A machine with ≥ 2 GB RAM

### Install (one command)

```bash
git clone https://github.com/RafineAI/rafineai-self-hosted.git
cd rafineai-self-hosted
./install.sh
```

`install.sh` checks dependencies, generates strong secrets, writes `.env`, starts the
stack, waits for health, seeds the default **owner** account, and prints your login
credentials.

### Or run manually

```bash
cp .env.example .env      # edit secrets + provider keys
docker compose up -d      # uses pre-built images from the registry
```

The panel is then available at `http://localhost`.

### Local development (build from source)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

> **Distributing to customers?** See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)
> for the build → registry → one-command-install model (GHCR / GCP Artifact
> Registry), upgrades, and backups.

---

## First login

After install you get an **owner** account (`owner@rafine.local` by default). The owner
can:
1. Create **admin** and **user** accounts (User Management).
2. Configure **LLM providers** (LLM Management) — either a shared API key or per-user
   OAuth2.
3. Hand the panel URL to users, who log in and start chatting immediately.

Roles:

| Role    | Capabilities                                                       |
|---------|--------------------------------------------------------------------|
| `owner` | Everything. Single, cannot be deleted.                             |
| `admin` | Manage users, providers, policies; view all audit logs.           |
| `user`  | Chat; view only their own conversations.                          |

---

## Repository layout

```
rafineai-self-hosted/
├── install.sh                 # one-command installer
├── docker-compose.yml         # production (pre-built images)
├── docker-compose.dev.yml     # development (build from source)
├── .env.example
├── db/                        # SQL schema + migrations
├── gateway/                   # Go hot-path proxy        → README in folder
├── api/                       # Python FastAPI backend   → README in folder
├── panel/                     # Next.js panel            → README in folder
└── nginx/                     # reverse proxy config
```

Each service folder has its own `README.md` with build/test/run instructions.

---

## Development & tests

```bash
# Go gateway
cd gateway && go test ./... && go vet ./...

# Python api
cd api && pip install -r requirements-dev.txt && pytest

# Next.js panel
cd panel && npm install && npm run lint && npm run build
```

See [`TASKS.md`](./TASKS.md) for the build roadmap and status.

---

## License

[MIT](LICENSE)
