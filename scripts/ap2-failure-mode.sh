#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/artifacts/ap2-failure-$(date +%Y%m%d-%H%M%S)}"
LOG_FILE="$OUT_DIR/ap2-failure.log"

mkdir -p "$OUT_DIR"

if ! command -v forge >/dev/null 2>&1; then
  echo "forge not found. Install Foundry first." >&2
  exit 1
fi

echo "[ap2] Running authorization failure-mode tests..."
echo "[ap2] Output directory: $OUT_DIR"

(
  cd "$ROOT_DIR/contracts"
  forge test -vvv --match-contract IssueEscrowTest --match-test "test_Release_RevertOn(InvalidSignature|InvalidCartSignature|DoublePay|WrongIntentHash|PolicyMismatch|ChainMismatch|RepoMismatch|IssueMismatch)"
) | tee "$LOG_FILE"

echo "[ap2] Saved log: $LOG_FILE"
