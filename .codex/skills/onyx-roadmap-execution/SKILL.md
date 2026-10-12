---
name: onyx-roadmap-execution
description: Execute an Onyx-only slice of the Onyx Server-Onyx master roadmap with a source audit, Elm-safe implementation, focused tests, full pnpm gates, and optional release verification. Use when continuing the Onyx roadmap, fixing a roadmap-visible regression, or selecting the next client-only roadmap slice.
---

# Onyx roadmap execution

Read `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `CONTRIBUTING.md`, and `/home/kain/ONYX_ONYX_MASTER_ROADMAP.md` before selecting work. Treat current source and tests as the truth when roadmap prose is stale.

## Select a slice

Stay in Onyx. Do not modify `/home/kain/onyx-server`. Choose one observable, testable slice. Prioritize in this order unless the user names a different target:

1. Regressions in identity, session resume, navigation, nicklist, active surfaces, or browser rendering.
2. Remaining atmosphere evidence: reader and time handoffs, dense-surface accessibility/reflow, background guardrails.
3. Torii entry integrity: invite, guest, claim, remembered identity, route/deploy metadata.
4. Local-first and extension safety boundaries.
5. Only then planned media or local-intelligence work backed by existing client contracts.

## Implement

Trace the behavior from the view through `App.update` (the Elm folds), the wire modules (`Wire`, `Ircx`, …), the ports in `elm/ports.js`, persistence, and rendering. Keep effects as data (`Outbound`), put new logic in its own module wired through a `-- v3/<slice>` block, and keep `onyx:` storage keys and `ocean.*` wire keys unchanged.

Add or update an elm-test vector (and a smoke test for `ports.js` changes). Update `ROUTE_ENTRYPOINTS` in `tools/site/routes.mjs` together with `elm/src/Route.elm` whenever routes change. Keep changes narrow; do not refactor adjacent code opportunistically.

## Verify and release

Run focused tests (`elm-test`, the relevant `elm/*.smoke.mjs`, focused Vitest), then `pnpm typecheck`, `pnpm lint`, and `pnpm test`. Run `elm/tools/screens.mjs` (real Chromium against the local fake server) for UI work. Only `./deploy.sh` may write `out/`; do not deploy unless the user asks or the current release task explicitly authorizes it.

Use `cross-model-handoff` for independent evidence or review when the slice has meaningful UI, security, wire, or architecture risk.
