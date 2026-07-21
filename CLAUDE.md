# Onyx — IRC webchat (SolidJS)

Modern web client for the **Onyx** network, running on the **Onyx Server** engine
(pure-Zig mesh daemon; formerly called Onyx Server). Pre-release; branch `onyx-solid`.
The brand is **Onyx** (formerly Ocean, briefly Ruri — both dead names).
Branded house: **Onyx** = network/product/client; **Onyx Server** = engine/daemon/
protocol; "IRCXNet" = retired public identity, legacy/wire token only.
Wire/config leftovers: `onyx/*` caps/tags; DM envelopes prefer `ONYXDM1 ` and
dual-open legacy `TSUMUGI1 `; media E2EE outbound uses `E2EE-HANDSHAKE` /
`E2EE-GROUPKEY` and dual-accepts historical `TSUMUGI_*` subtypes; offline memos
prefer `MEMO` and dual-accept `TEGAMI`. Those historical tokens are **wire
literals**, not product names — do not reintroduce Japanese names in new code or UI.
English subsystem names: Cadence (CadenceVox/CadenceVis), MooringSession/MooringGroup,
Event Spine.

**License: AGPL-3.0-or-later** (see `LICENSE`). Onyx is copyleft-licensed but NOT yet
publicly released — it lives only in the PRIVATE `github.com/devinkbrown/onyx` repo. The
`.git/hooks/pre-push` guard still blocks any non-private GitHub remote; a public release is a
separate, deliberate decision (the AGPL grant only takes effect on public distribution).

## Stack
- **SolidJS 1.9** + `@solidjs/router` — SPA, no SSR
- **Vite 7** (`pnpm build` → static export in `dist/`; only `deploy.sh` writes `out/`)
- **Zustand vanilla** store + `useStore` Solid bridge (`src/lib/store/`)
- **Tailwind 4** + hand-rolled CSS tokens; **TypeScript**
- **pnpm always, never npm**

## Layout
- Entry: `src/index.tsx` — routes `/` (Landing), `/about`, `/app` (AppShell),
  `/appearance`, `/stats`, `/status`, `/roadmap`, and `/invite`. Keep this
  table in sync with `ROUTE_ENTRYPOINTS` in
  `tools/materialize-route-entrypoints.mjs`, which owns their static metadata.
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
- Media engine: `src/lib/cadence-media/` — **Cadence** (CadenceVox/CadenceVis,
  Cadence frames). Internals: MooringSession ECDH/AES-GCM, MediaEngine,
  MooringGroup, ChunkAssembler, PeerRegistry. Outbound media E2EE subtypes are
  English (`E2EE-*`); legacy `TSUMUGI_*` remains dual-accepted only.
  Signaling = `MEDIA` subcommands + Event Spine `EVENT ... MEDIA ...` events.
- Backgrounds: `src/backgrounds/` — animated canvas scenes
- Uploads: `src/lib/upload/` — multipart POST (field `file`) to
  `${VITE_MEDIA_URL}/upload`; prod default is same-origin `/upload`
- Link previews: `src/lib/preview/linkPreview.ts` → same-origin
  `/linkpreview?url=` (SSRF-guarded OG fetcher in
  /home/kain/website/upload_server.py); preference-gated (`linkPreviews`)

## Persistence conventions
- localStorage keys: `onyx:` prefix. Legacy `ocean-*` keys are migrated
  (copied, never deleted) by `src/lib/migrateStorage.ts`; `ruri:` shims in
  ThemeProvider/preferences/etc. stay as read-old-write-new fallbacks.
- IRCX METADATA keys `ocean.display-name` / `ocean.accent` / `ocean.links`
  are WIRE FORMAT (server-persisted) — never rename them.

## Env (Vite exposes only `VITE_*`)
- `VITE_IRC_WS` — pin the Onyx Server WS endpoint (unset = auto node selection)
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
pnpm build      # → dist/ (safe: NEVER touches production)
./deploy.sh     # dist/ build + route-correct SPA entrypoints + sw stamp
                # + community-site overlay from /home/kain/landing,
                # then rsync --delete dist/ → out/ (nginx serves out/)
```
nginx serves `out/` at eshmaki.me. ONLY deploy.sh writes out/ — plain builds
go to dist/, so tests/e2e can never wipe or half-replace production.

## IRC → Onyx concept mapping
| IRC | Onyx |
|-----|------|
| #channel | Text channel |
| Private message | DM |
| +q / +o / +v | Owner / Op / Voice roles |
| Onyx Server account (built-in services) | Onyx account |
| CHATHISTORY | Message history |
| IRCX PROP / ACCESS / METADATA | Channel & profile properties |
| MEDIA subcommands + Event Spine MEDIA | Voice/video channel |

## Services (Onyx Server built-in — NO NickServ pseudo-clients)
Real server commands with structured replies (NOTE/FAIL/WARN): `REGISTER`,
`VERIFY`, `IDENTIFY`, `LOGOUT`, `DROP`, `ACCOUNTINFO`, `ACCOUNTSET`,
`GHOST`, `CERTADD`/`CERTLIST`/`CERTDEL`. Session resume: after SASL the
server issues `NOTE SESSION TOKEN`/`MTOKEN`; reconnect with `SESSION RESUME`.
