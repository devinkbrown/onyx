---
name: onyx-agent-toolkit
description: >
  Audit and evolve the Onyx client agent/skill roster. Use when adding agents,
  skills, routing, or Codex/Claude parity for /home/kain/onyx.
---

# Maintain the Onyx client agent toolkit

## Design rules
- **Token-lean agents** — bodies ≤~3 KiB; deep knowledge in skills (`onyx-agent-core` + domain).
- **One implementer gate** — `solidjs-coder` / project `onyx-coder-leaf` writes general code; specialists own deep sinks (crypto, render, wire, vault, media).
- **Reviewers never edit** — project `onyx-*-reviewer` / auditor agents are read-only.
- **Deploy is separate** — no agent deploys unless user explicitly authorizes `./deploy.sh`.
- **Never touch `out/`** from agents.
- **Do not edit onyx-server** from client agents unless task is dual-repo with explicit file sets.
- Prefer skills over permanent agents for every directory.
- Keep Codex (`.codex/agents/`) and Claude (`.claude/agents/`) responsibilities aligned; skills single-source under `.agents/skills` and expose via `.claude/skills`.

## Canonical trees
| Path | Role |
|------|------|
| `.agents/skills/` | Skill source of truth |
| `.claude/skills/` | Claude exposure (copy or symlink) |
| `.claude/agents/` | Claude project agents |
| `.codex/agents/` | Codex project agents |
| `.agents/ROSTER.md` | Routing map |
| `AGENTS.md` | Universal constraints |

## After toolkit changes
1. Skills have valid frontmatter (`name`, `description`).
2. Agents that implement list `skills: [onyx-agent-core, …]`.
3. Reviewers: no Write/Edit.
4. Update `.agents/ROSTER.md` + `AGENTS.md` routing if roles change.
5. Smoke: open `onyx-agent-core` + one agent frontmatter parse.
