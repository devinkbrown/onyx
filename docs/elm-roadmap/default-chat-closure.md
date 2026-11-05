# Default chat closure: design contract and candidate-5 checkpoint

This document began as a source-only design and defect inventory on 2026-11-04.
Its initial diagnosis below is historical where marked; the requirements remain
the intended contract. Candidate 5 has been executed: root typecheck/lint,
2,603 Elm tests, 124 runtime tests, all Node smoke tests, and 20 Chromium mock
cases passed. The real local-server foundation send journey was not rerun after
the guest-send repair, so that end-to-end path remains open for acceptance.
Preserve full-intent/multiline/acceptance contracts.

## Ownership and actual defects

- **Lab:** NEW `elm/runtime/memory-send-owner.ts` and tests; bounded
  local-workspace-owner.ts `ensureCurrentWorkspace` helper only, coordinating
  with its current owner. No bootstrap or facts edits.
- **Platform:** bootstrap composition/shared validated send-plan builder and
  authenticated-facts.ts channel/DM policy, peer queries and source observations.
- **Namespace:** new send-acceptance-registry/tests and journal adapter work.
- **Main:** default composer/results and automatic draft save/load/revision UI.

The initial source audit found that the guest journal branch returned a
memory-only result without a send record and durable `runFlush` rejected guests.
That diagnosis has been superseded by the bounded memory-send owner and the
default composer result path. Candidate-5 unit/runtime/Node and Chromium mock
lanes pass, but the corrected guest-send flow has not yet passed the real
local-server foundation journey. Authenticated automatic workspace setup and
the requirements below remain subject to owner-fenced source review and
scenario-specific acceptance; module presence alone is not closure.

The initial audit also found room-only `policySnapshot` and a raw/canonical DM
target mismatch. Those findings motivated the current raw-target DM facts and
canonical route checks. Keep the security requirement: never fix a routing or
policy gap by trusting an Elm `plain` boolean. Candidate 5 does not certify the
full DM history/privacy matrix.

## One default send decision

Bootstrap's actual composer/journal.queue adapter:

1. Validate current registered physical owner, target/full canonical intent,
   negotiated bounds and fresh private policy. Unknown/required encryption never
   falls back to plaintext.
2. Matching account local namespace plus available durable journal/custody uses
   existing durable queue/claim path.
3. Guest plaintext OR unavailable durable IDB/local custody with current proven
   plaintext policy uses the explicit bounded memory sender below. This includes
   authenticated plaintext chat when browser storage is unavailable.
4. Offline volatile sends are blocked; preserve draft. No plaintext durable
   fallback, no shared old WSS path, no automatic replay when network returns.
5. Required encrypted sends use actual current provider protection or remain
   locked/recovery-required. Storage failure is not authority to downgrade.

Plain channel eligibility needs actual self JOIN/current write authority and
complete current policy, not every visible roster member having an account.
Guest peers are legal members. Full verified membership is a separate encrypted
author/media requirement, not a prerequisite for ordinary channel chat.

## Memory sender exact private API

```
createMemorySendOwner({ownerSnapshot,isCurrent,isRegistered,
  policySnapshot,prepareLivePlan,validatePreparedPlan,sendLineGroup,
  verifyAcceptanceProof,onObservation,now})

submit({context,intent}):Promise<MemorySendResult>
reconcileAccepted({context,recordId,proofRef}):Promise<MemorySendResult>
inspect(context):readonly MemorySendSummary[]
retireOwner(owner):void
dispose():void
```

Intent is the existing full canonical v2 chat intent: clientIntentId, base
conversation/targetKey, messageKind, replyTo, audiencePrefix and body. Memory
sender accepts only PRIVMSG and proven plaintext; explicit MEMO stays in its
separate supported account path. Generate a private volatile record ID before
preparation and install deduplication/attempt state before bytes leave.

