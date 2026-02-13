# OSM402 Demo Manual (Intern-Friendly)

목표: **로컬 서버 + 실제 GitHub + BITE V2 Sandbox 2 + 실제 USDC(0.1 USDC)** 데모를 누구나 그대로 재현.

## 1) 고정값 (이번 데모에서 변경 금지)

- Network: `BITE V2 Sandbox 2`
- Chain ID: `103698795`
- RPC: `https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2`
- Explorer: `https://base-sepolia-testnet-explorer.skalenodes.com:10032`
- Token: `USDC` (decimals `6`)
- USDC Address: `0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8`
- Demo bounty label: `bounty:$0.1`

## 2) 준비물

- Node.js 20+
- pnpm 8+
- Foundry (`forge`, `cast`)
- ngrok
- 실제 GitHub 계정 + GitHub App 생성 권한

설치 확인:

```bash
node -v
pnpm -v
forge --version
cast --version
ngrok version
```

## 3) 지갑 세팅 (가장 중요)

### 3-1. 지갑 매핑표

#### A안: 한 지갑 재사용 (데모 빠르게 진행, 권장)

| ENV 키 | 역할 | 같은 지갑 사용 가능 |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | 컨트랙트 배포 | ✅ |
| `GITPAY_MAINTAINER_PRIVATE_KEY` | Intent 서명 | ✅ |
| `GITPAY_AGENT_PRIVATE_KEY` | Cart 서명 + release tx 실행 | ✅ |
| `X402_PAYER_PRIVATE_KEY` | 이슈 펀딩(USDC 전송) | ✅ |

이 경우 `GITPAY_MAINTAINER_ADDRESS`, `GITPAY_AGENT_ADDRESS`는 비워도 됩니다.

#### B안: 역할 분리 지갑

| ENV 키 | 전용 지갑 |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | deployer |
| `GITPAY_MAINTAINER_PRIVATE_KEY` | maintainer signer |
| `GITPAY_AGENT_PRIVATE_KEY` | payout agent |
| `X402_PAYER_PRIVATE_KEY` | payer |

이 경우 아래도 반드시 입력:
- `GITPAY_MAINTAINER_ADDRESS=<maintainer address>`
- `GITPAY_AGENT_ADDRESS=<agent address>`

### 3-2. private key -> address 확인 방법

```bash
# 예시: deployer 키 주소 확인
cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY"
```

모든 키 주소를 확인해서 메모해 두세요. 데모 직전 주소 혼동이 가장 자주 납니다.

### 3-3. 잔액 준비

필수:
- Deployer/Payer/Agent 지갑에 체인 사용 가능한 가스 토큰(sFUEL) 확보
- Payer 지갑에 최소 `0.1 USDC` 이상 확보

권장:
- 실패 대비 `1 USDC` 이상 준비

## 4) GitHub 설정 (실제 GitHub 필수)

### 4-1. 데모용 실제 저장소 생성

1. GitHub에서 새 repo 생성 (예: `gitpay-bite-demo-repo`)
2. `examples/bite-demo-repo/` 내용을 push
3. repo root에 `.gitpay.yml` 존재 확인

### 4-2. GitHub App 생성 (상세)

경로:
- GitHub 우측 상단 프로필
- `Settings`
- `Developer settings`
- `GitHub Apps`
- `New GitHub App`

필수 입력:
- GitHub App name: 예) `gitpay-demo-local`
- Homepage URL: 본인 GitHub 프로필 또는 repo URL
- Webhook: `Active`
- Webhook URL: 임시로 `https://example.com/api/webhooks/github` 입력 후 나중에 ngrok URL로 교체
- Webhook secret: `.env`의 `GITHUB_WEBHOOK_SECRET`와 동일

Repository permissions:
- Issues: `Read and write`
- Pull requests: `Read and write`
- Contents: `Read-only`
- Checks: `Read-only`

Subscribe to events:
- `Issues`
- `Pull request`
- `Issue comment`

생성 후:
1. App 상세 페이지에서 `App ID` 확인 -> `.env`의 `GITHUB_APP_ID`에 입력
2. `Private keys`에서 `Generate a private key` 클릭
3. 다운로드된 `.pem` 내용을 `.env`의 `GITHUB_PRIVATE_KEY_PEM`에 입력

`.env`에 넣을 때(한 줄로):

```bash
# 다운로드한 파일명 예시: gitpay-demo-local.2026-02-14.private-key.pem
PEM_ONE_LINE=$(awk 'NF {sub(/\r/, ""); printf "%s\\n", $0;}' gitpay-demo-local*.pem)
echo "$PEM_ONE_LINE"
```

출력된 값을 `GITHUB_PRIVATE_KEY_PEM=` 뒤에 붙여 넣으세요.

### 4-3. GitHub App 설치

- App 페이지의 `Install App`
- 데모 repo가 있는 org/user 선택
- Repository access: `Only select repositories`
- 데모 repo 선택 후 설치

