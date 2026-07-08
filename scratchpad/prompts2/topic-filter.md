**Feature: filter a message list by topic (roadmap v1.1 Sumi-e — topic-aware views / forum view).**

Pure helpers to slice a channel's messages by named-conversation topic. Pure logic only — no store, no components, no wiring. Do NOT import the topic model module; define your own minimal message shape.

### Files to create
1. `src/lib/search/topicFilter.ts`
2. `src/lib/search/topicFilter.test.ts`

### `topicFilter.ts`
Export:
- `interface TopicMessage { id: string; topic: string | null; at: Date }` (a minimal structural shape; real messages are assignable to it).
- `function filterByTopic<T extends TopicMessage>(messages: readonly T[], topic: string | null): T[]` — when `topic` is `null`, return all (copy); otherwise return only messages whose `topic` matches case-insensitively. Never mutate input.
- `function listTopics<T extends TopicMessage>(messages: readonly T[]): string[]` — distinct non-null topic labels, case-insensitive-deduped (preserve first-seen casing), sorted by most-recent activity (a topic's newest `at`) descending, ties broken alphabetically.
- `interface TopicSummary { topic: string; count: number; lastAt: Date }`.
- `function summarizeTopics<T extends TopicMessage>(messages: readonly T[]): TopicSummary[]` — per distinct topic: `count` and `lastAt` (max `at`); sorted by `lastAt` desc then topic asc. Excludes the null/no-topic messages.

Explicit return types; generic-preserving (`filterByTopic` returns `T[]`); pure.

### `topicFilter.test.ts`
Cover: `filterByTopic` null → all (and is a copy, not the same ref); case-insensitive match; `listTopics` dedup + recency ordering + tie-break; `summarizeTopics` counts + lastAt + ordering + exclusion of null-topic messages.
