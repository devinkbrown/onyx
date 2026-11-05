# Elm roadmap evidence

## Session 2026-11-05 (Claude): audit fixes, encrypted rooms, Firefox, deploy

No ledger row was promoted. These runs are not bound to a frozen source cut,
and that binding is what acceptance requires.

- **Encrypted rooms work end to end against a real local Onyx Server.** The
  local-server lab (`--suite group`) passes all 8 stages: sign-in,
  required-encryption room, enroll, founder genesis, ciphertext send, member
  trust review and rotation, member decrypt and send, and device removal to a
  new epoch. Receipt: `evidence/group-lab-post-candidate-57.json`
  (build-proven server, `currentSourceAcceptance=pass`). About 15 product bugs
  were fixed on the way. Device-trust review (trust-preview/confirm) is new
  code and needs independent security review. Rooms with three or more members
  and cross-node delivery are unproven.
- **Strict acceptance audits** of E10–E14, E20–E24, E30–E35, E40–E44 and
  E100–E103 found specific test gaps and product defects. About 60 focused tests
  were added and about 25 product defects fixed, each mutation-checked:
  - REDACT arriving before its original
  - read markers moving backwards
  - nick-based message ownership and guest device memory
  - forged EVENT MEDIA accepted from any source
  - optimistic PROP writes
  - fixed rank ladder
  - SASL abort (`AUTHENTICATE *` / 906)
  - serverPrefix not reset on reconnect
  - prefixless session-reissue FAIL not recognised
  - "unknown" integration state treated as enabled
  - auditorium/hidden letters (`x`/`h`)

  Known product gaps that remain:
  - no localization layer
  - no LISTX fold
  - ACCESS write path unused
  - AiPolicy/HistoryPolicy unwired
  - no operator dashboard
- **Performance:** allocation-free `roomPolicyFacts` and `content-visibility`
  on transcript rows. Desktop passes, and mobile (4x CPU emulation) now passes
  the 10 s guards, input latency and heap limits. The mobile ingest long task is
  still open at about 396 ms against the 200 ms target.
- **Firefox 151** (stock build over WebDriver BiDi, opt-in project in
  `tests/e2e/elm.config.ts`): 17 of 21 mock-socket tests pass. The 4 failures
  appear to be BiDi `routeWebSocket` mock artefacts or harness assumptions;
  Firefox against the real lab server is not yet run.
- **Final gates:** runtime 383/383, Elm 2784/2784, Chromium mock 21/21, all JS
  smokes, foundation lab pass, lint 0 errors.
- **Deployed** the Elm client to eshmaki.me (`deploy.sh` now supports the Elm
  service-worker envelope).

## Current verification — post-candidate 57 working tree (2026-11-05)

This run continues the paused candidate 57 wave. It was **not** bound to a
frozen source manifest or archive, so it does not satisfy the ledger's receipt
fields and promotes no package, requirement, or cohort.

Passed on the final tree: runtime strict TypeScript, perf strict TypeScript,
root typecheck, lint (0 errors), ports syntax, Elm compile, runtime 316/316,
Elm 2,718/2,718, Chromium mock 21/21, and the authenticated two-node loopback
foundation ([receipt](evidence/foundation-post-candidate-57.json)).

Source changes in this run:

- **Scheme loss on remember (defect).** `rememberProvenOwner` reselected the
  workspace with a null conversation-key scheme and could fail the in-flight
  record's fence, with no retry. Canonical keys stayed null for the connection,
  so read anchors silently stopped reading and persisting. The `remember`
  handler now re-records the authenticated scheme. Found by the candidate 57
  cache regression, which was failing correctly.
- **Dotted group-control ingress (defect).** Server deliveries of
  `E2EE.KEYPACKAGE`, `E2EE.COMMIT`, and `E2EE.WELCOME` carry the sender's prefix
  and parse with an empty command, so the private ingress filter never matched
  them. They now reach the crypto provider and are consumed before public
  projection. Mutation-checked against the new regression. Mock-wire evidence
  only: no two-party group exchange has run against a real server.
- **Room device removal UI.** `directory-refresh` now returns the verified head,
  and each device row offers a confirmed removal bound to that epoch and commit
  hash. Decoder vectors only: not exercised in a browser or against a server.
- **Ingest cost.** Owner snapshots are memoized and identifier validation no
  longer allocates an encoder per call.

### Measurement: still failing

The current-only v3 receipt is
[`failed`](evidence/measure-post-candidate-57.json). No baseline was available,
so there is no comparison or improvement claim, and all of it is Chromium
emulation, not device evidence.

| Lane | Input p95 (limit) | Max ingest long task (limit) | Post-GC heap growth (limit) | Result |
|---|---:|---:|---:|---|
| Desktop | 39.9 ms (100) | 180 ms (200) | -6.2% (10%) | Within limits |
| Emulated mobile, 4x CPU | none | none | none | Failed: persistence guard expired on `evt-0-999` at 10 s with 2 calls pending |

Desktop heap growth varied between runs of this source (-6.2% to 7.6%).

