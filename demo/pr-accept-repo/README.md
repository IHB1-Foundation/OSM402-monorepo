# BITE V2 Sandbox 2 Demo Repository (PR Accept Case)

This folder represents the PR source that should be accepted and paid.

## Purpose

- Fixes only `src/calc.js` (`a - b` -> `a + b`).
- Does not touch sensitive paths (such as `.github/workflows/**`).
- Should pass policy checks and proceed to payout.

## How to Use

1. Start from the real GitHub `origin-repo`.
2. Create a feature branch.
3. Apply the same changes from this folder.
4. Open a PR with:
   - `Closes #<ISSUE_NUMBER>`
   - `osm402:address 0x<RECIPIENT_ADDRESS>`

Reference template:

- `docs/demo-assets/PR_PASS_EXAMPLE.md`

## Test

```bash
npm test
```
