#!/usr/bin/env bash
# ============================================================
#  RafineAI — end-to-end smoke test against a running stack.
#  Verifies: login → create provider → create conversation →
#  chat (proxied through the gateway) → message persistence →
#  audit log written.
#
#  Usage:
#    BASE_URL=http://localhost ./scripts/smoke_test.sh
#
#  Requires the stack to be up (./install.sh) and a real LLM
#  provider, OR point a provider's base_url at a mock.
# ============================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
OWNER_EMAIL="${OWNER_EMAIL:-owner@rafine.local}"
OWNER_PASSWORD="${OWNER_PASSWORD:?set OWNER_PASSWORD (see .env)}"

# Provider under test — override to hit a real provider.
P_NAME="${P_NAME:-SmokeOpenAI}"
P_TYPE="${P_TYPE:-openai}"
P_MODEL="${P_MODEL:-gpt-4o}"
P_API_KEY="${P_API_KEY:?set P_API_KEY for the provider}"
P_BASE_URL="${P_BASE_URL:-}"

jq_get() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
step() { printf "\033[1m→ %s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$1"; }

step "Logging in as owner"
TOKEN=$(curl -fsS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" | jq_get '["access_token"]')
ok "got access token"

step "Creating provider"
BODY="{\"name\":\"$P_NAME\",\"type\":\"$P_TYPE\",\"auth_mode\":\"api_key\",\"api_key\":\"$P_API_KEY\",\"default_model\":\"$P_MODEL\""
[ -n "$P_BASE_URL" ] && BODY="$BODY,\"base_url\":\"$P_BASE_URL\""
BODY="$BODY}"
PID=$(curl -fsS -X POST "$BASE_URL/api/providers" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "$BODY" | jq_get '["id"]')
ok "provider $PID"

step "Waiting for gateway to sync provider"
sleep 4

step "Creating conversation"
CID=$(curl -fsS -X POST "$BASE_URL/api/conversations" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"provider_id\":\"$PID\",\"title\":\"smoke\"}" | jq_get '["id"]')
ok "conversation $CID"

step "Sending a chat message"
REPLY=$(curl -fsS -X POST "$BASE_URL/api/conversations/$CID/chat" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"content":"Reply with the single word: pong"}' | jq_get '["message"]["content"]')
ok "assistant replied: $REPLY"

step "Verifying messages persisted"
COUNT=$(curl -fsS "$BASE_URL/api/conversations/$CID/messages" -H "Authorization: Bearer $TOKEN" | jq_get '.__len__()')
[ "$COUNT" -ge 2 ] || { echo "expected >=2 messages, got $COUNT"; exit 1; }
ok "$COUNT messages stored"

step "Verifying audit log written"
sleep 3
AUDIT=$(curl -fsS "$BASE_URL/api/audit?limit=1" -H "Authorization: Bearer $TOKEN" | jq_get '.__len__()')
[ "$AUDIT" -ge 1 ] || { echo "no audit rows found"; exit 1; }
ok "audit log present"

printf "\n\033[32m✅ Smoke test passed.\033[0m\n"
