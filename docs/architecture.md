# Onyx architecture

**Audience: contributor.** A map of the Elm client for someone who just cloned the
repo. It projects [`../CLAUDE.md`](../CLAUDE.md) and the code into a readable
overview; every load-bearing claim cites a real path. Where this doc and
`CLAUDE.md` disagree, the code (and the citation) wins.

Onyx is an **Elm 0.19.1** single-page app — no SSR, no JavaScript framework.
All UI, routing, protocol parsing and state live in Elm (`elm/src`); every side
effect (WebSocket, IndexedDB, WebCrypto, WebAuthn, uploads, notifications,
service worker) lives behind a port implemented in plain JavaScript
(`elm/ports.js`). The Cadence media engine and the canvas background renderer are
TypeScript (`elm/engine`, entries in `elm/media`) bundled by esbuild into
`voice.js` and `backdrop.js`. IRC/IRCX runs over a WebSocket. It is a client only:
the server is Onyx Server (see [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md)).

The SolidJS client that preceded this one was removed. It is recoverable at the
annotated tag `solid-client-final`; comments in `elm/` that cite `src/…` paths
point into that tag.

## Boot & routing

- `elm/index.html` is the shell document. Its stylesheet `<link>` order is the CSS
  cascade order; scripts load in the order `app.js` (the compiled Elm program) →
  `voice.js` (`window.OnyxVoiceEngine`) → `backdrop.js` (`window.OnyxBackdrop`) →
  `historyImport.js` → `ports.js`. An inline boot script then reads the `onyx:*`
  localStorage flags (preferences, blocklists, notify levels, resume tokens, …),
  calls `Elm.Main.init({ node, flags })` and hands the app to `OnyxPorts.wire(app)`.
- **First thing `ports.js` does at load** is `migrateLegacyStorage`: legacy
  `ocean-*` localStorage keys are copied (never deleted, never clobbering) to
  `onyx:*`, before the boot script reads any flag. Keep it first.
- `elm/src/Main.elm` is the `Browser.application`: it owns the ports, the
  subscriptions and URL changes, and turns `App`'s effect list (`List Outbound`)
  into port calls.
- `elm/src/Route.elm` is the route table (`/`, `/about`, `/app`, `/appearance`,
  `/stats`, `/status`, `/roadmap`, `/invite`, `/guides`, `/community`, `/privacy`,
  `/guidelines`, `/contact`, `/accessibility`, `/glossary`, `/integrations`,
  `/agents`, `/onyxos`, `/download` with the `/install` alias, and `NotFound`).
  **It must stay in sync with `ROUTE_ENTRYPOINTS` in `tools/site/routes.mjs`**,
  which `tools/build-site.mjs` turns into a real document with route-correct
  crawler and unfurl metadata for every path (`tools/site/site.test.mjs` fails
  when the two drift).
- The service worker (`public/sw.js`) is registered by `ports.js`
  (`registerServiceWorker`, gated and silent). A replacement worker hands off via
  `ONYX_SKIP_WAITING`; the page reloads once on `controllerchange`, so stale hashed
  assets cannot linger after a deploy.

## State: the model and its folds (`elm/src/App.elm`)

There is one model, one `Msg` type and one `update` in `App.elm`. Protocol lines
are parsed by pure modules (`Wire`, `Ircx`, `Isupport`, `Session`, `Services`,
`Spine`, …) and folded back into the model; commands go out as data
(`Outbound`), never mutated optimistically. Feature code lives in its own module
(`Organize`, `Chanserv`, `WatchTogether`, `OperConsole`, `GapShell`, …) and is
wired into `App.elm` through blocks tagged `-- v3/<slice>` and the `settleSteps`
list. Rules that follow:

- `update` is pure; if it needs the world it returns an `Outbound`.
- Parsers and folds fail closed (bounded lengths, no control characters,
  rejected-not-repaired input) and carry elm-test vectors in `elm/tests/`.
- Views (`elm/src/View.elm`, `elm/src/View/*.elm`) only read the model.

## IRC over wss

`ports.js` owns the one WebSocket (`wsConnect` / `wsSend` / `wsClose` ports) and the
SASL crypto (PLAIN / SCRAM through WebCrypto); `Session.elm`, `Wire.elm` and
`Credentials.elm` own the registration state machine, CAP/IRCv3 + IRCX
negotiation, session resume (`SESSION RESUME`, reclaim plans) and remembered
identities. Key traits:

- **Framing contract:** one IRC message per WebSocket frame with no trailing CRLF
  expected inbound; see [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md) §1.1.
- The IRC line parser used by the media bundle lives in `elm/engine/lib/irc/parser.ts`
  (with its wire types); the client's own parsing is `Wire.elm`.
- **Node selection:** `elm/src/Nodes.elm` lists the Onyx network's Onyx Server
  nodes and picks the fastest by probe latency; `ports.js` runs the probes.
  `?ws=wss://…` pins an endpoint and disables probing — the path for dev and
  self-host against your own Onyx Server.

## Theming & appearance

The OKLCH palette factory (AA contrast by construction) is `Theme.elm`;
`ShellPalette.elm` derives the shell's `--onyx-*` palette from the active theme
tokens (built-in, custom, or Theme Studio session); `Studio.elm` is the Theme
Studio; `ThemeLook.elm` holds the theme ids (`ocean` is the default THEME id, not
the brand). `elm/css/gap-appearance.css` bridges theme tokens onto the shell.
Animated backgrounds are painted by the canvas engine in
`elm/engine/backgrounds/` (17 variants), mounted by `elm/media/backdrop.ts` as
`window.OnyxBackdrop`; its policy (Adaptive / reduced motion / reduced data) is
`elm/engine/backgrounds/backgroundPolicy.ts`.

