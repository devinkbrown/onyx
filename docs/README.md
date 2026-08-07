# Onyx documentation

Onyx is a SolidJS web client for the Onyx Server network: IRC/IRCX text chat,
local-first history, end-to-end encrypted direct messages, and Cadence
voice/video over WebSocket transport.

This hub separates user guides, contributor reference, integration contracts,
and maintainer notes. Status language is deliberate: **available** means the
client path is present and tested; **server-gated** means the connected daemon
must advertise or implement the feature; **staged** means the source foundation
exists but the complete product path is not claimed.

## Naming and project boundary

- **Onyx** is the network and browser client in this repository.
- **Onyx Server** is the separate pure-Zig daemon:
  <https://github.com/devinkbrown/onyx-server>.
- **Cadence** is the client media stack. Its wire codec identifiers are
  `cadencevox` and `cadencevis`.
- `ocean.*` IRCX metadata keys and historical crypto literals are wire
  compatibility, not current product names.

The client is licensed under [AGPL-3.0-or-later](../LICENSE). See
[`../NOTICE.md`](../NOTICE.md) for the hosted-service and third-party boundary.

## Choose a path

### New contributor

| Document | What it answers |
| --- | --- |
| [`getting-started.md`](getting-started.md) | What to install, how to run the client, and how to connect it to a server. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Repository conventions, tests, deployment safety, and pull-request expectations. |
| [`architecture.md`](architecture.md) | The `src/` map and the state, protocol, storage, media, and routing invariants. |
| [`testing-and-release.md`](testing-and-release.md) | Local gates, browser evidence, release review, and deployment boundaries. |

### User

| Document | What it answers |
| --- | --- |
| [`features.md`](features.md) | Passkeys, Home catch-up, notifications, and everyday client behavior. |
| [`search-and-history.md`](search-and-history.md) | Device-local history, search modes, time travel, and E2EE privacy boundaries. |
| [`importing.md`](importing.md) | Local Discord, Slack, and IRC-log imports. |
| [`security.md`](security.md) | What is protected locally, what is sent to a server, and where encryption is scoped. |

### Operator or integrator

| Document | What it answers |
| --- | --- |
| [`configuration.md`](configuration.md) | Vite variables, endpoint selection, uploads, static hosting, and reverse-proxy expectations. |
| [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md) | Client-facing transport, CAP/IRCv3/IRCX, SASL, session resume, and media signaling. |
| [`protocol/onyx-client-contract.v1.json`](protocol/onyx-client-contract.v1.json) | Machine-readable client/server contract, including the current group-E2EE status. |
| [`protocol/halloy-cap-matrix.md`](protocol/halloy-cap-matrix.md) | Capability interoperability notes and evidence. |

### Maintainer or security reviewer

| Document | What it answers |
| --- | --- |
| [`testing-and-release.md`](testing-and-release.md) | What counts as evidence before a public release or deploy. |
| [`../SECURITY.md`](../SECURITY.md) | How to report a vulnerability privately. |
| [`protocol/group-e2ee-c1.md`](protocol/group-e2ee-c1.md) | The group-room E2EE control payload and its explicit staged boundary. |
| [`../ROADMAP.md`](../ROADMAP.md) | Historical strategy and item-level implementation archaeology. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Public-source milestones and notable changes. |
| [`../AGENTS.md`](../AGENTS.md) | Agent-specific implementation rules for this checkout. |

## Source-backed status snapshot

- IRC/IRCX chat, reconnect, session resume, device-local history, importers,
  search, notifications, and the responsive PWA are active client surfaces.
- Direct-message E2EE is implemented end to end: device keys, TOFU/key-change
  handling, multi-device fan-out, fail-closed rendering, ciphertext-only DM
  vault persistence, and a connected browser proof live in the client.
- Cadence media has a separate implemented E2EE path and exposes its actual
  negotiated security state.
- Passkeys are implemented in the client but require server `WEBAUTHN` support.
- Group-room E2EE has a strict envelope, keyring, opaque control routing, and
  signed payload foundation. The current store/transport/key-wrap integration
  is explicitly staged; see [`protocol/group-e2ee-c1.md`](protocol/group-e2ee-c1.md).

If a page here disagrees with a source file or test, fix the documentation drift
and prefer the code-backed behavior. Load-bearing claims should cite a real
`src/…` path where practical.
