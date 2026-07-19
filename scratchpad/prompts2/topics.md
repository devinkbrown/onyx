**Feature: client-side named-conversation (topic) model (roadmap v1.1 Sumi-e — named conversations, the marquee feature).**

Onyx Server's server now carries topics on the wire. Build the pure CLIENT model that reads that wire format. Pure logic only — no store, no components, no wiring.

### The wire format (from the Onyx Server server, authoritative)
- **Message tag** `onyx/topic=<label>` — an IRCv3 client-only message tag on a channel PRIVMSG/NOTICE naming the conversation it belongs to. In a parsed message the tag key is `onyx/topic` (no `+`). Label rules: 1–50 bytes, no control chars / CR / LF / DEL, and **no comma**.
- **Channel PROP** `onyx_server.topics` — a comma-delimited registry of a channel's known topic labels (≤64 labels, ≤400 bytes total). Auto-grows as topics are used.

### Files to create
1. `src/lib/topics/topics.ts`
2. `src/lib/topics/topics.test.ts`

### `topics.ts`
Export:
- `const TOPIC_TAG = 'onyx/topic'` and `const TOPIC_PROP = 'onyx_server.topics'`.
- `const MAX_TOPIC_LABEL_BYTES = 50`, `const MAX_TOPIC_REGISTRY = 64`.
- `function isValidTopicLabel(label: string): boolean` — 1–50 bytes (use a UTF-8 byte length, not `.length`), no control chars (`\x00-\x1f`, `\x7f`), no comma.
- `function parseMessageTopic(tags: Readonly<Record<string, string | undefined>>): string | null` — read `tags[TOPIC_TAG]`, trim, return it only if `isValidTopicLabel`, else null.
- `function parseTopicRegistry(propValue: string | null | undefined): string[]` — split on comma, trim each, drop empties/invalid, dedup (case-insensitive, preserve first-seen casing), cap to `MAX_TOPIC_REGISTRY`.
- `function topicMessageTag(label: string): Record<string, string> | null` — for sending: `{ [TOPIC_TAG]: label }` if valid, else null.
- `function bucketUnreadByTopic(messages: readonly { topic: string | null; unread: boolean }[]): Map<string, number>` — count unread messages per topic label; messages with `topic: null` bucket under the empty string `''` ("no topic"). Return a Map.

Explicit return types; pure; never mutate inputs. UTF-8 byte length: `new TextEncoder().encode(s).length`.

### `topics.test.ts`
Cover: `isValidTopicLabel` boundaries (50-byte multi-byte edge, comma rejected, control rejected, empty rejected); `parseMessageTopic` returns null for missing/invalid tag; `parseTopicRegistry` split/trim/dedup(case-insensitive)/cap/invalid-drop; `topicMessageTag` valid + null; `bucketUnreadByTopic` counts + the `''` no-topic bucket.
