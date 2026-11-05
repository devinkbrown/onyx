# Elm integration closure

Historical full Elm checkpoint: **candidate 30**; candidate 31 later failed
before Elm parsing. Latest terminal affected run: **candidate 34**, 2026-11-05;
isolated Wave35 fixture corrections are authored but untested.
This document separates production source paths from unresolved client work and
acceptance or external prerequisites. It is not a release receipt. The
read-only master roadmap remains
`/home/kain/onyx-server/docs/design/onyx-elm-client-roadmap.md`.

Candidate 26 source manifest:
`c2f3a40addd912cd6f8115a1388ac6cc059899974f2eb5a51faa6a09cbf88ed0`. Restored archive SHA-256:
`4178c8d274d2c328491a7feedfef54aa56e3cd4d6ea6df64f63967afeb1fffae`. `affected-candidate-26.json` reports passed and source unchanged
during the run. Subsequent E01 catalog/consumer source changes are outside this
cut; final source hashes and E04 mutation proof wait for review and gates.

## Evidence checkpoint

- Candidate 26 passed full Elm (2,613), Chromium mock 20/20, stress 8/8, and
  the real two-node foundation with five assertions plus cleanup. Runtime TS
  131 tests/22 files and lint 25 are unchanged-scope reuse from candidate 25,
  not new candidate-26 runs.
- Candidate 25 corrected a test-only expectation that had incorrectly required
  a redacted row to remain public. Its bounded storage path reuses immutable
  admitted rows before normalization with exact-version/owner cleanup, reuses
  canonical-target retention per put, atomically merges messages+metadata with
  a monotonic expiry floor, prunes once per target, and enforces 400-row/TTL
  limits including late-expired inserts. The 121-snapshot regression passed
  (123 puts, two transactions, normalization counter); public redaction
  returned 122 rows while an exact scoped durable tombstone confirmed 123
  stored.
- Earlier scoped labs passed ordinary paths: logical session (8 raw assertions
  plus 1 Elm bootstrap assertion), exact session (9 raw assertions plus 1
  bootstrap assertion), and logical history (101 raw assertions plus 1
  bootstrap assertion). These are assertion counts, not scenario counts.
  Aggregate session/history receipts exited 2
  for explicitly untested fault-injection, equal-time, and rate gates; ordinary
  paths did not fail. Three-node exact local RESUME deadline and logical DM
  mirror timeout remain unresolved observations, not proven deadlocks.
- The candidate-26 paired performance receipt ended with exit 2. Both builds
  completed, but the baseline failed production-v5 initialization; the current
  candidate timed out at 180 seconds during `joinConfiguredRooms`. No metrics
  or numeric comparison were recorded. Its `performanceThresholdStatus` says
  `thresholds-met`, but observations are empty; this is vacuous, unavailable
  evidence, not a pass. Sol is diagnosing.
- Candidate 23/24/25 history and contract-validator receipts are preserved in
  the staged evidence notes. E02/E03 reviews cover only scoped contract and
  planning obligations; they do not accept M0, T scenarios, cohorts, or release.
  E04's runner infrastructure does not itself establish package acceptance.
  Candidate 33's expected-failure lane passed on that source cut; it has not
  been rerun for Wave 34. E00 remains pending a current full-source-cut review;
  the historical 260-test archive was Elm-only and is not itself the full
  closure. E01 remains pending: the MODE482 permission-error fixture includes
  an actual notification assertion, and candidate 33's expected-failure lane
  passed, but its full Elm suite failed and no E01 acceptance review is
  attached.

Candidate 26 remains the last fully passing affected cut, not the current
source. Candidate 30's Elm suite failed, and candidate 31 also failed before
Elm verification. E02 and E03 have attached bounded package reviews; they do
not accept M0, scenarios, cohorts, or release. Candidate 33's expected-failure
lane passed on its source cut; E04 remains pending row-scoped package
acceptance, and Wave 34 proof is not yet available.

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

## Candidate 27 historical source checkpoint — verification failed

