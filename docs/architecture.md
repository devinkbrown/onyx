# Onyx architecture

**Audience: contributor.** A map of the `src/` tree for someone who just cloned
the repo. It projects [`../CLAUDE.md`](../CLAUDE.md) and the code into a readable
overview; every load-bearing claim cites a real `src/…` path. Where this doc and
`CLAUDE.md` disagree, the code (and the citation) wins.

Onyx is a **SolidJS 1.9 + Vite 7** single-page app — no SSR, no virtual DOM.
State is a single Zustand-vanilla store; the UI subscribes with fine-grained
Solid signals through a thin bridge. IRC/IRCX runs over a WebSocket. It is a
client only: the server is Orochi (see [`../OROCHI_PROTOCOL.md`](../OROCHI_PROTOCOL.md)).

## Entry & routing

`src/index.tsx` is the entry point. Notable order and structure:

- **First import is `./lib/migrateStorage`** (`src/index.tsx:4`) — it migrates
  legacy `ocean-*` localStorage keys to `onyx:*` as an import side effect, before
  any module-scope storage read. Keep it first.
- The service worker is registered in production and reloads the page once when a
  new worker takes control (`src/index.tsx:12`), so stale hashed chunks can't
  linger after a deploy.
- Routes are declared with `@solidjs/router` (`src/index.tsx:86`): `/` (Landing,
  eager), and lazy routes `/about`, `/app` (`AppRoute` → the chat shell),
  `/appearance`, `/stats`, `/status`, `/roadmap`, `/invite`. **This `<Route>`
  table must stay in sync with the SPA route-copy list in `deploy.sh:32`**
  (`for route in app about appearance stats status roadmap invite`).
- The Cmd/Ctrl-K command palette host (`GlobalSpotlight`, `src/index.tsx:56`) is
  armed lazily on first open so its command catalogue stays off the landing chunk.
- In dev only, the store module is exposed as `window.__onyx` for headless
  QA/e2e harnesses (`src/index.tsx:73`); it never ships to prod.

## State: the store + `useStore` bridge (`src/lib/store/`)

There is one store — a Zustand **vanilla** store built with
`createStore` and the `subscribeWithSelector` middleware
(`src/lib/store/store.ts:1`). It holds connection state, channels, messages,
media/call state, E2EE, notifications, pins, drafts, and most UI preferences.

The Solid bridge is `useStore` (`src/lib/store/useStore.ts:7`): it takes a
selector, seeds a Solid signal from `store.getState()`, and re-sets it via
`store.subscribe(selector, …)` with an optional equality function, unsubscribing
on cleanup. Rules that follow from this design:

- **Component reads go through `useStore(s => …)`** — that is the reactive path.
  `getState()` (`src/lib/store/useStore.ts:28`) is a *non-reactive snapshot*;
  reading it in a component gives a value that never updates.
- **Writes go through immutable `set()` actions** on the store; server commands
  are dispatched with `get().client?.sendRaw(...)` and folded back through the
  message handler, not mutated optimistically.

Slice behaviour is covered by ~15 co-located tests (`src/lib/store/store.*.test.ts`,
`useStore.test.ts`).

## IRC over wss (`src/lib/irc/`)

`src/lib/irc/client.ts` is the `IRCClient` WebSocket client. It negotiates
CAP/IRCv3 + IRCX, runs SASL during registration, keeps the connection alive with
ping/pong, and drives reconnect. Constructor options include the wss `url`, nick,
SASL `password`, and Orochi reclaim tokens `sessionToken` (local node) and
`meshToken` (any node) (`src/lib/irc/client.ts:28`). Key traits:

- **Framing contract:** one IRC message per WebSocket frame with no trailing
  CRLF; the reader tolerates LF-only and splits on `/\r?\n/` without retaining a
  cross-frame remainder. See [`../OROCHI_PROTOCOL.md`](../OROCHI_PROTOCOL.md) §1.1.
- The original constructor nick is preserved as the SASL authcid even after a
  `433` fallback (`src/lib/irc/client.ts:54`), so PLAIN/SCRAM always identify
  against the original account.
- Binary frames (browser media datagrams) surface via an `onBinary` callback
  (`src/lib/irc/client.ts:40`).
- Parsing/building lives in `src/lib/irc/parser.ts` (`parseIRCMessage`,
  `formatIRCLine`, `buildSessionResumeLine`, `selectSaslMechanism`, PREFIX/
  CHANLIMIT parsers); wire types in `src/lib/irc/types.ts`; multiline batch
  planning in `src/lib/irc/multiline.ts`.

**Node selection:** `src/app/nodes.ts` lists the IRCXNet nodes (`ircx.us`,
`eshmaki.me`; `src/app/nodes.ts:19`) and attaches to the fastest by connect
latency. `VITE_IRC_WS` pins an endpoint and disables probing
(`src/app/nodes.ts:25`) — the path for dev and self-host against your own Orochi.

## Theming (`src/theme/`)

