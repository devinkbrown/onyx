# Offline retention snapshots

## Scope and ownership

This contract closes the offline cached-history gap in roadmap §8 (around line
799): an explicitly unlocked local workspace must be able to read its own cache
under its last known authoritative retention policy. It does not create live
server authority. Namespace owns `owned-storage.ts` and its tests; Perf owns
bootstrap/fact integration; Main owns truthful history UI. Implement test cases
now and defer their execution until consolidated verification.

Current source behavior reported in the closure review is that `retentionFor`
requires complete live facts and a current policy revision, whereas retiring
authenticated facts clears room observations. Reloading offline therefore loses
the facts needed by get/around/search/export, even after local workspace unlock.
Persist the validated retention observation in the existing `VAULT_META` store;
do not add a store or bump the database version.

## Stored record

Use a versioned, module-owned metadata key made by the existing canonical tuple
encoder, with a retention-specific discriminator. Include the selected local
workspace namespace, canonical base conversation key and CASEMAPPING scheme.
Never derive the namespace from a disconnected live owner's null account, a
nickname, or an audience-prefixed wire target. Preserve the exact conversation
identifier separately. Neither JSON settings import nor public bridge payloads
may manufacture this record.

```ts
type RetentionSnapshotV1 = {
  version: 1;
  namespaceKey: string;
  targetKey: string;
  conversationId: string;
  caseMapping: string;
  policyRevision: string; // bounded 2048 UTF-8 bytes, opaque and exact
  retention: { kind: 'none' } | { kind: 'ttl'; seconds: string };
  observedAtMs: number; // finite, safe nonnegative local wall clock
  evaluatedThroughMs: number; // durable nondecreasing expiry-evaluation floor
  provenance: 'authenticated-complete-policy';
};
```

`seconds` uses the existing source-bound retention parser and limits; preserve
its exact unsigned-decimal domain and avoid unchecked numeric conversion.
`none` is an explicit complete authoritative observation of no TTL. Missing,
malformed, incomplete and legacy metadata are unknown, never `none`. The
snapshot contains no message body, key, token, membership assertion or claim
that encryption is optional. Validate stored bytes on every load, including
namespace/key/target/scheme agreement and revision bounds.

## Storage API and authority boundary

Add these conceptual methods to the existing owned-storage service, adapting its
existing result/request types rather than introducing a parallel store:

```ts
refreshRetention(context: RequestContext, conversationId: ConversationId):
  Promise<RetentionRefreshResult>;

type RetentionReadScope =
  | { kind: 'live'; policyRevision: string; lastSyncMs: number }
  | { kind: 'cached'; policyRevision: string; lastSyncMs: number }
  | { kind: 'unknown' };
```

`refreshRetention` accepts no policy, revision or authority flag from its caller.
It reads the existing authenticated-policy dependency, captures the selected
namespace ticket and canonical conversation scheme, and requires complete
current facts. Recheck request, namespace, mapping and fact revision after each
await and before commit. Serialize refreshes per namespace/target so an older
observation cannot overwrite a newer one. A retirement or policy invalidation
during the write must not commit that observation as current. Failures preserve
the previous snapshot and return an unavailable/stale result; they never invent
a fallback policy.

Extend the internal `retentionFor` resolution, shared by get/around/search and
export, to return the effective policy plus `RetentionReadScope`. Propagate that
scope through their existing result envelopes. Search/export must resolve and
filter each target independently: an unknown target must be reported or excluded
with explicit incomplete coverage, never exported without its retention check.
Retain existing all-or-nothing behavior if that is the existing API contract.

## Resolution and expiry

1. Complete current authenticated policy always supersedes the cached copy.
   Apply it immediately, even if snapshot persistence fails. Persist it through
   the refresh path. Current known TTL cannot fall back to an older `none`.
2. While live facts are pending, invalidated or contradictory, return unknown
   for that live target. Do not use the cache to bypass a current incomplete or
   restrictive observation. This does not erase the last complete snapshot.
3. When the runtime explicitly reports an offline local-history read context,
   and the selected namespace ticket is valid, use the exact matching stored
   snapshot. Offline means a local reading mode, not a fabricated authenticated
   owner; it can coexist with a registered guest viewing a different explicitly
   selected history-only workspace. Its scope is `cached` with the original
   observation time. Never label a read as live/server-synchronized.
