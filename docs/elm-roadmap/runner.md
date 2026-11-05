# Deterministic verification lanes

The helper is [`elm/tools/run-roadmap-checks.mjs`](../../elm/tools/run-roadmap-checks.mjs).
Its pinned toolchain is Elm **0.19.1**, elm-test **0.19.1-revision17**, pnpm
**10.33.0**, and the lock-selected esbuild package/native binary. Set `ELM_BIN`,
`ELM_TEST_BIN`, or `PNPM_BIN` to name the exact executable. Receipts record the
resolved real paths, versions, executable/package hashes, and lock hash. Missing
or mismatched tools make provenance incomplete; they do not count as a pass.

The shared selector in `elm/tools/source-closure.mjs` is the authority for both
`source-manifest.mjs` and `freeze-source-cut.mjs`. It includes tracked,
modified, and untracked Elm runtime and app sources, root `src/`, tests, browser
tests, all public assets, documentation, all root tooling, Elm roadmap evidence,
build inputs, and declared root config/workflow files. It excludes generated outputs, caches, dependency stores, and
private or secret material. The manifest hashes every selected file and mode.
The freeze command writes a normalized POSIX tar archive and manifest under
`/tmp`, verifies restore bytes/modes, and rejects a changing source set. Neither
tool writes to `out/`.

The Elm fuzz seed is **11031904** and fuzz count is **100**. The transcript
catalog is redacted and deterministic; its test values are mirrored in a new
Elm test because Elm tests cannot read workspace files. `validate-transcripts`
strictly checks the JSON shape, source revision/symbols, allowed events,
outbound-vs-inbound framing, and that every catalog case maps to a named Elm
test. It rejects unknown fields/events and missing expectations.

| Lane | Command | Scope |
|---|---|---|
| Transcript validation | `node elm/tools/run-roadmap-checks.mjs validate-transcripts` | Fixture schema and mappings only |
| Focused Elm | `node elm/tools/run-roadmap-checks.mjs elm-focused` | Main compile + `RoadmapTranscriptTest.elm` |
| Full Elm | `node elm/tools/run-roadmap-checks.mjs elm-full` | Main compile + full Elm suite |
| Port/browser JS smokes | `node elm/tools/run-roadmap-checks.mjs node-smokes` | Every `elm/*.smoke.mjs`, no file silently skipped |
| Runtime TypeScript | `node elm/tools/run-roadmap-checks.mjs runtime-tests` | Strict `elm/runtime/tsconfig.json` typecheck followed by dedicated Vitest 4 node, DOM, and fork-isolated worker projects; fake IndexedDB, `IDBKeyRange`, and WebCrypto are installed per test |
| Root gates | `node elm/tools/run-roadmap-checks.mjs root-gates` | `pnpm typecheck`, `pnpm lint`, `pnpm test` |
| Mock Chromium | `ONYX_CHROMIUM_EXECUTABLE=/path/to/chromium node elm/tools/run-roadmap-checks.mjs chromium-mock` | `pnpm test:e2e:elm`; browser executable must be explicitly supplied |
| Local server browser | `ONYX_ELM_LAB_BASE=https://127.0.0.1:PORT ONYX_ELM_LAB_WS=wss://127.0.0.1:PORT/ws node elm/tools/run-roadmap-checks.mjs browser-local` | Explicit local WSS journey; missing endpoints are an unavailable/blocked lane |
| Stress and media | `ONYX_CHROMIUM_EXECUTABLE=/path/to/chromium node elm/tools/run-roadmap-checks.mjs stress-media` | Root build to `dist/`, Chromium voice journey, then the isolated Elm stress fixture |
| Contract observations | `node elm/tools/run-roadmap-checks.mjs contract-observations` | Records both validators' actual outcomes; a disagreement remains blocked with exit 2 |
| Playwright separation | `node elm/tools/run-roadmap-checks.mjs playwright-list-audit` | Uses each declared config's `--list` output and rejects overlapping static, local, media, stress, and performance suites |
| Consolidated phase | `node elm/tools/run-roadmap-checks.mjs final` | Static, Elm, all Node smokes, runtime/root unit gates, contract observation, browser/local, stress/media, then performance last |
| Paired performance | `ONYX_PERF_BASELINE_STAGE=/tmp/prior-stage ONYX_PERF_BASELINE_RECEIPT=/tmp/prior.json node elm/tools/run-roadmap-checks.mjs performance` | Runs only with an earlier, distinct, source-bound baseline receipt and stage; otherwise records unavailable and exits 2 |
| Expected-failure proof | `node elm/tools/run-roadmap-checks.mjs expected-failure` | Mutates one assertion in a temporary Elm copy and requires an assertion failure, not a compile failure; removes the temporary tree |
| Source manifest | `node elm/tools/run-roadmap-checks.mjs manifest` | Prints source/tool fingerprint, not an acceptance claim |

`final` continues through the remaining declared stages after a lane fails so the
receipt reports the complete phase. It runs the isolated paired performance
lane last. If no distinct valid baseline is supplied, performance is explicitly
`unavailable`; a candidate-only run is not a baseline. A blocked or failed lane
does not get rewritten as a pass, and every receipt keeps
`acceptanceStatus: pending` until the ledger is reviewed against its evidence.

Each completed lane writes a mode-0600 JSON receipt under
`ROADMAP_RECEIPT_DIR` or `/tmp/onyx-roadmap-receipts`. Receipts include the
source manifest digest, command vectors, UTC timestamp, exit status, browser,
OS, network, and declared limits. Local/mock receipts are not live-server
acceptance. CI uploads these receipts as an artifact; it does not update the
ledger's acceptance status automatically.

## Current known baseline observations

These are failure observations, not retained green results:

- `pnpm test:e2e:elm` with mocked Chromium: **16 passed, 4 failed**, all at
  stale “Open connection dialog” selectors. The `Connect.` accessible name is
  intentionally retained and selectors need updating before this lane can
  pass.
- Elm port smokes: **310 passed, 1 failed** in `ctcpQuery.smoke.mjs`; its fake
  socket lacks the selected text subprotocol and its assertion still expects
  trailing CRLF. Preserve the text-protocol framing contract while repairing
  the test.
- The server repository's `python3 -B tools/check-client-contract.py` exits 1
  with `client observer/runtime/message activation split is frozen`; the
  client's `pnpm check:server-contract-v2` exits 0 after comparing the local
  v2 JSON to the server JSON. This is a validator disagreement, not a resolved
  contract or client acceptance result.

For CI, install Elm 0.19.1 and elm-test revision17 into the runner's temporary
tool directory via pinned pnpm, with install scripts disabled for elm-test. Do
not add elm-test or Elm packages to the root application's dependencies.
`ELM_HOME` should be cached by the hash of `elm/elm.json`.
`elm/tools/vendor-elm-packages.sh` is available for offline/local use; CI must
fail if dependency setup or a declared test lane is missing. Browser jobs use
the exact `--list`-audited suite configuration and an explicitly installed
Chromium binary. Local server and public-service evidence remain separate from
mock browser results.
