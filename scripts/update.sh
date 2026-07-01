#!/usr/bin/env bash
# update.sh — Pull latest code and restart the RafineAI stack.
#
# Usage:
#   ./scripts/update.sh            # prod stack (pre-built images)
#   ./scripts/update.sh --dev      # dev stack (build from source)
#   ./scripts/update.sh --dev --no-pull  # dev, skip git pull (local changes only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ── Parse args ───────────────────────────────────────────────────────────────
DEV=false
SKIP_PULL=false
for arg in "$@"; do
  case "$arg" in
    --dev)       DEV=true ;;
    --no-pull)   SKIP_PULL=true ;;
    -h|--help)
      echo "Usage: $0 [--dev] [--no-pull]"
      echo "  --dev       Use dev compose (build from source)"
      echo "  --no-pull   Skip git pull (useful if you have local changes)"
      exit 0 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1 ;;
  esac
done

COMPOSE_FILE="docker-compose.yml"
$DEV && COMPOSE_FILE="docker-compose.dev.yml"

# ── Helpers ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${GREEN}▶ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
die()  { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || die "docker is not installed"
command -v git     >/dev/null 2>&1 || die "git is not installed"
[ -f ".env" ] || die ".env not found — run ./scripts/gen-env.sh first"

# ── Git pull ──────────────────────────────────────────────────────────────────
if $SKIP_PULL; then
  warn "Skipping git pull (--no-pull)"
else
  step "Pulling latest code from origin"

  # Warn about uncommitted changes but don't abort
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Uncommitted local changes detected — stashing before pull"
    git stash push -m "update.sh auto-stash $(date +%Y%m%d-%H%M%S)"
    STASHED=true
  else
    STASHED=false
  fi

  BEFORE=$(git rev-parse --short HEAD)
  git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" || {
    warn "Fast-forward pull failed; trying rebase"
    git pull --rebase origin "$(git rev-parse --abbrev-ref HEAD)"
  }
  AFTER=$(git rev-parse --short HEAD)

  if [ "$BEFORE" = "$AFTER" ]; then
    echo "Already up to date ($AFTER)."
  else
    echo "Updated: $BEFORE → $AFTER"
    git log --oneline "$BEFORE..$AFTER"
  fi

  if [ "${STASHED:-false}" = "true" ]; then
    step "Re-applying stashed changes"
    git stash pop || warn "Stash pop had conflicts — resolve manually with: git stash pop"
  fi
fi

# ── Stop running stack ────────────────────────────────────────────────────────
step "Stopping current stack"
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

# ── Build / pull images ───────────────────────────────────────────────────────
if $DEV; then
  step "Building images from source"
  docker compose -f "$COMPOSE_FILE" build --parallel
else
  step "Pulling latest images from registry"
  docker compose -f "$COMPOSE_FILE" pull
fi

# ── Start stack ───────────────────────────────────────────────────────────────
step "Starting stack"
docker compose -f "$COMPOSE_FILE" up -d

# ── Health check ──────────────────────────────────────────────────────────────
step "Waiting for API to become healthy"
MAX=30
for i in $(seq 1 $MAX); do
  if docker compose -f "$COMPOSE_FILE" exec -T api \
       wget -qO- http://localhost:8000/healthz 2>/dev/null | grep -q '"ok"'; then
    echo -e "${GREEN}✓ API is healthy${NC}"
    break
  fi
  if [ "$i" -eq "$MAX" ]; then
    warn "API did not respond in time — check logs: docker compose -f $COMPOSE_FILE logs api"
  else
    printf "."
    sleep 2
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
docker compose -f "$COMPOSE_FILE" ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"
echo "════════════════════════════════════════"
echo -e "${GREEN}✓ Update complete${NC}"
echo "  Logs:   docker compose -f $COMPOSE_FILE logs -f"
echo "  Stop:   docker compose -f $COMPOSE_FILE down"
