# Contributing to Onyx

**Audience: contributor.** How to set up, test, gate, and safely deploy the Onyx
web client. Onyx is an **Elm** single-page app with a small JavaScript/TypeScript
port layer — see the docs hub ([`docs/README.md`](docs/README.md)),
[`docs/architecture.md`](docs/architecture.md) for the source map,
[`elm/README.md`](elm/README.md) for the toolchain bootstrap, and
[`CLAUDE.md`](CLAUDE.md) for working conventions. (The SolidJS client this
replaced was removed; it is recoverable at the `solid-client-final` tag.)

## Prerequisites

- **pnpm only — never npm or yarn.** The lockfile is `pnpm-lock.yaml` and this is
  a pnpm workspace (`pnpm-workspace.yaml`). Mixing package managers corrupts the
  install.
- Node 20+ (`@types/node` is pinned to `^20`).
- The **Elm 0.19.1** compiler on `PATH` (and `elm-test` for the Elm suite). The
  sandbox-friendly bootstrap is in [`elm/README.md`](elm/README.md).

```bash
pnpm install
export PATH=/tmp:$PATH ELM_HOME=/tmp/elmhome   # wherever your elm binary / package cache live
pnpm dev          # builds the Elm client + site, serves dist/ on http://127.0.0.1:3000
```

## Scripts (`package.json`)

| Command | What it does |
|---|---|
| `pnpm dev` | `pnpm build`, then serve `dist/` on port 3000 (`tools/serve.mjs`). |
| `pnpm build` | `elm/tools/build.sh` → `elm/dist-elm/`, then `tools/build-site.mjs` → **`dist/`** (never `out/`). |
| `pnpm preview` | Serve the existing `dist/` (no rebuild). |
| `pnpm typecheck` | `tsc -p tsconfig.json --noEmit` over `elm/engine` + `elm/media`. |
| `pnpm lint` | ESLint (`eslint --cache`) over `elm/*.js`, the smoke suites, and the TypeScript engine. |
| `pnpm test` | Vitest: the `elm/engine` suites, `tools/` tests and the static-site contract tests. |
| `pnpm test:smoke` | Every `elm/*.smoke.mjs` suite (jsdom over the real bundle and `ports.js`). |
| `pnpm test:deploy` | `tools/deploy-controller.test.sh` — deploy.sh path validation, rollback and allowlist safety. |
| `pnpm test:watch` / `test:coverage` | Vitest watch / V8 coverage. |
| `pnpm site:check` | Safe website gate: typecheck, lint, tests, then build to `dist/`. |
| `pnpm site:workbench` | Interactive local menu for build/serve, safe gates and preview. Never writes `out/`. |

## Quality gates (run before you finish)

```bash
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)   # Elm compiles + vectors pass
pnpm test:smoke
pnpm typecheck
pnpm lint
pnpm test
node elm/tools/css-coverage.mjs      # 0 unstyled classes, 0 undefined CSS variables
```

UI changes also need real-browser evidence: `node elm/tools/screens.mjs --vp all`
(see [`elm/README.md`](elm/README.md)). TypeScript is **strict**, and
`noUncheckedIndexedAccess` is on (`tsconfig.json`) — indexed access yields
`T | undefined`, so handle the `undefined` case rather than asserting it away.

## Tests

- **Elm (`elm/tests/`, elm-test + elm-program-test):** vectors for every protocol
  fold, parser and view contract; new behaviour gets a vector first.
- **Smoke (`elm/*.smoke.mjs`):** jsdom suites over the real `ports.js` and the
  built bundle, with stubbed WebSocket/IndexedDB. Every change to `ports.js`
  needs one.
- **Unit (Vitest):** co-located `*.test.ts` next to the engine sources in
  `elm/engine/` (setup in `vitest.setup.ts`, IndexedDB faked with
  `fake-indexeddb`), plus `tools/**/*.test.{mjs,ts}` for the site generator, the
  service worker contract and the release tooling.
- **Screens (`elm/tools/screens*.mjs`):** headless Chromium against a fake local
  IRC server — never the live network. Connected checks against production are
  not part of the gates.

## Elm conventions

- Effects are data: `update` returns state plus `List Outbound`; only `Main.elm`
  talks to ports. Pure protocol folds live in their own modules with vectors.
- New feature code goes in its own module, wired into `App.elm` through a
  `-- v3/<slice>` block and the `settleSteps` list; keep `App.elm` edits minimal.
