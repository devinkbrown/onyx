# Onyx architecture

**Audience: contributor.** A map of the `src/` tree for someone who just cloned
the repo. It projects [`../CLAUDE.md`](../CLAUDE.md) and the code into a readable
overview; every load-bearing claim cites a real `src/…` path. Where this doc and
`CLAUDE.md` disagree, the code (and the citation) wins.

Onyx is a **SolidJS 1.9 + Vite 7** single-page app — no SSR, no virtual DOM.
State is a single Zustand-vanilla store; the UI subscribes with fine-grained
Solid signals through a thin bridge. IRC/IRCX runs over a WebSocket. It is a
client only: the server is Onyx Server (see [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md)).

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
  `/appearance`, `/stats`, `/status`, `/roadmap`, `/invite`, `/guides`,
  `/community`, `/privacy`, `/guidelines`, `/contact`. **This `<Route>`
  table must stay in sync with `ROUTE_ENTRYPOINTS` in
  `tools/materialize-route-entrypoints.mjs`**, which materialises a document
  with route-correct crawler and unfurl metadata for every SPA entrypoint.
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
SASL `password`, and Onyx Server reclaim tokens `sessionToken` (local node) and
`meshToken` (any node) (`src/lib/irc/client.ts:28`). Key traits:

- **Framing contract:** one IRC message per WebSocket frame with no trailing
  CRLF; the reader tolerates LF-only and splits on `/\r?\n/` without retaining a
  cross-frame remainder. See [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md) §1.1.
- The original constructor nick is preserved as the SASL authcid even after a
  `433` fallback (`src/lib/irc/client.ts:54`), so PLAIN/SCRAM always identify
  against the original account.
- Binary frames (browser media datagrams) surface via an `onBinary` callback
  (`src/lib/irc/client.ts:40`).
- Parsing/building lives in `src/lib/irc/parser.ts` (`parseIRCMessage`,
  `formatIRCLine`, `buildSessionResumeLine`, `selectSaslMechanism`, PREFIX/
  CHANLIMIT parsers); wire types in `src/lib/irc/types.ts`; multiline batch
  planning in `src/lib/irc/multiline.ts`.

**Node selection:** `src/app/nodes.ts` lists the Onyx network's Onyx Server nodes
(`ircx.us`, `eshmaki.me`; `src/app/nodes.ts:19`) and attaches to the fastest by
connect latency. `VITE_IRC_WS` pins an endpoint and disables probing
(`src/app/nodes.ts:25`) — the path for dev and self-host against your own Onyx Server.

## Theming (`src/theme/`)

The theme layer is OKLCH-based. `src/theme/paletteFactory.ts` is the generative
engine behind the Theme Studio: from a small seed (a hue plus a few knobs) it
derives a full token map in OKLCH so lightness is perceptually even and text
contrast is **AA by construction** (`src/theme/paletteFactory.ts:1`). It also
transforms existing palettes (hue rotate, saturate, warm/cool, push contrast)
and auto-repairs failing pairs. Contrast math is in `src/theme/contrast.ts`;
the 17 built-in themes and `TokenMap` in `src/theme/themes.ts`
(`DEFAULT_THEME_ID` is a *theme* name — `ocean`, not the brand;
`src/theme/themes.ts:1207`). One of the seventeen is **Vermillion**
("Ink & Vermillion", `src/theme/themes.ts:820`, `:1172`) — the eshmaki.me house
identity: a single vermillion accent (OKLCH ~33°) over the deepest warm ink,
factory-derived so its text pairs stay AA. Runtime application in
`src/theme/ThemeProvider.tsx`; the editor in `src/theme/ThemeStudio.tsx`; custom
themes in `src/theme/customThemes.ts`. Design tokens are emitted to CSS via
`src/styles/tokens.css` (+ `global.css`). Animated canvas scenes live in
`src/backgrounds/`.

## History vault (`src/lib/vault/`)

The vault is a local-first IndexedDB message store. `src/lib/vault/historyVault.ts`
persists per-target message batches bounded to **`VAULT_KEEP = 400`** messages,
oldest pruned (`src/lib/vault/historyVault.ts:45`). `loadRecent`/`loadAround`
read back chronologically and drive time-travel (the `?at=` deep link). A
retention policy can widen the per-channel keep above the flat bound
(`src/lib/vault/historyVault.ts:235`). Supporting modules: on-device vault search — exact substring (`historyVault.ts`
`searchVault`), related-terms ranking over a hashing embedding index
(`embeddingIndex.ts`, `searchVaultSemantic.ts`), and hybrid RRF fusion of both
(`searchVaultHybrid.ts`, default UI mode) — plus portable export/import
(`portableTransfer.ts`), retention policy (`retentionPolicy.ts`), and
hydrate/flush sync (`vaultSync.ts` — `initVaultSync` is called from
`src/routes/AppRoute.tsx:39` after retention policy apply).

**Privacy invariant:** decrypted E2EE-DM plaintext is never written to
IndexedDB — only ciphertext persists. E2EE lives in `src/lib/e2ee/`
(`dmCipher.ts`, `policy.ts`).

