# PROJECT.md

## OSM402

**Tagline:** Fund with x402. Merge with Proof. Pay by Mandate.

OSM402 is a GitHub-native bounty system that enables instant, auditable payouts on merge without trusting an AI model to decide who gets paid.

It combines:

- x402 (HTTP 402 Payments) to fund bounties from CI/agents via standard web requests.
- Mandate-based authorization (AP2-inspired) to prove who authorized payments and under what constraints.
- Onchain escrow to hold funds per issue and release them automatically when deterministic conditions are met.
- AI (Gemini) as an explainer plus risk signal, not as the final payment authority.

This project is designed for the DoraHacks x402 hackathon:

- https://dorahacks.io/hackathon/x402/detail

---

## 1) Problem

### 1.1 Reward latency

Open-source and bounty payments often take days or weeks after approval, creating friction and distrust.

### 1.2 Micro-bounties are economically broken

Small fixes ($1-$5) frequently cost more in overhead than the bounty itself (fees, cross-border transfer, admin burden).

### 1.3 Verification does not scale

Maintainers must manually validate whether:

- the PR actually fixes the issue,
- the solution is safe and maintainable,
- the change is not malicious,
- the tests meaningfully cover the change.

This results in review bottlenecks and fewer paid contributions.

---

## 2) Solution

OSM402 introduces a three-layer trust model:

1. **Funding is real (x402 plus escrow)**
   - A bounty is not a promise; it is a funded onchain escrow position.
   - Funding happens through an HTTP call returning `402 Payment Required`.
   - The paying agent (for example, GitHub Action) retries with an x402 payment payload.
2. **Authorization is explicit (Mandates)**
   - A maintainer authorizes an intent: up to `$X` can be paid for this issue under policy `P` until expiry `T`.
   - An agent constructs a cart mandate at merge-time: pay recipient `R`, amount `A`, for merge commit SHA.
   - The escrow contract enforces these constraints before releasing funds.
3. **Verification is automated but bounded (CI plus policy plus AI risk flags)**
   - Payouts happen only when deterministic checks pass (required checks plus policy rules).
   - Gemini generates structured review output to reduce human effort and trigger `HOLD` when risk is detected.
   - AI does not determine payout amount (no "AI decides money" failure mode).

---

## 3) Goals and Non-Goals

### 3.1 Goals (Hackathon MVP)

- Demonstrate x402 funding flow:
  - server returns `402 Payment Required` for funding requests,
  - client (GitHub Action) pays via x402 and receives confirmation.
- Demonstrate mandate-guarded payout on merge:
  - intent mandate created at fund time,
  - cart mandate created at merge time,
  - escrow releases funds only if mandates validate and policy conditions pass.
- Demonstrate GitHub-native UX:
  - label an issue to create a bounty,
  - PR gets review output from Gemini,
  - merge triggers payout comment with transaction link.

### 3.2 Non-Goals (Out of Scope for MVP)

- Dispute resolution marketplace or arbitration.
- Full AP2 protocol compliance (we implement AP2-inspired mandates via EIP-712).
- Cross-chain bridging of escrow funds.
- KYC/AML compliance automation.
- Advanced contributor identity verification beyond wallet address claim.

---

## 4) Core Principles (Design Constraints)

- **Deterministic payouts:** payout logic is deterministic and reproducible given inputs.
- **No AI payment authority:** AI can recommend, explain, flag risk, and trigger `HOLD`. It cannot set final amount.
- **Escrow enforces constraints:** onchain contract must validate mandates and prevent replay/double payout.
- **Evidence-first auditability:** every payout is linked to:
  - issue identifier,
  - repo,
  - PR,
  - merge commit SHA,
  - mandate hashes,
  - onchain events.

---

## 5) User Personas

- **Maintainer**
  - Funds issues, defines policies, approves merge, wants low overhead and safety.
- **Contributor**
  - Submits PRs, expects fast payout, wants clear rules.
- **CI Agent (GitHub Action)**
  - Pays via x402 to fund bounties (as configured), runs tests.
- **OSM402 Agent (Server)**
  - Verifies GitHub events, computes deterministic payout, constructs cart mandate, executes payout.

---

## 6) User Journeys

### 6.1 Fund a bounty (x402)

