# BITE V2 Sandbox 2 Demo Repository (Origin)

This folder is the baseline repository for the real GitHub demo.

## Purpose

- Contains the intentional bug in `src/calc.js` (`add()` returns subtraction).
- Includes `.osm402.yml` policy used by OSM402.
- Acts as the target repository where you create issues and receive PRs.

## Setup

1. Create a new GitHub repository (example: `osm402-bite-demo-repo`).
2. Push the contents of this folder as the initial `main` branch.

## Policy

`.osm402.yml` is included in the repo root:

- Fixed payout: `0.1`
- HOLD triggers: `.github/workflows/**` and common lockfiles

## Bug to Fix

`src/calc.js` has an intentional bug:

- current behavior: `add(a, b)` returns `a - b`
- expected behavior: `add(a, b)` returns `a + b`

## Test

```bash
npm test
```
