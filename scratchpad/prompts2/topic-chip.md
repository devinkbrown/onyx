**Feature: topic chip + topic filter bar (roadmap v1.1 Sumi-e — named conversations UI).**

Two small, presentational, prop-driven SolidJS pieces for named conversations: a chip that labels a message's topic, and a horizontal filter bar of a channel's topics. Self-contained and prop-driven — do NOT import any store or the topic model; everything comes through props. Unwired (a later pass mounts them).

### Files to create
1. `src/shell/TopicChip.tsx`
2. `src/shell/TopicChip.css`

### `TopicChip.tsx` (never destructure props)
Export two components + their prop types:
- `export function TopicChip(props: { label: string; active?: boolean; onClick?: (label: string) => void }): JSX.Element` — a small pill showing `#`-style topic label; when `onClick` is given it's a `<button>` (role stays button, `aria-pressed={props.active}`), otherwise a non-interactive `<span>`. Applies an `is-active` class when `props.active`.
- `export function TopicFilterBar(props: { topics: readonly string[]; active: string | null; onSelect: (label: string | null) => void }): JSX.Element` — a horizontal, wrapping row: a leading "All" chip (selected when `props.active === null`, calls `onSelect(null)`) followed by a `For` over `props.topics` rendering `TopicChip` with `active={props.active === topic}` and `onClick={() => props.onSelect(topic)}`. `role="tablist"`, each chip `role="tab"` conceptually — keep ARIA correct and simple.
- `import './TopicChip.css'`.

### `TopicChip.css`
Design-token styling (mono label, `--stone`/`--ink` ground, `--line` border, `--r-pill`). Resting, `:hover`, `:focus-visible` (2px `--lapis-bright`), and `.is-active` (accent `--lapis-bright` ground, `--ink` text) states — states that feel designed, not default. The filter bar scrolls horizontally on overflow (`overflow-x:auto`, no wrap) OR wraps — pick wrap for calmness; keep it from ever overflowing the page. `@media (prefers-reduced-motion: reduce)` drops transitions.

No test needed (presentational). Run tsc + eslint on the `.tsx`.
