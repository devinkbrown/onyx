# Onyx Elm client

The Elm client is the browser application under `elm/`. Its current baseline,
open work, and acceptance rules are tracked in the
[Elm roadmap evidence ledger](../docs/elm-roadmap/README.md). The ledger mirrors
the read-only Onyx Server roadmap at
`/home/kain/onyx-server/docs/design/onyx-elm-client-roadmap.md`.

## Current affected verification — candidate 56 (2026-11-05)

Candidate 56 is terminal with all expected stages complete, source unchanged,
and clean children. The aggregate is incomplete because the current-only v2
measurement did not meet its heap target. Its 2,118-file source cut has manifest
digest `f22f69806adf62303cc16f9b000f5650054c74ec3edfe1164e9e74b72da50d61` and
archive SHA-256
`6e9cb7ded1ca986f2890a17b47a32aa6194ff24265ffc01fc2db2b3201a62b42`; candidate
56 changes since 55 are documentation only.

Fresh gates passed: Elm 2,714/2,714 and Chromium mock 21/21. Runtime strict,
the 12-case focused private-provider suite, and 310 existing runtime test passes
are reused prior evidence, not candidate56 reruns. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-56-continuation-a6d3d449-8fe9-4b2c-84d2-1c6ecc6d06b2.json),
[source cut](/tmp/onyx-elm-verification-final/source-candidate-56.json),
[measurement receipt](/tmp/onyx-elm-verification-final/measure-candidate-56-a6d3d449-8fe9-4b2c-84d2-1c6ecc6d06b2.json),
and [terminal checkpoint](/tmp/onyx-elm-verification-final/wave56-terminal-checkpoint.json).

The desktop v2 lane recorded input p95 40.4 ms and maximum ingest long task
159 ms, within their 100 ms and 200 ms limits. Active-page post-GC heap growth
was 16.0929%, above the 10% target. The emulated-mobile lane hit its local
10-second wait for cycle 1 item 999; the 600-second lane watchdog did not
expire, and there are no completed mobile metrics. No baseline was available,
so there is no comparison or improvement claim. See the
[measurement method](../docs/elm-roadmap/performance-methodology.md). This
result does not establish roadmap completion.

## Historical affected verification — candidate 52 (2026-11-05)

Candidate 52 is terminal with `completeExpectedStageIds: true`,
`sourceUnchanged: true`, and clean children, but the aggregate result is
incomplete because the current-only measurement failed. Its source manifest
digest is
`562dc8747c4d76babcf814947f81ee414ad3e0511636eb7c8911bfae7304cc1c` and
archive SHA-256 is
`8fc53895bfd4b76dd6c252f9b5cd21a329dacf605d5b2e692424b48d7bab665a`. The wave changes only
`elm/ports.js` and `elm/threadReveal.smoke.mjs` from candidate 51. Fresh passes:
ports syntax, thread-reveal smoke, lint, focused live-tail browser (2/2), and
two-node authenticated foundation. Runtime strict typecheck, runtime 310/310,
and Elm 2,714/2,714 are reused candidate 50 evidence because those inputs are
unchanged; they were not rerun in candidate 52. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-52-95f4d394a010456abccccdae168f4928.json),
[source cut](/tmp/onyx-elm-verification-final/source-candidate-52.json),
[terminal checkpoint](/tmp/onyx-elm-verification-final/wave52-terminal-checkpoint.json),
and [measurement receipt](/tmp/onyx-elm-verification-final/measure-candidate-52-95f4d394a010456abccccdae168f4928.json).

The candidate-only desktop measurement recorded 100,000 vault rows, 50 rooms,
1,000 roster rows, 120 loaded/rendered messages, 400 durable rows, 50 input
samples, and 5,000 ingest events. Input p95 was 40.4 ms and maximum ingest long
task was 119 ms; last-three-cycle heap growth was 135.16%, above the 10% limit.
The emulated-mobile lane timed out after dataset-ready while waiting for cycle 2
item 999; it produced no completed mobile metrics. No baseline was available,
so there is no performance comparison or improvement claim. This result does
not establish roadmap completion.