A separate diagnostic with the persistence guard temporarily raised to 60 s
(not acceptance evidence; spec restored afterwards) gave the only completed
mobile metrics so far: input p95 67.6 ms, heap growth -2.1%, cycle 0 persistence
settlement 14.6 s, and **max ingest long task 465 ms, above the 200 ms limit**.
Open mobile work is therefore persistence settlement and that long task, whose
source is not yet attributed.

## Historical affected verification — candidate 56 (2026-11-05)

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
[performance method](performance-methodology.md). This result does not establish
roadmap completion.

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
## Historical affected verification — candidate 50 (2026-11-05)

Candidate 50 ended incomplete with `sourceUnchanged: true` and all started
children clean. Manifest digest:
`bf130611dda8cd9d7605b0d1ef6f10999b11d2ed52a907c5f322c4ffc64e244d`; archive
SHA-256: `4a4489e6e32c3e2b1ea52c1c7012f69e623ba83722194aec38b7b5629758347f`.
See the [affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-50-ebbfd98a372a43c28d851f22cadd14df.json),
[source cut](/tmp/onyx-elm-verification-final/source-candidate-50.json), and
[terminal checkpoint](/tmp/onyx-elm-verification-final/wave50-terminal-checkpoint.json).

Runtime strict TypeScript and lint passed; runtime tests passed 310/310 and
Elm passed 2,714/2,714. Chromium mock passed 20/21. The desktop 1280px
live-tail test found row 199 outside the viewport before it reached the reading
bar and “Back to latest” checks; the 390px counterpart passed. Foundation auth
and current-only performance stages were not run after the browser failure.
No current-only performance result is available.

The candidate49 profile-only retry exported a first-1,000-event mobile CPU
profile (SHA-256
`20510f00dbe3bd4f0c16f5ec63353cd541dfe0c667316bdf5fddcc441c8993aa`) but
recorded no performance metrics and is not acceptance evidence
([retry receipt](/tmp/onyx-elm-verification-final/wave49-mobile-profile-retry-117bf7860a11477191c8a36db487ca4b.json)).

## Historical scoped verification — candidate 48 (2026-11-05)

Candidate 48 is terminal for its three-stage scope with
`sourceUnchanged: true` and `completeExpectedStageIds: true`. Its manifest
digest is `8532794c8a67b0d73d56f060bef3669e1b47c3eab3ac79539ed67e841640b4e3`;
archive SHA-256 is
`09db58266da6bb00714026c2426ecc9493da5e4230d3382ecf52596b37a9b200`. See the
[affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-48.json),
[source cut](/tmp/onyx-elm-verification-final/source-candidate-48.json), and
[terminal checkpoint](/tmp/onyx-elm-verification-final/wave48-terminal-checkpoint.json).

Runtime strict TypeScript passed, the focused transport-owner suite passed
22/22, and root lint passed. This was a test-only correction to
`elm/runtime/transport-owner.test.ts`; production files are unchanged. It does
not rerun candidate 47's aggregate or performance measurement
([integration receipt](/tmp/onyx-elm-verification-final/wave48-integration.json)).

## Historical affected verification — candidate 47 (2026-11-05)

Candidate 47 is terminal with unchanged source and all expected stages
terminal, but its aggregate result is incomplete. Manifest digest:
`362436f90888ce933cad0d164491a692940ea162efb80e98c558264af52b97f5`; archive
SHA-256: `cc47af557b3df26a9ed655783831c07461225d304f78fb7771997e33e6d7c529`.
See the [affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-47.json)
and [terminal checkpoint](/tmp/onyx-elm-verification-final/wave47-terminal-checkpoint.json).

Fresh passes included root unit tests 7,631/7,631 across 611 files, Elm
2,710/2,710, and Chromium mock 21/21; root typecheck/lint, Node smokes,
stress-browser, foundation auth, and E84/E91 strict typechecks also passed. Runtime strict typecheck and runtime unit tests failed on
test fixture issues corrected in candidate 48. The current-only measurement
did not complete.

E84 observed a server refusal `DTLS_UNAVAILABLE` after sending a valid
32-octet SHA-256 browser fingerprint; browser Opus/VP8 capabilities were
observed. This is not codec or media interoperability. E91 completed
WebTransport registration, ping/pong, text canary, ECHO CAP acknowledgement,
and source refusal of `SESSIONTOKEN`. WSS auth/join/canary and explicit
fallback checks passed; policy parity and media remain unproven
([E84 receipt](/tmp/onyx-elm-verification-final/e84-cadence-dtls-candidate-47.json),
[E91 receipt](/tmp/onyx-elm-verification-final/e91-investigation-candidate-47.json)).

The E90 desktop lane met thresholds: input p95 38.6 ms, maximum ingest long
task 183 ms, and last-three-cycle raw heap growth -35.9995% across 5,000
ingest events. The failure snapshot showed cycle 2 items 880–999; the overall 180-second
timeout occurred while reading the loaded-row attribute, so there is no
completed mobile lane. No baseline rows were available, so there
is no comparison or improvement claim. This was Chromium viewport emulation,
not physical mobile evidence ([measurement receipt](/tmp/onyx-elm-verification-final/measure-candidate-47.json)).