1. Maintainer adds label: `bounty:$10` to an issue.
2. GitHub Action calls OSM402 API: `POST /api/fund`.
3. OSM402 responds: `402 Payment Required` with payment requirements (network, asset, amount).
4. Action retries with x402 payment payload.
5. OSM402 confirms payment and deposits funds into issue escrow.
6. OSM402 comments on issue: `Funded cap=$10 escrow=... intentHash=...`.

### 6.2 Merge and pay

1. Contributor submits PR referencing the issue.
2. Required checks pass (CI).
3. Maintainer merges PR into default branch.
4. Webhook triggers OSM402 payout pipeline:
   - verify merge event and required checks,
   - parse `.osm402.yml` policy,
   - compute payout amount deterministically,
   - run mandatory Gemini review and use risk flags for `HOLD`,
   - create cart mandate,
   - call escrow contract `release(...)`.
5. OSM402 comments on PR: `Paid $X tx=... cartHash=... intentHash=...`.

### 6.3 HOLD flow

- If policy or AI flags risk conditions:
  - OSM402 posts: `HOLD - Manual review required (reason=...)`.
  - Maintainer can later approve via:
    - updating label to `osm402:override`,
    - or issuing a signed override mandate (future).
  - MVP: simplest manual override is a label-based allowlist.

---

## 7) Technical Architecture

### 7.1 Components

1. **GitHub App / Webhook listener**
   - receives events: issue labeled, PR opened/synchronized, PR closed/merged, check suite completed,
   - verifies webhook signatures.
2. **GitHub Action**
   - runs CI,
   - triggers funding call and pays via x402 (for demo),
   - optionally posts contributor wallet address claim if missing.
3. **OSM402 API Server (Node.js/TypeScript)**
   - x402 middleware: returns 402 and verifies x402 payment receipts,
   - policy engine: parses `.osm402.yml`, computes `policyHash`, determines amount,
   - mandate service: constructs and validates EIP-712 typed mandates,
   - payout executor: calls escrow contract.
4. **AI Reviewer (Gemini)**
   - inputs: PR diff, file summary, metadata,
   - outputs: structured JSON (`summary`, `riskFlags`, `testObservations`, `suggestedTier`).
5. **Onchain Contracts**
   - `IssueEscrowFactory` (CREATE2 deterministic deployment),
   - `IssueEscrow` (holds funds, validates mandates, releases funds),
   - ERC-20 asset: USDC (or supported stable).

### 7.2 Network choice

- **MVP network:** BITE V2 Sandbox 2 (SKALE) for hackathon-aligned demo flow.
- **Optional:** Additional chain adapters for broader deployment coverage.

---

## 8) Data Model

### 8.1 Canonical identifiers

- `repoKey`: `${owner}/${repo}`
- `issueKey`: `${repoKey}#${issue_number}`
- `prKey`: `${repoKey}#PR${pr_number}`
- `mergeSha`: commit SHA merged into default branch

### 8.2 Database tables (minimal)

- `repos`
  - `id`, `repoKey`, `installationId`, `defaultBranch`, `createdAt`
- `issues`
  - `id`, `issueKey`, `repoId`, `issueNumber`, `bountyCap`, `asset`, `chainId`, `policyHash`, `escrowAddress`, `intentHash`, `status`, `createdAt`
- `prs`
  - `id`, `prKey`, `repoId`, `prNumber`, `issueId`, `mergeSha`, `contributorGithub`, `contributorAddress`, `status`, `createdAt`
- `payouts`
  - `id`, `issueId`, `prId`, `amount`, `recipient`, `cartHash`, `txHash`, `status`, `createdAt`
- `events`
  - `id`, `type`, `githubDeliveryId`, `payloadHash`, `createdAt` (for idempotency and debugging)

---

## 9) Mandate Model (AP2-inspired, EIP-712 typed data)

### 9.1 Intent mandate (maintainer-authorized)

Intent mandate binds:

- scope (repo/issue),
- token plus chain,
- cap (max payout),
- expiry,
- `policyHash`,
- nonces.

Example fields:

- `chainId`
- `repoKeyHash` (`keccak256`)
- `issueNumber`
- `asset` (`ERC20`)
- `cap` (`uint256`)
- `expiry` (`uint256`)
- `policyHash` (`bytes32`)
- `nonce` (`uint256`)

