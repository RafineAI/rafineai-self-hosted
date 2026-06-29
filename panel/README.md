# panel — RafineAI web UI (Next.js 14)

The operator/user-facing panel: login, chat, and admin screens for users,
providers, and audit logs. App Router + TypeScript + Tailwind.

## Pages

| Route        | Access | Purpose                                            |
|--------------|--------|----------------------------------------------------|
| `/login`     | public | Email + password sign-in                           |
| `/chat`      | any    | Conversation list, message thread, composer        |
| `/providers` | admin  | Configure LLM providers; connect per-user OAuth2    |
| `/users`     | admin  | Create / enable / disable / delete users           |
| `/audit`     | admin  | Browse audit logs                                  |

## How it talks to the backend

`lib/api.ts` is a small fetch wrapper that attaches the JWT access token and
transparently refreshes it on 401. The base URL is `NEXT_PUBLIC_API_URL`
(empty = same origin, which nginx proxies to the api). Sessions are kept in
`localStorage`; role-gated nav is enforced client-side and re-checked by the api.

## Develop

```bash
npm install
# Point at the api when running outside docker:
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local
npm run dev      # http://localhost:3000
```

## Build & lint

```bash
npm run lint
npm run build    # produces .next/standalone (used by the Dockerfile)
```

The Dockerfile builds the standalone output and runs `node server.js`.