## 5) .env 채우기 체크리스트

프로젝트 루트에서:

```bash
cp .env.example .env
```

필수 입력 항목:
- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY_PEM`
- `GITHUB_WEBHOOK_SECRET`
- `OSM402_ACTION_SHARED_SECRET` (legacy alias: `GITPAY_ACTION_SHARED_SECRET`)
- `DEPLOYER_PRIVATE_KEY`
- `GITPAY_MAINTAINER_PRIVATE_KEY`
- `GITPAY_AGENT_PRIVATE_KEY`
- `X402_PAYER_PRIVATE_KEY`
- `DEMO_REPO=owner/repo`

선택 입력:
- `GITPAY_MAINTAINER_ADDRESS`, `GITPAY_AGENT_ADDRESS` (역할 분리 지갑일 때)
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## 6) 빌드 + 컨트랙트 배포

```bash
pnpm install
pnpm -r build
pnpm --filter contracts deploy:bite-v2-sandbox-2
```

배포 로그에서:
- `IssueEscrowFactory deployed at: 0x...`

`.env` 반영:
- `ESCROW_FACTORY_ADDRESS=0x...`

## 7) 로컬 서버 + ngrok 연결

서버 실행:

```bash
pnpm dev --filter server
```

다른 터미널:

```bash
set -a
source .env
set +a
ngrok http 3000
```

ngrok가 준 URL을 GitHub App Webhook URL로 업데이트:
- `https://<ngrok-domain>/api/webhooks/github`

헬스체크:

```bash
curl -s http://localhost:3000/api/health | jq
```

Gemini 증거 체크:
- `ai.provider = "gemini"`
- `ai.configured = true`
- `ai.model = "gemini-2.0-flash"` (또는 설정값)

참고:
- `scripts/demo.sh`는 로컬 mock webhook 시뮬레이션용입니다.
- **실제 GitHub 데모**는 아래 8번 시나리오(PASS/HOLD)대로 GitHub PR을 직접 생성/머지해서 진행하세요.

## 8) 실제 데모 실행 (PASS + HOLD 2트랙)

### 8-1. 공통 준비 (Issue + Funding)

대상 repo에서:
1. PASS용 이슈 생성 + 라벨 `bounty:$0.1` 추가 (예: `ISSUE_PASS=1`)
2. HOLD용 이슈 생성 + 라벨 `bounty:$0.1` 추가 (예: `ISSUE_HOLD=2`)
3. 펀딩 에이전트 실행 (열려 있는 bounty 이슈 전체 처리)

변수 먼저 지정:

```bash
ISSUE_PASS=1
ISSUE_HOLD=2
PASS_PR_NO=1
HOLD_PR_NO=2
```

```bash
pnpm --filter server tsx src/scripts/agentFundOpenBounties.ts \
  --repo "$DEMO_REPO" \
  --secret "$OSM402_ACTION_SHARED_SECRET" \
  --private-key "$X402_PAYER_PRIVATE_KEY" \
  --rpc-url "$RPC_URL"
```

이슈 상태 확인:

```bash
curl -s "http://localhost:3000/api/fund/$DEMO_REPO/$ISSUE_PASS" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" | jq
curl -s "http://localhost:3000/api/fund/$DEMO_REPO/$ISSUE_HOLD" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" | jq
```

`FUNDED`가 나오면 PR 시나리오로 진행.

### 8-2. 시나리오 A (조건 만족 / 지급)

의도:
- 일반 코드 수정 PR -> 정책 통과 -> Paid

파일 템플릿:
- `docs/demo-assets/PR_PASS_EXAMPLE.md`

액션(기여자 로컬):

```bash
git checkout -b fix/add-pass
sed -i '' 's/return a - b;/return a + b;/' src/calc.js
npm test
git add src/calc.js
git commit -m "fix: make add() return a+b"
git push origin fix/add-pass
```

GitHub에서 PR 생성 시:
- 본문은 `PR_PASS_EXAMPLE.md` 복붙
- 반드시 `Closes #$ISSUE_PASS` + `osm402:address 0x...` 포함

기대 결과:
- PR 오픈 직후 `OSM402 Review (Gemini)` 코멘트 생성
- 머지 후 `OSM402 — Paid` 코멘트 + txHash

검증 포인트:
- 서버 로그: `[reviewer] Gemini review done ... source=gemini`
- 서버 로그: `[merge] AI risk flags source=gemini, count=<n>`
- explorer에서 USDC transfer 확인

### 8-3. 시나리오 B (조건 불만족 / HOLD)

의도:
- 정책 sensitive path 변경 PR -> HOLD

파일 템플릿:
- `docs/demo-assets/PR_HOLD_EXAMPLE.md`

액션(기여자 로컬):

```bash
git checkout -b chore/workflow-hold
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'YAML'
name: ci
on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm test
YAML
git add .github/workflows/ci.yml
git commit -m "chore: add ci workflow (hold scenario)"
git push origin chore/workflow-hold
```