## Architecture

- `src/Main.elm` owns `Browser.application` and interprets typed outbound
  effects through ports.
- `src/App.elm` owns the pure application model, update transitions, and
  inbound IRC line fold.
- `src/Wire.elm`, `src/Session.elm`, `src/Isupport.elm`, `src/Labels.elm`, and
  focused domain modules own pure protocol and policy behavior.
- `src/View.elm` and `src/View/*` render the application and public routes.
- `ports.js` owns browser facilities such as WebSocket, storage, crypto,
  WebAuthn, notifications, and media adapters.
- `tests/` contains Elm regression and vector tests; `*.smoke.mjs` files
  exercise browser-port adapters under Node.
- `elm.json` pins the Elm application, Elm compiler version, and Elm test
  package closure. Keep direct, indirect, and test-indirect packages complete.

The TypeScript tree is a historical behavior oracle for mirrored vectors; the
Elm browser entrypoint does not import the SolidJS runtime. See the
[source ownership map](../docs/elm-roadmap/module-ownership.md) for each
current module and its direct Elm tests.

## Historical affected verification — candidate 50 (2026-11-05)

Candidate 50 ended incomplete with `sourceUnchanged: true` and all started
children clean. Its source manifest digest is
`bf130611dda8cd9d7605b0d1ef6f10999b11d2ed52a907c5f322c4ffc64e244d` and
archive SHA-256 is
`4a4489e6e32c3e2b1ea52c1c7012f69e623ba83722194aec38b7b5629758347f`. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-50-ebbfd98a372a43c28d851f22cadd14df.json),
[source cut](/tmp/onyx-elm-verification-final/source-candidate-50.json), and
[terminal checkpoint](/tmp/onyx-elm-verification-final/wave50-terminal-checkpoint.json).

Runtime strict TypeScript and lint passed; the runtime suite passed 310/310
and Elm passed 2,714/2,714. Chromium mock passed 20/21: the desktop 1280px
live-tail test found row 199 outside the viewport before reaching its reading
bar and “Back to latest” assertions. Its 390px counterpart passed. The
authenticated foundation and current-only performance stages were not run
after this failure. No current-only performance result is available.

Candidate 49's profile-only retry exported a first-1,000-event mobile CPU
profile (SHA-256
`20510f00dbe3bd4f0c16f5ec63353cd541dfe0c667316bdf5fddcc441c8993aa`). It
recorded no performance metrics and is not performance acceptance evidence
([retry receipt](/tmp/onyx-elm-verification-final/wave49-mobile-profile-retry-117bf7860a11477191c8a36db487ca4b.json)).

## Historical scoped verification — candidate 48 (2026-11-05)

Candidate 48 is terminal for its three-stage scope, with `sourceUnchanged: true`
and `completeExpectedStageIds: true`. Its source manifest digest is
`8532794c8a67b0d73d56f060bef3669e1b47c3eab3ac79539ed67e841640b4e3` and
archive SHA-256 is
`09db58266da6bb00714026c2426ecc9493da5e4230d3382ecf52596b37a9b200`. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-48.json),
[source cut](/tmp/onyx-elm-verification-final/source-candidate-48.json), and
[terminal checkpoint](/tmp/onyx-elm-verification-final/wave48-terminal-checkpoint.json).

Runtime strict TypeScript passed, the focused transport-owner suite passed
22/22, and root lint passed. Candidate 48 changes only
`elm/runtime/transport-owner.test.ts` from candidate 47: it corrects optional
callback fixtures and the test observation arrays. Production files are
unchanged. This scoped run does not rerun the candidate-47 aggregate or
performance measurement ([integration receipt](/tmp/onyx-elm-verification-final/wave48-integration.json)).

## Historical affected verification — candidate 47 (2026-11-05)

