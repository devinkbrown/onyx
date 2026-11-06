# Onyx documentation

Onyx is the Elm web client for the Onyx network: rooms, DMs, voice calls,
encrypted DMs and rooms, history on your device, and an installable PWA, talking
IRCv3/IRCX to [Onyx Server](https://github.com/devinkbrown/onyx-server) over
secure WebSocket.

If a page here disagrees with the code or tests, the code wins; please fix the
page.

## Start here

| Document | For |
| --- | --- |
| [`../README.md`](../README.md) | What Onyx is, quick start, status |
| [`getting-started.md`](getting-started.md) | Build and run the client locally |
| [`features.md`](features.md) | What the app does, from a user's point of view |
| [`architecture.md`](architecture.md) | Elm / runtime / bridge map, security boundaries, build chain |
| [`configuration.md`](configuration.md) | `?ws=`, nodes, uploads, storage, static hosting |
| [`testing-and-release.md`](testing-and-release.md) | Gates, audit, labs, perf, deploy and live verification |
| [`security.md`](security.md) | Threat model and what each layer protects |
| [`desktop-host.md`](desktop-host.md) | Native desktop host (Zig + Native SDK) |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Conventions and deploy safety |
| [`../CLAUDE.md`](../CLAUDE.md), [`../AGENTS.md`](../AGENTS.md) | Working guide for coding agents |
| [`../elm/README.md`](../elm/README.md) | Elm toolchain and client-specific tooling |

## Protocol

| Document | For |
| --- | --- |
| [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md) | Client-facing transport, CAP/IRCv3/IRCX, SASL, session resume, media signaling |
| [`protocol/group-e2ee-c1.md`](protocol/group-e2ee-c1.md) | Encrypted-room control payload |
| [`protocol/push-notify-modes.md`](protocol/push-notify-modes.md) | Web Push payloads and client handling |
| [`protocol/halloy-cap-matrix.md`](protocol/halloy-cap-matrix.md) | CAP interoperability notes (July 2026) |
| [`protocol/onyx-client-contract.v1.json`](protocol/onyx-client-contract.v1.json), [`v2`](protocol/onyx-client-contract.v2.json) | Machine-readable client/server contract (`pnpm check:server-contract*`) |

## Roadmap and evidence

| Document | For |
| --- | --- |
| [`../ROADMAP.md`](../ROADMAP.md) | Where things stand and what's next |
| [`elm-roadmap/README.md`](elm-roadmap/README.md) | Evidence log, newest first |
| [`elm-roadmap/acceptance-ledger.json`](elm-roadmap/acceptance-ledger.json) | Formal package acceptance |
| [`elm-roadmap/runner.md`](elm-roadmap/runner.md) | Deterministic verification lanes and receipts |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Notable changes |

## Archive

[`archive/`](archive/README.md) holds roadmaps, audits and guides from the
SolidJS era. They cite files that no longer exist and are kept as history only.

## Names

- **Onyx**: the network and this client. **Onyx Server**: the daemon.
- **Cadence**: the media stack; `cadencevox` / `cadencevis` are wire codec ids.
- `ocean.*` IRCX metadata keys and `TSUMUGI*` bytes are wire-compatibility
  literals, not product names.

The client is [AGPL-3.0-or-later](../LICENSE); see [`../NOTICE.md`](../NOTICE.md).
