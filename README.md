# Onyx

Onyx is a SolidJS web client for the IRCXNet/Orochi network — text chat plus
realtime voice/video (Suimyaku media engine) over IRC/IRCX with WebSocket
transport. Live at https://eshmaki.me.

**Status: pre-release / internal.** Not published; keep it local for now.

## Stack

- [SolidJS](https://www.solidjs.com/) 1.9 + `@solidjs/router` (SPA)
- Zustand (vanilla store + a `useStore` Solid bridge)
- Tailwind 4 (via `@tailwindcss/vite`) + hand-rolled design tokens
- Vite 7, TypeScript, Vitest (unit) + Playwright (e2e)
- **pnpm only** — never npm

## Commands

```bash
pnpm dev           # Vite dev server
pnpm build         # production build → out/
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm test          # vitest unit tests (co-located *.test.ts[x])
pnpm test:e2e      # playwright (tests/e2e)
```

## Environment

Vite exposes only `VITE_*` variables; see `.env.example` for full docs.

| Variable | Purpose |
|----------|---------|
| `VITE_IRC_WS` | Pin the Orochi WebSocket endpoint. Unset = auto nearest-node selection (`src/app/nodes.ts`). |
| `VITE_DEFAULT_CHANNEL` | Reserved; not currently read. |
| `VITE_MEDIA_URL` | Upload base; the client POSTs multipart to `${VITE_MEDIA_URL}/upload`. Unset = same-origin `/upload` in prod builds. |

## Deploy

```bash
./deploy.sh
```

nginx serves `out/` directly at eshmaki.me, so building **is** deploying.
The script:

1. runs `pnpm build` → `out/`
2. materialises SPA route entrypoints (`out/app|about|appearance/index.html`
   copies) so hard loads of client routes don't 404 — keep that list in sync
   with the `<Route>` table in `src/index.tsx`
3. stamps the service-worker cache name (`onyx-shell-<version>`) into
   `out/sw.js` so already-cached clients pick up the new build