Candidate 27 source manifest:
`b1c7c6627e0883f175d82e47dc42928cc5e09003000ca3e2e52d3d81f5fc45f4`; restored
archive SHA-256:
`ad4841b10c5f5588ceaaa8ce42d5c0e05b3accfd68c955701de3772d8273d1cf`. The
source cut restored and remained unchanged during its affected run. Strict
runtime TypeScript passed, but runtime tests passed only 146/148: two fixture
assertions failed in `authenticated-facts.test.ts` and
`bootstrap-domain-integration.test.ts`. Elm, Node smokes, current
expected-failure, lint, Chromium, stress, and real foundation stages were
blocked before execution. E04 has no current known-good/mutated proof from this
cut. Candidate-27 performance was not reached; candidate-26's paired attempt
also remains unavailable with no metrics.

Candidate-27 source bindings were used for the E02/E03 independent reviews;
their hashed contract/planning source files remain unchanged. The acceptance
reviews are attached in the ledger and do not derive acceptance from the failed
aggregate run.

## Candidate 30 current checkpoint — verification failed

Candidate 30 production Elm and tests compile, but the Elm suite reports
2,635/2,664 passing and 29 failures. Runtime TypeScript (148 tests in 23 files)
and strict TypeScript are unchanged-scope reuse from candidate 28. Later Node,
expected-failure, lint, Chromium, stress, and real-foundation stages were not
run after the Elm failure. Wave 31 E22/E24 source authoring is subsequent and
unverified. No aggregate pass or production release claim follows.

## Ownership and completion rules

- **Main Luna:** App/Main/Session/Wire, central View routing, ports.js, shared
  contracts, build/runner/ledger integration and complete user journeys.
- **Platform Luna:** bootstrap.ts after Main's explicit handoff; authenticated
  facts, platform/worker/push, media/transport/tab ownership and their adapters.
- **Storage Luna:** storage/journal/drafts/settings, local workspace custody,
  crypto/provider/backup/recovery, operator import and host bridge design.
- **Sol:** architecture and finite central/platform/media source review.
- **Root:** integration verification and storage/crypto/lab source review.

Existing code is preserved unless a concrete defect requires repair. A module,
exported factory, generic button, disabled flag or unit fixture does not close a
feature: the actual control, typed effect, production service, correlated
outcome and rendered recovery state must connect. Source presence is not
acceptance.

## Critical integration boundary

`elm/runtime/contracts.ts` defines the runtime boundary. `bootstrap.ts` composes
the transport, facts, identity, credential, local workspace, journal, storage,
crypto, platform, notification and media services into the Elm browser entry.
Runtime owners carry request and generation fences; Elm receives public status
and opaque references rather than secret bytes. The current active schema tuple
is `{vault:5,privateCrypto:2,platform:1,tabIntents:1,localWorkspaces:1}`.

Keep these as separate proof obligations:

1. Validate every port command/result and echo request and owner generations.
   Distinguish local persistence, transport admission, server acceptance and
   unknown outcome.
2. Compose workspace, transport/private ingress, facts, crypto, storage/journal,
   platform and media, and dispose every subscription, lease, timer, database
   handle, stream, worker and pending operation on retirement.
3. Process private ingress before public projection. Exact server provenance is
   independent of account authentication. Relayed user events are not server
   authority records.
4. Normalize actual Event Spine media MACKEY/NATIVE-MACKEY replies privately
   before Elm, logs or cache; fence imports to current call, room and physical
   identity.
5. Keep facts as the owner of external observations and the crypto provider as
   the owner of trust, accepted heads, sessions and author leases.
6. Separate accepted heads from proposed membership. Historical acceptance uses
   saved signer/trust evidence; valid late sibling forks remain detectable.
7. Local workspace selection may unlock scoped offline data but cannot prove
   live account authority or authorize a send, signature or enrollment.

