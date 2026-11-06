# Onyx architecture

**Audience: contributors.** A map of the client for someone who just cloned the
repo. Where this page and the code disagree, the code wins; please fix the page.

Onyx is an **Elm 0.19.1** single-page app with three layers:

1. **Elm** (`elm/src`): all UI, routing, protocol parsing and application state.
2. **Private runtime** (`elm/runtime`, TypeScript): everything that holds a
   secret or a live resource: the IRC socket, credentials, keys, owned
   IndexedDB stores, media, the service-worker lifecycle.
3. **Browser bridge** (`elm/ports.js`, plain JS): the remaining port effects
   (history vault reads, prefs, uploads, link previews, notifications,
   clipboard) and the hand-off between Elm and the runtime.

The server is [Onyx Server](https://github.com/devinkbrown/onyx-server); its
client-facing protocol is in [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md).
The SolidJS client that came before was removed; comments in `elm/` that cite
`src/shell/…` or `src/lib/store/…` point at the tag `solid-client-final`.

## Boot

`elm/index.html` is the base document.

1. An inline script reads `onyx:theme` and sets `data-theme` before first paint,
   and keeps the browser's `theme-color` in step with the page.
2. Stylesheets load in cascade order: `app.css`, `rail.css`, `convo.css`,
   `site.css`.
3. Scripts load: `app.js` (compiled Elm), `ports.js` (`window.OnyxPorts`),
   `runtime.js` (`window.OnyxRuntime`, from `elm/runtime/browser-entry.ts`).
4. The boot script checks the runtime build matches the shell
   (`loadBrowserBuildCompatibility`), reads `onyx:*` flags, calls
   `Elm.Main.init`, creates the runtime with `createBrowserRuntime`, and wires
   both with `OnyxPorts.wire(app, { runtime, requirePrivateRuntime: true })`.

## Elm (`elm/src`)

- `Main.elm` is the `Browser.application`. It owns every port and subscription
  and turns `App`'s outbound effects into port calls.
- `App.elm` holds the one model, `Msg` and pure `update`, plus the inbound IRC
  line fold. It's very large; add new logic in its own module and keep `App`
  edits small.
- Pure protocol modules: `Wire` (line parse/format), `Session` (registration,
  CAP, SASL, resume), `Isupport`, `Labels`, `Modes`, `Ircx` (PROP/ACCESS/
  WHISPER/LISTX builders), `Spine` (Event Spine), `Media` (MEDIA control),
  `Services`, `Multiline`. Each fails closed and has vectors in `elm/tests/`.
- Crypto-adjacent codecs: `DmCipher` (`ONYXDM1`/`ONYXDMN1`), `GroupEnvelope`
  (`ONYXROOM1`), `GroupControl`, `GroupCommit`, `GroupWelcome`, `GroupDirectory`,
  `GroupSession`, `Keyring`. They validate shapes; WebCrypto and keys live in
  the runtime.
- Shell: `ConnectGate` (guest / sign in / create account), `Nav` (Home, Rooms,
  Messages, Calls, You with Rooms/Messages filters All/Unread/@Mentions/
  Favorites), and `View/*`: `Rail`, `Topbar`, `RoomHeader`, `Thread`,
  `Composer`, `Inbox`, `Calls`, `CallSetup`, `Roster`, `Profile`, `Search`,
  `Pins`, `Media`, `Appearance`, `RuntimeServices` (You > Advanced), `Trust`,
  `EncryptedRoomSetup`, and the public pages (`Landing`, `PublicFrame`,
  `About`, `Stats`, `Status`, `Roadmap`, `Guides`, `Download`, …).
- Looks: `ThemeLook` lists the built-in looks and "match device" (`system`,
  the default when nothing is stored); `ThemeTokens` and `Theme` produce the
  token set; `Studio` edits custom themes (`onyx:custom-themes`).
- Routing: `Route.elm` parses `/`, `/about`, `/app`, `/appearance`, `/stats`,
  `/status`, `/roadmap`, `/invite`, `/guides`, `/community`, `/privacy`,
  `/guidelines`, `/contact`, `/accessibility`, `/glossary`, `/integrations`,
  `/agents`, `/onyxos`, `/download` (alias `/install`). Keep it in sync with
  `ELM_ROUTE_ENTRYPOINTS` in `tools/materialize-elm-routes.mjs`, which writes a
  document with the right title and metadata for each route.

## Private runtime (`elm/runtime`)

Bundled by Vite (inside `tools/build-elm-site.mjs`) into an IIFE `runtime.js`.
Strict TypeScript (`elm/runtime/tsconfig.json`); `@/` resolves to `src/`.

| Area | Files |
| --- | --- |
| IRC transport | `transport-owner.ts` (the WebSocket), `client-line-validator.ts`, `public-ingress-batcher.ts`, `session-mesh-control.ts` |
| Sessions and identity | `credential-owner.ts`, `identity-owner.ts`, `session-operation-owner.ts`, `session-recovery-controller.ts`, `tab-intent-owner.ts` |
| Sending | `outbox-journal.ts`, `send-acceptance-registry.ts`, `memory-send-owner.ts`, `scheduled-custody.ts`, `scheduled-due-pump.ts` |
| Storage | `migrations.ts` (`onyx-vault` v5 owner-scoped stores), `owned-storage.ts`, `draft-store.ts`, `read-anchor-store.ts`, `local-workspace-owner.ts`, `settings-store.ts` |
| Private crypto | `private-crypto-provider.ts`, `group-authoring.ts`, `group-recovery.ts`, `group-directory-trust.ts`, `crypto-backup.ts`, `private-account-security.ts`, `private-passkey-management.ts` |
| Media | `media-engine.ts` (wraps `src/lib/cadence-media/MediaEngine.ts`), `media-capture.ts`, `media-devices.ts`, `media-playout.ts`, `caption-producer.ts` |
| Platform | `bootstrap.ts`, `browser-platform.ts`, `worker-lifecycle.ts` (service-worker registration and safe activation), `push-lifecycle.ts`, `notification-router.ts` |

Shared modules it imports from `src/lib/`: `cadence-media/` (Cadence frames,
MooringSession/MooringGroup, ChunkAssembler, PeerRegistry, media MAC, Opcodec
WASM, video encode worker), `e2ee/` (DM cipher, device signing, group
envelope/keyring/commit/welcome/directory), `irc/` (parser, multiline,
recovery codes), `net/boundedAbort.ts`.

## Security boundaries

- Elm never receives passwords, tokens, private keys, epoch keys or decrypted
  private payloads beyond what a view needs to show.
- All wire text is untrusted. Views render text nodes; parsers are bounded.
- Encrypted DMs and rooms fail closed: no plaintext fallback, locked
  placeholder on failure. The vault stores ciphertext only
  (`owned-storage.ts` classifies `ONYXDM1`, `ONYXDMN1`, `ONYXROOM1`,
  `ONYXGROUP1` and legacy `TSUMUGI1` rows as encrypted).
- Room epoch keys are ephemeral (not persisted); a reload re-provisions them.
- Device-trust review (`group.trust-preview` / `group.trust-confirm` in
  `contracts.ts` and `bootstrap.ts`) writes a pin only on confirm. It's new and
  pending independent security review.

## History and search

- History is kept per conversation in IndexedDB `onyx-vault` (runtime-owned v5
  stores; the legacy v3 path in `ports.js` opens only without a runtime).
  Default keep is 400 rows per conversation; `Retention.elm` and
  `onyx:vault-retention-policy` set per-conversation keep and max age.
- Search (`Search.elm`, `SavedSearches.elm`) runs over loaded messages and the
  device vault, with exact, related-terms and hybrid modes
  (`onyx:vault-search-mode`). Locked envelopes never match.

## Transport and nodes

- One IRC message per WebSocket frame; see the protocol doc §1.1.
- `Nodes.elm` lists nodes (currently `eshmaki.me`) and picks the fastest probe.
  `?ws=wss://…` pins an endpoint. The runtime accepts only `wss:`.
- CAP requests include `draft/metadata-2` (needed for display names and DM
  keys); `EVENT` subscriptions wait for IRCX `800`; `CHATHISTORY` waits for
  registration (`001`).

## Media

Voice calls use the **Cadence** stack: `MEDIA` subcommands and Event Spine
`EVENT … MEDIA …` for signaling, Cadence frames over the WebSocket for audio
(codec ids `cadencevox` / `cadencevis`), MooringSession/MooringGroup for media
E2EE (`E2EE-HANDSHAKE` / `E2EE-GROUPKEY`). The Elm side is `Media.elm`,
`Cadence.elm`, `RoomMedia.elm`, `MediaReadiness.elm` and the call views. Calls
start inside a room.

## Service worker and updates

`elm/sw.js` precaches the shell listed in a build envelope written by
`tools/build-elm-site.mjs` (SHA-256 per asset, also published as
`/runtime-build.json`). One mismatched hash fails the install. The runtime
registers the worker shortly after load and when the page becomes visible, and
activates a waiting build only when the page is idle (no draft, call or private
mutation), then reloads once. A pre-November worker's `onyx-shell-*` cache is
deleted on takeover. `/onyxos/` is excluded from the precache because another
site serves it.

## Build and deploy

- `node tools/build-elm-site.mjs <dir>`: `elm make --optimize` and minify,
  Vite runtime bundle, CSS and public assets, service-worker envelope, and one
  document per route plus a flat `404.html`.
- `./deploy.sh`: the only writer of `out/`. Builds `dist/`, verifies,
  backs up the live tree, rsyncs, verifies again and restores on failure. nginx
  config lives in `ops/nginx/eshmaki-server.conf`.
- `node tools/verify-live-shell.mjs https://eshmaki.me`: checks every precached
  asset hash at the public origin.
