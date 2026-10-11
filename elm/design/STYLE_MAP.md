# Onyx Elm client — style map

A complete map of the Elm client's visual system as of `7e03d47f` (branch `v3/map-styles`): every stylesheet, token, component pattern, override, dead rule, z-index, breakpoint, motion rule and accent use, plus a plan for consolidating them.

**How it was produced**

- **Static (S):** `node elm/tools/style-map.mjs` parses the CSS. It is dependency-free and runs in about 1.5 s. It reads:
  - `app.css` and every file in `css/`, in `index.html` link order;
  - every string literal in `src/**/*.elm` (comments skipped): classes, `data-*` attributes, inline `style` calls;
  - `ports.js` and `media/*.ts`: runtime custom properties and `<html>` data attributes;
  - the 18 theme maps in `src/ThemeTokens.elm`.

  It writes two outputs:
  - `elm/design/style-map.json` — machine-readable, every location as `file:line`;
  - the **Generated inventory** (sections G0–G17 at the end of this file).

  Every number in the analysis below comes from those outputs.
- **Chromium (C):** confirmed in real Chromium (`elm/tools/screens.mjs`), with the current `dist-elm` build, a fake IRC server, and an extra scenario file that reads computed styles. Scenarios run:
  - Ocean, Pearl and Garnet themes;
  - the preferences `fontScale=lg`, `width=full`, `readerMode`, `highContrast`;
  - keyboard focus;
  - widths of 700, 767 and 768 px;
  - the landing page;
  - the command palette, the You hub and the Preferences sheet.

  A Chromium check is marked **(C)** below.

**Regenerating.** Run `node elm/tools/style-map.mjs` from the repo root. It rewrites `design/style-map.json` and only the part of this file between the `BEGIN/END GENERATED` markers. The analysis above the markers is hand-written and is kept.

Locations are written `file:line`. `css/` is dropped from file names; `app.css` is the root sheet.

---

## 0. The 25 most important findings

Ranked by user-visible impact, then by how much each one blocks consolidation.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Themes never reach the shell. The app has two colour systems that are not connected.** `appearanceApply` writes the 31 Solid palette tokens inline on `<html>` (`ports.js:6066-6090`). Those are `--ink`, `--stone*`, `--lapis*`, `--gold*`, `--shu*`, `--paper*`, `--line`, `--r-*`, `--dur` and `--ease`. The shell paints with 11 `--onyx-*` colours, defined once at `app.css:4-15`, and no theme writes them. Result: the 18 themes and Theme Studio colour editing barely change the app. | (C) Ocean vs Pearl vs Garnet: `body`, `.onyx-rail`, `.onyx-composer` and `.onyx-room-header` compute to identical colours (`#0b0e12` / `#e8e6e1`). Only the theme-token consumers change: the owner avatar ring (`--gold`), the mention tint (`--gold`), the provenance badge (`--lapis`) and the Studio preview. Screenshots `sm-ocean` / `sm-pearl` are near-identical. |
| 2 | **Light themes switch `color-scheme` to light on a still-dark shell.** `index.html:6` declares `color-scheme: dark`. Pearl and Frost then set `color-scheme: light` on `<html>`. Native controls and scrollbars follow the light scheme, and Pearl's `--gold` `#896100` is painted on the `#0b0e12` ground for the mention tint and owner ring, which is low contrast. | (C) `getComputedStyle(html).colorScheme === "light"` while `body` stays `rgb(11,14,18)`. |
| 3 | **The root font size is 15px, so every rem token renders at 93.75%.** `html, body { font: var(--text-md)/… }` (`app.css:209-217`) sets the *root* to `0.9375rem` = 15px. So `1rem` is 15px. Body text is 14.06px (designed: 15), `--text-sm` 12.19 (13), `--text-xs` 10.31 (11), `--space-4` 15px (16). Raw px values do not scale — the 256 off-ladder font sizes and the 1,612 on-scale raw spacing values among them — so near-duplicates appear side by side: 12px next to 12.19px, 11px next to 11.25px. | (C) body `14.0625px`; rail name `12.1875px`; nav label `10.3125px`; a minimal repro gives `rem = 15px`. |
| 4 | **Five appearance preferences change nothing on screen.** `ports.js:6051-6059` writes `data-font-scale`, `data-width`, `data-reader`, `data-experience-mode`, `data-density` and `data-hide-events` on `<html>`, and `ports.js:6061` writes `data-theme`. No selector reads `font-scale`, `width`, `reader`, `experience-mode` or `theme`. Density works only through the transcript's own attribute (`Thread.elm:200`); hide-events and experience-mode work in Elm. | (C) With `fontScale=lg`, `width=full` and `readerMode=true`, body font size and layout are unchanged. `grep` finds no CSS for those attributes. |
| 5 | **Most Theme Studio controls have nothing to drive.** Several Studio-editable tokens have zero CSS readers: `--r-0`, `--r-sm`, `--r-md` (the radius sliders); `--dur` (the duration slider); `--font-display`, `--font-sans`, `--font-serif`; `--ink-2`, `--gold-deep`, `--stone-line`; and the theme-only `--brand-action`, `--warn`, `--danger`, `--line-faint`. The shell's radius is `--radius: 6px` and its motion is `--dur-micro/fast/base`. | (S) G2 status `theme-only, unused` ×10 and `theme-overridden, unused` (`--dur`); Studio list in G2. |
| 6 | **Account2 controls have no visible keyboard focus.** `box-shadow: var(--focus-ring)`, where `--focus-ring` is `1px solid …` (an outline value, invalid as a box-shadow), combined with `outline: none`, leaves no indicator at all. Affected: `.a2-input`, `.a2-select`, `.a2-textarea`, `.a2-btn`, `.a2-link`, `.a2-reclaim__signin` and `.a2-reclaim__dismiss` (`account2.css:37,57,120`). This fails WCAG 2.4.7. | (C) Computed `box-shadow: none`, `outline-style: none` on focus. |
| 7 | **The focus ring comes in six forms.** The design calls for an inset 1px hairline (`--focus-ring` + `--focus-offset: -1px`, 16 uses). 14 rules hard-code `2px solid var(--onyx-accent)` with offsets of 2, 1, −1 or −2. One rule uses `1px solid` at offset 2. High-contrast mode switches to `3px solid var(--lapis-bright)` (`app.css:3148`), the theme *blue*, instead of the green accent. | (C) Nav button: `2px` at +1. `.onyx-call-join`: `1px` at +2. High-contrast: `3px rgb(101,173,245)`. |
| 8 | **Load order is accidental.** There are 17 stylesheets and 3 of them say they load last: `ui-sheets.css:2` ("Loaded LAST so it wins…"), `pol-ios.css:3` and `calls-engine.css:2`. `ui-sheets.css` is in fact 15th. The calls files are scattered: c8 and c11 load before `polish.css`, c6 and c4 load after `roomsettings.css`. | (S) G1. |
| 9 | **`app.css` is a v1 layer that later files paint over.** <ul><li>360 classes are painted from two or more files.</li><li>133 selectors are re-declared verbatim in another file, with 157 conflicting property values.</li><li>340 declarations lose to a later identical selector; 286 of them are in `app.css`.</li><li>54 rules (134 declarations) are entirely overridden — for example, the whole `app.css` landing block at 905-1064 was re-cut in `pol-public.css`.</li></ul> | (S) G13, G14. |
| 10 | **Overrides are done by raising specificity.** There are 538 cross-file property fights over 235 classes. In 364 of them a later file wins only by raising specificity: `.onyx-frame .x` 52× in `pol-shell.css` and 14× in `pol-thread.css`, and `.ui-root.r:is(…)` roots in `pol-stats.css`. 40 fights would flip winner if the files were simply wrapped in `@layer` in link order, so cascade layers are not a free fix. | (S) G14.1 (`escalates`, `layerFlip`). |
| 11 | **Dead CSS: 64 fully dead rules (221 declarations), 7 rules with dead selector members, 49 classes never emitted.** Most are the per-sheet head, title and close classes left behind when `View.Sheet` took over headers: `onyx-prefs-*`, `onyx-profile-*`, `onyx-account-head/title/close`, `onyx-steward-*`, `onyx-scheduled-*`, `notify-*`, `chb-head/title/close`, `onyx-newmsg-*`, `onyx-shortcuts-header/close`, `notif-center__head/__close`. The rest: `onyx-calls-toggle*`, `onyx-member-nick/avatar/profile/prefix/row-actions`, `onyx-rail-count`, `onyx-leave`, `onyx-schedule-open`, `invite-preview-title`. | (S) G16, cross-checked by grep. `tools/css-coverage.mjs` agrees: 0 unstyled classes. |
| 12 | **Two sheet systems stacked on each other.** `.onyx-sheet*` is defined at `app.css:3724-3912` (keyframes `onyx-sheet-in`/`-side-in`, phone radius `var(--radius)`, layer padding `--space-4`). It is defined again in `ui-sheets.css` (`ui-sheet-pop/side/drop/rise/veil-in`, phone radius 12px, padding `--space-6`/`--space-4`). `calls-c6.css`, `calls-c11.css` and `pol-ios.css` patch it further. 40 selectors are duplicated between `app.css` and `ui-sheets.css`. 7 rules (`pol-shell.css:1293`, `pol-thread.css:363,827`, `pol-roster.css:353` and others) still animate with the old `onyx-sheet-in`. | (S) G13.2, G6. |
| 13 | **About 130 separate button implementations.** 43 button-named classes carry their own control styling and 76 more are per-instance classes that style a button by hand (`cursor:pointer` + border + padding). For example, one rule (`app.css:1431-1461`) lists 31 per-instance `.onyx-account-*` classes instead of using a shared button class. Base min-heights: 20, 24, 28, 30, 32, 36, 40, 44 and 48px, plus two target tokens. | (C) One desktop room screen renders 83 buttons in 16 distinct height/radius/size/weight/border combinations. `.onyx-row-action` and the facepile buttons render at the **UA default 13.333px** (no `font: inherit`). G17.1. |
| 14 | **Six parallel icon systems.** <ul><li>`.onyx-ci` / `--ci` (calls)</li><li>`.pt-ico` / `--pt-i-*` (thread, roster, polish)</li><li>`.onyx-shi` / `--shi` (shell)</li><li>`.onyx-nav-icon` / `--onyx-nav-glyph` (nav)</li><li>`.ui-icon` / `--onyx-i-*` (sheets)</li><li>`--pub-i-*` / `--claim-i` (public)</li></ul>Together they hold 104 SVG data URIs with three stroke widths (1.7, 1.75, 2) and at least four different close glyphs. | (S) mask inventory in §3.1. |
| 15 | **About 95 declarations break the accent budget.** Of 294 declarations painting with the accent or an alias: <ul><li>**within budget:** primary action 99, focus 41, current location 17, mention 14, theme preview 13, calls live-audio 7 (a documented exception), token aliases 3;</li><li>**outside:** selection / toggle state 47, unread / count / badge 20 (the design says unread is neutral), success / online status 10, links 6, other 12, data-viz fill 5.</li></ul> | (S) G7, every entry listed. |
| 16 | **The accent doubles as the success colour.** There is no `--onyx-ok`, so `.onyx-toast--success`, `.onyx-reconnect-online`, `.onyx-member-dot` (presence), `.onyx-account-passkey-ok` and `.onyx-conn-live` all paint `--onyx-accent`. Meanwhile the theme's `--ok` (#5bc78e Ocean, #15915c Pearl) is read only by the Studio preview (`Studio.elm:1001`, with a `#46c08a` fallback). | (S) G7 status category. |
| 17 | **Three accent hues on screen at once.** The shell accent is green `#46c08a`. The theme lapis (Ocean `#65adf5` blue) shows through `.shell-msg-mention`, `.provenance-badge` and the high-contrast focus ring. Every sender name gets a cyan-blue `hsl(186–231 …)` nick tint via an Elm inline style (`Thread.elm:506,811,851`). | (C) screenshots. G3.4. |
| 18 | **24 distinct width breakpoints; the one mobile/desktop seam is written four ways.** `max-width: 767.98px` ×22, `767px` ×7, `768px` ×11 (public pages, inclusive), `min-width: 768px` ×4. Also: 640/641 (prefs, calls), 600, 520, 480, 400, 360/359, 860, 880, 959.98, 1024, 1099.98/1100, and container queries at 760/1000. | (C) At exactly 768px the app shell is in desktop layout (rail visible) while the public site is in mobile layout (hamburger). G5. |
| 19 | **z-index: 22 raw values, no tokens, with collisions.** <ul><li>The toaster is z 60 at `app.css:1070` and z 90 at `ui-sheets.css:788`.</li><li>Sheet layer, overlays, profile popover and the phone call-more menu all share 60.</li><li>The spotlight and the call-ring dialog share 80.</li><li>The lightbox and the public skip link share 100.</li><li>The room-more scrim and menu step 40/41 → 58/59 (`pol-shell.css`) → 60/61 (`ui-sheets.css`).</li></ul> | (S) G4. |
| 20 | **Motion: the duration ladder is well adopted, but the vocabulary is duplicated.** The ladder has 80 token uses and only 6 raw durations. But there are 14 `@keyframes` for about 3 motions. There are 2 infinite loops in the shell (`onyx-call-breathe` `app.css:3270`; `pt-pulse` `pol-thread.css:1677`) against "no looping animation". There are 3 overlapping global reduced-motion mechanisms (`app.css:3135`, `3916`, `3933/3940`) plus 16 local blocks. Themes write `--dur` 180–260 ms, which nothing reads. Reduced-motion coverage itself is complete. | (S) G6. |
| 21 | **Typography: 50 font-size values, 7 weights, 23 line-heights, 149 size × line-height × weight combinations.** 256 font-size declarations are off the ladder, 187 of them in `app.css` (across all files: 12px ×65, 13px ×65, 16px ×16, 11px ×15, 18px ×14). 650 is the most-used weight (163 declarations), yet system fonts render 600/650/700 with only two faces. | (C) 29 distinct rendered text styles on one desktop room screen. G8, G3.5. |
| 22 | **Spacing: 129 distinct values; 649 uses off the 4px scale** (2px ×173, 6px ×128, 10px ×99, 14px ×23). 1,612 raw px values sit on the scale but bypass the tokens; 1,623 use tokens. The four composite tokens (`--gap-tight/row`, `--pad-control/panel-lg`) are unused. | (S) G9, G3.12. |
| 23 | **Radius drift.** `--radius` 6px (278 uses) sits beside raw 6px ×71, 4px ×23, 2px ×15, 10px ×11, 8px ×10, 999px ×14 (alongside `--r-pill` ×35), 12px sheet tops ×7, and `calc(var(--radius)*2)` and similar. | (S) G10, G3.8. |
| 24 | **Elevation versus design.** `--elev-0` and `--elev-1` are unused. 7 drop shadows are bespoke (prefs, call sheet, mod desk, spotlight, update strip, call more, Studio knob), against the rule that only sheets get one short cool shadow. 34 more `box-shadow`s are really 1–2px rings or selection bars and deserve a `--ring-*` recipe. | (S) G11, G3.9. |
| 25 | **Three token vocabularies plus per-file aliases.** <ul><li>Shell: `--onyx-*`.</li><li>Solid palette: `--ink`, `--stone`, `--lapis`, `--gold`, `--shu`, `--paper`. 17 of these also have `app.css :root` values (15 "onyx cut" values plus `--ease` / `--dur`). Most differ from the default Ocean theme, so their few consumers flash on first paint.</li><li>Per-file aliases: `--pg-*` (stats), `--pub-*` (public), `--pt-*` (thread), `--sheet-*` (sheets).</li></ul>In total, 160 custom properties are defined, 11 are never used and 10 are theme-only and never used. Colour literals are rare (43), but there are 89 ad-hoc `color-mix()` tints (65 distinct), and the app's only gradients come from an Elm inline style (`Avatar.elm:39-45`) despite "no gradients". | (S) G2, G3. |

**Consolidation headline (see §5):**

1. Make the active theme drive the shell through a single semantic token layer: `--onyx-*` derived from the palette and committed by the existing `appearanceApply`.
2. Fix the 16px root.
3. Delete the 64 dead and 54 shadowed rules.
4. Merge each `app.css` v1 block into its `pol-*` / `ui-sheets` successor.
5. Replace the ~130 buttons, 6 icon systems and 2 sheet systems with one primitive each, named after the Solid primitives (`.onyx-button`, `.onyx-icon-button`, `.onyx-field`, …).
6. Re-cut the 17 files into 11 role-ordered files under an explicit `@layer` order. This must come last, because 40 fights flip under layers.

---

## 1. Stylesheets — load order, size, ownership

`index.html:16-43` links 17 sheets, in this order. Every CSS file on disk is linked, and every link exists.

`elm/tools/build.sh` copies `app.css` and `css/*.css`, minifies them with esbuild, and content-hashes each one. It **requires** `app.css` to be referenced from `index.html` (`build.sh`: `for required in ["app.js","voice.js","ports.js","app.css"]`).

| # | file | KiB | lines | rules | decls | owns (views → class prefixes) | its own claim | reality |
|---|---|---|---|---|---|---|---|---|
| 1 | `app.css` | 153.0 | 3943 | 1229 | 4533 | Everything v1: `:root` tokens (4-118); avatars; topbar; connect gate; sidebar; thread/roster/composer v1; calls hub (792-904) + calls C1–C3 (3154-3411); landing v1 (905-1263); scheduled; room care; provenance; notify; nav; You hub; home; composer suggest; boost; jump-to-date; roster v3; DM safety; switcher; mod desk; transcript density; prefs; a11y pref switches (3133-3151); v3/frame block (3412-3912: frame grid, inbox, room header, sheet primitive v1 3720-3853, target floor 3825, mobile frame 3854-3912); reduced motion (3914-3942). Views: Account 82, Thread 76, Profile 51, DmSafety 50, Home 50, Prefs 37, CallStage 36, Composer 31 | "abyssal monochrome + single sea-glass accent… No gradients" | 286 declarations here lose to later files; 59 of the 64 dead rules live here |
| 2 | `pol-stats.css` | 46.1 | 1080 | 301 | 1059 | `/stats`, `/status`, `/roadmap` (Stats 91, Status 12, Roadmap 11) — `public-room`, `stats-*`, `data-*`, `status-*`, `channel-spark`; local tokens `--pg-*` | "accent marks one thing: the live/current answer" | uses `--pg-select` (accent 10%) for selection |
| 3 | `pol-studio.css` | 45.1 | 1785 | 287 | 1144 | `/appearance` + Theme Studio (Studio 126, Appearance 50) — `ap-*`, `ts-*`, `background-picker` | "Selection is neutral" | the only real consumer of theme tokens (the `.ts-pv-*` preview) |
| 4 | `pol-shell.css` | 62.8 | 1469 | 463 | 1383 | Shell polish: Rail 42, RoomHeader 35, Inbox 20, Account 18, Home 17, Nav 16, Topbar 16, Bans 10 — `onyx-rail`, `onyx-room`, `notif-center`, `onyx-nav`, `moderation-desk`; `.onyx-shi` icons | "One sea-glass accent" | 52 `.onyx-frame .x` specificity escalations |
| 5 | `pol-thread.css` | 76.3 | 1920 | 462 | 1713 | Thread 110, Composer 44, Search 41, Media 31, Pins 24 — `onyx-message`, `room-media`, `shell-msg`, `shell-composer`, `pins-item`; `.pt-ico` icons; `:root` defaults for `--nick-tint`, `--onyx-avatar-*`, `--pt-*` | "Tokens from app.css :root only" | 14 `.onyx-frame .x` escalations; `pt-pulse` infinite loop |
| 6 | `pol-roster.css` | 13.7 | 417 | 84 | 300 | Roster 28 — `onyx-mlist`, `onyx-roster`, `onyx-member` | in-flow rail ≥1100, popover sheet below | re-cuts the `app.css` roster v3 (2538-2588) |
| 7 | `pol-public.css` | 68.1 | 1681 | 555 | 1778 | About 54, Landing 47, Download 45, Guides 44, PublicFrame 30, Onyxos 27, Invite 23, Trust 6 — `onyx-land`, `public-frame`, `guides-*`, `public-info`; `--pub-*` tokens | "Breakpoint 768px" | the only file using inclusive `max-width: 768px` |
| 8 | `calls-c8.css` | 8.9 | 134 | 69 | 226 | CallOverlays 23, VoiceSettings 20 — `onyx-call-react*`, `onyx-vs-*` | "Tokens only from app.css :root" | loads before `polish.css` (non-semantic position) |
| 9 | `calls-c11.css` | 5.5 | 192 | 36 | 109 | StageMode 15 — `onyx-stage-*` | — | — |
| 10 | `polish.css` | 10.7 | 387 | 67 | 238 | Polish 34 — `time-scrubber`, `shell-composer-tool--more`, `a2hs-sheet`, `first-run`, `update-available`, `polish-primary/ghost` | — | its own button pair `polish-primary/ghost` |
| 11 | `account2.css` | 6.3 | 168 | 57 | 193 | Account2 41 — `a2-*` | — | invisible focus (finding 6) |
| 12 | `roomsettings.css` | 9.7 | 355 | 88 | 291 | RoomSettings 56, RoomHeader 6 — `rset-*`, room-header second row | — | its own button / input / select / toggle set |
| 13 | `calls-c6.css` | 8.3 | 275 | 62 | 188 | CallDock 29 — ring dialogs, mini view, reconnecting | — | `color: #fff` on danger |
| 14 | `calls-c4.css` | 11.3 | 165 | 96 | 231 | CallVideo 25 — tiles, grid, spotlight, camera/share | — | — |
| 15 | `ui-sheets.css` | 45.4 | 1101 | 267 | 829 | Every overlay: Switcher 18, Browser 14, Nav 13, Profile 13, Sheet 12, Inbox 10, Prefs 10 — `onyx-sheet*`, `onyx-spotlight`, `onyx-you`, `onyx-toast`; `--sheet-*`, `--onyx-i-*` icons | "Loaded LAST so it wins the cascade" | 15th of 17 |
| 16 | `pol-ios.css` | 5.0 | 132 | 18 | 30 | Device geometry: document feel, `.onyx-frame` height from `--vvh`, safe areas, keyboard-open, standalone | "Loaded last" | 16th of 17 |
| 17 | `calls-engine.css` | 5.8 | 124 | 42 | 119 | CallStage 12 — call bar container queries, phone call screen | "Loaded last" | actually last |

The per-file prefix and view counts are in G1. Every class and the file:line of each rule that paints it is in G14 and in `style-map.json` (`multiFileClasses`, `components`).

---

## 2. The token system

### 2.1 Four layers, of which only one follows the theme

| Layer | Defined at | Who writes it at runtime | Readers | Follows the theme? |
|---|---|---|---|---|
| **Shell colour** — `--onyx-bg/panel/panel-2/line/text/dim/faint/accent/accent-ink/warn/bad` | `app.css:5-15`. High-contrast override at `app.css:3143-3146` (only `--onyx-line/dim/faint`) | nobody | 2,523 reads (`--onyx-dim` 550, `--onyx-line` 498, `--onyx-text` 438, `--onyx-accent` 209…) | **No** |
| **Rhythm** — `--space-0..8`, `--gap-*`, `--pad-*`, `--text-2xs..2xl`, `--leading-*`, `--tracking-kicker`, `--target-min/floor`, `--focus-ring/offset`, `--dur-micro/fast/base`, `--ease`, `--radius`, `--elev-0..3`, frame geometry (`--shell-measure`, `--nav-rail-w`, `--sidebar-w`, `--context-w`, `--mobile-nav-h`, `--composer-h`), device (`--safe-*`, `--kb-inset`, `--vv-top`, `--vvh`) | `app.css:37-114` | `ports.js:9975-9981` (`--vvh`, `--kb-inset`, `--vv-top`); themes overwrite `--ease` (identical in all 18) and `--dur` (unused) | 3,172 reads | n/a (by design) |
| **Solid palette** — `--ink(-2)`, `--stone(-2/-3/-line)`, `--lapis(-bright/-deep)`, `--gold(-bright/-deep)`, `--brand-action`, `--shu(-bright)`, `--paper(-dim/-mute)`, `--ok`, `--warn`, `--danger`, `--seam(-faint)`, `--line(-faint)`, `--r-0/sm/md/pill`, `--ease`, `--dur` | 15 of the 31 are re-defined at `app.css:18-34` with "onyx cut" values (`--ease` / `--dur` at `app.css:76-81`). All 31 are committed inline by `appearanceApply` (`App.elm:1560-1582` → `ports.js:6066-6090`) from `ThemeTokens.tokensFor` or `Theme.elm:609-632` (custom themes) | every theme change | 78 colour reads, 49 of them in `pol-studio.css` (`.ts-pv-*` preview) and 4 in Elm inline styles, plus the Avatar gradients (`Avatar.elm:39-45`); `--ease` 73, `--r-pill` 35 | Yes — but almost nothing reads it |
| **Local aliases** — `--pg-*` (`pol-stats.css:15-25`), `--pub-*` (`pol-public.css:14-20`), `--pt-*` (`pol-thread.css:12-18` and icons), `--sheet-*` (`ui-sheets.css:14-40`, `:293`, `:1037`), `--onyx-i-*` (`ui-sheets.css:27-38`), `--ci`, `--shi`, `--claim-i`, `--tool-glyph`, `--onyx-nav-glyph` | per file | Elm inline: `--nick-tint`, `--onyx-avatar-bg/fg`, `--pip-ix/iy`, `--room-heat`, `--h`, `--heat` | per file | Only through `--onyx-*` |

The precedence chain for a palette token is:

1. `app.css :root` value (first paint only).
2. Inline `<html style>` from the theme commit, which beats any `:root` rule — including `@media (prefers-reduced-motion) :root { --dur:0ms }` (`app.css:3917-3922`). So the theme's `--dur` survives reduced motion. That is harmless only because `--dur` has no readers.
3. Studio session overrides, folded into the same commit.

Stale keys are removed on the next commit (`ports.js:6081-6088`).

### 2.2 What a theme change actually changes (C)

Computed values at 1440×900 in `#lounge`:

| | Ocean (dark) | Pearl (light) | Garnet `shu` (dark) |
|---|---|---|---|
| `color-scheme` | dark | **light** | dark |
| `--ink` / `--paper` | `#202429` / `#f5f7f8` | `#f5f0e5` / `#251e15` | `#080100` / `#ebdad5` |
| `body` bg / fg | `#0b0e12` / `#e8e6e1` | **same** | **same** |
| `.onyx-rail` bg, `.onyx-composer` bg, `.onyx-room-header` bg | `#12161c`, `#0b0e12`, `#0b0e12` | **same** | **same** |
| `.onyx-sender` colour | `hsl(…)` from `nickTint` | same | same |
| Visible difference | — | brown owner ring (`.onyx-avatar--owner`, `app.css:136`), brown mention tint (`pol-thread.css:169-176`) | red owner ring, red mention tint |

### 2.3 Tokens that are dead, theme-only or misused

- **Never read (11):**
  - `--elev-0`, `--elev-1`;
  - `--gap-tight`, `--gap-row`, `--pad-control`, `--pad-panel-lg`;
  - `--space-0`, `--sheet-top`;
  - `--onyx-i-check`, `--onyx-i-link`, `--onyx-i-mail`.
- **Theme-only and never read (10):**
  - `--brand-action`, `--danger`, `--warn`, `--gold-deep`, `--ink-2`, `--stone-line`, `--line-faint`;
  - `--r-0`, `--r-sm`, `--r-md`.
- **Theme-overridden and never read:** `--dur`.
- **Theme-only and read (4):**
  - `--ok` — only `Studio.elm:1001`, with fallback `#46c08a`, the *shell* accent;
  - `--paper-mute` — 9 reads in `pol-studio.css`, fallback `--onyx-faint`;
  - `--seam`, `--seam-faint` — Studio preview only.

  These four are undefined until the first `appearanceApply`.
- **Font tokens:**
  - `--font-mono` is the only font token (42 uses).
  - The Studio exposes `--font-display`, `--font-sans` and `--font-serif`, which no rule reads.
  - Body text uses a literal system stack (`app.css:215-216`).
- **Misuse:** `--focus-ring` is an *outline* shorthand that is used as a `box-shadow` (finding 6).
- **Bypasses:** these are rare for colour but pervasive for rhythm (counts in G3):

  | kind | off-token | total |
  |---|---|---|
  | colour literals in rules | 43 | — |
  | `color-mix()` tints | 89 | — |
  | font sizes | 256 | 978 |
  | line heights | 31 | 162 |
  | radii | 208 | 549 |
  | shadows | 47 | 71 |
  | spacing declarations | 814 | 2,551 |
  | raw dimensions | 1,012 | — |
  | font weights (no weight tokens exist) | 449 | — |
  | z-indexes (no tokens) | 52 | — |
  | breakpoints (CSS can't use vars in media queries) | 72 | — |

- **Elm inline styles that bypass every sheet (G3.4):**
  - Avatar gradients built from palette tokens (`Avatar.elm:39-45`, written via `--onyx-avatar-bg/fg` at `Avatar.elm:213-214`);
  - `nickTint` hsl colours (`Thread.elm:506,532,811,851,890`);
  - room colour labels (`Rail.elm:382`);
  - Studio swatches and preview colours (`Studio.elm:268,999-1001,1040,1075-1085,1140-1141`);
  - Appearance swatches (`Appearance.elm:333,432`);
  - `min-height: 44px` / `touch-action` duplicated from CSS (`Appearance.elm:327-328,488-489`; `Studio.elm:242,262-263`);
  - Stats bar heights (`--h`, `--heat`, `width`), Room-settings heat, Call-dock PiP position.
- **Static theme colour:** `index.html:5` hard-codes `<meta name="theme-color" content="#0b0e12">`, which is never updated per theme.

---

## 3. Component patterns

### 3.1 Inventory (variants, where defined, divergence)

The full class lists are in G17 and the base-property matrices in G17.1.

| Pattern | Implementations (base classes) | Defined in | Divergence |
|---|---|---|---|
| Button | 43 named + 76 per-instance button-like (`app.css:1431-1461` alone enumerates 31 `.onyx-account-*` button classes) | all 17 files | min-height 20/24/28/30/32/36/40/44/48 + `--target-floor`/`--target-min`; padding 15+ recipes; radius `6px`, `var(--radius)`, `4px`, `999px`; weight unset/600/650/700; primaries: `.conn-submit`, `.onyx-calls-primary`, `.onyx-newmsg-primary`, `.onyx-reclaim-submit`, `.onyx-steward-btn-primary`, `.rset-btn-primary`, `.polish-primary`, `.onyx-land-open`, `.public-frame__open`, `.a2-reclaim__signin`, `.r-btn.primary`, `.jump-to-date__jump`, `.guest-claim-chip__keep`, `.onyx-keychange-accept`, `.onyx-thread-reply`, `.onyx-composer-send--ready`; `.onyx-call-btn-primary` is **inverted text-on-bg, not accent**; danger: `.onyx-call-btn-danger` and `.onyx-cbtn-leave` use `#fff`, `.onyx-steward-btn-danger` is red text |
| Icon button | 10 named (+ 8 dead `*-close`) | `app.css`, `ui-sheets.css`, `pol-thread.css`, `pol-roster.css`, calls | sizes 28/32/36/44 / `var(--sheet-close)`; glyph as text ✕ (font-size 18 / `--text-lg`) vs mask (ui-sheets hides the glyph: `ui-sheets.css:243-252`) |
| Chip | 12 (`.ap-chip`, `.ap-theme-chip`, `.ts-theme-chip`, `.guest-claim-chip`, `.onyx-account-chip`, `.onyx-dmsafe-chip(-plain)`, `.onyx-sec-chip`, `.onyx-voice-chip(-status)`, `.topic-chip`, `.ts-theme-chip-del`) | `app.css`, `pol-shell.css`, `pol-studio.css`, `pol-thread.css`, `calls-engine.css` | radius pill vs 6px; height 28/30/44; selected state: accent border (`.topic-chip.is-active`), `.on` class (`.ap-chip.on`), `--on` modifier (`.ap-theme-chip--on`), `aria-pressed` |
| Pill / badge / count | `.boost-pill`, `.chb-pill`, `.shell-ribbon-badge`, `.onyx-nav-badge(--mention)`, `.onyx-rail-mention`, `.topic-chip__unread`, `.onyx-home-unread`, `.onyx-home-count`, `.chb-count`, `.notify-count`, `.onyx-call-badge`, `.ts-audit__badge--*`, `.provenance-badge` | `app.css`, `pol-shell.css`, `pol-thread.css`, `ui-sheets.css`, `pol-studio.css` | unread counts are accent in 4 places, neutral elsewhere; `.provenance-badge` paints theme `--lapis` |
| Input / textarea | 14 (`.a2-input/-textarea`, `.conn-input`, `.notify-input`, `.onyx-rail-filter-input`, `.onyx-roster-filter-input`, `.onyx-steward-field`, `.rset-input/-textarea`, `.shell-topic-create-input`, `.ts-save-input`, `.onyx-composer-field`, `.shell-emoji-search`, `.onyx-spotlight-input`) + the zero-specificity skin `:where(.onyx-sheet, .chb) :where(button:not([class]))` (`pol-shell.css:12-30`) | 8 files | background `--onyx-bg` vs `--onyx-panel-2`; min-height none / 24 / 32 / 36 / 48; font-size 12px / `--text-sm` / `--text-md` / `1rem`; focus 2px accent vs hairline vs **none** (a2) |
| Select | 3 (`.a2-select`, `.onyx-vs-select`, `.rset-select`) | `account2.css`, `calls-c8.css`, `roomsettings.css` | heights 24 / 40 / 36; bg panel-2 vs bg |
| Switch / toggle | `.pref-toggle` + `.pref-switch` (`app.css:3100-3107`), `.rset-toggle*` (`roomsettings.css`), `.ap-choice-toggle` (`pol-studio.css:283-323`), `.notify-toggle`, `.onyx-moddesk-toggle`, `.onyx-audience-toggle`, `.guides-step-toggle` | 5 files | three different switch drawings; "on" = accent knob (pref) vs `aria-pressed` accent border (notify) vs neutral (studio) |
| Segmented control | `.pref-segment`, `.room-notify-seg`, `.stats-window-options button`, `.chb-sort-btn`, `.moderation-cockpit__mode` | `app.css`, `pol-stats.css`, `pol-shell.css`, `ui-sheets.css` | selection = accent text + border (pref, room-notify) vs `--pg-select` accent wash (stats) vs neutral (`ui-sheets.css:738` chb-sort) |
| Tabs | `.pref-category-tab` (`[aria-selected]` → accent inset bar), `.onyx-land-tabs button`, `.onyxos-console__tabs button`, `.onyx-account-nav__item` | `app.css`, `pol-shell.css`, `pol-public.css`, `ui-sheets.css` | three different selected indicators |
| List row | `.onyx-rail-item`, `.onyx-mlist-main`, `.onyx-member`, `.onyx-spotlight-option`, `.notif-center__row/__open`, `.onyx-home-row`, `.chb-row`, `.pins-item`, `.onyx-you-link`, `.room-media-index-*` | everywhere | heights 26/36/38/40/44/52/57/58 (C); hover `--pt-hover` vs panel-2 |
| Card | `.shell-topic-card`, `.chb-card`, `.pref-action-card`, `.data-card`, `.guides-card`, `.dl-card`, `.roadmap-card`, `.onyx-member-card`, `.onyx-coach`, `.guest-claim-chip` | `app.css`, `pol-shell.css`, `pol-stats.css`, `pol-public.css`, `ui-sheets.css` | radius 6/8/10px; bg panel vs panel-2 vs none |
| Sheet / dialog / popover | `.onyx-sheet-layer/backdrop/sheet/head/title/close` (the primitive, `View/Sheet.elm`) + per-sheet panel classes (`.onyx-prefs`, `.onyx-account`, `.onyx-moddesk-sheet`, `.onyx-call-sheet`, `.onyx-call-ring`, `.a2-sheet`, `.onyx-newmsg-sheet`, `.jump-to-date-*`, `.onyx-thread-sheet`, `.onyx-spotlight`, `.onyx-profile-pop`, `.onyx-roster[popover]`, `.onyx-msg-menu-pop`, `.onyx-react-pop`, `.onyx-room-more-menu`, `.notif-center`) | `app.css` (v1), `ui-sheets.css` (v2), `calls-c6`, `calls-c11`, `pol-ios`, `pol-shell`, `pol-thread`, `pol-roster` | two keyframe families; z 40–100; shadows `--elev-3` vs 4 bespoke; phone radius `--radius` vs 12px |
| Menu / palette | `.onyx-msg-menu`, `.onyx-room-more-menu`, `.onyx-call-more`, `.onyx-call-react-menu`, `.shell-command-menu`, `.shell-emoji-picker`, `.onyx-spotlight-*`, `.shell-composer-tools` | `app.css`, `pol-thread.css`, `pol-shell.css`, `ui-sheets.css`, calls | 5 z-levels; phone becomes a sheet in 3 different files |
| Toast / banner | `.onyx-toaster/.onyx-toast(--success/--error…)`, `.update-available`, `.onyx-reconnect*`, `.a2-reclaim`, `.onyx-join-banner`, `.onyx-home-outbox-*` | `app.css`, `ui-sheets.css`, `polish.css`, `account2.css`, `calls-c1` (in `app.css`) | toaster z 60 → 90; success = accent |
| Avatar | `.onyx-avatar(--sm/--md/--owner/--service)` (Elm `Avatar.view`), `.onyx-face`, `.onyx-facepile-face`, `.onyx-rail-avatar`, `.onyx-call-avatar(-lg)`, `.onyx-land-sketch-avatar--*`, `.a2-person` | `app.css`, `pol-shell`, `pol-thread`, `pol-roster`, `account2`, calls, `pol-public` | gradient (inline, theme tokens) vs flat panel-2; sizes 2rem / 2.65rem / 30 / 40 / 56 / 72px; owner ring gold |
| Divider | `.onyx-day-divider(-label)`, `.onyx-unread-divider`, `--pt-seam` | `app.css`, `pol-thread.css` | fine |
| Empty state | `.onyx-home-empty`, `.onyx-account-empty`, `.chb-empty`, `.notif-center__empty`, `.pins-empty`, `.room-media-index-empty`, `.onyx-room-intro*` | 6 files | font sizes 12/13px vs `--text-sm` |
| Skeleton / loading | `.room-media-index-skeleton` (`pt-pulse`, infinite), `.onyx-pending-note`, `.shell-attachment-progress` | `pol-thread.css` | only one skeleton |
| Icons | `.onyx-ci` (`app.css:3159` + `calls-c4.css:9-17` + `calls-c6.css:12` + `calls-c8.css:9-10` + `roomsettings`/`pol-shell` uses), `.pt-ico` (`pol-thread.css`, 27 glyphs), `.onyx-shi` (`pol-shell.css:510-540`), `.onyx-nav-icon` (`app.css:2190-2202`), `.ui-icon` / `--onyx-i-*` (`ui-sheets.css:27-50`), `--pub-i-*` (`pol-public.css:17-20`) | 7 files | stroke-width 1.7 ×5 / 1.75 ×78 / 2 ×17 |

### 3.2 Duplicates, conflicts and cascade overrides

Summary:

- **Verbatim re-declarations.** 278 selectors are declared more than once in the same context; 133 of them across files. File pairs:
  - `app.css` + `ui-sheets.css`: 40
  - `app.css` + `pol-public.css`: 31
  - `app.css` + `pol-shell.css`: 23
  - `app.css` + `calls-engine.css`: 11
  - `app.css` + `pol-thread.css`: 9
  - `pol-shell.css` + `ui-sheets.css`: 6
- **Shadowed declarations.** 340 declarations lose to a later identical selector; 114 of them merely restate the winning value. 54 whole rules are dead weight. All are listed in G13.0.
- **Classes painted by several files.** 360 classes are painted by two or more files. The worst:
  - `.onyx-ci`: 7 files, 40 rules;
  - `.onyx-cbtn`: 5 files;
  - `.onyx-sheet`, `.onyx-sheet-layer`, `.onyx-call-btn`, `.onyx-call-bar`, `.onyx-composer`, `.onyx-avatar`: 4 files each.

  Most common pairs:
  - `app.css` + `ui-sheets.css`: 94 classes
  - `app.css` + `pol-shell.css`: 89
  - `app.css` + `pol-thread.css`: 55
  - `app.css` + `pol-public.css`: 23
- **Property fights.** 538 cases where one class in the same state and context gets different values from different files. 364 are won by a later file *raising specificity* (`.onyx-frame .onyx-composer` over `.onyx-composer`). 40 are cases where an earlier file still wins on specificity, and those would flip under `@layer`.

Representative conflicts, from G13.1 / G14.1:

| Selector | Property | Values in cascade order → winner |
|---|---|---|
| `.onyx-composer` | background / padding / gap / border-top | `app.css:747` panel → `pol-thread.css:989` bg; `10px 16px` → `--space-2 --space-4`; `1px solid line` → `0` |
| `.onyx-toaster` | z-index / bottom / max-width | `app.css:1070` 60 / 16px / `min(360px,90vw)` → `ui-sheets.css:788-791` 90 / composer-aware / 380px |
| `.onyx-toast` | radius / padding | `8px` / `8px 10px` → `var(--radius)` / tokens |
| `.onyx-spotlight-panel` | width / shadow / animation | 560 / `rgb(0 8 16/45%)` / `onyx-switcher-in` → 600 / `--elev-3` / `ui-sheet-drop` |
| `.onyx-sheet-backdrop` | background | `color-mix(in srgb,#000 55%…)` → `var(--sheet-veil)` |
| `.onyx-sheet-layer > .onyx-sheet` (phone) | radius / max-height | `var(--radius)` / `92dvh` → `12px 12px 0 0` / `var(--sheet-max-h)` |
| `.onyx-rail .onyx-rail-star-on` | color | `app.css:592` accent → `app.css:3842` text → `pol-shell.css:870` dim (three values, two files) |
| `.onyx-rail .onyx-rail-filter-unread-on` | border / colour | accent → dim / text (the later file removed the accent; the earlier rule is dead weight) |
| `.onyx-land-*` (24 selectors) | everything | `app.css:905-1064` → `pol-public.css:500-760` |
| `.onyx-frame` | height | `100vh` → `100dvh` (`app.css:3433-3434`) → `var(--vvh, 100dvh)` (`pol-ios.css:65`) |
| `.onyx-call-avatar-lg` | size | 72px (`app.css:3195`) → 56px compact (`app.css:3287`, 0,3,0) → 40px (`calls-c4.css:140`, 0,2,0); the compact rule out-specifies the later one (layer flip) |

**!important (12, G12).** Ten are legitimate preference kill switches in `app.css`:

- reduced motion at `3138-3141`, `3927-3929`, `3942`;
- high-contrast focus at `3148`;
- reduced transparency at `3151`.

The other two:

- `pol-stats.css:1062` — `transition: none !important`, which duplicates the global switch;
- `pol-ios.css:126` — `.a2hs-sheet { display:none !important }` in standalone mode.

There are no `!important` declarations in component code.

**Specificity (G15).**

- 2,450 selectors have specificity (0,1,0), almost all a single class.
- 15 selectors sit at (0,0,0) (`:where()` skins and `*`).
- 103 are outliers: (0,4,0) and up, ids, or 4+ compounds. Worst:
  - `.stats-page :is(...) button:is([aria-pressed=...])` chains;
  - `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(...)`.
- 2 selectors use ids.

### 3.3 Dead rules

The full list is in G16. Method: a class is live if any Elm string literal, any `ports.js` / `media` string, or a concatenated dynamic prefix (`"onyx-toast--" ++ intent`, and 8 others) can produce it.

- **64 rules (221 declarations) are fully dead.** 59 are in `app.css`, 4 in `pol-shell.css` and 1 in `pol-public.css`.
- **7 more rules** carry dead selector-list members (`.onyx-shortcuts-close`, `.notif-center__close`, `.onyx-calls-toggle-open`, `.onyx-leave`).
- **3 attribute selectors** name `data-icon` values the views never emit: `.onyx-shi[data-icon="bell"]` (`pol-shell.css:538`), `.pt-ico[data-icon="calendar"|"chart"]` (`pol-thread.css:82-83`).
- **No unstyled classes.** Every class the views emit is mentioned somewhere; `tools/css-coverage.mjs` reports 0.

### 3.4 z-index ladder (actual, G4)

```
-1  .ap-background-host
 1  sticky heads inside scrollers, tile overlays, lightbox dialog
 3  .onyx-call-reactions, account nav (phone)
 4  .onyx-row-actions, sticky sheet head
 5  .onyx-jump-latest, desktop .onyx-primary-nav, .onyx-moddesk-bar
10  .ap-bar
19  .public-frame__nav (phone)          20  .public-frame__header, .onyx-call-more
21  .onyx-call-react-menu
40  popover backdrops/scrims + composer popovers      41  their menus
45  .notif-center
50  call PiP card, fullscreen/expanded call stage
58/59  room-more scrim/menu (pol-shell, phone) — overridden by 60/61 (ui-sheets)
60  .onyx-sheet-layer, .onyx-overlays, .onyx-profile-pop, .onyx-toaster (app.css), phone .onyx-call-more
70  phone msg-menu/react backdrop, .update-available      71  phone msg-menu/react pop
80  .onyx-spotlight, .onyx-call-ring-layer
90  .onyx-toaster (ui-sheets, wins)
100 .shell-msg-lightbox, .public-frame__skip
```

### 3.5 Breakpoints (G5)

There are 72 width-conditioned blocks with 24 distinct conditions.

- **The canonical seam** (design: "Mobile (<768px)") is written as:
  - `max-width: 767.98px` — 22 blocks (shell, thread, roster, sheets, iOS);
  - `max-width: 767px` — 7 (stats, calls c4/c6/c8, roomsettings);
  - `max-width: 768px` — 11 (public, studio — *inclusive*, so at exactly 768 the public site is "phone" and the app is "desktop"; confirmed in Chromium);
  - `min-width: 768px` — 4.
- **The second seam,** 640/641, is used by prefs (`app.css:3124`), the calls bar (`app.css:3386`, `calls-c11.css:189`, `calls-engine.css:17,63`) and the container switch in `calls-engine.css`. Between 641 and 767px the shell is in mobile layout while the call bar uses desktop rules.
- **Other values:**
  - 1099.98 / 1100 (context rail), 959.98 (sidebar narrows), 1024, 880, 860;
  - 600, 520 (+ `max-height: 600`), 480, 400, 360 vs 359;
  - container queries at `onyx-call` 760 / 1000.
- **Feature queries:**
  - `hover: hover` ×5, `hover: none` ×4, `pointer: coarse` ×1, `(hover: hover) and (pointer: fine)` ×2;
  - `forced-colors` ×8 (good coverage);
  - `display-mode: standalone` ×1;
  - `@supports (height: 100dvh)` and `@supports (animation-timeline: scroll())`.

### 3.6 Motion (G6)

- **Ladder.**
  - `--dur-micro` 100, `--dur-fast` 160, `--dur-base` 220 (`app.css:77-80`).
  - 80 token uses across 88 transition/animation declarations.
  - 6 hard-coded durations:
    - the two 1.6s loops;
    - the reduced-motion `0.001ms` / `0ms` values;
    - `pol-ios.css:39` `opacity 0ms`.
  - Easing literals: `ease-out` ×2, `ease-in-out` ×2, `linear` ×3; everything else is `var(--ease)`.
- **Keyframes (14).**
  - Sheets have two vocabularies: `onyx-sheet-in`, `onyx-sheet-side-in` (`app.css:3778-3782`) and `ui-sheet-pop`, `-side`, `-drop`, `-rise`, `-veil-in`, `-veil-track` (`ui-sheets.css:85-97,392`).
  - Panels: `onyx-switcher-in`, `onyx-moddesk-in`, `polish-rise`.
  - Calls: `onyx-call-react-in`, `onyx-call-breathe` (**infinite**).
  - Loading: `pt-pulse` (**infinite**, skeleton).
  - None is unused, and every animation names a defined keyframe.
- **Reduced motion.** Coverage is complete; nothing escapes, because every rule is under the global `*` switch. It is, however, implemented three times:
  1. `:root[data-reduce-motion='true'] *` → `animation-duration: 0.001ms; iteration-count: 1; transition-duration: 0.001ms` (`app.css:3135-3142`);
  2. `@media (prefers-reduced-motion: reduce)` → duration tokens 0 plus `* { animation: none !important; transition-duration: 0ms !important }` (`app.css:3916-3930`);
  3. `:root[data-reduce-motion='true']` → tokens 0 plus `* { animation: none !important }` (`app.css:3933-3942`). This overrides (1)'s "run once to the end state" with "no animation".

  On top of these there are 16 per-file `prefers-reduced-motion: reduce` blocks and 3 `no-preference` blocks, all redundant. Script-driven motion in `ports.js` (`requestAnimationFrame` at `ports.js:3423` and `:9962`) is measurement, not animation.

### 3.7 Accent audit (G7 lists all 294 declarations)

The rule (`design/V3_DESIGN_DIRECTION.md`) allows the accent for four things only: current location, primary action, focus ring and mention glyph. `CALLS_DESIGN.md` adds "live audio now".

| Category | Count | Verdict | Examples |
|---|---|---|---|
| primary action | 99 | in budget | `.conn-submit`, `.onyx-land-open`, `.public-frame__open`, `.polish-primary`, `.rset-btn-primary`, `.onyx-composer-send--ready` |
| focus | 41 | in budget, but six ring shapes (finding 7) | |
| current location | 17 | in budget | `.onyx-nav-btn--active::before`, `.onyx-rail-active::before`, `.public-frame__nav a[aria-current]`, `.pref-category-tab[aria-selected]` |
| mention | 14 | in budget | `.onyx-rail-mention`, `.onyx-nav-badge--mention`, `.shell-msg-mention--self`, `.is-mention .onyx-home-unread` |
| theme preview | 13 | intended | `.ts-pv-*`, `.background-picker__swatch` |
| live audio (calls) | 7 | documented exception | speaking ring, tile speaking border, talk bars, call pip |
| token alias | 3 | — | `--focus-ring`, `--pg-live`, `--pg-select` |
| **selection / toggle state** | **47** | **outside** (pol-studio says "Selection is neutral") | `.pref-segment[aria-checked]`, `.room-notify-seg[aria-checked]`, `.pref-toggle … .pref-switch::after`, `.topic-chip.is-active`, `.chb-sort-btn[aria-pressed]`, `.onyx-spotlight-option[aria-selected]` (box-shadow), `.notify-toggle[aria-pressed]`, `.onyx-moddesk-toggle[aria-pressed]`, stats `--pg-select` |
| **unread / count / badge** | **20** | **outside** ("Unread uses heavier text and a neutral pill, never the accent") | `.topic-chip__unread`, `.onyx-jump-latest--unread` (×2 files), `.shell-ribbon-badge`, `.onyx-home-count`, `.chb-pill`, `.boost-pill.you`, `.provenance-badge` (theme lapis) |
| **status / success** | **10** | **outside**: no success token exists | `.onyx-toast--success`, `.onyx-reconnect-online`, `.onyx-member-dot`, `.onyx-account-passkey-ok`, `.onyx-conn-live`, `.chb-row--live` |
| **links / nav text** | **6** | **outside** | `.shell-msg-link`, `.shell-msg-channel-link`, `.onyx-account-nav__item` (every item), `.onyx-land-action` (shadowed) |
| **other** | **12** | **outside** | `.onyx-gem` (brand mark), `.onyx-whisper` border, `.onyx-composer-target`, `.onyx-schedule-view`, `.onyx-home-announce`, `.onyx-home-row-meta`, `.onyx-coach` border + eyebrow, `.public-frame__skip` |
| data-viz fill | 5 | borderline | `.time-scrubber__bar--now` fill, `.shell-attachment-progress` (`accent-color`), guides progress meter |

---

## 4. The scales actually in use

### 4.1 Typography (G8)

**Ladder as designed.** `--text-2xs` 12, `xs` 11, `sm` 13, `md` 15, `lg` 17, `xl` 20, `2xl` 24px.

- `--text-2xs` (12) is *larger* than `--text-xs` (11). The names are inverted.
- At the actual 15px root, the ladder renders as 11.25 / 10.31 / 12.19 / 14.06 / 15.94 / 18.75 / 22.5 px.

**Font-size declarations (978 total, 50 distinct values).**

| value | declarations |
|---|---|
| `--text-sm` | 317 |
| `--text-2xs` | 119 |
| `--text-xs` | 111 |
| `--text-md` | 86 |
| raw 12px | 65 |
| raw 13px | 65 |
| `--text-lg` | 56 |
| `--text-xl` | 24 |
| raw 16px | 16 |
| raw 11px | 15 |
| raw 18px | 14 |
| raw 15px | 9 |
| raw 9px | 6 |
| raw 10px | 5 |
| raw 20px | 5 |
| raw 24px | 5 |

Also 19 one-off `clamp()` display sizes in public and studio, and `em` values (0.85, 0.9, 0.92, 1.1).

**Weights.**

| weight | declarations |
|---|---|
| 650 | 163 |
| 600 | 142 |
| 700 | 102 |
| 400 | 17 |
| 750 | 14 |
| 500 | 7 |
| 800 | 3 |

With the system stack, 600/650 and 700/750/800 collapse to about two rendered faces.

**Line-heights (23 values).**

| line-height | declarations |
|---|---|
| `--leading-snug` | 40 |
| `--leading-body` | 38 |
| `1` | 29 |
| `--leading-tight` | 23 |
| 16 more raw values (1.02–1.9, 16 / 18 / 20px) | |

**Combinations.** 149 distinct size × line-height × weight combinations are set together in one rule. On a single desktop room screen Chromium renders 29 distinct text styles; the top ones are `14.06/21.09/400`, `10.31/15.47/400`, `10.8/16.2/800` (avatar initials) and `14.06/18.98/500`.

**Families.** `--font-mono` (42 uses) and one literal system stack. No display font is loaded. The public pages' 60px H1 runs at weight 750.

### 4.2 Spacing (G9)

Scale: `--space-1..8` = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 px (rendering at 3.75 … 37.5 px because of the 15px root).

| kind | uses |
|---|---|
| tokenized | 1,623 |
| raw px on the scale | 1,612 |
| raw off the scale | 649 |

Off-scale values: 2px ×173, 6px ×128, 10px ×99, 14px ×23, 1px ×19, 3px ×13, 5px ×12, 56 / 64 / 48 / 96 / 72px, and several negative pulls. In all, 129 distinct component values.

### 4.3 Radius (G10)

| value | uses |
|---|---|
| `var(--radius)` (6px) | 278 |
| raw 6px | 71 |
| 50% | 38 |
| `var(--r-pill)` | 35 |
| 4px | 23 |
| 0 | 22 |
| 2px | 15 |
| 999px | 14 |
| 10px | 11 |
| 8px | 10 |
| `12px 12px 0 0` (phone sheets) | 7 |
| 3px | 5 |
| `calc(var(--radius) * 1.5)`, `* 2`, `+ 3px`; 1px | rare |

The theme radii `--r-0`, `--r-sm` and `--r-md` (2–12px depending on theme) have no readers.

### 4.4 Elevation (G11)

- **Tokens.** `--elev-0` and `--elev-1` are unused. `--elev-2` has 6 uses and `--elev-3` (sheets) has 16.
- **Bespoke drop shadows (7):**
  - `app.css:2667` spotlight (shadowed by `ui-sheets`);
  - `app.css:2882` mod desk, a sideways shadow;
  - `app.css:3074` prefs;
  - `app.css:3337` call sheet;
  - `polish.css:344` update strip;
  - `calls-engine.css:94` call-more, upward;
  - `pol-studio.css:321` switch knob.
- **Rings rather than elevation.** 34 `box-shadow`s are 1–2px rings or selection bars, for example `inset 2px 0 0 var(--onyx-accent)` and `0 0 0 2px var(--gold)`.
- **Backdrops.** Most use `--sheet-veil`; others use literal `#000` or rgb mixes (`app.css:2654`, `:3739`).

---

## 5. Consolidation proposal

### 5.1 Target: one token layer and one component layer, in 11 role-ordered files

```
index.html (order = cascade order; @layer statement in tokens.css makes it explicit)
  app.css            → renamed role: TOKENS + BASE entry (build.sh requires an `app.css` link;
                       keep the name or update build.sh's `required` list in the same commit)
                       @layer tokens, base, icons, components, shell, thread, sheets, calls,
                              studio, public, device;
                       tokens: palette defaults (= Ocean), semantic --onyx-*, rhythm, z, motion,
                               radius, elevation, ring, focus, device geometry
                       base:   html/body (16px root), font inheritance for controls, focus ring,
                               sr-only, ONE reduced-motion block, high-contrast, reduced-transparency,
                               forced-colors, iOS document feel (from pol-ios §1)
  css/icons.css      → one mask system `.onyx-ico[data-icon]` + one data-URI set (stroke 1.75)
  css/components.css → the Solid primitive names (src/primitives/*.tsx): .onyx-button, .onyx-icon-button,
                       .onyx-field (input/select/textarea), .onyx-tabs, .onyx-popover, .onyx-toast,
                       .onyx-sheet, .onyx-avatar, .onyx-spinner, .onyx-tooltip — plus Elm-only
                       .onyx-chip, .onyx-badge, .onyx-switch, .onyx-segmented, .onyx-row, .onyx-card,
                       .onyx-menu, .onyx-divider, .onyx-empty, .onyx-skeleton, .onyx-kicker
  css/shell.css      → frame grid, primary nav, mobile nav, topbar, sidebar/rail, room header,
                       roster, home, inbox/notify, connect gate      (app.css v1 + pol-shell + pol-roster)
  css/thread.css     → transcript, message parts, composer, search, pins, media, lightbox
                                                                     (app.css v1 + pol-thread + polish)
  css/sheets.css     → the sheet primitive + every sheet body: prefs, account, account2, profile,
                       mod desk, room settings, switcher, You hub, new message, scheduled
                                                                     (ui-sheets + app.css v1 + account2 + roomsettings)
  css/calls.css      → app.css calls C1–C3 + calls-c4/c6/c8/c11/engine (one file, one order)
  css/studio.css     → pol-studio
  css/public.css     → pol-public + pol-stats (+ app.css landing v1 deleted)
  css/device.css     → pol-ios §2–5 (geometry only); last
```

**Token layer.** These are the exact additions and renames. Everything else keeps its name, so the 2,523 `--onyx-*` colour reads do not churn.

- **Semantic colour.** Keep the 11 `--onyx-*` names. Add:
  - `--onyx-ok`, the success colour, so the accent stops doubling as success;
  - `--onyx-focus`, defaulting to `--onyx-accent`; high-contrast changes only its width;
  - `--onyx-select`, a neutral selection ground (`--onyx-panel-2`) plus `--onyx-select-line` (`--onyx-text`);
  - `--onyx-scrim`, replacing `--sheet-veil` and the literal `#000` / rgb backdrops;
  - `--onyx-on-danger`, replacing `#fff` on danger buttons.
- **Theme bridge.** Each theme map (`ThemeTokens.elm`, and `Theme.elm:609-632` for custom themes) emits the semantic `--onyx-*` keys derived from its palette. The existing `appearanceApply` commit then re-skins the shell with **zero CSS change**. Ocean's derived values must equal today's `app.css:5-15` so the default look is pixel-identical. The palette tokens stay for the Studio preview and avatars.
- **Rhythm.**
  - Rename `--text-2xs` to `--text-mono` (12px, for timestamps and code), so that `xs < sm` reads in order.
  - Add `--space-px: 1px`, `--space-0-5: 2px`, `--space-1-5: 6px`. These absorb the 173 + 128 most common off-scale values with no visual change.
  - Delete `--gap-*`, `--pad-*` and `--space-0` if they stay unused.
- **Weight.** `--weight-regular: 400`, `--weight-medium: 500`, `--weight-strong: 600`, `--weight-bold: 700`. Map 650 → strong or bold (an owner decision) and 750/800 → bold.
- **Radius.** `--radius-sm: 4px`, `--radius: 6px`, `--radius-lg: 12px` (phone sheet tops), `--radius-pill: 999px` (alias the theme's `--r-pill`), `--radius-round: 50%`. Delete the theme `--r-0`, `--r-sm` and `--r-md` from `ThemeTokens.elm` and the Studio, or wire `--radius*` to them (an owner decision).
- **z-index.**

  | token | value | used by |
  |---|---|---|
  | `--z-raised` | 1 | |
  | `--z-sticky` | 5 | |
  | `--z-header` | 20 | |
  | `--z-popover` | 40 | scrim 40 / menu 41 via `+ 1` |
  | `--z-panel` | 45 | `notif-center` |
  | `--z-call` | 50 | |
  | `--z-sheet` | 60 | |
  | `--z-sheet-menu` | 70 | |
  | `--z-dialog` | 80 | spotlight, ring |
  | `--z-toast` | 90 | |
  | `--z-top` | 100 | lightbox, skip link |

- **Motion.** Keep the three `--dur-*` tokens and `--ease`. Delete `--dur` from the theme maps and the Studio.
- **Elevation.** Keep `--elev-2` and `--elev-3`. Add `--ring-1: 0 0 0 1px` and `--ring-2: 0 0 0 2px` recipes, used as `box-shadow: var(--ring-2) var(--onyx-…)`. Delete `--elev-0` and `--elev-1`.
- **Focus.** Keep `--focus-ring` as an *outline* shorthand only. Add `--focus-ring-shadow: 0 0 0 1px var(--onyx-focus) inset` for places that genuinely need a box-shadow.
- **Breakpoints.** CSS cannot put variables in media queries. Document the constants in `app.css` and enforce them with `style-map.mjs`:
  - `--bp-phone: 767.98px` (max) / 768px (min);
  - `--bp-sidebar: 959.98px`;
  - `--bp-context: 1099.98px`;
  - `--bp-small: 479.98px`;
  - container `onyx-call` at 760 / 1000.

### 5.2 Ordered steps

Each step is one commit. Every step must pass the same gate:

- `bash elm/tools/build.sh`;
- `node elm/tools/screens.mjs --vp all`, plus the style-probe scenarios for themes, preferences, focus and 768px, compared against the step-0 baseline;
- `node elm/tools/css-coverage.mjs --strict`;
- `node elm/tools/style-map.mjs`, then diff `design/style-map.json` — the counts must move only in the intended direction;
- `elm-test` for any step that touches `src/`.

| # | Step | Touches | Visual change | Risk / notes |
|---|---|---|---|---|
| 0 | **Baseline.** Add the probe scenarios (theme × preferences × focus × 700/767/768) as `elm/tools/screens-style.mjs`. Capture screenshots and computed-style JSON at every viewport. Commit `style-map.json` as the reference. | tools only | none | — |
| 1 | **Delete dead CSS:** the G16.1 rules, the dead members in G16.2, the 3 unseen `data-icon` selectors, and the 11 unused tokens. | CSS | none | Re-grep each class in `src/` and `ports.js` immediately before deleting; a class built by a new dynamic prefix would be missed. The `chb-*` / `notify-*` heads go together with the shared sheet head. |
| 2 | **Delete shadowed CSS:** the 54 fully shadowed rules (G13.0), then the remaining same-selector, same-context shadowed declarations in G13.1, from the *losing* side. | CSS | none | Safe only for identical selector and context, which is how they were computed. Never remove a loser that is `!important` or sits in a different `@media`. |
| 3 | **Bug fixes:** <ul><li>`account2.css` focus → `outline: var(--focus-ring); outline-offset: var(--focus-offset)`;</li><li>high-contrast focus → `outline: 3px solid var(--onyx-accent)`;</li><li>`button, input, select, textarea { font: inherit }` in base;</li><li>a single `.onyx-toaster` z;</li><li>`.onyx-call-btn-danger` / `.onyx-cbtn-leave` `#fff` → `--onyx-on-danger`.</li></ul> | CSS | intended (focus visible; 13.33 → 14.06px text on two button kinds) | Update screenshot baselines deliberately. |
| 4 | **Theme bridge.** Emit the `--onyx-*` keys from `ThemeTokens.tokensFor` and `Theme.elm`; set `<meta theme-color>` from `appearanceApply`. | `src/ThemeTokens.elm`, `src/Theme.elm`, `ports.js` (meta), `tests/ThemeTest.elm` | none for Ocean; all other themes start re-skinning the shell | **Biggest product decision.** Every theme needs a contrast pass on `--onyx-*` pairs (extend `Theme.enforceAA` pairs, `Theme.elm:666-674`). Until then, Pearl and Frost would ship a light shell for the first time. Alternative B: hide non-Ocean themes and the Studio colour editors until this lands. |
| 5 | **Root size:** `html { font-size: 100% }`; body keeps `font: var(--text-md)/var(--leading-body) …`. | `app.css:209-217` | **all rem sizes +6.7%** | Deliberate rebaseline. Check the 44px targets (px, unaffected), the `--composer-h`/`--mobile-nav-h` px tokens versus rem paddings inside them, and phone overflow at 320px (`--vp se`). Alternative: keep 15px and rewrite the documented ladder. Either way the docs and the computed values must agree. |
| 6 | **Preferences that do nothing:** either implement them (`:root[data-font-scale="sm"\|"lg"] { font-size: 93.75% \| 106.25% }`, `[data-width="full"] { --shell-measure: none }`, `[data-reader="true"]` → transcript measure and leading) or remove the controls. | CSS (+ `View/Appearance.elm` if removing) | intended | Depends on step 5, because font scale multiplies the root. |
| 7 | **Icons:** one `css/icons.css`, `.onyx-ico[data-icon]`, one glyph set (stroke 1.75). Keep `.onyx-ci`, `.pt-ico`, `.onyx-shi`, `.onyx-nav-icon` and `.ui-icon` as aliases (`.onyx-ci, .pt-ico, … { … }`) until the views switch. | CSS, then `View/Icon.elm` and callers | subtle (unified stroke width) | Aliases keep it CSS-only at first. Duplicate glyph names (`close` and others) must resolve to one drawing. |
| 8 | **Sheets:** fold `app.css:3724-3912` into `ui-sheets.css`, keeping the winner of each fight; delete `onyx-sheet-in` / `onyx-sheet-side-in` and point `pol-shell:1293`, `pol-thread:363,827` and `pol-roster:353` at `ui-sheet-*`; move the `calls-c6` / `calls-c11` / `pol-ios` sheet patches beside it. | CSS | none if the winners are kept | 40 duplicate selectors. Use G13.1 winners verbatim. |
| 9 | **Components:** add the primitives (§5.1) to `components.css`, with selection neutral and unread neutral per the design. Start by promoting the existing Studio-scoped `.ts-studio .onyx-button` / `--ghost` / `--primary` (`pol-studio.css:747-790`, used by `View/Studio.elm:174`) to the global `.onyx-button`. Migrate the views by **adding** `onyx-button onyx-button--ghost` beside the existing class (`class "onyx-button onyx-button--ghost onyx-account-logout"`), then delete each old class's rule once its matrix row (G17.1) is empty. Rename the one-off `.onyx-empty` (`app.css:710`) and the Studio-scoped `.onyx-tabs`, `.onyx-field` and `.onyx-tooltip` (`pol-studio.css:739,1061,1186`) before taking those names. Go one family per commit, in this order: buttons (119 classes) → fields → chips/pills/badges → switch/segmented/tabs → rows/cards → menus/toasts. | `src/View/*.elm` + CSS | intended (the accent budget becomes visible: 47 selection + 20 unread + 10 status + 6 link uses stop being accent) | Elm tests that assert class strings (`tests/*Test.elm` with `Query.has [ class … ]`) keep passing because old classes stay until their rules go. `data-testid`s are untouched. |
| 10 | **Scales:** mechanical token substitution for on-scale raw values (1,612 spacing, raw 6px radius ×71, 999px ×14, raw 12/13/11/15/24px font sizes that equal ladder steps). Then the off-scale decisions (10px, 14px, 18px, 16px, 650 weight, 8/10px radii) as small reviewed commits. Then z-index literals → `--z-*`. Then breakpoints: `767px` / `768px` → `767.98px`, `min-width: 768px` unchanged. | CSS | none for exact substitutions; small for the off-scale ones | Exact substitution is only zero-change *after* step 5 if both sides are rem; before step 5, `12px` and `--text-2xs` differ (12 vs 11.25). Do step 10 after step 5, or substitute only px-for-px. Public pages flip to desktop at exactly 768px (intended). |
| 11 | **Reflow into the 11 files, then layers:** move each block into its role file; resolve the 40 layer-flip fights (G14.1, **flip**) by merging into one rule; then add the `@layer` statement and delete the `.onyx-frame .x` / page-root specificity boosters, verifying each against the fights table. | CSS, `index.html`, `build.sh` (if `app.css` is renamed) | none | Under `@layer`, an earlier layer's `!important` beats a later layer's. Keep the 10 preference kill switches in `base` (which is what they want) and delete `pol-stats.css:1062` (redundant). `tools/css-coverage.mjs` and `style-map.mjs` read `css/*.css` and need no change. |
| 12 | **Guard rails:** add `style-map.mjs --check` to the elm gates. It fails on: <ul><li>new dead rules;</li><li>new colour literals outside `:root`;</li><li>new z-index / breakpoint / duration literals;</li><li>`box-shadow: var(--focus-ring)`;</li><li>new accent uses outside the allowed G7 categories;</li><li>a stylesheet that claims "loaded last" and isn't.</li></ul> | tools | none | Thresholds start at the post-step-11 counts. |

### 5.3 What to merge, what to delete (quick reference)

- **Delete outright:**
  - 64 dead rules and 7 dead selector members (G16);
  - 54 fully shadowed rules (G13.0);
  - the `app.css` landing v1 (905-1064; the remaining non-shadowed declarations need a one-time diff against `pol-public.css`);
  - the `app.css` spotlight and shortcut close styling (2629-2710; superseded by `ui-sheets.css:214-252`);
  - 11 unused tokens; `--dur` and the unused theme radius and font tokens in `ThemeTokens.elm` and the Studio (if the owner chooses not to wire them);
  - the second and third reduced-motion implementations (keep one media block plus one data-attribute block with identical bodies);
  - the 16 local reduced-motion blocks;
  - `pol-stats.css:1062`.
- **Merge:**
  - `app.css` sheet v1 → `ui-sheets.css`;
  - `app.css` roster v3 (2538-2588) → `pol-roster.css`;
  - `app.css` thread/composer v1 → `pol-thread.css`;
  - `app.css` rail/topbar/nav/room header/inbox → `pol-shell.css`;
  - `app.css` calls C1–C3 (3154-3420) + `calls-c4/c6/c8/c11/engine` → `calls.css`;
  - `polish.css` → `thread.css` (composer tools, scrubber) and `sheets.css` (first-run, A2HS);
  - `account2.css` and `roomsettings.css` → `sheets.css`;
  - `pol-stats.css` → `public.css`.
- **Unify:**
  - buttons (119 → `.onyx-button`, 4 variants, 3 sizes);
  - icons (6 → `.onyx-ico`);
  - sheet keyframes (8 → 3: `veil`, `pop`, `rise`; `side` stays as a variant);
  - focus (6 → 1);
  - z-index (22 → 11 tokens);
  - breakpoints (24 → 6);
  - weights (7 → 4);
  - radii (13 → 5).

---

## 6. Reproducing the Chromium checks

The (C) findings came from the scenario file below, run against the current build. To reproduce:

1. Save the file outside the repo, for example as `/tmp/style-probe.mjs`.
2. Build and run:

   ```sh
   bash elm/tools/build.sh
   node elm/tools/screens.mjs --extra /tmp/style-probe.mjs --out /tmp/style-shots --vp phone,desktop \
     --only sm-ocean,sm-pearl,sm-shu,sm-prefs-lg,sm-focus-default,sm-landing,sm-landing-pearl,sm-palette,sm-you,sm-prefs-sheet
   node elm/tools/screens.mjs --extra /tmp/style-probe.mjs --out /tmp/style-shots --vp desktop --only sm-bp-700,sm-bp-767,sm-bp-768
   ```

Each scenario writes a screenshot plus a JSON file of computed styles to `probe-out/`, next to the scenario file. The JSON includes `<html>` data attributes, resolved tokens, key elements, every visible button and input, and a census of rendered text styles.

Step 0 of §5.2 proposes committing this file as `elm/tools/screens-style.mjs`.

<details><summary>style-probe.mjs</summary>

```js
// style-probe.mjs — extra scenarios for elm/tools/screens.mjs (computed-style evidence for STYLE_MAP.md).
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = new URL('./probe-out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SELS = [
  'html', 'body', '.onyx-frame', '.onyx-topbar', '.onyx-primary-nav', '.onyx-mobile-nav', '.onyx-rail', '.onyx-rail-active .onyx-rail-name',
  '.onyx-room-header', '.onyx-transcript', '.onyx-message', '.onyx-sender', '.onyx-avatar', '.onyx-message-text', '.shell-msg-text',
  '.onyx-composer', '.onyx-composer-field', '.onyx-composer-send', '.onyx-day-divider', '.onyx-system', '.onyx-toaster',
  '.onyx-nav-btn', '.onyx-nav-btn[aria-current="page"]', '.onyx-roster', '.onyx-member', '.public-frame', '.onyx-land-open', '.public-frame__open',
  '.onyx-land-h1', '.public-frame__nav', '.onyx-sheet', '.onyx-sheet-layer',
];

async function measure(p, tag) {
  const data = await p.evaluate((sels) => {
    const pick = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        cls: el.className && el.className.baseVal === undefined ? String(el.className).slice(0, 80) : '', tag: el.tagName.toLowerCase(),
        w: Math.round(r.width), h: Math.round(r.height), display: s.display, bg: s.backgroundColor, color: s.color, fs: s.fontSize, lh: s.lineHeight,
        fw: s.fontWeight, ff: s.fontFamily.slice(0, 40), radius: s.borderRadius, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        pad: s.padding, z: s.zIndex, shadow: s.boxShadow.slice(0, 60), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, maxw: s.maxWidth,
      };
    };
    const out = {};
    for (const sel of sels) { const el = document.querySelector(sel); out[sel] = el ? pick(el) : null; }
    const root = getComputedStyle(document.documentElement);
    const toks = ['--onyx-bg', '--onyx-panel', '--onyx-text', '--onyx-accent', '--onyx-line', '--ink', '--stone', '--stone-2', '--paper', '--paper-dim', '--lapis', '--lapis-bright', '--line', '--dur', '--dur-base', '--ease', '--r-pill', '--radius', '--r-sm', '--r-md', '--seam', '--ok'];
    const tokens = Object.fromEntries(toks.map((t) => [t, root.getPropertyValue(t).trim()]));
    const buttons = [...document.querySelectorAll('button, a[role="button"], .onyx-button, [class*="btn"]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(pick);
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(pick);
    const fontSizes = {};
    for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (!r.width || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const s = getComputedStyle(el); const k = `${s.fontSize}/${s.lineHeight}/${s.fontWeight}`; fontSizes[k] = (fontSizes[k] || 0) + 1; }
    return { url: location.pathname, vw: innerWidth, vh: innerHeight, dataset: { ...document.documentElement.dataset }, inlineStyle: (document.documentElement.getAttribute('style') || '').slice(0, 400), colorScheme: root.colorScheme, tokens, els: out, buttons, inputs, fontSizes };
  }, SELS);
  const vp = p.viewportSize();
  writeFileSync(`${OUT}${tag}--${vp.width}.json`, JSON.stringify(data, null, 1));
}

const withStore = (p, entries) => p.addInitScript((e) => { for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v); }, entries);

export default {
  'sm-ocean': async (p, h) => { await h.joinRoom(p); await measure(p, 'sm-ocean'); },
  'sm-pearl': async (p, h) => { await withStore(p, { 'onyx:theme': 'pearl' }); await h.joinRoom(p); await h.settle(p, 600); await measure(p, 'sm-pearl'); },
  'sm-shu': async (p, h) => { await withStore(p, { 'onyx:theme': 'shu' }); await h.joinRoom(p); await h.settle(p, 600); await measure(p, 'sm-shu'); },
  'sm-prefs-lg': async (p, h) => {
    await withStore(p, { 'onyx:preferences': JSON.stringify({ fontScale: 'lg', width: 'full', density: 'compact', readerMode: true, highContrast: true, experienceMode: 'pro' }) });
    await h.joinRoom(p); await h.settle(p, 600); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await h.settle(p, 200);
    await measure(p, 'sm-prefs-lg');
    const focus = await p.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return { cls: String(el.className), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}` }; });
    writeFileSync(`${OUT}sm-prefs-lg-focus--${p.viewportSize().width}.json`, JSON.stringify(focus));
  },
  'sm-focus-default': async (p, h) => {
    await h.joinRoom(p); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await h.settle(p, 200);
    const focus = await p.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return { cls: String(el.className), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, offset: s.outlineOffset }; });
    writeFileSync(`${OUT}sm-focus-default--${p.viewportSize().width}.json`, JSON.stringify(focus));
  },
  'sm-bp-767': async (p, h) => { await p.setViewportSize({ width: 767, height: 900 }); await h.joinRoom(p); await measure(p, 'sm-bp-app'); await p.goto(`${h.base}/`); await h.settle(p, 700); await measure(p, 'sm-bp-landing'); },
  'sm-bp-768': async (p, h) => { await p.setViewportSize({ width: 768, height: 900 }); await h.joinRoom(p); await measure(p, 'sm-bp-app'); await p.goto(`${h.base}/`); await h.settle(p, 700); await measure(p, 'sm-bp-landing'); },
  'sm-bp-700': async (p, h) => { await p.setViewportSize({ width: 700, height: 900 }); await h.joinRoom(p); await measure(p, 'sm-bp-app'); },
  'sm-landing': async (p, h) => { await p.goto(`${h.base}/`); await h.settle(p, 700); await measure(p, 'sm-landing'); },
  'sm-landing-pearl': async (p, h) => { await withStore(p, { 'onyx:theme': 'pearl' }); await p.goto(`${h.base}/`); await h.settle(p, 700); await measure(p, 'sm-landing-pearl'); },
  'sm-palette': async (p, h) => { await h.joinRoom(p); await p.keyboard.press('Control+k'); await h.settle(p); await measure(p, 'sm-palette'); },
  'sm-you': async (p, h) => { await h.joinRoom(p); await h.tryClick(p, '[data-testid="you-open"]'); await measure(p, 'sm-you'); },
  'sm-prefs-sheet': async (p, h) => { await h.joinRoom(p); await h.tryClick(p, '[data-testid="you-open"]'); await h.tryClick(p, '[data-testid="you-preferences"], button:has-text("Preferences")'); await measure(p, 'sm-prefs-sheet'); },
};
```

</details>

## Generated inventory

Everything below is regenerated by `elm/tools/style-map.mjs`. Section index:

- G0 totals
- G1 files
- G2 every custom property, theme value and use, with G2.1 the theme matrix
- G3 every hard-coded bypass
- G4 z-index
- G5 breakpoints
- G6 motion
- G7 accent
- G8 typography
- G9 spacing
- G10 radius
- G11 shadows
- G12 `!important`
- G13 duplicate selectors
- G14 multi-file classes and property fights
- G15 specificity
- G16 dead rules
- G17 component families and matrices


<!-- BEGIN GENERATED STYLE INVENTORY (elm/tools/style-map.mjs) -->

> Everything below this marker is regenerated by `node elm/tools/style-map.mjs`; edit the analysis above it, never this part. Locations are `file:line[,line…]` with `css/` dropped; `app.css` is the root sheet. The full machine-readable map (every selector, declaration and use) is `elm/design/style-map.json`.

## G0. Totals

| bytes | lines | rules | selectors | declarations | !important | custom props defined | custom props referenced | classes styled | classes in Elm class attrs |
|---|---|---|---|---|---|---|---|---|---|
| 595966 | 15328 | 4183 | 4738 | 14364 | 12 | 160 | 157 | 2155 | 2031 |

## G1. Stylesheets in cascade order (index.html)

| # | file | KiB | lines | rules | selectors | decls | !imp | @media | @container | tokens defined | key classes | dead rules (decls) | decls shadowed by a later identical selector | rules fully shadowed | top class prefixes | views emitting its classes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `app.css` | 153.0 | 3943 | 1229 | 1367 | 4533 | 10 | 15 | 0 | 113 | 907 | 59 (205) | 286 | 53 | onyx-account 85, onyx-home 46, onyx-call 46, onyx-member 32, onyx-rail 30, onyx-moddesk 24, onyx-land 22, onyx-dmsafe 20, onyx-spotlight 19, onyx-calls 18 | View/Account.elm 82, View/Thread.elm 76, View/Profile.elm 51, View/DmSafety.elm 50, View/Home.elm 50, View/Prefs.elm 37, View/CallStage.elm 36, View/Composer.elm 31 |
| 2 | `css/pol-stats.css` | 46.1 | 1080 | 301 | 333 | 1059 | 1 | 7 | 0 | 11 | 124 | 0 (0) | 2 | 0 | public-room 19, stats-feed 8, stats-inspector 6, data-room 6, status-observation 4, stats-window 4, stats-chart 3, stats-heatmap 3, channel-spark 3, status-check 2 | View/Stats.elm 91, View/Status.elm 12, View/Roadmap.elm 11, View/About.elm 6, View/Download.elm 3, View/NotFound.elm 1 |
| 3 | `css/pol-studio.css` | 45.1 | 1785 | 287 | 326 | 1144 | 0 | 8 | 0 | 0 | 183 | 0 (0) | 2 | 0 | ts-pv 39, ts-audit 17, background-picker 9, ts-token 9, ts-factory 7, ts-theme 7, ts-preview 6, ap-theme 5, ap-background 4, ap-readiness 4 | View/Studio.elm 126, View/Appearance.elm 50, App.elm 1 |
| 4 | `css/pol-shell.css` | 62.8 | 1469 | 463 | 518 | 1383 | 0 | 10 | 0 | 24 | 269 | 4 (15) | 18 | 1 | onyx-rail 42, onyx-room 28, notif-center 19, onyx-account 18, onyx-home 13, guest-claim 9, onyx-nav 8, onyx-calls 7, moderation-desk 5, onyx-call 5 | View/Rail.elm 42, View/RoomHeader.elm 35, View/Inbox.elm 20, View/Account.elm 18, View/Home.elm 17, View/Nav.elm 16, View/Topbar.elm 16, View/Bans.elm 10 |
| 5 | `css/pol-thread.css` | 76.3 | 1920 | 462 | 557 | 1713 | 0 | 9 | 0 | 61 | 260 | 0 (0) | 5 | 0 | onyx-message 44, room-media 31, shell-msg 30, onyx-thread 19, shell-composer 11, pins-item 11, onyx-msg 9, onyx-composer 9, onyx-topic 7, onyx-react 6 | View/Thread.elm 110, View/Composer.elm 44, View/Search.elm 41, View/Media.elm 31, View/Pins.elm 24, View/Home.elm 3, View/MessageText.elm 2, View/Polish.elm 2 |
| 6 | `css/pol-roster.css` | 13.7 | 417 | 84 | 98 | 300 | 0 | 8 | 0 | 0 | 32 | 0 (0) | 1 | 0 | onyx-mlist 12, onyx-roster 8, onyx-member 6, onyx-avatar 2, onyx-members 2, pt-ico 1, onyx-away 1 | View/Roster.elm 28, Avatar.elm 2, View/Icon.elm 1, View/Stewardship.elm 1 |
| 7 | `css/pol-public.css` | 68.1 | 1681 | 555 | 642 | 1778 | 0 | 17 | 0 | 14 | 294 | 1 (1) | 9 | 0 | onyx-land 53, public-frame 31, ab-scene 9, guides-route 8, guides-progress 7, guides-card 5, public-info 5, guides-index 4, guides-share 4, not-found 4 | View/About.elm 54, View/Landing.elm 47, View/Download.elm 45, View/Guides.elm 44, View/PublicFrame.elm 30, View/Onyxos.elm 27, View/Invite.elm 23, View/Trust.elm 6 |
| 8 | `css/calls-c8.css` | 8.9 | 134 | 69 | 72 | 226 | 0 | 2 | 0 | 2 | 45 | 0 (0) | 1 | 0 | onyx-call 23, onyx-vs 18, onyx-cbtn 2, onyx-ci 1, onyx-voice 1 | View/CallOverlays.elm 23, View/VoiceSettings.elm 20, View/CallPresence.elm 1, View/CallStage.elm 1 |
| 9 | `css/calls-c11.css` | 5.5 | 192 | 36 | 43 | 109 | 0 | 3 | 0 | 0 | 24 | 0 (0) | 3 | 0 | onyx-stage 13, onyx-call 5, onyx-cbtn 2, onyx-tile 2, onyx-ci 1, onyx-sheet 1 | View/StageMode.elm 15, View/CallDock.elm 2, View/CallVideo.elm 2, View/CallStage.elm 2, View/CallPresence.elm 1, View/CallOverlays.elm 1, View/Sheet.elm 1 |
| 10 | `css/polish.css` | 10.7 | 387 | 67 | 85 | 238 | 0 | 3 | 0 | 6 | 34 | 0 (0) | 0 | 0 | time-scrubber 13, shell-composer 9, a2hs-sheet 4, first-run 3, update-available 2, onyx-sheet 1, polish-primary 1, polish-ghost 1 | View/Polish.elm 34 |
| 11 | `css/account2.css` | 6.3 | 168 | 57 | 67 | 193 | 0 | 2 | 0 | 0 | 44 | 0 (0) | 5 | 0 | a2-reclaim 8, a2-status 4, a2-row 3, a2-btn 3, a2-ready 3, a2-confirm 2, a2-person 2, a2-dot 2, a2-sheet 1, a2-body 1 | View/Account2.elm 41, View/Rail.elm 2, View/Appearance.elm 1 |
| 12 | `css/roomsettings.css` | 9.7 | 355 | 88 | 92 | 291 | 0 | 2 | 0 | 0 | 68 | 0 (0) | 0 | 0 | onyx-room 5, rset-bridge 5, rset-toggle 5, rset-event 4, rset-roles 4, rset-access 4, rset-rhythm 4, rset-group 3, rset-readonly 3, rset-insights 3 | View/RoomSettings.elm 56, View/RoomHeader.elm 6, View/DmSafety.elm 3, View/Notify.elm 1, View/CallPresence.elm 1, View/Sheet.elm 1 |
| 13 | `css/calls-c6.css` | 8.3 | 275 | 62 | 67 | 188 | 0 | 4 | 0 | 1 | 35 | 0 (0) | 0 | 0 | onyx-call 31, onyx-sheet 2, onyx-ci 1, onyx-cbtn 1 | View/CallDock.elm 29, View/Sheet.elm 2, View/CallStage.elm 2, View/CallPresence.elm 1, View/CallOverlays.elm 1 |
| 14 | `css/calls-c4.css` | 11.3 | 165 | 96 | 101 | 231 | 0 | 2 | 0 | 9 | 36 | 0 (0) | 1 | 0 | onyx-call 13, onyx-tile 13, onyx-cq 6, onyx-cbtn 3, onyx-ci 1 | View/CallVideo.elm 25, View/CallStage.elm 6, View/CallOverlays.elm 3, View/CallPresence.elm 1, View/CallDock.elm 1 |
| 15 | `css/ui-sheets.css` | 45.4 | 1101 | 267 | 301 | 829 | 0 | 10 | 0 | 30 | 131 | 0 (0) | 6 | 0 | onyx-spotlight 15, onyx-you 14, onyx-sheet 13, notif-center 10, onyx-member 8, pref-category 6, onyx-account 5, onyx-profile 5, onyx-toast 5, onyx-moddesk 4 | View/Switcher.elm 18, View/Browser.elm 14, View/Nav.elm 13, View/Profile.elm 13, View/Sheet.elm 12, View/Inbox.elm 10, View/Prefs.elm 10, View/DmSafety.elm 6 |
| 16 | `css/pol-ios.css` | 5.0 | 132 | 18 | 21 | 30 | 1 | 6 | 0 | 0 | 5 | 0 (0) | 0 | 0 | onyx-frame 1, onyx-mobile 1, onyx-composer 1, onyx-sheet 1, a2hs-sheet 1 | View.elm 1, View/Nav.elm 1, View/Composer.elm 1, View/Sheet.elm 1, View/Polish.elm 1 |
| 17 | `css/calls-engine.css` | 5.8 | 124 | 42 | 48 | 119 | 0 | 3 | 2 | 0 | 15 | 0 (0) | 1 | 0 | onyx-call 12, onyx-cbtn 2, onyx-sec 1 | View/CallStage.elm 12, View/CallOverlays.elm 2, View/CallVideo.elm 1 |

Each file's own header comment (its declared ownership):

- **app.css** — Onyx Elm shell — abyssal monochrome + single sea-glass accent. System stack, 6px radii, hierarchy via weight/size. No gradients.
- **css/pol-stats.css** — elm polish/pol-stats — public /stats, /status and /roadmap pages. Ported from src/routes/{stats,status,roadmap,public-room-comparison, data-pages,landing}.css and re-cut to the Elm language: near-black surfaces, warm off-white text, 1px seams, 6px radii, no gradients or glow. The accent marks one thing here: the live/current answer (fresh feed pip, selected control, primary action, focus). Every rule is scoped to a page root so the shared `r-*` / `data-*` names cannot leak into other public pages.
- **css/pol-studio.css** — v3 polish / pol-studio — the /appearance page and the Theme Studio (View.Appearance, View.Studio). Ported from src/app/appearance.css, src/backgrounds/picker/background-picker.css and the STUDIO_CSS block in src/theme/ThemeStudio.tsx, re-cut for the Elm language: near-black steps (bg / panel / panel-2) split by the 1px seam, warm off-white text, 6px radii, hierarchy by weight and size, no gradients or glow. The accent marks only the current location (bar tag), primary actions (apply / generate / bake / save) and focus. Selection is neutral: panel-2 ground + a text-coloured hairline.  The live preview mock (.ts-pv-*) deliberately paints from the THEME tokens (--ink / --stone / --paper / --lap
- **css/pol-shell.css** — v3/pol-shell — production polish for the shell views (inbox, account, moderation desk, browser/formation, calls hub, rail, room header, prefs, profile, topbar identity, stewardship, switcher, notify). Ported from the Solid reference (src/shell/**, src/app/*.css) onto the Elm tokens in app.css :root. One sea-glass accent: current location, primary action, focus ring, mention glyph. 6px radii, no glow.
- **css/pol-thread.css** — v3/pol-thread — the core chat surface: transcript rows, dividers, intro, typing, replies, inline media / previews / file chips, the lightbox, the thread sheet, the composer (context bars, attachments, conversation picker, outbox), message search, the media index and pins. Tokens from app.css :root only. Near-black surfaces, warm off-white text; the sea-glass accent marks current location, the primary action, focus and the mention glyph — nothing else.
- **css/pol-roster.css** — v3/ui-roster — the channel member list (View.Roster).  A calm list in the Discord / Slack mould: one clean line per person (avatar with a presence dot, the full name), role sections in words with counts, Away dimmed at the end, the filter folded into an icon until it is needed, no per-row buttons on touch and a single quiet Message icon on hover / focus with a fine pointer.  Wide layouts (>= 1100px) show the list in flow as the 240px context rail. Below that the frame hides the rail and the room header's people toggle opens the same element as a popover sheet: a right side sheet on tablets, a full-height bottom sheet on phones. The browser owns open / close, light dismiss and Escape (popover
- **css/pol-public.css** — v3/pol-public — the public website (frame, landing, about, download, guides, invite, OnyxOS, info/trust pages, 404).  Same design language as the app shell: near-black ground, warm off-white text, ONE sea-glass accent (primary action, current location, focus), 6px radii, hierarchy by weight and size. No gradients, glow, or glass. Decorative Solid scene layers (r-ground/r-flecks/r-veins/r-grain/onyxos-grid/public-atmosphere) are intentionally not drawn. Breakpoint 768px; phone-safe at 375px.
- **css/calls-c8.css** — v3/calls-c8 — calls C8 + C9 (CALLS_DESIGN.md §2.4, §2.10, §2.11, §3.4, §2.18): Hand / React / Captions in the bar, the React menu, reaction chips, the live captions plate, the push-to-talk hint and the Voice settings sheet. Tokens only from app.css :root. The accent keeps its one call meaning (live audio now) — nothing here uses it except the shared focus ring.
- **css/calls-c11.css** — v3/calls-c11 — C11 stage mode (spec §2.16, oracle StagePanel) and the C12 accessibility pass over every call surface (spec §3.2–3.4, §6). Tokens come from app.css :root. Accent stays reserved for the live pip, the speaking ring and the focus ring; a raised hand is warn.
- **css/polish.css** — v3/polish — composer More tools tray, time scrubber, the quiet first-run notifications / Add to Home Screen sheets, and the update-available strip. Tokens only (app.css :root); the accent marks the primary action, the current hour and the focus ring.
- **css/account2.css** — v3/account2 — session reclaim banner, revoke-others confirm, portable residence, theme share/import sheet, You hub status block, People sheet, sidebar friend presence. Tokens come from :root in app.css.
- **css/roomsettings.css** — v3/roomsettings — room header completion (privacy glyph, expandable topic, facepile, second row) and the Room settings sheet + 3.8 room surfaces (scheduled event, bridge badge, group-control mark, insights). Tokens only; accent reserved for the primary action and the focus ring.
- **css/calls-c6.css** — v3/calls-c6 — DM ring dialogs (C6), mini voice view (C7) and reconnecting / error states (C10). Spec: design/calls/CALLS_DESIGN.md §2.8, §2.9, §2.14, §2.18. Tokens come from app.css :root. Accent is used only for the live pip and the speaking outline.
- **css/calls-c4.css** — v3/calls-c4 — calls C4 + C5 (CALLS_DESIGN.md §2.4, §2.6, §2.7, §2.13, §2.18): camera / share / deafen controls, the connection pip and turn-off-camera prompt, the video grid, participant tiles, spotlight + screenshare layouts and stage sizes. Tokens only from app.css :root. The accent means live audio now: tile speaking border and talk bars — nothing else.
- **css/ui-sheets.css** — v3/ui-sheets — every overlay, sheet and popover in the shell. Loaded LAST so it wins the cascade over app.css + the pol-* files.  One family: near-black panel, 1px seam, 6px radii, the short cool sheet shadow (--elev-3), a sticky head (kicker / title / subtitle, trailing actions, icon close), and on phones a true bottom sheet — grab handle, internal scroll, safe-area padding, swipe-down to dismiss (pure CSS scroll-snap, see View.Sheet). Desktop keeps centred dialogs in three widths, right-hand side panels, and a top-right popover for the inbox.  Icons are CSS masks over data-URI SVGs (never font glyphs).
- **css/pol-ios.css** — v3/ios — the shared iOS / touch plumbing for the app frame.  Loaded last so it can lay device geometry over every surface without restyling them. Reads the geometry tokens from app.css :root: --safe-top/right/bottom/left (env(safe-area-inset-*)), --vvh (visual viewport height, published by ports.js installViewportInsets; 100dvh or 100vh without it) and --kb-inset / --vv-top / &lt;html data-kb>.  1. document feel — no tap flash, no text inflation, no double-tap zoom on controls, press states for touch, chrome not selectable; 2. the app shell — fixed to the visual viewport (so the composer rides above the on-screen keyboard), no rubber-banding, lists scroll inside themselves; 3. safe areas — top 
- **css/calls-engine.css** — v3/calls-engine — call surface polish once real calls run (elm/media voice engine). Loaded last; overrides only call classes.  - The bar reflows by the STAGE's width (container queries), not the viewport: the stage lives in the message column, whose width depends on the rails. Wide: info \| controls \| chip. Narrow: info + chip on one row, every control on one even row of >= 44px targets. - Person cells top-align (a role line no longer pushes a neighbour down). - Phone: the More menu is a bottom sheet; an expanded/fullscreen stage is a full-screen call screen sized by 100dvh with safe-area insets (iOS Safari, installed PWA); the docked bar drops the bottom inset it only needs at the screen edg

## G2. Custom properties — every definition, theme value, runtime writer and use

Status counts: **theme-only, unused** 10 · **ok** 126 · **theme-overridden, unused** 1 · **theme-overridden** 16 · **unused** 11 · **runtime-written** 11 · **theme-only** 4.

Status legend: `ok` defined in CSS and used; `theme-overridden` defined in CSS **and** re-written inline on `<html>` by every theme commit (the inline value wins); `theme-only` used but defined only by the theme maps (undefined until the first appearanceApply); `runtime-written` set by Elm inline style or ports.js; `unused` defined, never read; `UNDEFINED` read without a fallback and defined nowhere; `undefined-with-fallback` read only with a fallback.

| token | status | defined at | first value | theme values (inline on <html>) | runtime writer | uses | used at |
|---|---|---|---|---|---|---|---|
| `--brand-action` | theme-only, unused |  |  | `#ff987d` ocean |  | 0 |  |
| `--ci` | ok | 27 definitions: app.css:3168,3169,3170,3171,3172,3173,3174,3175,3176,3177,3178,3179,3180,3181,3182 · calls-c8.css:9,10 · calls-c6.css:13 · calls-c4.css:9,10,11,12,13,14,15,16,17 (selectors in style-map.json) | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | app.css:3165,3166 |
| `--claim-i` | ok | 5 definitions: pol-public.css:632,640,641,642,643 (selectors in style-map.json) | `var(--pub-i-chevron)` |  |  | 2 | pol-public.css:637,638 |
| `--composer-h` | ok | app.css:96 | `64px` |  |  | 4 | app.css:3894 · ui-sheets.css:790,812,1049 |
| `--context-w` | ok | app.css:94 | `240px` |  |  | 1 | app.css:3427 |
| `--danger` | theme-only, unused |  |  | `var(--shu)` all |  | 0 |  |
| `--dur` | theme-overridden, unused | app.css:79<br>app.css:3921 @@media (prefers-reduced-motion: reduce)<br>app.css:3937 `:root[data-reduce-motion='true']` | `var(--dur-base)` | `220ms` ocean,obsidian,frost<br>`260ms` tide,reef,teal<br>`240ms` abyss,onyx,shu,hisui,kohaku,terracotta,vermillion,sapphire,slate<br>`200ms` pearl<br>`180ms` ink<br>`250ms` pine |  | 0 |  |
| `--dur-base` | ok | app.css:78<br>app.css:3920 @@media (prefers-reduced-motion: reduce)<br>app.css:3936 `:root[data-reduce-motion='true']` | `220ms` |  |  | 13 | app.css:79,2884 · pol-thread.css:363 · pol-roster.css:353 · polish.css:347 · ui-sheets.css:61,73,311,801,958,972,1058,1067 |
| `--dur-fast` | ok | app.css:77<br>app.css:3919 @@media (prefers-reduced-motion: reduce)<br>app.css:3935 `:root[data-reduce-motion='true']` | `160ms` |  |  | 61 | app.css×9 · pol-stats.css×9 · pol-studio.css×25 · pol-shell.css×2 · pol-thread.css×2 · pol-roster.css×1 · pol-public.css×4 · calls-c8.css×1 · polish.css×1 · account2.css×2 · roomsettings.css×1 · calls-c6.css×1 · ui-sheets.css×3 |
| `--dur-micro` | ok | app.css:76<br>app.css:3918 @@media (prefers-reduced-motion: reduce)<br>app.css:3934 `:root[data-reduce-motion='true']` | `100ms` |  |  | 7 | pol-thread.css:148,214,419,1017 · pol-roster.css:174 · ui-sheets.css:445,627 |
| `--ease` | theme-overridden | app.css:75 | `cubic-bezier(0.16, 1, 0.3, 1)` | `cubic-bezier(0.16, 1, 0.3, 1)` all |  | 73 | app.css×6 · pol-stats.css×9 · pol-studio.css×25 · pol-shell.css×2 · pol-thread.css×7 · pol-roster.css×3 · pol-public.css×4 · calls-c8.css×1 · polish.css×2 · account2.css×2 · roomsettings.css×1 · calls-c6.css×1 · ui-sheets.css×10 |
| `--elev-0` | unused | app.css:84 | `none` |  |  | 0 |  |
| `--elev-1` | unused | app.css:85 | `0 1px 0 color-mix(in oklab, var(--onyx-text) 5%, t…` |  |  | 0 |  |
| `--elev-2` | ok | app.css:86 | `0 14px 36px -28px color-mix(in oklab, var(--onyx-b…` |  |  | 6 | app.css:1906,3613,3695 · pol-thread.css:211 · pol-public.css:555,835 |
| `--elev-3` | ok | app.css:87 | `0 28px 56px -32px color-mix(in oklab, #000 90%, tr…` |  |  | 16 | app.css:3764 · pol-shell.css:432,1292 · pol-thread.css:277,586,1251 · pol-roster.css:352 · polish.css:47 · calls-c6.css:104 · ui-sheets.css:69,413,800,803,804,805,971 |
| `--focus-offset` | ok | app.css:72 | `-1px` |  |  | 11 | app.css:3822 · pol-stats.css:342 · pol-shell.css:758 · pol-thread.css:192,243 · pol-roster.css:153,217 · calls-c8.css:35 · polish.css:101,239 · ui-sheets.css:241 |
| `--focus-ring` | ok | app.css:71 | `1px solid var(--onyx-accent)` |  |  | 19 | app.css:3821 · pol-stats.css:62,342,750 · pol-shell.css:758 · pol-thread.css:192,243,479 · pol-roster.css:153,217 · calls-c8.css:35 · calls-c11.css:157 · polish.css:100,238 · account2.css:37,57,120 · calls-c6.css:81 · ui-sheets.css:241 |
| `--font-mono` | ok | app.css:35 | `'JetBrains Mono Variable', ui-monospace, 'SFMono-R…` |  |  | 42 | app.css×10 · pol-stats.css×4 · pol-studio.css×5 · pol-shell.css×3 · pol-thread.css×3 · pol-public.css×12 · calls-c8.css×1 · polish.css×2 · account2.css×1 · ui-sheets.css×1 |
| `--gap-row` | unused | app.css:50 | `var(--space-3)` |  |  | 0 |  |
| `--gap-section` | ok | app.css:51 | `var(--space-6)` |  |  | 1 | account2.css:6 |
| `--gap-tight` | unused | app.css:49 | `var(--space-2)` |  |  | 0 |  |
| `--gold` | theme-overridden | app.css:26 | `#c9a24a` | `#b4bfca` ocean<br>`#5dcbd1` tide<br>`#51a0ad` abyss<br>`#f19173` reef<br>`#c9a24a` onyx<br>`#7fa5b8` obsidian<br>`#896100` pearl<br>`#bbb7b1` ink<br>`#f4733c` shu<br>`#70c5a0` hisui<br>`#a5a51a` pine<br>`#eea563` kohaku<br>`#e8777a` terracotta<br>`#ef7179` vermillion<br>`#00aaf3` sapphire<br>`#72ccab` teal<br>`#ae7853` slate<br>`#00768a` frost |  | 8 | app.css:136 · pol-studio.css:553 · pol-thread.css:169,170,176,1129 · pol-public.css:582 · src/View/Studio.elm:1000 |
| `--gold-bright` | theme-overridden | app.css:27 | `#f1d489` | `#f5f7f8` ocean<br>`#92f1f6` tide<br>`#88cedb` abyss<br>`#ffc0ac` reef<br>`#f1d489` onyx<br>`#add1e3` obsidian<br>`#ad7c0a` pearl<br>`#dedad5` ink<br>`#ffb294` shu<br>`#a5e9c9` hisui<br>`#cdcf62` pine<br>`#ffcca1` kohaku<br>`#ffafae` terracotta<br>`#ffafb0` vermillion<br>`#8ad1ff` sapphire<br>`#9feacd` teal<br>`#d8a582` slate<br>`#0096af` frost |  | 3 | pol-shell.css:129 · pol-thread.css:1131 · src/View/Studio.elm:1040 |
| `--gold-deep` | theme-only, unused |  |  | `#71808e` ocean<br>`#3e999d` tide<br>`#236671` abyss<br>`#a9573d` reef<br>`#8c6c2c` onyx<br>`#516f7e` obsidian<br>`#5f4200` pearl<br>`#908c88` ink<br>`#a43e08` shu<br>`#3e8165` hisui<br>`#686800` pine<br>`#a46c36` kohaku<br>`#9c4346` terracotta<br>`#a13d46` vermillion<br>`#006b9b` sapphire<br>`#42876e` teal<br>`#73492b` slate<br>`#00515f` frost |  | 0 |  |
| `--h` | runtime-written |  |  |  | Elm inline style View/Stats.elm:326<br>Elm inline style View/Stats.elm:539<br>Elm inline style View/Stats.elm:573<br>Elm inline style View/Stats.elm:1033 | 2 | pol-stats.css:716,810 |
| `--heat` | runtime-written |  |  |  | Elm inline style View/Stats.elm:633 | 1 | pol-stats.css:831 |
| `--ink` | theme-overridden | app.css:18 | `#000101` | `#202429` ocean<br>`#00060b` tide<br>`#000102` abyss<br>`#000407` reef<br>`#000101` onyx<br>`#000001` obsidian,ink<br>`#f5f0e5` pearl<br>`#080100` shu<br>`#000401` hisui<br>`#000300` pine<br>`#050200` kohaku<br>`#060100` terracotta,vermillion<br>`#000208` sapphire<br>`#000302` teal<br>`#040301` slate<br>`#e3f7fe` frost |  | 3 | pol-studio.css:1227,1390,1448 |
| `--ink-2` | theme-only, unused |  |  | `#262c32` ocean<br>`#000a11` tide<br>`#000103` abyss<br>`#00060a` reef<br>`#010203` onyx<br>`#000101` obsidian<br>`#f1ebe1` pearl<br>`#010102` ink<br>`#0b0201` shu<br>`#000601` hisui<br>`#010501` pine<br>`#080300` kohaku<br>`#0a0200` terracotta<br>`#0a0101` vermillion<br>`#00040d` sapphire<br>`#000603` teal<br>`#060503` slate<br>`#def2f8` frost |  | 0 |  |
| `--kb-inset` | runtime-written | app.css:111 | `0px` |  | ports.js setProperty ports.js:9978 | 10 | app.css:2038,2039 · pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1666 · ui-sheets.css:1042,1045,1047,1049,1078 |
| `--lapis` | theme-overridden | app.css:30 | `#6996c5` | `#65adf5` ocean<br>`#00b8ed` tide<br>`#0091cb` abyss<br>`#0094bc` reef<br>`#6996c5` onyx<br>`#6a9eca` obsidian<br>`#0065b0` pearl<br>`#c9c3bc` ink<br>`#e74142` shu<br>`#00a149` hisui<br>`#3b9f32` pine<br>`#d98b09` kohaku<br>`#d55c27` terracotta<br>`#de5034` vermillion<br>`#0089ea` sapphire<br>`#009d82` teal<br>`#949d7b` slate<br>`#036884` frost |  | 4 | app.css:1860 · pol-studio.css:552,1449 · pol-public.css:581 |
| `--lapis-bright` | theme-overridden | app.css:22 | `#9cc2ea` | `#65adf5` ocean<br>`#9ae0ff` tide<br>`#58c4ff` abyss<br>`#0bc9ff` reef<br>`#9cc2ea` onyx<br>`#9ecdf6` obsidian<br>`#086fbe` pearl<br>`#ece7e0` ink<br>`#ff958d` shu<br>`#5bd47d` hisui<br>`#79d070` pine<br>`#ffb75d` kohaku<br>`#ff9970` terracotta<br>`#ff9781` vermillion<br>`#7cbdff` sapphire<br>`#00d5b2` teal<br>`#bdc6a5` slate<br>`#2f7791` frost |  | 9 | app.css:1858,1861,2061,3148 · pol-studio.css:1291,1325,1385,1386,1422 |
| `--lapis-deep` | theme-overridden | app.css:23 | `#385b7e` | `#397db8` ocean<br>`#007093` tide<br>`#005477` abyss<br>`#00556e` reef<br>`#385b7e` onyx<br>`#3c6588` obsidian<br>`#003e70` pearl<br>`#9d9892` ink<br>`#940014` shu<br>`#005e28` hisui<br>`#065f00` pine<br>`#8a5600` kohaku<br>`#832e00` terracotta<br>`#8e1900` vermillion<br>`#004f8b` sapphire<br>`#005b4b` teal<br>`#656c51` slate<br>`#003c4d` frost |  | 2 | pol-studio.css:556,1322 |
| `--leading-body` | ok | app.css:65 | `1.5` |  |  | 39 | app.css×2 · pol-stats.css×19 · pol-studio.css×6 · pol-thread.css×7 · pol-public.css×3 · polish.css×1 · ui-sheets.css×1 |
| `--leading-snug` | ok | app.css:64 | `1.35` |  |  | 41 | app.css×4 · pol-stats.css×10 · pol-studio.css×7 · pol-shell.css×3 · pol-thread.css×7 · pol-roster.css×2 · pol-public.css×3 · calls-c8.css×1 · calls-c11.css×1 · account2.css×1 · ui-sheets.css×2 |
| `--leading-tight` | ok | app.css:63 | `1.15` |  |  | 23 | pol-stats.css:82,108,148,239,281,365,380,413,507,580,642,643,681 · pol-studio.css:88,564,572,993,998 · pol-shell.css:1052 · pol-thread.css:515,618,889 · pol-public.css:35 |
| `--line` | theme-overridden | app.css:33 | `color-mix(in oklab, var(--paper) 40%, transparent)` | `color-mix(in oklab, var(--paper) 40%…` ocean<br>`color-mix(in oklab, var(--paper) 16%…` tide<br>`color-mix(in oklab, var(--paper) 11%…` abyss<br>`color-mix(in oklab, var(--paper) 14%…` reef,pine,terracotta,vermillion,sapphire,teal<br>`color-mix(in oklab, var(--paper) 13%…` onyx,slate<br>`color-mix(in oklab, var(--paper) 12%…` obsidian<br>`color-mix(in oklab, var(--lapis) 28%…` pearl,kohaku<br>`color-mix(in oklab, var(--lapis) 25%…` ink<br>`color-mix(in oklab, var(--shu) 18%, …` shu<br>`color-mix(in oklab, var(--lapis) 22%…` hisui<br>`color-mix(in oklab, var(--paper) 18%…` frost |  | 3 | app.css:1858,1871,1877 |
| `--line-faint` | theme-only, unused |  |  | `color-mix(in oklab, var(--paper) 6%,…` ocean,onyx<br>`color-mix(in oklab, var(--paper) 8%,…` tide<br>`color-mix(in oklab, var(--paper) 5%,…` abyss,obsidian<br>`color-mix(in oklab, var(--gold) 12%,…` reef,terracotta,vermillion,sapphire<br>`color-mix(in oklab, var(--lapis) 12%…` pearl,kohaku<br>`color-mix(in oklab, var(--lapis) 10%…` ink,slate<br>`color-mix(in oklab, var(--shu) 8%, t…` shu<br>`color-mix(in oklab, var(--lapis) 9%,…` hisui<br>`color-mix(in oklab, var(--gold) 11%,…` pine,teal<br>`color-mix(in oklab, var(--gold) 14%,…` frost |  | 0 |  |
| `--mobile-nav-h` | ok | app.css:95<br>pol-shell.css:1205 `.onyx-frame:not([data-convo="false"]):not([data-na` @@media (max-width: 767.98px) | `56px` |  |  | 8 | app.css:3879,3894 · pol-shell.css:1410,1416 · polish.css:371 · calls-c6.css:200 · ui-sheets.css:812,1049 |
| `--nav-rail-w` | ok | app.css:92 | `56px` |  |  | 3 | app.css:3427,3522 · pol-shell.css:1141 |
| `--nick-tint` | runtime-written | pol-thread.css:12 | `var(--onyx-line)` |  | Elm inline style View/Thread.elm:532<br>Elm inline style View/Thread.elm:890 | 2 | app.css:141 · pol-thread.css:926 |
| `--ok` | theme-only |  |  | `#5bc78e` ocean,tide,abyss,reef,onyx,obsidian,ink,shu,hisui,pine,kohaku,terracotta,vermillion,sapphire,teal,slate<br>`#15915c` pearl,frost |  | 2 | pol-studio.css:1317 · src/View/Studio.elm:1001 |
| `--onyx-accent` | ok | app.css:12 | `#46c08a` |  |  | 209 | app.css×114 · pol-stats.css×12 · pol-studio.css×13 · pol-shell.css×13 · pol-thread.css×12 · pol-public.css×26 · polish.css×4 · account2.css×4 · roomsettings.css×3 · calls-c6.css×1 · calls-c4.css×2 · ui-sheets.css×4 · calls-engine.css×1 |
| `--onyx-accent-ink` | ok | app.css:13 | `#06281a` |  |  | 39 | app.css×17 · pol-stats.css×1 · pol-studio.css×3 · pol-shell.css×5 · pol-thread.css×4 · pol-public.css×4 · polish.css×1 · account2.css×2 · roomsettings.css×1 · ui-sheets.css×1 |
| `--onyx-avatar-bg` | runtime-written | pol-thread.css:13 | `var(--onyx-panel-2)` |  | Elm inline style Avatar.elm:213 | 1 | app.css:127 |
| `--onyx-avatar-fg` | runtime-written | pol-thread.css:14 | `var(--onyx-text)` |  | Elm inline style Avatar.elm:214 | 1 | app.css:126 |
| `--onyx-bad` | ok | app.css:15 | `#e5484d` |  |  | 87 | app.css×33 · pol-stats.css×2 · pol-studio.css×9 · pol-shell.css×8 · pol-thread.css×11 · pol-public.css×4 · calls-c8.css×1 · account2.css×4 · roomsettings.css×2 · calls-c6.css×5 · calls-c4.css×4 · ui-sheets.css×4 |
| `--onyx-bg` | ok | app.css:5 | `#0b0e12` |  |  | 98 | app.css×28 · pol-stats.css×4 · pol-studio.css×16 · pol-shell.css×13 · pol-thread.css×11 · pol-roster.css×1 · pol-public.css×10 · calls-c8.css×3 · calls-c11.css×1 · polish.css×2 · roomsettings.css×2 · calls-c4.css×4 · ui-sheets.css×3 |
| `--onyx-dim` | ok | app.css:10<br>app.css:3145 `:root[data-high-contrast='true']` | `#9aa3ad` |  |  | 550 | app.css×189 · pol-stats.css×12 · pol-studio.css×39 · pol-shell.css×60 · pol-thread.css×75 · pol-roster.css×8 · pol-public.css×86 · calls-c8.css×9 · calls-c11.css×4 · polish.css×10 · account2.css×9 · roomsettings.css×13 · calls-c6.css×7 · calls-c4.css×8 · ui-sheets.css×21 |
| `--onyx-faint` | ok | app.css:11<br>app.css:3146 `:root[data-high-contrast='true']` | `#5d6670` |  |  | 166 | app.css×60 · pol-stats.css×2 · pol-studio.css×23 · pol-shell.css×19 · pol-thread.css×7 · pol-roster.css×8 · pol-public.css×23 · calls-c8.css×3 · polish.css×3 · account2.css×1 · roomsettings.css×3 · calls-c6.css×2 · calls-c4.css×1 · ui-sheets.css×11 |
| `--onyx-i-alert` | ok | ui-sheets.css:36 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:937,937 |
| `--onyx-i-bell` | ok | ui-sheets.css:34 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 4 | ui-sheets.css:557,558,570,571 |
| `--onyx-i-bolt` | ok | ui-sheets.css:31 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:455,456 |
| `--onyx-i-check` | unused | ui-sheets.css:33 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 0 |  |
| `--onyx-i-chevron` | ok | ui-sheets.css:32 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:641,642 |
| `--onyx-i-close` | ok | ui-sheets.css:27 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 4 | ui-sheets.css:49,50,250,251 |
| `--onyx-i-contrast` | ok | ui-sheets.css:37 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:945,946 |
| `--onyx-i-hash` | ok | ui-sheets.css:29 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:458,458 |
| `--onyx-i-link` | unused | ui-sheets.css:35 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 0 |  |
| `--onyx-i-mail` | unused | ui-sheets.css:38 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 0 |  |
| `--onyx-i-person` | ok | ui-sheets.css:30 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:459,459 |
| `--onyx-i-search` | ok | ui-sheets.css:28 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:428,429 |
| `--onyx-line` | ok | app.css:8<br>app.css:3144 `:root[data-high-contrast='true']` | `#232b36` |  |  | 498 | app.css×182 · pol-stats.css×8 · pol-studio.css×47 · pol-shell.css×41 · pol-thread.css×61 · pol-roster.css×6 · pol-public.css×76 · calls-c8.css×7 · calls-c11.css×4 · polish.css×11 · account2.css×8 · roomsettings.css×9 · calls-c6.css×2 · calls-c4.css×6 · ui-sheets.css×29 · calls-engine.css×1 |
| `--onyx-nav-glyph` | ok | 5 definitions: app.css:2198,2199,2200,2201,2202 (selectors in style-map.json) | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | app.css:2194,2195 |
| `--onyx-panel` | ok | app.css:6 | `#12161c` |  |  | 136 | app.css×46 · pol-stats.css×4 · pol-studio.css×14 · pol-shell.css×11 · pol-thread.css×18 · pol-roster.css×4 · pol-public.css×23 · calls-c8.css×2 · calls-c11.css×1 · polish.css×2 · account2.css×2 · calls-c6.css×1 · ui-sheets.css×7 · pol-ios.css×1 |
| `--onyx-panel-2` | ok | app.css:7 | `#181e27` |  |  | 211 | app.css×61 · pol-stats.css×5 · pol-studio.css×18 · pol-shell.css×33 · pol-thread.css×40 · pol-roster.css×6 · pol-public.css×14 · calls-c8.css×2 · polish.css×4 · account2.css×2 · roomsettings.css×6 · calls-c6.css×1 · calls-c4.css×3 · ui-sheets.css×16 |
| `--onyx-text` | ok | app.css:9 | `#e8e6e1` |  |  | 438 | app.css×152 · pol-stats.css×9 · pol-studio.css×52 · pol-shell.css×52 · pol-thread.css×56 · pol-roster.css×7 · pol-public.css×49 · calls-c8.css×10 · polish.css×10 · account2.css×8 · roomsettings.css×9 · calls-c6.css×1 · calls-c4.css×4 · ui-sheets.css×19 |
| `--onyx-warn` | ok | app.css:14 | `#d9a13b` |  |  | 91 | app.css×40 · pol-stats.css×3 · pol-studio.css×11 · pol-shell.css×7 · pol-thread.css×6 · pol-public.css×4 · calls-c8.css×4 · calls-c11.css×6 · account2.css×3 · roomsettings.css×1 · calls-c4.css×5 · ui-sheets.css×1 |
| `--pad-control` | unused | app.css:52 | `var(--space-3)` |  |  | 0 |  |
| `--pad-panel` | ok | app.css:53 | `var(--space-4)` |  |  | 2 | app.css:3750 · account2.css:6 |
| `--pad-panel-lg` | unused | app.css:54 | `var(--space-5)` |  |  | 0 |  |
| `--paper` | theme-overridden | app.css:24 | `#eae8e0` | `#f5f7f8` ocean<br>`#d1e1e9` tide<br>`#d4e0e8` abyss<br>`#d2e1e8` reef<br>`#eae8e0` onyx<br>`#d6dfe7` obsidian<br>`#251e15` pearl<br>`#f0eae2` ink<br>`#ebdad5` shu<br>`#d6e2d8` hisui<br>`#d8e1d6` pine<br>`#e4ddd0` kohaku<br>`#e8dbd4` terracotta<br>`#eadad6` vermillion<br>`#d4e0eb` sapphire<br>`#d3e2dc` teal<br>`#eae7e2` slate<br>`#202b2e` frost |  | 9 | app.css:33 · pol-studio.css:1226,1287,1321,1334,1343,1362,1418,1481 |
| `--paper-dim` | theme-overridden | app.css:25 | `#a4a19a` | `#b4bfca` ocean<br>`#8c9ba2` tide<br>`#8f9aa1` abyss<br>`#8d9ba2` reef<br>`#a4a19a` onyx<br>`#9199a1` obsidian<br>`#494136` pearl<br>`#a9a49c` ink<br>`#a49490` shu<br>`#919c92` hisui<br>`#939b91` pine<br>`#9e988b` kohaku<br>`#a1968f` terracotta<br>`#a39591` vermillion<br>`#8f9aa5` sapphire<br>`#8e9c97` teal<br>`#a7a49e` slate<br>`#546063` frost |  | 5 | app.css:1871,1873 · pol-studio.css:1312,1469,1491 |
| `--paper-mute` | theme-only |  |  | `#b4bfca` ocean<br>`#536770` tide<br>`#56666f` abyss<br>`#54676f` reef<br>`#6e6c63` onyx<br>`#5a656e` obsidian<br>`#71675a` pearl<br>`#706b63` ink<br>`#725e59` shu<br>`#5a685b` hisui<br>`#5c675a` pine<br>`#6a6252` kohaku<br>`#6f6057` terracotta<br>`#715e5a` vermillion<br>`#576573` sapphire<br>`#556861` teal<br>`#716e68` slate<br>`#7a8d92` frost |  | 9 | pol-studio.css:1256,1300,1316,1326,1370,1413,1419,1477,1494 |
| `--pg-bad` | ok | pol-stats.css:22 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-bad)` |  |  | 1 | pol-stats.css:460 |
| `--pg-bar` | ok | pol-stats.css:23 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `color-mix(in oklab, var(--onyx-text) 58%, var(--on…` |  |  | 3 | pol-stats.css:718,812,911 |
| `--pg-dim` | ok | pol-stats.css:18 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-dim)` |  |  | 29 | pol-stats.css:70,422,463,470,484,514,538,591,601,605,621,644,676,769,792,819,839,841,852,858,881,891,900,907,916,926,960,961,976 |
| `--pg-faint` | ok | pol-stats.css:19 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-faint)` |  |  | 23 | pol-stats.css:449,554,604,606,646,691,695,726,731,763,793,814,815,824,833,853,866,906,913,940,942,965,968 |
| `--pg-line` | ok | pol-stats.css:14 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-line)` |  |  | 39 | pol-stats.css×39 |
| `--pg-live` | ok | pol-stats.css:20 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-accent)` |  |  | 3 | pol-stats.css:455,565,602 |
| `--pg-panel` | ok | pol-stats.css:15 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-panel)` |  |  | 7 | pol-stats.css:437,626,640,685,826,905,956 |
| `--pg-raised` | ok | pol-stats.css:16 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-panel-2)` |  |  | 2 | pol-stats.css:105,503 |
| `--pg-select` | ok | pol-stats.css:24 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `color-mix(in oklab, var(--onyx-accent) 10%, transp…` |  |  | 2 | pol-stats.css:689,974 |
| `--pg-text` | ok | pol-stats.css:17 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-text)` |  |  | 24 | pol-stats.css:27,57,104,489,502,545,600,626,685,688,720,729,768,794,820,831,880,883,905,908,912,933,959,969 |
| `--pg-warn` | ok | pol-stats.css:21 `.ui-root.r:is(.stats-page, .status-route, .roadmap` | `var(--onyx-warn)` |  |  | 5 | pol-stats.css:458,603,699,770,842 |
| `--pip-ix` | runtime-written |  |  |  | Elm inline style View/CallDock.elm:338 | 4 | calls-c6.css:109,114,119,124 |
| `--pip-iy` | runtime-written |  |  |  | Elm inline style View/CallDock.elm:339 | 4 | calls-c6.css:110,115,120,125 |
| `--pt-glyph` | ok | 27 definitions: pol-thread.css:66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92 (selectors in style-map.json) | `var(--pt-i-react)` |  |  | 2 | pol-thread.css:33,34 |
| `--pt-gutter` | ok | pol-thread.css:17<br>pol-thread.css:1891 @@media (max-width: 767.98px) | `calc(2rem + var(--space-2) + var(--space-3))` |  |  | 4 | pol-thread.css:100,144,488,559 |
| `--pt-hover` | ok | pol-thread.css:15 | `color-mix(in oklab, var(--onyx-panel) 72%, transpa…` |  |  | 2 | pol-thread.css:114,193 |
| `--pt-i-arrow-down` | ok | pol-thread.css:48 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:76 |
| `--pt-i-attach` | ok | pol-thread.css:44 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:72 · polish.css:83 |
| `--pt-i-calendar` | ok | pol-thread.css:54 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:82 · polish.css:85 |
| `--pt-i-chart` | ok | pol-thread.css:55 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:83 · polish.css:87 |
| `--pt-i-check` | ok | pol-thread.css:46 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:74 |
| `--pt-i-chevron-down` | ok | pol-thread.css:50 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:78 |
| `--pt-i-chevron-up` | ok | pol-thread.css:49 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:77 |
| `--pt-i-clock` | ok | pol-thread.css:53 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:81 · polish.css:84 |
| `--pt-i-download` | ok | pol-thread.css:59 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:87 |
| `--pt-i-emoji` | ok | pol-thread.css:39 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:67 · polish.css:86 |
| `--pt-i-file` | ok | pol-thread.css:52 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:80 |
| `--pt-i-hash` | ok | pol-thread.css:61 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:89 |
| `--pt-i-image` | ok | pol-thread.css:57 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:85 |
| `--pt-i-link` | ok | pol-thread.css:58 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:86 |
| `--pt-i-lock` | ok | pol-thread.css:64 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:92 |
| `--pt-i-message` | ok | pol-thread.css:63 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:91 |
| `--pt-i-more` | ok | pol-thread.css:42 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 3 | pol-thread.css:70,573,574 |
| `--pt-i-people` | ok | pol-thread.css:62 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:90 |
| `--pt-i-pin` | ok | pol-thread.css:60 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:88 |
| `--pt-i-plus` | ok | pol-thread.css:43 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 5 | pol-thread.css:71,1096,1097 · polish.css:78,79 |
| `--pt-i-react` | ok | pol-thread.css:38 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:66 |
| `--pt-i-reply` | ok | pol-thread.css:40 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:68 |
| `--pt-i-search` | ok | pol-thread.css:51 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:79 |
| `--pt-i-send` | ok | pol-thread.css:45 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:73 |
| `--pt-i-slash` | ok | pol-thread.css:56 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:84 |
| `--pt-i-thread` | ok | pol-thread.css:41 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:69 |
| `--pt-i-x` | ok | pol-thread.css:47 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:75 |
| `--pt-seam` | ok | pol-thread.css:16 | `color-mix(in oklab, var(--onyx-line) 55%, var(--on…` |  |  | 3 | pol-thread.css:704,741,760 |
| `--pub-gutter` | ok | pol-public.css:15 `.public-frame`<br>pol-public.css:257 `.public-frame` @@media (max-width: 768px)<br>pol-public.css:343 `.public-frame` @@media (max-width: 359px) | `var(--space-6, 24px)` |  |  | 10 | pol-public.css:87,87,174,174,194,194,210,283,1302,1303 |
| `--pub-header-h` | ok | pol-public.css:16 `.public-frame`<br>pol-public.css:257 `.public-frame` @@media (max-width: 768px) | `64px` |  |  | 9 | pol-public.css:85,271,906,995,1050,1051,1177,1262,1455 |
| `--pub-i-arrow` | ok | pol-public.css:19 `.public-frame` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 6 | pol-public.css:464,465,614,615,711,712 |
| `--pub-i-chevron` | ok | pol-public.css:18 `.public-frame` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 7 | pol-public.css:329,330,632,734,735,1146,1147 |
| `--pub-i-refresh` | ok | pol-public.css:468 `.pub-refresh` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-public.css:469,470 |
| `--pub-measure` | ok | pol-public.css:14 `.public-frame` | `var(--shell-measure, 1180px)` |  |  | 4 | pol-public.css:84,174,191,208 |
| `--r-0` | theme-only, unused |  |  | `0px` all |  | 0 |  |
| `--r-md` | theme-only, unused |  |  | `8px` ocean,abyss<br>`12px` tide<br>`11px` reef<br>`4px` onyx,pearl,shu,hisui,kohaku<br>`3px` obsidian<br>`2px` ink<br>`7px` pine<br>`9px` terracotta,slate<br>`6px` vermillion<br>`5px` sapphire<br>`13px` teal<br>`10px` frost |  | 0 |  |
| `--r-pill` | theme-overridden | app.css:34 | `999px` | `999px` all |  | 35 | app.css×2 · pol-stats.css×5 · pol-studio.css×9 · pol-shell.css×9 · pol-thread.css×8 · pol-roster.css×1 · account2.css×1 |
| `--r-sm` | theme-only, unused |  |  | `4px` ocean,terracotta,slate<br>`6px` tide,teal<br>`3px` abyss,pine,vermillion<br>`5px` reef,frost<br>`2px` onyx,pearl,shu,hisui,kohaku,sapphire<br>`1px` obsidian<br>`0px` ink |  | 0 |  |
| `--radius` | ok | app.css:83 | `6px` |  |  | 293 | app.css×83 · pol-stats.css×16 · pol-studio.css×25 · pol-shell.css×25 · pol-thread.css×44 · pol-roster.css×5 · pol-public.css×41 · calls-c8.css×8 · calls-c11.css×3 · account2.css×5 · roomsettings.css×9 · calls-c6.css×3 · calls-c4.css×4 · ui-sheets.css×20 · calls-engine.css×2 |
| `--room-heat` | runtime-written |  |  |  | Elm inline style View/RoomSettings.elm:1177 | 1 | roomsettings.css:340 |
| `--safe-bottom` | ok | app.css:109 | `env(safe-area-inset-bottom, 0px)` |  |  | 9 | pol-shell.css:1206,1289,1411 · pol-thread.css:360,952 · pol-roster.css:349,367 · pol-ios.css:92,100 |
| `--safe-left` | ok | app.css:110 | `env(safe-area-inset-left, 0px)` |  |  | 1 | pol-ios.css:84 |
| `--safe-right` | ok | app.css:108 | `env(safe-area-inset-right, 0px)` |  |  | 1 | pol-ios.css:85 |
| `--safe-top` | ok | app.css:107 | `env(safe-area-inset-top, 0px)` |  |  | 6 | pol-roster.css:349,365,366 · pol-ios.css:83,86,121 |
| `--scrub-heat` | ok | polish.css:208 `.time-scrubber__bar` | `0` |  |  | 1 | polish.css:224 |
| `--seam` | theme-only |  |  | `color-mix(in oklab, var(--lapis) 28%…` ocean,slate<br>`color-mix(in oklab, var(--lapis) 50%…` tide<br>`color-mix(in oklab, var(--lapis) 36%…` abyss,kohaku,teal<br>`color-mix(in oklab, var(--lapis) 40%…` reef,shu,terracotta,vermillion,sapphire<br>`color-mix(in oklab, var(--gold) 40%,…` onyx<br>`color-mix(in oklab, var(--lapis) 30%…` obsidian<br>`color-mix(in oklab, var(--gold) 55%,…` pearl<br>`color-mix(in oklab, var(--paper) 16%…` ink<br>`color-mix(in oklab, var(--lapis) 38%…` hisui,pine<br>`color-mix(in oklab, var(--lapis) 34%…` frost |  | 1 | pol-studio.css:1228 |
| `--seam-faint` | theme-only |  |  | `color-mix(in oklab, var(--lapis) 12%…` ocean,obsidian,slate<br>`color-mix(in oklab, var(--lapis) 20%…` tide<br>`color-mix(in oklab, var(--lapis) 13%…` abyss<br>`color-mix(in oklab, var(--lapis) 16%…` reef,shu,terracotta,vermillion,sapphire<br>`color-mix(in oklab, var(--gold) 15%,…` onyx<br>`color-mix(in oklab, var(--gold) 24%,…` pearl<br>`color-mix(in oklab, var(--paper) 7%,…` ink<br>`color-mix(in oklab, var(--lapis) 15%…` hisui,pine,kohaku,teal<br>`color-mix(in oklab, var(--lapis) 14%…` frost |  | 6 | pol-studio.css:1238,1277,1278,1288,1359,1465 |
| `--sheet-close` | ok | 4 definitions: ui-sheets.css:23,292,433,841 (selectors in style-map.json) | `36px` |  |  | 4 | ui-sheets.css:224,225,226,227 |
| `--sheet-grip-zone` | ok | ui-sheets.css:24 | `22px` |  |  | 9 | ui-sheets.css:315,325,343,855,911,912,912,968,1082 |
| `--sheet-head-pad` | ok | ui-sheets.css:17 | `14px` |  |  | 4 | ui-sheets.css:158,586,591,721 |
| `--sheet-max-h` | ok | 4 definitions: ui-sheets.css:22,293,399,1037 (selectors in style-map.json) | `min(calc(100dvh - 64px), 860px)` |  |  | 5 | ui-sheets.css:65,307,667,872,1081 |
| `--sheet-pad` | ok | ui-sheets.css:15<br>ui-sheets.css:291 @@media (max-width: 767.98px) | `20px` |  |  | 31 | pol-shell.css×1 · ui-sheets.css×30 |
| `--sheet-top` | unused | ui-sheets.css:16 | `var(--sheet-pad)` |  |  | 0 |  |
| `--sheet-veil` | ok | ui-sheets.css:25 | `color-mix(in srgb, #000 58%, transparent)` |  |  | 5 | ui-sheets.css:60,407,849,957,1058 |
| `--sheet-w-lg` | ok | ui-sheets.css:20 | `760px` |  |  | 2 | ui-sheets.css:111,679 |
| `--sheet-w-md` | ok | ui-sheets.css:19 | `560px` |  |  | 1 | ui-sheets.css:104 |
| `--sheet-w-side` | ok | ui-sheets.css:21 | `440px` |  |  | 1 | ui-sheets.css:114 |
| `--sheet-w-sm` | ok | ui-sheets.css:18 | `440px` |  |  | 1 | ui-sheets.css:109 |
| `--shell-measure` | ok | app.css:91 | `1180px` |  |  | 2 | app.css:3480 · pol-public.css:14 |
| `--shi` | ok | 23 definitions: pol-shell.css:527,528,529,530,531,532,533,534,535,536,537,538,554,555,556,557,558,559,560,561,562,563,982 (selectors in style-map.json) | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 4 | pol-shell.css:524,525,551,552 |
| `--shu` | theme-overridden | app.css:31 | `#e95145` | `#ff6f61` ocean<br>`#ff7a6c` tide<br>`#f0594b` abyss<br>`#ff6f5e` reef<br>`#e95145` onyx<br>`#e95047` obsidian,pine,sapphire<br>`#c83319` pearl<br>`#d8412c` ink<br>`#e9523b` shu<br>`#e95146` hisui<br>`#e85336` kohaku<br>`#e8523b` terracotta<br>`#e95144` vermillion<br>`#e95049` teal<br>`#e9523c` slate<br>`#c92f34` frost |  | 6 | app.css:1878 · pol-studio.css:554,1391,1455 · pol-public.css:583 · src/View/Studio.elm:999 |
| `--shu-bright` | theme-overridden | app.css:32 | `#ff7f71` | `#ff9484` ocean<br>`#ffa193` tide<br>`#ff7c6e` abyss<br>`#ff9a86` reef<br>`#ff7f71` onyx,hisui<br>`#ff7f72` obsidian,pine,sapphire<br>`#e5462b` pearl<br>`#ff5d44` ink<br>`#ff806a` shu,slate<br>`#ff8066` kohaku<br>`#ff8069` terracotta<br>`#ff7f70` vermillion<br>`#ff7f74` teal<br>`#e64344` frost |  | 3 | app.css:1877,1879 · pol-studio.css:1453 |
| `--sidebar-w` | ok | app.css:93<br>app.css:3527 @@media (max-width: 959.98px) | `280px` |  |  | 3 | app.css:3427,3522 · pol-shell.css:1141 |
| `--space-0` | unused | app.css:40 | `0` |  |  | 0 |  |
| `--space-1` | ok | app.css:41 | `0.25rem` |  |  | 242 | app.css×59 · pol-stats.css×12 · pol-studio.css×11 · pol-shell.css×31 · pol-thread.css×48 · pol-roster.css×7 · pol-public.css×19 · calls-c8.css×7 · calls-c11.css×2 · polish.css×7 · account2.css×6 · roomsettings.css×11 · calls-c6.css×4 · calls-c4.css×8 · ui-sheets.css×7 · calls-engine.css×3 |
| `--space-2` | ok | app.css:42 | `0.5rem` |  |  | 576 | app.css×106 · pol-stats.css×41 · pol-studio.css×43 · pol-shell.css×79 · pol-thread.css×86 · pol-roster.css×18 · pol-public.css×56 · calls-c8.css×13 · calls-c11.css×10 · polish.css×15 · account2.css×16 · roomsettings.css×23 · calls-c6.css×14 · calls-c4.css×9 · ui-sheets.css×34 · pol-ios.css×1 · calls-engine.css×12 |
| `--space-3` | ok | app.css:43 | `0.75rem` |  |  | 411 | app.css×81 · pol-stats.css×50 · pol-studio.css×35 · pol-shell.css×43 · pol-thread.css×55 · pol-roster.css×5 · pol-public.css×63 · calls-c8.css×5 · calls-c11.css×7 · polish.css×16 · account2.css×3 · roomsettings.css×8 · calls-c6.css×11 · calls-c4.css×2 · ui-sheets.css×26 · pol-ios.css×1 |
| `--space-4` | ok | app.css:44 | `1rem` |  |  | 259 | app.css×31 · pol-stats.css×37 · pol-studio.css×33 · pol-shell.css×19 · pol-thread.css×18 · pol-roster.css×4 · pol-public.css×78 · calls-c11.css×5 · polish.css×5 · calls-c6.css×3 · ui-sheets.css×26 |
| `--space-5` | ok | app.css:45 | `1.25rem` |  |  | 86 | app.css×9 · pol-stats.css×9 · pol-studio.css×13 · pol-shell.css×2 · pol-thread.css×2 · pol-public.css×42 · calls-c8.css×1 · calls-c6.css×2 · ui-sheets.css×6 |
| `--space-6` | ok | app.css:46 | `1.5rem` |  |  | 66 | app.css×9 · pol-stats.css×5 · pol-studio.css×1 · pol-shell.css×2 · pol-thread.css×2 · pol-roster.css×2 · pol-public.css×36 · calls-c6.css×2 · ui-sheets.css×7 |
| `--space-7` | ok | app.css:47 | `2rem` |  |  | 30 | app.css:2295 · pol-stats.css:49,138,232,271,402,404,404 · pol-studio.css:617 · pol-thread.css:495 · pol-public.css:206,337,356,357,526,626,656,683,748,826,962,978,978,989,1419,1445,1457,1581,1622 · ui-sheets.css:546 |
| `--space-8` | ok | app.css:48 | `2.5rem` |  |  | 24 | app.css:1896,2042,2369,2892 · pol-stats.css:334 · pol-shell.css:1050,1050,1070,1434 · pol-public.css:283,503,769,819,821,979,1176,1511,1541,1561,1566,1611,1614,1620 · calls-c6.css:242 |
| `--stone` | theme-overridden | app.css:19 | `#050709` | `#2d333a` ocean<br>`#051820` tide<br>`#010508` abyss<br>`#010f16` reef<br>`#050709` onyx<br>`#020304` obsidian<br>`#e5e0d6` pearl<br>`#030405` ink<br>`#160705` shu<br>`#040f06` hisui<br>`#060e05` pine<br>`#130b01` kohaku<br>`#140904` terracotta<br>`#140604` vermillion<br>`#020b16` sapphire<br>`#010f0a` teal<br>`#110e0a` slate<br>`#d0e4ea` frost |  | 3 | pol-studio.css:1237,1274,1464 |
| `--stone-2` | theme-overridden | app.css:20 | `#0d0f12` | `#343b43` ocean<br>`#12262e` tide<br>`#050c10` abyss<br>`#081a21` reef<br>`#0d0f12` onyx<br>`#07090a` obsidian<br>`#dbd6cc` pearl<br>`#08090c` ink<br>`#21100d` shu<br>`#0c190f` hisui<br>`#0e170d` pine<br>`#1d1507` kohaku<br>`#1f130c` terracotta<br>`#1d0f0b` vermillion<br>`#071420` sapphire<br>`#071914` teal<br>`#1c1a15` slate<br>`#c3d7dd` frost |  | 1 | app.css:1872 |
| `--stone-3` | theme-overridden | app.css:21 | `#16191c` | `#3a424b` ocean<br>`#21343d` tide<br>`#0c1418` abyss<br>`#13252c` reef<br>`#16191c` onyx<br>`#0f1112` obsidian<br>`#d0cbc1` pearl<br>`#0f1113` ink<br>`#2c1a17` shu<br>`#162319` hisui<br>`#182116` pine<br>`#281f11` kohaku<br>`#2a1d16` terracotta<br>`#281814` vermillion<br>`#111e2b` sapphire<br>`#11241e` teal<br>`#282521` slate<br>`#b6cad0` frost |  | 1 | pol-studio.css:1344 |
| `--stone-line` | theme-only, unused |  |  | `#49535e` ocean<br>`#254350` tide<br>`#101c22` abyss<br>`#142f3b` reef<br>`#1e2226` onyx<br>`#15181b` obsidian<br>`#c9c2b5` pearl<br>`#15181c` ink<br>`#3a211c` shu<br>`#1b2e1f` hisui<br>`#1e2c1b` pine<br>`#342812` kohaku<br>`#37241a` terracotta<br>`#351e19` vermillion<br>`#132739` sapphire<br>`#122f26` teal<br>`#343029` slate<br>`#a4c0c8` frost |  | 0 |  |
| `--target-floor` | ok | app.css:70 | `24px` |  |  | 36 | app.css×2 · pol-stats.css×3 · pol-studio.css×3 · pol-thread.css×12 · calls-c8.css×1 · calls-c11.css×3 · polish.css×4 · account2.css×4 · roomsettings.css×2 · calls-c6.css×2 |
| `--target-min` | ok | app.css:69 | `44px` |  |  | 80 | app.css×5 · pol-stats.css×11 · pol-studio.css×9 · pol-thread.css×15 · pol-roster.css×3 · pol-public.css×22 · calls-c8.css×1 · calls-c11.css×3 · polish.css×2 · calls-c6.css×2 · calls-engine.css×7 |
| `--text-2xl` | ok | app.css:62 | `1.5rem` |  |  | 5 | app.css:2298 · pol-stats.css:642 · pol-thread.css:508,513,618 |
| `--text-2xs` | ok | app.css:56 | `0.75rem` |  |  | 124 | app.css×44 · pol-stats.css×14 · pol-studio.css×6 · pol-shell.css×8 · pol-thread.css×14 · pol-roster.css×2 · pol-public.css×15 · calls-c8.css×4 · calls-c11.css×1 · polish.css×5 · account2.css×2 · roomsettings.css×2 · calls-c6.css×4 · calls-c4.css×1 · ui-sheets.css×2 |
| `--text-lg` | ok | app.css:60 | `1.0625rem` |  |  | 56 | app.css×16 · pol-stats.css×7 · pol-studio.css×3 · pol-shell.css×4 · pol-thread.css×3 · pol-roster.css×1 · pol-public.css×14 · calls-c8.css×1 · calls-c11.css×1 · calls-c6.css×1 · ui-sheets.css×5 |
| `--text-md` | ok | app.css:59 | `0.9375rem` |  |  | 87 | app.css×19 · pol-stats.css×4 · pol-studio.css×7 · pol-shell.css×14 · pol-thread.css×13 · pol-roster.css×1 · pol-public.css×15 · calls-c8.css×1 · polish.css×3 · roomsettings.css×3 · calls-c6.css×1 · calls-c4.css×1 · ui-sheets.css×4 · calls-engine.css×1 |
| `--text-sm` | ok | app.css:58 | `0.8125rem` |  |  | 318 | app.css×75 · pol-stats.css×20 · pol-studio.css×25 · pol-shell.css×32 · pol-thread.css×53 · pol-roster.css×5 · pol-public.css×57 · calls-c8.css×5 · calls-c11.css×3 · polish.css×2 · account2.css×4 · roomsettings.css×12 · calls-c6.css×5 · calls-c4.css×1 · ui-sheets.css×17 · calls-engine.css×2 |
| `--text-xl` | ok | app.css:61 | `1.25rem` |  |  | 24 | app.css:2465 · pol-stats.css:237,363,378,580,643,742,794 · pol-shell.css:1164,1174 · pol-thread.css:861,1390,1895 · pol-public.css:691,824,963,988,1195,1264,1505,1588,1598 · calls-c6.css:36 · ui-sheets.css:604 |
| `--text-xs` | ok | app.css:57 | `0.6875rem` |  |  | 111 | app.css×25 · pol-stats.css×7 · pol-studio.css×18 · pol-shell.css×16 · pol-thread.css×14 · pol-roster.css×3 · pol-public.css×8 · calls-c11.css×1 · polish.css×1 · account2.css×7 · roomsettings.css×4 · calls-c6.css×1 · calls-c4.css×3 · ui-sheets.css×3 |
| `--tool-glyph` | ok | 5 definitions: polish.css:83,84,85,86,87 (selectors in style-map.json) | `var(--pt-i-attach)` |  |  | 2 | polish.css:78,79 |
| `--tracking-kicker` | ok | app.css:66 | `0.06em` |  |  | 49 | pol-stats.css×8 · pol-studio.css×12 · pol-shell.css×4 · pol-thread.css×7 · pol-roster.css×2 · pol-public.css×8 · calls-c8.css×2 · calls-c11.css×1 · polish.css×1 · account2.css×1 · ui-sheets.css×3 |
| `--vv-top` | runtime-written | app.css:112 | `0px` |  | ports.js setProperty ports.js:9981 | 1 | pol-ios.css:111 |
| `--vvh` | runtime-written | app.css:113<br>app.css:117 @@supports (height: 100dvh) | `100vh` |  | ports.js setProperty ports.js:9975 | 7 | pol-roster.css:346,347,365,366 · ui-sheets.css:1037 · pol-ios.css:65,66 |
| `--warn` | theme-only, unused |  |  | `#e6d08c` ocean,tide,abyss,reef,onyx,obsidian,ink,shu,hisui,pine,kohaku,terracotta,vermillion,sapphire,teal,slate<br>`var(--gold)` pearl<br>`#8a6e1f` frost |  | 0 |  |

Root data-* attributes written by ports.js on <html>: `data-bound`, `data-density`, `data-experience-mode`, `data-font-scale`, `data-hide-events`, `data-high-contrast`, `data-kb`, `data-reader`, `data-reduce-motion`, `data-reduce-transparency`, `data-theme`, `data-width`, `data-yield`.

Theme Studio-editable tokens (src/Studio.elm): `--ink`, `--ink-2`, `--stone`, `--stone-2`, `--stone-3`, `--lapis`, `--lapis-bright`, `--lapis-deep`, `--gold`, `--gold-bright`, `--gold-deep`, `--shu`, `--shu-bright`, `--paper`, `--paper-dim`, `--paper-mute`, `--ok`, `--stone-line`, `--r-0`, `--r-sm`, `--r-md`, `--dur`, `--ease`, `--font-mono`, `--font-display`, `--font-sans`, `--font-serif`.

### G2.1 Theme token matrix (src/ThemeTokens.elm — committed inline on <html> by every appearanceApply)

| token | ocean (dark) | tide (dark) | abyss (dark) | reef (dark) | onyx (dark) | obsidian (dark) | pearl (light) | ink (dark) | shu (dark) | hisui (dark) | pine (dark) | kohaku (dark) | terracotta (dark) | vermillion (dark) | sapphire (dark) | teal (dark) | slate (dark) | frost (light) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `--ink` | #202429 | #00060b | #000102 | #000407 | #000101 | #000001 | #f5f0e5 | #000001 | #080100 | #000401 | #000300 | #050200 | #060100 | #060100 | #000208 | #000302 | #040301 | #e3f7fe |
| `--ink-2` | #262c32 | #000a11 | #000103 | #00060a | #010203 | #000101 | #f1ebe1 | #010102 | #0b0201 | #000601 | #010501 | #080300 | #0a0200 | #0a0101 | #00040d | #000603 | #060503 | #def2f8 |
| `--stone` | #2d333a | #051820 | #010508 | #010f16 | #050709 | #020304 | #e5e0d6 | #030405 | #160705 | #040f06 | #060e05 | #130b01 | #140904 | #140604 | #020b16 | #010f0a | #110e0a | #d0e4ea |
| `--stone-2` | #343b43 | #12262e | #050c10 | #081a21 | #0d0f12 | #07090a | #dbd6cc | #08090c | #21100d | #0c190f | #0e170d | #1d1507 | #1f130c | #1d0f0b | #071420 | #071914 | #1c1a15 | #c3d7dd |
| `--stone-3` | #3a424b | #21343d | #0c1418 | #13252c | #16191c | #0f1112 | #d0cbc1 | #0f1113 | #2c1a17 | #162319 | #182116 | #281f11 | #2a1d16 | #281814 | #111e2b | #11241e | #282521 | #b6cad0 |
| `--stone-line` | #49535e | #254350 | #101c22 | #142f3b | #1e2226 | #15181b | #c9c2b5 | #15181c | #3a211c | #1b2e1f | #1e2c1b | #342812 | #37241a | #351e19 | #132739 | #122f26 | #343029 | #a4c0c8 |
| `--lapis` | #65adf5 | #00b8ed | #0091cb | #0094bc | #6996c5 | #6a9eca | #0065b0 | #c9c3bc | #e74142 | #00a149 | #3b9f32 | #d98b09 | #d55c27 | #de5034 | #0089ea | #009d82 | #949d7b | #036884 |
| `--lapis-bright` | #65adf5 | #9ae0ff | #58c4ff | #0bc9ff | #9cc2ea | #9ecdf6 | #086fbe | #ece7e0 | #ff958d | #5bd47d | #79d070 | #ffb75d | #ff9970 | #ff9781 | #7cbdff | #00d5b2 | #bdc6a5 | #2f7791 |
| `--lapis-deep` | #397db8 | #007093 | #005477 | #00556e | #385b7e | #3c6588 | #003e70 | #9d9892 | #940014 | #005e28 | #065f00 | #8a5600 | #832e00 | #8e1900 | #004f8b | #005b4b | #656c51 | #003c4d |
| `--gold` | #b4bfca | #5dcbd1 | #51a0ad | #f19173 | #c9a24a | #7fa5b8 | #896100 | #bbb7b1 | #f4733c | #70c5a0 | #a5a51a | #eea563 | #e8777a | #ef7179 | #00aaf3 | #72ccab | #ae7853 | #00768a |
| `--gold-bright` | #f5f7f8 | #92f1f6 | #88cedb | #ffc0ac | #f1d489 | #add1e3 | #ad7c0a | #dedad5 | #ffb294 | #a5e9c9 | #cdcf62 | #ffcca1 | #ffafae | #ffafb0 | #8ad1ff | #9feacd | #d8a582 | #0096af |
| `--gold-deep` | #71808e | #3e999d | #236671 | #a9573d | #8c6c2c | #516f7e | #5f4200 | #908c88 | #a43e08 | #3e8165 | #686800 | #a46c36 | #9c4346 | #a13d46 | #006b9b | #42876e | #73492b | #00515f |
| `--brand-action` | #ff987d | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| `--shu` | #ff6f61 | #ff7a6c | #f0594b | #ff6f5e | #e95145 | #e95047 | #c83319 | #d8412c | #e9523b | #e95146 | #e95047 | #e85336 | #e8523b | #e95144 | #e95047 | #e95049 | #e9523c | #c92f34 |
| `--shu-bright` | #ff9484 | #ffa193 | #ff7c6e | #ff9a86 | #ff7f71 | #ff7f72 | #e5462b | #ff5d44 | #ff806a | #ff7f71 | #ff7f72 | #ff8066 | #ff8069 | #ff7f70 | #ff7f72 | #ff7f74 | #ff806a | #e64344 |
| `--paper` | #f5f7f8 | #d1e1e9 | #d4e0e8 | #d2e1e8 | #eae8e0 | #d6dfe7 | #251e15 | #f0eae2 | #ebdad5 | #d6e2d8 | #d8e1d6 | #e4ddd0 | #e8dbd4 | #eadad6 | #d4e0eb | #d3e2dc | #eae7e2 | #202b2e |
| `--paper-dim` | #b4bfca | #8c9ba2 | #8f9aa1 | #8d9ba2 | #a4a19a | #9199a1 | #494136 | #a9a49c | #a49490 | #919c92 | #939b91 | #9e988b | #a1968f | #a39591 | #8f9aa5 | #8e9c97 | #a7a49e | #546063 |
| `--paper-mute` | #b4bfca | #536770 | #56666f | #54676f | #6e6c63 | #5a656e | #71675a | #706b63 | #725e59 | #5a685b | #5c675a | #6a6252 | #6f6057 | #715e5a | #576573 | #556861 | #716e68 | #7a8d92 |
| `--ok` | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #15915c | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #15915c |
| `--warn` | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | var(--gold) | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #8a6e1f |
| `--danger` | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) | var(--shu) |
| `--seam` | mix(var(--lapis) 28%) | mix(var(--lapis) 50%) | mix(var(--lapis) 36%) | mix(var(--lapis) 40%) | mix(var(--gold) 40%) | mix(var(--lapis) 30%) | mix(var(--gold) 55%) | mix(var(--paper) 16%) | mix(var(--lapis) 40%) | mix(var(--lapis) 38%) | mix(var(--lapis) 38%) | mix(var(--lapis) 36%) | mix(var(--lapis) 40%) | mix(var(--lapis) 40%) | mix(var(--lapis) 40%) | mix(var(--lapis) 36%) | mix(var(--lapis) 28%) | mix(var(--lapis) 34%) |
| `--seam-faint` | mix(var(--lapis) 12%) | mix(var(--lapis) 20%) | mix(var(--lapis) 13%) | mix(var(--lapis) 16%) | mix(var(--gold) 15%) | mix(var(--lapis) 12%) | mix(var(--gold) 24%) | mix(var(--paper) 7%) | mix(var(--lapis) 16%) | mix(var(--lapis) 15%) | mix(var(--lapis) 15%) | mix(var(--lapis) 15%) | mix(var(--lapis) 16%) | mix(var(--lapis) 16%) | mix(var(--lapis) 16%) | mix(var(--lapis) 15%) | mix(var(--lapis) 12%) | mix(var(--lapis) 14%) |
| `--line` | mix(var(--paper) 40%) | mix(var(--paper) 16%) | mix(var(--paper) 11%) | mix(var(--paper) 14%) | mix(var(--paper) 13%) | mix(var(--paper) 12%) | mix(var(--lapis) 28%) | mix(var(--lapis) 25%) | mix(var(--shu) 18%) | mix(var(--lapis) 22%) | mix(var(--paper) 14%) | mix(var(--lapis) 28%) | mix(var(--paper) 14%) | mix(var(--paper) 14%) | mix(var(--paper) 14%) | mix(var(--paper) 14%) | mix(var(--paper) 13%) | mix(var(--paper) 18%) |
| `--line-faint` | mix(var(--paper) 6%) | mix(var(--paper) 8%) | mix(var(--paper) 5%) | mix(var(--gold) 12%) | mix(var(--paper) 6%) | mix(var(--paper) 5%) | mix(var(--lapis) 12%) | mix(var(--lapis) 10%) | mix(var(--shu) 8%) | mix(var(--lapis) 9%) | mix(var(--gold) 11%) | mix(var(--lapis) 12%) | mix(var(--gold) 12%) | mix(var(--gold) 12%) | mix(var(--gold) 12%) | mix(var(--gold) 11%) | mix(var(--lapis) 10%) | mix(var(--gold) 14%) |
| `--r-0` | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px | 0px |
| `--r-sm` | 4px | 6px | 3px | 5px | 2px | 1px | 2px | 0px | 2px | 2px | 3px | 2px | 4px | 3px | 2px | 6px | 4px | 5px |
| `--r-md` | 8px | 12px | 8px | 11px | 4px | 3px | 4px | 2px | 4px | 4px | 7px | 4px | 9px | 6px | 5px | 13px | 9px | 10px |
| `--r-pill` | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px | 999px |
| `--ease` | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) | cubic-bezier(0.16, 1, 0.3, 1) |
| `--dur` | 220ms | 260ms | 240ms | 260ms | 240ms | 220ms | 200ms | 180ms | 240ms | 240ms | 250ms | 240ms | 240ms | 240ms | 240ms | 260ms | 240ms | 220ms |

## G3. Hard-coded values that bypass tokens (every one, file:line)


### G3.1 Colour literals in component rules and component-scoped custom properties (43)

| colour | count | where |
|---|---|---|
| `#000` | 9 | app.css:3739 · pol-studio.css:230,321 · pol-shell.css:422,1279 · pol-thread.css:348,819 · pol-roster.css:355 · ui-sheets.css:131 |
| `highlight` | 9 | pol-stats.css:1073,1077 · pol-studio.css:331,1738 · pol-shell.css:177 · pol-thread.css:1916,1918 · pol-public.css:1678 · polish.css:385 |
| `canvastext` | 8 | pol-stats.css:1070,1071,1078 · pol-roster.css:413,414 · pol-public.css:1679 · polish.css:383,384 |
| `buttontext` | 4 | pol-studio.css:329,330,1740 · pol-public.css:1676 |
| `canvas` | 3 | pol-stats.css:1071 · pol-roster.css:413,414 |
| `rgba(0, 0, 0, 0.35)` | 2 | app.css:3074,3337 |
| `#fff` | 2 | app.css:3308 · calls-c6.css:9 |
| `rgb(0 0 0 / 55%)` | 1 | app.css:2654 |
| `rgb(0 8 16 / 45%)` | 1 | app.css:2667 |
| `rgb(0 0 0 / 35%)` | 1 | app.css:2882 |
| `highlighttext` | 1 | pol-studio.css:332 |
| `rgb(0 0 0 / 0.35)` | 1 | polish.css:344 |
| `rgba(0, 0, 0, 0.45)` | 1 | calls-engine.css:94 |

### G3.2 Colour literals that are :root token definitions (29)

`--onyx-bg` `#0b0e12` app.css:5 · `--onyx-panel` `#12161c` app.css:6 · `--onyx-panel-2` `#181e27` app.css:7 · `--onyx-line` `#232b36` app.css:8 · `--onyx-text` `#e8e6e1` app.css:9 · `--onyx-dim` `#9aa3ad` app.css:10 · `--onyx-faint` `#5d6670` app.css:11 · `--onyx-accent` `#46c08a` app.css:12 · `--onyx-accent-ink` `#06281a` app.css:13 · `--onyx-warn` `#d9a13b` app.css:14 · `--onyx-bad` `#e5484d` app.css:15 · `--ink` `#000101` app.css:18 · `--stone` `#050709` app.css:19 · `--stone-2` `#0d0f12` app.css:20 · `--stone-3` `#16191c` app.css:21 · `--lapis-bright` `#9cc2ea` app.css:22 · `--lapis-deep` `#385b7e` app.css:23 · `--paper` `#eae8e0` app.css:24 · `--paper-dim` `#a4a19a` app.css:25 · `--gold` `#c9a24a` app.css:26 · `--gold-bright` `#f1d489` app.css:27 · `--lapis` `#6996c5` app.css:30 · `--shu` `#e95145` app.css:31 · `--shu-bright` `#ff7f71` app.css:32 · `--elev-3` `#000` app.css:87 · `--onyx-line` `#5a6675` app.css:3144 · `--onyx-dim` `#c9d0d7` app.css:3145 · `--onyx-faint` `#9aa3ad` app.css:3146 · `--sheet-veil` `#000` ui-sheets.css:25

### G3.3 Colour literals inside var() fallbacks (0)

| token → fallback | count | where |
|---|---|---|

### G3.3b Ad-hoc tints: every color-mix() (89 uses, 65 distinct)

| color-mix expression | count | where |
|---|---|---|
| `color-mix(in oklab, var(--onyx-accent) 88%, var(--onyx-text))` | 6 | app.css:1996 · pol-stats.css:119 · pol-studio.css:781 · pol-public.css:148,450,541 |
| `color-mix(in srgb, #000 55%, transparent)` | 5 | app.css:3739 · pol-shell.css:422,1279 · pol-thread.css:348 · pol-roster.css:355 |
| `color-mix(in oklab, var(--onyx-bad) 55%, var(--onyx-line))` | 4 | pol-shell.css:282,329 · pol-thread.css:1670,1821 |
| `color-mix(in oklab, var(--onyx-text) 26%, transparent)` | 4 | ui-sheets.css:338,867,983,1096 |
| `color-mix(in oklab, var(--onyx-warn) 45%, transparent)` | 3 | pol-studio.css:670,1542,1625 |
| `color-mix(in oklab, var(--onyx-dim) 45%, var(--onyx-line))` | 2 | app.css:1947 · pol-shell.css:596 |
| `color-mix(in oklab, var(--onyx-accent) 80%, var(--onyx-bg))` | 2 | app.css:2032 · pol-public.css:1650 |
| `color-mix(in oklab, var(--onyx-panel-2) 60%, transparent)` | 2 | pol-studio.css:281 · ui-sheets.css:743 |
| `color-mix(in oklab, var(--onyx-warn) 40%, transparent)` | 2 | pol-studio.css:1179,1601 |
| `color-mix(in oklab, var(--onyx-warn) 12%, transparent)` | 2 | pol-studio.css:1184 · pol-thread.css:1163 |
| `color-mix(in oklab, var(--onyx-accent) 70%, var(--onyx-line))` | 2 | pol-thread.css:1019,1338 |
| `color-mix(in srgb, var(--onyx-bg) 78%, transparent)` | 2 | calls-c4.css:105,121 |
| `color-mix(in oklab, var(--paper) 40%, transparent)` | 1 | app.css:33 |
| `color-mix(in oklab, var(--onyx-text) 5%, transparent)` | 1 | app.css:85 |
| `color-mix(in oklab, var(--onyx-bg) 88%, transparent)` | 1 | app.css:86 |
| `color-mix(in oklab, #000 90%, transparent)` | 1 | app.css:87 |
| `color-mix(in oklab, var(--onyx-text) 6%, transparent)` | 1 | app.css:87 |
| `color-mix(in srgb, var(--onyx-warn) 12%, transparent)` | 1 | app.css:292 |
| `color-mix(in oklab, var(--lapis-bright) 32%, var(--line))` | 1 | app.css:1858 |
| `color-mix(in oklab, var(--lapis) 10%, transparent)` | 1 | app.css:1860 |
| `color-mix(in oklab, var(--paper-dim) 36%, var(--line))` | 1 | app.css:1871 |
| `color-mix(in oklab, var(--stone-2) 42%, transparent)` | 1 | app.css:1872 |
| `color-mix(in oklab, var(--shu-bright) 34%, var(--line))` | 1 | app.css:1877 |
| `color-mix(in oklab, var(--shu) 10%, transparent)` | 1 | app.css:1878 |
| `color-mix(in oklab, var(--onyx-text) 50%, transparent)` | 1 | app.css:1999 |
| `color-mix(in oklab, var(--onyx-accent) 16%, var(--onyx-panel-2))` | 1 | app.css:2000 |
| `color-mix(in oklab, var(--onyx-text) 58%, var(--onyx-bg))` | 1 | pol-stats.css:23 |
| `color-mix(in oklab, var(--onyx-accent) 10%, transparent)` | 1 | pol-stats.css:24 |
| `color-mix(in oklab, var(--pg-text) var(--heat, 4%), var(--onyx-bg))` | 1 | pol-stats.css:831 |
| `color-mix(in oklab, #000 25%, transparent)` | 1 | pol-studio.css:230 |
| `color-mix(in oklab, #000 40%, transparent)` | 1 | pol-studio.css:321 |
| `color-mix(in oklab, var(--onyx-bad) 14%, transparent)` | 1 | pol-studio.css:1036 |
| `color-mix(in oklab, var(--lapis-deep, var(--onyx-panel-2)) 40%, transparent)` | 1 | pol-studio.css:1322 |
| `color-mix(in oklab, var(--lapis-bright, var(--onyx-accent)) 45%, transparent)` | 1 | pol-studio.css:1386 |
| `color-mix(in oklab, var(--shu, var(--onyx-bad)) 55%, transparent)` | 1 | pol-studio.css:1455 |
| `color-mix(in oklab, var(--onyx-bad) 30%, var(--onyx-bg))` | 1 | pol-studio.css:1602 |
| `color-mix(in oklab, var(--onyx-panel-2) 55%, transparent)` | 1 | pol-shell.css:99 |
| `color-mix(in oklab, var(--onyx-bad) 45%, var(--onyx-line))` | 1 | pol-shell.css:130 |
| `color-mix(in oklab, var(--onyx-warn) 40%, var(--onyx-line))` | 1 | pol-shell.css:277 |
| `color-mix(in oklab, var(--onyx-bad) 12%, transparent)` | 1 | pol-shell.css:330 |
| `color-mix(in oklab, var(--onyx-warn) 10%, transparent)` | 1 | pol-shell.css:623 |
| `color-mix(in oklab, var(--onyx-panel) 72%, transparent)` | 1 | pol-thread.css:15 |
| `color-mix(in oklab, var(--onyx-line) 55%, var(--onyx-dim))` | 1 | pol-thread.css:16 |
| `color-mix(in oklab, var(--gold) 9%, transparent)` | 1 | pol-thread.css:169 |
| `color-mix(in oklab, var(--gold) 13%, transparent)` | 1 | pol-thread.css:176 |
| `color-mix(in oklab, var(--onyx-text) 9%, var(--onyx-panel))` | 1 | pol-thread.css:410 |
| `color-mix(in oklab, var(--onyx-text) 34%, var(--onyx-line))` | 1 | pol-thread.css:411 |
| `color-mix(in oklab, var(--onyx-bad) 70%, transparent)` | 1 | pol-thread.css:477 |
| `color-mix(in srgb, #000 82%, transparent)` | 1 | pol-thread.css:819 |
| `color-mix(in oklab, var(--onyx-bg) 86%, transparent)` | 1 | pol-thread.css:853 |
| `color-mix(in oklab, var(--onyx-bad) 8%, var(--onyx-panel))` | 1 | pol-thread.css:1823 |
| `color-mix(in oklab, var(--lapis) 38%, var(--onyx-panel-2))` | 1 | pol-public.css:581 |
| `color-mix(in oklab, var(--gold) 46%, var(--onyx-panel-2))` | 1 | pol-public.css:582 |
| `color-mix(in oklab, var(--shu) 30%, var(--onyx-panel-2))` | 1 | pol-public.css:583 |
| `color-mix(in oklab, var(--onyx-warn) 50%, transparent)` | 1 | pol-public.css:1077 |
| `color-mix(in oklab, var(--onyx-bad) 60%, transparent)` | 1 | pol-public.css:1123 |
| `color-mix(in srgb, var(--onyx-bg) 94%, transparent)` | 1 | calls-c8.css:64 |
| `color-mix(in srgb, var(--onyx-text) 75%, var(--onyx-bg))` | 1 | calls-c8.css:82 |
| `color-mix(in srgb, #000 58%, transparent)` | 1 | ui-sheets.css:25 |
| `color-mix(in srgb, #000 22%, transparent)` | 1 | ui-sheets.css:131 |
| `color-mix(in oklab, var(--onyx-bad) 40%, var(--onyx-line))` | 1 | ui-sheets.css:653 |
| `color-mix(in oklab, var(--onyx-bg) 40%, var(--onyx-panel))` | 1 | ui-sheets.css:673 |
| `color-mix(in oklab, var(--onyx-panel-2) 70%, var(--onyx-line))` | 1 | ui-sheets.css:1003 |
| `color-mix(in oklab, var(--onyx-bad) 10%, transparent)` | 1 | ui-sheets.css:1004 |
| `color-mix(in oklab, var(--onyx-panel-2) 60%, var(--onyx-line))` | 1 | ui-sheets.css:1032 |

### G3.4 Elm inline styles (bypass every stylesheet) (36)

| file:line | property | value expression | literal colours |
|---|---|---|---|
| src/View/Appearance.elm:327 | `min-height` | `"44px"` |  |
| src/View/Appearance.elm:328 | `touch-action` | `"manipulation"` |  |
| src/View/Appearance.elm:333 | `background` | `color` |  |
| src/View/Appearance.elm:432 | `background` | `color` |  |
| src/View/Appearance.elm:488 | `min-height` | `"44px"` |  |
| src/View/Appearance.elm:489 | `touch-action` | `"manipulation"` |  |
| src/View/Rail.elm:382 | `background-color` | `c` |  |
| src/View/Stats.elm:865 | `width` | `(String.fromInt (round (toFloat (max 0 room.messages) / toFloat maxMessages * 100)) ++ "%"` |  |
| src/View/Studio.elm:242 | `touch-action` | `"manipulation"` |  |
| src/View/Studio.elm:262 | `min-height` | `"44px"` |  |
| src/View/Studio.elm:263 | `touch-action` | `"manipulation"` |  |
| src/View/Studio.elm:268 | `background` | `color` |  |
| src/View/Studio.elm:999 | `background` | `"var(--shu)"` |  |
| src/View/Studio.elm:1000 | `background` | `"var(--gold)"` |  |
| src/View/Studio.elm:1001 | `background` | `"var(--ok, #46c08a)"` | #46c08a |
| src/View/Studio.elm:1040 | `color` | `"var(--gold-bright)"` |  |
| src/View/Studio.elm:1075 | `color` | `nickColor` |  |
| src/View/Studio.elm:1083 | `color` | `sigilColor` |  |
| src/View/Studio.elm:1085 | `background` | `dot` |  |
| src/View/Studio.elm:1140 | `background` | `("var(" ++ row.bg ++ ")")` |  |
| src/View/Studio.elm:1141 | `color` | `("var(" ++ row.fg ++ ")")` |  |
| src/View/Thread.elm:506 | `color` | `(Avatar.nickTint m.from)` |  |
| src/View/Thread.elm:811 | `color` | `(Avatar.nickTint par.from)` |  |
| src/View/Thread.elm:851 | `color` | `(Avatar.nickTint msg.from)` |  |
| src/Avatar.elm:213 | `--onyx-avatar-bg` | `bg` |  |
| src/Avatar.elm:214 | `--onyx-avatar-fg` | `fg` |  |
| src/View/CallDock.elm:338 | `--pip-ix` | `(String.fromInt (12 + pos.x) ++ "px")` |  |
| src/View/CallDock.elm:339 | `--pip-iy` | `(String.fromInt (12 + pos.y) ++ "px")` |  |
| src/View/RoomSettings.elm:1177 | `--room-heat` | `(String.fromFloat (toFloat (round (toFloat (safe count) / toFloat peak * 1000)) / 1000))` |  |
| src/View/Stats.elm:326 | `--h` | `(Stats.barHeight day.messages peak)` |  |
| src/View/Stats.elm:539 | `--h` | `(String.fromInt (max 3 (round (toFloat messages / toFloat (max 1 hourPeak) * 100))))` |  |
| src/View/Stats.elm:573 | `--h` | `(String.fromInt (max 3 (round (toFloat day.messages / toFloat dayPeak * 100))))` |  |
| src/View/Stats.elm:633 | `--heat` | `(heatOf messages)` |  |
| src/View/Stats.elm:1033 | `--h` | `(sparkHeight n)` |  |
| src/View/Thread.elm:532 | `--nick-tint` | `(Avatar.nickTint m.from)` |  |
| src/View/Thread.elm:890 | `--nick-tint` | `(Avatar.nickTint msg.from)` |  |

### G3.5 Font sizes off the --text-* ladder (256 of 978)

| value | count | where |
|---|---|---|
| `12px` | 65 | app.css:145,149,157,158,162,172,173,180,181,184,186,193,354,465,471,773,1165,1167,1226,1232,1239,1241,1242,1248,1256,1257,1259,1298,1315,1338,1373,1376,1388,1418,1420,1426,1476,1486,1487,1492,1495,1497,1510,1517,1518,1582,1660,1672,1690,1707,1718,1790,1815,1828,1842,1845,1847,1848,3201,3214,3253,3284,3288,3326,3354 |
| `13px` | 65 | app.css:348,731,823,900,954,1032,1043,1050,1309,1345,1365,1367,1377,1385,1414,1422,1427,1470,1473,1483,1491,1506,1509,1511,1544,1546,1547,1548,1549,1551,1558,1562,1570,1593,1620,1641,1698,1702,1711,1712,1713,1716,1726,1756,1759,1768,1772,1776,1792,1793,1794,1795,1811,1812,1814,1821,1827,1834,1843,3210,3219,3350,3361,3365,3369 |
| `11px` | 15 | app.css:196,415,677,688,1225,1236,1493,1715,2076,3193,3304 · pol-studio.css:1263 · pol-shell.css:840,1256,1421 |
| `16px` | 13 | app.css:1115,1299,3408 · pol-shell.css:1038,1319 · pol-thread.css:387,1289,1308,1569 · pol-roster.css:396,401 · calls-c8.css:52 · ui-sheets.css:825 |
| `18px` | 12 | app.css:719,1205,1207,1237,1363,1364,1543,1545,1654,1749,3287,3359 |
| `15px` | 9 | app.css:156,859,1689,1755,1789,1810,3194 · pol-shell.css:1389 · pol-thread.css:406 |
| `9px` | 6 | pol-studio.css:1296,1317,1341,1376,1412,1481 |
| `10px` | 5 | pol-studio.css:1439 · pol-shell.css:647,707,1029,1238 |
| `17px` | 4 | app.css:925,1020,1403,3341 |
| `14px` | 4 | app.css:1148,1251,1417,1701 |
| `20px` | 3 | app.css:961 · pol-thread.css:327 · calls-c8.css:32 |
| `1rem` | 3 | app.css:1938 · pol-public.css:912,1404 |
| `24px` | 3 | app.css:3195 · pol-thread.css:389,1310 |
| `clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)` | 3 | pol-stats.css:146,279,411 |
| `max(1rem, 16px)` | 3 | pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1665 |
| `0.72rem` | 2 | app.css:134,205 |
| `1.125rem` | 2 | app.css:1921 · pol-public.css:110 |
| `1.75rem` | 2 | app.css:1924 · pol-shell.css:1052 |
| `1.5rem` | 2 | app.css:2048 · pol-public.css:1356 |
| `font: var(--text-2xs) / 1.2 var(--font-mono)` | 2 | pol-stats.css:814,824 |
| `0` | 2 | pol-studio.css:307 · ui-sheets.css:230 |
| `font: 600 var(--text-2xs) / 1 var(--font-mono)` | 2 | pol-shell.css:122 · ui-sheets.css:478 |
| `1.25rem` | 2 | pol-public.css:955,1421 |
| `0.86rem` | 1 | app.css:135 |
| `28px` | 1 | app.css:851 |
| `44px` | 1 | app.css:914 |
| `0.62rem` | 1 | app.css:1863 |
| `2rem` | 1 | app.css:2043 |
| `0.92em` | 1 | app.css:2068 |
| `0.85em` | 1 | app.css:2081 |
| `1.1em` | 1 | app.css:2085 |
| `clamp(1.5rem, 1.15rem + 1.4vw, 2.25rem)` | 1 | pol-stats.css:80 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem)` | 1 | pol-stats.css:546 |
| `font: var(--text-sm) / 1.2 var(--font-mono)` | 1 | pol-stats.css:969 |
| `clamp(1.5rem, 1.1rem + 1.6vw, 2.125rem)` | 1 | pol-studio.css:86 |
| `10.5px` | 1 | pol-thread.css:146 |
| `1.1rem` | 1 | pol-thread.css:616 |
| `0.78rem` | 1 | pol-roster.css:402 |
| `0.9em` | 1 | pol-public.css:39 |
| `clamp(2rem, 1.4rem + 2.6vw, 2.75rem)` | 1 | pol-public.css:385 |
| `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | 1 | pol-public.css:514 |
| `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | 1 | pol-public.css:523 |
| `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | 1 | pol-public.css:621 |
| `clamp(2.375rem, 9.6vw, 2.75rem)` | 1 | pol-public.css:778 |
| `clamp(1.5rem, 1.2rem + 1vw, 1.875rem)` | 1 | pol-public.css:909 |
| `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` | 1 | pol-public.css:992 |
| `clamp(1.875rem, 1.4rem + 1.8vw, 2.5rem)` | 1 | pol-public.css:1360 |
| `clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)` | 1 | pol-public.css:1442 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | 1 | pol-public.css:1461 |
| `clamp(1.75rem, 1.3rem + 2vw, 2.5rem)` | 1 | pol-public.css:1557 |

### G3.6 Line heights off --leading-* (31 of 162)

| value | count | where |
|---|---|---|
| `16px` | 3 | pol-shell.css:648,709,1240 |
| `20px` | 3 | pol-shell.css:1388 · pol-thread.css:1043,1289 |
| `0` | 3 | pol-thread.css:120,925 · ui-sheets.css:231 |
| `1.6` | 3 | pol-public.css:1026,1536,1589 |
| `1.05` | 2 | app.css:917 · pol-public.css:1442 |
| `1.1` | 2 | app.css:2204 · pol-stats.css:909 |
| `1.2` | 2 | app.css:2748 · pol-public.css:426 |
| `18px` | 2 | app.css:3592 · pol-shell.css:841 |
| `1.65` | 2 | pol-public.css:912,1595 |
| `1.15` | 1 | app.css:1927 |
| `1.45` | 1 | app.css:2990 |
| `1.4` | 1 | pol-studio.css:1264 |
| `1.25` | 1 | pol-shell.css:1250 |
| `1.3` | 1 | pol-shell.css:1251 |
| `1.08` | 1 | pol-public.css:388 |
| `1.02` | 1 | pol-public.css:517 |
| `1.5` | 1 | pol-public.css:524 |
| `1.9` | 1 | pol-public.css:1608 |

### G3.7 Font weights (no weight tokens exist) (449)

| value | count | where |
|---|---|---|
| `650` | 163 | app.css:160,182,235,454,556,634,655,674,782,824,848,892,941,972,1028,1051,1224,1247,1333,1372,1933,2016,2231,2274,2433,2721,2903,2924,2940,3047,3066,3210,3214,3219,3241,3282,3304,3326,3354,3369,3617,3659,3797 · pol-stats.css:72,81,107,218,311,439,506,623,680,912 · pol-studio.css:87,118,130,197,357,452,458,490,504,649,658,691,809,821,1091,1297,1320,1377,1440,1533,1567 · pol-shell.css:48,182,201,216,228,297,386,480,815,1014 · pol-thread.css:384,407,461,621,668,781,889,928,939,966,1108,1130,1258,1445,1547,1552,1589,1763,1849 · pol-roster.css:56,162,228 · pol-public.css:63,144,185,231,240,301,377,425,511,537,586,629,672,703,751,864,865,924,930,950,966,1007,1012,1072,1080,1083,1090,1104,1134,1154,1233,1242,1372,1394,1469,1497,1515 · calls-c8.css:50,68,83,92,95,110 · calls-c11.css:36,104 · polish.css:107,299 · calls-c6.css:28 · calls-c4.css:106 · ui-sheets.css:165,170,179,264,436,599,780,1070 |
| `600` | 142 | app.css:205,264,314,355,378,678,689,949,1140,1165,1180,1217,1426,1495,1516,1548,1964,2012,2014,2027,2061,2107,2129,2174,2298,2312,2318,2319,2330,2335,2339,2347,2354,2365,2371,2378,2519,2528,2845,2977,3085,3093,3101,3201,3253 · pol-stats.css:729 · pol-studio.css:154,260,373,563,591,713,757,904,992,1118,1176,1190,1612,1745,1754 · pol-shell.css:72,188,319,334,374,447,485,608,765,784,1061,1119,1382,1401,1422 · pol-thread.css:438,628,644,710,748,770,801,857,1183,1199,1230,1245,1266,1462,1499,1651,1690,1799,1811 · pol-roster.css:64,166,338 · pol-public.css:123,186,251,313,545,645,725,740,759,824,874,895,938,988,1118,1235,1285,1317,1414,1436,1516,1597,1629 · calls-c8.css:19,74 · account2.css:8,102 · roomsettings.css:77,110,123,143,164,209,222,276,284,298,304 · calls-c4.css:33 · ui-sheets.css:644,655,751,885,1074 |
| `700` | 102 | app.css:179,183,196,416,525,562,584,737,753,962,1021,1297,1363,1543,1551,1574,1701,1717,1750,1755,1827,1921,1988,2250,2814,3190,3231,3591 · pol-stats.css:147,184,238,280,353,364,379,412,540,547,580,600,601,642,643,792,794,819,905,907,909,926,959 · pol-studio.css:72,1286,1342,1362,1416,1469,1499,1591 · pol-shell.css:144,336,351,582,708,730,817,921,1030,1052,1175,1239,1303,1371,1383 · pol-thread.css:483,509,514,618,1751 · pol-public.css:110,219,565,621,691,909,963,965,992,1014,1178,1195,1215,1264,1357,1461,1505,1588,1598 · roomsettings.css:156 · calls-c6.css:151 · ui-sheets.css:461,604 |
| `400` | 17 | app.css:2427,2478,2571 · pol-stats.css:824,937 · pol-studio.css:291,1125 · pol-shell.css:271 · pol-thread.css:719,861,1068,1210,1241 · pol-public.css:955 · polish.css:16,65,144 |
| `750` | 14 | app.css:852,915,1925,3296,3341 · pol-shell.css:349 · pol-thread.css:593 · pol-public.css:386,515,579,1442,1557 · calls-c11.css:138 · calls-c6.css:37 |
| `500` | 7 | app.css:2724,3213,3283 · pol-studio.css:1079 · pol-shell.css:491 · pol-thread.css:669 · pol-roster.css:224 |
| `800` | 3 | app.css:129,1864 · pol-stats.css:417 |
| `inherit` | 1 | calls-c4.css:27 |

### G3.8 Radii off a token (208 of 549)

| value | count | where |
|---|---|---|
| `6px` | 71 | app.css:159,172,342,366,382,397,440,681,693,761,778,797,866,887,939,995,1103,1137,1177,1187,1225,1271,1287,1305,1319,1329,1370,1381,1408,1465,1481,1515,1522,1556,1567,1579,1590,1606,1617,1628,1639,1652,1669,1695,1705,1723,1765,1819,1832,1845,2073,3209,3218,3226,3235,3240,3249,3303,3314,3318,3325,3336,3345,3348,3358,3373 · polish.css:46,190,255,297,343 |
| `50%` | 38 | app.css:128,201,275,299,836,1746,1760,2332,2563,3104,3184,3189,3263,3267,3278 · pol-stats.css:176,448,564,890 · pol-studio.css:229,319,1245,1333,1509 · pol-shell.css:440,853,1035,1044 · pol-thread.css:504,610,1175 · pol-public.css:575,1043 · account2.css:151 · roomsettings.css:102,268 · ui-sheets.css:521,525 |
| `4px` | 23 | app.css:2069,2640 · pol-stats.css:675 · pol-studio.css:910,1083,1151,1152,1313,1381,1442,1466 · pol-thread.css:236,289,1066,1148,1263,1281,1647 · pol-public.css:41 · polish.css:62,134 · ui-sheets.css:482,505 |
| `2px` | 15 | app.css:1973,3406 · pol-stats.css:830 · pol-shell.css:583,819,1302,1377 · pol-thread.css:869 · polish.css:217,226 · ui-sheets.css:337,866,982,1095 · calls-engine.css:98 |
| `999px` | 14 | app.css:173,184,186,193,196,205,267,318,332,3103 · roomsettings.css:258 · ui-sheets.css:728,884,907 |
| `10px` | 11 | app.css:1156,1197,1354,1395,1534,1905 · pol-studio.css:246 · pol-public.css:293,553,1353,1389 |
| `8px` | 10 | app.css:177,1087,1124,1216,1221,1243,1680,1734,1781,1802 |
| `12px 12px 0 0` | 7 | pol-thread.css:362,1303 · pol-roster.css:370 · polish.css:367 · ui-sheets.css:309,970,1084 |
| `3px` | 5 | app.css:245,569,2062,2081 · pol-public.css:1202 |
| `2px 2px 0 0` | 3 | pol-stats.css:717,811 · roomsettings.css:342 |
| `0 3px 3px 0` | 2 | pol-shell.css:692,812 |
| `1px` | 2 | pol-public.css:168,861 |
| `0 0 6px 6px` | 1 | app.css:3293 |
| `6px 6px 0 0` | 1 | app.css:3404 |
| `calc(var(--radius) * 2) calc(var(--radius) * 2) 0 0` | 1 | pol-shell.css:1291 |
| `calc(var(--radius) * 1.5)` | 1 | pol-shell.css:1322 |
| `calc(var(--radius) * 2)` | 1 | pol-shell.css:1374 |
| `0 0 4px 4px` | 1 | pol-thread.css:306 |
| `calc(var(--radius) + 3px)` | 1 | pol-public.css:659 |

### G3.9 Shadows off --elev-* (47 of 71)

| file:line | selector | property | value |
|---|---|---|---|
| app.css:85 | `:root` | --elev-1 | `0 1px 0 color-mix(in oklab, var(--onyx-text) 5%, transparent) inset` |
| app.css:86 | `:root` | --elev-2 | `0 14px 36px -28px color-mix(in oklab, var(--onyx-bg) 88%, transparent)` |
| app.css:87 | `:root` | --elev-3 | `0 28px 56px -32px color-mix(in oklab, #000 90%, transparent), 0 1px 0 color-mix(in oklab, var(--onyx-text) 6%, transpare` |
| app.css:136 | `.onyx-avatar--owner` | box-shadow | `0 0 0 2px var(--gold)` |
| app.css:141 | `.onyx-row-avatar .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| app.css:203 | `.onyx-facepile-face .onyx-avatar` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| app.css:2570 | `.onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 2px var(--onyx-faint)` |
| app.css:2667 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | box-shadow | `0 12px 32px rgb(0 8 16 / 45%)` |
| app.css:2882 | `.onyx-moddesk-sheet` | box-shadow | `-8px 0 24px rgb(0 0 0 / 35%)` |
| app.css:3074 | `.onyx-prefs` | box-shadow | `0 8px 24px rgba(0, 0, 0, 0.35)` |
| app.css:3084 | `.pref-category-tab[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| app.css:3337 | `.onyx-call-sheet` | box-shadow | `0 12px 32px rgba(0, 0, 0, 0.35)` |
| pol-stats.css:321 | `.roadmap-legend a[aria-current='location']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-stats.css:340 | `.roadmap-card:is(:target, [data-current='true'])` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-stats.css:956 | `.stats-page .data-room-row[data-selected='true']` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-studio.css:230 | `.ap-swatch > span, .ap-theme-swatch > span` | box-shadow | `inset 0 0 0 1px color-mix(in oklab, #000 25%, transparent)` |
| pol-studio.css:321 | `.ap-choice-toggle > b::after` | box-shadow | `0 1px 3px color-mix(in oklab, #000 40%, transparent)` |
| pol-studio.css:538 | `.background-picker__card--selected` | box-shadow | `inset 0 0 0 1px var(--onyx-text)` |
| pol-shell.css:652 | `.onyx-topbar .shell-ribbon-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:714 | `.onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:1245 | `.onyx-room-back-count` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| pol-shell.css:1377 | `.onyx-rail .onyx-rail-color` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| pol-shell.css:1431 | `.onyx-mobile-nav .onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-thread.css:170 | `.onyx-mention` | box-shadow | `inset 2px 0 0 var(--gold)` |
| pol-thread.css:181 | `.onyx-message-search-current, .onyx-message-search-current:hover` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:926 | `.onyx-thread-msg-face .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| pol-thread.css:1265 | `.onyx-composer .shell-command-item--active` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:1655 | `.room-media-index-filter[aria-selected='true']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-roster.css:243 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px var(--onyx-faint)` |
| pol-roster.css:414 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px CanvasText` |
| pol-public.css:127 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-public.css:333 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 3px 0 0 var(--onyx-accent)` |
| pol-public.css:677 | `.onyx-land-tabs button[aria-selected="true"]` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| pol-public.css:1327 | `.guides-route__item[data-state="current"] .guides-route__card` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1499 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1570 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| polish.css:344 | `.update-available` | box-shadow | `0 8px 24px rgb(0 0 0 / 0.35)` |
| account2.css:37 | `.a2-input:focus-visible, .a2-select:focus-visible, .a2-textarea:focus-` | box-shadow | `var(--focus-ring)` |
| account2.css:57 | `.a2-btn:focus-visible, .a2-link:focus-visible` | box-shadow | `var(--focus-ring)` |
| account2.css:120 | `.a2-reclaim__signin:focus-visible, .a2-reclaim__dismiss:focus-visible` | box-shadow | `var(--focus-ring)` |
| account2.css:157 | `.a2-dot--avatar` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| ui-sheets.css:449 | `.onyx-spotlight-option[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| ui-sheets.css:803 | `.onyx-toast--success` | box-shadow | `inset 3px 0 0 var(--onyx-accent), var(--elev-3)` |
| ui-sheets.css:804 | `.onyx-toast--danger` | box-shadow | `inset 3px 0 0 var(--onyx-bad), var(--elev-3)` |
| ui-sheets.css:805 | `.onyx-toast--warning` | box-shadow | `inset 3px 0 0 var(--onyx-warn), var(--elev-3)` |
| pol-ios.css:86 | `.onyx-frame` | box-shadow | `inset 0 var(--safe-top) 0 0 var(--onyx-panel)` |
| calls-engine.css:94 | `.onyx-call-more` | box-shadow | `0 -12px 32px rgba(0, 0, 0, 0.45)` |

### G3.10 Hard-coded durations in transition / animation (6 of 88 declarations)

| value | count | where |
|---|---|---|
| `0.001ms` | 2 | app.css:3138,3140 |
| `1.6s` | 2 | app.css:3270 · pol-thread.css:1677 |
| `0ms` | 2 | app.css:3928 · pol-ios.css:39 |

### G3.11 Easing keywords / curves written literally (7)

| value | count | where |
|---|---|---|
| `linear` | 3 | ui-sheets.css:386,445,627 |
| `ease-out` | 2 | app.css:2668,2884 |
| `ease-in-out` | 2 | app.css:3270 · pol-thread.css:1677 |

### G3.12 Spacing (padding / margin / gap / inset / scroll-padding) with raw lengths (814 of 2551 declarations)

| value | count | where |
|---|---|---|
| `2px` | 173 | app.css:158,172,173,184,186,193,193,319,431,533,617,668,694,973,1097,1104,1113,1138,1298,1299,1508,1584,1609,1647,1674,1709,1716,1719,1727,1756,1845,2077,2077,2128,2166,2232,2273,2318,2320,2368,2457,2490,2586,2722,2758,2834,2849,2894,2939,3001,3083,3102,3302,3342,3355,3505,3878 · pol-stats.css:348,563,588,664,665,738,863,964,969 · pol-studio.css:289,355,367,419,488,576,814,893,1066,1067,1141,1271,1295,1309 · pol-shell.css:62,88,132,201,670,895,934,991,1158,1192,1247,1378 · pol-thread.css:100,100,206,207,378,430,447,488,488,559,659,700,766,888,911,925,1011,1157,1178,1193,1205,1235,1287,1332,1332,1332,1455,1476,1521,1528,1635,1683,1755,1792,1847,1848 · pol-roster.css:181 · pol-public.css:588,654,797,869,923,1067,1153,1232,1303,1484,1516 · calls-c8.css:78,79,108,109 · calls-c11.css:55 · polish.css:120,203,245 · roomsettings.css:69,92,214,256,275,297,319,335 · calls-c4.css:35,114,126,138 · ui-sheets.css:168,186,198,511,604,605,610,693,728,736,736,749 · calls-engine.css:37 |
| `8px` | 136 | app.css:149,150,155,159,160,170,172,176,178,180,181,184,205,367,372,420,466,472,672,674,683,694,720,764,783,831,901,982,988,999,1022,1058,1073,1083,1088,1104,1122,1171,1171,1204,1209,1219,1221,1231,1243,1244,1249,1250,1253,1254,1258,1260,1262,1275,1295,1323,1362,1365,1371,1375,1417,1418,1429,1429,1470,1471,1472,1472,1474,1474,1475,1475,1482,1485,1487,1488,1489,1490,1497,1498,1504,1504,1505,1512,1514,1514,1515,1542,1546,1547,1548,1549,1561,1562,1563,1583,1663,1673,1674,1684,1684,1709,1714,1738,1738,1761,1777,1785,1785,1791,1796,1806,1806,1814,1825,1829,1841,1844,3206,3208,3233,3239,3252,3292,3300,3361,3362,3363,3369,3372,3372,3406 · pol-thread.css:1036 · pol-public.css:612 · ui-sheets.css:728,907 |
| `6px` | 128 | app.css:171,175,192,196,289,357,383,398,479,553,590,652,682,729,801,1125,1131,1163,1167,1222,1225,1301,1310,1314,1323,1374,1388,1488,1494,1551,1559,1561,1595,1596,1612,1621,1631,1634,1642,1727,1759,1774,1775,1813,1823,1826,1841,1932,2072,2117,2118,2122,2126,2126,2144,2262,2284,2296,2310,2319,2322,2338,2343,2356,2357,2397,2428,2467,2516,2519,2524,2575,2695,2774,2784,2788,2791,2802,2842,2855,2860,2902,2907,2935,2944,2997,3025,3038,3045,3083,3093,3115,3217,3262,3299,3308,3314,3324,3372 · pol-studio.css:1235,1273,1285,1295,1357,1358,1430,1431,1589 · pol-shell.css:483,1043 · pol-thread.css:399,428,431,545,580,637,657,1175,1492 · pol-roster.css:158 · pol-public.css:595,595,595,1393 · calls-c8.css:44 · ui-sheets.css:674,700,938 |
| `10px` | 99 | app.css:173,178,184,184,186,193,226,231,268,288,367,444,606,609,641,745,746,894,942,1037,1088,1125,1138,1221,1243,1291,1310,1369,1370,1375,1494,1507,1515,1559,1563,1584,1621,1642,1683,1737,1742,1784,1805,1823,1841,1845,1847,1912,2055,2072,2077,2090,2117,2128,2144,2263,2305,2314,2322,2359,2369,2369,2421,2508,2522,2603,2618,2683,2714,2800,2836,2837,2875,2907,3018,3024,3050,3061,3083,3099,3118,3119,3208,3217,3252,3295,3317,3317,3348,3358,3363,3398 · pol-shell.css:591 · pol-thread.css:1289 · pol-roster.css:199 · pol-public.css:100 · ui-sheets.css:346,431,718 |
| `4px` | 76 | app.css:158,161,170,176,178,192,200,200,200,205,333,869,1178,1188,1211,1215,1217,1229,1237,1240,1255,1315,1366,1386,1409,1413,1424,1466,1476,1482,1485,1496,1525,1571,1610,1610,1632,1632,1655,1688,1699,1708,1769,1826,1835,1841,1841,1847,1915,2069,2077,2081,3201,3263,3361 · pol-studio.css:1283,1284,1285,1295,1309,1340,1375,1397,1463,1463,1463 · pol-shell.css:236,646,705,777,799,826,1236 · pol-roster.css:203 · pol-public.css:95 · ui-sheets.css:468 |
| `12px` | 66 | app.css:154,333,347,408,423,665,764,832,854,860,871,933,1029,1052,1161,1178,1188,1209,1216,1234,1235,1250,1288,1366,1369,1370,1386,1402,1409,1413,1413,1419,1424,1466,1515,1525,1550,1571,1686,1699,1740,1769,1787,1808,1835,2072,3225,3225,3248,3260,3292,3292,3340,3340,3348,3353,3358,3388,3395,3396,3398 · pol-shell.css:236 · pol-public.css:856 · ui-sheets.css:158,674,721 |
| `16px` | 32 | app.css:154,665,746,871,902,926,955,963,968,975,999,1157,1198,1215,1356,1396,1416,1536,1550,1610,1632,1684,1738,1785,1806,3087,3285,3340,3340,3347,3348,3396 |
| `14px` | 23 | app.css:373,383,398,514,801,1275,1334,1943,2284,2529,2534,2840,3225,3225,3225,3239,3248,3252,3365 · pol-shell.css:1042 · pol-public.css:264,1398 · ui-sheets.css:907 |
| `1px` | 19 | app.css:564,2338,2641,2990 · pol-studio.css:354,558,656,711,968,1531,1589 · pol-shell.css:791,820,874,972 · pol-roster.css:181 · pol-public.css:40,800 · polish.css:56 |
| `calc(-1 * VAR)` | 15 | app.css:1958,1971,1977 · pol-thread.css:1611 · pol-public.css:1212,1302 · calls-c8.css:93 · ui-sheets.css:157,511,585,720,760,760,899,912 |
| `3px` | 13 | app.css:506,590,670,730,1972,2062 · pol-studio.css:218,219,1308,1488 · pol-shell.css:1415 · pol-thread.css:1013 · pol-public.css:657 |
| `20px` | 12 | app.css:343,870,878,933,989,1012,1013,3285,3368,3377,3396,3396 |
| `5px` | 12 | app.css:493,564,2641 · pol-studio.css:1405,1461 · pol-shell.css:838 · pol-public.css:40,156,852 · ui-sheets.css:163,477,597 |
| `56px` | 11 | pol-public.css:336,358,681,769,819,821,903,904,1441,1453,1580 |
| `calc(VAR + env(safe-area-inset-bottom, 0px))` | 9 | app.css:3880 · calls-c6.css:233 · ui-sheets.css:310,842,889,968,1082 · calls-engine.css:92,117 |
| `64px` | 8 | app.css:910,958,978,1046 · pol-public.css:206,503,1335,1441 |
| `48px` | 7 | app.css:817,1011 · pol-public.css:210,589,769,776,792 |
| `24px` | 7 | app.css:817,893,910,1011,1058,3258,3258 |
| `28px` | 5 | app.css:934,3258,3258 · pol-shell.css:754 · ui-sheets.css:845 |
| `40px` | 5 | app.css:1907 · pol-public.css:337,776,776 · ui-sheets.css:622 |
| `-18px` | 5 | pol-studio.css:1703 · ui-sheets.css:336,865,981,1094 |
| `-1px` | 4 | app.css:166,1979 · pol-thread.css:999 · pol-roster.css:261 |
| `7px` | 4 | app.css:444,1334 · pol-shell.css:1388 · pol-thread.css:733 |
| `96px` | 4 | app.css:910,1944 · pol-public.css:504,1405 |
| `36px` | 4 | app.css:1907,3258 · pol-studio.css:1010 · pol-shell.css:1318 |
| `-4px` | 4 | app.css:1914,2042,3284 · pol-public.css:94 |
| `-6px` | 4 | app.css:3197,3267 · pol-public.css:159 · ui-sheets.css:228 |
| `18px` | 3 | app.css:783,1794,2898 |
| `clamp(VAR, 5vw, 4.5rem)` | 3 | pol-stats.css:49,232,402 |
| `clamp(VAR, 6vw, 5rem)` | 3 | pol-stats.css:138,271,404 |
| `72px` | 3 | pol-public.css:199,620,648 |
| `calc(VAR + 2px)` | 3 | ui-sheets.css:343,855,912 |
| `22px` | 2 | app.css:894,942 |
| `32px` | 2 | app.css:1907,3394 |
| `-8px` | 2 | app.css:1914 · ui-sheets.css:639 |
| `clamp(VAR, 4vw, 4rem)` | 2 | pol-stats.css:328,632 |
| `calc(120px + VAR)` | 2 | pol-stats.css:1056 · pol-studio.css:1782 |
| `clamp(16px, 5vw, 48px)` | 2 | pol-studio.css:48,81 |
| `44px` | 2 | pol-studio.css:1704 · pol-public.css:789 |
| `1.15em` | 2 | pol-public.css:973,1243 |
| `env(safe-area-inset-top, 0px)` | 2 | ui-sheets.css:837 · calls-engine.css:107 |
| `-0.55rem` | 1 | app.css:202 |
| `0.12rem` | 1 | app.css:1857 |
| `0.45rem` | 1 | app.css:1857 |
| `168px` | 1 | app.css:1944 |
| `calc(168px + VAR)` | 1 | app.css:2039 |
| `12vh` | 1 | app.css:2651 |
| `9px` | 1 | app.css:3324 |
| `calc(10px + env(safe-area-inset-bottom, 0px))` | 1 | app.css:3398 |
| `clamp(16px, 4vw, 48px)` | 1 | pol-stats.css:40 |
| `0.4em` | 1 | pol-stats.css:452 |
| `clamp(2px, 0.6vw, 8px)` | 1 | pol-stats.css:708 |
| `clamp(1px, 0.3vw, 4px)` | 1 | pol-stats.css:802 |
| `clamp(28px, 6vw, 72px)` | 1 | pol-studio.css:81 |
| `14vh` | 1 | pol-studio.css:81 |
| `clamp(28px, 4vw, 44px)` | 1 | pol-studio.css:124 |
| `clamp(32px, 5vw, 56px)` | 1 | pol-studio.css:408 |
| `calc(VAR + 32px)` | 1 | pol-studio.css:421 |
| `-12px` | 1 | pol-studio.css:439 |
| `-14px` | 1 | pol-studio.css:1021 |
| `18vh` | 1 | pol-studio.css:1677 |
| `env(safe-area-inset-bottom, 0px)` | 1 | pol-shell.css:360 |
| `calc(VAR + 36px)` | 1 | pol-shell.css:1042 |
| `0.35em` | 1 | pol-thread.css:1768 |
| `max(VAR, calc((100% - VAR) / 2 + VAR))` | 1 | pol-public.css:174 |
| `calc(48px + env(safe-area-inset-bottom))` | 1 | pol-public.css:210 |
| `88px` | 1 | pol-public.css:504 |
| `1.4em` | 1 | pol-public.css:1179 |
| `140px` | 1 | pol-public.css:1405 |
| `calc(140px + VAR)` | 1 | pol-public.css:1666 |
| `194px` | 1 | calls-c6.css:191 |
| `52px` | 1 | ui-sheets.css:128 |
| `-10px` | 1 | ui-sheets.css:348 |
| `min(14vh, 120px)` | 1 | ui-sheets.css:406 |
| `84px` | 1 | ui-sheets.css:706 |
| `calc(VAR + 44px)` | 1 | ui-sheets.css:721 |
| `136px` | 1 | ui-sheets.css:908 |
| `calc(VAR - 4px)` | 1 | ui-sheets.css:911 |
| `calc(VAR + max(0px, env(safe-area-inset-bottom, 0px) - VAR))` | 1 | ui-sheets.css:1045 |
| `calc(VAR + 6px)` | 1 | ui-sheets.css:1082 |
| `max(8px, calc(VAR + 4px))` | 1 | pol-ios.css:92 |
| `env(safe-area-inset-left, 0px)` | 1 | calls-engine.css:108 |
| `env(safe-area-inset-right, 0px)` | 1 | calls-engine.css:108 |

### G3.13 Raw dimensions — width / height / min / max / offsets / border widths / tracking (1012 declarations)

| value | count | where |
|---|---|---|
| `32px` | 96 | app.css:1920,1920,1957,2374,2374,2501,2551,2617,2700,2701,2890,2890,3044,3097,3108,3335,3344,3344,3557,3805,3806 · pol-stats.css:887,888 · pol-studio.css:545,752,1075,1140,1558,1607,1660 · pol-shell.css:15,33,50,51,162,163,303,472,590,603,665,798,880,937,1115,1129,1130,1274 · pol-thread.css:285,311,325,581,895,896,1263,1271,1375,1376,1377,1509,1531,1554,1595,1596,1643,1873,1874 · pol-roster.css:48 · pol-public.css:603,604,788,788,1110,1180,1277 · calls-c8.css:26 · polish.css:204 · roomsettings.css:191,219,254 · ui-sheets.css:201,505,524,525,525,529,530,531,532,756,806,806,925,926 · calls-engine.css:33,64 |
| `1px` | 55 | app.css:166,166,1979,1979,2152,2153,2179,2631,2921,2921,3148,3387,3387,3401,3401,3771,3908 · pol-studio.css:315,316 · pol-shell.css:614,615,1290,1355,1455,1456 · pol-thread.css:361,456,476,943,997,998,1082,1083,1302 · pol-roster.css:259,260 · pol-public.css:271,825 · calls-c8.css:66,66 · polish.css:366 · account2.css:13,13 · calls-c6.css:215,216 · ui-sheets.css:118,308,629,969,1083 · calls-engine.css:35,35,66,66,93 |
| `16px` | 53 | app.css:1068,1069,2391,2392,2812,2866,3221,3221 · pol-shell.css:597,597,644,645,703,704,1081,1081,1136,1136,1234,1235 · pol-thread.css:415,415,441,441,570,571,589,589,973,973,1151,1151,1337,1337,1609,1609 · pol-roster.css:84,84,300,300 · pol-public.css:708,709,731,732,1142,1143 · calls-c8.css:127 · calls-c6.css:185,185 · ui-sheets.css:452,453,637,638 |
| `28px` | 53 | app.css:2329,2329,2602,2769,2770,2911,3235,3235,3324 · pol-studio.css:546,1019,1020,1555,1564,1565,1722 · pol-shell.css:68,103,120,121,205,235,853,853,858,859,1027,1028,1198,1425 · pol-thread.css:617,617,638,1124,1142,1143,1292,1493 · pol-roster.css:72,73,143,289,290 · pol-public.css:261,261 · calls-c6.css:212 · calls-c4.css:55,57,57,119,119 · ui-sheets.css:553,554 |
| `36px` | 51 | app.css:2343,2456,2557,2801,3239,3317,3372,3406,3703 · pol-studio.css:1196,1703,1703 · pol-shell.css:315,631,632,658,942,943,956,1199,1302,1333 · pol-thread.css:370,962,1033,1059,1060,1281,1351 · pol-roster.css:377,397 · pol-public.css:248,573,574,1087,1249,1292 · calls-c8.css:114,118 · roomsettings.css:175 · ui-sheets.css:334,488,726,735,851,863,950,979,1074,1092 · calls-engine.css:97 |
| `14px` | 49 | app.css:241,242,3104,3104,3280,3280,3328,3328 · pol-shell.css:745,746,787,787,819,851,851,1363,1363 · pol-thread.css:648,648,666,666,1503,1503 · pol-roster.css:101,101,169,170 · calls-c8.css:49,49 · calls-c11.css:42,42 · roomsettings.css:39,39 · calls-c6.css:170,170 · calls-c4.css:35,40,53,53,108,108,123,123 · ui-sheets.css:541,541,934,934,937,937 |
| `18px` | 39 | app.css:563,3162,3163,3588 · pol-studio.css:1748,1749 · pol-shell.css:548,549,836,837,886,886,1324,1324,1334,1334 · pol-thread.css:29,30,1339,1339 · pol-roster.css:337,337 · pol-public.css:168,326,327,861 · calls-c8.css:108,108 · roomsettings.css:255 · ui-sheets.css:46,47,247,248,425,426,567,568,942,943 |
| `40px` | 39 | app.css:1751,1753,3194,3194 · pol-shell.css:675,676,1061,1220,1307,1317,1326,1335,1335,1440,1441,1441 · pol-thread.css:252,1289,1291,1308 · pol-roster.css:191,202,396 · pol-public.css:138,225,664,1312 · calls-c8.css:30,30,99 · polish.css:374 · roomsettings.css:237,336 · calls-c4.css:140,140 · ui-sheets.css:260,441,884,1075 |
| `44px` | 39 | app.css:2167,2322,2359,2741,2742,3079,3079,3083,3099,3119,3303,3391 · pol-studio.css:1139,1702,1702 · pol-shell.css:108,1182,1183,1195,1195,1221,1259,1259,1261,1266,1267,1398,1436 · pol-thread.css:252,388,1309 · pol-public.css:854,855 · ui-sheets.css:650,826,827,852,852,1098 |
| `8px` | 33 | app.css:273,274,297,298,838,839,1282,1760,1760,2076,2565,2568,2967,3184,3184,3393,3393 · pol-studio.css:1243,1244 · pol-shell.css:743 · pol-public.css:1043,1043 · account2.css:149,150 · roomsettings.css:100,101 · calls-c4.css:38,117,128 · ui-sheets.css:332,861,977,1090 |
| `20px` | 29 | app.css:2191,2192,3103 · pol-studio.css:1436 · pol-shell.css:521,522,639,639,1109,1109,1306,1306,1336,1336,1377 · pol-thread.css:254,254,337,1077,1077,1093,1094 · pol-roster.css:395,395 · polish.css:53,75,76 · ui-sheets.css:475,476 |
| `48px` | 28 | app.css:1936,1985,2012,3400,3400,3642 · pol-shell.css:576,1305,1368,1369,1389,1389 · pol-public.css:532,722,825,1397,1411,1421,1421 · calls-c8.css:44 · calls-c11.css:190,190 · ui-sheets.css:674,796,985,1099 · calls-engine.css:58,80 |
| `24px` | 25 | app.css:578,579,1284,2222,2585,2875,3118,3118,3193,3193,3277,3277 · pol-studio.css:437,438 · pol-shell.css:778,1229,1229,1255 · pol-public.css:109,109,262,262 · calls-c8.css:62 · calls-c6.css:98 · calls-c4.css:103 |
| `2px` | 25 | app.css:1997,2019,2327,2985,3104,3104 · pol-stats.css:63,123,810 · pol-studio.css:610,790 · pol-shell.css:643 · pol-thread.css:119,218,479,1893 · pol-public.css:46,168,861 · calls-c11.css:158 · polish.css:322 · roomsettings.css:264,265 · calls-c6.css:82 · calls-engine.css:28 |
| `4px` | 19 | app.css:572,1973,2076,3406 · pol-stats.css:750,910 · pol-shell.css:1232,1302,1377 · pol-thread.css:371,1216 · pol-roster.css:378 · calls-c4.css:127 · ui-sheets.css:335,591,864,980,1093 · calls-engine.css:97 |
| `22px` | 17 | app.css:2338 · pol-shell.css:1189,1189,1196,1196,1260,1260,1388,1388,1426,1426 · pol-thread.css:558 · pol-public.css:634,635,796 · calls-c8.css:17 · ui-sheets.css:518 |
| `6px` | 17 | app.css:2374,2374,2393,3202,3202,3255,3255,3313 · pol-stats.css:561,562 · pol-shell.css:1197,1431 · pol-thread.css:1674 · pol-public.css:1200 · ui-sheets.css:519,520,592 |
| `-2px` | 17 | app.css:2555,3277,3277 · pol-stats.css:317,1077 · pol-studio.css:283,1738 · pol-shell.css:1233,1431 · pol-roster.css:233,234 · pol-public.css:1501,1503,1538,1678 · account2.css:157,157 |
| `52px` | 15 | app.css:3535 · pol-studio.css:256 · pol-shell.css:896,1038,1038,1159,1425 · pol-roster.css:400 · pol-public.css:308 · polish.css:369 · calls-c6.css:243 · ui-sheets.css:420,524,843 · calls-engine.css:38 |
| `30px` | 14 | app.css:3208,3217 · pol-shell.css:753,762,788,1006 · pol-thread.css:228,229,414 · pol-roster.css:105 · pol-public.css:105,106 · calls-c6.css:184 · ui-sheets.css:737 |
| `56px` | 14 | app.css:3287,3287,3292,3303 · pol-studio.css:47,729 · pol-shell.css:1212,1377 · pol-thread.css:1897,1897 · pol-public.css:1350,1351 · calls-c11.css:126 · ui-sheets.css:620 |
| `10px` | 11 | app.css:571 · pol-stats.css:173,174,445,446 · pol-studio.css:227,228 · pol-shell.css:689,690 · pol-roster.css:235,236 |
| `560px` | 10 | app.css:1199,1357,1397,1537,2094,2658,2659 · pol-shell.css:969 · pol-thread.css:1252 · ui-sheets.css:411 |
| `12px` | 10 | app.css:2888,2888 · pol-shell.css:1165,1165,1324 · roomsettings.css:266,267 · calls-c4.css:114,126,129 |
| `72px` | 9 | app.css:2139,3195,3195,3286 · pol-thread.css:787,788 · pol-public.css:981 · ui-sheets.css:135,751 |
| `3px` | 8 | pol-stats.css:716 · pol-shell.css:642,691,811,819 · calls-c4.css:36,115,127 |
| `5px` | 8 | pol-studio.css:1330,1331,1506,1507 · pol-shell.css:1197 · pol-thread.css:143 · calls-c4.css:37,115 |
| `420px` | 7 | app.css:154,598,1158,3758 · pol-thread.css:687,701 · ui-sheets.css:134 |
| `200px` | 7 | app.css:1038,2458,3080,3230,3690 · pol-shell.css:573 · pol-thread.css:1898 |
| `360px` | 7 | app.css:1077,1786,1807,3605 · pol-shell.css:426 · pol-thread.css:696 · pol-roster.css:345 |
| `7px` | 7 | pol-shell.css:702,809,810,1044,1044 · pol-thread.css:1175,1175 |
| `2rem` | 6 | app.css:134,134,205 · pol-stats.css:964 · pol-thread.css:108,909 |
| `6rem` | 6 | pol-stats.css:327,534,785,963,964 · pol-studio.css:1765 |
| `26px` | 6 | pol-shell.css:1037,1037 · pol-thread.css:397,429,1104,1110 |
| `280px` | 5 | app.css:1284,1611,1633,2413 · calls-c8.css:44 |
| `64px` | 5 | app.css:1822,2109,3008 · pol-studio.css:420 · calls-engine.css:29 |
| `-1px` | 5 | app.css:1948,2564,2567 · pol-stats.css:941 · pol-public.css:1408 |
| `220px` | 5 | app.css:3050,3314 · pol-shell.css:471 · pol-thread.css:1034,1280 |
| `11px` | 5 | pol-shell.css:583,583 · pol-public.css:862 · calls-c4.css:39,116 |
| `312px` | 5 | pol-thread.css:343 · calls-c6.css:109,114,119,124 |
| `320px` | 4 | app.css:2445 · pol-thread.css:695,731 · polish.css:39 |
| `34px` | 4 | app.css:3103 · pol-studio.css:518 · pol-shell.css:1256,1256 |
| `96px` | 4 | app.css:3397 · pol-public.css:934 · calls-c8.css:114 · calls-c4.css:160 |
| `2.75rem` | 4 | pol-stats.css:826 · pol-thread.css:1705,1743,1744 |
| `21px` | 4 | pol-shell.css:1262,1262,1272,1272 |
| `4rem` | 4 | pol-thread.css:607,608,616,616 |
| `46rem` | 4 | pol-thread.css:1325 · pol-public.css:1580,1592,1593 |
| `380px` | 4 | calls-c11.css:136 · calls-c6.css:21 · ui-sheets.css:791,1060 |
| `182px` | 4 | calls-c6.css:110,115,120,125 |
| `640px` | 3 | app.css:816 · pol-shell.css:1050 · ui-sheets.css:135 |
| `340px` | 3 | app.css:1685,1739 · pol-thread.css:1269 |
| `440px` | 3 | app.css:1902,2222,3335 |
| `160px` | 3 | app.css:2356 · calls-c6.css:204 · calls-c4.css:139 |
| `40rem` | 3 | pol-stats.css:823 · pol-studio.css:345 · pol-public.css:649 |
| `28rem` | 3 | pol-studio.css:387 · pol-thread.css:1399 · pol-public.css:1530 |
| `15rem` | 3 | pol-studio.css:1262 · pol-public.css:1176,1474 |
| `520px` | 3 | pol-shell.css:573 · calls-c8.css:89 · account2.css:5 |
| `36rem` | 3 | pol-thread.css:658 · pol-public.css:506,1620 |
| `2.25rem` | 3 | pol-roster.css:402,402 · pol-public.css:1602 |
| `2.65rem` | 2 | app.css:135,135 |
| `400px` | 2 | app.css:339,2501 |
| `140px` | 2 | app.css:1210 · pol-shell.css:494 |
| `120px` | 2 | app.css:2117,2899 |
| `720px` | 2 | app.css:2295 · ui-sheets.css:667 |
| `480px` | 2 | app.css:2879 · pol-thread.css:756 |
| `16rem` | 2 | pol-stats.css:266,631 |
| `8rem` | 2 | pol-stats.css:803,816 |
| `1.25rem` | 2 | pol-stats.css:828,829 |
| `30rem` | 2 | pol-stats.css:896 · pol-public.css:771 |
| `34rem` | 2 | pol-studio.css:241 · pol-public.css:1341 |
| `27px` | 2 | pol-studio.css:317,318 |
| `168px` | 2 | pol-studio.css:512 · ui-sheets.css:682 |
| `9.5rem` | 2 | pol-studio.css:722 · pol-public.css:1216 |
| `22rem` | 2 | pol-studio.css:940 · pol-public.css:1048 |
| `13rem` | 2 | pol-studio.css:1100 · pol-public.css:928 |
| `6.5rem` | 2 | pol-studio.css:1757 · pol-public.css:1329 |
| `-8px` | 2 | pol-shell.css:688,808 |
| `-6px` | 2 | pol-shell.css:701 · ui-sheets.css:517 |
| `15px` | 2 | pol-shell.css:866,866 |
| `3.5rem` | 2 | pol-thread.css:502,503 |
| `260px` | 2 | pol-thread.css:694 · calls-c4.css:137 |
| `60px` | 2 | ui-sheets.css:840 · calls-engine.css:41 |
| `880px` | 1 | app.css:909 |
| `1.35rem` | 1 | app.css:1856 |
| `110px` | 1 | app.css:2941 |
| `760px` | 1 | app.css:3074 |
| `112px` | 1 | app.css:3262 |
| `76rem` | 1 | pol-stats.css:38 |
| `18rem` | 1 | pol-stats.css:132 |
| `1rem` | 1 | pol-stats.css:253 |
| `20rem` | 1 | pol-stats.css:395 |
| `10rem` | 1 | pol-stats.css:709 |
| `1.4rem` | 1 | pol-stats.css:824 |
| `3rem` | 1 | pol-stats.css:967 |
| `1040px` | 1 | pol-studio.css:79 |
| `51px` | 1 | pol-studio.css:303 |
| `31px` | 1 | pol-studio.css:304 |
| `26rem` | 1 | pol-studio.css:1043 |
| `5.5rem` | 1 | pol-studio.css:1272 |
| `0.6rem` | 1 | pol-studio.css:1498 |
| `3.25rem` | 1 | pol-studio.css:1588 |
| `12rem` | 1 | pol-studio.css:1659 |
| `248px` | 1 | pol-shell.css:968 |
| `68px` | 1 | pol-shell.css:1343 |
| `76px` | 1 | pol-shell.css:1352 |
| `-14px` | 1 | pol-thread.css:202 |
| `-22px` | 1 | pol-thread.css:250 |
| `216px` | 1 | pol-thread.css:320 |
| `232px` | 1 | pol-thread.css:342 |
| `1100px` | 1 | pol-thread.css:825 |
| `240px` | 1 | pol-thread.css:1267 |
| `38px` | 1 | pol-thread.css:1280 |
| `42px` | 1 | pol-thread.css:1291 |
| `24rem` | 1 | pol-thread.css:1673 |
| `17rem` | 1 | pol-public.css:902 |
| `52rem` | 1 | pol-public.css:1441 |
| `14rem` | 1 | pol-public.css:1466 |
| `9rem` | 1 | pol-public.css:1569 |
| `620px` | 1 | calls-c8.css:62 |
| `42rem` | 1 | polish.css:338 |
| `8.5rem` | 1 | roomsettings.css:312 |
| `300px` | 1 | calls-c6.css:98 |
| `56rem` | 1 | calls-c4.css:72 |
| `500px` | 1 | ui-sheets.css:122 |
| `600px` | 1 | ui-sheets.css:410 |
| `680px` | 1 | ui-sheets.css:486 |
| `460px` | 1 | ui-sheets.css:579 |
| `212px` | 1 | ui-sheets.css:672 |
| `84px` | 1 | ui-sheets.css:690 |
| `74px` | 1 | ui-sheets.css:895 |

### G3.14 Opacity values (78)

| value | count | where |
|---|---|---|
| `1` | 17 | app.css:1946,2558,3518 · pol-shell.css:868,1017 · pol-thread.css:152,222,421,1917 · pol-roster.css:178,253,306,398,415 · pol-public.css:1407 · ui-sheets.css:543,561 |
| `0.5` | 15 | app.css:174,656,1798,2018,3048,3572,3716 · pol-shell.css:28,57,250 · pol-thread.css:1471 · account2.css:58 · roomsettings.css:203,249 · calls-c6.css:186 |
| `0.45` | 11 | app.css:388,1573,1846,2531,2913 · pol-studio.css:608,786 · calls-c6.css:266 · calls-c4.css:20,125 · ui-sheets.css:211 |
| `0` | 11 | app.css:3268,3512 · pol-shell.css:863 · pol-thread.css:147,212,256,419 · pol-roster.css:122,173,304 · ui-sheets.css:539 |
| `0.6` | 8 | app.css:1950,3271,3274 · pol-stats.css:691 · pol-shell.css:1357 · pol-public.css:453 · polish.css:310 · calls-c6.css:65 |
| `0.55` | 6 | app.css:204,704 · pol-stats.css:516 · pol-roster.css:252 · calls-c6.css:187,265 |
| `0.7` | 3 | app.css:195 · pol-stats.css:225 · pol-studio.css:1481 |
| `0.8` | 2 | app.css:3123 · pol-thread.css:156 |
| `0.4` | 2 | pol-thread.css:1389 · calls-c6.css:130 |
| `0.62` | 1 | pol-thread.css:155 |
| `0.66` | 1 | pol-ios.css:38 |
| `0.72` | 1 | pol-ios.css:41 |

## G4. z-index ladder (every declaration, low → high)

| z | count | where (file:line selector) |
|---|---|---|
| `-1` | 1 | pol-studio.css:34 `.ap-background-host` |
| `1` | 5 | pol-stats.css:826 `.stats-page .stats-heatmap tbody th, .stats-page .stats-heat`<br>pol-studio.css:77 `.ap-wrap`<br>pol-thread.css:824 `.shell-msg-lightbox-dialog`<br>pol-thread.css:880 `.onyx-thread-sheet .onyx-thread-head`<br>calls-c4.css:96 `.onyx-tile-top, .onyx-tile-bottom` |
| `3` | 2 | calls-c8.css:38 `.onyx-call-reactions`<br>ui-sheets.css:896 `.onyx-account-body > .onyx-account-nav` @@media (max-width: 767.98px) |
| `4` | 2 | pol-thread.css:204 `.onyx-row-actions`<br>ui-sheets.css:153 `.onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)` |
| `5` | 3 | app.css:2969 `.onyx-jump-latest`<br>app.css:3447 `.onyx-frame > .onyx-primary-nav`<br>ui-sheets.css:713 `.onyx-moddesk-bar` |
| `10` | 1 | pol-studio.css:42 `.ap-bar` |
| `19` | 1 | pol-public.css:275 `.public-frame__nav` @@media (max-width: 768px) |
| `20` | 2 | app.css:3313 `.onyx-call-more`<br>pol-public.css:73 `.public-frame__header` |
| `21` | 1 | calls-c8.css:25 `.onyx-call-react-menu` |
| `40` | 6 | app.css:1292 `.onyx-schedule-pop`<br>app.css:1839 `.onyx-msg-menu-backdrop`<br>app.css:2398 `.shell-composer-popovers`<br>app.css:3681 `.onyx-room-more-scrim`<br>pol-thread.css:260 `.onyx-react-backdrop`<br>polish.css:38 `.shell-composer-tools` |
| `41` | 4 | app.css:1840 `.onyx-msg-menu`<br>app.css:3687 `.onyx-room-more-menu`<br>pol-thread.css:261 `.onyx-react-pop .onyx-react-picker`<br>pol-thread.css:339 `.onyx-msg-menu-pop, .onyx-react-pop` @@media (min-width: 768px) |
| `45` | 1 | app.css:3604 `.notif-center` |
| `50` | 3 | calls-c6.css:97 `.onyx-call-pip-card`<br>calls-c4.css:64 `.onyx-call-stage[data-size="fullscreen"]`<br>calls-engine.css:105 `.onyx-call-stage[data-size="expanded"], .onyx-call-stage[dat` @@media (max-width: 640px) |
| `58` | 1 | pol-shell.css:1279 `.onyx-frame .onyx-room-more-scrim` @@media (max-width: 767.98px) |
| `59` | 1 | pol-shell.css:1286 `.onyx-frame .onyx-room-more-menu` @@media (max-width: 767.98px) |
| `60` | 8 | app.css:1070 `.onyx-toaster`<br>app.css:3490 `.onyx-overlays`<br>app.css:3724 `.onyx-sheet-layer`<br>pol-shell.css:414 `.onyx-profile-pop:not(.onyx-sheet-layer)`<br>ui-sheets.css:57 `.onyx-sheet-layer`<br>ui-sheets.css:956 `.onyx-room-more-scrim` @@media (max-width: 767.98px)<br>ui-sheets.css:1057 `.onyx-profile-pop:not(.onyx-sheet-layer)`<br>calls-engine.css:90 `.onyx-call-more` @@media (max-width: 640px) |
| `61` | 1 | ui-sheets.css:966 `.onyx-room-more-menu` @@media (max-width: 767.98px) |
| `70` | 2 | pol-thread.css:348 `.onyx-msg-menu-backdrop, .onyx-react-backdrop` @@media (max-width: 767.98px)<br>polish.css:329 `.update-available` |
| `71` | 1 | pol-thread.css:356 `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-rea` @@media (max-width: 767.98px) |
| `80` | 3 | app.css:2647 `.onyx-spotlight`<br>calls-c6.css:18 `.onyx-sheet-layer.onyx-call-ring-layer`<br>ui-sheets.css:406 `.onyx-spotlight` |
| `90` | 1 | ui-sheets.css:788 `.onyx-toaster` |
| `100` | 2 | pol-thread.css:811 `.shell-msg-lightbox`<br>pol-public.css:55 `.public-frame__skip` |

## G5. Breakpoints and conditional blocks (every @media / @container / @supports)

| condition | blocks | where (file:line (rules inside)) |
|---|---|---|
| `@media (max-width: 359px)` | 2 | pol-public.css:342 (3) · pol-public.css:808 (1) |
| `@media (max-width: 360px)` | 1 | pol-shell.css:173 (1) |
| `@media (max-width: 400px)` | 1 | pol-stats.css:1039 (4) |
| `@media (max-width: 480px)` | 3 | app.css:2380 (2) · pol-studio.css:1708 (13) · pol-studio.css:1764 (2) |
| `@media (max-width: 520px)` | 1 | app.css:2035 (7) |
| `@media (max-width: 520px) and (max-height: 600px)` | 1 | app.css:2046 (4) |
| `@media (max-height: 520px) and (max-width: 1024px)` | 1 | ui-sheets.css:398 (1) |
| `@media (max-width: 600px)` | 2 | pol-public.css:775 (23) · pol-public.css:1157 (1) |
| `@media (max-width: 640px)` | 4 | app.css:3124 (26) · app.css:3386 (20) · calls-c11.css:189 (1) · calls-engine.css:63 (19) |
| `@media (min-width: 641px)` | 1 | calls-engine.css:17 (1) |
| `@container onyx-call (max-width: 760px)` | 1 | calls-engine.css:45 (7) |
| `@media (max-width: 767px) and (max-height: 480px)` | 1 | pol-stats.css:251 (1) |
| `@media (max-width: 767px)` | 6 | pol-stats.css:992 (33) · calls-c8.css:123 (9) · roomsettings.css:347 (2) · calls-c6.css:197 (16) · calls-c6.css:268 (1) · calls-c4.css:149 (12) |
| `@media (max-width: 767.98px)` | 22 | app.css:2863 (17) · app.css:2952 (13) · app.css:3855 (12) · pol-shell.css:493 (120) · pol-shell.css:1152 (118) · pol-shell.css:1466 (1) · pol-thread.css:346 (41) · pol-thread.css:1285 (31) · pol-thread.css:1566 (15) · pol-thread.css:1890 (8) · pol-roster.css:359 (13) · calls-c11.css:181 (5) · polish.css:357 (8) · account2.css:159 (2) · ui-sheets.css:289 (74) · ui-sheets.css:808 (57) · ui-sheets.css:822 (56) · ui-sheets.css:954 (15) · ui-sheets.css:1035 (11) · ui-sheets.css:1077 (5) · pol-ios.css:89 (4) · pol-ios.css:109 (3) |
| `@media (max-width: 768px), (pointer: coarse)` | 3 | pol-stats.css:1054 (1) · pol-studio.css:1776 (2) · pol-public.css:1657 (4) |
| `@media (max-width: 768px)` | 8 | pol-studio.css:1675 (12) · pol-public.css:256 (61) · pol-public.css:976 (39) · pol-public.css:1162 (34) · pol-public.css:1294 (31) · pol-public.css:1418 (16) · pol-public.css:1560 (12) · pol-public.css:1610 (3) |
| `@media (min-width: 768px)` | 4 | pol-shell.css:1140 (2) · pol-thread.css:333 (3) · calls-c6.css:190 (1) · pol-ios.css:99 (1) |
| `@media (max-width: 860px)` | 1 | pol-public.css:768 (4) |
| `@media (max-width: 880px)` | 1 | app.css:3379 (2) |
| `@media (max-width: 959.98px)` | 2 | app.css:3526 (1) · pol-shell.css:1146 (2) |
| `@container onyx-call (max-width: 1000px)` | 1 | calls-engine.css:32 (6) |
| `@media (max-width: 1024px)` | 2 | pol-stats.css:980 (9) · pol-public.css:764 (1) |
| `@media (max-width: 1099.98px)` | 2 | app.css:3521 (2) · pol-roster.css:330 (6) |
| `@media (min-width: 1100px)` | 1 | pol-roster.css:36 (1) |

Non-width conditions:

| condition | where |
|---|---|
| `@supports (height: 100dvh)` | app.css:116 (1) |
| `@media (prefers-reduced-motion: no-preference)` | app.css:2052 (1) · pol-studio.css:334 (1) · pol-public.css:473 (1) |
| `@media (prefers-reduced-motion: reduce)` | app.css:2676 (4) · app.css:3273 (3) · app.css:3916 (2) · pol-stats.css:1061 (1) · pol-shell.css:499 (2) · pol-shell.css:1446 (1) · pol-thread.css:1907 (2) · pol-roster.css:407 (2) · calls-c8.css:55 (1) · calls-c11.css:169 (1) · polish.css:377 (1) · account2.css:164 (1) · roomsettings.css:352 (1) · calls-c6.css:272 (1) · calls-c4.css:143 (1) · pol-ios.css:129 (1) · calls-engine.css:121 (1) |
| `@media (forced-colors: active)` | pol-stats.css:1065 (5) · pol-studio.css:328 (6) · pol-studio.css:1732 (2) · pol-shell.css:176 (1) · pol-thread.css:1914 (3) · pol-roster.css:412 (3) · pol-public.css:1671 (3) · polish.css:382 (3) |
| `@media (hover: hover)` | pol-studio.css:281 (1) · pol-roster.css:214 (2) · pol-roster.css:246 (1) · pol-public.css:167 (1) · ui-sheets.css:994 (7) |
| `@media (hover: none)` | pol-shell.css:1016 (1) · pol-thread.css:249 (5) · ui-sheets.css:560 (1) · pol-ios.css:36 (2) |
| `@media (hover: hover) and (pointer: fine)` | pol-thread.css:418 (2) · pol-roster.css:303 (3) |
| `@media (pointer: coarse)` | ui-sheets.css:378 (1) |
| `@supports (animation-timeline: scroll())` | ui-sheets.css:383 (2) |
| `@media (display-mode: standalone)` | pol-ios.css:117 (2) |

Distinct width thresholds (feature value × blocks): `max-width 359px`×2 · `max-width 360px`×1 · `max-width 400px`×1 · `max-width 480px`×3 · `max-height 480px`×1 · `max-width 520px`×2 · `max-height 520px`×1 · `max-height 600px`×1 · `max-width 600px`×2 · `max-width 640px`×4 · `min-width 641px`×1 · `max-width 760px`×1 · `max-width 767px`×7 · `max-width 767.98px`×22 · `max-width 768px`×11 · `min-width 768px`×4 · `max-width 860px`×1 · `max-width 880px`×1 · `max-width 959.98px`×2 · `max-width 1000px`×1 · `max-width 1024px`×3 · `max-width 1099.98px`×2 · `min-width 1100px`×1

## G6. Motion inventory

Global reduced-motion kill switches (`*` with !important): app.css:3924; `data-reduce-motion` rules: app.css:3135 {animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important} · app.css:3933 {--dur-micro: 0ms; --dur-fast: 0ms; --dur-base: 0ms; --dur: 0ms} · app.css:3940 {animation: none !important}.

Every prefers-reduced-motion block: app.css:2052 ((prefers-reduced-motion: no-preference), 1 rules) · app.css:2676 ((prefers-reduced-motion: reduce), 4 rules) · app.css:3273 ((prefers-reduced-motion: reduce), 3 rules) · app.css:3916 ((prefers-reduced-motion: reduce), 2 rules) · pol-stats.css:1061 ((prefers-reduced-motion: reduce), 1 rules) · pol-studio.css:334 ((prefers-reduced-motion: no-preference), 1 rules) · pol-shell.css:499 ((prefers-reduced-motion: reduce), 2 rules) · pol-shell.css:1446 ((prefers-reduced-motion: reduce), 1 rules) · pol-thread.css:1907 ((prefers-reduced-motion: reduce), 2 rules) · pol-roster.css:407 ((prefers-reduced-motion: reduce), 2 rules) · pol-public.css:473 ((prefers-reduced-motion: no-preference), 1 rules) · calls-c8.css:55 ((prefers-reduced-motion: reduce), 1 rules) · calls-c11.css:169 ((prefers-reduced-motion: reduce), 1 rules) · polish.css:377 ((prefers-reduced-motion: reduce), 1 rules) · account2.css:164 ((prefers-reduced-motion: reduce), 1 rules) · roomsettings.css:352 ((prefers-reduced-motion: reduce), 1 rules) · calls-c6.css:272 ((prefers-reduced-motion: reduce), 1 rules) · calls-c4.css:143 ((prefers-reduced-motion: reduce), 1 rules) · pol-ios.css:129 ((prefers-reduced-motion: reduce), 1 rules) · calls-engine.css:121 ((prefers-reduced-motion: reduce), 1 rules).

| @keyframes | defined | used by | loops? |
|---|---|---|---|
| `onyx-switcher-in` | app.css:2672 | app.css:2668 |  |
| `onyx-moddesk-in` | app.css:2886 | app.css:2884 |  |
| `onyx-call-breathe` | app.css:3272 | app.css:3270 | **infinite** |
| `onyx-sheet-in` | app.css:3778 | app.css:3696, app.css:3765, app.css:3910, pol-shell.css:1293, pol-thread.css:363, pol-thread.css:827, pol-roster.css:353 |  |
| `onyx-sheet-side-in` | app.css:3782 | app.css:3773 |  |
| `pt-pulse` | pol-thread.css:1679 | pol-thread.css:1677 | **infinite** |
| `onyx-call-react-in` | calls-c8.css:53 | calls-c8.css:47 |  |
| `polish-rise` | polish.css:352 | polish.css:48, polish.css:347 |  |
| `ui-sheet-pop` | ui-sheets.css:85 | ui-sheets.css:73, ui-sheets.css:801, ui-sheets.css:1067 |  |
| `ui-sheet-veil-in` | ui-sheets.css:88 | ui-sheets.css:61, ui-sheets.css:407, ui-sheets.css:838, ui-sheets.css:958, ui-sheets.css:1058 |  |
| `ui-sheet-side` | ui-sheets.css:91 | ui-sheets.css:120 |  |
| `ui-sheet-drop` | ui-sheets.css:94 | ui-sheets.css:136, ui-sheets.css:415 |  |
| `ui-sheet-rise` | ui-sheets.css:97 | ui-sheets.css:311, ui-sheets.css:972, ui-sheets.css:1085 |  |
| `ui-sheet-veil-track` | ui-sheets.css:392 | ui-sheets.css:386 |  |

Every animation declaration (43):

| file:line | selector | value | context |
|---|---|---|---|
| app.css:2668 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | `onyx-switcher-in var(--dur-fast) ease-out` |  |
| app.css:2677 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | `none` | @media (prefers-reduced-motion: reduce) |
| app.css:2884 | `.onyx-moddesk-sheet` | `onyx-moddesk-in var(--dur-base) ease-out` |  |
| app.css:3270 | `.onyx-call-person[data-speaking="true"] .onyx-call-ring::after` | `onyx-call-breathe 1.6s ease-in-out infinite` |  |
| app.css:3271 | `.onyx-call-stage[data-motion="still"] .onyx-call-person[data-speaking=` | `none` |  |
| app.css:3274 | `.onyx-call-person[data-speaking="true"] .onyx-call-ring::after` | `none` | @media (prefers-reduced-motion: reduce) |
| app.css:3696 | `.onyx-room-more-menu` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| app.css:3765 | `.onyx-sheet-layer > .onyx-sheet` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| app.css:3773 | `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` | `onyx-sheet-side-in` |  |
| app.css:3910 | `.onyx-sheet-layer > .onyx-sheet, .onyx-sheet-layer[data-placement="sid` | `onyx-sheet-in` | @media (max-width: 767.98px) |
| app.css:3927 | `*, *::before, *::after` | `none` !important | @media (prefers-reduced-motion: reduce) |
| app.css:3942 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *` | `none` !important |  |
| pol-shell.css:502 | `.notif-center *, .onyx-account-chip, .onyx-ident` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-shell.css:1293 | `.onyx-frame .onyx-room-more-menu` | `onyx-sheet-in var(--dur-fast) var(--ease)` | @media (max-width: 767.98px) |
| pol-thread.css:363 | `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-react-picker` | `onyx-sheet-in var(--dur-base) var(--ease)` | @media (max-width: 767.98px) |
| pol-thread.css:827 | `.shell-msg-lightbox-dialog` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| pol-thread.css:1677 | `.room-media-index-skeleton` | `pt-pulse 1.6s ease-in-out infinite` |  |
| pol-thread.css:1911 | `.shell-msg-lightbox-dialog, .room-media-index-skeleton` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-roster.css:353 | `.onyx-frame > .onyx-roster:popover-open, .onyx-roster:popover-open` | `onyx-sheet-in var(--dur-base) var(--ease)` | @media (max-width: 1099.98px) |
| pol-roster.css:408 | `.onyx-roster:popover-open` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-c8.css:47 | `.onyx-call-reaction` | `onyx-call-react-in var(--dur-fast) var(--ease) both` |  |
| calls-c8.css:54 | `.onyx-call-stage[data-motion="still"] .onyx-call-reaction` | `none` |  |
| calls-c8.css:56 | `.onyx-call-reaction` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-c11.css:167 | `.onyx-call-stage[data-motion="still"] .onyx-call-ring::after` | `none` |  |
| calls-c11.css:176 | `.onyx-call-ring::after, .onyx-tile, .onyx-tile-video, .onyx-call-pip-c` | `none` | @media (prefers-reduced-motion: reduce) |
| polish.css:48 | `.shell-composer-tools` | `polish-rise var(--dur-fast) var(--ease)` |  |
| polish.css:347 | `.update-available` | `polish-rise var(--dur-base) var(--ease)` |  |
| polish.css:379 | `.shell-composer-tools, .update-available` | `none` | @media (prefers-reduced-motion: reduce) |
| ui-sheets.css:61 | `.onyx-sheet-backdrop` | `ui-sheet-veil-in var(--dur-base) var(--ease)` |  |
| ui-sheets.css:73 | `.onyx-sheet-layer > .onyx-sheet` | `ui-sheet-pop var(--dur-base) var(--ease)` |  |
| ui-sheets.css:120 | `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` | `ui-sheet-side` |  |
| ui-sheets.css:136 | `.onyx-sheet-layer[data-placement="popover"] > .onyx-sheet` | `ui-sheet-drop` |  |
| ui-sheets.css:311 | `.onyx-sheet-layer > .onyx-sheet, .onyx-sheet-layer[data-placement] > .` | `ui-sheet-rise var(--dur-base) var(--ease)` | @media (max-width: 767.98px) |
| ui-sheets.css:386 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet-backdrop` | `ui-sheet-veil-track linear both` | @media (max-width: 767.98px) && @supports (animati |
| ui-sheets.css:407 | `.onyx-spotlight-backdrop` | `ui-sheet-veil-in var(--dur-fast) var(--ease)` |  |
| ui-sheets.css:415 | `.onyx-spotlight-panel` | `ui-sheet-drop var(--dur-fast) var(--ease)` |  |
| ui-sheets.css:801 | `.onyx-toast` | `ui-sheet-pop var(--dur-base) var(--ease)` |  |
| ui-sheets.css:838 | `.onyx-spotlight-panel` | `ui-sheet-veil-in` | @media (max-width: 767.98px) |
| ui-sheets.css:958 | `.onyx-room-more-scrim` | `ui-sheet-veil-in var(--dur-base) var(--ease)` | @media (max-width: 767.98px) |
| ui-sheets.css:972 | `.onyx-room-more-menu` | `ui-sheet-rise var(--dur-base) var(--ease)` | @media (max-width: 767.98px) |
| ui-sheets.css:1058 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-profile-backdrop` | `ui-sheet-veil-in var(--dur-base) var(--ease)` |  |
| ui-sheets.css:1067 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` | `ui-sheet-pop var(--dur-base) var(--ease)` |  |
| ui-sheets.css:1085 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` | `ui-sheet-rise` | @media (max-width: 767.98px) |

Every transition declaration (49):

| file:line | selector | value | context |
|---|---|---|---|
| app.css:2053 | `.conn-input, .conn-submit, .conn-alt-btn, .conn-foot a` | `border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), color var(--` | @media (prefers-reduced-motion: no-preference) |
| app.css:3104 | `.pref-switch::after` | `transform var(--dur-fast, var(--dur-fast))` |  |
| app.css:3140 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *` | `transition-duration: 0.001ms` !important |  |
| app.css:3514 | `.onyx-primary-nav .onyx-nav-label` | `opacity var(--dur-fast) var(--ease)` |  |
| app.css:3928 | `*, *::before, *::after` | `transition-duration: 0ms` !important | @media (prefers-reduced-motion: reduce) |
| pol-stats.css:111 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn` | `border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease)` |  |
| pol-stats.css:221 | `.status-check__button, .status-quiet-link` | `border-color var(--dur-fast) var(--ease)` |  |
| pol-stats.css:313 | `.roadmap-legend a` | `background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)` |  |
| pol-stats.css:511 | `.stats-page :is(.stats-refresh, .data-action, .public-room-comparison_` | `border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease)` |  |
| pol-stats.css:683 | `.stats-page :is(.stats-window-options, .stats-control-group) button` | `background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)` |  |
| pol-stats.css:1062 | `:is(.stats-page, .status-route, .roadmap-page) *` | `none` !important | @media (prefers-reduced-motion: reduce) |
| pol-studio.css:63 | `.ap-bar a` | `color var(--dur-fast) var(--ease)` |  |
| pol-studio.css:184 | `.ap-chip, .ap-theme-chip` | `color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), background var(--dur-fa` |  |
| pol-studio.css:269 | `.ap-choice-toggle` | `background var(--dur-fast) var(--ease)` |  |
| pol-studio.css:336 | `.ap-choice-toggle > b, .ap-choice-toggle > b::after` | `transform var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease)` | @media (prefers-reduced-motion: no-preference) |
| pol-studio.css:531 | `.background-picker__card` | `border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)` |  |
| pol-studio.css:595 | `.ap-action` | `background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)` |  |
| pol-studio.css:765 | `.ts-studio .onyx-button` | `background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fa` |  |
| pol-studio.css:912 | `.ts-scheme-toggle__btn` | `background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)` |  |
| pol-studio.css:978 | `.ts-theme-chip` | `color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), background var(--dur-fa` |  |
| pol-studio.css:1031 | `.ts-theme-chip-del` | `color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)` |  |
| pol-studio.css:1085 | `.ts-studio .onyx-tabs__trigger` | `background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)` |  |
| pol-studio.css:1618 | `.ts-audit__fix` | `background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)` |  |
| pol-shell.css:502 | `.notif-center *, .onyx-account-chip, .onyx-ident` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-shell.css:864 | `.onyx-rail .onyx-rail-star` | `opacity var(--dur-fast) var(--ease)` |  |
| pol-shell.css:1447 | `.onyx-rail .onyx-rail-star` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-thread.css:148 | `.onyx-continuation:not(.onyx-message--compact) > .onyx-ts` | `opacity var(--dur-micro) var(--ease)` |  |
| pol-thread.css:214 | `.onyx-row-actions` | `opacity var(--dur-micro) var(--ease)` |  |
| pol-thread.css:419 | `.onyx-message .boost-add` | `opacity var(--dur-micro) var(--ease)` | @media (hover: hover) and (pointer: fine) |
| pol-thread.css:1017 | `.onyx-composer-bar` | `border-color var(--dur-micro) var(--ease)` |  |
| pol-thread.css:1098 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell` | `transform var(--dur-fast) var(--ease)` |  |
| pol-thread.css:1909 | `.onyx-continuation > .onyx-ts, .onyx-message > .onyx-msg-menu-trigger` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-roster.css:174 | `.onyx-mlist-group-head > .pt-ico` | `transform var(--dur-fast) var(--ease), opacity var(--dur-micro) var(--ease)` |  |
| pol-roster.css:409 | `.onyx-mlist-group-head > .pt-ico` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-public.css:488 | `.public-frame__nav a, .public-frame__open, .public-frame__menu-toggle ` | `color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), border-color var(--` | @media (prefers-reduced-motion: no-preference) |
| calls-c11.css:165 | `.onyx-call-stage[data-motion="still"] .onyx-tile, .onyx-call-stage[dat` | `none` |  |
| calls-c11.css:176 | `.onyx-call-ring::after, .onyx-tile, .onyx-tile-video, .onyx-call-pip-c` | `none` | @media (prefers-reduced-motion: reduce) |
| account2.css:51 | `.a2-btn, .a2-link` | `border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)` |  |
| account2.css:166 | `.a2-btn, .a2-link` | `none` | @media (prefers-reduced-motion: reduce) |
| roomsettings.css:270 | `.rset-toggle-thumb` | `transform var(--dur-fast) var(--ease)` |  |
| roomsettings.css:353 | `.rset-toggle-thumb` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-c6.css:105 | `.onyx-call-pip-card` | `opacity var(--dur-fast) var(--ease)` |  |
| calls-c6.css:273 | `.onyx-call-pip-card` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-c4.css:144 | `.onyx-tile, .onyx-tile-video` | `none` | @media (prefers-reduced-motion: reduce) |
| ui-sheets.css:445 | `.onyx-spotlight-option` | `background-color var(--dur-micro) linear` |  |
| ui-sheets.css:627 | `.onyx-you .onyx-you-link` | `background-color var(--dur-micro) linear` |  |
| pol-ios.css:39 | `.onyx-frame :where(button, summary, [role="button"], [role="menuitem"]` | `opacity 0ms` | @media (hover: none) |
| pol-ios.css:130 | `.onyx-frame :where(button, summary, [role="button"]):active` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-engine.css:122 | `.onyx-call-more` | `none` | @media (prefers-reduced-motion: reduce) |

scroll-behavior declarations: app.css:3141 auto · app.css:3929 auto @@media (prefers-reduced-motion: reduce)

Script-driven motion in ports.js: 3423 `requestAnimationFrame(` · 9962 `requestAnimationFrame(`

## G7. Accent audit (every declaration painting with the accent or an alias of it)

Accent tokens and their derived aliases: `--onyx-accent`, `--onyx-accent-ink`, `--lapis`, `--lapis-bright`, `--lapis-deep`, `--brand-action`, `--accent`, `--seam`, `--seam-faint`, `--pg-live`, `--pg-select`. `--focus-ring` uses are listed as focus.

| category (classified from selector + property) | declarations |
|---|---|
| primary action | 99 |
| selection / toggle state | 47 |
| focus | 41 |
| unread / count / badge / pill | 20 |
| current location | 17 |
| mention | 14 |
| theme preview (intended theme accent) | 13 |
| other (outside the budget) | 12 |
| status (success / online) | 10 |
| live-audio (calls) | 7 |
| link / nav text | 6 |
| control fill / data-viz | 5 |
| token alias | 3 |

### G7 · primary action (99)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:379 | `.onyx-reclaim-submit` | color | --onyx-accent-ink |
| app.css:380 | `.onyx-reclaim-submit` | background | --onyx-accent |
| app.css:381 | `.onyx-reclaim-submit` | border | --onyx-accent |
| app.css:655 | `.onyx-newmsg-primary` | background | --onyx-accent |
| app.css:655 | `.onyx-newmsg-primary` | border | --onyx-accent |
| app.css:655 | `.onyx-newmsg-primary` | color | --onyx-accent-ink |
| app.css:776 | `.onyx-composer button` | background | --onyx-accent |
| app.css:779 | `.onyx-composer button` | color | --onyx-accent-ink |
| app.css:885 | `.onyx-calls-primary` | background | --onyx-accent |
| app.css:888 | `.onyx-calls-primary` | color | --onyx-accent-ink |
| app.css:938 | `.onyx-land-open` | background | --onyx-accent |
| app.css:940 | `.onyx-land-open` | color | --onyx-accent-ink |
| app.css:1100 | `.onyx-toast__undo` | color | --onyx-accent |
| app.css:1102 | `.onyx-toast__undo` | border | --onyx-accent |
| app.css:1134 | `.guest-claim-chip__keep` | color | --onyx-accent-ink |
| app.css:1135 | `.guest-claim-chip__keep` | background | --onyx-accent |
| app.css:1136 | `.guest-claim-chip__keep` | border | --onyx-accent |
| app.css:1174 | `.guest-claim-sheet__submit` | color | --onyx-accent-ink |
| app.css:1175 | `.guest-claim-sheet__submit` | background | --onyx-accent |
| app.css:1176 | `.guest-claim-sheet__submit` | border | --onyx-accent |
| app.css:1327 | `.onyx-composer .onyx-schedule-confirm` | background | --onyx-accent |
| app.css:1330 | `.onyx-composer .onyx-schedule-confirm` | color | --onyx-accent-ink |
| app.css:1574 | `.onyx-steward-btn-primary` | background | --onyx-accent |
| app.css:1574 | `.onyx-steward-btn-primary` | border-color | --onyx-accent |
| app.css:1574 | `.onyx-steward-btn-primary` | color | --onyx-accent-ink |
| app.css:1989 | `.conn-submit` | color | --onyx-accent-ink |
| app.css:1990 | `.conn-submit` | background | --onyx-accent |
| app.css:1996 | `.conn-submit:hover:not(:disabled)` | background | --onyx-accent |
| app.css:2000 | `.conn-submit:disabled` | background | --onyx-accent |
| app.css:2032 | `.conn-submit:active:not(:disabled)` | background | --onyx-accent |
| app.css:2528 | `.jump-to-date__jump` | color | --onyx-accent-ink |
| app.css:2529 | `.jump-to-date__jump` | background | --onyx-accent |
| app.css:2606 | `.onyx-member-action--primary` | background | --onyx-accent |
| app.css:2606 | `.onyx-member-action--primary` | border-color | --onyx-accent |
| app.css:2606 | `.onyx-member-action--primary` | color | --onyx-accent-ink |
| app.css:2607 | `.onyx-member-action--primary:hover` | background | --onyx-accent |
| app.css:3047 | `.onyx-keychange-accept` | background | --onyx-accent |
| app.css:3047 | `.onyx-keychange-accept` | border | --onyx-accent |
| app.css:3047 | `.onyx-keychange-accept` | color | --onyx-accent-ink |
| pol-stats.css:114 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary` | border-color | --onyx-accent |
| pol-stats.css:115 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary` | color | --onyx-accent-ink |
| pol-stats.css:116 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary` | background | --onyx-accent |
| pol-stats.css:119 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary:hover` | background | --onyx-accent |
| pol-stats.css:565 | `.stats-page .stats-primary-metric .note i` | background | --pg-live |
| pol-studio.css:603 | `.ap-action--apply` | color | --onyx-accent-ink |
| pol-studio.css:604 | `.ap-action--apply` | background | --onyx-accent |
| pol-studio.css:605 | `.ap-action--apply` | border-color | --onyx-accent |
| pol-studio.css:775 | `.ts-studio .onyx-button--primary` | color | --onyx-accent-ink |
| pol-studio.css:776 | `.ts-studio .onyx-button--primary` | background | --onyx-accent |
| pol-studio.css:777 | `.ts-studio .onyx-button--primary` | border-color | --onyx-accent |
| pol-studio.css:781 | `.ts-studio .onyx-button--primary:hover:not(:disabled)` | background | --onyx-accent |
| pol-studio.css:1385 | `.ts-pv-badge--accent` | color | --lapis-bright |
| pol-studio.css:1385 | `.ts-pv-badge--accent` | color | --onyx-accent |
| pol-studio.css:1386 | `.ts-pv-badge--accent` | border-color | --lapis-bright |
| pol-studio.css:1386 | `.ts-pv-badge--accent` | border-color | --onyx-accent |
| pol-studio.css:1448 | `.ts-pv-btn--primary` | color | --onyx-accent-ink |
| pol-studio.css:1449 | `.ts-pv-btn--primary` | background | --lapis |
| pol-studio.css:1449 | `.ts-pv-btn--primary` | background | --onyx-accent |
| pol-shell.css:298 | `.chb .chb-submit` | color | --onyx-accent-ink |
| pol-shell.css:299 | `.chb .chb-submit` | background | --onyx-accent |
| pol-shell.css:300 | `.chb .chb-submit` | border-color | --onyx-accent |
| pol-shell.css:1062 | `.onyx-home .onyx-home-action--primary` | color | --onyx-accent-ink |
| pol-shell.css:1062 | `.onyx-home .onyx-home-action--primary` | background | --onyx-accent |
| pol-shell.css:1062 | `.onyx-home .onyx-home-action--primary` | border-color | --onyx-accent |
| pol-thread.css:967 | `.onyx-frame .onyx-thread-reply` | color | --onyx-accent-ink |
| pol-thread.css:968 | `.onyx-frame .onyx-thread-reply` | background | --onyx-accent |
| pol-thread.css:1115 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready` | background | --onyx-accent |
| pol-thread.css:1115 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready` | color | --onyx-accent-ink |
| pol-thread.css:1116 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(:disabled)` | background | --onyx-accent |
| pol-thread.css:1116 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(:disabled)` | color | --onyx-accent-ink |
| pol-public.css:141 | `.public-frame__open` | color | --onyx-accent-ink |
| pol-public.css:142 | `.public-frame__open` | background | --onyx-accent |
| pol-public.css:148 | `.public-frame__open:hover` | background | --onyx-accent |
| pol-public.css:441 | `.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .gu` | border-color | --onyx-accent |
| pol-public.css:442 | `.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .gu` | color | --onyx-accent-ink |
| pol-public.css:443 | `.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .gu` | background | --onyx-accent |
| pol-public.css:449 | `.r-btn.primary:hover, .not-found-page__action:hover, .onyxos-button--primary:hover, .guide` | border-color | --onyx-accent |
| pol-public.css:450 | `.r-btn.primary:hover, .not-found-page__action:hover, .onyxos-button--primary:hover, .guide` | background | --onyx-accent |
| pol-public.css:540 | `.onyx-land-open` | border-color | --onyx-accent |
| pol-public.css:540 | `.onyx-land-open` | color | --onyx-accent-ink |
| pol-public.css:540 | `.onyx-land-open` | background | --onyx-accent |
| pol-public.css:541 | `.onyx-land-open:hover` | background | --onyx-accent |
| pol-public.css:1650 | `.public-frame :is(.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guide` | background | --onyx-accent |
| polish.css:305 | `.polish-primary, .update-available button` | background | --onyx-accent |
| polish.css:306 | `.polish-primary, .update-available button` | border | --onyx-accent |
| polish.css:307 | `.polish-primary, .update-available button` | color | --onyx-accent-ink |
| account2.css:59 | `.a2-btn--primary` | border-color | --onyx-accent |
| account2.css:59 | `.a2-btn--primary` | background | --onyx-accent |
| account2.css:59 | `.a2-btn--primary` | color | --onyx-accent-ink |
| account2.css:117 | `.a2-reclaim__signin` | border-color | --onyx-accent |
| account2.css:117 | `.a2-reclaim__signin` | background | --onyx-accent |
| account2.css:117 | `.a2-reclaim__signin` | color | --onyx-accent-ink |
| roomsettings.css:206 | `.rset-btn-primary` | color | --onyx-accent-ink |
| roomsettings.css:207 | `.rset-btn-primary` | background | --onyx-accent |
| roomsettings.css:208 | `.rset-btn-primary` | border-color | --onyx-accent |
| roomsettings.css:212 | `.rset-btn-primary:hover` | background | --onyx-accent |
| ui-sheets.css:265 | `.onyx-sheet :is(.onyx-newmsg-primary, .polish-primary, .chb-submit, .guest-claim-sheet__su` | color | --onyx-accent-ink |
| ui-sheets.css:266 | `.onyx-sheet :is(.onyx-newmsg-primary, .polish-primary, .chb-submit, .guest-claim-sheet__su` | background | --onyx-accent |
| ui-sheets.css:267 | `.onyx-sheet :is(.onyx-newmsg-primary, .polish-primary, .chb-submit, .guest-claim-sheet__su` | border | --onyx-accent |

### G7 · selection / toggle state (47)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:185 | `.shell-topic-card-follow.is-active` | border-color | --onyx-accent |
| app.css:187 | `.shell-topic-follow.is-active` | border-color | --onyx-accent |
| app.css:188 | `.shell-topic-action.is-active` | border-color | --onyx-accent |
| app.css:194 | `.topic-chip.is-active` | border-color | --onyx-accent |
| app.css:509 | `.onyx-rail .onyx-rail-filter-unread-on` | border-color | --onyx-accent |
| app.css:510 | `.onyx-rail .onyx-rail-filter-unread-on` | color | --onyx-accent |
| app.css:592 | `.onyx-rail .onyx-rail-star-on` | color | --onyx-accent |
| app.css:700 | `.onyx-audience-toggle-set` | color | --onyx-accent |
| app.css:701 | `.onyx-audience-toggle-set` | border-color | --onyx-accent |
| app.css:805 | `.onyx-calls-toggle-open` | border-color | --onyx-accent |
| app.css:806 | `.onyx-calls-toggle-open` | color | --onyx-accent |
| app.css:1003 | `.onyx-land-tabs button[aria-selected="true"]` | border-color | --onyx-accent |
| app.css:1212 | `.chb-sort-btn[aria-pressed="true"]` | color | --onyx-accent |
| app.css:1212 | `.chb-sort-btn[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:1246 | `.chb-skin[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:1974 | `.conn-strength-on` | background | --onyx-accent |
| app.css:2091 | `.onyx-notify-toggle-open` | border-color | --onyx-accent |
| app.css:2091 | `.onyx-notify-toggle-open` | color | --onyx-accent |
| app.css:2110 | `.notify-toggle[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:2110 | `.notify-toggle[aria-pressed="true"]` | color | --onyx-accent |
| app.css:2129 | `.room-notify-seg[aria-checked="true"]` | border-color | --onyx-accent |
| app.css:2129 | `.room-notify-seg[aria-checked="true"]` | color | --onyx-accent |
| app.css:2482 | `.onyx-composer .shell-composer-tool--emoji[aria-expanded="true"]` | border-color | --onyx-accent |
| app.css:2712 | `.onyx-dmsafe-trigger[aria-expanded="true"]` | border-color | --onyx-accent |
| app.css:2810 | `.onyx-spotlight-option[aria-selected="true"]` | border-left-color | --onyx-accent |
| app.css:2877 | `.onyx-moddesk-toggle[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:2934 | `.onyx-moddesk-sheet .moderation-cockpit__mode[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:3098 | `.pref-segment[aria-checked="true"]` | border-color | --onyx-accent |
| app.css:3098 | `.pref-segment[aria-checked="true"]` | color | --onyx-accent |
| app.css:3105 | `.pref-toggle[aria-checked="true"] .pref-switch` | border-color | --onyx-accent |
| app.css:3106 | `.pref-toggle[aria-checked="true"] .pref-switch::after` | background | --onyx-accent |
| app.css:3212 | `.onyx-voice-chip[data-active="true"]` | border-color | --onyx-accent |
| pol-stats.css:687 | `.stats-page :is(.stats-window-options, .stats-control-group) button:is([aria-pressed='true` | border-color | --onyx-accent |
| pol-stats.css:689 | `.stats-page :is(.stats-window-options, .stats-control-group) button:is([aria-pressed='true` | background | --pg-select |
| pol-stats.css:956 | `.stats-page .data-room-row[data-selected='true']` | box-shadow | --onyx-accent |
| pol-stats.css:973 | `.stats-page .data-action:is(.data-action--compare, .data-action--inspect)[aria-pressed='tr` | border-color | --onyx-accent |
| pol-stats.css:974 | `.stats-page .data-action:is(.data-action--compare, .data-action--inspect)[aria-pressed='tr` | background | --pg-select |
| pol-studio.css:1322 | `.ts-pv-chan[data-active='true']` | background | --lapis-deep |
| pol-studio.css:1325 | `.ts-pv-chan[data-active='true'] .ts-pv-chan__hash` | color | --lapis-bright |
| pol-studio.css:1325 | `.ts-pv-chan[data-active='true'] .ts-pv-chan__hash` | color | --onyx-accent |
| pol-thread.css:1265 | `.onyx-composer .shell-command-item--active` | box-shadow | --onyx-accent |
| pol-thread.css:1655 | `.room-media-index-filter[aria-selected='true']` | box-shadow | --onyx-accent |
| pol-public.css:1289 | `.guides-step-toggle[aria-pressed="true"]` | border-color | --onyx-accent |
| pol-public.css:1290 | `.guides-step-toggle[aria-pressed="true"]::before` | color | --onyx-accent |
| pol-public.css:1499 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | --onyx-accent |
| pol-public.css:1570 | `.onyxos-console__tabs button[aria-selected="true"]` @@media (max-width: 768px) | box-shadow | --onyx-accent |
| ui-sheets.css:449 | `.onyx-spotlight-option[aria-selected="true"]` | box-shadow | --onyx-accent |

### G7 · focus (41)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:495 | `.onyx-rail-filter-input:focus` | outline | --onyx-accent |
| app.css:769 | `.onyx-composer input:focus` | border-color | --onyx-accent |
| app.css:1948 | `.conn-input:focus-visible` | outline | --onyx-accent |
| app.css:1948 | `.conn-input:focus-visible` | border-color | --onyx-accent |
| app.css:1997 | `.conn-submit:focus-visible` | outline | --onyx-accent |
| app.css:2019 | `.conn-cancel:focus-visible, .conn-alt-btn:focus-visible, .conn-link:focus-visible, .conn-b` | outline | --onyx-accent |
| app.css:2179 | `.onyx-nav-btn:focus-visible` | outline | --onyx-accent |
| app.css:2327 | `.onyx-home-row:focus-visible, .onyx-home-room:focus-visible, .onyx-home-action:focus-visib` | outline | --onyx-accent |
| app.css:2555 | `.onyx-roster-filter-input:focus-visible` | outline | --onyx-accent |
| app.css:2631 | `.onyx-palette-launcher:focus-visible, .onyx-spotlight-close:focus-visible, .onyx-shortcuts` | outline | --onyx-accent |
| app.css:2985 | `.onyx-jump-latest:focus-visible` | outline | --onyx-accent |
| app.css:3148 | `:root[data-high-contrast='true'] :focus-visible` | outline | --lapis-bright |
| app.css:3821 | `:where(button, [href], input, select, textarea, [tabindex]):focus-visible` | outline | --focus-ring |
| pol-stats.css:62 | `:is(.stats-page, .status-route, .roadmap-page) :is(a, button, input, [tabindex]):focus-vis` | outline | --focus-ring |
| pol-stats.css:342 | `.roadmap-card:focus-visible` | outline | --focus-ring |
| pol-stats.css:750 | `.stats-page .stats-inspector:focus-visible` | outline | --focus-ring |
| pol-stats.css:941 | `.stats-page .stats-room-search input:focus-visible` | border-color | --onyx-accent |
| pol-studio.css:283 | `.ap-choice-toggle:focus-visible` | outline | --onyx-accent |
| pol-shell.css:758 | `.onyx-frame .onyx-rail-filter-input:focus` | outline | --focus-ring |
| pol-shell.css:758 | `.onyx-frame .onyx-rail-filter-input:focus` | border-color | --onyx-accent |
| pol-thread.css:192 | `.onyx-message:focus-visible` | outline | --focus-ring |
| pol-thread.css:243 | `.onyx-row-action:focus-visible` | outline | --focus-ring |
| pol-thread.css:479 | `.onyx-unread-divider:focus-visible` | outline | --focus-ring |
| pol-thread.css:1019 | `.onyx-composer-bar:focus-within` | border-color | --onyx-accent |
| pol-thread.css:1338 | `.onyx-message-search__surface:focus-within` | border-color | --onyx-accent |
| pol-roster.css:153 | `.onyx-mlist-group-head:focus-visible` | outline | --focus-ring |
| pol-roster.css:217 | `.onyx-mlist-main:focus-visible` | outline | --focus-ring |
| pol-public.css:45 | `.public-frame :where(a, button, summary, input, [tabindex]):focus-visible` | outline | --onyx-accent |
| pol-public.css:1408 | `.invite-form-panel .form-field input:focus-visible` | outline | --onyx-accent |
| pol-public.css:1408 | `.invite-form-panel .form-field input:focus-visible` | border-color | --onyx-accent |
| calls-c8.css:35 | `.onyx-call-react-item:focus-visible` | outline | --focus-ring |
| calls-c11.css:157 | `:where(.onyx-call-stage, .onyx-call-bar, .onyx-call-more, .onyx-call-sheet, .onyx-stage-pa` | outline | --focus-ring |
| polish.css:100 | `.onyx-composer .shell-composer-tools-item:focus-visible, .onyx-composer .shell-composer-to` | outline | --focus-ring |
| polish.css:238 | `.time-scrubber__bar:focus-visible, .time-scrubber__close:focus-visible, .time-scrubber__co` | outline | --focus-ring |
| polish.css:321 | `.polish-primary:focus-visible, .polish-ghost:focus-visible, .update-available button:focus` | outline | --onyx-accent |
| account2.css:37 | `.a2-input:focus-visible, .a2-select:focus-visible, .a2-textarea:focus-visible` | box-shadow | --focus-ring |
| account2.css:57 | `.a2-btn:focus-visible, .a2-link:focus-visible` | box-shadow | --focus-ring |
| account2.css:120 | `.a2-reclaim__signin:focus-visible, .a2-reclaim__dismiss:focus-visible` | box-shadow | --focus-ring |
| calls-c6.css:81 | `.onyx-call-ring .onyx-call-btn:focus-visible, .onyx-call-pip-card button:focus-visible, .o` | outline | --focus-ring |
| ui-sheets.css:241 | `.onyx-sheet-close:focus-visible, .onyx-you-close:focus-visible, .onyx-spotlight-close:focu` | outline | --focus-ring |
| calls-engine.css:28 | `.onyx-cbtn:focus-visible` | outline | --onyx-accent |

### G7 · unread / count / badge / pill (20)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:196 | `.topic-chip__unread` | background | --onyx-accent |
| app.css:1225 | `.chb-pill` | border | --onyx-accent |
| app.css:1225 | `.chb-pill` | color | --onyx-accent |
| app.css:1232 | `.chb-ledger` | color | --onyx-accent |
| app.css:1377 | `.onyx-scheduled-ledger` | color | --onyx-accent |
| app.css:1776 | `.onyx-member-ledger` | color | --onyx-accent |
| app.css:1858 | `.provenance-badge` | border | --lapis-bright |
| app.css:1860 | `.provenance-badge` | background | --lapis |
| app.css:1861 | `.provenance-badge` | color | --lapis-bright |
| app.css:2347 | `.onyx-home-count` | color | --onyx-accent |
| app.css:2492 | `.boost-pill.you` | border-color | --onyx-accent |
| app.css:2984 | `.onyx-jump-latest--unread` | color | --onyx-accent-ink |
| app.css:2984 | `.onyx-jump-latest--unread` | background | --onyx-accent |
| app.css:2984 | `.onyx-jump-latest--unread` | border-color | --onyx-accent |
| pol-shell.css:649 | `.onyx-topbar .shell-ribbon-badge` | color | --onyx-accent-ink |
| pol-shell.css:650 | `.onyx-topbar .shell-ribbon-badge` | background | --onyx-accent |
| pol-thread.css:591 | `.onyx-frame .onyx-jump-latest--unread` | color | --onyx-accent-ink |
| pol-thread.css:591 | `.onyx-frame .onyx-jump-latest--unread` | background | --onyx-accent |
| pol-thread.css:591 | `.onyx-frame .onyx-jump-latest--unread` | border-color | --onyx-accent |
| pol-thread.css:592 | `.onyx-jump-latest--unread:hover` | border-color | --onyx-accent |

### G7 · current location (17)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:453 | `.onyx-rail-active .onyx-rail-name` | color | --onyx-accent |
| app.css:2188 | `.onyx-nav-btn--active .onyx-nav-icon` | background | --onyx-accent |
| app.css:3084 | `.pref-category-tab[aria-selected="true"]` | box-shadow | --onyx-accent |
| pol-stats.css:195 | `.status-observation[data-feed-state='current'] .status-observation__marker` | color | --onyx-accent |
| pol-stats.css:321 | `.roadmap-legend a[aria-current='location']` | box-shadow | --onyx-accent |
| pol-stats.css:340 | `.roadmap-card:is(:target, [data-current='true'])` | box-shadow | --onyx-accent |
| pol-stats.css:455 | `.stats-page .stats-observation[data-feed-state='current'] .stats-observation__marker, .sta` | color | --pg-live |
| pol-stats.css:602 | `.stats-page .stats-feed-step[data-step-state='current'] .stats-feed-step__heading > strong` | color | --pg-live |
| pol-shell.css:693 | `.onyx-primary-nav .onyx-nav-btn--active::before` | background | --onyx-accent |
| pol-shell.css:698 | `.onyx-nav-btn--active .onyx-nav-icon` | background | --onyx-accent |
| pol-shell.css:813 | `.onyx-rail .onyx-rail-active::before` | background | --onyx-accent |
| pol-thread.css:181 | `.onyx-message-search-current, .onyx-message-search-current:hover` | box-shadow | --onyx-accent |
| pol-public.css:127 | `.public-frame__nav a[aria-current="page"]` | box-shadow | --onyx-accent |
| pol-public.css:333 | `.public-frame__nav a[aria-current="page"]` @@media (max-width: 768px) | box-shadow | --onyx-accent |
| pol-public.css:1229 | `.guides-route__item[data-state="current"] .guides-route__card` | border-color | --onyx-accent |
| pol-public.css:1234 | `.guides-route__item[data-state="current"] .guides-route__state` | color | --onyx-accent |
| pol-public.css:1327 | `.guides-route__item[data-state="current"] .guides-route__card` @@media (max-width: 768px) | box-shadow | --onyx-accent |

### G7 · mention (14)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:567 | `.onyx-rail-mention` | background | --onyx-accent |
| app.css:567 | `.onyx-rail-mention` | color | --onyx-accent-ink |
| app.css:2061 | `.shell-msg-mention` | color | --lapis-bright |
| app.css:2062 | `.shell-msg-mention--self` | color | --onyx-accent-ink |
| app.css:2062 | `.shell-msg-mention--self` | background | --onyx-accent |
| app.css:2341 | `.is-mention .onyx-home-unread` | background | --onyx-accent |
| app.css:2341 | `.is-mention .onyx-home-unread` | color | --onyx-accent-ink |
| app.css:2365 | `.onyx-home-room-mention` | color | --onyx-accent |
| pol-shell.css:128 | `.notif-center__row[data-type="mention"] .notif-center__glyph` | color | --onyx-accent |
| pol-shell.css:717 | `.onyx-nav-badge--mention` | color | --onyx-accent-ink |
| pol-shell.css:717 | `.onyx-nav-badge--mention` | background | --onyx-accent |
| pol-shell.css:849 | `.onyx-rail .onyx-rail-mention` | color | --onyx-accent-ink |
| pol-shell.css:849 | `.onyx-rail .onyx-rail-mention` | background | --onyx-accent |
| pol-shell.css:849 | `.onyx-rail .onyx-rail-mention` | border-color | --onyx-accent |

### G7 · theme preview (intended theme accent) (13)

| file:line | selector | property | token |
|---|---|---|---|
| pol-studio.css:552 | `.background-picker__swatch i` | background | --lapis |
| pol-studio.css:556 | `.background-picker__card[data-kind='scene'] .background-picker__swatch i:nth-child(2)` | background | --lapis-deep |
| pol-studio.css:1228 | `.ts-preview` | border | --seam |
| pol-studio.css:1238 | `.ts-preview__bar` | border-bottom | --seam-faint |
| pol-studio.css:1277 | `.ts-pv-side` | border-right | --seam-faint |
| pol-studio.css:1278 | `.ts-pv-members` | border-left | --seam-faint |
| pol-studio.css:1288 | `.ts-pv-side__server` | border-bottom | --seam-faint |
| pol-studio.css:1291 | `.ts-pv-side__sigil` | color | --lapis-bright |
| pol-studio.css:1291 | `.ts-pv-side__sigil` | color | --onyx-accent |
| pol-studio.css:1317 | `.ts-pv-chan__hash--voice` | color | --onyx-accent |
| pol-studio.css:1359 | `.ts-pv-head` | border-bottom | --seam-faint |
| pol-studio.css:1465 | `.ts-pv-composer` | border | --seam-faint |
| pol-public.css:581 | `.onyx-land-sketch-avatar--lapis` | background | --lapis |

### G7 · other (outside the budget) (12)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:243 | `.onyx-gem` | background | --onyx-accent |
| app.css:612 | `.onyx-newmsg-mark` | color | --onyx-accent |
| app.css:672 | `.onyx-whisper` | border-left | --onyx-accent |
| app.css:736 | `.onyx-member-prefix` | color | --onyx-accent |
| app.css:752 | `.onyx-composer-target` | color | --onyx-accent |
| app.css:1342 | `.onyx-composer .onyx-schedule-view` | color | --onyx-accent |
| app.css:2302 | `.onyx-home-announce` | color | --onyx-accent |
| app.css:2336 | `.onyx-home-row-meta` | color | --onyx-accent |
| app.css:2369 | `.onyx-coach` | border | --onyx-accent |
| app.css:2371 | `.onyx-coach-eyebrow` | color | --onyx-accent |
| pol-public.css:61 | `.public-frame__skip` | color | --onyx-accent-ink |
| pol-public.css:62 | `.public-frame__skip` | background | --onyx-accent |

### G7 · status (success / online) (10)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:282 | `.onyx-conn-live` | color | --onyx-accent |
| app.css:283 | `.onyx-conn-live .onyx-dot` | background | --onyx-accent |
| app.css:323 | `.onyx-reconnect-online` | color | --onyx-accent |
| app.css:324 | `.onyx-reconnect-online .onyx-reconnect-dot` | background | --onyx-accent |
| app.css:1091 | `.onyx-toast--success` | border-color | --onyx-accent |
| app.css:1220 | `.chb-row--live` | border-color | --onyx-accent |
| app.css:1227 | `.chb-count--live` | color | --onyx-accent |
| app.css:1506 | `.onyx-account-passkey-ok` | color | --onyx-accent |
| app.css:1760 | `.onyx-member-dot` | background | --onyx-accent |
| ui-sheets.css:803 | `.onyx-toast--success` | box-shadow | --onyx-accent |

### G7 · live-audio (calls) (7)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:843 | `.onyx-calls-pip[data-state="established"]` | background | --onyx-accent |
| app.css:3185 | `.onyx-call-pip[data-state="live"]` | background | --onyx-accent |
| app.css:3264 | `.onyx-call-person[data-speaking="true"] .onyx-call-ring` | border-color | --onyx-accent |
| app.css:3268 | `.onyx-call-ring::after` | border | --onyx-accent |
| calls-c6.css:181 | `.onyx-call-pip-faces .onyx-call-avatar[data-speaking="true"]` | outline | --onyx-accent |
| calls-c4.css:87 | `.onyx-tile[data-speaking="true"]` | border-color | --onyx-accent |
| calls-c4.css:115 | `.onyx-tile-talk > span` | background | --onyx-accent |

### G7 · link / nav text (6)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:1026 | `.onyx-land-action` | color | --onyx-accent |
| app.css:1414 | `.onyx-account-nav__item` | color | --onyx-accent |
| app.css:2060 | `.shell-msg-link` | color | --onyx-accent |
| app.css:2064 | `.shell-msg-channel-link` | color | --onyx-accent |
| pol-studio.css:1422 | `.ts-pv-msg__link` | color | --lapis-bright |
| pol-studio.css:1422 | `.ts-pv-msg__link` | color | --onyx-accent |

### G7 · control fill / data-viz (5)

| file:line | selector | property | token |
|---|---|---|---|
| pol-thread.css:1217 | `.shell-attachment-progress` | accent-color | --onyx-accent |
| pol-public.css:1205 | `.guides-progress__meter` | color | --onyx-accent |
| pol-public.css:1210 | `.guides-progress__meter::-webkit-progress-value` | background | --onyx-accent |
| pol-public.css:1211 | `.guides-progress__meter::-moz-progress-bar` | background | --onyx-accent |
| polish.css:230 | `.time-scrubber__bar--now .time-scrubber__bar-fill` | background | --onyx-accent |

### G7 · token alias (3)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:71 | `:root` | --focus-ring | --onyx-accent |
| pol-stats.css:20 | `.ui-root.r:is(.stats-page, .status-route, .roadmap-page)` | --pg-live | --onyx-accent |
| pol-stats.css:24 | `.ui-root.r:is(.stats-page, .status-route, .roadmap-page)` | --pg-select | --onyx-accent |

## G8. Typography in use

Ladder: `--text-2xs`=12px · `--text-xs`=11px · `--text-sm`=13px · `--text-md`=15px · `--text-lg`=17px · `--text-xl`=20px · `--text-2xl`=24px; leading `--leading-tight`=1.15 · `--leading-snug`=1.35 · `--leading-body`=1.5.

Font-size distribution (px at a 16px root):

| size | count | where |
|---|---|---|
| `13px (--text-sm)` | 317 | (317 sites — style-map.json typography.fontSizes) |
| `12px (--text-2xs)` | 119 | (119 sites — style-map.json typography.fontSizes) |
| `11px (--text-xs)` | 111 | (111 sites — style-map.json typography.fontSizes) |
| `15px (--text-md)` | 86 | (86 sites — style-map.json typography.fontSizes) |
| `12px` | 65 | app.css:145,149,157,158,162,172,173,180,181,184,186,193,354,465,471,773,1165,1167,1226,1232,1239,1241,1242,1248,1256,1257,1259,1298,1315,1338,1373,1376,1388,1418,1420,1426,1476,1486,1487,1492,1495,1497,1510,1517,1518,1582,1660,1672,1690,1707,1718,1790,1815,1828,1842,1845,1847,1848,3201,3214,3253,3284,3288,3326,3354 |
| `13px` | 65 | app.css:348,731,823,900,954,1032,1043,1050,1309,1345,1365,1367,1377,1385,1414,1422,1427,1470,1473,1483,1491,1506,1509,1511,1544,1546,1547,1548,1549,1551,1558,1562,1570,1593,1620,1641,1698,1702,1711,1712,1713,1716,1726,1756,1759,1768,1772,1776,1792,1793,1794,1795,1811,1812,1814,1821,1827,1834,1843,3210,3219,3350,3361,3365,3369 |
| `17px (--text-lg)` | 56 | app.css:234,611,612,626,2096,2230,2505,2686,2707,2767,2838,2890,2893,3077,3120,3796 · pol-stats.css:156,289,423,438,858,892,909 · pol-studio.css:96,440,1024 · pol-shell.css:53,166,920,1370 · pol-thread.css:889,1589,1882 · pol-roster.css:387 · pol-public.css:260,312,395,779,865,930,965,1009,1014,1080,1361,1444,1469,1589 · calls-c8.css:119 · calls-c11.css:138 · calls-c6.css:50 · ui-sheets.css:165,178,431,780,1070 |
| `20px (--text-xl)` | 24 | app.css:2465 · pol-stats.css:237,363,378,580,643,742,794 · pol-shell.css:1164,1174 · pol-thread.css:861,1390,1895 · pol-public.css:691,824,963,988,1195,1264,1505,1588,1598 · calls-c6.css:36 · ui-sheets.css:604 |
| `16px` | 16 | app.css:1115,1299,1938,3408 · pol-shell.css:1038,1319 · pol-thread.css:387,1289,1308,1569 · pol-roster.css:396,401 · pol-public.css:912,1404 · calls-c8.css:52 · ui-sheets.css:825 |
| `11px` | 15 | app.css:196,415,677,688,1225,1236,1493,1715,2076,3193,3304 · pol-studio.css:1263 · pol-shell.css:840,1256,1421 |
| `18px` | 14 | app.css:719,1205,1207,1237,1363,1364,1543,1545,1654,1749,1921,3287,3359 · pol-public.css:110 |
| `15px` | 9 | app.css:156,859,1689,1755,1789,1810,3194 · pol-shell.css:1389 · pol-thread.css:406 |
| `9px` | 6 | pol-studio.css:1296,1317,1341,1376,1412,1481 |
| `20px` | 5 | app.css:961 · pol-thread.css:327 · pol-public.css:955,1421 · calls-c8.css:32 |
| `24px` | 5 | app.css:2048,3195 · pol-thread.css:389,1310 · pol-public.css:1356 |
| `24px (--text-2xl)` | 5 | app.css:2298 · pol-stats.css:642 · pol-thread.css:508,513,618 |
| `10px` | 5 | pol-studio.css:1439 · pol-shell.css:647,707,1029,1238 |
| `17px` | 4 | app.css:925,1020,1403,3341 |
| `14px` | 4 | app.css:1148,1251,1417,1701 |
| `28px` | 3 | app.css:851,1924 · pol-shell.css:1052 |
| `clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)` | 3 | pol-stats.css:146,279,411 |
| `max(1rem, 16px)` | 3 | pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1665 |
| `0` | 2 | pol-studio.css:307 · ui-sheets.css:230 |
| `11.52px` | 2 | app.css:134,205 |
| `inherit` | 2 | pol-public.css:1539 · calls-c4.css:27 |
| `13.76px` | 1 | app.css:135 |
| `44px` | 1 | app.css:914 |
| `9.92px` | 1 | app.css:1863 |
| `32px` | 1 | app.css:2043 |
| `0.92em` | 1 | app.css:2068 |
| `0.85em` | 1 | app.css:2081 |
| `1.1em` | 1 | app.css:2085 |
| `clamp(1.5rem, 1.15rem + 1.4vw, 2.25rem)` | 1 | pol-stats.css:80 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem)` | 1 | pol-stats.css:546 |
| `clamp(1.5rem, 1.1rem + 1.6vw, 2.125rem)` | 1 | pol-studio.css:86 |
| `10.5px` | 1 | pol-thread.css:146 |
| `17.6px` | 1 | pol-thread.css:616 |
| `12.48px` | 1 | pol-roster.css:402 |
| `0.9em` | 1 | pol-public.css:39 |
| `clamp(2rem, 1.4rem + 2.6vw, 2.75rem)` | 1 | pol-public.css:385 |
| `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | 1 | pol-public.css:514 |
| `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | 1 | pol-public.css:523 |
| `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | 1 | pol-public.css:621 |
| `clamp(2.375rem, 9.6vw, 2.75rem)` | 1 | pol-public.css:778 |
| `clamp(1.5rem, 1.2rem + 1vw, 1.875rem)` | 1 | pol-public.css:909 |
| `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` | 1 | pol-public.css:992 |
| `clamp(1.875rem, 1.4rem + 1.8vw, 2.5rem)` | 1 | pol-public.css:1360 |
| `clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)` | 1 | pol-public.css:1442 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | 1 | pol-public.css:1461 |
| `clamp(1.75rem, 1.3rem + 2vw, 2.5rem)` | 1 | pol-public.css:1557 |

Font-weight distribution:

| weight | count |
|---|---|
| `650` | 163 |
| `600` | 142 |
| `700` | 102 |
| `400` | 17 |
| `750` | 14 |
| `500` | 7 |
| `800` | 3 |
| `inherit` | 1 |

Line-height distribution:

| line-height | count |
|---|---|
| `var(--leading-snug)` | 40 |
| `var(--leading-body)` | 38 |
| `1` | 29 |
| `var(--leading-tight)` | 23 |
| `0` | 3 |
| `16px` | 3 |
| `20px` | 3 |
| `1.6` | 3 |
| `1.05` | 2 |
| `1.1` | 2 |
| `1.2` | 2 |
| `18px` | 2 |
| `1.65` | 2 |
| `1.15` | 1 |
| `1.45` | 1 |
| `1.4` | 1 |
| `1.25` | 1 |
| `1.3` | 1 |
| `1.08` | 1 |
| `1.02` | 1 |
| `1.5` | 1 |
| `1.9` | 1 |
| `inherit` | 1 |

Size × line-height × weight set together in one rule (149 distinct combinations):

| size | line-height | weight | rules | where |
|---|---|---|---|---|
| `13px (--text-sm)` | `—` | `—` | 211 | (211 rules) |
| `12px (--text-2xs)` | `—` | `—` | 86 | (86 rules) |
| `12px` | `—` | `—` | 56 | (56 rules) |
| `13px` | `—` | `—` | 56 | (56 rules) |
| `11px (--text-xs)` | `—` | `—` | 46 | (46 rules) |
| `13px (--text-sm)` | `—` | `600` | 43 | (43 rules) |
| `15px (--text-md)` | `—` | `—` | 42 | (42 rules) |
| `11px (--text-xs)` | `—` | `650` | 28 | pol-studio.css:117,129,356,451,489,503,648,657,690,820,1532 · pol-thread.css:460,938,1107,1257 · pol-roster.css:55,161 · pol-public.css:239,300,751,864,1090,1233,1515 · calls-c11.css:35 · calls-c6.css:27 · ui-sheets.css:169,598 |
| `13px (--text-sm)` | `—` | `650` | 20 | app.css:634,1933,2903 · pol-stats.css:622 · pol-shell.css:182,201 · pol-thread.css:384,965,1130,1445,1762,1849 · pol-public.css:230,510,671,1133,1394,1497 · polish.css:106 · ui-sheets.css:263 |
| `17px (--text-lg)` | `—` | `—` | 18 | app.css:611,2096,2230,2505,2686,2838,2893,3077,3120 · pol-roster.css:387 · pol-public.css:260,779,1009,1361,1444 · calls-c8.css:119 · calls-c6.css:50 · ui-sheets.css:431 |
| `13px (--text-sm)` | `var(--leading-snug)` | `—` | 15 | app.css:1951,1952,1977 · pol-stats.css:961 · pol-studio.css:111,146,378,461,950 · pol-shell.css:155 · pol-thread.css:661,783 · pol-roster.css:129 · calls-c11.css:48 · ui-sheets.css:187 |
| `13px (--text-sm)` | `var(--leading-body)` | `—` | 15 | pol-stats.css:485,605,606,764,833,852,913 · pol-studio.css:139,642,702,1056 · pol-thread.css:1434,1611,1827 · pol-public.css:630 |
| `11px (--text-xs)` | `—` | `600` | 14 | app.css:2173,2371,2844 · pol-studio.css:712,903,1175 · pol-shell.css:187,484,764,783 · pol-thread.css:769,1798 · pol-roster.css:63 · calls-c4.css:33 |
| `15px (--text-md)` | `—` | `650` | 13 | app.css:2274,3658 · pol-studio.css:458,808 · pol-shell.css:48 · pol-thread.css:621 · pol-public.css:143,536,586,629,966,1104,1242 |
| `12px (--text-2xs)` | `—` | `600` | 12 | app.css:263,313,2319,2339,2365,2519,2976 · pol-shell.css:71,447 · pol-public.css:873 · calls-c8.css:19,74 |
| `17px (--text-lg)` | `1` | `—` | 12 | app.css:612,626,2707,2767,2890 · pol-stats.css:858,892 · pol-studio.css:440,1024 · pol-shell.css:53,166 · pol-thread.css:1882 |
| `16px` | `—` | `—` | 12 | app.css:1299,1938,3408 · pol-shell.css:1038,1319 · pol-thread.css:387,1308,1569 · pol-roster.css:396,401 · pol-public.css:1404 · ui-sheets.css:825 |
| `11px (--text-xs)` | `—` | `700` | 11 | app.css:524,561,2249 · pol-stats.css:792,819,907,926 · pol-studio.css:1590 · pol-thread.css:482,1750 · roomsettings.css:155 |
| `18px` | `—` | `—` | 9 | app.css:719,1205,1207,1237,1364,1545,1654,3287,3359 |
| `20px (--text-xl)` | `—` | `700` | 9 | pol-shell.css:1174 · pol-public.css:691,963,1195,1264,1505,1588,1598 · ui-sheets.css:604 |
| `15px` | `—` | `—` | 8 | app.css:156,859,1689,1789,1810,3194 · pol-shell.css:1389 · pol-thread.css:406 |
| `17px (--text-lg)` | `—` | `650` | 8 | app.css:234 · pol-public.css:865,930,1080,1469 · ui-sheets.css:165,780,1070 |
| `15px (--text-md)` | `var(--leading-body)` | `—` | 8 | app.css:1930 · pol-stats.css:191 · pol-thread.css:619,930,1857 · pol-public.css:28 · polish.css:265 · ui-sheets.css:776 |
| `15px (--text-md)` | `—` | `600` | 8 | app.css:3085 · pol-studio.css:259,372 · pol-shell.css:1382,1400 · pol-public.css:122 · roomsettings.css:276 · ui-sheets.css:644 |
| `11px` | `—` | `—` | 7 | app.css:1225,1236,1493,1715,2076,3193 · pol-shell.css:1256 |
| `15px (--text-md)` | `—` | `700` | 7 | app.css:1987 · pol-studio.css:71 · pol-shell.css:582,729,1303 · pol-public.css:1178,1215 |
| `12px` | `—` | `600` | 6 | app.css:354,1165,1426,1495,3201,3253 |
| `12px (--text-2xs)` | `—` | `650` | 6 | app.css:2720 · pol-thread.css:407,1552 · pol-public.css:1071 · calls-c8.css:92 · calls-c4.css:106 |
| `13px` | `—` | `650` | 5 | app.css:823,1050,3210,3219,3369 |
| `18px` | `—` | `700` | 5 | app.css:1363,1543,1749,1921 · pol-public.css:110 |
| `17px (--text-lg)` | `var(--leading-body)` | `—` | 5 | pol-stats.css:156,289,423 · pol-studio.css:96 · pol-public.css:395 |
| `20px (--text-xl)` | `var(--leading-tight)` | `700` | 5 | pol-stats.css:237,363,378,580,643 |
| `24px` | `—` | `—` | 4 | app.css:2048,3195 · pol-thread.css:389,1310 |
| `17px (--text-lg)` | `var(--leading-snug)` | `650` | 4 | app.css:3796 · pol-stats.css:438 · pol-thread.css:1589 · ui-sheets.css:178 |
| `12px (--text-2xs)` | `var(--leading-snug)` | `—` | 4 | pol-stats.css:555,696,793 · pol-studio.css:941 |
| `20px (--text-xl)` | `—` | `—` | 4 | pol-stats.css:742 · pol-shell.css:1164 · pol-thread.css:1390,1895 |
| `12px (--text-2xs)` | `—` | `700` | 3 | app.css:583 · pol-stats.css:352,601 |
| `11px` | `—` | `600` | 3 | app.css:677,688 · pol-shell.css:1421 |
| `14px` | `—` | `—` | 3 | app.css:1148,1251,1417 |
| `12px` | `—` | `650` | 3 | app.css:3214,3326,3354 |
| `clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)` | `var(--leading-tight)` | `700` | 3 | pol-stats.css:146,279,411 |
| `24px (--text-2xl)` | `var(--leading-tight)` | `700` | 3 | pol-stats.css:642 · pol-thread.css:513,618 |
| `max(1rem, 16px)` | `—` | `—` | 3 | pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1665 |
| `12px (--text-2xs)` | `—` | `400` | 3 | pol-studio.css:1124 · pol-shell.css:271 · pol-thread.css:718 |
| `9px` | `—` | `—` | 3 | pol-studio.css:1317,1412,1481 |
| `11px (--text-xs)` | `var(--leading-snug)` | `—` | 3 | pol-shell.css:139 · pol-thread.css:1771 · account2.css:9 |
| `17px (--text-lg)` | `—` | `700` | 3 | pol-shell.css:1370 · pol-public.css:965,1014 |
| `11px` | `—` | `700` | 2 | app.css:196,415 |
| `17px` | `—` | `—` | 2 | app.css:925,1403 |
| `16px` | `1` | `—` | 2 | app.css:1115 · calls-c8.css:52 |
| `13px` | `—` | `700` | 2 | app.css:1551,1827 |
| `11px (--text-xs)` | `var(--leading-snug)` | `650` | 2 | pol-stats.css:71 · pol-public.css:376 |
| `13px (--text-sm)` | `var(--leading-tight)` | `650` | 2 | pol-stats.css:505,679 |
| `13px (--text-sm)` | `var(--leading-tight)` | `600` | 2 | pol-studio.css:562,991 |
| `11px (--text-xs)` | `var(--leading-tight)` | `—` | 2 | pol-studio.css:571,997 |
| `9px` | `—` | `650` | 2 | pol-studio.css:1296,1376 |
| `10px` | `16px` | `700` | 2 | pol-shell.css:707,1238 |
| `20px` | `1` | `—` | 2 | pol-thread.css:327 · calls-c8.css:32 |
| `13px (--text-sm)` | `—` | `400` | 2 | pol-thread.css:1209,1240 |
| `20px (--text-xl)` | `var(--leading-snug)` | `600` | 2 | pol-public.css:824,988 |
| `12px (--text-2xs)` | `1.6` | `—` | 2 | pol-public.css:1025,1535 |
| `11.52px` | `—` | `—` | 1 | app.css:134 |
| `13.76px` | `—` | `—` | 1 | app.css:135 |
| `11.52px` | `—` | `600` | 1 | app.css:205 |
| `28px` | `—` | `750` | 1 | app.css:851 |
| `44px` | `1.05` | `750` | 1 | app.css:914 |
| `20px` | `—` | `700` | 1 | app.css:961 |
| `17px` | `—` | `700` | 1 | app.css:1020 |
| `13px` | `—` | `600` | 1 | app.css:1548 |
| `13px` | `1` | `—` | 1 | app.css:1593 |
| `14px` | `—` | `700` | 1 | app.css:1701 |
| `15px` | `—` | `700` | 1 | app.css:1755 |
| `9.92px` | `1` | `800` | 1 | app.css:1863 |
| `28px` | `1.15` | `750` | 1 | app.css:1924 |
| `32px` | `—` | `—` | 1 | app.css:2043 |
| `0.92em` | `—` | `—` | 1 | app.css:2068 |
| `0.85em` | `—` | `—` | 1 | app.css:2081 |
| `1.1em` | `—` | `—` | 1 | app.css:2085 |
| `24px (--text-2xl)` | `—` | `600` | 1 | app.css:2298 |
| `20px (--text-xl)` | `1` | `—` | 1 | app.css:2465 |
| `11px (--text-xs)` | `1.2` | `—` | 1 | app.css:2747 |
| `11px` | `—` | `650` | 1 | app.css:3304 |
| `17px` | `—` | `750` | 1 | app.css:3341 |
| `11px (--text-xs)` | `18px` | `700` | 1 | app.css:3590 |
| `clamp(1.5rem, 1.15rem + 1.4vw, 2.25rem)` | `var(--leading-tight)` | `650` | 1 | pol-stats.css:80 |
| `15px (--text-md)` | `var(--leading-tight)` | `650` | 1 | pol-stats.css:106 |
| `15px (--text-md)` | `var(--leading-snug)` | `700` | 1 | pol-stats.css:183 |
| `11px (--text-xs)` | `var(--leading-snug)` | `700` | 1 | pol-stats.css:539 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem)` | `1` | `700` | 1 | pol-stats.css:546 |
| `13px (--text-sm)` | `—` | `700` | 1 | pol-stats.css:600 |
| `20px (--text-xl)` | `1` | `700` | 1 | pol-stats.css:794 |
| `17px (--text-lg)` | `1.1` | `700` | 1 | pol-stats.css:909 |
| `15px (--text-md)` | `—` | `400` | 1 | pol-stats.css:936 |
| `clamp(1.5rem, 1.1rem + 1.6vw, 2.125rem)` | `var(--leading-tight)` | `650` | 1 | pol-studio.css:86 |
| `13px (--text-sm)` | `var(--leading-snug)` | `400` | 1 | pol-studio.css:290 |
| `0` | `—` | `—` | 1 | pol-studio.css:307 |
| `12px (--text-2xs)` | `var(--leading-body)` | `—` | 1 | pol-studio.css:886 |
| `13px (--text-sm)` | `—` | `500` | 1 | pol-studio.css:1078 |
| `11px` | `1.4` | `—` | 1 | pol-studio.css:1263 |
| `9px` | `—` | `700` | 1 | pol-studio.css:1341 |
| `10px` | `—` | `650` | 1 | pol-studio.css:1439 |
| `13px (--text-sm)` | `1` | `650` | 1 | pol-studio.css:1566 |
| `10px` | `16px` | `—` | 1 | pol-shell.css:647 |
| `11px` | `18px` | `—` | 1 | pol-shell.css:840 |
| `17px (--text-lg)` | `var(--leading-snug)` | `700` | 1 | pol-shell.css:920 |
| `10px` | `—` | `700` | 1 | pol-shell.css:1029 |
| `28px` | `var(--leading-tight)` | `700` | 1 | pol-shell.css:1052 |
| `15px (--text-md)` | `1.25` | `—` | 1 | pol-shell.css:1250 |
| `11px (--text-xs)` | `1.3` | `—` | 1 | pol-shell.css:1251 |
| `11px (--text-xs)` | `20px` | `—` | 1 | pol-shell.css:1388 |
| `10.5px` | `—` | `—` | 1 | pol-thread.css:146 |
| `13px (--text-sm)` | `1` | `—` | 1 | pol-thread.css:403 |
| `24px (--text-2xl)` | `—` | `700` | 1 | pol-thread.css:508 |
| `17.6px` | `—` | `—` | 1 | pol-thread.css:616 |
| `15px (--text-md)` | `var(--leading-snug)` | `650` | 1 | pol-thread.css:781 |
| `12px (--text-2xs)` | `var(--leading-snug)` | `600` | 1 | pol-thread.css:800 |
| `13px (--text-sm)` | `1` | `600` | 1 | pol-thread.css:856 |
| `20px (--text-xl)` | `—` | `400` | 1 | pol-thread.css:861 |
| `17px (--text-lg)` | `var(--leading-tight)` | `650` | 1 | pol-thread.css:889 |
| `15px (--text-md)` | `20px` | `—` | 1 | pol-thread.css:1042 |
| `16px` | `20px` | `—` | 1 | pol-thread.css:1289 |
| `15px (--text-md)` | `1` | `—` | 1 | pol-thread.css:1384 |
| `12.48px` | `—` | `—` | 1 | pol-roster.css:402 |
| `0.9em` | `—` | `—` | 1 | pol-public.css:39 |
| `17px (--text-lg)` | `—` | `600` | 1 | pol-public.css:312 |
| `clamp(2rem, 1.4rem + 2.6vw, 2.75rem)` | `1.08` | `750` | 1 | pol-public.css:385 |
| `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | `1.02` | `750` | 1 | pol-public.css:514 |
| `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | `1.5` | `—` | 1 | pol-public.css:523 |
| `13px (--text-sm)` | `—` | `750` | 1 | pol-public.css:578 |
| `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | `—` | `700` | 1 | pol-public.css:621 |
| `clamp(2.375rem, 9.6vw, 2.75rem)` | `—` | `—` | 1 | pol-public.css:778 |
| `clamp(1.5rem, 1.2rem + 1vw, 1.875rem)` | `—` | `700` | 1 | pol-public.css:909 |
| `16px` | `1.65` | `—` | 1 | pol-public.css:912 |
| `20px` | `1` | `400` | 1 | pol-public.css:955 |
| `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` | `—` | `700` | 1 | pol-public.css:992 |
| `24px` | `—` | `700` | 1 | pol-public.css:1356 |
| `clamp(1.875rem, 1.4rem + 1.8vw, 2.5rem)` | `—` | `—` | 1 | pol-public.css:1360 |
| `20px` | `—` | `—` | 1 | pol-public.css:1421 |
| `clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)` | `1.05` | `750` | 1 | pol-public.css:1442 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | `—` | `700` | 1 | pol-public.css:1461 |
| `inherit` | `—` | `—` | 1 | pol-public.css:1539 |
| `clamp(1.75rem, 1.3rem + 2vw, 2.5rem)` | `—` | `750` | 1 | pol-public.css:1557 |
| `17px (--text-lg)` | `1.6` | `—` | 1 | pol-public.css:1589 |
| `12px (--text-2xs)` | `1.9` | `—` | 1 | pol-public.css:1608 |
| `15px (--text-md)` | `var(--leading-snug)` | `—` | 1 | calls-c8.css:79 |
| `17px (--text-lg)` | `—` | `750` | 1 | calls-c11.css:138 |
| `20px (--text-xl)` | `—` | `750` | 1 | calls-c6.css:36 |
| `inherit` | `inherit` | `inherit` | 1 | calls-c4.css:27 |
| `0` | `0` | `—` | 1 | ui-sheets.css:230 |

font-family declarations:

| value | where |
|---|---|
| `var(--font-mono)` | app.css:631,1862,2068,2635,2746,3010,3068,3359 · pol-studio.css:1123,1156,1198,1411,1581 · pol-shell.css:151,270 · pol-thread.css:717,1266,1749 · pol-public.css:38,844,1024,1099,1196,1468,1504,1525,1534,1548,1608,1621 · calls-c8.css:115 · polish.css:130,179 · account2.css:34 |
| `var(--font-mono, monospace)` | app.css:2895,2920 |
| `inherit` | pol-thread.css:1268 |
| `ui-monospace, SFMono-Regular, Menlo, monospace` | roomsettings.css:168 |

## G9. Spacing in use (padding / margin / gap / inset components)

Scale: `--space-0`=0px · `--space-1`=4px · `--space-2`=8px · `--space-3`=12px · `--space-4`=16px · `--space-5`=20px · `--space-6`=24px · `--space-7`=32px · `--space-8`=40px.

| component value | on the 4px scale? | count | where |
|---|---|---|---|
| `0` | raw, on scale | 1233 | (1233 sites — style-map.json spacing.distribution) |
| `8px (--space-2)` | token | 551 | (551 sites — style-map.json spacing.distribution) |
| `12px (--space-3)` | token | 386 | (386 sites — style-map.json spacing.distribution) |
| `16px (--space-4)` | token | 236 | (236 sites — style-map.json spacing.distribution) |
| `4px (--space-1)` | token | 229 | (229 sites — style-map.json spacing.distribution) |
| `2px` | **off scale** | 173 | (173 sites — style-map.json spacing.distribution) |
| `8px` | raw, on scale | 136 | (136 sites — style-map.json spacing.distribution) |
| `6px` | **off scale** | 128 | (128 sites — style-map.json spacing.distribution) |
| `10px` | **off scale** | 99 | (99 sites — style-map.json spacing.distribution) |
| `20px (--space-5)` | token | 82 | (82 sites — style-map.json spacing.distribution) |
| `4px` | raw, on scale | 76 | (76 sites — style-map.json spacing.distribution) |
| `12px` | raw, on scale | 66 | (66 sites — style-map.json spacing.distribution) |
| `24px (--space-6)` | token | 56 | (56 sites — style-map.json spacing.distribution) |
| `auto` | raw, on scale | 43 | app.css:711,908,1131,1226,1233,2044,2295,2576,3344,3361,3406 · pol-stats.css:39 · pol-studio.css:80,1332,1339,1508 · pol-shell.css:151,333,448,598,874 · pol-thread.css:951,1468 · pol-roster.css:21,74,171,311,343,362 · pol-public.css:86,112,193,209,1342 · calls-c8.css:62,72 · polish.css:339 · calls-c6.css:180 · calls-c4.css:57,72 · ui-sheets.css:555,728 · calls-engine.css:97 |
| `16px` | raw, on scale | 32 | app.css:154,665,746,871,902,926,955,963,968,975,999,1157,1198,1215,1356,1396,1416,1536,1550,1610,1632,1684,1738,1785,1806,3087,3285,3340,3340,3347,3348,3396 |
| `32px (--space-7)` | token | 24 | (24 sites — style-map.json spacing.distribution) |
| `14px` | **off scale** | 23 | app.css:373,383,398,514,801,1275,1334,1943,2284,2529,2534,2840,3225,3225,3225,3239,3248,3252,3365 · pol-shell.css:1042 · pol-public.css:264,1398 · ui-sheets.css:907 |
| `40px (--space-8)` | token | 22 | (22 sites — style-map.json spacing.distribution) |
| `1px` | **off scale** | 19 | app.css:564,2338,2641,2990 · pol-studio.css:354,558,656,711,968,1531,1589 · pol-shell.css:791,820,874,972 · pol-roster.css:181 · pol-public.css:40,800 · polish.css:56 |
| `var(--sheet-pad)` | token | 17 | (17 sites — style-map.json spacing.distribution) |
| `3px` | **off scale** | 13 | app.css:506,590,670,730,1972,2062 · pol-studio.css:218,219,1308,1488 · pol-shell.css:1415 · pol-thread.css:1013 · pol-public.css:657 |
| `20px` | raw, on scale | 12 | app.css:343,870,878,933,989,1012,1013,3285,3368,3377,3396,3396 |
| `5px` | **off scale** | 12 | app.css:493,564,2641 · pol-studio.css:1405,1461 · pol-shell.css:838 · pol-public.css:40,156,852 · ui-sheets.css:163,477,597 |
| `56px` | **off scale** | 11 | pol-public.css:336,358,681,769,819,821,903,904,1441,1453,1580 |
| `64px` | **off scale** | 8 | app.css:910,958,978,1046 · pol-public.css:206,503,1335,1441 |
| `48px` | **off scale** | 7 | app.css:817,1011 · pol-public.css:210,589,769,776,792 |
| `24px` | raw, on scale | 7 | app.css:817,893,910,1011,1058,3258,3258 |
| `calc(-1 * var(--space-2))` | **off scale** | 6 | app.css:1958,1971 · pol-thread.css:1611 · pol-public.css:1212 · calls-c8.css:93 · ui-sheets.css:511 |
| `calc(-1 * var(--sheet-pad))` | **off scale** | 6 | ui-sheets.css:157,585,720,760,760,899 |
| `28px` | **off scale** | 5 | app.css:934,3258,3258 · pol-shell.css:754 · ui-sheets.css:845 |
| `40px` | raw, on scale | 5 | app.css:1907 · pol-public.css:337,776,776 · ui-sheets.css:622 |
| `-18px` | **off scale** | 5 | pol-studio.css:1703 · ui-sheets.css:336,865,981,1094 |
| `calc(var(--pub-header-h, 64px) + var(--space-4))` | **off scale** | 5 | pol-public.css:906,995,1050,1051,1262 |
| `-1px` | **off scale** | 4 | app.css:166,1979 · pol-thread.css:999 · pol-roster.css:261 |
| `7px` | **off scale** | 4 | app.css:444,1334 · pol-shell.css:1388 · pol-thread.css:733 |
| `96px` | **off scale** | 4 | app.css:910,1944 · pol-public.css:504,1405 |
| `36px` | **off scale** | 4 | app.css:1907,3258 · pol-studio.css:1010 · pol-shell.css:1318 |
| `-4px` | **off scale** | 4 | app.css:1914,2042,3284 · pol-public.css:94 |
| `-6px` | **off scale** | 4 | app.css:3197,3267 · pol-public.css:159 · ui-sheets.css:228 |
| `18px` | **off scale** | 3 | app.css:783,1794,2898 |
| `clamp(var(--space-7), 5vw, 4.5rem)` | **off scale** | 3 | pol-stats.css:49,232,402 |
| `clamp(var(--space-7), 6vw, 5rem)` | **off scale** | 3 | pol-stats.css:138,271,404 |
| `var(--pt-gutter)` | token | 3 | (3 sites — style-map.json spacing.distribution) |
| `72px` | **off scale** | 3 | pol-public.css:199,620,648 |
| `calc(var(--space-6) + env(safe-area-inset-bottom, 0px))` | **off scale** | 3 | calls-c6.css:233 · ui-sheets.css:842,889 |
| `var(--sheet-head-pad)` | token | 3 | (3 sites — style-map.json spacing.distribution) |
| `calc(var(--sheet-grip-zone) + 2px)` | **off scale** | 3 | ui-sheets.css:343,855,912 |
| `calc(var(--space-2) + env(safe-area-inset-bottom, 0px))` | **off scale** | 3 | ui-sheets.css:968 · calls-engine.css:92,117 |
| `22px` | **off scale** | 2 | app.css:894,942 |
| `32px` | raw, on scale | 2 | app.css:1907,3394 |
| `-8px` | **off scale** | 2 | app.css:1914 · ui-sheets.css:639 |
| `var(--pad-panel)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `calc(120px + var(--kb-inset, 0px))` | **off scale** | 2 | pol-stats.css:1056 · pol-studio.css:1782 |
| `env(safe-area-inset-top)` | **off scale** | 2 | pol-studio.css:48 · pol-public.css:74 |
| `clamp(16px, 5vw, 48px)` | **off scale** | 2 | pol-studio.css:48,81 |
| `44px` | **off scale** | 2 | pol-studio.css:1704 · pol-public.css:789 |
| `var(--safe-bottom, 0px)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `calc(var(--space-3) + var(--safe-bottom))` | **off scale** | 2 | pol-thread.css:360,952 |
| `calc(var(--space-4) + var(--safe-bottom))` | **off scale** | 2 | pol-roster.css:349,367 |
| `max(var(--pub-gutter), env(safe-area-inset-right))` | **off scale** | 2 | pol-public.css:87,194 |
| `max(var(--pub-gutter), env(safe-area-inset-left))` | **off scale** | 2 | pol-public.css:87,194 |
| `var(--pub-gutter)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `1.15em` | **off scale** | 2 | pol-public.css:973,1243 |
| `calc(var(--sheet-pad) + env(safe-area-inset-bottom, 0px))` | **off scale** | 2 | ui-sheets.css:310,1082 |
| `var(--sheet-grip-zone)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `env(safe-area-inset-top, 0px)` | **off scale** | 2 | ui-sheets.css:837 · calls-engine.css:107 |
| `var(--safe-top)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `-8.8px` | **off scale** | 1 | app.css:202 |
| `1.92px` | **off scale** | 1 | app.css:1857 |
| `7.2px` | **off scale** | 1 | app.css:1857 |
| `max(var(--space-8), env(safe-area-inset-top))` | **off scale** | 1 | app.css:1896 |
| `max(var(--space-6), env(safe-area-inset-bottom))` | **off scale** | 1 | app.css:1896 |
| `168px` | **off scale** | 1 | app.css:1944 |
| `calc(-1 * var(--space-1))` | **off scale** | 1 | app.css:1977 |
| `max(var(--space-3), env(safe-area-inset-top))` | **off scale** | 1 | app.css:2038 |
| `calc(max(var(--space-3), env(safe-area-inset-bottom)) + var(--kb-inset, 0px))` | **off scale** | 1 | app.css:2038 |
| `calc(168px + var(--kb-inset, 0px))` | **off scale** | 1 | app.css:2039 |
| `12vh` | **off scale** | 1 | app.css:2651 |
| `9px` | **off scale** | 1 | app.css:3324 |
| `calc(10px + env(safe-area-inset-bottom, 0px))` | **off scale** | 1 | app.css:3398 |
| `calc(var(--space-1) + env(safe-area-inset-bottom, 0px))` | **off scale** | 1 | app.css:3880 |
| `calc(var(--mobile-nav-h) + var(--composer-h))` | **off scale** | 1 | app.css:3894 |
| `clamp(16px, 4vw, 48px)` | **off scale** | 1 | pol-stats.css:40 |
| `clamp(var(--space-4), 4vw, 4rem)` | **off scale** | 1 | pol-stats.css:328 |
| `0.4em` | **off scale** | 1 | pol-stats.css:452 |
| `clamp(var(--space-6), 4vw, 4rem)` | **off scale** | 1 | pol-stats.css:632 |
| `clamp(2px, 0.6vw, 8px)` | **off scale** | 1 | pol-stats.css:708 |
| `clamp(1px, 0.3vw, 4px)` | **off scale** | 1 | pol-stats.css:802 |
| `clamp(28px, 6vw, 72px)` | **off scale** | 1 | pol-studio.css:81 |
| `14vh` | **off scale** | 1 | pol-studio.css:81 |
| `clamp(28px, 4vw, 44px)` | **off scale** | 1 | pol-studio.css:124 |
| `clamp(32px, 5vw, 56px)` | **off scale** | 1 | pol-studio.css:408 |
| `calc(var(--space-4) + 32px)` | **off scale** | 1 | pol-studio.css:421 |
| `-12px` | **off scale** | 1 | pol-studio.css:439 |
| `-14px` | **off scale** | 1 | pol-studio.css:1021 |
| `18vh` | **off scale** | 1 | pol-studio.css:1677 |
| `env(safe-area-inset-bottom, 0px)` | **off scale** | 1 | pol-shell.css:360 |
| `calc(var(--sheet-pad, 16px) + 36px)` | **off scale** | 1 | pol-shell.css:1042 |
| `calc(var(--space-3) + var(--safe-bottom, 0px))` | **off scale** | 1 | pol-shell.css:1289 |
| `0.35em` | **off scale** | 1 | pol-thread.css:1768 |
| `max(var(--space-3), var(--safe-top))` | **off scale** | 1 | pol-roster.css:349 |
| `max(var(--pub-gutter), calc((100% - var(--pub-measure)) / 2 + var(--pub-gutter)))` | **off scale** | 1 | pol-public.css:174 |
| `calc(48px + env(safe-area-inset-bottom))` | **off scale** | 1 | pol-public.css:210 |
| `calc(var(--space-8) + env(safe-area-inset-bottom))` | **off scale** | 1 | pol-public.css:283 |
| `88px` | **off scale** | 1 | pol-public.css:504 |
| `1.4em` | **off scale** | 1 | pol-public.css:1179 |
| `calc(-1 * var(--pub-gutter, 20px))` | **off scale** | 1 | pol-public.css:1302 |
| `var(--pub-gutter, 20px)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `140px` | **off scale** | 1 | pol-public.css:1405 |
| `calc(var(--pub-header-h, 64px) + var(--space-2))` | **off scale** | 1 | pol-public.css:1455 |
| `calc(140px + var(--kb-inset, 0px))` | **off scale** | 1 | pol-public.css:1666 |
| `var(--gap-section)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `194px` | **off scale** | 1 | calls-c6.css:191 |
| `52px` | **off scale** | 1 | ui-sheets.css:128 |
| `-10px` | **off scale** | 1 | ui-sheets.css:348 |
| `min(14vh, 120px)` | **off scale** | 1 | ui-sheets.css:406 |
| `84px` | **off scale** | 1 | ui-sheets.css:706 |
| `calc(var(--sheet-pad) + 44px)` | **off scale** | 1 | ui-sheets.css:721 |
| `136px` | **off scale** | 1 | ui-sheets.css:908 |
| `calc(var(--sheet-grip-zone) - 4px)` | **off scale** | 1 | ui-sheets.css:911 |
| `calc(-1 * var(--sheet-grip-zone))` | **off scale** | 1 | ui-sheets.css:912 |
| `calc(var(--sheet-pad) + max(0px, env(safe-area-inset-bottom, 0px) - var(--kb-inset, 0px)))` | **off scale** | 1 | ui-sheets.css:1045 |
| `calc(var(--sheet-grip-zone) + 6px)` | **off scale** | 1 | ui-sheets.css:1082 |
| `var(--safe-left)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `var(--safe-right)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `max(8px, calc(var(--safe-bottom) + 4px))` | **off scale** | 1 | pol-ios.css:92 |
| `max(var(--space-3), var(--safe-bottom))` | **off scale** | 1 | pol-ios.css:100 |
| `env(safe-area-inset-left, 0px)` | **off scale** | 1 | calls-engine.css:108 |
| `env(safe-area-inset-right, 0px)` | **off scale** | 1 | calls-engine.css:108 |

## G10. Radius values in use

| value | count | where |
|---|---|---|
| `var(--radius)` | 278 | (278 sites — style-map.json radius) |
| `6px` | 71 | app.css:159,172,342,366,382,397,440,681,693,761,778,797,866,887,939,995,1103,1137,1177,1187,1225,1271,1287,1305,1319,1329,1370,1381,1408,1465,1481,1515,1522,1556,1567,1579,1590,1606,1617,1628,1639,1652,1669,1695,1705,1723,1765,1819,1832,1845,2073,3209,3218,3226,3235,3240,3249,3303,3314,3318,3325,3336,3345,3348,3358,3373 · polish.css:46,190,255,297,343 |
| `50%` | 38 | app.css:128,201,275,299,836,1746,1760,2332,2563,3104,3184,3189,3263,3267,3278 · pol-stats.css:176,448,564,890 · pol-studio.css:229,319,1245,1333,1509 · pol-shell.css:440,853,1035,1044 · pol-thread.css:504,610,1175 · pol-public.css:575,1043 · account2.css:151 · roomsettings.css:102,268 · ui-sheets.css:521,525 |
| `var(--r-pill)` | 35 | (35 sites — style-map.json radius) |
| `4px` | 23 | app.css:2069,2640 · pol-stats.css:675 · pol-studio.css:910,1083,1151,1152,1313,1381,1442,1466 · pol-thread.css:236,289,1066,1148,1263,1281,1647 · pol-public.css:41 · polish.css:62,134 · ui-sheets.css:482,505 |
| `0` | 22 | app.css:2041,3125,3772 · pol-stats.css:332 · pol-studio.css:265 · pol-shell.css:1074,1093,1345 · pol-thread.css:916,1039 · pol-public.css:127,310,1326 · calls-c6.css:235 · calls-c4.css:64,67 · ui-sheets.css:119,626,742,836 · calls-engine.css:105,116 |
| `2px` | 15 | app.css:1973,3406 · pol-stats.css:830 · pol-shell.css:583,819,1302,1377 · pol-thread.css:869 · polish.css:217,226 · ui-sheets.css:337,866,982,1095 · calls-engine.css:98 |
| `999px` | 14 | app.css:173,184,186,193,196,205,267,318,332,3103 · roomsettings.css:258 · ui-sheets.css:728,884,907 |
| `10px` | 11 | app.css:1156,1197,1354,1395,1534,1905 · pol-studio.css:246 · pol-public.css:293,553,1353,1389 |
| `8px` | 10 | app.css:177,1087,1124,1216,1221,1243,1680,1734,1781,1802 |
| `12px 12px 0 0` | 7 | pol-thread.css:362,1303 · pol-roster.css:370 · polish.css:367 · ui-sheets.css:309,970,1084 |
| `3px` | 5 | app.css:245,569,2062,2081 · pol-public.css:1202 |
| `var(--radius) var(--radius) 0 0` | 3 | app.css:3909 · ui-sheets.css:629 · calls-engine.css:93 |
| `2px 2px 0 0` | 3 | pol-stats.css:717,811 · roomsettings.css:342 |
| `0 3px 3px 0` | 2 | pol-shell.css:692,812 |
| `1px` | 2 | pol-public.css:168,861 |
| `0 0 6px 6px` | 1 | app.css:3293 |
| `6px 6px 0 0` | 1 | app.css:3404 |
| `inherit` | 1 | pol-stats.css:911 |
| `calc(var(--radius) * 2) calc(var(--radius) * 2) 0 0` | 1 | pol-shell.css:1291 |
| `calc(var(--radius) * 1.5)` | 1 | pol-shell.css:1322 |
| `calc(var(--radius) * 2)` | 1 | pol-shell.css:1374 |
| `0 var(--radius) var(--radius) 0` | 1 | pol-thread.css:173 |
| `0 0 4px 4px` | 1 | pol-thread.css:306 |
| `calc(var(--radius) + 3px)` | 1 | pol-public.css:659 |
| `0 0 var(--radius) var(--radius)` | 1 | ui-sheets.css:630 |

## G11. Elevation / shadows (every declaration)

| file:line | selector | property | value |
|---|---|---|---|
| app.css:84 | `:root` | --elev-0 | `none` |
| app.css:85 | `:root` | --elev-1 | `0 1px 0 color-mix(in oklab, var(--onyx-text) 5%, transparent) inset` |
| app.css:86 | `:root` | --elev-2 | `0 14px 36px -28px color-mix(in oklab, var(--onyx-bg) 88%, transparent)` |
| app.css:87 | `:root` | --elev-3 | `0 28px 56px -32px color-mix(in oklab, #000 90%, transparent), 0 1px 0 color-mix(in oklab, var(--onyx-text) 6%, transpare` |
| app.css:136 | `.onyx-avatar--owner` | box-shadow | `0 0 0 2px var(--gold)` |
| app.css:141 | `.onyx-row-avatar .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| app.css:203 | `.onyx-facepile-face .onyx-avatar` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| app.css:1906 | `.conn-card` | box-shadow | `var(--elev-2)` |
| app.css:2041 | `.conn-card` | box-shadow | `none` |
| app.css:2570 | `.onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 2px var(--onyx-faint)` |
| app.css:2667 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | box-shadow | `0 12px 32px rgb(0 8 16 / 45%)` |
| app.css:2882 | `.onyx-moddesk-sheet` | box-shadow | `-8px 0 24px rgb(0 0 0 / 35%)` |
| app.css:3074 | `.onyx-prefs` | box-shadow | `0 8px 24px rgba(0, 0, 0, 0.35)` |
| app.css:3084 | `.pref-category-tab[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| app.css:3337 | `.onyx-call-sheet` | box-shadow | `0 12px 32px rgba(0, 0, 0, 0.35)` |
| app.css:3613 | `.notif-center` | box-shadow | `var(--elev-2)` |
| app.css:3695 | `.onyx-room-more-menu` | box-shadow | `var(--elev-2)` |
| app.css:3764 | `.onyx-sheet-layer > .onyx-sheet` | box-shadow | `var(--elev-3)` |
| pol-stats.css:321 | `.roadmap-legend a[aria-current='location']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-stats.css:340 | `.roadmap-card:is(:target, [data-current='true'])` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-stats.css:956 | `.stats-page .data-room-row[data-selected='true']` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-studio.css:230 | `.ap-swatch > span, .ap-theme-swatch > span` | box-shadow | `inset 0 0 0 1px color-mix(in oklab, #000 25%, transparent)` |
| pol-studio.css:321 | `.ap-choice-toggle > b::after` | box-shadow | `0 1px 3px color-mix(in oklab, #000 40%, transparent)` |
| pol-studio.css:538 | `.background-picker__card--selected` | box-shadow | `inset 0 0 0 1px var(--onyx-text)` |
| pol-shell.css:432 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` | box-shadow | `var(--elev-3)` |
| pol-shell.css:652 | `.onyx-topbar .shell-ribbon-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:714 | `.onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:1245 | `.onyx-room-back-count` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| pol-shell.css:1292 | `.onyx-frame .onyx-room-more-menu` | box-shadow | `var(--elev-3)` |
| pol-shell.css:1377 | `.onyx-rail .onyx-rail-color` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| pol-shell.css:1431 | `.onyx-mobile-nav .onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-thread.css:170 | `.onyx-mention` | box-shadow | `inset 2px 0 0 var(--gold)` |
| pol-thread.css:181 | `.onyx-message-search-current, .onyx-message-search-current:hover` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:211 | `.onyx-row-actions` | box-shadow | `var(--elev-2)` |
| pol-thread.css:277 | `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-react-picker` | box-shadow | `var(--elev-3)` |
| pol-thread.css:586 | `.onyx-frame .onyx-jump-latest` | box-shadow | `var(--elev-3)` |
| pol-thread.css:926 | `.onyx-thread-msg-face .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| pol-thread.css:1251 | `.onyx-composer .shell-command-menu, .onyx-composer .shell-emoji-picker` | box-shadow | `var(--elev-3)` |
| pol-thread.css:1265 | `.onyx-composer .shell-command-item--active` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:1655 | `.room-media-index-filter[aria-selected='true']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-roster.css:243 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px var(--onyx-faint)` |
| pol-roster.css:352 | `.onyx-frame > .onyx-roster:popover-open, .onyx-roster:popover-open` | box-shadow | `var(--elev-3)` |
| pol-roster.css:414 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px CanvasText` |
| pol-public.css:127 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-public.css:333 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 3px 0 0 var(--onyx-accent)` |
| pol-public.css:555 | `.onyx-land-sketch-window` | box-shadow | `var(--elev-2)` |
| pol-public.css:677 | `.onyx-land-tabs button[aria-selected="true"]` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| pol-public.css:835 | `.ab-scene` | box-shadow | `var(--elev-2)` |
| pol-public.css:1327 | `.guides-route__item[data-state="current"] .guides-route__card` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1499 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1570 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| polish.css:47 | `.shell-composer-tools` | box-shadow | `var(--elev-3)` |
| polish.css:344 | `.update-available` | box-shadow | `0 8px 24px rgb(0 0 0 / 0.35)` |
| polish.css:383 | `.update-available` | box-shadow | `none` |
| account2.css:37 | `.a2-input:focus-visible, .a2-select:focus-visible, .a2-textarea:focus-` | box-shadow | `var(--focus-ring)` |
| account2.css:57 | `.a2-btn:focus-visible, .a2-link:focus-visible` | box-shadow | `var(--focus-ring)` |
| account2.css:120 | `.a2-reclaim__signin:focus-visible, .a2-reclaim__dismiss:focus-visible` | box-shadow | `var(--focus-ring)` |
| account2.css:157 | `.a2-dot--avatar` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| calls-c6.css:104 | `.onyx-call-pip-card` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:69 | `.onyx-sheet-layer > .onyx-sheet` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:413 | `.onyx-spotlight-panel` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:449 | `.onyx-spotlight-option[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| ui-sheets.css:509 | `.notif-center .notif-center__filter[aria-pressed="true"]` | box-shadow | `none` |
| ui-sheets.css:800 | `.onyx-toast` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:803 | `.onyx-toast--success` | box-shadow | `inset 3px 0 0 var(--onyx-accent), var(--elev-3)` |
| ui-sheets.css:804 | `.onyx-toast--danger` | box-shadow | `inset 3px 0 0 var(--onyx-bad), var(--elev-3)` |
| ui-sheets.css:805 | `.onyx-toast--warning` | box-shadow | `inset 3px 0 0 var(--onyx-warn), var(--elev-3)` |
| ui-sheets.css:886 | `.onyx-prefs .pref-category-tab[aria-selected="true"]` | box-shadow | `none` |
| ui-sheets.css:971 | `.onyx-room-more-menu` | box-shadow | `var(--elev-3)` |
| pol-ios.css:86 | `.onyx-frame` | box-shadow | `inset 0 var(--safe-top) 0 0 var(--onyx-panel)` |
| calls-engine.css:94 | `.onyx-call-more` | box-shadow | `0 -12px 32px rgba(0, 0, 0, 0.45)` |

## G12. !important (every use)

| file:line | selector | declaration | context |
|---|---|---|---|
| app.css:3138 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `animation-duration: 0.001ms` |  |
| app.css:3139 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `animation-iteration-count: 1` |  |
| app.css:3140 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `transition-duration: 0.001ms` |  |
| app.css:3141 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `scroll-behavior: auto` |  |
| app.css:3148 | `:root[data-high-contrast='true'] :focus-visible` | `outline: 3px solid var(--lapis-bright)` |  |
| app.css:3151 | `:root[data-reduce-transparency='true'] *` | `backdrop-filter: none` |  |
| app.css:3927 | `*, *::before, *::after` | `animation: none` | @media (prefers-reduced-motion: reduce) |
| app.css:3928 | `*, *::before, *::after` | `transition-duration: 0ms` | @media (prefers-reduced-motion: reduce) |
| app.css:3929 | `*, *::before, *::after` | `scroll-behavior: auto` | @media (prefers-reduced-motion: reduce) |
| app.css:3942 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `animation: none` |  |
| pol-stats.css:1062 | `:is(.stats-page, .status-route, .roadmap-page) *` | `transition: none` | @media (prefers-reduced-motion: reduce) |
| pol-ios.css:126 | `.onyx-sheet-layer:has(> [data-shortcut-scope="a2hs"]), [data-shortcut-scope="a2h` | `display: none` | @media (display-mode: standalone) |

## G13. Same selector declared more than once in the same context

278 selectors are declared in more than one rule; 133 across files. Property conflicts: 223. Declarations shadowed by a later identical selector: 340 (114 merely restate the winning value).

### G13.0 Rules fully overridden by a later identical selector (54 rules, 134 declarations — deletable without visual change)

| file:line | selector | decls | context |
|---|---|---|---|
| app.css:282 | `.onyx-conn-live` | 1 |  |
| app.css:283 | `.onyx-conn-live .onyx-dot` | 1 |  |
| app.css:323 | `.onyx-reconnect-online` | 1 |  |
| app.css:324 | `.onyx-reconnect-online .onyx-reconnect-dot` | 1 |  |
| app.css:508 | `.onyx-rail .onyx-rail-filter-unread-on` | 2 |  |
| app.css:592 | `.onyx-rail .onyx-rail-star-on` | 1 |  |
| app.css:804 | `.onyx-calls-toggle-open` | 2 |  |
| app.css:923 | `.onyx-land-lede` | 4 |  |
| app.css:930 | `.onyx-land-cta` | 4 |  |
| app.css:937 | `.onyx-land-open` | 6 |  |
| app.css:946 | `.onyx-land-link` | 3 |  |
| app.css:952 | `.onyx-land-note` | 3 |  |
| app.css:958 | `.onyx-land-trust` | 1 |  |
| app.css:960 | `.onyx-land-h2` | 3 |  |
| app.css:966 | `.onyx-land-claims` | 3 |  |
| app.css:972 | `.onyx-land-claims dt` | 1 |  |
| app.css:973 | `.onyx-land-claims dd` | 2 |  |
| app.css:975 | `.onyx-land-detail` | 2 |  |
| app.css:976 | `.onyx-land-detail a` | 1 |  |
| app.css:978 | `.onyx-land-board` | 1 |  |
| app.css:980 | `.onyx-land-board-head p` | 3 |  |
| app.css:986 | `.onyx-land-tabs` | 3 |  |
| app.css:992 | `.onyx-land-tabs button` | 7 |  |
| app.css:1017 | `.onyx-land-panel-copy p` | 1 |  |
| app.css:1019 | `.onyx-land-h3` | 3 |  |
| app.css:1025 | `.onyx-land-action` | 4 |  |
| app.css:1034 | `.onyx-land-links` | 4 |  |
| app.css:1041 | `.onyx-land-links a` | 1 |  |
| app.css:1043 | `.onyx-land-footnote` | 2 |  |
| app.css:1044 | `.onyx-land-footnote a` | 1 |  |
| app.css:1046 | `.onyx-land-shelf` | 1 |  |
| app.css:1048 | `.onyx-land-shelf-label` | 4 |  |
| app.css:1055 | `.onyx-land-shelf-list` | 6 |  |
| app.css:1064 | `.onyx-land-shelf-list a` | 1 |  |
| app.css:1119 | `.guest-claim-chip` | 7 |  |
| app.css:2091 | `.onyx-notify-toggle-open` | 2 |  |
| app.css:2188 | `.onyx-nav-btn--active .onyx-nav-icon` | 1 |  |
| app.css:2234 | `.onyx-you-close` | 6 |  |
| app.css:2432 | `.onyx-composer .shell-command-item--active` | 1 |  |
| app.css:2492 | `.boost-pill.you` | 1 |  |
| app.css:2557 | `.onyx-roster .onyx-member` | 3 |  |
| app.css:2558 | `.onyx-roster .onyx-member.onyx-away` | 1 |  |
| app.css:2698 | `.onyx-spotlight-close, .onyx-shortcuts-close` | 9 |  |
| app.css:2712 | `.onyx-dmsafe-trigger[aria-expanded="true"]` | 1 |  |
| app.css:2788 | `.onyx-spotlight-group + .onyx-spotlight-group` | 1 |  |
| app.css:2865 | `.onyx-spotlight` | 2 | @media (max-width: 767.98px) |
| app.css:2877 | `.onyx-moddesk-toggle[aria-pressed="true"]` | 1 |  |
| app.css:3398 | `.onyx-call-bar` | 1 | @media (max-width: 640px) |
| app.css:3399 | `.onyx-call-bar-center` | 1 | @media (max-width: 640px) |
| app.css:3402 | `.onyx-cbtn-leave` | 1 | @media (max-width: 640px) |
| app.css:3403 | `.onyx-call-more` | 3 | @media (max-width: 640px) |
| app.css:3768 | `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` | 5 |  |
| app.css:3842 | `.onyx-rail .onyx-rail-star-on` | 1 |  |
| pol-shell.css:304 | `.chb .chb-sort-btn[aria-pressed="true"]` | 2 |  |

### G13.1 Cross-file duplicates with conflicting values

| selector | context | property | values in cascade order | winner |
|---|---|---|---|---|
| `.onyx-thread-sheet` |  | padding | app.css:154 `16px`<br>pol-thread.css:876 `0` | pol-thread.css:876 |
| `.onyx-thread-sheet` |  | gap | app.css:154 `12px`<br>pol-thread.css:876 `0` | pol-thread.css:876 |
| `.topic-chip` |  | font-size | app.css:193 `12px`<br>pol-thread.css:626 `var(--text-sm)` | pol-thread.css:626 |
| `.onyx-rail .onyx-rail-filter-unread` |  | font-size | app.css:505 `var(--text-2xs)`<br>pol-shell.css:764 `var(--text-xs)` | pol-shell.css:764 |
| `.onyx-rail .onyx-rail-filter-unread` |  | padding | app.css:506 `3px var(--space-2)`<br>pol-shell.css:763 `0 var(--space-2)` | pol-shell.css:763 |
| `.onyx-rail .onyx-rail-filter-clear` |  | font-size | app.css:505 `var(--text-2xs)`<br>pol-shell.css:764 `var(--text-xs)` | pol-shell.css:764 |
| `.onyx-rail .onyx-rail-filter-clear` |  | padding | app.css:506 `3px var(--space-2)`<br>pol-shell.css:763 `0 var(--space-2)` | pol-shell.css:763 |
| `.onyx-rail .onyx-rail-new` |  | font-size | app.css:505 `var(--text-2xs)`<br>pol-shell.css:783 `var(--text-xs)` | pol-shell.css:783 |
| `.onyx-rail .onyx-rail-new` |  | padding | app.css:506 `3px var(--space-2)`<br>pol-shell.css:779 `0 var(--space-2)` | pol-shell.css:779 |
| `.onyx-rail .onyx-rail-star` |  | width | app.css:501 `auto`<br>pol-shell.css:858 `28px` | pol-shell.css:858 |
| `.onyx-rail .onyx-rail-star` |  | border | app.css:503 `1px solid var(--onyx-line)`<br>pol-shell.css:861 `0` | pol-shell.css:861 |
| `.onyx-rail .onyx-rail-star` |  | color | app.css:504 `var(--onyx-dim)`<br>app.css:589 `var(--onyx-faint)`<br>pol-shell.css:862 `var(--onyx-faint)` | pol-shell.css:862 |
| `.onyx-rail .onyx-rail-star` |  | padding | app.css:506 `3px var(--space-2)`<br>app.css:590 `3px 6px`<br>pol-shell.css:860 `0` | pol-shell.css:860 |
| `.onyx-rail .onyx-rail-filter-unread-on` |  | border-color | app.css:509 `var(--onyx-accent)`<br>pol-shell.css:768 `var(--onyx-dim)` | pol-shell.css:768 |
| `.onyx-rail .onyx-rail-filter-unread-on` |  | color | app.css:510 `var(--onyx-accent)`<br>pol-shell.css:768 `var(--onyx-text)` | pol-shell.css:768 |
| `.onyx-rail-meta` |  | gap | app.css:553 `6px`<br>pol-shell.css:826 `4px` | pol-shell.css:826 |
| `.onyx-rail .onyx-rail-star-on` |  | color | app.css:592 `var(--onyx-accent)`<br>app.css:3842 `var(--onyx-text)`<br>pol-shell.css:870 `var(--onyx-dim)` | pol-shell.css:870 |
| `.onyx-newmsg-sheet` |  | gap | app.css:606 `10px`<br>ui-sheets.css:767 `var(--space-3)` | ui-sheets.css:767 |
| `.onyx-composer` |  | align-items | app.css:744 `center`<br>pol-thread.css:985 `stretch` | pol-thread.css:985 |
| `.onyx-composer` |  | gap | app.css:745 `10px`<br>pol-thread.css:987 `var(--space-2)` | pol-thread.css:987 |
| `.onyx-composer` |  | padding | app.css:746 `10px 16px`<br>pol-thread.css:988 `var(--space-2) var(--space-4) var(--space-3)` | pol-thread.css:988 |
| `.onyx-composer` |  | background | app.css:747 `var(--onyx-panel)`<br>pol-thread.css:989 `var(--onyx-bg)` | pol-thread.css:989 |
| `.onyx-composer` |  | border-top | app.css:748 `1px solid var(--onyx-line)`<br>pol-thread.css:990 `0` | pol-thread.css:990 |
| `.onyx-land-h1` |  | font-size | app.css:914 `44px`<br>pol-public.css:514 `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | pol-public.css:514 |
| `.onyx-land-h1` |  | letter-spacing | app.css:916 `-0.02em`<br>pol-public.css:516 `-0.03em` | pol-public.css:516 |
| `.onyx-land-h1` |  | line-height | app.css:917 `1.05`<br>pol-public.css:517 `1.02` | pol-public.css:517 |
| `.onyx-land-lede` |  | font-size | app.css:925 `17px`<br>pol-public.css:523 `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | pol-public.css:523 |
| `.onyx-land-lede` |  | margin | app.css:926 `16px 0 0`<br>pol-public.css:521 `var(--space-5) 0 0` | pol-public.css:521 |
| `.onyx-land-lede` |  | max-width | app.css:927 `52ch`<br>pol-public.css:520 `36ch` | pol-public.css:520 |
| `.onyx-land-cta` |  | gap | app.css:933 `12px 20px`<br>pol-public.css:526 `var(--space-3)` | pol-public.css:526 |
| `.onyx-land-cta` |  | margin-top | app.css:934 `28px`<br>pol-public.css:526 `var(--space-7)` | pol-public.css:526 |
| `.onyx-land-open` |  | border-radius | app.css:939 `6px`<br>pol-public.css:535 `var(--radius)` | pol-public.css:535 |
| `.onyx-land-open` |  | padding | app.css:942 `10px 22px`<br>pol-public.css:533 `0 var(--space-6)` | pol-public.css:533 |
| `.onyx-land-link` |  | align-self | app.css:947 `center`<br>pol-public.css:542 `auto` | pol-public.css:542 |
| `.onyx-land-link` |  | font-weight | app.css:949 `600`<br>pol-public.css:537 `650` | pol-public.css:537 |
| `.onyx-land-note` |  | font-size | app.css:954 `13px`<br>pol-public.css:544 `var(--text-sm)` | pol-public.css:544 |
| `.onyx-land-note` |  | margin | app.css:955 `16px 0 0`<br>pol-public.css:544 `var(--space-5) 0 0` | pol-public.css:544 |
| `.onyx-land-trust` |  | margin-top | app.css:958 `64px`<br>pol-public.css:620 `0` | pol-public.css:620 |
| `.onyx-land-h2` |  | font-size | app.css:961 `20px`<br>pol-public.css:621 `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | pol-public.css:621 |
| `.onyx-land-h2` |  | margin | app.css:963 `0 0 16px`<br>pol-public.css:621 `0` | pol-public.css:621 |
| `.onyx-land-claims` |  | gap | app.css:968 `16px`<br>pol-public.css:625 `var(--space-6)` | pol-public.css:625 |
| `.onyx-land-claims` |  | margin | app.css:969 `0`<br>pol-public.css:626 `var(--space-7) 0 0` | pol-public.css:626 |
| `.onyx-land-claims dd` |  | margin | app.css:973 `2px 0 0`<br>pol-public.css:630 `var(--space-1) 0 0` | pol-public.css:630 |
| `.onyx-land-detail` |  | margin | app.css:975 `16px 0 0`<br>pol-public.css:644 `var(--space-6) 0 0` | pol-public.css:644 |
| `.onyx-land-board` |  | margin-top | app.css:978 `64px`<br>pol-public.css:648 `0` | pol-public.css:648 |
| `.onyx-land-board-head p` |  | margin | app.css:982 `8px 0 0`<br>pol-public.css:650 `var(--space-3) 0 0` | pol-public.css:650 |
| `.onyx-land-board-head p` |  | max-width | app.css:983 `62ch`<br>pol-public.css:650 `60ch` | pol-public.css:650 |
| `.onyx-land-tabs` |  | display | app.css:987 `flex`<br>pol-public.css:652 `inline-flex` | pol-public.css:652 |
| `.onyx-land-tabs` |  | gap | app.css:988 `8px`<br>pol-public.css:654 `2px` | pol-public.css:654 |
| `.onyx-land-tabs` |  | margin-top | app.css:989 `20px`<br>pol-public.css:656 `var(--space-7)` | pol-public.css:656 |
| `.onyx-land-tabs button` |  | border | app.css:994 `1px solid var(--onyx-line)`<br>pol-public.css:666 `0` | pol-public.css:666 |
| `.onyx-land-tabs button` |  | border-radius | app.css:995 `6px`<br>pol-public.css:667 `var(--radius)` | pol-public.css:667 |
| `.onyx-land-tabs button` |  | padding | app.css:999 `8px 16px`<br>pol-public.css:665 `0 var(--space-4)` | pol-public.css:665 |
| `.onyx-land-panel` |  | display | app.css:1009 `flex`<br>pol-public.css:679 `grid` | pol-public.css:679 |
| `.onyx-land-panel` |  | gap | app.css:1011 `24px 48px`<br>pol-public.css:681 `var(--space-6) 56px` | pol-public.css:681 |
| `.onyx-land-panel` |  | margin-top | app.css:1012 `20px`<br>pol-public.css:682 `var(--space-5)` | pol-public.css:682 |
| `.onyx-land-h3` |  | font-size | app.css:1020 `17px`<br>pol-public.css:691 `var(--text-xl)` | pol-public.css:691 |
| `.onyx-land-h3` |  | margin | app.css:1022 `0 0 8px`<br>pol-public.css:691 `0` | pol-public.css:691 |
| `.onyx-land-action` |  | color | app.css:1026 `var(--onyx-accent)`<br>pol-public.css:701 `var(--onyx-text)` | pol-public.css:701 |
| `.onyx-land-action` |  | display | app.css:1027 `inline-block`<br>pol-public.css:693 `inline-flex` | pol-public.css:693 |
| `.onyx-land-action` |  | margin-top | app.css:1029 `12px`<br>pol-public.css:697 `var(--space-5)` | pol-public.css:697 |
| `.onyx-land-links` |  | gap | app.css:1037 `10px`<br>pol-public.css:716 `0` | pol-public.css:716 |
| `.onyx-land-links` |  | min-width | app.css:1038 `200px`<br>pol-public.css:716 `0` | pol-public.css:716 |
| `.onyx-land-footnote` |  | font-size | app.css:1043 `13px`<br>pol-public.css:739 `var(--text-sm)` | pol-public.css:739 |
| `.onyx-land-footnote a` |  | color | app.css:1044 `var(--onyx-text)`<br>pol-public.css:740 `var(--onyx-dim)` | pol-public.css:740 |
| `.onyx-land-shelf` |  | margin-top | app.css:1046 `64px`<br>pol-public.css:747 `0` | pol-public.css:747 |
| `.onyx-land-shelf-label` |  | font-size | app.css:1050 `13px`<br>pol-public.css:751 `var(--text-xs)` | pol-public.css:751 |
| `.onyx-land-shelf-label` |  | margin | app.css:1052 `0 0 12px`<br>pol-public.css:751 `0` | pol-public.css:751 |
| `.onyx-land-shelf-list` |  | gap | app.css:1058 `8px 24px`<br>pol-public.css:752 `0 var(--space-5)` | pol-public.css:752 |
| `.onyx-land-shelf-list a` |  | color | app.css:1064 `var(--onyx-text)`<br>pol-public.css:757 `var(--onyx-dim)` | pol-public.css:757 |
| `.onyx-toaster` |  | right | app.css:1068 `16px`<br>ui-sheets.css:789 `var(--space-5)` | ui-sheets.css:789 |
| `.onyx-toaster` |  | bottom | app.css:1069 `16px`<br>ui-sheets.css:790 `calc(var(--composer-h) + var(--space-6))` | ui-sheets.css:790 |
| `.onyx-toaster` |  | z-index | app.css:1070 `60`<br>ui-sheets.css:788 `90` | ui-sheets.css:788 |
| `.onyx-toaster` |  | max-width | app.css:1077 `min(360px, 90vw)`<br>ui-sheets.css:791 `min(380px, calc(100vw - 2 * var(--space-4)))` | ui-sheets.css:791 |
| `.onyx-toast` |  | align-items | app.css:1082 `flex-start`<br>ui-sheets.css:794 `center` | ui-sheets.css:794 |
| `.onyx-toast` |  | gap | app.css:1083 `8px`<br>ui-sheets.css:795 `var(--space-3)` | ui-sheets.css:795 |
| `.onyx-toast` |  | border-radius | app.css:1087 `8px`<br>ui-sheets.css:798 `var(--radius)` | ui-sheets.css:798 |
| `.onyx-toast` |  | padding | app.css:1088 `8px 10px`<br>ui-sheets.css:797 `var(--space-2) var(--space-2) var(--space-2) var(-` | ui-sheets.css:797 |
| `.guest-claim-chip` |  | gap | app.css:1122 `8px`<br>pol-shell.css:1103 `var(--space-3)` | pol-shell.css:1103 |
| `.guest-claim-chip` |  | border-radius | app.css:1124 `8px`<br>pol-shell.css:1107 `var(--radius)` | pol-shell.css:1107 |
| `.guest-claim-chip` |  | padding | app.css:1125 `6px 10px`<br>pol-shell.css:1104 `var(--space-3)` | pol-shell.css:1104 |
| `.onyx-you-close` |  | color | app.css:2235 `var(--onyx-text)`<br>ui-sheets.css:232 `var(--onyx-dim)` | ui-sheets.css:232 |
| `.onyx-you-close` |  | border | app.css:2237 `1px solid var(--onyx-line)`<br>ui-sheets.css:234 `0` | ui-sheets.css:234 |
| `.onyx-you-close` |  | padding | app.css:2239 `var(--space-1) var(--space-3)`<br>ui-sheets.css:229 `0` | ui-sheets.css:229 |
| `.onyx-coach-dismiss` |  | color | app.css:2375 `var(--onyx-dim)`<br>pol-shell.css:1080 `var(--onyx-faint)` | pol-shell.css:1080 |
| `.onyx-roster .onyx-member` |  | flex-wrap | app.css:2557 `wrap`<br>pol-roster.css:189 `nowrap` | pol-roster.css:189 |
| `.onyx-roster .onyx-member` |  | min-height | app.css:2557 `36px`<br>pol-roster.css:191 `40px` | pol-roster.css:191 |
| `.onyx-spotlight-close:focus-visible` |  | outline | app.css:2631 `2px solid var(--onyx-accent)`<br>ui-sheets.css:241 `var(--focus-ring)` | ui-sheets.css:241 |
| `.onyx-spotlight-close:focus-visible` |  | outline-offset | app.css:2631 `1px`<br>ui-sheets.css:241 `var(--focus-offset)` | ui-sheets.css:241 |
| `.onyx-shortcuts-close:focus-visible` |  | outline | app.css:2631 `2px solid var(--onyx-accent)`<br>ui-sheets.css:241 `var(--focus-ring)` | ui-sheets.css:241 |
| `.onyx-shortcuts-close:focus-visible` |  | outline-offset | app.css:2631 `1px`<br>ui-sheets.css:241 `var(--focus-offset)` | ui-sheets.css:241 |
| `.onyx-spotlight-foot kbd` |  | background | app.css:2638 `var(--onyx-panel-2)`<br>ui-sheets.css:480 `var(--onyx-bg)` | ui-sheets.css:480 |
| `.onyx-spotlight-foot kbd` |  | padding | app.css:2641 `1px 5px`<br>ui-sheets.css:477 `0 5px` | ui-sheets.css:477 |
| `.onyx-spotlight-backdrop` |  | background | app.css:2654 `rgb(0 0 0 / 55%)`<br>ui-sheets.css:407 `var(--sheet-veil)` | ui-sheets.css:407 |
| `.onyx-spotlight-panel` |  | width | app.css:2658 `min(560px, 100%)`<br>ui-sheets.css:410 `min(600px, 100%)` | ui-sheets.css:410 |
| `.onyx-spotlight-panel` |  | max-height | app.css:2659 `min(70vh, 560px)`<br>ui-sheets.css:411 `min(64vh, 560px)` | ui-sheets.css:411 |
| `.onyx-spotlight-panel` |  | box-shadow | app.css:2667 `0 12px 32px rgb(0 8 16 / 45%)`<br>ui-sheets.css:413 `var(--elev-3)` | ui-sheets.css:413 |
| `.onyx-spotlight-panel` |  | animation | app.css:2668 `onyx-switcher-in var(--dur-fast) ease-out`<br>ui-sheets.css:415 `ui-sheet-drop var(--dur-fast) var(--ease)` | ui-sheets.css:415 |
| `.onyx-spotlight-search` |  | gap | app.css:2682 `var(--space-2)`<br>ui-sheets.css:419 `var(--space-3)` | ui-sheets.css:419 |
| `.onyx-spotlight-search` |  | padding | app.css:2683 `10px var(--space-3)`<br>ui-sheets.css:421 `0 var(--space-2) 0 var(--space-4)` | ui-sheets.css:421 |
| `.onyx-spotlight-input` |  | font-size | app.css:2694 `var(--text-md)`<br>ui-sheets.css:431 `var(--text-lg)` | ui-sheets.css:431 |
| `.onyx-spotlight-input` |  | padding | app.css:2695 `6px 0`<br>ui-sheets.css:431 `10px 0` | ui-sheets.css:431 |
| `.onyx-spotlight-close` |  | min-width | app.css:2700 `32px`<br>ui-sheets.css:226 `var(--sheet-close)` | ui-sheets.css:226 |
| `.onyx-spotlight-close` |  | min-height | app.css:2701 `32px`<br>ui-sheets.css:227 `var(--sheet-close)` | ui-sheets.css:227 |
| `.onyx-spotlight-close` |  | border | app.css:2703 `1px solid var(--onyx-line)`<br>ui-sheets.css:234 `0` | ui-sheets.css:234 |
| `.onyx-spotlight-close` |  | font-size | app.css:2707 `var(--text-lg)`<br>ui-sheets.css:230 `0` | ui-sheets.css:230 |
| `.onyx-spotlight-close` |  | line-height | app.css:2708 `1`<br>ui-sheets.css:231 `0` | ui-sheets.css:231 |
| `.onyx-spotlight-close` |  | margin | ui-sheets.css:228 `0 -6px 0 0`<br>ui-sheets.css:433 `0` | ui-sheets.css:433 |
| `.onyx-shortcuts-close` |  | min-width | app.css:2700 `32px`<br>ui-sheets.css:226 `var(--sheet-close)` | ui-sheets.css:226 |
| `.onyx-shortcuts-close` |  | min-height | app.css:2701 `32px`<br>ui-sheets.css:227 `var(--sheet-close)` | ui-sheets.css:227 |
| `.onyx-shortcuts-close` |  | border | app.css:2703 `1px solid var(--onyx-line)`<br>ui-sheets.css:234 `0` | ui-sheets.css:234 |
| `.onyx-shortcuts-close` |  | font-size | app.css:2707 `var(--text-lg)`<br>ui-sheets.css:230 `0` | ui-sheets.css:230 |
| `.onyx-shortcuts-close` |  | line-height | app.css:2708 `1`<br>ui-sheets.css:231 `0` | ui-sheets.css:231 |
| `.onyx-spotlight-results` |  | padding | app.css:2784 `6px`<br>ui-sheets.css:435 `var(--space-2)` | ui-sheets.css:435 |
| `.onyx-spotlight-group + .onyx-spotlight-group` |  | margin-top | app.css:2788 `6px`<br>ui-sheets.css:437 `var(--space-2)` | ui-sheets.css:437 |
| `.onyx-spotlight-section` |  | padding | app.css:2791 `6px var(--space-2) var(--space-1)`<br>ui-sheets.css:436 `var(--space-2) var(--space-3) var(--space-1)` | ui-sheets.css:436 |
| `.onyx-spotlight-option` |  | gap | app.css:2800 `10px`<br>ui-sheets.css:440 `var(--space-3)` | ui-sheets.css:440 |
| `.onyx-spotlight-option` |  | min-height | app.css:2801 `36px`<br>ui-sheets.css:441 `40px` | ui-sheets.css:441 |
| `.onyx-spotlight-option` |  | padding | app.css:2802 `6px var(--space-2)`<br>ui-sheets.css:442 `0 var(--space-3)` | ui-sheets.css:442 |
| `.onyx-spotlight-option` |  | border-left | app.css:2804 `2px solid transparent`<br>ui-sheets.css:443 `0` | ui-sheets.css:443 |
| `.onyx-spotlight-title mark` |  | text-decoration | app.css:2814 `underline`<br>ui-sheets.css:461 `none` | ui-sheets.css:461 |
| `.onyx-spotlight-hint` |  | color | app.css:2818 `var(--onyx-dim)`<br>ui-sheets.css:462 `var(--onyx-faint)` | ui-sheets.css:462 |
| `.onyx-spotlight-hint` |  | font-size | app.css:2819 `var(--text-2xs)`<br>ui-sheets.css:462 `var(--text-sm)` | ui-sheets.css:462 |
| `.onyx-spotlight-foot` |  | padding | app.css:2829 `var(--space-2) var(--space-3)`<br>ui-sheets.css:469 `var(--space-2) var(--space-4)` | ui-sheets.css:469 |
| `.onyx-spotlight` | @media (max-width: 767.98px) | padding | app.css:2865 `var(--space-2)`<br>ui-sheets.css:830 `0` | ui-sheets.css:830 |
| `.onyx-spotlight` | @media (max-width: 767.98px) | align-items | app.css:2865 `start`<br>ui-sheets.css:830 `stretch` | ui-sheets.css:830 |
| `.onyx-spotlight-panel` | @media (max-width: 767.98px) | max-height | app.css:2866 `calc(100dvh - 16px)`<br>ui-sheets.css:833 `none` | ui-sheets.css:833 |
| `.onyx-call-people` |  | align-items | app.css:3257 `center`<br>calls-engine.css:21 `flex-start` | calls-engine.css:21 |
| `.onyx-call-bar` |  | grid-template-columns | app.css:3292 `1fr auto 1fr`<br>calls-engine.css:24 `minmax(0, 1fr) auto minmax(0, 1fr)` | calls-engine.css:24 |
| `.onyx-call-bar` | @media (max-width: 640px) | padding | app.css:3398 `10px 12px calc(10px + env(safe-area-inset-bottom, `<br>calls-engine.css:85 `var(--space-2) var(--space-2) var(--space-2)` | calls-engine.css:85 |
| `.onyx-call-bar-center` | @media (max-width: 640px) | justify-content | app.css:3399 `space-between`<br>calls-engine.css:77 `stretch` | calls-engine.css:77 |
| `.onyx-call-more` | @media (max-width: 640px) | left | app.css:3403 `auto`<br>calls-engine.css:90 `0` | calls-engine.css:90 |
| `.onyx-frame` |  | height | app.css:3433 `100vh`<br>app.css:3434 `100dvh`<br>pol-ios.css:65 `var(--vvh, 100dvh)` | pol-ios.css:65 |
| `.onyx-frame > .onyx-primary-nav` |  | padding | app.css:3443 `var(--space-2) var(--space-1)`<br>pol-shell.css:671 `var(--space-2) 0` | pol-shell.css:671 |
| `.onyx-frame > .onyx-primary-nav` |  | gap | app.css:3444 `var(--space-1)`<br>pol-shell.css:670 `2px` | pol-shell.css:670 |
| `.onyx-primary-nav .onyx-nav-btn` |  | padding | app.css:3496 `var(--space-2) 0`<br>pol-shell.css:677 `0` | pol-shell.css:677 |
| `.onyx-primary-nav .onyx-nav-btn` |  | min-height | app.css:3497 `var(--target-min)`<br>pol-shell.css:676 `40px` | pol-shell.css:676 |
| `.notif-center__filters` |  | display | app.css:3618 `flex`<br>pol-shell.css:60 `grid` | pol-shell.css:60 |
| `.onyx-sheet-layer` |  | padding | app.css:3727 `var(--space-4)`<br>ui-sheets.css:57 `var(--space-6) var(--space-4)` | ui-sheets.css:57 |
| `.onyx-sheet-backdrop` |  | background | app.css:3739 `color-mix(in srgb, #000 55%, transparent)`<br>ui-sheets.css:60 `var(--sheet-veil)` | ui-sheets.css:60 |
| `.onyx-sheet-layer > .onyx-sheet` |  | animation | app.css:3765 `onyx-sheet-in var(--dur-fast) var(--ease)`<br>ui-sheets.css:73 `ui-sheet-pop var(--dur-base) var(--ease)` | ui-sheets.css:73 |
| `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` |  | animation-name | app.css:3773 `onyx-sheet-side-in`<br>ui-sheets.css:120 `ui-sheet-side` | ui-sheets.css:120 |
| `.onyx-sheet-close` |  | min-width | app.css:3805 `32px`<br>ui-sheets.css:226 `var(--sheet-close)` | ui-sheets.css:226 |
| `.onyx-sheet-close` |  | min-height | app.css:3806 `32px`<br>ui-sheets.css:227 `var(--sheet-close)` | ui-sheets.css:227 |
| `.onyx-sheet-close` |  | border | app.css:3811 `1px solid var(--onyx-line)`<br>ui-sheets.css:234 `0` | ui-sheets.css:234 |
| `.onyx-frame > .onyx-mobile-nav` | @media (max-width: 767.98px) | gap | app.css:3878 `2px`<br>pol-shell.css:1409 `0` | pol-shell.css:1409 |
| `.onyx-frame > .onyx-mobile-nav` | @media (max-width: 767.98px) | padding | app.css:3880 `var(--space-1) var(--space-1) calc(var(--space-1) `<br>pol-shell.css:1411 `0 var(--space-1) var(--safe-bottom, 0px)` | pol-shell.css:1411 |
| `.onyx-mobile-nav .onyx-nav-btn` | @media (max-width: 767.98px) | font-size | app.css:3885 `var(--text-xs)`<br>pol-shell.css:1421 `11px` | pol-shell.css:1421 |
| `.onyx-sheet-layer > .onyx-sheet` | @media (max-width: 767.98px) | max-height | app.css:3907 `92dvh`<br>ui-sheets.css:307 `var(--sheet-max-h)` | ui-sheets.css:307 |
| `.onyx-sheet-layer > .onyx-sheet` | @media (max-width: 767.98px) | border-radius | app.css:3909 `var(--radius) var(--radius) 0 0`<br>ui-sheets.css:309 `12px 12px 0 0` | ui-sheets.css:309 |
| `.onyx-sheet-layer > .onyx-sheet` | @media (max-width: 767.98px) | padding-bottom | ui-sheets.css:310 `calc(var(--sheet-pad) + env(safe-area-inset-bottom`<br>ui-sheets.css:1045 `calc(var(--sheet-pad) + max(0px, env(safe-area-ins` | ui-sheets.css:1045 |
| `.notif-center .notif-center__open` |  | grid-template-columns | pol-shell.css:103 `28px minmax(0, 1fr)`<br>ui-sheets.css:524 `32px minmax(0, 1fr)` | ui-sheets.css:524 |
| `.notif-center .notif-center__open` |  | min-height | pol-shell.css:108 `44px`<br>ui-sheets.css:524 `52px` | ui-sheets.css:524 |
| `.notif-center .notif-center__open` |  | padding | pol-shell.css:109 `var(--space-2)`<br>ui-sheets.css:524 `var(--space-2) var(--space-2)` | ui-sheets.css:524 |
| `.chb .chb-sort-btn[aria-pressed="true"]` |  | border-color | pol-shell.css:304 `var(--onyx-dim)`<br>ui-sheets.css:738 `transparent` | ui-sheets.css:738 |
| `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` |  | width | pol-shell.css:426 `min(360px, 100%)`<br>ui-sheets.css:1060 `min(380px, 100%)` | ui-sheets.css:1060 |
| `:root` | @media (max-width: 767.98px) | --sheet-max-h | ui-sheets.css:293 `calc(100dvh - env(safe-area-inset-top, 0px) - 20px`<br>ui-sheets.css:1037 `calc(var(--vvh, 100dvh) - env(safe-area-inset-top,` | ui-sheets.css:1037 |

### G13.2 Cross-file duplicates (all)

| selector | context | occurrences |
|---|---|---|
| `:root` |  | app.css:4, pol-thread.css:11, pol-thread.css:37, ui-sheets.css:14 |
| `.onyx-system` |  | app.css:145, pol-thread.css:488 |
| `.onyx-day-divider` |  | app.css:149, pol-thread.css:451 |
| `.onyx-day-divider-label` |  | app.css:150, pol-thread.css:459 |
| `.onyx-thread-sheet` |  | app.css:154, pol-thread.css:876 |
| `.topic-chip` |  | app.css:193, pol-thread.css:626 |
| `html` |  | app.css:209, app.css:3828, pol-ios.css:24 |
| `.onyx-rail li` |  | app.css:431, pol-shell.css:791 |
| `.onyx-rail .onyx-rail-filter-unread` |  | app.css:496, pol-shell.css:759 |
| `.onyx-rail .onyx-rail-filter-clear` |  | app.css:496, pol-shell.css:759 |
| `.onyx-rail .onyx-rail-new` |  | app.css:496, pol-shell.css:775 |
| `.onyx-rail .onyx-rail-star` |  | app.css:496, app.css:587, pol-shell.css:855 |
| `.onyx-rail .onyx-rail-filter-unread-on` |  | app.css:508, pol-shell.css:768 |
| `.onyx-rail .onyx-rail-item` |  | app.css:534, pol-shell.css:794 |
| `.onyx-rail-copy` |  | app.css:540, pol-shell.css:820 |
| `.onyx-rail-meta` |  | app.css:553, pol-shell.css:826 |
| `.onyx-rail-avatar` |  | app.css:574, account2.css:156 |
| `.onyx-rail .onyx-rail-star-on` |  | app.css:592, app.css:3842, pol-shell.css:870 |
| `.onyx-newmsg-sheet` |  | app.css:596, ui-sheets.css:767 |
| `.onyx-composer` |  | app.css:742, app.css:2387, pol-thread.css:983 |
| `.onyx-land-h1` |  | app.css:913, pol-public.css:513 |
| `.onyx-land-lede` |  | app.css:923, pol-public.css:519 |
| `.onyx-land-cta` |  | app.css:930, pol-public.css:526 |
| `.onyx-land-open` |  | app.css:937, pol-public.css:527, pol-public.css:540 |
| `.onyx-land-link` |  | app.css:946, pol-public.css:527, pol-public.css:542 |
| `.onyx-land-note` |  | app.css:952, pol-public.css:544 |
| `.onyx-land-trust` |  | app.css:958, pol-public.css:620 |
| `.onyx-land-h2` |  | app.css:960, pol-public.css:621 |
| `.onyx-land-claims` |  | app.css:966, pol-public.css:622 |
| `.onyx-land-claims dt` |  | app.css:972, pol-public.css:629 |
| `.onyx-land-claims dd` |  | app.css:973, pol-public.css:630 |
| `.onyx-land-detail` |  | app.css:975, pol-public.css:644 |
| `.onyx-land-detail a` |  | app.css:976, pol-public.css:645 |
| `.onyx-land-board` |  | app.css:978, pol-public.css:648 |
| `.onyx-land-board-head p` |  | app.css:980, pol-public.css:650 |
| `.onyx-land-tabs` |  | app.css:986, pol-public.css:651 |
| `.onyx-land-tabs button` |  | app.css:992, pol-public.css:662 |
| `.onyx-land-tabs button[aria-selected="true"]` |  | app.css:1002, pol-public.css:677 |
| `.onyx-land-panel` |  | app.css:1007, pol-public.css:678 |
| `.onyx-land-panel-copy` |  | app.css:1016, pol-public.css:689 |
| `.onyx-land-panel-copy p` |  | app.css:1017, pol-public.css:690 |
| `.onyx-land-h3` |  | app.css:1019, pol-public.css:691 |
| `.onyx-land-action` |  | app.css:1025, pol-public.css:692 |
| `.onyx-land-links` |  | app.css:1034, pol-public.css:716 |
| `.onyx-land-links a` |  | app.css:1041, pol-public.css:717 |
| `.onyx-land-footnote` |  | app.css:1043, pol-public.css:739 |
| `.onyx-land-footnote a` |  | app.css:1044, pol-public.css:740 |
| `.onyx-land-shelf` |  | app.css:1046, pol-public.css:742 |
| `.onyx-land-shelf-label` |  | app.css:1048, pol-public.css:751 |
| `.onyx-land-shelf-list` |  | app.css:1055, pol-public.css:752 |
| `.onyx-land-shelf-list a` |  | app.css:1064, pol-public.css:753 |
| `.onyx-toaster` |  | app.css:1066, ui-sheets.css:787 |
| `.onyx-toast` |  | app.css:1080, ui-sheets.css:793 |
| `.onyx-toast--success` |  | app.css:1091, ui-sheets.css:803 |
| `.onyx-toast--danger` |  | app.css:1092, ui-sheets.css:804 |
| `.onyx-toast--warning` |  | app.css:1093, ui-sheets.css:805 |
| `.onyx-toast__dismiss` |  | app.css:1109, ui-sheets.css:806 |
| `.guest-claim-chip` |  | app.css:1119, pol-shell.css:1100 |
| `.onyx-nav-btn--active .onyx-nav-icon` |  | app.css:2188, pol-shell.css:698 |
| `.onyx-you-close` |  | app.css:2234, ui-sheets.css:214 |
| `.onyx-coach-dismiss` |  | app.css:2373, pol-shell.css:1080 |
| `.onyx-composer .shell-command-item--active` |  | app.css:2432, pol-thread.css:1265 |
| `.onyx-composer .shell-emoji-search` |  | app.css:2452, pol-thread.css:1270 |
| `.onyx-roster .onyx-member` |  | app.css:2557, pol-roster.css:185 |
| `.onyx-roster .onyx-member.onyx-away` |  | app.css:2558, pol-roster.css:253 |
| `.onyx-spotlight-close:focus-visible` |  | app.css:2629, ui-sheets.css:238 |
| `.onyx-shortcuts-close:focus-visible` |  | app.css:2629, ui-sheets.css:238 |
| `.onyx-spotlight-foot kbd` |  | app.css:2632, app.css:2834, ui-sheets.css:472 |
| `.onyx-spotlight` |  | app.css:2644, ui-sheets.css:406 |
| `.onyx-spotlight-backdrop` |  | app.css:2654, ui-sheets.css:407 |
| `.onyx-spotlight-panel` |  | app.css:2655, ui-sheets.css:409 |
| `.onyx-spotlight-search` |  | app.css:2679, ui-sheets.css:418 |
| `.onyx-spotlight-sigil` |  | app.css:2686, ui-sheets.css:423 |
| `.onyx-spotlight-input` |  | app.css:2687, ui-sheets.css:431 |
| `.onyx-spotlight-close` |  | app.css:2698, ui-sheets.css:214, ui-sheets.css:433 |
| `.onyx-shortcuts-close` |  | app.css:2698, ui-sheets.css:214 |
| `.onyx-spotlight-results` |  | app.css:2781, ui-sheets.css:435, ui-sheets.css:1021 |
| `.onyx-spotlight-group + .onyx-spotlight-group` |  | app.css:2788, ui-sheets.css:437 |
| `.onyx-spotlight-section` |  | app.css:2789, ui-sheets.css:436 |
| `.onyx-spotlight-option` |  | app.css:2797, ui-sheets.css:439 |
| `.onyx-spotlight-option[aria-selected="true"]` |  | app.css:2808, ui-sheets.css:447 |
| `.onyx-spotlight-icon` |  | app.css:2812, ui-sheets.css:451 |
| `.onyx-spotlight-title mark` |  | app.css:2814, ui-sheets.css:461 |
| `.onyx-spotlight-hint` |  | app.css:2815, ui-sheets.css:462 |
| `.onyx-spotlight-foot` |  | app.css:2827, ui-sheets.css:465 |
| `.onyx-spotlight` | @media (max-width: 767.98px) | app.css:2865, ui-sheets.css:830, ui-sheets.css:1041 |
| `.onyx-spotlight-panel` | @media (max-width: 767.98px) | app.css:2866, ui-sheets.css:831 |
| `.onyx-spotlight-hint` | @media (max-width: 767.98px) | app.css:2867, ui-sheets.css:845 |
| `.onyx-jump-latest-count` |  | app.css:2986, pol-thread.css:593 |
| `.pref-action-card__icon` |  | app.css:3120, ui-sheets.css:939 |
| `.onyx-call-people` |  | app.css:3256, calls-engine.css:21 |
| `.onyx-call-person` |  | app.css:3262, calls-engine.css:22 |
| `.onyx-call-bar` |  | app.css:3291, calls-c8.css:13, calls-engine.css:24 |
| `.onyx-call-bar-left` |  | app.css:3295, calls-engine.css:25 |
| `.onyx-call-bar-right` |  | app.css:3300, calls-engine.css:26 |
| `.onyx-cbtn-leave` |  | app.css:3308, calls-engine.css:29 |
| `.onyx-sec-chip` |  | app.css:3323, calls-engine.css:27 |
| `.onyx-call-bar` | @media (max-width: 640px) | app.css:3398, calls-engine.css:68, calls-engine.css:85 |
| `.onyx-call-bar-center` | @media (max-width: 640px) | app.css:3399, calls-engine.css:75 |
| `.onyx-cbtn` | @media (max-width: 640px) | app.css:3400, calls-engine.css:86 |
| `.onyx-cbtn-leave` | @media (max-width: 640px) | app.css:3402, calls-engine.css:82 |
| `.onyx-call-more` | @media (max-width: 640px) | app.css:3403, calls-engine.css:89 |
| `.onyx-frame` |  | app.css:3425, pol-ios.css:64, pol-ios.css:82 |
| `.onyx-frame > .onyx-primary-nav` |  | app.css:3439, pol-shell.css:668 |
| `.onyx-frame > .onyx-topbar` |  | app.css:3450, pol-shell.css:571 |
| `.onyx-frame > .onyx-rail` |  | app.css:3453, pol-shell.css:720 |
| `.onyx-primary-nav .onyx-nav-btn` |  | app.css:3494, pol-shell.css:674 |
| `.notif-center__head` |  | app.css:3616, pol-shell.css:47 |
| `.notif-center__filters` |  | app.css:3618, pol-shell.css:59 |
| `.notif-center__list` |  | app.css:3619, pol-shell.css:88 |
| `.onyx-room-header` |  | app.css:3637, roomsettings.css:9 |
| `.onyx-room-more-menu > button` |  | app.css:3699, pol-shell.css:976 |
| `.onyx-sheet-layer` |  | app.css:3721, ui-sheets.css:57 |
| `.onyx-sheet-layer[data-placement="side"]` |  | app.css:3731, ui-sheets.css:113 |
| `.onyx-sheet-backdrop` |  | app.css:3736, ui-sheets.css:59 |
| `.onyx-sheet-layer > .onyx-sheet` |  | app.css:3761, ui-sheets.css:64 |
| `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` |  | app.css:3768, ui-sheets.css:115 |
| `.onyx-sheet-close` |  | app.css:3801, ui-sheets.css:214 |
| `.onyx-frame > .onyx-rail` | @media (max-width: 767.98px) | app.css:3869, pol-shell.css:1310 |
| `.onyx-frame > .onyx-mobile-nav` | @media (max-width: 767.98px) | app.css:3874, pol-shell.css:1408, pol-ios.css:91 |
| `.onyx-mobile-nav .onyx-nav-btn` | @media (max-width: 767.98px) | app.css:3885, pol-shell.css:1413 |
| `.onyx-sheet-layer` | @media (max-width: 767.98px) | app.css:3896, ui-sheets.css:296, ui-sheets.css:1041 |
| `.onyx-sheet-layer > .onyx-sheet` | @media (max-width: 767.98px) | app.css:3902, ui-sheets.css:302, ui-sheets.css:1043 |
| `.notif-center .notif-center__filter[aria-pressed="true"]` |  | pol-shell.css:76, ui-sheets.css:506 |
| `.notif-center .notif-center__open` |  | pol-shell.css:101, ui-sheets.css:524 |
| `.notif-center .notif-center__dismiss` |  | pol-shell.css:161, ui-sheets.css:526 |
| `.chb .chb-sort-btn[aria-pressed="true"]` |  | pol-shell.css:304, ui-sheets.css:738 |
| `.onyx-profile-pop:not(.onyx-sheet-layer)` |  | pol-shell.css:411, ui-sheets.css:1057 |
| `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` |  | pol-shell.css:424, ui-sheets.css:1059 |
| `:root` | @media (max-width: 767.98px) | pol-thread.css:1891, ui-sheets.css:290, ui-sheets.css:1036 |
| `.onyx-tile` | @media (prefers-reduced-motion | calls-c11.css:170, calls-c4.css:144 |
| `.onyx-tile-video` | @media (prefers-reduced-motion | calls-c11.css:170, calls-c4.css:144 |
| `.onyx-call-pip-card` | @media (prefers-reduced-motion | calls-c11.css:170, calls-c6.css:273 |

### G13.3 Same-file duplicates

| selector | context | occurrences | conflicting props |
|---|---|---|---|
| `.topic-chip__unread` |  | app.css:196, app.css:3838 | background, color |
| `.onyx-topbar` |  | app.css:222, app.css:3532 | gap, padding |
| `.onyx-gem` |  | app.css:240, app.css:3833 | background |
| `.onyx-conn-live` |  | app.css:282, app.css:3834 | color |
| `.onyx-conn-live .onyx-dot` |  | app.css:283, app.css:3835 | background |
| `.onyx-reconnect-online` |  | app.css:323, app.css:3836 | color |
| `.onyx-reconnect-online .onyx-reconnect-dot` |  | app.css:324, app.css:3837 | background |
| `.onyx-rail` |  | app.css:405, app.css:411 |  |
| `.onyx-roster` |  | app.css:405, app.css:412 |  |
| `.onyx-thread` |  | app.css:425, app.css:668 |  |
| `.onyx-newmsg-mark` |  | app.css:612, app.css:3852 | color |
| `.onyx-newmsg-secondary` |  | app.css:647, app.css:654 |  |
| `.onyx-newmsg-primary` |  | app.css:647, app.css:655 |  |
| `.onyx-thread-pane` |  | app.css:660, app.css:2961 |  |
| `.onyx-message` |  | app.css:670, app.css:1586 |  |
| `.onyx-member-prefix` |  | app.css:734, app.css:3839 | color |
| `.onyx-composer-target` |  | app.css:751, app.css:3841 | color |
| `.onyx-calls-toggle-open` |  | app.css:804, app.css:3574 | border-color, color |
| `.onyx-account-totp-enroll` |  | app.css:1431, app.css:1471 |  |
| `.onyx-account-passkey-rename` |  | app.css:1431, app.css:1500 |  |
| `.onyx-msg-menu` |  | app.css:1603, app.css:1840 |  |
| `.onyx-member-identity` |  | app.css:1742, app.css:2572 |  |
| `.onyx-member-pronouns` |  | app.css:1756, app.css:1757 |  |
| `.onyx-member-status` |  | app.css:1756, app.css:1757 |  |
| `.onyx-member-guest` |  | app.css:1756, app.css:1758 |  |
| `.onyx-member-dot` |  | app.css:1760, app.css:3840 | background |
| `.onyx-msg-menu-delete-confirm-cancel` |  | app.css:1830, app.css:1837 |  |
| `.onyx-msg-menu-delete-confirm-delete` |  | app.css:1830, app.css:1838 |  |
| `.conn-cancel` |  | app.css:2003, app.css:2012 | padding |
| `.conn-alt-btn` |  | app.css:2003, app.css:2016 | background, padding |
| `.onyx-leave` |  | app.css:2003, app.css:2055 | padding |
| `.onyx-notify-toggle-open` |  | app.css:2091, app.css:3574 | border-color, color |
| `.onyx-home-privacy` |  | app.css:2299, app.css:2300 | color, font-size |
| `.onyx-home-announce` |  | app.css:2302, app.css:3843 | color |
| `.onyx-home-row-meta` |  | app.css:2336, app.css:3845 | color |
| `.onyx-home-count` |  | app.css:2347, app.css:3843 | color |
| `.onyx-coach` |  | app.css:2367, app.css:3847 |  |
| `.onyx-coach-eyebrow` |  | app.css:2371, app.css:3845 | color |
| `.shell-command-menu` |  | app.css:2402, app.css:2410 |  |
| `.shell-emoji-picker` |  | app.css:2402, app.css:2443 |  |
| `.onyx-composer .shell-composer-tool--emoji[aria-expanded="true"]` |  | app.css:2482, app.css:3849 | border-color |
| `.boost-pill.you` |  | app.css:2492, app.css:3848 | border-color |
| `.onyx-shortcuts-sheet` |  | app.css:2655, app.css:2836 |  |
| `.onyx-dmsafe-trigger[aria-expanded="true"]` |  | app.css:2712, app.css:3849 | border-color |
| `.onyx-keychange-kicker` |  | app.css:2753, app.css:3026 | color |
| `.onyx-moddesk-toggle[aria-pressed="true"]` |  | app.css:2877, app.css:3849 | border-color |
| `.onyx-moddesk-sheet .moderation-cockpit__modes` |  | app.css:2931, app.css:2933 |  |
| `.onyx-keychange-accept` |  | app.css:3039, app.css:3047 |  |
| `.onyx-keychange-dismiss` |  | app.css:3039, app.css:3049 |  |
| `:root[data-reduce-motion='true'] *` |  | app.css:3135, app.css:3940 |  |
| `:root[data-reduce-motion='true'] *::before` |  | app.css:3135, app.css:3940 |  |
| `:root[data-reduce-motion='true'] *::after` |  | app.css:3135, app.css:3940 |  |
| `.onyx-join-banner` | @media (max-width: 640px) | app.css:3388, app.css:3392 |  |
| `.status-quiet-link` |  | pol-stats.css:205, pol-stats.css:247 |  |
| `.status-hero` | @media (max-width: 767px) | pol-stats.css:993, pol-stats.css:996 |  |
| `.roadmap-hero` | @media (max-width: 767px) | pol-stats.css:993, pol-stats.css:997 |  |
| `.stats-page .data-hero.stats-hero` | @media (max-width: 767px) | pol-stats.css:993, pol-stats.css:998 |  |
| `.status-quiet-link` | @media (max-width: 767px) | pol-stats.css:1001, pol-stats.css:1004 |  |
| `.stats-page .stats-feed-step:last-child` | @media (max-width: 767px) | pol-stats.css:1016, pol-stats.css:1019 | border-bottom |
| `.stats-page .stats-inspector-metrics > div` | @media (max-width: 400px) | pol-stats.css:1042, pol-stats.css:1044 | padding-inline |
| `.ap-studio` |  | pol-studio.css:407, pol-studio.css:475 |  |
| `.background-picker__meta` |  | pol-studio.css:569, pol-studio.css:576 | color |
| `.ts-pv-side` |  | pol-studio.css:1267, pol-studio.css:1277 |  |
| `.ts-pv-members` |  | pol-studio.css:1267, pol-studio.css:1278 |  |
| `.ts-pv-members__head` |  | pol-studio.css:1293, pol-studio.css:1303 |  |
| `.ts-footer__right` |  | pol-studio.css:1640, pol-studio.css:1649 |  |
| `.ts-editor` | @media (max-width: 768px) | pol-studio.css:1681, pol-studio.css:1692 |  |
| `.onyx-account-persona-wear` |  | pol-shell.css:231, pol-shell.css:251 |  |
| `.onyx-calls-leave` |  | pol-shell.css:311, pol-shell.css:329 | color, background |
| `.onyx-room-settings-toggle` |  | pol-shell.css:380, pol-shell.css:558 |  |
| `.onyx-pins-toggle` |  | pol-shell.css:380, pol-shell.css:559 |  |
| `.onyx-media-toggle` |  | pol-shell.css:380, pol-shell.css:560 |  |
| `.onyx-jump-toggle` |  | pol-shell.css:380, pol-shell.css:561 |  |
| `.onyx-scrubber-toggle` |  | pol-shell.css:380, pol-shell.css:562 |  |
| `.onyx-topbar .onyx-palette-launcher::before` |  | pol-shell.css:542, pol-shell.css:597 | width, height |
| `.onyx-room-more-alerts .room-notify-name::before` |  | pol-shell.css:542, pol-shell.css:1004 |  |
| `.onyx-topbar .onyx-palette-launcher` |  | pol-shell.css:554, pol-shell.css:586 |  |
| `.onyx-room-more-alerts .room-notify-name` |  | pol-shell.css:555, pol-shell.css:995 |  |
| `.onyx-rail .onyx-rail-label` |  | pol-shell.css:771, pol-shell.css:774 |  |
| `.onyx-rail .onyx-rail-label` | @media (max-width: 767.98px) | pol-shell.css:1329, pol-shell.css:1331 |  |
| `.onyx-rail-row .onyx-rail-sub` | @media (max-width: 767.98px) | pol-shell.css:1379, pol-shell.css:1381 | display |
| `.onyx-edited` |  | pol-thread.css:159, pol-thread.css:166 |  |
| `.onyx-react-pop .onyx-react-picker` |  | pol-thread.css:261, pol-thread.css:271, pol-thread.css:309 |  |
| `.onyx-msg-menu-pop .onyx-msg-menu` |  | pol-thread.css:271, pol-thread.css:279 |  |
| `.onyx-msg-menu .onyx-msg-menu-item[aria-label$="for everyone"]` |  | pol-thread.css:300, pol-thread.css:302 |  |
| `.onyx-room-intro-face` |  | pol-thread.css:603, pol-thread.css:615 | background, border |
| `.shell-msg-media-img` |  | pol-thread.css:683, pol-thread.css:694 |  |
| `.shell-msg-media-video` |  | pol-thread.css:683, pol-thread.css:695 |  |
| `.shell-msg-media-audio` |  | pol-thread.css:683, pol-thread.css:696 |  |
| `.shell-msg-preview-title` |  | pol-thread.css:774, pol-thread.css:781 |  |
| `.shell-msg-preview-desc` |  | pol-thread.css:774, pol-thread.css:783 |  |
| `.shell-msg-preview-thumb` |  | pol-thread.css:784, pol-thread.css:793 |  |
| `.shell-msg-preview-consent` |  | pol-thread.css:784, pol-thread.css:794 |  |
| `.shell-msg-lightbox-close` |  | pol-thread.css:844, pol-thread.css:861 | padding, font-size, font-weight |
| `.onyx-composer .shell-command-menu` |  | pol-thread.css:1250, pol-thread.css:1252 |  |
| `.onyx-composer .shell-emoji-picker` |  | pol-thread.css:1250, pol-thread.css:1269 |  |
| `.onyx-composer .shell-command-menu` | @media (max-width: 767.98px) | pol-thread.css:1298, pol-thread.css:1305 |  |
| `.onyx-message-search__surface` |  | pol-thread.css:1324, pol-thread.css:1327 |  |
| `.onyx-message-search__body` |  | pol-thread.css:1324, pol-thread.css:1394 |  |
| `.onyx-message-search__saved` |  | pol-thread.css:1420, pol-thread.css:1431 |  |
| `.onyx-message-search__recall` |  | pol-thread.css:1420, pol-thread.css:1473 |  |
| `.onyx-message-search__server` |  | pol-thread.css:1420, pol-thread.css:1431 |  |
| `.onyx-message-search__vault` |  | pol-thread.css:1420, pol-thread.css:1431 |  |
| `.onyx-message-search__history-off` |  | pol-thread.css:1420, pol-thread.css:1434 |  |
| `.onyx-message-search__vault-mode` |  | pol-thread.css:1451, pol-thread.css:1467 |  |
| `.onyx-message-search__saved-run` |  | pol-thread.css:1524, pol-thread.css:1542 |  |
| `.onyx-message-search__server-row` |  | pol-thread.css:1524, pol-thread.css:1543 |  |
| `.pins-ledger` |  | pol-thread.css:1807, pol-thread.css:1814 |  |
| `.pins-item-body--missing` |  | pol-thread.css:1865, pol-thread.css:1868 |  |
| `.pins-item-body--deleted` |  | pol-thread.css:1865, pol-thread.css:1868 |  |
| `.onyx-mlist-close` |  | pol-roster.css:67, pol-roster.css:85 | display |
| `.onyx-roster-group:not([open]) > .onyx-mlist-group-head > .pt-ico` |  | pol-roster.css:176, pol-roster.css:179 |  |
| `.onyx-mlist-main:focus-visible` |  | pol-roster.css:212, pol-roster.css:217 |  |
| `.onyx-roster:popover-open .onyx-mlist-main` | @media (max-width: 767.98px) | pol-roster.css:399, pol-roster.css:401 |  |
| `.not-found-page__action` |  | pol-public.css:407, pol-public.css:437, pol-public.css:1622 | color, background |
| `.guides-copy` |  | pol-public.css:407, pol-public.css:1247 | min-height, padding |
| `.guides-download` |  | pol-public.css:407, pol-public.css:1247 | min-height, padding |
| `.guides-reset` |  | pol-public.css:407, pol-public.css:1247, pol-public.css:1255 | min-height, padding, color |
| `.pub-refresh` |  | pol-public.css:456, pol-public.css:467 |  |
| `.onyx-land-sketch-log` | @media (max-width: 600px) | pol-public.css:784, pol-public.css:786 |  |
| `.onyxos-source` |  | pol-public.css:1448, pol-public.css:1511 |  |
| `.onyxos-workbench` |  | pol-public.css:1448, pol-public.css:1541 |  |
| `.onyxos-source` | @media (max-width: 768px) | pol-public.css:1562, pol-public.css:1572 |  |
| `.onyxos-workbench` | @media (max-width: 768px) | pol-public.css:1562, pol-public.css:1572 |  |
| `.onyx-call-react-item:focus-visible` |  | calls-c8.css:34, calls-c8.css:35 |  |
| `.onyx-call-caption-translate` |  | calls-c8.css:71, calls-c8.css:85 | margin-left |
| `.polish-primary` |  | polish.css:292, polish.css:303 |  |
| `.polish-ghost` |  | polish.css:292, polish.css:312 |  |
| `.update-available button` |  | polish.css:292, polish.css:303 |  |
| `.a2-textarea` |  | account2.css:20, account2.css:34 | font-size |
| `.a2-link` |  | account2.css:40, account2.css:53 | color |
| `.a2-reclaim__signin` |  | account2.css:104, account2.css:117 | background, color |
| `.a2-reclaim__dismiss` |  | account2.css:104, account2.css:118 | color |
| `.rset-group-mark` |  | roomsettings.css:90, roomsettings.css:112 |  |
| `.rset-textarea` |  | roomsettings.css:170, roomsettings.css:185 |  |
| `.onyx-tile-top` |  | calls-c4.css:95, calls-c4.css:99 |  |
| `.onyx-tile-bottom` |  | calls-c4.css:95, calls-c4.css:100 |  |
| `.onyx-tile-nick` |  | calls-c4.css:102, calls-c4.css:111 | font-size |
| `.onyx-sheet-layer[data-placement] > .onyx-sheet` | @media (max-width: 767.98px) | ui-sheets.css:302, ui-sheets.css:1043 | padding-bottom |
| `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet` | @media (max-width: 767.98px) | ui-sheets.css:315, ui-sheets.css:365 |  |
| `.onyx-you .onyx-you-group__title` |  | ui-sheets.css:610, ui-sheets.css:611 |  |
| `.onyx-prefs .pref-category-content` |  | ui-sheets.css:676, ui-sheets.css:1021 |  |
| `.onyx-toaster` | @media (max-width: 767.98px) | ui-sheets.css:809, ui-sheets.css:1049 | bottom |
| `.onyx-room-more-menu` | @media (max-width: 767.98px) | ui-sheets.css:960, ui-sheets.css:1047 | bottom |
| `.onyx-sec-chip` | @media (max-width: 640px) | calls-engine.css:64, calls-engine.css:83 | width |

## G14. Classes painted by more than one file

360 classes are the key (rightmost) element of rules in two or more files (rule count in parentheses; every rule location is in style-map.json `multiFileClasses`).

| files | classes |
|---|---|
| app.css + ui-sheets.css | `.onyx-sheet-close` (10) `.onyx-you-link` (9) `.onyx-spotlight-close` (7) `.onyx-prefs` (7) `.pref-category-tab` (7) `.onyx-sheet-backdrop` (7) `.onyx-spotlight-panel` (6) `.onyx-shortcuts-sheet` (6) `.onyx-spotlight-option` (6) `.onyx-account-nav__item` (5) `.onyx-you-close` (5) `.onyx-shortcuts-close` (5) `.onyx-spotlight` (5) `.onyx-spotlight-input` (5) `.onyx-spotlight-icon` (5) `.onyx-spotlight-hint` (5) `.onyx-toaster` (4) `.chb-skin` (4) `.onyx-account-nav` (4) `.onyx-member-action` (4) `.onyx-you-leave` (4) `.onyx-member-action--primary` (4) `.onyx-spotlight-results` (4) `.onyx-prefs-body` (4) `.pref-category-nav` (4) `.pref-category-tabs` (4) `.pref-category-content` (4) `.onyx-toast__dismiss` (3) `.chb-filter` (3) `.chb-sort` (3) `.chb-topic` (3) `.onyx-account-section` (3) `.onyx-member-identity` (3) `.onyx-member-pronouns` (3) `.onyx-you` (3) `.onyx-you-group__title` (3) `.jump-to-date-close` (3) `.onyx-spotlight-backdrop` (3) `.onyx-spotlight-search` (3) `.onyx-spotlight-foot` (3) `.onyx-moddesk-sheet` (3) `.onyx-moddesk-head` (3) `.pref-category-tab__summary` (3) `.onyx-reclaim-lead` (2) `.onyx-newmsg-sheet` (2) `.onyx-newmsg-actions` (2) `.onyx-toast` (2) `.onyx-toast--success` (2) `.onyx-toast--danger` (2) `.onyx-toast--warning` (2) `.guest-claim-sheet__form` (2) `.chb-toolbar` (2) `.chb-status` (2) `.chb-list` (2) `.chb-name` (2) `.chb-pill` (2) `.chb-count` (2) `.chb-count--live` (2) `.chb-ledger` (2) `.chb-join` (2) `.chb-create` (2) `.chb-skins` (2) `.chb-check` (2) `.chb-create-actions` (2) `.onyx-scheduled-empty` (2) `.onyx-account` (2) `.onyx-profile-nick` (2) `.onyx-profile-account` (2) `.onyx-member-name` (2) `.onyx-member-nickline` (2) `.onyx-member-actions` (2) `.onyx-you-identity` (2) `.onyx-you-title` (2) `.onyx-you-nick` (2) `.onyx-you-desc` (2) `.onyx-you-lede` (2) `.onyx-you-group` (2) `.onyx-you-group__hint` (2) `.onyx-you-leave-row` (2) `.jump-to-date-head` (2) `.jump-to-date-title` (2) `.onyx-spotlight-sigil` (2) `.onyx-spotlight-group` (2) `.onyx-spotlight-section` (2) `.onyx-spotlight-title` (2) `.shortcuts-overlay` (2) `.shortcuts-overlay__row` (2) `.onyx-moddesk-room` (2) `.onyx-invshare-preview` (2) `.onyx-invshare-url` (2) `.pref-category-tab__label` (2) `.pref-action-card__icon` (2) `.notif-center` (2) `.onyx-sheet-title` (2) |
| app.css + pol-shell.css | `.onyx-rail-item` (10) `.onyx-nav-icon` (10) `.onyx-palette-launcher` (10) `.onyx-rail-star` (9) `.onyx-nav-btn` (9) `.onyx-rail-label` (8) `.onyx-rail-sub` (8) `.onyx-topbar` (7) `.onyx-rail` (7) `.onyx-rail-name` (7) `.onyx-rail-filter-input` (6) `.onyx-rail-new` (6) `.onyx-rail-time` (6) `.onyx-moddesk-toggle` (6) `.onyx-main` (6) `.onyx-rail-active` (5) `.onyx-rail-browse` (5) `.room-notify-name` (5) `.room-notify-seg` (5) `.onyx-dmsafe-trigger` (5) `.shell-ribbon-bell` (5) `.onyx-brand` (4) `.onyx-gem` (4) `.onyx-conn-live` (4) `.onyx-rail-section-heading` (4) `.onyx-rail-copy` (4) `.onyx-rail-unread` (4) `.guest-claim-chip__keep` (4) `.guest-claim-chip__dismiss` (4) `.onyx-primary-nav` (4) `.onyx-nav-btn--active` (4) `.onyx-home-inner` (4) `.onyx-home-empty` (4) `.onyx-home-action` (4) `.onyx-coach-dismiss` (4) `.onyx-coach` (4) `.onyx-coach-eyebrow` (4) `.onyx-palette-kbd` (4) `.onyx-room-header-btn` (4) `.onyx-conn` (3) `.onyx-rail-filter` (3) `.onyx-rail-filter-unread` (3) `.onyx-rail-filter-clear` (3) `.onyx-rail-section` (3) `.onyx-rail-empty` (3) `.onyx-rail-color` (3) `.onyx-rail-star-on` (3) `.guest-claim-chip` (3) `.onyx-nav-btn--dialog-open` (3) `.onyx-home-empty-copy` (3) `.onyx-header-voice` (3) `.onyx-voice-chip` (3) `.onyx-voice-chip-status` (3) `.onyx-call-join` (3) `.onyx-topbar-search` (3) `.onyx-topbar-global` (3) `.onyx-room-more-toggle` (3) `.shell-ribbon-badge` (3) `.onyx-room-header-id` (3) `.onyx-room-header-name` (3) `.onyx-room-header-topic` (3) `.onyx-room-header-actions` (3) `.onyx-conn-connecting` (2) `.onyx-rail-filter-unread-on` (2) `.onyx-rail-filter-empty` (2) `.onyx-rail-row` (2) `.onyx-rail-meta` (2) `.onyx-rail-mention` (2) `.onyx-rail-keywarn` (2) `.guest-claim-chip__text` (2) `.guest-claim-chip__actions` (2) `.chb-close` (2) `.onyx-account-hint` (2) `.onyx-account-actions` (2) `.onyx-profile-badge` (2) `.onyx-home-masthead` (2) `.onyx-home-title` (2) `.onyx-home-inbox` (2) `.onyx-home-invite` (2) `.onyx-home-rooms` (2) `.onyx-home-actions` (2) `.onyx-coach-text` (2) `.onyx-dmsafe-bar` (2) `.onyx-dmsafe-chip` (2) `.pref-action-card` (2) `.onyx-call-join-label` (2) `.onyx-search-toggle-open` (2) `.shell-ribbon-inbox` (2) `.notif-center__head` (2) |
| app.css + pol-thread.css | `.onyx-message` (13) `.onyx-msg-menu-trigger` (9) `.onyx-msg-menu-item` (9) `.onyx-msg-menu` (7) `.onyx-react-picker` (7) `.shell-command-menu` (7) `.onyx-react-choice` (6) `.boost-pill` (6) `.boost-add` (6) `.onyx-ts` (6) `.onyx-audience-toggle` (5) `.onyx-body` (5) `.shell-emoji-picker` (5) `.shell-emoji-choice` (5) `.onyx-day-divider` (4) `.topic-chip` (4) `.shell-command-item` (4) `.shell-composer-tool--emoji` (4) `.onyx-jump-latest` (4) `.onyx-system` (3) `.onyx-thread-indicator` (3) `.onyx-topic-tools` (3) `.onyx-topic` (3) `.onyx-sender` (3) `.onyx-composer-target` (3) `.onyx-react-search` (3) `.onyx-react-grid` (3) `.shell-composer-popovers` (3) `.shell-command-usage` (3) `.shell-emoji-search` (3) `.shell-emoji-grid` (3) `.you` (3) `.boost-count` (3) `.onyx-jump-latest--unread` (3) `.onyx-day-divider-label` (2) `.onyx-thread-sheet` (2) `.onyx-thread-head` (2) `.onyx-thread-title` (2) `.onyx-thread-desc` (2) `.onyx-thread-msg` (2) `.onyx-thread-msg-from` (2) `.onyx-thread-msg-text` (2) `.onyx-thread-state` (2) `.onyx-audience-toggle-set` (2) `.onyx-composer-error` (2) `.onyx-msg-menu-delete-confirm` (2) `.onyx-msg-menu-backdrop` (2) `.onyx-feed-empty` (2) `.onyx-feed-empty-title` (2) `.onyx-feed-empty-body` (2) `.shell-command-item--active` (2) `.shell-command-desc` (2) `.boost-bar` (2) `.boost-emoji` (2) `.onyx-jump-latest-count` (2) |
| app.css + pol-public.css | `.onyx-land-open` (5) `.onyx-land-link` (5) `.onyx-land-claims` (4) `.onyx-land-panel` (4) `.onyx-land-action` (4) `.onyx-land-h1` (3) `.onyx-land-lede` (3) `.onyx-land-cta` (3) `.onyx-land-note` (3) `.onyx-land-trust` (3) `.onyx-land-board` (3) `.onyx-land-tabs` (3) `.onyx-landing` (2) `.onyx-land-h2` (2) `.onyx-land-detail` (2) `.onyx-land-panel-copy` (2) `.onyx-land-h3` (2) `.onyx-land-panel-note` (2) `.onyx-land-links` (2) `.onyx-land-footnote` (2) `.onyx-land-shelf` (2) `.onyx-land-shelf-label` (2) `.onyx-land-shelf-list` (2) |
| app.css + pol-roster.css | `.onyx-roster-filter-input` (9) `.onyx-member-message` (7) `.onyx-member` (6) `.onyx-member-presence-dot` (5) `.onyx-roster-filter` (4) `.onyx-away` (3) `.onyx-roster-care` (3) `.onyx-roster-head` (3) `.onyx-roster-count` (3) `.onyx-member-presence-dot--away` (3) `.onyx-avatar--sm` (2) `.onyx-roster-empty` (2) `.onyx-member-role` (2) |
| pol-shell.css + ui-sheets.css | `.notif-center__dismiss` (7) `.notif-center__filter` (6) `.notif-center__row` (6) `.notif-center__glyph` (5) `.notif-center__open` (4) `.notif-center__close` (3) `.notif-center__empty` (3) `.onyx-profile-pop` (3) `.shell-ribbon-bell-icon` (3) `.pref-reset-all` (2) `.onyx-profile-summary` (2) `.onyx-profile-backdrop` (2) |
| pol-stats.css + pol-public.css | `.r-btn` (16) `.primary` (6) `.label` (6) `.data-hero` (5) `.data-card` (4) `.r-wrap` (3) `.r-kicker` (3) `.ui-root` (2) `.r` (2) `.r-section` (2) `.sub` (2) |
| app.css + calls-engine.css | `.onyx-sec-chip` (8) `.onyx-cbtn-leave` (7) `.onyx-call-bar-center` (5) `.onyx-call-bar-right` (5) `.onyx-call-more` (5) `.onyx-call-person` (4) `.onyx-call-bar-left` (4) `.onyx-call-more-wrap` (3) `.onyx-call-where` (2) |
| app.css + pol-shell.css + ui-sheets.css | `.chb-card` (7) `.onyx-room-more-menu` (6) `.chb-sort-btn` (5) `.onyx-member-card` (5) `.onyx-you-head` (5) `.notif-center__filters` (4) `.notif-center__list` (3) `.onyx-room-more-scrim` (3) |
| app.css + pol-shell.css + roomsettings.css | `.onyx-facepile` (5) `.onyx-room-header` (4) `.room-notify` (3) `.onyx-convohead` (3) `.onyx-dmsafe` (3) |
| pol-shell.css + roomsettings.css | `.onyx-room-topic-toggle` (4) `.onyx-room-header-sub` (4) `.onyx-room-privacy` (3) `.onyx-room-header-topic-open` (2) |
| app.css + calls-c4.css | `.onyx-call-avatar-lg` (3) `.onyx-cbtn-cap` (3) `.onyx-call-you` (2) |
| account2.css + ui-sheets.css | `.a2-body` (2) `.a2-section` (2) `.a2-status` (2) |
| app.css + pol-shell.css + pol-ios.css | `.onyx-frame` (8) `.onyx-mobile-nav` (7) |
| app.css + calls-c4.css + calls-engine.css | `.onyx-call-stage` (7) `.onyx-call-more-item` (5) |
| calls-c11.css + calls-c4.css | `.onyx-tile` (13) `.onyx-tile-video` (6) |
| pol-shell.css + pol-thread.css | `.shell-composer-tool` (6) `.shell-composer-action-label` (3) |
| pol-thread.css + polish.css | `.shell-composer-tool--more` (6) `.shell-composer-more-wrap` (3) |
| app.css + pol-shell.css + calls-c8.css + calls-c11.css + roomsettings.css + calls-c6.css + calls-c4.css | `.onyx-ci` (40) |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css + calls-engine.css | `.onyx-cbtn` (17) |
| app.css + calls-c11.css + calls-c6.css + ui-sheets.css | `.onyx-sheet` (26) |
| app.css + calls-c6.css + ui-sheets.css + pol-ios.css | `.onyx-sheet-layer` (16) |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css | `.onyx-call-btn` (13) |
| app.css + calls-c8.css + calls-c4.css + calls-engine.css | `.onyx-call-bar` (11) |
| app.css + pol-shell.css + pol-thread.css + pol-ios.css | `.onyx-composer` (8) |
| app.css + pol-shell.css + pol-thread.css + pol-roster.css | `.onyx-avatar` (7) |
| pol-shell.css + pol-thread.css + pol-roster.css | `.pt-ico` (61) |
| app.css + pol-shell.css + pol-roster.css | `.onyx-roster` (15) |
| app.css + calls-c11.css + calls-c6.css | `.onyx-call-ring` (12) |
| app.css + calls-c6.css + calls-engine.css | `.onyx-call-people` (7) |
| app.css + pol-shell.css + account2.css | `.onyx-rail-avatar` (5) |
| app.css + roomsettings.css + ui-sheets.css | `.onyx-sheet-head` (5) |
| calls-c11.css + calls-c6.css | `.onyx-call-pip-card` (11) |
| calls-c4.css + calls-engine.css | `.onyx-call-video` (6) |
| app.css + calls-c11.css | `.onyx-call-sheet` (5) |
| pol-shell.css + pol-roster.css | `.onyx-members-toggle` (5) |
| app.css + calls-c6.css | `.onyx-call-avatar` (4) |
| pol-studio.css + pol-shell.css | `.on` (3) |
| polish.css + pol-ios.css | `.a2hs-sheet` (2) |

### G14.1 Cross-file property fights (538): one class, same state, same context, same property, different values in different files

Full selectors for every value are in style-map.json `fights`. 364 fights are won by a later file raising specificity (marked ↑); 40 would change winner if the files were wrapped in @layer in link order (marked **flip**: an earlier file out-specifies a later one). Each value is `file:line(specificity abc) value`, in cascade order.

| class | state | context | property: values in cascade order |
|---|---|---|---|
| `.a2-body` | `(base)` |  | **padding** ↑: account2.css:6(010) `var(--pad-panel)` → ui-sheets.css:731(020) `0` |
| `.a2-status` | `(base)` |  | **margin-top** ↑: account2.css:123(010) `var(--space-3)` → ui-sheets.css:606(020) `var(--space-4)` |
| `.boost-count` | `(base)` |  | **color** ↑: app.css:2494(010) `var(--onyx-dim)` → pol-thread.css:407(020) `var(--onyx-dim)` → pol-thread.css:413(040) `var(--onyx-text)` |
| `.boost-pill` | `(base)` |  | **background** ↑: app.css:2489(010) `var(--onyx-panel-2)` → pol-thread.css:400(030) `var(--onyx-panel)`<br>**font-size** ↑: app.css:2488(010) `var(--text-2xs)` → pol-thread.css:403(030) `var(--text-sm)`<br>**gap** ↑: app.css:2487(010) `var(--space-1)` → pol-thread.css:399(030) `6px`<br>**padding** ↑: app.css:2490(010) `2px var(--space-2)` → pol-thread.css:398(030) `0 var(--space-2)` |
| `.boost-pill` | `.you` |  | **border-color** ↑: app.css:2492(020) `var(--onyx-accent)` → app.css:3848(020) `var(--onyx-dim)` → pol-thread.css:411(030) `color-mix(in oklab, var(` |
| `.chb-card` | `(base)` |  | **background** ↑: pol-shell.css:288(020) `var(--onyx-panel-2)` → ui-sheets.css:742(020) `transparent` → ui-sheets.css:743(030) `color-mix(in oklab, var(`<br>**border** ↑: app.css:1221(010) `1px solid var(--onyx-lin` → ui-sheets.css:742(020) `0`<br>**border-color** ↑: pol-shell.css:289(020) `var(--onyx-dim)` → ui-sheets.css:744(030) `var(--onyx-line)`<br>**border-radius** ↑: app.css:1221(010) `8px` → ui-sheets.css:742(020) `0`<br>**padding** ↑: app.css:1221(010) `8px 10px` → ui-sheets.css:742(020) `var(--space-3) var(--spa` |
| `.chb-check` | `(base)` |  | **align-items** ↑: app.css:1249(010) `baseline` → ui-sheets.css:756(020) `center` |
| `.chb-close` | `(base)` |  | **border** ↑: app.css:1207(010) `none` → pol-shell.css:303(020) `0` |
| `.chb-count--live` | `(base)` |  | **color** ↑: app.css:1227(010) `var(--onyx-accent)` → ui-sheets.css:747(020) `var(--onyx-text)` |
| `.chb-create` | `(base)` |  | **gap** ↑: app.css:1235(010) `12px` → ui-sheets.css:752(020) `var(--space-4)` |
| `.chb-ledger` | `(base)` |  | **color** ↑: app.css:1232(010) `var(--onyx-accent)` → ui-sheets.css:750(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:1232(010) `12px` → ui-sheets.css:750(020) `var(--text-sm)` |
| `.chb-list` | `(base)` |  | **gap** ↑: app.css:1219(010) `8px` → ui-sheets.css:740(020) `0` |
| `.chb-pill` | `(base)` |  | **color** ↑: app.css:1225(010) `var(--onyx-accent)` → ui-sheets.css:748(020) `var(--onyx-dim)` |
| `.chb-skin` | `[aria-pressed=""]` |  | **border-color** ↑: app.css:1246(020) `var(--onyx-accent)` → ui-sheets.css:755(030) `var(--onyx-text)` |
| `.chb-skins` | `(base)` |  | **padding** ↑: app.css:1243(010) `8px 10px` → ui-sheets.css:753(020) `var(--space-3)` |
| `.chb-sort` | `(base)` |  | **gap** ↑: app.css:1211(010) `4px` → ui-sheets.css:736(020) `2px` |
| `.chb-sort-btn` | `[aria-pressed=""]` |  | **border-color** ↑: app.css:1212(020) `var(--onyx-accent)` → pol-shell.css:304(030) `var(--onyx-dim)` → ui-sheets.css:738(030) `transparent`<br>**color** ↑: app.css:1212(020) `var(--onyx-accent)` → pol-shell.css:304(030) `var(--onyx-text)` → ui-sheets.css:738(030) `var(--onyx-text)` |
| `.chb-toolbar` | `(base)` |  | **gap** ↑: app.css:1209(010) `8px` → ui-sheets.css:734(020) `var(--space-2)`<br>**margin** ↑: app.css:1209(010) `12px 0` → ui-sheets.css:734(020) `0 0 var(--space-3)` |
| `.chb-topic` | `(base)` |  | **margin** ↑: app.css:1229(010) `4px 0` → ui-sheets.css:749(020) `2px 0 var(--space-2)` |
| `.data-card` | `(base)` |  | **background** **flip**: pol-stats.css:640(020) `var(--pg-panel)` → pol-public.css:403(010) `var(--onyx-panel)`<br>**border** **flip**: pol-stats.css:638(020) `1px solid var(--pg-line)` → pol-public.css:401(010) `1px solid var(--onyx-lin`<br>**padding** **flip**: pol-stats.css:637(020) `var(--space-5)` → pol-public.css:400(010) `var(--space-6)` |
| `.guest-claim-chip` | `(base)` |  | **border-radius**: app.css:1124(010) `8px` → pol-shell.css:1107(010) `var(--radius)`<br>**gap**: app.css:1122(010) `8px` → pol-shell.css:1103(010) `var(--space-3)`<br>**padding**: app.css:1125(010) `6px 10px` → pol-shell.css:1104(010) `var(--space-3)` |
| `.guest-claim-chip__actions` | `(base)` |  | **gap** ↑: app.css:1131(010) `6px` → pol-shell.css:1113(020) `var(--space-1)`<br>**margin-left** ↑: app.css:1131(010) `auto` → pol-shell.css:1113(020) `0` |
| `.guest-claim-chip__dismiss` | `(base)` |  | **color** ↑: app.css:1144(010) `var(--onyx-dim)` → pol-shell.css:1132(020) `var(--onyx-faint)` |
| `.guest-claim-chip__keep` | `(base)` |  | **background** ↑: app.css:1135(010) `var(--onyx-accent)` → pol-shell.css:1121(020) `var(--onyx-panel-2)`<br>**border** ↑: app.css:1136(010) `1px solid var(--onyx-acc` → pol-shell.css:1122(020) `1px solid var(--onyx-lin`<br>**border-radius** ↑: app.css:1137(010) `6px` → pol-shell.css:1123(020) `var(--radius)`<br>**color** ↑: app.css:1134(010) `var(--onyx-accent-ink)` → pol-shell.css:1120(020) `var(--onyx-text)`<br>**padding** ↑: app.css:1138(010) `2px 10px` → pol-shell.css:1116(020) `0 var(--space-3)` |
| `.guest-claim-sheet__form` | `(base)` |  | **gap** ↑: app.css:1163(010) `6px` → ui-sheets.css:775(020) `var(--space-2)` |
| `.jump-to-date-close` | `(base)` |  | **background** ↑: app.css:2507(010) `none` → ui-sheets.css:233(020) `transparent`<br>**border** ↑: app.css:2508(010) `1px solid var(--onyx-lin` → ui-sheets.css:234(020) `0`<br>**padding** ↑: app.css:2508(010) `var(--space-1) 10px` → ui-sheets.css:229(020) `0` |
| `.label` | `(base)` |  | **color**: pol-stats.css:538(020) `var(--pg-dim)` → pol-public.css:375(020) `var(--onyx-dim)`<br>**font-weight**: pol-stats.css:540(020) `700` → pol-public.css:377(020) `650` |
| `.notif-center` | `(base)` |  | **position** ↑: app.css:3601(010) `absolute` → ui-sheets.css:498(020) `relative`<br>**right** ↑: app.css:3603(010) `0` → ui-sheets.css:500(020) `auto`<br>**top** ↑: app.css:3602(010) `calc(100% + var(--space-` → ui-sheets.css:499(020) `auto` |
| `.notif-center__close` | `(base)` |  | **font-size** **flip**: pol-shell.css:53(020) `var(--text-lg)` → ui-sheets.css:230(010) `0`<br>**line-height** **flip**: pol-shell.css:54(020) `1` → ui-sheets.css:231(010) `0`<br>**min-height** **flip**: pol-shell.css:51(020) `32px` → ui-sheets.css:227(010) `var(--sheet-close)`<br>**min-width** **flip**: pol-shell.css:50(020) `32px` → ui-sheets.css:226(010) `var(--sheet-close)` |
| `.notif-center__empty` | `(base)` |  | **border** ↑: pol-shell.css:84(010) `1px dashed var(--onyx-li` → ui-sheets.css:547(020) `0`<br>**margin** ↑: pol-shell.css:79(010) `var(--space-2) 0 0` → ui-sheets.css:545(020) `var(--space-2) 0`<br>**padding** ↑: pol-shell.css:80(010) `var(--space-5) var(--spa` → ui-sheets.css:546(020) `var(--space-7) var(--spa` |
| `.notif-center__filter` | `(base)` |  | **font-size** ↑: pol-shell.css:71(020) `var(--text-2xs)` → ui-sheets.css:505(030) `var(--text-sm)`<br>**min-height** ↑: pol-shell.css:68(020) `28px` → ui-sheets.css:505(030) `32px` |
| `.notif-center__filters` | `(base)` |  | **display**: app.css:3618(010) `flex` → pol-shell.css:60(010) `grid`<br>**margin** ↑: app.css:3618(010) `var(--space-2) 0` → ui-sheets.css:504(020) `0` |
| `.notif-center__glyph` | `(base)` |  | **border-radius** ↑: pol-shell.css:126(010) `var(--radius)` → ui-sheets.css:525(020) `50%`<br>**height** ↑: pol-shell.css:121(010) `28px` → ui-sheets.css:525(020) `32px`<br>**width** ↑: pol-shell.css:120(010) `28px` → ui-sheets.css:525(020) `32px` |
| `.notif-center__list` | `(base)` |  | **margin** ↑: app.css:3619(010) `0` → ui-sheets.css:511(020) `0 calc(-1 * var(--space-` |
| `.notif-center__open` | `(base)` |  | **grid-template-columns**: pol-shell.css:103(020) `28px minmax(0, 1fr)` → ui-sheets.css:524(020) `32px minmax(0, 1fr)`<br>**min-height**: pol-shell.css:108(020) `44px` → ui-sheets.css:524(020) `52px`<br>**padding**: pol-shell.css:109(020) `var(--space-2)` → ui-sheets.css:524(020) `var(--space-2) var(--spa` |
| `.notif-center__row` | `[data-unread=""]` |  | **background** ↑: pol-shell.css:99(020) `color-mix(in oklab, var(` → ui-sheets.css:513(030) `transparent` |
| `.notif-center__row` | `(base)` |  | **border-left** ↑: pol-shell.css:96(010) `2px solid transparent` → ui-sheets.css:512(020) `0` |
| `.onyx-account` | `(base)` |  | **width** ↑: app.css:1397(010) `min(560px, 94vw)` → ui-sheets.css:679(020) `min(var(--sheet-w-lg), 1` |
| `.onyx-account-hint` | `(base)` |  | **margin** ↑: app.css:1418(010) `0 0 8px` → pol-shell.css:227(020) `0` |
| `.onyx-account-nav` | `(base)` |  | **gap** ↑: app.css:1413(010) `12px` → ui-sheets.css:693(020) `2px`<br>**margin** ↑: app.css:1413(010) `12px 0 4px` → ui-sheets.css:694(020) `0` |
| `.onyx-account-nav__item` | `(base)` |  | **color** ↑: app.css:1414(010) `var(--onyx-accent)` → ui-sheets.css:702(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:1414(010) `13px` → ui-sheets.css:701(020) `var(--text-sm)` |
| `.onyx-audience-toggle` | `(base)` |  | **border-radius** ↑: app.css:693(010) `6px` → pol-thread.css:1110(030) `var(--radius)`<br>**font-size** ↑: app.css:688(010) `11px` → pol-thread.css:1107(020) `var(--text-xs)`<br>**font-weight** ↑: app.css:689(010) `600` → pol-thread.css:1108(020) `650`<br>**padding** ↑: app.css:694(010) `2px 8px` → pol-thread.css:1105(020) `0 var(--space-2)` → pol-thread.css:1110(030) `0 var(--space-2)` |
| `.onyx-audience-toggle-set` | `(base)` |  | **border-color** ↑: app.css:701(010) `var(--onyx-accent)` → pol-thread.css:1111(030) `var(--onyx-dim)`<br>**color** ↑: app.css:700(010) `var(--onyx-accent)` → pol-thread.css:1111(030) `var(--onyx-text)` |
| `.onyx-avatar` | `(base)` |  | **box-shadow**: app.css:141(020) `0 0 0 1px var(--nick-tin` → app.css:203(020) `0 0 0 2px var(--onyx-bg)` → pol-thread.css:926(020) `0 0 0 1px var(--nick-tin` |
| `.onyx-body` | `(base)` |  | **color** ↑: app.css:706(010) `var(--onyx-text)` → app.css:708(020) `var(--onyx-dim)` → pol-thread.css:185(020) `var(--onyx-dim)` → pol-thread.css:445(020) `var(--onyx-text)` |
| `.onyx-brand` | `(base)` |  | **gap** ↑: app.css:231(010) `10px` → pol-shell.css:581(020) `var(--space-2)` |
| `.onyx-call-avatar-lg` | `(base)` |  | **font-size** ↑ **flip**: app.css:3195(010) `24px` → app.css:3287(030) `18px` → calls-c4.css:140(020) `var(--text-md)`<br>**height** ↑ **flip**: app.css:3195(010) `72px` → app.css:3287(030) `56px` → calls-c4.css:140(020) `40px`<br>**width** ↑ **flip**: app.css:3195(010) `72px` → app.css:3287(030) `56px` → calls-c4.css:140(020) `40px` |
| `.onyx-call-bar` | `(base)` |  | **border-radius** ↑: app.css:3293(010) `0 0 6px 6px` → calls-c4.css:67(030) `0`<br>**grid-template-columns**: app.css:3292(010) `1fr auto 1fr` → calls-engine.css:24(010) `minmax(0, 1fr) auto minm` |
| `.onyx-call-bar` | `(base)` | @media (max-width: 640px) | **padding**: app.css:3398(010) `10px 12px calc(10px + en` → calls-engine.css:85(010) `var(--space-2) var(--spa` |
| `.onyx-call-bar-center` | `(base)` | @media (max-width: 640px) | **justify-content**: app.css:3399(010) `space-between` → calls-engine.css:77(010) `stretch` |
| `.onyx-call-btn` | `(base)` |  | **min-height** ↑: app.css:3239(010) `36px` → calls-c11.css:107(020) `var(--target-floor)` → calls-c6.css:64(020) `var(--target-min)` → calls-c4.css:55(020) `28px`<br>**padding** ↑: app.css:3239(010) `0 14px` → calls-c11.css:107(020) `0 var(--space-2)` → calls-c4.css:55(020) `0 var(--space-2)` |
| `.onyx-call-join` | `(base)` |  | **min-height** ↑: app.css:3217(010) `30px` → pol-shell.css:937(030) `32px` |
| `.onyx-call-more` | `(base)` | @media (max-width: 640px) | **left**: app.css:3403(010) `auto` → calls-engine.css:90(010) `0` |
| `.onyx-call-people` | `(base)` |  | **align-items**: app.css:3257(010) `center` → calls-engine.css:21(010) `flex-start` |
| `.onyx-call-ring` | `::after` |  | **animation**: app.css:3270(031) `onyx-call-breathe 1.6s e` → app.css:3271(051) `none` → calls-c11.css:167(031) `none` |
| `.onyx-call-you` | `(base)` |  | **color** ↑: app.css:3283(010) `var(--onyx-faint)` → calls-c4.css:113(020) `var(--onyx-dim)` |
| `.onyx-cbtn` | `(base)` | @media (max-width: 640px) | **width** ↑: app.css:3400(010) `48px` → calls-engine.css:80(020) `100%` → calls-engine.css:80(020) `100%` |
| `.onyx-cbtn-cap` | `(base)` |  | **line-height** ↑: app.css:3310(010) `1` → calls-c4.css:27(020) `inherit` |
| `.onyx-ci` | `(base)` |  | **height** ↑: app.css:3163(010) `18px` → app.css:3221(020) `16px` → app.css:3280(020) `14px` → app.css:3328(020) `14px` → calls-c8.css:49(020) `14px` → calls-c11.css:42(020) `14px` → roomsettings.css:39(020) `14px` → calls-c6.css:170(020) `14px` → calls-c6.css:185(020) `16px` → calls-c4.css:53(020) `14px` → calls-c4.css:108(020) `14px` → calls-c4.css:123(020) `14px`<br>**width** ↑: app.css:3162(010) `18px` → app.css:3221(020) `16px` → app.css:3280(020) `14px` → app.css:3328(020) `14px` → calls-c8.css:49(020) `14px` → calls-c11.css:42(020) `14px` → roomsettings.css:39(020) `14px` → calls-c6.css:170(020) `14px` → calls-c6.css:185(020) `16px` → calls-c4.css:53(020) `14px` → calls-c4.css:108(020) `14px` → calls-c4.css:123(020) `14px` |
| `.onyx-coach` | `(base)` |  | **background** ↑: app.css:2369(010) `var(--onyx-panel)` → pol-shell.css:1071(020) `transparent`<br>**border** ↑: app.css:2369(010) `1px solid var(--onyx-acc` → pol-shell.css:1072(020) `0`<br>**border-radius** ↑: app.css:2369(010) `var(--radius)` → pol-shell.css:1074(020) `0`<br>**display** ↑: app.css:2368(010) `flex` → pol-shell.css:1078(040) `none`<br>**flex-direction** ↑: app.css:2368(010) `column` → pol-shell.css:1067(020) `row`<br>**gap** ↑: app.css:2368(010) `2px` → pol-shell.css:1069(020) `var(--space-2)`<br>**padding** ↑: app.css:2369(010) `10px var(--space-8) 10px` → pol-shell.css:1070(020) `var(--space-2) var(--spa` |
| `.onyx-coach-dismiss` | `(base)` |  | **color**: app.css:2375(010) `var(--onyx-dim)` → pol-shell.css:1080(010) `var(--onyx-faint)` |
| `.onyx-coach-eyebrow` | `(base)` |  | **color** ↑: app.css:2371(010) `var(--onyx-accent)` → app.css:3846(010) `var(--onyx-dim)` → pol-shell.css:1076(020) `var(--onyx-faint)` |
| `.onyx-coach-text` | `(base)` |  | **color** ↑: app.css:2372(010) `var(--onyx-text)` → pol-shell.css:1079(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:2372(010) `var(--text-md)` → pol-shell.css:1079(020) `var(--text-sm)` |
| `.onyx-composer` | `(base)` |  | **align-items**: app.css:744(010) `center` → pol-thread.css:985(010) `stretch`<br>**background**: app.css:747(010) `var(--onyx-panel)` → pol-thread.css:989(010) `var(--onyx-bg)`<br>**border-top**: app.css:748(010) `1px solid var(--onyx-lin` → pol-thread.css:990(010) `0`<br>**display** ↑: app.css:743(010) `flex` → pol-shell.css:568(040) `none`<br>**gap**: app.css:745(010) `10px` → pol-thread.css:987(010) `var(--space-2)`<br>**padding**: app.css:746(010) `10px 16px` → pol-thread.css:988(010) `var(--space-2) var(--spa` |
| `.onyx-conn` | `(base)` |  | **border** ↑: app.css:266(010) `1px solid var(--onyx-lin` → pol-shell.css:605(020) `0`<br>**border-radius** ↑: app.css:267(010) `999px` → pol-shell.css:606(020) `var(--radius)`<br>**font-size** ↑: app.css:263(010) `var(--text-2xs)` → pol-shell.css:607(020) `var(--text-sm)`<br>**padding** ↑: app.css:268(010) `var(--space-1) var(--spa` → pol-shell.css:604(020) `0 var(--space-2)` |
| `.onyx-convohead` | `(base)` |  | **margin** ↑: app.css:2592(010) `0 0 var(--space-2)` → pol-shell.css:931(020) `0` → roomsettings.css:23(020) `0` |
| `.onyx-dmsafe` | `(base)` |  | **margin** ↑: app.css:2714(010) `0 0 10px` → pol-shell.css:931(020) `0` → roomsettings.css:24(020) `0` |
| `.onyx-dmsafe-bar` | `(base)` |  | **flex-wrap** ↑: app.css:2715(010) `wrap` → pol-shell.css:932(020) `nowrap`<br>**justify-content** ↑: app.css:2715(010) `space-between` → pol-shell.css:932(020) `flex-start` |
| `.onyx-facepile` | `(base)` |  | **padding** ↑: app.css:200(010) `4px 0 4px 4px` → roomsettings.css:26(020) `0 var(--space-1) 0 0` |
| `.onyx-feed-empty-body` | `(base)` |  | **margin** ↑: app.css:2379(010) `0` → pol-thread.css:622(020) `var(--space-1) 0 0` |
| `.onyx-feed-empty-title` | `(base)` |  | **font-weight** ↑: app.css:2378(010) `600` → pol-thread.css:621(020) `650`<br>**margin** ↑: app.css:2378(010) `0 0 var(--space-1)` → pol-thread.css:621(020) `0` |
| `.onyx-frame` | `(base)` |  | **height**: app.css:3433(010) `100vh` → app.css:3434(010) `100dvh` → pol-ios.css:65(010) `var(--vvh, 100dvh)` |
| `.onyx-gem` | `(base)` |  | **border-radius** ↑: app.css:245(010) `3px` → pol-shell.css:583(020) `2px`<br>**height** ↑: app.css:242(010) `14px` → pol-shell.css:583(020) `11px`<br>**width** ↑: app.css:241(010) `14px` → pol-shell.css:583(020) `11px` |
| `.onyx-home-action` | `(base)` |  | **min-height** ↑: app.css:2343(010) `36px` → pol-shell.css:1061(020) `40px`<br>**padding** ↑: app.css:2343(010) `6px var(--space-3)` → pol-shell.css:1061(020) `0 var(--space-4)` |
| `.onyx-home-empty` | `(base)` |  | **background** ↑: app.css:2315(010) `var(--onyx-panel)` → pol-shell.css:1056(020) `transparent`<br>**border** ↑: app.css:2315(010) `1px solid var(--onyx-lin` → pol-shell.css:1057(020) `0`<br>**gap** ↑: app.css:2314(010) `10px` → pol-shell.css:1054(020) `var(--space-4)`<br>**padding** ↑: app.css:2315(010) `var(--space-3)` → pol-shell.css:1055(020) `0` |
| `.onyx-home-inner` | `(base)` |  | **gap** ↑: app.css:2295(010) `var(--space-4)` → pol-shell.css:1050(020) `var(--space-5)`<br>**max-width** ↑: app.css:2295(010) `720px` → pol-shell.css:1050(020) `640px`<br>**padding** ↑: app.css:2295(010) `var(--space-4) 0 var(--s` → pol-shell.css:1050(020) `var(--space-8) var(--spa` |
| `.onyx-home-invite` | `(base)` |  | **background** ↑: app.css:2315(010) `var(--onyx-panel)` → pol-shell.css:1090(020) `transparent`<br>**border** ↑: app.css:2315(010) `1px solid var(--onyx-lin` → pol-shell.css:1091(020) `0`<br>**border-radius** ↑: app.css:2315(010) `var(--radius)` → pol-shell.css:1093(020) `0`<br>**flex-direction** ↑: app.css:2314(010) `column` → pol-shell.css:1084(020) `row`<br>**gap** ↑: app.css:2314(010) `10px` → pol-shell.css:1088(020) `var(--space-3)`<br>**padding** ↑: app.css:2315(010) `var(--space-3)` → pol-shell.css:1089(020) `var(--space-3) 0 0` |
| `.onyx-home-masthead` | `(base)` |  | **gap** ↑: app.css:2296(010) `6px` → pol-shell.css:1051(020) `var(--space-1)` |
| `.onyx-home-title` | `(base)` |  | **font-size** ↑: app.css:2298(010) `var(--text-2xl)` → pol-shell.css:1052(020) `1.75rem`<br>**font-weight** ↑: app.css:2298(010) `600` → pol-shell.css:1052(020) `700` |
| `.onyx-invshare-url` | `(base)` |  | **font-size** ↑: app.css:3068(010) `var(--text-2xs)` → ui-sheets.css:771(020) `var(--text-sm)` |
| `.onyx-jump-latest` | `(base)` |  | **background** ↑: app.css:2979(010) `var(--onyx-panel)` → pol-thread.css:584(020) `var(--onyx-panel-2)`<br>**border-radius** ↑: app.css:2981(010) `var(--radius)` → pol-thread.css:583(020) `var(--r-pill)`<br>**font-size** ↑: app.css:2976(010) `var(--text-2xs)` → pol-thread.css:587(020) `var(--text-sm)`<br>**gap** ↑: app.css:2972(010) `var(--space-1)` → pol-thread.css:580(020) `6px`<br>**padding** ↑: app.css:2974(010) `var(--space-1) var(--spa` → pol-thread.css:582(020) `0 var(--space-3) 0 var(-` |
| `.onyx-land-action` | `(base)` |  | **color**: app.css:1026(010) `var(--onyx-accent)` → pol-public.css:701(010) `var(--onyx-text)`<br>**display**: app.css:1027(010) `inline-block` → pol-public.css:693(010) `inline-flex`<br>**margin-top**: app.css:1029(010) `12px` → pol-public.css:697(010) `var(--space-5)` |
| `.onyx-land-board` | `(base)` |  | **margin-top**: app.css:978(010) `64px` → pol-public.css:648(010) `0` |
| `.onyx-land-claims` | `(base)` |  | **gap**: app.css:968(010) `16px` → pol-public.css:625(010) `var(--space-6)`<br>**margin**: app.css:969(010) `0` → pol-public.css:626(010) `var(--space-7) 0 0` |
| `.onyx-land-cta` | `(base)` |  | **gap**: app.css:933(010) `12px 20px` → pol-public.css:526(010) `var(--space-3)`<br>**margin-top**: app.css:934(010) `28px` → pol-public.css:526(010) `var(--space-7)` |
| `.onyx-land-detail` | `(base)` |  | **margin**: app.css:975(010) `16px 0 0` → pol-public.css:644(010) `var(--space-6) 0 0` |
| `.onyx-land-footnote` | `(base)` |  | **font-size**: app.css:1043(010) `13px` → pol-public.css:739(010) `var(--text-sm)` |
| `.onyx-land-h1` | `(base)` |  | **font-size**: app.css:914(010) `44px` → pol-public.css:514(010) `clamp(2.5rem, 1.6rem + 3`<br>**letter-spacing**: app.css:916(010) `-0.02em` → pol-public.css:516(010) `-0.03em`<br>**line-height**: app.css:917(010) `1.05` → pol-public.css:517(010) `1.02` |
| `.onyx-land-h2` | `(base)` |  | **font-size**: app.css:961(010) `20px` → pol-public.css:621(010) `clamp(1.5rem, 1.2rem + 1`<br>**margin**: app.css:963(010) `0 0 16px` → pol-public.css:621(010) `0` |
| `.onyx-land-h3` | `(base)` |  | **font-size**: app.css:1020(010) `17px` → pol-public.css:691(010) `var(--text-xl)`<br>**margin**: app.css:1022(010) `0 0 8px` → pol-public.css:691(010) `0` |
| `.onyx-land-lede` | `(base)` |  | **font-size**: app.css:925(010) `17px` → pol-public.css:523(010) `clamp(1.0625rem, 0.95rem`<br>**margin**: app.css:926(010) `16px 0 0` → pol-public.css:521(010) `var(--space-5) 0 0`<br>**max-width**: app.css:927(010) `52ch` → pol-public.css:520(010) `36ch` |
| `.onyx-land-link` | `(base)` |  | **align-self**: app.css:947(010) `center` → pol-public.css:542(010) `auto`<br>**font-weight**: app.css:949(010) `600` → pol-public.css:537(010) `650` |
| `.onyx-land-links` | `(base)` |  | **gap**: app.css:1037(010) `10px` → pol-public.css:716(010) `0`<br>**min-width**: app.css:1038(010) `200px` → pol-public.css:716(010) `0` |
| `.onyx-land-note` | `(base)` |  | **font-size**: app.css:954(010) `13px` → pol-public.css:544(010) `var(--text-sm)`<br>**margin**: app.css:955(010) `16px 0 0` → pol-public.css:544(010) `var(--space-5) 0 0` |
| `.onyx-land-open` | `(base)` |  | **border-radius**: app.css:939(010) `6px` → pol-public.css:535(010) `var(--radius)`<br>**padding**: app.css:942(010) `10px 22px` → pol-public.css:533(010) `0 var(--space-6)` |
| `.onyx-land-panel` | `(base)` |  | **display**: app.css:1009(010) `flex` → pol-public.css:679(010) `grid`<br>**gap**: app.css:1011(010) `24px 48px` → pol-public.css:681(010) `var(--space-6) 56px`<br>**margin-top**: app.css:1012(010) `20px` → pol-public.css:682(010) `var(--space-5)` |
| `.onyx-land-panel-note` | `(base)` |  | **font-size** ↑: app.css:1032(010) `13px` → pol-public.css:715(020) `var(--text-sm)` |
| `.onyx-land-shelf` | `(base)` |  | **margin-top**: app.css:1046(010) `64px` → pol-public.css:747(010) `0` |
| `.onyx-land-shelf-label` | `(base)` |  | **font-size**: app.css:1050(010) `13px` → pol-public.css:751(010) `var(--text-xs)`<br>**margin**: app.css:1052(010) `0 0 12px` → pol-public.css:751(010) `0` |
| `.onyx-land-shelf-list` | `(base)` |  | **gap**: app.css:1058(010) `8px 24px` → pol-public.css:752(010) `0 var(--space-5)` |
| `.onyx-land-tabs` | `(base)` |  | **display**: app.css:987(010) `flex` → pol-public.css:652(010) `inline-flex`<br>**gap**: app.css:988(010) `8px` → pol-public.css:654(010) `2px`<br>**margin-top**: app.css:989(010) `20px` → pol-public.css:656(010) `var(--space-7)` |
| `.onyx-land-trust` | `(base)` |  | **margin-top**: app.css:958(010) `64px` → pol-public.css:620(010) `0` |
| `.onyx-landing` | `(base)` |  | **margin** ↑: app.css:908(010) `0 auto` → pol-public.css:497(020) `0`<br>**max-width** ↑: app.css:909(010) `880px` → pol-public.css:497(020) `none`<br>**padding** ↑: app.css:910(010) `64px 24px 96px` → pol-public.css:497(020) `0` |
| `.onyx-member` | `(base)` |  | **flex-wrap**: app.css:2557(020) `wrap` → pol-roster.css:189(020) `nowrap`<br>**font-size** ↑: app.css:731(010) `13px` → pol-roster.css:193(020) `var(--text-md)`<br>**gap** ↑: app.css:729(010) `6px` → pol-roster.css:190(020) `0`<br>**min-height**: app.css:2557(020) `36px` → pol-roster.css:191(020) `40px`<br>**padding** ↑: app.css:730(010) `3px 0` → pol-roster.css:192(020) `0` |
| `.onyx-member-actions` | `(base)` |  | **display** ↑: app.css:1761(010) `flex` → ui-sheets.css:1073(020) `grid`<br>**gap** ↑: app.css:1761(010) `8px` → ui-sheets.css:1073(020) `var(--space-2)` |
| `.onyx-member-card` | `(base)` |  | **background** ↑: app.css:1732(010) `var(--onyx-panel-2)` → pol-shell.css:431(030) `var(--onyx-panel)` → ui-sheets.css:1066(030) `var(--onyx-panel)`<br>**border-radius** ↑: app.css:1734(010) `8px` → ui-sheets.css:1065(030) `var(--radius)`<br>**gap** ↑: app.css:1737(010) `10px` → ui-sheets.css:1062(030) `var(--space-4)`<br>**margin** ↑: app.css:1738(010) `8px 0 8px 16px` → pol-shell.css:429(030) `0`<br>**max-width** ↑: app.css:1739(010) `340px` → pol-shell.css:427(030) `100%` → ui-sheets.css:1061(030) `100%`<br>**padding** ↑: app.css:1740(010) `12px` → ui-sheets.css:1063(030) `var(--sheet-pad)`<br>**width**: pol-shell.css:426(030) `min(360px, 100%)` → ui-sheets.css:1060(030) `min(380px, 100%)` |
| `.onyx-member-identity` | `(base)` |  | **gap** ↑: app.css:1742(010) `10px` → ui-sheets.css:1069(020) `var(--space-3)` |
| `.onyx-member-message` | `(base)` |  | **background** ↑: app.css:2579(010) `transparent` → pol-roster.css:294(020) `var(--onyx-panel)`<br>**color** ↑: app.css:2582(010) `var(--onyx-text)` → pol-roster.css:297(020) `var(--onyx-dim)`<br>**min-height** ↑: app.css:2585(010) `24px` → pol-roster.css:291(020) `0`<br>**padding** ↑: app.css:2586(010) `2px var(--space-2)` → pol-roster.css:292(020) `0` |
| `.onyx-member-name` | `(base)` |  | **font-size** ↑: app.css:1755(010) `15px` → ui-sheets.css:1070(020) `var(--text-lg)`<br>**font-weight** ↑: app.css:1755(010) `700` → ui-sheets.css:1070(020) `650` |
| `.onyx-member-nickline` | `(base)` |  | **font-size** ↑: app.css:1756(010) `13px` → ui-sheets.css:1072(020) `var(--text-sm)`<br>**margin** ↑: app.css:1756(010) `2px 0 0` → ui-sheets.css:1072(020) `0` |
| `.onyx-member-presence-dot` | `(base)` |  | **background** ↑: app.css:2561(010) `var(--onyx-dim)` → pol-roster.css:237(020) `var(--onyx-text)`<br>**bottom** ↑: app.css:2564(010) `-1px` → pol-roster.css:234(020) `-2px`<br>**height** ↑: app.css:2565(010) `8px` → pol-roster.css:236(020) `10px`<br>**right** ↑: app.css:2567(010) `-1px` → pol-roster.css:233(020) `-2px`<br>**width** ↑: app.css:2568(010) `8px` → pol-roster.css:235(020) `10px` |
| `.onyx-member-presence-dot--away` | `(base)` |  | **box-shadow** ↑: app.css:2570(010) `inset 0 0 0 2px var(--on` → pol-roster.css:243(020) `inset 0 0 0 1.5px var(--` |
| `.onyx-member-pronouns` | `(base)` |  | **font-size** ↑: app.css:1756(010) `13px` → ui-sheets.css:1072(020) `var(--text-sm)`<br>**margin** ↑: app.css:1756(010) `2px 0 0` → ui-sheets.css:1072(020) `0` |
| `.onyx-member-role` | `(base)` |  | **padding** ↑: app.css:2575(010) `0 6px` → pol-roster.css:262(020) `0` |
| `.onyx-mobile-nav` | `(base)` | @media (max-width: 767.98px) | **display** ↑: app.css:3876(020) `flex` → pol-shell.css:1204(040) `none` → pol-ios.css:110(040) `none`<br>**gap**: app.css:3878(020) `2px` → pol-shell.css:1409(020) `0`<br>**padding**: app.css:3880(020) `var(--space-1) var(--spa` → pol-shell.css:1411(020) `0 var(--space-1) var(--s` |
| `.onyx-moddesk-room` | `(base)` |  | **font-size** ↑: app.css:2895(010) `var(--text-sm)` → ui-sheets.css:728(020) `var(--text-2xs)` |
| `.onyx-moddesk-sheet` | `(base)` |  | **padding** ↑: app.css:2883(010) `var(--space-4)` → ui-sheets.css:709(020) `0 var(--sheet-pad) var(-` |
| `.onyx-moddesk-toggle` | `(base)` |  | **min-height** ↑: app.css:2875(010) `24px` → pol-shell.css:665(020) `32px` |
| `.onyx-msg-menu` | `(base)` |  | **background** ↑: app.css:1604(010) `var(--onyx-panel-2)` → pol-thread.css:274(020) `var(--onyx-panel)`<br>**border-radius** ↑: app.css:1606(010) `6px` → pol-thread.css:276(020) `var(--radius)`<br>**gap** ↑: app.css:1609(010) `2px` → pol-thread.css:279(020) `0`<br>**margin** ↑: app.css:1610(010) `4px 0 4px 16px` → pol-thread.css:273(020) `0`<br>**max-width** ↑: app.css:1611(010) `280px` → pol-thread.css:279(020) `none`<br>**padding** ↑: app.css:1612(010) `6px` → pol-thread.css:279(020) `var(--space-1)` |
| `.onyx-msg-menu-item` | `:hover` |  | **background** ↑: app.css:1624(020) `var(--onyx-panel)` → pol-thread.css:298(030) `var(--onyx-panel-2)` |
| `.onyx-msg-menu-item` | `(base)` |  | **border** ↑: app.css:1616(010) `none` → pol-thread.css:288(030) `0`<br>**border-radius** ↑: app.css:1617(010) `6px` → pol-thread.css:289(030) `4px`<br>**font-size** ↑: app.css:1620(010) `13px` → pol-thread.css:292(030) `var(--text-sm)`<br>**padding** ↑: app.css:1621(010) `6px 10px` → pol-thread.css:286(030) `0 var(--space-3)` |
| `.onyx-msg-menu-trigger` | `(base)` |  | **border** ↑: app.css:1589(010) `1px solid transparent` → pol-thread.css:235(020) `0`<br>**border-radius** ↑: app.css:1590(010) `6px` → pol-thread.css:236(020) `4px`<br>**color** ↑: app.css:1591(010) `var(--onyx-faint)` → pol-thread.css:237(020) `var(--onyx-dim)`<br>**padding** ↑: app.css:1596(010) `0 6px` → pol-thread.css:233(020) `0` |
| `.onyx-msg-menu-trigger` | `:hover` |  | **border-color** ↑: app.css:1600(020) `var(--onyx-line)` → pol-thread.css:242(030) `transparent` |
| `.onyx-msg-menu-trigger` | `[aria-expanded=""]` |  | **border-color** ↑: app.css:1600(020) `var(--onyx-line)` → pol-thread.css:242(030) `transparent` |
| `.onyx-nav-btn` | `(base)` |  | **border** ↑: app.css:2170(010) `1px solid transparent` → pol-shell.css:680(020) `0`<br>**color** ↑: app.css:2168(010) `var(--onyx-dim)` → pol-shell.css:679(020) `var(--onyx-faint)`<br>**min-height** ↑: app.css:2167(010) `44px` → app.css:3497(020) `var(--target-min)` → pol-shell.css:676(020) `40px`<br>**padding** ↑: app.css:2166(010) `var(--space-2) 2px` → app.css:3496(020) `var(--space-2) 0` → pol-shell.css:677(020) `0` |
| `.onyx-nav-btn` | `(base)` | @media (max-width: 767.98px) | **font-size**: app.css:3885(020) `var(--text-xs)` → pol-shell.css:1421(020) `11px` |
| `.onyx-nav-icon` | `(base)` |  | **background**: app.css:2188(020) `var(--onyx-accent)` → app.css:2193(010) `currentColor` → pol-shell.css:697(020) `currentColor` → pol-shell.css:698(020) `var(--onyx-accent)` |
| `.onyx-newmsg-sheet` | `(base)` |  | **gap**: app.css:606(010) `10px` → ui-sheets.css:767(010) `var(--space-3)` |
| `.onyx-palette-launcher` | `(base)` |  | **color** ↑: app.css:2622(010) `var(--onyx-dim)` → pol-shell.css:592(020) `var(--onyx-faint)`<br>**flex** ↑: app.css:2626(010) `none` → pol-shell.css:587(020) `1 1 auto`<br>**padding** ↑: app.css:2618(010) `var(--space-1) 10px` → pol-shell.css:591(020) `0 var(--space-2) 0 10px` |
| `.onyx-palette-launcher` | `:hover` |  | **color** ↑: app.css:2628(020) `var(--onyx-text)` → pol-shell.css:596(030) `var(--onyx-dim)` |
| `.onyx-prefs-body` | `(base)` |  | **grid-template-columns** ↑: app.css:3080(010) `200px minmax(0, 1fr)` → ui-sheets.css:672(020) `212px minmax(0, 1fr)` |
| `.onyx-primary-nav` | `(base)` |  | **align-items** ↑: app.css:2142(010) `stretch` → pol-shell.css:669(020) `center`<br>**gap** ↑: app.css:2143(010) `var(--space-1)` → app.css:3444(020) `var(--space-1)` → pol-shell.css:670(020) `2px`<br>**padding** ↑: app.css:2144(010) `10px 6px` → app.css:3443(020) `var(--space-2) var(--spa` → pol-shell.css:671(020) `var(--space-2) 0` |
| `.onyx-profile-account` | `(base)` |  | **font-size** ↑: app.css:1702(010) `13px` → ui-sheets.css:781(020) `var(--text-sm)` |
| `.onyx-profile-nick` | `(base)` |  | **font-size** ↑: app.css:1701(010) `14px` → ui-sheets.css:780(020) `var(--text-lg)`<br>**font-weight** ↑: app.css:1701(010) `700` → ui-sheets.css:780(020) `650` |
| `.onyx-rail` | `(base)` |  | **padding** ↑: app.css:408(010) `12px` → pol-shell.css:723(020) `0 var(--space-2) var(--s` |
| `.onyx-rail-avatar` | `(base)` |  | **border-radius** ↑: app.css:580(010) `var(--radius)` → pol-shell.css:440(020) `50%` → pol-shell.css:853(020) `50%`<br>**height** ↑: app.css:579(010) `24px` → pol-shell.css:853(020) `28px`<br>**width** ↑: app.css:578(010) `24px` → pol-shell.css:853(020) `28px` |
| `.onyx-rail-color` | `(base)` |  | **border-radius** ↑: app.css:569(010) `3px` → pol-shell.css:819(020) `2px`<br>**height** ↑: app.css:571(010) `10px` → pol-shell.css:819(020) `14px`<br>**width** ↑: app.css:572(010) `4px` → pol-shell.css:819(020) `3px` |
| `.onyx-rail-copy` | `(base)` |  | **flex-direction** ↑: app.css:542(010) `column` → pol-shell.css:829(020) `row` |
| `.onyx-rail-empty` | `(base)` |  | **color** ↑: app.css:531(010) `var(--onyx-dim)` → pol-shell.css:789(020) `var(--onyx-faint)` |
| `.onyx-rail-filter` | `(base)` |  | **gap** ↑: app.css:479(010) `6px` → pol-shell.css:739(020) `var(--space-1)`<br>**margin** ↑: app.css:481(010) `0 0 var(--space-3)` → pol-shell.css:739(020) `0 0 var(--space-2)` |
| `.onyx-rail-filter-clear` | `(base)` |  | **font-size**: app.css:505(020) `var(--text-2xs)` → pol-shell.css:764(020) `var(--text-xs)`<br>**padding**: app.css:506(020) `3px var(--space-2)` → pol-shell.css:763(020) `0 var(--space-2)` |
| `.onyx-rail-filter-input` | `:focus` |  | **outline** ↑: app.css:495(020) `1px solid var(--onyx-acc` → pol-shell.css:758(030) `var(--focus-ring)`<br>**outline-offset** ↑: app.css:495(020) `0` → pol-shell.css:758(030) `var(--focus-offset)` |
| `.onyx-rail-filter-input` | `(base)` |  | **padding** ↑: app.css:493(010) `5px var(--space-2)` → pol-shell.css:754(020) `0 var(--space-2) 0 28px` |
| `.onyx-rail-filter-unread` | `(base)` |  | **font-size**: app.css:505(020) `var(--text-2xs)` → pol-shell.css:764(020) `var(--text-xs)`<br>**padding**: app.css:506(020) `3px var(--space-2)` → pol-shell.css:763(020) `0 var(--space-2)` |
| `.onyx-rail-filter-unread-on` | `(base)` |  | **border-color**: app.css:509(020) `var(--onyx-accent)` → pol-shell.css:768(020) `var(--onyx-dim)`<br>**color**: app.css:510(020) `var(--onyx-accent)` → pol-shell.css:768(020) `var(--onyx-text)` |
| `.onyx-rail-label` | `(base)` |  | **letter-spacing** ↑: app.css:527(010) `0.08em` → pol-shell.css:774(020) `var(--tracking-kicker)`<br>**margin**: app.css:522(020) `0` → app.css:529(010) `0 0 var(--space-2)` → pol-shell.css:774(020) `var(--space-2) 0 var(--s` |
| `.onyx-rail-meta` | `(base)` |  | **gap**: app.css:553(010) `6px` → pol-shell.css:826(010) `4px` |
| `.onyx-rail-name` | `(base)` |  | **color** ↑: app.css:453(020) `var(--onyx-accent)` → pol-shell.css:815(030) `var(--onyx-text)`<br>**font-weight** ↑: app.css:454(020) `650` → app.css:556(020) `650` → pol-shell.css:815(030) `650` → pol-shell.css:817(030) `700` |
| `.onyx-rail-new` | `(base)` |  | **color** ↑: app.css:504(020) `var(--onyx-dim)` → pol-shell.css:782(020) `var(--onyx-dim)` → pol-shell.css:788(030) `var(--onyx-text)`<br>**font-size**: app.css:505(020) `var(--text-2xs)` → pol-shell.css:783(020) `var(--text-xs)`<br>**padding**: app.css:506(020) `3px var(--space-2)` → pol-shell.css:779(020) `0 var(--space-2)` |
| `.onyx-rail-section-heading` | `(base)` |  | **justify-content** ↑: app.css:518(010) `space-between` → pol-shell.css:1461(030) `flex-end` |
| `.onyx-rail-star` | `(base)` |  | **border**: app.css:503(020) `1px solid var(--onyx-lin` → pol-shell.css:861(020) `0`<br>**color**: app.css:504(020) `var(--onyx-dim)` → app.css:589(020) `var(--onyx-faint)` → pol-shell.css:862(020) `var(--onyx-faint)`<br>**padding**: app.css:506(020) `3px var(--space-2)` → app.css:590(020) `3px 6px` → pol-shell.css:860(020) `0`<br>**width**: app.css:501(020) `auto` → pol-shell.css:858(020) `28px` |
| `.onyx-rail-star-on` | `(base)` |  | **color**: app.css:592(020) `var(--onyx-accent)` → app.css:3842(020) `var(--onyx-text)` → pol-shell.css:870(020) `var(--onyx-dim)` |
| `.onyx-rail-sub` | `(base)` |  | **color** ↑: app.css:547(010) `var(--onyx-faint)` → pol-shell.css:824(020) `var(--onyx-faint)` → pol-shell.css:825(030) `var(--onyx-dim)`<br>**font-size** ↑: app.css:548(010) `var(--text-2xs)` → pol-shell.css:824(020) `var(--text-xs)` |
| `.onyx-rail-unread` | `(base)` |  | **border-radius** ↑: app.css:559(010) `var(--radius)` → pol-shell.css:846(020) `var(--r-pill)`<br>**font-size** ↑: app.css:561(010) `var(--text-xs)` → pol-shell.css:840(020) `11px`<br>**padding** ↑: app.css:564(010) `1px 5px` → pol-shell.css:838(020) `0 5px` |
| `.onyx-react-choice` | `:hover` |  | **background** ↑: app.css:1657(020) `var(--onyx-panel)` → pol-thread.css:331(030) `var(--onyx-panel-2)` |
| `.onyx-react-choice` | `(base)` |  | **font-size** ↑: app.css:1654(010) `18px` → pol-thread.css:327(030) `20px`<br>**padding** ↑: app.css:1655(010) `4px` → pol-thread.css:326(030) `0` |
| `.onyx-react-grid` | `(base)` |  | **grid-template-columns** ↑: app.css:1646(010) `repeat(6, 1fr)` → pol-thread.css:320(020) `repeat(8, minmax(0, 1fr)` |
| `.onyx-react-picker` | `(base)` |  | **background** ↑: app.css:1626(010) `var(--onyx-panel-2)` → pol-thread.css:274(020) `var(--onyx-panel)`<br>**border-radius** ↑: app.css:1628(010) `6px` → pol-thread.css:276(020) `var(--radius)`<br>**gap** ↑: app.css:1631(010) `6px` → pol-thread.css:309(020) `var(--space-2)`<br>**margin** ↑: app.css:1632(010) `4px 0 4px 16px` → pol-thread.css:273(020) `0`<br>**max-width** ↑: app.css:1633(010) `280px` → pol-thread.css:309(020) `none`<br>**padding** ↑: app.css:1634(010) `6px` → pol-thread.css:309(020) `var(--space-2)` |
| `.onyx-react-search` | `(base)` |  | **background** ↑: app.css:1637(010) `var(--onyx-panel)` → pol-thread.css:313(020) `var(--onyx-bg)`<br>**border-radius** ↑: app.css:1639(010) `6px` → pol-thread.css:315(020) `var(--radius)`<br>**font-size** ↑: app.css:1641(010) `13px` → pol-thread.css:318(020) `var(--text-sm)`<br>**padding** ↑: app.css:1642(010) `6px 10px` → pol-thread.css:312(020) `0 var(--space-3)` |
| `.onyx-reclaim-lead` | `(base)` |  | **font-size** ↑: app.css:348(010) `13px` → ui-sheets.css:776(020) `var(--text-md)`<br>**margin** ↑: app.css:347(010) `0 0 12px` → ui-sheets.css:776(020) `0 0 var(--space-4)` |
| `.onyx-room-header` | `(base)` |  | **min-height** ↑: app.css:3642(010) `48px` → pol-shell.css:896(020) `52px`<br>**padding** ↑: app.css:3643(010) `var(--space-2) var(--spa` → pol-shell.css:897(020) `var(--space-2) var(--spa`<br>**row-gap** **flip**: pol-shell.css:895(020) `2px` → roomsettings.css:9(010) `var(--space-1)` |
| `.onyx-room-header-actions` | `(base)` |  | **gap** ↑: app.css:3677(010) `var(--space-2)` → pol-shell.css:934(020) `2px` |
| `.onyx-room-header-id` | `(base)` |  | **align-items** ↑: app.css:3652(010) `baseline` → pol-shell.css:905(020) `center`<br>**flex** ↑: app.css:3649(010) `1 1 auto` → pol-shell.css:903(020) `1 1 0`<br>**gap** ↑: app.css:3653(010) `var(--space-3)` → pol-shell.css:906(020) `var(--space-2)` |
| `.onyx-room-header-name` | `(base)` |  | **font-size** ↑: app.css:3658(010) `var(--text-md)` → pol-shell.css:920(020) `var(--text-lg)`<br>**font-weight** ↑: app.css:3659(010) `650` → pol-shell.css:921(020) `700` |
| `.onyx-room-more-menu` | `(base)` | @media (max-width: 767.98px) | **animation** **flip**: pol-shell.css:1293(020) `onyx-sheet-in var(--dur-` → ui-sheets.css:972(010) `ui-sheet-rise var(--dur-`<br>**border-radius** **flip**: pol-shell.css:1291(020) `calc(var(--radius) * 2) ` → ui-sheets.css:970(010) `12px 12px 0 0`<br>**bottom** **flip**: pol-shell.css:1285(020) `0` → ui-sheets.css:965(010) `0` → ui-sheets.css:1047(010) `var(--kb-inset, 0px)`<br>**padding** **flip**: pol-shell.css:1289(020) `0 var(--space-2) calc(va` → ui-sheets.css:968(010) `var(--sheet-grip-zone) v`<br>**z-index** **flip**: pol-shell.css:1286(020) `59` → ui-sheets.css:966(010) `61` |
| `.onyx-room-more-menu` | `(base)` |  | **min-width** ↑: app.css:3690(010) `200px` → pol-shell.css:968(020) `248px` |
| `.onyx-room-more-scrim` | `(base)` | @media (max-width: 767.98px) | **background** **flip**: pol-shell.css:1279(020) `color-mix(in srgb, #000 ` → ui-sheets.css:957(010) `var(--sheet-veil)`<br>**z-index** **flip**: pol-shell.css:1279(020) `58` → ui-sheets.css:956(010) `60` |
| `.onyx-room-more-toggle` | `[aria-expanded=""]` |  | **border-color** ↑: app.css:3580(020) `var(--onyx-dim)` → pol-shell.css:953(040) `transparent` → pol-shell.css:953(040) `transparent` |
| `.onyx-room-privacy` | `(base)` |  | **color** **flip**: pol-shell.css:928(030) `var(--onyx-faint)` → roomsettings.css:36(010) `var(--onyx-dim)` |
| `.onyx-room-topic-toggle` | `(base)` |  | **color** **flip**: pol-shell.css:927(020) `var(--onyx-faint)` → roomsettings.css:53(010) `var(--onyx-dim)` |
| `.onyx-roster-care` | `(base)` |  | **border** ↑: app.css:1578(010) `1px solid var(--onyx-lin` → pol-roster.css:318(020) `0`<br>**font-size** ↑: app.css:1582(010) `12px` → pol-roster.css:321(020) `var(--text-sm)`<br>**padding** ↑: app.css:1584(010) `2px 10px` → pol-roster.css:316(020) `var(--space-1) 0` |
| `.onyx-roster-count` | `(base)` |  | **color** ↑: app.css:2541(010) `var(--onyx-dim)` → pol-roster.css:62(020) `var(--onyx-faint)` |
| `.onyx-roster-empty` | `(base)` |  | **margin** ↑: app.css:2556(010) `var(--space-2) 0` → pol-roster.css:127(020) `var(--space-3) var(--spa` |
| `.onyx-roster-filter` | `(base)` |  | **margin** ↑: app.css:2542(010) `var(--space-1) 0 var(--s` → pol-roster.css:94(020) `var(--space-1) var(--spa` |
| `.onyx-roster-filter-input` | `(base)` |  | **background** ↑: app.css:2544(010) `var(--onyx-bg)` → pol-roster.css:107(020) `transparent`<br>**border** ↑: app.css:2545(010) `1px solid var(--onyx-lin` → pol-roster.css:108(020) `0`<br>**min-height** ↑: app.css:2551(010) `32px` → pol-roster.css:105(020) `30px`<br>**padding** ↑: app.css:2552(010) `var(--space-1) var(--spa` → pol-roster.css:106(020) `0` |
| `.onyx-roster-filter-input` | `:focus-visible` |  | **outline** ↑: app.css:2555(020) `2px solid var(--onyx-acc` → pol-roster.css:112(030) `none` |
| `.onyx-roster-head` | `(base)` |  | **align-items** ↑: app.css:2539(010) `baseline` → pol-roster.css:45(020) `center`<br>**justify-content** ↑: app.css:2539(010) `space-between` → pol-roster.css:47(020) `flex-start` |
| `.onyx-search-toggle-open` | `(base)` |  | **border-color** ↑: app.css:3580(010) `var(--onyx-dim)` → pol-shell.css:953(030) `transparent` |
| `.onyx-sender` | `(base)` |  | **margin-right** ↑: app.css:674(010) `8px` → app.css:2997(020) `6px` → pol-thread.css:125(030) `var(--space-2)` |
| `.onyx-sheet` | `(base)` |  | **animation**: app.css:3765(020) `onyx-sheet-in var(--dur-` → ui-sheets.css:73(020) `ui-sheet-pop var(--dur-b`<br>**animation-name**: app.css:3773(030) `onyx-sheet-side-in` → ui-sheets.css:120(030) `ui-sheet-side` → ui-sheets.css:136(030) `ui-sheet-drop`<br>**border-radius** **flip**: app.css:3772(030) `0` → ui-sheets.css:66(020) `var(--radius)` → ui-sheets.css:119(030) `0`<br>**max-height** **flip**: app.css:3770(030) `none` → ui-sheets.css:65(020) `var(--sheet-max-h)` → ui-sheets.css:117(030) `none` → ui-sheets.css:135(030) `min(calc(100dvh - 72px),` |
| `.onyx-sheet` | `(base)` | @media (max-width: 767.98px) | **border-radius** ↑ **flip**: app.css:3909(020) `var(--radius) var(--radi` → app.css:3909(030) `var(--radius) var(--radi` → ui-sheets.css:309(020) `12px 12px 0 0` → ui-sheets.css:309(030) `12px 12px 0 0`<br>**max-height** ↑ **flip**: app.css:3907(020) `92dvh` → app.css:3907(030) `92dvh` → ui-sheets.css:307(020) `var(--sheet-max-h)` → ui-sheets.css:307(030) `var(--sheet-max-h)` |
| `.onyx-sheet-backdrop` | `(base)` |  | **background** **flip**: app.css:3150(030) `var(--onyx-bg)` → app.css:3739(010) `color-mix(in srgb, #000 ` → ui-sheets.css:60(010) `var(--sheet-veil)` → ui-sheets.css:131(030) `color-mix(in srgb, #000 ` |
| `.onyx-sheet-close` | `(base)` |  | **background** ↑: app.css:3810(010) `transparent` → ui-sheets.css:233(020) `transparent` → ui-sheets.css:233(010) `transparent` → ui-sheets.css:718(020) `var(--onyx-panel)`<br>**border** ↑: app.css:3811(010) `1px solid var(--onyx-lin` → ui-sheets.css:234(020) `0` → ui-sheets.css:234(010) `0`<br>**min-height** ↑: app.css:3806(010) `32px` → ui-sheets.css:227(020) `var(--sheet-close)` → ui-sheets.css:227(010) `var(--sheet-close)`<br>**min-width** ↑: app.css:3805(010) `32px` → ui-sheets.css:226(020) `var(--sheet-close)` → ui-sheets.css:226(010) `var(--sheet-close)` |
| `.onyx-sheet-head` | `(base)` |  | **margin-bottom** ↑: app.css:3791(010) `var(--space-3)` → roomsettings.css:128(020) `0` → ui-sheets.css:503(020) `0` → ui-sheets.css:768(020) `var(--space-1)` |
| `.onyx-sheet-layer` | `(base)` |  | **padding**: app.css:3727(010) `var(--space-4)` → ui-sheets.css:57(010) `var(--space-6) var(--spa` |
| `.onyx-sheet-layer` | `[data-placement=""]` |  | **padding**: app.css:3733(020) `0` → ui-sheets.css:113(020) `0` → ui-sheets.css:128(020) `52px var(--space-4) var(`<br>**place-items**: app.css:3732(020) `stretch end` → ui-sheets.css:127(020) `start end` |
| `.onyx-shortcuts-close` | `(base)` |  | **border**: app.css:2703(010) `1px solid var(--onyx-lin` → ui-sheets.css:234(010) `0`<br>**font-size**: app.css:2707(010) `var(--text-lg)` → ui-sheets.css:230(010) `0`<br>**line-height**: app.css:2708(010) `1` → ui-sheets.css:231(010) `0`<br>**min-height**: app.css:2701(010) `32px` → ui-sheets.css:227(010) `var(--sheet-close)`<br>**min-width**: app.css:2700(010) `32px` → ui-sheets.css:226(010) `var(--sheet-close)` |
| `.onyx-shortcuts-close` | `:focus-visible` |  | **outline**: app.css:2631(020) `2px solid var(--onyx-acc` → ui-sheets.css:241(020) `var(--focus-ring)`<br>**outline-offset**: app.css:2631(020) `1px` → ui-sheets.css:241(020) `var(--focus-offset)` |
| `.onyx-shortcuts-sheet` | `(base)` |  | **display** ↑: app.css:2661(010) `flex` → ui-sheets.css:486(020) `block`<br>**width** ↑: app.css:2658(010) `min(560px, 100%)` → ui-sheets.css:486(020) `min(680px, 100%)` |
| `.onyx-spotlight` | `(base)` | @media (max-width: 767.98px) | **align-items**: app.css:2865(010) `start` → ui-sheets.css:830(010) `stretch`<br>**padding**: app.css:2865(010) `var(--space-2)` → ui-sheets.css:830(010) `0` |
| `.onyx-spotlight-backdrop` | `(base)` |  | **background** **flip**: app.css:2654(010) `rgb(0 0 0 / 55%)` → app.css:3150(030) `var(--onyx-bg)` → ui-sheets.css:407(010) `var(--sheet-veil)` |
| `.onyx-spotlight-close` | `(base)` |  | **border**: app.css:2703(010) `1px solid var(--onyx-lin` → ui-sheets.css:234(010) `0`<br>**font-size**: app.css:2707(010) `var(--text-lg)` → ui-sheets.css:230(010) `0`<br>**line-height**: app.css:2708(010) `1` → ui-sheets.css:231(010) `0`<br>**min-height**: app.css:2701(010) `32px` → ui-sheets.css:227(010) `var(--sheet-close)`<br>**min-width**: app.css:2700(010) `32px` → ui-sheets.css:226(010) `var(--sheet-close)` |
| `.onyx-spotlight-close` | `:focus-visible` |  | **outline**: app.css:2631(020) `2px solid var(--onyx-acc` → ui-sheets.css:241(020) `var(--focus-ring)`<br>**outline-offset**: app.css:2631(020) `1px` → ui-sheets.css:241(020) `var(--focus-offset)` |
| `.onyx-spotlight-foot` | `(base)` |  | **padding**: app.css:2829(010) `var(--space-2) var(--spa` → ui-sheets.css:469(010) `var(--space-2) var(--spa` |
| `.onyx-spotlight-group` | `(base)` |  | **margin-top**: app.css:2788(020) `6px` → ui-sheets.css:437(020) `var(--space-2)` |
| `.onyx-spotlight-hint` | `(base)` |  | **color** ↑: app.css:2818(010) `var(--onyx-dim)` → ui-sheets.css:462(010) `var(--onyx-faint)` → ui-sheets.css:463(030) `var(--onyx-dim)`<br>**font-size**: app.css:2819(010) `var(--text-2xs)` → ui-sheets.css:462(010) `var(--text-sm)` |
| `.onyx-spotlight-input` | `(base)` |  | **font-size**: app.css:2694(010) `var(--text-md)` → ui-sheets.css:431(010) `var(--text-lg)`<br>**padding**: app.css:2695(010) `6px 0` → ui-sheets.css:431(010) `10px 0` |
| `.onyx-spotlight-option` | `(base)` |  | **border-left**: app.css:2804(010) `2px solid transparent` → ui-sheets.css:443(010) `0`<br>**gap**: app.css:2800(010) `10px` → ui-sheets.css:440(010) `var(--space-3)`<br>**min-height**: app.css:2801(010) `36px` → ui-sheets.css:441(010) `40px`<br>**padding**: app.css:2802(010) `6px var(--space-2)` → ui-sheets.css:442(010) `0 var(--space-3)` |
| `.onyx-spotlight-panel` | `(base)` |  | **animation**: app.css:2668(010) `onyx-switcher-in var(--d` → ui-sheets.css:415(010) `ui-sheet-drop var(--dur-`<br>**box-shadow**: app.css:2667(010) `0 12px 32px rgb(0 8 16 /` → ui-sheets.css:413(010) `var(--elev-3)`<br>**max-height**: app.css:2659(010) `min(70vh, 560px)` → ui-sheets.css:411(010) `min(64vh, 560px)`<br>**width**: app.css:2658(010) `min(560px, 100%)` → ui-sheets.css:410(010) `min(600px, 100%)` |
| `.onyx-spotlight-panel` | `(base)` | @media (max-width: 767.98px) | **max-height**: app.css:2866(010) `calc(100dvh - 16px)` → ui-sheets.css:833(010) `none` |
| `.onyx-spotlight-results` | `(base)` |  | **padding**: app.css:2784(010) `6px` → ui-sheets.css:435(010) `var(--space-2)` |
| `.onyx-spotlight-search` | `(base)` |  | **gap**: app.css:2682(010) `var(--space-2)` → ui-sheets.css:419(010) `var(--space-3)`<br>**padding**: app.css:2683(010) `10px var(--space-3)` → ui-sheets.css:421(010) `0 var(--space-2) 0 var(-` |
| `.onyx-spotlight-section` | `(base)` |  | **padding**: app.css:2791(010) `6px var(--space-2) var(-` → ui-sheets.css:436(010) `var(--space-2) var(--spa` |
| `.onyx-thread-desc` | `(base)` |  | **font-size** ↑: app.css:157(010) `12px` → pol-thread.css:890(020) `var(--text-sm)` |
| `.onyx-thread-head` | `(base)` |  | **align-items** ↑: app.css:155(010) `baseline` → pol-thread.css:882(020) `center`<br>**gap** ↑: app.css:155(010) `8px` → pol-thread.css:883(020) `var(--space-3)` |
| `.onyx-thread-indicator` | `(base)` |  | **background** ↑: app.css:158(010) `none` → pol-thread.css:432(030) `transparent`<br>**border** ↑: app.css:158(010) `none` → pol-thread.css:433(030) `1px solid transparent`<br>**font-size** ↑: app.css:158(010) `12px` → pol-thread.css:437(030) `var(--text-sm)`<br>**padding** ↑: app.css:158(010) `2px 4px` → pol-thread.css:431(030) `0 var(--space-2) 0 6px` |
| `.onyx-thread-msg` | `(base)` |  | **border** ↑: app.css:159(010) `1px solid var(--onyx-lin` → pol-thread.css:915(020) `0`<br>**border-radius** ↑: app.css:159(010) `6px` → pol-thread.css:916(020) `0`<br>**padding** ↑: app.css:159(010) `8px` → pol-thread.css:913(020) `var(--space-2) var(--spa` |
| `.onyx-thread-msg-text` | `(base)` |  | **margin** ↑: app.css:161(010) `4px 0 0` → pol-thread.css:930(020) `0` |
| `.onyx-thread-sheet` | `(base)` |  | **gap**: app.css:154(010) `12px` → pol-thread.css:876(010) `0`<br>**padding**: app.css:154(010) `16px` → pol-thread.css:876(010) `0` |
| `.onyx-thread-state` | `(base)` |  | **font-size** ↑: app.css:162(010) `12px` → pol-thread.css:945(020) `var(--text-sm)` |
| `.onyx-thread-title` | `(base)` |  | **font-size** ↑: app.css:156(010) `15px` → pol-thread.css:889(020) `var(--text-lg)` |
| `.onyx-toast` | `(base)` |  | **align-items**: app.css:1082(010) `flex-start` → ui-sheets.css:794(010) `center`<br>**border-radius**: app.css:1087(010) `8px` → ui-sheets.css:798(010) `var(--radius)`<br>**gap**: app.css:1083(010) `8px` → ui-sheets.css:795(010) `var(--space-3)`<br>**padding**: app.css:1088(010) `8px 10px` → ui-sheets.css:797(010) `var(--space-2) var(--spa` |
| `.onyx-toaster` | `(base)` |  | **bottom**: app.css:1069(010) `16px` → ui-sheets.css:790(010) `calc(var(--composer-h) +`<br>**max-width**: app.css:1077(010) `min(360px, 90vw)` → ui-sheets.css:791(010) `min(380px, calc(100vw - `<br>**right**: app.css:1068(010) `16px` → ui-sheets.css:789(010) `var(--space-5)`<br>**z-index**: app.css:1070(010) `60` → ui-sheets.css:788(010) `90` |
| `.onyx-topbar` | `(base)` |  | **display** ↑: app.css:223(010) `flex` → pol-shell.css:572(020) `grid`<br>**gap** ↑: app.css:225(010) `var(--space-4)` → app.css:3533(010) `var(--space-3)` → pol-shell.css:575(020) `var(--space-4)`<br>**min-height** ↑: app.css:3535(010) `52px` → pol-shell.css:576(020) `48px`<br>**padding** ↑: app.css:226(010) `10px var(--space-4)` → app.css:3534(010) `var(--space-2) var(--spa` → pol-shell.css:577(020) `0 var(--space-3) 0 var(-` |
| `.onyx-topbar-global` | `(base)` |  | **gap** ↑: app.css:3548(010) `var(--space-2)` → pol-shell.css:599(020) `var(--space-1)` |
| `.onyx-topbar-search` | `(base)` |  | **justify-content** ↑: app.css:3542(010) `center` → pol-shell.css:585(020) `stretch` |
| `.onyx-topic` | `(base)` |  | **overflow** ↑: app.css:252(010) `hidden` → pol-thread.css:1226(020) `visible`<br>**white-space** ↑: app.css:254(010) `nowrap` → pol-thread.css:1227(020) `normal` |
| `.onyx-topic-tools` | `(base)` |  | **display** ↑: app.css:170(010) `flex` → pol-thread.css:632(011) `block`<br>**padding** ↑: app.css:170(010) `4px 0` → pol-thread.css:632(011) `0 0 var(--space-2)` |
| `.onyx-ts` | `(base)` |  | **font-size** ↑: app.css:2993(020) `var(--text-2xs)` → pol-thread.css:130(030) `var(--text-2xs)` → pol-thread.css:146(030) `10.5px` |
| `.onyx-you` | `(base)` |  | **padding** ↑: app.css:2221(010) `var(--space-4)` → ui-sheets.css:580(020) `0 var(--sheet-pad) var(-`<br>**width** ↑: app.css:2222(010) `min(440px, calc(100vw - ` → ui-sheets.css:579(020) `min(460px, 100%)` |
| `.onyx-you-close` | `(base)` |  | **border**: app.css:2237(010) `1px solid var(--onyx-lin` → ui-sheets.css:234(010) `0`<br>**color**: app.css:2235(010) `var(--onyx-text)` → ui-sheets.css:232(010) `var(--onyx-dim)`<br>**padding**: app.css:2239(010) `var(--space-1) var(--spa` → ui-sheets.css:229(010) `0` |
| `.onyx-you-desc` | `(base)` |  | **font-size** ↑: app.css:2232(010) `var(--text-2xs)` → ui-sheets.css:605(020) `var(--text-sm)` |
| `.onyx-you-group` | `(base)` |  | **margin-top** ↑: app.css:2245(010) `var(--space-4)` → ui-sheets.css:609(020) `var(--space-5)` |
| `.onyx-you-group__title` | `(base)` |  | **letter-spacing** ↑: app.css:2252(010) `0.08em` → ui-sheets.css:610(020) `var(--tracking-kicker)`<br>**margin** ↑: app.css:2248(010) `0 0 var(--space-1)` → ui-sheets.css:610(020) `0 0 2px` |
| `.onyx-you-head` | `(base)` |  | **display** ↑ **flip**: app.css:2228(010) `flex` → pol-shell.css:1042(030) `flex` → ui-sheets.css:584(020) `block`<br>**gap** ↑: app.css:2228(010) `var(--space-3)` → pol-shell.css:1042(030) `14px` |
| `.onyx-you-leave` | `(base)` |  | **border** ↑: app.css:2282(010) `1px solid var(--onyx-lin` → ui-sheets.css:653(030) `1px solid color-mix(in o`<br>**color** ↑: app.css:2280(010) `var(--onyx-text)` → ui-sheets.css:651(030) `var(--onyx-bad)` |
| `.onyx-you-leave-row` | `(base)` |  | **justify-content** ↑: app.css:2277(010) `flex-end` → ui-sheets.css:647(020) `stretch`<br>**margin-top** ↑: app.css:2277(010) `var(--space-4)` → ui-sheets.css:647(020) `var(--space-6)` |
| `.onyx-you-lede` | `(base)` |  | **margin** ↑: app.css:2243(010) `var(--space-3) 0 0` → ui-sheets.css:607(020) `var(--space-4) 0 0` |
| `.onyx-you-link` | `(base)` |  | **border-radius** ↑: app.css:2267(010) `var(--radius)` → ui-sheets.css:626(020) `0`<br>**display** ↑: app.css:2259(010) `block` → ui-sheets.css:618(020) `flex`<br>**margin** ↑: app.css:2262(010) `0 0 6px` → ui-sheets.css:621(020) `0`<br>**padding** ↑: app.css:2263(010) `10px var(--space-3)` → ui-sheets.css:622(020) `var(--space-2) 40px var(` |
| `.onyx-you-nick` | `(base)` |  | **font-weight** ↑: app.css:2231(010) `650` → ui-sheets.css:604(020) `700`<br>**margin** ↑: app.css:2231(010) `var(--space-1) 0 0` → ui-sheets.css:604(020) `2px 0 0` |
| `.onyx-you-title` | `(base)` |  | **font-size** ↑: app.css:2230(010) `var(--text-lg)` → ui-sheets.css:598(020) `var(--text-xs)`<br>**margin** ↑: app.css:2230(010) `0` → ui-sheets.css:597(020) `5px 0 0` |
| `.pref-category-content` | `(base)` |  | **padding** ↑: app.css:3087(010) `var(--space-4)` → ui-sheets.css:676(020) `var(--space-5) var(--she` |
| `.pref-category-tab` | `[aria-selected=""]` |  | **border-color** ↑: app.css:3084(020) `var(--onyx-line)` → ui-sheets.css:675(030) `transparent` |
| `.pref-category-tab` | `(base)` |  | **min-height** ↑: app.css:3083(010) `44px` → ui-sheets.css:674(020) `48px`<br>**padding** ↑: app.css:3083(010) `6px 10px` → ui-sheets.css:674(020) `6px 12px` |
| `.pt-ico` | `(base)` | @media (max-width: 767.98px) | **height**: pol-shell.css:1262(040) `21px` → pol-roster.css:395(040) `20px` → pol-roster.css:395(040) `20px`<br>**width**: pol-shell.css:1262(040) `21px` → pol-roster.css:395(040) `20px` → pol-roster.css:395(040) `20px` |
| `.pt-ico` | `(base)` |  | **height** ↑ **flip**: pol-thread.css:30(010) `18px` → pol-thread.css:415(030) `16px` → pol-thread.css:441(030) `16px` → pol-thread.css:589(020) `16px` → pol-thread.css:617(020) `28px` → pol-thread.css:648(020) `14px` → pol-thread.css:666(020) `14px` → pol-thread.css:973(020) `16px` → pol-thread.css:1077(031) `20px` → pol-thread.css:1151(030) `16px` → pol-thread.css:1337(020) `16px` → pol-thread.css:1339(020) `18px` → pol-thread.css:1503(020) `14px` → pol-thread.css:1609(020) `16px` → pol-thread.css:1609(020) `16px` → pol-thread.css:1609(020) `16px` → pol-roster.css:84(020) `16px` → pol-roster.css:101(020) `14px` → pol-roster.css:170(020) `14px` → pol-roster.css:300(030) `16px`<br>**transform** ↑: pol-thread.css:666(020) `scaleY(-1)` → pol-thread.css:1505(040) `rotate(45deg)` → pol-roster.css:179(040) `rotate(-90deg)`<br>**width** ↑ **flip**: pol-thread.css:29(010) `18px` → pol-thread.css:415(030) `16px` → pol-thread.css:441(030) `16px` → pol-thread.css:589(020) `16px` → pol-thread.css:617(020) `28px` → pol-thread.css:648(020) `14px` → pol-thread.css:666(020) `14px` → pol-thread.css:973(020) `16px` → pol-thread.css:1077(031) `20px` → pol-thread.css:1151(030) `16px` → pol-thread.css:1337(020) `16px` → pol-thread.css:1339(020) `18px` → pol-thread.css:1503(020) `14px` → pol-thread.css:1609(020) `16px` → pol-thread.css:1609(020) `16px` → pol-thread.css:1609(020) `16px` → pol-roster.css:84(020) `16px` → pol-roster.css:101(020) `14px` → pol-roster.css:169(020) `14px` → pol-roster.css:300(030) `16px` |
| `.r-btn` | `(base)` |  | **background** **flip**: pol-stats.css:105(020) `var(--pg-raised)` → pol-public.css:423(010) `transparent`<br>**border** **flip**: pol-stats.css:102(020) `1px solid var(--pg-line)` → pol-public.css:420(010) `1px solid var(--onyx-lin`<br>**color** **flip**: pol-stats.css:104(020) `var(--pg-text)` → pol-public.css:422(010) `var(--onyx-text)`<br>**font-size**: pol-stats.css:106(020) `var(--text-md)` → pol-public.css:1087(020) `var(--text-sm)`<br>**line-height** **flip**: pol-stats.css:108(020) `var(--leading-tight)` → pol-public.css:426(010) `1.2`<br>**min-height**: pol-stats.css:100(020) `var(--target-min)` → pol-public.css:418(010) `var(--target-min)` → pol-public.css:1087(020) `36px` → pol-public.css:1411(020) `48px`<br>**padding** **flip**: pol-stats.css:101(020) `var(--space-2) var(--spa` → pol-public.css:419(010) `0 var(--space-5)` → pol-public.css:1087(020) `0 var(--space-3)` |
| `.r-section` | `(base)` |  | **padding-block** **flip**: pol-stats.css:49(020) `clamp(var(--space-7), 5v` → pol-public.css:356(010) `var(--space-7) 0` |
| `.room-notify` | `(base)` |  | **border-bottom** ↑: app.css:2126(010) `1px solid var(--onyx-lin` → roomsettings.css:22(020) `0`<br>**display** ↑: app.css:2126(010) `flex` → pol-shell.css:989(020) `grid`<br>**gap** ↑: app.css:2126(010) `6px` → pol-shell.css:991(020) `2px`<br>**padding** ↑: app.css:2126(010) `6px var(--space-3)` → pol-shell.css:992(020) `0` → roomsettings.css:22(020) `0` |
| `.room-notify-name` | `(base)` |  | **color** ↑: app.css:2127(010) `var(--onyx-dim)` → pol-shell.css:1002(020) `var(--onyx-text)`<br>**font-size** ↑: app.css:2127(010) `var(--text-2xs)` → pol-shell.css:1001(020) `var(--text-sm)` |
| `.room-notify-seg` | `(base)` |  | **background** ↑: app.css:2128(010) `transparent` → pol-shell.css:1010(020) `var(--onyx-bg)`<br>**color** ↑: app.css:2128(010) `var(--onyx-text)` → pol-shell.css:1009(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:2128(010) `var(--text-2xs)` → pol-shell.css:1008(020) `var(--text-sm)`<br>**padding** ↑: app.css:2128(010) `2px 10px` → pol-shell.css:1007(020) `0 var(--space-2)` |
| `.room-notify-seg` | `[aria-checked=""]` |  | **border-color** ↑: app.css:2129(020) `var(--onyx-accent)` → pol-shell.css:1014(030) `var(--onyx-dim)`<br>**color** ↑: app.css:2129(020) `var(--onyx-accent)` → pol-shell.css:1014(030) `var(--onyx-text)`<br>**font-weight** ↑: app.css:2129(020) `600` → pol-shell.css:1014(030) `650` |
| `.shell-command-item` | `(base)` |  | **align-items** ↑: app.css:2420(020) `baseline` → pol-thread.css:1263(030) `center`<br>**border-radius** ↑: app.css:2425(020) `var(--radius)` → pol-thread.css:1263(030) `4px` |
| `.shell-command-usage` | `(base)` |  | **font-weight** ↑: app.css:2433(010) `650` → pol-thread.css:1266(020) `600` |
| `.shell-composer-popovers` | `(base)` |  | **bottom** ↑: app.css:2393(010) `calc(100% + 6px)` → pol-thread.css:1249(020) `calc(100% - var(--space-`<br>**left** ↑: app.css:2391(010) `16px` → pol-thread.css:1249(020) `var(--space-4)`<br>**right** ↑: app.css:2392(010) `16px` → pol-thread.css:1249(020) `var(--space-4)` |
| `.shell-emoji-choice` | `(base)` |  | **border-radius** ↑: app.css:2464(020) `var(--radius)` → pol-thread.css:1281(030) `4px`<br>**padding** ↑: app.css:2467(020) `6px 0` → pol-thread.css:1281(030) `0` |
| `.shell-emoji-grid` | `(base)` |  | **grid-template-columns** ↑: app.css:2456(010) `repeat(auto-fill, minmax` → pol-thread.css:1280(020) `repeat(auto-fill, minmax`<br>**max-height** ↑: app.css:2458(010) `200px` → pol-thread.css:1280(020) `220px` |
| `.shell-emoji-picker` | `(base)` |  | **width** ↑: app.css:2445(010) `min(320px, 100%)` → pol-thread.css:1269(020) `min(340px, 100%)` |
| `.shell-ribbon-badge` | `(base)` |  | **background** ↑: app.css:3595(010) `var(--onyx-panel-2)` → pol-shell.css:650(020) `var(--onyx-accent)`<br>**border** ↑: app.css:3596(010) `1px solid var(--onyx-lin` → pol-shell.css:651(020) `0`<br>**color** ↑: app.css:3594(010) `var(--onyx-text)` → pol-shell.css:649(020) `var(--onyx-accent-ink)`<br>**font-size** ↑: app.css:3590(010) `var(--text-xs)` → pol-shell.css:647(020) `10px`<br>**line-height** ↑: app.css:3592(010) `18px` → pol-shell.css:648(020) `16px`<br>**min-width** ↑: app.css:3588(010) `18px` → pol-shell.css:644(020) `16px`<br>**padding** ↑: app.css:3589(010) `0 var(--space-1)` → pol-shell.css:646(020) `0 4px` |
| `.shell-ribbon-bell` | `(base)` |  | **color** ↑: app.css:3561(010) `var(--onyx-text)` → pol-shell.css:634(020) `var(--onyx-dim)`<br>**min-height** ↑: app.css:3557(010) `32px` → pol-shell.css:632(020) `36px`<br>**padding** ↑: app.css:3558(010) `0 var(--space-3)` → pol-shell.css:633(020) `0` |
| `.shell-ribbon-bell-icon` | `(base)` |  | **height** **flip**: pol-shell.css:639(020) `20px` → ui-sheets.css:568(010) `18px`<br>**width** **flip**: pol-shell.css:639(020) `20px` → ui-sheets.css:567(010) `18px` |
| `.shortcuts-overlay` | `(base)` |  | **gap** ↑: app.css:2840(010) `14px` → ui-sheets.css:487(020) `var(--space-5)` |
| `.sub` | `(base)` |  | **color** **flip**: pol-stats.css:422(030) `var(--pg-dim)` → pol-public.css:394(020) `var(--onyx-dim)`<br>**margin** **flip**: pol-stats.css:421(030) `var(--space-2) 0 0` → pol-public.css:393(020) `var(--space-4) 0 0`<br>**max-width** **flip**: pol-stats.css:420(030) `55ch` → pol-public.css:392(020) `62ch` |
| `.topic-chip` | `(base)` |  | **font-size**: app.css:193(010) `12px` → pol-thread.css:626(010) `var(--text-sm)` |
| `.you` | `.boost-pill` |  | **border-color** ↑: app.css:2492(020) `var(--onyx-accent)` → app.css:3848(020) `var(--onyx-dim)` → pol-thread.css:411(030) `color-mix(in oklab, var(` |

## G15. Specificity

Histogram (a,b,c → selectors): 0,0,0→15 · 0,0,1→7 · 0,1,0→2450 · 0,1,1→291 · 0,1,2→29 · 0,1,3→2 · 0,2,0→1212 · 0,2,1→181 · 0,2,2→17 · 0,3,0→391 · 0,3,1→53 · 0,3,2→5 · 0,4,0→60 · 0,4,1→15 · 0,5,0→5 · 0,5,1→2 · 0,6,0→1 · 1,2,0→1 · 1,3,0→1

Outliers (103: ids, ≥4 class-level parts, or ≥4 compounds deep):

| file:line | selector | specificity | compounds |
|---|---|---|---|
| pol-shell.css:1452 | `.onyx-rail[data-collection="rooms"]:not(:has(> [data-testid="sidebar-favorites"])) #sidebar-channels-label` | 1,3,0 | 2 |
| pol-shell.css:1452 | `.onyx-rail[data-collection="messages"] #sidebar-dms-label` | 1,2,0 | 2 |
| pol-thread.css:1071 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool:hover:not(:disabled)` | 0,6,0 | 4 |
| app.css:3271 | `.onyx-call-stage[data-motion="still"] .onyx-call-person[data-speaking="true"] .onyx-call-ring::after` | 0,5,1 | 3 |
| pol-thread.css:1100 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool--more[aria-expanded='true` | 0,5,1 | 4 |
| pol-thread.css:256 | `.onyx-message:hover:not(:focus-within):not(.onyx-message--active) > .onyx-row-actions` | 0,5,0 | 2 |
| pol-thread.css:1073 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool:disabled` | 0,5,0 | 4 |
| pol-thread.css:1075 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool[aria-expanded='true']` | 0,5,0 | 4 |
| pol-thread.css:1078 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool > .shell-composer-action-` | 0,5,0 | 5 |
| pol-thread.css:1116 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(:disabled)` | 0,5,0 | 3 |
| pol-stats.css:602 | `.stats-page .stats-feed-step[data-step-state='current'] .stats-feed-step__heading > strong` | 0,4,1 | 4 |
| pol-stats.css:603 | `.stats-page .stats-feed-step[data-step-state='attention'] .stats-feed-step__heading > strong` | 0,4,1 | 4 |
| pol-stats.css:604 | `.stats-page .stats-feed-step[data-step-state='unavailable'] .stats-feed-step__heading > strong` | 0,4,1 | 4 |
| pol-stats.css:685 | `.stats-page :is(.stats-window-options, .stats-control-group) button:hover:not(:disabled)` | 0,4,1 | 3 |
| pol-stats.css:955 | `.stats-page .data-list > div > .data-room-row:first-child` | 0,4,1 | 4 |
| pol-stats.css:1052 | `.stats-page :is(.stats-refresh, .data-action, .public-room-comparison__share, .public-room-comparison__clear, ` | 0,4,1 | 2 |
| pol-studio.css:556 | `.background-picker__card[data-kind='scene'] .background-picker__swatch i:nth-child(2)` | 0,4,1 | 3 |
| pol-thread.css:1071 | `.onyx-composer .onyx-composer-bar > button:hover:not(:disabled)` | 0,4,1 | 3 |
| pol-thread.css:1091 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool--more::before` | 0,4,1 | 4 |
| calls-c4.css:42 | `.onyx-cq[data-tier="2"] .onyx-cq-bars > span[data-on="true"]` | 0,4,1 | 3 |
| calls-c4.css:44 | `.onyx-cq[data-tier="3"] .onyx-cq-bars > span[data-on="true"]` | 0,4,1 | 3 |
| ui-sheets.css:328 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)::before` | 0,4,1 | 3 |
| ui-sheets.css:824 | `.onyx-sheet :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea)` | 0,4,1 | 2 |
| ui-sheets.css:826 | `.onyx-sheet :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select)` | 0,4,1 | 2 |
| ui-sheets.css:1028 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button:active` | 0,4,1 | 4 |
| app.css:3517 | `.onyx-primary-nav .onyx-nav-btn:hover .onyx-nav-label` | 0,4,0 | 3 |
| app.css:3517 | `.onyx-primary-nav .onyx-nav-btn:focus-visible .onyx-nav-label` | 0,4,0 | 3 |
| pol-stats.css:118 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary:hover` | 0,4,0 | 2 |
| pol-stats.css:121 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary:focus-visible` | 0,4,0 | 2 |
| pol-stats.css:453 | `.stats-page .stats-observation[data-feed-state='current'] .stats-observation__marker` | 0,4,0 | 3 |
| pol-stats.css:453 | `.stats-page .public-room-comparison__ledger[data-state='current'] .public-room-comparison__marker` | 0,4,0 | 3 |
| pol-stats.css:456 | `.stats-page .stats-observation:is([data-feed-state='partial'], [data-feed-state='stale'], [data-feed-state='fu` | 0,4,0 | 3 |
| pol-stats.css:456 | `.stats-page .public-room-comparison__ledger[data-state='snapshot'] .public-room-comparison__marker` | 0,4,0 | 3 |
| pol-stats.css:459 | `.stats-page .stats-observation:is([data-feed-state='unknown'], [data-feed-state='unavailable']) .stats-observa` | 0,4,0 | 3 |
| pol-stats.css:461 | `.stats-page .stats-observation[data-feed-state='loading'] .stats-observation__marker` | 0,4,0 | 3 |
| pol-stats.css:461 | `.stats-page .public-room-comparison__ledger[data-state='loading'] .public-room-comparison__marker` | 0,4,0 | 3 |
| pol-stats.css:513 | `.stats-page :is(.stats-refresh, .data-action, .public-room-comparison__share, .public-room-comparison__clear, ` | 0,4,0 | 2 |
| pol-stats.css:535 | `.stats-page .stats-summary > .data-metric:nth-child(odd)` | 0,4,0 | 3 |
| pol-stats.css:536 | `.stats-page .stats-summary > .data-metric:nth-child(n + 3)` | 0,4,0 | 3 |
| pol-stats.css:742 | `.stats-page .stats-spotlight-metrics .data-metric .value` | 0,4,0 | 4 |
| pol-stats.css:972 | `.stats-page .data-action:is(.data-action--compare, .data-action--inspect)[aria-pressed='true']` | 0,4,0 | 2 |
| pol-stats.css:1045 | `.stats-page .stats-summary > .data-metric:first-child` | 0,4,0 | 3 |
| pol-stats.css:1072 | `.stats-page .stats-observation[data-feed-state='current'] .stats-observation__marker` | 0,4,0 | 3 |
| pol-studio.css:769 | `.ts-studio .onyx-button--ghost:hover:not(:disabled)` | 0,4,0 | 2 |
| pol-studio.css:780 | `.ts-studio .onyx-button--primary:hover:not(:disabled)` | 0,4,0 | 2 |
| pol-studio.css:1772 | `.ap :is(.ap-chip, .ap-theme-chip, .ts-theme-chip, .background-picker__card, .ts-scheme-toggle__btn, .ts-studio` | 0,4,0 | 2 |
| pol-shell.css:568 | `.onyx-frame[data-convo="false"] > .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| pol-shell.css:951 | `.onyx-frame .onyx-room-header .onyx-room-more-toggle[aria-expanded="true"]` | 0,4,0 | 3 |
| pol-shell.css:951 | `.onyx-frame .onyx-room-header .onyx-room-more-toggle[aria-expanded="true"]` | 0,4,0 | 3 |
| pol-shell.css:962 | `.onyx-frame .onyx-room-header .onyx-members-toggle:hover` | 0,4,0 | 3 |
| pol-shell.css:1078 | `.onyx-home .onyx-home-empty.is-first-room ~ .onyx-coach` | 0,4,0 | 3 |
| pol-shell.css:1203 | `.onyx-frame:not([data-convo="false"]):not([data-nav-drawer="true"]) > .onyx-topbar` | 0,4,0 | 2 |
| pol-shell.css:1203 | `.onyx-frame:not([data-convo="false"]):not([data-nav-drawer="true"]) > .onyx-mobile-nav` | 0,4,0 | 2 |
| pol-shell.css:1206 | `.onyx-frame:not([data-convo="false"]):not([data-nav-drawer="true"]) > .onyx-main` | 0,4,0 | 2 |
| pol-shell.css:1262 | `.onyx-frame .onyx-room-header .onyx-members-toggle .pt-ico` | 0,4,0 | 4 |
| pol-shell.css:1272 | `.onyx-frame .onyx-room-header .onyx-call-join .onyx-ci` | 0,4,0 | 4 |
| pol-shell.css:1336 | `.onyx-rail .onyx-rail-filter .onyx-rail-new .onyx-shi` | 0,4,0 | 4 |
| pol-shell.css:1467 | `:root[data-kb="open"] .onyx-frame > .onyx-main` | 0,4,0 | 3 |
| pol-thread.css:216 | `.onyx-thread > .onyx-message:first-child > .onyx-row-actions` | 0,4,0 | 3 |
| pol-thread.css:255 | `.onyx-message:hover:not(:focus-within):not(.onyx-message--active)` | 0,4,0 | 1 |
| pol-thread.css:413 | `.onyx-message .boost-pill.you .boost-count` | 0,4,0 | 3 |
| pol-thread.css:1054 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool` | 0,4,0 | 4 |
| pol-thread.css:1290 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool` | 0,4,0 | 4 |
| pol-thread.css:1505 | `.onyx-message-search__save[open] > .onyx-message-search__save-toggle .pt-ico` | 0,4,0 | 3 |
| pol-roster.css:117 | `.onyx-roster .onyx-roster-filter:not(.onyx-roster-filter--open):not(:focus-within)` | 0,4,0 | 2 |
| pol-roster.css:124 | `.onyx-roster:has(.onyx-roster-filter:focus-within) .onyx-mlist-find` | 0,4,0 | 2 |
| pol-roster.css:176 | `.onyx-roster-group:not([open]) > .onyx-mlist-group-head > .pt-ico` | 0,4,0 | 3 |
| pol-roster.css:179 | `.onyx-roster-group:not([open]) > .onyx-mlist-group-head > .pt-ico` | 0,4,0 | 3 |
| pol-roster.css:305 | `.onyx-roster .onyx-member:hover > .onyx-member-message` | 0,4,0 | 3 |
| pol-roster.css:305 | `.onyx-roster .onyx-member:focus-within > .onyx-member-message` | 0,4,0 | 3 |
| pol-roster.css:307 | `.onyx-roster .onyx-member:hover > .onyx-member-role--shown` | 0,4,0 | 3 |
| pol-roster.css:394 | `.onyx-roster:popover-open .onyx-mlist-find .pt-ico` | 0,4,0 | 3 |
| pol-roster.css:394 | `.onyx-roster:popover-open .onyx-mlist-close .pt-ico` | 0,4,0 | 3 |
| pol-roster.css:398 | `.onyx-roster:popover-open .onyx-mlist-group-head > .pt-ico` | 0,4,0 | 3 |
| pol-public.css:1648 | `.public-frame :is(.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .guid` | 0,4,0 | 2 |
| calls-c6.css:226 | `.onyx-sheet-layer.onyx-call-ring-layer > .onyx-sheet.onyx-call-ring` | 0,4,0 | 2 |
| calls-c6.css:266 | `.onyx-call-stage[data-reconnecting="true"] .onyx-cbtn:disabled` | 0,4,0 | 2 |
| calls-c4.css:157 | `.onyx-call-grid > .onyx-tile:nth-child(n+5) .onyx-tile-video` | 0,4,0 | 3 |
| ui-sheets.css:316 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet:has(> :is(.onyx-sheet-head, .jump-to-date-head))` | 0,4,0 | 2 |
| ui-sheets.css:342 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)` | 0,4,0 | 3 |
| ui-sheets.css:542 | `.notif-center .notif-center__row:hover .notif-center__dismiss` | 0,4,0 | 3 |
| ui-sheets.css:542 | `.notif-center .notif-center__row:focus-within .notif-center__dismiss` | 0,4,0 | 3 |
| ui-sheets.css:741 | `.chb .chb-row + .chb-row .chb-card` | 0,4,0 | 4 |
| pol-ios.css:110 | `:root[data-kb="open"] .onyx-frame > .onyx-mobile-nav` | 0,4,0 | 3 |
| pol-ios.css:112 | `:root[data-kb="open"] .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| app.css:2943 | `.onyx-moddesk-sheet .moderation-desk__rail > div span:first-child` | 0,3,2 | 4 |
| pol-stats.css:825 | `.stats-page .stats-heatmap thead th:first-child` | 0,3,2 | 4 |
| pol-stats.css:904 | `.stats-page .public-room-comparison__table tr:last-child :is(th, td)` | 0,3,2 | 4 |
| pol-stats.css:906 | `.stats-page .public-room-comparison__table thead th:first-child` | 0,3,2 | 4 |
| pol-stats.css:559 | `.stats-page .stats-primary-metric .note i` | 0,3,1 | 4 |
| pol-stats.css:659 | `.stats-page .data-card .stats-window-copy p` | 0,3,1 | 4 |
| pol-thread.css:1077 | `.onyx-composer .onyx-composer-bar > button .pt-ico` | 0,3,1 | 4 |
| pol-thread.css:1078 | `.onyx-composer .onyx-composer-bar > button > .shell-composer-action-label` | 0,3,1 | 4 |
| calls-c8.css:119 | `.onyx-call-sheet-layer .onyx-voice-settings .onyx-call-sheet-head h2` | 0,3,1 | 4 |
| ui-sheets.css:200 | `.onyx-sheet-layer .onyx-sheet .onyx-sheet-head-actions > button` | 0,3,1 | 4 |
| ui-sheets.css:850 | `.onyx-sheet-layer .onyx-sheet .onyx-sheet-head-actions > button` | 0,3,1 | 4 |
| ui-sheets.css:950 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button` | 0,3,1 | 4 |
| ui-sheets.css:985 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button` | 0,3,1 | 4 |
| pol-stats.css:825 | `.stats-page .stats-heatmap tbody th` | 0,2,2 | 4 |
| pol-stats.css:883 | `.stats-page .public-room-comparison__prompt p strong` | 0,2,2 | 4 |
| pol-stats.css:905 | `.stats-page .public-room-comparison__table thead th` | 0,2,2 | 4 |
| pol-stats.css:907 | `.stats-page .public-room-comparison__table tbody th` | 0,2,2 | 4 |
| pol-stats.css:909 | `.stats-page .public-room-comparison__table td strong` | 0,2,2 | 4 |

## G16. Dead rules (selectors matching nothing the Elm views render)

Method: a class is live when it appears as a whitespace-separated token in any Elm string literal under src/ (comments excluded), in a ports.js / media/*.ts string, or extends a literal dynamic prefix (a literal ending in "-"/"_" followed by `++`). Everything else is dead. Data-attribute selectors are dead when the attribute is never written. 64 rules (221 declarations) are fully dead; 7 rules carry dead selector-list members; 49 distinct styled classes are never emitted.

Dynamic prefixes honoured: `guides-page-- (src/View/Guides.elm:247)`, `onyx-home-outbox- (src/View/Home.elm:243)`, `onyx-land-sketch-avatar-- (src/View/Landing.elm:103)`, `onyx-land-claim-icon-- (src/View/Landing.elm:189)`, `public-info-page-- (src/View/PublicInfo.elm:140)`, `onyx-button-- (src/View/Studio.elm:174)`, `ts-audit__badge-- (src/View/Studio.elm:1151)`, `onyx-toast-- (src/View/Toast.elm:39)`, `trust-page-- (src/View/Trust.elm:223)`.

### G16.1 Fully dead rules

| file:line | selector | decls | never emitted |
|---|---|---|---|
| app.css:463 | `.onyx-rail-count` | 3 | `.onyx-rail-count` |
| app.css:609 | `.onyx-newmsg-header` | 3 | `.onyx-newmsg-header` |
| app.css:610 | `.onyx-newmsg-header > div:nth-child(2)` | 2 | `.onyx-newmsg-header` |
| app.css:611 | `.onyx-newmsg-header h2` | 2 | `.onyx-newmsg-header` |
| app.css:612 | `.onyx-newmsg-mark` | 3 | `.onyx-newmsg-mark` |
| app.css:613 | `.onyx-newmsg-eyebrow` | 5 | `.onyx-newmsg-eyebrow` |
| app.css:620 | `.onyx-newmsg-close` | 8 | `.onyx-newmsg-close` |
| app.css:734 | `.onyx-member-prefix` | 3 | `.onyx-member-prefix` |
| app.css:794 | `.onyx-calls-toggle` | 7 | `.onyx-calls-toggle` |
| app.css:804 | `.onyx-calls-toggle-open` | 2 | `.onyx-calls-toggle-open` |
| app.css:1204 | `.chb-head` | 3 | `.chb-head` |
| app.css:1205 | `.chb-title` | 2 | `.chb-title` |
| app.css:1206 | `.chb-desc` | 3 | `.chb-desc` |
| app.css:1207 | `.chb-close` | 5 | `.chb-close` |
| app.css:1236 | `.chb-eyebrow` | 2 | `.chb-eyebrow` |
| app.css:1237 | `.chb-create-header h2` | 2 | `.chb-create-header` |
| app.css:1238 | `.chb-create-lead` | 2 | `.chb-create-lead` |
| app.css:1268 | `.onyx-composer .onyx-schedule-open` | 7 | `.onyx-schedule-open` |
| app.css:1278 | `.onyx-composer .onyx-schedule-open:disabled` | 2 | `.onyx-schedule-open` |
| app.css:1362 | `.onyx-scheduled-head` | 3 | `.onyx-scheduled-head` |
| app.css:1363 | `.onyx-scheduled-title` | 3 | `.onyx-scheduled-title` |
| app.css:1365 | `.onyx-scheduled-desc` | 3 | `.onyx-scheduled-desc` |
| app.css:1402 | `.onyx-account-head` | 3 | `.onyx-account-head` |
| app.css:1403 | `.onyx-account-title` | 3 | `.onyx-account-title` |
| app.css:1404 | `.onyx-account-close` | 6 | `.onyx-account-close` |
| app.css:1542 | `.onyx-steward-head` | 3 | `.onyx-steward-head` |
| app.css:1543 | `.onyx-steward-title` | 3 | `.onyx-steward-title` |
| app.css:1544 | `.onyx-steward-room` | 2 | `.onyx-steward-room` |
| app.css:1545 | `.onyx-steward-close` | 5 | `.onyx-steward-close` |
| app.css:1666 | `.onyx-member-profile` | 8 | `.onyx-member-profile` |
| app.css:1676 | `.onyx-member-profile:hover` | 2 | `.onyx-member-profile` |
| app.css:1688 | `.onyx-profile-head` | 3 | `.onyx-profile-head` |
| app.css:1689 | `.onyx-profile-title` | 2 | `.onyx-profile-title` |
| app.css:1690 | `.onyx-profile-desc` | 3 | `.onyx-profile-desc` |
| app.css:1691 | `.onyx-profile-close` | 8 | `.onyx-profile-close` |
| app.css:1720 | `.onyx-member-nick` | 8 | `.onyx-member-nick` |
| app.css:1730 | `.onyx-member-nick:hover` | 1 | `.onyx-member-nick` |
| app.css:1743 | `.onyx-member-avatar` | 10 | `.onyx-member-avatar` |
| app.css:2055 | `.onyx-leave` | 2 | `.onyx-leave` |
| app.css:2095 | `.notify-head` | 3 | `.notify-head` |
| app.css:2096 | `.notify-title` | 3 | `.notify-title` |
| app.css:2097 | `.notify-close` | 6 | `.notify-close` |
| app.css:2571 | `.onyx-roster .onyx-member-prefix` | 2 | `.onyx-member-prefix` |
| app.css:2573 | `.onyx-member-identity .onyx-member-nick` | 3 | `.onyx-member-nick` |
| app.css:2574 | `.onyx-away .onyx-member-nick` | 2 | `.onyx-member-nick` |
| app.css:2576 | `.onyx-member-row-actions` | 3 | `.onyx-member-row-actions` |
| app.css:2577 | `.onyx-member-row-actions .onyx-member-profile` | 1 | `.onyx-member-row-actions` `.onyx-member-profile` |
| app.css:2837 | `.onyx-shortcuts-header` | 4 | `.onyx-shortcuts-header` |
| app.css:2838 | `.onyx-shortcuts-header h2` | 2 | `.onyx-shortcuts-header` |
| app.css:2839 | `.onyx-shortcuts-description` | 3 | `.onyx-shortcuts-description` |
| app.css:3075 | `.onyx-prefs-head` | 5 | `.onyx-prefs-head` |
| app.css:3076 | `.onyx-prefs-head > div` | 2 | `.onyx-prefs-head` |
| app.css:3077 | `.onyx-prefs-title` | 2 | `.onyx-prefs-title` |
| app.css:3078 | `.onyx-prefs-desc` | 3 | `.onyx-prefs-desc` |
| app.css:3079 | `.onyx-prefs-close` | 7 | `.onyx-prefs-close` |
| app.css:3616 | `.notif-center__head` | 3 | `.notif-center__head` |
| app.css:3617 | `.notif-center__head > span` | 2 | `.notif-center__head` |
| app.css:3839 | `.onyx-member-prefix` | 1 | `.onyx-member-prefix` |
| app.css:3852 | `.onyx-newmsg-mark` | 1 | `.onyx-newmsg-mark` |
| pol-shell.css:47 | `.notif-center__head` | 2 | `.notif-center__head` |
| pol-shell.css:48 | `.notif-center__title` | 3 | `.notif-center__title` |
| pol-shell.css:49 | `.notif-center .notif-center__close` | 6 | `.notif-center__close` |
| pol-shell.css:303 | `.chb .chb-close` | 4 | `.chb-close` |
| pol-public.css:1372 | `.invite-preview-title` | 1 | `.invite-preview-title` |

### G16.2 Rules with dead selector-list members

| file:line | dead members |
|---|---|
| app.css:2003 | `.onyx-leave` |
| app.css:2629 | `.onyx-shortcuts-close:focus-visible` |
| app.css:2698 | `.onyx-shortcuts-close` |
| app.css:3574 | `.onyx-calls-toggle-open` |
| ui-sheets.css:214 | `.notif-center__close`<br>`.onyx-shortcuts-close` |
| ui-sheets.css:238 | `.onyx-shortcuts-close:focus-visible` |
| ui-sheets.css:996 | `.notif-center__close:hover`<br>`.onyx-shortcuts-close:hover` |

### G16.3 Never-emitted classes

`.chb-close` (app.css,pol-shell.css) · `.chb-create-header` (app.css) · `.chb-create-lead` (app.css) · `.chb-desc` (app.css) · `.chb-eyebrow` (app.css) · `.chb-head` (app.css) · `.chb-title` (app.css) · `.invite-preview-title` (pol-public.css) · `.notif-center__close` (pol-shell.css,ui-sheets.css) · `.notif-center__head` (app.css,pol-shell.css) · `.notif-center__title` (pol-shell.css) · `.notify-close` (app.css) · `.notify-head` (app.css) · `.notify-title` (app.css) · `.onyx-account-close` (app.css) · `.onyx-account-head` (app.css) · `.onyx-account-title` (app.css) · `.onyx-calls-toggle` (app.css) · `.onyx-calls-toggle-open` (app.css) · `.onyx-leave` (app.css) · `.onyx-member-avatar` (app.css) · `.onyx-member-nick` (app.css) · `.onyx-member-prefix` (app.css) · `.onyx-member-profile` (app.css) · `.onyx-member-row-actions` (app.css) · `.onyx-newmsg-close` (app.css) · `.onyx-newmsg-eyebrow` (app.css) · `.onyx-newmsg-header` (app.css) · `.onyx-newmsg-mark` (app.css) · `.onyx-prefs-close` (app.css) · `.onyx-prefs-desc` (app.css) · `.onyx-prefs-head` (app.css) · `.onyx-prefs-title` (app.css) · `.onyx-profile-close` (app.css) · `.onyx-profile-desc` (app.css) · `.onyx-profile-head` (app.css) · `.onyx-profile-title` (app.css) · `.onyx-rail-count` (app.css) · `.onyx-schedule-open` (app.css) · `.onyx-scheduled-desc` (app.css) · `.onyx-scheduled-head` (app.css) · `.onyx-scheduled-title` (app.css) · `.onyx-shortcuts-close` (app.css,ui-sheets.css) · `.onyx-shortcuts-description` (app.css) · `.onyx-shortcuts-header` (app.css) · `.onyx-steward-close` (app.css) · `.onyx-steward-head` (app.css) · `.onyx-steward-room` (app.css) · `.onyx-steward-title` (app.css)

### G16.4 Attribute values never seen as literals (lower confidence: the value may be computed)

| file:line | selector | unseen |
|---|---|---|
| pol-shell.css:538 | `.onyx-shi[data-icon="bell"]` | `[data-icon="bell"]` |
| pol-thread.css:82 | `.pt-ico[data-icon="calendar"]` | `[data-icon="calendar"]` |
| pol-thread.css:83 | `.pt-ico[data-icon="chart"]` | `[data-icon="chart"]` |

### G16.5 Classes the views emit in class / classList that no stylesheet mentions (0)



## G17. Component families (classes by naming pattern, where each is defined)


### avatar / facepile (31 classes, 6 multi-file, 1 dead)

| defined in | classes |
|---|---|
| app.css | `.onyx-avatar--md` `.onyx-avatar--owner` `.onyx-avatar--service` `.onyx-call-avatar-md` `.onyx-call-avatar-sm` `.onyx-facepile-away` `.onyx-facepile-face` `.onyx-facepile-overflow` `.onyx-home-avatar` `.onyx-home-avatar-person` `.onyx-member-avatar` **dead** `.onyx-member-avatar-slot` |
| pol-shell.css | `.onyx-call-ring-avatar` `.onyx-face` `.onyx-ident-avatar` `.onyx-room-header-avatar` `.onyx-you-avatar` |
| pol-public.css | `.onyx-land-sketch-avatar` `.onyx-land-sketch-avatar--gold` `.onyx-land-sketch-avatar--lapis` `.onyx-land-sketch-avatar--shu` |
| pol-thread.css | `.onyx-room-intro-face` `.onyx-row-avatar` `.onyx-thread-msg-face` |
| app.css + pol-shell.css + pol-thread.css + pol-roster.css | `.onyx-avatar` |
| app.css + pol-roster.css | `.onyx-avatar--sm` |
| app.css + calls-c6.css | `.onyx-call-avatar` |
| app.css + calls-c4.css | `.onyx-call-avatar-lg` |
| app.css + pol-shell.css + roomsettings.css | `.onyx-facepile` |
| app.css + pol-shell.css + account2.css | `.onyx-rail-avatar` |
| calls-c4.css | `.onyx-tile-avatar` |

### divider (4 classes, 2 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css + pol-thread.css | `.onyx-day-divider` `.onyx-day-divider-label` |
| pol-public.css | `.ab-seam` |
| pol-stats.css | `.r-divider` |

### sheet / dialog / popover (65 classes, 21 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.guest-claim-sheet` `.guest-claim-sheet__actions` `.guest-claim-sheet__cancel` `.guest-claim-sheet__error` `.guest-claim-sheet__hint` `.guest-claim-sheet__label` `.guest-claim-sheet__lede` `.guest-claim-sheet__submit` `.jump-to-date-sheet` `.onyx-call-sheet-body` `.onyx-call-sheet-close` `.onyx-call-sheet-head` `.onyx-overlays` `.onyx-profile-sheet` `.shortcuts-overlay__desc` `.shortcuts-overlay__group-name` `.shortcuts-overlay__kbd` `.shortcuts-overlay__keys` `.shortcuts-overlay__rows` `.shortcuts-overlay__sep` |
| app.css + ui-sheets.css | `.guest-claim-sheet__form` `.onyx-moddesk-sheet` `.onyx-newmsg-sheet` `.onyx-sheet-backdrop` `.onyx-sheet-close` `.onyx-sheet-title` `.onyx-shortcuts-sheet` `.onyx-spotlight-backdrop` `.shortcuts-overlay` `.shortcuts-overlay__row` |
| pol-thread.css | `.onyx-react-backdrop` `.shell-msg-lightbox` `.shell-msg-lightbox-actions` `.shell-msg-lightbox-backdrop` `.shell-msg-lightbox-close` `.shell-msg-lightbox-dialog` `.shell-msg-lightbox-img` `.shell-msg-lightbox-save` |
| ui-sheets.css | `.onyx-sheet-grip` `.onyx-sheet-head-actions` `.onyx-sheet-heading` `.onyx-sheet-kicker` `.onyx-sheet-spacer` `.onyx-sheet-sub` `.onyx-sheet-x` |
| polish.css | `.a2hs-sheet__actions` `.a2hs-sheet__detail` `.a2hs-sheet__status` `.onyx-sheet-lede` |
| app.css + pol-thread.css | `.onyx-msg-menu-backdrop` `.onyx-thread-sheet` `.shell-composer-popovers` |
| account2.css | `.a2-sheet` |
| polish.css + pol-ios.css | `.a2hs-sheet` |
| calls-c6.css | `.onyx-call-ring-layer` |
| app.css + calls-c11.css | `.onyx-call-sheet` |
| app.css + pol-shell.css | `.onyx-nav-btn--dialog-open` |
| pol-shell.css + ui-sheets.css | `.onyx-profile-backdrop` |
| app.css + pol-shell.css + ui-sheets.css | `.onyx-room-more-scrim` |
| app.css + calls-c11.css + calls-c6.css + ui-sheets.css | `.onyx-sheet` |
| app.css + roomsettings.css + ui-sheets.css | `.onyx-sheet-head` |
| app.css + calls-c6.css + ui-sheets.css + pol-ios.css | `.onyx-sheet-layer` |
| calls-c11.css | `.onyx-stage-hands-sheet-list` |
| pol-public.css | `.onyxos-source__sheet` |
| pol-shell.css | `.shortcuts-overlay__group` |

### heading / kicker / label (192 classes, 20 multi-file, 11 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-eyebrow` **dead** `.chb-invite-heading` `.chb-invite-label` `.chb-skin-label` `.chb-title` **dead** `.conn-alt-title` `.conn-hint` `.conn-label` `.conn-title` `.jump-to-date__hint` `.moderation-cockpit__hint` `.notify-group-title` `.notify-hint` `.notify-title` **dead** `.onyx-account-passkey-meta` `.onyx-account-persona-offers-label` `.onyx-account-section__title` `.onyx-account-title` **dead** `.onyx-call-hint` `.onyx-calls-kicker` `.onyx-calls-rooms-title` `.onyx-calls-title` `.onyx-dmsafe-kicker` `.onyx-dmsafe-number-label` `.onyx-home-label` `.onyx-invshare-label` `.onyx-keychange-col-label` `.onyx-keychange-kicker` `.onyx-keychange-lede` `.onyx-keychange-sub` `.onyx-keychange-title` `.onyx-member-meta` `.onyx-moddesk-eyebrow` `.onyx-moddesk-hint` `.onyx-moderation-title` `.onyx-nav-label` `.onyx-newmsg-eyebrow` **dead** `.onyx-newmsg-hint` `.onyx-prefs-title` **dead** `.onyx-profile-title` **dead** `.onyx-reclaim-label` `.onyx-schedule-headings` `.onyx-schedule-sub` `.onyx-schedule-title` `.onyx-scheduled-meta` `.onyx-scheduled-title` **dead** `.onyx-steward-label` `.onyx-steward-title` **dead** `.person-safety__note-label` `.person-safety__title` `.pref-label` `.pref-section-title` |
| pol-public.css | `.a11y-kicker` `.a11y-lede` `.ab-eyebrow` `.ab-kicker` `.ab-lede` `.ab-scene__label` `.ab-scene__title` `.ab-title` `.dl-checksum-label` `.dl-kicker` `.dl-lede` `.dl-section-title` `.guides-index__eyebrow` `.guides-kicker` `.guides-route__title` `.guides-route-map__eyebrow` `.guides-share__eyebrow` `.guides-snapshot__eyebrow` `.invite-lede` `.invite-preview-title` **dead** `.onyx-land-kicker` `.onyx-land-sketch-caption` `.onyx-land-sketch-meta` `.onyxos-eyebrow` `.onyxos-lede` `.onyxos-section-heading` `.public-frame__current-kicker` `.public-frame__current-label` `.public-frame__footer-title` `.public-frame__nav-more-title` `.trust-article-heading` |
| pol-thread.css | `.onyx-intro-title` `.onyx-message-search__section-title` `.onyx-message-search__target-kicker` `.onyx-message-search__vault-label` `.onyx-outbox-label` `.onyx-room-intro-title` `.onyx-thread-headings` `.onyx-thread-msg-meta` `.pins-context-kicker` `.pins-title` `.room-media-index-context-kicker` `.room-media-index-meta` `.room-media-index-title` `.shell-composer-context-label` `.shell-msg-preview-title` `.shell-msg-spoiler-label` |
| pol-studio.css | `.ap-background-stage__heading` `.ap-ghint` `.ap-glabel` `.ap-label` `.ap-lede` `.ap-readiness-title` `.onyx-field__label` `.ts-audit__label` `.ts-eyebrow` `.ts-factory__hint` `.ts-preview__bar-title` `.ts-section__heading` `.ts-simple-look__hint` `.ts-token-label` |
| calls-c8.css | `.onyx-call-caption` `.onyx-call-caption-nick` `.onyx-call-caption-text` `.onyx-call-caption-tr` `.onyx-call-caption-translate` `.onyx-call-captions` `.onyx-call-captions-copy` `.onyx-call-captions-head` `.onyx-call-captions-log` `.onyx-call-captions-source` `.onyx-call-captions-state` `.onyx-call-captions-title` `.onyx-vs-label` `.onyx-vs-title` |
| pol-stats.css | `.data-room-heading` `.public-room-comparison__lede` `.r-title` `.roadmap-kicker` `.roadmap-lede` `.stats-chart-caption` `.stats-feed-step__heading` `.stats-title-accent` `.status-kicker` `.status-lede` `.status-observation__label` |
| pol-shell.css | `.conn-strength-label` `.notif-center__title` **dead** `.onyx-account-section__subtitle` `.onyx-conn-label` `.onyx-rail-line--sub` `.onyx-rail-new-label` `.onyx-rail-title` `.onyx-room-header-titles` `.onyx-room-more-title` `.onyx-topbar-title` |
| roomsettings.css | `.rset-access-meta` `.rset-bridge-label` `.rset-event-title` `.rset-group-indicator-label` `.rset-heading` `.rset-hint` `.rset-insights-title` `.rset-label` `.rset-readonly-label` `.rset-roles-label` |
| app.css + pol-shell.css | `.onyx-account-hint` `.onyx-call-join-label` `.onyx-coach-eyebrow` `.onyx-home-title` `.onyx-rail-label` `.onyx-rail-meta` `.onyx-rail-section-heading` `.onyx-rail-sub` |
| account2.css | `.a2-heading` `.a2-hint` `.a2-label` `.a2-ready__label` `.a2-reclaim__title` |
| app.css + ui-sheets.css | `.jump-to-date-title` `.onyx-you-group__hint` `.onyx-you-group__title` `.onyx-you-lede` `.onyx-you-title` |
| calls-c6.css | `.onyx-call-ring-kicker` `.onyx-call-ring-meta` `.onyx-call-ring-sub` `.onyx-call-ring-title` |
| pol-stats.css + pol-public.css | `.label` `.r-kicker` `.sub` |
| app.css + pol-public.css | `.onyx-land-lede` `.onyx-land-shelf-label` |
| pol-roster.css | `.onyx-mlist-group-title` `.onyx-mlist-title` |
| calls-c11.css | `.onyx-stage-hint` `.onyx-stage-title` |
| pol-shell.css + roomsettings.css | `.onyx-room-header-sub` |
| app.css + pol-thread.css | `.onyx-thread-title` |
| polish.css | `.time-scrubber__label` |

### button-like by declarations (per-instance class name) (94 classes, 11 multi-file, 4 dead)

| defined in | classes |
|---|---|
| app.css | `.conn-cancel` `.conn-link` `.jump-to-date__copy` `.jump-to-date__jump` `.jump-to-date__preset` `.notify-remove` `.onyx-account-cert-bind` `.onyx-account-cert-remove-go` `.onyx-account-data-download` `.onyx-account-data-history` `.onyx-account-device-publish` `.onyx-account-device-remove-legacy` `.onyx-account-drop-arm` `.onyx-account-drop-cancel` `.onyx-account-drop-go` `.onyx-account-email-save` `.onyx-account-keytrans-refresh` `.onyx-account-logout` `.onyx-account-passkey-add` `.onyx-account-passkey-cancel` `.onyx-account-passkey-refresh` `.onyx-account-passkey-remove` `.onyx-account-passkey-remove-go` `.onyx-account-passkey-rename` `.onyx-account-passkey-save` `.onyx-account-password-save` `.onyx-account-recovery-clear` `.onyx-account-recovery-copy` `.onyx-account-recovery-done` `.onyx-account-recovery-generate` `.onyx-account-recovery-refresh` `.onyx-account-refresh` `.onyx-account-session__drop` `.onyx-account-totp-confirm-go` `.onyx-account-totp-copy` `.onyx-account-totp-disable` `.onyx-account-totp-enroll` `.onyx-calls-room` `.onyx-home-room` `.onyx-keychange-accept` `.onyx-keychange-dismiss` `.onyx-keychange-retry` `.onyx-leave` **dead** `.onyx-member-nick` **dead** `.onyx-member-profile` **dead** `.onyx-reclaim-cancel` `.onyx-reconnect-retry` `.onyx-scheduled-cancel` `.pref-reset` `.shell-msg-channel-link` `.shell-topic-follow` |
| pol-thread.css | `.onyx-message-search__deep` `.onyx-message-search__saved-delete` `.onyx-message-search__saved-run` `.onyx-message-search__vault-mode` `.room-media-index-filter` `.room-media-index-jump` `.room-media-index-retry` `.shell-msg-media-consent` `.shell-msg-preview-consent` |
| pol-shell.css | `.onyx-account-persona-claim-go` `.onyx-account-persona-off` `.onyx-account-persona-wear` `.onyx-calls-join-video` `.onyx-calls-join-voice` `.onyx-calls-leave` `.onyx-calls-mute` |
| pol-public.css | `.dl-copy` `.guides-copy` `.guides-download` `.guides-reset` |
| app.css + pol-shell.css | `.onyx-call-join` `.onyx-coach-dismiss` `.onyx-dmsafe-trigger` `.shell-ribbon-bell` |
| account2.css | `.a2-link` `.a2-reclaim__dismiss` `.a2-reclaim__signin` |
| polish.css | `.time-scrubber__bar` `.time-scrubber__close` `.time-scrubber__copy` |
| pol-studio.css | `.ts-audit__fix` `.ts-token-revert` `.ts-token-swatch` |
| app.css + pol-thread.css | `.onyx-jump-latest` `.onyx-thread-indicator` |
| app.css + pol-roster.css | `.onyx-member-message` `.onyx-roster-care` |
| app.css + ui-sheets.css | `.onyx-you-leave` `.onyx-you-link` |
| pol-shell.css + ui-sheets.css | `.notif-center__close` **dead** |
| calls-c4.css | `.onyx-cq-prompt-x` |
| pol-roster.css | `.onyx-mlist-find` |
| pol-stats.css | `.status-quiet-link` |

### input / textarea / field (29 classes, 2 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-field` `.chb-field-desc` `.chb-field-error` `.conn-field` `.conn-input` `.notify-input` `.onyx-account-field` `.onyx-account-field-label` `.onyx-steward-field` `.shell-topic-create-input` |
| pol-thread.css | `.onyx-composer-field` `.onyx-message-search__input` `.onyx-message-search__query-field` `.onyx-message-search__save-input` |
| pol-studio.css | `.onyx-field` `.onyx-field__input` `.ts-save-input` `.ts-token-text-field` |
| pol-public.css | `.form-field` `.form-field-error` `.onyx-land-sketch-input` |
| account2.css | `.a2-input` `.a2-textarea` |
| roomsettings.css | `.rset-input` `.rset-textarea` |
| pol-shell.css | `.onyx-rail-filter-field` |
| app.css + pol-shell.css | `.onyx-rail-filter-input` |
| app.css + pol-roster.css | `.onyx-roster-filter-input` |
| calls-c8.css | `.onyx-vs-field` |

### button (130 classes, 22 multi-file, 1 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-actions` `.chb-invite-actions` `.conn-actions` `.conn-alt-btn` `.conn-submit` `.jump-to-date__actions` `.notify-add-btn` `.onyx-call-btn-ghost` `.onyx-call-btn-primary` `.onyx-calls-primary` `.onyx-convohead-action` `.onyx-home-caught-up-button` `.onyx-ident-action` `.onyx-keychange-actions` `.onyx-member-advanced-actions` `.onyx-member-row-actions` **dead** `.onyx-moddesk-actions` `.onyx-moddesk-danger` `.onyx-moderation-actions` `.onyx-newmsg-primary` `.onyx-newmsg-secondary` `.onyx-primary-nav-context` `.onyx-reclaim-actions` `.onyx-reclaim-submit` `.onyx-scheduled-actions` `.onyx-steward-actions` `.onyx-steward-btn` `.onyx-steward-btn-danger` `.onyx-steward-btn-primary` `.person-safety__actions` `.pref-action-card__body` `.pref-action-card__title` `.pref-actions` `.pref-reset--danger` `.pref-row-action` `.shell-topic-action` `.shell-topic-actions` |
| pol-public.css | `.ab-cta` `.ab-cta--section` `.dl-actions` `.dl-cta` `.guides-action` `.guides-card-actions` `.guides-hero-actions` `.guides-progress__actions` `.guides-share__actions` `.invite-actions` `.not-found-page__action` `.onyx-land-sketch-send` `.onyxos-button` `.onyxos-button--primary` `.onyxos-hero__actions` `.public-frame__nav-actions` `.public-frame__nav-primary` |
| pol-studio.css | `.ap-action` `.ap-action--apply` `.ap-action--quiet` `.ap-background-actions` `.onyx-button` `.onyx-button--ghost` `.onyx-button--primary` `.ts-eyedropper-button` `.ts-factory__actions` `.ts-pv-actions` `.ts-pv-btn` `.ts-pv-btn--danger` `.ts-pv-btn--primary` `.ts-pv-btn--send` `.ts-scheme-toggle__btn` `.ts-seed-btn` |
| app.css + pol-shell.css | `.guest-claim-chip__actions` `.onyx-account-actions` `.onyx-home-action` `.onyx-home-actions` `.onyx-nav-btn` `.onyx-nav-btn--active` `.onyx-primary-nav` `.onyx-room-header-actions` `.onyx-room-header-btn` `.pref-action-card` |
| pol-thread.css | `.onyx-composer-send` `.onyx-composer-send--ready` `.onyx-composer-send-label` `.onyx-earlier-button` `.onyx-latest-button` `.onyx-message-search__button` `.onyx-row-action` `.onyx-row-actions` |
| pol-shell.css | `.chb-ghost` `.chb-submit` `.notif-center__action` `.onyx-home-action--primary` `.onyx-home-action--quiet` `.onyx-moddesk-form--danger` `.onyx-nav-btn--selected` |
| app.css + ui-sheets.css | `.chb-create-actions` `.onyx-member-action` `.onyx-member-action--primary` `.onyx-member-actions` `.onyx-newmsg-actions` `.pref-action-card__icon` |
| pol-stats.css | `.data-action` `.data-action--ledger` `.data-room-actions` `.public-room-comparison__actions` `.r-cta` `.status-check__button` |
| polish.css | `.first-run-notify__actions` `.polish-ghost` `.polish-primary` `.shell-composer-tools-action` |
| account2.css | `.a2-btn` `.a2-btn--danger` `.a2-btn--primary` |
| calls-c6.css | `.onyx-call-btn-danger` `.onyx-call-pip-btn` `.onyx-call-ring-actions` |
| roomsettings.css | `.rset-actions` `.rset-btn` `.rset-btn-primary` |
| calls-c4.css | `.onyx-call-primary` `.onyx-tile-btn` |
| app.css + pol-public.css | `.onyx-land-action` `.onyx-land-cta` |
| app.css + pol-shell.css + ui-sheets.css | `.chb-sort-btn` |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css | `.onyx-call-btn` |
| calls-c11.css | `.onyx-stage-actions` |
| calls-c8.css | `.onyx-vs-btn` |
| pol-stats.css + pol-public.css | `.r-btn` |
| pol-shell.css + pol-thread.css | `.shell-composer-action-label` |

### card (38 classes, 5 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-public.css | `.ab-who-card` `.dl-card` `.dl-card--soon` `.dl-card-head` `.guides-card` `.guides-card__meta` `.guides-card--optional` `.guides-card--principles` `.guides-route__card` `.public-info-card` |
| app.css | `.chb-card-head` `.conn-card` `.shell-topic-card` `.shell-topic-card-author` `.shell-topic-card-follow` `.shell-topic-card-main` `.shell-topic-card-meta` `.shell-topic-card-preview` `.shell-topic-card-title` |
| calls-c4.css | `.onyx-tile-bottom` `.onyx-tile-name` `.onyx-tile-nick` `.onyx-tile-q` `.onyx-tile-spacer` `.onyx-tile-talk` `.onyx-tile-top` |
| pol-stats.css | `.roadmap-card` `.roadmap-card-head` `.stats-card-heading` `.stats-card-quiet` `.stats-flow-card` `.stats-heatmap-card` |
| app.css + pol-shell.css + ui-sheets.css | `.chb-card` `.onyx-member-card` |
| calls-c11.css + calls-c4.css | `.onyx-tile` `.onyx-tile-video` |
| pol-stats.css + pol-public.css | `.data-card` |
| pol-shell.css | `.onyx-rail-tile` |

### badge / count / dot (78 classes, 14 multi-file, 1 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-count--started` `.notify-count` `.onyx-call-badge` `.onyx-call-badge-hand` `.onyx-call-people-count` `.onyx-call-pip` `.onyx-calls-pip` `.onyx-dot` `.onyx-home-count` `.onyx-home-unread` `.onyx-member-dot` `.onyx-rail-count` **dead** `.onyx-reconnect-dot` `.onyx-voice-count` `.pref-count` `.provenance-badge` `.shell-topic-card-unread` |
| pol-studio.css | `.ap-tag` `.ts-audit__badge` `.ts-audit__badge--aa` `.ts-audit__badge--aa-large` `.ts-audit__badge--aaa` `.ts-audit__badge--fail` `.ts-audit__badge--na` `.ts-badge` `.ts-badge--modified` `.ts-preview__bar-dot` `.ts-pv-badge` `.ts-pv-badge--accent` `.ts-pv-badge--hot` `.ts-pv-chan__count` `.ts-pv-member__dot` `.ts-token-badge` |
| calls-c6.css | `.onyx-call-pip-body` `.onyx-call-pip-cap` `.onyx-call-pip-corner` `.onyx-call-pip-faces` `.onyx-call-pip-handle` `.onyx-call-pip-live` `.onyx-call-pip-more` `.onyx-call-pip-where` |
| pol-shell.css | `.onyx-call-pip-leave` `.onyx-ident-badge` `.onyx-nav-badge` `.onyx-nav-badge--mention` `.onyx-rail-has-unread` `.onyx-room-back-count` `.onyx-you-conn-dot` |
| pol-thread.css | `.onyx-earlier-count` `.onyx-message-search__count` `.onyx-message-search__server-count` `.onyx-thread-count` `.onyx-unread-divider` `.onyx-unread-divider-label` `.unread` |
| app.css + pol-shell.css | `.onyx-profile-badge` `.onyx-rail-filter-unread` `.onyx-rail-filter-unread-on` `.onyx-rail-unread` `.shell-ribbon-badge` |
| app.css + pol-thread.css | `.boost-count` `.onyx-jump-latest--unread` `.onyx-jump-latest-count` |
| app.css + pol-roster.css | `.onyx-member-presence-dot` `.onyx-member-presence-dot--away` `.onyx-roster-count` |
| account2.css | `.a2-dot` `.a2-dot--avatar` |
| app.css + ui-sheets.css | `.chb-count` `.chb-count--live` |
| calls-c4.css | `.onyx-tile-tag` `.onyx-tile-tag-text` |
| pol-public.css | `.guides-progress__count` |
| calls-c11.css + calls-c6.css | `.onyx-call-pip-card` |
| pol-roster.css | `.onyx-mlist-group-count` |
| roomsettings.css | `.rset-bridge-dot` |
| polish.css | `.shell-composer-tools-kbd` |
| pol-stats.css | `.stats-result-count` |

### chip (39 classes, 9 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-studio.css | `.ap-chip` `.ap-chip--theme` `.ap-chips` `.ap-theme-chip` `.ap-theme-chip--custom` `.ap-theme-chip--on` `.ts-theme-chip` `.ts-theme-chip__label` `.ts-theme-chip__scheme` `.ts-theme-chip--custom` `.ts-theme-chip-del` `.ts-theme-chip-wrap` |
| pol-shell.css | `.guest-claim-chip__hint` `.guest-claim-chip__icon` `.guest-claim-chip__line` `.guest-claim-chip__nick` `.onyx-account-chip` `.onyx-account-chips` `.onyx-account-chips__desc` `.onyx-account-chips__label` `.onyx-voice-chip-count` |
| app.css + pol-shell.css | `.guest-claim-chip` `.guest-claim-chip__dismiss` `.guest-claim-chip__keep` `.guest-claim-chip__text` `.onyx-dmsafe-chip` `.onyx-voice-chip` `.onyx-voice-chip-status` |
| app.css | `.onyx-dmsafe-chip-plain` `.onyx-dmsafe-chip-warn` `.topic-chip__hash` `.topic-chip__unread` |
| pol-thread.css | `.onyx-message-search__recall-chip` `.topic-chip__label` `.topic-chip--all` |
| pol-stats.css | `.public-room-comparison__chip` `.public-room-comparison__chips` |
| app.css + calls-engine.css | `.onyx-sec-chip` |
| app.css + pol-thread.css | `.topic-chip` |

### empty state (32 classes, 10 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-empty-title` `.is-empty` `.jump-to-date__empty` `.onyx-account-empty` `.onyx-account-personas-empty` `.onyx-dmsafe-empty` `.onyx-empty` `.onyx-empty-small` `.onyx-keychange-col-empty` `.onyx-newmsg-empty` `.onyx-profile-empty` `.onyx-react-empty` `.pref-placeholder` |
| pol-shell.css | `.moderation-cockpit__empty` `.moderation-cockpit__empty-wrap` `.onyx-rail-zero` `.onyx-room-header-topic-empty` |
| app.css + pol-shell.css | `.onyx-home-empty` `.onyx-home-empty-copy` `.onyx-rail-empty` `.onyx-rail-filter-empty` |
| pol-stats.css | `.channel-spark-empty` `.data-empty` `.public-room-comparison__empty` |
| app.css + pol-thread.css | `.onyx-feed-empty` `.onyx-feed-empty-body` `.onyx-feed-empty-title` |
| pol-thread.css | `.pins-empty` `.room-media-index-empty` |
| pol-shell.css + ui-sheets.css | `.notif-center__empty` |
| app.css + pol-roster.css | `.onyx-roster-empty` |
| app.css + ui-sheets.css | `.onyx-scheduled-empty` |

### list / row / item (112 classes, 11 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-invitee-row` `.chb-row--live` `.chb-skins-row` `.conn-alt-row` `.moderation-desk__ban-list` `.moderation-desk__ban-row` `.moderation-desk__log-list` `.notify-item` `.notify-list` `.notify-row` `.notify-row-copy` `.notify-row-hint` `.notify-row-title` `.onyx-account-cert-item` `.onyx-account-cert-list` `.onyx-account-device-list` `.onyx-account-passkey-list-title` `.onyx-account-passkey-row` `.onyx-account-persona-list` `.onyx-account-persona-row` `.onyx-account-totp-row` `.onyx-call-peer-list` `.onyx-calls-rooms-list` `.onyx-dmsafe-ready-row` `.onyx-home-list` `.onyx-home-outbox-item` `.onyx-home-outbox-list` `.onyx-home-row` `.onyx-home-row-copy` `.onyx-home-row-meta` `.onyx-home-row-name` `.onyx-moddesk-row` `.onyx-scheduled-item` `.onyx-scheduled-list` `.onyx-steward-item` `.onyx-steward-list` `.pref-row` `.pref-row-copy` `.pref-row-preview` `.pref-rows` |
| pol-thread.css | `.onyx-attach-row` `.onyx-message-search__saved-list` `.onyx-message-search__saved-row` `.onyx-message-search__server-list` `.onyx-message-search__server-row` `.pins-item` `.pins-item-body` `.pins-item-body--deleted` `.pins-item-body--locked` `.pins-item-body--missing` `.pins-item-from` `.pins-item-main` `.pins-item-meta` `.pins-item-state` `.pins-item-unpin` `.pins-item-when` `.pins-list` `.pins-list-item` `.room-media-index-item` `.room-media-index-list` `.room-media-index-row` `.room-media-index-row--file` `.room-media-index-row--link` `.room-media-index-row--picture` |
| pol-studio.css | `.ap-readiness-row` `.ts-audit__list` `.ts-audit__row` `.ts-header__title-row` `.ts-save-row` `.ts-section__heading-row` `.ts-token-color-row` |
| pol-public.css | `.a11y-list` `.a11y-topic-list` `.dl-artifact-list` `.dl-checksum-row` `.guides-index__list` `.guides-route__item` |
| pol-stats.css | `.data-list` `.data-room-row` `.data-row` `.stats-feed-timeline-list` `.stats-flow-list` |
| roomsettings.css | `.onyx-dmsafe-rows` `.rset-access-list` `.rset-access-row` `.rset-roles-list` `.rset-roles-row` |
| account2.css | `.a2-list` `.a2-row` `.a2-row--between` `.a2-row--fill` |
| app.css + ui-sheets.css | `.chb-list` `.onyx-account-nav__item` `.onyx-you-leave-row` |
| pol-shell.css | `.chb-row` `.onyx-account-passkey-list` `.onyx-room-header-topic-row` |
| polish.css | `.shell-composer-tools-item` `.shell-composer-tools-item-desc` `.shell-composer-tools-item-title` |
| calls-c8.css | `.onyx-call-react-item` `.onyx-vs-key-row` |
| app.css + pol-shell.css | `.onyx-rail-item` `.onyx-rail-row` |
| app.css + pol-thread.css | `.shell-command-item` `.shell-command-item--active` |
| app.css + pol-shell.css + ui-sheets.css | `.notif-center__list` |
| pol-shell.css + ui-sheets.css | `.notif-center__row` |
| app.css + calls-c4.css + calls-engine.css | `.onyx-call-more-item` |
| app.css + pol-public.css | `.onyx-land-shelf-list` |
| pol-roster.css | `.onyx-mlist-rows` |
| calls-c11.css | `.onyx-stage-hand-row` |

### icon button (31 classes, 10 multi-file, 8 dead)

| defined in | classes |
|---|---|
| app.css | `.notify-close` **dead** `.onyx-account-close` **dead** `.onyx-dmsafe-close` `.onyx-moddesk-close` `.onyx-newmsg-close` **dead** `.onyx-prefs-close` **dead** `.onyx-profile-close` **dead** `.onyx-schedule-close` `.onyx-scheduled-close` `.onyx-steward-close` **dead** |
| pol-thread.css | `.onyx-message-search__button--close` `.onyx-thread-close` `.pins-close` `.room-media-index-close` `.shell-composer-context-close` |
| app.css + ui-sheets.css | `.jump-to-date-close` `.onyx-shortcuts-close` **dead** `.onyx-you-close` |
| calls-c8.css | `.onyx-cbtn-hand` `.onyx-cbtn-react` |
| app.css + pol-shell.css | `.chb-close` **dead** |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css + calls-engine.css | `.onyx-cbtn` |
| app.css + calls-c4.css | `.onyx-cbtn-cap` |
| app.css + calls-engine.css | `.onyx-cbtn-leave` |
| calls-c4.css | `.onyx-cbtn-share` |
| calls-c11.css | `.onyx-cbtn-wide` |
| pol-roster.css | `.onyx-mlist-close` |
| pol-public.css | `.onyxos-close` |
| pol-shell.css + pol-thread.css | `.shell-composer-tool` |
| app.css + pol-thread.css | `.shell-composer-tool--emoji` |
| pol-thread.css + polish.css | `.shell-composer-tool--more` |

### switch / toggle (43 classes, 8 multi-file, 2 dead)

| defined in | classes |
|---|---|
| app.css | `.notify-toggle` `.onyx-calls-toggle` **dead** `.onyx-calls-toggle-open` **dead** `.onyx-member-advanced-toggle` `.onyx-moddesk-toggles` `.onyx-notify-toggle` `.onyx-notify-toggle-open` `.pref-switch` `.pref-toggle` `.pref-toggle-text` `.pref-toggle-title` |
| pol-shell.css | `.onyx-account-push-toggle` `.onyx-jump-toggle` `.onyx-media-toggle` `.onyx-media-toggle-open` `.onyx-pins-toggle` `.onyx-pins-toggle-open` `.onyx-room-settings-toggle` `.onyx-scrubber-toggle` `.onyx-search-toggle` |
| roomsettings.css | `.rset-toggle` `.rset-toggle-label` `.rset-toggle-text` `.rset-toggle-thumb` `.rset-toggle-track` |
| app.css + pol-shell.css | `.onyx-moddesk-toggle` `.onyx-room-more-toggle` `.onyx-search-toggle-open` |
| calls-c8.css | `.onyx-vs-toggle` `.onyx-vs-toggle-label` `.onyx-vs-toggle-text` |
| app.css + pol-thread.css | `.onyx-audience-toggle` `.onyx-audience-toggle-set` |
| pol-thread.css | `.onyx-message-search__save-toggle` `.onyx-topic-tools-toggle` |
| pol-studio.css | `.ts-advanced__toggle` `.ts-scheme-toggle` |
| app.css + ui-sheets.css | `.chb-check` |
| pol-public.css | `.guides-step-toggle` |
| pol-shell.css + pol-roster.css | `.onyx-members-toggle` |
| pol-roster.css | `.onyx-members-toggle-count` |
| pol-shell.css + roomsettings.css | `.onyx-room-topic-toggle` |
| pol-stats.css | `.status-check` |

### tabs (10 classes, 5 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-studio.css | `.onyx-tabs` `.onyx-tabs__content` `.onyx-tabs__list` `.onyx-tabs__trigger` |
| app.css + ui-sheets.css | `.pref-category-tab` `.pref-category-tab__label` `.pref-category-tab__summary` `.pref-category-tabs` |
| app.css + pol-public.css | `.onyx-land-tabs` |
| pol-public.css | `.onyxos-console__tabs` |

### toast / banner / notice (23 classes, 6 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.jump-to-date__notice` `.onyx-join-banner` `.onyx-join-banner-actions` `.onyx-join-banner-copy` `.onyx-join-banner-failed` `.onyx-join-banner-hide` `.onyx-join-banner-warn` `.onyx-notices` `.onyx-toast__body` `.onyx-toast__undo` `.onyx-toast--info` |
| app.css + ui-sheets.css | `.onyx-toast` `.onyx-toast__dismiss` `.onyx-toast--danger` `.onyx-toast--success` `.onyx-toast--warning` `.onyx-toaster` |
| pol-shell.css | `.onyx-room-more-alerts` `.onyx-steward-notice` `.onyx-steward-notices` |
| account2.css | `.a2-reclaim--alert` |
| pol-thread.css | `.onyx-message-search__server-notice` |
| ui-sheets.css | `.ui-icon--alert` |

### pill (6 classes, 2 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.boost-pill--more` `.boost-pill--summary` |
| pol-public.css | `.ab-pillars` |
| app.css + pol-thread.css | `.boost-pill` |
| app.css + ui-sheets.css | `.chb-pill` |
| pol-shell.css | `.chb-pill--in` |

### skeleton / loading (12 classes, 0 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-public.css | `.guides-progress` `.guides-progress__eyebrow` `.guides-progress__head` `.guides-progress__meter` `.guides-progress__status` |
| pol-thread.css | `.onyx-pending` `.onyx-pending-note` `.room-media-index-skeleton` `.room-media-index-status--loading` `.shell-attachment-progress` |
| app.css | `.chb-invite-progress` `.onyx-account-pending` |

### menu / palette / dropdown (59 classes, 24 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.onyx-msg-menu-delete-confirm-actions` `.onyx-msg-menu-delete-confirm-cancel` `.onyx-msg-menu-delete-confirm-copy` `.onyx-msg-menu-delete-confirm-delete` `.onyx-msg-menu-delete-confirm-title` `.onyx-msg-menu-translation` `.onyx-msg-menu-translation-action` `.onyx-msg-menu-translation-actions` `.onyx-msg-menu-translation-copy-status` `.onyx-msg-menu-translation-head` `.onyx-msg-menu-translation-note` `.onyx-msg-menu-translation-text` `.onyx-spotlight-empty` `.onyx-spotlight-empty-sub` `.onyx-spotlight-empty-text` `.onyx-spotlight-status` |
| app.css + ui-sheets.css | `.onyx-spotlight` `.onyx-spotlight-close` `.onyx-spotlight-foot` `.onyx-spotlight-group` `.onyx-spotlight-hint` `.onyx-spotlight-icon` `.onyx-spotlight-input` `.onyx-spotlight-option` `.onyx-spotlight-panel` `.onyx-spotlight-results` `.onyx-spotlight-search` `.onyx-spotlight-section` `.onyx-spotlight-sigil` `.onyx-spotlight-title` |
| pol-studio.css | `.background-picker` `.background-picker__card` `.background-picker__card--selected` `.background-picker__copy` `.background-picker__grid` `.background-picker__group` `.background-picker__heading` `.background-picker__meta` `.background-picker__swatch` `.ts-public-look-picker` |
| app.css + pol-thread.css | `.onyx-msg-menu` `.onyx-msg-menu-delete-confirm` `.onyx-msg-menu-item` `.onyx-msg-menu-trigger` `.onyx-react-picker` `.shell-command-menu` `.shell-emoji-picker` |
| pol-thread.css | `.onyx-msg-menu-head` `.onyx-msg-menu-head-from` `.onyx-msg-menu-head-text` `.onyx-msg-menu-pop` `.shell-nick-menu` |
| app.css + pol-shell.css | `.onyx-palette-kbd` `.onyx-palette-launcher` |
| calls-c8.css | `.onyx-call-react-menu` |
| pol-shell.css | `.onyx-palette-launcher-label` |
| app.css + pol-shell.css + ui-sheets.css | `.onyx-room-more-menu` |
| pol-public.css | `.public-frame__menu-toggle` |
| pol-stats.css | `.stats-spotlight-metrics` |

### segmented control (9 classes, 3 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-studio.css | `.ap-chips--choices` `.ap-choice-toggle` `.ap-choice-toggles` |
| app.css | `.conn-strength-seg` `.pref-segment` `.pref-segments` |
| app.css + pol-thread.css | `.onyx-react-choice` `.shell-emoji-choice` |
| app.css + pol-shell.css | `.room-notify-seg` |

### select (3 classes, 0 multi-file, 0 dead)

| defined in | classes |
|---|---|
| account2.css | `.a2-select` |
| calls-c8.css | `.onyx-vs-select` |
| roomsettings.css | `.rset-select` |

### G17.1 Base-class property matrix (live classes; unconditional `.class { }` rules only, last declaration in cascade order)


**button** — 43 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-btn` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.ap-action` | pol-studio.css | `var(--target-min)` |  | `0 var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` |  |  |
| `.conn-alt-btn` | app.css | `var(--target-min)` |  | `0 var(--space-3)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.conn-submit` | app.css | `48px` |  | `0 var(--space-4)` | `var(--text-md)` | `700` | `var(--radius)` | `0` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.guides-action` | pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.notify-add-btn` | app.css |  |  | `6px var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-call-btn` | app.css, calls-c11.css, calls-c6.css, calls-c4.css | `36px` |  | `0 14px` |  | `650` | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-call-btn-danger` | calls-c6.css |  |  |  |  |  |  |  | `var(--onyx-bad)` | `#fff` |
| `.onyx-call-btn-primary` | app.css |  |  |  |  |  |  |  | `var(--onyx-text)` | `var(--onyx-bg)` |
| `.onyx-call-pip-btn` | calls-c6.css | `30px` |  | `0 var(--space-3)` | `var(--text-sm)` |  |  |  |  |  |
| `.onyx-calls-primary` | app.css |  |  | `10px 22px` |  | `650` | `6px` | `0` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-convohead-action` | app.css | `28px` |  | `var(--space-1) 10px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-earlier-button` | pol-thread.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--r-pill)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-home-action` | app.css, pol-shell.css | `36px` |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-home-caught-up-button` | app.css | `36px` |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-ident-action` | app.css |  |  | `4px 12px` |  |  | `999px` | `1px solid var(--onyx-line)` | `none` | `inherit` |
| `.onyx-land-action` | app.css, pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-land-sketch-send` | pol-public.css |  | `32px` |  |  |  | `var(--radius)` |  | `var(--onyx-panel-2)` |  |
| `.onyx-latest-button` | pol-thread.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--r-pill)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-member-action` | app.css, ui-sheets.css |  |  | `4px 12px` | `13px` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-nav-btn` | app.css, pol-shell.css | `44px` |  | `var(--space-2) 2px` | `var(--text-xs)` | `600` | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-dim)` |
| `.onyx-newmsg-primary` | app.css |  |  | `6px var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-newmsg-secondary` | app.css |  |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-primary-nav` | app.css, pol-shell.css |  |  | `10px 6px` |  |  |  |  | `var(--onyx-panel)` |  |
| `.onyx-reclaim-submit` | app.css |  |  | `6px 14px` |  | `600` | `6px` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-room-header-btn` | app.css, pol-shell.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-row-action` | pol-thread.css | `0` | `30px` | `0` |  |  | `4px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-row-actions` | pol-thread.css |  |  | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.onyx-steward-btn` | app.css |  |  | `4px 12px` | `13px` |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-steward-btn-danger` | app.css |  |  |  |  |  |  |  | `transparent` | `var(--onyx-bad)` |
| `.onyx-steward-btn-primary` | app.css |  |  |  |  | `700` |  |  | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-tile-btn` | calls-c4.css |  | `28px` | `0` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `color-mix(in srgb, var(--onyx-bg) 78%, t` | `var(--onyx-text)` |
| `.onyxos-button` | pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.polish-ghost` | polish.css | `var(--target-min)` |  | `var(--space-2) var(--space-4)` |  | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.polish-primary` | polish.css | `var(--target-min)` |  | `var(--space-2) var(--space-4)` |  | `650` | `6px` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.pref-action-card` | app.css, pol-shell.css | `44px` |  | `10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.pref-row-action` | app.css | `24px` |  | `var(--space-1) 10px` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.r-btn` | pol-stats.css, pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.rset-btn` | roomsettings.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.rset-btn-primary` | roomsettings.css |  |  |  |  | `600` |  |  | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.shell-composer-action-label` | pol-shell.css, pol-thread.css |  |  |  | `var(--text-sm)` | `600` |  |  |  |  |
| `.shell-topic-action` | app.css |  |  | `2px 10px` | `12px` |  | `999px` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.ts-pv-btn` | pol-studio.css | `20px` |  | `0 var(--space-2)` | `10px` | `650` | `4px` | `1px solid transparent` |  |  |

**button-like by declarations (per-instance class name)** — 76 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-link` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.conn-cancel` | app.css | `48px` |  | `0 var(--space-5)` |  | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.conn-link` | app.css | `32px` |  | `0` | `var(--text-sm)` | `600` |  | `0` | `none` | `var(--onyx-dim)` |
| `.dl-copy` | pol-public.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.guides-copy` | pol-public.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.guides-download` | pol-public.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.guides-reset` | pol-public.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.notify-remove` | app.css |  |  | `var(--space-1) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-cert-bind` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-cert-remove-go` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-data-download` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-data-history` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-device-publish` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-device-remove-legacy` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-drop-arm` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-drop-cancel` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-drop-go` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-email-save` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-keytrans-refresh` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-logout` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-add` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-cancel` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-refresh` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-remove` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-remove-go` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-rename` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-passkey-save` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-password-save` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-persona-claim-go` | pol-shell.css | `28px` |  | `4px 12px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-persona-off` | pol-shell.css | `28px` |  | `4px 12px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-persona-wear` | pol-shell.css | `28px` |  | `4px 12px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-recovery-clear` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-recovery-copy` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-recovery-done` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-recovery-generate` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-recovery-refresh` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-refresh` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-totp-confirm-go` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-totp-copy` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-totp-disable` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-totp-enroll` | app.css |  |  | `4px 12px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-call-join` | app.css, pol-shell.css | `30px` |  | `0 10px` | `13px` | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-calls-join-video` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-calls-join-voice` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-calls-leave` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-bad)` |
| `.onyx-calls-mute` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-calls-room` | app.css | `36px` |  | `6px 8px` |  |  | `6px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-coach-dismiss` | app.css, pol-shell.css |  | `32px` |  |  |  | `var(--radius)` | `0` | `none` | `var(--onyx-faint)` |
| `.onyx-cq-prompt-x` | calls-c4.css |  | `28px` |  |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-dmsafe-trigger` | app.css, pol-shell.css | `28px` |  | `var(--space-1) 10px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-home-room` | app.css | `44px` |  | `var(--space-2) 10px` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-jump-latest` | app.css, pol-thread.css |  |  | `var(--space-1) var(--space-3)` | `var(--text-2xs)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.onyx-keychange-accept` | app.css | `32px` |  | `6px var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-keychange-dismiss` | app.css | `32px` |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-keychange-retry` | app.css |  |  | `0` |  |  |  | `0` | `transparent` | `var(--onyx-text)` |
| `.onyx-member-message` | app.css, pol-roster.css | `24px` |  | `2px var(--space-2)` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-mlist-find` | pol-roster.css |  | `28px` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-reclaim-cancel` | app.css |  |  | `6px 14px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-reconnect-retry` | app.css |  |  | `2px var(--space-3)` | `var(--text-2xs)` | `600` | `999px` | `1px solid currentColor` | `transparent` | `inherit` |
| `.onyx-roster-care` | app.css, pol-roster.css |  |  | `2px 10px` | `12px` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-scheduled-cancel` | app.css |  |  | `4px 12px` | `13px` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-thread-indicator` | app.css, pol-thread.css |  |  | `2px 4px` | `12px` |  |  | `none` | `none` | `var(--onyx-dim)` |
| `.onyx-you-leave` | app.css, ui-sheets.css |  |  | `6px 14px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-you-link` | app.css, ui-sheets.css |  |  | `10px var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.pref-reset` | app.css | `32px` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.room-media-index-filter` | pol-thread.css | `32px` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` | `600` | `4px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.room-media-index-jump` | pol-thread.css | `var(--target-floor)` |  | `2px var(--space-3)` | `var(--text-xs)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.room-media-index-retry` | pol-thread.css | `var(--target-floor)` |  | `2px var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.shell-msg-channel-link` | app.css |  |  | `0` |  |  |  | `0` | `none` | `var(--onyx-accent)` |
| `.shell-msg-media-consent` | pol-thread.css | `var(--target-floor)` |  | `var(--space-2) var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px dashed var(--pt-seam)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.shell-msg-preview-consent` | pol-thread.css |  | `72px` | `var(--space-1)` | `var(--text-2xs)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-dim)` |
| `.shell-ribbon-bell` | app.css, pol-shell.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.shell-topic-follow` | app.css |  |  | `2px 10px` | `12px` |  | `999px` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.status-quiet-link` | pol-stats.css | `var(--target-min)` |  | `var(--space-2) var(--space-4)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.ts-token-revert` | pol-studio.css | `var(--target-floor)` |  | `0 var(--space-2)` | `var(--text-xs)` | `600` | `var(--radius)` | `1px solid color-mix(in oklab, var(--onyx` | `transparent` | `var(--onyx-warn)` |
| `.ts-token-swatch` | pol-studio.css |  | `32px` | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |

**icon button** — 10 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.jump-to-date-close` | app.css, ui-sheets.css |  |  | `var(--space-1) 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.onyx-cbtn` | app.css, calls-c11.css, calls-c6.css, calls-c4.css, calls-engine.css |  | `44px` |  | `11px` | `650` | `6px` | `1px solid transparent` | `transparent` | `var(--onyx-dim)` |
| `.onyx-cbtn-leave` | app.css, calls-engine.css |  |  |  |  |  |  |  | `var(--onyx-bad)` | `#fff` |
| `.onyx-dmsafe-close` | app.css | `28px` |  |  | `var(--text-lg)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-mlist-close` | pol-roster.css |  | `28px` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-moddesk-close` | app.css | `32px` |  |  | `var(--text-lg)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-scheduled-close` | app.css |  |  |  | `18px` |  |  | `none` | `transparent` | `var(--onyx-dim)` |
| `.onyx-you-close` | app.css, ui-sheets.css | `var(--sheet-close)` | `var(--sheet-close)` | `0` | `0` |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.pins-close` | pol-thread.css |  | `32px` | `0` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.room-media-index-close` | pol-thread.css |  | `32px` | `0` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |

**chip** — 12 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.ap-chip` | pol-studio.css | `var(--target-min)` |  | `0 var(--space-4)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-dim)` |
| `.ap-theme-chip` | pol-studio.css | `var(--target-min)` |  | `0 var(--space-4)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-dim)` |
| `.guest-claim-chip` | app.css, pol-shell.css |  |  | `var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.onyx-account-chip` | pol-shell.css | `28px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--r-pill)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-dmsafe-chip` | app.css, pol-shell.css |  |  | `2px var(--space-2)` | `var(--text-2xs)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` |  | `var(--onyx-text)` |
| `.onyx-dmsafe-chip-plain` | app.css |  |  |  |  | `500` |  |  |  | `var(--onyx-dim)` |
| `.onyx-sec-chip` | app.css, calls-engine.css |  | `28px` | `0 9px` | `12px` | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-voice-chip` | app.css, pol-shell.css |  | `30px` | `0 10px` | `13px` | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-voice-chip-status` | app.css, pol-shell.css |  |  |  |  | `500` |  |  |  | `var(--onyx-dim)` |
| `.topic-chip` | app.css, pol-thread.css | `var(--target-floor)` |  | `2px 10px` | `var(--text-sm)` |  | `999px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.ts-theme-chip` | pol-studio.css | `var(--target-min)` |  | `var(--space-1) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-dim)` |
| `.ts-theme-chip-del` | pol-studio.css |  | `28px` | `0` | `var(--text-lg)` |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-faint)` |

**pill** — 2 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.boost-pill` | app.css, pol-thread.css |  |  | `2px var(--space-2)` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.chb-pill` | app.css, ui-sheets.css |  |  | `0 6px` | `11px` |  | `6px` | `1px solid var(--onyx-accent)` |  | `var(--onyx-accent)` |

**input / textarea / field** — 16 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-input` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.a2-textarea` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-2)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.chb-field-desc` | app.css |  |  |  | `12px` |  |  |  |  | `var(--onyx-dim)` |
| `.chb-field-error` | app.css |  |  |  | `12px` |  |  |  |  | `var(--onyx-warn)` |
| `.conn-input` | app.css | `48px` |  | `0 14px` | `1rem` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.notify-input` | app.css |  |  | `6px 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-account-field` | app.css |  |  | `4px 8px` | `13px` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-field-label` | app.css |  |  |  | `12px` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-land-sketch-input` | pol-public.css |  |  |  | `var(--text-md)` |  |  |  |  | `var(--onyx-faint)` |
| `.onyx-rail-filter-input` | app.css, pol-shell.css |  |  | `5px var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-roster-filter-input` | app.css, pol-roster.css | `32px` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-steward-field` | app.css |  |  | `6px 10px` | `13px` |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.rset-input` | roomsettings.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.rset-textarea` | roomsettings.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.shell-topic-create-input` | app.css |  |  | `2px 8px` | `12px` |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.ts-save-input` | pol-studio.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |

**select** — 3 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-select` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-vs-select` | calls-c8.css | `40px` |  | `0 var(--space-2)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.rset-select` | roomsettings.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |

**badge / count / dot** — 38 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-dot` | account2.css |  | `8px` |  |  |  | `50%` | `1px solid var(--onyx-dim)` | `transparent` |  |
| `.ap-tag` | pol-studio.css |  |  |  | `var(--text-md)` | `700` |  |  |  | `var(--onyx-text)` |
| `.chb-count` | app.css, ui-sheets.css |  |  |  | `12px` |  |  |  |  | `var(--onyx-dim)` |
| `.notify-count` | app.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-call-badge` | app.css |  | `24px` |  |  |  | `50%` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-call-pip` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.onyx-call-pip-card` | calls-c11.css, calls-c6.css |  |  |  |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.onyx-call-pip-corner` | calls-c6.css |  | `var(--target-floor)` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-call-pip-live` | calls-c6.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-call-pip-more` | calls-c6.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-calls-pip` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.onyx-dot` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.onyx-earlier-count` | pol-thread.css |  |  | `0 6px` | `var(--text-2xs)` |  | `var(--r-pill)` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-home-count` | app.css |  |  |  |  | `600` |  |  |  | `var(--onyx-text)` |
| `.onyx-home-unread` | app.css |  |  | `1px 6px` | `var(--text-2xs)` | `600` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-ident-badge` | pol-shell.css |  |  | `0 6px` | `var(--text-xs)` | `600` | `var(--r-pill)` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-member-dot` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-text)` |  |
| `.onyx-member-presence-dot` | app.css, pol-roster.css |  | `8px` |  |  |  | `50%` | `2px solid var(--onyx-panel)` | `var(--onyx-dim)` |  |
| `.onyx-mlist-group-count` | pol-roster.css |  |  |  |  | `600` |  |  |  | `var(--onyx-faint)` |
| `.onyx-nav-badge` | pol-shell.css |  | `16px` | `0 4px` | `10px` | `700` | `var(--r-pill)` |  | `var(--onyx-text)` | `var(--onyx-bg)` |
| `.onyx-profile-badge` | app.css, pol-shell.css |  |  | `2px 8px` | `12px` |  | `6px` |  | `var(--onyx-panel)` |  |
| `.onyx-rail-unread` | app.css, pol-shell.css |  |  | `1px 5px` | `var(--text-xs)` | `700` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-reconnect-dot` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-warn)` |  |
| `.onyx-roster-count` | app.css, pol-roster.css |  |  |  | `var(--text-xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-thread-count` | pol-thread.css |  |  |  | `var(--text-xs)` | `650` |  |  |  | `var(--onyx-dim)` |
| `.onyx-tile-tag` | calls-c4.css |  | `24px` | `0 var(--space-2)` | `var(--text-2xs)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `color-mix(in srgb, var(--onyx-bg) 78%, t` | `var(--onyx-text)` |
| `.onyx-unread-divider-label` | pol-thread.css |  |  |  | `var(--text-xs)` | `700` |  |  |  |  |
| `.onyx-voice-count` | app.css |  |  |  | `12px` | `600` |  |  |  | `var(--onyx-dim)` |
| `.onyx-you-conn-dot` | pol-shell.css |  | `7px` |  |  |  | `50%` |  | `var(--onyx-dim)` |  |
| `.pref-count` | app.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.provenance-badge` | app.css | `1.35rem` |  | `0.12rem 0.45rem` | `0.62rem` | `800` | `var(--r-pill)` | `1px solid color-mix(in oklab, var(--lapi` | `color-mix(in oklab, var(--lapis) 10%, tr` | `var(--lapis-bright)` |
| `.rset-bridge-dot` | roomsettings.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-dim)` |  |
| `.shell-composer-tools-kbd` | polish.css |  |  | `0 var(--space-1)` | `var(--text-2xs)` |  | `4px` | `1px solid var(--onyx-line)` |  |  |
| `.shell-ribbon-badge` | app.css, pol-shell.css |  |  | `0 var(--space-1)` | `var(--text-xs)` | `700` | `var(--r-pill)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.shell-topic-card-unread` | app.css |  |  |  |  | `700` |  |  |  | `var(--onyx-text)` |
| `.ts-badge` | pol-studio.css |  |  | `1px var(--space-2)` | `var(--text-xs)` | `650` | `var(--r-pill)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.ts-pv-badge` | pol-studio.css |  |  | `0 4px` | `9px` | `650` | `4px` | `1px solid transparent` |  |  |
| `.ts-token-badge` | pol-studio.css |  |  |  | `var(--text-2xs)` | `400` |  |  |  | `var(--onyx-dim)` |

**card** — 15 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.ab-who-card` | pol-public.css |  |  | `var(--space-5)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.chb-card` | app.css, pol-shell.css, ui-sheets.css |  |  | `8px 10px` |  |  | `8px` | `1px solid var(--onyx-line)` |  |  |
| `.conn-card` | app.css |  |  | `36px 40px 32px` |  |  | `10px` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.data-card` | pol-stats.css, pol-public.css |  |  | `var(--space-6)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.dl-card` | pol-public.css |  |  | `var(--space-5)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.guides-card` | pol-public.css |  |  | `var(--space-6)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.onyx-member-card` | app.css, pol-shell.css, ui-sheets.css |  |  | `12px` |  |  | `8px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.onyx-tile` | calls-c11.css, calls-c4.css |  |  |  |  |  | `var(--radius)` | `2px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.onyx-tile-nick` | calls-c4.css |  | `24px` | `0 var(--space-2)` | `var(--text-xs)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `color-mix(in srgb, var(--onyx-bg) 78%, t` | `var(--onyx-text)` |
| `.onyx-tile-video` | calls-c11.css, calls-c4.css |  | `100%` |  |  |  |  |  | `var(--onyx-bg)` |  |
| `.roadmap-card` | pol-stats.css |  |  | `var(--space-6) var(--space-4)` |  |  | `0` |  |  |  |
| `.shell-topic-card` | app.css |  |  |  |  |  | `8px` | `1px solid var(--onyx-line)` |  |  |
| `.shell-topic-card-follow` | app.css |  |  | `2px 10px` | `12px` |  | `999px` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.shell-topic-card-main` | app.css |  |  | `8px 10px` |  |  |  | `none` | `none` | `inherit` |
| `.shell-topic-card-meta` | app.css |  |  |  | `12px` |  |  |  |  | `var(--onyx-dim)` |

**tabs** — 2 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.onyx-land-tabs` | app.css, pol-public.css |  |  | `3px` |  |  | `calc(var(--radius) + 3px)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.pref-category-tab` | app.css, ui-sheets.css | `44px` |  | `6px 10px` |  |  | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-text)` |

**segmented control** — 6 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.ap-choice-toggle` | pol-studio.css | `52px` |  | `var(--space-3) var(--space-4)` | `var(--text-md)` | `600` | `0` | `0` | `transparent` | `var(--onyx-text)` |
| `.ap-choice-toggles` | pol-studio.css |  |  |  |  |  | `10px` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.conn-strength-seg` | app.css |  | `4px` |  |  |  | `2px` |  | `var(--onyx-line)` |  |
| `.onyx-react-choice` | app.css, pol-thread.css |  |  | `4px` | `18px` |  | `6px` | `none` | `transparent` |  |
| `.pref-segment` | app.css | `32px` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.room-notify-seg` | app.css, pol-shell.css |  |  | `2px 10px` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |

**switch / toggle** — 20 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.guides-step-toggle` | pol-public.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.notify-toggle` | app.css |  |  | `var(--space-1) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-account-push-toggle` | pol-shell.css | `28px` |  | `4px 12px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-audience-toggle` | app.css, pol-thread.css |  |  | `2px 8px` | `11px` | `600` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-media-toggle-open` | pol-shell.css |  |  |  |  | `650` |  |  | `var(--onyx-panel-2)` |  |
| `.onyx-moddesk-toggle` | app.css, pol-shell.css | `24px` |  | `var(--space-1) 10px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-notify-toggle` | app.css |  |  | `var(--space-1) 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-notify-toggle-open` | app.css |  |  |  |  |  |  |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-pins-toggle-open` | pol-shell.css |  |  |  |  | `650` |  |  | `var(--onyx-panel-2)` |  |
| `.onyx-room-topic-toggle` | pol-shell.css, roomsettings.css | `var(--target-floor)` |  | `0 var(--space-2)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-search-toggle-open` | app.css, pol-shell.css |  |  |  |  |  |  |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-topic-tools-toggle` | pol-thread.css | `28px` |  | `0 var(--space-2) 0 var(--space-1)` | `var(--text-sm)` | `600` | `var(--radius)` |  |  | `var(--onyx-dim)` |
| `.pref-switch` | app.css |  | `20px` |  |  |  | `999px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.pref-toggle` | app.css | `44px` |  | `var(--space-2) 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.pref-toggle-title` | app.css |  |  |  | `var(--text-sm)` | `600` |  |  |  |  |
| `.rset-toggle` | roomsettings.css | `40px` |  | `var(--space-2)` |  |  | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-text)` |
| `.rset-toggle-label` | roomsettings.css |  |  |  | `var(--text-md)` | `600` |  |  |  |  |
| `.rset-toggle-thumb` | roomsettings.css |  | `12px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.rset-toggle-track` | roomsettings.css |  | `18px` |  |  |  | `999px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.ts-scheme-toggle` | pol-studio.css |  |  | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |

**toast / banner / notice** — 4 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.onyx-join-banner` | app.css |  |  | `12px 14px` |  |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.onyx-join-banner-hide` | app.css |  | `28px` |  |  |  | `6px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-steward-notice` | pol-shell.css |  |  | `var(--space-2) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.onyx-toast` | app.css, ui-sheets.css | `48px` |  | `var(--space-2) var(--space-2) var(--spac` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |

**avatar / facepile** — 13 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.onyx-avatar` | app.css, pol-shell.css, pol-thread.css, pol-roster.css |  |  |  |  | `800` | `50%` |  | `var(--onyx-avatar-bg)` | `var(--onyx-avatar-fg)` |
| `.onyx-call-avatar` | app.css, calls-c6.css |  |  |  |  | `700` | `50%` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-call-avatar-lg` | app.css, calls-c4.css |  | `72px` |  | `24px` |  |  |  |  |  |
| `.onyx-call-avatar-md` | app.css |  | `40px` |  | `15px` |  |  |  |  |  |
| `.onyx-call-avatar-sm` | app.css |  | `24px` |  | `11px` |  |  |  |  |  |
| `.onyx-face` | pol-shell.css |  | `28px` |  | `10px` | `700` | `50%` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-facepile-face` | app.css |  |  | `0` |  |  | `50%` | `none` | `none` |  |
| `.onyx-facepile-overflow` | app.css |  | `2rem` | `0 8px` | `0.72rem` | `600` | `999px` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-home-avatar` | app.css |  | `28px` |  | `var(--text-sm)` | `600` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-land-sketch-avatar` | pol-public.css |  | `36px` |  | `var(--text-sm)` | `750` | `50%` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-rail-avatar` | app.css, pol-shell.css, account2.css |  | `24px` |  | `var(--text-2xs)` | `700` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-room-intro-face` | pol-thread.css |  | `4rem` |  |  |  | `50%` | `0` | `transparent` | `var(--onyx-text)` |
| `.onyx-you-avatar` | pol-shell.css |  | `52px` |  | `16px` |  |  |  |  | `var(--onyx-text)` |
<!-- END GENERATED STYLE INVENTORY -->
