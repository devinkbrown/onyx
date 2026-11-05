# Local Transport Investigations

This note describes two opt-in, source-bound lab harnesses: the WebRTC server
investigation (E84) and the WebTransport server investigation (E91). These are
tools for measuring specific behavior against an actual Onyx Server binary.
They do not enable either transport in the normal client, certify acceptance,
or replace a deployment review.

## What the probes measure

E84 uses a real browser `RTCPeerConnection` and an actual server connection to
record the server's response to the browser's advertised codecs and fingerprint.
The server's active offer parser accepts `cadencevox`, `cadencevis`, and `raw`;
it does not negotiate browser-standard Opus or VP8. A standards-only offer can
therefore produce the actual `NO_CODECS` refusal. That refusal is a useful
compatibility observation, not successful media interoperability. The separate
`cadence-dtls` probe measures the custom-codec signaling path only. It does not
turn Cadence frames into Opus or VP8, establish media compatibility, or supply
decoded-media evidence. See the [E84 investigation](../../elm/tools/media/webrtc-server-investigation.ts),
[page](../../elm/tools/media/webrtc-server-investigation.html), and
[browser spec](../../tests/e2e/elm-local-webrtc-server-investigation.spec.ts).

E91 uses the actual browser WebTransport implementation, a generated local
certificate whose leaf DER hash is pinned only for this experiment, and the
existing WebTransport adapter and transport owner. A complete WebTransport text
observation requires registration, raw PING/PONG, the client's own JOIN followed
by the server's 353 NAMES entry and matching 366 terminator, then an exact
self-echoed room PRIVMSG canary. A complete result also requires the
source-shaped `SESSIONTOKEN INSECURE_TRANSPORT` refusal. After explicit
confirmation, the fresh WSS fallback must authenticate, complete the same
JOIN/NAMES proof, echo its text canary exactly once, and reject a write from
the retired WebTransport owner. See the [E91 investigation
page](../../elm/tools/transport/webtransport-server-investigation.html),
[controller](../../elm/tools/transport/webtransport-server-investigation.ts),
and [browser spec](../../tests/e2e/elm-local-webtransport-server-investigation.spec.ts).

The server's current WebTransport listener binds all interfaces. Its bridge
opens a loopback TCP IRC connection, which does not carry the QUIC TLS state or
the original peer address into the IRC connection. The daemon therefore treats
that connection as non-TLS: password SASL mechanisms are not advertised or
accepted under the default policy, and `SESSIONTOKEN` is refused with the
source-defined insecure-transport result. QUIC encryption alone does not prove
WSS policy equivalence. E91 does not send a password, SASL response, or reusable
token over WebTransport. Its WSS fallback is a distinct connection, requires a
visible confirmation action, uses the normal protected WSS/SASL flow, and
starts with a fresh physical and connection owner. Old WebTransport writes are
checked against the retired owner. This fallback is not automatic and is not a
claim of session or media continuity.

The E91 certificate hash option is deliberately confined to this local
investigation. It proves that the browser was asked to pin the generated leaf
certificate for that run; it does not validate production WebPKI, deployed
origins, or browser behavior on other platforms. The E84 certificate and SDP
observations likewise do not establish cross-browser support. Neither harness
establishes binary media transport, custom-codec interoperability, production
performance, or cross-browser metrics.

## Containment and provenance

Both harnesses launch workers with user, network, and PID namespaces. The
shared helper proves that the worker's network and PID namespace identities
differ from the parent by checking inherited parent namespace descriptors. It
requires the worker to be PID 1 in its new PID namespace and `lo` to be its
only, raised network interface, then repeats those checks before the worker
can start a daemon or listener. This is necessary because the production
WebTransport UDP listener is not loopback-bound.

If `unshare`, namespace identity inspection, loopback setup, or the loopback-only
interface check is unavailable, the harness writes a bounded blocked receipt and exits
before it builds the browser stage, starts a daemon, or binds a listener. Such a
receipt means containment could not be established; it is not a WebTransport
connection failure. Do not work around a blocked result by starting the daemon
outside the namespace, changing firewall rules, or inventing a loopback-only
server setting.

