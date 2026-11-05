# Portable group history backup: implementation contract

Frozen architecture, 2026-11-04. Source inspection only; no test/build/browser/
server execution in this batch. This changes a local encrypted backup container,
not IRC/group wire protocols or signature algorithms.

## Source facts and ownership

Current `elm/runtime/crypto-backup.ts` ONYXGBK1 encrypts only a 32-byte epoch key
with metadata. It cannot establish an accepted signer/checkpoint on a fresh
profile. `group-recovery.ts` currently asks a dependency to supply raw epoch
material; bootstrap must not implement that dependency by getting raw keys.

Actual verified raw-material windows are in `src/lib/e2ee/groupSession.ts`:

- `bootstrapVerifiedGenesis`: commitment verified around lines331–342, raw
  snapshot used to construct the session, then zeroed in finally around369.
- `bootstrapVerifiedEpoch`: equivalent verified commitment/install path around
  lines495–541.
- `applyRecord`: supplied key commitment verified around747–758, then atomic
  state swap and pending welcome wipe around761–776.
- Author creation already has raw material in
  `private-crypto-provider.ts` prepareRecoverableEpoch before sender buffers wipe.

`groupControlSessionAdapter.ts` mapSessionResult/bootstrapOpenedPair produce the
actual signed accepted evidence, including signer public bytes/trust. Existing
historical receipt verification recomputes signature/hash/key commitment. Reuse
these primitives. RoomEpochKeyring's nonextractable CryptoKeys cannot be exported;
GroupSession's private raw buffer is not a public extraction API.

Implementation ownership:

- **Storage/provider Luna:** crypto-backup.ts, group-recovery.ts,
  private-crypto-provider.ts, bounded GroupSession/adapter hook and authored tests.
- **Platform Luna:** compose private ref IO and encrypted-file download only;
  no raw-key getters or temporary bootstrap key buffers.
- **Main Luna:** safe preview/approval/status/presentation; keys/passwords/file
  plaintext remain private. Existing frozen group backup actions retain their
  meanings; add explicit preview approval through the typed private adapter.

## Private verified-key escrow

Add optional internal `onVerifiedEpochMaterial(material):Promise<void>` to pure
GroupSession bootstrap/apply input/config plumbing. Material is exactly
`{room,epoch,commitId,commitHash,membershipDigest,newEpochKeyCommitment,epochKey}`,
with fixed-size byte copies and no getter. Invoke only after signature/routing/
recipient/commitment checks have passed and before original material is wiped.
The adapter supplies the private provider callback; it joins the material to the
same canonical signed commit/signer/routing evidence already being applied.

The hook writes **staged** local AEAD escrow under the selected registered
workspace grant. This is not yet an accepted export record. The existing
onAppliedEvidence path promotes it to **accepted** only after exact actual local
install and matching signed receipt. Prepare encryption before the IDB transaction;
publish escrow state plus receipt linkage in one transaction. Never await crypto
inside an already-open IDB transaction. Recheck owner/workspace/head before and
after hook awaits and before pure state publication. On stale failure abort
installation; on local storage failure report recovery unavailable/volatile and
never claim durable backup. Keep an already accepted live event's truth separate
from whether local recovery storage succeeded.

Use existing private DB2 `epoch-backups` store, with a disjoint versioned key:
JSON.stringify(['epoch-escrow-v1',stableLocalOwnerKey,room,epoch,commitHashHex]).
Record has kind/version/scope/room/epoch/hash/state/ciphertext and no raw key.
Use the existing scoped local AES-GCM key, fresh12-byte IV/tag128. Fixed AAD is
UTF-8 canonical JSON of domain `onyx-group-epoch-escrow-v1`, stable local owner
key, room, epoch, commit hash and membership digest. Selection/connection epochs
are operation fences, not stable AAD fields. The ciphertext plaintext contains
raw32 material and exact evidence linkage. Validate it and recompute commitment
when opening. Account switching cannot relabel an escrow row.

Bound each record64KiB, at most128 accepted escrow records and8MiB per workspace;
never silently overwrite a different hash for the same epoch. Retain sibling
evidence as conflict. Eviction/export policy must explicitly identify unavailable
older epochs; no unlimited recovery claim. Clear transient copies in finally.
If a current pre-hook session lacks escrow, export returns
`epoch-material-unavailable`; offer a real new epoch/recovery path, never pretend
to extract a nonextractable key or silently export another epoch.

## Exact provider APIs

Provider exposes these private runtime methods, not global token/key APIs:

