# Elm client implementation waves

This file preserves the architect-owned implementation order and interface
contract. It is not an acceptance receipt. All rows remain individually
pending except bounded package reviews explicitly attached in
`acceptance-ledger.json`; no package review accepts a milestone, scenario,
cohort, or release by implication.

## Candidate 26 source/verification checkpoint

Candidate 26 manifest: `c2f3a40addd912cd6f8115a1388ac6cc059899974f2eb5a51faa6a09cbf88ed0`; restored archive SHA-256: `4178c8d274d2c328491a7feedfef54aa56e3cd4d6ea6df64f63967afeb1fffae`.
`affected-candidate-26.json` reports passed/sourceUnchanged=true. Full Elm
2,613, Chromium mock 20/20, stress 8/8, and the real two-node foundation's
five assertions plus cleanup passed. Runtime TypeScript (131 tests/22 files)
and lint (25) are unchanged-scope reuse from candidate 25, not new candidate-26
runs. Candidate numbers identify source cuts, not test counts. E01
catalog/consumer edits after this cut are pending their own source hash and
verification; E04's mutation proof must be refreshed for the current consumer.

Candidate 25 corrected a test-only expectation that had incorrectly required a
redacted row to remain public. Its storage path retains immutable admitted-row
reuse before normalization with bounded exact-version/owner cleanup,
per-put canonical-target retention reuse, atomic messages+metadata merge with a
monotonic expiry floor, one prune per target, and strict 400-row/TTL behavior
including late-expired inserts. The 121-snapshot regression passed with 123
puts, two transactions, and a normalization counter; redaction returned 122
public rows while an exact scoped durable tombstone confirmed 123 stored.

Historical scoped labs passed ordinary logical-session (raw 8 + bootstrap),
exact-session (raw 9 + bootstrap), and logical-history observation 7 (grouped
cases containing 101 raw assertions plus one bootstrap assertion). Their
aggregate exit-2 receipts reflect explicitly untested
fault-injection/equal-time/rate gates, not ordinary-path failures. Three-node
exact local RESUME deadline and logical DM mirror timeout remain unresolved
observations, not proven deadlocks. Candidate 26's two-node foundation passed
five assertions and cleanup; broader T27–T28 remains open.

The candidate-26 paired performance receipt ended with exit 2: baseline
production-v5 initialization failed, and the current run hit a 180-second
`joinConfiguredRooms` timeout. No metrics exist. Its empty observations make
`performanceThresholdStatus: thresholds-met` vacuous, not a pass. Sol is
diagnosing the run. Performance result stays pending.

## Candidate 27 historical source checkpoint — verification failed

Candidate 27 source manifest digest is
`b1c7c6627e0883f175d82e47dc42928cc5e09003000ca3e2e52d3d81f5fc45f4`; restored
archive SHA-256 is
`ad4841b10c5f5588ceaaa8ce42d5c0e05b3accfd68c955701de3772d8273d1cf`. The
source freeze verified restore and source stability, but the affected run
failed. Strict runtime TypeScript passed; runtime tests passed 146/148, with
two fixture assertions failing in `authenticated-facts.test.ts` and
`bootstrap-domain-integration.test.ts`. The failure was followed by blocked
before-execution statuses for Elm, Node smokes, expected-failure, lint,
Chromium, stress, and the real foundation lane. E04 therefore has no current
expected-failure proof. Its source manifest is retained with the E02/E03
review artifacts; the affected receipt remains an external historical
receipt, not a current pass.

This frozen but failed source includes the bounded batch:

- **E10:** checked IRCX variable builders route assembled lines through the
  bounded wire encoder, with focused vectors for UTF-8 line limits, rejected
  control bytes, parameter limits, target syntax, and empty PROP deletion.
  This library coverage does not establish that every operator or community UI
  action uses the checked builder.
- **E11:** CAP token name/value bounds use checked UTF-8 byte lengths, and
  ISUPPORT retains a bounded escaped-token inventory while updating typed
  projections and removals. Elm execution was blocked before its suite.
- **E13:** a new mock-wire keyboard/DOM test covers the connection dialog,
  retry, visible status, and focus return using keyboard input. It is not
  screen-reader evidence or real-server acceptance.
