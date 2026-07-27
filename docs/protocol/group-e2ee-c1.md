# Group E2EE (Era 3 C1) — status

**Status:** staged Onyx v1 design — **not product-complete**.

## What exists today

| Layer | Reality |
|-------|---------|
| DM E2EE | Static-static P-256 + HKDF + AES-GCM (`TSUMUGI1` / `ONYXDM1`) |
| Multi-device keys | Per-device publish via `E2EEKEY` + KEYTRANS list (C2 partial) |
| Media E2EE | Mooring / SFrame-shaped paths for calls (separate from room E2EE) |
| Room policy | `encryption-policy` PROP (`off` / `optional` / `required`) |
| Ephemeral epoch keys | bounded in-memory `RoomEpochKeyring`; never serialized into the history vault |
| Control plane | strict client/server codec plus a staged origin-signed mesh record and metadata-only replay authority; live handler/transport not yet registered |

## What C1 still requires

1. Opaque group key schedule (MLS-class TreeKEM or deliberate subset)  
2. Multi-device leaf fan-out for every room member  
3. Epoch advance + member add/remove without server plaintext  
4. Client UI for “required encryption room” + recovery on key loss  
5. Fail-closed history when keys unavailable  

## Non-goals (for now)

- Claiming MLS RFC compliance before TreeKEM upgrade  
- Server-side decryption or key escrow  

## Chosen implementation direction

Onyx v1 follows the repository's staged, in-house TreeKEM design: group
secrets and epoch ratchets run in the browser, while Onyx Server authenticates
membership and forwards bounded opaque `key-package`, `welcome`, and `commit`
records. The server is never a group member and never receives a decryptable
room secret. Full RFC 9420 wire interoperability is deliberately deferred.

The versioned [client/server contract](onyx-client-contract.v1.json) records
the negotiated `onyx/e2ee` capability, `ONYXROOM1` content envelope, and the
required `+onyx/e2ee=mls` tag. The client contract check compares that exact
artifact to the server checkout when both repositories are available.
Here `mls` is an internal algorithm-family marker only; it is not an RFC 9420
wire-interoperability claim.

The staged control command has two exact forms:

```text
E2EEGROUP <channel> <key-package|commit> <from-device> :<opaque-base64url>
E2EEGROUP <channel> welcome <from-device> <to-account> <to-device> :<opaque-base64url>
```

The payload is canonical unpadded base64url, bounded to 4096 bytes on the IRC
wire. It is neither decrypted nor persisted by the server. The staged mesh
codec binds routing metadata and payload to an origin signature, while its
separate replay checkpoint retains only origin keys, clocks, retirement
watermarks, and relay IDs. The command remains non-live until authenticated
membership/device checks, rolling transport negotiation, and delivery are
registered.

## Next implementation slice

- Rolling-upgrade-safe signed mesh framing plus authenticated member/device
  authorization and bounded opaque group-control delivery on the server.
- Single-room, two-device welcome/commit flow that installs one epoch key in
  the browser-only keyring.
- Channel send/open wiring: `ONYXROOM1` plus `+onyx/e2ee=mls`; unknown or stale
  epochs remain locked, and ciphertext stays ciphertext-only at rest.

See also: `ONYX_PRODUCT_COMPLETE_ROADMAP.md` Era 3 C1.
