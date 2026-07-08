**Feature: "Since you left" digest card (roadmap v1.1 Sumi-e — the rendered since-you-left digest).**

A presentational card that renders the ALREADY-MERGED `SinceDigest` model from `src/lib/notifications/sinceDigest.ts`. Prop-driven; no store, no wiring (a later pass feeds it real data).

### Files to create
1. `src/shell/SinceDigestCard.tsx`
2. `src/shell/SinceDigestCard.css`

### First, READ (do not modify):
- `src/lib/notifications/sinceDigest.ts` — import the `SinceDigest` / `ChannelDigest` types and the `digestHeadline` helper. Use the exact field names (`since`, `totalMessages`, `totalMentions`, `activeChannels`, `channels[]` with `channel`, `count`, `mentions`, `participants`, `firstAt`, `lastAt`).
- `src/shell/HomeView.tsx` (or a sibling card) for house card style + how CSS is imported.

### `SinceDigestCard.tsx` (never destructure props)
- `export function SinceDigestCard(props: { digest: SinceDigest; onOpenChannel?: (channel: string) => void }): JSX.Element`.
- Header: `digestHeadline(props.digest)` as the title + a quiet "since <relative/date of props.digest.since>" subline (format inline with `toLocaleString` — do not add a date dependency).
- `<Show when={props.digest.totalMessages > 0} fallback={…"All caught up" empty state…}>`: a list (`For` over `props.digest.channels`) of rows: channel name, message `count`, a `mentions` badge when `> 0`, and up to ~3 `participants` (with "+N" overflow). A row is a `<button>` calling `props.onOpenChannel?.(channel)` when the callback is present, else a static row.
- Mentions badge uses a distinct accent so it reads at a glance. `import './SinceDigestCard.css'`.

### `SinceDigestCard.css`
Token-styled card (`--surface` ground, `--line` border, `--r-md`), clear hierarchy (headline larger, rows quieter), a mentions badge in `--shu`/`--shu-bright`, hover/focus-visible states on the interactive rows, tabular-nums for counts. Designed empty state.

No test needed (presentational, wraps a tested model). Run tsc + eslint on the `.tsx`.