## Media engine (`src/lib/cadence-media/`)

Voice/video is the **Cadence** media stack (public English name; directory path
is historical). Codecs: **CadenceVox** (audio) / **CadenceVis** (video). Default
transport is Cadence frames over the WebSocket (binary frames), with `MEDIA`
subcommands + Event-Spine `EVENT … MEDIA …` messages for signaling. Mesh state
replication is **Undertow**; inter-server secure links are **Mooring**. Key
pieces: `MediaEngine.ts` (capture/encode/signaling), `cadenceFrame.ts` (frame
codec module name historical — Cadence framing), `ChunkAssembler.ts`
(reassembly), `mediaMac.ts` (per-stream media MAC, pinned by
`ws_media_mac.vectors.json`), `PeerRegistry.ts` + `spatialAudio.ts` (HRTF
spatial audio), `MooringSession.ts`/`MooringGroup.ts` (E2E media crypto modules
— historical names; device identity lives in `dmCipher` deviceKeys), and
`videoEncodeWorker.ts`
(off-main-thread encode). Voice UI is in `src/shell/voice/`. Vite keeps this in
a separate `media` chunk so it stays off first paint (`vite.config.ts:22`).

## Command palette (`src/chat/spotlight/`)

The Cmd/Ctrl-K "Spotlight" palette: `useSpotlight.ts` owns the launcher hotkey
and open signal; `Spotlight.tsx` is the dialog; `commands.ts` builds the command
set; `timeGrammar.ts` parses the natural-language time grammar; `fuzzy.ts` is the
subsequence matcher + ranking.

`timeGrammar.parseTimeExpr` (`src/chat/spotlight/timeGrammar.ts`) resolves a
broad phrase set to an absolute instant: `N minutes/hours/days/weeks ago`,
12-hour clocks (`3pm`, `9:05 a.m.`, `yesterday 3pm` — the docs flagship),
weekday names (`tuesday`, `fri 08:30`, `last friday noon`), dayparts
(`this morning`, `yesterday afternoon`, bare `morning`), and
`noon`/`midnight`. Day arithmetic uses calendar `setDate` rather than 24h
spans so a requested wall-clock hour survives DST transitions; anything it
cannot parse returns `null` so callers fail closed. Channel-first jumps
(`#room at: last friday`) and verb-first jumps (`at #room <expr>`,
`at: <expr>`) both route through the same parser.

## Home & catch-up (`src/lib/catchup/`, `src/shell/HomeView.tsx`)

The app opens on a **Home / catch-up** surface (`src/shell/HomeView.tsx`), not
the last channel buffer. `src/lib/catchup/` holds the pure, DOM-free ranking
logic behind it:

- `summary.ts` — ranks the store's per-target unread/mention counters by unread
  count (busiest first). A different lens from `notifications/catchUp.ts`, which
  ranks by priority (DMs/mentions first, then recency).
- `markCaughtUp.ts` — `planCatchUpAll(channels, dms)` enumerates every joined
  channel + DM that still has unread activity in a deterministic order (mentions
  first, then most-unread, then name A→Z) and returns the totals
  (`src/lib/catchup/markCaughtUp.ts:72`). It never touches the store.
- `resumePoints.ts` — `buildResumePoints(items, firstUnreadId, limit)` powers
  the **"Pick up where you left off"** section. It takes the already-ranked
  `catchUp` items and attaches, per target, the store's authoritative
  `firstUnreadId` boundary (the same cursor that draws the UnreadDivider),
  dropping any target with no genuine boundary (`src/lib/catchup/resumePoints.ts:71`).
  A resume point therefore deep-links to the *exact* first-unread message, not
  the start of a heuristic window. HomeView mounts it at
  `src/shell/HomeView.tsx:544`; tapping a point calls `state.navigate(...)` then
  `state.focusMessage(point.boundaryId)` (`src/shell/HomeView.tsx:216`). Pure and
  unit-tested (no store, no `Date.now()`).

`src/shell/MarkAllCaughtUp.tsx` (mounted at `src/shell/HomeView.tsx:444`) is the
"Mark all caught up" affordance: it reads `channels`/`dms` reactively, computes
the plan with `planCatchUpAll`, and on click advances read-state one target at a
time through the store's per-target `markRead` action (which also syncs the
IRCv3 read marker to the server). It captures the plan *before* the loop because
each `markRead` mutates the store and recomputes the plan
(`src/shell/MarkAllCaughtUp.tsx:56`), self-hides once nothing is unread, and
moves focus to a live status line on success (WCAG 2.4.3). Both modules are
fully unit-tested.

## Passkeys / WebAuthn (`src/lib/webauthn/`)

Passwordless login. `src/lib/webauthn/passkey.ts` is the browser half of the
daemon's `WEBAUTHN` command (see [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md)
§5.1). It is pure ceremony plumbing — base64url (no-padding) codecs, option
builders, and response encoders — with the two `navigator.credentials`
create/get calls as the only browser-dependent seam. Fail-closed by design:

