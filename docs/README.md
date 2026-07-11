# Onyx documentation

Onyx is a **SolidJS 1.9 + Vite 7** web client for IRCXNet — text chat plus
realtime voice/video (the Suimyaku media engine) over IRC/IRCX with WebSocket
transport. This is the documentation hub; each entry is labelled by audience.

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
| [`importing.md`](importing.md) | end-user | Import Discord (DiscordChatExporter) history into your on-device vault. |

## Integration

| Doc | Audience | What it covers |
|---|---|---|
| [`../OROCHI_PROTOCOL.md`](../OROCHI_PROTOCOL.md) | integrator | Client integration reference for the Orochi wire surface — transport, WebSocket framing, CAP/IRCv3/IRCX, SASL, session resume, media signaling. |

## Planning (historical — not reference)

| Doc | Audience | What it covers |
|---|---|---|
| [`../ROADMAP.md`](../ROADMAP.md) | maintainer | Competitive read + phased roadmap. **Historical/strategy** — where it disagrees with current behavior, the code and the docs above are authoritative. |

---

*Conventions: docs are written for a named audience and cite real `src/…:line`
paths for load-bearing claims. Where a doc and the code disagree, the code wins —
flag the drift.*
