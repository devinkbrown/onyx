# Security and privacy model

The client-side boundaries contributors must preserve. This isn't a guarantee
about any deployment, browser extension, proxy or server.

## Threat model

IRC lines, metadata, history rows, media signaling, uploads and server replies
are untrusted. Expect malformed wire text, forged-looking metadata, unknown
ciphertext, replayed frames, oversized payloads and capability lies.

The browser profile, OS, extensions, devtools and a compromised server host are
outside the client's control. The network can see connection metadata and any
content that isn't end-to-end encrypted.

## Where secrets live

- **Elm (`elm/src`) holds no secrets.** Passwords, session tokens, private keys,
  room epoch keys and decrypted private payloads stay in the private runtime
  (`elm/runtime`) or in WebCrypto. Elm gets UI-safe projections.
- **The runtime owns the IRC socket** (`transport-owner.ts`) and validates
  outbound lines (`client-line-validator.ts`).
- Sign-in on the connect gate goes through the runtime; the password never
  enters the Elm model.

## Encrypted DMs

Device-held WebCrypto keys and the `ONYXDM1` / `ONYXDMN1` envelopes
(`elm/src/DmCipher.elm`, `src/lib/e2ee/dmCipher.ts`). Invariants:

- an encrypted DM never falls back to plaintext;
- a missing, invalid or changed peer key fails closed, and key changes are
  visible;
- multi-device fan-out encrypts to the published device set;
- the server and search see the envelope, not the body;
- the vault stores ciphertext only;
- notifications and accessibility text use a neutral locked placeholder.

DM keys are published as `ocean.dm-key(s)` metadata, which needs the server to
negotiate `draft/metadata-2`.

## Encrypted rooms

Rooms with required encryption use `ONYXROOM1` envelopes, signed group control
records (`E2EE.KEYPACKAGE`, `E2EE.COMMIT`, `E2EE.WELCOME`), a device directory,
and epoch keys installed per room.

- Epoch keys are ephemeral (never persisted); a reload re-provisions them.
- A required-encryption room never accepts or sends plaintext.
- Group control input is consumed by the private crypto provider before any
  public projection.
- **Device-trust review** (`group.trust-preview` → `group.trust-confirm`) shows a
  device before trusting it and writes the pin only on confirm. This is new
  code and **pending independent security review**.

Tested: an 8-stage two-browser journey against a local Onyx Server passes.
Not proven: rooms with three or more members, cross-node delivery, real
devices. The payload format is in
[`protocol/group-e2ee-c1.md`](protocol/group-e2ee-c1.md); it's an in-house
format, not MLS.

## Cadence media

Media E2EE uses MooringSession/MooringGroup (`src/lib/cadence-media/`) with
`E2EE-HANDSHAKE` / `E2EE-GROUPKEY`. The UI shows a padlock only when the media
payload is actually sealed and authenticated; an authenticated relay alone is
not "private". Keep fail-closed startup, the replay window, membership
rotation and teardown intact.

## Local data

- History (IndexedDB `onyx-vault`) and preferences (`onyx:*` localStorage)
  belong to the browser profile. They aren't a cloud backup.
- Device keys (`onyx-keys`), key pins and trusted signers live in separate
  databases and survive clearing history.
- Backups and exports are deliberate user downloads; treat them as sensitive.
- Remembered sign-in material is local browser state; clear it on shared
  computers.

## Service worker

The worker precaches only hashed shell assets listed in its build envelope,
activates a new build only when the page is idle (no unsaved draft, active
call or pending private mutation). Web Push notifications never show message
text: the body is always generic, and DM titles never name the sender.

## Contributor rules

- Never use `innerHTML` for untrusted content.
- Never add a plaintext fallback to an E2EE failure.
- Never log secrets or message bodies.
- Never commit `.env` files, keys, browser profiles, deployment trees or real
  user exports.
- A new crypto or storage sink needs a focused adversarial test and a note
  here.

Report suspected vulnerabilities privately via [`../SECURITY.md`](../SECURITY.md).
