# Production bootstrap implementation contract

This is the frozen implementation map for Platform Luna's `bootstrap.ts` batch.
It specifies private implementation functions, not additional public bridge
actions. Main Luna keeps App/Main/View/ports/shared contracts/build integration.
Storage Luna owns the private provider/store implementations identified below.
No execution is needed to implement this graph.

## Construction and lifetime

1. Keep existing `createBrowserRuntime(config)` connection/auth/CAP methods.
   Establish `snapshot`, `isCurrent`, `requestCurrent`, learned server identity,
   endpoint registry, private request/proof/ref registries and a disposer stack.
2. Construct browser lifecycle, metrics, tab-intent owner and local workspace owner.
3. Construct transport with a private ingress multiplexer before public projection.
4. Construct authenticated facts on that multiplexer. Do not ingest the same line
   again through an authenticated-server subscription.
5. Construct private crypto provider with the mappings below. Cyclic references
   use closure lookups initialized before any service receives events, not null
   success stubs. Defer event delivery until the graph is complete.
6. Construct messages, drafts, journal, anchors, settings, eviction and import.
7. Construct notification adapter/private platform store, worker, push and router.
8. Construct Cadence adapter/media facade, caption producer, WebRTC experiment
   and WebTransport adapter. Register binary/private control consumers.
9. Subscribe all safe projections; enable installed feature readiness from actual
   prerequisites. Publish the typed command dispatcher and dispose hook.

On owner retirement synchronously revoke live request/proof authority before
async cleanup. Recreate provider/domain instances when their owner lifetime ends.
Local workspace access is separately revocable and does not become live auth.
Dispose in reverse construction order; clear one-use refs and pending callbacks.
Workspace selection epochs fence operations; they must not enter stable at-rest
AEAD identity in a way that makes saved ciphertext unreadable after lock/reselect.

## Private bootstrap functions to implement

All of these are owned by Platform Luna inside bootstrap or a private sibling
module. Their names are implementation names and do not change frozen ports.

| Function | Concrete data/behavior |
|---|---|
| `requestCurrent(context)` | Exact current UI owner/network/account/physical/connection/account generations and nonretired request. |
| `provenAccount(owner)` | Current source-confirmed account proof recorded by existing001/900/accepted auth flow; never account metadata from disk. |
| `resolvePrivateRef(ref,kind,context)` | Private map lookup, exact expected kind and owner/request binding, expiry, one-use consumption. |
| `privateFiles` | File input bytes/Blob download and private password DOM reads; bounded sizes, clear controls, cancellation and final request checks. |
| `roomGate(owner,room)` | Private map with ready/paused-membership-change/recovery-required; invalidated by facts/provider callbacks. |
| `cryptoPolicy(owner,target)` | Current facts encryption plus verified provider accepted head and room gate; unknown stays unknown. Never directory-derived epoch. |
| `journalPolicy(owner,target)` | Current proven live owner/network state, membership, crypto policy, server memo enablement and current write permissions. |
| `retention(owner,target)` | Known current server history/TTL policy, capped durable keep400; unknown policy blocks destructive eviction. |
| `proofs` | One-use private registries for exact MARKREAD and send acceptance, bound to real ingress/attempt/target/owner/mapping. |
| `privateMediaIngress` | Exact-server caller-targeted `EVENT … MEDIA …` decoder using the server's actual trailing-body grammar; consume and normalize private fields before public projection. It does not accept NOTE as a media acknowledgement. |
| `safeEmit` | Explicit DomainView projection and request/owner/sequence envelope; no arbitrary errors, keys, bearer bytes or raw service objects. |

`cryptoPolicy` must allow real current plain chat when source policy says so.
Unknown or required encryption cannot downgrade. Required-room policy can have
no installed epoch and must then render locked/recovery-required.

## PrivateCryptoDeps: every callback

The names in the first column are the actual current provider dependency names.
Use adapters to their exact TypeScript signatures rather than unsafe casts.

