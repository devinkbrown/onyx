# Onyx — IRC webchat (SolidJS)

Modern web client for the IRCXNet/Orochi network (Orochi is the pure-Zig IRC
daemon at /home/kain/orochi). Pre-release/internal; branch `onyx-solid`.
The brand is **Onyx** (formerly Ocean, briefly Ruri — both dead names).

## Stack
- **SolidJS 1.9** + `@solidjs/router` — SPA, no SSR
- **Vite 7** (`pnpm build` → static export in `out/`)
- **Zustand vanilla** store + `useStore` Solid bridge (`src/lib/store/`)
- **Tailwind 4** + hand-rolled CSS tokens; **TypeScript**
- **pnpm always, never npm**

## Layout
- Entry: `src/index.tsx` — routes `/` (Landing), `/about`, `/app` (AppShell),
  `/appearance`. Route list MUST stay in sync with deploy.sh's SPA
  entrypoint list (`for route in app about appearance`).
  First import is `src/lib/migrateStorage.ts` (legacy `ocean-*` →
  `onyx:*` localStorage migration, runs as an import side effect) — keep it first.
- IRC layer: `src/lib/irc/` — `client.ts` (WS client, SASL PLAIN/SCRAM,
  CAP/IRCv3, IRCX), `parser.ts`, `types.ts`
- Store: `src/lib/store/store.ts` — single Zustand vanilla store; most UI
  prefs persist to localStorage under the `onyx:` prefix
- Node selection: `src/app/nodes.ts` — probes mesh nodes, attaches to the
  fastest; `VITE_IRC_WS` pins an endpoint and disables probing
- Theming: `src/theme/` — `ThemeProvider.tsx`, `themes.ts` (14 built-in
  themes, `DEFAULT_THEME_ID = 'ocean'` — a THEME name, not the brand),
  `ThemeStudio.tsx`, `customThemes.ts`
- Tokens: `src/styles/tokens.css` (+ `global.css`)
- Primitives: `src/primitives/` — reusable UI building blocks
- Media engine: `src/lib/suimyaku-media/` — Orochi voice/video
  (TsumugiSession ECDH/AES-GCM, MediaEngine, TsumugiGroup, ChunkAssembler,
  PeerRegistry). Default transport: kagura frames over WS; WebRTC is opt-in.
  Signaling = `MEDIA` subcommands + `NOTE MEDIA` events.
- Backgrounds: `src/backgrounds/` — animated canvas scenes
- Uploads: `src/lib/upload/` — multipart POST (field `file`) to
  `${VITE_MEDIA_URL}/upload`; prod default is same-origin `/upload`

## Persistence conventions
- localStorage keys: `onyx:` prefix. Legacy `ocean-*` keys are migrated
  (copied, never deleted) by `src/lib/migrateStorage.ts`; `ruri:` shims in
  ThemeProvider/preferences/etc. stay as read-old-write-new fallbacks.
- IRCX METADATA keys `ocean.display-name` / `ocean.accent` / `ocean.links`
  are WIRE FORMAT (server-persisted) — never rename them.

## Env (Vite exposes only `VITE_*`)
- `VITE_IRC_WS` — pin the Orochi WS endpoint (unset = auto node selection)
- `VITE_DEFAULT_CHANNEL` — reserved, not currently read
- `VITE_MEDIA_URL` — upload base (unset = `/upload` in prod builds)

## Tests
- Unit: Vitest, co-located `*.test.ts(x)` next to sources (`pnpm test`)
- E2E: Playwright in `tests/e2e/` (`pnpm test:e2e`); connected e2e must hit
  the live origin (WS is origin-sensitive); `tests/_legacy-ocean-e2e/` is dead
- `pnpm typecheck` and `pnpm lint` must pass before finishing

## Build & deploy
```bash
pnpm dev        # dev server
pnpm build      # → out/
./deploy.sh     # build + materialise /app /about /appearance route copies
                # + stamp sw cache 'onyx-shell-<version>' (nginx serves out/)
```
nginx serves `out/` at eshmaki.me — building via deploy.sh IS deploying.

## IRC → Onyx concept mapping
| IRC | Onyx |
|-----|------|
| #channel | Text channel |
| Private message | DM |
| +q / +o / +v | Owner / Op / Voice roles |
| Orochi account (built-in services) | Onyx account |
| CHATHISTORY | Message history |
| IRCX PROP / ACCESS / METADATA | Channel & profile properties |
| MEDIA subcommands + NOTE MEDIA | Voice/video channel |

## Services (Orochi built-in — NO NickServ pseudo-clients)
Real server commands with structured replies (NOTE/FAIL/WARN): `REGISTER`,
`VERIFY`, `IDENTIFY`, `LOGOUT`, `DROP`, `ACCOUNTINFO`, `ACCOUNTSET`,
`GHOST`, `CERTADD`/`CERTLIST`/`CERTDEL`. Session resume: after SASL the
server issues `NOTE SESSION TOKEN`/`MTOKEN`; reconnect with `SESSION RESUME`.
