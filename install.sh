#!/usr/bin/env bash
# ============================================================
#  RafineAI Self-Hosted — one-command installer.
#  Generates secrets, writes .env, starts the stack, waits for
#  health, and prints the owner login credentials.
#
#  Usage:
#    ./install.sh           # production images from the registry
#    ./install.sh --dev     # build everything from source
# ============================================================
set -euo pipefail

MODE="prod"
[ "${1:-}" = "--dev" ] && MODE="dev"

cd "$(dirname "$0")"

# ---- helpers ----
c_green() { printf "\033[32m%s\033[0m\n" "$1"; }
c_red()   { printf "\033[31m%s\033[0m\n" "$1"; }
c_bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
die()     { c_red "✗ $1"; exit 1; }

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}"; }

# ---- 1. dependency checks ----
c_bold "→ Checking prerequisites…"
command -v docker >/dev/null 2>&1 || die "Docker is not installed."
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "Docker Compose is not installed."
fi
docker info >/dev/null 2>&1 || die "Docker daemon is not running."
c_green "✓ Docker and Docker Compose found."

# ---- 2. generate .env (only if missing) ----
if [ -f .env ]; then
  c_green "✓ Existing .env found — keeping current secrets."
else
  c_bold "→ Generating secrets and writing .env…"
  POSTGRES_PASSWORD="$(rand 24)"
  MASTER_KEY="$(rand 48)"
  JWT_SECRET="$(rand 48)"
  OWNER_PASSWORD="$(rand 16)"

  cat > .env <<EOF
RAFINE_VERSION=latest
REGISTRY=ghcr.io/rafineai
RAFINE_PUBLIC_URL=http://localhost
HTTP_PORT=80

POSTGRES_USER=rafine
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=rafineai
DATABASE_URL=postgres://rafine:${POSTGRES_PASSWORD}@postgres:5432/rafineai?sslmode=disable

RAFINE_MASTER_KEY=${MASTER_KEY}
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_TTL_MIN=60
JWT_REFRESH_TTL_DAYS=14

OWNER_EMAIL=owner@rafine.local
OWNER_PASSWORD=${OWNER_PASSWORD}

GATEWAY_SYNC_INTERVAL_SEC=30
GATEWAY_AUDIT_BATCH_SIZE=50
GATEWAY_AUDIT_FLUSH_MS=2000
EOF
  c_green "✓ .env created."
fi

# ---- 3. start the stack ----
c_bold "→ Starting RafineAI ($MODE)…"
if [ "$MODE" = "dev" ]; then
  $DC -f docker-compose.dev.yml up -d --build
else
  $DC pull
  $DC up -d
fi

# ---- 4. wait for the api to be healthy ----
c_bold "→ Waiting for services to become healthy…"
HTTP_PORT="$(grep -E '^HTTP_PORT=' .env | cut -d= -f2)"
HTTP_PORT="${HTTP_PORT:-80}"
ok=0
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${HTTP_PORT}/healthz" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done
[ "$ok" = "1" ] || die "Services did not become healthy in time. Check: $DC logs"
c_green "✓ RafineAI is up."

# ---- 5. print credentials ----
OWNER_EMAIL="$(grep -E '^OWNER_EMAIL=' .env | cut -d= -f2)"
OWNER_PASSWORD="$(grep -E '^OWNER_PASSWORD=' .env | cut -d= -f2)"
echo
c_bold "============================================================"
c_green " ✅ RafineAI installed successfully!"
c_bold "============================================================"
echo "  Panel:    http://localhost:${HTTP_PORT}"
echo "  Owner:    ${OWNER_EMAIL}"
echo "  Password: ${OWNER_PASSWORD}"
echo
echo "  Manage:   $DC ps | logs | down"
c_bold "============================================================"
