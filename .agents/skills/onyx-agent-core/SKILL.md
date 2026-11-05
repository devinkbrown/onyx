---
name: onyx-agent-core
description: >
  Shared dense operating contract for all Onyx web client agents. Load when
  implementing, reviewing, or gating any /home/kain/onyx change.
---

# Onyx client agent core (token-lean)

## Bar (all modes)
1. **Correct** — intended behavior on every edge; verify against live source.
2. **Fail-closed / secure** — hostile IRC is untrusted; no silent plaintext on E2EE fail.
3. **Neat** — Elm idioms (pure `update`, effects as data, impossible states unrepresentable); small units; match existing patterns.
4. **Efficient** — no needless model churn or view work; measure before perf claims.

## Repo facts
- Path: `/home/kain/onyx`. **pnpm only** (never npm/bun).
- Stack: Elm 0.19.1 (`elm/src`) + JS ports (`elm/ports.js`) + esbuild-bundled TypeScript engine (`elm/engine`, strict TS with `noUncheckedIndexedAccess`). The SolidJS client was removed (tag `solid-client-final`); there is no other client.
- Brand: **Onyx** = client/network; **Onyx Server** = daemon. English subsystem names (Cadence, Mooring client crypto).
- Do **not** edit `/home/kain/onyx-server` unless the task explicitly says dual-repo.

## Elm / port invariants
- Effects are data: `update` returns state plus `List Outbound`; only `Main.elm` talks to ports.
- New features live in their own module, wired into `App.elm` via a `-- v3/<slice>` block and the `settleSteps` list.
- Every side effect (socket, IndexedDB, WebCrypto, uploads) crosses a port in `elm/ports.js`; Elm validates fail-closed.
- `localStorage` keys: `onyx:` prefix. Wire METADATA keys `ocean.*` are **frozen wire format**.

## Security sinks (fail closed)
- **Render/XSS**: parse → typed tokens → Elm `text` nodes; never `innerHTML`.
- **E2EE DM**: failed DM open/seal → locked placeholder; never plaintext to the model/vault/outbox.
- **Vault**: only ciphertext for E2EE bodies in IndexedDB; `VAULT_KEEP = 400` per target.
- **Outbox**: MEMO-only offline; classify drop vs permanent fail carefully (see `elm/src/Outbox.elm`).
- **Roster**: late/overlapping `NAMES` 353 must **APPEND**, not REPLACE (unless client-initiated burst).
- **PREFIX**: learn exotic `PREFIX=(YQqov)*!.@+` from 005 before nick parse.

## Gates
| Iterate | Ship |
|---------|------|
| focused `elm-test <file>` / `node elm/<x>.smoke.mjs` / `pnpm exec vitest run <files>` | `elm make` + `elm-test` + `pnpm test:smoke` + `pnpm typecheck` + `pnpm lint` + `pnpm test` |
| UI journey | `node elm/tools/screens.mjs` (real Chromium, local fake IRC server — never the live network) |

## Deploy
- `pnpm build` → **`dist/`** only (safe).
- **Only `./deploy.sh` writes `out/`** (nginx). Never point tests/builds at `out/`.

## Skills map
| Need | Skill |
|------|-------|
| roadmap slice | `onyx-roadmap-execution` |
| Codex↔Claude handoff | `cross-model-handoff` |
| gates / release evidence | `onyx-client-verification` |
| roster / toolkit | `onyx-agent-toolkit` |

## Specialist routing
See `.agents/ROSTER.md`. Implement: `onyx-coder-leaf`.  
Deep: `onyx-irc`, `onyx-store`, `onyx-crypto`, `onyx-render`, `onyx-vault`, `onyx-media`, `onyx-notify`, `onyx-theme`, `onyx-a11y`, `onyx-ui`, `onyx-cmdk`, `onyx-perf`, `onyx-e2e`.

## Docs
`AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `CONTRIBUTING.md`, `.agents/ROSTER.md`.
