# Getting started

This guide is for someone who has just cloned the public Onyx client. It covers
the local UI first, then the pieces needed for a real server connection.

## Prerequisites

- Node.js 20 or newer.
- pnpm. Do not mix npm/yarn lockfile changes into this repository.
- A browser with WebSocket, IndexedDB, Web Crypto, and (for calls) microphone
  or camera support.
- An Onyx Server endpoint if you want to connect to chat. A static build can
  still be inspected without a reachable server.

## Install

```bash
git clone https://github.com/devinkbrown/onyx.git
cd onyx
pnpm install
cp .env.example .env.local
```

The checked-in lockfile is the reproducible dependency input. Do not commit
`.env.local`; Vite exposes only `VITE_*` values to browser code, and anything
placed in one of those variables must be treated as public build configuration,
not a secret.

## Start a development session

```bash
pnpm dev
```

Open <http://localhost:3000>. The development entry point exposes a
`window.__onyx` store handle for local QA; production builds do not expose that
handle.

Without `VITE_IRC_WS`, the client probes the node registry in
`src/app/nodes.ts` and chooses the fastest reachable public node. For a local
or private server, set a WebSocket endpoint in `.env.local`, for example:

```dotenv
VITE_IRC_WS=wss://irc.example.test:8080
```

Restart Vite after changing environment values. A browser page cannot use an
`irc://` endpoint here; the client transport is WebSocket, normally `wss://`
outside local development.

## First connection

The landing page leads to the connect surface. First-run is guest join: a
display name, an optional room, then Join. Sign in and Create account stay
secondary. Public copy uses rooms, messages, display name, join, sign in,
and create account — not mesh, node, or claim-path language. The server, not
the client, is authoritative for registration, account state, and
session-resume tokens.

After connection:

1. Open Home to see unread/catch-up state.
2. Join a channel from the channel browser or composer command surface.
3. Open Preferences to choose history retention, notifications, appearance,
   media, and import/export behavior.
4. Use the account panel for device identity, direct-message keys, sessions,
   recovery codes, and server-gated passkeys.

The app route is `/app`. Public informational routes include `/about`,
`/appearance`, `/stats`, `/status`, `/roadmap`, and `/invite`.

## Build and preview

```bash
pnpm build
pnpm preview
```

The build output is `dist/`; preview runs on port 4173. The client is a static
SPA, so a generic host must serve the materialized route documents or fall back
to the SPA entry point for client routes. See
[`configuration.md`](configuration.md) for the production boundary.

## Useful checks while learning the codebase

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm site:check
```

Use a focused test while iterating, then the complete gate before handing off a
change. `pnpm test:e2e` uses Playwright and a production preview; connected
browser specs additionally need the development app and a reachable test
server. Their required environment is documented in the spec itself.

## Troubleshooting

### The page loads but cannot connect

Check the browser console for the selected WebSocket URL, verify that the
endpoint is reachable from the browser, and confirm the server's TLS
certificate is trusted. For a self-hosted node, set `VITE_IRC_WS` explicitly
instead of relying on the first-party node registry.

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
is lazy-loaded from the `/app` path, so a landing-page-only smoke test does not
prove a call path.