`prepareLivePlan({context,recordId,intent})` returns the SAME source-encoder plan
used by journal preparation: `{lines,validationReceipt,planHash}`. Platform
extracts/reuses its actual single/multiline/fallback builder, not another ad hoc
IRC concatenator. Namespace registry binds that volatile attempt with the same
owner/claim/target/plan/label rules. Full UTF-8/reply/action/audience limits apply.
Required room ciphertext tagging is not part of this plaintext-only fallback.

`policySnapshot` returns current registered physical generation, self membership/
write permission, plaintext-policy revision/mapping fence and network readiness.
Check before/after every await and immediately before group admission. A guest
does not need accountId; its authority is the current actual physical owner.
For plaintext DM, current target/policy facts below replace channel membership.

`sendLineGroup` is the existing fenced physical group sender, serialized with
durable groups and raw user sends. No direct WebSocket/global OnyxPorts fallback.
All lines admitted→transport-admitted, complete real proof→server-accepted,
any partial/unknown/owner loss after possible bytes→delivery-unknown. Definitive
zero-write block is blocked and may be explicitly retried while context remains
current. No automatic resubmit of admitted/unknown records, no flush method.

Result includes recordId, clientIntentId, existing admission/status semantics and
`durability:'volatile'`. Summary retains safe intent metadata/deduplication status
only. Pending/unknown UI clearly says not saved across reload. At most32 active
records and2MiB transient bodies per physical owner; after admission release
unneeded body bytes, retain bounded labels/hashes/status. Retirement/dispose clears
bodies/private refs and prevents old callbacks changing a new owner. Reusing the
same clientIntentId returns its existing result; changed metadata is conflict.
Registry onProofReady routes to memory.reconcileAccepted or durable journal by
its private registered attempt type, never by a caller guess.

## Automatic false-consent workspace lifecycle

Add `localWorkspaces.ensureCurrentWorkspace(owner):Promise<LocalWorkspaceScope|null>`.
This is NOT a remember-consent setter. If current valid matching physical guest
or actually proven account scope is already selected, return it without changing
epoch/key/consent. Otherwise reuse stable installation/account custody identity,
create/select a new scope with remembered:false only when none exists. Preserve
existing explicit remember consent; automatic reconnect must not silently revoke
it by invoking rememberProvenOwner(false). Never select a foreign/history-only
scope as live workspace. Never manufacture account proof from persisted rows.

Bootstrap runs ensure after accepted001 for guest and actual account proof for
account; before switching lock/revoke prior local namespace synchronously. Save
an initialization epoch/context and recheck after awaits; stale A initialization
must not select A after B becomes current. Only one initialization per owner is
in flight; repeated proof/001 signals are idempotent. Network change also retires
the old scope. Capture authenticated CASEMAPPING into the matching scope once
source-known. While initialization is pending, serialize dependent draft/queue
operations against that bounded promise, then either proceed or show actual
storage failure; no requirement to open a runtime panel first.

If storage cannot provision custody, current plaintext chat uses memory path;
draft UI says memory-only/unsaved. Persisting stable local keys does not itself
grant remember-login consent or automatically unlock old account data on reload.

## Source-backed channel defaults

After a complete correlated PROP snapshot, absent encryption-policy means off
for this source: server.channelEncryptionPolicy around50250. Before snapshot,
or after invalidation/incomplete response, it remains unknown. Invalid property
values stay unknown on the client rather than manufacturing permission.
Absent EPHEMERAL after complete PROP means no TTL; incomplete means unknown,
not a zero-second expiry. Do not require a nonexistent property before chatting.

Required-room wire admission is exact `+onyx/e2ee=mls` ONCE and canonical
ONYXROOM1 envelope≤4096 bytes, per src/proto/e2ee_policy.zig. Platform already
owns this repair. No plaintext fallback or generic encrypted=1 tag; no fragmented
encrypted envelopes. Reply/label/audience fields remain under prior constraints.

## DM target, routing and encryption designation