Candidate 47 is terminal with `sourceUnchanged: true` and
`completeExpectedStageIds: true`, but its aggregate result is incomplete. Its
source manifest digest is
`362436f90888ce933cad0d164491a692940ea162efb80e98c558264af52b97f5` and
archive SHA-256 is
`cc47af557b3df26a9ed655783831c07461225d304f78fb7771997e33e6d7c529`. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-47.json)
and [terminal checkpoint](/tmp/onyx-elm-verification-final/wave47-terminal-checkpoint.json).

Fresh passes included root unit tests 7,631/7,631 across 611 files, Elm
2,710/2,710, and Chromium mock 21/21. Root typecheck/lint, Node smokes,
stress-browser, foundation auth, and E84/E91 strict typechecks also passed.
Runtime strict typecheck and runtime unit tests failed on test fixture issues
corrected in candidate 48; the current-only measurement also did not complete.

E84 observed the server refuse Cadence DTLS with `DTLS_UNAVAILABLE` after the
probe sent a valid 32-octet SHA-256 browser fingerprint; browser Opus/VP8
capabilities were observed. This is not codec or media interoperability. E91
completed WebTransport registration, ping/pong, text canary, and ECHO CAP
acknowledgement, while `SESSIONTOKEN` was source-refused. WSS authentication,
join, canary, and explicit fallback checks passed; policy parity and media
remain unproven ([E84 receipt](/tmp/onyx-elm-verification-final/e84-cadence-dtls-candidate-47.json),
[E91 receipt](/tmp/onyx-elm-verification-final/e91-investigation-candidate-47.json)).

The E90 desktop lane met its thresholds: input p95 38.6 ms, maximum ingest
long task 183 ms, and last-three-cycle raw heap growth -35.9995% across 5,000
ingest events. The failure snapshot showed cycle 2 items 880–999; the overall 180-second
timeout occurred while reading the loaded-row attribute, so there is no
completed mobile lane. No baseline rows were
available, so there is no comparison or improvement claim. The result is
Chromium viewport emulation, not physical mobile evidence
([measurement receipt](/tmp/onyx-elm-verification-final/measure-candidate-47.json)).

## Historical verification — candidate 46 (2026-11-05)

Candidate 46 is terminal with `completeExpectedStageIds: true` and
`finishedAtUtc: 2026-11-05T05:39:25.247306+00:00`. Its source manifest is
`84c40fa51901df1b2b7d4b246012d07da6acf40d22635868c50cb0e67e4de8f7` and
archive SHA-256 is
`eb3e3c160c8ba8882f3c6cf51be77a86dae97bad748012b998c052320801f696`, bound by
the [source cut receipt](/tmp/onyx-elm-verification-final/source-candidate-46.json)
and [affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-46.json).

Ports syntax and lint passed; thread-reveal smoke passed 24/24. E91 was not
rerun: its candidate-45 observation reuses unchanged transport TypeScript and
runtime inputs, and the new `ports.js` follow behavior is outside that prototype
harness. The 2,705/2,705 Elm result remains candidate-44 unchanged-Elm-scope
evidence. Candidate 46 did not rerun the full application, Elm, or runtime
test suites.

Candidate-46 E90 current-only measurement failed without baseline comparison.
Desktop recorded 100,000 vault rows, 50 rooms, 1,000 roster members, 120
initial/loaded rows, 400 durable rows, 50/50 input samples, and 5,000 ingest
events. Input p95 was 40.3 ms and heap growth -53.1967%; the 281 ms maximum
ingest long task exceeded the 200 ms limit. Emulated mobile missed cycle 0 item
499 within 10 seconds after dataset-ready, so no mobile measurement was
recorded ([measurement receipt](/tmp/onyx-elm-verification-final/measure-candidate-46.json), [run log](/tmp/onyx-elm-verification-final/measure-current-only-candidate-46.log)).
No performance comparison or roadmap completion is claimed.

## Historical verification — candidate 45 (2026-11-05)

