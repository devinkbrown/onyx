# Onyx client agent roster

Project path: `/home/kain/onyx`. Daemon is a **different** repo (`/home/kain/onyx-server`).

## Project Claude agents (`.claude/agents/`)
| Agent | Mode | Use for |
|-------|------|---------|
| `onyx-coder-leaf` | Implement | Bounded client TS/TSX outside specialist sinks |
| `onyx-explorer` | Read-only | Trace a feature before coding |
| `onyx-spec-architect` | Read-only | Implementation blueprint |
| `onyx-adversarial-reviewer` | Read-only | Falsify a diff |
| `onyx-security-boundary-reviewer` | Read-only | XSS, storage, media, uploads |
| `onyx-a11y-browser-auditor` | Read-only | a11y / keyboard / reflow |

## Project Codex agents (`.codex/agents/`)
| Agent | Mode |
|-------|------|
| `onyx-implementer-integrator` | Implement + integrate reviews |
| `onyx-evidence-reviewer` | Independent evidence review |
| `onyx-verification-release` | Gate / release readiness |

## Global specialists (`~/.claude/agents/`) — MUST route deep work
| Domain | Agent |
|--------|-------|
| General Solid/TS implement + review | `solidjs-coder` |
| IRC-over-wss wire | `onyx-irc` |
| Zustand store fold-back | `onyx-store` |
| E2EE DM / passkeys / credentials | `onyx-crypto` |
| Message render / XSS sink | `onyx-render` |
| IndexedDB vault | `onyx-vault` |
| Cadence voice/video | `onyx-media` |
| Web Push / PWA / notify | `onyx-notify` |
| Theme / OKLCH tokens | `onyx-theme` |
| UI/UX design taste | `onyx-ui` |
| Accessibility audits | `onyx-a11y` |
| Cmd-K / Spotlight | `onyx-cmdk` |
| Perf / virtualization | `onyx-perf` |
| Playwright critical flows | `onyx-e2e` |

## Skills (`.agents/skills/` → `.claude/skills/`)
`onyx-agent-core`, `onyx-client-verification`, `onyx-roadmap-execution`, `cross-model-handoff`, `onyx-agent-toolkit`.

## Parallel rules
- One writer per file set; parent assigns disjoint slices.
- Security sinks (render, crypto, vault) get specialist or security reviewer before ship.
- Server work → onyx-server roster / `zig-coder`, never this client implementer.