Keep raw display/wire target separate from canonical storage conversation key.
Facts.normalize target internally with current CASEMAPPING; resolvePeerConversation
accepts the raw ConversationId from Main and returns the same requested ID plus
canonicalTarget/account/mappingGeneration/routingRevision. Compare canonicalized
forms on BOTH sides. Do not compare canonical tuple bytes to a raw nickname.

Add private `facts.observeDmTarget({context,target})` and
`facts.dmPolicySnapshot(owner,target)`; Main navigation/composer supplies a target,
never a policy flag. Observe first direct message navigation/send and accepted
private ingress/history hydration. If no shared room proves the peer account,
issue bounded serialized WHOIS target: exact-server330 proves account,318 closes;
401 means unavailable. Lack330 on complete318 can describe an unauthenticated
peer, never infer nickname==account. Account/nick/quit/connection/mapping change
invalidates routing. No account proof is needed to send ordinary allowed plaintext
to a guest peer; encrypted account-bound crypto still requires real peer identity.

Preserve actual existing DM designation from App.dmDesignated/DmCipher:
peer key change, validated ocean.dm-key/ocean.dm-keys advertisement, verified
directory devices or observed encrypted history boundary requires encrypted/locked
behavior. The private runtime ingests exact-server METADATA/761 responses and
complete762 (server handleMetadata52174–52271) and validates public-key shapes;
it does not trust a public Elm `no key` claim. Metadata queries serialize or use
actual labels because762 may omit target. Directory structural provenance alone
does not grant cryptographic trust; provider pins/verification still apply.

Private storage supplies `observeDmHistoryBoundary({ticket,target,boundary})`
from actual owner-scoped scanned/hydrated wire records: encrypted, plain-scope-
complete or unknown. This is internal trusted adapter input, never an Elm port.
Encrypted boundary is sticky for that scoped conversation absent explicit audited
reset; absent current peer key must not erase it. Unknown/missing legacy rows stay
unknown and cannot grant plaintext cache/export/search permissions.

DM sending policy distinguishes designation from history-search privacy: current
complete metadata/directory absence and no known encrypted/key-change boundary
permits the existing ordinary plaintext DM behavior, even when archive search
privacy is not proved. Incomplete discovery remains unknown until bounded query
completion; do not downgrade a designated conversation while keys are unavailable.
Current explicit user encrypted preference can strengthen policy, not override a
required designation. A peer with keys but missing trust/owner identity is locked.
History-search/plaintext persistence permissions retain their stricter existing
proof scan; ordinary send availability is not a blanket privacy proof.

Bound32 pending peer queries,256 target facts,10second query deadlines. Retain
only current owner/mapping source facts; timeouts return unknown, never no-key.
Provider consumes dm-required/plain projection and actual route/directory facts;
it does not read an Elm policy boolean. Wire envelope/private key formats remain
existing canonical ONYXDM1/ONYXDMN1; no new protocol.

### Stable queued policy versus operation fences

Current bootstrap policy.revision embeds connectionGeneration/mappingGeneration/
membershipGeneration. Strict equality to that string holds every known queued
intent after reconnect even when actual policy is unchanged. Replace its durable
meaning with canonical JSON of this fixed tuple:
`['onyx-send-policy-v2',networkId,baseCanonicalTarget,stableCaseMappingScheme,
encryptionMode,peerAccountIdOrNull,ephemeralSecondsOrNull]` (bounded2048 bytes).
These are source-observed semantic facts, not volatile counter values. Unknown
TTL/routing/policy does not generate a known revision. Guest peer identity without
stable account binding cannot authorize automatic old-connection DM replay.

Keep connection/account/physical/mapping/membership/policy-observation generations
as separate in-memory fences checked around every await and wire effect. Fresh
self membership/write/trust/head availability still gates dispatch; it must not
be encoded as a counter that permanently invalidates equivalent durable intents.
Known required→plain or peer-account rebinding remains held/review, never silently
downgrades/retargets. Same required privacy with a fresh verified epoch may seal
an unadmitted intent once under the current head; admitted/unknown never reseal.
Preserve genuinely unknown-at-queue sentinel separately. Old counter-only known
records lacking semantic facts need explicit review/migration proof; never rewrite
them as unknown to bypass checks. Unchanged known plaintext channel policy can
therefore flush after actual rejoin/reconnect without manual policy reset.

