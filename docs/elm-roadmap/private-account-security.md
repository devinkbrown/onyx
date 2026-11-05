# Frozen private account security batch

Source-only implementation contract. No tests/builds/server/browser execution
until the complete implementation waves are integrated. This batch changes no
generic cryptographic proof protocol.

## Ownership

- Namespace Luna: `elm/runtime/identity-owner.ts`, new
  `elm/runtime/private-account-security.ts` and focused authored tests.
- Platform Luna: bootstrap private composition, private form/host/clipboard IO,
  ingress ordering, account-proof transitions and mechanism-specific transport.
- Main Luna: safe Elm status/input/presentation controls, Session SASL mechanism
  selection, private ports and existing WebAuthn integration. No raw secrets in
  Elm messages/model, generic logs, cache/export, URL or history.

## Actual source contracts

- `server.zig:35620–35692`: TOTP STATUS/DISABLE/ENROLL/CONFIRM. ENROLL emits
  `TOTP: add this ...`, `TOTP: secret <32 base32 symbols>`, then
  `TOTP: otpauth://...`. Confirmation success is the exact ACTIVE notice.
- `server.zig:35715–35796`: RECOVERYCODES STATUS/GENERATE/CLEAR/LOGIN. GENERATE
  emits declared count then numbered `RECOVERYCODES: <index>. <code>` rows.
  LOGIN success says the code is spent; login authority still comes from the
  actual account proof transition, not a timer or display string alone.
- Source-proven account-security failures may arrive as prefixless standard
  `FAIL TOTP|RECOVERYCODES <code> :<reason>` records. Consume these only to
  settle the matching pending operation on its exact current physical owner,
  endpoint and server-prefix fence; they never prove an account or grant
  authority. When that capability is unavailable, accept only the exact learned
  server-prefix `NOTICE <current nick> :FAIL TOTP|RECOVERYCODES <code>: <reason>`
  fallback. Publish a fixed safe failure reason, never the server text or code.
- `server.zig:55513`: `NOTICE <nick> :SESSIONTOKEN <account> <sst_token>
  expires=<unix>`. This is account continuation, distinct from bouncer
  `SESSION TOKEN`/`SESSION MTOKEN` credentials.
- `sasl_mechrouter.zig:296–307,619–640`: SESSION-TOKEN SASL challenge response is
  base64 UTF-8 account + NUL + token. Use existing AUTHENTICATE400-byte chunking
  and final-plus rule. It is not PLAIN and contains no extra NUL field.
- `server.zig:57268,57438`: actual WebAuthn bodies begin REGISTER-CHALLENGE and
  AUTH-CHALLENGE. Preserve the existing private ceremony; do not rename to an
  invented PASSKEY response or consume/drop the challenge.

## Private security operation API

Export `createPrivateAccountSecurity(deps)` with dependencies:

```
ownerSnapshot, isCurrent, currentServerPrefix, currentNick, endpointId,
isAccountProven, isCertificateVerifiedAccount, sendLine, readAndClearPrivateForm,
resolvePresentationHost, clipboardWrite, emitSafeStatus, now
```

`readAndClearPrivateForm(formRef,context,kind)` is one-use JS-only and returns
bounded code/password bytes. `resolvePresentationHost(hostRef,context)` resolves
only a registered dedicated private account-security DOM element. Neither
dependency accepts raw selectors from Elm.

Returned methods:

```
begin(context, intent): Promise<{operationRef,admission}>
ingest({line,owner,serverPrefix}): boolean
onAccountProven(previousOwner,nextOwner): void
present(context,presentationRef,hostRef): boolean
copy(context,presentationRef,selection:'secret'|'uri'|'codes'): Promise<boolean>
dismiss(context,presentationRef): void
retireOwner(owner): void
dispose(): void
```

Intent union is exactly:

