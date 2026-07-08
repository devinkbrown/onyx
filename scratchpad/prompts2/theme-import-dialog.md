**Feature: theme import/share dialog (roadmap v1.2 Washi — "theme sharing/import").**

A self-contained dialog to import a shared theme code and to copy a share link — built on the ALREADY-MERGED pure layer `src/lib/theme/themeShare.ts`. Presentational + local state only; no store, no app wiring (a later pass mounts it).

### Files to create
1. `src/shell/ThemeImportDialog.tsx`
2. `src/shell/ThemeImportDialog.css`

### First, READ (do not modify):
- `src/lib/theme/themeShare.ts` — use its exports: `encodeTheme`, `decodeTheme`, `themeShareUrl`, `parseThemeParam` and the `CustomTheme` type (from `@/theme`). Learn the exact signatures.
- `src/shell/PreferencesPanel.tsx` — for how the `Sheet` primitive is imported/used, and house form styling.

### `ThemeImportDialog.tsx` (never destructure props)
- `export function ThemeImportDialog(props: { open: boolean; onClose: () => void; onImport: (theme: CustomTheme) => void; shareTheme?: CustomTheme }): JSX.Element`.
- Renders a `Sheet` (title "Share & import a theme", `onOpenChange={(n)=>{ if(!n) props.onClose() }}`, `closeLabel="Close"`).
- **Import** section: a `<textarea>` where the user pastes a share code (or full `?theme=…` URL). A createSignal holds the input; a createMemo runs `parseThemeParam(extractCode(input))` (accept either a raw code or a URL containing `?theme=`). Show a live validity state: valid → the theme's name + an "Import theme" button that calls `props.onImport(theme)` then `props.onClose()`; invalid non-empty → a small error line ("That doesn't look like a valid theme code."). Never throw on bad input.
- **Share** section (only `<Show when={props.shareTheme}>`): shows the `themeShareUrl(props.shareTheme, location.origin)` in a read-only field + a "Copy link" button using `navigator.clipboard.writeText` (guard its absence; show "Copied" feedback via a signal, reset after a moment using an event, not a magic global). Guard `typeof navigator`/`location` for SSR.
- `import './ThemeImportDialog.css'`.

### `ThemeImportDialog.css`
Token-styled form: textarea/input with `--surface` ground, `--line` border, `:focus-visible` 2px `--lapis-bright`; primary button in `--lapis-bright`; the error line in `--shu-bright`; a valid-preview row. Clean rhythm, designed states.

No test needed (presentational, wraps a tested pure layer). Run tsc + eslint on the `.tsx`.
