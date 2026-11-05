## What changed

Describe the observable behavior and the affected client surface.

## Why

Link the issue or explain the user/protocol problem this solves.

## Evidence

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `elm-test` and the relevant `elm/*.smoke.mjs` suites (Elm changes)
- [ ] Relevant focused Vitest (engine / site changes)
- [ ] Real-browser screenshots (`elm/tools/screens.mjs`) for UI changes
- [ ] `git diff --check`

## Security and release boundaries

- [ ] No credentials, `.env` files, user exports, deployment backups, or
      generated `out/` content are included.
- [ ] E2EE, message rendering, vault, upload, notification, or media-security
      changes include fail-closed/adversarial coverage.
- [ ] Public docs and client/server contracts were updated when behavior changed.
- [ ] This pull request does not claim a hosted deployment unless deployment
      evidence is included separately.
