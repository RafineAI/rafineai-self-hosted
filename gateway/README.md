# gateway — RafineAI hot-path proxy (Go)

The gateway is the performance-critical component. It authenticates HMAC-signed
API keys with **zero database round-trips**, serves an **OpenAI-compatible**
chat endpoint, applies a content policy, and writes audit logs **asynchronously**.

## Endpoints

| Method | Path                     | Description                                  |
|--------|--------------------------|----------------------------------------------|
| GET    | `/healthz`               | Liveness probe                               |
| POST   | `/v1/chat/completions`   | OpenAI-compatible chat (auth: `Bearer <rk_…>`) |

### Request headers
- `Authorization: Bearer rk_…` — signed gateway key (required)
- `X-Rafine-Provider: <provider-id>` — provider override (optional; the key may embed it)
- `X-Rafine-Conversation: <conversation-id>` — for audit linkage (optional)

## How auth works (zero-network)

A key is `rk_<base64url(payloadJSON)>.<base64url(hmacSHA256)>`. The gateway
recomputes the HMAC with `RAFINE_MASTER_KEY` and compares in constant time. No
DB lookup happens on the hot path. Revocation is handled by an in-RAM blocklist
synced from `gateway_keys` every `GATEWAY_SYNC_INTERVAL_SEC` seconds.

See `internal/signing` — the identical scheme is implemented in the Python api
(`app/signing.py`) so the api can mint keys the gateway trusts.

## State model

`internal/state` holds an immutable `Snapshot` (providers, per-user OAuth tokens,
blocklist) swapped atomically via `atomic.Pointer`. Hot-path reads never lock.
`internal/store` loads/decrypts that snapshot from PostgreSQL; the sync worker
in `cmd/gateway/main.go` refreshes it on an interval. If the DB is unreachable,
the previous snapshot keeps serving.

## Content policy

`internal/policy` redacts obvious PII (Turkish national ID, credit-card-like
numbers) before forwarding. Rule names are recorded in the audit trail. This is
the hook for richer deny/route rules later.

## Provider adapters

`internal/provider` translates the unified OpenAI-shaped request to/from each
upstream: `openai`, `anthropic`, `gemini`. **MVP is non-streaming.** Streaming
passthrough is a documented Phase-2 item.

## Develop & test

```bash
go test ./...        # unit tests
go test -race ./...  # race detector
go vet ./...
go build ./cmd/gateway
```

## Configuration

All settings come from environment variables — see the root `.env.example`.
Key ones: `DATABASE_URL`, `RAFINE_MASTER_KEY`, `GATEWAY_PORT`,
`GATEWAY_SYNC_INTERVAL_SEC`, `GATEWAY_AUDIT_BATCH_SIZE`, `GATEWAY_AUDIT_FLUSH_MS`.
