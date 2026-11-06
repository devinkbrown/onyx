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
- Default branch `onyx-elm`. Stack: Elm 0.19.1 (`elm/src`) + private TypeScript runtime (`elm/runtime`, Vite-bundled to `runtime.js`, strict TS) + browser bridge (`elm/ports.js`). `src/lib` holds only shared TS the runtime imports (Cadence media, E2EE, IRC parser). The SolidJS client was removed (tag `solid-client-final`); there is no other client.
- Brand: **Onyx** = client/network; **Onyx Server** = daemon. English subsystem names (Cadence, Mooring client crypto).
- Do **not** edit `/home/kain/onyx-server` unless the task explicitly says dual-repo.

## Elm / port invariants
- Effects are data: `update` returns state plus `List Outbound`; only `Main.elm` talks to ports.
- New logic lives in its own module; keep `App.elm` edits surgical.
- Secrets (passwords, tokens, keys, decrypted private payloads) stay in `elm/runtime`; the runtime owns the IRC socket. Other side effects (vault reads, prefs, uploads, notifications) cross `elm/ports.js`. Elm validates fail-closed.
- `localStorage` keys: `onyx:` prefix. Wire METADATA keys `ocean.*` are **frozen wire format**.

## Security sinks (fail closed)
- **Render/XSS**: parse → typed tokens → Elm `text` nodes; never `innerHTML`.
- **E2EE DM**: failed DM open/seal → locked placeholder; never plaintext to the model/vault/outbox.
- **Vault**: only ciphertext for E2EE bodies in IndexedDB (`onyx-vault`); default keep 400 per target.
- **Encrypted rooms**: epoch keys never persisted; device-trust review is new and pending independent security review.
- **Outbox**: MEMO-only offline; classify drop vs permanent fail carefully (see `elm/src/Outbox.elm`).
- **Roster**: late/overlapping `NAMES` 353 must **APPEND**, not REPLACE (unless client-initiated burst).
- **PREFIX**: learn exotic `PREFIX=(YQqov)*!.@+` from 005 before nick parse.

## Gates
| Iterate | Ship |
|---------|------|
| focused `elm-test <file>` / `node --test elm/<x>.smoke.mjs` / `pnpm exec vitest run --config elm/vitest.runtime.config.ts <files>` | `pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit` + `pnpm typecheck` + `pnpm lint` + `pnpm test:elm-runtime` + `elm make` + `elm-test` + `node --test elm/*.smoke.mjs` + `pnpm test:e2e:elm` |
| UI journey | `pnpm test:e2e:elm:audit` + `node elm/tools/screens.mjs --site <build>` (mock wire — never the live network) |
| Protocol / session / crypto | `node elm/tools/lab/run.mjs … --suite foundation\|sessions\|history\|group` against a local server |

## Deploy
- Build: `node tools/build-elm-site.mjs <dir>` (`pnpm build`/`pnpm dev` are broken Vite leftovers).
- **Only `./deploy.sh` writes `out/`** (nginx). Never point tests/builds at `out/`.
- After a deploy: `node tools/verify-live-shell.mjs https://eshmaki.me` (one precache mismatch strands returning visitors).

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