Candidate 45's observation batch is terminal with `sourceUnchanged: true`;
acceptance remains pending. Its manifest is
`f6b786b74753605a0cd9746897f489dd28ebe84ca393e73e23793308c5a585f3` and
archive SHA-256 is
`4886ea94661369cfb5a5020fc06eaf38a87d8bbec041ead161181f841700d82c`. See the
[candidate 45 receipt](/tmp/onyx-elm-verification-final/affected-candidate-45.json).

E91 exited 0 with the expected observation complete: WebTransport registration,
ping/pong, text canary, ECHO CAP acknowledgement, and `SESSIONTOKEN` source
refusal were observed; WSS auth/join/canary and explicit fallback checks also
passed. This does not establish WSS policy parity or media transport
([E91 receipt](/tmp/onyx-elm-verification-final/e91-investigation-candidate-45.json)).

Transport and performance strict typechecks, runner syntax, and lint passed.
The mobile profile diagnostic exited 1 after cycle 0 item 499 was not observed;
it is explicitly excluded from acceptance, though a CPU profile was captured
([diagnostic log](/tmp/onyx-elm-verification-final/mobile-profile-diagnostic-candidate-45.log)).
Its stage hash matched candidate 44 before and after
(`f9888df39f63f5d92d9fe292c7eadb33aa5e583cfe3f5e4752c95a391fd34f34`).
Candidate 45 did not rerun the full application, Elm, or runtime test suites.

Desktop E90 thresholds and metrics remain candidate-44 evidence only; candidate
45 produced no desktop measurement. No roadmap completion is claimed.

## Historical verification — candidate 44 (2026-11-05)

Candidate 44 was terminal with `sourceUnchanged: true` and
`aggregatePass: false`. Its source manifest is
`59016b365bf775c04bdeb79799311cd391798f1979fff5c960f9a9dd495ac877`; the
restored archive SHA-256 is
`6758e103fcd99a889aec148683289b7c49257028120fde8878540f585cb268de`. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-44.json)
and [terminal checkpoint](/tmp/onyx-elm-verification-final/wave44-terminal-checkpoint.json).

Fresh Elm tests passed 2,705/2,705; strict transport TypeScript, runner syntax,
and lint passed. E91 remains `unknown` after `wt-framing-timeout`: ECHO CAP was
advertised and acknowledged, and the `SESSIONTOKEN` command was source-refused
(separate from SASL `SESSION-TOKEN`). WT JOIN/NAMES and text-canary proof remain
unobserved. WSS authentication, join, canary, and fallback checks passed
([E91 receipt](/tmp/onyx-elm-verification-final/e91-investigation-candidate-44.json)).

E90 desktop reached 100,000 vault rows, 50 rooms, 1,000 roster members, 120
initial/loaded rows, 400 durable rows, 50/50 input samples, and 5,000 ingest
events; p95 was 40 ms, max long task 145 ms, heap growth -33.705%, with all
desktop thresholds met. Emulated mobile missed cycle 0 item 499 within 10
seconds after dataset-ready, so no mobile measurement was recorded. Baseline
and comparison are unavailable; no improvement is claimed ([receipt](/tmp/onyx-elm-verification-final/measure-candidate-44.json), [run log](/tmp/onyx-elm-verification-final/measure-current-only-candidate-44.log)).

Formal package acceptance remains E00, E02, E03, and E04; 0/74 T scenarios and
0/11 M milestones are accepted. This is not a completion fraction.

## Historical verification — candidate 43 (2026-11-05)

Candidate 43 was a terminal affected run. Its source manifest is
`118455d72ad7110c535cd5828763acffcd623d810deb58896ca61c2ad97e032f` and the
restored source archive SHA-256 is
`d3eb8c5bfa229509dbaa721b9e6b24ce54c8bbf7535e66a8d05b517f5bdba44c`. The
terminal checkpoint records `sourceUnchanged: true` and `aggregatePass: false`.
See the [candidate 43 affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-43.json)
and [terminal checkpoint](/tmp/onyx-elm-verification-final/wave43-terminal-checkpoint.json).

