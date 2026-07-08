**Feature: reactive accessibility media-preference signals (roadmap v1.2 Washi — a11y).**

Expose the OS accessibility signals as reactive SolidJS accessors so components can adapt in JS (complements the CSS-only `a11y-media.css`). Small reactive module + test. No store, no components, no wiring.

### Files to create
1. `src/lib/a11y/mediaPrefs.ts`
2. `src/lib/a11y/mediaPrefs.test.ts`

### `mediaPrefs.ts`
Using `window.matchMedia` + `createSignal`, expose live accessors that update when the OS preference changes (attach a `change` listener on each MediaQueryList). Be SSR/JSDOM-safe: guard `typeof window === 'undefined'` and a missing/legacy `matchMedia` (no `addEventListener`), returning a static default in that case. Export:
- `const prefersReducedMotion: Accessor<boolean>` — `(prefers-reduced-motion: reduce)`.
- `const prefersMoreContrast: Accessor<boolean>` — `(prefers-contrast: more)`.
- `const prefersReducedTransparency: Accessor<boolean>` — `(prefers-reduced-transparency: reduce)`.
- `const forcedColors: Accessor<boolean>` — `(forced-colors: active)`.
- `function makeMediaSignal(query: string): Accessor<boolean>` — the reusable factory the above are built on (exported for reuse/testing). It must: return `false` when `matchMedia` is unavailable; initialize from `mql.matches`; subscribe via `addEventListener('change', …)` when available, else `addListener` fallback; never throw.

Explicit return types. Do NOT leak: it's fine for module-level signals to live for the app's lifetime, but `makeMediaSignal` used ad hoc should register its listener idempotently.

### `mediaPrefs.test.ts`
Stub `window.matchMedia` (a fake `MediaQueryList` with `matches`, `addEventListener`/`removeEventListener` capturing the handler). Cover: initial value reflects `matches`; firing a `change` event flips the accessor; a missing `matchMedia` yields `false` and does not throw; the `addListener` legacy fallback path. Restore `window.matchMedia` in `afterEach`.