- **E14:** label and multiline send-path work is present in the frozen source;
  regression results for that source cut were unavailable.

The two runtime assertion failures do not establish production defects beyond
their reported test expectations. No Elm, E10/E11 vector, keyboard-browser,
expected-failure, stress, or real-server result is claimed. E10/E11/E13/E14
remain unaccepted pending diagnosis, corrected verification, and
package-specific evidence.

## Candidate 30 historical verification checkpoint — failed

Candidate 30's production source and Elm tests compile. The full Elm suite
reported 2,635 of 2,664 tests passing, with 29 failures. Runtime TypeScript
(148 tests across 23 files) and strict TypeScript pass evidence are unchanged-
scope reuse from candidate 28, not candidate-30 executions. Later Node,
expected-failure, lint, Chromium, stress, and real-foundation lanes were not run
after the Elm failures. This checkpoint is not an aggregate pass and does not
establish a production release claim.

Wave 31 source authoring for E22/E24 and related identity paths follows this
failed checkpoint. Those changes are not represented by this receipt. The
E13 keyboard/DOM fixture remains mock-wire evidence only until executed and
does not substitute for screen-reader or real-server review.

## Candidate 31 source/verification checkpoint — failed

Candidate 31 manifest digest is
`405525e9c2a351dd3cfef42c3cd515c01f79d166839600d7fbd952eaae6e1b7c`; restored
archive SHA-256 is
`4e9893ee82e82d0b8c2c3bb63c3ed4c055b012a3968e0e636b7d32050c3d24f1`.
The receipt reports `sourceUnchanged: true`. Root unit tests passed 7,612 tests
across 608 files. Runtime tests reported 166 passing and 7 failing across 26
files; root and runtime TypeScript gates failed. Node smoke lanes passed. Elm
parsing failed, so expected-failure, Chromium, stress, and lab lanes were
blocked before execution. Lint reported 8 errors in the immutable E02 evidence
checker, plus warnings that are not included in this status. The JSON Schema
vector checker was not executed because `jsonschema` was unavailable in that
run environment. No package acceptance advanced from this checkpoint.

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

Current source corrections and the isolated lab's source-supported OPER plus
SQUIT/CONNECT fault scenario are not yet bound to a new source cut or execution
receipt. The lab scenario is being authored locally; its behavior remains
pending. No tests, typechecks, builds, browser runs, or lab runs establish the
current Wave 34 source. Candidate 33's results do not transfer to it. No paired
performance measurement is available.

The ledger now carries 170 atomic T assertion definitions mapped to T01–T74.
They are definitions only: every scenario and atomic assertion remains pending,
and the source-map's candidate test references are not acceptance evidence.
Formal acceptance remains 2/53 E packages, 0/74 T scenarios, and 0/11 M
milestones. E02 and E03 retain only their existing bounded accepted reviews;
no other status advances. Source presence, review, and candidate-33 stage
passes do not imply package, scenario, milestone, cohort, or release
acceptance.

## Shared boundary and ownership

`elm/runtime/contracts.ts` is the version-1 public boundary. Runtime modules
use distinct unique-symbol brands and validated constructors. `OwnerSnapshot`
contains `{ networkId, accountId: AccountId | null, accountGeneration,
connectionGeneration, physicalRef: LocalPhysicalEpoch | null, ownerRef }`. This
browser-local lifetime fence is distinct from a proven server `AttachmentId`.
Each
request/event carries schema version 1, request ID, owner reference, and both
generations. Every asynchronous callback and side effect revalidates the
snapshot. A service factory receives an owner snapshot getter, `isCurrent`, the
transport, purpose-specific private identity providers, and an allowlisted
public event emitter; every service has `dispose()`.

The browser runtime boots before Elm. `OnyxPorts.wire(app, { runtime })`
connects it without importing the Solid application. Elm receives opaque public
references and status metadata only. Credential bytes, private keys, arbitrary
signing APIs, raw MAC material, and secret-bearing URLs do not cross into Elm,
views, cache, export, diagnostics, or logs. Network/account storage keys use
canonical JSON arrays or length-prefixed tuples, never delimiter concatenation.
Opaque 64-bit selectors and server timestamp fractions remain validated
canonical strings and are never round-tripped through IEEE-754 numbers.

