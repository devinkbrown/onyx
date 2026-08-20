# Importing from Discord

Onyx lets you import your own Discord server history directly into your device's local vault. No Discord API token needed, no server upload—everything runs on your device.

## How it works

Onyx reads a Discord history export off your disk and merges it into your device's local vault. The import is purely on-device: your history never touches Discord's servers again, nothing is uploaded anywhere, and everything becomes instantly searchable, time-travellable scrollback in your vault.

There are two ways in — pick whichever export you already have:

- **[Official Discord data package](#route-a--official-discord-data-package-no-tool)** — the export **every** Discord user can request themselves from Settings, no third-party tool. Onyx reads the unzipped folder. Contains **only your own messages** (that's a property of Discord's package, not a limit of Onyx).
- **[DiscordChatExporter](#route-b--discordchatexporter)** — a popular, open-source tool that exports a whole channel (every author) to a JSON file, using your token.

Both routes normalize into the same vault snapshot and share the same validation, per-channel cap, dedup, and summary, so the "What gets imported", "Limits", and "Privacy" sections below apply to either.

## Route A — Official Discord data package (no tool)

This route needs nothing but Discord itself.

### Request your data from Discord

1. In Discord, open **Settings → Privacy & Safety → Request all of my Data**.
2. Discord emails you a download link when the package is ready (this can take up to ~30 days on Discord's side).
3. Download the `.zip` and **unzip it** — Onyx imports the *folder*, not the zip. The unzipped tree contains an `account/` folder and a `messages/` folder.

### Import the package into Onyx

1. Open Onyx preferences (settings icon, bottom right).
2. Open **Preferences → Import & export → Discord package**.
3. Click **Choose package folder** and select the unzipped package folder. Onyx reads only the package files it recognizes (`account/user.json`, `messages/index.json`, and each channel's `channel.json` + `messages.json`/`messages.csv`) — everything else in the folder is ignored. (`src/shell/HistoryImportControls.tsx:247`, `:283`)
4. Review the import summary (channels, message count, date range, any skipped or over-cap messages).
5. Click **Import into vault**.

Under the hood, `parseDiscordPackage` correlates the package tree on-device: your author name from `account/user.json`, channel names from `messages/index.json` and each channel's `channel.json`, and the message rows from `messages.json` or the newer `messages.csv`. (`src/lib/import/discordPackageImport.ts:272`, `:231`, `:248`, `:290`) Package timestamps written as `YYYY-MM-DD HH:MM:SS` with no offset are pinned to **UTC** so imports are deterministic regardless of your machine's timezone. (`src/lib/import/discordPackageImport.ts:85`) It then hands the normalized channels to the same `parseDiscordExport` the DiscordChatExporter route uses, inheriting identical validation, bounding, dedup, and summary. (`src/lib/import/discordPackageImport.ts:322-340`)

A malformed file is skipped, not fatal: one unreadable `channel.json`, `messages.json`, or `messages.csv` is dropped and the rest of the package still imports. (`src/lib/import/discordPackageImport.ts:294-317`) Re-importing the same package is safe — message ids are the stable `discord:<channelId>:<id>` form, so a second import upserts the same rows instead of duplicating them. (`src/lib/import/discordImport.ts:206`)

> Discord's own package only contains **your** messages, so this route imports your side of each channel. To archive a channel with every participant's messages, use Route B.

## Route B — DiscordChatExporter

### Export from Discord

1. Download [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) (GitHub releases or by package manager).
2. Point it at your Discord token (follow the project's instructions for token extraction).
3. For each channel you want to save, export in **JSON** format:

```bash
DiscordChatExporter export \
  -t <YOUR_TOKEN> \
  -c <CHANNEL_ID> \
  -o channel-name.json \
  --format json
```

Repeat for as many channels as you like. JSON files are safe to store—they're plain text.

### Import into Onyx

1. Open Onyx preferences (settings icon, bottom right).
2. Open **Preferences → Import & export → Discord JSON**.
3. Click **Choose Discord JSON** and select one or more `.json` files from your computer.
4. Review the import summary (channels, message count, date range, any skipped messages).
5. Click **Import into vault**.

Everything is merged into your local history. Open any imported channel to start reading, or search from anywhere.

## What gets imported

- **Channels** → converted to Onyx targets (e.g., `#general`)
- **Messages** → full text, author display names, edit markers
- **Attachments** → URLs appended to message text (searchable, clickable)
- **Reactions** → emoji, user list, counts
- **Replies** → quoted context preserved
- **Guild name** → shown in the import summary for clarity

System events (channel pins, user joins, calls, thread notices) are **skipped by default** to keep your archive focused on actual conversation.

The full set above applies to **Route B** (DiscordChatExporter) exports. A **Route A** data package carries only four fields per message — id, timestamp, contents, and attachments (`src/lib/import/discordPackageImport.ts:17`) — so package imports bring in message text, timestamps, and attachment URLs, with your account name as the author; per-message reactions, reply quotes, and edit markers are not present in Discord's package to import.

## Limits

- **Per-channel cap**: Only the newest **400 messages** per channel are kept in the vault. Older messages are dropped if an import exceeds this limit. If you need older history, run multiple exports with date filters.
- **Device-local**: Imported history stays on this device. It's not synced to the server, not uploaded, and not visible to other Onyx clients.
- **Merge, not replace**: Existing local history is merged with imports. New messages don't overwrite old ones.

## Privacy

All import processing happens in your browser. Your Discord export — the DiscordChatExporter JSON files or the unzipped data-package folder — is never uploaded, never sent over the network, and never reaches any server. Onyx doesn't call Discord's API; it only reads the files you provide, on this device. Your history is yours, fully local, fully under your control.

## Other sources

The same on-device import model — no accounts, no network calls, full privacy — also covers:

- **Slack** — request your workspace export (Slack → Settings & administration → Workspace settings → Import/Export Data), unzip it, and choose the per-channel JSON files under **Import from Slack**.
- **Classic client logs** — plain-text weechat, irssi, or mIRC logs. Under **Import a classic client log**, name the room the log belongs to, then choose the file.
