# Security and privacy model

This page describes the client-side boundaries that contributors must preserve.
It is not a guarantee that every deployment, browser extension, reverse proxy,
or server is trustworthy.

## Threat model

IRC messages, metadata, history rows, media signaling, uploads, and server
replies are untrusted input. The client should assume that a peer or relay can
send malformed wire text, forged-looking metadata, unknown ciphertext, replayed
frames, oversized payloads, and capability lies.

The browser profile, operating system, installed extensions, developer tools,
and a compromised server host are outside the client's full control. A hosted
network can still observe connection metadata and any content that is not
end-to-end encrypted.

## Direct-message E2EE

The DM path in `src/lib/e2ee/` uses device-held Web Crypto keys and the
`ONYXDM1`/`ONYXDMN1` envelope families. The store integrates sealing before
socket admission and opening after ciphertext is stored. The important
invariants are:

- a designated encrypted DM never silently falls back to plaintext;
- a missing, invalid, or changed peer key fails closed;
- TOFU/key-change state is visible to the user;
- multi-device fan-out encrypts to the published device set;
- the server and ordinary message search see the envelope, not the DM body;
- the history vault stores ciphertext and never decrypted DM plaintext;
- notifications and accessibility text use a neutral locked placeholder rather
  than leaking the envelope or plaintext.

DM encryption is not the same as account authentication, transport TLS, or
server-side access control. Verify device identity and key-change warnings when
the conversation matters.

## Cadence media E2EE

Cadence media has its own client-held room-key path in
`src/lib/cadence-media/`. The UI derives a security state from the negotiated
Mooring/session, seal, MAC, and relay conditions. A padlock is permitted only
when the actual media payload is sealed and authenticated; an authenticated
transport or relay alone is not described as private.

Media security state can degrade during a call. Contributors must preserve the
fail-closed startup, replay-window, membership-rotation, and teardown behavior.

## Group-room E2EE boundary

`ONYXROOM1`, the in-memory room keyring, opaque `E2EEGROUP` routing, and the
signed OGC1 control payload are implemented foundations. The current client
contract intentionally marks full group-room E2EE as **staged**: live store
send/open integration, trusted-directory verification, pairwise welcome
key-wrap, and production acceptance must not be inferred from the pure codecs.

When adding room encryption, do not persist raw room secrets in IndexedDB, do
not trust the embedded signer key without external trust, and do not accept
plaintext when a room's `encryption-policy` is `required`.

## Local data and imports

- IndexedDB history and `localStorage` preferences belong to the browser
  profile; they are not a hosted backup.
- Discord, Slack, and IRC-log import parsing is local to the browser. The client
  does not upload the source export as part of the import flow.
- Portable vault/identity exports are deliberate user downloads. Treat them as
  sensitive files.
- Saved credentials/session material, if enabled by the user, is local browser
  state and should be cleared on a shared computer.

## Contributor security rules

Do not use `innerHTML` for untrusted message content, add plaintext fallback to
an E2EE failure, log secrets or message bodies, or commit `.env` files, private
keys, browser profiles, generated deployment trees, or real user exports.

For a new crypto or storage sink, add a focused adversarial test and document
the boundary in the relevant guide. Report a suspected vulnerability privately
using [`../SECURITY.md`](../SECURITY.md).
