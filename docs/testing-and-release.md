# Testing and release evidence

Source changes, a verified build, a first-party deployment and a GitHub
publication are different claims. A green unit test is evidence, not a release.

## Default gate

```bash
pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit   # runtime strict TS
pnpm typecheck                                        # shared src/ TS
pnpm lint
pnpm test:elm-runtime                                 # runtime Vitest (node, DOM, worker)
pnpm test                                             # root Vitest (src/, tools/)
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
node --test elm/*.smoke.mjs                           # 60 ports.js smokes
pnpm test:e2e:elm                                     # Chromium, mock socket
git diff --check
```

Playwright configs build into `/tmp` and serve on loopback. None of them write
`out/`.

Counts at `d1025b7f` (2026-11-06): elm-test 2895, runtime 385, Chromium mock 36,
audit 628, smokes 60, deploy controller 122, all passing.

## Focused iteration

```bash
(cd elm && elm-test tests/DmCipherTest.elm)
node --test elm/e2ee.smoke.mjs
pnpm exec vitest run --config elm/vitest.runtime.config.ts elm/runtime/transport-owner.test.ts
pnpm exec vitest run src/lib/e2ee
```

Test malformed wire input, missing keys, empty state and failure paths, not only
the happy path.

## UI audit

```bash
pnpm test:e2e:elm:audit
ONYX_FIREFOX_EXECUTABLE=/path/to/firefox pnpm test:e2e:elm:audit -- --project firefox
```

628 checks across `chromium`, `chromium-light`, `chromium-reduced-motion`,
`iphone-13`, `iphone-13-light` and `iphone-se` (Chromium device emulation).
Firefox is opt-in and runs stock Firefox over WebDriver BiDi (`moz-firefox`).
Mock-socket results aren't evidence about a real server or a real phone.

Screenshots for review:

```bash
node tools/build-elm-site.mjs /tmp/onyx-site
node elm/tools/screens.mjs --site /tmp/onyx-site
```

## Local-server labs

Run against a throwaway local Onyx Server binary, never production:

```bash
node elm/tools/lab/run.mjs \
  --server-bin /path/to/onyx-server --server-source /path/to/onyx-server \
  --server-build-receipt /tmp/server-build.json \
  --scratch-parent /tmp --topology two|line3 \
  --suite foundation|sessions|history|group --scenario logical|exact \
  --receipt /tmp/onyx-elm-lab.json
```

| Suite | Checks |
| --- | --- |
| `foundation` | WSS registration, CAP/005, framing, in-session sign-in, authenticated canary send |
| `sessions` | Multi-attachment session resume and DM/channel delivery across nodes |
| `history` | CHATHISTORY paths |
| `group` | Two-browser encrypted room, 8 stages: sign-in, required-encryption room, enroll, founder genesis, ciphertext send, member trust review and rotation, member decrypt and send, device removal to a new epoch |

Without `--server-build-receipt` the binary isn't bound to its source, so the
result is functional only. Lab source provenance is currently blocked while
onyx-server is mid-change. Details: [`../elm/tools/lab/README.md`](../elm/tools/lab/README.md).

## Performance

```bash
node elm/tools/perf/run.mjs --suite=measure
```

Desktop and 4x-CPU emulated mobile lanes against 100,000 vault rows. Results
are Chromium emulation, not device evidence. Method:
[`elm-roadmap/performance-methodology.md`](elm-roadmap/performance-methodology.md).

## Roadmap acceptance

Formal acceptance uses source-bound receipts from `elm/tools/run-roadmap-checks.mjs`
(see [`elm-roadmap/runner.md`](elm-roadmap/runner.md)) and is recorded in
[`elm-roadmap/acceptance-ledger.json`](elm-roadmap/acceptance-ledger.json).
Runs on an unfrozen working tree don't promote anything.

## Security-sensitive evidence

Crypto and privacy changes need positive and negative tests:

- E2EE seals fail closed and never downgrade to plaintext;
- ciphertext stays ciphertext in the vault, notifications and lock screen;
- a changed or untrusted device key is never silently accepted;
- room ciphertext without a key renders a locked placeholder;
- group control payloads are untrusted until verified against device trust;
- media UI never shows a padlock for a merely authenticated relay.

Read [`security.md`](security.md) first.

## Deploying (first-party)

Only the operator runs `./deploy.sh`. Rehearse into a scratch target first:

```bash
DEPLOY_DRY_RUN=1 ./deploy.sh
ONYX_LIVE_OUT=/tmp/onyx-rehearsal/out ./deploy.sh
```

A real deploy backs up the live tree and restores it automatically if
post-sync checks fail. Afterwards:

```bash
node tools/verify-live-shell.mjs https://eshmaki.me
```

Every precached asset must match its hash, or the service-worker install fails
and returning visitors stay on the previous build. A GitHub push isn't evidence
the hosted site changed.

## Public-release checklist

1. Review `git status`, `git diff --stat` and the staged file list.
2. No generated output, backups, credentials, `.env*` or machine paths.
3. Run the default gate and the relevant audit, lab or perf lanes; keep
   failures as failures.
4. Check README, `package.json` description, license and security policy agree.
5. Verify the pushed branch and commit.
