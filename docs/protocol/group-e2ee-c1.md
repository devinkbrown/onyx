# Group E2EE (Era 3 C1) — status

**Status:** foundation only — **not product-complete**.

## What exists today

| Layer | Reality |
|-------|---------|
| DM E2EE | Static-static P-256 + HKDF + AES-GCM (`TSUMUGI1` / `ONYXDM1`) |
| Multi-device keys | Per-device publish via `E2EEKEY` + KEYTRANS list (C2 partial) |
| Media E2EE | Mooring / SFrame-shaped paths for calls (separate from room E2EE) |
| Room policy | `encryption-policy` PROP (`off` / `optional` / `required`) |

## What C1 still requires

1. Opaque group key schedule (MLS-class TreeKEM or deliberate subset)  
2. Multi-device leaf fan-out for every room member  
3. Epoch advance + member add/remove without server plaintext  
4. Client UI for “required encryption room” + recovery on key loss  
5. Fail-closed history when keys unavailable  

## Non-goals (for now)

- Claiming MLS RFC compliance before TreeKEM upgrade  
- Server-side decryption or key escrow  

## Next implement slice (when scheduled)

- Spec spike: member set + epoch wire tags on channel messages  
- Single-room prototype with two devices and one epoch rotate  

See also: `ONYX_PRODUCT_COMPLETE_ROADMAP.md` Era 3 C1.
