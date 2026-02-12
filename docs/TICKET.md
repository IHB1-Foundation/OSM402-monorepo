# TICKET.md

## Ticket Workflow

- Status values: `TODO` → `IN_PROGRESS` → `DONE`
- Work strictly in ticket order unless a dependency requires otherwise.
- Each ticket must include:
  - code changes
  - tests (where applicable)
  - documentation updates (where applicable)
  - acceptance criteria validation
- Keep commits/ticket outputs atomic: **one ticket = one cohesive change set**.

---

## Definition of Done (DoD)

A ticket is DONE only if:

- Acceptance criteria are met.
- Code is linted and tests pass (or a documented reason exists).
- Required docs/config are updated.
- No secrets are committed.

---

## EPIC 0 — Repo Scaffold and Tooling

### GP-001 — Create monorepo skeleton

- Type: Infra
- Priority: P0
- Status: DONE
- Description:
  - Initialize monorepo structure per PROJECT.md.
  - Add pnpm workspace config.
- Tasks:
  - Create folders: `apps/server`, `apps/github-action`, `contracts`, `packages/*`, `docs/`
  - Add root `package.json`, `pnpm-workspace.yaml`
- Acceptance Criteria:
  - `pnpm -r install` succeeds
  - Basic folder layout matches PROJECT.md
- Dependencies: None

### GP-002 — Lint/format/typecheck baseline

- Type: Infra
- Priority: P0
- Status: DONE
- Description:
  - Add ESLint, Prettier, TypeScript configs shared across packages.
- Tasks:
  - Add root `tsconfig.base.json`
  - Add ESLint config
  - Add Prettier config
  - Add `pnpm lint`, `pnpm format`, `pnpm typecheck`
- Acceptance Criteria:
  - `pnpm lint` passes on empty codebase
- Dependencies: GP-001

### GP-003 — Contracts toolchain setup

- Type: Infra
- Priority: P0
- Status: DONE
- Description:
  - Choose Foundry or Hardhat and scaffold contract project.
- Tasks:
  - Initialize toolchain
  - Add example test
  - Add deployment script placeholder
- Acceptance Criteria:
  - `pnpm contracts:test` runs successfully
- Dependencies: GP-001

### GP-004 — Server app skeleton

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Create Node/TS server (Express recommended) with health route.
- Tasks:
  - Add `apps/server` project
  - Add `/api/health`
  - Add env config loader
- Acceptance Criteria:
  - `pnpm dev --filter server` starts and `/api/health` returns 200
- Dependencies: GP-001, GP-002

### GP-005 — GitHub Action skeleton

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement minimal GitHub Action package that can call an HTTP endpoint.
- Tasks:
  - Setup action runtime (Node 20)
  - Add sample workflow file under `.github/workflows/gitpay-demo.yml`
- Acceptance Criteria:
  - Action runs in a test repo and logs a successful HTTP call
- Dependencies: GP-001, GP-002

---

## EPIC 1 — Onchain Escrow Contracts

### GP-010 — Implement IssueEscrowFactory and IssueEscrow

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement CREATE2 factory and per-issue escrow contract.
- Tasks:
  - Implement deterministic salt scheme
  - Implement escrow storage and events
  - Implement safe ERC20 transfer
  - Add reentrancy guard and nonce tracking
- Acceptance Criteria:
  - Factory deploys escrow deterministically
  - Escrow can hold funds and release once with valid mandates
- Dependencies: GP-003

### GP-011 — Implement EIP-712 mandate verification (Solidity)

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Add EIP-712 domain separator and typed-data hashing for Intent/Cart.
- Tasks:
  - Define `Intent` and `Cart` structs
  - Implement `hashIntent`, `hashCart`
  - Implement signature verification (ecrecover)
- Acceptance Criteria:
  - Unit tests verify correct signature validation
- Dependencies: GP-010

### GP-012 — Contract unit tests (escrow + mandates)

- Type: Test
- Priority: P0
- Status: DONE
- Description:
  - Add comprehensive tests for:
    - cap/expiry enforcement
    - replay protection
    - invalid signatures
    - paid/double payout prevention
- Acceptance Criteria:
  - Test suite covers failure cases and passes
- Dependencies: GP-010, GP-011

### GP-013 — Deployment scripts + addresses registry

