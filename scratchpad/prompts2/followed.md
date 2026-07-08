**Feature: followed conversations model (roadmap v1.1 Sumi-e — calm notifications need a "followed" set).**

Calm mode notifies about *followed* conversations. Build the pure model + persistence for the set of conversations (channels / DMs / topics) a user follows. Pure logic + localStorage — no store, no components, no wiring. Mirror the localStorage+signal pattern in `src/lib/prefs/preferences.ts` (read it first).

### Files to create
1. `src/lib/notifications/followed.ts`
2. `src/lib/notifications/followed.test.ts`

### `followed.ts`
A followed conversation is identified by a normalized key (lowercased target, e.g. `#general`, `@nick`, or `#general/topic-label`). Export:
- `function followKey(target: string, topic?: string | null): string` — normalize: trim, lowercase; if `topic` is a non-empty string append `/` + lowercased trimmed topic. Return the key.
- localStorage-backed reactive set, key `'onyx:followed'` (JSON array of keys):
  - `loadFollowed(): Set<string>` (guard `typeof window/localStorage`; ignore malformed → empty set).
  - `isFollowed(target: string, topic?: string | null): boolean`.
  - `follow(target: string, topic?: string | null): void` and `unfollow(target: string, topic?: string | null): void` — immutable update of the backing signal + persist.
  - `toggleFollow(target: string, topic?: string | null): boolean` — flip; return the new followed state.
  - a `followed` accessor (module-level `createSignal<ReadonlySet<string>>`) so UI can react.
- Persist as a sorted JSON array for stable storage.

Explicit return types; never mutate a Set in place that's already in the signal (create a new Set).

### `followed.test.ts`
Cover: `followKey` normalization (case, trim, topic suffix, empty topic ignored); follow → isFollowed true; unfollow → false; toggle returns new state and flips; persistence roundtrip through localStorage; malformed stored JSON → empty set. `beforeEach(() => localStorage.clear())`.
