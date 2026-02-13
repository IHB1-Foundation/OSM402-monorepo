# GitPay.ai — Demo Playbook

**Duration:** 5–10 minutes setup, 3–5 minutes demo run

---

## Quick Start (Local Mock Demo)

After setup, run the entire happy path in a single shot:

```bash
./scripts/demo.sh
```

The script runs all 6 demo steps automatically: health check, funding (402 challenge → payment), PR open with address claim, merge webhook, payout execution, and idempotency verification.

This quick start assumes:

- `X402_MOCK_MODE=true`
- `ESCROW_MOCK_MODE=true`

Options:

```bash
./scripts/demo.sh --no-color            # disable color output
DEMO_BASE_URL=http://host:4000 ./scripts/demo.sh  # custom server URL
```

---

## Pre-Demo Checklist

### 1. Machine Setup (one-time)

- [ ] Node 20+ installed (`node -v`)
- [ ] pnpm 8+ installed (`pnpm -v`)
- [ ] Foundry installed (`forge --version`) — for contract tests/deploy
- [ ] `jq` installed (`jq --version`) — for JSON output formatting
- [ ] `openssl` available (`openssl version`) — for webhook signature

### 2. Project Setup (one-time)

```bash
git clone <repo-url> && cd gitpay
pnpm install
pnpm -r build
cp .env.example .env
```

### 3. Environment Configuration

Edit `.env` with these values:

```bash
# Required for demo
GITHUB_WEBHOOK_SECRET=demo-secret
GITPAY_ACTION_SHARED_SECRET=demo-action-secret

# Mock modes (recommended for stable demo)
X402_MOCK_MODE=true
ESCROW_MOCK_MODE=true
```

### 4. Start Server

```bash
pnpm dev --filter server
```

Verify: `curl http://localhost:3000/api/health | jq`

### 5. Optional: SKALE Hackathon Chain Mode (BITE V2 Sandbox 2)

Use this when you want the full “Commerce Realism” story:

- x402 challenge (HTTP 402)
- **Onchain ERC20 transfer proof** (txHash)
- Escrow `release(...)` on SKALE testnet

- [ ] Choose SKALE hackathon chain: **BITE V2 Sandbox 2**
- [ ] Deploy contracts (MockSKLA + IssueEscrowFactory)
- [ ] Run server with SKALE config and real modes
- [ ] Fund using the provided `x402Fund.ts` helper

Faucet (if you need sFUEL / test assets): request in SKALE Builders Telegram:

- `https://t.me/+dDdvu5T6BOEzZDEx`

#### 5.1 Set SKALE env vars in `.env`

  ```bash
  CHAIN_NAME=bite-v2-sandbox-2
  # Optional overrides (defaults exist for bite-v2-sandbox-2 preset)
  RPC_URL=https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2
  EXPLORER_URL=https://base-sepolia-testnet-explorer.skalenodes.com:10032

  # Asset (recommended: chain USDC)
  # BITE V2 Sandbox 2 USDC (decimals 6): 0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8
  # (You can omit ASSET_* entirely if you keep the preset defaults.)
  ASSET_SYMBOL=USDC
  ASSET_DECIMALS=6
  ASSET_ADDRESS=0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8

  # Escrow factory
  ESCROW_FACTORY_ADDRESS=<FACTORY_ADDRESS>

  # Real modes
  X402_MOCK_MODE=false
  ESCROW_MOCK_MODE=false

  # Agent keys (required for real onchain release)
  GITPAY_MAINTAINER_PRIVATE_KEY=<intent_signer_key>
  GITPAY_AGENT_PRIVATE_KEY=<cart_signer_and_tx_sender_key>
  ```

#### 5.2 Deploy contracts to BITE V2 Sandbox 2

  ```bash
  export BITE_V2_SANDBOX_2_RPC_URL="https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2"
  export DEPLOYER_PRIVATE_KEY="<key>"
  pnpm --filter contracts deploy:bite-v2-sandbox-2
  ```

Record the printed addresses into `.env`:

- `MockSKLA` → optional (only if you choose to use it instead of USDC)
- `IssueEscrowFactory` → `ESCROW_FACTORY_ADDRESS`