```
exportPortableGroupBackup({context,conversationId,epoch,commitHashHex,passwordRef})
  -> Promise<{kind:'encrypted',bytes:Uint8Array}
            |{kind:'blocked',reason:PortableBackupReason}>

previewPortableGroupBackup({context,inputRef,passwordRef,configuredNetworkId})
  -> Promise<{kind:'preview',preview:PortableBackupPreview}
            |{kind:'blocked',reason:PortableBackupReason}>

approvePortableGroupBackup({context,previewRef,
                           confirmHistoryOnly:true,confirmFingerprint})
  -> Promise<{kind:'installed-history-only',conversationId,epoch,commitHashHex}
            |{kind:'blocked',reason:PortableBackupReason}>

cancelPortableGroupBackup({context,previewRef}):void
```

Reason enum: stale-owner, workspace-locked, epoch-material-unavailable,
evidence-unavailable, wrong-network, wrong-account, wrong-room, invalid-container,
wrong-password-or-corrupt, unsupported-version, checkpoint-conflict,
explicit-trust-required, storage-unavailable, cancelled.

Provider dependencies for IO are
`readPrivatePassword(ref,context):Promise<Uint8Array|null>` and
`readPrivateImport(inputRef,passwordRef,context):Promise<{bytes,password}|null>`.
These consume one-use bound private refs. They never supply epoch keys.
Export verifies selected workspace, exact accepted escrow/receipt/head selection,
opens privately, encrypts v2, zeroes key/password/plaintext, rechecks context and
returns only encrypted bytes. Platform downloads those bytes after final context
check and zeroes its owned byte copy. Replace raw
readPrivateBackupSelection/readCurrentEpochBackupSelection dependencies in export;
do not implement a bootstrap adapter that returns epochKey.

## ONYXGBK2 local container

Keep ONYXGBK1 reader. V2 exact big-endian header is:

```
ASCII ONYXGBK2 (8 bytes)
PBKDF2 iterations u32 (600000..2000000)
salt length u16 (must16), salt16
IV length u8 (must12), IV12
ciphertext length u32 (includes GCM16-byte tag)
ciphertext
```

Reuse established local PBKDF2-HMAC-SHA256/AES256-GCM primitives/parameters from
crypto-backup.ts: password12..1024 UTF-8 bytes, fresh random salt/IV, tag128.
The complete47-byte header is AES-GCM additional authenticated data, prefixed by
UTF-8 `onyx-group-portable-backup-v2` plus NUL. Header ciphertext length must equal
actual remaining bytes. Maximum container128KiB; decrypt at most64KiB canonical
plaintext. Validate bounds/version/iterations before KDF; serialize at most one
KDF per provider. No new custom cipher, signing key export or key derivation.

Encrypted plaintext is UTF-8 canonical fixed-order JSON:

```
{
 version:2,kind:'room-epoch-history',networkId,accountId,exportingDeviceId,
 room,epoch,commitHashHex,membershipDigestHex,epochKeyB64url,
 receipt:{
   signedCommitPayload,fromAccount,fromDevice,signerPublicKeyB64url,
   signerFingerprintHex,acceptanceTrust:'first-use'|'pinned',
   acceptedMembershipRevision,acceptedMappingScheme,
   provenance:'source-observed-acceptance'|'user-approved-history-checkpoint'
 }
}
```

No extra keys, duplicate semantic variants or missing fields. Shared validated
NetworkId/AccountId/room/epoch domains apply; preserve actual exact opaque IDs.
Key exactly32 decoded bytes; signer exactly32; canonical unpadded base64url;
hashes exactly64 lowercase hex. Signed payload≤4096 bytes. Canonical UTF-8 must
roundtrip byte-for-byte. No private signing/wrapping key, password, bearer, sender
session state, pending outbox or claim of full membership history is included.

Verify signature with saved signer and exact existing group routing/transcript;
recompute commit hash and compare room/epoch/membership/commit ID; recompute raw
key commitment using actual signed commit ID/digest. An embedded trust string is
a historical assertion inside the password container, not a fresh trust root.
Never allow backup metadata to override what the signed commit actually says.

## Fresh-profile trust and history-only import

Preview decrypts/validates the entire container privately and stores at most one
private preview for five minutes. Safe preview fields are
`{previewRef,networkId,accountId,conversationId,epoch,commitHashHex,
signerAccountId,signerDeviceId,signerFingerprintHex,
trust:'matches-local-receipt'|'new-history-checkpoint',historyOnly:true}`.
No key, password, raw signed payload or plaintext messages in that preview.

If an independently authenticated local accepted receipt matches exactly, retain
that stronger provenance. Otherwise require explicit user approval of the shown
fingerprint/checkpoint; explain that the password authenticates the file's
integrity, not the signer's identity or latest membership. The user can compare
the fingerprint externally. A copied claimed `pinned` field never grants trust.
Existing conflicting accepted evidence blocks implicit replacement; preserve it
and report checkpoint-conflict. Approval does not claim a complete earlier chain.