Fresh candidate 43 passes: runtime strict TypeScript; 278 runtime tests; root
lint; the HTTPS harness's three tests; Chromium mock 21/21; and stress-browser
1/1. The E84 standards investigation returned the expected source refusal
`NO_CODECS` for browser Opus/VP8, with actual Chromium codec capability and a
generated/sent 32-octet SHA-256 fingerprint. This is a refusal observation,
not codec or media interoperability ([standards receipt](/tmp/onyx-elm-verification-final/e84-standards-candidate-43.json)).
E84 Cadence-DTLS exited 1 with an
`unknown` result at `server-startup`; containment and server source binding
were verified, but no browser codec, fingerprint, or server refusal was
observed. Its startup cause remains unresolved ([Cadence-DTLS receipt](/tmp/onyx-elm-verification-final/e84-cadence-dtls-candidate-43.json)).
The candidate 43 E91 result is
also `unknown` (`wt-framing-timeout`); WebTransport text echo and the
specialized session-token refusal remain unobserved ([E91 receipt](/tmp/onyx-elm-verification-final/e91-investigation-candidate-43.json)).

Candidate 43 did not rerun the full Elm suite. The source-42 initial receipt
reports 2,705/2,705 Elm tests passing and records a child-leak observation,
with owned children stopped and `childrenClean: false`. Candidate 43's
changed-since-42 list excludes `elm/src/` and `elm/tests/`, so this remains
unchanged-Elm-42 evidence, not a fresh candidate-43 stage ([source-42 initial
receipt](/tmp/onyx-elm-verification-final/affected-candidate-42.json)). Root
unit tests remain candidate-37-scoped evidence (7,631/7,631 across 611 files);
they were not rerun in candidate 43.

The candidate-43 E90 current-only measurement failed. Desktop recorded 50/50
input samples at p95 38.5 ms, a maximum ingest long task of 353 ms, and
last-three-cycle raw heap growth of 11.740296%, exceeding the 200 ms and 10%
limits. The emulated-mobile run failed to observe cycle 0 item 499 within its
10-second assertion and recorded no mobile measurement. No baseline rows were
supplied, so comparison is unavailable and no performance improvement is
established. CPU-throttled viewport emulation is not physical mobile evidence
([E90 receipt](/tmp/onyx-elm-verification-final/measure-candidate-43.json)).

Formal package acceptance remains four scoped reviews: E00, E02, E03, and E04.
This is not a roadmap completion fraction; 0/74 T scenarios and 0/11 M
milestones are accepted.

## Historical checkpoints through candidate 34

Candidate 26 is the last complete affected cut: `c2f3a40addd912cd6f8115a1388ac6cc059899974f2eb5a51faa6a09cbf88ed0` (restored archive
SHA-256 `4178c8d274d2c328491a7feedfef54aa56e3cd4d6ea6df64f63967afeb1fffae`). The source remained unchanged during the cut. Full Elm
2,613, Chromium mock 20/20, stress 8/8, and the real two-node foundation's five
assertions plus cleanup passed. Runtime TypeScript (131/22 files) and lint (25)
are unchanged-scope reuse from candidate 25, not candidate-26 runs. Subsequent
E01 catalog/consumer work is outside this evidence cut. Candidate 33 later
passed the expected-failure lane, but its source-bound result does not cover
Wave 34 or establish E04 acceptance.

Candidate 25's test-only correction fixed an expectation that had incorrectly
required a redacted row to remain public. Its storage path reuses immutable
admitted rows before normalization with bounded exact-version/owner cleanup,
reuses canonical-target retention per put, atomically merges messages and
metadata with a monotonic expiry floor, prunes once per target, and enforces
400-row/TTL limits including late-expired inserts. The 121-snapshot regression
passed with 123 puts and two transactions. Redaction returned 122 public rows;
an exact scoped durable tombstone confirmed 123 stored.