Explorer proof:

- `https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/<FACTORY>`

### 6. Optional: Real GitHub Integration

For a live GitHub demo (webhook from a real repo):

- [ ] Create a GitHub App with webhook events: `issues`, `pull_request`, `issue_comment`
- [ ] Install the app on a test repository
- [ ] Set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PEM`, `GITHUB_WEBHOOK_SECRET` in `.env`
- [ ] Use ngrok or similar to expose local server: `ngrok http 3000`
- [ ] Set webhook URL in GitHub App settings to ngrok URL + `/api/webhooks/github`
- [ ] Add `.gitpay.yml` to the test repository root
- [ ] Add a `bounty:$10` label to an issue to trigger funding

---

## Happy Path Demo Script (Manual)

All commands assume server is running on `http://localhost:3000`.

### Step 1: Health Check (10s)

```bash
curl -s http://localhost:3000/api/health | jq
```

Expected: `{"status":"ok","timestamp":"...","version":"0.1.0"}`

### Step 2: Fund a Bounty via x402 (Mock Mode) (60s)

#### 2a. Call without payment → 402 challenge

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST http://localhost:3000/api/fund \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: demo-action-secret" \
  -d '{"repoKey":"demo/repo","issueNumber":1,"bountyCapUsd":10}'
```

Expected: `HTTP 402` with payment requirements JSON.

#### 2b. Retry with x402 payment header → funded

```bash
PAYMENT=$(echo -n '{"paymentHash":"demo-001","amount":"10000000","chainId":84532,"payer":"0x0000000000000000000000000000000000000001"}' | base64)

curl -s -X POST http://localhost:3000/api/fund \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: demo-action-secret" \
  -H "X-Payment: $PAYMENT" \
  -d '{"repoKey":"demo/repo","issueNumber":1,"bountyCapUsd":10}' | jq
```

Expected: `200` with escrowAddress, depositTxHash, intentHash.

#### 2c. Verify funding status

```bash
curl -s http://localhost:3000/api/fund/demo/repo/1 \
  -H "X-GitPay-Secret: demo-action-secret" | jq '.issue.status'
```

Expected: `"FUNDED"`

### Step 2 (Alt): Fund via x402 on SKALE Testnet (Real Mode) (60–120s)

In real mode (`X402_MOCK_MODE=false`), the server verifies an onchain ERC20 transfer
to the required escrow address. The safest way is to use the helper script:

```bash
pnpm --filter server tsx src/scripts/x402Fund.ts \
  --base-url http://localhost:3000 \
  --secret "demo-action-secret" \
  --repo "demo/repo" \
  --issue 1 \
  --bounty 10 \
  --rpc-url "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2" \
  --private-key "<PAYER_PRIVATE_KEY>"
```

### Step 3: Simulate PR Open + Address Claim (30s)

```bash
SIG=$(echo -n '{"action":"opened","number":42,"pull_request":{"number":42,"title":"Fix #1","body":"Closes #1\ngitpay:address 0x1234567890abcdef1234567890abcdef12345678","merged":false,"merge_commit_sha":null,"user":{"login":"contributor"},"head":{"sha":"head123"},"base":{"ref":"main"},"changed_files":2,"additions":30,"deletions":5},"repository":{"full_name":"demo/repo","default_branch":"main"}}' | openssl dgst -sha256 -hmac "demo-secret" | awk '{print "sha256="$2}')

curl -s -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: demo-pr-open-001" \
  -H "X-Hub-Signature-256: $SIG" \
  -d '{"action":"opened","number":42,"pull_request":{"number":42,"title":"Fix #1","body":"Closes #1\ngitpay:address 0x1234567890abcdef1234567890abcdef12345678","merged":false,"merge_commit_sha":null,"user":{"login":"contributor"},"head":{"sha":"head123"},"base":{"ref":"main"},"changed_files":2,"additions":30,"deletions":5},"repository":{"full_name":"demo/repo","default_branch":"main"}}' | jq
