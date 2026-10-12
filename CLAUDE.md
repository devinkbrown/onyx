# Onyx — web client (Elm)

Modern web client for the **Onyx** network, running on the **Onyx Server** engine
(pure-Zig mesh daemon). Public source.
The brand is **Onyx** (formerly Ocean, briefly Ruri — both dead names).
Branded house: **Onyx** = network/product/client; **Onyx Server** = engine/daemon/
protocol; "IRCXNet" = retired public identity, legacy/wire token only.
Wire/config leftovers: `onyx/*` caps/tags; DM envelopes seal as `ONYXDM1 `;
`TSUMUGI1 ` remains only as frozen E2EE envelope legacy bytes in
`elm/engine/lib/e2ee/dmCipher.ts` (open-path dual-accept for vault/history rows — not
a command). Offline memos use `MEMO` only. Media E2EE outbound uses
`E2EE-HANDSHAKE` / `E2EE-GROUPKEY` (inbound may dual-accept historical
`TSUMUGI_*` subtypes). Wire media codecs: `cadencevox` / `cadencevis`. Those
historical envelope/subtype bytes are **crypto/interop literals**, not product
names — do not reintroduce Japanese names in new code or UI.
English subsystem names: Cadence (CadenceVox/CadenceVis), MooringSession/MooringGroup,
Event Spine.

**License: AGPL-3.0-or-later** (see `LICENSE`). The client source is public under
that license. The hosted Onyx network and the separately maintained Onyx Server
daemon are operational products with their own deployment and release boundaries.

**The Elm client in `elm/` is the only client.** The SolidJS client that preceded it
was removed; the last commit that contains it is the annotated tag
`solid-client-final` (`git show solid-client-final:src/index.tsx`). Comments in
`elm/` that cite `src/…` paths refer to that tag. Nothing in the repository
builds, bundles or deploys Solid, and `./deploy.sh` has no client switch.

## Stack
- **Elm 0.19.1** (`elm/src`, `Browser.application`, no CSS framework) — all UI,
  protocol folds, routing and state. Effects are data (`List Outbound`) that
  `Main.elm` turns into port calls.
- **Ports in plain JS** (`elm/ports.js`, `elm/historyImport.js`) — WebSocket,
  IndexedDB vault, WebCrypto, WebAuthn, uploads, link previews, notifications,
  service-worker registration. Elm stays pure and fail-closed; every side
  effect crosses a port.
- **TypeScript engine, bundled by esbuild** (`elm/engine`, entries in
  `elm/media`) — the Cadence media engine (`window.OnyxVoiceEngine`) and the
  canvas background renderer (`window.OnyxBackdrop`). `@/` resolves to
  `elm/engine/` (tsconfig `paths`, esbuild, vitest).
- **Hand-rolled CSS** — `elm/app.css` (tokens) + `elm/css/*.css`; the link order
  in `elm/index.html` IS the cascade order.
- **Static site** — `tools/build-site.mjs` assembles `dist/` from the Elm build,
  `public/` and the route table (`tools/site/routes.mjs`).
- **pnpm always, never npm.** Dev dependencies only (esbuild, vitest, jsdom,
  fake-indexeddb, TypeScript, ESLint, Playwright for the screenshot tools).

## Layout
- `elm/src/` — Elm modules. `Main.elm` entry (ports, subscriptions, routing),
  `App.elm` model/`Msg`/`update` (feature modules wired in through blocks tagged
  `-- v3/<slice>` and the `settleSteps` list), `Wire.elm`/`GroupControl.elm`/
  `DmCipher.elm`/… pure protocol and crypto-adjacent modules, `View.elm` +
  `View/*.elm` every rendered surface. `Route.elm` is the route table and mirrors
  `ROUTE_ENTRYPOINTS` in `tools/site/routes.mjs` (a test fails when they drift).
- `elm/tests/` — elm-test vectors (`elm/elm.json` pins must stay complete).
- `elm/*.smoke.mjs` — jsdom smoke suites over the real bundle and `ports.js`.
- `elm/index.html` — the shell document: stylesheet cascade, script order
  (`app` → `voice` → `backdrop` → `historyImport` → `ports`) and the boot script
  that reads `onyx:*` flags into `Elm.Main.init`.
- `elm/engine/` — TypeScript bundled into the Elm build: `lib/cadence-media/`
  (MooringSession ECDH/AES-GCM, MediaEngine, MooringGroup, ChunkAssembler,
  PeerRegistry), `lib/e2ee/` (device signing keys, DM envelope cipher, TOFU key
  pins), `lib/irc/` (parser + wire types), `backgrounds/` (canvas engine + 17
  variants). Its vitest suites are co-located.