Both runners require a matching server build receipt and validate the actual
server source/binary through the private-run helper before use. Each wrapper
creates a mode-0700 scratch root directly under `/tmp`, passes it to the
namespace worker through `TMPDIR`, and removes it after launcher teardown.
They use restrictive file modes, hash harness inputs before and after
staging/measurement, and bind the receipt to the staged browser files. Browser
trace, screenshots, and video are disabled. Receipts contain finite outcomes
and provenance, not raw IRC lines, passwords, tokens, SDP, ICE secrets, or
free-form browser errors. A failed provenance or cleanup check invalidates the
observation.

## Commands

Run from the Onyx client repository root, using a checkout that contains the
reviewed harness files. The server binary and build receipt must still match the
source used by that binary; these example paths are not a substitute for the
runner's provenance checks. The runner owns its temporary ports, disposable
account/room, browser server, child processes, namespace, and receipt path.

E84's standards-codec observation:

```sh
node elm/tools/media/webrtc-server-investigation.mjs \
  --server-bin /tmp/onyx-elm-server-build/bin/onyx-server \
  --server-source /home/kain/onyx-server \
  --server-build-receipt /tmp/onyx-elm-verification-final/server-build-receipt.json \
  --receipt /tmp/onyx-e84-standards.json \
  --probe standards
```

The separate custom-codec signaling observation is selected explicitly:

```sh
node elm/tools/media/webrtc-server-investigation.mjs \
  --server-bin /tmp/onyx-elm-server-build/bin/onyx-server \
  --server-source /home/kain/onyx-server \
  --server-build-receipt /tmp/onyx-elm-verification-final/server-build-receipt.json \
  --receipt /tmp/onyx-e84-cadence-signaling.json \
  --probe cadence-dtls
```

E91's actual-server WebTransport observation:

```sh
node elm/tools/transport/webtransport-server-investigation.mjs \
  --server-bin /tmp/onyx-elm-server-build/bin/onyx-server \
  --server-source /home/kain/onyx-server \
  --server-build-receipt /tmp/onyx-elm-verification-final/server-build-receipt.json \
  --receipt /tmp/onyx-e91-webtransport.json
```

The E91 wrapper establishes containment before it runs the harness. The browser
probe pauses after the WebTransport observation and requires an explicit
“Confirm fresh WSS fallback” click. If the WT JOIN/NAMES sequence or text
canary is incomplete, or that confirmation does not occur, the receipt is
`unknown`; no successful fallback observation is inferred when confirmation is
missing. `--server-source` is optional for E91 and defaults to
`/home/kain/onyx-server`; the example supplies it explicitly. E84 requires
`--server-source`, and its optional `--probe` defaults to `standards`.

The focused strict TypeScript configurations for the investigation controllers
can be checked from the same repository root:

```sh
pnpm exec tsc --noEmit -p elm/tools/media/tsconfig.json
pnpm exec tsc --noEmit -p elm/tools/transport/tsconfig.json
```

These typechecks do not run the browser or contact a server. The executable
runner commands above perform the isolated investigation and write receipts;
they are not ordinary site build or deployment commands.

## Interpretation boundaries

Treat timeouts, missing replies, incomplete WebTransport JOIN/NAMES or
text-canary evidence, and incomplete cleanup as `unknown`. Preflight API,
security-context, or containment failures may be `blocked` according to the
receipt; containment refusal is written before listeners start. E84 also
records post-launch setup failures as unknown and invalidates an existing
observation if owned-process or scratch cleanup fails. A refusal is established
only when the expected source-shaped response is observed from the current
server connection. A completed E84 refusal does not prove browser media works.
A completed E91 text/fallback observation does not prove authentication-policy
equivalence, reusable-session restoration, cross-browser support, or media
transport. No result in this note should be read as permission to enable either
path in ordinary connection selection.
