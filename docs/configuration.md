# Configuration and hosting

The Onyx client is a static site with **no build-time environment variables**.
Every deployment gets the same bundle, and it carries no server credentials.

## Runtime settings

| Setting | Where | Meaning |
| --- | --- | --- |
| `?ws=wss://host/ws` | page URL | Pins one Onyx Server WebSocket endpoint and skips node probing. Only `wss:` is accepted. |
| `?nick=` | page URL | Pre-fills the nickname. Without it the connect gate opens first. |
| node list | `elm/src/Nodes.elm` | Endpoints probed when there is no pin (currently `wss://eshmaki.me:8080`). `ports.js` times a bodyless HTTPS `HEAD` per node and picks the fastest. |
| `mediaUrl` flag | boot script in `elm/index.html` | Upload base. `null` (shipped) means same-origin `/upload`. |

Anything in a URL or the shipped HTML is public. Never put passwords, tokens or
keys there. To point a self-hosted build at your own server, link people to
`/app/?ws=wss://your.host/ws`, or edit `nodes` in `Nodes.elm` and rebuild.

## WebSocket endpoint

The endpoint must speak the framing and capabilities in
[`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md): one IRC message per
text frame, CAP/IRCv3 (including `draft/metadata-2`), SASL, IRCX, session
resume, CHATHISTORY, and binary frames for Cadence media. A reverse proxy must
keep the `Upgrade`/`Connection` headers, the original scheme and host, long
idle connections, binary frames, and the server's origin policy.

## Uploads and link previews

- Uploads are multipart POSTs (field `file`) to same-origin `/upload`. The
  deployment enforces size, type, auth, retention and malware policy; the
  browser isn't an authorization boundary.
- Link previews call same-origin `/linkpreview?url=` when the user allows it.
  That proxy must enforce SSRF protection, scheme/host allowlists, size limits,
  timeouts and sanitisation.

## Browser storage

| Store | Contents |
| --- | --- |
| localStorage `onyx:*` | Preferences, theme, notification levels, blocklists, retention policy, etc. |
| IndexedDB `onyx-vault` | Conversation history and owner-scoped drafts, outbox, read anchors, settings, backups (runtime v5 stores). Default keep 400 per conversation. |
| IndexedDB `onyx-keys`, `onyx-key-pins`, `onyx-trusted-group-signers` | Device keys, DM key pins, trusted group signers. Not cleared with ordinary history. |
| IndexedDB `onyx-vault-searches`, `onyx-saved-searches` | Search index and saved searches. |

Decrypted E2EE plaintext is never written to the vault. Browser-profile access
and OS malware are outside what the client can protect.

## Static hosting

```bash
node tools/build-elm-site.mjs /path/to/site   # needs elm 0.19.1 on PATH
```

The output has one HTML document per route plus a flat `404.html`, so no SPA
rewrite is needed. Unknown paths should get `404.html` with a 404 status
(`ops/nginx/eshmaki-server.conf` shows the first-party setup;
`tools/serve-dir.mjs` is a simple local server with SPA fallback).

Serve `sw.js` and `runtime-build.json` with no long-lived caching, and make sure
every precached asset is served byte-for-byte as built. After deploying, run:

```bash
node tools/verify-live-shell.mjs https://your.host
```

`deploy.sh` is specific to eshmaki.me (nginx layout, landing-site staging, live
`out/` directory). Don't copy it to another host without reviewing every path
and permission step. Only `deploy.sh` writes `out/`.

## Route metadata

`elm/src/Route.elm` and `ELM_ROUTE_ENTRYPOINTS` in
`tools/materialize-elm-routes.mjs` are a pair. When you add or rename a public
route, update both (and `public/sitemap.xml`), or direct links and social
unfurls get the wrong title or canonical URL.