```

### Step 4: Simulate Merge → Payout (60s)

```bash
MERGE_BODY='{"action":"closed","number":42,"pull_request":{"number":42,"title":"Fix #1","body":"Closes #1\ngitpay:address 0x1234567890abcdef1234567890abcdef12345678","merged":true,"merge_commit_sha":"abc123def456789012345678901234567890abcd","user":{"login":"contributor"},"head":{"sha":"head123"},"base":{"ref":"main"},"changed_files":2,"additions":30,"deletions":5},"repository":{"full_name":"demo/repo","default_branch":"main"}}'

SIG=$(echo -n "$MERGE_BODY" | openssl dgst -sha256 -hmac "demo-secret" | awk '{print "sha256="$2}')

curl -s -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: demo-merge-001" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$MERGE_BODY" | jq
```

Expected: Payout created (PENDING or auto-executed to DONE).

### Step 5: Execute Payout (30s)

```bash
curl -s -X POST http://localhost:3000/api/payout/execute \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: demo-action-secret" \
  -d '{"repoKey":"demo/repo","prNumber":42}' | jq
```

Expected: `200` with txHash (mock in dev mode).

### Step 6: Verify Idempotency (20s)

Re-send the same merge webhook:

```bash
curl -s -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: demo-merge-001" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$MERGE_BODY" | jq
```

Expected: `"Delivery already processed"` — no duplicate payout.

---

## Demo Summary Table

| Step | Action | Expected Result | Duration |
|------|--------|-----------------|----------|
| 1 | Health check | Server OK | 10s |
| 2a | Fund (no payment) | 402 with requirements | 15s |
| 2b | Fund (with x402) | Escrow funded, intentHash | 15s |
| 2c | Verify status | Issue = FUNDED | 10s |
| 3 | PR open + address claim | PR recorded, address captured | 15s |
| 4 | Merge webhook | Payout pipeline triggered | 15s |
| 5 | Execute payout | TX hash recorded | 15s |
| 6 | Duplicate webhook | Safely ignored | 10s |

**Total: ~2 minutes** (automated script) / ~4 minutes (manual with narration)

---

## Judging Criteria Mapping

| Criteria | GitPay Feature | Demo Step | Evidence |
|----------|---------------|-----------|----------|
| **AI Readiness** | Gemini structured review + riskFlags → HOLD | PR open triggers AI review | Structured JSON output with summary, riskFlags, testObservations |
| **Commerce Realism** | x402 HTTP 402 → payment → onchain escrow | Steps 2a–2b | Real 402 challenge-response, payment verification, escrow deposit |
| **Ship-ability** | Full pipeline: fund → merge → payout | Steps 2–5 | End-to-end flow with SQLite persistence, idempotency |
| **Partner Integration (SKALE)** | Gasless deployment, chain adapter, MockSKLA | Optional SKALE testnet mode | Contracts on BITE V2 Sandbox 2, onchain proofs |
| **Composability** | EIP-712 mandates, deterministic escrow (CREATE2) | Intent/Cart hashes in output | Two-mandate authorization, deterministic escrow addresses |

---

## Fallback Plan

| Problem | Fallback |
|---------|----------|
| x402 issues | Keep `X402_MOCK_MODE=true`, show 402 → retry flow |
| Chain slow/down | Skip SKALE deploy, run full demo on mock mode |
| Webhook signature trouble | Double-check `GITHUB_WEBHOOK_SECRET` matches between `.env` and script |
| AI reviewer timeout | AI review is non-blocking; payout still proceeds |
| SQLite issues | Delete `apps/server/dev.db` and restart server (auto-creates tables) |
| Server won't start | Check `pnpm install` and `.env` — most issues are missing deps or env |

---

## Fresh Machine → Demo in 10 Minutes

```bash
# 1. Clone & install (3 min)
git clone <repo-url> && cd gitpay
pnpm install && pnpm -r build

# 2. Configure (1 min)
cp .env.example .env
# Edit .env: set GITHUB_WEBHOOK_SECRET=demo-secret
#            set GITPAY_ACTION_SHARED_SECRET=demo-action-secret

# 3. Start server (30s)
pnpm dev --filter server

# 4. Run demo (2 min) — in another terminal
./scripts/demo.sh

# 5. (Optional) Run contract tests (2 min)
pnpm contracts:test
```
