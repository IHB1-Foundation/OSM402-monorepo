# PR 예시(복붙)

## 제목

`Fix add() implementation (Closes #<ISSUE_NUMBER>)`

## 본문

아래는 “이슈 링크 + 지급 주소”가 한 번에 들어가도록 만든 형태입니다.

```
Closes #<ISSUE_NUMBER>

gitpay:address 0x1234567890abcdef1234567890abcdef12345678

### 변경 내용
- add()가 a+b를 반환하도록 수정

### 테스트
- npm test
```

> `gitpay:address ...`는 PR open/sync 이벤트에서 자동으로 캡처됩니다.

