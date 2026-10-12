# Configuration and hosting

Onyx is a build-time-configured static client. It does not contain server
credentials and it does not turn arbitrary environment variables into browser
secrets.

## Runtime configuration

The Elm client has **no build-time environment variables**: the static bundle is
identical for every deployment and carries no server credentials. What can be
configured:

| Setting | Where | Meaning |
| --- | --- | --- |
| `?ws=wss://host/ws` | page URL | Pins one Onyx Server WebSocket endpoint and disables node probing. When absent, `elm/src/Nodes.elm` lists the configured nodes and `ports.js` probes them and selects the fastest response. |
| `?nick=` | page URL | Pre-fills the nick on the connect gate. |
| `mediaUrl` flag | boot script in `elm/index.html` | Base URL for multipart uploads. `null` (the shipped value) means same-origin `/upload`. The client posts the file in a field named `file`. |

Anything in a URL or in the shipped HTML is public: never put passwords, access
tokens, private keys, or server-only credentials there. To point a self-hosted
build at your own node, either link users to `/app/?ws=wss://your.host/ws` or
edit the `nodes` list in `elm/src/Nodes.elm` and rebuild.

## WebSocket endpoint expectations

The endpoint must accept the Onyx client's IRC/IRCX WebSocket framing and the
capabilities documented in [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md).
The client negotiates CAP/IRCv3, SASL, session resume, history, and the Onyx
vendor extensions it needs. A reverse proxy must preserve:

- the WebSocket `Upgrade` and `Connection` headers;
- the original secure scheme and host when TLS terminates at the proxy;
- long-lived idle connections, with ping/pong allowed through;
- binary WebSocket frames for Cadence media;
- the server's origin and authentication policy.

`?ws=` is a URL, not an HTTP health endpoint. The automatic node probe
uses HTTPS HEAD requests only to estimate latency; it does not open throwaway
IRC sockets.

## Uploads and link previews

The upload client sends multipart form data to same-origin `/upload` (or the
`mediaUrl` flag's base when a deployment sets one). The deployment must enforce
size, content-type, authentication, retention, and malware policy at that
boundary; the browser is not an authorization boundary.

Link previews use a same-origin `/linkpreview?url=` proxy when enabled by user
preferences. The proxy must enforce SSRF protections, outbound scheme/host
allowlists, response-size limits, timeouts, and content sanitization. The
client's preference is a user choice, not a replacement for server-side
validation.

## Browser storage

- `localStorage` keys use the `onyx:` prefix. Legacy `ocean-*` values are copied
  forward (never deleted) by `migrateLegacyStorage`, which `elm/ports.js` runs
  when it loads, before the boot script reads any flag.
- Conversation history is stored in IndexedDB (`onyx-vault`, written by
  `elm/ports.js`) and is bounded by the retention policy; the default target is
  400 messages.
- DM/device keys use a separate `onyx-keys` database and are not erased by
  clearing ordinary history.
- E2EE DM plaintext is never persisted in the history vault. Browser profile
  access and OS malware are outside the client's protection boundary.

## Static hosting

For a generic host:

```bash
pnpm build   # needs the Elm 0.19.1 compiler on PATH; writes dist/
# serve dist/ as static files with the required WebSocket/media endpoints
```

`dist/` contains one HTML document per route (plus the flat `404.html`), so a
generic static host needs no SPA fallback rewrite: unknown paths should return
`404.html` with a 404 status (`tools/serve.mjs` and `ops/nginx/` show both
behaviours).

The first-party `deploy.sh` is intentionally host-specific. It assumes the
eshmaki.me nginx layout, a separately staged community-site overlay,
service-worker stamping, and a live `out/` directory. It is
not a portable installer and should not be copied into a different host
without reviewing every path and permission operation.

The repository invariant is simple: `pnpm build`, preview, tests, and local
tools write/read `dist/`; only the reviewed deployment script may write `out/`.
This prevents a test or ordinary build from replacing the live site.

## Route metadata

The Elm route table (`elm/src/Route.elm`) and `ROUTE_ENTRYPOINTS` in
`tools/site/routes.mjs` are a pair; `tools/build-site.mjs` turns the latter into
one static document per route (title, description, canonical URL, Open Graph /
Twitter metadata). When adding or renaming a public route, update both and the
sitemap; `pnpm test` (`tools/site/site.test.mjs`) fails when the two drift.
Otherwise direct links, crawlers, and social unfurls can receive the wrong title
or canonical URL even when client-side navigation appears to work.