## History vault (IndexedDB, `ports.js`)

The vault is a local-first IndexedDB message store (`onyx-vault`, stores
`messages`, `outbox`, `scheduled`, `vault_meta`). Per-target batches are bounded
to **`VAULT_KEEP = 400`** messages, oldest pruned, unless a retention policy
(`Retention.elm`, `onyx:vault-retention-policy`) says otherwise. On-device search
is exact substring, related-terms ranking over a hashing embedding index, or the
hybrid fusion of both (default). Portable export/import and the Discord / Slack /
IRC-log importers are `HistoryImport.elm` + `elm/historyImport.js`. A leftover
database from the removed Solid client at the same name (schema v6) makes `onyx-vault`
unopenable at v3, so the Elm vault falls back to its own `onyx-elm-vault`.

**Privacy invariant:** decrypted E2EE-DM plaintext is never written to IndexedDB —
only ciphertext persists.

## End-to-end encryption

DM envelopes (`ONYXDM1 `), multi-device fan-out, key-change handling and room
(group) envelopes are Elm modules — `DmCipher.elm`, `Keyring.elm`, `GroupControl.elm`,
`GroupEnvelope.elm`, `GroupSession.elm`, `GroupCommit.elm`, `GroupWelcome.elm`,
`DmSafety.elm` — with WebCrypto doing the primitives behind the seal/open ports.
A failed seal or open never degrades to plaintext (locked placeholder). The device
signing key, TOFU key pins and the DM envelope cipher the media engine needs are
in `elm/engine/lib/e2ee/` (`deviceSign.ts`, `keyPinning.ts`, `dmCipher.ts`).

## Media engine (`elm/engine/lib/cadence-media/`)

Voice is the **Cadence** media stack (public English name). Codecs: **CadenceVox**
(audio) / **CadenceVis** (video). Default transport is Cadence frames over the
WebSocket (binary frames), with `MEDIA` subcommands + Event-Spine
`EVENT … MEDIA …` messages for signaling. Key pieces: `MediaEngine.ts`
(capture/encode/signaling), `cadenceFrame.ts`, `ChunkAssembler.ts` (reassembly),
`mediaMac.ts` (per-stream media MAC, pinned by `ws_media_mac.vectors.json`),
`PeerRegistry.ts` + `spatialAudio.ts`, `MooringSession.ts` / `MooringGroup.ts`
(E2E media crypto), `OpcodecWasm.ts` + `public/opcodec_wasm.*` (the codec) and
`videoEncodeWorker.ts` (off-main-thread encode). `elm/media/voice-core.ts` adapts
the engine to the one socket `ports.js` owns, and `elm/media/voice-engine.ts`
mounts `window.OnyxVoiceEngine` with the browser glue. The Elm side is `Media.elm`,
`CallMedia.elm`, `Cadence.elm` and the call views. The engine is bundled by
`elm/media/build-voice.mjs` (which fails the build if anything outside
`elm/engine` / `elm/media` is pulled in). Video is switched off in the shipped
engine (`VIDEO_ENABLED = false`); voice works.

## Other notable areas

- **Home & catch-up** — `Home.elm` ranks unread/mention counters and builds the
  catch-up summary and the mark-all-caught-up plan.
- **Notifications** — `Notify.elm` / `NotifyCenter.elm` decide whether to alert,
  `Attention.elm` holds the Calm / Regular / Power presets and smart mute, and
  followed rooms and quiet hours feed both; `Push.elm`
  is the Web Push subscription flow; `public/sw.js` shows pushes and never puts an
  E2EE envelope on a lock screen.
- **Passkeys** — `Passkey.elm` is the WebAuthn state machine; the ceremony runs in
  `ports.js` (fail-closed base64url / challenge-size / rp-id checks).
- **Invites** — `Invite.elm` builds and validates rich invite links; the public
  `/invite` route is a room card.
- **Uploads & link previews** — `Upload.elm`; `ports.js` posts multipart `file`
  to same-origin `/upload` and fetches same-origin `/linkpreview?url=`
  (preference-gated, an SSRF-guarded deployment proxy).
- **Public pages** — landing, about, download, guides, stats, status, roadmap, …
  are Elm views (`View/*.elm`) with their stylesheet `elm/css/pol-public.css`.

## Build & deploy chain

- `pnpm build` — `elm/tools/build.sh` (`elm make --optimize`, esbuild minify,
  the voice and backdrop bundles, content-hashed assets → `elm/dist-elm/`) then
  `tools/build-site.mjs` (public/ + hashed assets under `/assets/elm/` + one
  document per route + the flat non-indexable `404.html` → **`dist/`**), *not*
  `out/`.
- `pnpm dev` — build, then `tools/serve.mjs` serves `dist/` on port 3000.
- `./deploy.sh` — the only writer of `out/`. It runs `pnpm build`, stamps the
  service-worker cache name, overlays allowlisted legacy support paths from the
  first-party community-site overlay (`/guides/` and `/community/` are SPA
  Getting started pages and are never overlaid), takes a hard-link snapshot of the
  live tree, then `rsync`s `dist/` → `out/` with post-sync verification and
  automatic proven rollback. nginx serves `out/`; its source-controlled include
  (`ops/nginx/eshmaki-server.conf`) preserves real 404 status for unknown paths
  while internally rendering the flat 404 document. The service worker only
  caches/falls back to exact `/` and `/app` or `/app/` navigations, so unknown
  `/app/*` URLs are never converted into cacheable soft 404s. See
  [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the safety rationale.