## Historical verification — candidate 46 (2026-11-05)

Candidate 46 is terminal with `completeExpectedStageIds: true` and
`finishedAtUtc: 2026-11-05T05:39:25.247306+00:00`. Its source manifest digest
is `84c40fa51901df1b2b7d4b246012d07da6acf40d22635868c50cb0e67e4de8f7` and
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
acceptance remains pending. Its manifest digest is
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
`aggregatePass: false`. Its source manifest digest is
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

Formal package acceptance remains E00, E02, E03, and E04. This is not a roadmap
completion fraction; 0/74 T scenarios and 0/11 M milestones are accepted.

## Historical verification — candidate 43 (2026-11-05)

Candidate 43 was a terminal affected run. Its source manifest digest is
`118455d72ad7110c535cd5828763acffcd623d810deb58896ca61c2ad97e032f` and the
restored source archive SHA-256 is
`d3eb8c5bfa229509dbaa721b9e6b24ce54c8bbf7535e66a8d05b517f5bdba44c`. The
[terminal checkpoint](/tmp/onyx-elm-verification-final/wave43-terminal-checkpoint.json)
records `terminal: true`, `sourceUnchanged: true`, and `aggregatePass: false`;
see the [affected receipt](/tmp/onyx-elm-verification-final/affected-candidate-43.json)
for exact commands and stage results.

Candidate 43 freshly passed runtime strict TypeScript, 278 runtime tests, root
lint, the three HTTPS harness tests, Chromium mock 21/21, and stress-browser
1/1. Its real-browser E84 standards probe returned `server-refused / NO_CODECS`
for the detected `opus,vp8` capabilities with a generated and sent SHA-256
fingerprint. This verifies the expected current-server refusal only; it does
not establish codec or media interoperability.

The E84 Cadence-DTLS probe exited 1 with `unknown` at `server-startup`. Network
containment and the source-bound server build were verified, but the receipt
contains no browser codec/fingerprint evidence and no server reply. The current
runner waits for the two-node mesh metrics before it starts account/browser
setup; the receipt does not preserve the exact topology-startup cause. Treat it
as unresolved startup evidence, not as a client refusal or interoperability
result. The current E91 result is also `unknown` (`cleanup`,
`wt-framing-timeout`): WebTransport registration and raw ping/pong completed,
but its text canary and session-token result are absent. WSS authentication,
join, and canary echo succeeded; transport-policy parity remains unproven.

Candidate 43 did not rerun the full Elm suite. The source-42 initial receipt
records 2,705/2,705 Elm tests and a child-leak observation, with owned children
stopped but `childrenClean: false`. Candidate 43's changed-since-42 list
contains no Elm application or test files, so this is unchanged-Elm-42
evidence, not a fresh candidate-43 stage ([source-42 initial
receipt](/tmp/onyx-elm-verification-final/affected-candidate-42.json)). Root unit
tests remain candidate-37-scoped evidence (7,631/7,631 across 611 files); the
root suite was not rerun in candidate 43.

The candidate-43 E90 current-only measurement failed. Desktop recorded 50/50
input samples at p95 38.5 ms, maximum ingest long task 353 ms, and
last-three-cycle raw heap growth 11.740296%, exceeding the 200 ms and 10%
limits. The emulated-mobile run failed to observe cycle 0 item 499 within its
10-second assertion after dataset-ready and recorded no mobile measurement.
The receipt supplies no baseline rows, so comparison is unavailable and no
performance improvement is established. The result is viewport emulation, not
physical mobile evidence. These E84, E91, and E90 failures leave candidate 43's
aggregate outcome failed.

Formal package acceptance remains four scoped reviews: E00, E02, E03, and E04.
This is not a roadmap completion fraction. No T scenario or M milestone is
accepted (0/74 and 0/11). No T/M promotion, interoperability acceptance, or
roadmap completion is claimed. See the [implementation status](implementation-status.json)
and [acceptance ledger](acceptance-ledger.json).

## Historical verification — source 42 (2026-11-05)

