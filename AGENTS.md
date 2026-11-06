<!-- BEGIN:onyx-agent-rules -->
# Agent rules for Onyx

**Audience: coding agents.** Onyx is an **Elm 0.19.1** single-page IRC web client
for the **Onyx** network on the **Onyx Server** engine. It is not React, Next.js
or Solid; the SolidJS client was removed (tag `solid-client-final`). State is one
Elm model, `update` is pure, effects are data. Patterns from React/Solid
(hooks, signals, re-render mental models) do not apply.

Read [`CLAUDE.md`](CLAUDE.md) first: layout, runtime ownership, security
boundaries, persistence, brand and wire-literal rules, gates, labs and deploy.
Then [`docs/architecture.md`](docs/architecture.md) for the source map and
[`elm/README.md`](elm/README.md) for the toolchain. Default branch: `onyx-elm`.

## Stack (verified against `elm/elm.json`, `package.json`, `elm/runtime/tsconfig.json`)

- **Elm 0.19.1** in `elm/src`: `Main.elm` (ports), `App.elm` (model/update),
  focused pure modules, `View/*`. Hand-written CSS in `elm/app.css`,
  `rail.css`, `convo.css`, `site.css`.
- **Private TypeScript runtime** in `elm/runtime`, bundled by Vite into
  `runtime.js` by `tools/build-elm-site.mjs`. Owns the IRC socket, credentials,
  keys and owned IndexedDB stores. Strict TS (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`); `@/` resolves to `src/`.
- **Browser bridge** `elm/ports.js`: vault, prefs, uploads, notifications,
  crypto helpers, media socket.
- **Shared TS** in `src/lib` (Cadence media, E2EE, IRC parser) imported by the
  runtime only.
- **pnpm only**, never npm. Build: `node tools/build-elm-site.mjs <dir>`.
  `pnpm build` wraps it (clean `dist/`); `pnpm dev` builds and serves on :3000.

## Conventions

- Effects are data; only `Main.elm` talks to ports. New pure logic goes in its
  own module with elm-test vectors; keep `App.elm` edits surgical.
- Every `ports.js` change needs an `elm/*.smoke.mjs` test; every runtime change
  needs a Vitest case under `elm/runtime/`.
- Secrets never enter Elm. Untrusted wire text is rendered as text, never HTML.
  Encrypted paths fail closed.
- localStorage keys use `onyx:`. IRCX `ocean.*` METADATA/PROP keys are wire
  format; never rename them.
- Use English subsystem names (Cadence, Mooring, Event Spine). Historical
  `TSUMUGI*` bytes are interop literals only.
- **Only `deploy.sh` writes `out/`.** Never point a build or test at `out/`.

## Gates

```bash
pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit
pnpm typecheck && pnpm lint
pnpm test:elm-runtime
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
node --test elm/*.smoke.mjs
pnpm test:e2e:elm
pnpm test:e2e:elm:audit   # UI changes
```

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
| Real-browser flows (`elm/tools/screens.mjs`, Playwright audit) | `onyx-e2e` |
| Daemon work | **not here** → `/home/kain/onyx-server` roster |

Roadmap slices: skill `onyx-roadmap-execution`. Cross-model: `cross-model-handoff`.
<!-- END:onyx-agent-rules -->