| Dependency | Actual producer/implementation owner |
|---|---|
| transport | Existing `createTransportOwner` instance; Platform composition. |
| ownerSnapshot / isCurrent | Existing bootstrap `snapshot` / `isCurrent`. |
| localOwnerGrant / validateLocalOwnerGrant | Compatibility live-account adapter over workspace selected grant, only exact matching live account/network. Storage supplies adapter for its legacy local-grant shape; do not cast the new workspace scope into OwnerSnapshot. |
| validateWorkspaceGrant | `workspace.validateGrant`; separate local-only authority. |
| indexedDB | Browser IndexedDB capability, unavailable visibly if absent. |
| canonicalConversationKey / conversationKeyScheme | `facts.canonicalConversationKey` / `facts.conversationKeyScheme`; selected offline namespace uses captured ticket plus stored stable scheme in local store adapters. |
| conversationPolicy | Bootstrap `cryptoPolicy`, reading actual provider session/head projection and facts/gate. |
| authorizePurpose | Exact current request/purpose allowlist in bootstrap; private group/media operations additionally validate their room/call/device contexts. |
| identityPurposes.proveAccount | This generic challenge API has no common source-defined proof transcript and currently no callers: explicit unsupported is correct. Actual login must retain its real mechanism-specific private SASL/continuation/passkey/certificate path. Never invent a generic signature or substitute identity-owner boolean bookkeeping. |
| identityPurposes.verifyServerProof | This generic API likewise has no defined common source proof protocol/current callers: refuse explicitly. Actual endpoint/server/auth transcript checks remain mandatory in their concrete mechanisms; a server-shaped prefix is not generic cryptographic proof. |
| identityPurposes.verifyTrustedDevice | Provider's actual pinned signer verification helper (Storage-owned); facts provenance is insufficient. |
| ensureRegisteredDevice | `facts.ensureRegisteredDevice`, matching derived device ID + ADD acknowledgement + exact complete LIST readback. |
| resolvePeerConversation | `facts.resolvePeerConversation`; exact current WHOX/WHOIS/account routing with revision/fences. |
| directoryRevision | Current composed verified-directory revision for target from facts plus provider trust projection; not an invented constant. |
| authenticatedDirectory | `facts.authenticatedDirectory`, explicitly structural authenticated source with trusted:false. |
| conversationForRoom | Current facts mapping/canonical target resolution plus validated ConversationId constructor; no host/account guess. |
| roomMembershipFacts | `facts.roomMembershipFacts`, preserving complete/hidden/rank/member/mapping generations. |
| resolveMediaPeer | Provider-owned verified signed handshake association; facts provides nick→account only. Storage supplies helper; never guess device from nick/AID. |
| freshGenesisFact | Adapter over `facts.freshCreateFact`: actual tracked admitted CREATE, OID, founder/current membership/mapping/PROP, provider local identity. Local recipient bootstrap is a different path. |
| authorizeGroupAuthor | Facts complete current member and operator role plus provider verified own device. Server chanmode.isOperator is op/owner/founder (`o/q/Q`), not derived network oper `Y` alone. |
| authorizeRemoteGroupAuthor | Same current role/account facts with provider verified signer/device binding; no raw directory trusted flag. |
| reserveFreshCreateProof / validateFreshCreateReservation | Facts one-use CREATE reservation map; match exact owner/room/operation and current fences. |
| setRoomSendGate | Bootstrap `roomGate` mutation + typed safe observation; read by composer/journal/provider seal. |
| readBackupPassword | `privateFiles` one-use private password ref scoped to current confirmed backup operation; never Elm text. |
| requestGroupWelcome | Storage-owned signed canonical key-package operation. Actual existing wire is `E2EEGROUP room key-package deviceId payload` (`irc/client.ts` sendCurrentEpochWelcomeRequest). Produce payload privately; do not fabricate server acceptance. |
| enrollVerifiedDevice | Storage-owned identity enrollment wrapper calling its actual ensure identity + facts registration/readback, then exact verified device result. |
| selectionMetadata | Storage-owned accepted receipt/backup registry; real room/epoch/commit metadata, not caller labels. |
| readPrivateBackupSelection | `privateFiles` resolves explicit private selection/password; Storage resolves actual selected epoch key from its private registry. No key export through bootstrap public objects. |
| writePrivateBackupSelection | `privateFiles` Blob download to exact owner-scoped output ref after checks. |
| readPrivateImport | `privateFiles` bounded selected bytes + password ref; destructive ownership/expiry checks, zero transient buffers. |
| authorizeRemovalIntent | Current facts role + explicit current operation + provider verified device; other same-account device is valid, current author removal retires itself. |
| onReadiness | Internal feature readiness and safe public status; never accepts Elm boolean claims. |

### Storage-owned completion helper

Storage Luna must finish the provider-owned operations in this table as concrete
private methods/closure adapters. Platform must not reconstruct them by exporting
keys. Keep the existing provider/factory contract stable; supply a narrow internal
helper for any remaining callback cycle before returning the provider. In
particular enrollment, accepted metadata, trusted device/media association and
canonical signed welcome payload construction are implementation work, not null
providers. Main owns the existing private authentication mechanism operations.