Source 42 is frozen at manifest `757bc49a38946b19a099348d41629a67c987be2473aabb30583d4c2dd98781a7` and archive SHA-256 `07c0c95b8ea268f0ff5cf335a4668668efb9f3d600430bf9aa5c801e78eeb8ff`.
Runtime strict TypeScript passed; runtime tests passed 278/278, and Elm production compilation plus the full suite passed 2,705/2,705.
E84/E91 Node syntax and strict TypeScript checks passed; Chromium mock passed 21/21 and stress-browser passed 1/1.
Three transport probes remain **unknown** because their isolated workers produced no complete child receipt; this establishes neither namespace permission nor server refusal. The overall receipt is incomplete.
A receipt helper failed on a null binding after seven passed stages; the continuation ran only remaining checks and did not rerun those stages. [Source 42 completion receipt](/tmp/onyx-elm-verification-final/affected-candidate-42-completion.json).
E90 paired observation: Ended with open failures: desktop input p95 40.3 ms from 50 samples, max ingest task 458 ms, and raw heap growth 13.46%. Current mobile missed cycle 0 item 499 at the 10-second assertion. The baseline emitted no rows, so comparisons remain unavailable. [Paired receipt](/tmp/onyx-elm-verification-final/paired-observation-candidate-42.json).
Source 42 includes 200-row bootstrap batches, shared visible-thread projection/window day labels, and protected temporary setup.
The earlier 7,631/7,631 root tests across 611 files are source 37 evidence; root source 37 scope remained unchanged and was not rerun on source 42.
Formal package acceptance remains four scoped reviews: E00, E02, E03, and E04. This is not a roadmap completion fraction; no T/M promotion or roadmap completion is claimed.
See [implementation status](implementation-status.json) and the [acceptance ledger](acceptance-ledger.json).

This folder tracks client-side evidence for the Elm roadmap at
/home/kain/onyx-server/docs/design/onyx-elm-client-roadmap.md. The source
roadmap is read-only from this repository. Its work-package inventory is copied
into the acceptance ledger so each E00–E104 package has an explicit status,
evidence list, blockers, and separate source, configuration-permission,
deployment, and client observations. E00, E02, E03, and E04 have bounded
accepted package reviews; all other package, scenario, and milestone acceptance
remains individually pending.

## Historical verification — source 37 (2026-11-05)

The full fresh run is bound to source 37 manifest digest
5ec98ba79e58903f894ef05aea77c94b18b079b14f5fa09b7098d90c5b5b5bc6 and archive
SHA-256 a889b5eed90848a7a379b9b730ee95a1f5a3310cf864b10bcd6c7751c489ff5e.
The affected receipt records sourceUnchanged true. Root tests passed 7,631/7,631
across 611 files; Elm runtime tests passed 278/278 across 42 files; the full Elm
suite passed 2,704/2,704. Root/runtime strict TypeScript and lint, Elm production
compile, Node smokes, expected-failure lane, mock Chromium, stress-browser,
host-bridge checks, and the authenticated two-node foundation passed. The
overall affected run remains failed due to known lab outcomes below; these
passing gates do not imply full roadmap or release acceptance.

The source 37 session lab passed two-node exact sessions 13/13, line3 logical
sessions 20/20, mesh recovery 15/15, and two-node plus line3 logical history
101/101 each. Two-node logical sessions missed both A-side deliveries for the
observed canary (10/11 assertions); line3 exact sessions received
TEMPORARILY_UNAVAILABLE during detached restore after the bounded same-token
retry. Rate-limit, equal-time-boundary, and deterministic fault-injection cases
remain blocked because their server triggers were unavailable. These results
do not establish a server defect. E32 C1/C2 and E63 cache-retirement corrections
are integrated with passing candidate 37 regression evidence; oversized
equal-time history still requires a server-addressable total-order continuation.

The bounded source 38 E00/E04 row review accepts E00 and E04 only. Together with
the existing E02 and E03 reviews, formal package acceptance remains 4/53; 0/74
T scenarios and 0/11 M milestones are accepted. The source-presence 49/4
assessment below remains the historical candidate 36 census, not a current
implementation fraction. No T/M promotion, interoperability acceptance, or
release readiness is claimed.

## Follow-up evidence — sources 38–40

Source 38 is bound to manifest digest
1167bb359e1084b8d24b3736cd448d78ab9ac3b23f909fe2178c68344e60cb1d and archive
SHA-256 9a592c8c7a469630d2288a2b51bf1c695b0d998fc839242c84cb737c6275e09e.
Its scoped E84 and E91 strict TypeScript checks passed. The E84 standards,
E84 Cadence-DTLS, and E91 WebTransport probes remain unknown because isolated
workers did not produce complete child receipts. That does not prove namespace
permission, policy failure, listener startup, or server refusal.

The actual candidate 38 E90 paired observation ended with open failures, not an
in-progress measurement. Both candidate 24 baseline and candidate 38 current
builds exited successfully, but both mobile runs failed to find the configured
#perf-1 room in joinConfiguredRooms at fixtures.ts line 305. The baseline
produced no comparable measurement rows. Candidate 38 produced one desktop row
with 99 measured input samples instead of the requested 50, a maximum ingest
long task of 241 ms, and raw allocated heap growth of 40.06%; the input
cohort, long-task, and heap thresholds failed. This raw allocation metric is not a retained-heap leak
measurement. The comparison is unavailable and no performance improvement is
established. Receipt:
[paired candidate 38 observation](/tmp/onyx-elm-verification-final/paired-observation-candidate38.json)
(SHA-256 25cc6143a516f7a37b01884fbb2456efef2f4252ada93bd2ce6620ce6b352d71).