## Default draft integration

Main automatically loads selected conversation draft after matching custody/
CASEMAPPING readiness and saves debounced edits through the real private store.
Use runtime canonical target/ticket key, not String.toLower. Capture draft revision,
conversation, UI owner and local workspace epoch for load/save; a late load cannot
overwrite newer typing or another conversation, and a late save cannot claim the
newer revision is saved. Composer queue acceptance clears only the submitted
revision, not later edits. Blocked/unknown send preserves relevant text/intent and
shows saved-encrypted versus memory-only/unsaved truthfully. Quota does not erase
the newest draft. Retirement clears old plaintext from visible composer state.

Authored scenarios cover guest default chat, authenticated automatic custody,
IDB-denied plaintext, offline volatile refusal/no replay, non-mutual/raw mixed-case
DM, peer account/key change, encrypted history with missing key, absent complete
PROP defaults, exact required-room tag/limit, and draft stale load/save races.
Execute after all implementation; helper-only tests do not establish journeys.

## Scheduled-message custody and current integration boundary

Scheduled messages use the existing IndexedDB v5 `scheduled` object store. The
runtime adds no database-version bump and does not adopt legacy schedule bodies:
the store reports only bounded legacy-held counts and an unavailable-review
flag. A valid row is owner-scoped and stores schedule metadata plus ciphertext;
listing projects opaque schedule references, target, due time, message kind,
reply/audience metadata, revision, mode, and state without opening the body.
Relevant source: `elm/runtime/migrations.ts` (`SCHEDULED`, `openVaultV5`) and
`elm/runtime/scheduled-custody.ts` (`StoredRow`, `scanOwned`, `metadata`, `list`).

For account workspaces, the payload body and captured policy are sealed through
the local workspace grant. The authenticated purpose is
`scheduled:<operationId>:<revision>`, and the canonical conversation target is
the exact binding; every edit increments the revision, so older ciphertext does
not open as a newer edit. The encrypted payload carries schema version 1,
revision, target key, due time, message kind, reply, audience prefix, captured
policy, and body. The service checks the request namespace and workspace grant
around crypto operations. Text is capped at 65,536 UTF-8 bytes and each sealed
record at 262,144 bytes; per-account row and byte quotas are 256 and 2 MiB.
Relevant source: `scheduled-custody.ts` (`sealPayload`, `privatePayload`,
`validMetadata`, `MAX_BODY_BYTES`, `MAX_RECORD_BYTES`) and
`elm/runtime/bootstrap.ts` (scheduled `seal`/`open` provider adapters).

Guest scheduled messages remain volatile in memory and are fenced to the actual
physical connection. The cap is 32 rows and 2 MiB of body bytes per owner. Body
bytes are cleared when rows leave custody or the owner retires; no guest schedule
is recovered from disk after reload or reconnect. Durable queue admission uses
`queueScheduledMessage` and compares the frozen captured policy with the trusted
policy snapshot during admission. The journal still owns durable claims,
prepared-line validation, transport admission, and unknown delivery states;
schedule custody does not send directly to the socket. Relevant source:
`scheduled-custody.ts` (`MAX_VOLATILE_ROWS`, `MAX_VOLATILE_BYTES`,
`dispatchVolatile`, `dispatch`) and `elm/runtime/outbox-journal.ts`
(`queueScheduledMessage`, `runFlush`).

