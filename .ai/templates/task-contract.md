---
task_id: REPLACE_WITH_STABLE_ID
base_sha: REPLACE_WITH_GIT_HEAD
mode: review
owned_paths:
  - REPLACE_WITH_PATH
authority: codex-integrator
gates:
  - pnpm typecheck
  - pnpm lint
  - pnpm test
---

# Objective and acceptance

- Objective:
- Done when:
- User journey / reproduction:

# Scope

- Non-goals and forbidden paths:
- Invariants (wire, persistence, accessibility, security):
- Worktree and branch (writers only):

# Evidence baseline

- Existing behavior and file:line evidence:
- Relevant tests and routes:
- Known risks / open questions:

# Delegated output

Return only: finding with severity/confidence; file:line or command/browser evidence; reproduction/counterexample; smallest safe change boundary; required tests/gates.

# Stop authority

No delegate may edit the primary checkout, commit, merge, deploy, write `out/`, modify dependencies, or touch `/home/kain/onyx-server`. A writer stops for a stale base SHA, ownership conflict, or rebase conflict and returns its diff and evidence to Codex.