4. No matching snapshot means unknown. Preserve legacy rows but hold them from
   retention-sensitive reads/export until real policy is learned. Do not adopt
   them into another workspace or relabel their policy.
5. TTL continues to elapse while offline. Reuse the existing validated message
   timestamp/expiry semantics and compare against wall clock, not elapsed time
   since unlock or snapshot age. Preserve exact wire timestamp/fraction bytes.
   A row with an unparseable expiry basis is held, not treated as immortal.
6. Prevent clock rollback from resurrecting previously expired rows: evaluate at
   `max(now, observedAtMs, evaluatedThroughMs)` and persist the increased floor
   transactionally before returning newly evaluated data. If that required
   persistence fails, fail closed rather than return potentially expired data.
   Keep the existing physical deletion policy; read filtering is mandatory.

Changing CASEMAPPING requires a current authoritative mapping/migration, not
guessing a new target key from a stored spelling. Existing namespace tickets
must fence selection, lock/reselect and account/network changes both before and
after asynchronous reads and before returning plaintext or export bytes.

## Bootstrap and UI hooks

Perf must call `refreshRetention` after a complete authenticated per-target
policy observation and when first opening a target with complete facts. The
collector's revision/complete-state change subscription provides the trigger;
do not write from untrusted peer messages or Elm booleans. Subscribe once and
dispose with the composed runtime. Disconnect retires live facts and selects
offline resolution; it does not delete durable snapshots. Explicit workspace
selection and an offline reload must reach the same owned-storage read path.

Main displays “Cached history · last synchronized …” for cached results and
truthful unavailable/incomplete coverage for unknown policy. Local unlock does
not claim new server synchronization. Normal reads need no separate manual
retention-panel action.

This change must not evict drafts or outbox rows, grant dispatch authority,
relax current required-encryption policy, persist plaintext previously forbidden
by the crypto boundary, or reinterpret a queue's known policy as unknown.

## Implementation acceptance cases (execution deferred)

- Complete live `none` snapshot; reload offline; explicit workspace unlock;
  normal history/around/search/export succeed with cached scope and last sync.
- TTL expires while closed; offline reopening excludes expired rows. Clock
  rollback does not restore them.
- Current complete TTL supersedes cached `none`, including failed metadata
  persistence. Live incomplete facts do not fall back to cached permissiveness.
- Legacy/malformed/foreign workspace/foreign mapping snapshot remains unknown.
- Lock, account/network switch or workspace reselection during any await returns
  no stale rows/plaintext/export. Switching back reads its own retained snapshot.
- Registered guest plus explicitly approved account history workspace reads only
  that local namespace without receiving live account/send authority.
- A 2048-byte valid policy revision survives validation consistently; larger or
  malformed revisions fail safely. Snapshot refresh ordering preserves the last
  current complete observation. Draft/outbox contents remain untouched.

This document is an implementation contract, not runtime acceptance evidence.

## Offline profile selection and UI owner transition

Source closure confirms a separate prerequisite: `bootstrap.ts` `close()` retires
services but currently retains `accountId`, `ownerRef` and `physicalRef`; its
workspace-select handler accepts `localWorkspaces.select()` without changing the
UI owner. `local-workspace-owner.ts:122–129` correctly rejects a selected B scope
against request owner A, including a different network. Do not relax that guard.

Perf owns one shared physical-retirement transition, used by explicit close and
actual transport termination. Retire the captured old owner and all dependent
operations before publishing a replacement snapshot: accountId=null,
physicalRef=null, fresh ownerRef, incremented connectionGeneration and
accountGeneration. Clear learned/tentative server identity, account proof,
registration, negotiated capabilities and live membership/policy authority.
Revoke local grants and old request tickets. Clear account authority even when
the transport closes unexpectedly. The transition must be idempotent for an
already retired physical connection and must publish `onOwnerState` so Elm stops
using its prior stamp. A new real connection allocates a fresh physicalRef and
still requires actual account proof.