## Wave 1 — foundation, protocol, account, and session (E10–E24)

### Foundation (E10–E14)

- **E10:** keep IRC parsing/formatting hostile-input bounded; use opaque IDs,
  validated wire/config constructors, and canonical scope keys.
- **E11:** request only explicit, implemented CAP names and supported aliases.
  Prefer one alias when names share server state. Canonical and draft spellings
  are normalized only where implementation supports them. CAP request groups
  are explicit sets: ACK settles only a still-pending requested name; duplicate
  or unsolicited ACK is inert; exact full-set NAK rejects only its own group;
  partial/mixed NAK cannot settle a group. CAP END waits for every group to be
  terminal and for SASL to finish or be explicitly aborted. DEL and reconnect
  retire pending groups safely.
- **E12:** choose `text.ircv3.net` before opening the text socket. Binary is
  accepted only after explicit `onyx.irc-media.v1` selection. One WebSocket
  application message carries one IRC command with no CRLF. Every open,
  message, error, close, timer, and send callback is fenced by the current
  connection generation; retiring a socket cannot affect its successor.
- **E13:** preserve truthful connection, retry, error, focus, and accessible
  state through registration/account transitions.
- **E14:** admit bounded batches/labels in deterministic order, and make stale
  completion/replay impossible across account or connection generations.

### Account/session (E20–E24)

- **E20:** account continuation is a typed, acknowledged state machine. A
  session resume credential selects an attachment; it never proves the
  account. Keep account proof (SASL SESSION-TOKEN, passkey, certificate) distinct
  from attachment restore.
- **E21:** the JavaScript credential custodian keys opaque holdings by
  normalized trusted network, proven account, original issuer, credential kind,
  and explicit attachment intent. Capture TOKEN/MTOKEN only from the exact
  learned `001` server prefix after current account proof and generation checks;
  peer PMs and forged server-looking prefixes are ignored. Elm sees only an
  opaque reference and metadata: local/mesh logical/exact kind, issuer endpoint,
  expiry in milliseconds, restorable and remembered state. Legacy slots migrate
  only as issuer-scoped unknown-kind metadata; there is no automatic
  cross-network migration or storage write without remember consent.
- TOKEN issuance is one serialized transaction. Send `SESSION TOKEN`, then a
  random public barrier cookie in `PING` on the same socket. Stage authenticated
  local TOKEN and optional MTOKEN in private memory. A matching server PONG
  closes the synchronous output segment; commit the entire bundle in one
  storage replacement, clearing a prior MTOKEN when the new issuance has none.
  Missing TOKEN, WARN/FAIL, timeout, or owner change leaves the previous bundle
  intact and issuance unknown. Never use this barrier as proof RESUME succeeded.
- **E22:** a pure reducer tracks attempt ID, connection/account generations,
  credential reference/kind/issuer, intent, visited trusted endpoints, and at
  most three redirect hops. Outcomes distinguish exact restore, logical restore,
  legacy new attachment, busy, missing, revoked, invalid, retryable, redirect,
  and unknown. Only exact source-backed server NOTICE success variants complete
  restore. Timer expiry reports uncertainty only. Exact busy/missing never
  falls back to a logical credential. TOKEN rotation occurs once only after a
  permitted confirmed success or explicit user intent to create a new
  attachment. Retryable warnings preserve authority. Terminal invalidation
  removes only the attempted authority; group revocation affects only known
  group-associated authority. Redirect hosts resolve through a preconfigured
  trusted endpoint registry; never construct an endpoint from server text.
  Unknown destinations require manual recovery. Each hop proves account again.
- **E23:** list/drop sessions with account and owner correlation; independent
  intentional tabs may attach independently, but the same exact bearer is
  never replayed concurrently. A new tab defaults to explicit fresh attachment;
  E23 runtime enforcement remains open until browser evidence.
- **E24:** complete acknowledged account-security journeys for TOTP,
  passkeys, recovery codes, certificates, and key-transparency; absent browser
  capabilities are shown as unavailable rather than treated as success.

### Shared Elm/runtime types

