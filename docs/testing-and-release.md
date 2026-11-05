# Testing and release evidence

This project distinguishes source changes, a verified build, a first-party
deployment, and a public GitHub publication. A green unit test is useful
evidence, but it is not by itself a release claim.

## Default gate

Run the repository gate from a clean-enough working tree (unrelated user work
may remain dirty, but the diff must be understood):

```bash
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
pnpm test:smoke
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node elm/tools/css-coverage.mjs
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
(cd elm && elm-test tests/DmCipherTest.elm)
node elm/e2ee.smoke.mjs
pnpm exec vitest run elm/engine/lib/e2ee
pnpm exec vitest run tools/site
```

Then rerun the full gate before publication. Strict TypeScript uses
`noUncheckedIndexedAccess`; tests should exercise malformed wire input, missing
keys, empty state, and failure paths rather than only the happy path.

## Browser tests

`elm/tools/screens.mjs` runs headless Chromium against the built Elm client
(`elm/dist-elm`) and a throwaway local fake IRC server, over the 15-viewport
aspect-ratio matrix, and reports page errors and horizontal overflow as
`PROBLEM` lines (the gate is zero):

```bash
bash elm/tools/build.sh
node elm/tools/screens.mjs --vp all --out <dir>
```

This is the right surface for route, responsive, keyboard, accessibility, and
PWA behavior. `elm/tools/call-e2e.mjs` runs a real two-browser call against a
throwaway local node (never the live network). Do not report a connected check as
green if the local server was absent.

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
3. Run the full gate above, including `git diff --check`.
4. Run the relevant screenshot scenarios and any connected checks with their real
   prerequisites; preserve failures as failures.
5. Check the package description, README opening paragraph, license, security
   policy, and public links for consistency.
6. Verify the GitHub branch and commit after pushing.
7. Treat hosted deployment as a separate explicit action; source publication
   does not deploy the application.

## First-party deployment

Only the authorized operator should run `./deploy.sh`. It builds the Elm client
and static site, overlays a separate community site, stamps the service worker,
and syncs to the nginx-served `out/` directory. Rehearse it into a temporary live
directory first: `ONYX_LIVE_OUT=/tmp/…/out ONYX_LANDING=<copy> ./deploy.sh`. A successful GitHub push is not
evidence that the hosted site changed.
