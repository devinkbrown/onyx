## What changed

Describe the observable behavior and the affected client surface.

## Why

Link the issue or explain the user/protocol problem this solves.

## Evidence

- [ ] `pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit`
- [ ] `pnpm typecheck` and `pnpm lint`
- [ ] `pnpm test:elm-runtime` (runtime changes) / `pnpm test` (shared `src/` or `tools/`)
- [ ] `elm make src/Main.elm` and `elm-test` (Elm changes)
- [ ] `node --test elm/*.smoke.mjs` (`ports.js` changes)
- [ ] `pnpm test:e2e:elm`
- [ ] `pnpm test:e2e:elm:audit` and screenshots (`elm/tools/screens.mjs`) for UI changes
- [ ] `bash tools/deploy-controller.test.sh` (`deploy.sh` changes)
- [ ] Local-server lab receipt (protocol, session, history or crypto changes)
- [ ] `git diff --check`

## Security and release boundaries

- [ ] No credentials, `.env` files, user exports, deployment backups, or
      generated `out/` content are included.
- [ ] E2EE, message rendering, vault, upload, notification, or media-security
      changes include fail-closed/adversarial coverage.
- [ ] Public docs and client/server contracts were updated when behavior changed.
- [ ] This pull request does not claim a hosted deployment unless deployment
      evidence (including `node tools/verify-live-shell.mjs`) is included separately.
- [ ] No secret crosses from `elm/runtime` into the Elm model, logs, URLs or storage.
