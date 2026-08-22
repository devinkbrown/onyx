# Message history & search

*Audience: end-user.* Onyx remembers your conversations on **this device** and
lets you search that local memory without a cloud history service. This guide
covers the on-device history vault, device-memory search (including hybrid
ranking), optional per-conversation archived server search, jumping to a moment
in time, and the privacy boundaries for each path.

## The local history vault

Every channel and DM you read is written to a small database inside your browser
(IndexedDB, named `onyx-vault`). Rooms open **instantly** from this local copy —
before the network even answers — survive reloads, and stay readable offline.
There's no cloud and no bouncer; the device itself remembers.
(`src/lib/vault/historyVault.ts:41`, `:5`)

- **On-device only.** History stays in this browser on this machine. It is never
  synced to the server, never uploaded, and not visible to other Onyx clients or
  other devices you sign in from.
- **Bounded.** The vault keeps at most the newest **400 messages per
  conversation** by default (`VAULT_KEEP = 400`); older ones are pruned
  automatically as new messages arrive. Preferences can raise or lower that
  per-conversation keep. (`src/lib/vault/historyVault.ts:45`, `:415`)
- **Best-effort.** In a private/incognito window, or if storage is full, the vault
  quietly does nothing rather than break the app — you simply lose the instant-open
  and offline benefits for that session. (`src/lib/vault/historyVault.ts:269`, `:431`)

### Turning it on or off