- Type: Infra
- Priority: P0
- Status: DONE
- Description:
  - Add scripts to deploy factory and record addresses/config.
- Tasks:
  - Deploy to Base Sepolia
  - Save to `apps/server/config/chains/base-sepolia.json`
- Acceptance Criteria:
  - One command deploys and prints addresses
- Dependencies: GP-010

---

## EPIC 2 — Policy Engine and Mandates (TypeScript)

### GP-020 — Mandate schemas + hashing (TypeScript)

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement typed-data builders for Intent/Cart (EIP-712) in TS.
- Tasks:
  - Define TS interfaces and JSON schema
  - Implement `buildIntentTypedData`, `buildCartTypedData`
  - Implement `hashIntent`, `hashCart`
- Acceptance Criteria:
  - Hashes match Solidity tests (golden vectors)
- Dependencies: GP-011

### GP-021 — Parse `.gitpay.yml` and compute policyHash

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement YAML parser and normalization + hashing.
- Tasks:
  - Load `.gitpay.yml` from repo content via GitHub API
  - Normalize YAML → bytes → keccak256 policyHash
- Acceptance Criteria:
  - policyHash stable across runs for identical policy
- Dependencies: GP-020

### GP-022 — Deterministic payout calculator

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement payout calculation for `fixed` and `tiered` modes.
- Tasks:
  - Implement tier matching rules
  - Ensure deterministic tie-break behavior
- Acceptance Criteria:
  - Given a PR diff summary, calculator returns stable amount
- Dependencies: GP-021

### GP-023 — HOLD rule evaluator

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Evaluate HOLD conditions deterministically from policy and PR metadata.
- Tasks:
  - Implement `touchesPaths`, `newDependencies`, `coverageDrop` scaffolding
  - Allow future AI mapping (riskFlags)
- Acceptance Criteria:
  - HOLD returns reasons list; empty means proceed
- Dependencies: GP-021

---

## EPIC 3 — x402 Funding (HTTP 402)

### GP-030 — Add x402 middleware (server)

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement server middleware/handler that:
    - returns `402 Payment Required` for unpaid requests
    - validates x402 payment on retry
- Tasks:
  - Select and integrate x402 library/SDK
  - Implement a wrapper: `requirePayment({amount, asset, chain})`
- Acceptance Criteria:
  - Unpaid call gets 402 with correct payload
  - Paid call succeeds and returns receipt
- Dependencies: GP-004

### GP-031 — Implement `/api/fund` endpoint

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Funding endpoint that creates/uses escrow and records Intent mandate.
- Tasks:
  - Parse bounty label amount
  - Fetch policyHash for repo
  - Create intent mandate and store
  - Return 402 until payment arrives
- Acceptance Criteria:
  - Funding creates issue record and escrow
  - After payment, issue is marked FUNDED
- Dependencies: GP-030, GP-013, GP-021

### GP-032 — Deposit funds into escrow after x402 payment

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - After x402 payment verified, move funds into escrow.
- Tasks:
  - Decide custody approach for MVP:
    - either x402 payment directly funds escrow
    - or server receives then transfers to escrow
  - Record onchain txHash in DB
- Acceptance Criteria:
  - Explorer shows escrow balance increased
- Dependencies: GP-031

### GP-033 — GitHub Action: fund via x402

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement Action logic:
    - call `/api/fund`
    - handle 402 challenge
    - retry with x402 payment
- Acceptance Criteria:
  - Action logs show 402 then success
- Dependencies: GP-005, GP-030

---

## EPIC 4 — GitHub App / Webhooks / Comments

### GP-040 — Webhook endpoint + signature verification

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Add `POST /api/webhooks/github` and verify signatures.
- Tasks:
  - Verify `X-Hub-Signature-256`
  - Store delivery IDs for idempotency
- Acceptance Criteria:
  - Invalid signatures rejected (401)
  - Duplicate delivery ignored safely
- Dependencies: GP-004

### GP-041 — Handle `issues.labeled` → trigger funding flow

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - When `bounty:$X` label added, kick off funding.
- Tasks:
  - Parse label
  - Call internal fund logic
  - Post GitHub comment “Funding pending / Funded ✅ …”
- Acceptance Criteria:
  - Labeling an issue causes GitPay comment and creates issue record
- Dependencies: GP-040, GP-031

