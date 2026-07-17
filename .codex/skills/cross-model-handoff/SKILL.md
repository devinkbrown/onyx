---
name: cross-model-handoff
description: Coordinate Codex implementation with bounded Claude Code research or review for a repository task. Use when work benefits from an independent architecture, security, accessibility, browser, or regression pass while one Codex agent remains the integration and release owner.
---

# Cross-model handoff

Keep Codex as the sole owner of the primary checkout, Git integration, full gates, commit, and deploy. Use Claude as a read-only evidence lane unless an explicitly isolated worktree and unique path ownership are supplied.

## Dispatch

Before delegation, create a compact task contract from `.ai/templates/task-contract.md`. Validate it with `node scripts/ai/check-contract.mjs <contract>`. Include the current commit, goal, non-goals, owned paths, known contracts, exact gates, and the required proof packet.

Dispatch only independent questions. Prefer one to three read-only reviewers over a standing agent pool. Do not run a team or parallel writers for dependent work.

Use these roles:

- `onyx-explorer` for execution-path and roadmap-gap evidence.
- `onyx-spec-architect` for a bounded implementation blueprint.
- `onyx-adversarial-reviewer` for a diff-focused falsification pass.
- `onyx-a11y-browser-auditor` for keyboard, zoom, focus, motion, and browser evidence.
- `onyx-security-boundary-reviewer` for browser storage, IRC wire, rendering, upload, preview, and media boundaries.

## Integrate

Accept only findings with a file-and-line citation or reproducible command/browser evidence. Resolve reviewer disagreement by checking source and tests, not by averaging opinions. Apply the smallest safe change in the primary worktree.

Run focused tests first, then the repository's full required gates. Check the diff with `node scripts/ai/check-scope.mjs --base <sha> --paths <comma-separated paths>` before integration. A UI or route change also needs the relevant browser acceptance check. Only the release owner may commit, merge, or call `./deploy.sh`.

## Safety rules

- Never let a reviewer edit the shared checkout.
- Never allow a delegated role to deploy, commit, merge, change dependencies, or write `out/`.
- Use a Claude worktree writer only for declared disjoint paths; integrate its diff through Codex.
- Stop and surface uncertainty when evidence is insufficient.