Local history is **on by default**. (`src/lib/prefs/preferences.ts:87`) You control
it in **Preferences → History & data → Local history** ("Remember conversations
on this device"). Turning it **off** stops new saves and erases what is already
stored in this browser's vault — the toggle wipes the database as it flips, and
tells you when erasure could not be verified.
(`src/shell/PreferencesPanel.tsx:561`, `:547`, `:573`)

## Searching your history

Press **Search** in the room or DM header, or **Cmd/Ctrl-F**. Home also has
**Search messages** in the welcome actions. (`src/shell/PresenceRibbon.tsx`,
`src/shell/AppShell.tsx`, `src/shell/home/HomeBriefingView.tsx`) Search is layered:

1. **Visible matches** — messages already loaded in the active conversation
   (in-memory find next/previous).
2. **Device memory** — a newest-first scan of this browser's vault across
   **all** channels and DMs you have stored here (not a network-wide index; one
   query is also globally work-capped so a huge vault cannot freeze the tab).
3. **Archived server history** *(optional, opt-in)* — only for the **active**
   room or DM, only when the server advertises search, and only after you press
   **Search full history** (or Ctrl/Cmd-Enter). There is no server-wide search
   across every room.
   (`src/shell/search/useMessageSearch.ts:355`, `:405`,
   `src/shell/search/MessageSearch.tsx:745`)

Every pane carries a provenance chip so the boundary is visible at a glance:
**This device** for visible find, device-memory recall, and saved searches;
**This server** only for the archived opt-in path.
(`src/shell/ProvenanceBadge.tsx:10`, `src/lib/intelligence/provenance.ts:11`,
`src/shell/search/MessageSearch.tsx:542`, `:637`, `:735`, `:828`)

Type at least two characters for device-memory results; they update as you type
(a short debounce keeps it smooth). (`src/shell/search/useMessageSearch.ts:539`,
`:597`)

### Device recall modes (all on this device)

Vault / device-memory matching has three modes. All scan IndexedDB **in this
browser** with a built-in hashing vectorizer — no network call, no model
download, no cloud AI:

| UI label | Mode key | What it does |
|---|---|---|
| **Text + related** | `hybrid` (**default**) | Exact substring ranking fused with related-token ranking (Reciprocal Rank Fusion) so literal hits and token-similar neighbors share one list |
| **Exact** | `exact` | Case-insensitive substring on message text and sender, newest first |
| **Related terms** | `semantic` | Token-similarity ranking only (shared/related tokens via the hashing vectorizer — not a neural language model) |

(`src/lib/prefs/vaultSearchMode.ts:16`, `:18`;
`src/shell/search/useMessageSearch.ts:31`, `:548`;
`src/lib/vault/searchVaultHybrid.ts:141`, `:46`;
`src/lib/vault/historyVault.ts:986`;
`src/lib/vault/searchVaultSemantic.ts:51`;
`src/lib/vault/embeddingIndex.ts:2`, `:336`)

Switch modes from **Advanced** in the search panel (the **Device recall**
segmented control; titles all end with “— all on this device”), from
**Preferences → History & data → Default search mode**, or from the command
palette (**Cmd/Ctrl-K**, then `vault: hybrid`, `vault: exact`, `vault: related`,
or bare `vault` to cycle). Hybrid and related-term matching stay behind
Advanced; the default search field just finds messages. The in-search choice is
session-local; Preferences stores the default a fresh search starts in.
(`src/shell/search/MessageSearch.tsx`,
`src/shell/PreferencesPanel.tsx`,
`src/chat/spotlight/commands.ts`)

Result section titles stay explicit about provenance:

- Exact → **Saved on this device**
- Hybrid → **Recalled on this device**
- Related terms → **Related terms on this device**

(`src/shell/search/MessageSearch.tsx:833`)

Loading and empty completion for device memory use the same boundary language
(*Searching device memory for …* / *no remembered matches*), never “searching the
network.” (`src/shell/search/MessageSearch.tsx:184`)

### Optional archived server search

When you are **in a concrete channel or DM**, the server supports history search,
and the conversation is not an E2EE DM boundary, the panel offers **Search full
history** under an **Archived message search** badge. That path searches the
server's archive for **that conversation only** — not every room on the network.
(`src/shell/search/MessageSearch.tsx:735`,
`src/shell/search/useMessageSearch.ts:355`)

Encrypted DMs fail closed on the server path: query text is not sent; only
loaded decrypted lines stay searchable on this device.
(`src/shell/search/MessageSearch.tsx:794`,
`src/shell/search/useMessageSearch.ts:337`)

## Jumping to a moment (time travel)

Onyx can scroll a conversation to a specific point in time. From the command
palette (**Cmd/Ctrl-K**) use the time grammar `at:` — for example
`at: yesterday 3pm` for the current room, or `#general at: last friday` to
target a channel by name. (`src/chat/spotlight/commands.ts:281`) Shared invite
and stats links carry the same `?at=` parameter, so opening one lands you at the
referenced moment. (`src/app/Connect.tsx:322`, `src/routes/Stats.tsx:64`)

When the server supports history replay, Onyx asks it for a window around that
moment. When it doesn't — or when you're offline with local history on — Onyx
falls back to the local vault, pulling the remembered messages nearest the
timestamp and landing on the closest one.
(`src/lib/store/store.ts:5591`, `src/lib/vault/historyVault.ts:533`)

## Privacy: encrypted DMs never hit the vault as plaintext

For end-to-end-encrypted DMs, the decrypted plaintext you see on screen is
**view-only and never written to disk**. When a message is saved, Onyx strips the
decrypted body (`plaintext`) and stores only the ciphertext envelope — so what
lands in IndexedDB is exactly what the server relayed, unreadable without your
device's key. (`src/lib/vault/historyVault.ts:100`, `:352`)

Boundaries for search:

- **Device-memory search** (exact / hybrid / related terms) scans only this
  browser's vault. Related-term ranking uses a **model-free hashing vectorizer**
  in-browser — the query text is never sent for those modes on the default path.
  (`src/lib/vault/embeddingIndex.ts:336`,
  `src/lib/vault/searchVaultHybrid.ts:31`,
  `src/lib/vault/searchVaultSemantic.ts:11`)
- **Archived server search** is explicit and per-conversation: only when you
  click **Search full history** (or Ctrl/Cmd-Enter) does the query go to the
  server for the active room. E2EE DMs never take that path.
- The vault is local IndexedDB; there is no history *upload* path.
- Importing history from other apps is likewise fully on-device (see
  [`importing.md`](importing.md)).

If you want to move history to another device deliberately, use
**Preferences → Import & export → Portable vault** — a portable JSON (or
compressed) snapshot you carry yourself, not a sync service.
(`src/shell/PreferencesPanel.tsx:206`, `:215`, `:3556`, `:1060`)
