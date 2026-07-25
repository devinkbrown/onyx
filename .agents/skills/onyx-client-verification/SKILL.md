---
name: onyx-client-verification
description: >
  Choose and run evidence-backed Onyx client gates: focused Vitest, full pnpm
  typecheck/lint/test, Playwright e2e, and release readiness. Use when judging
  whether a client change is done or shippable.
---

# Onyx client verification

## Default ship gate
```sh
pnpm typecheck && pnpm lint && pnpm test
```
A green focused test is **not** enough for ship — run all three.

## Iterate
```sh
pnpm exec vitest run path/to/file.test.ts
```

## UI / connected behavior
- Playwright: `pnpm test:e2e` (or scoped spec). Connected e2e must hit the **live origin** (WS is origin-sensitive).
- Prefer `onyx-e2e` agent for critical flows (connect/join, DM/E2EE, media, search).
- Distinguish source-only a11y conclusions from real browser evidence.

## Release readiness checklist
1. Gates green (typecheck + lint + test); report pass counts.
2. No `out/` writes from the change (only `deploy.sh` may write `out/`).
3. Route materialization updated if routes changed (`tools/materialize-route-entrypoints.mjs`).
4. Security sinks touched? Independent review (`onyx-security-boundary-reviewer` / `onyx-render` / `onyx-crypto`).
5. Dual-repo wire change? Server first or client first per contract; never assume daemon behavior without source.
6. Deploy only on explicit user go via `./deploy.sh`.

## Vacuous-test traps
- Mocking away the store so no immutable-action path runs
- E2E that never opens a real WS
- Asserting only that a component mounts without interaction

## Evidence return shape
Commands, pass/fail counts, files covered, residual risks, not-shipped reasons.
