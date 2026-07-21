# Onyx documentation

Onyx is the network people join — the consumer-facing brand — delivered as a
**SolidJS 1.9 + Vite 7** web client: text chat plus realtime voice/video (the
**Cadence** voice/video) over IRC/IRCX with WebSocket transport. This is the
documentation hub; each entry is labelled by audience.

**Naming (branded house):** **Onyx** is the public network + **first-party client**
(product sauce — not marketed as FOSS). **Onyx Server** is the **AGPL pure-Zig
engine** you self-host. English subsystems: **Undertow**, **Mooring**, **Cadence**
(CadenceVox/Vis). Wire: `onyx/*` caps, `ONYXDM1` envelopes (legacy `TSUMUGI1` dual-open). "IRCXNet" is retired.
See [`../NOTICE.md`](../NOTICE.md). Public glossary: https://eshmaki.me/glossary/

## Start here

| Doc | Audience | What it covers |
|---|---|---|
| [`../README.md`](../README.md) | everyone | Project front door: stack, commands, env vars, deploy. |
| [`architecture.md`](architecture.md) | contributor | Map of the `src/` tree — routing, the store + `useStore` bridge, IRC-over-wss, theming, vault, media engine, Home catch-up (incl. resume points), rich invites, on-device importers, command-palette time grammar, build/deploy chain. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | contributor | Setup (pnpm), test (Vitest/Playwright), typecheck/lint gates, the `dist/` vs `out/` deploy-safety rule, branch conventions. |
| [`../AGENTS.md`](../AGENTS.md) | coding agents | Stack + conventions for AI agents working in the repo. |
| [`../CLAUDE.md`](../CLAUDE.md) | contributor / agents | Dense working context: layout, persistence conventions, IRC↔Onyx mapping, services. |

## Guides

| Doc | Audience | What it covers |
|---|---|---|
| [`features.md`](features.md) | end-user | Passkeys (passwordless sign-in: add/list/rename/remove) and the Home "since you were away" catch-up digest (Needs you / Followed / Quiet tiers, calm presets). |
| [`search-and-history.md`](search-and-history.md) | end-user | The on-device history vault, device-memory search (hybrid / exact / related terms), optional per-conversation archived server search, time travel (`?at=`), and the encrypted-DM privacy invariant. |
| [`importing.md`](importing.md) | end-user | Import Discord (DiscordChatExporter) history into your on-device vault. |

## Integration

| Doc | Audience | What it covers |
|---|---|---|
| [`../ONYX_SERVER_PROTOCOL.md`](../ONYX_SERVER_PROTOCOL.md) | integrator | Client integration reference for the Onyx Server wire surface — transport, WebSocket framing, CAP/IRCv3/IRCX, SASL, session resume, media signaling. |

## Planning (historical — not reference)

| Doc | Audience | What it covers |
|---|---|---|
| [`../ROADMAP.md`](../ROADMAP.md) | maintainer | Competitive read + phased roadmap. **Historical/strategy** — where it disagrees with current behavior, the code and the docs above are authoritative. |

---

*Conventions: docs are written for a named audience and cite real `src/…:line`
paths for load-bearing claims. Where a doc and the code disagree, the code wins —
flag the drift.*
