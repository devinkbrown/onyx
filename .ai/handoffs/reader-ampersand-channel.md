---
task_id: reader-ampersand-channel
base_sha: c89355b8a7edb3128538c1fc801b67f09c355ccf
mode: implementation
owned_paths:
  - src/shell/MessageView.tsx
  - src/shell/MessageView.test.ts
  - src/shell/shell.test.tsx
authority: codex-integrator
gates:
  - pnpm typecheck
  - pnpm lint
  - pnpm test
---

# Objective and acceptance

- Objective: make reader-memory, since-digest, and reviewed-anchor handoffs respect the active channel view rather than a `#` prefix.
- Done when: a valid `&` channel renders the digest and reader memory and records a channel review anchor.
- User journey / reproduction: open `&ops`, review unread messages, then reopen its reader context.

# Scope

- Non-goals and forbidden paths: no server or Onyx Server work; no protocol, dependency, or `out/` changes.
- Invariants: keep DMs excluded; preserve review-history `kind: 'channel'`; retain CHANTYPES-aware store travel behavior.
- Worktree and branch (writers only): primary checkout, Codex integration owner.

# Evidence baseline

- Existing behavior and file:line evidence: `MessageView` previously gated three reader paths with `target.startsWith('#')` despite the active view already carrying the channel kind.
- Relevant tests and routes: `src/shell/MessageView.test.ts`, `src/shell/shell.test.tsx`.
- Known risks / open questions: alternate CHANTYPES remain represented by active-view kind, not prefix heuristics.

# Delegated output

Return only: finding with severity/confidence; file:line or command/browser evidence; reproduction/counterexample; smallest safe change boundary; required tests/gates.

# Stop authority

No delegate may edit the primary checkout, commit, merge, deploy, write `out/`, modify dependencies, or touch `/home/kain/onyx-server`. A writer stops for a stale base SHA, ownership conflict, or rebase conflict and returns its diff and evidence to Codex.
