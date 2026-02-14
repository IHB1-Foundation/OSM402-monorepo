# BITE V2 Sandbox 2 Demo Repository (PR HOLD Case)

This folder represents the PR source that should be held (not paid).

## Purpose

- Includes a normal code fix in `src/calc.js`.
- Also adds `.github/workflows/ci.yml`, which matches HOLD policy paths.
- Should trigger `OSM402 — HOLD` after merge.

## How to Use

1. Start from the real GitHub `origin-repo`.
2. Create a feature branch.
3. Apply the same changes from this folder.
4. Open a PR with:
   - `Closes #<ISSUE_NUMBER>`
   - `osm402:address 0x<RECIPIENT_ADDRESS>` (optional for HOLD demo)

Reference template:

- `docs/demo-assets/PR_HOLD_EXAMPLE.md`

## Test

```bash
npm test
```
