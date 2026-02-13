# BITE V2 Sandbox 2 데모용 레포(예시)

이 폴더는 “진짜 GitHub 레포”로 옮겨서 데모하기 위한 최소 코드베이스입니다.

## 1) 새 GitHub 레포 만들기

- 새 repo 생성 (예: `gitpay-bite-demo-repo`)
- 이 폴더(`examples/bite-demo-repo/`) 내용을 그대로 push

## 2) 정책 파일

루트에 `.gitpay.yml`이 포함되어 있습니다.

## 3) 이슈/PR 흐름(추천)

1) 이슈 생성 → `bounty:$10` 라벨 부착
2) 로컬에서 buyer agent 실행 → 이슈 펀딩(x402 + onchain)
3) PR 생성(본문에 `Closes #...` + `gitpay:address 0x...`)
4) 머지 → GitPay가 onchain payout 실행 + PR에 Paid 코멘트

## 4) 테스트

```bash
npm test
```

## 5) PR에서 고칠 버그

`src/calc.js`의 `add()`가 현재 빼기로 구현되어 있어 테스트가 실패합니다.

