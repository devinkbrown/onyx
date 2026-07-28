# Group E2EE (Era 3 C1) — control payload

**Status:** staged Onyx v1 design — **not product-complete**.

This document defines the first **versioned client payload** that rides the
opaque `E2EEGROUP` trailing parameter. It is an Onyx in-house control format.
It does **not** claim MLS or RFC 9420 wire interoperability.

**Server vs client (current truth):**

| Side | Reality |
|------|---------|
| **Onyx Server** | Source has an **active** opaque `E2EEGROUP` delivery path: authenticated membership/routing policy, local fan-out as `E2EE.KEYPACKAGE` / `E2EE.COMMIT` / `E2EE.WELCOME`, and mesh hop custody for exact origin-signed wires. The daemon does **not** parse the trailing payload as crypto, decrypt group secrets, or act as a group member. |
| **Onyx client payload** | OGC1 signed envelope is **implemented as pure codec helpers** (`groupControlPayload.ts`) and remains **staged / unwired** into the live store send/open and transport handler path. Product room E2EE is not complete. |

## Layers

| Layer | Module | Role |
|-------|--------|------|
| IRC routing | `src/lib/e2ee/groupControl.ts` | `E2EEGROUP` command shape; opaque base64url; no crypto |
| Signed payload (this) | `src/lib/e2ee/groupControlPayload.ts` | Canonical binary + Ed25519 envelope (staged; not store-wired) |
| Content envelope | `src/lib/e2ee/groupEnvelope.ts` | `ONYXROOM1` room ciphertext (separate) |
| Local epoch keys | `src/lib/e2ee/groupKeyring.ts` | In-memory AES-GCM keys; never vaulted |
| Welcome key-wrap (future) | *not implemented* | Pairwise wrap of epoch secrets into welcome **body** |

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

## Versioned payload wire (v1)

`opaque-base64url` = canonical base64url of the binary layout below
(all multi-byte integers **big-endian**):

| Offset | Field | Size | Notes |
|-------:|-------|-----:|-------|
| 0 | `magic` | 4 | ASCII `OGC1` (`GROUP_CONTROL_PAYLOAD_MAGIC`) |
| 4 | `version` | u8 | Must be `1` (`GROUP_CONTROL_PAYLOAD_VERSION`) |
| 5 | `kind` | u8 | `1` key-package, `2` welcome, `3` commit |
| 6 | `epoch` | u32be | Room epoch this control advances or advertises |
| 10 | `body_len` | u16be | `1 … 2048` (`MAX_GROUP_CONTROL_BODY_BYTES`) |
| 12 | `body` | `body_len` | Opaque typed-by-kind material (see body rules) |
| 12+L | `signer_pub` | 32 | Ed25519 public; bound in transcript; must equal trusted |
| 44+L | `signature` | 64 | Ed25519 over the transcript |

`L = body_len`. Total binary length must be exactly `108 + body_len`.
Re-encoding the decoded bytes must equal the original base64url string
(non-canonical encodings fail closed). Magic mismatch fails closed at parse.

### Body rules (v1)

| Kind | Body meaning | Forbidden |
|------|--------------|-----------|
| `key-package` | Public join / leaf material for a later schedule | Raw room AES key, extractable secrets |
| `commit` | Public epoch-advance / membership update material | Raw room AES key |
| `welcome` | Reserved for **pairwise key-wrap ciphertext** (future owner) | Cleartext room key; server-readable secrets |

Bodies are opaque to this module: `sign` / `parse` / `verify` never interpret
them as keys. A later pairwise welcome key-wrap layer owns encryption of any
epoch secret into the welcome body and decryption under the recipient device
key. Until that layer exists, welcome bodies must not be treated as room keys.

## Ed25519 transcript (exact field order)

Domain label: `ONYX-GROUP-CONTROL-v1`

```text
domain_utf8 ‖ 0x00 ‖
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

These are intentionally pure crypto/codec helpers. They are **not yet wired**
into the store/send/open path: no live handler currently signs outbound
controls, verifies inbound `E2EE.*` records against a trusted directory, or
installs epoch keys from welcome bodies. A future pairwise welcome key-wrap
layer will produce welcome `body` bytes, then call `signGroupControlPayload`.

## What exists elsewhere today

| Layer | Reality |
|-------|---------|
| DM E2EE | Static-static P-256 + HKDF + AES-GCM (`ONYXDM1` / legacy open `TSUMUGI1`) |
| Multi-device keys | Per-device publish via `E2EEKEY` + KEYTRANS list (C2 partial) |
| Media E2EE | Mooring paths for calls (separate from room E2EE) |
| Room policy | `encryption-policy` PROP (`off` / `optional` / `required`) |
| Ephemeral epoch keys | Bounded in-memory `RoomEpochKeyring`; never serialized into the history vault |
| Server opaque delivery | Active `E2EEGROUP` → `E2EE.*` path + mesh hop authority for opaque wires (daemon source) |
| Control IRC codec (client) | Strict `E2EEGROUP` build/parse helpers; **store/transport product wiring incomplete** |
| OGC1 payload (client) | Sign/parse/verify implemented; **staged / unwired** to store send/open |

## Non-goals (current)

- Claiming MLS RFC 9420 compliance or TreeKEM completeness
- Server-side decryption or key escrow
- Persisting room secrets in IndexedDB / the history vault
- Embedding raw room keys in key-package or commit payloads
- Claiming production dual-node acceptance of room group E2EE

## Next implementation slices

1. **Pairwise welcome key-wrap** (separate module): encrypt epoch installation
   material to a target device public key; place ciphertext in welcome `body`;
   keep sign/verify ownership in `groupControlPayload.ts`.
2. **Client store send/open integration**: outbound sign + IRC send; inbound
   `E2EE.*` parse/verify with trusted signer directory; keyring install.
3. Single-room two-device welcome/commit flow that installs one epoch key into
   the browser-only keyring.
4. Channel send/open: `ONYXROOM1` + fail-closed locked placeholder when the
   epoch key is missing; ciphertext stays ciphertext-only at rest.
5. **Production acceptance** after packaging and dual-node operator gates
   (not claimed by the v0.5.7 pre-deploy note alone).

See also: `onyx-client-contract.v1.json` (`group_e2ee`),
`onyx-server/docs/ops/release-v0.5.7-e2ee-group-control.md`, Era 3 C1 roadmap.
