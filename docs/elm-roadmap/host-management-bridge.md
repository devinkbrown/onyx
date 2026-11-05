# Host management bridge: proposed remote HTTPS v1

**Status: design only.** This document specifies one proposed remote HTTPS
profile. It does not describe an implemented browser API, pairing service, or
host adapter. Until those components are implemented and independently
reviewed, the client reports this transport as unsupported and makes no
host-management network request. E104 remains pending acceptance.

Native messaging is outside v1. There is no alternate native signature, MAC,
or authentication profile. Setup and doctor imports remain offline,
read-only observations; they cannot pair a host, establish current readiness,
grant permissions, or authorize a daemon change.

## Standards and profile status

The proposed profile uses [RFC 8785 JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
for canonical JSON and SHA-256 digests, [RFC 8032 Ed25519](https://www.rfc-editor.org/rfc/rfc8032)
for detached service-response signatures, and [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/)
for a user authenticator assertion on every application request. These are
design references, not evidence of universal browser support or a claim that
this is an existing Onyx wire protocol. The response signing profile is the
proposed application protocol `Ed25519-JCS-v1`.

## Trust and pairing

The browser is configured with one exact HTTPS origin, one host installation,
one WebAuthn RP ID, and one service response public key plus `keyId`, all
established out of band. Requests target only that origin and configured host
installation. Redirects are rejected. Ordinary web PKI authenticates the TLS
endpoint but does not establish which host installation is managed.

The RP ID must be valid for the browser application's calling origin: it is
that origin's effective domain or a registrable-domain suffix allowed by
[WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/#relying-party-identifier).
It is not automatically the remote management service hostname. CORS does not
grant a different RP scope. Pairing rejects an origin/RP-ID combination that
does not satisfy the WebAuthn rule.

Pairing is an out-of-band trust ceremony binding endpoint, host installation,
browser origin, RP ID, and initial response-signing key. Imported setup/doctor
documents cannot supply or change those bindings. The browser stores public
pins and nonsecret pairing metadata only. It stores no long-term signing key;
the authenticator private key is nonexportable.

Every application request requires a WebAuthn assertion. The service creates
a random 32-byte one-use challenge expiring in 60 seconds and binds it
server-side to SHA-256 of the JCS bytes of the exact unsigned request, browser
origin, RP ID, principal, installation, host reference, and permission
revision. The signed challenge response binds these values plus `requestId`,
`challengeRef`, and expiry. WebAuthn challenge bytes are exactly the random
32-byte challenge; v1 defines no custom concatenated signature construction.
The service validates `clientDataJSON` challenge, type, and origin;
authenticator RP ID hash; UP and UV flags; assertion signature; credential and
principal association; and counters under WebAuthn and service policy. Token
binding is not assumed. The challenge is consumed atomically with durable
operation admission. An assertion authenticates the request; it is not human
approval of configuration. Mutations also require separate explicit UI
confirmation of the exact plan.

Application requests use `POST /onyx-host-bridge/v1/request`. A separate
`POST /onyx-host-bridge/v1/challenge` bootstraps the challenge. Its request is
exactly `{protocol, version, installationId, hostRef, principalRef, requestId,
requestDigest, operation}`; `requestDigest` is SHA-256 of the complete unsigned
application envelope and `operation` is one of the eleven operation names.
The bootstrap request contains no credential ID or password. The endpoint
uses an allowlisted origin, strict CORS, bounded and rate-limited processing,
no ambient cookie authentication, and a signed response that does not reveal
account enrollment. Its signed challenge binds request digest and context to
an enrolled discoverable credential; the browser delegates credential
selection to the platform authenticator and stores no credential secret. If
permission revision becomes stale, the service rejects the challenge/request
binding. A caller may create a new read or plan request; a mutation must first
reconcile its original identity and must not be blindly resubmitted.

## JSON, identifiers, and bounds

The parser rejects duplicate object keys, invalid UTF-8 or surrogate
sequences, non-I-JSON values, non-finite numbers, unknown fields, and values
outside the operation schema. JSON numbers are safe integers only. Times are
epoch milliseconds; larger integers, counters, and opaque revisions use
decimal strings. Identifiers are unpadded base64url encodings of 16–32 random
bytes. SHA-256 digests are 64 lowercase hexadecimal characters.

The HTTP JSON body limit is 1,048,576 UTF-8 bytes; nesting depth is at most 12;
objects have at most 64 fields; arrays have at most 256 items unless an
operation schema sets a smaller limit; and strings have at most 4,096 UTF-8
bytes unless specifically bounded otherwise. A TOML candidate is at most
262,144 UTF-8 bytes. WebAuthn proof decoded buffers are bounded: `credentialId`
342 base64url characters, `clientDataJSON` 4,096 bytes,
`authenticatorData` 4,096 bytes, `signature` 1,024 bytes, and `userHandle`
null or at most 64 bytes. Encoded values use canonical unpadded base64url.

The unsigned application envelope has exactly these fields:

```json
{
  "protocol": "onyx-host-bridge",
  "version": 1,
  "installationId": "<opaque-id>",
  "hostRef": "<opaque-id>",
  "principalRef": "<opaque-id>",
  "requestId": "<opaque-id>",
  "idempotencyKey": "<opaque-id>",
  "issuedAtMs": 0,
  "expiresAtMs": 0,
  "permissionRevision": "<opaque-revision>",
  "operation": "host.inspect",
  "body": {}
}
```

Request lifetime is at most 60 seconds and allowed service/client clock skew is
at most 30 seconds. The service clock is authoritative. Challenge expiry
cannot extend request expiry. `idempotencyKey` is required for every request.
A semantic retry reuses the same key; request ID, timestamps, operation, body,
host, principal, installation, and permission revision remain bound by the
unsigned-request digest. The authenticated HTTP body is the unsigned envelope
plus sibling `proof`; compute the digest from the envelope after removing only
`proof`. Challenge fields are separate from that envelope. An expired request
can only be reconciled; a mutation cannot
be regenerated with a new identity to evade its original outcome.

The request proof has exactly this shape:

```json
{
  "challengeRef": "<opaque-id>",
  "credentialId": "<base64url>",
  "clientDataJSON": "<base64url>",
  "authenticatorData": "<base64url>",
  "signature": "<base64url>",
  "userHandle": null
}
```

The service response envelope binds `protocol`, `version`, `installationId`,
`hostRef`, `principalRef`, `requestId`, `idempotencyKey`, `operation`,
`requestDigest`, `serverTimeMs`, `permissionRevision`, `operationRef` (or
null), `status`, `result`, `error` (or null), and `proof`. The proof is exactly
`{ "profile": "Ed25519-JCS-v1", "keyId": "…", "signature": "…" }`;
`signature` is canonical base64url for 64 Ed25519 bytes. It covers UTF-8 JCS
bytes of the entire response except `proof`. The response private key resides
only in a server OS keystore or HSM, separate from TLS and authenticator keys.
The browser verifies key pin, exact binding, freshness, and signature before
using a response.

Statuses are `ready`, `planned`, `accepted`, `running`, `applied`, `rejected`,
`expired`, `cancelled`, `outcome-unknown`, `not-found`, and `conflict`. Each
operation schema restricts the allowed subset. Errors are limited to
`invalid-request`, `unsupported-version`, `unsupported-operation`, `unpaired`,
`unauthenticated`, `forbidden`, `factor-required`, `stale-permission`,
`stale-host-state`, `plan-expired`, `plan-mismatch`, `idempotency-conflict`,
`replay`, `rate-limited`, `unavailable`, and `internal-error`. Errors expose no
raw diagnostics or secret-bearing detail.

The challenge response is signed over all fields except `proof`:
`protocol`, `version`, `installationId`, `hostRef`, `principalRef`, `requestId`,
`requestDigest`, `operation`, `challengeRef`, `challenge`, `issuedAtMs`,
`expiresAtMs`, `rpId`, `origin`, `permissionRevision`, `credentialSelection`,
`status`, and `error`. `credentialSelection` is exactly `discoverable`. Status
is `challenge` or `rejected`; on rejection, challenge reference, challenge,
RP ID, origin, and permission revision are null, while a challenge response
carries these values. The challenge is 32 random bytes in canonical unpadded
base64url; `challengeRef` is a 16–32-byte opaque identifier. The response
uses the same detached Ed25519-JCS proof shape as application responses.

## Authenticated grant and authorization

The service-issued grant has exactly `principalRef`, `hostRef`,
`installationId`, `permissionRevision`, `issuedAtMs`, `expiresAtMs`, finite
`capabilities`, and `factors`. It lasts at most 60 seconds. `factors` records
`userPresent: true`, `userVerified: true`, `verifiedAtMs`, and private
`credentialRef`; freshness is no more than 60 seconds at request admission.
Capabilities are finite operation identifiers authorized for that principal
and paired host. Optional role labels are informational only and limited to
`viewer`, `config-admin`, `service-admin`, and `auditor` (at most four). UI
role labels never authorize a request.

Capabilities are exact operation identifiers, not role names. A request must
present its exact operation identifier in the service-issued grant; optional
`viewer`, `config-admin`, `service-admin`, and `auditor` labels are
informational display metadata only. They do not grant, imply, or replace any
capability. Plan result `requiredCapability` identifies the exact commit
capability and is kind-bound:
`config` → `config.commit`, `restart` → `service.restart.commit`, and
`rollback` → `rollback.commit`. The service checks the corresponding exact
operation capability at commit time. `operation.cancel` and rollback
operations also retain the original-principal and original-mutation-capability
checks; a rollback plan or commit does not erase the authorization required
for the operation it would reverse. V1 has no administrator override for
another principal's cancellation.

Each request checks current ACL, exact host/principal/installation, grant
freshness, and permission revision. Each mutation rechecks exact principal,
host, permission revision, and plan state before durable admission and before
the side effect. Revocation before effect rejects the operation; revocation
after an effect may have started yields `outcome-unknown` and requires
reconciliation. IRC identity and operator status never substitute for host
authorization. A credential counter anomaly is rejected or quarantined under
service policy and requires recovery; it does not silently establish
authentication.

## Finite operation and body contract

The v1 operation set is exactly eleven identifiers:

| Operation | Exact request body | Purpose |
|---|---|---|
| `host.inspect` | `{}` | Return bounded current host revision, configuration digest, service state (`running`, `stopped`, `starting`, `stopping`, `unknown`), and authorized capability grant. No files or secrets. |
| `config.plan` | `{ "candidateToml": string, "expectedHostRevision": string }` | Validate a secret-free candidate against the pinned server TOML/config schema and allowed-key policy. Backend rejects secret-bearing values, unknown keys, includes, environment interpolation, and executable content; v1 has no secret-setting operation. The plan is bound to host revision/configuration digest and the deployment's compatible schema version; the client does not invent supported keys. |
| `config.commit` | `{ "planRef": string, "planDigest": string, "expectedHostRevision": string, "confirmationRef": string }` | Commit the exact approved plan after fresh assertion and explicit confirmation. |
| `service.restart.plan` | `{ "expectedHostRevision": string }` | Produce a typed restart plan. |
| `service.restart.commit` | `{ "planRef": string, "planDigest": string, "expectedHostRevision": string, "confirmationRef": string }` | Commit the exact approved restart plan. |
| `operation.inspect` | `{ "operationRef": string|null, "originalIdempotencyKey": string }` | Read the exact operation outcome. Null looks up the durable tuple by original key. |
| `operation.reconcile` | `{ "operationRef": string|null, "originalIdempotencyKey": string }` | Observe an unresolved operation; never replay it. Null looks up by original key when the first commit response was lost. |
| `operation.cancel` | `{ "operationRef": string, "originalIdempotencyKey": string }` | Cancel accepted work only if execution has not started; otherwise record cancellation request and unknown outcome. |
| `audit.read` | `{ "cursor": null|string, "limit": integer }` | Read at most 100 bounded redacted audit rows and a next cursor; `limit` is 1–100. |
| `rollback.plan` | `{ "operationRef": string, "expectedHostRevision": string }` | Plan rollback only when safe restoration material exists; otherwise reject as unsupported. |
| `rollback.commit` | `{ "planRef": string, "planDigest": string, "expectedHostRevision": string, "confirmationRef": string }` | Commit a separately planned, confirmed, idempotent rollback. |

There is no `config.preview` alias, wildcard operation, generic command, or
implicit effect. `operation.inspect`, `operation.reconcile`, and
`operation.cancel` each have their own envelope `idempotencyKey`; body
`originalIdempotencyKey` names the original mutation. Inspect and reconcile
accept `operationRef: null` to find a lost first response by the exact
installation/host/principal/original-key tuple. If a reference is supplied,
it and the key must identify the same operation. Cancel requires a nonnull
reference after reconciliation. These operations accept no filesystem paths
or arbitrary identifiers.

Operation results are also typed. `host.inspect` returns
`{hostRevision, configDigest, serviceState, grant}`. A plan operation returns
`{plan, grant}`. `operation.inspect` and `operation.reconcile` return
`{record: OperationRecord}`; authoritative absence returns a signed
`not-found` with `{record: null, absence: "durable-no-reservation"}` for the
same exact tuple only. A mutation commit returns `{record: OperationRecord}`
once it has a durable record; failed validation before reservation has
`operationRef: null` and `result: null`. `operation.cancel` returns its
resulting operation record, including either the cancelled or unknown state.
`audit.read` returns `{rows: AuditRow[], nextCursor}`. The exact record and
audit fields are listed here and in the companion schema.

The response matrix is strict. `host.inspect` succeeds only as `ready` with a
host result. `config.plan`, `service.restart.plan`, and `rollback.plan` succeed
only as `planned` with a plan whose `kind` is respectively `config`,
`restart`, or `rollback`. The three commit operations return `accepted`,
`running`, `applied`, `cancelled`, or `outcome-unknown` with an operation
record whose operation and state match the request and outer status;
`rejected` with a durable rejected record is also allowed. `operation.inspect`
and `.reconcile` return `ready` with a record or `not-found` with the
authoritative-absence result. `operation.cancel` returns `cancelled` with a
cancelled record, `outcome-unknown` with a running/unknown record and
`cancellationRequested: true`, or `rejected` with a record in terminal state
`applied`, `rejected`, or `cancelled`. An accepted, running, or
outcome-unknown operation is not terminal and cannot use the rejection branch.
`audit.read` succeeds only as `ready` with an audit result.
Any operation may also return a pre-admission `rejected`, `expired`, or
`conflict` with null result/reference and a nonnull fixed error. Expiry uses
`plan-expired` or `stale-permission`; conflict uses `idempotency-conflict` or
`plan-mismatch`. An unavailable lookup is rejected as unavailable, never
misreported as not-found. These status/result/error combinations and
cross-field equality checks are normative; a mismatched response is rejected.

An `OperationRecord` has exactly `operationRef`, `originalIdempotencyKey`,
`operation`, `requestDigest`, `planDigest` (or null), `state`, `acceptedAtMs`,
`updatedAtMs`, `finishedAtMs` (or null), `hostRevisionBefore`,
`hostRevisionAfter` (or null), `resultDigest` (or null),
`cancellationRequested`, `rollback` (`available` or `unavailable`), and
`error` (or null). Its state is `accepted`, `running`, `applied`, `rejected`,
`cancelled`, or `outcome-unknown`. Public records contain no candidate config
or secret values.

An `AuditRow` has exactly `auditRef`, `operationRef` (or null), `principalRef`,
`hostRef`, `installationId`, `operation`, `requestDigest`, `planDigest` (or
null), `permissionRevision`, `authorization` (`allowed` or `denied`),
`factor`, `event`, `atMs`, and `error` (or null). `factor` has exactly
`userPresent`, `userVerified`, `verifiedAtMs` (or null), and `credentialRef`
(or null). `event` is one of `admitted`, `started`, `applied`, `rejected`,
`cancel-requested`, `cancelled`, `reconciled`, or `outcome-unknown`. Audit rows
are bounded and redacted; cursors are scoped to the requesting principal and
host.

Plan operations return exact fields `planRef`, `kind` (`config`, `restart`,
`rollback`), `planDigest`, `hostRevision`, `permissionRevision`, `expiresAtMs`,
`changes`, `warnings`, `rollback`, `requiredCapability`, and
`confirmationRef`. Plans expire within 120 seconds. There are at most 128
changes; each change has `path`, `action` (`set`, `remove`, `restart`,
`restore`), `oldSummary`, and `newSummary`. Summaries are at most 256 UTF-8
bytes and contain no secret values. Warnings are fixed codes. The digest is
SHA-256 of JCS of the plan excluding `planDigest`. `confirmationRef` binds the
exact plan server-side; possessing it is not proof of user approval. The UI
shows the digest and exact changes and requires an explicit confirmation
gesture before commit. Commit uses a fresh assertion and the same plan digest
and host revision; the service atomically revalidates state and permission
before admission and effect.

Plan `path` is a logical TOML key, never a filesystem path. A `set` or `remove`
change carries redacted old/new summaries as applicable; restart and restore
changes use the same typed change structure. Warning identifiers are a
versioned fixed-code registry, never free-form text. V1 codes are
`service-restart-required`, `connection-interruption`,
`rollback-unavailable`, and `configuration-replaced`; a plan contains at most
16 unique warnings.

`host.inspect` returns typed current observations only. Unknown host,
configuration, or service state stays unknown, never guessed ready. `audit.read`
is cursor-bounded and redacted. No response includes secrets, environment
values, arbitrary file contents, or free-form diagnostics.

## Durable admission, retries, and effects

The durable idempotency tuple is
`(installationId, hostRef, principalRef, idempotencyKey)`. Its first accepted
request stores the immutable digest of the exact unsigned request. The same
tuple and digest return the same operation reference and current durable
result; they never repeat the side effect. The same tuple with a different
digest returns `conflict` / `idempotency-conflict`.

Read and plan operations, along with their challenge records, are retained
until request and challenge expiry plus the 30-second allowed skew. Expired
read/plan identities are rejected as expired rather than replayed indefinitely.
Mutation compact tombstones remain under the longer replay-protection lifetime
below.

Before any host effect, one durable transaction validates and consumes the
challenge, checks authorization and plan/revision, reserves the idempotency
tuple and operation reference, records intended effect and audit entry, and
marks the request `accepted`. An accepted receipt proves durable admission,
not application. A worker records `running` before the effect and writes the
terminal result and audit atomically afterward. A crash after intent or during
an effect remains `outcome-unknown` unless the fixed adapter proves the exact
resulting state. Restart or configuration replacement never blindly repeats
an operation.

`operation.cancel` atomically changes accepted-but-not-started work to
`cancelled`. For running work it records a cancellation request and returns
`outcome-unknown`; cancellation is not rollback. Reconciliation is lookup and
observation only. `not-found` is allowed only when authoritative durable
storage proves absence before reservation for that exact tuple. Lost or
corrupt state returns unavailable/unknown, never absence.

Full operation, result, idempotency, and audit records are retained at least
30 days. After full-record purge, a compact exact tuple, request digest,
terminal/result digest or unresolved marker remains indefinitely until
installation retirement. This replay protection is bounded to 100,000
mutations per installation. Quota exhaustion rejects before admission; replay
protection is never evicted to make room. Retirement accepts no new work.
Re-pairing requires explicit out-of-band action and a new installation ID; the
retired idempotency namespace remains permanently retired.

Configuration uses a fixed typed adapter with atomic file replacement and
revision checks. Client input supplies no shell text, command arguments,
paths, or environment variables. Restart and configuration adapters record
whether an effect is reversible. Rollback is a new plan/confirmation/
idempotency operation referencing the prior operation and using retained
server-side restoration material; it is unsupported without a safe inverse.
No timeout or cancellation claims rollback.

## Signing-key rotation and revocation

The initial Ed25519 public key and `keyId` are pinned out of band. A rotation
statement has exact fields `protocol`, `version`, `profile`, `installationId`,
`hostRef`, `origin`, `oldKeyId`, `oldPublicKey`, `newKeyId`, `newPublicKey`,
`keyEpoch`, `activateAtMs`, `expiresAtMs`, `oldProof`, and `newProof`. Both
proofs sign JCS of the statement with both proof fields removed. The fixed
values are `protocol: onyx-host-bridge`, `version: 1`, and
`profile: Ed25519-JCS-v1`; `keyEpoch` is a positive safe integer, each public
key decodes to 32 bytes, and expiry is at most 120 seconds after trusted
receipt/service time. The statement binds exact installation, host, and
origin. The client accepts only the next consecutive epoch from an unrevoked pinned key
and persists it atomically before trusting the new key. A compromised,
revoked, or lost old key has no in-band recovery. An administrator replaces
trust out of band; that clears grants, challenges, and pending trust while
unresolved operations remain unresolved. Graceful revocation is authenticated
by the currently trusted key; compromise revocation requires out-of-band
administrator action. A self-signed new pin is never trusted. Signature
freshness and exact request/response binding are checked even when the
signature is cryptographically valid.

Graceful revocation has exact fields `protocol`, `version`, `profile`,
`installationId`, `hostRef`, `origin`, `keyId`, `keyEpoch`, `revokedAtMs`, and
`reason: retired`, plus the same detached proof signed by the currently
trusted key over JCS with `proof` removed. Compromise revocation remains an
out-of-band administrator action. Rotation and revocation arrive only from the
already paired configured endpoint after independent signature verification;
they add no operation or authority to a challenge response.

## Data handling and failure presentation

The browser may retain public key pins, nonsecret pairing metadata, grant
metadata, and safe operation references/digests. It never writes TOML drafts,
secrets, WebAuthn assertion bytes, credentials, or raw user documents to
`localStorage`, URLs, logs, or audit. Audit records contain principal, host
binding, operation, plan digest, authorization/factor decision, timestamps,
result, and reconciliation history, excluding credentials, private keys,
secret configuration values, and raw documents.

The UI distinguishes accepted, running, applied, rejected, expired, cancelled,
and unresolved outcomes. It displays a durable operation reference and does
not convert timeout into failure or success. Unknown outcomes retain their
exact identity for reconciliation; the client never submits the mutation
again under a new key automatically. Setup/doctor import is a separate local
read-only workflow.

## Verification fixtures and implementation prerequisites

The companion JSON Schema expresses the proposed bounds and finite operation
set. The companion vectors contain typed examples and negative expected cases,
but do not claim cryptographic execution. During implementation, a
standards-conforming JCS/SHA-256 tool must produce and verify canonical UTF-8
and digest vectors. Ed25519 primitive tests should cite published RFC 8032
vectors; do not invent a service signing key or private-key fixture. WebAuthn
vectors must exercise the actual implementation and browser/authenticator
policy. No digest or signature hex is guessed here.

Independent review must cover browser client, authenticated service, fixed
host adapter, durable store, WebAuthn validation, key custody, origin/CORS,
replay protection, retention quota, audit redaction, recovery, and user
confirmation. Until implementation and acceptance evidence exist, this
capability stays unsupported. E104 design documentation does not satisfy its
execution acceptance or the broader M10 exit.
