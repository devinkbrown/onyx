# Configuration and hosting

Onyx is a build-time-configured static client. It does not contain server
credentials and it does not turn arbitrary environment variables into browser
secrets.

## Vite variables

Copy [`.env.example`](../.env.example) to `.env.local` for local work.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_IRC_WS` | unset | Pins one Onyx Server WebSocket endpoint. When unset, `src/app/nodes.ts` probes its configured node registry and selects the fastest response. |
| `VITE_DEFAULT_CHANNEL` | unused | Reserved for a future first-run/default-channel surface. It is currently not read by the client. |
| `VITE_MEDIA_URL` | `/upload` in a first-party production build | Base URL for multipart uploads. The client posts the file in a field named `file`. |

All `VITE_*` values are embedded into the bundle. Never put passwords, access
tokens, private keys, or server-only credentials in them.

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

`VITE_IRC_WS` is a URL, not an HTTP health endpoint. The automatic node probe
uses HTTPS HEAD requests only to estimate latency; it does not open throwaway
IRC sockets.

## Uploads and link previews

The upload client sends multipart form data to `${VITE_MEDIA_URL}/upload` (or
same-origin `/upload` when the variable is unset). The deployment must enforce
size, content-type, authentication, retention, and malware policy at that
boundary; the browser is not an authorization boundary.

Link previews use a same-origin `/linkpreview?url=` proxy when enabled by user
preferences. The proxy must enforce SSRF protections, outbound scheme/host
allowlists, response-size limits, timeouts, and content sanitization. The
client's preference is a user choice, not a replacement for server-side
validation.

## Browser storage

- `localStorage` keys use the `onyx:` prefix. Legacy `ocean-*` values are copied
  forward by the first import in `src/index.tsx`.
- Conversation history is stored in IndexedDB by `src/lib/vault/` and is
  bounded by the retention policy; the default target is 400 messages.
- DM/device keys use a separate `onyx-keys` database and are not erased by
  clearing ordinary history.
- E2EE DM plaintext is never persisted in the history vault. Browser profile
  access and OS malware are outside the client's protection boundary.

## Static hosting

For a generic host:

```bash
pnpm build
# serve dist/ with SPA fallback and the required WebSocket/media endpoints
```

The first-party `deploy.sh` is intentionally host-specific. It assumes the
eshmaki.me nginx layout, a separately staged community-site overlay, route
materialization, service-worker stamping, and a live `out/` directory. It is
not a portable installer and should not be copied into a different host
without reviewing every path and permission operation.

The repository invariant is simple: `pnpm build`, preview, tests, and local
tools write/read `dist/`; only the reviewed deployment script may write `out/`.
This prevents a test or ordinary build from replacing the live site.

## Route metadata

The Solid route table in `src/index.tsx` and `ROUTE_ENTRYPOINTS` in
`tools/materialize-route-entrypoints.mjs` are a pair. When adding or renaming a
public route, update both and its route tests. Otherwise direct links,
crawlers, and social unfurls can receive the wrong title or canonical URL even
when client-side navigation appears to work.
