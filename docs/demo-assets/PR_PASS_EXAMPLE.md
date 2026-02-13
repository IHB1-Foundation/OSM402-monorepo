# PR 템플릿 (PASS / 지급 기대)

## 제목

`Fix add() implementation (Closes #<ISSUE_NUMBER>)`

## 브랜치/변경 가이드

- 브랜치: `fix/add-pass`
- 변경 파일: `src/calc.js`만 수정
- 수정 내용: `return a + b;`

## 본문(복붙)

```text
Closes #<ISSUE_NUMBER>

osm402:address 0x<YOUR_RECIPIENT_ADDRESS>

### 변경 내용
- add()가 a+b를 반환하도록 수정

### 테스트
- npm test 통과
```

## 기대 결과

- PR 오픈 후 `OSM402 Review (Gemini)` 코멘트
- PR 머지 후 `OSM402 — Paid` 코멘트 + txHash