### GP-042 — Handle PR events and store PR metadata

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - On PR opened/synchronize:
    - store PR metadata, diff summary
    - optionally run Gemini reviewer
- Acceptance Criteria:
  - PR record exists and updates on synchronize
- Dependencies: GP-040

### GP-043 — Merge detection and required-check gating

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - On PR closed (merged):
    - verify merged to default branch
    - verify required checks pass
    - start payout pipeline
- Acceptance Criteria:
  - Non-merged closes do not trigger payout
  - Missing checks triggers HOLD
- Dependencies: GP-040, GP-022, GP-023

### GP-044 — GitHub comments: Funded / Paid / HOLD

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Implement consistent bot comment formatting.
- Acceptance Criteria:
  - Comments include hashes/tx links/amount
- Dependencies: GP-041, GP-043

---

## EPIC 5 — Payout Execution

### GP-050 — Generate Cart mandate on merge

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Build cart mandate from:
    - intentHash
    - mergeSha
    - recipient address
    - deterministic amount
- Acceptance Criteria:
  - cartHash is stable and matches contract expectations
- Dependencies: GP-020, GP-043

### GP-051 — Execute `escrow.release(...)` and record tx

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Call IssueEscrow `release` and record txHash.
- Acceptance Criteria:
  - Onchain event `Released` emitted
  - DB payout record marked DONE
- Dependencies: GP-050, GP-010, GP-012

### GP-052 — Idempotency and replay safety in server pipeline

- Type: Feature
- Priority: P0
- Status: DONE
- Description:
  - Ensure repeated webhook deliveries do not double-pay.
- Tasks:
  - DB unique constraints
  - payout pipeline locking
- Acceptance Criteria:
  - Same merge event processed twice results in one onchain payout
- Dependencies: GP-051, GP-040

### GP-053 — Post "Paid ✅" PR comment with tx link

- Type: Feature
- Priority: P0
- Status: DONE
- Acceptance Criteria:
  - PR shows Paid comment after successful tx
- Dependencies: GP-051, GP-044

---

## EPIC 6 — Gemini Reviewer

### GP-060 — Gemini client + strict JSON schema

- Type: Feature
- Priority: P1
- Status: DONE
- Description:
  - Add Gemini API client and JSON schema validation.
- Acceptance Criteria:
  - If Gemini returns invalid JSON, system falls back safely
- Dependencies: GP-004

### GP-061 — PR diff summarizer and prompt builder

- Type: Feature
- Priority: P1
- Status: DONE
- Description:
  - Build prompt from diff + metadata, ensure token limits.
- Acceptance Criteria:
  - Reviewer runs under timeouts and never blocks payout pipeline indefinitely
- Dependencies: GP-060, GP-042

### GP-062 — Post AI review comment on PR

- Type: Feature
- Priority: P1
- Status: DONE
- Acceptance Criteria:
  - PR receives structured “GitPay Review” comment
- Dependencies: GP-061, GP-044

### GP-063 — HOLD mapping from riskFlags

- Type: Feature
- Priority: P1
- Status: DONE
- Acceptance Criteria:
  - riskFlags can trigger HOLD with reasons
- Dependencies: GP-023, GP-062

---

## EPIC 7 — Demo, Docs, and Optional SKALE Mode

### GP-070 — Example repo + `.gitpay.yml` template

- Type: Docs
- Priority: P0
- Status: DONE
- Acceptance Criteria:
  - Example policy file included and referenced in README
- Dependencies: GP-021

### GP-071 — End-to-end demo script

- Type: Docs
- Priority: P0
- Status: DONE
- Description:
  - Write a step-by-step demo script (3–5 minutes).
- Acceptance Criteria:
  - Script covers funding (402) + merge payout + tx verification
- Dependencies: GP-053

### GP-072 — README Quickstart

- Type: Docs
- Priority: P0
- Status: DONE
- Acceptance Criteria:
  - Fresh setup instructions work on a new machine
- Dependencies: GP-071

### GP-073 — SKALE adapter scaffold (optional)

- Type: Feature
- Priority: P2
- Status: TODO
- Description:
  - Create chain adapter interface and stub SKALE adapter.
- Acceptance Criteria:
  - Base adapter remains default; SKALE adapter compiles and is selectable
- Dependencies: GP-051
