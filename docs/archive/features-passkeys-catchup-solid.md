> **Archived 2026-11-06.** Historical record from the SolidJS era; paths and status here are not current. See [`../README.md`](../README.md).

# Passkeys & catching up

*Audience: end-user.* Two everyday features: signing in without a password
using a **passkey**, and the **"since you were away"** digest on your Home
screen that tells you what happened while you were gone.

## Passkeys — sign in without a password

A passkey lets you sign in with Face ID, a fingerprint, or a hardware security
key instead of typing a password. You manage them from the account panel
(settings icon, bottom right) under **Passkeys**. (`src/shell/PasskeysSection.tsx:123`)

### Add a passkey

1. Sign in to your account first — the section stays inert for guests.
   (`src/shell/PasskeysSection.tsx:70`)
2. Open the account panel and find **Passkeys**.
3. Optionally give the passkey a name (e.g. *My laptop*) so you can tell your
   devices apart later. (`src/shell/PasskeysSection.tsx:156`)
4. Click **Add a passkey**. The button changes to *Waiting for your device…*
   while your browser prompts you for Face ID, a fingerprint, or your security
   key. (`src/shell/PasskeysSection.tsx:163`)
5. On success you'll see *Passkey added* and the new key appears in **Your
   passkeys**. (`src/lib/store/store.ts:4936`)

If you cancel the device prompt, or anything goes wrong, Onyx shows the error
and **never** quietly falls back to a weaker sign-in — you stay exactly as
secure as before. (`src/shell/PasskeysSection.tsx:11`)

### Your passkeys list

Each registered passkey shows its name, when it was added, and how many times
it has signed you in (*Used N×*). (`src/shell/PasskeysSection.tsx:222`) Use
**Refresh** to re-fetch the list from the server.
(`src/shell/PasskeysSection.tsx:186`)

- **Rename** — give a passkey a clearer name.
  (`src/shell/PasskeysSection.tsx:239`)
- **Remove** — deletes a passkey. Onyx asks you to confirm inline (*Remove?* /
  *Cancel*) so a single stray click can't delete a key.
  (`src/shell/PasskeysSection.tsx:244`) On success you'll see *Passkey removed*.
  (`src/lib/store/store.ts:4973`)

### When passkeys aren't available

The section is honest about what your browser and server can actually do:

- **"This browser does not support passkeys."** — your browser can't do
  WebAuthn. Try a current Chrome, Safari, Firefox, or Edge on a device with a
  screen lock. (`src/shell/PasskeysSection.tsx:190`)
- **"This server does not offer passkey sign-in yet."** — passkeys are not
  currently available on the network you're connected to. You can still protect
  your account with a password and two-factor authentication.
  (`src/shell/PasskeysSection.tsx:198`)

Onyx does not receive a passkey capability advertisement up front. When a
signed-in user opens the panel, the client probes with `WEBAUTHN LIST`; a
successful reply enables the manager. If the command is unavailable, the
server does not answer, or passkeys are temporarily unavailable, the client
fails closed and the section reports that the server does not offer passkey
sign-in. (`src/shell/PasskeysSection.tsx:125`, `src/lib/store/store.ts:8677`, `src/lib/store/store.ts:8687`)

The client supports the passkey manager, and Onyx Server implements the
`WEBAUTHN` command. Server success replies are targeted IRCX `EVENT` messages
such as `:server EVENT <nick> WEBAUTHN CRED …`; the client consumes that event
plane. The server requires `[webauthn]` configuration with an RP ID and at least
one allowed origin, and fails closed when either is missing.
(client: `src/lib/webauthn/passkey.ts:6`, `src/lib/store/store.ts:10539`;
Onyx Server: `src/daemon/server.zig:57172`,
`etc/onyx-server.reference.toml:795`)

If a network's server has the base passkey commands but does not implement
`WEBAUTHN RENAME`, Onyx hides **Rename** after the server rejects that
subcommand and explains that renaming is unavailable there.
(`src/lib/store/store.ts:10561`, `src/shell/PasskeysSection.tsx:233`)

## "Since you were away" — the Home catch-up digest

When you're connected, your Home screen leads with a **Catch up** card that
sorts everything you missed into three tiers, loudest first, so mentions and
DMs surface while ambient chatter stays out of your way.
(`src/shell/HomeView.tsx:485`)

The header summarises the totals — unread count, mentions (bold), and how many
**followed** channels have activity — or shows *You're all caught up ✓* when
there's nothing waiting. (`src/shell/HomeView.tsx:490`)

### The three tiers

- **Needs you** — your DMs and any channel where you were **mentioned**. Mute
  is Discord-style hard silence: a muted room or DM never appears here, even
  with @ or a keyword highlight. Mentions-only is the middle All / @ / Mute
  level and still badges @.
  (`src/lib/notifications/awayDigest.ts`, `src/shell/HomeView.tsx:511`)
- **Followed** — channels you follow that have unread messages but no mention.
  Summarised on their own, never bumped up into *Needs you*.
  (`src/lib/notifications/awayDigest.ts`, `src/shell/HomeView.tsx:521`)
- **Quiet activity** — the collapsed tail: everything else with unread that is
  not hard-silenced. Folded into an expandable *Quiet activity (N)* section and
  capped so it never floods the card.
  (`src/lib/notifications/awayDigest.ts`, `src/shell/HomeView.tsx:529`)

Muting a channel or DM is hard silence — no badge, no OS ping, no digest row.
Mentions-only still badges @. (`src/lib/notifications/awayDigest.ts`)

### How your calm preset changes it

Your calm-mode preset governs how loud the digest is:

- **Calm / Regular** — followed channels stay in their own **Followed** tier and
  never escalate into *Needs you*. (`src/lib/notifications/awayDigest.ts:69`)
- **Power** — followed channels are pulled up into *Needs you* alongside your
  mentions and DMs, so a power user sees everything up top.
  (`src/lib/notifications/awayDigest.ts:69`)

Within each tier the order is deterministic: *Needs you* leads with the loudest
mention, then DMs, then most recent; the other tiers sort busiest-first.
(`src/lib/notifications/awayDigest.ts:75`, `src/lib/notifications/awayDigest.ts:89`)
Click any row to jump straight into that conversation.
(`src/shell/HomeView.tsx:249`)

## Mentions, DMs, and calls when the tab is closed

You → **Notifications** is the short page for what can ping after this tab
closes: mentions, DMs, and calls. Turning alerts on uses this browser's
service worker and the network you already joined — not a third-party push
vendor. A room you are in can still be set to all messages, mentions only, or
mute. (`src/shell/YouNotifications.tsx`)

Onyx asks once, quietly, after you have sent or received a real message — never
as a wall on Connect. The desktop app does not claim system notifications while
its host flag is off. (`src/shell/FirstRunNotifyPrompt.tsx`,
`docs/protocol/push-notify-modes.md`)