- `elm/media/` — bundle entries (`voice-engine.ts`, `backdrop.ts`), adapters
  (`voice-core.ts`, `backdrop-core.ts`) and `build-voice.mjs` /
  `build-backdrop.mjs`.
- `elm/tools/` — `build.sh`, screenshots (`screens*.mjs`), CSS coverage / regress /
  inert checks, contrast audit, style map, call end-to-end, smoke runner.
- `elm/design/` — design and status docs (start at `elm/design/INDEX.md`).
- `tools/build-site.mjs`, `tools/site/` — the static-site generator and its tests;
  `tools/serve.mjs` — local static server; other `tools/` are desktop-packaging,
  contract-check and announce utilities.
- `public/` — static site content copied verbatim into `dist/` (icons, manifest,
  `sw.js`, robots/sitemap, brand art, screenshots, `opcodec_wasm.*`, `source/`).
- `deploy.sh`, `ops/nginx/` — the only writer of the live `out/`; the nginx include.
- `desktop/`, `build.zig`, `app.zon` — Zig/Native SDK desktop host that packages `dist/`.
- `docs/` — contributor/user/operator docs; many roadmap documents are
  historical and predate the Elm port.

## Persistence conventions
- localStorage keys: `onyx:` prefix. Legacy `ocean-*` keys are migrated (copied,
  never deleted, never clobbering an existing `onyx:` key) by
  `migrateLegacyStorage` at the top of `elm/ports.js`, which runs when the script
  loads — before the boot script in `elm/index.html` reads any flag. Do not move
  it later. The IndexedDB vault is `onyx-vault` (v3); if a leftover database from
  the removed Solid client blocks it (VersionError), the Elm vault falls back to
  its own `onyx-elm-vault`. Rows are never read across.
- IRCX METADATA keys `ocean.display-name` / `ocean.accent` / `ocean.links`
  are WIRE FORMAT (server-persisted) — never rename them.

## Runtime configuration (no build-time env)
- `?ws=wss://…` pins the Onyx Server WebSocket endpoint (and disables node
  probing); `?nick=` pre-fills the nick. With neither, `Nodes.elm` + `ports.js`
  probe the mesh nodes and attach to the fastest.
- Uploads go to same-origin `/upload` (multipart field `file`); link previews to
  same-origin `/linkpreview?url=` (an SSRF-guarded deployment proxy),
  preference-gated.

## Tests and gates
Toolchain bootstrap (Elm compiler, elm-test, package cache) is in `elm/README.md`.
```bash
export PATH=/tmp:$PATH ELM_HOME=/tmp/elmhome
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)   # Elm: compile + vectors
pnpm test:smoke          # every elm/*.smoke.mjs
pnpm test                # vitest: elm/engine suites + tools/ + static-site contract tests
pnpm typecheck && pnpm lint   # both must pass before finishing
node elm/tools/css-coverage.mjs                       # 0 unstyled classes, 0 undefined vars
node elm/tools/screens.mjs --vp phone,desktop --out <dir>   # real Chromium, fake IRC server
```
Connected checks never target the live network from CI; the screenshot/call tools
run against a throwaway local server.

## Build & deploy
```bash
pnpm build      # elm/tools/build.sh → elm/dist-elm/, then tools/build-site.mjs → dist/
pnpm dev        # build, then serve dist/ on http://127.0.0.1:3000 (tools/serve.mjs)
./deploy.sh     # pnpm build + stamp sw.js + host-specific landing overlay, then rsync --delete dist/ → out/
```
nginx serves `out/` at eshmaki.me. ONLY deploy.sh writes `out/` — plain builds go
to `dist/`, so tests and tooling can never wipe or half-replace production.
`ONYX_LIVE_OUT=<abs path ending in /out>` retargets the sync (use a temp dir for
rehearsals); `DEPLOY_DRY_RUN=1` stops before the sync. The Elm compiler is found
on `PATH` plus `ONYX_ELM_BIN_DIR` (default `/tmp`), `ELM_HOME` defaults to
`/tmp/elmhome`.

`tools/build-site.mjs` emits one document per route (route `<head>` metadata +
the Elm head parts + the Elm boot body), the root `index.html` and the flat
non-indexable `404.html`; Elm assets are content-hashed under `/assets/elm/`.
Add a route in three places together: `elm/src/Route.elm`, `ROUTE_ENTRYPOINTS` in
`tools/site/routes.mjs`, and (if it needs a sitemap entry) `public/sitemap.xml`.
`public/sw.js` keeps the same `/sw.js` URL and scope, skip-waiting/clients-claim
behaviour and the `onyx-shell-__BUILD_VERSION__` stamp (deploy.sh), so browsers
holding any older worker update cleanly.

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
