**Feature: quiet-boost bar (roadmap v1.1 Sumi-e — quiet Boosts, reactions that notify no one).**

A presentational row of boost pills that renders the ALREADY-MERGED `quietBoosts.ts` model. Prop-driven; no store, no wiring.

### Files to create
1. `src/shell/BoostBar.tsx`
2. `src/shell/BoostBar.css`

### First, READ (do not modify):
- `src/lib/reactions/quietBoosts.ts` — import the `BoostGroup` type (fields `emoji`, `count`, `reactors`, `youBoosted`). You render pre-aggregated groups; you do NOT aggregate here.

### `BoostBar.tsx` (never destructure props)
- `export function BoostBar(props: { boosts: readonly BoostGroup[]; onBoost?: (emoji: string) => void; onAdd?: () => void }): JSX.Element`.
- `<Show when={props.boosts.length > 0 || props.onAdd}>` a horizontal wrapping row (`For` over `props.boosts`): each group a pill showing `emoji` + `count`, `aria-pressed={group.youBoosted}`, `title` listing reactors (first few + "+N"), calling `props.onBoost?.(group.emoji)` on click; the `.you` class when `group.youBoosted`. Optional trailing "＋" add-boost button when `props.onAdd` is set (`aria-label="Add a boost"`).
- Boosts are calm by design — no notification affordance, no animation storm. Keep it quiet.
- `import './BoostBar.css'`.

### `BoostBar.css`
Token-styled pills (`--stone`/`--ink` ground, `--line` border, `--r-pill`, tabular-nums count); resting / `:hover` / `:focus-visible` (2px `--lapis-bright`) / `.you` (accent-tinted ground, `--lapis-bright` border) states. A subtle hover lift is fine; nothing loud. `@media (prefers-reduced-motion: reduce)` drops transitions/transforms.

No test needed (presentational, wraps a tested model). Run tsc + eslint on the `.tsx`.
