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
./deploy.sh
```

nginx serves **`out/`** directly at eshmaki.me. `pnpm build` targets **`dist/`**
(`vite.config.ts:13`), *not* `out/` — so a plain build (or a test run) can never
half-replace production. **`deploy.sh` is the only writer of `out/`.** The script
(`deploy.sh`):

1. runs `pnpm build` → `dist/`
2. materialises SPA route entrypoints with route-specific canonical, Open Graph,
   title, and description metadata via `tools/materialize-route-entrypoints.mjs`
   so hard loads do not 404 and unfurlers do not mistake them for `/` — keep its
   `ROUTE_ENTRYPOINTS` list in sync with the `<Route>` table in `src/index.tsx`
3. stamps the service-worker cache name (`onyx-shell-<version>`) into `dist/sw.js`
   so already-cached clients pick up the new build
4. overlays the community site from `/home/kain/landing`, then
   `rsync -a --delete dist/ → out/`
