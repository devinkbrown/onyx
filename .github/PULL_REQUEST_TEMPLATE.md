## What changed

Describe the observable behavior and the affected client surface.

## Why

Link the issue or explain the user/protocol problem this solves.

## Evidence

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] Relevant focused Vitest
- [ ] Relevant Playwright journey, with connected prerequisites named
- [ ] `git diff --check`

## Security and release boundaries

- [ ] No credentials, `.env` files, user exports, deployment backups, or
      generated `out/` content are included.
- [ ] E2EE, message rendering, vault, upload, notification, or media-security
      changes include fail-closed/adversarial coverage.
- [ ] Public docs and client/server contracts were updated when behavior changed.
- [ ] This pull request does not claim a hosted deployment unless deployment
      evidence is included separately.
