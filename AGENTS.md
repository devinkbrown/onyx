<!-- BEGIN:onyx-agent-rules -->
# Agent rules for Onyx

**Audience: coding agents.** Onyx is an **Elm 0.19.1** single-page IRC web client
for the **Onyx** network on the **Onyx Server** engine (not React, Next.js, Solid,
or any SSR framework — the SolidJS client that preceded it was removed and lives
only at the `solid-client-final` tag). Patterns from React/Solid training data
(hooks, signals, re-render mental models) do **not** apply: state is one Elm
model, `update` is pure, effects are data. Use English subsystem names
(Cadence media, Mooring client crypto) — not retired Japanese prose names.
New code uses English identifiers. Offline memos are `MEMO` only. Wire media
codecs are `cadencevox` / `cadencevis`. Historical crypto envelope bytes
`TSUMUGI1 ` may still open in `elm/engine/lib/e2ee/dmCipher.ts` and the Elm
`DmCipher` (legacy open-path only — not a command); inbound media may
dual-accept historical `TSUMUGI_*` subtypes.

Before writing code, read [`CLAUDE.md`](CLAUDE.md) (working context: layout,
persistence conventions, IRC↔Onyx mapping) and
[`docs/architecture.md`](docs/architecture.md) (the source map). Docs hub:
[`docs/README.md`](docs/README.md). Toolchain, gates and layout of the client:
[`elm/README.md`](elm/README.md). For contributor setup, gates, and the
deploy-safety rule see [`CONTRIBUTING.md`](CONTRIBUTING.md). Brand: **Onyx** =
network/product/client; **Onyx Server** = engine (not "Onyx" in public docs).

## Stack (verified against `elm/elm.json`, `package.json`, `tsconfig.json`)

- **Elm 0.19.1** — `elm/src` (`Main.elm` entry, `App.elm` model/update, feature
  modules, `View/*`). No SSR, no CSS framework (hand-rolled CSS in `elm/app.css`
  and `elm/css/`).
- **JS ports** — `elm/ports.js` (WebSocket, IndexedDB vault, WebCrypto, WebAuthn,
  uploads, notifications, service worker) and `elm/historyImport.js`.
- **TypeScript engine** bundled by esbuild — `elm/engine` (Cadence media engine,
  E2EE device keys / DM envelopes / key pins, IRC parser, canvas backgrounds) with
  entries in `elm/media`. Strict TS with `noUncheckedIndexedAccess` (`tsconfig.json`);
  `@/` is `elm/engine/`.
- **pnpm only**, never npm. `pnpm build` = Elm build + `tools/build-site.mjs`.
- **IndexedDB history vault** — `onyx-vault`, `VAULT_KEEP = 400` per target.

## Conventions

- Effects are data (`List Outbound`); only `Main.elm` talks to ports. Pure
  protocol folds live in their own modules with elm-test vectors; changes to
  `ports.js` need a smoke test (`elm/*.smoke.mjs`).
- Add feature code as its own module, wired into `App.elm` through a
  `-- v3/<slice>` block and the `settleSteps` list.
- `localStorage` keys use the `onyx:` prefix. IRCX METADATA/PROP keys prefixed
  `ocean.` (e.g. `ocean.display-name`, `ocean.watch`) are **wire format** —
  server-persisted; never rename them.
- Gates before finishing: `elm make` + `elm-test`, `pnpm test:smoke`,
  `pnpm typecheck`, `pnpm lint`, `pnpm test` (see `CONTRIBUTING.md`).
- **Only `deploy.sh` writes `out/`.** `pnpm build` emits `dist/`. Never point a
  build or test at `out/`.

## Agent roster (AI routing)

Full map: [`.agents/ROSTER.md`](.agents/ROSTER.md).  
Shared bar/gates/security sinks: skill **`onyx-agent-core`**.  
Verification: skill **`onyx-client-verification`**.

| Need | Agent |
|------|-------|
| General implement / review | project `onyx-coder-leaf` |
| Trace before code | `onyx-explorer` |
| Blueprint | `onyx-spec-architect` |
| Adversarial review | `onyx-adversarial-reviewer` |
| Security sinks | `onyx-security-boundary-reviewer` (+ `onyx-render` / `onyx-crypto`) |
| IRC wire | `onyx-irc` |
| Elm model/`update` fold-back | `onyx-store` |
| Vault / outbox | `onyx-vault` |
| Media | `onyx-media` |
| a11y | `onyx-a11y` / `onyx-a11y-browser-auditor` |
| Real-browser flows (`elm/tools/screens*.mjs`) | `onyx-e2e` |
| Daemon work | **not here** → `/home/kain/onyx-server` roster |

Roadmap slices: skill `onyx-roadmap-execution`. Cross-model: `cross-model-handoff`.
<!-- END:onyx-agent-rules -->