Earlier scoped ordinary lab paths passed for logical session (raw 8 plus
bootstrap), exact session (raw 9 plus bootstrap), and logical history (raw 10
plus bootstrap). Aggregate session/history exit-2 receipts reflect explicitly
untested fault-injection/equal-time/rate gates; ordinary paths did not fail.
Three-node exact local RESUME deadline and logical DM mirror timeout remain
unresolved observations, not proven deadlocks. Candidate 26's two-node
foundation passed five assertions and cleanup. Full T27–T28 remains open.

Candidate-26 paired performance exited 2: baseline production-v5 initialization
failed; the current candidate timed out at 180 seconds during
`joinConfiguredRooms`. No metrics were collected. The receipt's
`performanceThresholdStatus: thresholds-met` is vacuous because observations
are empty; it is not a pass. See the [integration closure]
(../docs/elm-roadmap/integration-closure.md) for status and prerequisites.

Candidate 27 was a frozen but failed cut: strict runtime TypeScript passed and
runtime tests passed 146/148 with two fixture assertion failures. At that
checkpoint, candidate 30 was the latest affected cut. Production and Elm test modules compile,
but Elm reports 2,635/2,664 tests passing with 29 failures. Runtime TypeScript
(148 tests across 23 files) and strict TypeScript are unchanged-scope reuse from
candidate 28, not candidate-30 runs. Later Node, expected-failure, lint,
Chromium, stress, and real-foundation stages were not run after the Elm failure.
Candidate 30 was not an aggregate pass. Wave 31 E22/E24 source authoring is
subsequent and unverified. Candidate 33 ran the E13 keyboard fixture and one
journey failed; screen-reader and real-server evidence remain absent.


## Candidate 33 historical run and Wave 34 status

Candidate 33 was a terminal failed affected run. Its unchanged
source manifest digest is `a86ddd837be220fe7cbfc11d09c8401e7a99630d3266c4529be323cb81351d75`
(archive SHA-256 `7d43e61ad49b2d52dae075419b7790b5274d1852ee999d24cddab02277846755`).
Runtime tests passed 249/268, Elm 2,669/2,697, Chromium 20/21, and root unit
tests 7,613/7,628; other stage outcomes are recorded in the roadmap evidence
checkpoint. This is not an aggregate pass.

At the Wave 34 checkpoint, its server-follower correction was source-only and
unverified. It keeps
semantic Event Spine publication distinct from each actual caller-facing wire
reply. Current server-backed EVENT, NOTICE, FAIL/WARN, prefixless-failure, and
direct-reply forms remain command-specific; no universal EVENT conversion is
specified. The local source-supported OPER plus
SQUIT/CONNECT lab fault scenario had no execution receipt at that checkpoint.
Later source37/38 evidence and current candidate43 results are recorded in the
[roadmap evidence README](../docs/elm-roadmap/README.md). The 170 atomic T assertion definitions are
definitions, not test results or acceptance.

## Historical candidate 34 terminal checkpoint and Wave35 fixture work

Candidate 34 was a terminal affected run before the later source37–43 cuts and
failed. Receipt:
`/tmp/onyx-elm-verification-final/affected-candidate-34.json`; source manifest
`dfebd14c11443185eb90ea207e958da83b39f71e4cc541862f9972a5c9416906`, archive
SHA-256 `f1a263c2a8e2ff58f807606937d60de02e7c6224a9d51174cc9bfe06f8957fff`,
source unchanged. Root passed 7,626/7,629 tests across 611 files; runtime
274/276; Elm 2,688/2,699; Chromium 20/21. Schema, TypeScript, lint, Node
smokes, expected-failure, stress, and authenticated two-node foundation
passed. Candidate 34 is not an aggregate pass.

Two-node ordinary session assertions passed (8/8 logical, 9/9 exact, plus
bootstrap 1/1 each); fault-injection remained blocked. Line3 logical stopped
before 381 because the operator/group prerequisite was unavailable. Line3
exact observed `TEMPORARILY_UNAVAILABLE` during detached restore, cause
unresolved. History ordinary assertions passed 101/101 plus bootstrap 1/1;
rate-limit and equal-time checks were blocked.

