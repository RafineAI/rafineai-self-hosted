#!/usr/bin/env bash
# ============================================================
#  RafineAI — generate a .env from .env.example with strong,
#  auto-filled secrets. Safe to run standalone or from install.sh.
#
#  Usage:
#    ./scripts/gen-env.sh            # create .env (refuses if it exists)
#    ./scripts/gen-env.sh --force    # overwrite an existing .env
#    ./scripts/gen-env.sh --print    # print to stdout, don't write a file
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

EXAMPLE=".env.example"
TARGET=".env"
FORCE=0
PRINT=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --print) PRINT=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -f "$EXAMPLE" ] || { echo "✗ $EXAMPLE not found (run from repo root)"; exit 1; }
if [ "$PRINT" = "0" ] && [ -f "$TARGET" ] && [ "$FORCE" = "0" ]; then
  echo "✓ $TARGET already exists — keeping it (use --force to regenerate)."
  exit 0
fi

# Random secret generator: alphanumeric of N chars (default 32).
# `head` closes the pipe early, so `tr` takes SIGPIPE — `|| true` keeps that
# from tripping `set -o pipefail`/`set -e`.
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "${1:-32}" || true; }

# Generate all secrets up front so DATABASE_URL can reference the DB password.
POSTGRES_USER_VAL="rafine"
POSTGRES_DB_VAL="rafineai"
POSTGRES_PASSWORD_VAL="$(rand 24)"
RAFINE_MASTER_KEY_VAL="$(rand 48)"
JWT_SECRET_VAL="$(rand 48)"
OWNER_PASSWORD_VAL="$(rand 16)"
DATABASE_URL_VAL="postgres://${POSTGRES_USER_VAL}:${POSTGRES_PASSWORD_VAL}@postgres:5432/${POSTGRES_DB_VAL}?sslmode=disable"

# Map of KEY -> generated value. Any KEY=... line in .env.example whose key is
# listed here gets its value replaced; everything else (comments, ports, URLs)
# is copied through verbatim.
declare -A OVERRIDES=(
  [POSTGRES_USER]="$POSTGRES_USER_VAL"
  [POSTGRES_DB]="$POSTGRES_DB_VAL"
  [POSTGRES_PASSWORD]="$POSTGRES_PASSWORD_VAL"
  [DATABASE_URL]="$DATABASE_URL_VAL"
  [RAFINE_MASTER_KEY]="$RAFINE_MASTER_KEY_VAL"
  [JWT_SECRET]="$JWT_SECRET_VAL"
  [OWNER_PASSWORD]="$OWNER_PASSWORD_VAL"
)

emit() {
  while IFS= read -r line || [ -n "$line" ]; do
    # Pass through comments and blank lines untouched.
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
      printf '%s\n' "$line"; continue
    fi
    key="${line%%=*}"
    if [[ -n "${OVERRIDES[$key]+x}" ]]; then
      printf '%s=%s\n' "$key" "${OVERRIDES[$key]}"
    else
      printf '%s\n' "$line"
    fi
  done < "$EXAMPLE"
}

if [ "$PRINT" = "1" ]; then
  emit
else
  emit > "$TARGET"
  chmod 600 "$TARGET"
  echo "✓ Wrote $TARGET with auto-generated secrets."
  echo "  Owner password: $OWNER_PASSWORD_VAL"
fi
