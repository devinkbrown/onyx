# Contributing to Onyx

**Audience: contributors.** How to set up, test, and safely ship the Onyx web
client. Onyx is an Elm app with a private TypeScript runtime and a JavaScript
port bridge. Start with [`README.md`](README.md), then
[`docs/architecture.md`](docs/architecture.md) and [`CLAUDE.md`](CLAUDE.md).
The default branch is `onyx-elm`.

## Prerequisites

- **pnpm only, never npm or yarn.** The lockfile is `pnpm-lock.yaml`.
- Node.js 20+.
- Elm 0.19.1 and elm-test 0.19.1-revision17, installed outside the app's
  dependency graph. See [`elm/README.md`](elm/README.md#toolchain).
- Chromium for Playwright (`ONYX_CHROMIUM_EXECUTABLE`, default `/usr/bin/chromium`).

```bash
pnpm install
node tools/build-elm-site.mjs /tmp/onyx-site
node tools/serve-dir.mjs /tmp/onyx-site 8080     # http://127.0.0.1:8080/app/
```

## Scripts that work

| Command | What it does |
| --- | --- |
| `node tools/build-elm-site.mjs <dir>` | Elm `--optimize` build, runtime bundle, CSS, service worker envelope and route documents into `<dir>`. |
| `node tools/serve-dir.mjs <dir> <port>` | Static server with SPA fallback for a staged build. |
| `pnpm typecheck` | `tsc` over the shared `src/` modules. |
| `pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit` | Strict typecheck of the private runtime. |
| `pnpm lint` | ESLint. |
| `pnpm test` | Root Vitest (`src/**`, `tools/**`). |
| `pnpm test:elm-runtime` | Runtime Vitest (`elm/vitest.runtime.config.ts`). |
| `pnpm test:e2e:elm` | Playwright mock-socket suite on Chromium (builds into `/tmp/onyx-elm-e2e`). |
| `pnpm test:e2e:elm:audit` | 628-check UI audit across six Chromium projects (optional Firefox). |
| `pnpm check:server-contract` / `check:server-contract-v2` | Compare client contract JSON with a sibling `../onyx-server` checkout. |
| `pnpm desktop:*` | Native desktop host; see [`docs/desktop-host.md`](docs/desktop-host.md). |

`pnpm build` (clean `dist/` + Elm site build), `pnpm preview` (serve `dist/` on
:4173), `pnpm dev` (build + serve on :3000) and `pnpm test:e2e` (the Elm
Chromium suite) all target the Elm client.

## Gates (run before you finish)

```bash
pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit
pnpm typecheck
pnpm lint
pnpm test:elm-runtime
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
node --test elm/*.smoke.mjs
pnpm test:e2e:elm
```

Also run, when relevant:

- UI changes: `pnpm test:e2e:elm:audit`, and screenshots with
  `node elm/tools/screens.mjs --site /tmp/onyx-site`.
- `deploy.sh` changes: `bash tools/deploy-controller.test.sh`.
- Shared `src/` changes: `pnpm test`.
- Protocol, session, history or crypto changes: the matching local-server lab
  (see [`docs/testing-and-release.md`](docs/testing-and-release.md)).

## Tests

- **Elm (`elm/tests/`):** vectors for every protocol fold, parser and view
  contract. New behaviour gets a vector first.
- **Smokes (`elm/*.smoke.mjs`):** `node:test` suites that load the real
  `ports.js` with stubbed browser APIs. Every `ports.js` change needs one.
- **Runtime (`elm/runtime/*.test.ts`):** Vitest node, DOM and worker projects
  with fake IndexedDB and WebCrypto.
- **Playwright (`tests/e2e/`):** the mock suite and audit answer the page's
  WebSocket with `page.routeWebSocket`. Nothing reaches the live network.
- **Labs (`elm/tools/lab/`):** a real local Onyx Server binary. Never test
  against production servers.

## Conventions

- Effects are data: `update` returns state plus outbound effects; only
  `Main.elm` talks to ports. Pure logic gets its own module.
- Secrets (passwords, tokens, keys, decrypted private payloads) stay in
  `elm/runtime`. Elm sees UI-safe projections only.
- Wire text is untrusted: render text nodes, never `innerHTML`; bound every
  parse; fail closed on crypto and auth.
- CSS: tokens and the base layer live in `elm/app.css`; `<link>` order in
  `elm/index.html` is the cascade order.
- Use English subsystem names; `TSUMUGI*` bytes are legacy interop literals.

## Persistence and wire keys

- localStorage keys use the `onyx:` prefix.
- IRCX METADATA/PROP keys prefixed `ocean.` (`ocean.display-name`,
  `ocean.accent`, `ocean.links`, …) are **wire format**, server-persisted and
  shared with other clients. Never rename them.

## Deploy safety

**Only `deploy.sh` writes `out/`.** nginx serves `out/` at eshmaki.me, so `out/`
is production. Builds and tests write to `dist/` or `/tmp`.

`./deploy.sh` (or `DEPLOY_DRY_RUN=1 ./deploy.sh` to build and check only):

1. Validates `ONYX_LIVE_OUT` (absolute, basename `out`, not a symlink).
2. Builds the Elm site into `dist/` (`ONYX_CLIENT=elm` is the default; `solid`
   fails because its sources are gone) and checks `index.html`, `app.js`,
   `ports.js`, `sw.js`, route documents and a flat `404.html`.
3. Verifies the service-worker build envelope.
4. Stages allowlisted legacy support paths from the host's landing tree.
5. Hard-link backs up the live tree, rsyncs into `out/`, verifies, and restores
   the backup automatically on failure.

Then verify the live site:

```bash
node tools/verify-live-shell.mjs https://eshmaki.me
```

Keep `elm/src/Route.elm` and `ELM_ROUTE_ENTRYPOINTS` in
`tools/materialize-elm-routes.mjs` in sync.

## Pull requests

The brand is **Onyx** (Ocean and Ruri are dead names, except the `ocean.*` wire
keys). Don't commit credentials, `.env` files, deployment output or user data.
Keep pull requests focused, describe the observable behaviour, include tests,
and update the relevant guide when a user-visible contract changes. See
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md); report security issues through
[`SECURITY.md`](SECURITY.md).