## Storage constructors

Every store receives the same captured `LocalNamespaceTicket` resolver/validator.
This is required even if its current source still needs Storage's namespace patch.
Do not wait to instantiate the graph: wire the frozen ticket functions now.

| Constructor | Callback mapping |
|---|---|
| `createOwnedStorage` | ownerSnapshot/isCurrent→bootstrap; canonical key/scheme→facts or selected stored scheme; projectForPersistence→provider canonical ciphertext/current-policy projection; currentPolicyRevision→cryptoPolicy.revision; retentionPolicy→retention; measureIdb→metrics.recordIdb. Never persist caller privacy labels without provider validation. |
| `createDraftStore` | canonical key→captured ticket scheme; sealLocalDraft/openLocalDraft→provider workspace-local AEAD adapters, purpose draft:revision, packed nonce/ciphertext conversion matching store; canRecoverOwner→explicit selected recovery grant, not ownerRef equality. |
| `createOutboxJournal` | policySnapshot→journalPolicy; prepareQueuedPayload→provider.prepareQueuedPayload; prepareDispatch→provider.prepareDispatch; memoCorrelationClear→private serialized active-MEMO registry; verifyAcceptanceProof→proofs exact attempt evidence; metrics→recordIdb. |
| `createReadAnchorStore` | canonical key/stable mapping→facts/ticket; consumeMarkerProof→proofs one-use exact registered prefixless MARKREAD record; viewed candidate never mints this proof. |
| `createSettingsStore` | installationId→private stable installation identity; ownerSnapshot/isCurrent→bootstrap; canonical key→ticket; known setting allowlist and explicit opt-ins remain store-owned. |
| `createEvictionPolicy` | readAcceptedHistory→owned store selected partition; retentionRevision→current retention facts revision; clearAccepted→owned store selected explicit IDs only; isCurrent includes captured ticket. |
| `createOperatorImport` | readPrivateFile→privateFiles; emit→safeEmit. Only preview/get/dismiss; no authority application. |

For journal queue/inspection a selected account workspace may be offline; for
dispatch the actual live proven account must match the durable row namespace.
Ordinary chat stays PRIVMSG and explicit memo stays MEMO SEND. Unknown/admitted
attempts are never automatically resealed/resubmitted.

## Platform constructors

Common RuntimeFactoryContext is snapshot/isCurrent/transport/provider.privateIdentity,
safeEmit and the actual PlatformDeps below.

| Constructor/dependency | Actual source |
|---|---|
| notifications | `createBrowserNotificationAdapter(navigator.serviceWorker, Notification)` with feature detection. |
| privateStore | `createPlatformPrivateStore(indexedDB,isCurrent)`; real DB1, no memory-success substitute. |
| build | Build-produced ID/protocol/hash allowlist and full schema tuple including localWorkspaces1. |
| getPushConfig | Current configured node/WEBPUSH/VAPID source metadata; unknown disabled, no manufactured public key. |
| privateSendWebPush | Actual native subscription private fields + formatted SUBSCRIBE/UNSUBSCRIBE through transport, serialized correlation in push service. |
| `createPushLifecycle` | Common context/platform; feed exact learned-server NOTICE/FAIL parsing and owner/node stamp into its reply observer. |
| `createWorkerLifecycle` | currentClientRef→private random tab ref; acquireActivationLease→actual tab quiescence lease/status handshake; drafts/journal/crypto/media drive real canActivate state. |
| `createNotificationRouter` | notifications; configured origin/path allowlist; private binding maps from platform store; typed route encoder into actual Elm route; navigate actual router/location only after owner/binding validation. |
| `createBrowserLifecycle` | Browser window/document/navigator. Freeze/pagehide revoke pending authority; resume/reconnect never replay uncertain writes. |
| `createMetrics` | Browser timing APIs; actual ingest duration and IDB callbacks; engine counters via media service. Missing samples remain unavailable. |

## Media and experimental transport constructors

