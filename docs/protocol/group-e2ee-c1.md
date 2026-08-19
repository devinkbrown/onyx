# Group E2EE (Era 3 C1) — control payload

**Status:** revision-3 control lifecycle, required-room message seal/open, and
truthful activation (`hold` → `active` after verified genesis bootstrap) are
product-wired; persistent higher-epoch recovery and production dual-node
acceptance remain incomplete.

This document defines the current **versioned client payload** that rides the
opaque `E2EEGROUP` trailing parameter. It is an Onyx in-house control format.
It does **not** claim MLS or RFC 9420 wire interoperability.

**Server vs client (current truth):**

| Side | Reality |
|------|---------|
| **Onyx Server** | Source has an **active** opaque `E2EEGROUP` delivery path: authenticated membership/routing policy, local fan-out as `E2EE.KEYPACKAGE` / `E2EE.COMMIT` / `E2EE.WELCOME`, and mesh hop custody for exact origin-signed wires. The daemon does **not** parse the trailing payload as crypto, decrypt group secrets, or act as a group member. |
| **Onyx client payload** | The connection/account-owned observer verifies authenticated OGC1-v2 controls from the trusted device directory. The runtime can pair a signed genesis commit/welcome, provision an ephemeral epoch-1 `GroupSession`, and seal/open `ONYXROOM1` messages for policy-required rooms through a private bridge. Persistent recovery, higher-epoch history recovery, and production dual-node acceptance are not complete. |

## Layers

| Layer | Module | Role |
|-------|--------|------|
| IRC routing | `src/lib/e2ee/groupControl.ts` | `E2EEGROUP` command shape; opaque base64url; no crypto |
| Signed payload (this) | `src/lib/e2ee/groupControlPayload.ts` | Canonical binary + Ed25519 envelope, consumed by the live observer/runtime |
| Content envelope | `src/lib/e2ee/groupEnvelope.ts` | `ONYXROOM1` room ciphertext (separate) |
| Live genesis session | `src/lib/e2ee/groupSession.ts` | Owns the ephemeral epoch-1 key and exposes only narrow session operations; never vaulted |
| Envelope helper keyring | `src/lib/e2ee/groupKeyring.ts` | Bounded helper/test keyring; not installed into the revision-3 runtime |
| Welcome key-wrap | `src/lib/e2ee/groupWelcome.ts` | Authenticated device-bound epoch-secret wrap/open; plaintext is single-use and zeroized |

## Outer IRC forms (unchanged)

```text
E2EEGROUP <channel> <key-package|commit> <from-device> :<opaque-base64url>
E2EEGROUP <channel> welcome <from-device> <to-account> <to-device> :<opaque-base64url>
```

| Bound | Limit |
|-------|------:|
| channel (UTF-8 bytes) | 128 |
| device id (chars) | 32 |
| account (chars) | 64 |
| trailing payload (base64url chars) | 4096 |

Payload encoding on IRC: **canonical unpadded base64url** only. The server
forwards the parameter; it does not parse, decrypt, or persist group secrets.

## Versioned payload wire (v2)

`opaque-base64url` = canonical base64url of the binary layout below
(all multi-byte integers **big-endian**):

| Offset | Field | Size | Notes |
|-------:|-------|-----:|-------|
| 0 | `magic` | 4 | ASCII `OGC1` (`GROUP_CONTROL_PAYLOAD_MAGIC`) |
| 4 | `version` | u8 | Must be `2` (`GROUP_CONTROL_PAYLOAD_VERSION`) |
| 5 | `kind` | u8 | `1` key-package, `2` welcome, `3` commit |
| 6 | `epoch` | u32be | Room epoch this control advances or advertises |
| 10 | `body_len` | u16be | `1 … 2048` (`MAX_GROUP_CONTROL_BODY_BYTES`) |
| 12 | `body` | `body_len` | Opaque typed-by-kind material (see body rules) |
| 12+L | `signer_pub` | 32 | Ed25519 public; bound in transcript; must equal trusted |
| 44+L | `signature` | 64 | Ed25519 over the transcript |

`L = body_len`. Total binary length must be exactly `108 + body_len`.
Re-encoding the decoded bytes must equal the original base64url string
(non-canonical encodings fail closed). Magic mismatch fails closed at parse.

Version 1 remains parseable for locked diagnostic rendering only. It is never
trusted, verified, or admitted into a session.

### Body rules (v2)

| Kind | Body meaning | Forbidden |
|------|--------------|-----------|
| `key-package` | Public join / leaf material for a later schedule | Raw room AES key, extractable secrets |
| `commit` | Public epoch-advance / membership update material | Raw room AES key |
| `welcome` | Authenticated **pairwise key-wrap ciphertext** owned by `groupWelcome.ts` | Cleartext room key; server-readable secrets |

Bodies are opaque to this module: `sign` / `parse` / `verify` never interpret
them as keys. `groupWelcome.ts` separately owns authenticated pairwise wrapping
and opening of epoch installation material. A welcome body is never treated as
a cleartext room key, and an opened welcome is a single-use capability.