Signed by:

- `maintainerSigner` (for MVP, may be a configured key).

Stored:

- on server DB and emitted as event when escrow funded.

### 9.2 Cart mandate (agent-authorized)

Cart mandate binds:

- `intentHash` reference,
- `mergeSha`,
- recipient plus amount,
- nonce,
- timestamp.

Example fields:

- `intentHash` (`bytes32`)
- `mergeSha` (`bytes32`)
- `prNumber` (`uint256`)
- `recipient` (`address`)
- `amount` (`uint256`)
- `nonce` (`uint256`)

Signed by:

- `osm402AgentSigner` (server key).

### 9.3 Why two mandates?

- Maintainer pre-approves a bounded spend (intent).
- Agent finalizes a specific payment at merge-time (cart).
- Escrow requires both signatures and prevents AI/server from exceeding intent constraints.

---

## 10) Policy Engine (`.osm402.yml`)

### 10.1 Policy file goals

- Deterministic payout decisions.
- Deterministic `HOLD` rules.

### 10.2 Example `.osm402.yml`

```yaml
version: 1

requiredChecks:
  - test
  - lint

payout:
  mode: tiered
  tiers:
    - name: docs
      amountUsd: 1
      match:
        onlyPaths:
          - 'README.md'
          - 'docs/**'
    - name: simple_fix
      amountUsd: 5
      match:
        maxFilesChanged: 5
        maxAdditions: 60
        maxDeletions: 60
    - name: security_patch
      amountUsd: 50
      match:
        anyPaths:
          - 'src/auth/**'
          - 'src/crypto/**'
          - 'security/**'

holdIf:
  - rule: touchesPaths
    any:
      - '.github/workflows/**'
      - 'package-lock.json'
      - 'pnpm-lock.yaml'
      - 'yarn.lock'
  - rule: newDependencies
  - rule: coverageDrop
    gtPercent: 2

addressClaim:
  mode: pr_comment
  command: '/osm402 address'
```

### 10.3 Deterministic policy hash

Compute `policyHash = keccak256(normalized_yaml_bytes)` and bind it into intent mandate.
If policy changes after funding, escrow refuses release (unless a new intent is funded).

---

## 11) AI Reviewer (Gemini)

### 11.1 Inputs

- PR title and body
- Diff summary (files changed, additions, deletions)
- Patch for changed files (truncate safely)
- Test results summary
- Policy context (required checks, hold rules)

### 11.2 Output (strict JSON schema)

```json
{
  "summary": ["...", "..."],
  "riskFlags": ["new-dependency", "auth-change"],
  "testObservations": ["no new tests added", "existing tests pass"],
  "suggestedTier": "simple_fix",
  "confidence": 0.73
}
```

### 11.3 How AI affects flow

- AI can trigger `HOLD` based on `riskFlags` (policy-defined mapping).
- AI never sets payout amount in MVP.
- Payout always uses deterministic policy engine.

---

## 12) Onchain Contracts

### 12.1 `IssueEscrowFactory`

Responsibilities:

- Deploy `IssueEscrow` via `CREATE2` using deterministic salt:
  - `salt = keccak256(repoKeyHash || issueNumber || policyHash)`
- Emit event:
  - `EscrowCreated(issueKeyHash, escrowAddress, policyHash)`

### 12.2 `IssueEscrow`

State:

- `asset` (ERC-20)
- `cap`
- `expiry`
- `policyHash`
- `maintainerSigner` (intent signer)
- `agentSigner` (cart signer)
- `paidAmount` or `paid` flag
- `usedNonces` mapping (intent/cart)

Methods:

- `fund(uint256 amount)` (or escrow just receives funds)
- `release(Intent intent, bytes intentSig, Cart cart, bytes cartSig)`
  - validate both signatures (EIP-712),
  - validate cap, expiry, `policyHash`,
  - validate nonces (replay protection),
  - validate `mergeSha` included in cart,
  - transfer asset to recipient.

Events:

- `Funded(amount, funder)`
- `Released(amount, recipient, cartHash, intentHash, mergeSha)`

Security:

- Reentrancy guard
- Strict nonce tracking
- One-issue-one-escrow pattern to minimize shared state risk

---