Candidate 39 changed only bounded mjs investigation files. Its terminal
diagnostic exited 1 with an unknown E91 outcome, cleanup incomplete, network
containment unknown, and no source binding. Startup stderr was unclassified and
818 bytes; the diagnostic records only its digest, not the contents. Whether a
listener started or namespace policy allowed the probe remains unknown. The
candidate 39 strict transport checks were not rerun; candidate 38 checks apply
to the unchanged TypeScript inputs only.
A separate minimal no-daemon probe successfully verified distinct network and
PID namespaces, PID 1, loopback-only networking, and dynamic import of the
current E91 runner and dependencies. It exited before invoking E91 entrypoint
logic and started no daemon, browser, or listener. This proves that bounded
namespace/module-loading probe only; it does not establish containment or
startup behavior for the full investigation. [Origin diagnosis](/tmp/onyx-elm-verification-final/e91-startup-origin-candidate39.json)
(SHA-256 6e7e3d0c22be27483cd2e739fb2f3a292796005c5e0bda6e085920214863b886).
[Candidate 39 terminal checkpoint](/tmp/onyx-elm-verification-final/wave39-terminal-checkpoint.json)
and [sanitized E91 startup diagnostic](/tmp/onyx-elm-verification-final/e91-startup-diagnostic-candidate39.json).

Source 40 is frozen at manifest digest
`aead384e05e87212f40c190cc5fcddb05fcb93da7bf8582bb263910b9d6304be` and archive
SHA-256 `91f2651ed5d7ab8776e5d11ece4effaf621772ed9ca123b9379286439dc8ed97`.
It changes lazy roster derivation, the hidden mobile rail locator, and the
50-input sample cohort. The terminal affected run reports sourceUnchanged true.
Elm full (2,704 tests), mock Chromium, and stress-browser passed; paired E90
exited 2 with `observed-with-open-failures`, so the overall candidate40 run
failed. Candidate37 root/runtime/lab results were not rerun and remain scoped to
candidate37.

Candidate24 baseline emitted no performance rows: desktop failed the exact
item999 locator after 10,000ms; mobile hit its 180,000ms Playwright test timeout
after dataset-ready, with only context closure recorded. Candidate40 desktop
emitted one observation with 50/50 input samples and p95 39.8ms (under the
100ms limit), but its maximum ingestion long task was 248ms (over 200ms) and
raw cycle3-to-cycle5 heap growth was 75.4109479% (over 10%). Candidate40 mobile
failed exact item499 visibility after its 10,000ms locator timeout following
dataset-ready; the test took 2.6m and did not hit the 180-second Playwright
timeout. The baseline has no rows, so comparison is unavailable and no
performance improvement is established. Raw heap growth is not a retained-heap
leak measurement. The source attribution found no measurement defect; it could
not identify the application task responsible for the long task or explain the
baseline visibility failure.

The outer candidate40 runner exited 1 after saving the terminal receipts because
its final `json.dumps(..., flush=True)` raised a TypeError. The terminal
checkpoint binds both receipts and the final source guard; the lane was not
rerun to repair the print. Candidate40 made no transport-source changes, so it
did not rerun E91. Candidate39 E91 startup remains unknown (stderr fingerprint
only, 818 bytes); the held candidate40 transport runner remains unverified.
Receipts: [candidate40 source manifest](evidence/source-candidate-40.json),
[affected receipt](evidence/affected-candidate-40.json),
[paired E90 receipt](evidence/paired-observation-candidate-40.json),
[terminal checkpoint](evidence/wave40-terminal-checkpoint.json), and
[bounded source-cost attribution](evidence/E90-source40-cost-attribution.json).

## Historical candidate 36 evidence checkpoint (2026-11-05)

The candidate-36 source cut is bound to manifest digest `a0253f25212636573d4a49b14fa6fcd4d57461a9b4e9fa3f7f5bb5a4172099aa`. Its affected-run receipt is `/tmp/onyx-elm-verification-final/affected-candidate-36.json`; the source was unchanged during execution, but the aggregate outcome is **failed** because two real lab cases failed. The wave36 terminal checkpoint is `/tmp/onyx-elm-verification-final/wave36-terminal-checkpoint.json`.

Candidate36 ran and passed runtime TypeScript plus 277 tests across 42 files, strict root/runtime TypeScript, root lint, Elm production compilation plus 2,699 Elm tests, Node smokes, expected-failure lane, Chromium mock 21/21, stress-browser, host-bridge schema/vector validation, and the authenticated two-node foundation (five assertions across guest/auth/browser and raw-wire checks, with cleanup). Root unit tests 7,631 across 611 files are reused from candidate35 after guarded source-input equality; they were not rerun on candidate36. Candidate numbers identify source cuts, not test totals.

The isolated lab receipts show both passing and unresolved paths. Two-node exact sessions passed 13/13 plus bootstrap; line3 logical sessions passed 19/19 plus bootstrap. Two-node and line3 logical history each passed 101/101 plus bootstrap. Two-node logical sessions failed one of 10 assertions on event-delivery cardinality; line3 exact sessions failed one of nine when the source returned `TEMPORARILY_UNAVAILABLE`; the cause remains unresolved. Rate-limit, equal-time-boundary, and fault-injection cases were blocked because the deterministic trigger was unavailable. These results do not accept the mapped T rows.

