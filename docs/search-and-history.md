# Message history & search

Onyx remembers your conversations on **your device** and lets you search across all
of them without anything leaving the browser. This guide covers the local history
vault, how search works (including on-device semantic ranking), jumping to a moment
in time, and the privacy guarantees behind all of it.

## The local history vault

Every channel and DM you read is written to a small database inside your browser
(IndexedDB, named `onyx-vault`). Rooms open **instantly** from this local copy —
before the network even answers — survive reloads, and stay readable offline.
There's no cloud and no bouncer; the device itself remembers.
(`src/lib/vault/historyVault.ts:19`, `:81`)

- **On-device only.** History stays in this browser on this machine. It is never
  synced to the server, never uploaded, and not visible to other Onyx clients or
  other devices you sign in from.
- **Bounded.** The vault keeps at most the newest **400 messages per
  conversation** (`VAULT_KEEP = 400`); older ones are pruned automatically as new
  messages arrive. (`src/lib/vault/historyVault.ts:23`, `:376`)
- **Best-effort.** In a private/incognito window, or if storage is full, the vault
  quietly does nothing rather than break the app — you simply lose the instant-open
  and offline benefits for that session. (`src/lib/vault/historyVault.ts:81`, `:154`)

### Turning it on or off

Local history is **on by default**. (`src/lib/prefs/preferences.ts:77`) You control
it in **Preferences → Local history** ("Remember conversations on this device").
Turning it **off** immediately erases everything stored in this browser's vault —
the toggle wipes the database as it flips. (`src/shell/PreferencesPanel.tsx:889`)

## Searching your history

Press **Cmd/Ctrl-F** to open message search. (`src/shell/AppShell.tsx:141`) It
searches two places at once: the messages currently loaded in your conversations,
and everything remembered in the device vault across **all** channels and DMs.
Type at least two characters; results update as you type (a short debounce keeps it
smooth). (`src/shell/search/useMessageSearch.ts:327`)

Vault search has two modes:

- **Exact text** (the default) — a case-insensitive substring match against message
  text and sender name, newest first. Fast and literal: searching `migration` finds
  messages containing that word. (`src/lib/vault/historyVault.ts:422`)
- **By meaning (semantic)** — ranks messages by topical similarity to your query, so
  a search for `migration` can also surface `schema rollout error` even when the
  exact word never appears. The ranking runs **entirely on your device** with a
  small, model-free embedding built into Onyx — no network call, no external model,
  and the same query always yields the same results.
  (`src/lib/vault/searchVaultSemantic.ts:44`, `src/lib/vault/embeddingIndex.ts:229`)

Switch modes from the command palette (**Cmd/Ctrl-K**, then type `vault:` — for
example `vault: meaning` or `vault: exact`). The choice persists for the session and
defaults to exact text. (`src/chat/spotlight/commands.ts:545`,
`src/shell/search/useMessageSearch.ts:66`)

> **On the roadmap, not yet wired.** A hybrid ranker
> (`src/lib/vault/searchVaultHybrid.ts`) that lists exact substring hits first and
> topical neighbors underneath in a single result exists in the codebase and is
> fully tested, but it is **not yet connected to the search UI** — today the panel
> uses either exact **or** semantic mode, not both at once.
> (verified: no non-test caller of `searchVaultHybrid` in `src/`)

## Jumping to a moment (time travel)

Onyx can scroll a conversation to a specific point in time. From the command palette
(**Cmd/Ctrl-K**) use the time grammar `at:` — for example `at: yesterday 3pm` for the
current room, or `#general at: last friday` to target a channel by name.
(`src/chat/spotlight/commands.ts:185`) Shared invite and stats links carry the same
`?at=` parameter, so opening one lands you at the referenced moment.
(`src/app/Connect.tsx:303`, `src/routes/Stats.tsx:55`)

When the server supports history replay, Onyx asks it for a window around that
moment. When it doesn't — or when you're offline — Onyx falls back to the local
vault, pulling the remembered messages nearest the timestamp and landing on the
closest one. (`src/lib/store/store.ts:2861`, `src/lib/vault/historyVault.ts:189`)

## Privacy: encrypted DMs never hit the vault

For end-to-end-encrypted DMs, the decrypted plaintext you see on screen is
**view-only and never written to disk**. When a message is saved, Onyx strips the
decrypted body and stores only the ciphertext envelope — so what lands in IndexedDB
is exactly what the server relayed, unreadable without your device's key.
(`src/lib/vault/historyVault.ts:122`)

More broadly, nothing about your history or your searches leaves the browser:

- The vault is local IndexedDB; there is no history upload path.
- Both search modes scan only the local vault, and the semantic model runs
  in-browser — your query text is never sent anywhere.
  (`src/lib/vault/searchVaultSemantic.ts:2`)
- Importing history from other apps is likewise fully on-device (see
  [`importing.md`](importing.md)).

If you want to move history to another device deliberately, use the export/import
controls in Preferences → "Local history & portability" — a portable JSON snapshot
you carry yourself, not a sync service.