- `{action:'totp-status'|'totp-enroll'|'totp-disable'|'recovery-status'}`
- `{action:'totp-confirm',formRef:string}`
- `{action:'recovery-generate'|'recovery-clear',formRef:string|null}`
- `{action:'recovery-login',account:string,formRef:string}`

Use actual TOTP/RECOVERYCODES verbs and existing IRC encoder. Reject invalid
input, do not truncate or log it. Generate/Clear optional password retains actual
server behavior; confirm/code/password input never traverses Elm.

Install pending state BEFORE sending. Serialize unlabelled operations across
both security families on the physical stream; labels may add correlation but
never invent it. At most one active operation, 30-second response deadline,
one private presentation per owner, five-minute presentation expiry. A timeout
is unknown; it does not reopen an ambiguous unlabelled stream for another
operation until source reconciliation or physical retirement. Block legacy raw
security sends while the private operation owns that family.

Only exact learned server prefix/current physical endpoint/generation and the
matching pending action may update state or admit secrets. Peer PM, forged
server-like prefix, unsolicited secret, duplicate row and stale operation cannot
create a presentation. Consume secret-shaped records even when rejected so
they never fall through to public diagnostics. Stage pre-registration material
only in the identity owner's bounded prereg rules; do not present it then.

Safe status is exactly an owner/request-stamped record:

```
{schemaVersion:1,requestId,operationRef,ownerRef,accountGeneration,
 connectionGeneration,action,
 phase:'pending'|'accepted'|'unknown'|'blocked'|'failed'|'dismissed',
 reason:fixedCode|null,
 totpState:'unknown'|'disabled'|'pending'|'active',
 remainingCodes:number|null,presentationRef:string|null}
```

No raw notice/error text or secret fields. Parse actual fixed status/success
strings, including STATUS pending text and DISABLE's two spellings. TOTP enroll
is pending, not active. Collect the complete declared recovery-code set with
unique contiguous indexes and bounded actual server count before accepted
generation; partial set stays unknown. TOTP presentation can progressively fill
its validated secret/URI; validate matching URI secret/account/issuer, never load
the URI as a network resource. Plain display uses DOM text nodes only.

Private `present` renders into the dedicated host directly; Elm renders only
safe labels/status and present/copy/dismiss controls. Copy requires explicit
user action, resolves current ref and selected field privately, and reports only
boolean success. Clear DOM/text buffers/refs on dismiss/expiry/account switch/
physical retirement/dispose. Show recovery secrets once; do not recreate them
from a public model. Recovery login must also observe the exact source-proven
account transition on the same physical operation before reporting accepted.

## Identity-owner account continuation API

Retain existing identity methods and add concrete private methods:

```
listAccountContinuations(): readonly ContinuationMetadata[]
setContinuationRememberConsent({networkId,accountId,enabled}): Promise<boolean>
forgetAccountContinuation(ref): Promise<boolean>
prepareSessionTokenSasl({context,continuationRef,authContextRef}):
  Promise<{kind:'ready',payload:Uint8Array}|{kind:'blocked',reason:fixedCode}>
settleSessionTokenSasl({authContextRef,result:'accepted'|'rejected'|'unknown'}):void
```

These methods are private runtime composition methods, never a global token
getter. Ready payload goes directly to the private AUTHENTICATE sender, then is
zeroed; it is never an Elm port result. Metadata is only
`{continuationRef,networkId,accountId,issuerEndpointId,expiresAtMs,remembered,
usable:boolean}`. Do not expose prefix/bearer or reinterpret bouncer refs.

Parse exact SESSIONTOKEN fields with strict bounded account/token/decimal expiry
validation. Account must match actual proven account. Before001, retain at most
eight transient records for15seconds bound to socket/network/endpoint/generation
and staged server prefix; commit only after exact001 identity plus matching900/
actual auth account proof. Never prove an account from disk, nick or token body.
Malformed/expired/foreign issuer secrets are consumed and rejected.