The initial candidate36 inventory reported 50 rows implementation-complete and E00, E32, E84 partial. A bounded independent E60/E63/E64 source review then found a specific E63 retirement defect: `retireWorkspace` deletes the bare owner key, while the intent-MAC cache uses the suffixed `${scope}\0intent-mac-v1` key. This is a concrete private-key-cache retirement failure; the review did not demonstrate cross-owner signing or decryption. The corrected candidate36 classification is **49 complete and 4 partial** (E00, E32, E63, E84). The initial 50/3 result remains historical rather than current independent evidence. At the candidate36 checkpoint, the bounded fix and lifecycle regression had been source-reviewed and integrated in Wave37 but had not yet been executed. Candidate36 remains its audited source snapshot and cannot certify later source. The normalized v2 aggregate is `/tmp/onyx-elm-verification-final/implementation-assessment-53-candidate36-v2.json` (SHA-256 `278e68f2d52cfe589d6e2610ae100f0fd87111a035cfd98832d03bf7b4b312fc`); it rebinds the final B artifact and the review correction. The earlier aggregate is preserved unchanged.

The candidate36 audit recorded these source gaps in that snapshot: E00's archive selector omits pinned `.zigversion` and the referenced native SDK patch; E32 has two concrete client defects plus a separate server continuation prerequisite for complete equal-time groups; E63 has the cache-retirement defect described above; E84 had a mounted same-browser loopback experiment but lacked the remote interoperability/refusal investigation path; E91 had an adapter but lacked the live authenticated listener and policy-equivalence investigation path. These are candidate36 findings, not claims about the later Wave37 source. E04's harness source was present while package delivery evidence remained pending. The T68/T69/T70 clause maps are restricted to E90 performance, E91 WebTransport, and E92 sleep/network/storage work respectively; E84 contains only its T67 interoperability clauses. See [implementation-status.json](implementation-status.json) for the 53 exact clause maps.

At the candidate36 checkpoint, formal acceptance was **2/53 E packages (E02 and E03), 0/74 T scenarios, and 0/11 M milestones**. The source38 row review above supersedes that package count; the candidate36 assessment still does not bind later source.

### Historical Wave37 integration checkpoint — before verification

The [Wave37 integration receipt](/tmp/onyx-elm-verification-final/wave37-integration.json) records the archive, performance, lab, history, and E63 cache-retirement updates, plus both E84 and E91 controllers, browser pages/specs, runners, strict configurations, and the shared namespace helper. The [transport investigation guide](transport-investigations.md) describes their observation scope and external limits. When this integration checkpoint was recorded, no tests, checks, or builds had run and candidate37 had not been cut. The source37 run and source38 follow-up are recorded in the current evidence section above; this older receipt is not an acceptance result.

## Reading status

`implementationStatus` describes source presence: `complete` means the
package's bounded implementation or design/harness deliverables are present;
`partial` names a concrete implementation gap; `unassessed` means the current
source has not been fully mapped. `packageDeliveryStatus` separately records
open verification, review, measurement, investigation, and external work.
`acceptanceStatus` remains independent: E00, E02, E03, and E04 have bounded
accepted reviews; every other package, scenario, and milestone remains pending.
An `unassessed` observation dimension means no receipt was established for that
dimension; it does not mean the implementation is absent. No test total, prose
claim, Git HEAD, or server `production_wired` field is an acceptance receipt by
itself.

Receipts must record the exact command, UTC time, exit/result, client source
manifest digest, relevant server source/artifact/config hashes, browser, OS,
network, and limits. Keep source, configuration permission, deployment, and
client observations independent. Redact credentials and user content; source
manifests contain paths and hashes, never file contents.

## Evidence references

- [Module ownership map](module-ownership.md) — current Elm module boundaries
  and direct Elm test imports.
- [Compatibility matrix](contracts.md) — §15 contract history, source-backed
  corrections, and remaining acceptance.
- [Browser, tab, and performance support](support-matrix.md) — explicitly
  supported, pending, and unproven cases.
- [Deterministic lanes](runner.md) — pinned test commands, runner behavior,
  transcript fixtures, and CI scope.
- [Prioritized package gaps](prioritized-gaps.md) — a non-acceptance planning
  sequence for substantive work after E10–E14.
- [Review source hash plan](reviews/source-hash-plan.md) — accepted E02/E03
  source bindings; the bounded E00/E04 row review is linked in the latest
  evidence checkpoint.

Candidate36 archive and manifest verified the selected source set, but its
source-closure selector omitted two required build inputs referenced by
workspace metadata: `.zigversion` and
`patches/@native-sdk__cli@0.6.2.patch`. Source37 added the bounded selector
correction and its regression passed; the source38 E00 review accepted that
closure work. Generated outputs, caches, dependency stores, and private
material remain excluded from the source archive.

Generate a fresh client source manifest after installing the pinned local
toolchain:

