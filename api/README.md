# api — RafineAI management backend (Python / FastAPI)

The api powers the panel: authentication, user & provider management, the
per-user OAuth2 flow, conversation persistence, the chat proxy to the gateway,
and audit queries. On startup it **runs SQL migrations** and **seeds the owner**.

## Endpoints

| Method | Path                                   | Role    | Purpose                         |
|--------|----------------------------------------|---------|---------------------------------|
| GET    | `/healthz`                             | –       | Liveness                        |
| POST   | `/api/auth/login`                      | –       | Email + password → JWT pair     |
| POST   | `/api/auth/refresh`                    | –       | Refresh access token            |
| GET    | `/api/auth/me`                         | any     | Current user (+ must_change_password) |
| POST   | `/api/auth/change-password`            | any     | Change own password             |
| GET/POST | `/api/users`                         | admin   | List / create users             |
| PATCH/DELETE | `/api/users/{id}`                | admin   | Update / delete (owner protected) |
| GET    | `/api/providers`                       | any     | List providers (+ connected flag) |
| POST/PATCH/DELETE | `/api/providers[/{id}]`     | admin   | Manage providers                |
| GET    | `/api/providers/{id}/oauth/start`      | any     | Begin per-user OAuth2           |
| GET    | `/api/oauth/callback`                  | –       | OAuth2 redirect target          |
| GET/POST | `/api/conversations`                 | any     | List / create conversations     |
| GET    | `/api/conversations/{id}/messages`     | any     | Message history                 |
| POST   | `/api/conversations/{id}/chat`         | any     | Send a message (proxied to gateway) |
| POST   | `/api/conversations/{id}/chat/stream`  | any     | Streaming chat (SSE; persists on completion) |
| GET    | `/api/audit`                           | admin   | Query audit logs                |
| GET    | `/api/policy/builtins`                 | admin   | Built-in detectors (read-only)  |
| GET/POST/PATCH/DELETE | `/api/policy/rules[/{id}]`  | admin   | Manage custom policy rules      |
| GET    | `/api/alerts`                          | admin   | Policy alerts (masked snippets) |
| POST   | `/api/alerts/{id}/resolve`             | admin   | Mark an alert resolved          |

## Security model

- Passwords hashed with **bcrypt**.
- Sessions are **JWT** (access + refresh) signed with `JWT_SECRET`.
- Provider API keys and OAuth tokens are encrypted at rest with **AES-256-GCM**
  derived from `RAFINE_MASTER_KEY` (`app/crypto.py`) — the gateway decrypts with
  the identical scheme. Raw secrets never leave the server in API responses.
- The chat proxy mints a short-lived **HMAC-signed gateway key** (`app/signing.py`)
  bound to the user + provider, which the gateway verifies with zero DB lookups.
- **Account provisioning:** an admin creates users; if no password is supplied the
  system generates a temporary one and returns it to the admin to relay (no email
  is sent). Such users must change their password on first sign-in
  (`must_change_password`). **Provider credentials are never stored in `.env`** —
  admins add them in the panel (shared API key, encrypted) or users connect via OAuth2.

> Cross-language compatibility between `app/crypto.py` / `app/signing.py` and the
> Go gateway is locked by `gateway/internal/crosslang_test.go`.

## Develop & test

A running PostgreSQL is required for the API tests.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt

# point at a test database
export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/rafineai_test"
pytest
```

Crypto/signing unit tests need no database.

## Configuration

See the root `.env.example`. Notable: `DATABASE_URL`, `RAFINE_MASTER_KEY`,
`JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `GATEWAY_URL`, `RAFINE_PUBLIC_URL`.