| Constructor/dependency | Actual source |
|---|---|
| `createCadenceTransportAdapter` | common context; currentNick→actual registered nick; activeRequest→private current call registry. One existing physical socket, no extra attachment. |
| `createMediaEngine` createEngine | Cadence adapter.createEngine; actual packaged workers/WASM assets. |
| mediaIdentity / verifyPeerMediaKey | provider.privateIdentity purpose-specific methods and verified signed device/attachment bindings; no global key stores. |
| media authenticated events | Private normalized exact-server MEDIA feed before public projection; actual room/target parsing and current call generation. |
| sendControl | format actual MEDIA CONSENT/RECORD commands and return real SendAdmission. |
| recordingPolicy | Current authenticated active media roster + exact consent revision; no blanket allConsented default. |
| mediaDevices | navigator.mediaDevices; capture begins synchronously in native trusted click, not after Elm round trip. |
| `createCaptionProducer` | getOwnedLocalAudioTrack→clone actual current call microphone; captionConsent→current member/consent policy; onRetirement→call/owner/member/consent events; sendCaption→Cadence adapter including captured callRef. Label server-visible captions. |
| `createWebRtcExperiment` | Actual capture lease/native RTCPeerConnection capabilities and observed stats; bounded local loopback only, real private cleanup. |
| `createWebTransportAdapter` | Explicit configured trusted endpoint; actual browser WebTransport constructor and stream reader/writer; same owner/auth/private ingress adapters, explicit WSS fallback, no protocol/security equivalence assumption. |

## Dispatch completion and source handoff

Implement every frozen DomainPayloads handler, not just workspace. Convert payload
to the actual service input; consume refs privately, project exact safe result,
retain original request/owner stamp. Subscription observations are independent
monotonic stamped views. Main mounts all corresponding controls and recovery views.

Return one integration manifest listing constructors instantiated, actual private
ingress consumers, command handlers, subscriptions/disposers and any remaining
client implementation gaps. No further noncritical architecture churn before
that integrated declaration; no tests/builds until all implementation is ready.

## Final journal line-group extension contract

This bounded extension preserves existing multiline/reply/action semantics when
ordinary sends use the journal. It changes private preparation, not IRC envelope
formats. Namespace Luna owns `outbox-journal.ts` and its authored tests; Platform
Luna owns bootstrap adaptation and the existing source multiline/encoder imports;
Main owns public contracts and Elm/ports composer metadata. Storage Luna owns the
provider changes below when reactivated. Do not execute checks until integration.

### Canonical local intent

Extend the existing private QueueIntent PRIVMSG branch with
`replyTo:string|null`, `messageKind:'message'|'action'` and
`audiencePrefix:string|null`. Memo has replyTo null, messageKind message and
audiencePrefix null. Extend public journal.queue with optional messageKind
(default message) and optional audiencePrefix (default null); preserve existing
replyTo. No arbitrary caller tag map.

The versioned local plaintext record is the exact JSON array
`[2,operation,targetKey,messageKind,replyTo,audiencePrefix,body]`, UTF-8 encoded,
with fixed order. This is the final v2 canonical tuple, including audience.
The provider encrypts this entire record under the selected local AEAD grant,
using purpose `outbox:<clientIntentId>`. Do not persist metadata outside that
record as an alternative authority source. The durable row keeps operation,
target and targetKey for indexing and must verify them against the decrypted
record before dispatch. Never put raw plaintext in durable rows.

Audience preserves the existing `App.composerSendTarget`/
`composerAudienceOffered` behavior: only a base channel with currently permitted
plaintext policy may use one currently advertised STATUSMSG prefix. Validate
the prefix as exactly one advertised source prefix, current membership/write
authority and current policy again at dispatch; DMs, MEMO and required-encrypted
rooms cannot use it. Store/policy/owner/conversation identity remains the BASE
room. Only the actual wire target becomes prefix+baseRoom. Never strip a revoked
prefix and send to the whole room. Prefix withdrawal, lost membership/authority
or policy change holds the intent for review. Canonical local encryption and HMAC
include audiencePrefix; changing it under the same clientIntentId is conflict.
Use the scoped wire target in the existing single/multiline builders and exact
echo correlation, and retain audience in optimistic/accepted message metadata.

Body maximum is 65536 UTF-8 bytes, not JavaScript string length. Preserve LF and
TAB; reject NUL, CR, other C0/DEL and unpaired surrogates without truncation.
Empty/whitespace behavior remains the existing composer policy. Reply ID is
validated through the existing MessageId constructor and source tag bounds.
Targets must pass the existing IRC target validation. Local serialized record
maximum is 262144 bytes; local ciphertext maximum is 262172 bytes (12 IV +16 tag).
Update journal validators accordingly; 8192 is not a valid universal bound.

Keep the existing HMAC-SHA256 key custody and length-prefix encoding, but commit
to `[domain,stableOwnerKey,canonicalIntentBytes]`, where domain is
`onyx-outbox-intent-commitment-v2`. Include all intent fields above in the canonical
record. Never hash random ciphertext for semantic deduplication. V1 durable rows
must retain their reader and be decoded as legacy message/no-reply only when that
is provable; otherwise hold for explicit review, never reinterpret as v2.

