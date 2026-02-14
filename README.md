# OSM402

**Fund with x402. Merge with Proof. Pay by Mandate.**

OSM402 is a GitHub-native bounty system that enables instant, auditable payouts on merge without trusting an AI model to decide who gets paid.

## How It Works

1. **Fund** — Label an issue `bounty:$10`. The CI agent pays via x402 into an onchain escrow.
2. **Work** — A contributor submits a PR referencing the issue. **Mandatory** Gemini review produces structured risk flags (it never decides payout amounts).
3. **Merge** — Maintainer merges. OSM402 verifies checks, computes payout deterministically, evaluates `HOLD` (policy + AI flags), and releases funds.

## Architecture

- **x402 Funding** — HTTP 402 challenge-response for payment
- **EIP-712 Mandates** — Intent (maintainer) + Cart (agent) authorization
- **Onchain Escrow** — Per-issue escrow on BITE V2 Sandbox 2 (SKALE) with replay protection
- **Policy Engine** — Deterministic payout tiers from `.osm402.yml`
- **AI Reviewer** — Gemini for risk flags and HOLD signals (never decides amounts)

## DoraHacks Submission

See `DORAHACKS.md` for DoraHacks detail text (tracks, demo script, evidence checklist).

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Foundry (for contracts)

### Setup

```bash
# Clone and install
git clone https://github.com/IHB1-Foundation/OSM402-monorepo.git && cd OSM402-monorepo
pnpm install

# Copy environment template
cp .env.example .env
# Edit .env with your keys

# Build packages
pnpm -r build

# Start server (or run everything: pnpm dev)
pnpm --filter @osm402/server dev
```

### GitHub App (Webhook + Comments)

For a real online GitHub demo, run the server locally and configure a GitHub App:

- Create a GitHub App (Repository permissions: **Issues: Read & write**, **Pull requests: Read & write**, **Contents: Read**, **Checks: Read**)
- Subscribe to webhook events: `issues`, `pull_request`, `issue_comment`
- Set webhook URL to `https://<your-public-url>/api/webhooks/github` (use ngrok for local)
- Install the App on the exact target repo in `.env` (`DEMO_REPO`)
- Set `.env`:
  - `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PEM`, `GITHUB_WEBHOOK_SECRET`
  - `GITHUB_PRIVATE_KEY_PEM` should be a **single line** with `\\n` escapes (not a multi-line block)
  - `DEMO_REPO=owner/repo`
  - `GEMINI_API_KEY` (required; AI review is mandatory)
  - `DEPLOYER_PRIVATE_KEY`, `OSM402_MAINTAINER_PRIVATE_KEY`, `OSM402_AGENT_PRIVATE_KEY`, `X402_PAYER_PRIVATE_KEY` (single-wallet mode: same key for all 4)
  - or set `GITHUB_TOKEN` as a simpler fallback

The server will verify `X-Hub-Signature-256` against the raw webhook payload.

Validate GitHub App installation/token before live demo:

```bash
pnpm demo:check-github-app
```

Expected:

- `installation_lookup_status=200`
- `installation_token_status=201`
- `ok=true`

### Verify

```bash
curl http://localhost:3010/api/health
# → {"status":"ok","timestamp":"...","version":"0.1.0","ai":{"provider":"gemini","configured":true,"model":"..."}}
```

### Run Demo

See [docs/DEMO.md](docs/DEMO.md) for a step-by-step demo script covering:
- Funding via x402 (402 challenge → payment → escrow)
- Merge payout simulation
- Idempotency verification
- PASS/HOLD split scenarios
- AP2 failure mode evidence

Use `demo/` to seed a real GitHub demo repo (baseline + ACCEPT/HOLD branches).

- Demo codebases: `demo/README.md`
- Seeding instructions: `docs/DEMO.md`
- Gemini pre-check (recommended): `pnpm demo:gemini-check`

#### x402 Fund (CLI, Real 402 → Pay → Retry)

```bash
set -a; source .env; set +a
pnpm --filter @osm402/server tsx src/scripts/x402Fund.ts \
  --base-url "http://localhost:${PORT:-3010}" \
  --repo "$DEMO_REPO" \
  --issue "${DEMO_ISSUE:-1}" \
  --bounty "${DEMO_BOUNTY:-0.1}" \
  --secret "$OSM402_ACTION_SHARED_SECRET" \
  --private-key "$X402_PAYER_PRIVATE_KEY"
```

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

After deploy, copy the printed factory address into `.env`:

- `ESCROW_FACTORY_ADDRESS=0x...` (from `IssueEscrowFactory deployed at: 0x...`)

## Project Structure

```
apps/
  server/          # Express API — webhooks, fund, payout
  github-action/   # GitHub Action — fund via x402
contracts/
  src/             # Solidity: IssueEscrow + Factory
  test/            # Foundry tests
packages/
  policy/          # .osm402.yml parser, payout calculator, HOLD evaluator
  mandates/        # EIP-712 Intent/Cart builders
  ai/              # Gemini client + JSON schema validation
  github/          # GitHub API wrapper (stub)
```

## Policy Configuration

Add `.osm402.yml` to your repo root. See the [example](.osm402.yml) for the full schema.

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
| `PORT` | Server port (default: 3010) |
| `X402_MOCK_MODE` | Use mock payments (`false` for real-chain demo) |
| `ESCROW_MOCK_MODE` | Use mock settlement (`false` for real onchain `release(...)`) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret |
| `OSM402_ACTION_SHARED_SECRET` | Internal API auth secret (`X-OSM402-Secret`) |
| `CHAIN_NAME` | Chain profile (default: `bite-v2-sandbox-2`) |
| `DEPLOYER_PRIVATE_KEY` | Deployer wallet private key |
| `ESCROW_FACTORY_ADDRESS` | Deployed `IssueEscrowFactory` address (required for real-chain demo) |
| `OSM402_MAINTAINER_PRIVATE_KEY` | Intent signer private key (single-wallet mode: same as deployer) |
| `OSM402_AGENT_PRIVATE_KEY` | Cart/release signer private key (single-wallet mode: same as deployer) |
| `X402_PAYER_PRIVATE_KEY` | x402 payer private key (single-wallet mode: same as deployer) |
| `GEMINI_API_KEY` | Gemini API key for mandatory AI review |
| `CHAIN_ID` | Target chain (default: 103698795 BITE V2 Sandbox 2) |

## License

MIT