```sh
ELM_BIN=/path/to/elm ELM_TEST_BIN=/path/to/elm-test \
  node elm/tools/source-manifest.mjs > /tmp/onyx-elm-source-manifest.json
```

The manifest records SHA-256 and mode for each selected input plus exact tool
provenance. A reproducible POSIX archive and restore verification can be
captured separately with `node elm/tools/freeze-source-cut.mjs
/tmp/onyx-elm-source-cut`. Both commands write only under `/tmp`; a manifest or
archive is a source fingerprint, not a pass receipt.

## Candidate 26 evidence checkpoint — 2026-11-04

Candidate 26 is the last fully passing affected source cut. Its source manifest is
`c2f3a40addd912cd6f8115a1388ac6cc059899974f2eb5a51faa6a09cbf88ed0`; restored archive SHA-256 is
`4178c8d274d2c328491a7feedfef54aa56e3cd4d6ea6df64f63967afeb1fffae`. `affected-candidate-26.json` reports passed and confirms source
unchanged during the run. Subsequent E01 catalog/consumer work is not covered by
this cut. Candidate 33 later passed the expected-failure lane, but that result
is bound to candidate 33 and does not establish E04 acceptance or cover Wave 34.

Candidate 26 passed the full Elm suite (2,613), Chromium mock 20/20, stress
8/8, and the real two-node foundation's five assertions plus cleanup. Runtime
TypeScript (131 tests across 22 files) and lint (25) are unchanged-scope reuse
from candidate 25, not new candidate-26 runs. Candidate numbers are source cuts,
not test counts. Candidate 25's `elm/src/App.elm`/`AppTest.elm` correction
resolved the prior redaction-test oracle mismatch; candidate 26 adds no new
runtime or lint claim.

Candidate 25's verified storage-path optimization remains in the tested
lineage: immutable admitted-row reuse before normalization with bounded
exact-version/owner cleanup; per-put canonical-target retention reuse; atomic
messages+metadata merge with monotonic expiry-floor merge; one prune per target;
and strict 400-row/TTL limits including late-expired inserts. The 121-snapshot
regression passed with 123 puts, two transactions, and a normalization counter.
Redaction returned 122 public rows while an exact scoped durable tombstone
confirmed all 123 stored. This evidence does not close every storage or
owner-lifecycle scenario.

Earlier scoped lab receipts passed ordinary paths: logical two-node session
(raw 8 assertions plus Elm bootstrap), exact session (raw 9 plus bootstrap),
and logical history (observation 7: grouped cases containing 101 raw assertions,
plus one Elm bootstrap assertion). Aggregate session/history
receipts exited 2 for explicitly untested fault-injection, equal-time, and rate
gates; ordinary paths did not fail. Three-node exact local RESUME deadline and
logical DM mirror timeout remain unresolved observations, not proven deadlocks.
Candidate 26's two-node foundation separately passed five assertions (guest
browser canary 1, authenticated browser canary 1, raw TLS 2, binary-frame
negative 1) and cleanup. Full T27–T28 and broader cross-node/session/history
acceptance remain open.

The terminal candidate-26 paired performance receipt exited 2. Its baseline
failed production-v5 initialization; the current candidate timed out at 180
seconds while `joinConfiguredRooms` was sending joins. No metrics or numeric
comparison were recorded. The receipt's `performanceThresholdStatus` says
`thresholds-met`, but its observations are empty; that is vacuous and must be
treated as unavailable, not a pass. Sol is investigating. Do not claim measured
performance improvement or threshold success.

Candidate 27 was a frozen but failed source cut: strict runtime TypeScript
passed, but runtime tests passed 146/148 with two fixture assertion failures.
That cut is historical. Candidate 30 is the latest completed full affected
Elm run described here:
production and Elm tests compile, but Elm reports 2,635/2,664 tests passed
with 29 failures. Runtime TypeScript (148 tests across 23 files) and strict
TypeScript are unchanged-scope reuse from candidate 28, not candidate-30 runs.
Later Node, expected-failure, lint, Chromium, stress, and real-foundation lanes
were not run after the Elm failures. Candidate 30 is not an aggregate pass.

Candidate 31 later failed during Elm parsing, before the Elm suite and later
affected lanes. Wave 31 source authoring is a historical checkpoint. Candidate
33 later ran to a terminal failed affected-run receipt; Wave 34 corrections are
source-only and unverified, as described below. The E13 keyboard fixture ran in
candidate 33 and failed one journey; screen-reader and real-server acceptance
remain unestablished.

## Wave 34 actual-server-following correction — 2026-11-04

Candidate 33 was the terminal affected-run receipt before the Wave 34 correction
source. Receipt: `/tmp/onyx-elm-verification-final/affected-candidate-33.json`.
Its source manifest digest is
`a86ddd837be220fe7cbfc11d09c8401e7a99630d3266c4529be323cb81351d75`, archive
SHA-256 is
`7d43e61ad49b2d52dae075419b7790b5274d1852ee999d24cddab02277846755`, and the
receipt confirms `sourceUnchanged: true`; overall outcome is **failed**.