Elm `Ids` keeps ID constructors private and exposes specific `fromWire` or
`fromConfig`, `toWire`, and canonical key functions. `AttachmentId` and
`LocalDropSid` are distinct even when both are 32-hex values. TypeScript brand
casts stay in the validated constructor module. Account ID may be absent for a
server-authenticated guest event and is never fabricated.

## Wave 2 — chat, history, community, and operations (E30–E44, E100–E104)

New domain reducers expose `init : Context -> Model`, `update : Msg -> Model ->
(Model, List Effect)`, `onServer : AuthenticatedEvent -> Model -> (Model, List
Effect)`, and `retire : OwnerRef -> Model -> Model`. Views return their domain
message type and are mapped centrally. Effects use public references and
validated intents, never private credential handles.

- **E30–E35:** stable accepted `msgid` identity across guest/nick/CHGHOST
  continuity; historical JOIN/PART/MODE/NICK never rewrite live membership;
  LATEST, BEFORE, AFTER, AROUND, BETWEEN, and TARGETS history with query labels,
  owner correlation, overlap/dedup, retention/rate/policy failure, and explicit
  completeness gaps; delivery journal reconciles accepted events without
  automatic retransmit; monotonic server-authenticated owner-scoped read state;
  complete reactions/edits/redactions/replies/multiline policy and acknowledg-
  ments; keyed translation, bidi/RTL behavior, accessible keyboard/focus/window
  traversal, bounded announcements, and bounded rendering. Equal-time server
  pagination remains an upstream limitation; the client must expose gaps.
- **E40–E44:** LISTX discovery and CREATE/register/settings; concurrent PROP
  acknowledgments; current-authority ACCESS/MODEX/role forms; auditorium,
  cloak, TTL, history, and AI policy projection; local/mesh session inventory
  and revoke with pending/local-commit/complete receipts; ownership, successor,
  autojoin, and account-group recovery. Candidate mesh cursors remain opaque
  and tied to owner/socket/nick, including zero-row and partial legacy coverage.
  Session-sync is never evidence of feature support.
- **E100–E104:** privilege-derived fresh/unknown read-only operations dashboard;
  strict redacted doctor/setup import retaining unknown/effective checks;
  mutations require current factor/scope and acknowledged audit; integration
  UI follows effective enablement and keeps private endpoint/secret custody;
  native/remote bridges use a versioned trusted adapter with argument arrays,
  scoped previews, and acknowledgments. Imported diagnostics never execute
  host commands. Missing backend services remain explicit prerequisites.

## Wave 3 — storage, platform, crypto, media, and stress (E50–E104 remainder)

- **E31/E51 storage ownership:** use stable owner context from trusted network
  configuration and proven canonical account; custom pinned endpoints have a
  distinct scope. CASEMAPPING comes only from the exact learned-server 005;
  persisted scheme revisions are stable (`irc-casemapping-v1:<scheme>`) while a
  separate monotonic mapping generation fences async work. Unknown mappings
  hold/refuse target-scoped operations. Guest cache/read markers use a fresh
  physical epoch per new connection. The active compatibility tuple is
  `{vault:5,privateCrypto:2,platform:1,tabIntents:1,localWorkspaces:1}`; private
  crypto, tab-intent and local-workspace databases have independent schema
  versions. Add owner-scoped v5
  message/outbox tables while leaving legacy rows read-only quarantine; never
  auto-assign or flush legacy rows. Revalidate
  owner/socket before every wire admission and durable state change. Account
  switches stop remaining flush work; already admitted sends remain uncertain
  and are never automatically resent. Guest offline content remains a draft,
  never an implicit MEMO. Unknown owners fail closed. Upgrade blockage or quota
  failure leaves old data untouched and reports storage unavailable.
- **E50–E53:** safe update/service-worker lifecycle, atomic migrations and
  recovery/export, acknowledged push subscription/server state, private
  notification and click routing. A sent subscribe request is not “enabled”
  until a correlated server persistence acknowledgment; worker delivery and
  direct-peer topology remain acceptance requirements.
- **E60–E64:** DM/group threat model, authenticated identity and pins, room
  creation/welcome/epoch authoring, ciphertext/stale async/logout boundaries,
  and multi-device/lost-device/backup recovery. Required encrypted rooms never
  fall back to plaintext on UI rollback.