Committed continuation survives physical reconnect privately until expiry,
explicit forget/account removal or actual rejection. Consent governs durable
remembering; default is bounded memory-only. Persist only in a private credential
store with a strict versioned account/issuer record; exclude all exports/caches.
Use guarded localStorage key `onyx:elm:account-continuations:v1`, existing explicit
credential-custody convention, not a new database/schema. Persist at most16
records with network/account/issuer/token/expiry/version only after consent;
validate every read and report remembered:false on storage failure while retaining
usable memory custody. Identity-owner dependencies include this guarded storage
adapter, trusted issuer registry and a private `isAuthContextCurrent(ref,context)`
validator from bootstrap. Do not silently migrate bouncer credential storage.
Current physical retirement clears staging/in-flight authority but not a consented
or in-memory committed credential merely because its socket ended. Account switch
does not make old credentials current: explicit account selection and matching
trusted issuer are required before use. Default usable route is exact configured
issuer endpoint/network; cross-node portability is not inferred from network name.

Prepare SESSION-TOKEN only when actually advertised in current SASL mechanisms,
on a selected current physical authContextRef with exact issuer/account scope.
The private identity owner validates this context through bootstrap callbacks;
an arbitrary caller ref is not proof. Feed the ready payload into existing private
chunked AUTHENTICATE sender. Elm selects mechanism and receives only admission/
success/failure metadata. SASL rejection retires that continuation; transient
transport loss remains unknown/preserved and requires explicit retry. Success
does not imply a newly rotated token unless an actual new SESSIONTOKEN arrives.

## Composition and safe UI hooks

Platform composes security owner before accepting private family traffic.
Credential owner's existing onPrivateServerLine callback dispatches account
security records to the security service and SESSIONTOKEN to identity, instead
of identity.admit clearing them. Add a private raw ingress hook for status/failure
records and WebAuthn challenges not covered by that callback. Process once before
public projection. Exact account proof transitions notify both owners.

Main/Platform add only these narrow safe ports/callbacks:

- command `{context,action,formRef?,account?}` into private security begin;
- presentation `{context,presentationRef,hostRef,action:'present'|'copy'|'dismiss',
  selection?}` into private UI methods;
- safe status record above into Elm;
- continuation metadata/remember/forget selection, never token bytes;
- SESSION-TOKEN selected continuationRef + private authContextRef into existing
  mechanism-specific SASL start/payload path.

Existing WebAuthn REGISTER-CHALLENGE/AUTH-CHALLENGE must still reach its actual
private navigator.credentials implementation with origin/RP/context checks;
ceremony completion and actual server/account proof remain distinct. Generic
PrivateIdentity.proveAccount/verifyServerProof stay unsupported; no new signatures.

The existing ports passkeyCreate/Get requests must capture RequestContext,
ceremonyRef and exact challenge/RP/operation before navigator.credentials. The
private helper owns one AbortController per ceremony and validates origin/RP and
current challenge before invocation. Recheck owner/request/ceremony/challenge
after every navigator/serialization await and immediately before sending the
existing source-shaped WEBAUTHN result. Retire/abort on account/physical change,
new ceremony/cancel/dispose; a late result cannot settle or clear a newer one.
Attestation/assertion bytes stay private JS and go directly to the existing
WEBAUTHN transport encoder, not Elm messages/model. Emit only fixed safe status
and actual account-proof completion. Main updates ports/native adapters; Namespace
owns the bounded helper in private-account-security.ts; Platform supplies current
context/retirement and private direct sender. Reuse existing proof serialization
and real REGISTER/AUTH-CHALLENGE syntax rather than inventing generic proofs.

Authored cases: actual server notice sequences, forged prefix/peer PM, partial/
duplicate recovery set, expiry/unknown response, old-account presentation/copy,
code input clearing, actual token grammar/expiry, prereg staging/proof mismatch,
same-issuer reconnect, other issuer rejection, SASL400-byte chunks, TOTP-induced
token rejection and actual WebAuthn challenge preservation. Execute only later.