At the Wave35 checkpoint, fixture corrections were being authored in an
isolated copy and had not been tested. Later bounded E00/E04 reviews raised
formal package acceptance to four scoped reviews; T/M acceptance remained
pending.


## Pinned toolchain

- Elm compiler: **0.19.1**
- `elm-test`: **0.19.1-revision17**, installed via **pnpm**
- Test seed: **11031904**; fuzz count: **100**
- Elm packages: exact versions recorded in `elm.json`
- JS dependencies: exact resolution recorded in root `pnpm-lock.yaml`

Do not use npm. For a local tool installation, make a temporary pnpm project
outside the application dependency graph and disable elm-test's networked
prepare hook. One supported pattern is:

```sh
mkdir -p /tmp/onyx-elm-tools
printf '{"private":true}\n' > /tmp/onyx-elm-tools/package.json
pnpm --dir /tmp/onyx-elm-tools add --save-exact --ignore-scripts elm-test@0.19.1-revision17
```

Install the official Elm 0.19.1 compiler into a temporary tools directory, set
`ELM_BIN`, `ELM_TEST_BIN`, `ELM_HOME`, and keep generated artifacts under `/tmp`
or `elm-stuff/`. The documented environment used for local verification is
`ELM_HOME=/tmp/onyx-elm-home`. The optional
[`vendor-elm-packages.sh`](tools/vendor-elm-packages.sh) script fills the
package cache for an offline run; it does not edit project dependencies.

## UI audit suite (Playwright, mock wire)

`tests/e2e/elm-audit-*.spec.ts` encode the UI audit findings (one test per
finding id), every shell surface, keyboard-only journeys, every public route,
the profile overlay, the brand mark, every built-in look (with AA contrast
checks and screenshots), and the `/stats` widgets against a mocked feed. The
specs only ever talk to a mock IRC server answered through
`page.routeWebSocket` (`tests/e2e/elm-audit-wire.mjs`); nothing reaches the
live network.

```sh
pnpm test:e2e:elm:audit                              # chromium, chromium-light, chromium-reduced-motion, iphone-13, iphone-13-light, iphone-se
pnpm test:e2e:elm:audit -- --project iphone-13 elm-audit-findings
ONYX_AUDIT_ORIGIN=http://127.0.0.1:8933 pnpm test:e2e:elm:audit   # against an already-served build
ONYX_FIREFOX_EXECUTABLE=/path/to/firefox-wrapper pnpm test:e2e:elm:audit -- --project firefox
```

Stock Firefox runs over WebDriver BiDi (`moz-firefox` channel). Under BiDi,
Playwright's trace/snapshot instrumentation raises a page error
(`Permission denied to access property "length"`) on every page while plain
Firefox logs none, so the specs ignore that one message; it is a harness
artifact, not product code.

## Deterministic lanes

From the repository root:

```sh
node elm/tools/run-roadmap-checks.mjs validate-transcripts
node elm/tools/run-roadmap-checks.mjs elm-focused
node elm/tools/run-roadmap-checks.mjs elm-full
node elm/tools/run-roadmap-checks.mjs node-smokes
```

The runner fails if the required tool version or test lane is missing. Focused
and full Elm runs compile `src/Main.elm` first. The broader root gates, mock
Chromium journey, source manifest, and isolated expected-failure proof are
documented in [`docs/elm-roadmap/runner.md`](../docs/elm-roadmap/runner.md).

To fingerprint the current tracked, dirty, and untracked source closure without
printing file contents:

```sh
node elm/tools/source-manifest.mjs > /tmp/onyx-elm-source-manifest.json
```

The digest covers Elm source/tests/assets, E2E files, declared Elm build tools,
CI inputs, root build/lint configuration, package lock, and copied public shell
assets. It excludes dependency caches, generated outputs (`dist/`, `out/`,
`elm-stuff/`), and private material. A digest identifies the input tree; it does
not claim a build or acceptance pass. Only `deploy.sh` may write `out/`.
