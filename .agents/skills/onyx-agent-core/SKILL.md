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
3. **Neat** — Solid idioms; small units; match existing patterns.
4. **Efficient** — no wasted re-renders or store churn; measure before perf claims.

## Repo facts
- Path: `/home/kain/onyx`. Branch typically `onyx-solid`. **pnpm only** (never npm/bun).
- Stack: SolidJS 1.9 + Vite 7 + Zustand vanilla + `useStore` bridge + strict TS (`noUncheckedIndexedAccess`).
- Brand: **Onyx** = client/network; **Onyx Server** = daemon. English subsystem names (Cadence, Mooring client crypto).
- Do **not** edit `/home/kain/onyx-server` unless the task explicitly says dual-repo.

## Solid / store invariants
- Never destructure props; read signals in JSX / `createMemo` / effects only.
- Reactive reads: `useStore(s => …)`. Snapshots: `getState()` (non-reactive).
- Writes: immutable `set()` store actions only.
- `localStorage` keys: `onyx:` prefix. Wire METADATA keys `ocean.*` are **frozen wire format**.

## Security sinks (fail closed)
- **Render/XSS**: parse → typed tokens → text-node JSX; never `innerHTML` / `dangerouslySetInnerHTML`.
- **E2EE DM**: failed `openDm`/`sealDm` → locked placeholder; never plaintext to store/vault/outbox.
- **Vault**: only ciphertext for E2EE bodies in IndexedDB; `VAULT_KEEP = 400` per target.
- **Outbox**: MEMO-only offline; classify drop vs permanent fail carefully (see `outboxFlushDecision.ts`).
- **Roster**: late/overlapping `NAMES` 353 must **APPEND**, not REPLACE (unless client-initiated burst).
- **PREFIX**: learn exotic `PREFIX=(YQqov)*!.@+` from 005 before nick parse.

## Gates
| Iterate | Ship |
|---------|------|
| focused `pnpm exec vitest run <files>` | `pnpm typecheck` + `pnpm lint` + `pnpm test` |
| UI journey | relevant Playwright under `tests/e2e/` against live origin (WS origin-sensitive) |

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
See `.agents/ROSTER.md`. Implement: `solidjs-coder` / `onyx-coder-leaf`.  
Deep: `onyx-irc`, `onyx-store`, `onyx-crypto`, `onyx-render`, `onyx-vault`, `onyx-media`, `onyx-notify`, `onyx-theme`, `onyx-a11y`, `onyx-ui`, `onyx-cmdk`, `onyx-perf`, `onyx-e2e`.

## Docs
`AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `CONTRIBUTING.md`, `.agents/ROSTER.md`.