Fresh profiles need a destination local history workspace. After explicit trust,
provider calls a narrow private local-workspace helper
`ensureImportedHistoryWorkspace({networkId,accountId,checkpointRef,explicit:true})`.
Only the provider's registered approved checkpointRef may authorize this call.
It creates/selects local data custody marked imported-history-only; it NEVER
calls proveAccount, marks server-proven, creates a send credential or adopts old
signing identity. Network must be explicitly configured; no URL imported from
the backup becomes a connection endpoint. Existing matching stable custody
identity is reused; no random key rotation for the same namespace.

Approval rechecks UI/request/selected destination scope/ref/expiry and all
signature/hash/commitment evidence, imports nonextractable AES key into the
workspace-scoped historical keyring and atomically persists local encrypted
escrow plus evidence marked `user-approved-history-checkpoint` when no original
local acceptance exists. This provenance must not masquerade as source-observed
accepted live head. It can reopen only that workspace/room/epoch history.
Never add it to live sessions/currentAcceptedHead, group author trust/pins,
media signing identity or live send gates. New device must separately enroll,
verify membership and obtain actual current welcome/rekey for live authoring.

Clear raw preview material/DOM/refs on cancel/expiry/account/workspace switch/
dispose; recheck owner/grant after every await. Persisted encrypted evidence may
remain for explicitly selected local history access. No automatic cross-account
or cross-network import. Same-profile live auth on another device does not make
an old-device history import impersonate that old identity.

## Legacy and integration acceptance

Exact RuntimeDomain/GroupRecovery mapping (no raw material fields):

- `group.backup-export` payload becomes
  `{conversationId,epoch,commitHashHex,passwordRef,outputRef}`. GroupRecovery
  calls provider.exportPortableGroupBackup with the exact selected hash, then
  writes only encrypted bytes through its existing output broker. Replace the
  old raw-key selection dependency with `exportEncryptedBackup(...)` returning
  encrypted bytes/status. An output ref never resolves a key.
- Existing `group.backup-import` payload is
  `{conversationId,inputRef,passwordRef,configuredNetworkId}` and performs only
  preview. The requested room/network must match the decrypted file. Provider
  preview uses its returned conversationId for this exact comparison before
  exposing preview metadata. Omitted configuredNetworkId may resolve only the
  current explicitly configured network, never a file-supplied endpoint.
- Add `group.backup-approve`
  `{previewRef,confirmHistoryOnly:true,confirmFingerprint:string}` and
  `group.backup-cancel` `{previewRef}`. Approved fingerprint must equal the exact
  safe preview value; immutable private candidate still determines the bytes.
- Safe group DomainView adds nullable `backupPreview:PortableBackupPreview` and
  `backupOutcome:'none'|'preview'|'encrypted-export'|'installed-history-only'`.
  Failure uses fixed reason codes; accepted history install completionScope is
  local, never server. Export says encrypted file produced, not successfully
  restored backup.
- Private broker signatures are exactly
  `readPrivatePassword(ref:symbol,context:RecoveryContext):Promise<Uint8Array|null>`,
  `readPrivateImport(inputRef:symbol,passwordRef:symbol,context:RecoveryContext):
  Promise<{bytes:Uint8Array,password:Uint8Array}|null>`, and
  `writePrivateBackupSelection(outputRef:symbol,encryptedBytes:Uint8Array,
  context:RecoveryContext):Promise<boolean>`. Public strings are mapped to those
  private symbols only after request/owner/kind/expiry validation. Resolve each
  source once; copies are zeroed in finally. No dependency returns epochKey.

Preview refs are private registered one-use candidates bound to the captured
request owner/generations, configured network and destination selection (or an
explicit no-workspace-yet state). A later approve request may have a new requestId
but must match the same UI owner/generations and unchanged destination state.
Switch/cancel/expiry retires the candidate; a fresh approval cannot resurrect it.
Consume approval atomically before async install; preserve retryable failure only
as a new explicit re-preview operation, never duplicate accepted install.

- ONYXGBK1 reader remains compatible, but it requires independently proven local
  accepted evidence and key commitment. A raw key/metadata legacy file alone
  cannot create a fresh-profile trusted receipt. Show evidence-unavailable and
  offer re-export v2 from the original proven profile, not synthetic acceptance.
- A v2 accepted live escrow may be re-exported later privately; imported history
  checkpoints remain labelled as such, including re-export. Do not upgrade trust
  provenance by repackaging a file.
- Main shows actual current epoch/hash, private password input, encrypted download,
  safe import preview and explicit fingerprint/history-only approval/cancel.
  Success says history-only, never account restored/device identity restored.
- Authored fixtures cover received bootstrap and rekey raw capture, failed local
  escrow publication, lock/reselect/reload, fresh-profile import, wrong password,
  substituted signer, mismatched commitment, fork/conflicting local evidence,
  header/size/KDF bounds, legacy missing evidence, and absence of raw material in
  bootstrap/Elm/logs. Execute only after full implementation integration.