## 13) APIs (Server)

### 13.1 Auth and security

- GitHub webhooks: validate `X-Hub-Signature-256`.
- API calls from GitHub Action: include shared secret or OIDC token (MVP: shared secret).
- x402 endpoints: respond with `402` and validate payment on retry.

### 13.2 Endpoints

`POST /api/fund`

- body: `{ repoKey, issueNumber, bountyCapUsd, asset, chainId, policyHash }`
- response:
  - `402` with payment requirements, or
  - `200` with `{ escrowAddress, intentHash, fundedTxHash }`.

`POST /api/webhooks/github`

- handles:
  - `issues.labeled` (bounty label),
  - `pull_request.opened`/`synchronize`,
  - `pull_request.closed` (merged),
  - `check_suite.completed` (optional gate).

`POST /api/payout/execute`

- internal (server-to-server),
- triggers payout for a given `issueKey` and `mergeSha`.

`GET /api/health`

---

## 14) GitHub Integration

### 14.1 Labels

- `bounty:$<amount>`: create or fund bounty.
- `osm402:hold`: manually hold payout.
- `osm402:override`: allow payout after hold (MVP).

### 14.2 Wallet address claim

MVP method: contributor posts PR comment:

```text
/osm402 address 0xabc...
```

Server stores mapping:

- `githubUser -> address`
- optional override: `repoKey -> address`

---

## 15) Repository Layout (Proposed)

```text
osm402/
  apps/
    server/          # Node/TS API (Express or Next API)
    github-action/   # Action code for fund + workflow templates
  contracts/
    src/             # Solidity contracts
    script/          # Deploy scripts
    test/            # Contract tests
  packages/
    policy/          # .osm402.yml parser + policyHash + payout calc
    mandates/        # EIP-712 typed data builders/verifiers
    github/          # Webhook verification + GitHub API wrapper
    ai/              # Gemini client + JSON schema validator
  docs/
    PROJECT.md
    TICKET.md
```

---

## 16) Environment Variables (MVP)

### Server

- `PORT`
- `DATABASE_URL`
- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY_PEM`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_CLIENT_ID` (optional)
- `GITHUB_CLIENT_SECRET` (optional)
- `OSM402_AGENT_PRIVATE_KEY` (EOA for signing cart mandates)
- `OSM402_MAINTAINER_PRIVATE_KEY` (for signing intent mandates in MVP demo)
- `CHAIN_ID` (BITE V2 Sandbox 2)
- `RPC_URL`
- `ESCROW_FACTORY_ADDRESS`
- `USDC_ADDRESS` (or supported asset)
- `GEMINI_API_KEY`

### GitHub Action

- `OSM402_API_URL`
- `OSM402_ACTION_SHARED_SECRET`
- `X402_PAYER_PRIVATE_KEY` (demo payer key; do not use in production)

---

## 17) Local Development

### 17.1 Contracts

1. Install Foundry or Hardhat.
2. Deploy contracts to BITE V2 Sandbox 2.
3. Record addresses in `apps/server/config/chains/skale-testnet.json`.

### 17.2 Server

1. `pnpm install`
2. `pnpm dev --filter server`
3. Use ngrok for webhook testing.

### 17.3 GitHub App

1. Create GitHub App.
2. Subscribe to listed webhook events.
3. Install to test repository.
4. Configure secrets.

### 17.4 Demo flow checklist

1. Deploy contracts.
2. Fund payer wallet and maintainer/agent keys.
3. Add `.osm402.yml` to test repo.
4. Add bounty label.
5. Create PR and comment wallet address.
6. Merge PR and observe payout.

---

## 18) Decision Log (MVP Defaults)

- Network: BITE V2 Sandbox 2
- Asset: supported stable (USDC preferred)
- Policy: tiered payouts with deterministic rules
- AI: Gemini for explanation and `HOLD` signal only
- Mandates: EIP-712 typed data, AP2-inspired structure

---

## 19) Future Extensions (Post-hackathon)

- Multi-contributor split payments
- Streaming payments by CI milestones
- SKALE deployment mode for gasless payouts
- Contributor login via Coinbase Smart Wallet and GitHub OAuth linking
- Evidence pack signing (hash check-suite payload into cart mandate)
- Human override mandate instead of label override
