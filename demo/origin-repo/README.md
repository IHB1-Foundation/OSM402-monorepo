# BITE V2 Sandbox 2 데모용 레포(예시)

이 폴더는 “진짜 GitHub 레포”로 옮겨서 데모하기 위한 최소 코드베이스입니다.

## 1) 새 GitHub 레포 만들기

- 새 repo 생성 (예: `osm402-bite-demo-repo`)
- 이 폴더(`examples/bite-demo-repo/`) 내용을 그대로 push

## 2) 정책 파일

루트에 `.osm402.yml`이 포함되어 있습니다.

- 기본 payout: `0.1`
- HOLD 조건: `.github/workflows/**`, lockfile 변경 시 HOLD

## 3) 이슈/PR 흐름(추천)

1) PASS용/HOLD용 이슈 2개 생성 → 각각 `bounty:$0.1` 라벨 부착
2) 로컬에서 buyer agent 실행 → 이슈 2개 모두 펀딩(x402 + onchain)
3) PASS PR 생성: `src/calc.js`만 수정 (`a - b` -> `a + b`)
4) PASS PR 머지 → OSM402가 onchain payout 실행 + PR에 Paid 코멘트
5) HOLD PR 생성: `.github/workflows/ci.yml` 추가/수정
6) HOLD PR 머지 → OSM402가 HOLD 코멘트 (미지급)

템플릿:
- PASS PR: `docs/demo-assets/PR_PASS_EXAMPLE.md`
- HOLD PR: `docs/demo-assets/PR_HOLD_EXAMPLE.md`

## 4) 테스트

```bash
npm test
```

## 5) PR에서 고칠 버그

`src/calc.js`의 `add()`가 현재 빼기로 구현되어 있어 테스트가 실패합니다.