### Provider and wire preparation

`prepareQueuedPayload` receives the complete canonical metadata above and seals
it once. It preserves the observed known policy revision, or the existing unknown
policy sentinel. `prepareDispatch` opens once, validates that record and captures
the fresh dispatch policy. Known incompatible policy changes require review;
unknown-at-queue may proceed only under fully proven current policy. Its final
post-await comparison is against the captured dispatch policy revision, not the
unknown sentinel. Recheck owner/grant/mapping/epoch after awaits.

For required encryption, encrypt the semantic message once with the existing
canonical DM/group primitive, including LF content. ACTION uses the same existing
CTCP action semantic encoding as the prior composer before encryption; do not
invent a new encrypted metadata format. The resulting canonical ciphertext
envelope is a single PRIVMSG body, never independently encrypt each multiline
fragment. If that envelope exceeds actual negotiated wire bounds, hold/review
without truncating, splitting into undecryptable envelopes or sending plaintext.

For plaintext LF content with negotiated draft/multiline, reuse
`src/lib/irc/multiline.ts` parseMultilineLimits, planMultilineBatches and
buildMultilineLines, and the existing IRC encoder/tag escaping. Preserve the
prior composer's behavior for whitespace-only lines and multi-batch degradation.
Without multiline, retain its explicit normal-line fallback semantics, including
independent accepted IDs. Reply metadata goes where the existing builder places
firstLineTags (`+draft/reply`); action handling follows the existing composer,
never an arbitrary control-character bypass. Single-line sends use formatIRCLine.

Strip exactly one final CRLF from encoder output for WSS; reject embedded CR/LF/
NUL in every actual wire line. Validate actual UTF-8 line bytes including tags,
target, prefix overhead and applicable negotiated server limits. A planner's
content byte limit is not the wire-line ceiling. Bound each planned group to
1024 wire lines and 256 KiB total encoded bytes; a stricter negotiated bound wins.
Do not silently truncate. A plan exceeding these work ceilings is review-needed.

Replace PreparedDispatch ready branch with:
`{kind:'ready',lines:readonly string[],validationReceipt:string}`.
The private receipt registry binds row/intent/claim, complete ordered line-group
hash, expected source echo/batch IDs, owner/mapping/policy/epoch and expiry. The
journal calls a private validatePreparedDispatch(row,context,ticket,prepared)
dependency before first write; a nonempty arbitrary receipt string is not proof.
Namespace writer adds that exact dependency; Platform implements the registry.

### Durable admission and correlation

Persist and await the dispatching claim plus exact attempt identity/line-group
hash before the FIRST send. Prepare/encrypt once per claimed attempt. Serialize
the complete group on that physical transport without interleaving another user
send group. The transport admission adapter must not allow raw legacy composer
sends to interleave a BATCH group. Recheck owner and claim immediately before each
line; write synchronously in order through the real transport sendLine.

The durable row extension is `dispatchAttempt:null|{nonce:string,planHash:string,
lineCount:number,policyRevision:string,mappingRevision:string,startedAt:number}`.
`planHash` is lowercase SHA256 of UTF-8 JSON.stringify(lines), computed before
the awaited claim update and bound by the private validation receipt. Existing
rows with no attempt field decode as null only when not already admitted/unknown;
old uncertain rows retain their uncertainty. No plaintext wire lines are stored.

Only all lines admitted permits transport-admitted. Definitively blocked BEFORE
ANY write may return queued-held for explicit/bounded retry. Any partial group,
unknown send, exception, owner loss or failed durable admission-state update after
bytes may have left becomes delivery-unknown; never automatically resend or
re-encrypt. Preserve the durable attempt even when the current UI owner retires.
Never retry BATCH END independently and claim the original operation succeeded.

Acceptance requires real correlated self-echo/source message IDs and matching
batch close/semantic coverage for the complete planned group, or exact correlated
MEMO server proof. Bare ACK, BATCH close alone, body/time similarity, PONG or a
timer cannot accept it. Partial evidence is retained as partial, not successful
whole-intent delivery. Two identical consecutive intents remain independent.

Authored regressions cover 4096 emoji (16 KiB), LF/reply/action semantics, actual
CAP UTF-8/tag overhead, ciphertext LF single envelope, duplicate clientIntentId
metadata conflict, partial admission at every line, owner retirement, zero-write
backpressure, lost echo/batch close and migration of old sealed payloads.