Remote new-member receive bootstrap remains distinct from genesis authoring.
Without retained ancestry, an explicit one-use approval must bind the exact
observed commit, signer, recipient, current membership and mapping fences. It
establishes a starting checkpoint, not verified earlier history or global head
uniqueness. Known forks and existing-session ancestry cannot be bypassed.

## All 53 packages

“Implemented source” names current production paths; it does not certify every
branch. “Still open” records remaining client work. “Acceptance / prerequisite”
keeps runtime, browser, deployment and server conditions separate. Every ledger
package remains open unless its own evidence says otherwise.

| Package | Implemented source | Still open | Acceptance / prerequisite |
|---|---|---|---|
| E00 | Source manifest/archive tooling captures the selected client input closure with pinned tool provenance. | Independent review of a current full source cut remains pending; the historical 260-test archive was Elm-only. | Current source-cut evidence can support bounded E00 review; the old archive is not a substitute. |
| E01 | `elm/fixtures/roadmap/catalog.json` and Elm Wire/Session/App fixtures are present. | MODE482 permission-error fixture with an actual notification assertion is written; E01 review and full acceptance remain pending. | Candidate 33's expected-failure lane passed, but its full Elm suite failed; no E01 acceptance is inferred. |
| E02 | Revision-4 contract matrix, client/server checker, and independent validators have source-backed corrections. | Keep runtime crypto/durable denial, broader policy, and release mapping separate. | Candidate 6: 123 client + 24 server contract tests; candidate 7: both validators passed. The attached review accepts this bounded contract/concordance package only. |
| E03 | Approved support matrix and implementation waves record tab, credential, cohort, unsupported-case, and proposed budget decisions. | Browser/OS observations and measured budget enforcement remain open. | Roadmap §3 assigns proposed budgets to M0; no E90 performance pass is inferred. The attached review accepts written planning decisions only. |
| E04 | Deterministic Elm, runtime, Node, browser, lab, and stress lanes are wired. | Keep broad scenario coverage open and bind each lane claim to its exact source cut. | Candidate 33's expected-failure lane passed, while runtime, Elm, Chromium, root-unit, and multi-node lab stages failed or remained blocked. That run is not aggregate E04 acceptance and does not cover Wave 34. |
| E10 | `Wire.elm`, `Ids.elm`, runtime decoders, and IRCX variable builders implement bounded parsing and checked encoding. | Close byte/UTF-8/tag/parameter/injection scenarios individually. | Current `Ircx.elm` checked-builder source review is ready; execution and encoded current-server transcripts remain needed. Operator/community UI use of every checked builder is not established by the library work. |
| E11 | `Session.elm`, App CAP folds and bootstrap implement requested capability groups and 005 handling; `Isupport.elm` retains bounded escaped token inventory and typed projections. | Close partial/mixed ACK/NAK, DEL/reconnect, alias and SASL-abort cases. | Current Session CAP byte-bound and ISUPPORT inventory authoring is source-review ready and awaits execution; actual negotiated-capability evidence remains per server configuration. |
| E12 | `transport-owner.ts`, `browser-lifecycle.ts`, and bootstrap own text/binary selection and socket generations. | Close stale callback, ordered admission and retirement edge cases. | Browser endpoint/certificate/listener reachability remains deployment-specific. |
| E13 | Elm App, `View/Connection.elm`, and shell expose connection, retry and private sign-in. | Repair the failed keyboard/focus registration-recovery journey; screen-reader review is still pending. | Candidate 33 Chromium passed 20/21, with the keyboard journey as the failure. The authenticated local canary remains scoped evidence and does not establish screen-reader acceptance. |
| E14 | Bootstrap, `Labels.elm`, and `Multiline.elm` implement labels, batching and bounded planning. | Close nested replay/live split, ACK-without-output, missing END and scheduling. | Current implementation batch remains in progress; server multiline tag/label loss keeps whole-intent acceptance uncertain. |
| E20 | Elm Services/App and private account-security runtime implement account proof flows. | Close factor-unavailable, abort, continuation and account-switch authority paths. | Configured SASL/passkey/certificate support is per endpoint. |
| E21 | `credential-owner.ts` owns opaque issuer/account-scoped credentials. | Close remember consent, expiry, rotation and full secret-form custody. | No bearer values in public state; verify against each permitted mechanism. |
| E22 | `Session.elm` and bootstrap implement typed resume outcomes and redirect handling. | Close issuer/kind correlation, busy/retryable preservation and explicit new-attachment controls. | Requires actual source-backed server outcomes and trusted endpoint configuration. |
| E23 | `tab-intent-owner.ts` tracks independent attachment intent and authority. | Close fresh/restore, duplicate-tab, reload and safe DROP browser paths. | A local owner unit path is not cross-tab acceptance. |
| E24 | `private-account-security.ts`, WebAuthn reply handling and account views implement security forms. | Close acknowledged password/reset/TOTP/passkey/recovery and one-shot secret journeys. | Browser capability absence and server feature policy must be observed separately. |
| E30 | `Spine.elm`, `App.elm`, and runtime event folds preserve accepted message and identity events. | Close NICK/CHGHOST/rename/account-transition and guest nick-reuse cases. | Requires current encoded event transcripts and message-identity assertions. |
| E31 | `outbox-journal.ts`, `memory-send-owner.ts`, and bootstrap connect durable/volatile send paths to composer outcomes. | Candidate 26 proves no own-send failure in the recorded lanes; close full acceptance correlation and DM policy paths. | Candidate 26 foundation verified one guest and one authenticated canary only; no cross-node or reload claim. |
| E32 | Elm history/search/window code and authenticated facts implement bounded history/search paths. | Close cursor/policy/completeness and equal-time boundary handling. | Server pagination can omit equal-time boundary IDs; client must expose the gap. |
| E33 | `read-anchor-store.ts` and Elm unread/read UI implement owner-scoped anchors. | Prove prefixless MARKREAD and distinguish viewed state from confirmed server marker. | Guest physical scope and account scope require separate server evidence. |
| E34 | Elm App, Ircx, Modes and conversation views implement rich-message and room-control paths. | Close edit/redact ordering, missing parents, replay reactions, pins/topics and multiline cases. | Whole multiline send cannot be inferred from body/time where server drops tags/labels. |
| E35 | `MessageWindow.elm`, thread views and shell implement bounded rendering and navigation. | Complete focus, keyboard, localization and dense-surface review. | Browser accessibility/reflow evidence remains per changed surface. |
| E40 | `Ircx.elm`, `Services.elm` and community views implement discovery, CREATE and settings. | Close hidden/truncated results and concurrent property changes. | Must exercise enabled server capability and permission outcomes. |
| E41 | `Modes.elm`, `Moderation.elm` and views implement roles, ACCESS and moderation actions. | Close stale-authority retirement and accepted/rejected forms. | Actual privilege/factor scope and server result required. |
| E42 | App/runtime facts and views project privacy and member visibility. | Close cloak, auditorium, TTL/history/AI policy and hidden-roster behavior. | Missing roster entries cannot be treated as offline; settings need actual server readback. |
| E43 | Session list/drop flows and `tab-intent-owner.ts` implement local session management. | Mesh inventory/pagination/revoke still need integrated client and fault coverage. | Server mesh pagination and runtime acceptance are separate prerequisites. |
| E44 | `View.Stewardship` and App/service folds implement room-care and ownership UI. | Close acknowledged owner/helper/successor and account-group recovery journeys. | Verify current authority and server acknowledgements. |
| E50 | `worker-lifecycle.ts` and browser lifecycle implement service-worker update ownership. | Close multi-tab quiescence and full schema compatibility handling. | Installed-worker update behavior needs real browser cohorts. |
| E51 | Workspace, owned storage, draft, settings, migration and eviction services are composed in bootstrap. | Close offline selection, quota recovery, selective export and unsent-work preservation. | Keep the active schema tuple and legacy quarantine behavior; test actual storage failures. |
| E52 | `push-lifecycle.ts` handles permission, subscription and server state. | Close failed unsubscribe and node/VAPID reconciliation. | Public push delivery remains unproven and optional. |
| E53 | `notification-router.ts` and platform adapters implement private route/click handling. | Close closed-tab routing and restrictive notification previews. | Test without account fallback in real browser contexts. |
| E60 | Existing Elm crypto contracts compose with `private-crypto-provider.ts`. | Finish threat-model, lifecycle, fork/replay and independent security review. | Unit/vector passes do not certify the security boundary. |
| E61 | `authenticated-facts.ts`, `identity-owner.ts`, and `group-directory-trust.ts` implement observed identity and directory trust paths. | Close forged-prefix, pinning and old-key adoption cases. | Requires authenticated server source and externally established signer trust. |
| E62 | `group-authoring.ts`, recovery and provider implement room authoring and receive bootstrap paths. | Close CREATE/rekey/welcome, removed-member, author-race and fork-pause journeys. | Server does not persist offline group secrets/welcomes or arbitrate distributed forks. |
| E63 | Workspace-owned storage and crypto provider fence ciphertext storage and transient plaintext. | Close logout/reload/worker races and prove ciphertext-only persisted content. | Verify at-rest behavior across actual owner changes. |
| E64 | `crypto-backup.ts` and private backup storage implement backup/recovery operations. | Close commitment-bound restore, historical evidence and lost-device recovery. | No durable server-side offline welcome is implied. |
| E70 | `media-engine.ts`, `media-capture.ts`, Cadence transport and media entry compose the media path. | Prove capture-to-decode-to-audible playback on real devices. | Local source or mock capture does not certify audibility. |
| E71 | `cadence-transport-adapter.ts` implements Cadence transport and attachment fencing. | Close actual Event Spine reply/MAC-key ingress and cross-node integration. | Arbitrary mesh media forwarding remains a server prerequisite. |
| E72 | Runtime identity/key lifecycle paths connect media ownership to room/provider state. | Prove epoch/member/peer retirement and real cross-node forwarding. | Three-node or mesh behavior needs its dedicated lane. |
| E73 | Elm Calls views and media capture/device runtime expose call controls. | Prove device selection, soundcheck, mute/deafen and recovery against observed audio. | Requires browser permission and real media devices. |
| E74 | `media-telemetry.ts` and engine expose telemetry/queue observations. | Connect telemetry to real playout and adaptation behavior. | No helper-only performance claims; measure under fixed workloads. |
| E80 | Media capture and engine provide camera/screen capture and frame paths. | Prove worker ownership, large-frame handling and actual browser capture. | Browser/device cohort evidence remains open. |
| E81 | Media views/runtime provide preview, publish and source-switch controls. | Prove accessible immediate stop and retirement of superseded capture. | Requires real capture path. |
| E82 | Engine adaptation paths exist. | Prove controls affect observed bitrate, keyframes and audio priority. | Requires measured media session evidence. |
| E83 | `caption-producer.ts` and journal paths implement caption/recording controls. | Prove authoritative recording state, server-visible captions and failure disclosure. | Server captions are visible; packet journals are not playable recordings. |
| E84 | `webrtc-experiment.ts` contains a bounded local experiment. | Keep interoperability, SDP/ICE/DTLS refusal and loopback-only claims unaccepted. | Common codecs, TURN and browser/server interoperability remain prerequisites. |
| E90 | Metrics and performance runner are present. | Candidate-26 paired measurement exited 2 before metrics; no comparison is available. | Candidate-26 baseline initialization failed and current candidate timed out before metrics; its empty-observation thresholds-met field is vacuous. Complete a valid same-workload, same-hardware, same-browser pair. |
| E91 | `webtransport-adapter.ts` implements an adapter path. | Close trusted endpoint, authentication equivalence, WSS fallback and continuity. | QUIC/HTTP3 support and rollout policy require actual server/runtime evidence. |
| E92 | Stress harness and fixtures are present. | Broaden stress coverage to remaining suspension, network-change, and storage-pressure scenarios. | Candidate 26 stress passed 8/8; this does not close other stress scenarios. |
| E100 | Elm operations/Event Spine views provide operational read surfaces. | Close current privilege/health freshness and stale-observation handling. | No general host-management API is implied. |
| E101 | `operator-import.ts` and typed views parse doctor/setup data; the authored setup fixtures now use the server's `candidate_validation`, `hostname_check`, and `address_check` source fields. | Execute the updated source-shaped fixtures and retain safe unknown/pending projections. | Import remains read-only; actual source schema is authoritative; acceptance evidence is pending. |
| E102 | Account-security and moderation services implement factor-scoped operation paths. | Close current factor/scope, audit correlation and private result handling. | Requires current server authorization and audit outcome. |
| E103 | `integration-operations.ts` and its views implement typed integration operations and correlated reply handling; the helper has scoped source review. | Main/runtime production composition and complete effective-enable/readback workflows remain under integration; source review is not execution evidence. | Endpoint permission and feature configuration are external observations; package acceptance remains pending. |
| E104 | `host-management-bridge.md` and its v1 schema define a proposed remote-HTTPS bridge profile; the bounded design can be reviewed independently. | No runtime or backend activation is included. | Design acceptance review pending; trusted service implementation, pairing, deployment, and operational acceptance remain unavailable prerequisites. |

