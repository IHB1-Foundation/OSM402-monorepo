# GitPay.ai — Demo Playbook

**Duration:** 5–10 minutes setup, 3–5 minutes demo run

---

## Demo Mode (Hackathon): Real Chain Only

For the hackathon demo, use:

- Chain: **BITE V2 Sandbox 2**
- Funding: **real x402 proof (onchain txHash)**
- Escrow: **real onchain `createEscrow` + `release(...)`**
- Flow: “Issue registered → agent funds → PR merged → auto payout”

Local mock mode is still available for development/regression, but not used in the demo.

---

## Quick Start (Real Chain, Agent-Driven)

```bash
# 0) install/build
pnpm install
pnpm -r build
cp .env.example .env

# 1) deploy contracts to BITE V2 Sandbox 2
export BITE_V2_SANDBOX_2_RPC_URL="https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2"
export DEPLOYER_PRIVATE_KEY="<deployer_key>"
pnpm --filter contracts deploy:bite-v2-sandbox-2

# 2) run server (with real-chain env)
pnpm dev --filter server

# 3) after creating a bounty issue on GitHub, run the buyer agent locally
pnpm --filter server tsx src/scripts/agentFundOpenBounties.ts \
  --repo "owner/repo" \
  --secret "$GITPAY_ACTION_SHARED_SECRET" \
  --private-key "$X402_PAYER_PRIVATE_KEY" \
  --rpc-url "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2"
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

# Real chain demo
CHAIN_NAME=bite-v2-sandbox-2
X402_MOCK_MODE=false
ESCROW_MOCK_MODE=false

# BITE V2 Sandbox 2 USDC (decimals 6)
ASSET_ADDRESS=0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8
ASSET_SYMBOL=USDC
ASSET_DECIMALS=6

# Onchain contracts (fill after deployment)
ESCROW_FACTORY_ADDRESS=<FACTORY_ADDRESS>

# Keys
GITPAY_MAINTAINER_PRIVATE_KEY=<intent_signer_key>
GITPAY_AGENT_PRIVATE_KEY=<cart_signer_and_tx_sender_key>
X402_PAYER_PRIVATE_KEY=<buyer_funding_key>
```

### 4. Start Server

```bash
pnpm dev --filter server
```

Verify: `curl http://localhost:3000/api/health | jq`

### 5. Faucet (sFUEL / USDC)

Use this when you want the full “Commerce Realism” story:

- x402 challenge (HTTP 402)
- **Onchain ERC20 transfer proof** (txHash)
- Escrow `release(...)` on SKALE testnet

- [ ] Choose SKALE hackathon chain: **BITE V2 Sandbox 2**
- [ ] Deploy contracts (MockSKLA + IssueEscrowFactory)
- [ ] Run server with SKALE config and real modes
- [ ] Fund using the provided `x402Fund.ts` helper

Request in SKALE Builders Telegram:

- `https://t.me/+dDdvu5T6BOEzZDEx`

### 6. Deploy contracts to BITE V2 Sandbox 2

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

### 6. Real GitHub Integration (recommended for judging)

For a live GitHub demo (webhook from a real repo):

- [ ] Create a GitHub App with webhook events: `issues`, `pull_request`, `issue_comment`
- [ ] Install the app on a test repository
- [ ] Set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PEM`, `GITHUB_WEBHOOK_SECRET` in `.env`
- [ ] Use ngrok or similar to expose local server: `ngrok http 3000`
- [ ] Set webhook URL in GitHub App settings to ngrok URL + `/api/webhooks/github`
- [ ] Add `.gitpay.yml` to the test repository root
- [ ] Add a `bounty:$10` label to an issue to trigger funding

---

## Happy Path Demo (Real Chain, Best-looking)

This demo is designed to look “agentic”:

1) Maintainer registers a bounty issue on GitHub (label)  
2) Buyer agent funds it (x402 402 → onchain USDC transfer proof)  
3) Contributor opens PR with payout address token  
4) Merge triggers onchain payout automatically  

See templates under `docs/demo-assets/`.
Suggested demo target repo contents are in `examples/bite-demo-repo/` (copy into a fresh GitHub repo).

### Step 1: Health Check (10s)

```bash
curl -s http://localhost:3000/api/health | jq
```

Expected: `{"status":"ok","timestamp":"...","version":"0.1.0"}`

### Step 2: Create a bounty issue on GitHub (30s)

1) Create an issue using: `docs/demo-assets/ISSUE_EXAMPLE.md`  
2) Add label: `bounty:$10`

Expected:

- GitPay posts **“Bounty Detected”** comment with the escrow address link.

### Step 3: Buyer agent funds it via x402 (60–120s)

#### 3a. Fund one issue (simple)

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

#### 3b. Fund all open bounty issues (best “agentic” look)

```bash
pnpm --filter server tsx src/scripts/agentFundOpenBounties.ts \
  --repo "demo/repo" \
  --secret "demo-action-secret" \
  --private-key "<PAYER_PRIVATE_KEY>" \
  --rpc-url "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2"
```

#### (Optional) Show the raw x402 402 payload (HTTP layer)

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST http://localhost:3000/api/fund \
  -H "Content-Type: application/json" \
  -H "X-GitPay-Secret: demo-action-secret" \
  -d '{"repoKey":"demo/repo","issueNumber":1,"bountyCapUsd":10}' | jq
```

### Step 4: Open PR (Real GitHub) + Address Claim (60s)

Create a PR in your demo target repo using:

- PR title/body template: `docs/demo-assets/PR_EXAMPLE.md`
- Ensure the body includes both:
  - `Closes #<ISSUE_NUMBER>`
  - `gitpay:address 0x...`

Expected:

- GitPay posts an AI review comment on the PR (if Gemini is configured).
- GitPay captures the payout address from the PR body.

### Step 5: Merge PR → Auto Payout (60–120s)

Merge the PR on GitHub.

Expected:

- GitPay receives the merge webhook.
- GitPay constructs mandates and sends `escrow.release(...)` onchain.
- The PR receives a **“Paid”** comment including the transaction link.

### Step 6: Verify Onchain (30s)

Open the tx link from the **Paid** comment and verify:

- token: USDC
- recipient: contributor address
- event: `Released` emitted by the escrow contract

### Step 7: Idempotency (No double-pay)

GitHub may redeliver webhooks; the server deduplicates by `X-GitHub-Delivery`.
If you resend the same delivery, it is ignored safely.

---

## Demo Summary Table

| Step | Action | Expected Result | Duration |
|------|--------|-----------------|----------|
| 1 | Health check | Server OK | 10s |
| 2 | Create issue + label | “Bounty Detected” comment | 30s |
| 3 | Buyer agent funds (x402) | Issue = FUNDED | 60–120s |
| 4 | PR open + address claim | PR recorded, address captured | 30–60s |
| 5 | Merge PR | Auto payout executed | 30–90s |
| 6 | Explorer proof | TX + Released event | 15–30s |
| 7 | Idempotency | No double pay | — |

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
