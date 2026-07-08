**Feature: keyboard shortcut registry + matcher (roadmap v1.0/1.1 — keyboard spine).**

A pure, data-driven registry of app keyboard shortcuts and a matcher that turns a `KeyboardEvent` into a shortcut id. Pure logic only — no store, no components, no DOM listeners, no wiring. This complements the already-merged `ShortcutsSheet` display component (do NOT import or modify it).

### Files to create
1. `src/lib/keyboard/shortcutsRegistry.ts`
2. `src/lib/keyboard/shortcutsRegistry.test.ts`

### `shortcutsRegistry.ts`
Export:
- `interface Chord { key: string; mod?: boolean; shift?: boolean; alt?: boolean }` — `key` is the `KeyboardEvent.key` value (e.g. `'k'`, `'/'`, `'?'`, `'Escape'`); `mod` means Ctrl on Windows/Linux OR ⌘ (Meta) on macOS.
- `interface Shortcut { id: string; chord: Chord; label: string; group: string }`.
- `const SHORTCUTS: readonly Shortcut[]` — a realistic set: command palette (`{key:'k', mod:true}`), focus composer (`{key:'/'}`), close/escape (`{key:'Escape'}`), keyboard-help (`{key:'?'}` — note `?` usually needs shift; set `shift:true` and `key:'?'`), go home, next/prev channel, toggle reader mode, open preferences. Give each a stable `id`, `label`, and `group` ("Navigation" | "Composing" | "Reading" | "Appearance").
- `function matchShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, registry?: readonly Shortcut[]): Shortcut | null` — return the first shortcut whose chord matches: `key` compared case-insensitively; `mod` satisfied by `ctrlKey || metaKey`; when a chord omits `mod`/`shift`/`alt`, that modifier must be ABSENT (a plain `/` must not fire when Ctrl is held). Default registry = `SHORTCUTS`.
- `function isTypingTarget(target: EventTarget | null): boolean` — true when the event target is an `<input>`, `<textarea>`, or `contenteditable` element (so callers can ignore shortcuts while typing). Guard non-Element targets.

Explicit return types; pure; no side effects.

### `shortcutsRegistry.test.ts`
Cover: `matchShortcut` fires ⌘/Ctrl+K via BOTH ctrlKey and metaKey; a plain `/` matches only with no modifiers and NOT when ctrl held; `?` requires shift; unknown key → null; `isTypingTarget` true for input/textarea/contenteditable and false for a div/null. Construct plain event-like objects (no real DOM needed) for `matchShortcut`; for `isTypingTarget` you may build minimal fake elements with `tagName`/`isContentEditable`.