## Ed25519 transcript (exact field order)

Domain label: `ONYX-GROUP-CONTROL-v2`

```text
domain_utf8 ‖ 0x00 ‖
u8(from_account_len) ‖ from_account_utf8 ‖ // authenticated sender; lowercase
u8(channel_len) ‖ channel_utf8 ‖          // trim + lowercase; leading # or &
u8(kind_code) ‖                           // 1 | 2 | 3
u8(from_device_len) ‖ from_device_utf8 ‖
u8(to_account_len) ‖ to_account_utf8 ‖    // length 0 when not welcome
u8(to_device_len) ‖ to_device_utf8 ‖      // length 0 when not welcome
u8(version) ‖
u32be(epoch) ‖
u16be(body_len) ‖ body ‖
signer_pub (32 bytes)
```

`signer_pub` **is** covered by the transcript (after body). Swapping the wire
discovery field invalidates the signature. Verification additionally requires
the wire `signer_pub` to **exactly equal** an externally supplied trusted
public key (raw 32 bytes, or a WebCrypto `CryptoKey` exported as raw — fail
closed if export is unavailable). The wire key alone is never account auth.

## Trust boundary

1. **Trusted signer input is mandatory.**
   `verifyGroupControlPayload(wire, routing, trustedSigner)` takes a raw
   32-byte Ed25519 public key or a WebCrypto `CryptoKey`. That key must come
   from an authenticated device directory, pin, or enrollment path — not from
   the envelope alone.
2. **Embedded `signer_pub` must match trusted.**
   Parse binds the field into the transcript; verify compares wire bytes to
   the external trusted material and rejects any mismatch. The field is not a
   standalone proof of account identity.
3. **Outer routing is authenticated by the transcript.**
   Channel (normalized), kind, from-device, and welcome targets are bound;
   metadata substitution fails closed.
4. **Server is not a group member.**
   Onyx Server authenticates membership/routing policy and delivers opaque
   records; it never receives a decryptable room secret in this format.
5. **No MLS claim.**
   Kind names (`key-package`, `welcome`, `commit`) are Onyx control labels.
   They do not assert RFC 9420 wire compatibility.

## Pure client APIs

| Function | Role |
|----------|------|
| `buildGroupControlTranscript` | Pure transcript bytes for sign/verify |
| `packGroupControlPayload` / `parseGroupControlPayload` | Canonical b64url ↔ parts |
| `signGroupControlPayload` | Ed25519 sign → wire string |
| `verifyGroupControlPayload` | Parse + routing match + trusted equality + verify |

These remain pure crypto/codec helpers. The live observer and runtime call them
to verify inbound `E2EE.*` records against the authenticated device directory,
pair commit/welcome controls, provision a strictly bound ephemeral genesis
session, and seal/open required-room messages through narrow bridge operations.
The store retains ciphertext as `text`, exposes only transient opened plaintext,
and never receives room keys or mutable crypto handles.

## What exists elsewhere today

| Layer | Reality |
|-------|---------|
| DM E2EE | Static-static P-256 + HKDF + AES-GCM (`ONYXDM1` / legacy open `TSUMUGI1`) |
| Multi-device keys | Per-device publish via `E2EEKEY` + KEYTRANS list (C2 partial) |
| Media E2EE | Mooring paths for calls (separate from room E2EE) |
| Room policy | `encryption-policy` PROP (`off` / `optional` / `required`) |
| Ephemeral genesis key | Retained only inside the active in-memory `GroupSession`; never serialized into the history vault |
| Envelope helper keyring | `RoomEpochKeyring` remains implemented for bounded helper/test seal-open paths; the revision-3 runtime does not install it |
| Server opaque delivery | Active `E2EEGROUP` → `E2EE.*` path + mesh hop authority for opaque wires (daemon source) |
| Control IRC codec (client) | Strict `E2EEGROUP` build/parse helpers; the connection-owned observer consumes server-origin `E2EE.*` controls |
| OGC1 payload (client) | Sign/parse/verify and trusted-directory verification are production-wired; genesis provisioning is ephemeral epoch 1 only |

## Non-goals (current)

- Claiming MLS RFC 9420 compliance or TreeKEM completeness
- Server-side decryption or key escrow
- Persisting room secrets in IndexedDB / the history vault
- Embedding raw room keys in key-package or commit payloads
- Claiming production dual-node acceptance of room group E2EE

## Next implementation slices

1. Higher-epoch recovery and rotation with explicit recovery state; genesis
   provisioning remains intentionally limited to epoch 0→1.
2. Persistent recovery for historical epochs without serializing raw room keys
   into the history vault.
3. **Production acceptance** after packaging and dual-node operator gates
   (not claimed by the v0.5.7 pre-deploy note alone).

See also: `onyx-client-contract.v2.json` (`group_e2ee`),
`onyx-server/docs/ops/release-v0.5.7-e2ee-group-control.md`, Era 3 C1 roadmap.
