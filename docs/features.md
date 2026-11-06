# Using Onyx

*Audience: people using the app.* A tour of what the current client does. The
in-app Guides (`/guides/`) cover the same ground step by step.

## Getting in

Open `/app/`. The connect screen offers three ways in:

- **Continue as guest.** Chat straight away with a guest name. You can keep the
  name later ("Keep this name" under You) without reconnecting.
- **Sign in** with an Onyx account.
- **Create account.**

Passwords go to the client's private runtime, never into the app's view state.

## The five places

| Place | What's there |
| --- | --- |
| **Home** | What needs you: conversations with mentions or unread DMs, plus next steps. |
| **Rooms** | Your rooms, filterable by All, Unread, @Mentions and Favorites. Browse or start a room. |
| **Messages** | Direct messages, with the same filters. |
| **Calls** | Voice calls in your rooms. |
| **You** | Account settings, connection, Appearance, Guides, and Advanced. |

On desktop you get a slim icon rail and a sidebar. On phones there's a bottom
bar, conversations open as full pages with Back, and You opens full screen.

## Conversations

- **Room header** with topic and member count; open it for room details and
  the member list, grouped Owners, Admins, Moderators, Helpers, Voiced and
  Members, with presence. Tap a name to open the profile.
- **Messages** are grouped by author with times in the gutter, day dividers, a
  "new" divider, "load older" and jump-to-latest.
- **Message menu** (hover, right-click or long-press): six one-tap reactions, the main
  actions (reply, quote, edit, delete, pin, copy text or link), and "More". Arrow keys move
  through it; on phones it's a bottom sheet.
- **Composer**: one row that grows as you type, with the reply bar above it.
  On phones, attachments and extras sit behind a **+** tray.
- **Search, pins and media** open as sheets from the room header.
- Failed sends, refused sign-ins and stuck sign-ins tell you what happened.

## Inbox

A sheet (bottom sheet on phones) with mentions, DMs, invites and kicks. Each row
shows its type, where it came from and when, and jumps to the message. Invites
and kicks are actionable. Server notices never land here as DMs or mentions, and
ignored people are filtered out.

## Voice calls

Start or join a call from a room or from Calls. While you're in a call, a call bar
stays visible across the app with microphone, camera, sharing and caption
controls. Calls need a signed-in account on the server.

## Encryption

- **Encrypted DMs** between devices that have published keys. If a key is
  missing or changes, the conversation fails closed and tells you.
- **Encrypted rooms** for rooms that require encryption. Members' devices are
  enrolled, and you review a new device before trusting it. Device-trust review
  is new and still waiting for an independent security review.

Encrypted messages are stored on your device only as ciphertext, and
notifications never show their text.

## History and search

Conversations are saved in this browser (IndexedDB), so rooms open from local
history and stay readable offline. The default is the newest 400 messages per
conversation, adjustable in settings, with optional age limits. Search covers
loaded messages and your saved history, with exact, related-terms and hybrid
modes. History isn't synced between devices.

## Appearance

Under **You → Appearance**: pick a look (Ocean, Pearl, Match device, Graphite,
Sepia, Mist, Plum, High contrast, and more), text size, density and motion.
"Match device" is the default and follows your system's light or dark setting.
You can also build custom themes. Your choice applies before the page paints.

## Install and updates

Onyx is an installable web app (Add to Home Screen on iOS, Install in desktop
browsers). New versions download in the background and switch over
automatically when nothing is in progress (no unsent draft, call or private
operation), with a single reload.

## Advanced

**You → Advanced** holds local services and recovery, devices, and backups.
