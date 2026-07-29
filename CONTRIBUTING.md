# Contributing to Onyx

**Audience: contributor.** How to set up, test, gate, and safely deploy the Onyx
client. Onyx is a **SolidJS 1.9 + Vite 7** SPA — see the docs hub
([`docs/README.md`](docs/README.md)), [`docs/architecture.md`](docs/architecture.md)
for the `src/` map, and [`CLAUDE.md`](CLAUDE.md) for working conventions.

## Prerequisites

- **pnpm only — never npm or yarn.** The lockfile is `pnpm-lock.yaml` and this is
  a pnpm workspace (`pnpm-workspace.yaml`). Mixing package managers corrupts the
  install.
- Node 20+ (`@types/node` is pinned to `^20`).

```bash
pnpm install
pnpm dev          # Vite dev server on http://localhost:3000
```

## Scripts (`package.json`)

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server (port 3000, host exposed). |
| `pnpm build` | Production build → **`dist/`** (never `out/`). |
| `pnpm preview` | Serve the built `dist/` locally (port 4173). |
| `pnpm typecheck` | `tsc -p tsconfig.json --noEmit`. |
| `pnpm lint` | ESLint (`eslint --cache`). |
| `pnpm test` | Vitest unit run (co-located `*.test.ts[x]`). |
| `pnpm test:watch` | Vitest in watch mode. |
| `pnpm test:coverage` | Vitest with V8 coverage. |
| `pnpm test:e2e` | Playwright e2e (`tests/e2e`). |

## Quality gates (run before you finish)

All three must pass:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

TypeScript is **strict**, and `noUncheckedIndexedAccess` is on
(`tsconfig.json`) — indexed access yields `T | undefined`, so handle the
`undefined` case rather than asserting it away.

## Tests

- **Unit (Vitest + `@solidjs/testing-library`):** co-located next to sources as
  `*.test.ts` / `*.test.tsx` (e.g. `src/lib/store/store.channel.test.ts`). Setup
  is `vitest.setup.ts`; IndexedDB is faked with `fake-indexeddb`. Write tests
  first for new store slices, vault bounds, IRC parsing, and theme/contrast math.
- **E2E (Playwright, `tests/e2e/`):** critical user flows. Connected e2e must hit
  the **live origin** because the WebSocket transport is origin-sensitive; the
  DEV-only `window.__onyx` store handle is available for harness assertions.
  `tests/_legacy-ocean-e2e/` is dead — do not extend it.

## SolidJS conventions

- Read store state in components via `useStore(s => …)` (reactive). `getState()`
  is a non-reactive snapshot — do not use it for values a component must react to.
- Mutate state only through immutable `set()` store actions; dispatch server
  commands with `get().client?.sendRaw(...)` and fold replies back through the
  message handler.
- Do not destructure props, and do not read signals in the component body where
  reactivity is expected — read them in JSX or inside `createMemo`/effects.

## Persistence & wire-key contract

- `localStorage` keys use the `onyx:` prefix. Legacy `ocean-*` keys are migrated
  (copied, never deleted) by `src/lib/migrateStorage.ts`, which **must stay the
  first import** in `src/index.tsx`.
- IRCX METADATA/PROP keys prefixed `ocean.` (e.g. `ocean.display-name`,
  `ocean.accent`, `ocean.links`, `ocean.watch`) are **wire format** —
  server-persisted and shared with other clients. Never rename them.

## Deploy safety — the `dist/` vs live-`out` invariant

**Only `deploy.sh` writes the live `out` tree.** nginx serves
`/home/kain/onyx/out` at eshmaki.me. A worktree checkout (for example
`/home/kain/onyx-public-launch`) is **not** that tree: set
`ONYX_LIVE_OUT=/home/kain/onyx/out` for a production release. When supplied,
`ONYX_LIVE_OUT` must already be an absolute path whose basename is `out` (raw
relative paths are rejected; the target must not itself be a symlink). The
default is the checkout-local `$checkout/out`.

Vite builds to `dist/` (`vite.config.ts`) so a plain build, test run, or
Playwright web server can never wipe or half-replace production. **`deploy.sh`
is the only writer of the live out.**

The **Vite/Solid Landing** is authoritative for the public root and all SPA
routes. `/home/kain/landing` is **legacy support only**: deploy builds it and
stages **allowlisted** non-conflicting paths (`guides`, `community`, `install`,
`self-host`, `why`, `memory`, `onyxOS`, `fonts`). It never overlays root
documents (`index.html`, `robots.txt`, `sitemap.xml`, favicons) or SPA-owned
routes/assets/service worker. SPA-owned content is fingerprinted before staging
and re-verified afterward.

`./deploy.sh` (or `DEPLOY_DRY_RUN=1 …` for build/stage/assert only — no live
mutation; `DEPLOY_DRY_RUN` must be exactly `0` or `1`):

1. Resolves and validates `ONYX_LIVE_OUT` (absolute, basename `out`, not `/`,
   not the checkout root, not `dist`, not a symlink).
2. `pnpm build` → `dist/` (aborts if `dist/index.html` or `dist/sw.js` is missing).
3. Materialises SPA route entrypoints with route-correct canonical, Open Graph,
   title, and description metadata so hard loads do not 404 and pre-hydration
   crawlers see the right page. **Keep `ROUTE_ENTRYPOINTS` in
   `tools/materialize-route-entrypoints.mjs` in sync with the `<Route>` table in
   `src/index.tsx`.**
4. Stamps the service-worker cache name (`onyx-shell-<version>[-dirty]`) into
   `dist/sw.js`.
5. Stages allowlisted legacy support from `/home/kain/landing` into `dist/`,
   then asserts SPA-owned fingerprints are unchanged.
6. Unless `DEPLOY_DRY_RUN=1`: hard-link snapshot of any existing live out under a
   sibling `.onyx-deploy-backups/` **before** ACL or content mutation, then
   two-phase live sync for **active-client compatibility**:
   - root: `rsync --archive --checksum --delete --exclude=/assets/ dist/ →
     $ONYX_LIVE_OUT` (never `--delete-excluded`)
   - assets: create live `assets/` and `rsync --archive --checksum` **without**
     `--delete` so prior immutable hashed assets stay available to clients
     still on the previous shell
   - verify every current staged file exists byte-identically in live
     (deterministic checksums), allowing extra legacy files only under live
     `assets/`; also check index title/metadata, `app/index.html`, `sw.js`, and
     the version stamp
   - automatic hashed-asset GC/retention is **not** implemented here — that is
     future, separately designed policy (no backup scanning or pruning in
     deploy)
   - on rsync or post-sync verification failure the controller restores the
     snapshot, proves restoration, emits `RECOVERY_EVIDENCE`, and exits nonzero
     (fail closed if rollback cannot be proven).

Controller unit tests: `bash tools/deploy-controller.test.sh` (never mutates
`/home/kain/onyx/out`).

Never point a build, test, or script at the live `out/` yourself.

## Branch conventions

Active development is on the `onyx-solid` branch. The brand is **Onyx** (formerly
Ocean, briefly Ruri — both are dead names; do not reintroduce them except as the
documented `ocean.*` wire keys and legacy `ocean-*` migration shims). This
project is pre-release / internal — keep it local; do not publish.
