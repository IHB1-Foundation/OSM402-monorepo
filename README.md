# GitPay.ai

**Fund with x402. Merge with Proof. Pay by Mandate.**

GitPay.ai is a GitHub-native bounty system that enables instant, auditable payouts on merge without trusting an AI model to decide who gets paid.

## How It Works

1. **Fund** — Label an issue `bounty:$10`. The CI agent pays via x402 into an onchain escrow.
2. **Work** — A contributor submits a PR referencing the issue. AI reviews the PR (explanation only).
3. **Merge** — Maintainer merges. GitPay verifies checks, computes payout deterministically, and releases funds.

## Architecture

- **x402 Funding** — HTTP 402 challenge-response for payment
- **EIP-712 Mandates** — Intent (maintainer) + Cart (agent) authorization
- **Onchain Escrow** — Per-issue escrow on Base Sepolia with replay protection
- **Policy Engine** — Deterministic payout tiers from `.gitpay.yml`
- **AI Reviewer** — Gemini for risk flags and HOLD signals (never decides amounts)

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Foundry (for contracts)

### Setup

```bash
# Clone and install
git clone <repo-url> && cd gitpay
pnpm install

# Copy environment template
cp .env.example .env
# Edit .env with your keys

# Build packages
pnpm -r build

# Start server (development mode with mock payments)
pnpm dev --filter server
```

### GitHub App (Webhook + Comments)

For a real online GitHub demo, run the server locally and configure a GitHub App:

- Create a GitHub App (Repository permissions: **Issues: Read & write**, **Pull requests: Read**, **Contents: Read**, **Checks: Read**)
- Subscribe to webhook events: `issues`, `pull_request`, `issue_comment`
- Set webhook URL to `https://<your-public-url>/api/webhooks/github` (use ngrok for local)
- Set `.env`:
  - `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PEM`, `GITHUB_WEBHOOK_SECRET`
  - or set `GITHUB_TOKEN` as a simpler fallback

The server will verify `X-Hub-Signature-256` against the raw webhook payload.

### Verify

```bash
curl http://localhost:3000/api/health
# → {"status":"ok","timestamp":"...","version":"0.1.0"}
```

### Run Demo

See [docs/DEMO.md](docs/DEMO.md) for a step-by-step demo script covering:
- Funding via x402 (402 challenge → payment → escrow)
- Merge payout simulation
- Idempotency verification

### Contracts

```bash
# Run contract tests
pnpm contracts:test

# Deploy to Base Sepolia (requires DEPLOYER_PRIVATE_KEY in .env)
cd contracts && forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

## Project Structure

```
apps/
  server/          # Express API — webhooks, fund, payout
  github-action/   # GitHub Action — fund via x402
contracts/
  src/             # Solidity: IssueEscrow + Factory
  test/            # Foundry tests
packages/
  policy/          # .gitpay.yml parser, payout calculator, HOLD evaluator
  mandates/        # EIP-712 Intent/Cart builders
  ai/              # Gemini client + JSON schema validation
  github/          # GitHub API wrapper (stub)
```

## Policy Configuration

Add `.gitpay.yml` to your repo root. See the [example](.gitpay.yml) for the full schema.

```yaml
version: 1
payout:
  mode: tiered
  tiers:
    - name: docs
      amountUsd: 1
      match:
        onlyPaths: ['docs/**']
    - name: simple_fix
      amountUsd: 5
      match:
        maxFilesChanged: 5
holdIf:
  - rule: touchesPaths
    any: ['.github/workflows/**']
```

## Environment Variables

See [.env.example](.env.example) for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `X402_MOCK_MODE` | Use mock payments for local dev (default: true) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret |
| `GEMINI_API_KEY` | Gemini API key for AI review |
| `CHAIN_ID` | Target chain (default: 84532 Base Sepolia) |

## License

MIT
