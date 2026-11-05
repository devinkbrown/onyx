# Getting started

Visitors who want to join a room in the official app should use the public
**Guides** page at `/guides/` (the same how-tos also live at `/community/`).
This document is for someone who has just cloned the public Onyx client. It
covers the local UI first, then the pieces needed for a real server connection.

## Prerequisites

- Node.js 20 or newer.
- pnpm. Do not mix npm/yarn lockfile changes into this repository.
- The Elm 0.19.1 compiler on `PATH` (see [`../elm/README.md`](../elm/README.md) for a
  sandbox-friendly bootstrap).
- A browser with WebSocket, IndexedDB, Web Crypto, and (for calls) microphone
  or camera support.
- An Onyx Server endpoint if you want to connect to chat. A static build can
  still be inspected without a reachable server.

## Install

```bash
git clone https://github.com/devinkbrown/onyx.git
cd onyx
pnpm install
```

The checked-in lockfile is the reproducible dependency input. The client has no
build-time environment variables; see [`configuration.md`](configuration.md).

## Start a development session

```bash
pnpm dev
```

`pnpm dev` builds the Elm client and the static site (`dist/`), then serves it
on <http://127.0.0.1:3000>. Rebuild after changing Elm, CSS or TypeScript
sources (`pnpm build`); for quick Elm-only feedback use `elm make` from `elm/`.

Without a pin, the client probes the node registry in `elm/src/Nodes.elm` and
chooses the fastest reachable public node. For a local or private server, open
`/app/?ws=wss://irc.example.test:8080`, which pins that WebSocket endpoint and
disables probing. A browser page cannot use an `irc://` endpoint here; the
client transport is WebSocket, normally `wss://` outside local development.

## First connection

The landing page leads to the connect surface. First-run is guest join: a
display name, an optional room, then Join. Sign in and Create account stay
secondary. Public copy uses rooms, messages, display name, join, sign in,
and create account — not mesh, node, or claim-path language. The server, not
the client, is authoritative for registration, account state, and
session-resume tokens.

After connection:

1. A guest who joined with a room lands in that room with the composer focused
   and a one-line “say hi” hint — no second identity ritual.
2. A guest who joined with no room lands on Home with Browse rooms, Start a
   room, and Invite friends. First-run tips are quiet, dismissible, and stored
   in `onyx:first-hour-seen` so they do not return.
3. Returning Home still shows unread/catch-up when there is real activity. A
   room you created (or are the only member of) in the last 48 hours may ask
   you to reshare until three people have actually shown up — no invented members.
4. Join a channel from the channel browser or composer command surface.
5. Open Preferences to choose history retention, notifications, appearance,
   media, and import/export behavior.
6. Use the account panel for device identity, direct-message keys, sessions,
   recovery codes, and server-gated passkeys.

The app route is `/app`. Public informational routes include `/about`,
`/appearance`, `/stats`, `/status`, `/roadmap`, and `/invite`.

## Build and preview

```bash
pnpm build
pnpm preview
```

The build output is `dist/`; preview serves it on port 3000. The client is a
static SPA, and the build emits one real document per route (plus a flat
`404.html`), so a generic host needs no rewrite rule: serve the files and answer
unknown paths with `404.html` and a 404 status. See
[`configuration.md`](configuration.md) for the production boundary.

## Useful checks while learning the codebase

```bash
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
pnpm test:smoke
pnpm typecheck
pnpm lint
pnpm test
pnpm site:check
```

Use a focused test while iterating (`elm-test tests/SomeTest.elm`,
`node elm/<name>.smoke.mjs`, `pnpm exec vitest run <file>`), then the complete
gate before handing off a change. Real-browser checks
(`node elm/tools/screens.mjs`) run Chromium against a local fake IRC server, never
the live network.

## Troubleshooting

### The page loads but cannot connect

Check the browser console for the selected WebSocket URL, verify that the
endpoint is reachable from the browser, and confirm the server's TLS
certificate is trusted. For a self-hosted node, pin it with `?ws=` instead of
relying on the first-party node registry.

### History is empty after a reload

History is device-local and best-effort. Check that the browser permits
IndexedDB, that you are using the same browser profile, and that the target has
not reached its retention policy. E2EE DM plaintext is intentionally never
stored; ciphertext-only rows may show a locked state until the correct device
key is available.

### A passkey control is missing

Passkey UI is capability-gated. The browser must support WebAuthn and the
connected server must advertise the expected `WEBAUTHN` behavior. The client
does not pretend that an unavailable server feature works.

### A media call cannot start

Grant the browser permission for the requested microphone/camera, use HTTPS or
localhost, and check the media capability/security indicators. Cadence media
runs in the `voice.js` bundle and starts on join, so a landing-page-only smoke test
does not prove a call path.