Create and edit plaintext enters through the private DOM editor in
`elm/runtime/bootstrap.ts` (`openPrivateScheduledMessage`). It returns an
owner/request-bound, one-use `inputRef` and due time to Elm; the body is read
privately by the custody service, checked, sealed, and wiped. The ordinary
composer body is not copied into the Elm scheduled list. `App.elm` carries only
private form request/result metadata, and `View/Scheduled.elm` renders no
scheduled body. The typed `RuntimeDomain.ScheduledItem` projection preserves
target, due time, revision, mode, message kind, reply, and audience prefix so
Edit/Review can reopen the private form without dropping send semantics.

Create admission is captured before the private editor opens. The opaque
admission retains the original request, owner, namespace ticket, operation ID,
and owner mutation generation across the editor's asynchronous lifetime; a
cancelled, expired, or retired admission is consumed/retired and cannot be
refreshed against a newer generation. For durable account workspaces, the
generation is stored as an owner-scoped opaque record in the existing
`VAULT_META` object store. The create transaction compares the captured value
with the current generation in the same read-write transaction that adds the
`SCHEDULED` row. Cancel advances the generation and deletes the exact schedule
row atomically in one transaction, so an older editor admission cannot add a
row after cancellation. Guest schedules use the corresponding in-memory
generation fence, which is retired with the physical owner and is never
recovered from disk. Relevant source: `scheduled-custody.ts`
(`captureCreateAdmission`, `bindCreateAdmission`, `writeNew`, `cancel`,
`retireOwner`) and `bootstrap.ts` (`requestPrivateScheduledMessage`).

Policy changes produce the fixed status “Review required before dispatch”; they
do not silently reclassify a saved message as allowed. The current view offers
Review for that state, Edit for a scheduled row, and Check status for
delivery-unknown/dispatching rows. The custody service's `reconcile` checks the
exact schedule reference and revision, then queries the existing journal by
immutable client-intent ID. A missing or pruned journal row is still unknown; it
is not proof that dispatch never began. Reconciliation never creates a new
intent or sends bytes. Relevant source: `scheduled-custody.ts` (`reconcile`)
and `elm/src/View/Scheduled.elm` (`runtimeScheduledRow`). The runtime router
now has an explicit `reconcile` branch to this method, separate from `dispatch`
(`elm/runtime/bootstrap.ts`, scheduled command routing).

Bootstrap now owns a 15-second single-flight due pump. It captures the current
request namespace, lists at most four due rows per pass, and admits only rows
whose state is `scheduled`. Before dispatch it requires a current namespace,
known compatible policy, current encryption eligibility and, for rooms, complete
joined/write membership; it also checks negotiated reply support and the actual
STATUSMSG prefix policy. Custody repeats owner, claim, and captured-policy checks
before journaling. Unknown-policy, dispatching, delivery-unknown, and
policy-review rows are skipped; none are automatically retried. After a changed
batch, bootstrap publishes a fresh metadata-only scheduled list observation.
The runner starts after guest registration or proven account setup, and stops on
physical retirement, reconnect, and disposal. Relevant source:
`elm/runtime/scheduled-due-pump.ts` (`createScheduledDuePump`) and
`elm/runtime/bootstrap.ts` (`runScheduledDuePump`, `startScheduledDuePump`,
`stopScheduledDuePump`, registered/account lifecycle hooks).

The scheduled custody path is the runtime service and private form bridge above;
the legacy `scheduledFenceRequest`/`scheduledAddRequest`/`scheduledDispatchRequest`/
`scheduledCancelRequest` Node adapter path has been removed from `elm/ports.js`.
`elm/scheduledVault.smoke.mjs` remains a compatibility smoke for that former
adapter contract and is not evidence for current encrypted custody, generation
fencing, or dispatch behavior. Candidate 5 ran the current
`elm/runtime/scheduled-custody.test.ts` coverage as part of 124 passing runtime
tests and passed `elm/scheduledRuntimePorts.smoke.mjs` among the Node smoke
lane. These are source-bound implementation checks; real local-server schedule
dispatch, crash/reload cohorts, and roadmap acceptance remain open.

These notes record source implementation boundaries only. They are not a passing
acceptance result, release claim, or completed full-roadmap claim.