GitHub에서 PR 생성 시:
- 본문은 `PR_HOLD_EXAMPLE.md` 복붙
- 반드시 `Closes #$ISSUE_HOLD` 포함

기대 결과:
- PR 오픈: `OSM402 Review (Gemini)` 코멘트
- 머지 후: `OSM402 — HOLD` 코멘트
- 자동 지급 없음

HOLD 확인 API:

```bash
HOLD_PR_NO=2
curl -s -X POST http://localhost:3000/api/payout/execute \
  -H "Content-Type: application/json" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" \
  -d '{"repoKey":"'"$DEMO_REPO"'","prNumber":'"$HOLD_PR_NO"'}' | jq
```

정상 HOLD 응답:
- HTTP `409`
- `error: "Payout is on HOLD"`

### 8-4. 발표용 진행 스크립트 (멘트 + 액션)

1. 멘트: “이슈 등록과 펀딩까지 자동으로 준비됩니다.”  
   액션: PASS/HOLD용 이슈 2개에 `bounty:$0.1` 라벨 + agent funding 실행
2. 멘트: “PASS 케이스는 머지 후 자동 지급됩니다.”  
   액션: `fix/add-pass` PR 생성/머지 -> `Paid` 코멘트 확인
3. 멘트: “민감 경로 변경은 머지돼도 지급이 HOLD 됩니다.”  
   액션: `chore/workflow-hold` PR 생성/머지 -> `HOLD` 코멘트 + 409 확인
4. 멘트: “AI는 리뷰/리스크 신호를 제공하고, 지급은 정책과 온체인 실행으로 결정됩니다.”  
   액션: `OSM402 Review (Gemini)` 코멘트 + 서버 로그 제시

## 9) 수동 지급 (PASS에서만 필요 시)

```bash
PASS_PR_NO=1
curl -s -X POST http://localhost:3000/api/payout/execute \
  -H "Content-Type: application/json" \
  -H "X-OSM402-Secret: $OSM402_ACTION_SHARED_SECRET" \
  -d '{"repoKey":"'"$DEMO_REPO"'","prNumber":'"$PASS_PR_NO"'}' | jq
```

## 10) 자주 발생하는 문제

- `401 Invalid webhook signature`
  - GitHub App webhook secret != `.env`의 `GITHUB_WEBHOOK_SECRET`
- `No token available`
  - GitHub App env 누락 또는 App 설치 안 됨
- `Escrow not funded onchain`
  - payer 지갑 USDC 부족 / 잘못된 토큰 전송
- `issue_not_funded`
  - `bounty:$0.1` 라벨 누락 또는 형식 오류
- Gemini 코멘트가 안 뜸
  - `GEMINI_API_KEY` 비어 있음 또는 API 호출 실패(서버 로그 확인)
  - `/api/health`에서 `ai.configured`가 `false`인지 먼저 확인

## 11) 데모 직전 30초 점검

```bash
# 1) health + ai
curl -s http://localhost:3000/api/health | jq

# 2) 핵심 env
rg -n "^(CHAIN_NAME|ASSET_SYMBOL|ASSET_ADDRESS|X402_MOCK_MODE|ESCROW_MOCK_MODE|ESCROW_FACTORY_ADDRESS|DEMO_REPO|GITHUB_APP_ID|GEMINI_API_KEY)=" .env

# 3) 지갑 주소 검증 예시
cast wallet address --private-key "$X402_PAYER_PRIVATE_KEY"

# 4) 정책 파일 확인 (HOLD 룰 존재 여부)
curl -s -H "Authorization: Bearer <token>" "https://api.github.com/repos/$DEMO_REPO/contents/.gitpay.yml" | jq -r '.name,.sha'
```

## 12) AP2 실패모드 증명 (권한/재실행 차단)

요구사항 대응 포인트:
- "누가 무엇을 승인했는지"가 깨지면 정산이 실패해야 함
- 동일 지급 재실행(replay)이 실패해야 함

실행:

```bash
pnpm demo:ap2-failure
```

기대 결과:
- `test_Release_RevertOnInvalidSignature`
- `test_Release_RevertOnInvalidCartSignature`
- `test_Release_RevertOnDoublePay`
- `test_Release_RevertOnWrongIntentHash`
- `test_Release_RevertOnPolicyMismatch`

위 테스트가 `PASS`면, AP2 authorization + settlement failure mode를 영상/로그로 증빙 가능.

## 13) 제출 증빙 번들 자동수집

데모 직후 아래 명령으로 제출용 파일 묶음을 생성:

```bash
pnpm evidence:collect
```

출력:
- `artifacts/evidence-<timestamp>/SUMMARY.md`
- `health.json`, `x402-challenge.json`
- PASS/HOLD payout 실행 응답 JSON
- `ap2-failure/ap2-failure.log`

추천:
- 영상에는 PASS/HOLD 실행 장면 + `SUMMARY.md` + Explorer tx 화면을 함께 캡처.