The theme layer is OKLCH-based. `src/theme/paletteFactory.ts` is the generative
engine behind the Theme Studio: from a small seed (a hue plus a few knobs) it
derives a full token map in OKLCH so lightness is perceptually even and text
contrast is **AA by construction** (`src/theme/paletteFactory.ts:1`). It also
transforms existing palettes (hue rotate, saturate, warm/cool, push contrast)
and auto-repairs failing pairs. Contrast math is in `src/theme/contrast.ts`;
the 14 built-in themes and `TokenMap` in `src/theme/themes.ts`
(`DEFAULT_THEME_ID` is a *theme* name, not the brand); runtime application in
`src/theme/ThemeProvider.tsx`; the editor in `src/theme/ThemeStudio.tsx`; custom
themes in `src/theme/customThemes.ts`. Design tokens are emitted to CSS via
`src/styles/tokens.css` (+ `global.css`). Animated canvas scenes live in
`src/backgrounds/`.

## History vault (`src/lib/vault/`)

The vault is a local-first IndexedDB message store. `src/lib/vault/historyVault.ts`
persists per-target message batches bounded to **`VAULT_KEEP = 400`** messages,
oldest pruned (`src/lib/vault/historyVault.ts:22`). `loadRecent`/`loadAround`
read back chronologically and drive time-travel (the `?at=` deep link). A
retention policy can widen the per-channel keep above the flat bound
(`src/lib/vault/historyVault.ts:146`). Supporting modules: on-device semantic
search over a hashing embedding index (`embeddingIndex.ts`,
`searchVaultSemantic.ts`), portable export/import (`portableTransfer.ts`),
retention policy (`retentionPolicy.ts`), and hydrate/flush sync
(`vaultSync.ts` — `initVaultSync` is called at boot from `src/index.tsx:79`).

**Privacy invariant:** decrypted E2EE-DM plaintext is never written to
IndexedDB — only ciphertext persists. E2EE lives in `src/lib/e2ee/`
(`dmCipher.ts`, `policy.ts`).

## Media engine (`src/lib/suimyaku-media/`)

Voice/video is the Suimyaku engine. Default transport is Suimyaku/Kagura frames
over the WebSocket (binary frames), with `MEDIA` subcommands + Event-Spine
`EVENT … MEDIA …` messages for signaling. Key pieces: `MediaEngine.ts`
(capture/encode/signaling), `kaguraFrame.ts` (frame codec), `ChunkAssembler.ts`
(reassembly), `mediaMac.ts` (per-stream media MAC, pinned by
`ws_media_mac.vectors.json`), `PeerRegistry.ts` + `spatialAudio.ts` (HRTF
spatial audio), `TsumugiSession.ts`/`TsumugiGroup.ts`/`TsumugiIdentity.ts` (E2E
media crypto), and `videoEncodeWorker.ts` (off-main-thread encode). Voice UI is
in `src/shell/voice/`. Vite keeps this in a separate `media` chunk so it stays
off first paint (`vite.config.ts:22`).

## Command palette (`src/chat/spotlight/`)

The Cmd/Ctrl-K "Spotlight" palette: `useSpotlight.ts` owns the launcher hotkey
and open signal; `Spotlight.tsx` is the dialog; `commands.ts` builds the command
set; `timeGrammar.ts` parses the natural-language time grammar (`at: yesterday
21:00`, relative offsets); `fuzzy.ts` is the subsequence matcher + ranking.

## Other notable `src/` areas

- `src/shell/` — the chat application shell (AppShell, ChannelSidebar,
  MessageView, Composer, MemberList, preferences, notifications, search, voice).
- `src/primitives/` — reusable UI building blocks.
- `src/lib/upload/` — multipart upload to `${VITE_MEDIA_URL}/upload` (prod
  default same-origin `/upload`).
- `src/lib/preview/linkPreview.ts` — same-origin `/linkpreview?url=` OG fetcher,
  preference-gated.
- `src/pwa/`, `public/sw.js` — service worker + PWA plumbing.

## Build & deploy chain

- `pnpm dev` — Vite dev server on port 3000 (`vite.config.ts:33`).
- `pnpm build` — Vite build to **`dist/`** (`vite.config.ts:13`), *not* `out/`.
  Manual chunks split `solid`, `media`, and the store `runtime`
  (`vite.config.ts:18`).
- `./deploy.sh` — the only writer of `out/`. It builds to `dist/`, materialises
  per-route `index.html` copies (`deploy.sh:32`), stamps the service-worker
  cache name (`deploy.sh:38`), overlays the community site from
  `/home/kain/landing`, then `rsync --delete dist/ → out/`. nginx serves `out/`
  at eshmaki.me. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the safety
  rationale.

> Note (doc drift): `README.md` and `CLAUDE.md` describe `pnpm build` as
> emitting `out/`. The build actually targets `dist/` (`vite.config.ts:13`);
> only `deploy.sh` produces `out/`. Follow the code.
