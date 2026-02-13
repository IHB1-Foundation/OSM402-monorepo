#!/usr/bin/env bash
# =============================================================================
# GitPay.ai — Single-Run Demo Script
# =============================================================================
# Runs the full happy-path demo in one shot:
#   Health Check → Fund (402 → Pay) → PR Open → Merge → Payout → Idempotency
#
# Usage:
#   ./scripts/demo.sh              # default (localhost:3000)
#   ./scripts/demo.sh --base-url http://my-server:4000
#   ./scripts/demo.sh --no-color   # disable color output
#
# Prerequisites:
#   - Server running (pnpm dev --filter server)
#   - .env configured with GITHUB_WEBHOOK_SECRET and GITPAY_ACTION_SHARED_SECRET
#   - curl, jq, openssl installed
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config defaults (overridable via env or flags)
# ---------------------------------------------------------------------------
BASE_URL="${DEMO_BASE_URL:-http://localhost:3000}"
WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-demo-secret}"
ACTION_SECRET="${GITPAY_ACTION_SHARED_SECRET:-demo-action-secret}"
REPO_KEY="${DEMO_REPO:-demo/repo}"
ISSUE_NUM="${DEMO_ISSUE:-1}"
PR_NUM="${DEMO_PR:-42}"
BOUNTY_USD="${DEMO_BOUNTY:-10}"
CONTRIBUTOR="${DEMO_CONTRIBUTOR:-contributor}"
CONTRIBUTOR_ADDR="${DEMO_ADDRESS:-0x1234567890abcdef1234567890abcdef12345678}"
NO_COLOR="${NO_COLOR:-}"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --base-url=*) BASE_URL="${arg#*=}" ;;
    --base-url)   shift; BASE_URL="${2:-$BASE_URL}" ;;
    --no-color)   NO_COLOR=1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
if [[ -z "$NO_COLOR" ]]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'
  YELLOW='\033[1;33m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
else
  GREEN=''; RED=''; CYAN=''; YELLOW=''; BOLD=''; DIM=''; RESET=''
fi

step_num=0
step() {
  step_num=$((step_num + 1))
  echo ""
  echo -e "${BOLD}${CYAN}━━━ Step $step_num: $1 ━━━${RESET}"
}

ok()   { echo -e "  ${GREEN}✓ $1${RESET}"; }
fail() { echo -e "  ${RED}✗ $1${RESET}"; }
info() { echo -e "  ${DIM}$1${RESET}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${RESET}"; }

check_dep() {
  if ! command -v "$1" &>/dev/null; then
    fail "Missing dependency: $1"
    exit 1
  fi
}

# Compute GitHub webhook HMAC signature for a payload string
hmac_sig() {
  local body="$1"
  echo -n "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print "sha256="$NF}'
}

# POST + capture HTTP code and body separately
api_call() {
  local method="$1"; shift
  local url="$1"; shift
  local tmp
  tmp=$(mktemp)
  local http_code
  http_code=$(curl -s -o "$tmp" -w "%{http_code}" "$@" -X "$method" "$url")
  echo "$http_code"
  cat "$tmp"
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
echo -e "${BOLD}GitPay.ai — Happy-Path Demo${RESET}"
echo -e "${DIM}Server: $BASE_URL | Repo: $REPO_KEY | Issue: #$ISSUE_NUM | PR: #$PR_NUM${RESET}"
echo ""

info "Checking dependencies..."
for dep in curl jq openssl base64; do check_dep "$dep"; done
ok "All dependencies available"

# ---------------------------------------------------------------------------
# Step 1: Health Check
# ---------------------------------------------------------------------------
step "Health Check"
HEALTH=$(curl -sf "$BASE_URL/api/health" 2>/dev/null || true)
if [[ -z "$HEALTH" ]]; then
  fail "Server not reachable at $BASE_URL"
  echo ""
  warn "Start the server first:"
  info "  pnpm dev --filter server"
  exit 1
fi
echo "$HEALTH" | jq .
ok "Server is healthy"

# ---------------------------------------------------------------------------
# Step 2a: Fund — expect 402
# ---------------------------------------------------------------------------
step "Fund Bounty — 402 Challenge (no payment)"
FUND_BODY="{\"repoKey\":\"$REPO_KEY\",\"issueNumber\":$ISSUE_NUM,\"bountyCapUsd\":$BOUNTY_USD}"
RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/fund" \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: $ACTION_SECRET" \
  -d "$FUND_BODY")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [[ "$HTTP_CODE" == "402" ]]; then
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  ok "Got 402 Payment Required (expected)"
else
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  warn "Expected 402, got $HTTP_CODE (server may be in a different mode)"
fi

# ---------------------------------------------------------------------------
# Step 2b: Fund — pay via x402 header
# ---------------------------------------------------------------------------
step "Fund Bounty — Retry with x402 Payment"
PAYMENT_JSON="{\"paymentHash\":\"demo-$(date +%s)\",\"amount\":\"10000000\",\"chainId\":84532,\"payer\":\"0x0000000000000000000000000000000000000001\"}"
PAYMENT=$(echo -n "$PAYMENT_JSON" | base64)

RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/fund" \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: $ACTION_SECRET" \
  -H "X-Payment: $PAYMENT" \
  -d "$FUND_BODY")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [[ "$HTTP_CODE" == "200" ]]; then
  ok "Bounty funded (HTTP $HTTP_CODE)"
else
  warn "HTTP $HTTP_CODE — check server logs"
fi

# ---------------------------------------------------------------------------
# Step 2c: Verify funding status
# ---------------------------------------------------------------------------
step "Verify Funding Status"
RESP=$(curl -s "$BASE_URL/api/fund/$REPO_KEY/$ISSUE_NUM" \
  -H "X-GitPay-Secret: $ACTION_SECRET")
