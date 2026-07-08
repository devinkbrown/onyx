**Feature: relative / duration time formatting (roadmap v1.1 — used by digests, scrubber, "since you left").**

A small, dependency-free, deterministic time-formatting utility. Pure logic only — no store, no components, no wiring.

### Files to create
1. `src/lib/time/relativeTime.ts`
2. `src/lib/time/relativeTime.test.ts`

### `relativeTime.ts`
All functions take an explicit `now` (or two Dates) so they are deterministic and testable — never call `Date.now()` internally except as a default parameter. Export:
- `function relativeTime(then: Date, now?: Date): string` — compact past/future relative label: `"just now"` (<45s), `"3m ago"`, `"2h ago"`, `"yesterday"`, `"4d ago"`, `"3w ago"`, `"5mo ago"`, `"2y ago"`; symmetric future forms (`"in 3m"`, `"tomorrow"`, `"in 2h"`). Choose the single largest fitting unit.
- `function shortDuration(ms: number): string` — a compact duration like `"0s"`, `"45s"`, `"3m"`, `"1h 20m"`, `"2d 4h"` (at most two units, largest first; negative clamps to `"0s"`).
- `function calendarDay(then: Date, now?: Date): string` — `"Today"`, `"Yesterday"`, else a localized short date (`toLocaleDateString(undefined, { month: 'short', day: 'numeric' })`, adding the year only when `then`'s year differs from `now`'s).

Explicit return types; pure. Pluralization must be correct where you spell words out; the compact `3m`/`2h` forms need no plural.

### `relativeTime.test.ts`
Pass a FIXED `now` in every test (e.g. `new Date('2026-07-08T12:00:00Z')`) so results are deterministic. Cover: each `relativeTime` bucket boundary (just-now, minutes, hours, yesterday, days, weeks, months, years) for past AND a couple of future cases; `shortDuration` for 0, sub-minute, single-unit, two-unit, and negative; `calendarDay` Today / Yesterday / same-year / cross-year.
