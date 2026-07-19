---
name: onyx-roadmap-execution
description: Execute an Onyx-only slice of the Orochi-Onyx master roadmap with a source audit, SolidJS-safe implementation, focused tests, full pnpm gates, and optional release verification. Use when continuing the Onyx roadmap, fixing a roadmap-visible regression, or selecting the next client-only roadmap slice.
---

# Onyx roadmap execution

Read `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `CONTRIBUTING.md`, and `/home/kain/OROCHI_ONYX_MASTER_ROADMAP.md` before selecting work. Treat current source and tests as the truth when roadmap prose is stale.

## Select a slice

Stay in Onyx. Do not modify `/home/kain/onyx-server`. Choose one observable, testable slice. Prioritize in this order unless the user names a different target:

1. Regressions in identity, session resume, navigation, nicklist, active surfaces, or browser rendering.
2. Remaining Sumi-e/Washi evidence: reader and time handoffs, dense-surface accessibility/reflow, background guardrails.
3. Torii entry integrity: invite, guest, claim, remembered identity, route/deploy metadata.
4. Local-first and extension safety boundaries.
5. Only then planned media or local-intelligence work backed by existing client contracts.

## Implement

Trace the behavior from UI entry through the Zustand store, IRC/wire layer, persistence, and rendering. Preserve Solid fine-grained reactivity: use `useStore` for reactive reads, avoid destructuring props, and use immutable store actions. Keep `onyx:` storage keys and `ocean.*` wire keys unchanged.

Add or update a co-located regression test. Update route materialization whenever routes change. Keep changes narrow; do not refactor adjacent code opportunistically.

## Verify and release

Run focused tests, then `pnpm typecheck`, `pnpm lint`, and `pnpm test`. Run the relevant Playwright/browser journey for UI work. Only `./deploy.sh` may write `out/`; do not deploy unless the user asks or the current release task explicitly authorizes it.

Use `cross-model-handoff` for independent evidence or review when the slice has meaningful UI, security, wire, or architecture risk.

## Gotchas

Real production failures in these priority areas; guard whichever the slice touches.

- Nicklist/roster (priority 1): an overlapping or late `NAMES` 353 must APPEND to the roster, never REPLACE it — a replacing fold collapsed `#root` to 2 members in production. Only a burst the client itself initiated (reconnect/reconcile) may replace. Confirm the roster folds against the exotic `PREFIX=(YQqov)*!.@+` learned from 005 so prefixed nicks are not mangled or dropped.
- E2EE DM (priority 4, security boundary): never silently downgrade a failed DM seal to plaintext. A DM that fails to open stays a locked placeholder; plaintext must never reach the outbox, the store, or the vault.
- Message render (priority 1, browser rendering): the render path is the XSS sink — parse raw line to typed tokens then render as JSX text nodes; never `innerHTML` / `dangerouslySetInnerHTML`.