## Acceptance and external prerequisites

The following remain distinct from client implementation and must not be
reported as successful from mocks or source presence:

- Three-node/exact session cohorts, cross-node DM/history delivery, supported
  upgrades, cold restart and four attachments plus fifth resume.
- Equal-time history completeness, server multiline tag/label preservation,
  durable offline group welcomes and distributed fork arbitration.
- Browser capture-to-speaker audibility, real devices, public push delivery,
  arbitrary media/push mesh forwarding, QUIC/HTTP3, TURN, common-codec
  interoperability and playable recordings.
- Trusted browser host-management API, file upload service and effective server
  configuration/permission for each optional feature.
- Performance baseline and candidate with the same workload, hardware and
  browser. Current paired attempt failed before metrics; no comparison is available.

Deployment, public service operations and external IRC messages remain outside
this local evidence checkpoint. The isolated loopback lab is separate from
those actions.

## Current result limits

- Candidate 34 is the latest terminal affected run and failed. Receipt:
  `/tmp/onyx-elm-verification-final/affected-candidate-34.json`; source digest
  `dfebd14c11443185eb90ea207e958da83b39f71e4cc541862f9972a5c9416906`, archive
  `f1a263c2a8e2ff58f807606937d60de02e7c6224a9d51174cc9bfe06f8957fff`, and
  `sourceUnchanged: true`. Root tests passed 7,626/7,629 across 611 files;
  runtime passed 274/276, Elm 2,688/2,699, and Chromium 20/21. Schema,
  TypeScript, lint, Node smokes, expected-failure, stress, and authenticated
  two-node foundation passed. It is not an aggregate pass.
- Candidate-34 two-node ordinary session assertions passed 8/8 logical and
  9/9 exact, with bootstrap 1/1 each; fault-injection was blocked. Line3
  logical stopped before 381 because its operator/group prerequisite was
  unavailable. Line3 exact saw `TEMPORARILY_UNAVAILABLE` during detached
  restore; cause remains unknown. History ordinary assertions passed 101/101
  plus bootstrap 1/1; rate-limit/equal-time cases were blocked.
- Candidate 26 remains the last complete affected source cut; package and
  T-scenario reconciliation remains pending by individual requirement.
- Candidate-26 performance remains **unavailable**: the paired attempt ended
  before metrics and the threshold field is vacuous with empty observations.
- No paired performance measurement was run for candidate 34 or the current
  Wave35 correction source.
- Wave35 fixture corrections are being authored in an isolated copy and are
  untested; no source or acceptance status is advanced by this work.
- Ledger reconciliation by individual T scenario, milestone, cohort and §14
  prerequisite: **pending**.
