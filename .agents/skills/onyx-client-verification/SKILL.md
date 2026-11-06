---
name: onyx-client-verification
description: >
  Choose and run evidence-backed Onyx client gates: elm-test, port smokes,
  runtime Vitest, typecheck/lint, Playwright mock and audit suites, local-server
  labs, and release readiness. Use when judging
  whether a client change is done or shippable.
---

# Onyx client verification

## Default ship gate
```sh
pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit
pnpm typecheck && pnpm lint
pnpm test:elm-runtime
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
node --test elm/*.smoke.mjs
pnpm test:e2e:elm
```
A green focused test is **not** enough for ship — run the whole gate. Add `pnpm test` for shared `src/`/`tools/` changes and `bash tools/deploy-controller.test.sh` for `deploy.sh`.

## Iterate
```sh
(cd elm && elm-test tests/<Module>Test.elm)
node --test elm/<name>.smoke.mjs
pnpm exec vitest run --config elm/vitest.runtime.config.ts elm/runtime/<file>.test.ts
```

## UI / connected behavior
- Playwright mock suite `pnpm test:e2e:elm` and the 628-check audit `pnpm test:e2e:elm:audit` (Chromium desktop/light/reduced-motion + iPhone 13/13-light/SE emulation; opt-in Firefox via `ONYX_FIREFOX_EXECUTABLE`). `pnpm test:e2e` is a broken Vite leftover.
- Connected behavior: local-server labs (`node elm/tools/lab/run.mjs … --suite foundation|sessions|history|group`). Never test against production servers.
- Mock and emulation results are not real-device (Safari/iOS/Android) evidence.
- Prefer `onyx-e2e` agent for critical flows (connect/join, DM/E2EE, media, search).
- Distinguish source-only a11y conclusions from real browser evidence.

## Release readiness checklist
1. Gates green (typecheck + lint + test); report pass counts.
2. No `out/` writes from the change (only `deploy.sh` may write `out/`).
3. Route materialization updated if routes changed (`elm/src/Route.elm` + `tools/materialize-elm-routes.mjs`).
4. Security sinks touched? Independent review (`onyx-security-boundary-reviewer` / `onyx-render` / `onyx-crypto`).
5. Dual-repo wire change? Server first or client first per contract; never assume daemon behavior without source.
6. Deploy only on explicit user go via `./deploy.sh`, then `node tools/verify-live-shell.mjs https://eshmaki.me`.
7. Don't claim roadmap acceptance: that needs source-bound receipts (`docs/elm-roadmap/runner.md`).

## Vacuous-test traps
- Testing a view helper while `App.update` never runs the path
- E2E that never opens a real WS
- Asserting only that a component mounts without interaction

## Evidence return shape
Commands, pass/fail counts, files covered, residual risks, not-shipped reasons.