- **E70–E84:** actual Cadence capture/playback engine, binary WSS media MAC and
  attachment contract, media E2EE/epoch/topology, call device/mute/recovery,
  measured telemetry, real video/screen capture/codecs, preview/layout/share
  ownership, measured adaptation, consent/journal/caption/transcript lifecycle.
  Missing engine, arbitrary mesh forwarding, codec/DTLS/TURN support stay
  explicit blockers.
- **E90–E92:** message/roster performance, browser suspension, network and
  storage stress against the ledger's fixed fixtures and declared hardware.
- **E101:** strict doctor/setup JSON import retaining unknown checks and
  requiring review. **E104:** native/remote administration trust/API remains
  explicitly blocked where no browser admin service exists.

## Acceptance, browser support, and release controls

All browser cohorts are pending until exact browser and OS versions are recorded:
Chromium, Firefox, and Safari desktop; ordinary and installed iOS; Android;
foreground/background; native adapter only if selected. Optional browser APIs
must be exercised as unavailable. Tabs are independent intentional attachments;
no shared leader is assumed. Performance figures are proposed budgets only,
not accepted limits: input-to-paint p95 at most 100 ms desktop / 200 ms declared
low-end mobile; no ingest task above 200 ms; replay heap plateau growth at most
10% across the last three equal cycles. Fixture proposal is 50 rooms, 100k disk
rows, and 500–1000 loaded active rows. Memory ceiling is unset until baseline.

Effective availability is the intersection of local implementation, rollout
flag, negotiated server support, endpoint enablement, browser permission, and
runtime readiness. Reader support precedes writers; retain credential readers
through migrations. Never erase valid authority or downgrade required-room
ciphertext due to a UI/flag rollback.

The cross-node journey needs four intentional physical attachments over two
nodes and a fifth reconnect/resume. Every surviving attachment verifies the
channel and DM exactly once, stable msgid/time, roster and reply continuity,
partition/reconvergence, sequential supported upgrades, cold restart, busy and
revoked behavior. Three-node line and full mesh are separately required for
media/push arbitrary reach. A cold restart cannot substitute for reconnect.

The security invariants are source-authenticated server events and generation
fences; no secret in Elm model/cache/export/log/URL; required-room fail-closed
ciphertext at rest; no uncertain automatic send replay; historical membership
never mutates live membership; guests never inherit account markers; mutations
require current factor and authority. Whole-goal completion requires every
applicable requirement to have a passed evidence receipt or explicit
user-approved out-of-scope decision. Unit suites, source presence, docs, or a
passing package row alone do not satisfy that predicate.

## Candidate 34 terminal verification and Wave35 corrections — 2026-11-05

Candidate 34 is the latest terminal affected run. The receipt
`/tmp/onyx-elm-verification-final/affected-candidate-34.json` reports failure
with `sourceUnchanged: true`; source manifest digest
`dfebd14c11443185eb90ea207e958da83b39f71e4cc541862f9972a5c9416906` and
archive SHA-256 `f1a263c2a8e2ff58f807606937d60de02e7c6224a9d51174cc9bfe06f8957fff`.
Root tests passed 7,626/7,629 across 611 files, runtime tests 274/276, Elm
2,688/2,699, and Chromium 20/21. Schema validation, root/runtime TypeScript,
lint, Node smokes, expected-failure, stress, and authenticated two-node
foundation stages passed. This is not an aggregate pass.

Candidate-34 lab evidence remains scoped to its receipts: two-node logical and
exact session ordinary assertions passed 8/8 and 9/9, with bootstrap 1/1 each;
fault-injection cases were blocked. Line3 logical stopped at mesh-link
registration before 381 because the operator/group prerequisite was unavailable.
Line3 exact observed `TEMPORARILY_UNAVAILABLE` at detached restore, with cause
unresolved. History ordinary assertions passed 101/101 plus bootstrap 1/1;
rate-limit and equal-time cases were blocked.

Wave35 fixture corrections are being authored in an isolated copy and remain
untested. They do not alter candidate-34 evidence or promote acceptance.
Formal acceptance remains 2/53 E packages, 0/74 T scenarios, and 0/11 M
milestones; E02/E03 are the only bounded accepted package reviews.
