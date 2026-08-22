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
  screen lock. (`src/shell/PasskeysSection.tsx:133`)
- **"This server does not offer passkey sign-in yet."** — the network you're
  connected to hasn't turned on passkey support. You can still protect your
  account with a password and two-factor authentication.
  (`src/shell/PasskeysSection.tsx:141`)

Onyx doesn't get server passkey support advertised up front, so it *probes* the
server the first time you open the panel and only shows the manager once the
server answers. (`src/lib/store/store.ts:569`) Until a server answers the probe,
the section fails closed to the "not offered yet" state rather than pretending
the feature works. (`src/lib/store/store.ts:3500`)

> **Status — coming once server support lands.** The full passkey manager
> (register, list, rename, remove) is built and shipping in the client, but it
> only lights up end-to-end once your Onyx Server replies to the `WEBAUTHN`
> command with the expected `NOTE WEBAUTHN …` messages — a known server-side
> gap. Renaming in particular degrades gracefully: if the server has passkeys
> but not the rename subcommand, Onyx hides the **Rename** button and tells you
> *"This server does not support renaming passkeys yet."* rather than failing
> repeatedly. (`src/lib/store/store.ts:4892`, `src/shell/PasskeysSection.tsx:233`)

## "Since you were away" — the Home catch-up digest

When you're connected, your Home screen leads with a **Catch up** card that
sorts everything you missed into three tiers, loudest first, so mentions and
DMs surface while ambient chatter stays out of your way.
(`src/shell/HomeView.tsx:485`)

The header summarises the totals — unread count, mentions (bold), and how many
**followed** channels have activity — or shows *You're all caught up ✓* when
there's nothing waiting. (`src/shell/HomeView.tsx:490`)

### The three tiers

- **Needs you** — your DMs and any channel where you were **mentioned**. This
  tier is always at the top and can't be silenced by muting.
  (`src/lib/notifications/awayDigest.ts:66`, `src/shell/HomeView.tsx:511`)
- **Followed** — channels you follow that have unread messages but no mention.
  Summarised on their own, never bumped up into *Needs you*.
  (`src/lib/notifications/awayDigest.ts:69`, `src/shell/HomeView.tsx:521`)
- **Quiet activity** — the collapsed tail: everything else with unread, plus
  **muted** ambient traffic (no mention/highlight). Direct mentions from a muted
  room still stay in *Needs you*; only ambient muted unread is quiet. Folded into
  an expandable *Quiet activity (N)* section and capped so it never floods the card.
  (`src/lib/notifications/awayDigest.ts:66`, `src/lib/notifications/awayDigest.ts:139`,
  `src/shell/HomeView.tsx:529`)

Muting a channel quiets only ambient unread (including followed-no-ping);
muted-room highlights still route to **Needs you**. (`src/lib/notifications/awayDigest.ts:66`)

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
