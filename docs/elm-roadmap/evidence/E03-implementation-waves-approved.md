# Elm client implementation waves

This file preserves the architect-owned implementation order and interface
contract. It is not an acceptance receipt. All E rows, T rows, browser cohorts,
server gates, and non-E requirements remain individually pending in
`acceptance-ledger.json` until evidence is attached.

## Candidate 5 source/verification checkpoint

Candidate 5 was captured before the current documentation refresh. Its manifest
is `e14bfe77bb6b1154ba8cade2fa27431d061d759809503f68418e4754ec8067e4`, and its
restored POSIX archive SHA-256 is
`2a9d9bf774d61f2f8bee807320c80a3134e90c0e8267c14929c731a4bf14e5f2` (2,001
selected files; tool provenance complete). The affected gate passed typecheck,
lint, Elm 2,603/2,603, runtime 124/124, all Node smokes, the Playwright list
audit, and Chromium mock 20/20. Root test reuse was 7,604/7,604 from an earlier
receipt with 608 unchanged root inputs, not a new candidate-5 run. The
candidate-5 contract observation records the then-current client-pass/server-
fail E02 disagreement. A separately authorized source-backed correction is
under review; retain the historical receipt and keep the revised E02 gate
pending until both validators and negative tests are exercised. Stress was interrupted for an obsolete fixture selector; the
corrected real local-server foundation journey has not been rerun after the
guest queue fix; no performance comparison has been measured. These are
implementation signals only: E/T/cohort/milestone acceptance remains pending.

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
