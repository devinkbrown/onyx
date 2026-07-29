# Onyx

Onyx is the network people join — the consumer-facing brand — delivered as a
SolidJS web client: text chat plus realtime voice/video (**Cadence** media —
CadenceVox/CadenceVis) over IRC/IRCX with WebSocket transport. Under the hood it
runs on **Onyx Server**, the pure-Zig mesh IRC daemon (self-host your own node).
Live at https://eshmaki.me.

**Status: pre-release / internal.** Client source is **not** a published open-source
product — keep it local. See [`NOTICE.md`](NOTICE.md).

**Licensing posture:** **Onyx client** = proprietary sauce (never marketed as FOSS).
**Onyx Server** = AGPL open engine. Public **network** is open to join; wire is open protocol.

## Documentation

Start at the hub: [`docs/README.md`](docs/README.md). Brand language:
**Onyx** = network / first-party client (sauce); **Onyx Server** = pure-Zig open engine.

| Doc | Audience |
|-----|----------|
| [`docs/architecture.md`](docs/architecture.md) | contributor — `src/` map |
| [`docs/features.md`](docs/features.md) | end-user — passkeys & Home catch-up |
| [`docs/search-and-history.md`](docs/search-and-history.md) | end-user — vault & search |
| [`docs/importing.md`](docs/importing.md) | end-user — Discord/Slack/IRC import |
| [`ONYX_SERVER_PROTOCOL.md`](ONYX_SERVER_PROTOCOL.md) | integrator — Onyx Server wire surface |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | contributor — setup, gates, deploy |

## Stack

- [SolidJS](https://www.solidjs.com/) 1.9 + `@solidjs/router` (SPA)
- Zustand (vanilla store + a `useStore` Solid bridge)
- Tailwind 4 (via `@tailwindcss/vite`) + hand-rolled design tokens
- Vite 7, TypeScript, Vitest (unit) + Playwright (e2e)
- **pnpm only** — never npm

## Commands

```bash
pnpm dev           # Vite dev server (port 3000)
pnpm build         # production build → dist/ (NOT out/; see Deploy)
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm test          # vitest unit tests (co-located *.test.ts[x])
pnpm test:e2e      # playwright (tests/e2e)
```

## Environment

Vite exposes only `VITE_*` variables; see `.env.example` for full docs.

| Variable | Purpose |
|----------|---------|
| `VITE_IRC_WS` | Pin the Onyx Server WebSocket endpoint. Unset = auto nearest-node selection (`src/app/nodes.ts`). |
| `VITE_DEFAULT_CHANNEL` | Reserved; not currently read. |
| `VITE_MEDIA_URL` | Upload base; the client POSTs multipart to `${VITE_MEDIA_URL}/upload`. Unset = same-origin `/upload` in prod builds. |

## Deploy

```bash
# Default: checkout-local out/ (safe for worktrees / dry practice)
./deploy.sh

# Production on this host (nginx root is /home/kain/onyx/out, not a worktree out/)
ONYX_LIVE_OUT=/home/kain/onyx/out ./deploy.sh

# Full build + stage + assertions, no live mutation
DEPLOY_DRY_RUN=1 ONYX_LIVE_OUT=/tmp/onyx-dry/out ./deploy.sh
```

nginx serves **`/home/kain/onyx/out`** at eshmaki.me. A worktree checkout such as
`/home/kain/onyx-public-launch` is **not** that tree — set **`ONYX_LIVE_OUT`** to
the absolute live `…/out` path when releasing. `pnpm build` targets **`dist/`**
(`vite.config.ts:13`), *not* `out/`, so a plain build (or a test run) can never
half-replace production. **`deploy.sh` is the only writer of the live out.**

The **Vite/Solid Landing** is authoritative for the public root and all SPA
routes. `/home/kain/landing` is legacy support only: deploy builds it and copies
**allowlisted** non-conflicting paths (`guides`, `community`, `install`,
`self-host`, `why`, `memory`, `onyxOS`, `fonts`). It never overlays root
documents (`index.html`, `robots.txt`, `sitemap.xml`, favicons) or SPA-owned
routes/assets/service worker.

`deploy.sh`:

1. resolves and validates `ONYX_LIVE_OUT` (when set: raw absolute only; basename
   `out`; not `/`, checkout root, `dist`, or a symlink; default `$checkout/out`)
   and prints the live target; `DEPLOY_DRY_RUN` must be exactly `0` or `1`
2. runs `pnpm build` → `dist/`
3. materialises SPA route entrypoints with route-specific canonical, Open Graph,
   title, and description metadata via `tools/materialize-route-entrypoints.mjs`
   so hard loads do not 404 and unfurlers do not mistake them for `/` — keep its
   `ROUTE_ENTRYPOINTS` list in sync with the `<Route>` table in `src/index.tsx`
4. stamps the service-worker cache name (`onyx-shell-<version>[-dirty]`) into
   `dist/sw.js` (dirty suffix when the working tree is uncommitted)
5. stages allowlisted legacy support from `/home/kain/landing` into `dist/`,
   with SPA-owned fingerprints taken before staging and verified after
6. unless `DEPLOY_DRY_RUN=1`: hard-link snapshot of an existing live out under a
   sibling `.onyx-deploy-backups/` **before** ACL or content mutation, then a
   two-phase live sync for **active-client compatibility**:
   - root: `rsync --archive --checksum --delete --exclude=/assets/ dist/ →`
     live out (never `--delete-excluded`)
   - assets: `mkdir` live `assets/` and `rsync --archive --checksum` (no
     `--delete`) `dist/assets/ →` live `assets/`, so prior immutable hashed
     chunks remain for tabs still on the previous build
   - post-sync: every current staged file must exist byte-identically in live
     (deterministic checksums); extra legacy files under live `assets/` are
     allowed; index title/metadata, `app/index.html`, `sw.js`, and the version
     stamp are still checked
   - safe asset GC/retention policy is **future, separately designed** work —
     this controller does not scan backups or auto-prune hashed assets
   - on rsync or verify failure: restore snapshot, prove restoration, emit
     `RECOVERY_EVIDENCE`, exit nonzero (fail closed if unproven)