- `b64urlToBytes` rejects any non-base64url byte, padding, or impossible length
  rather than silently decoding to the wrong bytes
  (`src/lib/webauthn/passkey.ts:62`).
- `MIN_CHALLENGE_BYTES = 16` floors the server challenge to the WebAuthn L2
  spec minimum; a shorter challenge is rejected before the device is ever
  prompted (`src/lib/webauthn/passkey.ts:33`, `:89`).
- `assertRpId` rejects an empty or whitespace relying-party id
  (`src/lib/webauthn/passkey.ts:84`); `PUBKEY_CRED_PARAMS` offers only ES256
  (-7) and EdDSA (-8) (`src/lib/webauthn/passkey.ts:21`).

The store owns the ceremony state (`passkeyBusy`/`passkeyError`/`passkeyNotice`,
`registerPasskey`/`signInWithPasskey`, `src/lib/store/store.ts:546`) and drives
it from the `WEBAUTHN` message handler (`src/lib/store/store.ts:4710`); every
builder call is wrapped in a guard so a fail-closed throw becomes an error state
instead of a stranded spinner. UI seams: the **Add a passkey** form in
`src/app/Account.tsx:686` and the **Sign in with a passkey** button in
`src/app/Connect.tsx:997` (gated on `isPasskeySupported()`). Note:
`src/lib/credentials.ts` is a *separate* concern — saved account/password +
session-token persistence, not WebAuthn.

## Notifications (`src/lib/notifications/`)

The notification decision engine — pure, testable modules that decide *whether*
and *how* to alert, plus the runtime that acts on them
(`NotificationRuntime.tsx`). Highlights: `decision.ts` (per-message notify
decision), `calmMode.ts`/`channelNotifyMode.ts` (the Calm / Regular / Power
presets), `catchUp.ts` (priority-ranked catch-up, DMs/mentions first),
`readState.ts` (unread/read tracking), `followed.ts` (followed rooms/topics/DMs),
`sinceDigest.ts`/`reviewHistory.ts` (since-you-left digests + review-range
memory), `webPush.ts` (Web Push subscription), and `homeMemory.ts` (Home recap
state). Almost every module has a co-located `*.test.ts`.

## Other notable `src/` areas

- `src/shell/` — the chat application shell (AppShell, ChannelSidebar,
  MessageView, Composer, MemberList, preferences, notifications, search, voice).
  `src/shell/threadIndex.ts` is a pure O(total) pass that collects the set of
  message ids with replies so each rendered row answers "has replies?" in O(1)
  via `Set.has` instead of the former O(rows×total) `messages.some(...)` rescan
  (`src/shell/threadIndex.ts:24`).
- `src/lib/invite/` — rich shareable invites. `inviteLink.ts` `buildInviteLink`
  is the pure builder for the create side: from an `InviteLinkSpec` (channel +
  optional preferred nick / moment / topic) it emits both the canonical share URL
  (`<origin>?join=…`) and the in-app deep-link (`<appOrigin>?join=…`)
  (`src/lib/invite/inviteLink.ts:60`). Every field is re-validated by routing the
  spec through `inviteCard.buildInviteCard`, so a comma or control character (a
  JOIN-list / CRLF smuggling vector) is dropped and a bad channel degrades to a
  network-only invite rather than a broken target. The **Share invite** section in
  `src/shell/ChannelSettings.tsx:393` is the UI; a successful copy is announced
  through a polite live region (`src/shell/ChannelSettings.tsx:444`, WCAG 2.2
  SC 4.1.3).
- `src/lib/import/` — on-device history importers (see [`importing.md`](importing.md)).
  `discordPackageImport.ts` `parseDiscordPackage` reads Discord's official
  self-serve **"Request all of my Data"** package — a folder tree
  (`account/user.json` author, `messages/index.json` channel names,
  per-channel `messages.json`/`.csv`) — correlates the channel identity and
  author, then delegates each channel to `parseDiscordExport`, inheriting its
  validation, per-channel `VAULT_KEEP` bounding, and dedup
  (`src/lib/import/discordPackageImport.ts:272`). `DiscordPackageImportControls`
  in Preferences is the UI (`src/shell/PreferencesPanel.tsx:911`,
  `src/shell/HistoryImportControls.tsx:269`), with import progress announced via a
  `role="status"` live region (`src/shell/HistoryImportControls.tsx:210`).
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
- `./deploy.sh` — the only writer of `out/`. It builds to `dist/`, uses
  `tools/materialize-route-entrypoints.mjs` for route-specific `index.html`
  documents and metadata plus a flat `404.html` with noindex metadata, stamps
  the service-worker cache name, overlays remaining allowlisted legacy
  support paths from the first-party community-site overlay (`/guides/` and
  `/community/` are SPA Getting started pages and are never overlaid), then
  `rsync --delete dist/ → out/`.
  nginx serves `out/`; its source-controlled include preserves real 404 status
  for unknown paths while internally rendering that flat document. The service
  worker only caches/falls back to exact `/` and `/app` or `/app/` navigations,
  so unknown `/app/*` URLs are never converted into cacheable soft 404s.
  at eshmaki.me. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the safety
  rationale.
