# RafineAI Self-Hosted

> Open-source AI Governance & API Gateway — run it on your own infrastructure.

RafineAI sits between your applications and LLM providers (OpenAI, Anthropic, Gemini, etc.), acting as a security, audit, and policy layer. The self-hosted edition lets you bring your own API keys and deploy everything on your own servers with zero external telemetry.

---

## Features

- **Policy Engine** — pre-flight and post-flight prompt analysis (Deny, Redact, Route)
- **Multi-tenant Workspaces** — isolated tenants with independent budgets, models, and rules
- **Audit & Observability** — every request logged asynchronously (token count, latency, applied rules, response)
- **Zero-latency hot path** — security rules loaded into RAM via atomic swap, never read from DB per request
- **Signed API Keys** — CPU-level cryptographic verification, no network round-trip
- **Single binary + PostgreSQL** — no Redis or other external dependencies

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- PostgreSQL 15+

### Run with Docker Compose

```bash
git clone https://github.com/RafineAI/rafineai-self-hosted.git
cd rafineai-self-hosted
cp .env.example .env   # fill in your LLM provider keys and DB credentials
docker compose up -d
```

The gateway will be available at `http://localhost:8080`.

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `RAFINE_MASTER_KEY` | Master signing key for API key generation | Yes |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI) | No |
| `ANTHROPIC_API_KEY` | Anthropic API key (if using Claude) | No |
| `GEMINI_API_KEY` | Google Gemini API key | No |

---

## Architecture

```
Client App
    │
    ▼
RafineAI Gateway  ◄── Policy Engine (in-memory, atomic swap)
    │                   └── Deny / Redact / Route rules
    ▼
LLM Provider (OpenAI / Anthropic / Gemini / …)
    │
    ▼
Async Audit Log ──► PostgreSQL
```

---

## Development

```bash
# Run tests
go test ./...

# Lint
go vet ./...

# Build binary
go build -o rafineai ./cmd/gateway
```

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes and open a PR

---

## License

[MIT](LICENSE)
