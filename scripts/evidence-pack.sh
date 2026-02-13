#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

BASE_URL="${DEMO_BASE_URL:-http://localhost:3000}"
ACTION_SECRET="${OSM402_ACTION_SHARED_SECRET:-${GITPAY_ACTION_SHARED_SECRET:-demo-action-secret}}"
DEMO_REPO="${DEMO_REPO:-owner/repo}"
ISSUE_PASS="${DEMO_ISSUE_PASS:-${DEMO_ISSUE:-1}}"
ISSUE_HOLD="${DEMO_ISSUE_HOLD:-2}"
PASS_PR_NO="${DEMO_PASS_PR:-${DEMO_PR:-1}}"
HOLD_PR_NO="${DEMO_HOLD_PR:-2}"
OUT_DIR="${1:-$ROOT_DIR/artifacts/evidence-$TIMESTAMP}"

mkdir -p "$OUT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

api_call() {
  local method="$1"
  local url="$2"
  local out_file="$3"
  shift 3

  local tmp
  tmp="$(mktemp)"
  local status
  status="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url" "$@" || true)"
  cp "$tmp" "$out_file"
  echo "$status" > "${out_file}.status"
  rm -f "$tmp"
}

echo "[evidence] collecting into $OUT_DIR"

cat > "$OUT_DIR/context.json" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "baseUrl": "$BASE_URL",
  "repoKey": "$DEMO_REPO",
  "issuePass": $ISSUE_PASS,
  "issueHold": $ISSUE_HOLD,
  "prPass": $PASS_PR_NO,
  "prHold": $HOLD_PR_NO
}
EOF

api_call GET "$BASE_URL/api/health" "$OUT_DIR/health.json"
api_call POST "$BASE_URL/api/x402-test" "$OUT_DIR/x402-challenge.json" \
  -H "Content-Type: application/json" \
  -d '{}'
api_call GET "$BASE_URL/api/fund/$DEMO_REPO/$ISSUE_PASS" "$OUT_DIR/fund-pass.json" \
  -H "X-OSM402-Secret: $ACTION_SECRET"
api_call GET "$BASE_URL/api/fund/$DEMO_REPO/$ISSUE_HOLD" "$OUT_DIR/fund-hold.json" \
  -H "X-OSM402-Secret: $ACTION_SECRET"
api_call POST "$BASE_URL/api/payout/execute" "$OUT_DIR/payout-pass.json" \
  -H "Content-Type: application/json" \
  -H "X-OSM402-Secret: $ACTION_SECRET" \
  -d "{\"repoKey\":\"$DEMO_REPO\",\"prNumber\":$PASS_PR_NO}"
api_call POST "$BASE_URL/api/payout/execute" "$OUT_DIR/payout-hold.json" \
  -H "Content-Type: application/json" \
  -H "X-OSM402-Secret: $ACTION_SECRET" \
  -d "{\"repoKey\":\"$DEMO_REPO\",\"prNumber\":$HOLD_PR_NO}"

AP2_STATUS="ok"
if ! bash "$ROOT_DIR/scripts/ap2-failure-mode.sh" "$OUT_DIR/ap2-failure" >"$OUT_DIR/ap2-failure.stdout.log" 2>&1; then
  AP2_STATUS="failed"
fi

cp "$ROOT_DIR/README.md" "$OUT_DIR/README.snapshot.md"
cp "$ROOT_DIR/docs/DEMO.md" "$OUT_DIR/DEMO.snapshot.md"
if [[ -f "$ROOT_DIR/docs/SUBMISSION.md" ]]; then
  cp "$ROOT_DIR/docs/SUBMISSION.md" "$OUT_DIR/SUBMISSION.snapshot.md"
fi

cat > "$OUT_DIR/SUMMARY.md" <<EOF
# Evidence Summary

- Generated at: \`$TIMESTAMP\`
- Base URL: \`$BASE_URL\`
- Repo: \`$DEMO_REPO\`

## HTTP Status Snapshot

- \`/api/health\`: $(cat "$OUT_DIR/health.json.status")
- \`/api/x402-test\` (expect 402): $(cat "$OUT_DIR/x402-challenge.json.status")
- \`/api/fund/$DEMO_REPO/$ISSUE_PASS\`: $(cat "$OUT_DIR/fund-pass.json.status")
- \`/api/fund/$DEMO_REPO/$ISSUE_HOLD\`: $(cat "$OUT_DIR/fund-hold.json.status")
- \`/api/payout/execute\` PASS PR \`#$PASS_PR_NO\`: $(cat "$OUT_DIR/payout-pass.json.status")
- \`/api/payout/execute\` HOLD PR \`#$HOLD_PR_NO\`: $(cat "$OUT_DIR/payout-hold.json.status")

## AP2 Failure-Mode Status

- \`scripts/ap2-failure-mode.sh\`: $AP2_STATUS
- Log: \`ap2-failure/ap2-failure.log\`

## Included Files

\`\`\`text
context.json
health.json
x402-challenge.json
fund-pass.json
fund-hold.json
payout-pass.json
payout-hold.json
ap2-failure.stdout.log
ap2-failure/ap2-failure.log
README.snapshot.md
DEMO.snapshot.md
SUBMISSION.snapshot.md (if exists)
\`\`\`
EOF

echo "[evidence] done"
echo "[evidence] summary: $OUT_DIR/SUMMARY.md"
