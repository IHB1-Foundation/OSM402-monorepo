# OSM402 Submission Guide

## Target Tracks

1. Overall Track: Best Agentic App / Agent
2. Best Integration of AP2

## Requirement Mapping

### Overall Track

| Requirement | Where it is implemented | Evidence to show |
|---|---|---|
| discover -> decide -> pay/settle -> outcome | `apps/server/src/scripts/agentFundOpenBounties.ts`, `apps/server/src/handlers/mergeDetected.ts`, `apps/server/src/routes/payout.ts` | Demo: `docs/DEMO.md` section 8 |
| Deterministic and reliable flow | `.gitpay.yml` + policy engine + idempotency checks | PASS/HOLD split + re-run behavior in logs |
| Trust and safety guardrails | HOLD rules, required checks, intent/cart mandates, escrow constraints | `OSM402 - HOLD` comment + contract constraints |
| Receipts and audit trail | Funding/payout comments include tx/hash refs | `apps/server/src/services/comments.ts` |

### AP2 Track

| Requirement | Where it is implemented | Evidence to show |
|---|---|---|
| intent -> authorization -> settlement | Intent/Cart mandates + `release(...)` | `packages/mandates`, `apps/server/src/services/releaseConfig.ts`, `contracts/src/IssueEscrow.sol` |
| Clear authorization boundary | Maintainer signs Intent, agent signs Cart | `apps/server/src/services/releaseConfig.ts` |
| Auditable receipt output | Paid comment with `txHash`, `cartHash`, `intentHash` | `apps/server/src/services/comments.ts` |
| Failure mode | Invalid auth / replay / mismatch reverts | `scripts/ap2-failure-mode.sh` output |

## Demo Sequence (2-3 min)

1. Create/fund issue via x402 (`402` -> pay -> retry success)
2. PASS PR merge -> auto payout (`OSM402 - Paid`)
3. HOLD PR merge -> block payout (`OSM402 - HOLD`, `/api/payout/execute` returns `409`)
4. AP2 failure mode command:

```bash
pnpm demo:ap2-failure
```

## Evidence Bundle

Collect a single folder for screenshots/logs/json payloads:

```bash
pnpm evidence:collect
```

Artifacts are saved under `artifacts/evidence-<timestamp>/`.