- Security-sensitive paths (auth, crypto, storage, uploads) fail closed, never log
  secrets and never put secrets in URLs.
- CSS: tokens live in `elm/app.css`; the `<link>` order in `elm/index.html` is the
  cascade order; run the CSS gates in `elm/README.md` after touching a stylesheet.

## Persistence & wire-key contract

- `localStorage` keys use the `onyx:` prefix. Legacy `ocean-*` keys are migrated
  (copied, never deleted) by `migrateLegacyStorage` at the top of `elm/ports.js`,
  which runs when the script loads — keep it ahead of anything that reads flags.
- IRCX METADATA/PROP keys prefixed `ocean.` (e.g. `ocean.display-name`,
  `ocean.accent`, `ocean.links`, `ocean.watch`) are **wire format** —
  server-persisted and shared with other clients. Never rename them.

## Deploy safety — the `dist/` vs live-`out` invariant

**Only `deploy.sh` writes `out/`.** nginx serves this checkout's `out/` tree
directly at eshmaki.me, so `out/` *is* production. To keep a plain build, a test run, or a
screenshot server from ever wiping or half-replacing the live site, `pnpm build`
writes only `dist/` (`tools/build-site.mjs` refuses any `out` directory), and
`deploy.sh` is the single path that syncs `dist/ → out/`. There is one client and
one build path: `deploy.sh` has no client switch.

The generated **Elm documents** (root, every route, the flat 404) are authoritative
for the public root and all SPA routes. `/home/kain/landing` is **legacy support
only**: deploy builds it and stages **allowlisted** non-conflicting paths
(`self-host`, `why`, `memory`, `onyxOS`, `fonts`). `/guides/` and `/community/` are
SPA Getting started how-tos. It never overlays root documents (`index.html`,
`robots.txt`, `sitemap.xml`, favicons) or SPA-owned routes/assets/service worker.
SPA-owned content is fingerprinted before staging and re-verified afterward.

`./deploy.sh` (or `DEPLOY_DRY_RUN=1 …` for build/stage/assert only — no live
mutation; `DEPLOY_DRY_RUN` must be exactly `0` or `1`):

1. Resolves and validates `ONYX_LIVE_OUT` (absolute, basename `out`, not `/`,
   not the checkout root, not `dist`, not a symlink).
2. `pnpm build` → `dist/` (aborts unless the root document boots the Elm client and
   `dist/sw.js`, `dist/app/index.html`, `dist/download/index.html` and a flat
   `dist/404.html` exist, and no document loads a legacy `/assets/index-*` bundle).
   `tools/build-site.mjs` writes route-correct canonical, Open Graph, title and
   description metadata so hard loads do not 404 and pre-hydration crawlers see
   the right page. **Keep `ROUTE_ENTRYPOINTS` in `tools/site/routes.mjs` in sync
   with the parser in `elm/src/Route.elm`** (a test fails when they drift).
3. Stamps the service-worker cache name (`onyx-shell-<version>`) into `dist/sw.js`.
4. Overlays the separately managed community-site build configured on the
   first-party host.
5. Hard-link snapshot of the current live tree, `rsync` into `out/` (`--delete`
   except `assets/`, which keeps earlier hashed files), post-sync verification,
   and automatic proven rollback on failure.

Controller unit tests: `pnpm test:deploy` (never mutates `/home/kain/onyx/out`).

Never point a build, test, or script at the live `out/` yourself.

## Interactive website workbench

Use `pnpm site:workbench` for an operator-facing local loop. It offers only
safe actions: build and serve, run the full `site:check` gate, or preview the
current `dist/` build. It intentionally has no deploy action: `./deploy.sh`
remains an explicit, separately reviewed operator decision and the sole writer of
the nginx-served `out/` tree.

## Public repository conventions

The brand is **Onyx** (formerly
Ocean, briefly Ruri — both are dead names; do not reintroduce them except as the
documented `ocean.*` wire keys and legacy `ocean-*` migration shims). The client
source is public under AGPL-3.0-or-later. Do not commit credentials, private
deployment output, generated `out/`, or machine-specific secrets.

Keep pull requests focused and explain the observable behavior they change.
Include tests for store, protocol, vault, crypto, or accessibility behavior and
update the relevant guide when a user-visible contract changes. The code of
conduct is [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md); security reports belong
in [`SECURITY.md`](SECURITY.md), not in a public issue.
