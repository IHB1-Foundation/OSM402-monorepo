# OSM402 Demo Manual (Real-Only)

목표: **실제 GitHub 이벤트 + 실제 온체인 실행(BITE V2 Sandbox 2)**으로 OSM402 플로우를 재현한다.

## 1) 고정값

- Network: `bite-v2-sandbox-2`
- Chain ID: `103698795`
- RPC: `https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2`
- Explorer: `https://base-sepolia-testnet-explorer.skalenodes.com:10032`
- Asset: `USDC` (`0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8`, decimals `6`)
- Demo label: `bounty:$0.1`
- Mode: `X402_MOCK_MODE=false`, `ESCROW_MOCK_MODE=false`

## 2) 준비물

- Node.js 20+
- pnpm 8+
- Foundry (`forge`, `cast`)
- ngrok
- GitHub App 생성/설치 권한

```bash
node -v
pnpm -v
forge --version
cast --version
ngrok version
```

## 3) 환경 변수 (.env)

```bash
cp .env.example .env
```

필수:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY_PEM`
- `GITHUB_WEBHOOK_SECRET`
- `OSM402_ACTION_SHARED_SECRET`
- `DEPLOYER_PRIVATE_KEY`
- `OSM402_MAINTAINER_PRIVATE_KEY`
- `OSM402_AGENT_PRIVATE_KEY`
- `X402_PAYER_PRIVATE_KEY`
- `DEMO_REPO=owner/repo`

단일 지갑 통합 모드(권장):

- `DEPLOYER_PRIVATE_KEY`
- `OSM402_MAINTAINER_PRIVATE_KEY`
- `OSM402_AGENT_PRIVATE_KEY`
- `X402_PAYER_PRIVATE_KEY`

위 4개를 **동일한 private key 값**으로 맞춘다.

필수 확인:

- `CHAIN_NAME=bite-v2-sandbox-2`
- `CHAIN_ID=103698795`
- `RPC_URL=https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2`
- `ASSET_SYMBOL=USDC`
- `ASSET_DECIMALS=6`
- `ASSET_ADDRESS=0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8`
- `X402_MOCK_MODE=false`
- `ESCROW_MOCK_MODE=false`

필수 추가:

- `OSM402_MAINTAINER_ADDRESS`
- `OSM402_AGENT_ADDRESS`

둘 다 단일 지갑 주소로 동일하게 설정.

키-주소 일치 확인:

```bash
cast wallet address --private-key "$OSM402_MAINTAINER_PRIVATE_KEY"
cast wallet address --private-key "$OSM402_AGENT_PRIVATE_KEY"
cast wallet address --private-key "$X402_PAYER_PRIVATE_KEY"
```

위 3개 출력 주소가 모두 같아야 단일 지갑 통합이 올바르게 적용된 상태다.

## 4) 컨트랙트 배포

```bash
pnpm install
pnpm -r build
pnpm --filter contracts deploy:bite-v2-sandbox-2
```

배포 로그의 주소 반영:

- `IssueEscrowFactory deployed at: 0x...` -> `.env`의 `ESCROW_FACTORY_ADDRESS`

## 5) 서버 실행 + GitHub Webhook 연결

터미널 A:

```bash
pnpm dev --filter server
```

터미널 B:

```bash
set -a
source .env
set +a
ngrok http 3000
```

GitHub App 설정:

- Webhook URL: `https://<ngrok-domain>/api/webhooks/github`
- Webhook secret: `.env`의 `GITHUB_WEBHOOK_SECRET`와 동일
- Repository permissions:
  - Issues: Read and write
  - Pull requests: Read and write
  - Contents: Read-only
  - Checks: Read-only
- Events:
  - Issues
  - Pull request
  - Issue comment

헬스체크:

```bash
curl -s http://localhost:3000/api/health | jq
```

## 6) 데모 시나리오

### 6.1 사전 준비

1. 데모 repo 루트에 `.osm402.yml` 존재 확인
2. Issue 2개 생성:
   - PASS 이슈
   - HOLD 이슈
3. 각 이슈에 `bounty:$0.1` 라벨 추가

### 6.2 펀딩 실행 (x402)

```bash
pnpm --filter server tsx src/scripts/agentFundOpenBounties.ts \
  --repo "$DEMO_REPO" \
  --secret "$OSM402_ACTION_SHARED_SECRET" \
  --private-key "$X402_PAYER_PRIVATE_KEY" \
  --rpc-url "$RPC_URL"
```

이슈 상태 확인:

```bash
ISSUE_PASS=<pass-issue-number>
ISSUE_HOLD=<hold-issue-number>

curl -s "http://localhost:3000/api/fund/$DEMO_REPO/$ISSUE_PASS" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" | jq
curl -s "http://localhost:3000/api/fund/$DEMO_REPO/$ISSUE_HOLD" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" | jq
```

기대: 두 이슈 모두 `FUNDED`.

### 6.3 PASS PR

PR 본문 필수:

- `Closes #<PASS_ISSUE>`
- `osm402:address 0x...`

머지 후 기대:

- PR 코멘트에 `OSM402 — Paid`
- txHash 출력
- Explorer에서 전송 확인 가능

### 6.4 HOLD PR

정책상 민감 경로(예: `.github/workflows/*`) 변경 PR 생성 후 머지.

머지 후 기대:

- PR 코멘트에 `OSM402 — HOLD`
- 자동 지급 없음

HOLD API 확인:

```bash
HOLD_PR_NO=<hold-pr-number>
curl -s -X POST http://localhost:3000/api/payout/execute \
  -H "Content-Type: application/json" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" \
  -d '{"repoKey":"'"$DEMO_REPO"'","prNumber":'"$HOLD_PR_NO"'}' | jq
```

기대: HTTP `409`, `Payout is on HOLD`.

## 7) 제출용 최소 증빙

- 402 challenge -> payment -> retry 성공 로그
- PASS PR의 Paid 코멘트 + txHash
- HOLD PR의 HOLD 코멘트 + 409 응답
- AP2 실패모드:

```bash
pnpm demo:ap2-failure
```

- 증빙 번들:

```bash
pnpm evidence:collect
```

## 8) 트러블슈팅

- `/api/fund` 401/403: `X-OSM402-Secret` 불일치
- webhook 401: `GITHUB_WEBHOOK_SECRET` 불일치
- 계속 402: payer USDC 부족/잘못된 전송
- payout 실패: maintainer/agent 주소-키 불일치
- GitHub 코멘트 누락: App 권한 또는 설치 대상 repo 확인