Candidate 33 stage results were mixed: host-bridge schema validation, root and
runtime TypeScript, root lint, Node smokes, expected-failure, stress-browser,
and authenticated two-node foundation stages passed. Runtime tests passed
249/268 (19 failed); Elm tests passed 2,669/2,697 (28 failed); Chromium passed
20/21 (one keyboard journey failed); root unit tests passed 7,613/7,628 (15
failed). Two-node session/history aggregate receipts exited 2 with blocked
acceptance gates. The two three-node session variants failed. Candidate 33 is
not an aggregate pass; its individual stage receipts remain scoped to that
source digest.

Wave 34 is a source-only correction after candidate 33. The server-follower
artifact `/tmp/onyx-elm-verification-final/wave34-server-follower-correction.json`
(SHA-256 `93e03daa6a972ee57267ec7cb25b6f9b71c42f599f0067af66735bc4c1c11487`)
clarifies that semantic Event Spine publication does not replace the actual
caller-facing IRC reply. Preserve source-backed caller `EVENT` forms for
MEDIA/WEBAUTHN, and actual NOTICE, standard FAIL/WARN, prefixless failures,
direct replies, and command-specific forms where those are what the server
emits. Do not invent universal EVENT wire forms or synthetic NOTICE/EVENT
translations. This correction does not modify the server.

At the Wave34 checkpoint, current source corrections and the isolated lab's
source-supported OPER plus SQUIT/CONNECT fault scenario were not yet bound to a
new source cut or execution receipt. The lab scenario was being authored
locally; its behavior remained pending. No tests, typechecks, builds, browser
runs, or lab runs had established the Wave34 source at that checkpoint.
Candidate33 results did not transfer to it. This is historical status; source37
and source38 evidence appears above.

The ledger now carries 170 atomic T assertion definitions mapped to T01–T74.
They are definitions only: every scenario and atomic assertion remains pending,
and the source-map's candidate test references are not acceptance evidence.
At the Wave34 checkpoint, formal acceptance was 2/53 E packages, 0/74 T
scenarios, and 0/11 M milestones; E02 and E03 had bounded accepted reviews.
The latest source38 checkpoint above records the later E00/E04 row decisions.
Source presence, review, and candidate-33 stage passes do not imply scenario,
milestone, cohort, or release acceptance.

Contract evidence stays source-candidate-scoped: 123 client and 24 server
contract tests at candidate 6, and candidate-7 concordance from two validators.
Candidate-5 E02 disagreement is historical. Candidate-26 client checker and v2
contract hashes match the candidate-7 receipt; the server checker hash is
recorded in the ledger. E02 accepts only contract correction and validator
concordance; E03 accepts only written planning/support decisions. Candidate
33's expected-failure lane passed after E01 consumer changes; that result is
candidate33-only and is not current-source evidence. E04 was pending at the
Wave34 checkpoint; its source37 proof and source38 row review are recorded
above. Do not extend the historical reviews to M0, T scenarios, browser cohorts,
or release. At Wave34, E00, E01, E04, all T/M rows, and all other package rows
remained pending. See the [integration closure]
(integration-closure.md) and ledger for review scope and external prerequisites.

## Historical candidate 34 terminal checkpoint and Wave35 source — 2026-11-05

Candidate 34 was a terminal affected run before candidate 36 and failed. Receipt:
`/tmp/onyx-elm-verification-final/affected-candidate-34.json`; source manifest
`dfebd14c11443185eb90ea207e958da83b39f71e4cc541862f9972a5c9416906`, archive
SHA-256 `f1a263c2a8e2ff58f807606937d60de02e7c6224a9d51174cc9bfe06f8957fff`,
`sourceUnchanged: true`. Root tests passed 7,626/7,629 across 611 files;
runtime tests passed 274/276; Elm passed 2,688/2,699; Chromium passed 20/21.
Schema validation, root/runtime TypeScript, lint, Node smokes, expected-failure,
stress, and the authenticated two-node foundation passed. Candidate 34 is not
an aggregate pass.

Lab receipts preserve scoped outcomes: two-node ordinary session assertions
passed (logical 8/8 and exact 9/9, each with browser bootstrap 1/1), while
fault-injection assertions were blocked. In the line3 logical session receipt,
mesh-link registration timed out before the expected 381 response because the
operator/group prerequisite was unavailable. The line3 exact receipt observed
`TEMPORARILY_UNAVAILABLE` during detached restore; its cause is unresolved.
History ordinary assertions passed 101/101 with browser bootstrap 1/1; rate-limit
and equal-time assertions were blocked. These receipts do not accept scenarios.

At the candidate34 checkpoint, Wave35 fixture corrections were being authored
in an isolated copy and had not been tested. They did not change candidate 34's
receipt or establish acceptance. Formal acceptance then remained 2/53 E
packages, 0/74 T scenarios, and 0/11 M milestones. Later E00/E04 decisions are
recorded in the source38 checkpoint above; no scenario or milestone status
advances.

