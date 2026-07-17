# Onyx cross-model workflow

## Authority

Codex owns the primary checkout, integration, Git, full verification, commit, merge, and release. Claude is read-only by default. A Claude writer needs an isolated worktree, declared disjoint paths, and an integration handoff; it never deploys.

## One roadmap slice

1. Create a task contract from `.ai/templates/task-contract.md`; validate it with `node scripts/ai/check-contract.mjs <contract>`.
2. Dispatch only independent evidence questions. Use at most one writer and two reviewers.
3. Require file:line or reproducible browser/command evidence; discard generic advice.
4. Implement the smallest change in the primary checkout, with a co-located regression test; before integration, check base and owned-path scope with `node scripts/ai/check-scope.mjs`.
5. Run focused tests, then `pnpm typecheck`, `pnpm lint`, and `pnpm test`; add Playwright/browser evidence for UI work.
6. Ask one adversarial reviewer to inspect the actual diff when risk is meaningful.
7. Codex alone commits and, when authorized, runs `./deploy.sh` plus public smoke checks.

## Dispatch matrix

| Risk | First evidence lane | Second lane only when needed |
| --- | --- | --- |
| unclear behavior / roadmap gap | `onyx-explorer` | `onyx-spec-architect` |
| UI, zoom, panels, motion | `onyx-a11y-browser-auditor` | `onyx-adversarial-reviewer` |
| IRC, storage, rendering, upload, media | `onyx-security-boundary-reviewer` | `onyx-adversarial-reviewer` |
| complex diff | `onyx-adversarial-reviewer` | focused domain reviewer |

## Stop rules

- Do not queue permanent autonomous work. Refill only independent review slots for the current slice.
- Stop a slice if it requires Orochi behavior, a new dependency, a schema/protocol change, or a release authority not in the contract; report the decision needed.
- Never run two writers in the same checkout or on overlapping paths. A worktree writer stops if the base SHA is stale or rebase conflicts.
- Never let a role modify `out/`; `./deploy.sh` is the only production writer.
