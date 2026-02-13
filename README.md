# OSM402

**Fund with x402. Merge with Proof. Pay by Mandate.**

OSM402 is a GitHub-native bounty system that enables instant, auditable payouts on merge without trusting an AI model to decide who gets paid.

## How It Works

1. **Fund** — Label an issue `bounty:$10`. The CI agent pays via x402 into an onchain escrow.
2. **Work** — A contributor submits a PR referencing the issue. AI reviews the PR (explanation only).
3. **Merge** — Maintainer merges. OSM402 verifies checks, computes payout deterministically, and releases funds.

## Architecture

- **x402 Funding** — HTTP 402 challenge-response for payment
- **EIP-712 Mandates** — Intent (maintainer) + Cart (agent) authorization
- **Onchain Escrow** — Per-issue escrow on BITE V2 Sandbox 2 (SKALE) with replay protection
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
git clone <repo-url> && cd osm402
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
- PASS/HOLD split scenarios
- AP2 failure mode evidence

## Hackathon Submission Focus

Current recommended tracks:

1. **Overall Track: Best Agentic App / Agent**
2. **Best Integration of AP2**

Track mapping details are documented in [docs/SUBMISSION.md](docs/SUBMISSION.md).

### AP2 Failure Mode Proof

Run contract-level authorization failure tests (invalid signer, replay, mismatches):

```bash
pnpm demo:ap2-failure
```

### Evidence Bundle (Screenshots/Logs/JSON)

Collect one submission folder with API responses and AP2 failure logs:

```bash
pnpm evidence:collect
```

Output directory:

- `artifacts/evidence-<timestamp>/`

### Contracts

```bash
# Run contract tests
pnpm contracts:test

# Deploy to BITE V2 Sandbox 2 (requires DEPLOYER_PRIVATE_KEY in .env)
pnpm --filter contracts deploy:bite-v2-sandbox-2
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
| `CHAIN_ID` | Target chain (default: 103698795 BITE V2 Sandbox 2) |

## License

MIT
