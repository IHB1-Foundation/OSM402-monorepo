# Issue Draft (Demo)

## Title

`Bug: add() returns wrong result in src/calc.js`

## Body

```text
### Problem
`src/calc.js` function `add(a, b)` returns subtraction instead of addition.

### Expected behavior
add(2, 3) === 5

### Reproduction
1) Run `npm test`
2) Test for `add()` fails

### Acceptance Criteria
- `add()` returns `a + b`
- `npm test` passes
```

## Label

- `bounty:$0.1`

## PR Body Template Hint

Include both lines in PR body:

```text
Closes #<ISSUE_NUMBER>
osm402:address 0x<YOUR_RECIPIENT_ADDRESS>
```