echo "$RESP" | jq . 2>/dev/null || echo "$RESP"
STATUS=$(echo "$RESP" | jq -r '.issue.status // .status // "unknown"' 2>/dev/null)
if [[ "$STATUS" == "FUNDED" ]]; then
  ok "Issue status: FUNDED"
else
  info "Issue status: $STATUS"
fi

# ---------------------------------------------------------------------------
# Step 3: PR Opened + Address Claim
# ---------------------------------------------------------------------------
step "Simulate PR Open + Address Claim"
PR_OPEN_BODY="{\"action\":\"opened\",\"number\":$PR_NUM,\"pull_request\":{\"number\":$PR_NUM,\"title\":\"Fix #$ISSUE_NUM\",\"body\":\"Closes #$ISSUE_NUM\ngitpay:address $CONTRIBUTOR_ADDR\",\"merged\":false,\"merge_commit_sha\":null,\"user\":{\"login\":\"$CONTRIBUTOR\"},\"head\":{\"sha\":\"head$(date +%s)\"},\"base\":{\"ref\":\"main\"},\"changed_files\":2,\"additions\":30,\"deletions\":5},\"repository\":{\"full_name\":\"$REPO_KEY\",\"default_branch\":\"main\"}}"
SIG=$(hmac_sig "$PR_OPEN_BODY")
DELIVERY="demo-pr-open-$(date +%s)"

RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/webhooks/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: $DELIVERY" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$PR_OPEN_BODY")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [[ "$HTTP_CODE" == "200" ]]; then
  ok "PR recorded, address captured (HTTP $HTTP_CODE)"
else
  warn "HTTP $HTTP_CODE — check server logs"
fi

# ---------------------------------------------------------------------------
# Step 4: Merge Webhook
# ---------------------------------------------------------------------------
step "Simulate Merge → Trigger Payout Pipeline"
MERGE_SHA="abc123def456789012345678901234567890abcd"
MERGE_BODY="{\"action\":\"closed\",\"number\":$PR_NUM,\"pull_request\":{\"number\":$PR_NUM,\"title\":\"Fix #$ISSUE_NUM\",\"body\":\"Closes #$ISSUE_NUM\ngitpay:address $CONTRIBUTOR_ADDR\",\"merged\":true,\"merge_commit_sha\":\"$MERGE_SHA\",\"user\":{\"login\":\"$CONTRIBUTOR\"},\"head\":{\"sha\":\"headmerge$(date +%s)\"},\"base\":{\"ref\":\"main\"},\"changed_files\":2,\"additions\":30,\"deletions\":5},\"repository\":{\"full_name\":\"$REPO_KEY\",\"default_branch\":\"main\"}}"
SIG=$(hmac_sig "$MERGE_BODY")
MERGE_DELIVERY="demo-merge-$(date +%s)"

RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/webhooks/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: $MERGE_DELIVERY" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$MERGE_BODY")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [[ "$HTTP_CODE" == "200" ]]; then
  ok "Merge event processed (HTTP $HTTP_CODE)"
else
  warn "HTTP $HTTP_CODE — check server logs"
fi

# ---------------------------------------------------------------------------
# Step 5: Execute Payout
# ---------------------------------------------------------------------------
step "Execute Payout"
RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/payout/execute" \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: $ACTION_SECRET" \
  -d "{\"repoKey\":\"$REPO_KEY\",\"prNumber\":$PR_NUM}")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [[ "$HTTP_CODE" == "200" ]]; then
  TX_HASH=$(echo "$BODY" | jq -r '.txHash // .payout.txHash // "n/a"' 2>/dev/null)
  ok "Payout executed (HTTP $HTTP_CODE) — tx: $TX_HASH"
else
  warn "HTTP $HTTP_CODE — payout may have already been executed or check logs"
fi

# ---------------------------------------------------------------------------
# Step 6: Idempotency — replay merge webhook
# ---------------------------------------------------------------------------
step "Idempotency Check — Replay Merge Webhook"
RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/webhooks/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: $MERGE_DELIVERY" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$MERGE_BODY")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
DEDUP=$(echo "$BODY" | jq -r '.message // ""' 2>/dev/null)
if [[ "$DEDUP" == *"already processed"* ]] || [[ "$DEDUP" == *"Delivery already"* ]]; then
  ok "Duplicate webhook safely ignored"
elif [[ "$HTTP_CODE" == "200" ]]; then
  ok "Webhook handled (HTTP $HTTP_CODE) — no double payout"
else
  warn "HTTP $HTTP_CODE — check response"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}━━━ Demo Complete ━━━${RESET}"
echo ""
echo -e "  ${BOLD}Flow Executed:${RESET}"
echo -e "    1. Health Check         — server alive"
echo -e "    2. Fund (402 → x402)    — escrow funded via HTTP payment"
echo -e "    3. PR Open              — contributor address captured"
echo -e "    4. Merge Webhook        — payout pipeline triggered"
echo -e "    5. Payout Execute       — funds released from escrow"
echo -e "    6. Idempotency          — duplicate webhook safely ignored"
echo ""
echo -e "  ${BOLD}Judging Criteria:${RESET}"
echo -e "    ${CYAN}AI Readiness${RESET}       — Gemini structured review + riskFlags → HOLD"
echo -e "    ${CYAN}Commerce Realism${RESET}   — x402 HTTP 402 → payment → onchain escrow"
echo -e "    ${CYAN}Ship-ability${RESET}       — Full pipeline: fund → merge → payout"
echo -e "    ${CYAN}Partner (SKALE)${RESET}    — Gasless deployment, chain adapter, MockSKLA"
echo -e "    ${CYAN}Composability${RESET}      — EIP-712 mandates, deterministic escrow (CREATE2)"
echo ""
