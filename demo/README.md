# Demo Codebases

`demo/` contains three ready-to-use repositories for an OSM402 payout demo.

## Folders

- `demo/origin-repo`: baseline repository (contains the intentional `add()` bug).
- `demo/pr-accept-repo`: PR source that should be accepted and paid.
  - Change: `src/calc.js` only (`a - b` -> `a + b`)
- `demo/pr-reject-repo`: PR source that should be put on HOLD/rejected for payout.
  - Changes:
    - `src/calc.js` fix (`a - b` -> `a + b`)
    - `.github/workflows/ci.yml` added (matches `holdIf.touchesPaths`)

## Why reject triggers HOLD

Policy file includes:

- `.github/workflows/**` in `holdIf.touchesPaths`

So any PR touching workflow files is expected to produce HOLD behavior.

## Suggested demo flow

1. Create a real GitHub repo from `demo/origin-repo`.
2. Create one issue using `demo/ISSUE_DEMO_001.md` and add label `bounty:$0.1`.
3. Open PR from `demo/pr-reject-repo` first to show HOLD behavior.
4. Open PR from `demo/pr-accept-repo` to show normal paid behavior.
