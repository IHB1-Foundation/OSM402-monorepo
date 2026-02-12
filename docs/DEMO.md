# GitPay.ai — End-to-End Demo Script

**Duration:** 3–5 minutes

## Prerequisites

1. Server running: `pnpm dev --filter server`
2. `.env` configured (copy from `.env.example`)
3. `X402_MOCK_MODE=true` (for local testing without real payments)

## Step 1: Verify Server Health (30s)

```bash
curl http://localhost:3000/api/health | jq
```

Expected:
```json
{ "status": "ok", "timestamp": "...", "version": "0.1.0" }
```

## Step 2: Fund a Bounty via x402 (1 min)

### 2a. Call `/api/fund` without payment (expect 402)

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST http://localhost:3000/api/fund \
  -H "Content-Type: application/json" \
  -d '{"repoKey":"owner/repo","issueNumber":1,"bountyCapUsd":10}'
```

Expected: `HTTP 402` with payment requirements.

### 2b. Retry with x402 payment header

```bash
PAYMENT=$(echo -n '{"paymentHash":"demo-001","amount":"10000000","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","chainId":84532,"payer":"0x0000000000000000000000000000000000000001"}' | base64)

curl -s -X POST http://localhost:3000/api/fund \
  -H "Content-Type: application/json" \
  -H "X-Payment: $PAYMENT" \
  -d '{"repoKey":"owner/repo","issueNumber":1,"bountyCapUsd":10}' | jq
```

Expected: `200 OK` with escrow address, deposit tx hash, intent hash.

### 2c. Verify funding status

```bash
curl http://localhost:3000/api/fund/owner/repo/1 | jq
```

## Step 3: Simulate Merge Webhook (1 min)

```bash
curl -s -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: demo-delivery-001" \
  -d '{
    "action": "closed",
    "number": 42,
    "pull_request": {
      "number": 42,
      "title": "Fix issue #1",
      "body": "Closes #1",
      "merged": true,
      "merge_commit_sha": "abc123def456",
      "user": {"login": "contributor"},
      "head": {"sha": "head123"},
      "base": {"ref": "main"},
      "changed_files": 2,
      "additions": 30,
      "deletions": 5
    },
    "repository": {
      "full_name": "owner/repo",
      "default_branch": "main"
    }
  }' | jq
```

Expected: Payout created (status PENDING or auto-executed to DONE).

## Step 4: Execute Payout (30s)

```bash
curl -s -X POST http://localhost:3000/api/payout/execute \
  -H "Content-Type: application/json" \
  -d '{"repoKey":"owner/repo","prNumber":42}' | jq
```

Expected: `200 OK` with tx hash (mock in dev mode).

## Step 5: Verify Idempotency (30s)

Re-send the same webhook delivery:

```bash
curl -s -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: demo-delivery-001" \
  -d '{}' | jq
```

Expected: `200 OK` with "Delivery already processed" — no duplicate payout.

## Summary

| Step | Action | Result |
|------|--------|--------|
| 1 | Health check | Server running |
| 2a | Fund (no payment) | 402 with requirements |
| 2b | Fund (with x402) | Escrow funded |
| 3 | Merge webhook | Payout pipeline started |
| 4 | Execute payout | TX recorded |
| 5 | Duplicate webhook | Safely ignored |
