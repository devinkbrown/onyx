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
| `pnpm site:check` | Safe website gate: typecheck, lint, tests, then build to `dist/`. |
| `pnpm site:workbench` | Interactive local menu for dev, safe gates, preview, and deploy-plan inspection. Never writes `out/`. |

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

## Deploy safety — the `dist/` vs `out/` invariant

**Only `deploy.sh` writes `out/`.** nginx serves this checkout's `out/` tree
directly at eshmaki.me, so `out/` *is* production. To keep a plain build, a test run, or a
Playwright web server from ever wiping or half-replacing the live site, Vite
builds to `dist/` (`vite.config.ts`), and `deploy.sh` is the single path that
syncs `dist/ → out/`.

`./deploy.sh`:

1. `pnpm build` → `dist/` (aborts if `dist/index.html` or `dist/sw.js` is missing).
2. Materialises SPA route entrypoints with route-correct canonical, Open Graph,
   title, and description metadata so hard loads do not 404 and pre-hydration
   crawlers see the right page. **Keep `ROUTE_ENTRYPOINTS` in
   `tools/materialize-route-entrypoints.mjs` in sync with the `<Route>` table in
   `src/index.tsx`.**
3. Stamps the service-worker cache name (`onyx-shell-<version>`) into `dist/sw.js`.
4. Overlays the separately managed community-site build configured on the
   first-party host.
5. `rsync -a --delete dist/ out/`.

Never point a build, test, or script at `out/` yourself.

## Interactive website workbench

Use `pnpm site:workbench` for an operator-facing local loop. It offers only
safe actions: start Vite, run the full `site:check` gate, preview the current
`dist/` build, or inspect the deployment boundary. It intentionally has no
deploy action: `./deploy.sh` remains an explicit, separately reviewed operator
decision and the sole writer of the nginx-served `out/` tree.

## Public repository conventions

Active development is on the `onyx-solid` branch. The brand is **Onyx** (formerly
Ocean, briefly Ruri — both are dead names; do not reintroduce them except as the
documented `ocean.*` wire keys and legacy `ocean-*` migration shims). The client
source is public under AGPL-3.0-or-later. Do not commit credentials, private
deployment output, generated `out/`, or machine-specific secrets.

Keep pull requests focused and explain the observable behavior they change.
Include tests for store, protocol, vault, crypto, or accessibility behavior and
update the relevant guide when a user-visible contract changes. The code of
conduct is [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md); security reports belong
in [`SECURITY.md`](SECURITY.md), not in a public issue.