Keep the existing public `workspace.select {workspaceRef}` action. Offline
selection uses this private two-phase sequence, not connection routing:

```ts
// Local-workspace-owner private service API; opaque refs are never public.
prepareSelection(input: {
  workspaceRef: string; explicitUserAction: true; context: RequestContext;
}): Promise<PreparedWorkspaceSelection | null>;
commitSelection(input: {
  prepared: PreparedWorkspaceSelection; context: RequestContext;
}): LocalWorkspaceScope | null;
```

The prepared object is registry-owned, bounded, one-use and short-lived. It
contains validated remembered/history-only metadata, captured previous selection
generation, and the configured network identity. No grant or plaintext is
released by preparation. Namespace/Lab owns these small workspace-service
methods; Perf owns orchestration. A network must already exist in trusted client
configuration; neither a backup nor a workspace row adds an endpoint or network.

1. Capture the current UI request and prepare the requested selection. Recheck
   request and selection generation after the metadata read. In online mode,
   require matching current network and proven account (or the already specified
   explicit guest history-only import exception). Refuse online A→B or network
   switches; do not silently disconnect or connect.
2. For a genuinely retired physical connection, perform the local UI-owner
   transition before committing the scope. Set networkId to the validated
   configured selected network; endpointId may only be an existing endpoint
   belonging to that configured network, chosen by configuration, never an
   imported address. It remains inactive. Keep accountId=null and
   physicalRef=null. Rotate ownerRef and connection/account generation stamps
   so every previous UI request is stale. Revoke previous grants and async work
   without disposing reusable services. Preserve the prepared selection only as
   a one-use, exact transition continuation; it must not survive other selection,
   lock, connection or configuration changes.
3. Commit synchronously under a newly minted internal RequestContext for that
   new snapshot, checking the prepared record against its exact predecessor and
   successor owner stamps and unchanged configuration. Bind selected grant and
   namespace tickets to the new UI context. Use the selected account solely as
   local workspace identity, never as snapshot.accountId. Offline predicates
   require explicit retired/local mode, not merely learnedPrefix===null during
   registration.
4. Publish the new owner state and selected workspace view as one ordered
   transition. Main must accept the owner-state event first, cancel old history,
   composer load/save and panel requests, and request history with the new stamp.
   Deliver the selection result as a transition observation stamped with the
   new owner; do not pretend the old request remains current. Other outstanding
   old-owner results remain rejected. If commit fails, report a locked/unselected
   local state under the new owner, with no restoration of old account authority.

   Main's owner-state handler must clear/quarantine the previously painted
   private view whenever ownerRef changes for this transition, including
   same-network null-account→null-account selection. A comparison of networkId
   and accountId alone is insufficient. Clear old conversation rows, decrypted
   previews, loaded composer plaintext, selected message/reply details, search
   results and export presentations before loading B. Preserve A's durable
   workspace-scoped drafts; do not save the old displayed draft under B. The
   fresh ownerRef is the minimal existing UI fence; no fake account proof or new
   public account identity is needed.

   Safe history result metadata is `retentionReadScope` with
   `{kind:'live'|'cached', policyRevision:string, lastSyncMs:number}` or
   `{kind:'unknown'}`. `lastSyncMs` is the snapshot's original authoritative
   observation time, validated finite/safe/nonnegative; it is never selection
   time or a claim that the current server confirmed offline reads. Main renders
   the cached label from this field only after checking the new owner/request
   stamp. Namespace supplies it for history/around/search/export; mixed-target
   results preserve per-target scope instead of inventing a common live time.

Use the same local path for same-network A→B and cross-configured-network
offline selection. Do not call connect, SASL, account proof, tab attachment
acquisition or default live-workspace initialization from this path. The latter
must not overwrite explicit offline selection. User connection remains a
separate explicit action that retires local request authority and performs the
normal configured endpoint/account authentication flow.

Required deferred cases: disconnect authenticated A then select remembered B;
select B on another configured network; lock/reselect while preparation waits;
connection starts while preparation waits; stale A history callback after B
commit; online A attempts B; and offline selection followed by explicit real
connect. Reads must use B's namespace and cached retention without asserting B
is logged in. These are implementation requirements, not verified outcomes.
