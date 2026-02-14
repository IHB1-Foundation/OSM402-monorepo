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
Closes #1
osm402:address 0x39143a780AED48939607d781A8B87E624e41A9fB
```

## PR Example (Success / ACCEPT expected)

Title:

`Fix add() implementation (Closes #1)`

Body:

```text
Closes #1

osm402:address 0x39143a780AED48939607d781A8B87E624e41A9fB

### Changes
- Update `src/calc.js` so `add()` returns `a + b`

### Tests
- `npm test` passes
```

Branch guide:

- `fix/add-pass`
- Only modify `src/calc.js` (`return a + b;`)

## PR Example (Failure / REJECT_HOLD expected)

Title:

`CI workflow tweak for maintenance (Closes #1)`

Body:

```text
Closes #1

osm402:address 0x39143a780AED48939607d781A8B87E624e41A9fB

### Changes
- Add or modify `.github/workflows/ci.yml`

### Intent
- Verify policy `holdIf(touchesPaths: .github/workflows/**)` triggers HOLD as expected
```

Branch guide:

- `chore/workflow-hold`
- Add or modify `.github/workflows/ci.yml`
