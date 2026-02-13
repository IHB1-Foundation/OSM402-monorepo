# PR 템플릿 (HOLD / 미지급 기대)

## 제목

`CI workflow tweak for maintenance (Closes #<ISSUE_NUMBER>)`

## 브랜치/변경 가이드

- 브랜치: `chore/workflow-hold`
- 변경 파일: `.github/workflows/ci.yml` (신규 생성 또는 수정)
- 이유: 정책의 `holdIf.touchesPaths`에 `.github/workflows/**`가 포함되어 HOLD를 의도적으로 재현

예시 파일 내용:

```yaml
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
```

## 본문(복붙)

```text
Closes #<ISSUE_NUMBER>

osm402:address 0x<YOUR_RECIPIENT_ADDRESS>

### 변경 내용
- GitHub Actions workflow 파일 추가

### 의도
- 정책의 sensitive path 조건이 HOLD를 올바르게 트리거하는지 검증
```

## 기대 결과

- PR 오픈 후 `OSM402 Review (Gemini)` 코멘트
- 머지 후 `OSM402 — HOLD` 코멘트
- `/api/payout/execute` 호출 시 `409` + `Payout is on HOLD`
