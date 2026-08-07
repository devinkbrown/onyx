# Testing and release evidence

This project distinguishes source changes, a verified build, a first-party
deployment, and a public GitHub publication. A green unit test is useful
evidence, but it is not by itself a release claim.

## Default gate

Run the repository gate from a clean-enough working tree (unrelated user work
may remain dirty, but the diff must be understood):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

Or use the equivalent safe wrapper:

```bash
pnpm site:check
```

The gate builds `dist/` and must not write `out/`.

## Focused iteration

While changing a narrow subsystem, run the smallest relevant test first:

```bash
pnpm exec vitest run src/lib/e2ee
pnpm exec vitest run src/lib/vault/historyVault.test.ts
pnpm exec vitest run src/shell/MessageView.test.ts
```

Then rerun the full typecheck, lint, and test gate before publication. Strict
TypeScript uses `noUncheckedIndexedAccess`; tests should exercise malformed
wire input, missing keys, empty state, and failure paths rather than only the
happy path.

## Browser tests

The Playwright config runs Chromium against a production preview on port 4173:

```bash
pnpm test:e2e
```

This is the right surface for route, responsive, keyboard, accessibility, and
PWA behavior. Connected tests are different: `tests/e2e/dm-e2ee.spec.ts` uses
the development-only `window.__onyx` handle and needs a development app plus a
reachable test WebSocket. Run that contract explicitly with the environment
documented at the top of the spec. Do not report a connected test as green if
the test server or development app was absent.

For connected journeys, record:

- the app URL and server endpoint used;
- whether the server was local or a live origin;
- the test name and pass count;
- browser permissions/media fakes where relevant;
- any server capability or TLS prerequisite.

## Security-sensitive evidence

Crypto and privacy changes need focused tests for both positive and negative
paths. In particular:

- E2EE DM seals must fail closed and never downgrade to plaintext;
- ciphertext must remain ciphertext in the store, vault, notifications, and
  lock-screen body;
- a changed or untrusted device key must not be silently accepted;
- room ciphertext without a room key must render a locked placeholder;
- group E2EE control payloads must be treated as untrusted until verified
  against an external device trust source;
- media UI must not show a private padlock for a merely authenticated relay.

Read [`security.md`](security.md) before changing one of these sinks.

## Public-release checklist

Before pushing a public release:

1. Review `git status`, `git diff --stat`, and the complete staged file list.
2. Confirm generated output, backups, credentials, `.env*`, and local machine
   paths are not being added accidentally.
3. Run typecheck, lint, unit tests, build, and `git diff --check`.
4. Run the relevant Playwright route and connected tests with their real
   prerequisites; preserve failures as failures.
5. Check the package description, README opening paragraph, license, security
   policy, and public links for consistency.
6. Verify the GitHub branch and commit after pushing.
7. Treat hosted deployment as a separate explicit action; source publication
   does not deploy the application.

## First-party deployment

Only the authorized operator should run `./deploy.sh`. It overlays a separate
community site, materializes route documents, stamps the service worker, and
syncs to the nginx-served `out/` directory. A successful GitHub push is not
evidence that the hosted site changed.
