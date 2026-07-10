# Importing from Discord

Onyx lets you import your own Discord server history directly into your device's local vault. No Discord API token needed, no server upload—everything runs on your device.

## How it works

Onyx imports Discord channel exports created by **DiscordChatExporter** (a popular, open-source tool). The import is purely on-device: your history never touches Discord's servers again, nothing is uploaded anywhere, and everything becomes instantly searchable, time-travellable scrollback in your vault.

## Export from Discord

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

## Import into Onyx

1. Open Onyx preferences (settings icon, bottom right).
2. Scroll to **Import from Discord** under "Local history & portability".
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

## Limits

- **Per-channel cap**: Only the newest **400 messages** per channel are kept in the vault. Older messages are dropped if an import exceeds this limit. If you need older history, run multiple exports with date filters.
- **Device-local**: Imported history stays on this device. It's not synced to the server, not uploaded, and not visible to other Onyx clients.
- **Merge, not replace**: Existing local history is merged with imports. New messages don't overwrite old ones.

## Privacy

All import processing happens in your browser. Your Discord export file is never uploaded, never sent over the network, and never reaches any server. Onyx doesn't call Discord's API; it only reads the JSON file you provide. Your history is yours, fully local, fully under your control.

## Coming soon

Slack workspace exports and IRC server logs will use the same on-device import model—no accounts, no network calls, full privacy.
