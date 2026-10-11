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
| 943461 | 23157 | 6445 | 7326 | 20880 | 11 | 204 | 230 | 2947 | 2766 |

## G1. Stylesheets in cascade order (index.html)

| # | file | KiB | lines | rules | selectors | decls | !imp | @media | @container | tokens defined | key classes | dead rules (decls) | decls shadowed by a later identical selector | rules fully shadowed | top class prefixes | views emitting its classes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `app.css` | 166.2 | 4127 | 1287 | 1436 | 4778 | 9 | 21 | 0 | 112 | 927 | 74 (258) | 306 | 42 | onyx-account 85, onyx-home 46, onyx-call 46, onyx-member 32, onyx-rail 30, onyx-moddesk 24, onyx-dmsafe 20, onyx-spotlight 19, onyx-calls 18, onyx-steward 18 | View/Account.elm 82, View/Thread.elm 74, View/DmSafety.elm 50, View/Profile.elm 50, View/Home.elm 47, View/Connect.elm 46, View/CallStage.elm 34, View/Composer.elm 31 |
| 2 | `css/gap-appearance.css` | 15.0 | 315 | 61 | 66 | 141 | 0 | 7 | 0 | 61 | 19 | 5 (5) | 1 | 0 | shell-msg 2, onyx-message 2, onyx-day 1, onyx-avatar 1, onyx-rail 1, onyx-mlist 1, onyx-member 1, onyx-home 1, onyx-frame 1, onyx-thread 1 | View/Thread.elm 5, View/MessageText.elm 2, View/Roster.elm 2, View/Composer.elm 2, View/Appearance.elm 2, Avatar.elm 1, View/Rail.elm 1, View/Home.elm 1 |
| 3 | `css/pol-stats.css` | 46.2 | 1080 | 301 | 333 | 1059 | 1 | 7 | 0 | 11 | 124 | 0 (0) | 2 | 0 | public-room 19, stats-feed 8, stats-inspector 6, data-room 6, status-observation 4, stats-window 4, stats-chart 3, stats-heatmap 3, channel-spark 3, status-check 2 | View/Stats.elm 91, View/Status.elm 12, View/Roadmap.elm 11, View/About.elm 6, View/Download.elm 3, View/NotFound.elm 1 |
| 4 | `css/pol-studio.css` | 47.7 | 1846 | 303 | 342 | 1175 | 0 | 12 | 2 | 0 | 183 | 0 (0) | 7 | 0 | ts-pv 39, ts-audit 17, background-picker 9, ts-token 9, ts-factory 7, ts-theme 7, ts-preview 6, ap-theme 5, ap-background 4, ap-readiness 4 | View/Studio.elm 126, View/Appearance.elm 49, View/Appeal.elm 1, App.elm 1 |
| 5 | `css/pol-shell.css` | 63.1 | 1472 | 463 | 518 | 1382 | 0 | 10 | 0 | 24 | 269 | 8 (28) | 21 | 1 | onyx-rail 42, onyx-room 28, notif-center 19, onyx-account 18, onyx-home 13, guest-claim 9, onyx-nav 8, onyx-calls 7, moderation-desk 5, onyx-call 5 | View/Rail.elm 40, View/RoomHeader.elm 35, View/Inbox.elm 20, View/Account.elm 18, View/Home.elm 17, View/Nav.elm 16, View/Topbar.elm 16, View/Bans.elm 10 |
| 6 | `css/pol-thread.css` | 109.0 | 2604 | 664 | 814 | 2211 | 0 | 30 | 0 | 74 | 308 | 0 (0) | 9 | 2 | onyx-message 45, shell-msg 39, room-media 31, onyx-thread 23, shell-composer 13, shell-topic 13, pins-item 12, onyx-msg 9, onyx-composer 9, onyx-topic 7 | View/Thread.elm 140, View/Composer.elm 44, View/Search.elm 41, View/Media.elm 31, View/Pins.elm 25, View/MessageText.elm 7, View/Home.elm 4, View/Polish.elm 4 |
| 7 | `css/pol-roster.css` | 16.0 | 476 | 97 | 114 | 331 | 0 | 9 | 0 | 5 | 32 | 0 (0) | 5 | 0 | onyx-mlist 12, onyx-roster 8, onyx-member 6, onyx-avatar 2, onyx-members 2, pt-ico 1, onyx-away 1 | View/Roster.elm 28, Avatar.elm 2, View/Icon.elm 1, View/Stewardship.elm 1 |
| 8 | `css/pol-public.css` | 74.6 | 1829 | 602 | 697 | 1877 | 0 | 22 | 0 | 18 | 297 | 1 (1) | 9 | 0 | onyx-land 53, public-frame 31, ab-scene 9, guides-route 8, guides-progress 7, guides-card 5, public-info 5, guides-index 4, guides-share 4, not-found 4 | View/About.elm 54, View/Landing.elm 47, View/Download.elm 45, View/Guides.elm 44, View/PublicFrame.elm 33, View/Onyxos.elm 27, View/Invite.elm 23, View/Trust.elm 6 |
| 9 | `css/calls-c8.css` | 8.9 | 134 | 69 | 72 | 226 | 0 | 2 | 0 | 2 | 45 | 0 (0) | 5 | 1 | onyx-call 23, onyx-vs 18, onyx-cbtn 2, onyx-ci 1, onyx-voice 1 | View/CallOverlays.elm 23, View/VoiceSettings.elm 20, View/CallPresence.elm 1, View/CallStage.elm 1 |
| 10 | `css/calls-c11.css` | 5.5 | 192 | 36 | 43 | 109 | 0 | 3 | 0 | 0 | 24 | 0 (0) | 4 | 0 | onyx-stage 13, onyx-call 5, onyx-cbtn 2, onyx-tile 2, onyx-ci 1, onyx-sheet 1 | View/StageMode.elm 15, View/CallDock.elm 2, View/CallVideo.elm 2, View/CallStage.elm 2, View/CallPresence.elm 1, View/CallOverlays.elm 1, View/Sheet.elm 1 |
| 11 | `css/polish.css` | 11.6 | 409 | 73 | 91 | 247 | 0 | 5 | 0 | 6 | 34 | 0 (0) | 0 | 0 | time-scrubber 13, shell-composer 9, a2hs-sheet 4, first-run 3, update-available 2, onyx-sheet 1, polish-primary 1, polish-ghost 1 | View/Polish.elm 34 |
| 12 | `css/account2.css` | 6.5 | 168 | 57 | 67 | 193 | 0 | 2 | 0 | 0 | 44 | 0 (0) | 5 | 0 | a2-reclaim 8, a2-status 4, a2-row 3, a2-btn 3, a2-ready 3, a2-confirm 2, a2-person 2, a2-dot 2, a2-sheet 1, a2-body 1 | View/Account2.elm 41, View/Rail.elm 2, View/Appearance.elm 1 |
| 13 | `css/roomsettings.css` | 9.7 | 355 | 88 | 92 | 291 | 0 | 2 | 0 | 0 | 68 | 1 (3) | 0 | 0 | onyx-room 5, rset-bridge 5, rset-toggle 5, rset-event 4, rset-roles 4, rset-access 4, rset-rhythm 4, rset-group 3, rset-readonly 3, rset-insights 3 | View/RoomSettings.elm 29, View/Chanserv.elm 26, View/RoomHeader.elm 6, View/DmSafety.elm 3, View/Notify.elm 1, View/CallPresence.elm 1, View/Sheet.elm 1 |
| 14 | `css/calls-c6.css` | 8.3 | 275 | 62 | 67 | 188 | 0 | 4 | 0 | 1 | 35 | 1 (3) | 16 | 3 | onyx-call 31, onyx-sheet 2, onyx-ci 1, onyx-cbtn 1 | View/CallDock.elm 28, View/Sheet.elm 2, View/CallStage.elm 2, View/CallPresence.elm 1, View/CallOverlays.elm 1 |
| 15 | `css/calls-c4.css` | 11.3 | 165 | 96 | 101 | 231 | 0 | 2 | 0 | 9 | 36 | 0 (0) | 13 | 4 | onyx-call 13, onyx-tile 13, onyx-cq 6, onyx-cbtn 3, onyx-ci 1 | View/CallVideo.elm 25, View/CallStage.elm 6, View/CallOverlays.elm 3, View/CallPresence.elm 1, View/CallDock.elm 1 |
| 16 | `css/gap-convo.css` | 13.4 | 327 | 80 | 91 | 234 | 0 | 11 | 0 | 0 | 38 | 0 (0) | 1 | 0 | gap-attach 7, gap-skeleton 7, gap-drop 5, onyx-message 5, onyx-attach 4, gap-collapsed 3, gap-draft 1, pt-ico 1, shell-attachment 1, gap-search 1 | View/Composer.elm 19, View/Thread.elm 12, View/Search.elm 5, View/Icon.elm 1 |
| 17 | `css/gap-account.css` | 5.5 | 152 | 48 | 51 | 125 | 0 | 3 | 2 | 0 | 30 | 0 (0) | 0 | 0 | gap-list 4, gap-status 3, gap-btn 3, gap-review 3, gap-subhead 2, gap-inline 2, pref-status 1, pref-reset 1, gap-acct 1, onyx-account 1 | View/GapAccount.elm 29, View/Account.elm 1 |
| 18 | `css/gap-oper.css` | 22.7 | 449 | 183 | 206 | 601 | 0 | 9 | 1 | 4 | 109 | 3 (3) | 2 | 0 | onyx-moddesk 7, oc-event 7, oc-btn 6, oc-item 6, oc-bar 5, oc-more 4, oc-replies 4, oc-row 3, oc-review 3, oc-reply 3 | View/ModDesk.elm 26, View/OperTabs.elm 26, View/OperFeedPanel.elm 22, View/OperKit.elm 21, View/Appeal.elm 12, View/Sheet.elm 1 |
| 19 | `css/rx-shell.css` | 32.5 | 697 | 224 | 264 | 493 | 0 | 27 | 0 | 15 | 111 | 0 (0) | 1 | 0 | onyx-rail 30, onyx-railmenu 14, onyx-room 12, onyx-nav 6, onyx-topbar 5, onyx-mlist 4, onyx-sheet 3, room-notify 3, onyx-roster 3, onyx-palette 3 | View/Rail.elm 42, View/RoomHeader.elm 15, View/Topbar.elm 9, View/Roster.elm 8, View/Nav.elm 7, View/Organize.elm 4, View/Sheet.elm 3, View/Notify.elm 3 |
| 20 | `css/gap-chanserv.css` | 9.1 | 288 | 63 | 69 | 221 | 0 | 4 | 0 | 0 | 38 | 0 (0) | 0 | 0 | cs-join 8, cs-slow 4, cs-mlock 3, cs-my 3, cs-pair 2, cs-knock 2, cs-disclosure 1, rset-flags 1, cs-subhead 1, cs-rule 1 | View/Chanserv.elm 37, View/Account2.elm 1 |
| 21 | `css/gap-import.css` | 20.5 | 479 | 168 | 182 | 564 | 0 | 3 | 1 | 4 | 93 | 0 (0) | 0 | 0 | hi-review 7, hi-tally 5, hi-conv 5, hi-batch 5, hi-btn 4, bk-btn 4, bk-select 4, hi-activity 4, bk-dialog 4, bk-detail 4 | View/HistoryImport.elm 51, View/BlockKit.elm 41, View/GapAccount.elm 1 |
| 22 | `css/gap-people.css` | 6.3 | 190 | 37 | 39 | 96 | 0 | 7 | 0 | 0 | 26 | 3 (7) | 0 | 0 | onyx-member 6, onyx-roster 5, moderation-desk 4, onyx-steward 1, chb-check 1, onyx-moddesk 1, gp-webhooks 1, gp-export 1, gp-actions 1, rset-btn 1 | View/RoomTools.elm 7, View/Roster.elm 5, View/Profile.elm 4, View/Bans.elm 3, View/Chanserv.elm 2, View/Stewardship.elm 2, View/ModDesk.elm 1 |
| 23 | `css/gap-organize.css` | 36.7 | 777 | 247 | 273 | 762 | 0 | 5 | 0 | 27 | 134 | 0 (0) | 1 | 0 | gorg-menu 14, gorg-saved 11, gorg-folder 10, gorg-tucked 9, gorg-note 9, gorg-more 8, gorg-preset 5, gorg-choice 4, gorg-rset 4, gorg-digest 4 | View/Organize.elm 97, View/Attention.elm 24, View/Thread.elm 5, View/Rail.elm 2, View.elm 2, View/Chanserv.elm 1, View/Home.elm 1, View/RoomHeader.elm 1 |
| 24 | `css/gap-usermodes.css` | 15.3 | 409 | 124 | 144 | 388 | 0 | 4 | 0 | 0 | 86 | 0 (0) | 0 | 0 | um-memo 13, um-requests 6, um-selfname 6, um-btn 5, um-request 5, um-choice 4, um-inbox 4, um-offline 4, onyx-schedule 4, um-held 4 | View/UserModes.elm 78, View/Composer.elm 4, View/GapAccount.elm 2, View/Scheduled.elm 2 |
| 25 | `css/gap-commands.css` | 5.8 | 175 | 37 | 37 | 126 | 0 | 4 | 1 | 1 | 23 | 0 (0) | 0 | 0 | gap-help 10, gap-keys 5, onyx-action 3, onyx-message 2, onyx-body 1, onyx-sheet 1, onyx-spotlight 1 | View/GapCommands.elm 18, View/Thread.elm 3, View/Sheet.elm 1, View/Switcher.elm 1 |
| 26 | `css/gap-watch.css` | 19.4 | 754 | 135 | 144 | 450 | 0 | 8 | 3 | 10 | 75 | 0 (0) | 2 | 0 | onyx-watch 72, onyx-room 2, pt-ico 1 | View/WatchTogether.elm 74, View/Icon.elm 1 |
| 27 | `css/gap-shell.css` | 16.7 | 392 | 111 | 116 | 394 | 0 | 4 | 0 | 10 | 54 | 1 (2) | 2 | 0 | gs-motd 11, gs-activity 7, gs-join 6, gs-door 4, gs-act 4, gs-more 4, gs-leave 4, gs-seg 3, gs-btn 3, gs-rail 2 | View/GapShell.elm 49, View/Topbar.elm 2, View/Sheet.elm 1, View/Account2.elm 1 |
| 28 | `css/gap-auth.css` | 3.8 | 103 | 23 | 25 | 57 | 0 | 4 | 0 | 0 | 15 | 0 (0) | 0 | 0 | ga-question 3, ga-alt 2, ga-signin 2, conn-title 1, ga-code 1, ga-otp 1, ga-actions 1, ga-problem 1, conn-link 1, ga-note 1 | View/AuthGate.elm 15 |
| 29 | `css/gap-claim.css` | 6.0 | 188 | 46 | 48 | 130 | 0 | 3 | 3 | 0 | 24 | 0 (0) | 0 | 0 | gc-btn 4, gc-facts 3, gc-note 3, gc-card 2, pref-group 2, gc-lead 2, gc-bar 2, pref-label 1, gc-kicker 1, gc-ask 1 | View/GapClaim.elm 21, View/GapAccount.elm 3 |
| 30 | `css/ui-sheets.css` | 69.0 | 1615 | 386 | 441 | 1116 | 0 | 27 | 0 | 57 | 160 | 0 (0) | 6 | 0 | onyx-spotlight 15, onyx-you 14, onyx-sheet 13, onyx-member 11, notif-center 10, onyx-account 8, pref-category 7, onyx-profile 5, onyx-toast 5, rset-toggle 4 | View/Switcher.elm 18, View/Profile.elm 16, View/Browser.elm 14, View/Prefs.elm 13, View/Sheet.elm 12, View/Nav.elm 12, View/Inbox.elm 10, View/Account.elm 9 |
| 31 | `css/pol-ios.css` | 5.0 | 132 | 18 | 21 | 30 | 1 | 6 | 0 | 0 | 5 | 0 (0) | 0 | 0 | onyx-frame 1, onyx-mobile 1, onyx-composer 1, onyx-sheet 1, a2hs-sheet 1 | View.elm 1, View/Nav.elm 1, View/Composer.elm 1, View/Sheet.elm 1, View/Polish.elm 1 |
| 32 | `css/calls-engine.css` | 34.0 | 583 | 256 | 322 | 654 | 0 | 25 | 5 | 13 | 84 | 0 (0) | 6 | 0 | onyx-call 56, onyx-tile 6, onyx-cbtn 5, onyx-join 4, onyx-vs 4, onyx-voice 3, onyx-calls 2, onyx-ci 1, onyx-header 1, onyx-sec 1 | View/CallStage.elm 29, View/CallDock.elm 16, View/CallPresence.elm 14, View/CallOverlays.elm 9, View/CallVideo.elm 9, View/VoiceSettings.elm 4, View/Calls.elm 2, View/Sheet.elm 1 |

Each file's own header comment (its declared ownership):

- **app.css** — Onyx Elm shell — abyssal monochrome + single sea-glass accent. System stack, 6px radii, hierarchy via weight/size. No gradients.
- **css/gap-appearance.css** — v3/gap-appearance — themes, text size, density, width, contrast and the background scene, for every surface. Loaded right after app.css.  1. Theme bridge. The shell paints with --onyx-*; the active theme (built- in, custom, or a Theme Studio session) arrives as palette tokens. The ONE derivation is Elm's ShellPalette (AA-guarded, Ocean anchored to the house cut), committed inline on &lt;html> as --onyx-theme-&lt;slot> (base) and --onyx-theme-hc-&lt;slot> (high contrast). This file only selects a set; the fallbacks are the house values, so first paint is unchanged. 2. High contrast follows the Raise-contrast switch AND prefers-contrast. 3. One focus ring (--focus-ring), thicker under high contrast. 4.
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
- **css/gap-convo.css** — v3/gap-convo — conversation gaps: the quiet "Saved here" draft line, the file drop target, staged-photo privacy + quality, hidden-sender banner, earlier-versions disclosure, search empty state, and the pulse a row gets when a jump lands on it. Linked after pol-thread.css and before ui-sheets.css. Tokens only; flat surfaces; one accent for "this is the thing you jumped to / the choice you made".
- **css/gap-account.css** — v3/gap-account — Account protection / names, Preferences data controls (local history, saved searches, portable-vault review). Linked before ui-sheets.css so sheet-level polish still wins. Uses only the shared tokens: near-black surfaces, one accent for the primary action and focus, 6px radii, 44px targets on touch.
- **css/gap-oper.css** — v3/gap-oper — the operator desk: Live feed, Bans, Silence, Abuse, Appeals, Content, Network.  One calm surface: a wide side panel on desktop, a bottom sheet on phones (the shared sheet rules), seven tabs, and inside each tab small bordered cards. The accent means one thing here — the current tab, the pressed chip, the primary action. Danger is the existing red border, never a fill. Text stays >= 14px; inputs are 16px on touch so iOS does not zoom; every control is 44px on coarse pointers.  Linked before ui-sheets.css, so every rule that has to beat a sheet rule carries its own specificity.
- **css/rx-shell.css** — v3/rx-shell — the app frame on every aspect ratio.  Loaded after the pol-* files and before ui-sheets.css. Owns the frame geometry across the viewport matrix plus the shell pieces this pass added (row menu, empty collections, the topbar compose glyph):  0. tokens + extra shell glyphs 1. sidebar rows: the overflow control, touch rows, row menu 2. empty Rooms / Messages collections 3. topbar compose; nav totals that read on every nav form 4. compact two-pane (600–767px: foldables open, small tablets, 200% zoom) — nav rail · list · conversation, not a stretched phone 5. touch at tablet / desktop widths (hover: none): 44px targets, 16px fields 6. short windows (≤520px tall: landscape phones, sho
- **css/gap-chanserv.css** — v3/gap-chanserv — registered-room services and the channel-operator tools: nested disclosures in Room settings, the mask-list tabs, the join-refusal card with "Ask to join", the hosts' Invite action in the inbox, the composer's slow-mode line.  Tokens only. The accent stays on the one primary action per surface and on focus; danger is the existing --onyx-bad. Linked before ui-sheets.css so the shared sheet rules (44px touch targets under 768px, 16px fields) still win where they overlap.
- **css/gap-import.css** — v3/gap-import — history import (Preferences → Import & export) and BlockKit-lite structured messages (inline cards + their dialogs).  Linked before ui-sheets.css; every selector is namespaced (.hi-* for the import pane, .bk-* for structured messages) so nothing here can reach another surface. Calm, near-black, 1px seams, 6px radii; the one accent marks the primary action, focus and "copied". Touch targets are 44px wherever the pointer is coarse (any width).
- **css/gap-people.css** — v3/gap-people — moderation, people and room-care surfaces.  Owned by the gap-people slice; linked before css/ui-sheets.css so the sheet family keeps the last word on sheet geometry. Tokens come from app.css :root. Covers: 1. the windowed member list ("Show more", content-visibility) 2. the member card's role-gated moderation group 3. Room care (offer entry, notes) 4. the room desk (timed-block review, read-only facts) 5. Room settings tools (webhooks, transcript export)
- **css/gap-organize.css** — v3/gap-organize — room folders, hidden rooms, closed conversations, saved messages, private notes, quiet hours / notification mode / smart mute, the "Since you left" digest, reader mode.  Loaded after the pol-* files and before ui-sheets.css (which owns the sheet frame: layer, veil, head, bottom-sheet behaviour). Every rule here is scoped to a gorg-* class, or to a [data-reader] / [data-testid] hook of this slice, so nothing else moves.  0. glyphs 1. Rooms / Messages lists: folders, the hidden / closed footers, the row overflow control 2. sheets: row menu, folder picker, saved messages 3. shared controls (buttons, inputs, switch) 4. member-card note, room settings, Preferences group 5. Notif
- **css/gap-usermodes.css** — v3/gap-usermodes — privacy switches, message requests, offline messages, server blocks, account rooms, the self name, an offline person's last-seen, and the send-later "where" choice.  Loaded before ui-sheets.css (which still wins the sheet chrome). The shared `pref-*` switch/row classes are reused wherever the look is the same; everything new is `um-*`. Tokens come from :root in app.css.
- **css/gap-commands.css** — =================================================================== v3/gap-commands — action rows (`/me`), the slash-commands sheet (`/help`), the single-key shortcuts switch in the `?` overlay, and the palette's Recent / People icons. Linked before ui-sheets.css: the shared sheet chrome stays theirs; only the classes below are owned here. ===================================================================
- **css/gap-watch.css** — v3/gap-watch — Watch Together (View.WatchTogether): the room activity card, its details disclosure, the start editor sheet and the room More-menu entry. Linked before ui-sheets.css so the shared sheet family keeps the last word on layer, head and phone bottom sheets.  Calm by design: the card is one compact sticky bar above the transcript (panel surface, 1px seam, 6px radius); its details overlay the transcript instead of pushing it, so the reading position never jumps. The accent marks only the host's primary action (play/pause, Join / Accept / Start) and the focus ring. Icons are CSS masks over data-URI SVGs — never font glyphs. Tokens from app.css :root only.
- **css/gap-shell.css** — v3/gap-shell — Activity, join-by-name, room More additions, Leave confirm, the Home network message and the connect gate's "Sign in as" action (views: src/View/GapShell.elm).  Same language as the shell: near-black panels, 1px seams, 6px radii, one accent (focus only here), kinds told by a small dot, not colour floods. Linked before ui-sheets.css, so the shared sheet frame (head, phone bottom sheet, swipe) still wins where it should; rules here are scoped to gs-* classes. Icons are CSS masks (never font glyphs).
- **css/gap-auth.css** — v3/gap-auth — the sign-in steps the connect gate was missing: two-step code entry, the pre-001 CHALLENGE question and its stop screens, passkey sign-in, forgot password, and the small links the sign-in form carries. They reuse the connect card's own classes (`.conn-*`, app.css / pol-public.css); only what those do not cover is here. Linked before ui-sheets.css.
- **css/gap-claim.css** — v3/gap-claim — the prompt about history from before this update (rows with no owner stamp): a Home card and a Preferences → History & data card, one decision (Attach / Not now / Delete it).  Linked before ui-sheets.css; every selector is namespaced .gc-*. Calm, near-black, a 1px seam, 6px radii; the one accent marks the primary action and focus. The card sits in the Home column (&lt;= 720px) or the Preferences panel, so it responds to its own width (container query), not the viewport. 44px targets wherever the pointer is coarse.
- **css/ui-sheets.css** — v3/ui-sheets — every overlay, sheet and popover in the shell. Loaded LAST so it wins the cascade over app.css + the pol-* files.  One family: near-black panel, 1px seam, 6px radii, the short cool sheet shadow (--elev-3), a sticky head (kicker / title / subtitle, trailing actions, icon close), and on phones a true bottom sheet — grab handle, internal scroll, safe-area padding, swipe-down to dismiss (pure CSS scroll-snap, see View.Sheet). Desktop keeps centred dialogs in three widths, right-hand side panels, and a top-right popover for the inbox.  Icons are CSS masks over data-URI SVGs (never font glyphs).  v3/rx-sheets — one placement per viewport class, whatever the shell underneath does: co
- **css/pol-ios.css** — v3/ios — the shared iOS / touch plumbing for the app frame.  Loaded last so it can lay device geometry over every surface without restyling them. Reads the geometry tokens from app.css :root: --safe-top/right/bottom/left (env(safe-area-inset-*)), --vvh (visual viewport height, published by ports.js installViewportInsets; 100dvh or 100vh without it) and --kb-inset / --vv-top / &lt;html data-kb>.  1. document feel — no tap flash, no text inflation, no double-tap zoom on controls, press states for touch, chrome not selectable; 2. the app shell — fixed to the visual viewport (so the composer rides above the on-screen keyboard), no rubber-banding, lists scroll inside themselves; 3. safe areas — top 
- **css/calls-engine.css** — v3/calls-engine + v3/rx-calls — the call surfaces at every aspect ratio. Loaded last; overrides only call classes (tokens from app.css).  Anatomy (View.CallStage): the stage is a head row (live status left; timer, people, connection and the security chip right), the people row or the video grid, then a controls-only toolbar. More opens as a row of tools under the controls on roomy stages and as a bottom sheet on phones and short screens; tap or click outside closes it.  Docking: in a conversation the stage (and the pre-join banner) stick to the top of the transcript scroller, so the call controls never scroll away; the transcript moves under them.  Sizing classes: - roomy stage (container >=

## G2. Custom properties — every definition, theme value, runtime writer and use

Status counts: **ok** 169 · **theme-only, unused** 7 · **theme-overridden** 17 · **unused** 12 · **undefined-with-fallback** 28 · **runtime-written** 9 · **theme-only** 7.

Status legend: `ok` defined in CSS and used; `theme-overridden` defined in CSS **and** re-written inline on `<html>` by every theme commit (the inline value wins); `theme-only` used but defined only by the theme maps (undefined until the first appearanceApply); `runtime-written` set by Elm inline style or ports.js; `unused` defined, never read; `UNDEFINED` read without a fallback and defined nowhere; `undefined-with-fallback` read only with a fallback.

| token | status | defined at | first value | theme values (inline on <html>) | runtime writer | uses | used at |
|---|---|---|---|---|---|---|---|
| `--account-head-h` | ok | 4 definitions: ui-sheets.css:923,1216,1590,1593 (selectors in style-map.json) | `71px` |  |  | 1 | ui-sheets.css:927 |
| `--app-max` | ok | rx-shell.css:30<br>rx-shell.css:632 @@media (min-width: 1960px) | `100vw` |  |  | 4 | rx-shell.css:635,641,642,643 |
| `--brand-action` | theme-only, unused |  |  | `#ff987d` ocean |  | 0 |  |
| `--ci` | ok | 29 definitions: app.css:3344,3345,3346,3347,3348,3349,3350,3351,3352,3353,3354,3355,3356,3357,3358 · calls-c8.css:9,10 · calls-c6.css:13 · calls-c4.css:9,10,11,12,13,14,15,16,17 · calls-engine.css:30,32 (selectors in style-map.json) | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | app.css:3341,3342 |
| `--claim-i` | ok | 5 definitions: pol-public.css:633,641,642,643,644 (selectors in style-map.json) | `var(--pub-i-chevron)` |  |  | 2 | pol-public.css:638,639 |
| `--cols` | ok | 4 definitions: calls-engine.css:334,335,336,337 (selectors in style-map.json) | `1` |  |  | 2 | calls-engine.css:346,346 |
| `--composer-h` | ok | app.css:102 | `64px` |  |  | 9 | app.css:4075 · pol-thread.css:2369,2370 · polish.css:393 · ui-sheets.css:800,822,1081,1604 · calls-engine.css:493 |
| `--conn-i` | ok | app.css:1851 `.conn-point-icon--guest`<br>app.css:1852 `.conn-point-icon--claim`<br>app.css:1853 `.conn-point-icon--device` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | app.css:1848,1849 |
| `--context-w` | ok | app.css:100<br>rx-shell.css:624 @@media (min-width: 1600px) | `16rem` |  |  | 1 | app.css:3603 |
| `--convo-measure` | ok | gap-appearance.css:219 `:root[data-width='full']`<br>rx-shell.css:29 | `none` |  |  | 2 | rx-shell.css:612,617 |
| `--danger` | theme-only, unused |  |  | `var(--shu)` all |  | 0 |  |
| `--dur` | theme-overridden | app.css:4105 @@media (prefers-reduced-motion: reduce)<br>app.css:4121 `:root[data-reduce-motion='true']` | `0ms` | `220ms` ocean,obsidian,frost<br>`260ms` tide,reef,teal<br>`240ms` abyss,onyx,shu,hisui,kohaku,terracotta,vermillion,sapphire,slate<br>`200ms` pearl<br>`180ms` ink<br>`250ms` pine |  | 3 | gap-appearance.css:109,110,111 |
| `--dur-base` | ok | 6 definitions: app.css:78,4104,4120 · gap-appearance.css:109,133,140 (selectors in style-map.json) | `220ms` |  |  | 13 | app.css:3063 · pol-thread.css:369 · pol-roster.css:353 · polish.css:347 · ui-sheets.css:83,95,343,811,986,1000,1090,1099 · calls-engine.css:256 |
| `--dur-fast` | ok | 6 definitions: app.css:77,4103,4119 · gap-appearance.css:110,132,139 (selectors in style-map.json) | `160ms` |  |  | 89 | app.css×12 · pol-stats.css×9 · pol-studio.css×25 · pol-shell.css×2 · pol-thread.css×2 · pol-roster.css×1 · pol-public.css×4 · calls-c8.css×1 · polish.css×1 · account2.css×2 · roomsettings.css×1 · calls-c6.css×1 · gap-oper.css×1 · rx-shell.css×1 · gap-chanserv.css×1 · gap-import.css×2 · gap-organize.css×4 · gap-usermodes.css×3 · gap-commands.css×1 · gap-watch.css×2 · gap-auth.css×1 · gap-claim.css×1 · ui-sheets.css×10 · calls-engine.css×1 |
| `--dur-micro` | ok | 6 definitions: app.css:76,4102,4118 · gap-appearance.css:111,131,138 (selectors in style-map.json) | `100ms` |  |  | 8 | pol-thread.css:152,218,425,1123 · pol-roster.css:174 · rx-shell.css:95 · ui-sheets.css:473,647 |
| `--ease` | theme-overridden | app.css:75 | `cubic-bezier(0.16, 1, 0.3, 1)` | `cubic-bezier(0.16, 1, 0.3, 1)` all |  | 99 | app.css×9 · pol-stats.css×9 · pol-studio.css×25 · pol-shell.css×2 · pol-thread.css×7 · pol-roster.css×3 · pol-public.css×4 · calls-c8.css×1 · polish.css×2 · account2.css×2 · roomsettings.css×1 · calls-c6.css×1 · gap-convo.css×1 · gap-oper.css×1 · rx-shell.css×2 · gap-chanserv.css×1 · gap-import.css×2 · gap-organize.css×4 · gap-usermodes.css×3 · gap-commands.css×1 · gap-watch.css×2 · gap-auth.css×1 · gap-claim.css×1 · ui-sheets.css×13 · calls-engine.css×1 |
| `--elev-0` | unused | app.css:87 | `none` |  |  | 0 |  |
| `--elev-1` | unused | app.css:88 | `0 1px 0 color-mix(in oklab, var(--onyx-text) 5%, t…` |  |  | 0 |  |
| `--elev-2` | ok | app.css:89 | `0 14px 36px -28px color-mix(in oklab, var(--onyx-b…` |  |  | 8 | app.css:1763,2164,3789,3871 · pol-thread.css:215 · pol-public.css:556,836 · gap-watch.css:227 |
| `--elev-3` | ok | app.css:90 | `0 28px 56px -32px color-mix(in oklab, #000 90%, tr…` |  |  | 17 | app.css:3940 · pol-shell.css:432,1295 · pol-thread.css:283,592,1357 · pol-roster.css:352 · polish.css:47 · calls-c6.css:104 · ui-sheets.css:91,441,810,813,814,815,999 · calls-engine.css:255 |
| `--focus-offset` | ok | app.css:72<br>gap-appearance.css:82 | `-1px` |  |  | 49 | app.css×8 · gap-appearance.css×1 · pol-stats.css×1 · pol-studio.css×1 · pol-shell.css×1 · pol-thread.css×3 · pol-roster.css×2 · pol-public.css×1 · calls-c8.css×1 · polish.css×2 · account2.css×1 · gap-convo.css×2 · gap-oper.css×6 · gap-import.css×3 · gap-people.css×1 · gap-organize.css×1 · gap-usermodes.css×2 · gap-commands.css×1 · gap-watch.css×3 · gap-shell.css×6 · gap-claim.css×1 · ui-sheets.css×1 |
| `--focus-offset-out` | ok | gap-appearance.css:83 | `2px` |  |  | 9 | app.css:2091,2120,3164 · pol-stats.css:123 · pol-public.css:46 · polish.css:322 · account2.css:57,120 · calls-engine.css:176 |
| `--focus-ring` | ok | app.css:71<br>gap-appearance.css:81 | `1px solid var(--onyx-accent)` |  |  | 74 | app.css×11 · gap-appearance.css×1 · pol-stats.css×4 · pol-studio.css×1 · pol-shell.css×1 · pol-thread.css×5 · pol-roster.css×2 · pol-public.css×2 · calls-c8.css×1 · calls-c11.css×1 · polish.css×3 · account2.css×3 · calls-c6.css×1 · gap-convo.css×2 · gap-oper.css×8 · gap-import.css×5 · gap-people.css×1 · gap-organize.css×1 · gap-usermodes.css×2 · gap-commands.css×2 · gap-watch.css×3 · gap-shell.css×9 · gap-claim.css×1 · ui-sheets.css×1 · calls-engine.css×3 |
| `--focus-width` | ok | 4 definitions: gap-appearance.css:54,69,80,86 (selectors in style-map.json) | `3px` |  |  | 2 | gap-appearance.css:81,82 |
| `--font-display` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:119 |
| `--font-mono` | ok | app.css:35 | `'JetBrains Mono Variable', ui-monospace, 'SFMono-R…` |  |  | 62 | app.css×10 · pol-stats.css×4 · pol-studio.css×5 · pol-shell.css×3 · pol-thread.css×6 · pol-public.css×12 · calls-c8.css×1 · polish.css×2 · account2.css×1 · gap-account.css×1 · gap-oper.css×5 · gap-import.css×3 · gap-people.css×1 · gap-commands.css×1 · gap-watch.css×3 · gap-shell.css×2 · gap-auth.css×1 · ui-sheets.css×1 |
| `--font-sans` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:115,119 |
| `--font-serif` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:124 |
| `--gap-i-clock` | ok | gap-commands.css:10 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | gap-commands.css:174,174 |
| `--gap-row` | unused | app.css:50 | `var(--space-3)` |  |  | 0 |  |
| `--gap-section` | ok | app.css:51 | `var(--space-6)` |  |  | 1 | account2.css:6 |
| `--gap-tight` | unused | app.css:49 | `var(--space-2)` |  |  | 0 |  |
| `--gi-chev` | ok | gap-import.css:13 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | gap-import.css:161,162 |
| `--gi-ext` | ok | gap-import.css:14 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | gap-import.css:372,373 |
| `--gi-field` | ok | gap-import.css:12 | `color-mix(in oklab, var(--onyx-bg) 55%, var(--onyx…` |  |  | 6 | gap-import.css:94,135,214,267,414,422 |
| `--gi-seam` | ok | gap-import.css:11 | `color-mix(in oklab, var(--onyx-line) 55%, var(--on…` |  |  | 1 | gap-import.css:282 |
| `--gold` | theme-overridden | app.css:26 | `#c9a24a` | `#b4bfca` ocean<br>`#5dcbd1` tide<br>`#51a0ad` abyss<br>`#f19173` reef<br>`#c9a24a` onyx<br>`#7fa5b8` obsidian<br>`#896100` pearl<br>`#bbb7b1` ink<br>`#f4733c` shu<br>`#70c5a0` hisui<br>`#a5a51a` pine<br>`#eea563` kohaku<br>`#e8777a` terracotta<br>`#ef7179` vermillion<br>`#00aaf3` sapphire<br>`#72ccab` teal<br>`#ae7853` slate<br>`#00768a` frost |  | 11 | app.css:142 · gap-appearance.css:243,245 · pol-studio.css:553 · pol-thread.css:173,174,180,1235,2277 · pol-public.css:583 · src/View/Studio.elm:1000 |
| `--gold-bright` | theme-overridden | app.css:27 | `#f1d489` | `#f5f7f8` ocean<br>`#92f1f6` tide<br>`#88cedb` abyss<br>`#ffc0ac` reef<br>`#f1d489` onyx<br>`#add1e3` obsidian<br>`#ad7c0a` pearl<br>`#dedad5` ink<br>`#ffb294` shu<br>`#a5e9c9` hisui<br>`#cdcf62` pine<br>`#ffcca1` kohaku<br>`#ffafae` terracotta<br>`#ffafb0` vermillion<br>`#8ad1ff` sapphire<br>`#9feacd` teal<br>`#d8a582` slate<br>`#0096af` frost |  | 3 | pol-shell.css:129 · pol-thread.css:1237 · src/View/Studio.elm:1040 |
| `--gold-deep` | theme-only, unused |  |  | `#71808e` ocean<br>`#3e999d` tide<br>`#236671` abyss<br>`#a9573d` reef<br>`#8c6c2c` onyx<br>`#516f7e` obsidian<br>`#5f4200` pearl<br>`#908c88` ink<br>`#a43e08` shu<br>`#3e8165` hisui<br>`#686800` pine<br>`#a46c36` kohaku<br>`#9c4346` terracotta<br>`#a13d46` vermillion<br>`#006b9b` sapphire<br>`#42876e` teal<br>`#73492b` slate<br>`#00515f` frost |  | 0 |  |
| `--gorg-gutter` | ok | gap-organize.css:651 `.onyx-frame[data-reader="true"]` | `max(var(--space-4), calc((100% - var(--gorg-measur…` |  |  | 2 | gap-organize.css:653,653 |
| `--gorg-measure` | ok | gap-organize.css:650 `.onyx-frame[data-reader="true"]` | `42rem` |  |  | 3 | gap-organize.css:651,660,664 |
| `--grid-h` | ok | calls-engine.css:342 `.onyx-call-video`<br>calls-engine.css:396 `.onyx-call-stage[data-size="expanded"] > .onyx-cal` @@media (min-width: 641px)<br>calls-engine.css:401 `.onyx-call-stage[data-size="fullscreen"] .onyx-cal` @@media (min-width: 641px) | `min(44vh, 30rem)` |  |  | 2 | calls-engine.css:346,349 |
| `--gs-i-activity` | ok | gap-shell.css:12 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | gap-shell.css:101 |
| `--gs-i-check` | ok | gap-shell.css:13 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | gap-shell.css:195 |
| `--gs-i-export` | ok | gap-shell.css:14 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | gap-shell.css:196 |
| `--gs-i-leave` | ok | gap-shell.css:16 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | gap-shell.css:197 |
| `--gs-i-ledger` | ok | gap-shell.css:15 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | gap-shell.css:198 |
| `--gw-bar-h` | ok | gap-watch.css:17<br>gap-watch.css:585 @@media (max-height: 520px) | `56px` |  |  | 1 | gap-watch.css:66 |
| `--gw-control` | ok | gap-watch.css:18<br>gap-watch.css:27 @@media (hover: none), (pointer: coarse) | `36px` |  |  | 7 | gap-watch.css:78,79,254,358,375,417,518 |
| `--gw-i-open` | ok | gap-watch.css:16 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 1 | gap-watch.css:23 |
| `--gw-i-pause` | ok | gap-watch.css:15 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 1 | gap-watch.css:22 |
| `--gw-i-play` | ok | gap-watch.css:14 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 1 | gap-watch.css:21 |
| `--h` | runtime-written |  |  |  | Elm inline style View/Stats.elm:326<br>Elm inline style View/Stats.elm:539<br>Elm inline style View/Stats.elm:573<br>Elm inline style View/Stats.elm:1033 | 2 | pol-stats.css:716,810 |
| `--heat` | runtime-written |  |  |  | Elm inline style View/Stats.elm:633 | 1 | pol-stats.css:831 |
| `--ink` | theme-overridden | app.css:18 | `#000101` | `#202429` ocean<br>`#00060b` tide<br>`#000102` abyss<br>`#000407` reef<br>`#000101` onyx<br>`#000001` obsidian,ink<br>`#f5f0e5` pearl<br>`#080100` shu<br>`#000401` hisui<br>`#000300` pine<br>`#050200` kohaku<br>`#060100` terracotta,vermillion<br>`#000208` sapphire<br>`#000302` teal<br>`#040301` slate<br>`#e3f7fe` frost |  | 3 | pol-studio.css:1227,1390,1448 |
| `--ink-2` | theme-only, unused |  |  | `#262c32` ocean<br>`#000a11` tide<br>`#000103` abyss<br>`#00060a` reef<br>`#010203` onyx<br>`#000101` obsidian<br>`#f1ebe1` pearl<br>`#010102` ink<br>`#0b0201` shu<br>`#000601` hisui<br>`#010501` pine<br>`#080300` kohaku<br>`#0a0200` terracotta<br>`#0a0101` vermillion<br>`#00040d` sapphire<br>`#000603` teal<br>`#060503` slate<br>`#def2f8` frost |  | 0 |  |
| `--kb-inset` | runtime-written | app.css:117 | `0px` |  | ports.js setProperty ports.js:11889 | 12 | app.css:2170,2171,2198,2220 · pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1667 · ui-sheets.css:1067,1075,1077,1081,1110 |
| `--lapis` | theme-overridden | app.css:30 | `#6996c5` | `#65adf5` ocean<br>`#00b8ed` tide<br>`#0091cb` abyss<br>`#0094bc` reef<br>`#6996c5` onyx<br>`#6a9eca` obsidian<br>`#005fa7` pearl<br>`#c9c3bc` ink<br>`#e74142` shu<br>`#00a149` hisui<br>`#3b9f32` pine<br>`#d98b09` kohaku<br>`#d55c27` terracotta<br>`#de5034` vermillion<br>`#0089ea` sapphire<br>`#009d82` teal<br>`#949d7b` slate<br>`#036884` frost |  | 4 | app.css:1708 · pol-studio.css:552,1449 · pol-public.css:582 |
| `--lapis-bright` | theme-overridden | app.css:22 | `#9cc2ea` | `#65adf5` ocean<br>`#9ae0ff` tide<br>`#58c4ff` abyss<br>`#0bc9ff` reef<br>`#9cc2ea` onyx<br>`#9ecdf6` obsidian<br>`#086fbe` pearl<br>`#ece7e0` ink<br>`#ff958d` shu<br>`#5bd47d` hisui<br>`#79d070` pine<br>`#ffb75d` kohaku<br>`#ff9970` terracotta<br>`#ff9781` vermillion<br>`#7cbdff` sapphire<br>`#00d5b2` teal<br>`#bdc6a5` slate<br>`#2f7791` frost |  | 8 | app.css:1706,1709,2240 · pol-studio.css:1291,1325,1385,1386,1422 |
| `--lapis-deep` | theme-overridden | app.css:23 | `#385b7e` | `#397db8` ocean<br>`#007093` tide<br>`#005477` abyss<br>`#00556e` reef<br>`#385b7e` onyx<br>`#3c6588` obsidian<br>`#003e70` pearl<br>`#9d9892` ink<br>`#940014` shu<br>`#005e28` hisui<br>`#065f00` pine<br>`#8a5600` kohaku<br>`#832e00` terracotta<br>`#8e1900` vermillion<br>`#004f8b` sapphire<br>`#005b4b` teal<br>`#656c51` slate<br>`#003c4d` frost |  | 2 | pol-studio.css:556,1322 |
| `--leading-body` | ok | app.css:65 | `1.5` |  |  | 52 | app.css×2 · pol-stats.css×19 · pol-studio.css×6 · pol-thread.css×7 · pol-public.css×3 · polish.css×1 · gap-convo.css×1 · gap-oper.css×1 · gap-import.css×5 · gap-usermodes.css×1 · gap-shell.css×3 · gap-claim.css×2 · ui-sheets.css×1 |
| `--leading-snug` | ok | app.css:64 | `1.35` |  |  | 100 | app.css×10 · pol-stats.css×10 · pol-studio.css×7 · pol-shell.css×3 · pol-thread.css×12 · pol-roster.css×2 · pol-public.css×3 · calls-c8.css×1 · calls-c11.css×1 · account2.css×1 · gap-convo.css×2 · gap-oper.css×9 · rx-shell.css×2 · gap-import.css×9 · gap-people.css×1 · gap-organize.css×2 · gap-usermodes.css×4 · gap-watch.css×9 · gap-shell.css×2 · gap-auth.css×1 · gap-claim.css×2 · ui-sheets.css×5 · calls-engine.css×2 |
| `--leading-tight` | ok | app.css:63 | `1.15` |  |  | 25 | app.css:1862 · pol-stats.css:82,108,148,239,281,365,380,413,507,580,642,643,681 · pol-studio.css:88,564,572,993,998 · pol-shell.css:1054 · pol-thread.css:521,624,995 · pol-public.css:35 · gap-import.css:140 |
| `--line` | theme-overridden | app.css:33 | `color-mix(in oklab, var(--paper) 40%, transparent)` | `color-mix(in oklab, var(--paper) 40%…` ocean<br>`color-mix(in oklab, var(--paper) 16%…` tide<br>`color-mix(in oklab, var(--paper) 11%…` abyss<br>`color-mix(in oklab, var(--paper) 14%…` reef,pine,terracotta,vermillion,sapphire,teal<br>`color-mix(in oklab, var(--paper) 13%…` onyx,slate<br>`color-mix(in oklab, var(--paper) 12%…` obsidian<br>`color-mix(in oklab, var(--lapis) 28%…` pearl,kohaku<br>`color-mix(in oklab, var(--lapis) 25%…` ink<br>`color-mix(in oklab, var(--shu) 18%, …` shu<br>`color-mix(in oklab, var(--lapis) 22%…` hisui<br>`color-mix(in oklab, var(--paper) 18%…` frost |  | 3 | app.css:1706,1719,1725 |
| `--line-faint` | theme-only, unused |  |  | `color-mix(in oklab, var(--paper) 6%,…` ocean,onyx<br>`color-mix(in oklab, var(--paper) 8%,…` tide<br>`color-mix(in oklab, var(--paper) 5%,…` abyss,obsidian<br>`color-mix(in oklab, var(--gold) 12%,…` reef,terracotta,vermillion,sapphire<br>`color-mix(in oklab, var(--lapis) 12%…` pearl,kohaku<br>`color-mix(in oklab, var(--lapis) 10%…` ink,slate<br>`color-mix(in oklab, var(--shu) 8%, t…` shu<br>`color-mix(in oklab, var(--lapis) 9%,…` hisui<br>`color-mix(in oklab, var(--gold) 11%,…` pine,teal<br>`color-mix(in oklab, var(--gold) 14%,…` frost |  | 0 |  |
| `--mobile-nav-h` | ok | 4 definitions: app.css:101 · pol-shell.css:1207 · rx-shell.css:391,576 (selectors in style-map.json) | `56px` |  |  | 8 | app.css:4060,4075 · pol-shell.css:1413,1419 · polish.css:371 · calls-c6.css:200 · ui-sheets.css:822,1081 |
| `--nav-rail-w` | ok | app.css:95<br>rx-shell.css:650 @@media (min-width: 2400px) and (min-heig | `56px` |  |  | 5 | app.css:3603,3698 · pol-shell.css:1143 · pol-thread.css:2106 · rx-shell.css:542 |
| `--nick-tint` | runtime-written | pol-thread.css:12 | `var(--onyx-line)` |  | Elm inline style View/Thread.elm:567<br>Elm inline style View/Thread.elm:955 | 2 | app.css:147 · pol-thread.css:1032 |
| `--oc-fs` | ok | gap-oper.css:25 `.oper-desk` | `14px` |  |  | 25 | gap-oper.css:28,38,85,108,112,115,165,176,183,196,212,247,263,281,329,353,360,361,367,374,391,393,400,401,403 |
| `--oc-fs-meta` | ok | gap-oper.css:26 `.oper-desk`<br>gap-oper.css:31 `.oper-desk` @@media (max-width: 400px) | `13px` |  |  | 16 | gap-oper.css:36,109,110,166,261,267,324,325,328,330,331,352,354,369,377,392 |
| `--oc-gap` | ok | gap-oper.css:24 `.oper-desk` | `var(--space-3)` |  |  | 3 | gap-oper.css:103,122,172 |
| `--ok` | theme-only |  |  | `#5bc78e` ocean,tide,abyss,reef,onyx,obsidian,ink,shu,hisui,pine,kohaku,terracotta,vermillion,sapphire,teal,slate<br>`#007347` pearl,frost |  | 2 | pol-studio.css:1317 · src/View/Studio.elm:1001 |
| `--onyx-accent` | ok | 4 definitions: app.css:12 · gap-appearance.css:30,48,63 (selectors in style-map.json) | `#46c08a` |  |  | 275 | app.css×105 · gap-appearance.css×1 · pol-stats.css×12 · pol-studio.css×12 · pol-shell.css×13 · pol-thread.css×14 · pol-public.css×24 · polish.css×3 · account2.css×4 · roomsettings.css×3 · calls-c6.css×1 · calls-c4.css×2 · gap-convo.css×8 · gap-account.css×3 · gap-oper.css×14 · rx-shell.css×3 · gap-import.css×11 · gap-people.css×1 · gap-organize.css×11 · gap-usermodes.css×8 · gap-commands.css×2 · gap-watch.css×8 · gap-shell.css×1 · gap-auth.css×1 · gap-claim.css×4 · ui-sheets.css×4 · calls-engine.css×2 |
| `--onyx-accent-ink` | ok | 4 definitions: app.css:13 · gap-appearance.css:31,49,64 (selectors in style-map.json) | `#06281a` |  |  | 53 | app.css×17 · pol-stats.css×1 · pol-studio.css×3 · pol-shell.css×5 · pol-thread.css×4 · pol-public.css×4 · polish.css×1 · account2.css×2 · roomsettings.css×1 · gap-account.css×1 · gap-oper.css×2 · rx-shell.css×1 · gap-import.css×1 · gap-organize.css×3 · gap-usermodes.css×2 · gap-watch.css×3 · gap-claim.css×1 · ui-sheets.css×1 |
| `--onyx-avatar-bg` | runtime-written | pol-thread.css:13 | `var(--onyx-panel-2)` |  | Elm inline style Avatar.elm:213 | 1 | app.css:133 |
| `--onyx-avatar-fg` | runtime-written | pol-thread.css:14 | `var(--onyx-text)` |  | Elm inline style Avatar.elm:214 | 1 | app.css:132 |
| `--onyx-bad` | ok | 4 definitions: app.css:15 · gap-appearance.css:33,51,66 (selectors in style-map.json) | `#e5484d` |  |  | 155 | app.css×33 · pol-stats.css×2 · pol-studio.css×9 · pol-shell.css×8 · pol-thread.css×11 · pol-public.css×4 · calls-c8.css×1 · account2.css×4 · roomsettings.css×2 · calls-c6.css×5 · calls-c4.css×4 · gap-account.css×2 · gap-oper.css×12 · rx-shell.css×3 · gap-chanserv.css×4 · gap-import.css×4 · gap-people.css×6 · gap-organize.css×3 · gap-usermodes.css×2 · gap-watch.css×8 · gap-shell.css×6 · gap-claim.css×5 · ui-sheets.css×17 |
| `--onyx-bad-ink` | ok | gap-appearance.css:34<br>gap-appearance.css:52 `:root[data-high-contrast='true']`<br>gap-appearance.css:67 @@media (prefers-contrast: more) | `var(--onyx-theme-bad-ink, #0b0e12)` |  |  | 2 | app.css:3484 · calls-c6.css:9 |
| `--onyx-bg` | ok | app.css:5<br>gap-appearance.css:23 | `#0b0e12` |  |  | 137 | app.css×32 · gap-appearance.css×2 · pol-stats.css×4 · pol-studio.css×16 · pol-shell.css×12 · pol-thread.css×11 · pol-roster.css×1 · pol-public.css×10 · calls-c8.css×3 · calls-c11.css×1 · polish.css×2 · roomsettings.css×2 · calls-c4.css×4 · gap-convo.css×2 · gap-account.css×1 · gap-oper.css×4 · rx-shell.css×4 · gap-chanserv.css×1 · gap-import.css×1 · gap-people.css×1 · gap-organize.css×3 · gap-usermodes.css×1 · gap-commands.css×1 · gap-watch.css×2 · gap-shell.css×2 · gap-claim.css×1 · ui-sheets.css×7 · calls-engine.css×6 |
| `--onyx-dim` | ok | 4 definitions: app.css:10 · gap-appearance.css:28,46,61 (selectors in style-map.json) | `#9aa3ad` |  |  | 721 | app.css×194 · gap-appearance.css×1 · pol-stats.css×12 · pol-studio.css×39 · pol-shell.css×60 · pol-thread.css×83 · pol-roster.css×8 · pol-public.css×88 · calls-c8.css×9 · calls-c11.css×4 · polish.css×10 · account2.css×9 · roomsettings.css×13 · calls-c6.css×7 · calls-c4.css×8 · gap-convo.css×7 · gap-account.css×5 · gap-oper.css×18 · rx-shell.css×12 · gap-chanserv.css×8 · gap-import.css×18 · gap-people.css×3 · gap-organize.css×22 · gap-usermodes.css×18 · gap-commands.css×3 · gap-watch.css×16 · gap-shell.css×11 · gap-claim.css×4 · ui-sheets.css×25 · calls-engine.css×6 |
| `--onyx-faint` | ok | 4 definitions: app.css:11 · gap-appearance.css:29,47,62 (selectors in style-map.json) | `#606973` |  |  | 257 | app.css×62 · gap-appearance.css×2 · pol-stats.css×2 · pol-studio.css×23 · pol-shell.css×19 · pol-thread.css×12 · pol-roster.css×8 · pol-public.css×25 · calls-c8.css×3 · polish.css×3 · account2.css×1 · roomsettings.css×3 · calls-c6.css×2 · calls-c4.css×1 · gap-convo.css×1 · gap-account.css×2 · gap-oper.css×11 · rx-shell.css×5 · gap-chanserv.css×1 · gap-import.css×10 · gap-people.css×2 · gap-organize.css×20 · gap-usermodes.css×6 · gap-commands.css×3 · gap-watch.css×5 · gap-shell.css×10 · gap-auth.css×1 · gap-claim.css×3 · ui-sheets.css×11 |
| `--onyx-focus` | ok | gap-appearance.css:38 | `var(--onyx-accent)` |  |  | 4 | app.css:1984 · gap-appearance.css:81,310 · pol-public.css:1409 |
| `--onyx-i-alert` | ok | ui-sheets.css:50 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:960,960 |
| `--onyx-i-bell` | ok | ui-sheets.css:48 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 4 | ui-sheets.css:585,586,598,599 |
| `--onyx-i-bolt` | ok | ui-sheets.css:45 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:483,484 |
| `--onyx-i-check` | unused | ui-sheets.css:47 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 0 |  |
| `--onyx-i-chevron` | ok | ui-sheets.css:46 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 10 | gap-oper.css:159,160 · gap-usermodes.css:141,142,259,260 · ui-sheets.css:661,662,1547,1548 |
| `--onyx-i-close` | ok | ui-sheets.css:41 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 4 | ui-sheets.css:71,72,282,283 |
| `--onyx-i-contrast` | ok | ui-sheets.css:51 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:968,969 |
| `--onyx-i-hash` | ok | ui-sheets.css:43 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:486,486 |
| `--onyx-i-link` | unused | ui-sheets.css:49 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 0 |  |
| `--onyx-i-mail` | unused | ui-sheets.css:52 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 0 |  |
| `--onyx-i-person` | ok | ui-sheets.css:44 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 4 | gap-commands.css:173,173 · ui-sheets.css:487,487 |
| `--onyx-i-search` | ok | ui-sheets.css:42 | `url("data:image/svg+xml;utf8,<svg xmlns='http://ww…` |  |  | 2 | ui-sheets.css:456,457 |
| `--onyx-line` | ok | 4 definitions: app.css:8 · gap-appearance.css:26,44,59 (selectors in style-map.json) | `#232b36` |  |  | 675 | app.css×195 · gap-appearance.css×1 · pol-stats.css×8 · pol-studio.css×47 · pol-shell.css×41 · pol-thread.css×66 · pol-roster.css×6 · pol-public.css×79 · calls-c8.css×7 · calls-c11.css×4 · polish.css×11 · account2.css×8 · roomsettings.css×9 · calls-c6.css×2 · calls-c4.css×6 · gap-convo.css×7 · gap-account.css×6 · gap-oper.css×19 · rx-shell.css×6 · gap-chanserv.css×4 · gap-import.css×25 · gap-people.css×7 · gap-organize.css×17 · gap-usermodes.css×17 · gap-commands.css×2 · gap-watch.css×12 · gap-shell.css×13 · gap-auth.css×1 · gap-claim.css×6 · ui-sheets.css×36 · calls-engine.css×7 |
| `--onyx-nav-glyph` | ok | 6 definitions: app.css:2377,2378,2379,2380,2381 · rx-shell.css:37 (selectors in style-map.json) | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | app.css:2373,2374 |
| `--onyx-panel` | ok | app.css:6<br>gap-appearance.css:24 | `#12161c` |  |  | 181 | app.css×49 · pol-stats.css×4 · pol-studio.css×14 · pol-shell.css×11 · pol-thread.css×23 · pol-roster.css×9 · pol-public.css×24 · calls-c8.css×2 · calls-c11.css×1 · polish.css×2 · account2.css×2 · calls-c6.css×1 · gap-convo.css×2 · gap-oper.css×8 · rx-shell.css×1 · gap-chanserv.css×1 · gap-import.css×6 · gap-organize.css×2 · gap-watch.css×2 · gap-shell.css×2 · gap-claim.css×1 · ui-sheets.css×9 · pol-ios.css×1 · calls-engine.css×4 |
| `--onyx-panel-2` | ok | app.css:7<br>gap-appearance.css:25 | `#181e27` |  |  | 290 | app.css×68 · pol-stats.css×5 · pol-studio.css×18 · pol-shell.css×33 · pol-thread.css×42 · pol-roster.css×6 · pol-public.css×15 · calls-c8.css×2 · polish.css×4 · account2.css×2 · roomsettings.css×6 · calls-c6.css×1 · calls-c4.css×3 · gap-convo.css×6 · gap-oper.css×5 · rx-shell.css×8 · gap-chanserv.css×3 · gap-import.css×5 · gap-people.css×1 · gap-organize.css×15 · gap-usermodes.css×7 · gap-commands.css×3 · gap-watch.css×5 · gap-shell.css×6 · gap-auth.css×1 · gap-claim.css×2 · ui-sheets.css×16 · calls-engine.css×2 |
| `--onyx-scene-alpha` | ok | 5 definitions: gap-appearance.css:271,274,278,280,282 (selectors in style-map.json) | `0.7` |  |  | 1 | gap-appearance.css:267 |
| `--onyx-success` | ok | gap-appearance.css:36<br>gap-appearance.css:53 `:root[data-high-contrast='true']`<br>gap-appearance.css:68 @@media (prefers-contrast: more) | `var(--onyx-theme-success, #46c08a)` |  |  | 3 | app.css:939,1354 · ui-sheets.css:813 |
| `--onyx-text` | ok | 4 definitions: app.css:9 · gap-appearance.css:27,45,60 (selectors in style-map.json) | `#e8e6e1` |  |  | 565 | app.css×158 · gap-appearance.css×2 · pol-stats.css×8 · pol-studio.css×52 · pol-shell.css×52 · pol-thread.css×62 · pol-roster.css×7 · pol-public.css×52 · calls-c8.css×10 · polish.css×10 · account2.css×8 · roomsettings.css×9 · calls-c6.css×1 · calls-c4.css×4 · gap-convo.css×5 · gap-account.css×1 · gap-oper.css×8 · rx-shell.css×7 · gap-chanserv.css×5 · gap-import.css×9 · gap-people.css×2 · gap-organize.css×20 · gap-usermodes.css×7 · gap-commands.css×4 · gap-watch.css×14 · gap-shell.css×14 · gap-auth.css×2 · gap-claim.css×5 · ui-sheets.css×23 · calls-engine.css×4 |
| `--onyx-theme-accent` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:30 |
| `--onyx-theme-accent-ink` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:31 |
| `--onyx-theme-bad` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:33 |
| `--onyx-theme-bad-ink` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:34 |
| `--onyx-theme-bg` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:23 |
| `--onyx-theme-dim` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:28 |
| `--onyx-theme-faint` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:29 |
| `--onyx-theme-hc-accent` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:48,63 |
| `--onyx-theme-hc-accent-ink` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:49,64 |
| `--onyx-theme-hc-bad` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:51,66 |
| `--onyx-theme-hc-bad-ink` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:52,67 |
| `--onyx-theme-hc-dim` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:46,61 |
| `--onyx-theme-hc-faint` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:47,62 |
| `--onyx-theme-hc-line` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:44,59 |
| `--onyx-theme-hc-success` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:53,68 |
| `--onyx-theme-hc-text` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:45,60 |
| `--onyx-theme-hc-warn` | undefined-with-fallback |  |  |  |  | 2 | gap-appearance.css:50,65 |
| `--onyx-theme-line` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:26 |
| `--onyx-theme-panel` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:24 |
| `--onyx-theme-panel-2` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:25 |
| `--onyx-theme-success` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:36 |
| `--onyx-theme-text` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:27 |
| `--onyx-theme-warn` | undefined-with-fallback |  |  |  |  | 1 | gap-appearance.css:32 |
| `--onyx-warn` | ok | 4 definitions: app.css:14 · gap-appearance.css:32,50,65 (selectors in style-map.json) | `#d9a13b` |  |  | 122 | app.css×40 · pol-stats.css×3 · pol-studio.css×11 · pol-shell.css×7 · pol-thread.css×6 · pol-public.css×4 · calls-c8.css×4 · calls-c11.css×6 · account2.css×3 · roomsettings.css×1 · calls-c4.css×5 · gap-convo.css×3 · gap-oper.css×4 · gap-chanserv.css×1 · gap-import.css×7 · gap-people.css×2 · gap-organize.css×3 · gap-usermodes.css×1 · gap-watch.css×2 · gap-shell.css×5 · gap-claim.css×2 · ui-sheets.css×1 · calls-engine.css×1 |
| `--overlay-docked` | unused | pol-thread.css:2112 `.onyx-sheet-layer.onyx-thread-pop` @@media (min-width: 1100px) | `1` |  |  | 0 |  |
| `--pad-control` | unused | app.css:52 | `var(--space-3)` |  |  | 0 |  |
| `--pad-panel` | ok | app.css:53 | `var(--space-4)` |  |  | 2 | app.css:3926 · account2.css:6 |
| `--pad-panel-lg` | unused | app.css:54 | `var(--space-5)` |  |  | 0 |  |
| `--paper` | theme-overridden | app.css:24 | `#eae8e0` | `#f5f7f8` ocean<br>`#d1e1e9` tide<br>`#d4e0e8` abyss<br>`#d2e1e8` reef<br>`#eae8e0` onyx<br>`#d6dfe7` obsidian<br>`#251e15` pearl<br>`#f0eae2` ink<br>`#ebdad5` shu<br>`#d6e2d8` hisui<br>`#d8e1d6` pine<br>`#e4ddd0` kohaku<br>`#e8dbd4` terracotta<br>`#eadad6` vermillion<br>`#d4e0eb` sapphire<br>`#d3e2dc` teal<br>`#eae7e2` slate<br>`#202b2e` frost |  | 9 | app.css:33 · pol-studio.css:1226,1287,1321,1334,1343,1362,1418,1481 |
| `--paper-dim` | theme-overridden | app.css:25 | `#a4a19a` | `#b4bfca` ocean<br>`#8c9ba2` tide<br>`#8f9aa1` abyss<br>`#8d9ba2` reef<br>`#a4a19a` onyx<br>`#9199a1` obsidian<br>`#494136` pearl<br>`#a9a49c` ink<br>`#a49490` shu<br>`#919c92` hisui<br>`#939b91` pine<br>`#9e988b` kohaku<br>`#a1968f` terracotta<br>`#a39591` vermillion<br>`#8f9aa5` sapphire<br>`#8e9c97` teal<br>`#a7a49e` slate<br>`#4c575a` frost |  | 5 | app.css:1719,1721 · pol-studio.css:1312,1469,1491 |
| `--paper-mute` | theme-only |  |  | `#b4bfca` ocean<br>`#5b7079` tide<br>`#56666f` abyss<br>`#54676f` reef<br>`#6e6c63` onyx<br>`#5a656e` obsidian<br>`#71675a` pearl<br>`#706b63` ink<br>`#725e59` shu<br>`#5a685b` hisui<br>`#5c675a` pine<br>`#6d6555` kohaku<br>`#6f6057` terracotta<br>`#715e5a` vermillion<br>`#576573` sapphire<br>`#556861` teal<br>`#716e68` slate<br>`#65787d` frost |  | 9 | pol-studio.css:1256,1300,1316,1326,1370,1413,1419,1477,1494 |
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
| `--pip-ix` | undefined-with-fallback |  |  |  |  | 4 | calls-c6.css:109,114,119,124 |
| `--pip-iy` | undefined-with-fallback |  |  |  |  | 5 | calls-c6.css:110,115,120,125 · calls-engine.css:493 |
| `--pt-compact-ts` | ok | pol-thread.css:2056 | `3.25rem` |  |  | 5 | pol-thread.css:2239,2240,2247,2280,2281 |
| `--pt-glyph` | ok | 32 definitions: pol-thread.css:68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96 · gap-watch.css:21,22,23 (selectors in style-map.json) | `var(--pt-i-react)` |  |  | 2 | pol-thread.css:33,34 |
| `--pt-gutter` | ok | 4 definitions: gap-appearance.css:185,189 · pol-thread.css:17,2015 (selectors in style-map.json) | `calc(1.5rem + var(--space-2) + var(--space-2))` |  |  | 4 | pol-thread.css:104,148,494,565 |
| `--pt-hover` | ok | pol-thread.css:15 | `color-mix(in oklab, var(--onyx-panel) 72%, transpa…` |  |  | 3 | pol-thread.css:118,197 · gap-convo.css:255 |
| `--pt-i-arrow-down` | ok | pol-thread.css:48 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:78 |
| `--pt-i-attach` | ok | pol-thread.css:44 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:74 · polish.css:83 |
| `--pt-i-calendar` | ok | pol-thread.css:54 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:84 · polish.css:85 |
| `--pt-i-chart` | ok | pol-thread.css:55 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:85 · polish.css:87 |
| `--pt-i-check` | ok | pol-thread.css:46 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:76 |
| `--pt-i-chevron-down` | ok | pol-thread.css:50 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:80 |
| `--pt-i-chevron-up` | ok | pol-thread.css:49 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:79 |
| `--pt-i-clock` | ok | pol-thread.css:53 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:83 · polish.css:84 |
| `--pt-i-download` | ok | pol-thread.css:59 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 3 | pol-thread.css:89,753,754 |
| `--pt-i-emoji` | ok | pol-thread.css:39 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-thread.css:69 · polish.css:86 |
| `--pt-i-file` | ok | pol-thread.css:52 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:82 |
| `--pt-i-hash` | ok | pol-thread.css:61 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:91 |
| `--pt-i-image` | ok | pol-thread.css:57 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:87 |
| `--pt-i-link` | ok | pol-thread.css:58 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:88 |
| `--pt-i-lock` | ok | pol-thread.css:66 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:94 |
| `--pt-i-message` | ok | pol-thread.css:63 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:93 |
| `--pt-i-more` | ok | pol-thread.css:42 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 3 | pol-thread.css:72,579,580 |
| `--pt-i-people` | ok | pol-thread.css:62 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:92 |
| `--pt-i-pin` | ok | pol-thread.css:60 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:90 |
| `--pt-i-plus` | ok | pol-thread.css:43 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 5 | pol-thread.css:73,1202,1203 · polish.css:78,79 |
| `--pt-i-react` | ok | pol-thread.css:38 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:68 |
| `--pt-i-reply` | ok | pol-thread.css:40 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:70 |
| `--pt-i-search` | ok | pol-thread.css:51 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:81 |
| `--pt-i-send` | ok | pol-thread.css:45 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:75 |
| `--pt-i-slash` | ok | pol-thread.css:56 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:86 |
| `--pt-i-thread` | ok | pol-thread.css:41 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:71 |
| `--pt-i-x` | ok | pol-thread.css:47 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:77 |
| `--pt-i-zoom-in` | ok | pol-thread.css:64 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:95 |
| `--pt-i-zoom-out` | ok | pol-thread.css:65 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 1 | pol-thread.css:96 |
| `--pt-measure` | ok | gap-appearance.css:218 `:root[data-width='full']`<br>pol-thread.css:2054<br>pol-thread.css:2083 @@media (min-width: 2200px) and (min-heig | `none` |  |  | 5 | pol-thread.css:1434,2062,2067,2069,2070 |
| `--pt-seam` | ok | pol-thread.css:16 | `color-mix(in oklab, var(--onyx-line) 55%, var(--on…` |  |  | 5 | pol-thread.css:710,756,775,2185,2565 |
| `--pt-thread-w` | ok | pol-thread.css:2055 | `clamp(320px, 28vw, 420px)` |  |  | 2 | pol-thread.css:2106,2117 |
| `--pub-gutter` | ok | pol-public.css:15 `.public-frame`<br>pol-public.css:257 `.public-frame` @@media (max-width: 768px)<br>pol-public.css:343 `.public-frame` @@media (max-width: 359px) | `var(--space-6, 24px)` |  |  | 12 | pol-public.css:87,87,174,174,194,194,210,283,1303,1304,1812,1813 |
| `--pub-header-h` | ok | 4 definitions: pol-public.css:16,257,1693,1781 (selectors in style-map.json) | `64px` |  |  | 11 | pol-public.css:85,271,907,996,1051,1052,1178,1263,1456,1772,1818 |
| `--pub-i-arrow` | ok | pol-public.css:19 `.public-frame` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 6 | pol-public.css:464,465,615,616,712,713 |
| `--pub-i-chevron` | ok | pol-public.css:18 `.public-frame` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 9 | pol-public.css:329,330,633,735,736,1147,1148,1749,1750 |
| `--pub-i-refresh` | ok | pol-public.css:468 `.pub-refresh` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 2 | pol-public.css:469,470 |
| `--pub-measure` | ok | pol-public.css:14 `.public-frame`<br>pol-public.css:1693 `.public-frame` @@media (min-width: 1700px)<br>pol-public.css:1699 `.public-frame` @@media (min-width: 2400px) | `var(--shell-measure, 1180px)` |  |  | 4 | pol-public.css:84,174,191,208 |
| `--r-0` | theme-only |  |  | `0px` all |  | 1 | gap-appearance.css:108 |
| `--r-md` | theme-only |  |  | `8px` ocean,abyss<br>`12px` tide<br>`11px` reef<br>`4px` onyx,pearl,shu,hisui,kohaku<br>`3px` obsidian<br>`2px` ink<br>`7px` pine<br>`9px` terracotta,slate<br>`6px` vermillion<br>`5px` sapphire<br>`13px` teal<br>`10px` frost |  | 1 | gap-appearance.css:108 |
| `--r-pill` | theme-overridden | app.css:34 | `999px` | `999px` all |  | 39 | app.css×2 · pol-stats.css×5 · pol-studio.css×9 · pol-shell.css×9 · pol-thread.css×9 · pol-roster.css×1 · account2.css×1 · gap-organize.css×3 |
| `--r-sm` | theme-only |  |  | `4px` ocean,terracotta,slate<br>`6px` tide,teal<br>`3px` abyss,pine,vermillion<br>`5px` reef,frost<br>`2px` onyx,pearl,shu,hisui,kohaku,sapphire<br>`1px` obsidian<br>`0px` ink |  | 1 | gap-appearance.css:108 |
| `--radius` | ok | app.css:86<br>gap-appearance.css:108 | `6px` |  |  | 413 | app.css×90 · gap-appearance.css×1 · pol-stats.css×16 · pol-studio.css×25 · pol-shell.css×25 · pol-thread.css×50 · pol-roster.css×5 · pol-public.css×41 · calls-c8.css×8 · calls-c11.css×3 · account2.css×5 · roomsettings.css×9 · calls-c6.css×3 · calls-c4.css×4 · gap-convo.css×6 · gap-account.css×2 · gap-oper.css×16 · rx-shell.css×9 · gap-chanserv.css×7 · gap-import.css×11 · gap-people.css×2 · gap-organize.css×15 · gap-usermodes.css×7 · gap-commands.css×2 · gap-watch.css×11 · gap-shell.css×11 · gap-auth.css×1 · gap-claim.css×3 · ui-sheets.css×23 · calls-engine.css×2 |
| `--room-heat` | runtime-written |  |  |  | Elm inline style View/RoomSettings.elm:1172 | 1 | roomsettings.css:340 |
| `--rows` | ok | 4 definitions: calls-engine.css:338,339,340,341 (selectors in style-map.json) | `1` |  |  | 2 | calls-engine.css:346,346 |
| `--rs-filter` | ok | pol-roster.css:415 `.onyx-roster`<br>pol-roster.css:418 `.onyx-roster:has(.onyx-roster-filter--open), .onyx`<br>pol-roster.css:459 `.onyx-roster:has(.onyx-roster-filter--open), .onyx` @@media (hover: none), (max-width: 599.98 | `0px` |  |  | 1 | pol-roster.css:444 |
| `--rs-head` | ok | pol-roster.css:414 `.onyx-roster`<br>pol-roster.css:457 `.onyx-roster` @@media (hover: none), (max-width: 599.98 | `36px` |  |  | 3 | pol-roster.css:425,431,444 |
| `--rx-surround` | ok | rx-shell.css:31 | `color-mix(in oklab, var(--onyx-bg) 72%, #000)` |  |  | 1 | rx-shell.css:633 |
| `--safe-bottom` | ok | app.css:115 | `env(safe-area-inset-bottom, 0px)` |  |  | 16 | pol-shell.css:1208,1292,1414 · pol-thread.css:366,859,1058,2366 · pol-roster.css:349,367 · rx-shell.css:380,381,382,510,527 · pol-ios.css:92,100 |
| `--safe-left` | ok | app.css:116 | `env(safe-area-inset-left, 0px)` |  |  | 3 | pol-thread.css:859 · rx-shell.css:542 · pol-ios.css:84 |
| `--safe-right` | ok | app.css:114 | `env(safe-area-inset-right, 0px)` |  |  | 3 | pol-thread.css:859,893 · pol-ios.css:85 |
| `--safe-top` | ok | app.css:113 | `env(safe-area-inset-top, 0px)` |  |  | 8 | pol-thread.css:859,892 · pol-roster.css:349,365,366 · pol-ios.css:83,86,121 |
| `--scrub-heat` | ok | polish.css:208 `.time-scrubber__bar` | `0` |  |  | 1 | polish.css:224 |
| `--seam` | theme-only |  |  | `color-mix(in oklab, var(--lapis) 28%…` ocean,slate<br>`color-mix(in oklab, var(--lapis) 50%…` tide<br>`color-mix(in oklab, var(--lapis) 36%…` abyss,kohaku,teal<br>`color-mix(in oklab, var(--lapis) 40%…` reef,shu,terracotta,vermillion,sapphire<br>`color-mix(in oklab, var(--gold) 40%,…` onyx<br>`color-mix(in oklab, var(--lapis) 30%…` obsidian<br>`color-mix(in oklab, var(--gold) 55%,…` pearl<br>`color-mix(in oklab, var(--paper) 16%…` ink<br>`color-mix(in oklab, var(--lapis) 38%…` hisui,pine<br>`color-mix(in oklab, var(--lapis) 34%…` frost |  | 1 | pol-studio.css:1228 |
| `--seam-faint` | theme-only |  |  | `color-mix(in oklab, var(--lapis) 12%…` ocean,obsidian,slate<br>`color-mix(in oklab, var(--lapis) 20%…` tide<br>`color-mix(in oklab, var(--lapis) 13%…` abyss<br>`color-mix(in oklab, var(--lapis) 16%…` reef,shu,terracotta,vermillion,sapphire<br>`color-mix(in oklab, var(--gold) 15%,…` onyx<br>`color-mix(in oklab, var(--gold) 24%,…` pearl<br>`color-mix(in oklab, var(--paper) 7%,…` ink<br>`color-mix(in oklab, var(--lapis) 15%…` hisui,pine,kohaku,teal<br>`color-mix(in oklab, var(--lapis) 14%…` frost |  | 6 | pol-studio.css:1238,1277,1278,1288,1359,1465 |
| `--sheet-close` | ok | 5 definitions: ui-sheets.css:37,324,461,843,1506 (selectors in style-map.json) | `36px` |  |  | 6 | ui-sheets.css:191,256,257,258,259,1479 |
| `--sheet-grip-zone` | ok | ui-sheets.css:38<br>ui-sheets.css:1178 @@media (max-height: 520px) | `22px` |  |  | 8 | gap-oper.css:410 · gap-organize.css:745 · ui-sheets.css:347,357,375,996,1114,1481 |
| `--sheet-head-pad` | ok | ui-sheets.css:30<br>ui-sheets.css:1178 @@media (max-height: 520px)<br>ui-sheets.css:1255 @@media (min-width: 1920px) and (min-heig | `14px` |  |  | 1 | ui-sheets.css:181 |
| `--sheet-max-h` | ok | 5 definitions: ui-sheets.css:36,325,1071,1198,1261 (selectors in style-map.json) | `min(calc(var(--vvh, 100dvh) - 64px), 860px)` |  |  | 8 | ui-sheets.css:87,339,687,885,1113,1214,1215,1266 |
| `--sheet-pad` | ok | 5 definitions: ui-sheets.css:28,323,1142,1197,1254 (selectors in style-map.json) | `20px` |  |  | 33 | pol-shell.css×1 · gap-oper.css×3 · gap-people.css×1 · gap-shell.css×1 · ui-sheets.css×27 |
| `--sheet-top` | unused | ui-sheets.css:29 | `var(--sheet-pad)` |  |  | 0 |  |
| `--sheet-veil` | ok | ui-sheets.css:39 | `color-mix(in srgb, #000 58%, transparent)` |  |  | 5 | ui-sheets.css:82,435,870,985,1090 |
| `--sheet-w` | ok | 9 definitions: ui-sheets.css:131,133,144,156,514,607,1223,1263,1264 (selectors in style-map.json) | `var(--sheet-w-sm)` |  |  | 2 | ui-sheets.css:1158,1159 |
| `--sheet-w-desk` | ok | ui-sheets.css:35<br>ui-sheets.css:1260 @@media (min-width: 1920px) and (min-heig | `500px` |  |  | 2 | ui-sheets.css:144,144 |
| `--sheet-w-lg` | ok | ui-sheets.css:33<br>ui-sheets.css:1258 @@media (min-width: 1920px) and (min-heig | `760px` |  |  | 3 | ui-sheets.css:133,133,699 |
| `--sheet-w-md` | ok | ui-sheets.css:32<br>ui-sheets.css:1257 @@media (min-width: 1920px) and (min-heig | `560px` |  |  | 3 | gap-import.css:406 · ui-sheets.css:126,1158 |
| `--sheet-w-side` | ok | ui-sheets.css:34<br>ui-sheets.css:1259 @@media (min-width: 1920px) and (min-heig | `440px` |  |  | 2 | ui-sheets.css:136,1159 |
| `--sheet-w-sm` | ok | ui-sheets.css:31<br>ui-sheets.css:1256 @@media (min-width: 1920px) and (min-heig | `440px` |  |  | 5 | gap-oper.css:433 · gap-import.css:405 · gap-watch.css:624 · ui-sheets.css:131,131 |
| `--shell-measure` | ok | app.css:94<br>gap-appearance.css:209 `:root[data-width='full'] .onyx-frame` | `1180px` |  |  | 7 | app.css:3656 · pol-public.css:14 · calls-engine.css:61,66,66,66,66 |
| `--shi` | ok | 56 definitions: pol-shell.css:529,530,531,532,533,534,535,536,537,538,539,540,556,557,558,559,560,561,562,563,564,565,984 · rx-shell.css:39,40,41 · gap-organize.css:25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,44,45,46,47,48,49,50,51,52 · gap-shell.css:101,195,196,197,198 (selectors in style-map.json) | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w…` |  |  | 6 | pol-shell.css:526,527,553,554 · gap-shell.css:222,223 |
| `--shu` | theme-overridden | app.css:31 | `#e95145` | `#ff6f61` ocean<br>`#ff7a6c` tide<br>`#f0594b` abyss<br>`#ff6f5e` reef<br>`#e95145` onyx<br>`#e95047` obsidian,pine,sapphire<br>`#bd270a` pearl<br>`#d8412c` ink<br>`#e9523b` shu<br>`#e95146` hisui<br>`#e85336` kohaku<br>`#e8523b` terracotta<br>`#e95144` vermillion<br>`#e95049` teal<br>`#e9523c` slate<br>`#be222b` frost |  | 6 | app.css:1726 · pol-studio.css:554,1391,1455 · pol-public.css:584 · src/View/Studio.elm:999 |
| `--shu-bright` | theme-overridden | app.css:32 | `#ff7f71` | `#ff9484` ocean<br>`#ffa193` tide<br>`#ff7c6e` abyss<br>`#ff9a86` reef<br>`#ff7f71` onyx,hisui<br>`#ff7f72` obsidian,pine,sapphire<br>`#e5462b` pearl<br>`#ff5d44` ink<br>`#ff806a` shu,slate<br>`#ff8066` kohaku<br>`#ff8069` terracotta<br>`#ff7f70` vermillion<br>`#ff7f74` teal<br>`#e64344` frost |  | 3 | app.css:1725,1727 · pol-studio.css:1453 |
| `--sidebar-w` | ok | 5 definitions: app.css:99,3703 · rx-shell.css:389,475,623 (selectors in style-map.json) | `18.5rem` |  |  | 4 | app.css:3603,3698 · pol-shell.css:1143 · pol-thread.css:2106 |
| `--space-0` | unused | app.css:40 | `0` |  |  | 0 |  |
| `--space-1` | ok | app.css:41 | `0.25rem` |  |  | 427 | app.css×60 · gap-appearance.css×3 · pol-stats.css×12 · pol-studio.css×11 · pol-shell.css×32 · pol-thread.css×67 · pol-roster.css×10 · pol-public.css×19 · calls-c8.css×7 · calls-c11.css×2 · polish.css×8 · account2.css×6 · roomsettings.css×11 · calls-c6.css×4 · calls-c4.css×8 · gap-convo.css×5 · gap-account.css×8 · gap-oper.css×12 · rx-shell.css×18 · gap-chanserv.css×10 · gap-import.css×9 · gap-people.css×4 · gap-organize.css×34 · gap-usermodes.css×16 · gap-commands.css×3 · gap-watch.css×7 · gap-shell.css×4 · gap-auth.css×4 · gap-claim.css×4 · ui-sheets.css×9 · calls-engine.css×20 |
| `--space-2` | ok | app.css:42 | `0.5rem` |  |  | 945 | app.css×114 · gap-appearance.css×9 · pol-stats.css×41 · pol-studio.css×43 · pol-shell.css×79 · pol-thread.css×106 · pol-roster.css×21 · pol-public.css×57 · calls-c8.css×13 · calls-c11.css×10 · polish.css×15 · account2.css×16 · roomsettings.css×23 · calls-c6.css×14 · calls-c4.css×9 · gap-convo.css×12 · gap-account.css×13 · gap-oper.css×35 · rx-shell.css×27 · gap-chanserv.css×24 · gap-import.css×28 · gap-people.css×7 · gap-organize.css×37 · gap-usermodes.css×38 · gap-commands.css×3 · gap-watch.css×30 · gap-shell.css×17 · gap-auth.css×2 · gap-claim.css×5 · ui-sheets.css×43 · pol-ios.css×1 · calls-engine.css×53 |
| `--space-3` | ok | app.css:43 | `0.75rem` |  |  | 688 | app.css×99 · gap-appearance.css×2 · pol-stats.css×50 · pol-studio.css×36 · pol-shell.css×43 · pol-thread.css×69 · pol-roster.css×6 · pol-public.css×70 · calls-c8.css×5 · calls-c11.css×7 · polish.css×16 · account2.css×3 · roomsettings.css×8 · calls-c6.css×11 · calls-c4.css×2 · gap-convo.css×10 · gap-account.css×3 · gap-oper.css×25 · rx-shell.css×16 · gap-chanserv.css×17 · gap-import.css×34 · gap-people.css×2 · gap-organize.css×25 · gap-usermodes.css×18 · gap-commands.css×3 · gap-watch.css×21 · gap-shell.css×13 · gap-auth.css×4 · gap-claim.css×5 · ui-sheets.css×36 · pol-ios.css×1 · calls-engine.css×28 |
| `--space-4` | ok | app.css:44 | `1rem` |  |  | 375 | app.css×49 · gap-appearance.css×4 · pol-stats.css×37 · pol-studio.css×35 · pol-shell.css×19 · pol-thread.css×26 · pol-roster.css×4 · pol-public.css×82 · calls-c11.css×5 · polish.css×6 · calls-c6.css×3 · gap-convo.css×7 · gap-account.css×1 · gap-oper.css×4 · rx-shell.css×11 · gap-import.css×6 · gap-organize.css×11 · gap-usermodes.css×2 · gap-commands.css×2 · gap-watch.css×6 · gap-shell.css×5 · gap-auth.css×3 · gap-claim.css×3 · ui-sheets.css×38 · calls-engine.css×6 |
| `--space-5` | ok | app.css:45 | `1.25rem` |  |  | 124 | app.css×15 · gap-appearance.css×1 · pol-stats.css×9 · pol-studio.css×16 · pol-shell.css×2 · pol-thread.css×2 · pol-public.css×44 · calls-c8.css×1 · calls-c6.css×2 · gap-convo.css×3 · rx-shell.css×1 · gap-import.css×1 · gap-organize.css×1 · gap-commands.css×1 · gap-shell.css×3 · gap-auth.css×4 · ui-sheets.css×14 · calls-engine.css×4 |
| `--space-6` | ok | app.css:46 | `1.5rem` |  |  | 84 | app.css×10 · gap-appearance.css×1 · pol-stats.css×5 · pol-studio.css×4 · pol-shell.css×2 · pol-thread.css×2 · pol-roster.css×2 · pol-public.css×39 · polish.css×1 · calls-c6.css×2 · rx-shell.css×1 · gap-watch.css×1 · ui-sheets.css×12 · calls-engine.css×2 |
| `--space-7` | ok | app.css:47 | `2rem` |  |  | 39 | app.css×3 · pol-stats.css×7 · pol-studio.css×1 · pol-thread.css×1 · pol-public.css×23 · gap-convo.css×1 · gap-organize.css×1 · ui-sheets.css×1 · calls-engine.css×1 |
| `--space-8` | ok | app.css:48 | `2.5rem` |  |  | 27 | app.css:1753,2154,2174,2548,3071 · pol-stats.css:334 · pol-studio.css:1829 · pol-shell.css:1052,1052,1072,1437 · pol-public.css:283,504,770,820,822,980,1177,1512,1542,1562,1567,1612,1615,1621,1793 · calls-c6.css:242 |
| `--stone` | theme-overridden | app.css:19 | `#050709` | `#2d333a` ocean<br>`#051820` tide<br>`#010508` abyss<br>`#010f16` reef<br>`#050709` onyx<br>`#020304` obsidian<br>`#e5e0d6` pearl<br>`#030405` ink<br>`#160705` shu<br>`#040f06` hisui<br>`#060e05` pine<br>`#130b01` kohaku<br>`#140904` terracotta<br>`#140604` vermillion<br>`#020b16` sapphire<br>`#010f0a` teal<br>`#110e0a` slate<br>`#d0e4ea` frost |  | 3 | pol-studio.css:1237,1274,1464 |
| `--stone-2` | theme-overridden | app.css:20 | `#0d0f12` | `#343b43` ocean<br>`#12262e` tide<br>`#050c10` abyss<br>`#081a21` reef<br>`#0d0f12` onyx<br>`#07090a` obsidian<br>`#dbd6cc` pearl<br>`#08090c` ink<br>`#21100d` shu<br>`#0c190f` hisui<br>`#0e170d` pine<br>`#1d1507` kohaku<br>`#1f130c` terracotta<br>`#1d0f0b` vermillion<br>`#071420` sapphire<br>`#071914` teal<br>`#1c1a15` slate<br>`#c3d7dd` frost |  | 1 | app.css:1720 |
| `--stone-3` | theme-overridden | app.css:21 | `#16191c` | `#3a424b` ocean<br>`#21343d` tide<br>`#0c1418` abyss<br>`#13252c` reef<br>`#16191c` onyx<br>`#0f1112` obsidian<br>`#d0cbc1` pearl<br>`#0f1113` ink<br>`#2c1a17` shu<br>`#162319` hisui<br>`#182116` pine<br>`#281f11` kohaku<br>`#2a1d16` terracotta<br>`#281814` vermillion<br>`#111e2b` sapphire<br>`#11241e` teal<br>`#282521` slate<br>`#b6cad0` frost |  | 1 | pol-studio.css:1344 |
| `--stone-line` | theme-only, unused |  |  | `#49535e` ocean<br>`#254350` tide<br>`#101c22` abyss<br>`#142f3b` reef<br>`#1e2226` onyx<br>`#15181b` obsidian<br>`#c9c2b5` pearl<br>`#15181c` ink<br>`#3a211c` shu<br>`#1b2e1f` hisui<br>`#1e2c1b` pine<br>`#342812` kohaku<br>`#37241a` terracotta<br>`#351e19` vermillion<br>`#132739` sapphire<br>`#122f26` teal<br>`#343029` slate<br>`#a4c0c8` frost |  | 0 |  |
| `--target-floor` | ok | app.css:70 | `24px` |  |  | 39 | app.css×2 · pol-stats.css×3 · pol-studio.css×3 · pol-thread.css×12 · calls-c8.css×1 · calls-c11.css×3 · polish.css×4 · account2.css×4 · roomsettings.css×2 · calls-c6.css×2 · gap-convo.css×3 |
| `--target-min` | ok | app.css:69 | `44px` |  |  | 184 | app.css×7 · gap-appearance.css×1 · pol-stats.css×11 · pol-studio.css×9 · pol-thread.css×47 · pol-roster.css×3 · pol-public.css×24 · calls-c8.css×1 · calls-c11.css×3 · polish.css×3 · calls-c6.css×2 · gap-convo.css×4 · gap-account.css×5 · gap-oper.css×1 · gap-import.css×4 · gap-people.css×5 · gap-organize.css×14 · gap-usermodes.css×2 · gap-commands.css×2 · gap-watch.css×3 · gap-auth.css×1 · gap-claim.css×1 · calls-engine.css×31 |
| `--text-2xl` | ok | app.css:62 | `1.5rem` |  |  | 5 | app.css:2477 · pol-stats.css:642 · pol-thread.css:514,519,624 |
| `--text-2xs` | ok | app.css:56<br>pol-thread.css:2090 `.onyx-main > .onyx-thread-pane, .onyx-main > .onyx` @@media (min-width: 2200px) and (min-heig | `0.75rem` |  |  | 167 | app.css×44 · pol-stats.css×14 · pol-studio.css×6 · pol-shell.css×8 · pol-thread.css×18 · pol-roster.css×2 · pol-public.css×15 · calls-c8.css×4 · calls-c11.css×1 · polish.css×5 · account2.css×2 · roomsettings.css×2 · calls-c6.css×4 · calls-c4.css×1 · gap-convo.css×3 · gap-account.css×1 · gap-import.css×9 · gap-organize.css×3 · gap-usermodes.css×16 · gap-watch.css×3 · gap-shell.css×2 · gap-auth.css×1 · ui-sheets.css×2 · calls-engine.css×1 |
| `--text-lg` | ok | app.css:60 | `1.0625rem` |  |  | 66 | app.css×18 · pol-stats.css×7 · pol-studio.css×3 · pol-shell.css×4 · pol-thread.css×3 · pol-roster.css×1 · pol-public.css×14 · calls-c8.css×1 · calls-c11.css×1 · calls-c6.css×1 · gap-convo.css×1 · rx-shell.css×3 · gap-import.css×2 · gap-shell.css×1 · gap-auth.css×1 · ui-sheets.css×5 |
| `--text-md` | ok | app.css:59<br>pol-thread.css:2087 `.onyx-main > .onyx-thread-pane, .onyx-main > .onyx` @@media (min-width: 2200px) and (min-heig | `0.9375rem` |  |  | 139 | app.css×23 · pol-stats.css×4 · pol-studio.css×7 · pol-shell.css×14 · pol-thread.css×20 · pol-roster.css×1 · pol-public.css×16 · calls-c8.css×1 · polish.css×3 · roomsettings.css×3 · calls-c6.css×1 · calls-c4.css×1 · gap-oper.css×2 · rx-shell.css×14 · gap-chanserv.css×3 · gap-import.css×3 · gap-organize.css×2 · gap-watch.css×2 · gap-shell.css×5 · gap-claim.css×2 · ui-sheets.css×8 · calls-engine.css×4 |
| `--text-sm` | ok | app.css:58<br>pol-thread.css:2088 `.onyx-main > .onyx-thread-pane, .onyx-main > .onyx` @@media (min-width: 2200px) and (min-heig | `0.8125rem` |  |  | 463 | app.css×86 · gap-appearance.css×1 · pol-stats.css×20 · pol-studio.css×25 · pol-shell.css×32 · pol-thread.css×60 · pol-roster.css×5 · pol-public.css×58 · calls-c8.css×5 · calls-c11.css×3 · polish.css×2 · account2.css×4 · roomsettings.css×12 · calls-c6.css×5 · calls-c4.css×1 · gap-convo.css×6 · gap-account.css×5 · gap-oper.css×1 · rx-shell.css×6 · gap-chanserv.css×4 · gap-import.css×19 · gap-people.css×2 · gap-organize.css×19 · gap-usermodes.css×15 · gap-commands.css×3 · gap-watch.css×15 · gap-shell.css×16 · gap-claim.css×3 · ui-sheets.css×20 · calls-engine.css×10 |
| `--text-xl` | ok | app.css:61 | `1.25rem` |  |  | 24 | app.css:2644 · pol-stats.css:237,363,378,580,643,742,794 · pol-shell.css:1166,1176 · pol-thread.css:1502,2019 · pol-public.css:692,825,964,989,1196,1265,1506,1589,1599 · calls-c6.css:36 · gap-import.css:140 · ui-sheets.css:624 |
| `--text-xs` | ok | app.css:57<br>pol-thread.css:2089 `.onyx-main > .onyx-thread-pane, .onyx-main > .onyx` @@media (min-width: 2200px) and (min-heig | `0.6875rem` |  |  | 161 | app.css×26 · pol-stats.css×7 · pol-studio.css×18 · pol-shell.css×16 · pol-thread.css×16 · pol-roster.css×3 · pol-public.css×9 · calls-c11.css×1 · polish.css×1 · account2.css×7 · roomsettings.css×4 · calls-c6.css×1 · calls-c4.css×3 · gap-account.css×2 · rx-shell.css×3 · gap-chanserv.css×1 · gap-import.css×6 · gap-people.css×3 · gap-organize.css×19 · gap-commands.css×3 · gap-watch.css×4 · gap-shell.css×4 · gap-claim.css×1 · ui-sheets.css×3 |
| `--tool-glyph` | ok | 5 definitions: polish.css:83,84,85,86,87 (selectors in style-map.json) | `var(--pt-i-attach)` |  |  | 2 | polish.css:78,79 |
| `--tracking-kicker` | ok | app.css:66 | `0.06em` |  |  | 69 | app.css×1 · pol-stats.css×8 · pol-studio.css×12 · pol-shell.css×4 · pol-thread.css×7 · pol-roster.css×2 · pol-public.css×9 · calls-c8.css×2 · calls-c11.css×1 · polish.css×1 · account2.css×1 · gap-oper.css×2 · gap-chanserv.css×1 · gap-import.css×6 · gap-people.css×1 · gap-organize.css×4 · gap-watch.css×2 · gap-shell.css×1 · gap-claim.css×1 · ui-sheets.css×3 |
| `--vv-top` | runtime-written | app.css:118 | `0px` |  | ports.js setProperty ports.js:11892 | 1 | pol-ios.css:111 |
| `--vvh` | runtime-written | app.css:119<br>app.css:123 @@supports (height: 100dvh) | `100vh` |  | ports.js setProperty ports.js:11886 | 20 | pol-thread.css:2369,2370,2433 · pol-roster.css:346,347,365,366 · polish.css:393 · ui-sheets.css:36,158,1071,1166,1198,1237,1241,1244,1261,1264 · pol-ios.css:65,66 |
| `--warn` | theme-only, unused |  |  | `#e6d08c` ocean,tide,abyss,reef,onyx,obsidian,ink,shu,hisui,pine,kohaku,terracotta,vermillion,sapphire,teal,slate<br>`#825c00` pearl<br>`#7b5f07` frost |  | 0 |  |

Root data-* attributes written by ports.js on <html>: `data-bound`, `data-density`, `data-experience-mode`, `data-font-scale`, `data-hide-events`, `data-high-contrast`, `data-kb`, `data-reader`, `data-reduce-motion`, `data-reduce-transparency`, `data-shell-scheme`, `data-theme`, `data-width`, `data-yield`.

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
| `--lapis` | #65adf5 | #00b8ed | #0091cb | #0094bc | #6996c5 | #6a9eca | #005fa7 | #c9c3bc | #e74142 | #00a149 | #3b9f32 | #d98b09 | #d55c27 | #de5034 | #0089ea | #009d82 | #949d7b | #036884 |
| `--lapis-bright` | #65adf5 | #9ae0ff | #58c4ff | #0bc9ff | #9cc2ea | #9ecdf6 | #086fbe | #ece7e0 | #ff958d | #5bd47d | #79d070 | #ffb75d | #ff9970 | #ff9781 | #7cbdff | #00d5b2 | #bdc6a5 | #2f7791 |
| `--lapis-deep` | #397db8 | #007093 | #005477 | #00556e | #385b7e | #3c6588 | #003e70 | #9d9892 | #940014 | #005e28 | #065f00 | #8a5600 | #832e00 | #8e1900 | #004f8b | #005b4b | #656c51 | #003c4d |
| `--gold` | #b4bfca | #5dcbd1 | #51a0ad | #f19173 | #c9a24a | #7fa5b8 | #896100 | #bbb7b1 | #f4733c | #70c5a0 | #a5a51a | #eea563 | #e8777a | #ef7179 | #00aaf3 | #72ccab | #ae7853 | #00768a |
| `--gold-bright` | #f5f7f8 | #92f1f6 | #88cedb | #ffc0ac | #f1d489 | #add1e3 | #ad7c0a | #dedad5 | #ffb294 | #a5e9c9 | #cdcf62 | #ffcca1 | #ffafae | #ffafb0 | #8ad1ff | #9feacd | #d8a582 | #0096af |
| `--gold-deep` | #71808e | #3e999d | #236671 | #a9573d | #8c6c2c | #516f7e | #5f4200 | #908c88 | #a43e08 | #3e8165 | #686800 | #a46c36 | #9c4346 | #a13d46 | #006b9b | #42876e | #73492b | #00515f |
| `--brand-action` | #ff987d | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| `--shu` | #ff6f61 | #ff7a6c | #f0594b | #ff6f5e | #e95145 | #e95047 | #bd270a | #d8412c | #e9523b | #e95146 | #e95047 | #e85336 | #e8523b | #e95144 | #e95047 | #e95049 | #e9523c | #be222b |
| `--shu-bright` | #ff9484 | #ffa193 | #ff7c6e | #ff9a86 | #ff7f71 | #ff7f72 | #e5462b | #ff5d44 | #ff806a | #ff7f71 | #ff7f72 | #ff8066 | #ff8069 | #ff7f70 | #ff7f72 | #ff7f74 | #ff806a | #e64344 |
| `--paper` | #f5f7f8 | #d1e1e9 | #d4e0e8 | #d2e1e8 | #eae8e0 | #d6dfe7 | #251e15 | #f0eae2 | #ebdad5 | #d6e2d8 | #d8e1d6 | #e4ddd0 | #e8dbd4 | #eadad6 | #d4e0eb | #d3e2dc | #eae7e2 | #202b2e |
| `--paper-dim` | #b4bfca | #8c9ba2 | #8f9aa1 | #8d9ba2 | #a4a19a | #9199a1 | #494136 | #a9a49c | #a49490 | #919c92 | #939b91 | #9e988b | #a1968f | #a39591 | #8f9aa5 | #8e9c97 | #a7a49e | #4c575a |
| `--paper-mute` | #b4bfca | #5b7079 | #56666f | #54676f | #6e6c63 | #5a656e | #71675a | #706b63 | #725e59 | #5a685b | #5c675a | #6d6555 | #6f6057 | #715e5a | #576573 | #556861 | #716e68 | #65787d |
| `--ok` | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #007347 | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #5bc78e | #007347 |
| `--warn` | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #825c00 | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #e6d08c | #7b5f07 |
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


### G3.1 Colour literals in component rules and component-scoped custom properties (50)

| colour | count | where |
|---|---|---|
| `highlight` | 12 | app.css:2230,2232 · pol-stats.css:1073,1077 · pol-studio.css:331,1738 · pol-shell.css:177 · pol-thread.css:2040,2042 · pol-public.css:1679 · polish.css:385 · gap-commands.css:168 |
| `#000` | 10 | app.css:3915 · pol-studio.css:230,321 · pol-shell.css:422,1282 · pol-thread.css:354,841 · pol-roster.css:355 · ui-sheets.css:153 · calls-engine.css:248 |
| `canvastext` | 9 | pol-stats.css:1070,1071,1078 · pol-roster.css:472,473 · pol-public.css:1680 · polish.css:383,384 · rx-shell.css:695 |
| `buttontext` | 8 | app.css:2231 · pol-studio.css:329,330,1740 · pol-public.css:1677 · rx-shell.css:693 · gap-people.css:188 · gap-commands.css:167 |
| `canvas` | 3 | pol-stats.css:1071 · pol-roster.css:472,473 |
| `rgba(0, 0, 0, 0.35)` | 2 | app.css:3253,3513 |
| `rgb(0 0 0 / 55%)` | 1 | app.css:2833 |
| `rgb(0 8 16 / 45%)` | 1 | app.css:2846 |
| `rgb(0 0 0 / 35%)` | 1 | app.css:3061 |
| `highlighttext` | 1 | pol-studio.css:332 |
| `rgb(0 0 0 / 0.35)` | 1 | polish.css:344 |
| `graytext` | 1 | rx-shell.css:694 |

### G3.2 Colour literals that are :root token definitions (27)

`--onyx-bg` `#0b0e12` app.css:5 · `--onyx-panel` `#12161c` app.css:6 · `--onyx-panel-2` `#181e27` app.css:7 · `--onyx-line` `#232b36` app.css:8 · `--onyx-text` `#e8e6e1` app.css:9 · `--onyx-dim` `#9aa3ad` app.css:10 · `--onyx-faint` `#606973` app.css:11 · `--onyx-accent` `#46c08a` app.css:12 · `--onyx-accent-ink` `#06281a` app.css:13 · `--onyx-warn` `#d9a13b` app.css:14 · `--onyx-bad` `#e5484d` app.css:15 · `--ink` `#000101` app.css:18 · `--stone` `#050709` app.css:19 · `--stone-2` `#0d0f12` app.css:20 · `--stone-3` `#16191c` app.css:21 · `--lapis-bright` `#9cc2ea` app.css:22 · `--lapis-deep` `#385b7e` app.css:23 · `--paper` `#eae8e0` app.css:24 · `--paper-dim` `#a4a19a` app.css:25 · `--gold` `#c9a24a` app.css:26 · `--gold-bright` `#f1d489` app.css:27 · `--lapis` `#6996c5` app.css:30 · `--shu` `#e95145` app.css:31 · `--shu-bright` `#ff7f71` app.css:32 · `--elev-3` `#000` app.css:90 · `--rx-surround` `#000` rx-shell.css:31 · `--sheet-veil` `#000` ui-sheets.css:39

### G3.3 Colour literals inside var() fallbacks (33)

| token → fallback | count | where |
|---|---|---|
| `--onyx-theme-hc-line → #5a6675` | 2 | gap-appearance.css:44,59 |
| `--onyx-theme-hc-text → #e8e6e1` | 2 | gap-appearance.css:45,60 |
| `--onyx-theme-hc-dim → #c9d0d7` | 2 | gap-appearance.css:46,61 |
| `--onyx-theme-hc-faint → #9aa3ad` | 2 | gap-appearance.css:47,62 |
| `--onyx-theme-hc-accent → #46c08a` | 2 | gap-appearance.css:48,63 |
| `--onyx-theme-hc-accent-ink → #06281a` | 2 | gap-appearance.css:49,64 |
| `--onyx-theme-hc-warn → #d9a13b` | 2 | gap-appearance.css:50,65 |
| `--onyx-theme-hc-bad → #e5484d` | 2 | gap-appearance.css:51,66 |
| `--onyx-theme-hc-bad-ink → #0b0e12` | 2 | gap-appearance.css:52,67 |
| `--onyx-theme-hc-success → #46c08a` | 2 | gap-appearance.css:53,68 |
| `--onyx-theme-bg → #0b0e12` | 1 | gap-appearance.css:23 |
| `--onyx-theme-panel → #12161c` | 1 | gap-appearance.css:24 |
| `--onyx-theme-panel-2 → #181e27` | 1 | gap-appearance.css:25 |
| `--onyx-theme-line → #232b36` | 1 | gap-appearance.css:26 |
| `--onyx-theme-text → #e8e6e1` | 1 | gap-appearance.css:27 |
| `--onyx-theme-dim → #9aa3ad` | 1 | gap-appearance.css:28 |
| `--onyx-theme-faint → #606973` | 1 | gap-appearance.css:29 |
| `--onyx-theme-accent → #46c08a` | 1 | gap-appearance.css:30 |
| `--onyx-theme-accent-ink → #06281a` | 1 | gap-appearance.css:31 |
| `--onyx-theme-warn → #d9a13b` | 1 | gap-appearance.css:32 |
| `--onyx-theme-bad → #e5484d` | 1 | gap-appearance.css:33 |
| `--onyx-theme-bad-ink → #0b0e12` | 1 | gap-appearance.css:34 |
| `--onyx-theme-success → #46c08a` | 1 | gap-appearance.css:36 |

### G3.3b Ad-hoc tints: every color-mix() (121 uses, 76 distinct)

| color-mix expression | count | where |
|---|---|---|
| `color-mix(in oklab, var(--onyx-accent) 88%, var(--onyx-text))` | 7 | app.css:1940,2090 · pol-stats.css:119 · pol-studio.css:781 · pol-public.css:148,450,542 |
| `color-mix(in srgb, #000 55%, transparent)` | 6 | app.css:3915 · pol-shell.css:422,1282 · pol-thread.css:354 · pol-roster.css:355 · calls-engine.css:248 |
| `color-mix(in oklab, var(--onyx-bad) 12%, transparent)` | 6 | pol-shell.css:330 · gap-oper.css:223 · rx-shell.css:199 · gap-shell.css:259 · gap-claim.css:136 · ui-sheets.css:1457 |
| `color-mix(in oklab, var(--onyx-bad) 45%, var(--onyx-line))` | 5 | pol-shell.css:130 · gap-people.css:93,162 · ui-sheets.css:1413,1444 |
| `color-mix(in oklab, var(--onyx-bad) 55%, var(--onyx-line))` | 5 | pol-shell.css:282,329 · pol-thread.css:1783,1938 · gap-shell.css:258 |
| `color-mix(in oklab, var(--onyx-panel-2) 60%, transparent)` | 3 | app.css:2137 · pol-studio.css:281 · ui-sheets.css:751 |
| `color-mix(in oklab, var(--onyx-accent) 10%, transparent)` | 3 | pol-stats.css:24 · gap-convo.css:257,259 |
| `color-mix(in oklab, var(--onyx-warn) 45%, transparent)` | 3 | pol-studio.css:670,1542,1625 |
| `color-mix(in oklab, var(--onyx-text) 26%, transparent)` | 3 | ui-sheets.css:370,1011,1128 |
| `color-mix(in oklab, var(--onyx-text) 50%, transparent)` | 2 | app.css:1941,2093 |
| `color-mix(in oklab, var(--onyx-accent) 16%, var(--onyx-panel-2))` | 2 | app.css:1941,2094 |
| `color-mix(in oklab, var(--onyx-dim) 45%, var(--onyx-line))` | 2 | app.css:1983 · pol-shell.css:598 |
| `color-mix(in oklab, var(--onyx-accent) 80%, var(--onyx-bg))` | 2 | app.css:2134 · pol-public.css:1651 |
| `color-mix(in oklab, var(--gold) 9%, transparent)` | 2 | gap-appearance.css:245 · pol-thread.css:173 |
| `color-mix(in oklab, var(--onyx-bad) 14%, transparent)` | 2 | pol-studio.css:1036 · gap-chanserv.css:115 |
| `color-mix(in oklab, var(--onyx-warn) 40%, transparent)` | 2 | pol-studio.css:1179,1601 |
| `color-mix(in oklab, var(--onyx-warn) 12%, transparent)` | 2 | pol-studio.css:1184 · pol-thread.css:1269 |
| `color-mix(in oklab, var(--onyx-line) 55%, var(--onyx-dim))` | 2 | pol-thread.css:16 · gap-import.css:11 |
| `color-mix(in oklab, var(--onyx-accent) 70%, var(--onyx-line))` | 2 | pol-thread.css:1125,1448 |
| `color-mix(in srgb, var(--onyx-bg) 78%, transparent)` | 2 | calls-c4.css:105,121 |
| `color-mix(in oklab, var(--onyx-bad) 10%, transparent)` | 2 | gap-people.css:96 · ui-sheets.css:1032 |
| `color-mix(in oklab, var(--onyx-bad) 40%, var(--onyx-line))` | 2 | gap-people.css:117 · ui-sheets.css:673 |
| `color-mix(in oklab, var(--paper) 40%, transparent)` | 1 | app.css:33 |
| `color-mix(in oklab, var(--onyx-text) 5%, transparent)` | 1 | app.css:88 |
| `color-mix(in oklab, var(--onyx-bg) 88%, transparent)` | 1 | app.css:89 |
| `color-mix(in oklab, #000 90%, transparent)` | 1 | app.css:90 |
| `color-mix(in oklab, var(--onyx-text) 6%, transparent)` | 1 | app.css:90 |
| `color-mix(in srgb, var(--onyx-warn) 12%, transparent)` | 1 | app.css:298 |
| `color-mix(in oklab, var(--lapis-bright) 32%, var(--line))` | 1 | app.css:1706 |
| `color-mix(in oklab, var(--lapis) 10%, transparent)` | 1 | app.css:1708 |
| `color-mix(in oklab, var(--paper-dim) 36%, var(--line))` | 1 | app.css:1719 |
| `color-mix(in oklab, var(--stone-2) 42%, transparent)` | 1 | app.css:1720 |
| `color-mix(in oklab, var(--shu-bright) 34%, var(--line))` | 1 | app.css:1725 |
| `color-mix(in oklab, var(--shu) 10%, transparent)` | 1 | app.css:1726 |
| `color-mix(in oklab, var(--gold) 6%, transparent)` | 1 | gap-appearance.css:243 |
| `color-mix(in oklab, var(--onyx-text) 58%, var(--onyx-bg))` | 1 | pol-stats.css:23 |
| `color-mix(in oklab, var(--pg-text) var(--heat, 4%), var(--onyx-bg))` | 1 | pol-stats.css:831 |
| `color-mix(in oklab, #000 25%, transparent)` | 1 | pol-studio.css:230 |
| `color-mix(in oklab, #000 40%, transparent)` | 1 | pol-studio.css:321 |
| `color-mix(in oklab, var(--lapis-deep, var(--onyx-panel-2)) 40%, transparent)` | 1 | pol-studio.css:1322 |
| `color-mix(in oklab, var(--lapis-bright, var(--onyx-accent)) 45%, transparent)` | 1 | pol-studio.css:1386 |
| `color-mix(in oklab, var(--shu, var(--onyx-bad)) 55%, transparent)` | 1 | pol-studio.css:1455 |
| `color-mix(in oklab, var(--onyx-bad) 30%, var(--onyx-bg))` | 1 | pol-studio.css:1602 |
| `color-mix(in oklab, var(--onyx-panel-2) 55%, transparent)` | 1 | pol-shell.css:99 |
| `color-mix(in oklab, var(--onyx-warn) 40%, var(--onyx-line))` | 1 | pol-shell.css:277 |
| `color-mix(in oklab, var(--onyx-warn) 10%, transparent)` | 1 | pol-shell.css:625 |
| `color-mix(in oklab, var(--onyx-panel) 72%, transparent)` | 1 | pol-thread.css:15 |
| `color-mix(in oklab, var(--gold) 13%, transparent)` | 1 | pol-thread.css:180 |
| `color-mix(in oklab, var(--onyx-text) 9%, var(--onyx-panel))` | 1 | pol-thread.css:416 |
| `color-mix(in oklab, var(--onyx-text) 34%, var(--onyx-line))` | 1 | pol-thread.css:417 |
| `color-mix(in oklab, var(--onyx-bad) 70%, transparent)` | 1 | pol-thread.css:483 |
| `color-mix(in srgb, #000 88%, transparent)` | 1 | pol-thread.css:841 |
| `color-mix(in oklab, var(--onyx-bg) 80%, transparent)` | 1 | pol-thread.css:897 |
| `color-mix(in oklab, var(--onyx-bad) 8%, var(--onyx-panel))` | 1 | pol-thread.css:1940 |
| `color-mix(in oklab, var(--lapis) 38%, var(--onyx-panel-2))` | 1 | pol-public.css:582 |
| `color-mix(in oklab, var(--gold) 46%, var(--onyx-panel-2))` | 1 | pol-public.css:583 |
| `color-mix(in oklab, var(--shu) 30%, var(--onyx-panel-2))` | 1 | pol-public.css:584 |
| `color-mix(in oklab, var(--onyx-warn) 50%, transparent)` | 1 | pol-public.css:1078 |
| `color-mix(in oklab, var(--onyx-bad) 60%, transparent)` | 1 | pol-public.css:1124 |
| `color-mix(in srgb, var(--onyx-bg) 94%, transparent)` | 1 | calls-c8.css:64 |
| `color-mix(in srgb, var(--onyx-text) 75%, var(--onyx-bg))` | 1 | calls-c8.css:82 |
| `color-mix(in oklab, var(--onyx-bg) 78%, transparent)` | 1 | gap-convo.css:48 |
| `color-mix(in oklab, var(--onyx-accent) 14%, transparent)` | 1 | gap-oper.css:289 |
| `color-mix(in oklab, var(--onyx-bg) 72%, #000)` | 1 | rx-shell.css:31 |
| `color-mix(in oklab, var(--onyx-bg) 55%, var(--onyx-panel))` | 1 | gap-import.css:12 |
| `color-mix(in oklab, var(--onyx-warn) 60%, var(--onyx-line))` | 1 | gap-import.css:103 |
| `color-mix(in oklab, var(--onyx-accent) 55%, var(--onyx-line))` | 1 | gap-import.css:375 |
| `color-mix(in oklab, var(--onyx-line) 55%, transparent)` | 1 | gap-shell.css:168 |
| `color-mix(in srgb, #000 58%, transparent)` | 1 | ui-sheets.css:39 |
| `color-mix(in srgb, #000 22%, transparent)` | 1 | ui-sheets.css:153 |
| `color-mix(in oklab, var(--onyx-bg) 40%, var(--onyx-panel))` | 1 | ui-sheets.css:693 |
| `color-mix(in oklab, var(--onyx-panel-2) 70%, var(--onyx-line))` | 1 | ui-sheets.css:1031 |
| `color-mix(in oklab, var(--onyx-panel-2) 60%, var(--onyx-line))` | 1 | ui-sheets.css:1060 |
| `color-mix(in oklab, var(--onyx-bad) 5%, transparent)` | 1 | ui-sheets.css:1415 |
| `color-mix(in oklab, var(--onyx-bad) 70%, var(--onyx-line))` | 1 | ui-sheets.css:1425 |
| `color-mix(in oklab, var(--onyx-bad) 30%, var(--onyx-line))` | 1 | ui-sheets.css:1451 |

### G3.4 Elm inline styles (bypass every stylesheet) (42)

| file:line | property | value expression | literal colours |
|---|---|---|---|
| src/View/Appearance.elm:329 | `min-height` | `"44px"` |  |
| src/View/Appearance.elm:330 | `touch-action` | `"manipulation"` |  |
| src/View/Appearance.elm:335 | `background` | `color` |  |
| src/View/Appearance.elm:434 | `background` | `color` |  |
| src/View/Appearance.elm:490 | `min-height` | `"44px"` |  |
| src/View/Appearance.elm:491 | `touch-action` | `"manipulation"` |  |
| src/View/GapClaim.elm:322 | `width` | `(String.fromInt pct ++ "%")` |  |
| src/View/GapCommands.elm:145 | `color` | `(Avatar.nickTint nick)` |  |
| src/View/HistoryImport.elm:98 | `width` | `(String.fromInt pct ++ "%")` |  |
| src/View/Rail.elm:465 | `background-color` | `c` |  |
| src/View/Rail.elm:772 | `left` | `(px left)` |  |
| src/View/Rail.elm:774 | `bottom` | `(px (menu.vh - menu.y + 4))` |  |
| src/View/Rail.elm:777 | `top` | `(px (menu.y + 4))` |  |
| src/View/Rail.elm:778 | `max-height` | `` |  |
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
| src/View/Thread.elm:541 | `color` | `(Avatar.nickTint m.from)` |  |
| src/View/Thread.elm:860 | `color` | `(Avatar.nickTint par.from)` |  |
| src/View/Thread.elm:900 | `color` | `(Avatar.nickTint msg.from)` |  |
| src/View/WatchTogether.elm:444 | `width` | `(String.fromFloat (toFloat (round (toFloat (clamp 0 d p) / toFloat d * 1000)) / 10) ++ "%"` |  |
| src/Avatar.elm:213 | `--onyx-avatar-bg` | `bg` |  |
| src/Avatar.elm:214 | `--onyx-avatar-fg` | `fg` |  |
| src/View/RoomSettings.elm:1172 | `--room-heat` | `(String.fromFloat (toFloat (round (toFloat (safe count) / toFloat peak * 1000)) / 1000))` |  |
| src/View/Stats.elm:326 | `--h` | `(Stats.barHeight day.messages peak)` |  |
| src/View/Stats.elm:539 | `--h` | `(String.fromInt (max 3 (round (toFloat messages / toFloat (max 1 hourPeak) * 100))))` |  |
| src/View/Stats.elm:573 | `--h` | `(String.fromInt (max 3 (round (toFloat day.messages / toFloat dayPeak * 100))))` |  |
| src/View/Stats.elm:633 | `--heat` | `(heatOf messages)` |  |
| src/View/Stats.elm:1033 | `--h` | `(sparkHeight n)` |  |
| src/View/Thread.elm:567 | `--nick-tint` | `(Avatar.nickTint m.from)` |  |
| src/View/Thread.elm:955 | `--nick-tint` | `(Avatar.nickTint msg.from)` |  |

### G3.5 Font sizes off the --text-* ladder (352 of 1376)

| value | count | where |
|---|---|---|
| `0.75rem` | 67 | app.css:151,155,163,164,168,178,179,186,187,190,192,199,360,471,477,779,1013,1015,1074,1080,1087,1089,1090,1096,1104,1105,1107,1146,1163,1186,1221,1224,1236,1266,1268,1274,1324,1334,1335,1340,1343,1345,1358,1365,1366,1430,1508,1520,1538,1555,1566,1638,1663,1676,1690,1693,1695,1696,3377,3390,3429,3460,3464,3502,3530 · pol-roster.css:404 · rx-shell.css:163 |
| `0.8125rem` | 65 | app.css:354,737,829,906,1157,1193,1213,1215,1225,1233,1262,1270,1275,1318,1321,1331,1339,1354,1357,1359,1392,1394,1395,1396,1397,1399,1406,1410,1418,1441,1468,1489,1546,1550,1559,1560,1561,1564,1574,1604,1607,1616,1620,1624,1640,1641,1642,1643,1659,1660,1662,1669,1675,1682,1691,3386,3395,3526,3537,3541,3545 · gap-appearance.css:190 · gap-oper.css:198,253,421 |
| `16px` | 26 | gap-appearance.css:313 · pol-shell.css:1322 · pol-thread.css:393,1395,1414,1682,2334,2411,2479,2585 · pol-roster.css:396 · gap-account.css:141,145 · gap-oper.css:230,231,397,425 · rx-shell.css:435,459 · gap-import.css:454 · gap-organize.css:741 · gap-usermodes.css:399 · gap-watch.css:665 · gap-shell.css:347,364 · ui-sheets.css:836 |
| `var(--oc-fs)` | 25 | gap-oper.css:28,38,85,108,112,115,165,176,183,196,212,247,263,281,329,353,360,361,367,374,391,393,400,401,403 |
| `0.6875rem` | 19 | app.css:202,421,683,694,1073,1084,1341,1563,2255,3369,3480 · pol-studio.css:1263 · pol-shell.css:842,1241,1259,1424 · rx-shell.css:364,374 · gap-organize.css:114 |
| `1.125rem` | 15 | app.css:725,1053,1055,1085,1211,1212,1391,1393,1502,1597,1780,3463,3535 · pol-public.css:110 · calls-engine.css:227 |
| `var(--oc-fs-meta)` | 13 | gap-oper.css:36,109,110,166,261,325,328,331,352,354,369,377,392 |
| `0.9375rem` | 10 | app.css:162,865,1537,1603,1637,1658,3370 · pol-shell.css:1392 · pol-thread.css:412 · gap-people.css:60 |
| `1rem` | 10 | app.css:963,1147,2218,3584 · pol-shell.css:1040 · pol-roster.css:403 · pol-public.css:913,1405 · calls-c8.css:52 · rx-shell.css:258 |
| `0.875rem` | 10 | app.css:996,1099,1265,1549 · gap-oper.css:420,422,424,428 · gap-auth.css:26 · calls-engine.css:535 |
| `1.5rem` | 10 | app.css:2181,3371 · pol-thread.css:395,1416,2335,2481 · pol-public.css:1357 · gap-auth.css:29 · calls-engine.css:431,469 |
| `1.25rem` | 6 | app.css:1814 · pol-thread.css:333 · pol-public.css:956,1422 · calls-c8.css:32 · gap-auth.css:95 |
| `9px` | 6 | pol-studio.css:1296,1317,1341,1376,1412,1481 |
| `1.0625rem` | 4 | app.css:1251,3517 · gap-organize.css:672 · calls-engine.css:293 |
| `max(1rem, 16px)` | 4 | app.css:1974 · pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1666 |
| `0.625rem` | 4 | gap-appearance.css:186 · pol-shell.css:649,709,1031 |
| `1.75rem` | 3 | app.css:857,1783 · pol-shell.css:1054 |
| `2rem` | 3 | app.css:2175 · pol-public.css:1788 · calls-engine.css:395 |
| `clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)` | 3 | pol-stats.css:146,279,411 |
| `0.72rem` | 2 | app.css:140,211 |
| `font: var(--text-2xs) / 1.2 var(--font-mono)` | 2 | pol-stats.css:814,824 |
| `0` | 2 | pol-studio.css:307 · ui-sheets.css:262 |
| `font: 600 var(--text-2xs) / 1 var(--font-mono)` | 2 | pol-shell.css:122 · ui-sheets.css:506 |
| `font: var(--oc-fs-meta) / 1.4 var(--font-mono)` | 2 | gap-oper.css:267,330 |
| `0.86rem` | 1 | app.css:141 |
| `0.62rem` | 1 | app.css:1711 |
| `clamp(2.25rem, 1.1rem + 2.2vw, 3.25rem)` | 1 | app.css:2155 |
| `1.625rem` | 1 | app.css:2215 |
| `0.92em` | 1 | app.css:2247 |
| `0.85em` | 1 | app.css:2260 |
| `1.1em` | 1 | app.css:2264 |
| `93.75%` | 1 | gap-appearance.css:151 |
| `112.5%` | 1 | gap-appearance.css:152 |
| `clamp(1.5rem, 1.15rem + 1.4vw, 2.25rem)` | 1 | pol-stats.css:80 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem)` | 1 | pol-stats.css:546 |
| `font: var(--text-sm) / 1.2 var(--font-mono)` | 1 | pol-stats.css:969 |
| `clamp(1.5rem, 1.1rem + 1.6vw, 2.125rem)` | 1 | pol-studio.css:86 |
| `10px` | 1 | pol-studio.css:1439 |
| `0.65625rem` | 1 | pol-thread.css:150 |
| `1.1rem` | 1 | pol-thread.css:622 |
| `0.6rem` | 1 | pol-thread.css:1968 |
| `0.9em` | 1 | pol-public.css:39 |
| `clamp(2rem, 1.4rem + 2.6vw, 2.75rem)` | 1 | pol-public.css:385 |
| `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | 1 | pol-public.css:515 |
| `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | 1 | pol-public.css:524 |
| `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | 1 | pol-public.css:622 |
| `clamp(2.375rem, 9.6vw, 2.75rem)` | 1 | pol-public.css:779 |
| `clamp(1.5rem, 1.2rem + 1vw, 1.875rem)` | 1 | pol-public.css:910 |
| `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` | 1 | pol-public.css:993 |
| `clamp(1.875rem, 1.4rem + 1.8vw, 2.5rem)` | 1 | pol-public.css:1361 |
| `clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)` | 1 | pol-public.css:1443 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | 1 | pol-public.css:1462 |
| `clamp(1.75rem, 1.3rem + 2vw, 2.5rem)` | 1 | pol-public.css:1558 |
| `clamp(100%, calc(62.5% + 0.35vw), 125%)` | 1 | pol-public.css:1692 |
| `2.375rem` | 1 | pol-public.css:1796 |
| `clamp(2.5rem, 1rem + 3.6vw, 3rem)` | 1 | pol-public.css:1827 |
| `font: var(--oc-fs-meta) / 1.5 var(--font-mono)` | 1 | gap-oper.css:324 |
| `font: 13px / 1.5 var(--font-mono)` | 1 | gap-oper.css:384 |
| `0.66rem` | 1 | rx-shell.css:47 |
| `106.25%` | 1 | rx-shell.css:649 |
| `1.375rem` | 1 | calls-engine.css:162 |
| `2.25rem` | 1 | calls-engine.css:399 |
| `1.1875rem` | 1 | calls-engine.css:455 |

### G3.6 Line heights off --leading-* (64 of 271)

| value | count | where |
|---|---|---|
| `1.2` | 8 | app.css:2927 · pol-public.css:426 · gap-import.css:35,81,336 · gap-usermodes.css:55 · gap-claim.css:116 · calls-engine.css:469 |
| `1.6` | 8 | gap-appearance.css:178 · pol-thread.css:2266 · pol-public.css:1027,1537,1590 · gap-oper.css:325,328,354 |
| `1.3` | 5 | pol-shell.css:1254 · gap-convo.css:16 · rx-shell.css:203,408 · gap-shell.css:337 |
| `1.45` | 4 | app.css:3169 · gap-people.css:122 · gap-commands.css:96,138 |
| `18px` | 4 | app.css:3768 · pol-shell.css:843 · rx-shell.css:365,374 |
| `1.4` | 4 | gap-appearance.css:165 · pol-studio.css:1264 · pol-thread.css:2322 · gap-usermodes.css:180 |
| `16px` | 4 | pol-shell.css:650,711 · pol-thread.css:2546 · gap-organize.css:115 |
| `20px` | 4 | pol-shell.css:1243,1391 · pol-thread.css:1149,1395 |
| `0` | 4 | pol-thread.css:124,1031,1967 · ui-sheets.css:263 |
| `1.25` | 3 | pol-shell.css:1253 · gap-convo.css:126 · rx-shell.css:407 |
| `1.05` | 2 | app.css:2155 · pol-public.css:1443 |
| `1.1` | 2 | app.css:2383 · pol-stats.css:909 |
| `1.35` | 2 | gap-appearance.css:170 · gap-convo.css:147 |
| `1.5` | 2 | pol-public.css:525 · gap-account.css:131 |
| `1.65` | 2 | pol-public.css:913,1596 |
| `1.15` | 1 | app.css:1786 |
| `1.62` | 1 | gap-appearance.css:173 |
| `1.08` | 1 | pol-public.css:388 |
| `1.02` | 1 | pol-public.css:518 |
| `1.9` | 1 | pol-public.css:1609 |
| `1.72` | 1 | gap-organize.css:673 |

### G3.7 Font weights (no weight tokens exist) (571)

| value | count | where |
|---|---|---|
| `650` | 209 | app.css:166,188,241,460,562,640,661,680,788,830,854,898,1072,1095,1181,1220,1854,1861,1908,1969,2022,2033,2115,2410,2453,2612,2900,3082,3103,3119,3226,3245,3386,3390,3395,3417,3458,3480,3502,3530,3545,3793,3835,3973 · pol-stats.css:72,81,107,218,311,439,506,623,680,912 · pol-studio.css:87,118,130,197,357,452,458,490,504,649,658,691,809,821,1091,1297,1320,1377,1440,1533,1567 · pol-shell.css:48,182,201,216,228,297,386,480,817,1016 · pol-thread.css:390,413,467,627,674,796,995,1034,1045,1072,1214,1236,1364,1558,1660,1665,1702,1880,1970 · pol-roster.css:56,162,228 · pol-public.css:63,144,185,231,240,301,377,425,512,538,587,630,673,704,752,865,866,925,931,951,967,1008,1013,1073,1081,1084,1091,1105,1135,1155,1234,1243,1373,1395,1470,1498,1516,1726 · calls-c8.css:50,68,83,92,95,110 · calls-c11.css:36,104 · polish.css:107,299 · calls-c6.css:28 · calls-c4.css:106 · gap-convo.css:69,137,237 · gap-oper.css:165,176,328,360,364,424,428 · rx-shell.css:241,295 · gap-chanserv.css:168 · gap-import.css:119,124,139,140,180,207,287,298,304,412,433 · gap-people.css:74,107 · gap-organize.css:240,360 · gap-commands.css:32 · gap-watch.css:125,136,280,384,494,525,643,716,717 · gap-shell.css:240,248,277,321 · gap-claim.css:37 · ui-sheets.css:197,202,211,296,464,790,1102,1282 · calls-engine.css:481 |
| `600` | 199 | app.css:211,270,320,361,384,684,695,988,1013,1028,1065,1274,1343,1364,1396,1922,1951,1962,2000,2111,2113,2129,2240,2286,2308,2353,2477,2491,2497,2498,2509,2514,2518,2526,2533,2544,2550,2557,2698,2707,3024,3156,3264,3272,3280,3377,3429 · pol-stats.css:729 · pol-studio.css:154,260,373,563,591,713,757,904,992,1118,1176,1190,1612,1745,1754 · pol-shell.css:72,188,319,334,374,447,485,610,767,786,1063,1121,1385,1404,1425 · pol-thread.css:444,634,650,716,763,785,816,917,1289,1305,1336,1351,1372,1575,1612,1764,1803,1916,1928,2197,2531 · pol-roster.css:64,166,338 · pol-public.css:123,186,251,313,546,646,726,741,760,825,875,896,939,989,1119,1236,1286,1318,1415,1437,1517,1598,1630,1740 · calls-c8.css:19,74 · account2.css:8,102 · roomsettings.css:77,110,123,143,164,209,222,276,284,298,304 · calls-c4.css:33 · gap-convo.css:211 · gap-account.css:37,57,99 · gap-oper.css:86,213,282,415 · rx-shell.css:307 · gap-chanserv.css:27,144,287 · gap-import.css:34,97,151,204,265,335,441 · gap-people.css:42 · gap-organize.css:164,268,297,300,333,375,413,497,526,541,689 · gap-usermodes.css:68,127,195,241,273,304,359,373 · gap-commands.css:58,137 · gap-watch.css:312 · gap-shell.css:68,103,141,309 · gap-claim.css:46,74,115 · ui-sheets.css:664,675,759,898,1106,1292,1426,1563 |
| `700` | 115 | app.css:185,189,202,422,531,568,590,743,759,1145,1211,1391,1399,1422,1549,1565,1598,1603,1675,1780,1820,1862,1937,2082,2429,2993,3366,3407,3767 · pol-stats.css:147,184,238,280,353,364,379,412,540,547,580,600,601,642,643,792,794,819,905,907,909,926,959 · pol-studio.css:72,1286,1342,1362,1416,1469,1499,1591 · pol-shell.css:144,336,351,584,710,732,819,923,1032,1054,1177,1242,1306,1374,1386 · pol-thread.css:489,515,520,624,1868 · pol-public.css:110,219,566,622,692,910,964,966,993,1015,1179,1196,1216,1265,1358,1462,1506,1589,1599 · roomsettings.css:156 · calls-c6.css:151 · rx-shell.css:158,171 · gap-chanserv.css:59 · gap-organize.css:84,116,230,529,595,695 · gap-usermodes.css:251 · gap-commands.css:28 · gap-auth.css:51 · ui-sheets.css:489,624 |
| `400` | 21 | app.css:2606,2657,2750 · pol-stats.css:824,937 · pol-studio.css:291,1125 · pol-shell.css:271 · pol-thread.css:725,1174,1316,1347 · pol-public.css:956 · polish.css:16,65,144 · rx-shell.css:202 · gap-import.css:352 · gap-organize.css:542 · gap-usermodes.css:148 · gap-shell.css:143 |
| `750` | 15 | app.css:858,1784,1815,1904,3472,3517 · pol-shell.css:349 · pol-thread.css:599 · pol-public.css:386,516,580,1443,1558 · calls-c11.css:138 · calls-c6.css:37 |
| `500` | 8 | app.css:2903,3389,3459 · pol-studio.css:1079 · pol-shell.css:491 · pol-thread.css:675 · pol-roster.css:224 · rx-shell.css:369 |
| `800` | 3 | app.css:135,1712 · pol-stats.css:417 |
| `inherit` | 1 | calls-c4.css:27 |

### G3.8 Radii off a token (245 of 710)

| value | count | where |
|---|---|---|
| `6px` | 69 | app.css:165,178,348,372,388,403,446,687,699,767,784,803,872,893,951,985,1025,1035,1073,1119,1135,1153,1167,1177,1218,1229,1256,1313,1329,1363,1370,1404,1415,1427,1438,1454,1465,1476,1487,1500,1517,1543,1553,1571,1613,1667,1680,1693,2252,3385,3394,3402,3411,3416,3425,3479,3490,3494,3501,3512,3521,3524,3534,3549 · polish.css:46,190,255,297,343 |
| `50%` | 52 | app.css:134,207,281,305,842,1594,1608,1900,2055,2511,2742,3283,3360,3365,3439,3443,3454 · pol-stats.css:176,448,564,890 · pol-studio.css:229,319,1245,1333,1509 · pol-shell.css:440,855,1037,1046 · pol-thread.css:510,616,1281 · pol-public.css:576,1044 · account2.css:151 · roomsettings.css:102,268 · gap-convo.css:28,278 · gap-chanserv.css:237 · gap-organize.css:235,469,581 · gap-commands.css:155 · gap-shell.css:105,146,177 · ui-sheets.css:549,553,1391 · calls-engine.css:88 |
| `4px` | 26 | app.css:2248,2819 · pol-stats.css:675 · pol-studio.css:910,1083,1151,1152,1313,1381,1442,1466 · pol-thread.css:240,295,913,1172,1254,1369,1387,1760,2263 · pol-public.css:41 · polish.css:62,134 · gap-chanserv.css:136 · ui-sheets.css:510,533 |
| `999px` | 23 | app.css:179,190,192,199,202,211,273,324,338,3282 · roomsettings.css:258 · gap-account.css:102 · gap-oper.css:277,331,354,379 · gap-usermodes.css:178,247 · gap-commands.css:145 · ui-sheets.css:897,939,1326,1379 |
| `2px` | 16 | app.css:2067,3582 · pol-stats.css:830 · pol-shell.css:585,821,1305,1380 · pol-thread.css:975 · polish.css:217,226 · gap-import.css:99 · gap-claim.css:154 · ui-sheets.css:369,1010,1127 · calls-engine.css:260 |
| `10px` | 12 | app.css:1004,1045,1202,1243,1382,1762,2163 · pol-studio.css:246 · pol-public.css:293,554,1354,1390 |
| `8px` | 11 | app.css:183,935,972,1064,1069,1091,1528,1582,1629,1650,1811 |
| `3px` | 7 | app.css:251,575,2241,2260 · pol-thread.css:2161 · pol-public.css:1203 · gap-convo.css:281 |
| `12px 12px 0 0` | 7 | pol-thread.css:368,1409 · pol-roster.css:370 · polish.css:367 · ui-sheets.css:341,998,1116 |
| `calc(var(--radius) * 1.5)` | 4 | pol-shell.css:1325 · rx-shell.css:162,292 · gap-organize.css:233 |
| `2px 2px 0 0` | 3 | pol-stats.css:717,811 · roomsettings.css:342 |
| `1px` | 3 | pol-public.css:168,862 · gap-watch.css:182 |
| `0 3px 3px 0` | 2 | pol-shell.css:694,814 |
| `calc(var(--radius) * 2)` | 2 | pol-shell.css:1377 · rx-shell.css:326 |
| `calc(var(--radius) - 2px)` | 2 | gap-shell.css:72,137 |
| `13px` | 1 | app.css:2044 |
| `0 0 6px 6px` | 1 | app.css:3469 |
| `6px 6px 0 0` | 1 | app.css:3580 |
| `calc(var(--radius) * 2) calc(var(--radius) * 2) 0 0` | 1 | pol-shell.css:1294 |
| `0 0 4px 4px` | 1 | pol-thread.css:312 |
| `calc(var(--radius) + 3px)` | 1 | pol-public.css:660 |

### G3.9 Shadows off --elev-* (59 of 90)

| file:line | selector | property | value |
|---|---|---|---|
| app.css:88 | `:root` | --elev-1 | `0 1px 0 color-mix(in oklab, var(--onyx-text) 5%, transparent) inset` |
| app.css:89 | `:root` | --elev-2 | `0 14px 36px -28px color-mix(in oklab, var(--onyx-bg) 88%, transparent)` |
| app.css:90 | `:root` | --elev-3 | `0 28px 56px -32px color-mix(in oklab, #000 90%, transparent), 0 1px 0 color-mix(in oklab, var(--onyx-text) 6%, transpare` |
| app.css:142 | `.onyx-avatar--owner` | box-shadow | `0 0 0 2px var(--gold)` |
| app.css:147 | `.onyx-row-avatar .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| app.css:209 | `.onyx-facepile-face .onyx-avatar` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| app.css:1878 | `.conn-identity[data-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| app.css:2100 | `.conn-submit--quiet, .conn-submit--quiet:hover:not(:disabled)` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| app.css:2749 | `.onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 2px var(--onyx-faint)` |
| app.css:2846 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | box-shadow | `0 12px 32px rgb(0 8 16 / 45%)` |
| app.css:3061 | `.onyx-moddesk-sheet` | box-shadow | `-8px 0 24px rgb(0 0 0 / 35%)` |
| app.css:3253 | `.onyx-prefs` | box-shadow | `0 8px 24px rgba(0, 0, 0, 0.35)` |
| app.css:3263 | `.pref-category-tab[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| app.css:3513 | `.onyx-call-sheet` | box-shadow | `0 12px 32px rgba(0, 0, 0, 0.35)` |
| pol-stats.css:321 | `.roadmap-legend a[aria-current='location']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-stats.css:340 | `.roadmap-card:is(:target, [data-current='true'])` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-stats.css:956 | `.stats-page .data-room-row[data-selected='true']` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-studio.css:230 | `.ap-swatch > span, .ap-theme-swatch > span` | box-shadow | `inset 0 0 0 1px color-mix(in oklab, #000 25%, transparent)` |
| pol-studio.css:321 | `.ap-choice-toggle > b::after` | box-shadow | `0 1px 3px color-mix(in oklab, #000 40%, transparent)` |
| pol-studio.css:538 | `.background-picker__card--selected` | box-shadow | `inset 0 0 0 1px var(--onyx-text)` |
| pol-shell.css:654 | `.onyx-topbar .shell-ribbon-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:716 | `.onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:1380 | `.onyx-rail .onyx-rail-color` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| pol-shell.css:1434 | `.onyx-mobile-nav .onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-thread.css:174 | `.onyx-mention` | box-shadow | `inset 2px 0 0 var(--gold)` |
| pol-thread.css:185 | `.onyx-message-search-current, .onyx-message-search-current:hover` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:1032 | `.onyx-thread-msg-face .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| pol-thread.css:1371 | `.onyx-composer .shell-command-item--active` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:1768 | `.room-media-index-filter[aria-selected='true']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-thread.css:2277 | `.onyx-message--compact.onyx-mention, .onyx-message--compact.onyx-messa` | box-shadow | `inset 2px 0 0 var(--gold)` |
| pol-thread.css:2278 | `.onyx-message--compact.onyx-message-search-current` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-roster.css:243 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px var(--onyx-faint)` |
| pol-roster.css:427 | `.onyx-roster .onyx-roster-head` | box-shadow | `0 calc(-1 * var(--space-3)) 0 var(--onyx-panel)` |
| pol-roster.css:438 | `.onyx-roster .onyx-roster-filter` | box-shadow | `0 0 0 var(--space-1) var(--onyx-panel), 0 var(--space-2) 0 var(--space-1) var(--onyx-panel)` |
| pol-roster.css:473 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px CanvasText` |
| pol-public.css:127 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-public.css:333 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 3px 0 0 var(--onyx-accent)` |
| pol-public.css:678 | `.onyx-land-tabs button[aria-selected="true"]` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| pol-public.css:1328 | `.guides-route__item[data-state="current"] .guides-route__card` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1500 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1571 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-public.css:1708 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-o` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| pol-public.css:1712 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-o` | box-shadow | `inset 0 0 0 1px var(--onyx-dim)` |
| pol-public.css:1753 | `.public-related__list a[aria-current="page"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| polish.css:344 | `.update-available` | box-shadow | `0 8px 24px rgb(0 0 0 / 0.35)` |
| account2.css:157 | `.a2-dot--avatar` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| gap-convo.css:136 | `.onyx-composer .gap-attach-quality-opt[aria-checked='true']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| gap-convo.css:251 | `.onyx-message.gap-landed` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| gap-oper.css:410 | `.oc-tabs` | box-shadow | `0 calc(-1 * var(--sheet-grip-zone)) 0 0 var(--onyx-panel)` |
| rx-shell.css:47 | `.onyx-facepile-face .onyx-avatar` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| gap-import.css:245 | `.hi-review-foot` | box-shadow | `0 28px 0 0 var(--onyx-panel), 0 56px 0 0 var(--onyx-panel), 0 84px 0 0 var(--onyx-panel)` |
| gap-shell.css:232 | `.onyx-frame .onyx-room-more-menu > button.gs-more-leave` | box-shadow | `0 -1px 0 var(--onyx-line)` |
| ui-sheets.css:477 | `.onyx-spotlight-option[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| ui-sheets.css:813 | `.onyx-toast--success` | box-shadow | `inset 3px 0 0 var(--onyx-success), var(--elev-3)` |
| ui-sheets.css:814 | `.onyx-toast--danger` | box-shadow | `inset 3px 0 0 var(--onyx-bad), var(--elev-3)` |
| ui-sheets.css:815 | `.onyx-toast--warning` | box-shadow | `inset 3px 0 0 var(--onyx-warn), var(--elev-3)` |
| pol-ios.css:86 | `.onyx-frame` | box-shadow | `inset 0 var(--safe-top) 0 0 var(--onyx-panel)` |
| calls-engine.css:66 | `.onyx-thread-pane > .onyx-call-stage, .onyx-thread-pane > .onyx-join-b` | box-shadow | `calc(-1 * var(--shell-measure)) 0 0 0 var(--onyx-bg), var(--shell-measure) 0 0 0 var(--onyx-bg), calc(-2 * var(--shell-m` |
| calls-engine.css:155 | `.onyx-call-head-faces .onyx-call-avatar[data-speaking="true"]` | box-shadow | `0 0 0 1px var(--onyx-accent)` |

### G3.10 Hard-coded durations in transition / animation (8 of 135 declarations)

| value | count | where |
|---|---|---|
| `1.6s` | 4 | app.css:3446 · pol-thread.css:1790 · gap-convo.css:252,290 |
| `0.001ms` | 2 | app.css:3317,3319 |
| `0ms` | 2 | app.css:4112 · pol-ios.css:39 |

### G3.11 Easing keywords / curves written literally (11)

| value | count | where |
|---|---|---|
| `ease-in-out` | 3 | app.css:3446 · pol-thread.css:1790 · gap-convo.css:290 |
| `linear` | 3 | ui-sheets.css:418,473,647 |
| `ease-out` | 2 | app.css:2847,3063 |
| `linear, linear` | 2 | ui-sheets.css:1328,1381 |
| `ease` | 1 | calls-engine.css:360 |

### G3.12 Spacing (padding / margin / gap / inset / scroll-padding) with raw lengths (994 of 3682 declarations)

| value | count | where |
|---|---|---|
| `2px` | 246 | app.css:164,178,179,190,192,199,199,325,437,539,623,674,700,945,952,961,986,1146,1147,1356,1432,1457,1495,1522,1557,1564,1567,1575,1604,1693,1821,1840,1861,2034,2256,2256,2307,2345,2411,2452,2497,2499,2547,2636,2669,2765,2901,2937,3013,3028,3073,3118,3180,3262,3281,3478,3518,3531,3681,4059 · gap-appearance.css:168,194 · pol-stats.css:348,563,588,664,665,738,863,964,969 · pol-studio.css:289,355,367,419,488,576,814,893,1066,1067,1141,1271,1295,1309 · pol-shell.css:62,88,132,201,672,897,936,993,1160,1194,1250,1381 · pol-thread.css:104,104,210,211,384,436,453,494,494,565,665,706,781,896,994,1017,1031,1117,1263,1284,1299,1311,1341,1393,1442,1442,1442,1528,1568,1589,1634,1641,1748,1796,1872,1909,1964,1967,1969,2159,2210,2269,2269,2273,2273,2275 · pol-roster.css:181 · pol-public.css:589,655,798,870,924,1068,1154,1233,1304,1485,1517,1783 · calls-c8.css:78,79,108,109 · calls-c11.css:55 · polish.css:120,203,245 · roomsettings.css:69,92,214,256,275,297,319,335 · calls-c4.css:35,114,126,138 · gap-convo.css:154,204,228,279 · gap-account.css:80,80 · gap-oper.css:129,262,263,263,350,367,369 · rx-shell.css:217,490,506 · gap-chanserv.css:122,167,227 · gap-import.css:117,168,198,203,206,399,414,440 · gap-people.css:29 · gap-organize.css:143,150,245,246,275,317,410,525,578,584,594 · gap-usermodes.css:162,329,345 · gap-commands.css:108,138 · gap-watch.css:292,486,589,589,709,741 · gap-shell.css:35,38,120,121,299,348 · ui-sheets.css:200,218,230,539,624,625,630,713,744,744,757 · calls-engine.css:113,479,480 |
| `6px` | 145 | app.css:177,181,198,202,295,363,389,404,485,559,596,658,688,735,807,973,979,1011,1015,1070,1073,1149,1158,1162,1171,1222,1236,1336,1342,1399,1407,1409,1443,1444,1460,1469,1479,1482,1490,1575,1607,1622,1623,1661,1671,1674,1689,1968,2251,2296,2297,2301,2305,2305,2323,2441,2463,2475,2489,2498,2501,2517,2522,2535,2536,2576,2607,2646,2695,2698,2703,2754,2874,2953,2963,2967,2970,2981,3021,3034,3039,3081,3086,3114,3123,3176,3204,3217,3224,3262,3272,3294,3393,3438,3475,3484,3490,3500,3548 · pol-studio.css:1235,1273,1285,1295,1357,1358,1430,1431,1589 · pol-shell.css:483,1045,1239 · pol-thread.css:405,434,437,551,586,643,663,1281,1605,2193,2207,2262 · pol-roster.css:158 · pol-public.css:596,596,596,1394 · calls-c8.css:44 · gap-convo.css:27 · gap-account.css:96 · gap-oper.css:190,331 · gap-import.css:361,414 · gap-usermodes.css:176,246 · gap-watch.css:637 · gap-shell.css:129,145 · ui-sheets.css:694,720,961,1522 · calls-engine.css:357 |
| `8px` | 140 | app.css:155,156,161,165,166,176,178,182,184,186,187,190,211,373,378,426,472,478,678,680,689,700,726,770,789,837,907,921,931,936,952,970,1019,1019,1052,1057,1067,1069,1079,1091,1092,1097,1098,1101,1102,1106,1108,1110,1123,1143,1171,1210,1213,1219,1223,1265,1266,1277,1277,1318,1319,1320,1320,1322,1322,1323,1323,1330,1333,1335,1336,1337,1338,1345,1346,1352,1352,1353,1360,1362,1362,1363,1390,1394,1395,1396,1397,1409,1410,1411,1431,1511,1521,1522,1532,1532,1557,1562,1586,1586,1609,1625,1633,1633,1639,1644,1654,1654,1662,1673,1677,1689,1692,3382,3384,3409,3415,3428,3468,3476,3537,3538,3539,3545,3548,3548,3582 · pol-thread.css:1142,2227 · pol-public.css:613 · ui-sheets.css:1181,1203,1203,1212,1212,1230,1230,1243,1243,1521 |
| `10px` | 100 | app.css:179,184,190,190,192,199,232,237,274,294,373,450,612,615,647,751,752,900,936,973,986,1069,1091,1139,1158,1217,1218,1223,1342,1355,1363,1407,1411,1432,1469,1490,1531,1585,1590,1632,1653,1671,1689,1693,1695,1771,2234,2251,2256,2269,2296,2307,2323,2442,2484,2493,2501,2538,2548,2548,2600,2687,2701,2782,2797,2862,2893,2979,3015,3016,3054,3086,3197,3203,3229,3240,3262,3278,3297,3298,3384,3393,3428,3471,3493,3493,3524,3534,3539,3574 · pol-shell.css:593 · pol-thread.css:1395,2227 · pol-roster.css:199 · pol-public.css:100 · gap-oper.css:190 · gap-organize.css:620 · gap-auth.css:26 · ui-sheets.css:378,459 |
| `4px` | 85 | app.css:164,167,176,182,184,198,206,206,206,211,339,875,1026,1036,1059,1063,1065,1077,1085,1088,1103,1163,1214,1234,1257,1261,1272,1314,1324,1330,1333,1344,1373,1419,1458,1458,1480,1480,1503,1536,1547,1556,1617,1674,1683,1689,1689,1695,1774,2248,2256,2260,3377,3439,3537 · gap-appearance.css:178,197 · pol-studio.css:1283,1284,1285,1295,1309,1340,1375,1397,1463,1463,1463 · pol-shell.css:236,648,707,779,801,828 · pol-thread.css:2262,2393 · pol-roster.css:203 · pol-public.css:95 · gap-convo.css:119 · gap-account.css:21 · gap-import.css:303 · gap-organize.css:553 · gap-shell.css:31 · ui-sheets.css:496,1218 |
| `12px` | 64 | app.css:160,339,353,414,429,671,770,838,860,866,877,1009,1026,1036,1057,1064,1082,1083,1098,1136,1214,1217,1218,1234,1250,1257,1261,1261,1267,1272,1314,1363,1373,1398,1419,1534,1547,1588,1617,1635,1656,1683,2251,3401,3401,3424,3436,3468,3468,3516,3516,3524,3529,3534,3564,3571,3572,3574 · pol-shell.css:236 · pol-thread.css:2470 · pol-public.css:857 · gap-account.css:21 · ui-sheets.css:181,694 |
| `1px` | 34 | app.css:570,1846,2517,2820,3169 · pol-studio.css:354,558,656,711,968,1531,1589 · pol-shell.css:793,822,876,974,1224 · pol-thread.css:2239,2239,2469 · pol-roster.css:181 · pol-public.css:40,801 · polish.css:56 · gap-oper.css:316 · gap-import.css:137,264,299,359 · gap-usermodes.css:176,205,240,316 · gap-commands.css:62 |
| `14px` | 27 | app.css:379,389,404,520,807,1123,1182,1979,2463,2708,2713,3019,3401,3401,3401,3415,3424,3428,3541 · pol-shell.css:1044 · pol-public.css:264,1399 · gap-watch.css:377,443,519 · ui-sheets.css:618,939 |
| `16px` | 26 | app.css:160,671,752,877,908,1005,1046,1063,1204,1244,1264,1384,1398,1458,1480,1532,1586,1633,1654,3266,3461,3516,3516,3523,3524,3572 |
| `calc(-1 * VAR)` | 22 | app.css:1799,1994,2065,2071 · pol-thread.css:1724,2144,2144,2144 · pol-public.css:1213,1303 · calls-c8.css:93 · gap-oper.css:48 · gap-import.css:458 · gap-watch.css:281,539 · gap-auth.css:78 · ui-sheets.css:180,539,619,770,770,931 |
| `3px` | 19 | app.css:512,596,676,736,2066,2241 · gap-appearance.css:173 · pol-studio.css:218,219,1308,1488 · pol-shell.css:1418 · pol-thread.css:1119,2159,2536 · pol-public.css:658 · gap-import.css:413 · calls-engine.css:228,294 |
| `5px` | 14 | app.css:499,570,2820 · pol-studio.css:1405,1461 · pol-shell.css:840 · pol-thread.css:2546 · pol-public.css:40,156,853 · rx-shell.css:363,374 · gap-organize.css:112 · ui-sheets.css:505 |
| `-8px` | 12 | app.css:1773 · pol-thread.css:2227,2462,2464,2465,2476 · gap-oper.css:157,409 · gap-shell.css:355,355,355 · ui-sheets.css:659 |
| `-4px` | 12 | app.css:1773,2174,2213,3460 · pol-thread.css:2463,2502,2593 · pol-public.css:94 · gap-shell.css:288,288,288 · calls-engine.css:153 |
| `56px` | 12 | pol-public.css:336,358,682,770,820,822,904,905,1442,1454,1581,1773 |
| `calc(VAR + env(safe-area-inset-bottom, 0px))` | 10 | app.css:4061 · calls-c6.css:233 · gap-shell.css:377 · ui-sheets.css:342,864,905,996,1114 · calls-engine.css:253,445 |
| `-6px` | 9 | app.css:2213,3373,3443 · pol-thread.css:2461,2602 · pol-public.css:159 · gap-oper.css:407 · gap-organize.css:477 · ui-sheets.css:260 |
| `-2px` | 9 | pol-thread.css:2160,2318,2461,2462,2474,2502,2593 · calls-engine.css:164,573 |
| `20px` | 8 | app.css:349,876,884,3461,3544,3553,3572,3572 |
| `max(VAR, env(safe-area-inset-right, 0px))` | 8 | gap-watch.css:614 · ui-sheets.css:1146,1155,1203,1212,1230,1243 · calls-engine.css:253 |
| `48px` | 7 | app.css:823 · pol-public.css:210,590,770,777,793,1784 |
| `36px` | 7 | app.css:1764,2165,3434 · pol-studio.css:1010 · pol-shell.css:1321 · gap-oper.css:144 · calls-engine.css:94 |
| `40px` | 7 | app.css:1764 · pol-public.css:337,777,777,1805,1824 · ui-sheets.css:642 |
| `28px` | 6 | app.css:2165,3434,3434 · pol-shell.css:756 · gap-oper.css:61 · ui-sheets.css:867 |
| `64px` | 6 | pol-public.css:206,504,1336,1442,1762,1824 |
| `max(VAR, env(safe-area-inset-left, 0px))` | 6 | gap-watch.css:614 · ui-sheets.css:1146,1203,1230,1243 · calls-engine.css:253 |
| `7px` | 5 | app.css:450,1182 · pol-shell.css:1391 · pol-thread.css:739 · gap-shell.css:167 |
| `72px` | 5 | app.css:2145 · pol-public.css:199,621,649,1824 |
| `-1px` | 4 | app.css:172,2073 · pol-thread.css:1105 · pol-roster.css:261 |
| `18px` | 4 | app.css:789,1642,3077 · gap-oper.css:115 |
| `24px` | 4 | app.css:823,899,3434,3434 |
| `32px` | 4 | app.css:1764,2165,3570 · pol-public.css:1785 |
| `-18px` | 4 | pol-studio.css:1703 · ui-sheets.css:368,1009,1126 |
| `96px` | 3 | app.css:1980 · pol-public.css:505,1406 |
| `clamp(VAR, 5vw, 4.5rem)` | 3 | pol-stats.css:49,232,402 |
| `clamp(VAR, 6vw, 5rem)` | 3 | pol-stats.css:138,271,404 |
| `-12px` | 3 | pol-studio.css:439 · pol-thread.css:2465 · ui-sheets.css:1377 |
| `env(safe-area-inset-bottom, 0px)` | 3 | pol-shell.css:360 · gap-commands.css:51 · ui-sheets.css:1570 |
| `-10px` | 3 | pol-thread.css:2227 · gap-organize.css:477 · ui-sheets.css:380 |
| `calc(VAR * -1)` | 3 | pol-thread.css:2577 · gap-account.css:114,118 |
| `env(safe-area-inset-right, 0px)` | 3 | ui-sheets.css:331,1209 · calls-engine.css:414 |
| `9px` | 2 | app.css:2042,3500 |
| `clamp(VAR, 4vw, 4rem)` | 2 | pol-stats.css:328,632 |
| `0.4em` | 2 | pol-stats.css:452 · gap-commands.css:26 |
| `calc(120px + VAR)` | 2 | pol-stats.css:1056 · pol-studio.css:1782 |
| `clamp(16px, 5vw, 48px)` | 2 | pol-studio.css:48,81 |
| `44px` | 2 | pol-studio.css:1704 · pol-public.css:790 |
| `max(VAR, calc((100% - VAR) / 2))` | 2 | pol-thread.css:2067 · rx-shell.css:612 |
| `-3px` | 2 | pol-thread.css:2160 · calls-engine.css:50 |
| `-9px` | 2 | pol-thread.css:2474 · ui-sheets.css:1390 |
| `1.15em` | 2 | pol-public.css:974,1244 |
| `1.1em` | 2 | gap-account.css:128 · gap-shell.css:322 |
| `calc(VAR + 40px)` | 2 | gap-chanserv.css:253 · gap-organize.css:737 |
| `env(safe-area-inset-left, 0px)` | 2 | ui-sheets.css:331 · calls-engine.css:414 |
| `env(safe-area-inset-top, 0px)` | 2 | ui-sheets.css:860 · calls-engine.css:414 |
| `-0.55rem` | 1 | app.css:208 |
| `22px` | 1 | app.css:900 |
| `0.12rem` | 1 | app.css:1705 |
| `0.45rem` | 1 | app.css:1705 |
| `168px` | 1 | app.css:1980 |
| `calc(168px + VAR)` | 1 | app.css:2171 |
| `calc(72px + VAR)` | 1 | app.css:2220 |
| `12vh` | 1 | app.css:2830 |
| `calc(10px + env(safe-area-inset-bottom, 0px))` | 1 | app.css:3574 |
| `clamp(16px, 4vw, 48px)` | 1 | pol-stats.css:40 |
| `clamp(2px, 0.6vw, 8px)` | 1 | pol-stats.css:708 |
| `clamp(1px, 0.3vw, 4px)` | 1 | pol-stats.css:802 |
| `clamp(28px, 6vw, 72px)` | 1 | pol-studio.css:81 |
| `14vh` | 1 | pol-studio.css:81 |
| `clamp(28px, 4vw, 44px)` | 1 | pol-studio.css:124 |
| `clamp(32px, 5vw, 56px)` | 1 | pol-studio.css:408 |
| `calc(VAR + 32px)` | 1 | pol-studio.css:421 |
| `-14px` | 1 | pol-studio.css:1021 |
| `18vh` | 1 | pol-studio.css:1677 |
| `clamp(40px, 4vw, 72px)` | 1 | pol-studio.css:1802 |
| `calc(VAR + 36px)` | 1 | pol-shell.css:1044 |
| `0.35em` | 1 | pol-thread.css:1885 |
| `100%` | 1 | pol-thread.css:2114 |
| `max(VAR, calc((100% - VAR) / 2 + VAR))` | 1 | pol-public.css:174 |
| `calc(48px + env(safe-area-inset-bottom))` | 1 | pol-public.css:210 |
| `88px` | 1 | pol-public.css:505 |
| `1.4em` | 1 | pol-public.css:1180 |
| `140px` | 1 | pol-public.css:1406 |
| `calc(140px + VAR)` | 1 | pol-public.css:1667 |
| `calc(32px + env(safe-area-inset-bottom))` | 1 | pol-public.css:1785 |
| `194px` | 1 | calls-c6.css:191 |
| `calc(VAR + 44px)` | 1 | gap-oper.css:49 |
| `-0.3rem` | 1 | rx-shell.css:46 |
| `50px` | 1 | rx-shell.css:131 |
| `calc(VAR * 2 + 18px)` | 1 | rx-shell.css:206 |
| `46px` | 1 | rx-shell.css:542 |
| `calc((100vw - VAR) / 2)` | 1 | rx-shell.css:642 |
| `calc((100vw - VAR) / 2 + VAR)` | 1 | rx-shell.css:643 |
| `calc(VAR + 28px)` | 1 | gap-chanserv.css:160 |
| `calc(32px + VAR + VAR)` | 1 | gap-chanserv.css:216 |
| `calc(VAR + 56px)` | 1 | gap-people.css:147 |
| `calc(VAR + 112px)` | 1 | gap-organize.css:653 |
| `calc(VAR + 64px)` | 1 | gap-organize.css:753 |
| `calc(14px + 0.32em)` | 1 | gap-auth.css:33 |
| `52px` | 1 | ui-sheets.css:150 |
| `calc(VAR + 2px)` | 1 | ui-sheets.css:375 |
| `min(14vh, 120px)` | 1 | ui-sheets.css:434 |
| `84px` | 1 | ui-sheets.css:726 |
| `136px` | 1 | ui-sheets.css:940 |
| `calc(VAR + max(0px, env(safe-area-inset-bottom, 0px) - VAR))` | 1 | ui-sheets.css:1075 |
| `calc(VAR + 6px)` | 1 | ui-sheets.css:1114 |
| `max(VAR, env(safe-area-inset-top, 0px))` | 1 | ui-sheets.css:1146 |
| `60px` | 1 | ui-sheets.css:1155 |
| `min(10vh, 96px)` | 1 | ui-sheets.css:1165 |
| `calc(VAR + 4px)` | 1 | ui-sheets.css:1479 |
| `max(8px, calc(VAR + 4px))` | 1 | pol-ios.css:92 |
| `-7px` | 1 | calls-engine.css:50 |
| `-5px` | 1 | calls-engine.css:573 |

### G3.13 Raw dimensions — width / height / min / max / offsets / border widths / tracking (1597 declarations)

| value | count | where |
|---|---|---|
| `44px` | 134 | app.css:2040,2346,2501,2538,2920,2921,3258,3258,3262,3278,3298,3479,3567 · gap-appearance.css:200 · pol-studio.css:1139,1702,1702 · pol-shell.css:108,1184,1185,1197,1197,1227,1262,1262,1264,1269,1270,1320,1329,1338,1338,1401,1439 · pol-thread.css:256,394,1415,2457,2457,2457,2472,2472,2472,2480 · pol-roster.css:460 · pol-public.css:855,856 · gap-oper.css:143,229,230,397,398,428 · rx-shell.css:114,114,260,262,262,332,433,435,438,439,440,442,445,448,448,449,451,451,452,454,458,459,461,461,465,466,491,514,549,551,561,562,578,579,592,592,597,662,663,664,669,670,670,672,673,674,675 · gap-chanserv.css:246,250,251,252,252 · gap-shell.css:346,350,351,354,355,355,356,357 · ui-sheets.css:670,766,837,840,844,845,845,845,845,897,980,1130,1218,1314,1504,1507,1537 · calls-engine.css:293,293,297,305 |
| `32px` | 131 | app.css:1779,1779,1898,1899,1993,2218,2218,2553,2553,2680,2730,2796,2879,2880,3069,3069,3223,3276,3287,3511,3520,3520,3733,3981,3982 · gap-appearance.css:196 · pol-stats.css:887,888 · pol-studio.css:545,752,1075,1140,1558,1607,1660 · pol-shell.css:15,33,50,51,162,163,303,472,592,605,667,800,882,939,1117,1131,1132,1277 · pol-thread.css:291,317,331,587,1001,1002,1369,1377,1485,1486,1487,1622,1644,1667,1708,1709,1756,1997,1998,2343,2523,2555 · pol-roster.css:48 · pol-public.css:604,605,789,789,1111,1181,1278 · calls-c8.css:26 · polish.css:204 · roomsettings.css:191,219,254 · gap-account.css:20 · gap-oper.css:225 · rx-shell.css:231,304,424,453,502,507 · gap-chanserv.css:129,177,178 · gap-import.css:148 · gap-organize.css:371,395,396,509 · gap-usermodes.css:47 · gap-shell.css:37,286,287 · ui-sheets.css:233,533,552,553,553,557,558,559,560,765,816,816,939,948,949 · calls-engine.css:36,40,85,85,87,87,144,144 |
| `36px` | 93 | app.css:2522,2635,2736,2980,3415,3493,3548,3582,3879 · gap-appearance.css:197,299 · pol-studio.css:1196,1703,1703 · pol-shell.css:315,633,634,660,944,945,958,1201,1305,1336 · pol-thread.css:376,1068,1139,1165,1166,1387,1461,2342,2348,2501,2589 · pol-roster.css:377,397 · pol-public.css:248,574,575,1088,1250,1293 · calls-c8.css:114,118 · roomsettings.css:175 · gap-account.css:46 · gap-oper.css:189,205,274,393 · rx-shell.css:155,156,341,342,462,505,505,506,550 · gap-import.css:26,210,308,327 · gap-people.css:34,135 · gap-organize.css:435,436 · gap-usermodes.css:80,124 · gap-shell.css:89,206 · gap-claim.css:121 · ui-sheets.css:366,516,735,743,973,1007,1106,1124,1357,1358 · calls-engine.css:84,189,210,259,280,509,525,542,546,572 |
| `16px` | 85 | app.css:916,917,2570,2571,2991,3045,3397,3397 · pol-shell.css:599,599,646,647,705,706,1083,1083,1138,1138 · pol-thread.css:421,421,447,447,576,577,595,595,750,751,1079,1079,1257,1257,1447,1447,1722,1722 · pol-roster.css:84,84,300,300 · pol-public.css:709,710,732,733,1143,1144 · calls-c8.css:127 · calls-c6.css:185,185 · gap-oper.css:155,156 · rx-shell.css:81,81,354,354 · gap-organize.css:190,190,406,406,467,468,576,577 · gap-usermodes.css:256,257 · gap-watch.css:102,102,430,430 · gap-shell.css:296,296 · ui-sheets.css:480,481,657,658,1237,1244,1543,1544 · calls-engine.css:90,90,91,91,193,193 |
| `28px` | 82 | app.css:2214,2214,2508,2508,2781,2948,2949,3090,3411,3411,3500 · gap-appearance.css:194 · pol-studio.css:546,1019,1020,1555,1564,1565,1722 · pol-shell.css:68,103,120,121,205,235,855,855,860,861,1029,1030,1200,1428 · pol-thread.css:623,623,644,1230,1248,1249,1398,1606,2351,2352 · pol-roster.css:72,73,143,289,290 · pol-public.css:261,261,1804,1804 · calls-c6.css:212 · calls-c4.css:55,57,57,119,119 · gap-convo.css:64,64 · rx-shell.css:73,74,327,327 · gap-import.css:384 · gap-organize.css:80,135,181,182,359,359,691,718 · gap-watch.css:303 · gap-shell.css:130,305 · ui-sheets.css:581,582 · calls-engine.css:543,547,548,550 |
| `1px` | 74 | app.css:172,172,2073,2073,2331,2332,3100,3100,3563,3563,3577,3577,3947,4092 · pol-studio.css:315,316 · pol-shell.css:616,617,1293,1358,1458,1459 · pol-thread.css:367,462,482,934,935,1049,1103,1104,1188,1189,1408,2128,2173 · pol-roster.css:259,260 · pol-public.css:271,826 · calls-c8.css:66,66 · polish.css:366 · account2.css:13,13 · calls-c6.css:215,216 · rx-shell.css:271,271,426,426,577,577 · gap-usermodes.css:11,12 · gap-watch.css:211 · ui-sheets.css:140,340,649,997,1115 · calls-engine.css:103,103,148,148,202,202,242,242,311,311,322,322,524,524 |
| `14px` | 71 | app.css:247,248,3283,3283,3456,3456,3504,3504 · pol-shell.css:747,748,789,789,821,853,853,1366,1366 · pol-thread.css:654,654,672,672,1616,1616,2200,2200 · pol-roster.css:101,101,169,170 · pol-public.css:1746,1747 · calls-c8.css:49,49 · calls-c11.css:42,42 · roomsettings.css:39,39 · calls-c6.css:170,170 · calls-c4.css:35,40,53,53,108,108,123,123 · gap-chanserv.css:38,39,188,188 · gap-import.css:158,159,369,370 · gap-organize.css:95,96,173,173,500,500 · gap-usermodes.css:138,139 · gap-commands.css:153,154 · ui-sheets.css:569,569,957,957,960,960 |
| `18px` | 66 | app.css:569,2053,2054,3338,3339,3764 · pol-studio.css:1748,1749 · pol-shell.css:550,551,838,839,888,888,1327,1327,1337,1337 · pol-thread.css:29,30,1449,1449,2546 · pol-roster.css:337,337 · pol-public.css:168,326,327,862 · calls-c8.css:108,108 · roomsettings.css:255 · rx-shell.css:193,193,361,362,374,374,425,425 · gap-import.css:196,197 · gap-organize.css:54,54,110,111 · gap-shell.css:101,101,219,220 · ui-sheets.css:68,69,279,280,453,454,595,596,965,966,1334,1335,1388,1389 · calls-engine.css:508,508 |
| `40px` | 65 | app.css:1599,1601,1809,1810,3370,3370 · pol-shell.css:677,678,1063,1226,1310,1443,1444,1444 · pol-thread.css:256,1395,1397,1414,2344,2345 · pol-roster.css:191,202,396 · pol-public.css:138,225,665,1313,1782 · calls-c8.css:30,30,99 · polish.css:374 · roomsettings.css:237,336 · calls-c4.css:140,140 · gap-account.css:79 · gap-oper.css:77 · rx-shell.css:287,288,414,446,455,511,530,549 · gap-chanserv.css:24 · gap-import.css:73 · gap-organize.css:228,229,453,708,708,723 · gap-usermodes.css:161 · gap-commands.css:70 · gap-watch.css:691 · gap-shell.css:244,349 · ui-sheets.css:292,469,1107,1322,1375 · calls-engine.css:132 |
| `20px` | 53 | app.css:1844,1845,2370,2371,3282 · pol-studio.css:1436 · pol-shell.css:523,524,641,641,1111,1111,1237,1238,1309,1309,1339,1339,1380 · pol-thread.css:258,258,343,923,923,1183,1183,1199,1200,2145,2145 · pol-roster.css:395,395 · polish.css:53,75,76 · rx-shell.css:115,115,259,259 · gap-organize.css:719,719 · gap-usermodes.css:245 · gap-commands.css:143 · gap-shell.css:375,375 · ui-sheets.css:503,504 · calls-engine.css:229,229,265,265,479,479 |
| `48px` | 49 | app.css:1929,1944,1972,2079,2111,3576,3576,3818 · gap-appearance.css:202 · pol-studio.css:1828 · pol-shell.css:578,1308,1371,1372,1392,1392 · pol-roster.css:402 · pol-public.css:533,723,826,1398,1412,1422,1422 · calls-c8.css:44 · calls-c11.css:190,190 · rx-shell.css:258,445 · gap-organize.css:718,746 · gap-usermodes.css:228 · gap-shell.css:365,371,379 · gap-auth.css:95 · ui-sheets.css:694,806,846,1013,1131,1238,1345 · calls-engine.css:175,201,227,227,241,263 |
| `2px` | 39 | app.css:2028,2062,3283,3283 · pol-stats.css:63,810 · pol-studio.css:610,790 · pol-shell.css:645 · pol-thread.css:123,222,485,2017 · pol-public.css:168,862 · calls-c11.css:158 · roomsettings.css:264,265 · calls-c6.css:82 · gap-account.css:41 · gap-oper.css:98,417,430 · gap-import.css:54,126,202 · gap-commands.css:151,152 · gap-watch.css:179 · gap-shell.css:161,257,319 · gap-claim.css:132 · ui-sheets.css:1332,1333 · calls-engine.css:39,97,97,192 |
| `8px` | 36 | app.css:279,280,303,304,844,845,1130,1608,1608,2255,2744,2747,3146,3360,3360,3569,3569 · pol-studio.css:1243,1244 · pol-shell.css:745 · pol-public.css:1044,1044 · account2.css:149,150 · roomsettings.css:100,101 · calls-c4.css:38,117,128 · gap-chanserv.css:235,236 · ui-sheets.css:364,1005,1122,1474,1475 |
| `24px` | 31 | app.css:584,585,1132,2401,2764,3054,3297,3297,3369,3369,3453,3453 · pol-studio.css:437,438 · pol-shell.css:780,1235,1235,1258 · pol-thread.css:2396 · pol-public.css:109,109,262,262 · calls-c8.css:62 · calls-c6.css:98 · calls-c4.css:103 · gap-organize.css:454 · gap-usermodes.css:364 · ui-sheets.css:1323,1376,1500 |
| `22px` | 26 | app.css:1840,2517 · pol-shell.css:1191,1191,1198,1198,1263,1263,1391,1391,1429,1429 · pol-thread.css:564,2270 · pol-public.css:635,636,797 · calls-c8.css:17 · rx-shell.css:294,294,568,568 · gap-import.css:456,456 · ui-sheets.css:546 · calls-engine.css:357 |
| `6px` | 26 | app.css:2553,2553,2572,3378,3378,3431,3431,3489 · pol-stats.css:561,562 · pol-shell.css:1199,1434 · pol-thread.css:1787 · pol-public.css:1201 · gap-convo.css:25,26 · gap-oper.css:379 · gap-shell.css:164,177,177 · ui-sheets.css:547,548,1189,1374,1481,1481 |
| `56px` | 23 | app.css:1885,3463,3463,3468,3479 · pol-studio.css:47,729,1813,1815,1816 · pol-shell.css:1214,1380 · pol-thread.css:2021,2021 · pol-public.css:1351,1352 · calls-c11.css:126 · rx-shell.css:326,326 · gap-shell.css:349 · gap-auth.css:30 · ui-sheets.css:640 · calls-engine.css:319 |
| `4px` | 22 | app.css:578,2067,2255,3582 · pol-stats.css:750,910 · pol-shell.css:1305,1380 · pol-thread.css:377,1322 · pol-roster.css:378 · calls-c4.css:127 · rx-shell.css:98 · gap-import.css:99 · gap-organize.css:202,721 · gap-claim.css:154 · ui-sheets.css:367,1008,1125 · calls-engine.css:259,375 |
| `52px` | 22 | app.css:3711 · gap-appearance.css:203 · pol-studio.css:256 · pol-shell.css:898,1040,1040,1161,1428 · pol-public.css:308 · polish.css:369,400 · calls-c6.css:243 · rx-shell.css:434 · gap-usermodes.css:346 · ui-sheets.css:448,552,865,1355,1356 · calls-engine.css:455,455,551 |
| `30px` | 18 | app.css:3384,3393 · pol-shell.css:755,764,790,1008 · pol-thread.css:232,233,420 · pol-roster.css:105 · pol-public.css:105,106 · calls-c6.css:184 · gap-organize.css:149,630 · gap-shell.css:48 · ui-sheets.css:745 · calls-engine.css:545 |
| `12px` | 16 | app.css:3067,3067 · pol-shell.css:1167,1167,1327 · roomsettings.css:266,267 · calls-c4.css:114,126,129 · gap-oper.css:153 · rx-shell.css:443,443 · gap-organize.css:680 · calls-engine.css:230,230 |
| `-2px` | 15 | app.css:2230,3453,3453 · pol-stats.css:317,1077 · pol-studio.css:1738 · pol-shell.css:1434 · pol-roster.css:233,234 · pol-public.css:1502,1504,1539,1679 · account2.css:157,157 |
| `560px` | 14 | app.css:1047,1205,1245,1385,2273,2837,2838 · pol-shell.css:971 · pol-thread.css:1358 · gap-watch.css:218,219 · ui-sheets.css:439,1166 · calls-engine.css:251 |
| `72px` | 14 | app.css:2318,3371,3371,3462 · pol-thread.css:802,803 · pol-public.css:982 · ui-sheets.css:158,759 · calls-engine.css:199,239,328,431,431 |
| `2rem` | 13 | app.css:140,140,211 · pol-stats.css:964 · pol-thread.css:112,1015 · pol-roster.css:404,404 · pol-public.css:1694,1694 · gap-convo.css:274,278,278 |
| `3px` | 13 | app.css:2051,2052 · pol-stats.css:716 · pol-shell.css:644,693,813,821 · calls-c4.css:36,115,127 · rx-shell.css:360 · gap-organize.css:465,466 |
| `10px` | 11 | app.css:577 · pol-stats.css:173,174,445,446 · pol-studio.css:227,228 · pol-shell.css:691,692 · pol-roster.css:235,236 |
| `7px` | 11 | pol-shell.css:704,811,812,1046,1046 · pol-thread.css:1281,1281 · gap-shell.css:105,105,146,146 |
| `96px` | 10 | app.css:3573 · pol-public.css:935 · calls-c8.css:114 · calls-c4.css:160 · gap-oper.css:232,425 · ui-sheets.css:1264 · calls-engine.css:161,395,395 |
| `26px` | 9 | app.css:2041 · pol-shell.css:1039,1039 · pol-thread.css:403,435,1210,1216 · gap-organize.css:161 · gap-shell.css:64 |
| `420px` | 8 | app.css:160,604,1006,3934 · pol-thread.css:693,707 · rx-shell.css:271 · ui-sheets.css:157 |
| `360px` | 8 | app.css:925,1634,1655,3781 · pol-shell.css:426 · pol-thread.css:702 · pol-roster.css:345 · polish.css:401 |
| `34px` | 8 | app.css:3282 · pol-studio.css:518 · pol-shell.css:1259,1259 · pol-roster.css:435 · rx-shell.css:99,182 · gap-commands.css:142 |
| `5px` | 8 | pol-studio.css:1330,1331,1506,1507 · pol-shell.css:1199 · pol-thread.css:147 · calls-c4.css:37,115 |
| `640px` | 7 | app.css:822 · pol-shell.css:1052 · gap-oper.css:304 · ui-sheets.css:158,1223,1265 · calls-engine.css:271 |
| `64px` | 7 | app.css:1670,2288,3187 · pol-studio.css:420 · calls-engine.css:162,162,501 |
| `320px` | 7 | app.css:2624 · pol-thread.css:701,737 · polish.css:39 · rx-shell.css:138 · gap-usermodes.css:364 · calls-engine.css:503 |
| `6rem` | 7 | pol-stats.css:327,534,785,963,964 · pol-studio.css:1765 · pol-thread.css:2370 |
| `3.5rem` | 7 | pol-studio.css:1813,1815,1816,1823 · pol-thread.css:508,509,2433 |
| `68px` | 7 | pol-shell.css:1346 · rx-shell.css:594 · calls-engine.css:177,225,231,289,291 |
| `280px` | 6 | app.css:1132,1459,1481,2592 · calls-c8.css:44 · gap-oper.css:384 |
| `200px` | 6 | app.css:2637,3259,3406,3866 · pol-shell.css:575 · pol-thread.css:2022 |
| `-1px` | 6 | app.css:2743,2746 · pol-stats.css:941 · gap-commands.css:84 · gap-watch.css:212,213 |
| `220px` | 6 | app.css:3229,3490 · pol-shell.css:471 · pol-thread.css:1140,1386 · calls-engine.css:517 |
| `15px` | 6 | pol-shell.css:868,868 · gap-organize.css:142,142,520,520 |
| `21px` | 5 | app.css:2061 · pol-shell.css:1265,1265,1275,1275 |
| `2.75rem` | 5 | pol-stats.css:826 · pol-thread.css:1818,1860,1861 · pol-public.css:1696 |
| `28rem` | 5 | pol-studio.css:387 · pol-thread.css:1513,2358 · pol-public.css:1531 · gap-watch.css:579 |
| `15rem` | 5 | pol-studio.css:1262 · pol-public.css:1177,1475 · gap-import.css:186 · gap-commands.css:66 |
| `11px` | 5 | pol-shell.css:585,585 · pol-public.css:863 · calls-c4.css:39,116 |
| `312px` | 5 | pol-thread.css:349 · calls-c6.css:109,114,119,124 |
| `182px` | 5 | calls-c6.css:110,115,120,125 · calls-engine.css:493 |
| `400px` | 4 | app.css:345,2680 · gap-organize.css:210 · gap-shell.css:239 |
| `30rem` | 4 | app.css:2159 · pol-stats.css:896 · pol-studio.css:1824 · pol-public.css:772 |
| `760px` | 4 | app.css:3253 · gap-commands.css:39 · ui-sheets.css:1264,1614 |
| `22rem` | 4 | pol-studio.css:940 · pol-thread.css:2260 · pol-public.css:1049 · rx-shell.css:322 |
| `520px` | 4 | pol-shell.css:575 · calls-c8.css:89 · account2.css:5 · calls-engine.css:459 |
| `76px` | 4 | pol-shell.css:1355 · gap-oper.css:201 · gap-usermodes.css:91 · calls-engine.css:453 |
| `4rem` | 4 | pol-thread.css:613,614,622,622 |
| `36rem` | 4 | pol-thread.css:664,2179 · pol-public.css:507,1621 |
| `46rem` | 4 | pol-public.css:1581,1593,1594,1760 |
| `380px` | 4 | calls-c11.css:136 · calls-c6.css:21 · ui-sheets.css:801,1092 |
| `460px` | 4 | gap-organize.css:211 · ui-sheets.css:608,1264 · calls-engine.css:252 |
| `340px` | 3 | app.css:1533,1587 · pol-thread.css:1375 |
| `120px` | 3 | app.css:2296,3078 · calls-engine.css:330 |
| `160px` | 3 | app.css:2535 · calls-c6.css:204 · calls-c4.css:139 |
| `480px` | 3 | app.css:3058 · pol-thread.css:771 · gap-import.css:278 |
| `112px` | 3 | app.css:3438 · calls-engine.css:399,399 |
| `1.5rem` | 3 | gap-appearance.css:186,186,187 |
| `2.5rem` | 3 | gap-appearance.css:190,190,191 |
| `18rem` | 3 | pol-stats.css:132 · pol-thread.css:2417 · calls-engine.css:392 |
| `16rem` | 3 | pol-stats.css:266,631 · pol-public.css:1760 |
| `10rem` | 3 | pol-stats.css:709 · gap-import.css:186 · gap-watch.css:291 |
| `8rem` | 3 | pol-stats.css:803,816 · gap-oper.css:335 |
| `40rem` | 3 | pol-stats.css:823 · pol-studio.css:345 · pol-public.css:650 |
| `9.5rem` | 3 | pol-studio.css:722 · pol-public.css:1217 · gap-people.css:82 |
| `1.75rem` | 3 | pol-thread.css:1964,1968,1968 |
| `14rem` | 3 | pol-thread.css:2287 · pol-public.css:1467 · calls-engine.css:143 |
| `680px` | 3 | gap-oper.css:15 · ui-sheets.css:514,1265 |
| `600px` | 3 | rx-shell.css:626 · ui-sheets.css:438,1166 |
| `2.65rem` | 2 | app.css:141,141 |
| `140px` | 2 | app.css:1058 · pol-shell.css:494 |
| `27.5rem` | 2 | app.css:1759,2143 |
| `52rem` | 2 | app.css:2205 · pol-public.css:1442 |
| `440px` | 2 | app.css:2401,3511 |
| `720px` | 2 | app.css:2474 · ui-sheets.css:687 |
| `76rem` | 2 | pol-stats.css:38 · pol-studio.css:1804 |
| `1.25rem` | 2 | pol-stats.css:828,829 |
| `3rem` | 2 | pol-stats.css:967 · gap-oper.css:377 |
| `34rem` | 2 | pol-studio.css:241 · pol-public.css:1342 |
| `27px` | 2 | pol-studio.css:317,318 |
| `168px` | 2 | pol-studio.css:512 · ui-sheets.css:702 |
| `26rem` | 2 | pol-studio.css:1043 · gap-convo.css:55 |
| `13rem` | 2 | pol-studio.css:1100 · pol-public.css:929 |
| `5.5rem` | 2 | pol-studio.css:1272 · gap-chanserv.css:204 |
| `12rem` | 2 | pol-studio.css:1659 · pol-public.css:1760 |
| `6.5rem` | 2 | pol-studio.css:1757 · pol-public.css:1330 |
| `-8px` | 2 | pol-shell.css:690,810 |
| `-6px` | 2 | pol-shell.css:703 · ui-sheets.css:545 |
| `216px` | 2 | pol-thread.css:326,2359 |
| `260px` | 2 | pol-thread.css:700 · calls-c4.css:137 |
| `240px` | 2 | pol-thread.css:1373 · rx-shell.css:626 |
| `42px` | 2 | pol-thread.css:1397 · gap-shell.css:347 |
| `24rem` | 2 | pol-thread.css:1786 · calls-engine.css:36 |
| `9rem` | 2 | pol-public.css:1570 · gap-import.css:293 |
| `8.5rem` | 2 | roomsettings.css:312 · gap-chanserv.css:93 |
| `300px` | 2 | calls-c6.css:98 · gap-watch.css:609 |
| `11rem` | 2 | gap-oper.css:340 · gap-chanserv.css:93 |
| `7.5rem` | 2 | gap-oper.css:377 · calls-engine.css:392 |
| `19px` | 2 | rx-shell.css:351,351 |
| `60px` | 2 | ui-sheets.css:863 · calls-engine.css:175 |
| `1.35rem` | 1 | app.css:1704 |
| `57px` | 1 | app.css:1872 |
| `66rem` | 1 | app.css:2146 |
| `32rem` | 1 | app.css:2153 |
| `110px` | 1 | app.css:3120 |
| `1rem` | 1 | pol-stats.css:253 |
| `20rem` | 1 | pol-stats.css:395 |
| `1.4rem` | 1 | pol-stats.css:824 |
| `1040px` | 1 | pol-studio.css:79 |
| `51px` | 1 | pol-studio.css:303 |
| `31px` | 1 | pol-studio.css:304 |
| `0.6rem` | 1 | pol-studio.css:1498 |
| `3.25rem` | 1 | pol-studio.css:1588 |
| `65rem` | 1 | pol-studio.css:1796 |
| `248px` | 1 | pol-shell.css:970 |
| `-14px` | 1 | pol-thread.css:206 |
| `-22px` | 1 | pol-thread.css:254 |
| `232px` | 1 | pol-thread.css:348 |
| `38px` | 1 | pol-thread.css:1386 |
| `180px` | 1 | pol-thread.css:2274 |
| `-18px` | 1 | pol-thread.css:2279 |
| `264px` | 1 | pol-thread.css:2332 |
| `352px` | 1 | pol-thread.css:2333 |
| `-24px` | 1 | pol-thread.css:2455 |
| `17rem` | 1 | pol-public.css:903 |
| `2.25rem` | 1 | pol-public.css:1603 |
| `620px` | 1 | calls-c8.css:62 |
| `42rem` | 1 | polish.css:338 |
| `56rem` | 1 | calls-c4.css:72 |
| `0.75rem` | 1 | gap-convo.css:281 |
| `7rem` | 1 | gap-convo.css:282 |
| `780px` | 1 | gap-oper.css:19 |
| `4.6rem` | 1 | gap-oper.css:335 |
| `4.4rem` | 1 | gap-oper.css:335 |
| `272px` | 1 | rx-shell.css:248 |
| `-9px` | 1 | rx-shell.css:359 |
| `50px` | 1 | rx-shell.css:595 |
| `44rem` | 1 | gap-chanserv.css:158 |
| `8.25rem` | 1 | gap-import.css:69 |
| `212px` | 1 | ui-sheets.css:692 |
| `84px` | 1 | ui-sheets.css:710 |
| `104px` | 1 | ui-sheets.css:1241 |
| `500px` | 1 | ui-sheets.css:1263 |
| `800px` | 1 | ui-sheets.css:1266 |
| `236px` | 1 | ui-sheets.css:1267 |
| `188px` | 1 | ui-sheets.css:1268 |
| `9px` | 1 | ui-sheets.css:1387 |
| `128px` | 1 | calls-engine.css:394 |
| `144px` | 1 | calls-engine.css:400 |
| `88px` | 1 | calls-engine.css:429 |
| `330px` | 1 | calls-engine.css:521 |

### G3.14 Opacity values (114)

| value | count | where |
|---|---|---|
| `0.5` | 25 | app.css:180,662,1646,2063,2117,3227,3748,3892 · pol-shell.css:28,57,250 · pol-thread.css:1584 · account2.css:58 · roomsettings.css:203,249 · calls-c6.css:186 · gap-convo.css:139,165 · gap-oper.css:291 · gap-import.css:219,318 · gap-organize.css:264,293,384,475 |
| `1` | 24 | app.css:1982,2737,3694 · gap-appearance.css:98 · pol-shell.css:870,1019 · pol-thread.css:156,226,427,2041 · pol-roster.css:178,253,306,398,474 · pol-public.css:1408 · rx-shell.css:101,463 · gap-organize.css:192,195,708 · ui-sheets.css:571,589 · calls-engine.css:363 |
| `0` | 15 | app.css:3444,3688 · pol-shell.css:865 · pol-thread.css:151,216,260,262,425 · pol-roster.css:122,173,304 · rx-shell.css:94 · gap-organize.css:187 · ui-sheets.css:567 · calls-engine.css:360 |
| `0.45` | 14 | app.css:394,1421,1694,2710,3092 · pol-studio.css:608,786 · calls-c6.css:266 · calls-c4.css:20,125 · gap-oper.css:218,429 · ui-sheets.css:243,1397 |
| `0.55` | 10 | app.css:210,710 · pol-stats.css:516 · pol-roster.css:252 · calls-c6.css:187,265 · gap-import.css:192 · gap-organize.css:675 · gap-usermodes.css:116 · gap-watch.css:433 |
| `0.6` | 9 | app.css:1986,3447,3450 · pol-stats.css:691 · pol-shell.css:1360 · pol-public.css:453 · polish.css:310 · calls-c6.css:65 · gap-usermodes.css:117 |
| `0.7` | 6 | app.css:201 · pol-stats.css:225 · pol-studio.css:1481 · gap-account.css:49,123 · gap-commands.css:34 |
| `0.4` | 3 | pol-thread.css:1499 · calls-c6.css:130 · gap-convo.css:89 |
| `0.8` | 2 | app.css:3302 · pol-thread.css:160 |
| `var(--onyx-scene-alpha, 0.3)` | 1 | gap-appearance.css:267 |
| `0.62` | 1 | pol-thread.css:159 |
| `0.85` | 1 | gap-oper.css:373 |
| `0.35` | 1 | gap-organize.css:405 |
| `0.66` | 1 | pol-ios.css:38 |
| `0.72` | 1 | pol-ios.css:41 |

## G4. z-index ladder (every declaration, low → high)

| z | count | where (file:line selector) |
|---|---|---|
| `-1` | 2 | gap-appearance.css:264 `#onyx-scene`<br>pol-studio.css:34 `.ap-background-host` |
| `1` | 7 | pol-stats.css:826 `.stats-page .stats-heatmap tbody th, .stats-page .stats-heat`<br>pol-studio.css:77 `.ap-wrap`<br>pol-thread.css:846 `.shell-msg-lightbox-dialog`<br>pol-thread.css:986 `.onyx-thread-sheet .onyx-thread-head`<br>calls-c4.css:96 `.onyx-tile-top, .onyx-tile-bottom`<br>ui-sheets.css:1477 `.onyx-member-card > .onyx-member-card-close`<br>calls-engine.css:155 `.onyx-call-head-faces .onyx-call-avatar[data-speaking="true"` |
| `2` | 4 | pol-thread.css:891 `.shell-msg-lightbox-actions`<br>pol-roster.css:445 `.onyx-roster .onyx-mlist-group-head`<br>gap-import.css:231 `.hi-review-foot`<br>ui-sheets.css:1568 `.onyx-frame .onyx-room-more .onyx-room-more-menu > .onyx-roo` @@media (max-width: 599.98px) |
| `3` | 4 | pol-roster.css:423 `.onyx-roster .onyx-roster-head`<br>pol-roster.css:432 `.onyx-roster .onyx-roster-filter`<br>calls-c8.css:38 `.onyx-call-reactions`<br>ui-sheets.css:928 `.onyx-account-body > .onyx-account-nav` @@media (max-width: 599.98px),  |
| `4` | 3 | pol-thread.css:208 `.onyx-row-actions`<br>gap-oper.css:46 `.oc-tabs`<br>ui-sheets.css:176 `.onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)` |
| `5` | 2 | app.css:3148 `.onyx-jump-latest`<br>app.css:3623 `.onyx-frame > .onyx-primary-nav` |
| `6` | 3 | pol-thread.css:2115 `.onyx-sheet-layer.onyx-thread-pop` @@media (min-width: 1100px)<br>gap-watch.css:35 `.onyx-watch`<br>calls-engine.css:57 `.onyx-thread-pane > .onyx-call-stage, .onyx-thread-pane > .o` |
| `10` | 1 | pol-studio.css:42 `.ap-bar` |
| `19` | 1 | pol-public.css:275 `.public-frame__nav` @@media (max-width: 768px) |
| `20` | 2 | app.css:3489 `.onyx-call-more`<br>pol-public.css:73 `.public-frame__header` |
| `21` | 1 | calls-c8.css:25 `.onyx-call-react-menu` |
| `40` | 7 | app.css:1140 `.onyx-schedule-pop`<br>app.css:1687 `.onyx-msg-menu-backdrop`<br>app.css:2577 `.shell-composer-popovers`<br>app.css:3857 `.onyx-room-more-scrim`<br>pol-thread.css:266 `.onyx-react-backdrop`<br>polish.css:38 `.shell-composer-tools`<br>gap-organize.css:682 `.gorg-reader-bar` |
| `41` | 5 | app.css:1688 `.onyx-msg-menu`<br>app.css:3863 `.onyx-room-more-menu`<br>pol-thread.css:267 `.onyx-react-pop .onyx-react-picker`<br>pol-thread.css:345 `.onyx-msg-menu-pop, .onyx-react-pop` @@media (min-width: 768px)<br>pol-thread.css:2389 `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-rea` @@supports (anchor-name: --pt-r |
| `45` | 1 | app.css:3780 `.notif-center` |
| `50` | 4 | calls-c6.css:97 `.onyx-call-pip-card`<br>calls-c4.css:64 `.onyx-call-stage[data-size="fullscreen"]`<br>calls-engine.css:403 `.onyx-thread-pane > .onyx-call-stage[data-size="fullscreen"]`<br>calls-engine.css:411 `.onyx-call-stage[data-size="expanded"], .onyx-call-stage[dat` @@media (max-width: 640px), (ma |
| `58` | 1 | pol-shell.css:1282 `.onyx-frame .onyx-room-more-scrim` @@media (max-width: 599.98px) |
| `59` | 1 | pol-shell.css:1289 `.onyx-frame .onyx-room-more-menu` @@media (max-width: 599.98px) |
| `60` | 8 | app.css:918 `.onyx-toaster`<br>app.css:3666 `.onyx-overlays`<br>app.css:3900 `.onyx-sheet-layer`<br>pol-shell.css:414 `.onyx-profile-pop:not(.onyx-sheet-layer)`<br>ui-sheets.css:79 `.onyx-sheet-layer`<br>ui-sheets.css:984 `.onyx-room-more-scrim` @@media (max-width: 599.98px)<br>ui-sheets.css:1089 `.onyx-profile-pop:not(.onyx-sheet-layer)`<br>calls-engine.css:181 `.onyx-call-more-scrim` |
| `61` | 3 | ui-sheets.css:994 `.onyx-room-more-menu` @@media (max-width: 599.98px)<br>calls-engine.css:183 `.onyx-call-more`<br>calls-engine.css:250 `.onyx-call-more` @@media (max-width: 640px), (ma |
| `70` | 3 | pol-thread.css:354 `.onyx-msg-menu-backdrop, .onyx-react-backdrop` @@media (max-width: 767.98px)<br>polish.css:329 `.update-available`<br>gap-convo.css:44 `.gap-drop` |
| `71` | 1 | pol-thread.css:362 `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-rea` @@media (max-width: 767.98px) |
| `80` | 3 | app.css:2826 `.onyx-spotlight`<br>calls-c6.css:18 `.onyx-sheet-layer.onyx-call-ring-layer`<br>ui-sheets.css:434 `.onyx-spotlight` |
| `90` | 1 | ui-sheets.css:798 `.onyx-toaster` |
| `100` | 2 | pol-thread.css:832 `.shell-msg-lightbox`<br>pol-public.css:55 `.public-frame__skip` |

## G5. Breakpoints and conditional blocks (every @media / @container / @supports)

| condition | blocks | where (file:line (rules inside)) |
|---|---|---|
| `@container onyx-tile (max-width: 240px)` | 1 | calls-engine.css:354 (3) |
| `@container ts-preview (max-width: 17rem)` | 1 | pol-studio.css:1842 (2) |
| `@container gap-acct (max-width: 300px)` | 1 | gap-account.css:116 (2) |
| `@container gc (max-width: 300px)` | 1 | gap-claim.css:169 (1) |
| `@container onyx-banner (max-width: 300px)` | 1 | calls-engine.css:105 (2) |
| `@media (max-width: 344px)` | 1 | calls-engine.css:532 (1) |
| `@media (max-width: 359px)` | 5 | app.css:2185 (3) · pol-public.css:342 (3) · pol-public.css:809 (1) · gap-usermodes.css:386 (3) · gap-auth.css:25 (1) |
| `@media (max-width: 359.98px)` | 2 | gap-organize.css:760 (3) · gap-watch.css:740 (2) |
| `@media (max-width: 360px)` | 2 | pol-shell.css:173 (1) · rx-shell.css:585 (12) |
| `@container ts-preview (max-width: 24rem)` | 1 | pol-studio.css:1838 (2) |
| `@media (max-width: 399.98px)` | 1 | pol-thread.css:2430 (1) |
| `@media (max-width: 400px)` | 5 | pol-stats.css:1039 (4) · gap-convo.css:176 (8) · gap-convo.css:220 (2) · gap-oper.css:30 (2) · gap-oper.css:422 (1) |
| `@container gc (max-width: 400px)` | 1 | gap-claim.css:159 (5) |
| `@container gap-acct (max-width: 420px)` | 1 | gap-account.css:108 (4) |
| `@media (max-width: 420px)` | 2 | gap-chanserv.css:258 (2) · gap-usermodes.css:379 (4) |
| `@container onyx-banner (max-width: 420px)` | 1 | calls-engine.css:99 (2) |
| `@media (max-height: 460px) and (orientation: landscape)` | 1 | gap-chanserv.css:264 (2) |
| `@media (max-width: 479.98px)` | 2 | pol-thread.css:930 (6) · pol-thread.css:2284 (4) |
| `@container watch (max-width: 479.98px)` | 1 | gap-watch.css:552 (4) |
| `@media (max-width: 480px)` | 3 | app.css:2559 (2) · pol-studio.css:1708 (13) · pol-studio.css:1764 (2) |
| `@media (max-height: 480px) and (orientation: landscape)` | 3 | gap-convo.css:33 (3) · gap-convo.css:299 (2) · gap-shell.css:383 (1) |
| `@media (max-height: 480px)` | 1 | gap-convo.css:74 (1) |
| `@container hi-review (max-width: 30rem)` | 1 | gap-import.css:248 (6) |
| `@container watch (min-width: 480px)` | 1 | gap-watch.css:565 (1) |
| `@media (max-height: 500px) and (orientation: landscape)` | 1 | pol-thread.css:2365 (8) |
| `@media (max-height: 500px)` | 6 | pol-thread.css:2423 (2) · polish.css:404 (3) · calls-engine.css:116 (32) · calls-engine.css:267 (30) · calls-engine.css:302 (27) · calls-engine.css:450 (5) |
| `@media (hover: none) and (max-height: 500px)` | 1 | gap-organize.css:768 (1) |
| `@media (max-height: 500px) and (min-width: 768px)` | 1 | calls-engine.css:513 (7) |
| `@media (max-height: 500px) and (min-width: 768px) and (hover: none)` | 1 | calls-engine.css:527 (1) |
| `@media (max-width: 520px)` | 1 | app.css:2169 (8) |
| `@media (max-width: 520px) and (max-height: 600px)` | 1 | app.css:2179 (4) |
| `@media (max-height: 520px) and (min-width: 521px)` | 4 | app.css:2193 (13) · pol-studio.css:1827 (4) · pol-public.css:1780 (20) · gap-auth.css:93 (4) |
| `@media (max-height: 520px)` | 7 | gap-convo.css:308 (2) · gap-oper.css:442 (4) · gap-import.css:463 (8) · gap-watch.css:584 (15) · gap-watch.css:726 (4) · gap-claim.css:180 (2) · ui-sheets.css:1177 (10) |
| `@container (max-width: 520px)` | 1 | gap-commands.css:107 (2) |
| `@media (max-height: 520px) and (orientation: landscape)` | 1 | gap-watch.css:613 (1) |
| `@container gc (max-width: 520px)` | 1 | gap-claim.css:65 (2) |
| `@media (max-height: 520px) and (min-width: 600px)` | 1 | ui-sheets.css:1195 (19) |
| `@container oc (min-width: 560px)` | 1 | gap-oper.css:333 (2) |
| `@media (max-width: 599.98px)` | 17 | app.css:4036 (10) · pol-shell.css:1154 (118) · pol-shell.css:1469 (1) · pol-roster.css:359 (13) · rx-shell.css:127 (12) · rx-shell.css:318 (10) · rx-shell.css:371 (2) · ui-sheets.css:321 (47) · ui-sheets.css:851 (30) · ui-sheets.css:982 (18) · ui-sheets.css:1069 (14) · ui-sheets.css:1109 (10) · ui-sheets.css:1480 (5) · ui-sheets.css:1556 (4) · ui-sheets.css:1589 (1) · pol-ios.css:89 (4) · pol-ios.css:109 (3) |
| `@media (hover: none), (max-width: 599.98px)` | 2 | pol-roster.css:456 (4) · rx-shell.css:659 (9) |
| `@media (max-width: 599.98px) and (max-height: 520px)` | 2 | rx-shell.css:575 (5) · ui-sheets.css:1592 (1) |
| `@media (max-width: 599.98px), (pointer: coarse)` | 1 | ui-sheets.css:834 (8) |
| `@media (max-width: 599.98px), (max-height: 520px), (pointer: coarse)` | 1 | ui-sheets.css:922 (6) |
| `@media (min-width: 600px)` | 6 | gap-appearance.css:222 (1) · pol-shell.css:1142 (2) · gap-convo.css:324 (1) · rx-shell.css:379 (5) · rx-shell.css:610 (2) · pol-ios.css:99 (1) |
| `@media (max-width: 600px)` | 2 | pol-public.css:776 (23) · pol-public.css:1158 (1) |
| `@media (min-width: 600px) and (hover: none)` | 2 | rx-shell.css:122 (25) · rx-shell.css:432 (24) |
| `@media (min-width: 600px) and (max-width: 767.98px)` | 3 | rx-shell.css:268 (19) · rx-shell.css:387 (17) · ui-sheets.css:1141 (10) |
| `@media (min-width: 600px) and (max-width: 767.98px), (min-width: 600px) and (max-height: 520px)` | 1 | rx-shell.css:423 (4) |
| `@media (min-width: 600px) and (max-height: 520px)` | 1 | rx-shell.css:474 (29) |
| `@media (min-width: 600px) and (max-height: 520px) and (hover: none)` | 1 | rx-shell.css:547 (3) |
| `@media (min-width: 600px) and (max-width: 959.98px) and (max-height: 520px) and (hover: none)` | 1 | rx-shell.css:557 (4) |
| `@container onyx-banner (max-width: 600px)` | 1 | calls-engine.css:93 (4) |
| `@container onyx-call (max-width: 600px)` | 1 | calls-engine.css:196 (6) |
| `@media (max-height: 620px) and (min-width: 641px)` | 1 | calls-engine.css:279 (12) |
| `@media (max-width: 640px)` | 8 | app.css:3303 (26) · app.css:3562 (20) · calls-c11.css:189 (1) · ui-sheets.css:913 (2) · calls-engine.css:109 (30) · calls-engine.css:208 (25) · calls-engine.css:466 (3) · calls-engine.css:485 (1) |
| `@media (max-width: 640px), (max-height: 520px)` | 1 | ui-sheets.css:883 (14) |
| `@media (max-width: 640px), (max-height: 500px)` | 2 | calls-engine.css:247 (19) · calls-engine.css:406 (14) |
| `@media (min-width: 641px) and (min-height: 501px)` | 1 | calls-engine.css:126 (1) |
| `@media (min-width: 641px)` | 1 | calls-engine.css:391 (10) |
| `@media (min-width: 720px)` | 1 | gap-oper.css:71 (1) |
| `@media (min-width: 721px) and (max-width: 860px)` | 1 | pol-public.css:1823 (4) |
| `@container watch (min-width: 760px)` | 1 | gap-watch.css:570 (3) |
| `@media (max-width: 767px) and (max-height: 480px)` | 1 | pol-stats.css:251 (1) |
| `@media (max-width: 767px)` | 9 | pol-stats.css:992 (33) · calls-c8.css:123 (9) · roomsettings.css:347 (2) · calls-c6.css:197 (16) · calls-c6.css:268 (1) · calls-c4.css:149 (12) · calls-engine.css:366 (18) · calls-engine.css:498 (11) · calls-engine.css:549 (5) |
| `@media (max-width: 767.98px)` | 24 | app.css:3042 (7) · app.css:3131 (3) · app.css:4079 (2) · pol-shell.css:493 (2) · pol-thread.css:352 (48) · pol-thread.css:1391 (38) · pol-thread.css:1679 (22) · pol-thread.css:2014 (15) · pol-thread.css:2416 (7) · pol-thread.css:2576 (3) · calls-c11.css:181 (5) · polish.css:357 (8) · account2.css:159 (2) · gap-account.css:144 (2) · gap-oper.css:408 (3) · gap-oper.css:436 (1) · rx-shell.css:257 (5) · gap-organize.css:728 (22) · gap-watch.css:53 (2) · gap-watch.css:719 (1) · gap-shell.css:362 (11) · ui-sheets.css:818 (4) · ui-sheets.css:1080 (3) · ui-sheets.css:1602 (2) |
| `@media (hover: none), (max-width: 767.98px)` | 1 | gap-chanserv.css:245 (6) |
| `@media (min-width: 768px)` | 6 | gap-appearance.css:226 (2) · pol-thread.css:339 (10) · pol-thread.css:2066 (7) · pol-thread.css:2357 (5) · pol-thread.css:2382 (3) · calls-c6.css:190 (1) |
| `@media (max-width: 768px), (pointer: coarse)` | 3 | pol-stats.css:1054 (1) · pol-studio.css:1776 (2) · pol-public.css:1658 (4) |
| `@media (max-width: 768px)` | 8 | pol-studio.css:1675 (12) · pol-public.css:256 (61) · pol-public.css:977 (39) · pol-public.css:1163 (34) · pol-public.css:1295 (31) · pol-public.css:1419 (16) · pol-public.css:1561 (12) · pol-public.css:1611 (3) |
| `@media (hover: none) and (min-width: 768px)` | 1 | pol-thread.css:2330 (6) |
| `@media (pointer: coarse) and (min-width: 768px)` | 1 | polish.css:399 (2) |
| `@media (min-width: 768px) and (max-height: 520px)` | 1 | rx-shell.css:539 (1) |
| `@media (min-width: 768px) and (min-height: 501px)` | 1 | calls-engine.css:490 (1) |
| `@media (min-width: 769px) and (min-height: 521px)` | 1 | pol-studio.css:1810 (1) |
| `@media (max-width: 860px)` | 1 | pol-public.css:769 (4) |
| `@media (max-width: 880px)` | 1 | app.css:3555 (2) |
| `@media (max-width: 959.98px)` | 2 | app.css:3702 (1) · pol-shell.css:1148 (2) |
| `@media (min-width: 960px) and (min-height: 521px)` | 1 | app.css:2140 (9) |
| `@media (max-width: 1024px)` | 2 | pol-stats.css:980 (9) · pol-public.css:765 (1) |
| `@media (max-width: 1099.98px)` | 2 | app.css:3697 (2) · pol-roster.css:330 (6) |
| `@media (min-width: 1100px)` | 3 | pol-thread.css:2104 (7) · pol-roster.css:36 (1) · pol-public.css:1755 (3) |
| `@media (min-width: 1180px)` | 1 | pol-studio.css:1798 (3) |
| `@media (max-width: 1180px)` | 1 | calls-engine.css:41 (2) |
| `@media (max-width: 74em)` | 1 | rx-shell.css:57 (1) |
| `@media (min-width: 1200px)` | 1 | pol-thread.css:2076 (1) |
| `@media (min-width: 1600px)` | 1 | rx-shell.css:621 (2) |
| `@media (min-width: 1700px)` | 3 | pol-studio.css:1822 (2) · pol-public.css:1689 (4) · gap-oper.css:17 (1) |
| `@media (min-width: 1920px) and (min-height: 1000px)` | 1 | ui-sheets.css:1252 (7) |
| `@media (min-width: 1960px)` | 1 | rx-shell.css:631 (6) |
| `@media (min-width: 2200px) and (min-height: 1200px)` | 1 | pol-thread.css:2082 (2) |
| `@media (min-width: 2400px)` | 1 | pol-public.css:1698 (1) |
| `@media (min-width: 2400px) and (min-height: 1300px)` | 1 | rx-shell.css:648 (2) |

Non-width conditions:

| condition | where |
|---|---|
| `@supports (height: 100dvh)` | app.css:122 (1) |
| `@media (hover: hover)` | app.css:2137 (1) · pol-studio.css:281 (1) · pol-roster.css:214 (2) · pol-roster.css:246 (1) · pol-public.css:167 (1) · rx-shell.css:87 (8) · gap-people.css:46 (2) · gap-people.css:95 (1) · gap-commands.css:81 (1) · ui-sheets.css:1022 (8) · ui-sheets.css:1455 (1) · calls-engine.css:359 (2) |
| `@media (prefers-reduced-motion: no-preference)` | app.css:2225 (2) · pol-studio.css:334 (1) · pol-public.css:473 (1) · gap-auth.css:100 (1) |
| `@media (forced-colors: active)` | app.css:2229 (3) · pol-stats.css:1065 (5) · pol-studio.css:328 (6) · pol-studio.css:1732 (2) · pol-shell.css:176 (1) · pol-thread.css:2038 (3) · pol-roster.css:471 (3) · pol-public.css:1672 (3) · polish.css:382 (3) · rx-shell.css:691 (3) · gap-people.css:186 (1) · gap-commands.css:166 (2) |
| `@media (prefers-reduced-motion: reduce)` | app.css:2855 (4) · app.css:3449 (3) · app.css:4100 (2) · gap-appearance.css:129 (1) · pol-stats.css:1061 (1) · pol-shell.css:499 (2) · pol-shell.css:1449 (1) · pol-thread.css:2031 (2) · pol-roster.css:466 (2) · calls-c8.css:55 (1) · calls-c11.css:169 (1) · polish.css:377 (1) · account2.css:164 (1) · roomsettings.css:352 (1) · calls-c6.css:272 (1) · calls-c4.css:143 (1) · gap-convo.css:256 (2) · gap-convo.css:291 (1) · gap-account.css:149 (1) · rx-shell.css:685 (2) · gap-chanserv.css:269 (1) · gap-import.css:475 (1) · gap-organize.css:772 (1) · gap-usermodes.css:404 (1) · gap-commands.css:162 (1) · gap-watch.css:617 (2) · gap-shell.css:387 (1) · gap-claim.css:185 (1) · pol-ios.css:129 (1) · calls-engine.css:579 (2) |
| `@media (prefers-contrast: more)` | gap-appearance.css:57 (2) · gap-appearance.css:281 (1) |
| `@media (hover: hover) and (pointer: fine)` | gap-appearance.css:193 (3) · pol-thread.css:424 (2) · pol-roster.css:303 (3) |
| `@media (hover: none), (pointer: coarse)` | gap-appearance.css:311 (1) · gap-account.css:137 (3) · gap-import.css:447 (6) · gap-usermodes.css:392 (4) · gap-watch.css:26 (1) · gap-claim.css:175 (1) |
| `@media (hover: none)` | pol-shell.css:1018 (1) · pol-thread.css:253 (10) · pol-thread.css:2226 (4) · pol-thread.css:2437 (3) · rx-shell.css:112 (5) · rx-shell.css:677 (1) · gap-people.css:57 (4) · gap-people.css:98 (3) · gap-people.css:139 (2) · gap-people.css:182 (1) · gap-organize.css:707 (12) · gap-commands.css:112 (1) · gap-auth.css:85 (1) · ui-sheets.css:588 (1) · pol-ios.css:36 (2) · calls-engine.css:46 (13) · calls-engine.css:558 (10) |
| `@media (pointer: coarse)` | pol-thread.css:942 (13) · pol-thread.css:2341 (9) · pol-thread.css:2405 (1) · gap-convo.css:167 (5) · gap-convo.css:217 (1) · gap-oper.css:228 (6) · gap-oper.css:396 (2) · ui-sheets.css:410 (6) · ui-sheets.css:766 (5) · ui-sheets.css:978 (4) · ui-sheets.css:1502 (3) |
| `@supports (anchor-name: --pt-row-actions)` | pol-thread.css:2381 (0) |
| `@media (pointer: coarse), (hover: none)` | pol-thread.css:2453 (41) · pol-thread.css:2582 (9) |
| `@media (hover: none) and (pointer: coarse)` | gap-shell.css:345 (10) |
| `@supports (animation-timeline: scroll())` | ui-sheets.css:415 (2) |
| `@media (display-mode: standalone)` | pol-ios.css:117 (2) |

Distinct width thresholds (feature value × blocks): `max-width 240px`×1 · `max-width 272px`×1 · `max-width 300px`×3 · `max-width 344px`×1 · `max-width 359px`×5 · `max-width 359.98px`×2 · `max-width 360px`×2 · `max-width 384px`×1 · `max-width 399.98px`×1 · `max-width 400px`×6 · `max-width 420px`×4 · `max-height 460px`×1 · `max-width 479.98px`×3 · `max-width 480px`×4 · `max-height 480px`×5 · `min-width 480px`×1 · `max-height 500px`×12 · `min-height 501px`×2 · `max-width 520px`×4 · `max-height 520px`×22 · `min-height 521px`×2 · `min-width 521px`×4 · `min-width 560px`×1 · `max-width 599.98px`×23 · `max-height 600px`×1 · `min-width 600px`×17 · `max-width 600px`×4 · `max-height 620px`×1 · `max-width 640px`×11 · `min-width 641px`×3 · `min-width 720px`×1 · `min-width 721px`×1 · `min-width 760px`×1 · `max-width 767px`×10 · `max-width 767.98px`×29 · `min-width 768px`×12 · `max-width 768px`×11 · `min-width 769px`×1 · `max-width 860px`×2 · `max-width 880px`×1 · `max-width 959.98px`×3 · `min-width 960px`×1 · `min-height 1000px`×1 · `max-width 1024px`×2 · `max-width 1099.98px`×2 · `min-width 1100px`×3 · `min-width 1180px`×1 · `max-width 1180px`×1 · `max-width 1184px`×1 · `min-width 1200px`×1 · `min-height 1200px`×1 · `min-height 1300px`×1 · `min-width 1600px`×1 · `min-width 1700px`×3 · `min-width 1920px`×1 · `min-width 1960px`×1 · `min-width 2200px`×1 · `min-width 2400px`×2

## G6. Motion inventory

Global reduced-motion kill switches (`*` with !important): app.css:4108; `data-reduce-motion` rules: app.css:3314 {animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important} · app.css:4117 {--dur-micro: 0ms; --dur-fast: 0ms; --dur-base: 0ms; --dur: 0ms} · app.css:4124 {animation: none !important} · gap-appearance.css:137 {--dur-micro: 0ms; --dur-fast: 0ms; --dur-base: 0ms} · gap-convo.css:259 {animation: none; background: color-mix(in oklab, var(--onyx-accent) 10%, transparent)} · gap-convo.css:296 {animation: none}.

Every prefers-reduced-motion block: app.css:2225 ((prefers-reduced-motion: no-preference), 2 rules) · app.css:2855 ((prefers-reduced-motion: reduce), 4 rules) · app.css:3449 ((prefers-reduced-motion: reduce), 3 rules) · app.css:4100 ((prefers-reduced-motion: reduce), 2 rules) · gap-appearance.css:129 ((prefers-reduced-motion: reduce), 1 rules) · pol-stats.css:1061 ((prefers-reduced-motion: reduce), 1 rules) · pol-studio.css:334 ((prefers-reduced-motion: no-preference), 1 rules) · pol-shell.css:499 ((prefers-reduced-motion: reduce), 2 rules) · pol-shell.css:1449 ((prefers-reduced-motion: reduce), 1 rules) · pol-thread.css:2031 ((prefers-reduced-motion: reduce), 2 rules) · pol-roster.css:466 ((prefers-reduced-motion: reduce), 2 rules) · pol-public.css:473 ((prefers-reduced-motion: no-preference), 1 rules) · calls-c8.css:55 ((prefers-reduced-motion: reduce), 1 rules) · calls-c11.css:169 ((prefers-reduced-motion: reduce), 1 rules) · polish.css:377 ((prefers-reduced-motion: reduce), 1 rules) · account2.css:164 ((prefers-reduced-motion: reduce), 1 rules) · roomsettings.css:352 ((prefers-reduced-motion: reduce), 1 rules) · calls-c6.css:272 ((prefers-reduced-motion: reduce), 1 rules) · calls-c4.css:143 ((prefers-reduced-motion: reduce), 1 rules) · gap-convo.css:256 ((prefers-reduced-motion: reduce), 2 rules) · gap-convo.css:291 ((prefers-reduced-motion: reduce), 1 rules) · gap-account.css:149 ((prefers-reduced-motion: reduce), 1 rules) · rx-shell.css:685 ((prefers-reduced-motion: reduce), 2 rules) · gap-chanserv.css:269 ((prefers-reduced-motion: reduce), 1 rules) · gap-import.css:475 ((prefers-reduced-motion: reduce), 1 rules) · gap-organize.css:772 ((prefers-reduced-motion: reduce), 1 rules) · gap-usermodes.css:404 ((prefers-reduced-motion: reduce), 1 rules) · gap-commands.css:162 ((prefers-reduced-motion: reduce), 1 rules) · gap-watch.css:617 ((prefers-reduced-motion: reduce), 2 rules) · gap-shell.css:387 ((prefers-reduced-motion: reduce), 1 rules) · gap-auth.css:100 ((prefers-reduced-motion: no-preference), 1 rules) · gap-claim.css:185 ((prefers-reduced-motion: reduce), 1 rules) · pol-ios.css:129 ((prefers-reduced-motion: reduce), 1 rules) · calls-engine.css:579 ((prefers-reduced-motion: reduce), 2 rules).

| @keyframes | defined | used by | loops? |
|---|---|---|---|
| `onyx-switcher-in` | app.css:2851 | app.css:2847 |  |
| `onyx-moddesk-in` | app.css:3065 | app.css:3063 |  |
| `onyx-call-breathe` | app.css:3448 | app.css:3446 | **infinite** |
| `onyx-sheet-in` | app.css:3954 | app.css:3872, app.css:3941, app.css:4094, pol-shell.css:1296, pol-thread.css:369, pol-thread.css:849, pol-roster.css:353, rx-shell.css:251 |  |
| `onyx-sheet-side-in` | app.css:3958 | app.css:3949 |  |
| `pt-pulse` | pol-thread.css:1792 | pol-thread.css:1790 | **infinite** |
| `onyx-call-react-in` | calls-c8.css:53 | calls-c8.css:47 |  |
| `polish-rise` | polish.css:352 | polish.css:48, polish.css:347 |  |
| `gap-landed` | gap-convo.css:246 | gap-convo.css:252 |  |
| `gap-pulse` | gap-convo.css:287 | gap-convo.css:290 | **infinite** |
| `gw-drop` | gap-watch.css:233 | gap-watch.css:230 |  |
| `ui-sheet-pop` | ui-sheets.css:107 | ui-sheets.css:95, ui-sheets.css:811, ui-sheets.css:1099 |  |
| `ui-sheet-veil-in` | ui-sheets.css:110 | ui-sheets.css:83, ui-sheets.css:435, ui-sheets.css:861, ui-sheets.css:986, ui-sheets.css:1090 |  |
| `ui-sheet-side` | ui-sheets.css:113 | ui-sheets.css:142 |  |
| `ui-sheet-drop` | ui-sheets.css:116 | ui-sheets.css:159, ui-sheets.css:443 |  |
| `ui-sheet-rise` | ui-sheets.css:119 | ui-sheets.css:343, ui-sheets.css:1000, ui-sheets.css:1117 |  |
| `ui-sheet-veil-track` | ui-sheets.css:424 | ui-sheets.css:418 |  |
| `onyx-call-sheet-in` | calls-engine.css:276 | calls-engine.css:256 |  |

Every animation declaration (58):

| file:line | selector | value | context |
|---|---|---|---|
| app.css:2847 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | `onyx-switcher-in var(--dur-fast) ease-out` |  |
| app.css:2856 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | `none` | @media (prefers-reduced-motion: reduce) |
| app.css:3063 | `.onyx-moddesk-sheet` | `onyx-moddesk-in var(--dur-base) ease-out` |  |
| app.css:3446 | `.onyx-call-person[data-speaking="true"] .onyx-call-ring::after` | `onyx-call-breathe 1.6s ease-in-out infinite` |  |
| app.css:3447 | `.onyx-call-stage[data-motion="still"] .onyx-call-person[data-speaking=` | `none` |  |
| app.css:3450 | `.onyx-call-person[data-speaking="true"] .onyx-call-ring::after` | `none` | @media (prefers-reduced-motion: reduce) |
| app.css:3872 | `.onyx-room-more-menu` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| app.css:3941 | `.onyx-sheet-layer > .onyx-sheet` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| app.css:3949 | `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` | `onyx-sheet-side-in` |  |
| app.css:4094 | `.onyx-sheet-layer > .onyx-sheet, .onyx-sheet-layer[data-placement="sid` | `onyx-sheet-in` | @media (max-width: 767.98px) |
| app.css:4111 | `*, *::before, *::after` | `none` !important | @media (prefers-reduced-motion: reduce) |
| app.css:4126 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *` | `none` !important |  |
| pol-shell.css:502 | `.notif-center *, .onyx-account-chip, .onyx-ident` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-shell.css:1296 | `.onyx-frame .onyx-room-more-menu` | `onyx-sheet-in var(--dur-fast) var(--ease)` | @media (max-width: 599.98px) |
| pol-thread.css:369 | `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-react-picker` | `onyx-sheet-in var(--dur-base) var(--ease)` | @media (max-width: 767.98px) |
| pol-thread.css:849 | `.shell-msg-lightbox-dialog` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| pol-thread.css:1790 | `.room-media-index-skeleton` | `pt-pulse 1.6s ease-in-out infinite` |  |
| pol-thread.css:2035 | `.shell-msg-lightbox-dialog, .room-media-index-skeleton` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-thread.css:2132 | `.onyx-sheet-layer.onyx-thread-pop > .onyx-sheet.onyx-thread-sheet` | `none` | @media (min-width: 1100px) |
| pol-roster.css:353 | `.onyx-frame > .onyx-roster:popover-open, .onyx-roster:popover-open` | `onyx-sheet-in var(--dur-base) var(--ease)` | @media (max-width: 1099.98px) |
| pol-roster.css:467 | `.onyx-roster:popover-open` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-c8.css:47 | `.onyx-call-reaction` | `onyx-call-react-in var(--dur-fast) var(--ease) both` |  |
| calls-c8.css:54 | `.onyx-call-stage[data-motion="still"] .onyx-call-reaction` | `none` |  |
| calls-c8.css:56 | `.onyx-call-reaction` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-c11.css:167 | `.onyx-call-stage[data-motion="still"] .onyx-call-ring::after` | `none` |  |
| calls-c11.css:176 | `.onyx-call-ring::after, .onyx-tile, .onyx-tile-video, .onyx-call-pip-c` | `none` | @media (prefers-reduced-motion: reduce) |
| polish.css:48 | `.shell-composer-tools` | `polish-rise var(--dur-fast) var(--ease)` |  |
| polish.css:347 | `.update-available` | `polish-rise var(--dur-base) var(--ease)` |  |
| polish.css:379 | `.shell-composer-tools, .update-available` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-convo.css:252 | `.onyx-message.gap-landed` | `gap-landed 1.6s var(--ease) 1` |  |
| gap-convo.css:255 | `.onyx-message.gap-landed:hover, .onyx-message.gap-landed:focus-within` | `none` |  |
| gap-convo.css:257 | `.onyx-message.gap-landed` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-convo.css:259 | `:root[data-reduce-motion='true'] .onyx-message.gap-landed` | `none` |  |
| gap-convo.css:290 | `.gap-skeleton-avatar, .gap-skeleton-name, .gap-skeleton-line` | `gap-pulse 1.6s ease-in-out infinite` |  |
| gap-convo.css:294 | `.gap-skeleton-avatar, .gap-skeleton-name, .gap-skeleton-line` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-convo.css:298 | `:root[data-reduce-motion='true'] .gap-skeleton-avatar, :root[data-redu` | `none` |  |
| rx-shell.css:245 | `.onyx-railmenu-layer[data-anchored="true"] > .onyx-sheet-backdrop` | `none` |  |
| rx-shell.css:251 | `.onyx-railmenu-layer[data-anchored="true"] > .onyx-sheet.onyx-railmenu` | `onyx-sheet-in var(--dur-fast) var(--ease)` |  |
| rx-shell.css:688 | `.onyx-railmenu-layer[data-anchored="true"] > .onyx-sheet.onyx-railmenu` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-watch.css:230 | `.onyx-watch-details` | `gw-drop var(--dur-fast) var(--ease)` |  |
| gap-watch.css:618 | `.onyx-watch-details` | `none` | @media (prefers-reduced-motion: reduce) |
| ui-sheets.css:83 | `.onyx-sheet-backdrop` | `ui-sheet-veil-in var(--dur-base) var(--ease)` |  |
| ui-sheets.css:95 | `.onyx-sheet-layer > .onyx-sheet` | `ui-sheet-pop var(--dur-base) var(--ease)` |  |
| ui-sheets.css:142 | `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` | `ui-sheet-side` |  |
| ui-sheets.css:159 | `.onyx-sheet-layer[data-placement="popover"] > .onyx-sheet` | `ui-sheet-drop` |  |
| ui-sheets.css:343 | `.onyx-sheet-layer > .onyx-sheet, .onyx-sheet-layer[data-placement] > .` | `ui-sheet-rise var(--dur-base) var(--ease)` | @media (max-width: 599.98px) |
| ui-sheets.css:418 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet-backdrop` | `ui-sheet-veil-track linear both` | @media (max-width: 599.98px) && @supports (animati |
| ui-sheets.css:435 | `.onyx-spotlight-backdrop` | `ui-sheet-veil-in var(--dur-fast) var(--ease)` |  |
| ui-sheets.css:443 | `.onyx-spotlight-panel` | `ui-sheet-drop var(--dur-fast) var(--ease)` |  |
| ui-sheets.css:811 | `.onyx-toast` | `ui-sheet-pop var(--dur-base) var(--ease)` |  |
| ui-sheets.css:861 | `.onyx-spotlight-panel` | `ui-sheet-veil-in` | @media (max-width: 599.98px) |
| ui-sheets.css:986 | `.onyx-room-more-scrim` | `ui-sheet-veil-in var(--dur-base) var(--ease)` | @media (max-width: 599.98px) |
| ui-sheets.css:1000 | `.onyx-room-more-menu` | `ui-sheet-rise var(--dur-base) var(--ease)` | @media (max-width: 599.98px) |
| ui-sheets.css:1090 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-profile-backdrop` | `ui-sheet-veil-in var(--dur-base) var(--ease)` |  |
| ui-sheets.css:1099 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` | `ui-sheet-pop var(--dur-base) var(--ease)` |  |
| ui-sheets.css:1117 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` | `ui-sheet-rise` | @media (max-width: 599.98px) |
| calls-engine.css:256 | `.onyx-call-more` | `onyx-call-sheet-in var(--dur-base, 220ms) var(--ease, ease-out) both` | @media (max-width: 640px), (max-height: 500px) |
| calls-engine.css:580 | `.onyx-call-more` | `none` | @media (prefers-reduced-motion: reduce) |

Every transition declaration (81):

| file:line | selector | value | context |
|---|---|---|---|
| app.css:2226 | `.conn-input, .conn-submit, .conn-alt-btn, .conn-foot a, .conn-identity` | `border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), color var(--` | @media (prefers-reduced-motion: no-preference) |
| app.css:2227 | `.conn-switch, .conn-switch::before` | `left var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), border-color var(--d` | @media (prefers-reduced-motion: no-preference) |
| app.css:3283 | `.pref-switch::after` | `transform var(--dur-fast, var(--dur-fast))` |  |
| app.css:3319 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *` | `transition-duration: 0.001ms` !important |  |
| app.css:3690 | `.onyx-primary-nav .onyx-nav-label` | `opacity var(--dur-fast) var(--ease)` |  |
| app.css:4112 | `*, *::before, *::after` | `transition-duration: 0ms` !important | @media (prefers-reduced-motion: reduce) |
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
| pol-shell.css:866 | `.onyx-rail .onyx-rail-star` | `opacity var(--dur-fast) var(--ease)` |  |
| pol-shell.css:1450 | `.onyx-rail .onyx-rail-star` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-thread.css:152 | `.onyx-continuation:not(.onyx-message--compact) > .onyx-ts` | `opacity var(--dur-micro) var(--ease)` |  |
| pol-thread.css:218 | `.onyx-row-actions` | `opacity var(--dur-micro) var(--ease)` |  |
| pol-thread.css:425 | `.onyx-message .boost-add` | `opacity var(--dur-micro) var(--ease)` | @media (hover: hover) and (pointer: fine) |
| pol-thread.css:1123 | `.onyx-composer-bar` | `border-color var(--dur-micro) var(--ease)` |  |
| pol-thread.css:1204 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell` | `transform var(--dur-fast) var(--ease)` |  |
| pol-thread.css:2033 | `.onyx-continuation > .onyx-ts, .onyx-message > .onyx-msg-menu-trigger` | `none` | @media (prefers-reduced-motion: reduce) |
| pol-roster.css:174 | `.onyx-mlist-group-head > .pt-ico` | `transform var(--dur-fast) var(--ease), opacity var(--dur-micro) var(--ease)` |  |
| pol-roster.css:468 | `.onyx-mlist-group-head > .pt-ico` | `none` | @media (prefers-reduced-motion: reduce) |
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
| gap-account.css:150 | `.gap-switch .pref-switch::after` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-oper.css:161 | `.oc-more > summary::before` | `transform var(--dur-fast) var(--ease)` |  |
| rx-shell.css:95 | `.onyx-rail .onyx-rail-row > .onyx-rail-star, .onyx-rail .onyx-rail-row` | `opacity var(--dur-micro) var(--ease)` | @media (hover: hover) |
| rx-shell.css:687 | `.onyx-rail .onyx-rail-row > :is(.onyx-rail-star, .onyx-rail-more), .on` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-chanserv.css:44 | `.cs-disclosure > summary::after` | `transform var(--dur-fast) var(--ease)` |  |
| gap-chanserv.css:270 | `.cs-disclosure > summary::after` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-import.css:100 | `.hi-bar-fill` | `width var(--dur-fast) var(--ease)` |  |
| gap-import.css:163 | `.hi-left-out > summary::before` | `transform var(--dur-fast) var(--ease)` |  |
| gap-import.css:477 | `.hi-bar-fill, .hi-left-out > summary::before` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-organize.css:97 | `.gorg-folder-head .gorg-i` | `transform var(--dur-fast) var(--ease)` |  |
| gap-organize.css:188 | `.onyx-rail .gorg-row-more` | `opacity var(--dur-fast) var(--ease)` |  |
| gap-organize.css:471 | `.gorg-switch-knob` | `transform var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease)` |  |
| gap-organize.css:775 | `.gorg-folder-head .gorg-i, .gorg-switch-knob, .onyx-rail .gorg-row-mor` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-usermodes.css:57 | `button.um-btn` | `border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)` |  |
| gap-usermodes.css:144 | `.um-more__toggle::after, .um-fold__toggle::after` | `transform var(--dur-fast) var(--ease)` |  |
| gap-usermodes.css:407 | `.um-btn, .um-more__toggle::after, .um-fold__toggle::after` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-commands.css:157 | `.gap-keys-pref-switch::after` | `transform var(--dur-fast) var(--ease)` |  |
| gap-commands.css:163 | `.gap-keys-pref-switch::after` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-watch.css:113 | `.onyx-watch-more .pt-ico` | `transform var(--dur-fast) var(--ease)` |  |
| gap-watch.css:619 | `.onyx-watch-more .pt-ico` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-shell.css:390 | `.onyx-frame .onyx-rail button.gs-rail-activity, .onyx-frame .gs-seg bu` | `none` | @media (prefers-reduced-motion: reduce) |
| gap-auth.css:101 | `.ga-otp` | `border-color var(--dur-fast) var(--ease)` | @media (prefers-reduced-motion: no-preference) |
| gap-claim.css:155 | `.gc-bar-fill` | `width var(--dur-fast) var(--ease)` |  |
| gap-claim.css:186 | `.gc-bar-fill` | `none` | @media (prefers-reduced-motion: reduce) |
| ui-sheets.css:473 | `.onyx-spotlight-option` | `background-color var(--dur-micro) linear` |  |
| ui-sheets.css:647 | `.onyx-you .onyx-you-link` | `background-color var(--dur-micro) linear` |  |
| ui-sheets.css:1328 | `.onyx-sheet .pref-switch, .onyx-sheet .rset-toggle-track` | `background-color var(--dur-fast) linear, border-color var(--dur-fast) linear` |  |
| ui-sheets.css:1337 | `.onyx-sheet .pref-switch::after, .onyx-sheet .rset-toggle-thumb` | `transform var(--dur-fast) var(--ease)` |  |
| ui-sheets.css:1381 | `.onyx-sheet .notify-toggle::before` | `background-color var(--dur-fast) linear, border-color var(--dur-fast) linear` |  |
| ui-sheets.css:1393 | `.onyx-sheet .notify-toggle::after` | `transform var(--dur-fast) var(--ease)` |  |
| ui-sheets.css:1550 | `.onyx-sheet .rset-advanced > summary::after` | `transform var(--dur-fast) var(--ease)` |  |
| pol-ios.css:39 | `.onyx-frame :where(button, summary, [role="button"], [role="menuitem"]` | `opacity 0ms` | @media (hover: none) |
| pol-ios.css:130 | `.onyx-frame :where(button, summary, [role="button"]):active` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-engine.css:360 | `.onyx-tile .onyx-tile-btn` | `opacity var(--dur-fast, 160ms) ease` | @media (hover: hover) |
| calls-engine.css:580 | `.onyx-call-more` | `none` | @media (prefers-reduced-motion: reduce) |
| calls-engine.css:581 | `.onyx-tile .onyx-tile-btn` | `none` | @media (prefers-reduced-motion: reduce) |

scroll-behavior declarations: app.css:3320 auto · app.css:4113 auto @@media (prefers-reduced-motion: reduce)

Script-driven motion in ports.js: 4429 `requestAnimationFrame(` · 11873 `requestAnimationFrame(`

## G7. Accent audit (every declaration painting with the accent or an alias of it)

Accent tokens and their derived aliases: `--onyx-accent`, `--onyx-accent-ink`, `--lapis`, `--lapis-bright`, `--lapis-deep`, `--brand-action`, `--accent`, `--seam`, `--seam-faint`, `--onyx-focus`, `--pg-live`, `--pg-select`. `--focus-ring` uses are listed as focus.

| category (classified from selector + property) | declarations |
|---|---|
| primary action | 125 |
| focus | 91 |
| selection / toggle state | 61 |
| other (outside the budget) | 42 |
| unread / count / badge / pill | 23 |
| current location | 20 |
| mention | 17 |
| theme preview (intended theme accent) | 13 |
| control fill / data-viz | 10 |
| live-audio (calls) | 9 |
| status (success / online) | 8 |
| link / nav text | 7 |
| token alias | 5 |

### G7 · primary action (125)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:385 | `.onyx-reclaim-submit` | color | --onyx-accent-ink |
| app.css:386 | `.onyx-reclaim-submit` | background | --onyx-accent |
| app.css:387 | `.onyx-reclaim-submit` | border | --onyx-accent |
| app.css:661 | `.onyx-newmsg-primary` | background | --onyx-accent |
| app.css:661 | `.onyx-newmsg-primary` | border | --onyx-accent |
| app.css:661 | `.onyx-newmsg-primary` | color | --onyx-accent-ink |
| app.css:782 | `.onyx-composer button` | background | --onyx-accent |
| app.css:785 | `.onyx-composer button` | color | --onyx-accent-ink |
| app.css:891 | `.onyx-calls-primary` | background | --onyx-accent |
| app.css:894 | `.onyx-calls-primary` | color | --onyx-accent-ink |
| app.css:948 | `.onyx-toast__undo` | color | --onyx-accent |
| app.css:950 | `.onyx-toast__undo` | border | --onyx-accent |
| app.css:982 | `.guest-claim-chip__keep` | color | --onyx-accent-ink |
| app.css:983 | `.guest-claim-chip__keep` | background | --onyx-accent |
| app.css:984 | `.guest-claim-chip__keep` | border | --onyx-accent |
| app.css:1022 | `.guest-claim-sheet__submit` | color | --onyx-accent-ink |
| app.css:1023 | `.guest-claim-sheet__submit` | background | --onyx-accent |
| app.css:1024 | `.guest-claim-sheet__submit` | border | --onyx-accent |
| app.css:1175 | `.onyx-composer .onyx-schedule-confirm` | background | --onyx-accent |
| app.css:1178 | `.onyx-composer .onyx-schedule-confirm` | color | --onyx-accent-ink |
| app.css:1422 | `.onyx-steward-btn-primary` | background | --onyx-accent |
| app.css:1422 | `.onyx-steward-btn-primary` | border-color | --onyx-accent |
| app.css:1422 | `.onyx-steward-btn-primary` | color | --onyx-accent-ink |
| app.css:2083 | `.conn-submit` | color | --onyx-accent-ink |
| app.css:2084 | `.conn-submit` | background | --onyx-accent |
| app.css:2090 | `.conn-submit:hover:not(:disabled)` | background | --onyx-accent |
| app.css:2094 | `.conn-submit:disabled` | background | --onyx-accent |
| app.css:2134 | `.conn-submit:active:not(:disabled), .conn-identities-go:active:not(:disabled)` | background | --onyx-accent |
| app.css:2707 | `.jump-to-date__jump` | color | --onyx-accent-ink |
| app.css:2708 | `.jump-to-date__jump` | background | --onyx-accent |
| app.css:2785 | `.onyx-member-action--primary` | background | --onyx-accent |
| app.css:2785 | `.onyx-member-action--primary` | border-color | --onyx-accent |
| app.css:2785 | `.onyx-member-action--primary` | color | --onyx-accent-ink |
| app.css:2786 | `.onyx-member-action--primary:hover` | background | --onyx-accent |
| app.css:3226 | `.onyx-keychange-accept` | background | --onyx-accent |
| app.css:3226 | `.onyx-keychange-accept` | border | --onyx-accent |
| app.css:3226 | `.onyx-keychange-accept` | color | --onyx-accent-ink |
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
| pol-shell.css:1064 | `.onyx-home .onyx-home-action--primary` | color | --onyx-accent-ink |
| pol-shell.css:1064 | `.onyx-home .onyx-home-action--primary` | background | --onyx-accent |
| pol-shell.css:1064 | `.onyx-home .onyx-home-action--primary` | border-color | --onyx-accent |
| pol-thread.css:1073 | `.onyx-frame .onyx-thread-reply` | color | --onyx-accent-ink |
| pol-thread.css:1074 | `.onyx-frame .onyx-thread-reply` | background | --onyx-accent |
| pol-thread.css:1221 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready` | background | --onyx-accent |
| pol-thread.css:1221 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready` | color | --onyx-accent-ink |
| pol-thread.css:1222 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(:disabled)` | background | --onyx-accent |
| pol-thread.css:1222 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(:disabled)` | color | --onyx-accent-ink |
| pol-public.css:141 | `.public-frame__open` | color | --onyx-accent-ink |
| pol-public.css:142 | `.public-frame__open` | background | --onyx-accent |
| pol-public.css:148 | `.public-frame__open:hover` | background | --onyx-accent |
| pol-public.css:441 | `.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .gu` | border-color | --onyx-accent |
| pol-public.css:442 | `.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .gu` | color | --onyx-accent-ink |
| pol-public.css:443 | `.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .gu` | background | --onyx-accent |
| pol-public.css:449 | `.r-btn.primary:hover, .not-found-page__action:hover, .onyxos-button--primary:hover, .guide` | border-color | --onyx-accent |
| pol-public.css:450 | `.r-btn.primary:hover, .not-found-page__action:hover, .onyxos-button--primary:hover, .guide` | background | --onyx-accent |
| pol-public.css:541 | `.onyx-land-open` | border-color | --onyx-accent |
| pol-public.css:541 | `.onyx-land-open` | color | --onyx-accent-ink |
| pol-public.css:541 | `.onyx-land-open` | background | --onyx-accent |
| pol-public.css:542 | `.onyx-land-open:hover` | background | --onyx-accent |
| pol-public.css:1651 | `.public-frame :is(.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guide` | background | --onyx-accent |
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
| gap-account.css:34 | `.gap-btn--primary, .pref-reset.gap-btn--primary` | color | --onyx-accent-ink |
| gap-account.css:35 | `.gap-btn--primary, .pref-reset.gap-btn--primary` | background | --onyx-accent |
| gap-account.css:36 | `.gap-btn--primary, .pref-reset.gap-btn--primary` | border-color | --onyx-accent |
| gap-oper.css:220 | `.onyx-moddesk-sheet .oper-desk .oc-btn-primary` | background | --onyx-accent |
| gap-oper.css:220 | `.onyx-moddesk-sheet .oper-desk .oc-btn-primary` | border-color | --onyx-accent |
| gap-oper.css:220 | `.onyx-moddesk-sheet .oper-desk .oc-btn-primary` | color | --onyx-accent-ink |
| gap-oper.css:221 | `.onyx-moddesk-sheet .oper-desk .oc-btn-primary:hover:not(:disabled)` | border-color | --onyx-accent |
| gap-oper.css:264 | `.oc-reply[data-tone="good"]` | border-left-color | --onyx-accent |
| gap-import.css:48 | `.hi-btn--primary` | border-color | --onyx-accent |
| gap-import.css:49 | `.hi-btn--primary` | background | --onyx-accent |
| gap-import.css:50 | `.hi-btn--primary` | color | --onyx-accent-ink |
| gap-import.css:52 | `.hi-btn--primary:hover:not(:disabled)` | border-color | --onyx-accent |
| gap-organize.css:386 | `.gorg-btn--primary` | color | --onyx-accent-ink |
| gap-organize.css:386 | `.gorg-btn--primary` | background | --onyx-accent |
| gap-organize.css:386 | `.gorg-btn--primary` | border-color | --onyx-accent |
| gap-organize.css:387 | `.gorg-btn--primary:hover` | border-color | --onyx-accent |
| gap-usermodes.css:68 | `button.um-btn.um-btn--primary` | border-color | --onyx-accent |
| gap-usermodes.css:68 | `button.um-btn.um-btn--primary` | background | --onyx-accent |
| gap-usermodes.css:68 | `button.um-btn.um-btn--primary` | color | --onyx-accent-ink |
| gap-usermodes.css:69 | `button.um-btn.um-btn--primary:hover:not(:disabled)` | border-color | --onyx-accent |
| gap-watch.css:392 | `.onyx-watch-btn-primary` | border-color | --onyx-accent |
| gap-watch.css:393 | `.onyx-watch-btn-primary` | background | --onyx-accent |
| gap-watch.css:394 | `.onyx-watch-btn-primary` | color | --onyx-accent-ink |
| gap-watch.css:397 | `.onyx-watch-btn-primary:hover` | border-color | --onyx-accent |
| gap-claim.css:126 | `.gc-btn--primary` | border-color | --onyx-accent |
| gap-claim.css:127 | `.gc-btn--primary` | background | --onyx-accent |
| gap-claim.css:128 | `.gc-btn--primary` | color | --onyx-accent-ink |
| gap-claim.css:130 | `.gc-btn--primary:hover:not(:disabled)` | border-color | --onyx-accent |
| ui-sheets.css:297 | `.onyx-sheet :is(.onyx-newmsg-primary, .polish-primary, .chb-submit, .guest-claim-sheet__su` | color | --onyx-accent-ink |
| ui-sheets.css:298 | `.onyx-sheet :is(.onyx-newmsg-primary, .polish-primary, .chb-submit, .guest-claim-sheet__su` | background | --onyx-accent |
| ui-sheets.css:299 | `.onyx-sheet :is(.onyx-newmsg-primary, .polish-primary, .chb-submit, .guest-claim-sheet__su` | border | --onyx-accent |

### G7 · focus (91)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:501 | `.onyx-rail-filter-input:focus` | outline | --focus-ring |
| app.css:775 | `.onyx-composer input:focus` | border-color | --onyx-accent |
| app.css:1984 | `.conn-input:focus-visible` | outline | --focus-ring |
| app.css:1984 | `.conn-input:focus-visible` | border-color | --onyx-focus |
| app.css:2028 | `.conn-offer-btn:focus-visible` | outline | --onyx-accent |
| app.css:2062 | `.conn-switch:focus-visible` | outline | --onyx-accent |
| app.css:2091 | `.conn-submit:focus-visible` | outline | --focus-ring |
| app.css:2120 | `.conn-cancel:focus-visible, .conn-alt-btn:focus-visible, .conn-link:focus-visible, .conn-b` | outline | --focus-ring |
| app.css:2121 | `.conn-identity-select:focus-visible` | outline | --focus-ring |
| app.css:2358 | `.onyx-nav-btn:focus-visible` | outline | --focus-ring |
| app.css:2506 | `.onyx-home-row:focus-visible, .onyx-home-room:focus-visible, .onyx-home-action:focus-visib` | outline | --focus-ring |
| app.css:2734 | `.onyx-roster-filter-input:focus-visible` | outline | --focus-ring |
| app.css:2810 | `.onyx-palette-launcher:focus-visible, .onyx-spotlight-close:focus-visible, .onyx-shortcuts` | outline | --focus-ring |
| app.css:3164 | `.onyx-jump-latest:focus-visible` | outline | --focus-ring |
| app.css:3997 | `:where(button, [href], input, select, textarea, [tabindex]):focus-visible` | outline | --focus-ring |
| gap-appearance.css:310 | `.pref-input:focus-visible` | outline | --focus-ring |
| gap-appearance.css:310 | `.pref-input:focus-visible` | border-color | --onyx-focus |
| pol-stats.css:62 | `:is(.stats-page, .status-route, .roadmap-page) :is(a, button, input, [tabindex]):focus-vis` | outline | --focus-ring |
| pol-stats.css:122 | `:is(.stats-page, .status-route, .roadmap-page) .r-btn.primary:focus-visible` | outline | --focus-ring |
| pol-stats.css:342 | `.roadmap-card:focus-visible` | outline | --focus-ring |
| pol-stats.css:750 | `.stats-page .stats-inspector:focus-visible` | outline | --focus-ring |
| pol-stats.css:941 | `.stats-page .stats-room-search input:focus-visible` | border-color | --onyx-accent |
| pol-studio.css:283 | `.ap-choice-toggle:focus-visible` | outline | --focus-ring |
| pol-shell.css:760 | `.onyx-frame .onyx-rail-filter-input:focus` | outline | --focus-ring |
| pol-shell.css:760 | `.onyx-frame .onyx-rail-filter-input:focus` | border-color | --onyx-accent |
| pol-thread.css:196 | `.onyx-message:focus-visible` | outline | --focus-ring |
| pol-thread.css:247 | `.onyx-row-action:focus-visible` | outline | --focus-ring |
| pol-thread.css:485 | `.onyx-unread-divider:focus-visible` | outline | --focus-ring |
| pol-thread.css:928 | `.shell-msg-lightbox-actions button:focus-visible` | outline | --focus-ring |
| pol-thread.css:1125 | `.onyx-composer-bar:focus-within` | border-color | --onyx-accent |
| pol-thread.css:1448 | `.onyx-message-search__surface:focus-within` | border-color | --onyx-accent |
| pol-thread.css:2173 | `.onyx-edited-toggle:focus-visible` | outline | --focus-ring |
| pol-roster.css:153 | `.onyx-mlist-group-head:focus-visible` | outline | --focus-ring |
| pol-roster.css:217 | `.onyx-mlist-main:focus-visible` | outline | --focus-ring |
| pol-public.css:45 | `.public-frame :where(a, button, summary, input, [tabindex]):focus-visible` | outline | --focus-ring |
| pol-public.css:1409 | `.invite-form-panel .form-field input:focus-visible` | outline | --focus-ring |
| pol-public.css:1409 | `.invite-form-panel .form-field input:focus-visible` | border-color | --onyx-focus |
| calls-c8.css:35 | `.onyx-call-react-item:focus-visible` | outline | --focus-ring |
| calls-c11.css:157 | `:where(.onyx-call-stage, .onyx-call-bar, .onyx-call-more, .onyx-call-sheet, .onyx-stage-pa` | outline | --focus-ring |
| polish.css:100 | `.onyx-composer .shell-composer-tools-item:focus-visible, .onyx-composer .shell-composer-to` | outline | --focus-ring |
| polish.css:238 | `.time-scrubber__bar:focus-visible, .time-scrubber__close:focus-visible, .time-scrubber__co` | outline | --focus-ring |
| polish.css:321 | `.polish-primary:focus-visible, .polish-ghost:focus-visible, .update-available button:focus` | outline | --focus-ring |
| account2.css:37 | `.a2-input:focus-visible, .a2-select:focus-visible, .a2-textarea:focus-visible` | outline | --focus-ring |
| account2.css:57 | `.a2-btn:focus-visible, .a2-link:focus-visible` | outline | --focus-ring |
| account2.css:120 | `.a2-reclaim__signin:focus-visible, .a2-reclaim__dismiss:focus-visible` | outline | --focus-ring |
| calls-c6.css:81 | `.onyx-call-ring .onyx-call-btn:focus-visible, .onyx-call-pip-card button:focus-visible, .o` | outline | --focus-ring |
| gap-convo.css:141 | `.onyx-composer .gap-attach-quality-opt:focus-visible, .onyx-composer .gap-attach-keep:focu` | outline | --focus-ring |
| gap-convo.css:216 | `.gap-collapsed-show:focus-visible` | outline | --focus-ring |
| gap-account.css:41 | `.gap-btn:focus-visible` | outline | --onyx-accent |
| gap-oper.css:95 | `.onyx-moddesk-sheet .oper-desk .oc-tab:focus-visible` | outline | --focus-ring |
| gap-oper.css:98 | `.oc-tabpanel:focus-visible` | outline | --focus-ring |
| gap-oper.css:164 | `.oc-more > summary:focus-visible` | outline | --focus-ring |
| gap-oper.css:200 | `.onyx-moddesk-sheet .oper-desk .oc-input:focus-visible` | outline | --focus-ring |
| gap-oper.css:200 | `.onyx-moddesk-sheet .oper-desk .oc-input:focus-visible` | border-color | --onyx-accent |
| gap-oper.css:219 | `.onyx-moddesk-sheet .oper-desk .oc-btn:focus-visible` | outline | --focus-ring |
| gap-oper.css:292 | `.onyx-moddesk-sheet .oper-desk .oc-chip:focus-visible` | outline | --focus-ring |
| gap-oper.css:417 | `.conn-foot .ap-footlink:focus-visible` | outline | --onyx-accent |
| gap-oper.css:426 | `.ap-input:focus-visible` | outline | --focus-ring |
| gap-oper.css:426 | `.ap-input:focus-visible` | border-color | --onyx-accent |
| gap-oper.css:430 | `.ap-btn:focus-visible` | outline | --focus-ring |
| gap-import.css:45 | `.hi-btn:focus-visible, .hi-seg:focus-visible, .bk-btn:focus-visible, .bk-inspect:focus-vis` | outline | --focus-ring |
| gap-import.css:105 | `.hi-note:focus-visible` | outline | --focus-ring |
| gap-import.css:126 | `.hi-review-title:focus-visible` | outline | --focus-ring |
| gap-import.css:166 | `.hi-left-out > summary:focus-visible` | outline | --focus-ring |
| gap-import.css:202 | `.hi-check:focus-visible` | outline | --focus-ring |
| gap-people.css:45 | `.onyx-roster-more:focus-visible` | outline | --focus-ring |
| gap-organize.css:442 | `.gorg-input:focus, .gorg-select:focus, .gorg-textarea:focus, .gorg-note-input:focus` | border-color | --onyx-accent |
| gap-organize.css:442 | `.gorg-input:focus, .gorg-select:focus, .gorg-textarea:focus, .gorg-note-input:focus` | outline | --focus-ring |
| gap-usermodes.css:66 | `.um-btn:focus-visible, .um-choice:focus-visible, .um-inbox-link:focus-visible, .um-request` | outline | --focus-ring |
| gap-usermodes.css:90 | `.um-input:focus-visible` | outline | --focus-ring |
| gap-usermodes.css:90 | `.um-input:focus-visible` | border-color | --onyx-accent |
| gap-commands.css:84 | `button.gap-help-row:focus-visible` | outline | --focus-ring |
| gap-commands.css:135 | `.gap-keys-pref:focus-visible` | outline | --focus-ring |
| gap-watch.css:542 | `.onyx-watch :is(button, a, input, select):focus-visible` | outline | --focus-ring |
| gap-watch.css:670 | `.onyx-watch-input:focus-visible` | outline | --focus-ring |
| gap-watch.css:670 | `.onyx-watch-input:focus-visible` | border-color | --onyx-accent |
| gap-watch.css:692 | `.onyx-watch-sheet :is(button, a, input):focus-visible` | outline | --focus-ring |
| gap-shell.css:43 | `.gs-join-field:focus-within` | outline | --focus-ring |
| gap-shell.css:78 | `.onyx-frame .onyx-rail button.gs-join-go:focus-visible` | outline | --focus-ring |
| gap-shell.css:100 | `.onyx-frame .onyx-rail button.gs-rail-activity:focus-visible` | outline | --focus-ring |
| gap-shell.css:142 | `.onyx-frame .gs-seg button.gs-seg-btn:focus-visible` | outline | --focus-ring |
| gap-shell.css:161 | `.gs-activity-list:focus-visible` | outline | --focus-ring |
| gap-shell.css:226 | `.onyx-room-more-menu > a.gs-more-ledger:focus-visible` | outline | --focus-ring |
| gap-shell.css:257 | `.onyx-frame .gs-leave button.gs-btn:focus-visible` | outline | --focus-ring |
| gap-shell.css:298 | `.onyx-frame .gs-motd button.gs-motd-dismiss:focus-visible` | outline | --focus-ring |
| gap-shell.css:319 | `.onyx-frame .gs-motd button.gs-motd-more:focus-visible` | outline | --focus-ring |
| gap-claim.css:123 | `.gc-btn:focus-visible` | outline | --focus-ring |
| ui-sheets.css:273 | `.onyx-sheet-close:focus-visible, .onyx-you-close:focus-visible, .onyx-spotlight-close:focu` | outline | --focus-ring |
| calls-engine.css:39 | `.onyx-voice-chip:focus-visible, .onyx-call-join:focus-visible` | outline | --focus-ring |
| calls-engine.css:176 | `.onyx-cbtn:focus-visible` | outline | --focus-ring |
| calls-engine.css:192 | `.onyx-call-more-item:focus-visible` | outline | --focus-ring |

### G7 · selection / toggle state (61)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:191 | `.shell-topic-card-follow.is-active` | border-color | --onyx-accent |
| app.css:193 | `.shell-topic-follow.is-active` | border-color | --onyx-accent |
| app.css:194 | `.shell-topic-action.is-active` | border-color | --onyx-accent |
| app.css:200 | `.topic-chip.is-active` | border-color | --onyx-accent |
| app.css:515 | `.onyx-rail .onyx-rail-filter-unread-on` | border-color | --onyx-accent |
| app.css:516 | `.onyx-rail .onyx-rail-filter-unread-on` | color | --onyx-accent |
| app.css:598 | `.onyx-rail .onyx-rail-star-on` | color | --onyx-accent |
| app.css:706 | `.onyx-audience-toggle-set` | color | --onyx-accent |
| app.css:707 | `.onyx-audience-toggle-set` | border-color | --onyx-accent |
| app.css:811 | `.onyx-calls-toggle-open` | border-color | --onyx-accent |
| app.css:812 | `.onyx-calls-toggle-open` | color | --onyx-accent |
| app.css:1060 | `.chb-sort-btn[aria-pressed="true"]` | color | --onyx-accent |
| app.css:1060 | `.chb-sort-btn[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:1094 | `.chb-skin[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:1878 | `.conn-identity[data-selected="true"]` | box-shadow | --onyx-accent |
| app.css:2068 | `.conn-strength-on` | background | --onyx-accent |
| app.css:2270 | `.onyx-notify-toggle-open` | border-color | --onyx-accent |
| app.css:2270 | `.onyx-notify-toggle-open` | color | --onyx-accent |
| app.css:2289 | `.notify-toggle[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:2289 | `.notify-toggle[aria-pressed="true"]` | color | --onyx-accent |
| app.css:2308 | `.room-notify-seg[aria-checked="true"]` | border-color | --onyx-accent |
| app.css:2308 | `.room-notify-seg[aria-checked="true"]` | color | --onyx-accent |
| app.css:2661 | `.onyx-composer .shell-composer-tool--emoji[aria-expanded="true"]` | border-color | --onyx-accent |
| app.css:2891 | `.onyx-dmsafe-trigger[aria-expanded="true"]` | border-color | --onyx-accent |
| app.css:2989 | `.onyx-spotlight-option[aria-selected="true"]` | border-left-color | --onyx-accent |
| app.css:3056 | `.onyx-moddesk-toggle[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:3113 | `.onyx-moddesk-sheet .moderation-cockpit__mode[aria-pressed="true"]` | border-color | --onyx-accent |
| app.css:3277 | `.pref-segment[aria-checked="true"]` | border-color | --onyx-accent |
| app.css:3277 | `.pref-segment[aria-checked="true"]` | color | --onyx-accent |
| app.css:3284 | `.pref-toggle[aria-checked="true"] .pref-switch` | border-color | --onyx-accent |
| app.css:3285 | `.pref-toggle[aria-checked="true"] .pref-switch::after` | background | --onyx-accent |
| app.css:3388 | `.onyx-voice-chip[data-active="true"]` | border-color | --onyx-accent |
| pol-stats.css:687 | `.stats-page :is(.stats-window-options, .stats-control-group) button:is([aria-pressed='true` | border-color | --onyx-accent |
| pol-stats.css:689 | `.stats-page :is(.stats-window-options, .stats-control-group) button:is([aria-pressed='true` | background | --pg-select |
| pol-stats.css:956 | `.stats-page .data-room-row[data-selected='true']` | box-shadow | --onyx-accent |
| pol-stats.css:973 | `.stats-page .data-action:is(.data-action--compare, .data-action--inspect)[aria-pressed='tr` | border-color | --onyx-accent |
| pol-stats.css:974 | `.stats-page .data-action:is(.data-action--compare, .data-action--inspect)[aria-pressed='tr` | background | --pg-select |
| pol-studio.css:1322 | `.ts-pv-chan[data-active='true']` | background | --lapis-deep |
| pol-studio.css:1325 | `.ts-pv-chan[data-active='true'] .ts-pv-chan__hash` | color | --lapis-bright |
| pol-studio.css:1325 | `.ts-pv-chan[data-active='true'] .ts-pv-chan__hash` | color | --onyx-accent |
| pol-thread.css:1371 | `.onyx-composer .shell-command-item--active` | box-shadow | --onyx-accent |
| pol-thread.css:1768 | `.room-media-index-filter[aria-selected='true']` | box-shadow | --onyx-accent |
| pol-thread.css:2544 | `.onyx-frame .onyx-thread-pane button.topic-chip.is-active, .onyx-frame .onyx-thread-pane b` | border-color | --onyx-accent |
| pol-public.css:1290 | `.guides-step-toggle[aria-pressed="true"]` | border-color | --onyx-accent |
| pol-public.css:1291 | `.guides-step-toggle[aria-pressed="true"]::before` | color | --onyx-accent |
| pol-public.css:1500 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | --onyx-accent |
| pol-public.css:1571 | `.onyxos-console__tabs button[aria-selected="true"]` @@media (max-width: 768px) | box-shadow | --onyx-accent |
| gap-convo.css:136 | `.onyx-composer .gap-attach-quality-opt[aria-checked='true']` | box-shadow | --onyx-accent |
| gap-oper.css:288 | `.onyx-moddesk-sheet .oper-desk .oc-chip[aria-pressed="true"]` | border-color | --onyx-accent |
| gap-oper.css:289 | `.onyx-moddesk-sheet .oper-desk .oc-chip[aria-pressed="true"]` | background | --onyx-accent |
| gap-import.css:85 | `.hi-seg[aria-checked="true"]` | border-color | --onyx-accent |
| gap-import.css:85 | `.hi-seg[aria-checked="true"]` | color | --onyx-accent |
| gap-organize.css:473 | `.gorg-switch[aria-checked="true"]` | background | --onyx-accent |
| gap-organize.css:473 | `.gorg-switch[aria-checked="true"]` | border-color | --onyx-accent |
| gap-organize.css:474 | `.gorg-switch[aria-checked="true"] .gorg-switch-knob` | background | --onyx-accent-ink |
| gap-organize.css:573 | `.gorg-preset-option--on` | border-color | --onyx-accent |
| gap-organize.css:583 | `.gorg-preset-option--on .gorg-preset-dot` | border | --onyx-accent |
| gap-usermodes.css:356 | `button.um-choice.um-choice--on` | border-color | --onyx-accent |
| gap-commands.css:159 | `.gap-keys-pref[aria-checked="true"] .gap-keys-pref-switch` | border-color | --onyx-accent |
| gap-commands.css:160 | `.gap-keys-pref[aria-checked="true"] .gap-keys-pref-switch::after` | background | --onyx-accent |
| ui-sheets.css:477 | `.onyx-spotlight-option[aria-selected="true"]` | box-shadow | --onyx-accent |

### G7 · other (outside the budget) (42)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:249 | `.onyx-gem` | background | --onyx-accent |
| app.css:618 | `.onyx-newmsg-mark` | color | --onyx-accent |
| app.css:678 | `.onyx-whisper` | border-left | --onyx-accent |
| app.css:742 | `.onyx-member-prefix` | color | --onyx-accent |
| app.css:758 | `.onyx-composer-target` | color | --onyx-accent |
| app.css:1190 | `.onyx-composer .onyx-schedule-view` | color | --onyx-accent |
| app.css:1933 | `.conn-identities-go` | color | --onyx-accent-ink |
| app.css:1934 | `.conn-identities-go` | background | --onyx-accent |
| app.css:1940 | `.conn-identities-go:hover:not(:disabled)` | background | --onyx-accent |
| app.css:1941 | `.conn-identities-go:disabled` | background | --onyx-accent |
| app.css:2481 | `.onyx-home-announce` | color | --onyx-accent |
| app.css:2515 | `.onyx-home-row-meta` | color | --onyx-accent |
| app.css:2548 | `.onyx-coach` | border | --onyx-accent |
| app.css:2550 | `.onyx-coach-eyebrow` | color | --onyx-accent |
| pol-public.css:61 | `.public-frame__skip` | color | --onyx-accent-ink |
| pol-public.css:62 | `.public-frame__skip` | background | --onyx-accent |
| gap-convo.css:29 | `.onyx-composer > .gap-draft-status::before` | background | --onyx-accent |
| gap-convo.css:57 | `.gap-drop-card` | border | --onyx-accent |
| gap-convo.css:62 | `.gap-drop-icon` | color | --onyx-accent |
| gap-convo.css:251 | `.onyx-message.gap-landed` | box-shadow | --onyx-accent |
| gap-convo.css:257 | `.onyx-message.gap-landed` @@media (prefers-reduced-motion | background | --onyx-accent |
| gap-convo.css:259 | `:root[data-reduce-motion='true'] .onyx-message.gap-landed` | background | --onyx-accent |
| gap-oper.css:242 | `.oc-review` | border | --onyx-accent |
| gap-oper.css:428 | `.ap-btn` | border | --onyx-accent |
| gap-oper.css:428 | `.ap-btn` | background | --onyx-accent |
| gap-oper.css:428 | `.ap-btn` | color | --onyx-accent-ink |
| gap-oper.css:431 | `.ap-status-good` | color | --onyx-accent |
| rx-shell.css:311 | `.onyx-rail .onyx-rail-emptystate-go` | color | --onyx-accent-ink |
| rx-shell.css:311 | `.onyx-rail .onyx-rail-emptystate-go` | background | --onyx-accent |
| rx-shell.css:311 | `.onyx-rail .onyx-rail-emptystate-go` | border | --onyx-accent |
| rx-shell.css:312 | `.onyx-rail .onyx-rail-emptystate-go:hover` | background | --onyx-accent |
| gap-import.css:378 | `.bk-btn[data-copy-state="copied"]` | border-color | --onyx-accent |
| gap-import.css:378 | `.bk-btn[data-copy-state="copied"]` | color | --onyx-accent |
| gap-people.css:106 | `.onyx-roster-care--offer` | color | --onyx-accent |
| gap-organize.css:295 | `.gorg-choice > .gorg-i[data-icon="check"]` | color | --onyx-accent |
| gap-usermodes.css:73 | `button.um-btn.um-btn--soft` | color | --onyx-accent |
| gap-watch.css:106 | `.onyx-watch-icon-btn.onyx-watch-play` | color | --onyx-accent-ink |
| gap-watch.css:107 | `.onyx-watch-icon-btn.onyx-watch-play` | background | --onyx-accent |
| gap-watch.css:108 | `.onyx-watch-icon-btn.onyx-watch-play` | border-color | --onyx-accent |
| gap-watch.css:111 | `.onyx-watch-icon-btn.onyx-watch-play:hover` | color | --onyx-accent-ink |
| gap-watch.css:111 | `.onyx-watch-icon-btn.onyx-watch-play:hover` | background | --onyx-accent |
| gap-auth.css:44 | `.ga-question` | border-left | --onyx-accent |

### G7 · unread / count / badge / pill (23)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:202 | `.topic-chip__unread` | background | --onyx-accent |
| app.css:1073 | `.chb-pill` | border | --onyx-accent |
| app.css:1073 | `.chb-pill` | color | --onyx-accent |
| app.css:1080 | `.chb-ledger` | color | --onyx-accent |
| app.css:1225 | `.onyx-scheduled-ledger` | color | --onyx-accent |
| app.css:1624 | `.onyx-member-ledger` | color | --onyx-accent |
| app.css:1706 | `.provenance-badge` | border | --lapis-bright |
| app.css:1708 | `.provenance-badge` | background | --lapis |
| app.css:1709 | `.provenance-badge` | color | --lapis-bright |
| app.css:2526 | `.onyx-home-count` | color | --onyx-accent |
| app.css:2671 | `.boost-pill.you` | border-color | --onyx-accent |
| app.css:3163 | `.onyx-jump-latest--unread` | color | --onyx-accent-ink |
| app.css:3163 | `.onyx-jump-latest--unread` | background | --onyx-accent |
| app.css:3163 | `.onyx-jump-latest--unread` | border-color | --onyx-accent |
| pol-shell.css:651 | `.onyx-topbar .shell-ribbon-badge` | color | --onyx-accent-ink |
| pol-shell.css:652 | `.onyx-topbar .shell-ribbon-badge` | background | --onyx-accent |
| pol-thread.css:597 | `.onyx-frame .onyx-jump-latest--unread` | color | --onyx-accent-ink |
| pol-thread.css:597 | `.onyx-frame .onyx-jump-latest--unread` | background | --onyx-accent |
| pol-thread.css:597 | `.onyx-frame .onyx-jump-latest--unread` | border-color | --onyx-accent |
| pol-thread.css:598 | `.onyx-jump-latest--unread:hover` | border-color | --onyx-accent |
| gap-usermodes.css:196 | `.um-requests__count` | color | --onyx-accent |
| gap-usermodes.css:248 | `.um-inbox-link__count` | background | --onyx-accent |
| gap-usermodes.css:249 | `.um-inbox-link__count` | color | --onyx-accent-ink |

### G7 · current location (20)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:459 | `.onyx-rail-active .onyx-rail-name` | color | --onyx-accent |
| app.css:2367 | `.onyx-nav-btn--active .onyx-nav-icon` | background | --onyx-accent |
| app.css:3263 | `.pref-category-tab[aria-selected="true"]` | box-shadow | --onyx-accent |
| pol-stats.css:195 | `.status-observation[data-feed-state='current'] .status-observation__marker` | color | --onyx-accent |
| pol-stats.css:321 | `.roadmap-legend a[aria-current='location']` | box-shadow | --onyx-accent |
| pol-stats.css:340 | `.roadmap-card:is(:target, [data-current='true'])` | box-shadow | --onyx-accent |
| pol-stats.css:455 | `.stats-page .stats-observation[data-feed-state='current'] .stats-observation__marker, .sta` | color | --pg-live |
| pol-stats.css:602 | `.stats-page .stats-feed-step[data-step-state='current'] .stats-feed-step__heading > strong` | color | --pg-live |
| pol-shell.css:695 | `.onyx-primary-nav .onyx-nav-btn--active::before` | background | --onyx-accent |
| pol-shell.css:700 | `.onyx-nav-btn--active .onyx-nav-icon` | background | --onyx-accent |
| pol-shell.css:815 | `.onyx-rail .onyx-rail-active::before` | background | --onyx-accent |
| pol-thread.css:185 | `.onyx-message-search-current, .onyx-message-search-current:hover` | box-shadow | --onyx-accent |
| pol-thread.css:2278 | `.onyx-message--compact.onyx-message-search-current` | box-shadow | --onyx-accent |
| pol-public.css:127 | `.public-frame__nav a[aria-current="page"]` | box-shadow | --onyx-accent |
| pol-public.css:333 | `.public-frame__nav a[aria-current="page"]` @@media (max-width: 768px) | box-shadow | --onyx-accent |
| pol-public.css:1230 | `.guides-route__item[data-state="current"] .guides-route__card` | border-color | --onyx-accent |
| pol-public.css:1235 | `.guides-route__item[data-state="current"] .guides-route__state` | color | --onyx-accent |
| pol-public.css:1328 | `.guides-route__item[data-state="current"] .guides-route__card` @@media (max-width: 768px) | box-shadow | --onyx-accent |
| pol-public.css:1753 | `.public-related__list a[aria-current="page"]` | box-shadow | --onyx-accent |
| gap-oper.css:92 | `.onyx-moddesk-sheet .oper-desk .oc-tab[aria-selected="true"]` | border-bottom-color | --onyx-accent |

### G7 · mention (17)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:573 | `.onyx-rail-mention` | background | --onyx-accent |
| app.css:573 | `.onyx-rail-mention` | color | --onyx-accent-ink |
| app.css:2240 | `.shell-msg-mention` | color | --lapis-bright |
| app.css:2241 | `.shell-msg-mention--self` | color | --onyx-accent-ink |
| app.css:2241 | `.shell-msg-mention--self` | background | --onyx-accent |
| app.css:2520 | `.is-mention .onyx-home-unread` | background | --onyx-accent |
| app.css:2520 | `.is-mention .onyx-home-unread` | color | --onyx-accent-ink |
| app.css:2544 | `.onyx-home-room-mention` | color | --onyx-accent |
| pol-shell.css:128 | `.notif-center__row[data-type="mention"] .notif-center__glyph` | color | --onyx-accent |
| pol-shell.css:719 | `.onyx-nav-badge--mention` | color | --onyx-accent-ink |
| pol-shell.css:719 | `.onyx-nav-badge--mention` | background | --onyx-accent |
| pol-shell.css:851 | `.onyx-rail .onyx-rail-mention` | color | --onyx-accent-ink |
| pol-shell.css:851 | `.onyx-rail .onyx-rail-mention` | background | --onyx-accent |
| pol-shell.css:851 | `.onyx-rail .onyx-rail-mention` | border-color | --onyx-accent |
| gap-organize.css:125 | `.gorg-folder-count--mention` | color | --onyx-accent-ink |
| gap-organize.css:125 | `.gorg-folder-count--mention` | background | --onyx-accent |
| gap-organize.css:125 | `.gorg-folder-count--mention` | border-color | --onyx-accent |

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
| pol-public.css:582 | `.onyx-land-sketch-avatar--lapis` | background | --lapis |

### G7 · control fill / data-viz (10)

| file:line | selector | property | token |
|---|---|---|---|
| pol-thread.css:1323 | `.shell-attachment-progress` | accent-color | --onyx-accent |
| pol-public.css:1206 | `.guides-progress__meter` | color | --onyx-accent |
| pol-public.css:1211 | `.guides-progress__meter::-webkit-progress-value` | background | --onyx-accent |
| pol-public.css:1212 | `.guides-progress__meter::-moz-progress-bar` | background | --onyx-accent |
| polish.css:230 | `.time-scrubber__bar--now .time-scrubber__bar-fill` | background | --onyx-accent |
| gap-import.css:100 | `.hi-bar-fill` | background | --onyx-accent |
| gap-import.css:199 | `.hi-check` | accent-color | --onyx-accent |
| gap-watch.css:256 | `.onyx-watch-range` | accent-color | --onyx-accent |
| gap-claim.css:155 | `.gc-bar-fill` | background | --onyx-accent |
| ui-sheets.css:57 | `.onyx-sheet input[type="checkbox"], .onyx-sheet input[type="radio"]` | accent-color | --onyx-accent |

### G7 · live-audio (calls) (9)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:849 | `.onyx-calls-pip[data-state="established"]` | background | --onyx-accent |
| app.css:3361 | `.onyx-call-pip[data-state="live"]` | background | --onyx-accent |
| app.css:3440 | `.onyx-call-person[data-speaking="true"] .onyx-call-ring` | border-color | --onyx-accent |
| app.css:3444 | `.onyx-call-ring::after` | border | --onyx-accent |
| calls-c6.css:181 | `.onyx-call-pip-faces .onyx-call-avatar[data-speaking="true"]` | outline | --onyx-accent |
| calls-c4.css:87 | `.onyx-tile[data-speaking="true"]` | border-color | --onyx-accent |
| calls-c4.css:115 | `.onyx-tile-talk > span` | background | --onyx-accent |
| calls-engine.css:155 | `.onyx-call-head-faces .onyx-call-avatar[data-speaking="true"]` | border-color | --onyx-accent |
| calls-engine.css:155 | `.onyx-call-head-faces .onyx-call-avatar[data-speaking="true"]` | box-shadow | --onyx-accent |

### G7 · status (success / online) (8)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:288 | `.onyx-conn-live` | color | --onyx-accent |
| app.css:289 | `.onyx-conn-live .onyx-dot` | background | --onyx-accent |
| app.css:329 | `.onyx-reconnect-online` | color | --onyx-accent |
| app.css:330 | `.onyx-reconnect-online .onyx-reconnect-dot` | background | --onyx-accent |
| app.css:1068 | `.chb-row--live` | border-color | --onyx-accent |
| app.css:1075 | `.chb-count--live` | color | --onyx-accent |
| app.css:1608 | `.onyx-member-dot` | background | --onyx-accent |
| gap-shell.css:147 | `.gs-activity-conn[data-state="live"] .gs-activity-conn-dot` | background | --onyx-accent |

### G7 · link / nav text (7)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:1262 | `.onyx-account-nav__item` | color | --onyx-accent |
| app.css:2239 | `.shell-msg-link` | color | --onyx-accent |
| app.css:2243 | `.shell-msg-channel-link` | color | --onyx-accent |
| pol-studio.css:1422 | `.ts-pv-msg__link` | color | --lapis-bright |
| pol-studio.css:1422 | `.ts-pv-msg__link` | color | --onyx-accent |
| gap-import.css:375 | `.bk-btn--action` | border-color | --onyx-accent |
| gap-import.css:376 | `.bk-btn--action:hover:not(:disabled)` | border-color | --onyx-accent |

### G7 · token alias (5)

| file:line | selector | property | token |
|---|---|---|---|
| app.css:71 | `:root` | --focus-ring | --onyx-accent |
| gap-appearance.css:38 | `:root` | --onyx-focus | --onyx-accent |
| gap-appearance.css:81 | `:root` | --focus-ring | --onyx-focus |
| pol-stats.css:20 | `.ui-root.r:is(.stats-page, .status-route, .roadmap-page)` | --pg-live | --onyx-accent |
| pol-stats.css:24 | `.ui-root.r:is(.stats-page, .status-route, .roadmap-page)` | --pg-select | --onyx-accent |

## G8. Typography in use

Ladder: `--text-2xs`=12px · `--text-xs`=11px · `--text-sm`=13px · `--text-md`=15px · `--text-lg`=17px · `--text-xl`=20px · `--text-2xl`=24px; leading `--leading-tight`=1.15 · `--leading-snug`=1.35 · `--leading-body`=1.5.

Font-size distribution (px at a 16px root):

| size | count | where |
|---|---|---|
| `13px (--text-sm)` | 457 | (457 sites — style-map.json typography.fontSizes) |
| `12px (--text-2xs)` | 161 | (161 sites — style-map.json typography.fontSizes) |
| `11px (--text-xs)` | 159 | (159 sites — style-map.json typography.fontSizes) |
| `15px (--text-md)` | 138 | (138 sites — style-map.json typography.fontSizes) |
| `12px` | 67 | app.css:151,155,163,164,168,178,179,186,187,190,192,199,360,471,477,779,1013,1015,1074,1080,1087,1089,1090,1096,1104,1105,1107,1146,1163,1186,1221,1224,1236,1266,1268,1274,1324,1334,1335,1340,1343,1345,1358,1365,1366,1430,1508,1520,1538,1555,1566,1638,1663,1676,1690,1693,1695,1696,3377,3390,3429,3460,3464,3502,3530 · pol-roster.css:404 · rx-shell.css:163 |
| `17px (--text-lg)` | 66 | app.css:240,617,618,632,1862,2156,2275,2409,2684,2865,2886,2946,3017,3069,3072,3256,3299,3972 · pol-stats.css:156,289,423,438,858,892,909 · pol-studio.css:96,440,1024 · pol-shell.css:53,166,922,1373 · pol-thread.css:995,1702,2006 · pol-roster.css:387 · pol-public.css:260,312,395,780,866,931,966,1010,1015,1081,1362,1445,1470,1590 · calls-c8.css:119 · calls-c11.css:138 · calls-c6.css:50 · gap-convo.css:68 · rx-shell.css:263,328,588 · gap-import.css:124,251 · gap-shell.css:240 · gap-auth.css:58 · ui-sheets.css:197,210,459,790,1102 |
| `13px` | 65 | app.css:354,737,829,906,1157,1193,1213,1215,1225,1233,1262,1270,1275,1318,1321,1331,1339,1354,1357,1359,1392,1394,1395,1396,1397,1399,1406,1410,1418,1441,1468,1489,1546,1550,1559,1560,1561,1564,1574,1604,1607,1616,1620,1624,1640,1641,1642,1643,1659,1660,1662,1669,1675,1682,1691,3386,3395,3526,3537,3541,3545 · gap-appearance.css:190 · gap-oper.css:198,253,421 |
| `16px` | 36 | app.css:963,1147,2218,3584 · gap-appearance.css:313 · pol-shell.css:1040,1322 · pol-thread.css:393,1395,1414,1682,2334,2411,2479,2585 · pol-roster.css:396,403 · pol-public.css:913,1405 · calls-c8.css:52 · gap-account.css:141,145 · gap-oper.css:230,231,397,425 · rx-shell.css:258,435,459 · gap-import.css:454 · gap-organize.css:741 · gap-usermodes.css:399 · gap-watch.css:665 · gap-shell.css:347,364 · ui-sheets.css:836 |
| `var(--oc-fs)` | 25 | gap-oper.css:28,38,85,108,112,115,165,176,183,196,212,247,263,281,329,353,360,361,367,374,391,393,400,401,403 |
| `20px (--text-xl)` | 24 | app.css:2644 · pol-stats.css:237,363,378,580,643,742,794 · pol-shell.css:1166,1176 · pol-thread.css:1502,2019 · pol-public.css:692,825,964,989,1196,1265,1506,1589,1599 · calls-c6.css:36 · gap-import.css:140 · ui-sheets.css:624 |
| `11px` | 19 | app.css:202,421,683,694,1073,1084,1341,1563,2255,3369,3480 · pol-studio.css:1263 · pol-shell.css:842,1241,1259,1424 · rx-shell.css:364,374 · gap-organize.css:114 |
| `18px` | 15 | app.css:725,1053,1055,1085,1211,1212,1391,1393,1502,1597,1780,3463,3535 · pol-public.css:110 · calls-engine.css:227 |
| `var(--oc-fs-meta)` | 13 | gap-oper.css:36,109,110,166,261,325,328,331,352,354,369,377,392 |
| `15px` | 10 | app.css:162,865,1537,1603,1637,1658,3370 · pol-shell.css:1392 · pol-thread.css:412 · gap-people.css:60 |
| `14px` | 10 | app.css:996,1099,1265,1549 · gap-oper.css:420,422,424,428 · gap-auth.css:26 · calls-engine.css:535 |
| `24px` | 10 | app.css:2181,3371 · pol-thread.css:395,1416,2335,2481 · pol-public.css:1357 · gap-auth.css:29 · calls-engine.css:431,469 |
| `20px` | 6 | app.css:1814 · pol-thread.css:333 · pol-public.css:956,1422 · calls-c8.css:32 · gap-auth.css:95 |
| `9px` | 6 | pol-studio.css:1296,1317,1341,1376,1412,1481 |
| `24px (--text-2xl)` | 5 | app.css:2477 · pol-stats.css:642 · pol-thread.css:514,519,624 |
| `10px` | 5 | gap-appearance.css:186 · pol-studio.css:1439 · pol-shell.css:649,709,1031 |
| `var(--text-sm, 13px)` | 5 | gap-account.css:27,57,66,89,125 |
| `17px` | 4 | app.css:1251,3517 · gap-organize.css:672 · calls-engine.css:293 |
| `max(1rem, 16px)` | 4 | app.css:1974 · pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1666 |
| `28px` | 3 | app.css:857,1783 · pol-shell.css:1054 |
| `32px` | 3 | app.css:2175 · pol-public.css:1788 · calls-engine.css:395 |
| `clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)` | 3 | pol-stats.css:146,279,411 |
| `inherit` | 3 | pol-thread.css:2308 · pol-public.css:1540 · calls-c4.css:27 |
| `0` | 2 | pol-studio.css:307 · ui-sheets.css:262 |
| `11.52px` | 2 | app.css:140,211 |
| `var(--text-xs, 12px)` | 2 | gap-account.css:11,129 |
| `13.76px` | 1 | app.css:141 |
| `9.92px` | 1 | app.css:1711 |
| `clamp(2.25rem, 1.1rem + 2.2vw, 3.25rem)` | 1 | app.css:2155 |
| `26px` | 1 | app.css:2215 |
| `0.92em` | 1 | app.css:2247 |
| `0.85em` | 1 | app.css:2260 |
| `1.1em` | 1 | app.css:2264 |
| `100%` | 1 | gap-appearance.css:150 |
| `93.75%` | 1 | gap-appearance.css:151 |
| `112.5%` | 1 | gap-appearance.css:152 |
| `clamp(1.5rem, 1.15rem + 1.4vw, 2.25rem)` | 1 | pol-stats.css:80 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem)` | 1 | pol-stats.css:546 |
| `clamp(1.5rem, 1.1rem + 1.6vw, 2.125rem)` | 1 | pol-studio.css:86 |
| `10.5px` | 1 | pol-thread.css:150 |
| `17.6px` | 1 | pol-thread.css:622 |
| `9.6px` | 1 | pol-thread.css:1968 |
| `0.9em` | 1 | pol-public.css:39 |
| `clamp(2rem, 1.4rem + 2.6vw, 2.75rem)` | 1 | pol-public.css:385 |
| `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | 1 | pol-public.css:515 |
| `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | 1 | pol-public.css:524 |
| `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | 1 | pol-public.css:622 |
| `clamp(2.375rem, 9.6vw, 2.75rem)` | 1 | pol-public.css:779 |
| `clamp(1.5rem, 1.2rem + 1vw, 1.875rem)` | 1 | pol-public.css:910 |
| `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` | 1 | pol-public.css:993 |
| `clamp(1.875rem, 1.4rem + 1.8vw, 2.5rem)` | 1 | pol-public.css:1361 |
| `clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)` | 1 | pol-public.css:1443 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | 1 | pol-public.css:1462 |
| `clamp(1.75rem, 1.3rem + 2vw, 2.5rem)` | 1 | pol-public.css:1558 |
| `clamp(100%, calc(62.5% + 0.35vw), 125%)` | 1 | pol-public.css:1692 |
| `38px` | 1 | pol-public.css:1796 |
| `clamp(2.5rem, 1rem + 3.6vw, 3rem)` | 1 | pol-public.css:1827 |
| `var(--text-2xs, 11px)` | 1 | gap-account.css:98 |
| `10.56px` | 1 | rx-shell.css:47 |
| `106.25%` | 1 | rx-shell.css:649 |
| `22px` | 1 | calls-engine.css:162 |
| `36px` | 1 | calls-engine.css:399 |
| `19px` | 1 | calls-engine.css:455 |

Font-weight distribution:

| weight | count |
|---|---|
| `650` | 209 |
| `600` | 199 |
| `700` | 115 |
| `400` | 21 |
| `750` | 15 |
| `500` | 8 |
| `800` | 3 |
| `inherit` | 1 |

Line-height distribution:

| line-height | count |
|---|---|
| `var(--leading-snug)` | 96 |
| `var(--leading-body)` | 51 |
| `1` | 31 |
| `var(--leading-tight)` | 25 |
| `1.2` | 8 |
| `1.6` | 8 |
| `1.3` | 5 |
| `0` | 4 |
| `1.45` | 4 |
| `18px` | 4 |
| `1.4` | 4 |
| `16px` | 4 |
| `20px` | 4 |
| `1.25` | 3 |
| `var(--leading-snug, 1.35)` | 3 |
| `1.05` | 2 |
| `1.1` | 2 |
| `1.35` | 2 |
| `1.5` | 2 |
| `1.65` | 2 |
| `1.15` | 1 |
| `1.62` | 1 |
| `1.08` | 1 |
| `1.02` | 1 |
| `1.9` | 1 |
| `inherit` | 1 |
| `1.72` | 1 |

Size × line-height × weight set together in one rule (200 distinct combinations):

| size | line-height | weight | rules | where |
|---|---|---|---|---|
| `13px (--text-sm)` | `—` | `—` | 279 | (279 rules) |
| `12px (--text-2xs)` | `—` | `—` | 108 | (108 rules) |
| `15px (--text-md)` | `—` | `—` | 73 | (73 rules) |
| `11px (--text-xs)` | `—` | `—` | 68 | (68 rules) |
| `13px (--text-sm)` | `—` | `600` | 67 | (67 rules) |
| `12px` | `—` | `—` | 58 | (58 rules) |
| `13px` | `—` | `—` | 57 | (57 rules) |
| `11px (--text-xs)` | `—` | `650` | 39 | app.css:1861 · pol-studio.css:117,129,356,451,489,503,648,657,690,820,1532 · pol-thread.css:466,1044,1213,1363 · pol-roster.css:55,161 · pol-public.css:239,300,752,865,1091,1234,1516,1725 · calls-c11.css:35 · calls-c6.css:27 · gap-import.css:118,139,207,298,304,412 · gap-people.css:73 · gap-watch.css:493 · gap-shell.css:276 · gap-claim.css:36 · ui-sheets.css:201 |
| `13px (--text-sm)` | `var(--leading-snug)` | `—` | 35 | app.css:1821,1827,1835,1855,1987,1988,2010,2034,2071 · pol-stats.css:961 · pol-studio.css:111,146,378,461,950 · pol-shell.css:155 · pol-thread.css:667,798,2220,2303 · pol-roster.css:129 · calls-c11.css:48 · rx-shell.css:296 · gap-import.css:106,299 · gap-organize.css:341 · gap-watch.css:148,198,325,461,649,674 · gap-shell.css:182 · ui-sheets.css:219,1296 |
| `16px` | `—` | `—` | 31 | app.css:1147,2218,3584 · gap-appearance.css:313 · pol-shell.css:1040,1322 · pol-thread.css:393,1414,1682,2334,2411,2479,2585 · pol-roster.css:396,403 · pol-public.css:1405 · gap-account.css:141,145 · gap-oper.css:230,231,397 · rx-shell.css:258,435,459 · gap-import.css:454 · gap-organize.css:741 · gap-usermodes.css:399 · gap-watch.css:665 · gap-shell.css:347,364 · ui-sheets.css:836 |
| `13px (--text-sm)` | `—` | `650` | 27 | app.css:640,1969,3082 · pol-stats.css:622 · pol-shell.css:182,201 · pol-thread.css:390,1071,1236,1558,1879,1970 · pol-public.css:230,511,672,1134,1395,1498 · polish.css:106 · gap-import.css:180,433 · gap-watch.css:383,524,642 · gap-shell.css:247,321 · ui-sheets.css:295 |
| `13px (--text-sm)` | `var(--leading-body)` | `—` | 25 | pol-stats.css:485,605,606,764,833,852,913 · pol-studio.css:139,642,702,1056 · pol-thread.css:1547,1724,1944 · pol-public.css:631 · gap-convo.css:234 · gap-import.css:288,408,424 · gap-usermodes.css:283 · gap-shell.css:241,300,322 · gap-claim.css:56,84 |
| `17px (--text-lg)` | `—` | `—` | 23 | app.css:617,2156,2275,2409,2684,2865,3017,3072,3256,3299 · pol-roster.css:387 · pol-public.css:260,780,1010,1362,1445 · calls-c8.css:119 · calls-c6.css:50 · rx-shell.css:263,328,588 · gap-import.css:251 · ui-sheets.css:459 |
| `15px (--text-md)` | `—` | `650` | 18 | app.css:1854,2033,2453,3834 · pol-studio.css:458,808 · pol-shell.css:48 · pol-thread.css:627 · pol-public.css:143,537,587,630,967,1105,1243 · rx-shell.css:295 · gap-chanserv.css:168 · gap-organize.css:239 |
| `11px (--text-xs)` | `—` | `600` | 18 | app.css:2352,2550,3023 · pol-studio.css:712,903,1175 · pol-shell.css:187,484,766,785 · pol-thread.css:784,1915 · pol-roster.css:63 · calls-c4.css:33 · gap-organize.css:163,300,496 · gap-commands.css:57 |
| `11px (--text-xs)` | `—` | `700` | 15 | app.css:530,567,2428 · pol-stats.css:792,819,907,926 · pol-studio.css:1590 · pol-thread.css:488,1867 · roomsettings.css:155 · gap-chanserv.css:58 · gap-organize.css:83,529,694 |
| `var(--oc-fs)` | `—` | `—` | 15 | gap-oper.css:28,38,112,115,183,196,263,353,361,367,391,393,400,401,403 |
| `12px (--text-2xs)` | `—` | `600` | 13 | app.css:269,319,2498,2518,2544,2698,3155 · pol-shell.css:71,447 · pol-public.css:874 · calls-c8.css:19,74 · gap-usermodes.css:304 |
| `17px (--text-lg)` | `1` | `—` | 12 | app.css:618,632,2886,2946,3069 · pol-stats.css:858,892 · pol-studio.css:440,1024 · pol-shell.css:53,166 · pol-thread.css:2006 |
| `12px (--text-2xs)` | `var(--leading-snug)` | `—` | 12 | pol-stats.css:555,696,793 · pol-studio.css:941 · gap-import.css:205,221,382,438 · gap-usermodes.css:22,30,360 · gap-watch.css:504 |
| `18px` | `—` | `—` | 10 | app.css:725,1053,1055,1085,1212,1393,1502,3463,3535 · calls-engine.css:227 |
| `15px (--text-md)` | `—` | `700` | 10 | app.css:1820,1936,2081 · pol-studio.css:71 · pol-shell.css:584,731,1306 · pol-public.css:1179,1216 · rx-shell.css:157 |
| `15px` | `—` | `—` | 9 | app.css:162,865,1537,1637,1658,3370 · pol-shell.css:1392 · pol-thread.css:412 · gap-people.css:60 |
| `15px (--text-md)` | `—` | `600` | 9 | app.css:3264 · pol-studio.css:259,372 · pol-shell.css:1385,1403 · pol-public.css:122 · roomsettings.css:276 · gap-chanserv.css:26 · ui-sheets.css:664 |
| `20px (--text-xl)` | `—` | `700` | 9 | pol-shell.css:1176 · pol-public.css:692,964,1196,1265,1506,1589,1599 · ui-sheets.css:624 |
| `var(--oc-fs-meta)` | `—` | `—` | 9 | gap-oper.css:36,110,166,261,331,352,369,377,392 |
| `17px (--text-lg)` | `—` | `650` | 8 | app.css:240 · pol-public.css:866,931,1081,1470 · ui-sheets.css:197,790,1102 |
| `15px (--text-md)` | `var(--leading-body)` | `—` | 8 | app.css:1790 · pol-stats.css:191 · pol-thread.css:625,1036,1981 · pol-public.css:28 · polish.css:265 · ui-sheets.css:786 |
| `24px` | `—` | `—` | 8 | app.css:2181,3371 · pol-thread.css:395,1416,2335,2481 · gap-auth.css:29 · calls-engine.css:431 |
| `11px` | `—` | `—` | 7 | app.css:1073,1084,1341,1563,2255,3369 · pol-shell.css:1259 |
| `17px (--text-lg)` | `var(--leading-snug)` | `650` | 7 | app.css:3972 · pol-stats.css:438 · pol-thread.css:1702 · gap-convo.css:68 · gap-import.css:124 · gap-shell.css:240 · ui-sheets.css:210 |
| `12px` | `—` | `600` | 6 | app.css:360,1013,1274,1343,3377,3429 |
| `12px (--text-2xs)` | `—` | `700` | 6 | app.css:589 · pol-stats.css:352,601 · gap-organize.css:595 · gap-usermodes.css:250 · gap-auth.css:50 |
| `14px` | `—` | `—` | 6 | app.css:996,1099,1265 · gap-oper.css:422 · gap-auth.css:26 · calls-engine.css:535 |
| `12px (--text-2xs)` | `—` | `650` | 6 | app.css:2899 · pol-thread.css:413,1665 · pol-public.css:1072 · calls-c8.css:92 · calls-c4.css:106 |
| `12px (--text-2xs)` | `—` | `400` | 6 | pol-studio.css:1124 · pol-shell.css:271 · pol-thread.css:724 · gap-import.css:351 · gap-usermodes.css:148 · gap-shell.css:143 |
| `18px` | `—` | `700` | 5 | app.css:1211,1391,1597,1780 · pol-public.css:110 |
| `17px (--text-lg)` | `var(--leading-body)` | `—` | 5 | pol-stats.css:156,289,423 · pol-studio.css:96 · pol-public.css:395 |
| `20px (--text-xl)` | `var(--leading-tight)` | `700` | 5 | pol-stats.css:237,363,378,580,643 |
| `13px` | `—` | `650` | 4 | app.css:829,3386,3395,3545 |
| `max(1rem, 16px)` | `—` | `—` | 4 | app.css:1974 · pol-stats.css:1056 · pol-studio.css:1782 · pol-public.css:1666 |
| `11px (--text-xs)` | `var(--leading-snug)` | `650` | 4 | pol-stats.css:71 · pol-public.css:376 · gap-watch.css:124 · ui-sheets.css:1281 |
| `20px (--text-xl)` | `—` | `—` | 4 | pol-stats.css:742 · pol-shell.css:1166 · pol-thread.css:1502,2019 |
| `var(--text-sm, 13px)` | `—` | `—` | 4 | gap-account.css:27,66,89,125 |
| `15px (--text-md)` | `var(--leading-snug)` | `600` | 4 | gap-import.css:204 · gap-claim.css:45,73 · ui-sheets.css:1291 |
| `11px` | `—` | `600` | 3 | app.css:683,694 · pol-shell.css:1424 |
| `32px` | `—` | `—` | 3 | app.css:2175 · pol-public.css:1788 · calls-engine.css:395 |
| `12px` | `—` | `650` | 3 | app.css:3390,3502,3530 |
| `clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem)` | `var(--leading-tight)` | `700` | 3 | pol-stats.css:146,279,411 |
| `24px (--text-2xl)` | `var(--leading-tight)` | `700` | 3 | pol-stats.css:642 · pol-thread.css:519,624 |
| `9px` | `—` | `—` | 3 | pol-studio.css:1317,1412,1481 |
| `11px (--text-xs)` | `var(--leading-snug)` | `—` | 3 | pol-shell.css:139 · pol-thread.css:1888 · account2.css:9 |
| `11px` | `18px` | `—` | 3 | pol-shell.css:842 · rx-shell.css:364,374 |
| `11px (--text-xs)` | `1.3` | `—` | 3 | pol-shell.css:1254 · rx-shell.css:203,408 |
| `17px (--text-lg)` | `—` | `700` | 3 | pol-shell.css:1373 · pol-public.css:966,1015 |
| `15px (--text-md)` | `var(--leading-snug)` | `650` | 3 | pol-thread.css:796 · gap-import.css:287 · gap-watch.css:135 |
| `15px (--text-md)` | `var(--leading-snug)` | `—` | 3 | pol-thread.css:2256 · calls-c8.css:79 · gap-oper.css:130 |
| `var(--oc-fs)` | `—` | `600` | 3 | gap-oper.css:85,212,281 |
| `var(--oc-fs)` | `var(--leading-snug)` | `—` | 3 | gap-oper.css:108,247,329 |
| `13px (--text-sm)` | `1.2` | `600` | 3 | gap-import.css:33,334 · gap-claim.css:114 |
| `11px` | `—` | `700` | 2 | app.css:202,421 |
| `16px` | `1` | `—` | 2 | app.css:963 · calls-c8.css:52 |
| `17px` | `—` | `—` | 2 | app.css:1251 · calls-engine.css:293 |
| `13px` | `—` | `700` | 2 | app.css:1399,1675 |
| `13px (--text-sm)` | `—` | `750` | 2 | app.css:1903 · pol-public.css:579 |
| `15px (--text-md)` | `var(--leading-snug)` | `700` | 2 | pol-stats.css:183 · rx-shell.css:170 |
| `13px (--text-sm)` | `var(--leading-tight)` | `650` | 2 | pol-stats.css:505,679 |
| `15px (--text-md)` | `—` | `400` | 2 | pol-stats.css:936 · rx-shell.css:202 |
| `13px (--text-sm)` | `var(--leading-tight)` | `600` | 2 | pol-studio.css:562,991 |
| `11px (--text-xs)` | `var(--leading-tight)` | `—` | 2 | pol-studio.css:571,997 |
| `9px` | `—` | `650` | 2 | pol-studio.css:1296,1376 |
| `15px (--text-md)` | `1.25` | `—` | 2 | pol-shell.css:1253 · rx-shell.css:407 |
| `20px` | `1` | `—` | 2 | pol-thread.css:333 · calls-c8.css:32 |
| `13px (--text-sm)` | `1` | `600` | 2 | pol-thread.css:916,2530 |
| `13px (--text-sm)` | `—` | `400` | 2 | pol-thread.css:1315,1346 |
| `inherit` | `—` | `—` | 2 | pol-thread.css:2308 · pol-public.css:1540 |
| `12px (--text-2xs)` | `1.4` | `—` | 2 | pol-thread.css:2321 · gap-usermodes.css:179 |
| `20px (--text-xl)` | `var(--leading-snug)` | `600` | 2 | pol-public.css:825,989 |
| `12px (--text-2xs)` | `1.6` | `—` | 2 | pol-public.css:1026,1536 |
| `20px` | `—` | `—` | 2 | pol-public.css:1422 · gap-auth.css:95 |
| `var(--oc-fs)` | `—` | `650` | 2 | gap-oper.css:165,176 |
| `var(--oc-fs-meta)` | `1.6` | `—` | 2 | gap-oper.css:325,354 |
| `14px` | `—` | `650` | 2 | gap-oper.css:424,428 |
| `13px (--text-sm)` | `1.2` | `—` | 2 | gap-import.css:80 · gap-usermodes.css:54 |
| `11.52px` | `—` | `—` | 1 | app.css:140 |
| `13.76px` | `—` | `—` | 1 | app.css:141 |
| `11.52px` | `—` | `600` | 1 | app.css:211 |
| `28px` | `—` | `750` | 1 | app.css:857 |
| `13px` | `—` | `600` | 1 | app.css:1396 |
| `13px` | `1` | `—` | 1 | app.css:1441 |
| `14px` | `—` | `700` | 1 | app.css:1549 |
| `15px` | `—` | `700` | 1 | app.css:1603 |
| `9.92px` | `1` | `800` | 1 | app.css:1711 |
| `28px` | `1.15` | `750` | 1 | app.css:1783 |
| `20px` | `1` | `750` | 1 | app.css:1814 |
| `17px (--text-lg)` | `var(--leading-tight)` | `700` | 1 | app.css:1862 |
| `clamp(2.25rem, 1.1rem + 2.2vw, 3.25rem)` | `1.05` | `—` | 1 | app.css:2155 |
| `26px` | `—` | `—` | 1 | app.css:2215 |
| `0.92em` | `—` | `—` | 1 | app.css:2247 |
| `0.85em` | `—` | `—` | 1 | app.css:2260 |
| `1.1em` | `—` | `—` | 1 | app.css:2264 |
| `24px (--text-2xl)` | `—` | `600` | 1 | app.css:2477 |
| `20px (--text-xl)` | `1` | `—` | 1 | app.css:2644 |
| `11px (--text-xs)` | `1.2` | `—` | 1 | app.css:2926 |
| `11px` | `—` | `650` | 1 | app.css:3480 |
| `17px` | `—` | `750` | 1 | app.css:3517 |
| `11px (--text-xs)` | `18px` | `700` | 1 | app.css:3766 |
| `100%` | `—` | `—` | 1 | gap-appearance.css:150 |
| `93.75%` | `—` | `—` | 1 | gap-appearance.css:151 |
| `112.5%` | `—` | `—` | 1 | gap-appearance.css:152 |
| `10px` | `—` | `—` | 1 | gap-appearance.css:186 |
| `clamp(1.5rem, 1.15rem + 1.4vw, 2.25rem)` | `var(--leading-tight)` | `650` | 1 | pol-stats.css:80 |
| `15px (--text-md)` | `var(--leading-tight)` | `650` | 1 | pol-stats.css:106 |
| `11px (--text-xs)` | `var(--leading-snug)` | `700` | 1 | pol-stats.css:539 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem)` | `1` | `700` | 1 | pol-stats.css:546 |
| `13px (--text-sm)` | `—` | `700` | 1 | pol-stats.css:600 |
| `20px (--text-xl)` | `1` | `700` | 1 | pol-stats.css:794 |
| `17px (--text-lg)` | `1.1` | `700` | 1 | pol-stats.css:909 |
| `clamp(1.5rem, 1.1rem + 1.6vw, 2.125rem)` | `var(--leading-tight)` | `650` | 1 | pol-studio.css:86 |
| `13px (--text-sm)` | `var(--leading-snug)` | `400` | 1 | pol-studio.css:290 |
| `0` | `—` | `—` | 1 | pol-studio.css:307 |
| `12px (--text-2xs)` | `var(--leading-body)` | `—` | 1 | pol-studio.css:886 |
| `13px (--text-sm)` | `—` | `500` | 1 | pol-studio.css:1078 |
| `11px` | `1.4` | `—` | 1 | pol-studio.css:1263 |
| `9px` | `—` | `700` | 1 | pol-studio.css:1341 |
| `10px` | `—` | `650` | 1 | pol-studio.css:1439 |
| `13px (--text-sm)` | `1` | `650` | 1 | pol-studio.css:1566 |
| `10px` | `16px` | `—` | 1 | pol-shell.css:649 |
| `10px` | `16px` | `700` | 1 | pol-shell.css:709 |
| `17px (--text-lg)` | `var(--leading-snug)` | `700` | 1 | pol-shell.css:922 |
| `10px` | `—` | `700` | 1 | pol-shell.css:1031 |
| `28px` | `var(--leading-tight)` | `700` | 1 | pol-shell.css:1054 |
| `11px` | `20px` | `700` | 1 | pol-shell.css:1241 |
| `11px (--text-xs)` | `20px` | `—` | 1 | pol-shell.css:1391 |
| `10.5px` | `—` | `—` | 1 | pol-thread.css:150 |
| `13px (--text-sm)` | `1` | `—` | 1 | pol-thread.css:409 |
| `24px (--text-2xl)` | `—` | `700` | 1 | pol-thread.css:514 |
| `17.6px` | `—` | `—` | 1 | pol-thread.css:622 |
| `12px (--text-2xs)` | `var(--leading-snug)` | `600` | 1 | pol-thread.css:815 |
| `17px (--text-lg)` | `var(--leading-tight)` | `650` | 1 | pol-thread.css:995 |
| `15px (--text-md)` | `20px` | `—` | 1 | pol-thread.css:1148 |
| `16px` | `20px` | `—` | 1 | pol-thread.css:1395 |
| `15px (--text-md)` | `1` | `—` | 1 | pol-thread.css:1494 |
| `9.6px` | `—` | `—` | 1 | pol-thread.css:1968 |
| `13px (--text-sm)` | `var(--leading-snug)` | `600` | 1 | pol-thread.css:2196 |
| `11px (--text-xs)` | `1.6` | `—` | 1 | pol-thread.css:2265 |
| `12px (--text-2xs)` | `16px` | `—` | 1 | pol-thread.css:2546 |
| `0.9em` | `—` | `—` | 1 | pol-public.css:39 |
| `17px (--text-lg)` | `—` | `600` | 1 | pol-public.css:312 |
| `clamp(2rem, 1.4rem + 2.6vw, 2.75rem)` | `1.08` | `750` | 1 | pol-public.css:385 |
| `clamp(2.5rem, 1.6rem + 3.4vw, 4rem)` | `1.02` | `750` | 1 | pol-public.css:515 |
| `clamp(1.0625rem, 0.95rem + 0.4vw, 1.25rem)` | `1.5` | `—` | 1 | pol-public.css:524 |
| `clamp(1.5rem, 1.2rem + 1vw, 2rem)` | `—` | `700` | 1 | pol-public.css:622 |
| `clamp(2.375rem, 9.6vw, 2.75rem)` | `—` | `—` | 1 | pol-public.css:779 |
| `clamp(1.5rem, 1.2rem + 1vw, 1.875rem)` | `—` | `700` | 1 | pol-public.css:910 |
| `16px` | `1.65` | `—` | 1 | pol-public.css:913 |
| `20px` | `1` | `400` | 1 | pol-public.css:956 |
| `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` | `—` | `700` | 1 | pol-public.css:993 |
| `24px` | `—` | `700` | 1 | pol-public.css:1357 |
| `clamp(1.875rem, 1.4rem + 1.8vw, 2.5rem)` | `—` | `—` | 1 | pol-public.css:1361 |
| `clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)` | `1.05` | `750` | 1 | pol-public.css:1443 |
| `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | `—` | `700` | 1 | pol-public.css:1462 |
| `clamp(1.75rem, 1.3rem + 2vw, 2.5rem)` | `—` | `750` | 1 | pol-public.css:1558 |
| `17px (--text-lg)` | `1.6` | `—` | 1 | pol-public.css:1590 |
| `12px (--text-2xs)` | `1.9` | `—` | 1 | pol-public.css:1609 |
| `clamp(100%, calc(62.5% + 0.35vw), 125%)` | `—` | `—` | 1 | pol-public.css:1692 |
| `38px` | `—` | `—` | 1 | pol-public.css:1796 |
| `clamp(2.5rem, 1rem + 3.6vw, 3rem)` | `—` | `—` | 1 | pol-public.css:1827 |
| `17px (--text-lg)` | `—` | `750` | 1 | calls-c11.css:138 |
| `20px (--text-xl)` | `—` | `750` | 1 | calls-c6.css:36 |
| `inherit` | `inherit` | `inherit` | 1 | calls-c4.css:27 |
| `12px (--text-2xs)` | `1.3` | `—` | 1 | gap-convo.css:15 |
| `13px (--text-sm)` | `1.25` | `—` | 1 | gap-convo.css:125 |
| `12px (--text-2xs)` | `1.35` | `—` | 1 | gap-convo.css:146 |
| `var(--text-xs, 12px)` | `—` | `—` | 1 | gap-account.css:11 |
| `var(--text-sm, 13px)` | `—` | `600` | 1 | gap-account.css:57 |
| `var(--text-2xs, 11px)` | `—` | `600` | 1 | gap-account.css:98 |
| `var(--text-xs, 12px)` | `1.5` | `—` | 1 | gap-account.css:129 |
| `var(--oc-fs-meta)` | `var(--leading-snug)` | `—` | 1 | gap-oper.css:109 |
| `var(--oc-fs-meta)` | `1.6` | `650` | 1 | gap-oper.css:328 |
| `var(--oc-fs)` | `var(--leading-snug)` | `650` | 1 | gap-oper.css:360 |
| `var(--oc-fs)` | `var(--leading-body)` | `—` | 1 | gap-oper.css:374 |
| `14px` | `var(--leading-snug)` | `—` | 1 | gap-oper.css:420 |
| `16px` | `var(--leading-snug)` | `—` | 1 | gap-oper.css:425 |
| `10.56px` | `—` | `—` | 1 | rx-shell.css:47 |
| `106.25%` | `—` | `—` | 1 | rx-shell.css:649 |
| `20px (--text-xl)` | `var(--leading-tight)` | `650` | 1 | gap-import.css:140 |
| `11px (--text-xs)` | `var(--leading-snug, 1.35)` | `—` | 1 | gap-people.css:52 |
| `11px` | `16px` | `700` | 1 | gap-organize.css:114 |
| `17px` | `1.72` | `—` | 1 | gap-organize.css:672 |
| `13px (--text-sm)` | `1.45` | `—` | 1 | gap-commands.css:95 |
| `11px (--text-xs)` | `1.45` | `—` | 1 | gap-commands.css:138 |
| `17px (--text-lg)` | `var(--leading-snug)` | `—` | 1 | gap-auth.css:58 |
| `0` | `0` | `—` | 1 | ui-sheets.css:262 |
| `15px (--text-md)` | `var(--leading-snug, 1.35)` | `—` | 1 | calls-engine.css:81 |
| `13px (--text-sm)` | `var(--leading-snug, 1.35)` | `—` | 1 | calls-engine.css:82 |
| `22px` | `—` | `—` | 1 | calls-engine.css:162 |
| `36px` | `—` | `—` | 1 | calls-engine.css:399 |
| `19px` | `—` | `—` | 1 | calls-engine.css:455 |
| `24px` | `1.2` | `—` | 1 | calls-engine.css:469 |

font-family declarations:

| value | where |
|---|---|
| `var(--font-mono)` | app.css:637,1710,2247,2814,2925,3189,3247,3535 · pol-studio.css:1123,1156,1198,1411,1581 · pol-shell.css:151,270 · pol-thread.css:723,1372,1866,2250,2308,2320 · pol-public.css:38,845,1025,1100,1197,1469,1505,1526,1535,1549,1609,1622 · calls-c8.css:115 · polish.css:130,179 · account2.css:34 · gap-oper.css:114 · gap-import.css:350,414,423 · gap-commands.css:87 · gap-watch.css:164,408,503 · gap-shell.css:143,171 · gap-auth.css:19 |
| `var(--font-mono, monospace)` | app.css:3074,3099 |
| `var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, san` | gap-appearance.css:115 |
| `var(--font-display, var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helveti` | gap-appearance.css:119 |
| `var(--font-serif, inherit)` | gap-appearance.css:124 |
| `inherit` | pol-thread.css:1374 · gap-account.css:97 |
| `ui-monospace, SFMono-Regular, Menlo, monospace` | roomsettings.css:168 |
| `var(--font-mono, ui-monospace, monospace)` | gap-account.css:90 |
| `var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)` | gap-people.css:176 |
| `"Iowan Old Style", "Charter", "Georgia", "Cambria", serif` | gap-organize.css:671 |

## G9. Spacing in use (padding / margin / gap / inset components)

Scale: `--space-0`=0px · `--space-1`=4px · `--space-2`=8px · `--space-3`=12px · `--space-4`=16px · `--space-5`=20px · `--space-6`=24px · `--space-7`=32px · `--space-8`=40px.

| component value | on the 4px scale? | count | where |
|---|---|---|---|
| `0` | raw, on scale | 1738 | (1738 sites — style-map.json spacing.distribution) |
| `8px (--space-2)` | token | 892 | (892 sites — style-map.json spacing.distribution) |
| `12px (--space-3)` | token | 636 | (636 sites — style-map.json spacing.distribution) |
| `4px (--space-1)` | token | 403 | (403 sites — style-map.json spacing.distribution) |
| `16px (--space-4)` | token | 322 | (322 sites — style-map.json spacing.distribution) |
| `2px` | **off scale** | 246 | (246 sites — style-map.json spacing.distribution) |
| `6px` | **off scale** | 145 | (145 sites — style-map.json spacing.distribution) |
| `8px` | raw, on scale | 140 | (140 sites — style-map.json spacing.distribution) |
| `20px (--space-5)` | token | 110 | (110 sites — style-map.json spacing.distribution) |
| `10px` | **off scale** | 100 | (100 sites — style-map.json spacing.distribution) |
| `4px` | raw, on scale | 85 | (85 sites — style-map.json spacing.distribution) |
| `auto` | raw, on scale | 68 | (68 sites — style-map.json spacing.distribution) |
| `24px (--space-6)` | token | 68 | (68 sites — style-map.json spacing.distribution) |
| `12px` | raw, on scale | 64 | (64 sites — style-map.json spacing.distribution) |
| `1px` | **off scale** | 34 | app.css:570,1846,2517,2820,3169 · pol-studio.css:354,558,656,711,968,1531,1589 · pol-shell.css:793,822,876,974,1224 · pol-thread.css:2239,2239,2469 · pol-roster.css:181 · pol-public.css:40,801 · polish.css:56 · gap-oper.css:316 · gap-import.css:137,264,299,359 · gap-usermodes.css:176,205,240,316 · gap-commands.css:62 |
| `32px (--space-7)` | token | 33 | (33 sites — style-map.json spacing.distribution) |
| `14px` | **off scale** | 27 | app.css:379,389,404,520,807,1123,1182,1979,2463,2708,2713,3019,3401,3401,3401,3415,3424,3428,3541 · pol-shell.css:1044 · pol-public.css:264,1399 · gap-watch.css:377,443,519 · ui-sheets.css:618,939 |
| `16px` | raw, on scale | 26 | app.css:160,671,752,877,908,1005,1046,1063,1204,1244,1264,1384,1398,1458,1480,1532,1586,1633,1654,3266,3461,3516,3516,3523,3524,3572 |
| `40px (--space-8)` | token | 25 | (25 sites — style-map.json spacing.distribution) |
| `3px` | **off scale** | 19 | app.css:512,596,676,736,2066,2241 · gap-appearance.css:173 · pol-studio.css:218,219,1308,1488 · pol-shell.css:1418 · pol-thread.css:1119,2159,2536 · pol-public.css:658 · gap-import.css:413 · calls-engine.css:228,294 |
| `var(--sheet-pad)` | token | 17 | (17 sites — style-map.json spacing.distribution) |
| `5px` | **off scale** | 14 | app.css:499,570,2820 · pol-studio.css:1405,1461 · pol-shell.css:840 · pol-thread.css:2546 · pol-public.css:40,156,853 · rx-shell.css:363,374 · gap-organize.css:112 · ui-sheets.css:505 |
| `-8px` | **off scale** | 12 | app.css:1773 · pol-thread.css:2227,2462,2464,2465,2476 · gap-oper.css:157,409 · gap-shell.css:355,355,355 · ui-sheets.css:659 |
| `-4px` | **off scale** | 12 | app.css:1773,2174,2213,3460 · pol-thread.css:2463,2502,2593 · pol-public.css:94 · gap-shell.css:288,288,288 · calls-engine.css:153 |
| `56px` | **off scale** | 12 | pol-public.css:336,358,682,770,820,822,904,905,1442,1454,1581,1773 |
| `calc(-1 * var(--space-2))` | **off scale** | 10 | app.css:1799,1994,2065 · pol-thread.css:1724,2144,2144 · pol-public.css:1213 · calls-c8.css:93 · gap-import.css:458 · ui-sheets.css:539 |
| `-6px` | **off scale** | 9 | app.css:2213,3373,3443 · pol-thread.css:2461,2602 · pol-public.css:159 · gap-oper.css:407 · gap-organize.css:477 · ui-sheets.css:260 |
| `-2px` | **off scale** | 9 | pol-thread.css:2160,2318,2461,2462,2474,2502,2593 · calls-engine.css:164,573 |
| `20px` | raw, on scale | 8 | app.css:349,876,884,3461,3544,3553,3572,3572 |
| `48px` | **off scale** | 7 | app.css:823 · pol-public.css:210,590,770,777,793,1784 |
| `36px` | **off scale** | 7 | app.css:1764,2165,3434 · pol-studio.css:1010 · pol-shell.css:1321 · gap-oper.css:144 · calls-engine.css:94 |
| `40px` | raw, on scale | 7 | app.css:1764 · pol-public.css:337,777,777,1805,1824 · ui-sheets.css:642 |
| `28px` | **off scale** | 6 | app.css:2165,3434,3434 · pol-shell.css:756 · gap-oper.css:61 · ui-sheets.css:867 |
| `64px` | **off scale** | 6 | pol-public.css:206,504,1336,1442,1762,1824 |
| `7px` | **off scale** | 5 | app.css:450,1182 · pol-shell.css:1391 · pol-thread.css:739 · gap-shell.css:167 |
| `72px` | **off scale** | 5 | app.css:2145 · pol-public.css:199,621,649,1824 |
| `calc(var(--pub-header-h, 64px) + var(--space-4))` | **off scale** | 5 | pol-public.css:907,996,1051,1052,1263 |
| `calc(-1 * var(--sheet-pad))` | **off scale** | 5 | ui-sheets.css:180,619,770,770,931 |
| `-1px` | **off scale** | 4 | app.css:172,2073 · pol-thread.css:1105 · pol-roster.css:261 |
| `18px` | **off scale** | 4 | app.css:789,1642,3077 · gap-oper.css:115 |
| `24px` | raw, on scale | 4 | app.css:823,899,3434,3434 |
| `32px` | raw, on scale | 4 | app.css:1764,2165,3570 · pol-public.css:1785 |
| `calc(-1 * var(--space-1))` | **off scale** | 4 | app.css:2071 · pol-thread.css:2144 · gap-watch.css:281,539 |
| `-18px` | **off scale** | 4 | pol-studio.css:1703 · ui-sheets.css:368,1009,1126 |
| `max(var(--space-4), env(safe-area-inset-right, 0px))` | **off scale** | 4 | ui-sheets.css:1155,1203,1230,1243 |
| `max(var(--space-5), env(safe-area-inset-right))` | **off scale** | 3 | app.css:1753,2173 · pol-studio.css:1829 |
| `max(var(--space-5), env(safe-area-inset-left))` | **off scale** | 3 | app.css:1753,2173 · pol-studio.css:1829 |
| `96px` | **off scale** | 3 | app.css:1980 · pol-public.css:505,1406 |
| `clamp(var(--space-7), 5vw, 4.5rem)` | **off scale** | 3 | pol-stats.css:49,232,402 |
| `clamp(var(--space-7), 6vw, 5rem)` | **off scale** | 3 | pol-stats.css:138,271,404 |
| `-12px` | **off scale** | 3 | pol-studio.css:439 · pol-thread.css:2465 · ui-sheets.css:1377 |
| `env(safe-area-inset-bottom, 0px)` | **off scale** | 3 | pol-shell.css:360 · gap-commands.css:51 · ui-sheets.css:1570 |
| `var(--pt-gutter)` | token | 3 | (3 sites — style-map.json spacing.distribution) |
| `calc(var(--space-4) + var(--safe-bottom))` | **off scale** | 3 | pol-thread.css:859 · pol-roster.css:349,367 |
| `-10px` | **off scale** | 3 | pol-thread.css:2227 · gap-organize.css:477 · ui-sheets.css:380 |
| `calc(var(--space-2) + var(--pt-compact-ts))` | **off scale** | 3 | pol-thread.css:2239,2280,2281 |
| `max(var(--pub-gutter), env(safe-area-inset-right))` | **off scale** | 3 | pol-public.css:87,194,1813 |
| `max(var(--pub-gutter), env(safe-area-inset-left))` | **off scale** | 3 | pol-public.css:87,194,1812 |
| `calc(var(--space-6) + env(safe-area-inset-bottom, 0px))` | **off scale** | 3 | calls-c6.css:233 · ui-sheets.css:864,905 |
| `var(--oc-gap)` | token | 3 | (3 sites — style-map.json spacing.distribution) |
| `env(safe-area-inset-right, 0px)` | **off scale** | 3 | ui-sheets.css:331,1209 · calls-engine.css:414 |
| `calc(var(--space-2) + env(safe-area-inset-bottom, 0px))` | **off scale** | 3 | ui-sheets.css:996 · calls-engine.css:253,445 |
| `max(var(--space-4), env(safe-area-inset-left, 0px))` | **off scale** | 3 | ui-sheets.css:1203,1230,1243 |
| `9px` | **off scale** | 2 | app.css:2042,3500 |
| `calc(max(var(--space-3), env(safe-area-inset-bottom)) + var(--kb-inset, 0px))` | **off scale** | 2 | app.css:2170,2198 |
| `var(--pad-panel)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `0.4em` | **off scale** | 2 | pol-stats.css:452 · gap-commands.css:26 |
| `calc(120px + var(--kb-inset, 0px))` | **off scale** | 2 | pol-stats.css:1056 · pol-studio.css:1782 |
| `env(safe-area-inset-top)` | **off scale** | 2 | pol-studio.css:48 · pol-public.css:74 |
| `clamp(16px, 5vw, 48px)` | **off scale** | 2 | pol-studio.css:48,81 |
| `44px` | **off scale** | 2 | pol-studio.css:1704 · pol-public.css:790 |
| `var(--safe-bottom, 0px)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `calc(var(--space-3) + var(--safe-bottom))` | **off scale** | 2 | pol-thread.css:366,1058 |
| `-3px` | **off scale** | 2 | pol-thread.css:2160 · calls-engine.css:50 |
| `max(var(--space-1), var(--safe-bottom))` | **off scale** | 2 | pol-thread.css:2366 · rx-shell.css:510 |
| `-9px` | **off scale** | 2 | pol-thread.css:2474 · ui-sheets.css:1390 |
| `var(--pub-gutter)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `1.15em` | **off scale** | 2 | pol-public.css:974,1244 |
| `calc(var(--space-2) * -1)` | **off scale** | 2 | gap-account.css:114,118 |
| `1.1em` | **off scale** | 2 | gap-account.css:128 · gap-shell.css:322 |
| `max(var(--space-4), var(--safe-bottom))` | **off scale** | 2 | rx-shell.css:380,382 |
| `max(var(--space-2), var(--safe-bottom))` | **off scale** | 2 | rx-shell.css:381,527 |
| `max(var(--space-3), env(safe-area-inset-right, 0px))` | **off scale** | 2 | gap-watch.css:614 · ui-sheets.css:1212 |
| `env(safe-area-inset-left, 0px)` | **off scale** | 2 | ui-sheets.css:331 · calls-engine.css:414 |
| `calc(var(--sheet-pad) + env(safe-area-inset-bottom, 0px))` | **off scale** | 2 | ui-sheets.css:342,1114 |
| `var(--sheet-grip-zone)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `env(safe-area-inset-top, 0px)` | **off scale** | 2 | ui-sheets.css:860 · calls-engine.css:414 |
| `var(--safe-top)` | token | 2 | (2 sites — style-map.json spacing.distribution) |
| `-8.8px` | **off scale** | 1 | app.css:208 |
| `22px` | **off scale** | 1 | app.css:900 |
| `1.92px` | **off scale** | 1 | app.css:1705 |
| `7.2px` | **off scale** | 1 | app.css:1705 |
| `max(var(--space-8), env(safe-area-inset-top))` | **off scale** | 1 | app.css:1753 |
| `max(var(--space-6), env(safe-area-inset-bottom))` | **off scale** | 1 | app.css:1753 |
| `168px` | **off scale** | 1 | app.css:1980 |
| `max(var(--space-3), env(safe-area-inset-top))` | **off scale** | 1 | app.css:2170 |
| `calc(168px + var(--kb-inset, 0px))` | **off scale** | 1 | app.css:2171 |
| `max(var(--space-4), env(safe-area-inset-top))` | **off scale** | 1 | app.css:2197 |
| `calc(72px + var(--kb-inset, 0px))` | **off scale** | 1 | app.css:2220 |
| `12vh` | **off scale** | 1 | app.css:2830 |
| `calc(10px + env(safe-area-inset-bottom, 0px))` | **off scale** | 1 | app.css:3574 |
| `calc(var(--space-1) + env(safe-area-inset-bottom, 0px))` | **off scale** | 1 | app.css:4061 |
| `calc(var(--mobile-nav-h) + var(--composer-h))` | **off scale** | 1 | app.css:4075 |
| `clamp(16px, 4vw, 48px)` | **off scale** | 1 | pol-stats.css:40 |
| `clamp(var(--space-4), 4vw, 4rem)` | **off scale** | 1 | pol-stats.css:328 |
| `clamp(var(--space-6), 4vw, 4rem)` | **off scale** | 1 | pol-stats.css:632 |
| `clamp(2px, 0.6vw, 8px)` | **off scale** | 1 | pol-stats.css:708 |
| `clamp(1px, 0.3vw, 4px)` | **off scale** | 1 | pol-stats.css:802 |
| `clamp(28px, 6vw, 72px)` | **off scale** | 1 | pol-studio.css:81 |
| `14vh` | **off scale** | 1 | pol-studio.css:81 |
| `clamp(28px, 4vw, 44px)` | **off scale** | 1 | pol-studio.css:124 |
| `clamp(32px, 5vw, 56px)` | **off scale** | 1 | pol-studio.css:408 |
| `calc(var(--space-4) + 32px)` | **off scale** | 1 | pol-studio.css:421 |
| `-14px` | **off scale** | 1 | pol-studio.css:1021 |
| `18vh` | **off scale** | 1 | pol-studio.css:1677 |
| `clamp(40px, 4vw, 72px)` | **off scale** | 1 | pol-studio.css:1802 |
| `max(var(--space-4), env(safe-area-inset-left))` | **off scale** | 1 | pol-studio.css:1828 |
| `max(var(--space-4), env(safe-area-inset-right))` | **off scale** | 1 | pol-studio.css:1828 |
| `calc(var(--sheet-pad, 16px) + 36px)` | **off scale** | 1 | pol-shell.css:1044 |
| `calc(var(--space-3) + var(--safe-bottom, 0px))` | **off scale** | 1 | pol-shell.css:1292 |
| `calc(var(--space-3) + var(--target-min) + var(--space-2) + var(--safe-top))` | **off scale** | 1 | pol-thread.css:859 |
| `calc(var(--space-4) + var(--safe-right))` | **off scale** | 1 | pol-thread.css:859 |
| `calc(var(--space-4) + var(--safe-left))` | **off scale** | 1 | pol-thread.css:859 |
| `0.35em` | **off scale** | 1 | pol-thread.css:1885 |
| `max(var(--space-4), calc((100% - var(--pt-measure)) / 2))` | **off scale** | 1 | pol-thread.css:2067 |
| `100%` | **off scale** | 1 | pol-thread.css:2114 |
| `calc(var(--space-3) * -1)` | **off scale** | 1 | pol-thread.css:2577 |
| `max(var(--space-3), var(--safe-top))` | **off scale** | 1 | pol-roster.css:349 |
| `max(var(--pub-gutter), calc((100% - var(--pub-measure)) / 2 + var(--pub-gutter)))` | **off scale** | 1 | pol-public.css:174 |
| `calc(48px + env(safe-area-inset-bottom))` | **off scale** | 1 | pol-public.css:210 |
| `calc(var(--space-8) + env(safe-area-inset-bottom))` | **off scale** | 1 | pol-public.css:283 |
| `88px` | **off scale** | 1 | pol-public.css:505 |
| `1.4em` | **off scale** | 1 | pol-public.css:1180 |
| `calc(-1 * var(--pub-gutter, 20px))` | **off scale** | 1 | pol-public.css:1303 |
| `var(--pub-gutter, 20px)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `140px` | **off scale** | 1 | pol-public.css:1406 |
| `calc(var(--pub-header-h, 64px) + var(--space-2))` | **off scale** | 1 | pol-public.css:1456 |
| `calc(140px + var(--kb-inset, 0px))` | **off scale** | 1 | pol-public.css:1667 |
| `calc(32px + env(safe-area-inset-bottom))` | **off scale** | 1 | pol-public.css:1785 |
| `calc(var(--pub-header-h) + env(safe-area-inset-top) + var(--space-4))` | **off scale** | 1 | pol-public.css:1818 |
| `var(--gap-section)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `194px` | **off scale** | 1 | calls-c6.css:191 |
| `calc(-1 * var(--sheet-pad, 20px))` | **off scale** | 1 | gap-oper.css:48 |
| `calc(var(--sheet-pad, 20px) + 44px)` | **off scale** | 1 | gap-oper.css:49 |
| `var(--sheet-pad, 20px)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `-4.8px` | **off scale** | 1 | rx-shell.css:46 |
| `50px` | **off scale** | 1 | rx-shell.css:131 |
| `calc(var(--space-3) * 2 + 18px)` | **off scale** | 1 | rx-shell.css:206 |
| `46px` | **off scale** | 1 | rx-shell.css:542 |
| `calc(var(--nav-rail-w) + var(--safe-left) + var(--space-2))` | **off scale** | 1 | rx-shell.css:542 |
| `max(var(--space-4), calc((100% - var(--convo-measure)) / 2))` | **off scale** | 1 | rx-shell.css:612 |
| `calc((100vw - var(--app-max)) / 2)` | **off scale** | 1 | rx-shell.css:642 |
| `calc((100vw - var(--app-max)) / 2 + var(--space-4))` | **off scale** | 1 | rx-shell.css:643 |
| `calc(var(--space-3) + 28px)` | **off scale** | 1 | gap-chanserv.css:160 |
| `calc(32px + var(--space-3) + var(--space-2))` | **off scale** | 1 | gap-chanserv.css:216 |
| `calc(var(--space-3) + 40px)` | **off scale** | 1 | gap-chanserv.css:253 |
| `calc(var(--sheet-pad) + 56px)` | **off scale** | 1 | gap-people.css:147 |
| `var(--gorg-gutter)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `calc(var(--gorg-gutter) + 112px)` | **off scale** | 1 | gap-organize.css:653 |
| `calc(var(--space-4) + 40px)` | **off scale** | 1 | gap-organize.css:737 |
| `var(--sheet-grip-zone, 22px)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `calc(var(--space-3) + 64px)` | **off scale** | 1 | gap-organize.css:753 |
| `max(var(--space-3), env(safe-area-inset-left, 0px))` | **off scale** | 1 | gap-watch.css:614 |
| `var(--sheet-pad, 16px)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `calc(var(--space-4) + env(safe-area-inset-bottom, 0px))` | **off scale** | 1 | gap-shell.css:377 |
| `calc(14px + 0.32em)` | **off scale** | 1 | gap-auth.css:33 |
| `calc(-1 * var(--space-3))` | **off scale** | 1 | gap-auth.css:78 |
| `52px` | **off scale** | 1 | ui-sheets.css:150 |
| `var(--sheet-head-pad)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `calc(var(--sheet-grip-zone) + 2px)` | **off scale** | 1 | ui-sheets.css:375 |
| `min(14vh, 120px)` | **off scale** | 1 | ui-sheets.css:434 |
| `84px` | **off scale** | 1 | ui-sheets.css:726 |
| `136px` | **off scale** | 1 | ui-sheets.css:940 |
| `calc(var(--sheet-pad) + max(0px, env(safe-area-inset-bottom, 0px) - var(--kb-inset, 0px)))` | **off scale** | 1 | ui-sheets.css:1075 |
| `calc(var(--sheet-grip-zone) + 6px)` | **off scale** | 1 | ui-sheets.css:1114 |
| `max(var(--space-6), env(safe-area-inset-top, 0px))` | **off scale** | 1 | ui-sheets.css:1146 |
| `max(var(--space-5), env(safe-area-inset-right, 0px))` | **off scale** | 1 | ui-sheets.css:1146 |
| `max(var(--space-5), env(safe-area-inset-left, 0px))` | **off scale** | 1 | ui-sheets.css:1146 |
| `60px` | **off scale** | 1 | ui-sheets.css:1155 |
| `min(10vh, 96px)` | **off scale** | 1 | ui-sheets.css:1165 |
| `calc(var(--sheet-close) + 4px)` | **off scale** | 1 | ui-sheets.css:1479 |
| `var(--safe-left)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `var(--safe-right)` | token | 1 | (1 sites — style-map.json spacing.distribution) |
| `max(8px, calc(var(--safe-bottom) + 4px))` | **off scale** | 1 | pol-ios.css:92 |
| `max(var(--space-3), var(--safe-bottom))` | **off scale** | 1 | pol-ios.css:100 |
| `-7px` | **off scale** | 1 | calls-engine.css:50 |
| `max(var(--space-2), env(safe-area-inset-right, 0px))` | **off scale** | 1 | calls-engine.css:253 |
| `max(var(--space-2), env(safe-area-inset-left, 0px))` | **off scale** | 1 | calls-engine.css:253 |
| `-5px` | **off scale** | 1 | calls-engine.css:573 |

## G10. Radius values in use

| value | count | where |
|---|---|---|
| `var(--radius)` | 382 | (382 sites — style-map.json radius) |
| `6px` | 69 | app.css:165,178,348,372,388,403,446,687,699,767,784,803,872,893,951,985,1025,1035,1073,1119,1135,1153,1167,1177,1218,1229,1256,1313,1329,1363,1370,1404,1415,1427,1438,1454,1465,1476,1487,1500,1517,1543,1553,1571,1613,1667,1680,1693,2252,3385,3394,3402,3411,3416,3425,3479,3490,3494,3501,3512,3521,3524,3534,3549 · polish.css:46,190,255,297,343 |
| `50%` | 52 | app.css:134,207,281,305,842,1594,1608,1900,2055,2511,2742,3283,3360,3365,3439,3443,3454 · pol-stats.css:176,448,564,890 · pol-studio.css:229,319,1245,1333,1509 · pol-shell.css:440,855,1037,1046 · pol-thread.css:510,616,1281 · pol-public.css:576,1044 · account2.css:151 · roomsettings.css:102,268 · gap-convo.css:28,278 · gap-chanserv.css:237 · gap-organize.css:235,469,581 · gap-commands.css:155 · gap-shell.css:105,146,177 · ui-sheets.css:549,553,1391 · calls-engine.css:88 |
| `var(--r-pill)` | 39 | (39 sites — style-map.json radius) |
| `0` | 32 | app.css:2150,2173,2209,3304,3948 · pol-stats.css:332 · pol-studio.css:265 · pol-shell.css:1076,1095,1348 · pol-thread.css:1022,1145,2129 · pol-public.css:127,310,1327 · calls-c6.css:235 · calls-c4.css:64,67 · gap-convo.css:122 · gap-watch.css:58,59 · gap-shell.css:158 · ui-sheets.css:141,646,750,859,1451,1562 · calls-engine.css:186,411,444 |
| `4px` | 26 | app.css:2248,2819 · pol-stats.css:675 · pol-studio.css:910,1083,1151,1152,1313,1381,1442,1466 · pol-thread.css:240,295,913,1172,1254,1369,1387,1760,2263 · pol-public.css:41 · polish.css:62,134 · gap-chanserv.css:136 · ui-sheets.css:510,533 |
| `999px` | 23 | app.css:179,190,192,199,202,211,273,324,338,3282 · roomsettings.css:258 · gap-account.css:102 · gap-oper.css:277,331,354,379 · gap-usermodes.css:178,247 · gap-commands.css:145 · ui-sheets.css:897,939,1326,1379 |
| `2px` | 16 | app.css:2067,3582 · pol-stats.css:830 · pol-shell.css:585,821,1305,1380 · pol-thread.css:975 · polish.css:217,226 · gap-import.css:99 · gap-claim.css:154 · ui-sheets.css:369,1010,1127 · calls-engine.css:260 |
| `10px` | 12 | app.css:1004,1045,1202,1243,1382,1762,2163 · pol-studio.css:246 · pol-public.css:293,554,1354,1390 |
| `8px` | 11 | app.css:183,935,972,1064,1069,1091,1528,1582,1629,1650,1811 |
| `3px` | 7 | app.css:251,575,2241,2260 · pol-thread.css:2161 · pol-public.css:1203 · gap-convo.css:281 |
| `12px 12px 0 0` | 7 | pol-thread.css:368,1409 · pol-roster.css:370 · polish.css:367 · ui-sheets.css:341,998,1116 |
| `var(--radius) var(--radius) 0 0` | 4 | app.css:4093 · gap-oper.css:81 · ui-sheets.css:649 · calls-engine.css:254 |
| `calc(var(--radius) * 1.5)` | 4 | pol-shell.css:1325 · rx-shell.css:162,292 · gap-organize.css:233 |
| `2px 2px 0 0` | 3 | pol-stats.css:717,811 · roomsettings.css:342 |
| `1px` | 3 | pol-public.css:168,862 · gap-watch.css:182 |
| `0 0 var(--radius) var(--radius)` | 3 | gap-watch.css:225 · gap-shell.css:233 · ui-sheets.css:650 |
| `0 3px 3px 0` | 2 | pol-shell.css:694,814 |
| `calc(var(--radius) * 2)` | 2 | pol-shell.css:1377 · rx-shell.css:326 |
| `0 var(--radius) var(--radius) 0` | 2 | pol-thread.css:177,2242 |
| `var(--radius, 6px)` | 2 | gap-account.css:25,72 |
| `calc(var(--radius) - 2px)` | 2 | gap-shell.css:72,137 |
| `13px` | 1 | app.css:2044 |
| `0 0 6px 6px` | 1 | app.css:3469 |
| `6px 6px 0 0` | 1 | app.css:3580 |
| `inherit` | 1 | pol-stats.css:911 |
| `calc(var(--radius) * 2) calc(var(--radius) * 2) 0 0` | 1 | pol-shell.css:1294 |
| `0 0 4px 4px` | 1 | pol-thread.css:312 |
| `calc(var(--radius) + 3px)` | 1 | pol-public.css:660 |

## G11. Elevation / shadows (every declaration)

| file:line | selector | property | value |
|---|---|---|---|
| app.css:87 | `:root` | --elev-0 | `none` |
| app.css:88 | `:root` | --elev-1 | `0 1px 0 color-mix(in oklab, var(--onyx-text) 5%, transparent) inset` |
| app.css:89 | `:root` | --elev-2 | `0 14px 36px -28px color-mix(in oklab, var(--onyx-bg) 88%, transparent)` |
| app.css:90 | `:root` | --elev-3 | `0 28px 56px -32px color-mix(in oklab, #000 90%, transparent), 0 1px 0 color-mix(in oklab, var(--onyx-text) 6%, transpare` |
| app.css:142 | `.onyx-avatar--owner` | box-shadow | `0 0 0 2px var(--gold)` |
| app.css:147 | `.onyx-row-avatar .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| app.css:209 | `.onyx-facepile-face .onyx-avatar` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| app.css:1763 | `.conn-stage` | box-shadow | `var(--elev-2)` |
| app.css:1878 | `.conn-identity[data-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| app.css:2100 | `.conn-submit--quiet, .conn-submit--quiet:hover:not(:disabled)` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| app.css:2151 | `.conn-stage` | box-shadow | `none` |
| app.css:2164 | `.conn-card` | box-shadow | `var(--elev-2)` |
| app.css:2173 | `.conn-stage` | box-shadow | `none` |
| app.css:2210 | `.conn-stage` | box-shadow | `none` |
| app.css:2749 | `.onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 2px var(--onyx-faint)` |
| app.css:2846 | `.onyx-spotlight-panel, .onyx-shortcuts-sheet` | box-shadow | `0 12px 32px rgb(0 8 16 / 45%)` |
| app.css:3061 | `.onyx-moddesk-sheet` | box-shadow | `-8px 0 24px rgb(0 0 0 / 35%)` |
| app.css:3253 | `.onyx-prefs` | box-shadow | `0 8px 24px rgba(0, 0, 0, 0.35)` |
| app.css:3263 | `.pref-category-tab[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| app.css:3513 | `.onyx-call-sheet` | box-shadow | `0 12px 32px rgba(0, 0, 0, 0.35)` |
| app.css:3789 | `.notif-center` | box-shadow | `var(--elev-2)` |
| app.css:3871 | `.onyx-room-more-menu` | box-shadow | `var(--elev-2)` |
| app.css:3940 | `.onyx-sheet-layer > .onyx-sheet` | box-shadow | `var(--elev-3)` |
| pol-stats.css:321 | `.roadmap-legend a[aria-current='location']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-stats.css:340 | `.roadmap-card:is(:target, [data-current='true'])` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-stats.css:956 | `.stats-page .data-room-row[data-selected='true']` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-studio.css:230 | `.ap-swatch > span, .ap-theme-swatch > span` | box-shadow | `inset 0 0 0 1px color-mix(in oklab, #000 25%, transparent)` |
| pol-studio.css:321 | `.ap-choice-toggle > b::after` | box-shadow | `0 1px 3px color-mix(in oklab, #000 40%, transparent)` |
| pol-studio.css:538 | `.background-picker__card--selected` | box-shadow | `inset 0 0 0 1px var(--onyx-text)` |
| pol-shell.css:432 | `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` | box-shadow | `var(--elev-3)` |
| pol-shell.css:654 | `.onyx-topbar .shell-ribbon-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:716 | `.onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-shell.css:1295 | `.onyx-frame .onyx-room-more-menu` | box-shadow | `var(--elev-3)` |
| pol-shell.css:1380 | `.onyx-rail .onyx-rail-color` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| pol-shell.css:1434 | `.onyx-mobile-nav .onyx-nav-badge` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| pol-thread.css:174 | `.onyx-mention` | box-shadow | `inset 2px 0 0 var(--gold)` |
| pol-thread.css:185 | `.onyx-message-search-current, .onyx-message-search-current:hover` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:215 | `.onyx-row-actions` | box-shadow | `var(--elev-2)` |
| pol-thread.css:283 | `.onyx-msg-menu-pop .onyx-msg-menu, .onyx-react-pop .onyx-react-picker` | box-shadow | `var(--elev-3)` |
| pol-thread.css:592 | `.onyx-frame .onyx-jump-latest` | box-shadow | `var(--elev-3)` |
| pol-thread.css:1032 | `.onyx-thread-msg-face .onyx-avatar` | box-shadow | `0 0 0 1px var(--nick-tint)` |
| pol-thread.css:1357 | `.onyx-composer .shell-command-menu, .onyx-composer .shell-emoji-picker` | box-shadow | `var(--elev-3)` |
| pol-thread.css:1371 | `.onyx-composer .shell-command-item--active` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-thread.css:1768 | `.room-media-index-filter[aria-selected='true']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-thread.css:2130 | `.onyx-sheet-layer.onyx-thread-pop > .onyx-sheet.onyx-thread-sheet` | box-shadow | `none` |
| pol-thread.css:2277 | `.onyx-message--compact.onyx-mention, .onyx-message--compact.onyx-messa` | box-shadow | `inset 2px 0 0 var(--gold)` |
| pol-thread.css:2278 | `.onyx-message--compact.onyx-message-search-current` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-roster.css:243 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px var(--onyx-faint)` |
| pol-roster.css:352 | `.onyx-frame > .onyx-roster:popover-open, .onyx-roster:popover-open` | box-shadow | `var(--elev-3)` |
| pol-roster.css:427 | `.onyx-roster .onyx-roster-head` | box-shadow | `0 calc(-1 * var(--space-3)) 0 var(--onyx-panel)` |
| pol-roster.css:438 | `.onyx-roster .onyx-roster-filter` | box-shadow | `0 0 0 var(--space-1) var(--onyx-panel), 0 var(--space-2) 0 var(--space-1) var(--onyx-panel)` |
| pol-roster.css:440 | `.onyx-roster .onyx-roster-filter:not(.onyx-roster-filter--open):not(:f` | box-shadow | `none` |
| pol-roster.css:473 | `.onyx-roster .onyx-member-presence-dot--away` | box-shadow | `inset 0 0 0 1.5px CanvasText` |
| pol-public.css:127 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-public.css:333 | `.public-frame__nav a[aria-current="page"]` | box-shadow | `inset 3px 0 0 var(--onyx-accent)` |
| pol-public.css:556 | `.onyx-land-sketch-window` | box-shadow | `var(--elev-2)` |
| pol-public.css:678 | `.onyx-land-tabs button[aria-selected="true"]` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| pol-public.css:836 | `.ab-scene` | box-shadow | `var(--elev-2)` |
| pol-public.css:1328 | `.guides-route__item[data-state="current"] .guides-route__card` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1500 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| pol-public.css:1571 | `.onyxos-console__tabs button[aria-selected="true"]` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| pol-public.css:1708 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-o` | box-shadow | `inset 0 0 0 1px var(--onyx-line)` |
| pol-public.css:1712 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-o` | box-shadow | `inset 0 0 0 1px var(--onyx-dim)` |
| pol-public.css:1753 | `.public-related__list a[aria-current="page"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| polish.css:47 | `.shell-composer-tools` | box-shadow | `var(--elev-3)` |
| polish.css:344 | `.update-available` | box-shadow | `0 8px 24px rgb(0 0 0 / 0.35)` |
| polish.css:383 | `.update-available` | box-shadow | `none` |
| account2.css:157 | `.a2-dot--avatar` | box-shadow | `0 0 0 2px var(--onyx-panel)` |
| calls-c6.css:104 | `.onyx-call-pip-card` | box-shadow | `var(--elev-3)` |
| gap-convo.css:136 | `.onyx-composer .gap-attach-quality-opt[aria-checked='true']` | box-shadow | `inset 0 -2px 0 var(--onyx-accent)` |
| gap-convo.css:251 | `.onyx-message.gap-landed` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| gap-oper.css:410 | `.oc-tabs` | box-shadow | `0 calc(-1 * var(--sheet-grip-zone)) 0 0 var(--onyx-panel)` |
| rx-shell.css:47 | `.onyx-facepile-face .onyx-avatar` | box-shadow | `0 0 0 2px var(--onyx-bg)` |
| gap-import.css:245 | `.hi-review-foot` | box-shadow | `0 28px 0 0 var(--onyx-panel), 0 56px 0 0 var(--onyx-panel), 0 84px 0 0 var(--onyx-panel)` |
| gap-watch.css:227 | `.onyx-watch-details` | box-shadow | `var(--elev-2)` |
| gap-shell.css:232 | `.onyx-frame .onyx-room-more-menu > button.gs-more-leave` | box-shadow | `0 -1px 0 var(--onyx-line)` |
| ui-sheets.css:91 | `.onyx-sheet-layer > .onyx-sheet` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:441 | `.onyx-spotlight-panel` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:477 | `.onyx-spotlight-option[aria-selected="true"]` | box-shadow | `inset 2px 0 0 var(--onyx-accent)` |
| ui-sheets.css:537 | `.notif-center .notif-center__filter[aria-pressed="true"]` | box-shadow | `none` |
| ui-sheets.css:810 | `.onyx-toast` | box-shadow | `var(--elev-3)` |
| ui-sheets.css:813 | `.onyx-toast--success` | box-shadow | `inset 3px 0 0 var(--onyx-success), var(--elev-3)` |
| ui-sheets.css:814 | `.onyx-toast--danger` | box-shadow | `inset 3px 0 0 var(--onyx-bad), var(--elev-3)` |
| ui-sheets.css:815 | `.onyx-toast--warning` | box-shadow | `inset 3px 0 0 var(--onyx-warn), var(--elev-3)` |
| ui-sheets.css:899 | `.onyx-prefs .pref-category-tab[aria-selected="true"]` | box-shadow | `none` |
| ui-sheets.css:999 | `.onyx-room-more-menu` | box-shadow | `var(--elev-3)` |
| pol-ios.css:86 | `.onyx-frame` | box-shadow | `inset 0 var(--safe-top) 0 0 var(--onyx-panel)` |
| calls-engine.css:66 | `.onyx-thread-pane > .onyx-call-stage, .onyx-thread-pane > .onyx-join-b` | box-shadow | `calc(-1 * var(--shell-measure)) 0 0 0 var(--onyx-bg), var(--shell-measure) 0 0 0 var(--onyx-bg), calc(-2 * var(--shell-m` |
| calls-engine.css:155 | `.onyx-call-head-faces .onyx-call-avatar[data-speaking="true"]` | box-shadow | `0 0 0 1px var(--onyx-accent)` |
| calls-engine.css:255 | `.onyx-call-more` | box-shadow | `var(--elev-3)` |

## G12. !important (every use)

| file:line | selector | declaration | context |
|---|---|---|---|
| app.css:3317 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `animation-duration: 0.001ms` |  |
| app.css:3318 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `animation-iteration-count: 1` |  |
| app.css:3319 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `transition-duration: 0.001ms` |  |
| app.css:3320 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `scroll-behavior: auto` |  |
| app.css:3327 | `:root[data-reduce-transparency='true'] *` | `backdrop-filter: none` |  |
| app.css:4111 | `*, *::before, *::after` | `animation: none` | @media (prefers-reduced-motion: reduce) |
| app.css:4112 | `*, *::before, *::after` | `transition-duration: 0ms` | @media (prefers-reduced-motion: reduce) |
| app.css:4113 | `*, *::before, *::after` | `scroll-behavior: auto` | @media (prefers-reduced-motion: reduce) |
| app.css:4126 | `:root[data-reduce-motion='true'] *, :root[data-reduce-motion='true'] *::before, ` | `animation: none` |  |
| pol-stats.css:1062 | `:is(.stats-page, .status-route, .roadmap-page) *` | `transition: none` | @media (prefers-reduced-motion: reduce) |
| pol-ios.css:126 | `.onyx-sheet-layer:has(> [data-shortcut-scope="a2hs"]), [data-shortcut-scope="a2h` | `display: none` | @media (display-mode: standalone) |

## G13. Same selector declared more than once in the same context

410 selectors are declared in more than one rule; 186 across files. Property conflicts: 295. Declarations shadowed by a later identical selector: 424 (124 merely restate the winning value).

### G13.0 Rules fully overridden by a later identical selector (53 rules, 114 declarations — deletable without visual change)

| file:line | selector | decls | context |
|---|---|---|---|
| app.css:181 | `.shell-topic-actions` | 2 |  |
| app.css:183 | `.shell-topic-card` | 2 |  |
| app.css:208 | `.onyx-facepile-face + .onyx-facepile-face` | 1 |  |
| app.css:209 | `.onyx-facepile-face .onyx-avatar` | 1 |  |
| app.css:288 | `.onyx-conn-live` | 1 |  |
| app.css:289 | `.onyx-conn-live .onyx-dot` | 1 |  |
| app.css:329 | `.onyx-reconnect-online` | 1 |  |
| app.css:330 | `.onyx-reconnect-online .onyx-reconnect-dot` | 1 |  |
| app.css:514 | `.onyx-rail .onyx-rail-filter-unread-on` | 2 |  |
| app.css:598 | `.onyx-rail .onyx-rail-star-on` | 1 |  |
| app.css:810 | `.onyx-calls-toggle-open` | 2 |  |
| app.css:967 | `.guest-claim-chip` | 7 |  |
| app.css:2270 | `.onyx-notify-toggle-open` | 2 |  |
| app.css:2367 | `.onyx-nav-btn--active .onyx-nav-icon` | 1 |  |
| app.css:2378 | `.onyx-nav-icon[data-icon="rooms"]` | 1 |  |
| app.css:2413 | `.onyx-you-close` | 6 |  |
| app.css:2611 | `.onyx-composer .shell-command-item--active` | 1 |  |
| app.css:2671 | `.boost-pill.you` | 1 |  |
| app.css:2736 | `.onyx-roster .onyx-member` | 3 |  |
| app.css:2737 | `.onyx-roster .onyx-member.onyx-away` | 1 |  |
| app.css:2877 | `.onyx-spotlight-close, .onyx-shortcuts-close` | 9 |  |
| app.css:2891 | `.onyx-dmsafe-trigger[aria-expanded="true"]` | 1 |  |
| app.css:2967 | `.onyx-spotlight-group + .onyx-spotlight-group` | 1 |  |
| app.css:3056 | `.onyx-moddesk-toggle[aria-pressed="true"]` | 1 |  |
| app.css:3168 | `.onyx-transcript--compact .onyx-thread` | 1 |  |
| app.css:3371 | `.onyx-call-avatar-lg` | 3 |  |
| app.css:3406 | `.onyx-join-banner-copy` | 2 |  |
| app.css:3475 | `.onyx-call-bar-center` | 4 |  |
| app.css:3487 | `.onyx-call-more-wrap` | 1 |  |
| app.css:3488 | `.onyx-call-more` | 10 |  |
| app.css:3553 | `.onyx-main-calls .onyx-call-stage` | 1 |  |
| app.css:3564 | `.onyx-join-banner` | 3 | @media (max-width: 640px) |
| app.css:3565 | `.onyx-join-banner-copy` | 1 | @media (max-width: 640px) |
| app.css:3571 | `.onyx-call-stage` | 1 | @media (max-width: 640px) |
| app.css:3572 | `.onyx-call-people` | 2 | @media (max-width: 640px) |
| app.css:3573 | `.onyx-call-person` | 1 | @media (max-width: 640px) |
| app.css:3574 | `.onyx-call-bar` | 1 | @media (max-width: 640px) |
| app.css:3575 | `.onyx-call-bar-center` | 1 | @media (max-width: 640px) |
| app.css:3577 | `.onyx-cbtn-cap` | 6 | @media (max-width: 640px) |
| app.css:3578 | `.onyx-cbtn-leave` | 1 | @media (max-width: 640px) |
| app.css:3944 | `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` | 5 |  |
| app.css:4021 | `.onyx-rail .onyx-rail-star-on` | 1 |  |
| pol-shell.css:304 | `.chb .chb-sort-btn[aria-pressed="true"]` | 2 |  |
| pol-thread.css:495 | `.onyx-transcript--compact .onyx-system` | 1 |  |
| pol-thread.css:582 | `.onyx-transcript--compact ~ .onyx-typing` | 1 |  |
| calls-c8.css:118 | `.onyx-vs-btn` | 1 |  |
| calls-c6.css:210 | `.onyx-call-pip-body` | 2 | @media (max-width: 767px) |
| calls-c6.css:211 | `.onyx-call-pip-faces` | 1 | @media (max-width: 767px) |
| calls-c6.css:212 | `.onyx-call-pip-btn` | 3 | @media (max-width: 767px) |
| calls-c4.css:72 | `.onyx-call-grid[data-columns="1"]` | 3 |  |
| calls-c4.css:137 | `.onyx-call-primary > .onyx-tile` | 3 |  |
| calls-c4.css:152 | `.onyx-call-grid[data-columns="2"], .onyx-call-grid[data-columns="3"], .onyx-call-grid[data` | 1 | @media (max-width: 767px) |
| calls-c4.css:155 | `.onyx-call-grid > .onyx-tile` | 1 | @media (max-width: 767px) |

### G13.1 Cross-file duplicates with conflicting values

| selector | context | property | values in cascade order | winner |
|---|---|---|---|---|
| `:root` |  | --onyx-bg | app.css:5 `#0b0e12`<br>gap-appearance.css:23 `var(--onyx-theme-bg, #0b0e12)` | gap-appearance.css:23 |
| `:root` |  | --onyx-panel | app.css:6 `#12161c`<br>gap-appearance.css:24 `var(--onyx-theme-panel, #12161c)` | gap-appearance.css:24 |
| `:root` |  | --onyx-panel-2 | app.css:7 `#181e27`<br>gap-appearance.css:25 `var(--onyx-theme-panel-2, #181e27)` | gap-appearance.css:25 |
| `:root` |  | --onyx-line | app.css:8 `#232b36`<br>gap-appearance.css:26 `var(--onyx-theme-line, #232b36)` | gap-appearance.css:26 |
| `:root` |  | --onyx-text | app.css:9 `#e8e6e1`<br>gap-appearance.css:27 `var(--onyx-theme-text, #e8e6e1)` | gap-appearance.css:27 |
| `:root` |  | --onyx-dim | app.css:10 `#9aa3ad`<br>gap-appearance.css:28 `var(--onyx-theme-dim, #9aa3ad)` | gap-appearance.css:28 |
| `:root` |  | --onyx-faint | app.css:11 `#606973`<br>gap-appearance.css:29 `var(--onyx-theme-faint, #606973)` | gap-appearance.css:29 |
| `:root` |  | --onyx-accent | app.css:12 `#46c08a`<br>gap-appearance.css:30 `var(--onyx-theme-accent, #46c08a)` | gap-appearance.css:30 |
| `:root` |  | --onyx-accent-ink | app.css:13 `#06281a`<br>gap-appearance.css:31 `var(--onyx-theme-accent-ink, #06281a)` | gap-appearance.css:31 |
| `:root` |  | --onyx-warn | app.css:14 `#d9a13b`<br>gap-appearance.css:32 `var(--onyx-theme-warn, #d9a13b)` | gap-appearance.css:32 |
| `:root` |  | --onyx-bad | app.css:15 `#e5484d`<br>gap-appearance.css:33 `var(--onyx-theme-bad, #e5484d)` | gap-appearance.css:33 |
| `:root` |  | --focus-ring | app.css:71 `1px solid var(--onyx-accent)`<br>gap-appearance.css:81 `var(--focus-width) solid var(--onyx-focus)` | gap-appearance.css:81 |
| `:root` |  | --focus-offset | app.css:72 `-1px`<br>gap-appearance.css:82 `calc(-1 * var(--focus-width))` | gap-appearance.css:82 |
| `:root` |  | --dur-micro | app.css:76 `100ms`<br>gap-appearance.css:111 `calc(var(--dur, 220ms) * 10 / 22)` | gap-appearance.css:111 |
| `:root` |  | --dur-fast | app.css:77 `160ms`<br>gap-appearance.css:110 `calc(var(--dur, 220ms) * 16 / 22)` | gap-appearance.css:110 |
| `:root` |  | --dur-base | app.css:78 `220ms`<br>gap-appearance.css:109 `var(--dur, 220ms)` | gap-appearance.css:109 |
| `:root` |  | --radius | app.css:86 `6px`<br>gap-appearance.css:108 `calc(var(--r-0, 0px) + (var(--r-sm, 4px) + var(--r` | gap-appearance.css:108 |
| `.onyx-thread-sheet` |  | padding | app.css:160 `16px`<br>pol-thread.css:982 `0` | pol-thread.css:982 |
| `.onyx-thread-sheet` |  | gap | app.css:160 `12px`<br>pol-thread.css:982 `0` | pol-thread.css:982 |
| `.onyx-topic-tools` |  | gap | app.css:176 `8px`<br>pol-thread.css:2548 `var(--space-2)` | pol-thread.css:2548 |
| `.shell-topic-create` |  | display | app.css:177 `inline-flex`<br>pol-thread.css:2551 `flex` | pol-thread.css:2551 |
| `.shell-topic-create` |  | gap | app.css:177 `6px`<br>pol-thread.css:2551 `var(--space-2)` | pol-thread.css:2551 |
| `.shell-topic-create-input` |  | border-radius | app.css:178 `6px`<br>pol-thread.css:2557 `var(--radius)` | pol-thread.css:2557 |
| `.shell-topic-create-input` |  | padding | app.css:178 `2px 8px`<br>pol-thread.css:2556 `0 var(--space-3)` | pol-thread.css:2556 |
| `.shell-topic-create-input` |  | font-size | app.css:178 `0.75rem`<br>pol-thread.css:2559 `var(--text-sm)` | pol-thread.css:2559 |
| `.shell-topic-actions` |  | display | app.css:181 `inline-flex`<br>pol-thread.css:2562 `flex` | pol-thread.css:2562 |
| `.shell-topic-actions` |  | gap | app.css:181 `6px`<br>pol-thread.css:2562 `var(--space-2)` | pol-thread.css:2562 |
| `.shell-topic-forum` |  | gap | app.css:182 `8px`<br>pol-thread.css:2563 `var(--space-2)` | pol-thread.css:2563 |
| `.shell-topic-forum` |  | padding | app.css:182 `4px 0`<br>pol-thread.css:2563 `var(--space-1) 0 var(--space-3)` | pol-thread.css:2563 |
| `.shell-topic-card` |  | border-radius | app.css:183 `8px`<br>pol-thread.css:2564 `var(--radius)` | pol-thread.css:2564 |
| `.shell-topic-card-meta` |  | font-size | app.css:186 `0.75rem`<br>pol-thread.css:2569 `var(--text-sm)` | pol-thread.css:2569 |
| `.shell-topic-card-preview` |  | font-size | app.css:187 `0.75rem`<br>pol-thread.css:2569 `var(--text-sm)` | pol-thread.css:2569 |
| `.topic-chip` |  | font-size | app.css:199 `0.75rem`<br>pol-thread.css:632 `var(--text-sm)` | pol-thread.css:632 |
| `.topic-chip__unread` |  | background | app.css:202 `var(--onyx-accent)`<br>app.css:4017 `var(--onyx-panel-2)` | app.css:4017 |
| `.topic-chip__unread` |  | color | app.css:202 `var(--onyx-bg)`<br>app.css:4017 `var(--onyx-text)` | app.css:4017 |
| `.topic-chip__unread` |  | padding | app.css:202 `0 6px`<br>pol-thread.css:2546 `0 5px` | pol-thread.css:2546 |
| `.topic-chip__unread` |  | font-size | app.css:202 `0.6875rem`<br>pol-thread.css:2546 `var(--text-2xs)` | pol-thread.css:2546 |
| `.onyx-facepile-face + .onyx-facepile-face` |  | margin-left | app.css:208 `-0.55rem`<br>rx-shell.css:46 `-0.3rem` | rx-shell.css:46 |
| `.onyx-reconnect-msg` |  | white-space | app.css:315 `nowrap`<br>gap-shell.css:334 `normal` | gap-shell.css:334 |
| `.onyx-rail .onyx-rail-filter-unread` |  | font-size | app.css:511 `var(--text-2xs)`<br>pol-shell.css:766 `var(--text-xs)` | pol-shell.css:766 |
| `.onyx-rail .onyx-rail-filter-unread` |  | padding | app.css:512 `3px var(--space-2)`<br>pol-shell.css:765 `0 var(--space-2)` | pol-shell.css:765 |
| `.onyx-rail .onyx-rail-filter-clear` |  | font-size | app.css:511 `var(--text-2xs)`<br>pol-shell.css:766 `var(--text-xs)` | pol-shell.css:766 |
| `.onyx-rail .onyx-rail-filter-clear` |  | padding | app.css:512 `3px var(--space-2)`<br>pol-shell.css:765 `0 var(--space-2)` | pol-shell.css:765 |
| `.onyx-rail .onyx-rail-new` |  | font-size | app.css:511 `var(--text-2xs)`<br>pol-shell.css:785 `var(--text-xs)` | pol-shell.css:785 |
| `.onyx-rail .onyx-rail-new` |  | padding | app.css:512 `3px var(--space-2)`<br>pol-shell.css:781 `0 var(--space-2)` | pol-shell.css:781 |
| `.onyx-rail .onyx-rail-star` |  | width | app.css:507 `auto`<br>pol-shell.css:860 `28px` | pol-shell.css:860 |
| `.onyx-rail .onyx-rail-star` |  | border | app.css:509 `1px solid var(--onyx-line)`<br>pol-shell.css:863 `0` | pol-shell.css:863 |
| `.onyx-rail .onyx-rail-star` |  | color | app.css:510 `var(--onyx-dim)`<br>app.css:595 `var(--onyx-faint)`<br>pol-shell.css:864 `var(--onyx-faint)` | pol-shell.css:864 |
| `.onyx-rail .onyx-rail-star` |  | padding | app.css:512 `3px var(--space-2)`<br>app.css:596 `3px 6px`<br>pol-shell.css:862 `0` | pol-shell.css:862 |
| `.onyx-rail .onyx-rail-filter-unread-on` |  | border-color | app.css:515 `var(--onyx-accent)`<br>pol-shell.css:770 `var(--onyx-dim)` | pol-shell.css:770 |
| `.onyx-rail .onyx-rail-filter-unread-on` |  | color | app.css:516 `var(--onyx-accent)`<br>pol-shell.css:770 `var(--onyx-text)` | pol-shell.css:770 |
| `.onyx-rail-meta` |  | gap | app.css:559 `6px`<br>pol-shell.css:828 `4px` | pol-shell.css:828 |
| `.onyx-rail .onyx-rail-star-on` |  | color | app.css:598 `var(--onyx-accent)`<br>app.css:4021 `var(--onyx-text)`<br>pol-shell.css:872 `var(--onyx-dim)` | pol-shell.css:872 |
| `.onyx-newmsg-sheet` |  | gap | app.css:612 `10px`<br>ui-sheets.css:777 `var(--space-3)` | ui-sheets.css:777 |
| `.onyx-composer` |  | align-items | app.css:750 `center`<br>pol-thread.css:1091 `stretch` | pol-thread.css:1091 |
| `.onyx-composer` |  | gap | app.css:751 `10px`<br>pol-thread.css:1093 `var(--space-2)` | pol-thread.css:1093 |
| `.onyx-composer` |  | padding | app.css:752 `10px 16px`<br>pol-thread.css:1094 `var(--space-2) var(--space-4) var(--space-3)` | pol-thread.css:1094 |
| `.onyx-composer` |  | background | app.css:753 `var(--onyx-panel)`<br>pol-thread.css:1095 `var(--onyx-bg)` | pol-thread.css:1095 |
| `.onyx-composer` |  | border-top | app.css:754 `1px solid var(--onyx-line)`<br>pol-thread.css:1096 `0` | pol-thread.css:1096 |
| `.onyx-toaster` |  | right | app.css:916 `16px`<br>ui-sheets.css:799 `var(--space-5)` | ui-sheets.css:799 |
| `.onyx-toaster` |  | bottom | app.css:917 `16px`<br>ui-sheets.css:800 `calc(var(--composer-h) + var(--space-6))` | ui-sheets.css:800 |
| `.onyx-toaster` |  | z-index | app.css:918 `60`<br>ui-sheets.css:798 `90` | ui-sheets.css:798 |
| `.onyx-toaster` |  | max-width | app.css:925 `min(360px, 90vw)`<br>ui-sheets.css:801 `min(380px, calc(100vw - 2 * var(--space-4)))` | ui-sheets.css:801 |
| `.onyx-toast` |  | align-items | app.css:930 `flex-start`<br>ui-sheets.css:804 `center` | ui-sheets.css:804 |
| `.onyx-toast` |  | gap | app.css:931 `8px`<br>ui-sheets.css:805 `var(--space-3)` | ui-sheets.css:805 |
| `.onyx-toast` |  | border-radius | app.css:935 `8px`<br>ui-sheets.css:808 `var(--radius)` | ui-sheets.css:808 |
| `.onyx-toast` |  | padding | app.css:936 `8px 10px`<br>ui-sheets.css:807 `var(--space-2) var(--space-2) var(--space-2) var(-` | ui-sheets.css:807 |
| `.guest-claim-chip` |  | gap | app.css:970 `8px`<br>pol-shell.css:1105 `var(--space-3)` | pol-shell.css:1105 |
| `.guest-claim-chip` |  | border-radius | app.css:972 `8px`<br>pol-shell.css:1109 `var(--radius)` | pol-shell.css:1109 |
| `.guest-claim-chip` |  | padding | app.css:973 `6px 10px`<br>pol-shell.css:1106 `var(--space-3)` | pol-shell.css:1106 |
| `.onyx-schedule-pop` |  | width | app.css:1132 `min(280px, calc(100vw - 24px))`<br>gap-usermodes.css:364 `min(320px, calc(100vw - 24px))` | gap-usermodes.css:364 |
| `.onyx-nav-icon[data-icon="rooms"]` |  | --onyx-nav-glyph | app.css:2378 `url("data:image/svg+xml,%3Csvg xmlns='http://www.w`<br>rx-shell.css:37 `url("data:image/svg+xml,%3Csvg xmlns='http://www.w` | rx-shell.css:37 |
| `.onyx-you-close` |  | color | app.css:2414 `var(--onyx-text)`<br>ui-sheets.css:264 `var(--onyx-dim)` | ui-sheets.css:264 |
| `.onyx-you-close` |  | border | app.css:2416 `1px solid var(--onyx-line)`<br>ui-sheets.css:266 `0` | ui-sheets.css:266 |
| `.onyx-you-close` |  | padding | app.css:2418 `var(--space-1) var(--space-3)`<br>ui-sheets.css:261 `0` | ui-sheets.css:261 |
| `.onyx-coach-dismiss` |  | color | app.css:2554 `var(--onyx-dim)`<br>pol-shell.css:1082 `var(--onyx-faint)` | pol-shell.css:1082 |
| `.onyx-roster .onyx-member` |  | flex-wrap | app.css:2736 `wrap`<br>pol-roster.css:189 `nowrap` | pol-roster.css:189 |
| `.onyx-roster .onyx-member` |  | min-height | app.css:2736 `36px`<br>pol-roster.css:191 `40px` | pol-roster.css:191 |
| `.onyx-spotlight-foot kbd` |  | background | app.css:2817 `var(--onyx-panel-2)`<br>ui-sheets.css:508 `var(--onyx-bg)` | ui-sheets.css:508 |
| `.onyx-spotlight-foot kbd` |  | padding | app.css:2820 `1px 5px`<br>ui-sheets.css:505 `0 5px` | ui-sheets.css:505 |
| `.onyx-spotlight-backdrop` |  | background | app.css:2833 `rgb(0 0 0 / 55%)`<br>ui-sheets.css:435 `var(--sheet-veil)` | ui-sheets.css:435 |
| `.onyx-spotlight-panel` |  | width | app.css:2837 `min(560px, 100%)`<br>ui-sheets.css:438 `min(600px, 100%)` | ui-sheets.css:438 |
| `.onyx-spotlight-panel` |  | max-height | app.css:2838 `min(70vh, 560px)`<br>ui-sheets.css:439 `min(64vh, 560px)` | ui-sheets.css:439 |
| `.onyx-spotlight-panel` |  | box-shadow | app.css:2846 `0 12px 32px rgb(0 8 16 / 45%)`<br>ui-sheets.css:441 `var(--elev-3)` | ui-sheets.css:441 |
| `.onyx-spotlight-panel` |  | animation | app.css:2847 `onyx-switcher-in var(--dur-fast) ease-out`<br>ui-sheets.css:443 `ui-sheet-drop var(--dur-fast) var(--ease)` | ui-sheets.css:443 |
| `.onyx-spotlight-search` |  | gap | app.css:2861 `var(--space-2)`<br>ui-sheets.css:447 `var(--space-3)` | ui-sheets.css:447 |
| `.onyx-spotlight-search` |  | padding | app.css:2862 `10px var(--space-3)`<br>ui-sheets.css:449 `0 var(--space-2) 0 var(--space-4)` | ui-sheets.css:449 |
| `.onyx-spotlight-input` |  | font-size | app.css:2873 `var(--text-md)`<br>ui-sheets.css:459 `var(--text-lg)` | ui-sheets.css:459 |
| `.onyx-spotlight-input` |  | padding | app.css:2874 `6px 0`<br>ui-sheets.css:459 `10px 0` | ui-sheets.css:459 |
| `.onyx-spotlight-close` |  | min-width | app.css:2879 `32px`<br>ui-sheets.css:258 `var(--sheet-close)` | ui-sheets.css:258 |
| `.onyx-spotlight-close` |  | min-height | app.css:2880 `32px`<br>ui-sheets.css:259 `var(--sheet-close)` | ui-sheets.css:259 |
| `.onyx-spotlight-close` |  | border | app.css:2882 `1px solid var(--onyx-line)`<br>ui-sheets.css:266 `0` | ui-sheets.css:266 |
| `.onyx-spotlight-close` |  | font-size | app.css:2886 `var(--text-lg)`<br>ui-sheets.css:262 `0` | ui-sheets.css:262 |
| `.onyx-spotlight-close` |  | line-height | app.css:2887 `1`<br>ui-sheets.css:263 `0` | ui-sheets.css:263 |
| `.onyx-spotlight-close` |  | margin | ui-sheets.css:260 `0 -6px 0 0`<br>ui-sheets.css:461 `0` | ui-sheets.css:461 |
| `.onyx-shortcuts-close` |  | min-width | app.css:2879 `32px`<br>ui-sheets.css:258 `var(--sheet-close)` | ui-sheets.css:258 |
| `.onyx-shortcuts-close` |  | min-height | app.css:2880 `32px`<br>ui-sheets.css:259 `var(--sheet-close)` | ui-sheets.css:259 |
| `.onyx-shortcuts-close` |  | border | app.css:2882 `1px solid var(--onyx-line)`<br>ui-sheets.css:266 `0` | ui-sheets.css:266 |
| `.onyx-shortcuts-close` |  | font-size | app.css:2886 `var(--text-lg)`<br>ui-sheets.css:262 `0` | ui-sheets.css:262 |
| `.onyx-shortcuts-close` |  | line-height | app.css:2887 `1`<br>ui-sheets.css:263 `0` | ui-sheets.css:263 |
| `.onyx-spotlight-results` |  | padding | app.css:2963 `6px`<br>ui-sheets.css:463 `var(--space-2)` | ui-sheets.css:463 |
| `.onyx-spotlight-group + .onyx-spotlight-group` |  | margin-top | app.css:2967 `6px`<br>ui-sheets.css:465 `var(--space-2)` | ui-sheets.css:465 |
| `.onyx-spotlight-section` |  | padding | app.css:2970 `6px var(--space-2) var(--space-1)`<br>ui-sheets.css:464 `var(--space-2) var(--space-3) var(--space-1)` | ui-sheets.css:464 |
| `.onyx-spotlight-option` |  | gap | app.css:2979 `10px`<br>ui-sheets.css:468 `var(--space-3)` | ui-sheets.css:468 |
| `.onyx-spotlight-option` |  | min-height | app.css:2980 `36px`<br>ui-sheets.css:469 `40px` | ui-sheets.css:469 |
| `.onyx-spotlight-option` |  | padding | app.css:2981 `6px var(--space-2)`<br>ui-sheets.css:470 `0 var(--space-3)` | ui-sheets.css:470 |
| `.onyx-spotlight-option` |  | border-left | app.css:2983 `2px solid transparent`<br>ui-sheets.css:471 `0` | ui-sheets.css:471 |
| `.onyx-spotlight-title mark` |  | text-decoration | app.css:2993 `underline`<br>ui-sheets.css:489 `none` | ui-sheets.css:489 |
| `.onyx-spotlight-hint` |  | color | app.css:2997 `var(--onyx-dim)`<br>ui-sheets.css:490 `var(--onyx-faint)` | ui-sheets.css:490 |
| `.onyx-spotlight-hint` |  | font-size | app.css:2998 `var(--text-2xs)`<br>ui-sheets.css:490 `var(--text-sm)` | ui-sheets.css:490 |
| `.onyx-spotlight-foot` |  | padding | app.css:3008 `var(--space-2) var(--space-3)`<br>ui-sheets.css:497 `var(--space-2) var(--space-4)` | ui-sheets.css:497 |
| `.onyx-call-avatar-lg` |  | width | app.css:3371 `72px`<br>calls-engine.css:162 `64px` | calls-engine.css:162 |
| `.onyx-call-avatar-lg` |  | height | app.css:3371 `72px`<br>calls-engine.css:162 `64px` | calls-engine.css:162 |
| `.onyx-call-avatar-lg` |  | font-size | app.css:3371 `1.5rem`<br>calls-engine.css:162 `1.375rem` | calls-engine.css:162 |
| `.onyx-header-voice` |  | flex | app.css:3382 `none`<br>calls-engine.css:35 `0 1 auto` | calls-engine.css:35 |
| `.onyx-voice-chip` |  | height | app.css:3384 `30px`<br>calls-engine.css:36 `32px` | calls-engine.css:36 |
| `.onyx-voice-chip` |  | max-width | app.css:3384 `100%`<br>calls-engine.css:36 `24rem` | calls-engine.css:36 |
| `.onyx-call-join` |  | min-height | app.css:3393 `30px`<br>calls-engine.css:40 `32px` | calls-engine.css:40 |
| `.onyx-join-banner` |  | gap | app.css:3401 `14px`<br>calls-engine.css:76 `var(--space-2) var(--space-3)` | calls-engine.css:76 |
| `.onyx-join-banner` |  | margin | app.css:3401 `12px 14px`<br>calls-engine.css:77 `var(--space-2) 0 var(--space-3)` | calls-engine.css:77 |
| `.onyx-join-banner` |  | padding | app.css:3401 `12px 14px`<br>calls-engine.css:77 `var(--space-2) var(--space-2) var(--space-2) var(-` | calls-engine.css:77 |
| `.onyx-join-banner` |  | background | app.css:3402 `var(--onyx-panel-2)`<br>calls-engine.css:78 `var(--onyx-panel)` | calls-engine.css:78 |
| `.onyx-join-banner-copy` |  | flex | app.css:3406 `1`<br>calls-engine.css:80 `1 1 14rem` | calls-engine.css:80 |
| `.onyx-join-banner-copy` |  | min-width | app.css:3406 `200px`<br>calls-engine.css:80 `0` | calls-engine.css:80 |
| `.onyx-join-banner-hide` |  | width | app.css:3411 `28px`<br>calls-engine.css:85 `32px` | calls-engine.css:85 |
| `.onyx-join-banner-hide` |  | height | app.css:3411 `28px`<br>calls-engine.css:85 `32px` | calls-engine.css:85 |
| `.onyx-call-stage` |  | margin | app.css:3424 `12px 14px`<br>calls-engine.css:125 `var(--space-2) 0 var(--space-3)` | calls-engine.css:125 |
| `.onyx-call-stage-status` |  | padding | app.css:3428 `10px 14px 0`<br>calls-engine.css:135 `0` | calls-engine.css:135 |
| `.onyx-call-stage-status` |  | font-size | app.css:3429 `0.75rem`<br>calls-engine.css:135 `var(--text-sm)` | calls-engine.css:135 |
| `.onyx-call-people` |  | align-items | app.css:3433 `center`<br>calls-engine.css:160 `flex-start` | calls-engine.css:160 |
| `.onyx-call-people` |  | gap | app.css:3434 `28px 36px`<br>calls-engine.css:160 `var(--space-4) var(--space-5)` | calls-engine.css:160 |
| `.onyx-call-people` |  | padding | app.css:3434 `24px 24px 28px`<br>calls-engine.css:160 `var(--space-4) var(--space-4)` | calls-engine.css:160 |
| `.onyx-call-person` |  | gap | app.css:3438 `6px`<br>calls-engine.css:161 `var(--space-1)` | calls-engine.css:161 |
| `.onyx-call-person` |  | width | app.css:3438 `112px`<br>calls-engine.css:161 `96px` | calls-engine.css:161 |
| `.onyx-call-role` |  | margin-top | app.css:3460 `-4px`<br>calls-engine.css:164 `-2px` | calls-engine.css:164 |
| `.onyx-call-role` |  | font-size | app.css:3460 `0.75rem`<br>calls-engine.css:164 `var(--text-2xs)` | calls-engine.css:164 |
| `.onyx-call-bar` |  | display | app.css:3468 `grid`<br>calls-engine.css:171 `flex` | calls-engine.css:171 |
| `.onyx-call-bar` |  | gap | app.css:3468 `12px`<br>calls-engine.css:172 `var(--space-2)` | calls-engine.css:172 |
| `.onyx-call-bar` |  | min-height | app.css:3468 `56px`<br>calls-engine.css:172 `0` | calls-engine.css:172 |
| `.onyx-call-bar` |  | padding | app.css:3468 `8px 12px`<br>calls-engine.css:172 `var(--space-2) var(--space-3)` | calls-engine.css:172 |
| `.onyx-call-bar-center` |  | flex-wrap | app.css:3475 `wrap`<br>calls-engine.css:174 `nowrap` | calls-engine.css:174 |
| `.onyx-call-bar-center` |  | gap | app.css:3475 `6px`<br>calls-engine.css:174 `var(--space-1)` | calls-engine.css:174 |
| `.onyx-cbtn` |  | width | app.css:3479 `56px`<br>calls-engine.css:175 `60px` | calls-engine.css:175 |
| `.onyx-cbtn` |  | height | app.css:3479 `44px`<br>calls-engine.css:175 `48px` | calls-engine.css:175 |
| `.onyx-cbtn-leave` |  | margin-left | app.css:3484 `6px`<br>calls-engine.css:177 `var(--space-2)` | calls-engine.css:177 |
| `.onyx-call-more-wrap` |  | position | app.css:3487 `relative`<br>calls-engine.css:178 `static` | calls-engine.css:178 |
| `.onyx-call-more` |  | position | app.css:3489 `absolute`<br>calls-engine.css:183 `relative` | calls-engine.css:183 |
| `.onyx-call-more` |  | bottom | app.css:3489 `calc(100% + 6px)`<br>calls-engine.css:183 `auto` | calls-engine.css:183 |
| `.onyx-call-more` |  | left | app.css:3489 `50%`<br>calls-engine.css:183 `auto` | calls-engine.css:183 |
| `.onyx-call-more` |  | transform | app.css:3489 `translateX(-50%)`<br>calls-engine.css:183 `none` | calls-engine.css:183 |
| `.onyx-call-more` |  | z-index | app.css:3489 `20`<br>calls-engine.css:183 `61` | calls-engine.css:183 |
| `.onyx-call-more` |  | min-width | app.css:3490 `220px`<br>calls-engine.css:185 `0` | calls-engine.css:185 |
| `.onyx-call-more` |  | padding | app.css:3490 `6px`<br>calls-engine.css:185 `var(--space-2) 0 0` | calls-engine.css:185 |
| `.onyx-call-more` |  | border | app.css:3490 `1px solid var(--onyx-line)`<br>calls-engine.css:186 `0` | calls-engine.css:186 |
| `.onyx-call-more` |  | border-radius | app.css:3490 `6px`<br>calls-engine.css:186 `0` | calls-engine.css:186 |
| `.onyx-main-calls .onyx-call-stage` |  | margin | app.css:3553 `20px 0 0`<br>calls-engine.css:471 `var(--space-5) 0 0` | calls-engine.css:471 |
| `.onyx-join-banner` | @media (max-width: 640px) | flex-direction | app.css:3564 `column`<br>calls-engine.css:110 `row` | calls-engine.css:110 |
| `.onyx-join-banner` | @media (max-width: 640px) | align-items | app.css:3564 `stretch`<br>calls-engine.css:110 `center`<br>calls-engine.css:112 `flex-start` | calls-engine.css:112 |
| `.onyx-join-banner` | @media (max-width: 640px) | margin | app.css:3564 `12px`<br>calls-engine.css:110 `var(--space-1) 0 var(--space-2)` | calls-engine.css:110 |
| `.onyx-call-stage` | @media (max-width: 640px) | margin | app.css:3571 `12px`<br>calls-engine.css:209 `var(--space-1) 0 var(--space-2)` | calls-engine.css:209 |
| `.onyx-call-people` | @media (max-width: 640px) | gap | app.css:3572 `20px 16px`<br>calls-engine.css:217 `var(--space-3)` | calls-engine.css:217 |
| `.onyx-call-people` | @media (max-width: 640px) | padding | app.css:3572 `20px 12px`<br>calls-engine.css:218 `var(--space-2) var(--space-3)` | calls-engine.css:218 |
| `.onyx-call-person` | @media (max-width: 640px) | width | app.css:3573 `96px`<br>calls-engine.css:225 `68px` | calls-engine.css:225 |
| `.onyx-call-bar` | @media (max-width: 640px) | padding | app.css:3574 `10px 12px calc(10px + env(safe-area-inset-bottom, `<br>calls-engine.css:236 `var(--space-2) var(--space-2)` | calls-engine.css:236 |
| `.onyx-frame` |  | height | app.css:3609 `100vh`<br>app.css:3610 `100dvh`<br>pol-ios.css:65 `var(--vvh, 100dvh)` | pol-ios.css:65 |
| `.onyx-frame > .onyx-primary-nav` |  | padding | app.css:3619 `var(--space-2) var(--space-1)`<br>pol-shell.css:673 `var(--space-2) 0` | pol-shell.css:673 |
| `.onyx-frame > .onyx-primary-nav` |  | gap | app.css:3620 `var(--space-1)`<br>pol-shell.css:672 `2px` | pol-shell.css:672 |
| `.onyx-primary-nav .onyx-nav-btn` |  | padding | app.css:3672 `var(--space-2) 0`<br>pol-shell.css:679 `0` | pol-shell.css:679 |
| `.onyx-primary-nav .onyx-nav-btn` |  | min-height | app.css:3673 `var(--target-min)`<br>pol-shell.css:678 `40px` | pol-shell.css:678 |
| `.notif-center__filters` |  | display | app.css:3794 `flex`<br>pol-shell.css:60 `grid` | pol-shell.css:60 |
| `.onyx-sheet-layer` |  | padding | app.css:3903 `var(--space-4)`<br>ui-sheets.css:79 `var(--space-6) var(--space-4)` | ui-sheets.css:79 |
| `.onyx-sheet-backdrop` |  | background | app.css:3915 `color-mix(in srgb, #000 55%, transparent)`<br>ui-sheets.css:82 `var(--sheet-veil)` | ui-sheets.css:82 |
| `.onyx-sheet-layer > .onyx-sheet` |  | animation | app.css:3941 `onyx-sheet-in var(--dur-fast) var(--ease)`<br>ui-sheets.css:95 `ui-sheet-pop var(--dur-base) var(--ease)` | ui-sheets.css:95 |
| `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` |  | animation-name | app.css:3949 `onyx-sheet-side-in`<br>ui-sheets.css:142 `ui-sheet-side` | ui-sheets.css:142 |
| `.onyx-sheet-close` |  | min-width | app.css:3981 `32px`<br>ui-sheets.css:258 `var(--sheet-close)` | ui-sheets.css:258 |
| `.onyx-sheet-close` |  | min-height | app.css:3982 `32px`<br>ui-sheets.css:259 `var(--sheet-close)` | ui-sheets.css:259 |
| `.onyx-sheet-close` |  | border | app.css:3987 `1px solid var(--onyx-line)`<br>ui-sheets.css:266 `0` | ui-sheets.css:266 |
| `.onyx-frame > .onyx-mobile-nav` | @media (max-width: 599.98px) | gap | app.css:4059 `2px`<br>pol-shell.css:1412 `0` | pol-shell.css:1412 |
| `.onyx-frame > .onyx-mobile-nav` | @media (max-width: 599.98px) | padding | app.css:4061 `var(--space-1) var(--space-1) calc(var(--space-1) `<br>pol-shell.css:1414 `0 var(--space-1) var(--safe-bottom, 0px)` | pol-shell.css:1414 |
| `.onyx-mobile-nav .onyx-nav-btn` | @media (max-width: 599.98px) | font-size | app.css:4066 `var(--text-xs)`<br>pol-shell.css:1424 `0.6875rem` | pol-shell.css:1424 |
| `.ap-lede` |  | margin | pol-studio.css:94 `var(--space-3) 0 0`<br>gap-oper.css:420 `0` | gap-oper.css:420 |
| `.ap-lede` |  | font-size | pol-studio.css:96 `var(--text-lg)`<br>gap-oper.css:420 `0.875rem` | gap-oper.css:420 |
| `.ap-lede` |  | line-height | pol-studio.css:97 `var(--leading-body)`<br>gap-oper.css:420 `var(--leading-snug)` | gap-oper.css:420 |
| `.notif-center .notif-center__open` |  | grid-template-columns | pol-shell.css:103 `28px minmax(0, 1fr)`<br>ui-sheets.css:552 `32px minmax(0, 1fr)` | ui-sheets.css:552 |
| `.notif-center .notif-center__open` |  | min-height | pol-shell.css:108 `44px`<br>ui-sheets.css:552 `52px` | ui-sheets.css:552 |
| `.notif-center .notif-center__open` |  | padding | pol-shell.css:109 `var(--space-2)`<br>ui-sheets.css:552 `var(--space-2) var(--space-2)` | ui-sheets.css:552 |
| `.chb .chb-sort-btn[aria-pressed="true"]` |  | border-color | pol-shell.css:304 `var(--onyx-dim)`<br>ui-sheets.css:746 `transparent` | ui-sheets.css:746 |
| `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` |  | width | pol-shell.css:426 `min(360px, 100%)`<br>ui-sheets.css:1092 `min(380px, 100%)` | ui-sheets.css:1092 |
| `.onyx-call-captions-copy` |  | min-height | calls-c8.css:72 `var(--target-floor)`<br>calls-engine.css:548 `28px` | calls-engine.css:548 |
| `.onyx-call-caption-translate` |  | min-height | calls-c8.css:72 `var(--target-floor)`<br>calls-engine.css:548 `28px` | calls-engine.css:548 |
| `.onyx-call-caption-translate` |  | margin-left | calls-c8.css:72 `auto`<br>calls-c8.css:85 `0` | calls-c8.css:85 |
| `.onyx-stage-hand-row .onyx-call-btn` |  | min-height | calls-c11.css:107 `var(--target-floor)`<br>calls-engine.css:547 `28px` | calls-engine.css:547 |
| `.onyx-call-pip-card` | @media (max-width: 767px) | top | calls-c6.css:200 `calc(var(--mobile-nav-h) + var(--space-2))`<br>calls-engine.css:501 `calc(env(safe-area-inset-top, 0px) + 64px)` | calls-engine.css:501 |
| `.onyx-call-pip-card` | @media (max-width: 767px) | right | calls-c6.css:201 `var(--space-3)`<br>calls-engine.css:502 `max(var(--space-3), env(safe-area-inset-right, 0px` | calls-engine.css:502 |
| `.onyx-call-pip-card` | @media (max-width: 767px) | width | calls-c6.css:204 `160px`<br>calls-engine.css:503 `min(320px, calc(100vw - 2 * var(--space-3)))` | calls-engine.css:503 |
| `.onyx-call-pip-card[data-corner]` | @media (max-width: 767px) | top | calls-c6.css:200 `calc(var(--mobile-nav-h) + var(--space-2))`<br>calls-engine.css:501 `calc(env(safe-area-inset-top, 0px) + 64px)` | calls-engine.css:501 |
| `.onyx-call-pip-card[data-corner]` | @media (max-width: 767px) | right | calls-c6.css:201 `var(--space-3)`<br>calls-engine.css:502 `max(var(--space-3), env(safe-area-inset-right, 0px` | calls-engine.css:502 |
| `.onyx-call-pip-card[data-corner]` | @media (max-width: 767px) | width | calls-c6.css:204 `160px`<br>calls-engine.css:503 `min(320px, calc(100vw - 2 * var(--space-3)))` | calls-engine.css:503 |
| `.onyx-call-pip-body` | @media (max-width: 767px) | gap | calls-c6.css:210 `var(--space-1)`<br>calls-engine.css:505 `var(--space-2)` | calls-engine.css:505 |
| `.onyx-call-pip-faces` | @media (max-width: 767px) | flex-basis | calls-c6.css:211 `100%`<br>calls-engine.css:506 `auto` | calls-engine.css:506 |
| `.onyx-call-pip-btn` | @media (max-width: 767px) | min-height | calls-c6.css:212 `28px`<br>calls-engine.css:507 `var(--target-min)`<br>calls-engine.css:550 `28px` | calls-engine.css:550 |
| `.onyx-call-pip-btn` | @media (max-width: 767px) | padding | calls-c6.css:212 `0 var(--space-2)`<br>calls-engine.css:507 `0 var(--space-3)` | calls-engine.css:507 |
| `.onyx-call-pip-btn` | @media (max-width: 767px) | font-size | calls-c6.css:212 `var(--text-2xs)`<br>calls-engine.css:507 `var(--text-sm)` | calls-engine.css:507 |
| `.onyx-call-grid[data-columns="1"]` |  | max-width | calls-c4.css:72 `56rem`<br>calls-engine.css:345 `none` | calls-engine.css:345 |
| `.onyx-call-grid[data-columns="1"]` |  | width | calls-c4.css:72 `100%`<br>calls-engine.css:346 `min(100%, calc((var(--grid-h) - (var(--rows, 1) - ` | calls-engine.css:346 |
| `.onyx-tile-nick` |  | font-size | calls-c4.css:106 `var(--text-2xs)`<br>calls-c4.css:111 `var(--text-xs)`<br>calls-engine.css:350 `var(--text-sm)` | calls-engine.css:350 |
| `.onyx-call-primary > .onyx-tile` |  | aspect-ratio | calls-c4.css:137 `auto`<br>calls-engine.css:349 `16 / 9` | calls-engine.css:349 |
| `.onyx-call-primary > .onyx-tile` |  | min-height | calls-c4.css:137 `260px`<br>calls-engine.css:349 `0` | calls-engine.css:349 |
| `.onyx-call-primary > .onyx-tile` |  | height | calls-c4.css:137 `100%`<br>calls-engine.css:349 `auto` | calls-engine.css:349 |
| `.onyx-call-grid > .onyx-tile` | @media (max-width: 767px) | aspect-ratio | calls-c4.css:155 `3 / 4`<br>calls-engine.css:379 `16 / 9` | calls-engine.css:379 |

### G13.2 Cross-file duplicates (all)

| selector | context | occurrences |
|---|---|---|
| `:root` |  | app.css:4, gap-appearance.css:22, gap-appearance.css:79, gap-appearance.css:107, pol-thread.css:11, pol-thread.css:37, pol-thread.css:2053, rx-shell.css:27, gap-import.css:10, gap-commands.css:9, gap-watch.css:13, gap-shell.css:11, ui-sheets.css:27 |
| `.onyx-system` |  | app.css:151, pol-thread.css:494 |
| `.onyx-day-divider` |  | app.css:155, pol-thread.css:457 |
| `.onyx-day-divider-label` |  | app.css:156, pol-thread.css:465 |
| `.onyx-thread-sheet` |  | app.css:160, pol-thread.css:982, pol-thread.css:2138 |
| `.onyx-topic-tools` |  | app.css:176, pol-thread.css:2548 |
| `.shell-topic-create` |  | app.css:177, pol-thread.css:2551 |
| `.shell-topic-create-input` |  | app.css:178, pol-thread.css:2552 |
| `.shell-topic-actions` |  | app.css:181, pol-thread.css:2562 |
| `.shell-topic-forum` |  | app.css:182, pol-thread.css:2563 |
| `.shell-topic-card` |  | app.css:183, pol-thread.css:2564 |
| `.shell-topic-card-title` |  | app.css:185, pol-thread.css:2567 |
| `.shell-topic-card-meta` |  | app.css:186, pol-thread.css:2568, pol-thread.css:2570 |
| `.shell-topic-card-preview` |  | app.css:187, pol-thread.css:2568, pol-thread.css:2571 |
| `.shell-topic-card-author` |  | app.css:188, pol-thread.css:2573 |
| `.topic-chip` |  | app.css:199, pol-thread.css:632 |
| `.topic-chip__unread` |  | app.css:202, app.css:4017, pol-thread.css:2546 |
| `.onyx-facepile-face + .onyx-facepile-face` |  | app.css:208, rx-shell.css:46 |
| `.onyx-facepile-face .onyx-avatar` |  | app.css:209, rx-shell.css:47 |
| `html` |  | app.css:215, app.css:4007, gap-appearance.css:150, pol-ios.css:24 |
| `body` |  | app.css:215, gap-appearance.css:114 |
| `.onyx-reconnect` |  | app.css:291, gap-shell.css:339 |
| `.onyx-reconnect-msg` |  | app.css:310, gap-shell.css:329 |
| `.onyx-roster` |  | app.css:411, app.css:418, pol-roster.css:413 |
| `.onyx-rail li` |  | app.css:437, pol-shell.css:793 |
| `.onyx-rail .onyx-rail-filter-unread` |  | app.css:502, pol-shell.css:761 |
| `.onyx-rail .onyx-rail-filter-clear` |  | app.css:502, pol-shell.css:761 |
| `.onyx-rail .onyx-rail-new` |  | app.css:502, pol-shell.css:777 |
| `.onyx-rail .onyx-rail-star` |  | app.css:502, app.css:593, pol-shell.css:857 |
| `.onyx-rail .onyx-rail-filter-unread-on` |  | app.css:514, pol-shell.css:770 |
| `.onyx-rail .onyx-rail-item` |  | app.css:540, pol-shell.css:796 |
| `.onyx-rail-copy` |  | app.css:546, pol-shell.css:822 |
| `.onyx-rail-meta` |  | app.css:559, pol-shell.css:828 |
| `.onyx-rail-avatar` |  | app.css:580, account2.css:156 |
| `.onyx-rail .onyx-rail-star-on` |  | app.css:598, app.css:4021, pol-shell.css:872 |
| `.onyx-newmsg-sheet` |  | app.css:602, ui-sheets.css:777 |
| `.onyx-composer` |  | app.css:748, app.css:2566, pol-thread.css:1089 |
| `.onyx-calls` |  | app.css:821, calls-engine.css:465 |
| `.onyx-toaster` |  | app.css:914, ui-sheets.css:797 |
| `.onyx-toast` |  | app.css:928, ui-sheets.css:803 |
| `.onyx-toast--success` |  | app.css:939, ui-sheets.css:813 |
| `.onyx-toast--danger` |  | app.css:940, ui-sheets.css:814 |
| `.onyx-toast--warning` |  | app.css:941, ui-sheets.css:815 |
| `.onyx-toast__dismiss` |  | app.css:957, ui-sheets.css:816 |
| `.guest-claim-chip` |  | app.css:967, pol-shell.css:1102 |
| `.onyx-schedule-pop` |  | app.css:1128, gap-usermodes.css:364 |
| `.onyx-member-card` |  | app.css:1579, ui-sheets.css:1468 |
| `.shell-msg-link` |  | app.css:2239, pol-thread.css:2324 |
| `.shell-msg-codeblock` |  | app.css:2250, pol-thread.css:2298 |
| `.shell-msg-codeblock code` |  | app.css:2254, pol-thread.css:2308 |
| `.shell-msg-blockquote` |  | app.css:2256, gap-appearance.css:122 |
| `.onyx-nav-btn--active .onyx-nav-icon` |  | app.css:2367, pol-shell.css:700 |
| `.onyx-nav-icon[data-icon="rooms"]` |  | app.css:2378, rx-shell.css:37 |
| `.onyx-you-close` |  | app.css:2413, ui-sheets.css:246 |
| `.onyx-coach-dismiss` |  | app.css:2552, pol-shell.css:1082 |
| `.onyx-composer .shell-command-item--active` |  | app.css:2611, pol-thread.css:1371 |
| `.onyx-composer .shell-emoji-search` |  | app.css:2631, pol-thread.css:1376 |
| `.onyx-roster .onyx-member` |  | app.css:2736, pol-roster.css:185, gap-people.css:21 |
| `.onyx-roster .onyx-member.onyx-away` |  | app.css:2737, pol-roster.css:253 |
| `.onyx-spotlight-close:focus-visible` |  | app.css:2808, ui-sheets.css:270 |
| `.onyx-shortcuts-close:focus-visible` |  | app.css:2808, ui-sheets.css:270 |
| `.onyx-spotlight-foot kbd` |  | app.css:2811, app.css:3013, ui-sheets.css:500 |
| `.onyx-spotlight` |  | app.css:2823, ui-sheets.css:434, ui-sheets.css:1066 |
| `.onyx-spotlight-backdrop` |  | app.css:2833, ui-sheets.css:435 |
| `.onyx-spotlight-panel` |  | app.css:2834, ui-sheets.css:437 |
| `.onyx-spotlight-search` |  | app.css:2858, ui-sheets.css:446 |
| `.onyx-spotlight-sigil` |  | app.css:2865, ui-sheets.css:451 |
| `.onyx-spotlight-input` |  | app.css:2866, ui-sheets.css:459 |
| `.onyx-spotlight-close` |  | app.css:2877, ui-sheets.css:246, ui-sheets.css:461 |
| `.onyx-shortcuts-close` |  | app.css:2877, ui-sheets.css:246 |
| `.onyx-dmsafe-panel` |  | app.css:2906, ui-sheets.css:1614 |
| `.onyx-spotlight-results` |  | app.css:2960, ui-sheets.css:463, ui-sheets.css:1049 |
| `.onyx-spotlight-group + .onyx-spotlight-group` |  | app.css:2967, ui-sheets.css:465 |
| `.onyx-spotlight-section` |  | app.css:2968, ui-sheets.css:464 |
| `.onyx-spotlight-option` |  | app.css:2976, ui-sheets.css:467 |
| `.onyx-spotlight-option[aria-selected="true"]` |  | app.css:2987, ui-sheets.css:475 |
| `.onyx-spotlight-icon` |  | app.css:2991, ui-sheets.css:479 |
| `.onyx-spotlight-title mark` |  | app.css:2993, ui-sheets.css:489 |
| `.onyx-spotlight-hint` |  | app.css:2994, ui-sheets.css:490 |
| `.onyx-spotlight-foot` |  | app.css:3006, ui-sheets.css:493 |
| `.oper-desk` |  | app.css:3108, gap-oper.css:23 |
| `.onyx-moddesk-sheet .moderation-cockpit__mode small` |  | app.css:3114, ui-sheets.css:1511 |
| `.onyx-jump-latest-count` |  | app.css:3165, pol-thread.css:599 |
| `.onyx-transcript--compact .onyx-thread` |  | app.css:3168, pol-thread.css:2237 |
| `.pref-action-card__icon` |  | app.css:3299, ui-sheets.css:962 |
| `.onyx-call-avatar-lg` |  | app.css:3371, calls-engine.css:162 |
| `.onyx-header-voice` |  | app.css:3382, calls-engine.css:35 |
| `.onyx-voice-chip` |  | app.css:3383, calls-engine.css:36 |
| `.onyx-voice-chip-status` |  | app.css:3389, calls-engine.css:38 |
| `.onyx-call-join` |  | app.css:3392, calls-engine.css:40 |
| `.onyx-join-banner` |  | app.css:3400, calls-engine.css:74 |
| `.onyx-join-banner-copy` |  | app.css:3406, calls-engine.css:80 |
| `.onyx-join-banner-copy strong` |  | app.css:3407, calls-engine.css:81 |
| `.onyx-join-banner-copy span` |  | app.css:3408, calls-engine.css:82 |
| `.onyx-join-banner-actions` |  | app.css:3409, calls-engine.css:83 |
| `.onyx-join-banner-hide` |  | app.css:3410, calls-engine.css:85 |
| `.onyx-call-btn` |  | app.css:3414, calls-engine.css:542 |
| `.onyx-call-stage` |  | app.css:3423, calls-engine.css:125 |
| `.onyx-call-stage-status` |  | app.css:3427, calls-engine.css:135 |
| `.onyx-call-people` |  | app.css:3432, calls-engine.css:160 |
| `.onyx-call-person` |  | app.css:3438, calls-engine.css:161 |
| `.onyx-call-name` |  | app.css:3458, calls-engine.css:163 |
| `.onyx-call-role` |  | app.css:3460, calls-engine.css:164 |
| `.onyx-call-bar` |  | app.css:3467, calls-c8.css:13, calls-engine.css:170 |
| `.onyx-call-bar-center` |  | app.css:3475, calls-engine.css:174 |
| `.onyx-cbtn` |  | app.css:3477, calls-engine.css:175 |
| `.onyx-cbtn-leave` |  | app.css:3484, calls-engine.css:177 |
| `.onyx-call-more-wrap` |  | app.css:3487, calls-engine.css:178 |
| `.onyx-call-more` |  | app.css:3488, calls-engine.css:182 |
| `.onyx-main-calls .onyx-call-stage` |  | app.css:3553, calls-engine.css:471 |
| `.onyx-join-banner` | @media (max-width: 640px) | app.css:3564, app.css:3568, calls-engine.css:110, calls-engine.css:112 |
| `.onyx-join-banner-copy` | @media (max-width: 640px) | app.css:3565, calls-engine.css:111 |
| `.onyx-call-stage` | @media (max-width: 640px) | app.css:3571, calls-engine.css:209 |
| `.onyx-call-people` | @media (max-width: 640px) | app.css:3572, calls-engine.css:215 |
| `.onyx-call-person` | @media (max-width: 640px) | app.css:3573, calls-engine.css:224 |
| `.onyx-call-bar` | @media (max-width: 640px) | app.css:3574, calls-engine.css:236 |
| `.onyx-call-bar-center` | @media (max-width: 640px) | app.css:3575, calls-engine.css:237 |
| `.onyx-cbtn-cap` | @media (max-width: 640px) | app.css:3577, calls-engine.css:242 |
| `.onyx-cbtn-leave` | @media (max-width: 640px) | app.css:3578, calls-engine.css:243 |
| `.onyx-frame` |  | app.css:3601, pol-ios.css:64, pol-ios.css:82 |
| `.onyx-frame > .onyx-primary-nav` |  | app.css:3615, pol-shell.css:670 |
| `.onyx-frame > .onyx-topbar` |  | app.css:3626, pol-shell.css:573 |
| `.onyx-frame > .onyx-rail` |  | app.css:3629, pol-shell.css:722 |
| `.onyx-primary-nav .onyx-nav-btn` |  | app.css:3670, pol-shell.css:676 |
| `.notif-center__head` |  | app.css:3792, pol-shell.css:47 |
| `.notif-center__filters` |  | app.css:3794, pol-shell.css:59 |
| `.notif-center__list` |  | app.css:3795, pol-shell.css:88 |
| `.onyx-room-header` |  | app.css:3813, roomsettings.css:9 |
| `.onyx-room-more-menu > button` |  | app.css:3875, pol-shell.css:978 |
| `.onyx-sheet-layer` |  | app.css:3897, ui-sheets.css:79, ui-sheets.css:1066 |
| `.onyx-sheet-layer[data-placement="side"]` |  | app.css:3907, ui-sheets.css:135 |
| `.onyx-sheet-backdrop` |  | app.css:3912, ui-sheets.css:81 |
| `.onyx-sheet-layer > .onyx-sheet` |  | app.css:3937, ui-sheets.css:86 |
| `.onyx-sheet-layer[data-placement="side"] > .onyx-sheet` |  | app.css:3944, ui-sheets.css:137 |
| `.onyx-sheet-close` |  | app.css:3977, ui-sheets.css:246 |
| `.onyx-frame > .onyx-rail` | @media (max-width: 599.98px) | app.css:4050, pol-shell.css:1313 |
| `.onyx-frame > .onyx-mobile-nav` | @media (max-width: 599.98px) | app.css:4055, pol-shell.css:1411, pol-ios.css:91 |
| `.onyx-mobile-nav .onyx-nav-btn` | @media (max-width: 599.98px) | app.css:4066, pol-shell.css:1416 |
| `:root` | @media (prefers-reduced-motion | app.css:4101, gap-appearance.css:130 |
| `:root[data-reduce-motion='true']` |  | app.css:4117, gap-appearance.css:137 |
| `.ap-lede` |  | pol-studio.css:93, gap-oper.css:420 |
| `.notif-center .notif-center__filter[aria-pressed="true"]` |  | pol-shell.css:76, ui-sheets.css:534 |
| `.notif-center .notif-center__open` |  | pol-shell.css:101, ui-sheets.css:552 |
| `.notif-center .notif-center__dismiss` |  | pol-shell.css:161, ui-sheets.css:554 |
| `.chb .chb-sort-btn[aria-pressed="true"]` |  | pol-shell.css:304, ui-sheets.css:746 |
| `.onyx-voice-chip-count` |  | pol-shell.css:334, calls-engine.css:37 |
| `.onyx-profile-pop:not(.onyx-sheet-layer)` |  | pol-shell.css:411, ui-sheets.css:1089 |
| `.onyx-profile-pop:not(.onyx-sheet-layer) > .onyx-member-card` |  | pol-shell.css:424, ui-sheets.css:1091 |
| `.onyx-sheet.onyx-you > .onyx-you-head` |  | pol-shell.css:1044, ui-sheets.css:614 |
| `.onyx-mobile-nav .onyx-nav-badge` | @media (max-width: 599.98px) | pol-shell.css:1434, rx-shell.css:374 |
| `.onyx-call-captions-copy` |  | calls-c8.css:71, calls-engine.css:548 |
| `.onyx-call-caption-translate` |  | calls-c8.css:71, calls-c8.css:85, calls-engine.css:548 |
| `.onyx-vs-btn` |  | calls-c8.css:118, calls-engine.css:546 |
| `.onyx-vs-btn` | @media (max-width: 767px) | calls-c8.css:132, calls-engine.css:554 |
| `.onyx-stage-hand-row .onyx-call-btn` |  | calls-c11.css:107, calls-engine.css:547 |
| `.onyx-tile` | @media (prefers-reduced-motion | calls-c11.css:170, calls-c4.css:144 |
| `.onyx-tile-video` | @media (prefers-reduced-motion | calls-c11.css:170, calls-c4.css:144 |
| `.onyx-call-pip-card` | @media (prefers-reduced-motion | calls-c11.css:170, calls-c6.css:273 |
| `.onyx-call-ring-actions .onyx-call-btn` |  | calls-c6.css:64, calls-engine.css:544 |
| `.onyx-call-pip-btn` |  | calls-c6.css:184, calls-engine.css:545 |
| `.onyx-call-pip-card` | @media (max-width: 767px) | calls-c6.css:198, calls-engine.css:499 |
| `.onyx-call-pip-card[data-corner]` | @media (max-width: 767px) | calls-c6.css:198, calls-engine.css:499 |
| `.onyx-call-pip-handle` | @media (max-width: 767px) | calls-c6.css:208, calls-engine.css:509 |
| `.onyx-call-pip-body` | @media (max-width: 767px) | calls-c6.css:210, calls-engine.css:505 |
| `.onyx-call-pip-faces` | @media (max-width: 767px) | calls-c6.css:211, calls-engine.css:506 |
| `.onyx-call-pip-btn` | @media (max-width: 767px) | calls-c6.css:212, calls-engine.css:507, calls-engine.css:550 |
| `.onyx-call-ring-actions .onyx-call-btn` | @media (max-width: 767px) | calls-c6.css:243, calls-engine.css:551 |
| `.onyx-call-lost .onyx-call-btn` | @media (max-width: 767px) | calls-c6.css:269, calls-engine.css:552 |
| `.onyx-cq-prompt .onyx-call-btn` |  | calls-c4.css:55, calls-engine.css:543 |
| `.onyx-call-video` |  | calls-c4.css:70, calls-engine.css:342 |
| `.onyx-call-grid` |  | calls-c4.css:71, calls-engine.css:343 |
| `.onyx-call-grid[data-columns="1"]` |  | calls-c4.css:72, calls-engine.css:334, calls-engine.css:343 |
| `.onyx-call-grid[data-columns="2"]` |  | calls-c4.css:73, calls-engine.css:335 |
| `.onyx-call-grid[data-columns="3"]` |  | calls-c4.css:74, calls-engine.css:336 |
| `.onyx-call-grid[data-columns="4"]` |  | calls-c4.css:75, calls-engine.css:337 |
| `.onyx-tile` |  | calls-c4.css:82, calls-engine.css:353 |
| `.onyx-tile-nick` |  | calls-c4.css:102, calls-c4.css:111, calls-engine.css:350 |
| `.onyx-call-primary` |  | calls-c4.css:136, calls-engine.css:348 |
| `.onyx-call-primary > .onyx-tile` |  | calls-c4.css:137, calls-engine.css:349 |
| `.onyx-call-grid[data-columns="2"]` | @media (max-width: 767px) | calls-c4.css:152, calls-engine.css:371 |
| `.onyx-call-grid[data-columns="3"]` | @media (max-width: 767px) | calls-c4.css:152, calls-engine.css:371 |
| `.onyx-call-grid[data-columns="4"]` | @media (max-width: 767px) | calls-c4.css:152, calls-engine.css:371 |
| `.onyx-call-grid > .onyx-tile` | @media (max-width: 767px) | calls-c4.css:155, calls-engine.css:379 |
| `.onyx-frame > .onyx-main > .onyx-composer` | @media (min-width: 600px) | gap-convo.css:325, rx-shell.css:614 |
| `:root` | @media (min-width: 600px) and  | rx-shell.css:388, ui-sheets.css:1142 |
| `:root` | @media (max-height: 520px) | gap-watch.css:585, ui-sheets.css:1178 |

### G13.3 Same-file duplicates

| selector | context | occurrences | conflicting props |
|---|---|---|---|
| `.onyx-topbar` |  | app.css:228, app.css:3708 | gap, padding |
| `.onyx-gem` |  | app.css:246, app.css:4012 | background |
| `.onyx-conn-live` |  | app.css:288, app.css:4013 | color |
| `.onyx-conn-live .onyx-dot` |  | app.css:289, app.css:4014 | background |
| `.onyx-reconnect-online` |  | app.css:329, app.css:4015 | color |
| `.onyx-reconnect-online .onyx-reconnect-dot` |  | app.css:330, app.css:4016 | background |
| `.onyx-rail` |  | app.css:411, app.css:417 |  |
| `.onyx-thread` |  | app.css:431, app.css:674 |  |
| `.onyx-newmsg-mark` |  | app.css:618, app.css:4031 | color |
| `.onyx-newmsg-secondary` |  | app.css:653, app.css:660 |  |
| `.onyx-newmsg-primary` |  | app.css:653, app.css:661 |  |
| `.onyx-thread-pane` |  | app.css:666, app.css:3140 |  |
| `.onyx-message` |  | app.css:676, app.css:1434 |  |
| `.onyx-member-prefix` |  | app.css:740, app.css:4018 | color |
| `.onyx-composer-target` |  | app.css:757, app.css:4020 | color |
| `.onyx-calls-toggle-open` |  | app.css:810, app.css:3750 | border-color, color |
| `.onyx-account-totp-enroll` |  | app.css:1279, app.css:1319 |  |
| `.onyx-account-passkey-rename` |  | app.css:1279, app.css:1348 |  |
| `.onyx-msg-menu` |  | app.css:1451, app.css:1688 |  |
| `.onyx-member-identity` |  | app.css:1590, app.css:2751 |  |
| `.onyx-member-pronouns` |  | app.css:1604, app.css:1605 |  |
| `.onyx-member-status` |  | app.css:1604, app.css:1605 |  |
| `.onyx-member-guest` |  | app.css:1604, app.css:1606 |  |
| `.onyx-member-dot` |  | app.css:1608, app.css:4019 | background |
| `.onyx-msg-menu-delete-confirm-cancel` |  | app.css:1678, app.css:1685 |  |
| `.onyx-msg-menu-delete-confirm-delete` |  | app.css:1678, app.css:1686 |  |
| `.conn-cancel` |  | app.css:2102, app.css:2111 | padding |
| `.conn-alt-btn` |  | app.css:2102, app.css:2115 | background, padding |
| `.onyx-leave` |  | app.css:2102, app.css:2234 | padding |
| `.onyx-notify-toggle-open` |  | app.css:2270, app.css:3750 | border-color, color |
| `.onyx-home-privacy` |  | app.css:2478, app.css:2479 | color, font-size |
| `.onyx-home-announce` |  | app.css:2481, app.css:4022 | color |
| `.onyx-home-row-meta` |  | app.css:2515, app.css:4024 | color |
| `.onyx-home-count` |  | app.css:2526, app.css:4022 | color |
| `.onyx-coach` |  | app.css:2546, app.css:4026 |  |
| `.onyx-coach-eyebrow` |  | app.css:2550, app.css:4024 | color |
| `.shell-command-menu` |  | app.css:2581, app.css:2589 |  |
| `.shell-emoji-picker` |  | app.css:2581, app.css:2622 |  |
| `.onyx-composer .shell-composer-tool--emoji[aria-expanded="true"]` |  | app.css:2661, app.css:4028 | border-color |
| `.boost-pill.you` |  | app.css:2671, app.css:4027 | border-color |
| `.onyx-shortcuts-sheet` |  | app.css:2834, app.css:3015 |  |
| `.onyx-dmsafe-trigger[aria-expanded="true"]` |  | app.css:2891, app.css:4028 | border-color |
| `.onyx-keychange-kicker` |  | app.css:2932, app.css:3205 | color |
| `.onyx-moddesk-toggle[aria-pressed="true"]` |  | app.css:3056, app.css:4028 | border-color |
| `.onyx-moddesk-sheet .moderation-cockpit__modes` |  | app.css:3110, app.css:3112 |  |
| `.onyx-keychange-accept` |  | app.css:3218, app.css:3226 |  |
| `.onyx-keychange-dismiss` |  | app.css:3218, app.css:3228 |  |
| `:root[data-reduce-motion='true'] *` |  | app.css:3314, app.css:4124 |  |
| `:root[data-reduce-motion='true'] *::before` |  | app.css:3314, app.css:4124 |  |
| `:root[data-reduce-motion='true'] *::after` |  | app.css:3314, app.css:4124 |  |
| `:root[data-high-contrast='true']` |  | gap-appearance.css:43, gap-appearance.css:86 |  |
| `:root[data-density='compact'] .onyx-message:not(.onyx-message--compact):not(.onyx-continua` |  | gap-appearance.css:166, gap-appearance.css:187 |  |
| `:root[data-density='roomy'] .onyx-message:not(.onyx-message--compact):not(.onyx-continuati` |  | gap-appearance.css:174, gap-appearance.css:191 |  |
| `.status-quiet-link` |  | pol-stats.css:205, pol-stats.css:247 |  |
| `.status-hero` | @media (max-width: 767px) | pol-stats.css:993, pol-stats.css:996 |  |
| `.roadmap-hero` | @media (max-width: 767px) | pol-stats.css:993, pol-stats.css:997 |  |
| `.stats-page .data-hero.stats-hero` | @media (max-width: 767px) | pol-stats.css:993, pol-stats.css:998 |  |
| `.status-quiet-link` | @media (max-width: 767px) | pol-stats.css:1001, pol-stats.css:1004 |  |
| `.stats-page .stats-feed-step:last-child` | @media (max-width: 767px) | pol-stats.css:1016, pol-stats.css:1019 | border-bottom |
| `.stats-page .stats-inspector-metrics > div` | @media (max-width: 400px) | pol-stats.css:1042, pol-stats.css:1044 | padding-inline |
| `.ap-wrap` |  | pol-studio.css:75, pol-studio.css:1796 | max-width |
| `.ap-studio` |  | pol-studio.css:407, pol-studio.css:475 |  |
| `.background-picker__meta` |  | pol-studio.css:569, pol-studio.css:576 | color |
| `.ts-preview-pane` |  | pol-studio.css:1212, pol-studio.css:1837 |  |
| `.ts-pv-side` |  | pol-studio.css:1267, pol-studio.css:1277 |  |
| `.ts-pv-members` |  | pol-studio.css:1267, pol-studio.css:1278 |  |
| `.ts-pv-members__head` |  | pol-studio.css:1293, pol-studio.css:1303 |  |
| `.ts-footer__right` |  | pol-studio.css:1640, pol-studio.css:1649 |  |
| `.ts-editor` | @media (max-width: 768px) | pol-studio.css:1681, pol-studio.css:1692 |  |
| `.onyx-account-persona-wear` |  | pol-shell.css:231, pol-shell.css:251 |  |
| `.onyx-calls-leave` |  | pol-shell.css:311, pol-shell.css:329 | color, background |
| `.onyx-room-settings-toggle` |  | pol-shell.css:380, pol-shell.css:560 |  |
| `.onyx-pins-toggle` |  | pol-shell.css:380, pol-shell.css:561 |  |
| `.onyx-media-toggle` |  | pol-shell.css:380, pol-shell.css:562 |  |
| `.onyx-jump-toggle` |  | pol-shell.css:380, pol-shell.css:563 |  |
| `.onyx-scrubber-toggle` |  | pol-shell.css:380, pol-shell.css:564 |  |
| `.onyx-topbar .onyx-palette-launcher::before` |  | pol-shell.css:544, pol-shell.css:599 | width, height |
| `.onyx-room-more-alerts .room-notify-name::before` |  | pol-shell.css:544, pol-shell.css:1006 |  |
| `.onyx-topbar .onyx-palette-launcher` |  | pol-shell.css:556, pol-shell.css:588 |  |
| `.onyx-room-more-alerts .room-notify-name` |  | pol-shell.css:557, pol-shell.css:997 |  |
| `.onyx-rail .onyx-rail-label` |  | pol-shell.css:773, pol-shell.css:776 |  |
| `.onyx-rail .onyx-rail-label` | @media (max-width: 599.98px) | pol-shell.css:1332, pol-shell.css:1334 |  |
| `.onyx-rail-row .onyx-rail-sub` | @media (max-width: 599.98px) | pol-shell.css:1382, pol-shell.css:1384 | display |
| `.onyx-edited` |  | pol-thread.css:163, pol-thread.css:170 |  |
| `.onyx-react-pop .onyx-react-picker` |  | pol-thread.css:267, pol-thread.css:277, pol-thread.css:315 |  |
| `.onyx-msg-menu-pop .onyx-msg-menu` |  | pol-thread.css:277, pol-thread.css:285 |  |
| `.onyx-msg-menu .onyx-msg-menu-item[aria-label$="for everyone"]` |  | pol-thread.css:306, pol-thread.css:308 |  |
| `.onyx-msg-menu-pop .onyx-msg-menu` | @media (min-width: 768px) | pol-thread.css:348, pol-thread.css:2358 |  |
| `.onyx-message .onyx-body` |  | pol-thread.css:451, pol-thread.css:2296 |  |
| `.onyx-transcript--compact .onyx-system` |  | pol-thread.css:495, pol-thread.css:2280 | padding-left |
| `.onyx-transcript--compact ~ .onyx-typing` |  | pol-thread.css:582, pol-thread.css:2281 | padding-left |
| `.onyx-room-intro-face` |  | pol-thread.css:609, pol-thread.css:621 | background, border |
| `.shell-msg-media-img` |  | pol-thread.css:689, pol-thread.css:700 |  |
| `.shell-msg-media-video` |  | pol-thread.css:689, pol-thread.css:701 |  |
| `.shell-msg-media-audio` |  | pol-thread.css:689, pol-thread.css:702 |  |
| `.shell-msg-file` |  | pol-thread.css:733, pol-thread.css:2326 |  |
| `.shell-msg-preview` |  | pol-thread.css:767, pol-thread.css:2325 |  |
| `.shell-msg-preview-title` |  | pol-thread.css:789, pol-thread.css:796 |  |
| `.shell-msg-preview-desc` |  | pol-thread.css:789, pol-thread.css:798 |  |
| `.shell-msg-preview-thumb` |  | pol-thread.css:799, pol-thread.css:808 |  |
| `.shell-msg-preview-consent` |  | pol-thread.css:799, pol-thread.css:809 |  |
| `.shell-msg-lightbox-zoom` |  | pol-thread.css:901, pol-thread.css:921 | padding |
| `.shell-msg-lightbox-close` |  | pol-thread.css:901, pol-thread.css:921 | padding |
| `.onyx-thread-sheet .onyx-thread-head` |  | pol-thread.css:983, pol-thread.css:2139 |  |
| `.onyx-thread-sheet .onyx-thread-close` |  | pol-thread.css:997, pol-thread.css:2144 | width, height |
| `.onyx-thread-sheet .onyx-thread-msg-text` |  | pol-thread.css:1036, pol-thread.css:2141 |  |
| `.onyx-composer .shell-command-menu` |  | pol-thread.css:1356, pol-thread.css:1358 |  |
| `.onyx-composer .shell-emoji-picker` |  | pol-thread.css:1356, pol-thread.css:1375 |  |
| `.onyx-composer .shell-command-menu` | @media (max-width: 767.98px) | pol-thread.css:1404, pol-thread.css:1411 |  |
| `.onyx-message-search__surface` |  | pol-thread.css:1433, pol-thread.css:1437 |  |
| `.onyx-message-search__body` |  | pol-thread.css:1433, pol-thread.css:1505 |  |
| `.onyx-message-search__button--close` |  | pol-thread.css:1500, pol-thread.css:1502 |  |
| `.onyx-message-search__saved` |  | pol-thread.css:1533, pol-thread.css:1544 |  |
| `.onyx-message-search__recall` |  | pol-thread.css:1533, pol-thread.css:1586 |  |
| `.onyx-message-search__server` |  | pol-thread.css:1533, pol-thread.css:1544 |  |
| `.onyx-message-search__vault` |  | pol-thread.css:1533, pol-thread.css:1544 |  |
| `.onyx-message-search__history-off` |  | pol-thread.css:1533, pol-thread.css:1547 |  |
| `.onyx-message-search__vault-mode` |  | pol-thread.css:1564, pol-thread.css:1580 |  |
| `.onyx-message-search__saved-run` |  | pol-thread.css:1637, pol-thread.css:1655 |  |
| `.onyx-message-search__server-row` |  | pol-thread.css:1637, pol-thread.css:1656 |  |
| `.pins-ledger` |  | pol-thread.css:1924, pol-thread.css:1931 |  |
| `.pins-item-body--missing` |  | pol-thread.css:1989, pol-thread.css:1992 |  |
| `.pins-item-body--deleted` |  | pol-thread.css:1989, pol-thread.css:1992 |  |
| `.onyx-message--compact.onyx-message-search-current` |  | pol-thread.css:2276, pol-thread.css:2278 | box-shadow |
| `.onyx-frame .room-media-index button.room-media-index-close` | @media (pointer: coarse), (hov | pol-thread.css:2486, pol-thread.css:2492 |  |
| `.onyx-frame .pins-panel button.pins-close` | @media (pointer: coarse), (hov | pol-thread.css:2486, pol-thread.css:2492 |  |
| `.onyx-frame .pins-panel button.pins-item-unpin` | @media (pointer: coarse), (hov | pol-thread.css:2486, pol-thread.css:2492 |  |
| `.onyx-frame .onyx-thread-pane button.topic-chip` |  | pol-thread.css:2519, pol-thread.css:2536 |  |
| `.onyx-frame .onyx-thread-pane button.shell-topic-card-follow` |  | pol-thread.css:2519, pol-thread.css:2545 |  |
| `.onyx-roster .onyx-roster-head` |  | pol-roster.css:42, pol-roster.css:420 | position, min-height |
| `.onyx-mlist-close` |  | pol-roster.css:67, pol-roster.css:85 | display |
| `.onyx-roster .onyx-roster-filter` |  | pol-roster.css:90, pol-roster.css:429 | margin |
| `.onyx-roster .onyx-roster-filter-input` |  | pol-roster.css:102, pol-roster.css:441 | min-height |
| `.onyx-roster .onyx-roster-filter:not(.onyx-roster-filter--open):not(:focus-within)` |  | pol-roster.css:117, pol-roster.css:440 |  |
| `.onyx-roster-group:not([open]) > .onyx-mlist-group-head > .pt-ico` |  | pol-roster.css:176, pol-roster.css:179 |  |
| `.onyx-roster .onyx-mlist-rows` |  | pol-roster.css:181, pol-roster.css:453 |  |
| `.onyx-mlist-main:focus-visible` |  | pol-roster.css:212, pol-roster.css:217 |  |
| `.onyx-roster:popover-open .onyx-mlist-main` | @media (max-width: 599.98px) | pol-roster.css:401, pol-roster.css:403 |  |
| `.onyx-roster .onyx-mlist-groups` |  | pol-roster.css:448, pol-roster.css:453 |  |
| `.public-frame__footer-inner` |  | pol-public.css:203, pol-public.css:1811 |  |
| `.not-found-page__action` |  | pol-public.css:407, pol-public.css:437, pol-public.css:1623 | color, background |
| `.guides-copy` |  | pol-public.css:407, pol-public.css:1248 | min-height, padding |
| `.guides-download` |  | pol-public.css:407, pol-public.css:1248 | min-height, padding |
| `.guides-reset` |  | pol-public.css:407, pol-public.css:1248, pol-public.css:1256 | min-height, padding, color |
| `.pub-refresh` |  | pol-public.css:456, pol-public.css:467 |  |
| `.onyx-land-open` |  | pol-public.css:528, pol-public.css:541 |  |
| `.onyx-land-link` |  | pol-public.css:528, pol-public.css:543 |  |
| `.onyx-land-sketch-log` | @media (max-width: 600px) | pol-public.css:785, pol-public.css:787 |  |
| `.onyxos-source` |  | pol-public.css:1449, pol-public.css:1512 |  |
| `.onyxos-workbench` |  | pol-public.css:1449, pol-public.css:1542 |  |
| `.onyxos-source` | @media (max-width: 768px) | pol-public.css:1563, pol-public.css:1573 |  |
| `.onyxos-workbench` | @media (max-width: 768px) | pol-public.css:1563, pol-public.css:1573 |  |
| `.onyx-call-react-item:focus-visible` |  | calls-c8.css:34, calls-c8.css:35 |  |
| `.shell-composer-tools` |  | polish.css:34, polish.css:392 |  |
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
| `.onyx-composer .gap-attach-quality-opt` | @media (pointer: coarse) | gap-convo.css:168, gap-convo.css:170 |  |
| `.onyx-composer .gap-attach-keep` | @media (pointer: coarse) | gap-convo.css:168, gap-convo.css:171 |  |
| `.gap-skeleton-avatar` |  | gap-convo.css:278, gap-convo.css:288 |  |
| `.gap-skeleton-name` |  | gap-convo.css:280, gap-convo.css:282, gap-convo.css:288 | background |
| `.gap-skeleton-line` |  | gap-convo.css:280, gap-convo.css:283, gap-convo.css:288 |  |
| `.oc-meta-inline` |  | gap-oper.css:110, gap-oper.css:111 |  |
| `.onyx-moddesk-sheet .oper-desk .oc-input-mono` |  | gap-oper.css:114, gap-oper.css:198 |  |
| `.oc-wire` |  | gap-oper.css:114, gap-oper.css:248 |  |
| `.oc-list` |  | gap-oper.css:345, gap-oper.css:346 |  |
| `.oc-members` |  | gap-oper.css:345, gap-oper.css:367 |  |
| `.oc-plain` |  | gap-oper.css:345, gap-oper.css:369 |  |
| `.oc-tags` |  | gap-oper.css:345, gap-oper.css:355 |  |
| `.ap-hint` |  | gap-oper.css:420, gap-oper.css:421 | font-size, color |
| `.onyx-rail .onyx-rail-row > .onyx-rail-star` | @media (hover: hover) | rx-shell.css:88, rx-shell.css:99 |  |
| `.onyx-rail .onyx-rail-row > .onyx-rail-more` | @media (hover: hover) | rx-shell.css:88, rx-shell.css:97 |  |
| `.onyx-rail .onyx-rail-entry > .onyx-rail-more` | @media (hover: hover) | rx-shell.css:88, rx-shell.css:97 |  |
| `.onyx-railmenu-head .onyx-railmenu-tile` |  | rx-shell.css:150, rx-shell.css:162 |  |
| `.onyx-railmenu-head .onyx-railmenu-face` |  | rx-shell.css:150, rx-shell.css:163 | font-size |
| `.onyx-frame[data-calls="true"] > .onyx-topbar` | @media (min-width: 600px) and  | rx-shell.css:484, rx-shell.css:495 |  |
| `.hi-note` |  | gap-import.css:88, gap-import.css:102 |  |
| `.hi-review-foot` |  | gap-import.css:228, gap-import.css:244 |  |
| `.hi-dest-input` | @media (hover: none), (pointer | gap-import.css:448, gap-import.css:453 |  |
| `.bk-select-input` | @media (hover: none), (pointer | gap-import.css:448, gap-import.css:453 |  |
| `.gorg-menu-face` |  | gap-organize.css:223, gap-organize.css:235 | border-radius |
| `.gorg-input` |  | gap-organize.css:423, gap-organize.css:435 |  |
| `.gorg-select` |  | gap-organize.css:423, gap-organize.css:436 |  |
| `.gorg-textarea` |  | gap-organize.css:423, gap-organize.css:437 |  |
| `.gorg-note-input` |  | gap-organize.css:423, gap-organize.css:437 |  |
| `.gorg-tucked-name--static` | @media (max-width: 767.98px) | gap-organize.css:732, gap-organize.css:733 |  |
| `.gorg-textarea` | @media (max-width: 767.98px) | gap-organize.css:738, gap-organize.css:742 |  |
| `.gorg-note-input` | @media (max-width: 767.98px) | gap-organize.css:738, gap-organize.css:742 |  |
| `.um-input` | @media (hover: none), (pointer | gap-usermodes.css:393, gap-usermodes.css:399 |  |
| `.um-list__row` | @media (hover: none), (pointer | gap-usermodes.css:393, gap-usermodes.css:401 |  |
| `.onyx-watch-glyph` |  | gap-watch.css:72, gap-watch.css:93 | background, cursor |
| `.onyx-watch-honest` |  | gap-watch.css:321, gap-watch.css:330 |  |
| `.onyx-watch-heading` | @media (max-height: 520px) | gap-watch.css:593, gap-watch.css:601 |  |
| `.gs-activity-foot` |  | gap-shell.css:189, gap-shell.css:191 | font-size, color |
| `.gc-btn` |  | gap-claim.css:104, gap-claim.css:121 |  |
| `:root` | @media (max-width: 599.98px) | ui-sheets.css:322, ui-sheets.css:1070 | --sheet-max-h |
| `.onyx-sheet-layer > .onyx-sheet` | @media (max-width: 599.98px) | ui-sheets.css:334, ui-sheets.css:1073 | padding-bottom |
| `.onyx-sheet-layer[data-placement] > .onyx-sheet` | @media (max-width: 599.98px) | ui-sheets.css:334, ui-sheets.css:1073 | padding-bottom |
| `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet` | @media (max-width: 599.98px) | ui-sheets.css:347, ui-sheets.css:397 |  |
| `.onyx-you .onyx-you-group__title` |  | ui-sheets.css:630, ui-sheets.css:631 |  |
| `.onyx-prefs .pref-category-content` |  | ui-sheets.css:696, ui-sheets.css:1049 |  |
| `.onyx-toaster` | @media (max-width: 767.98px) | ui-sheets.css:819, ui-sheets.css:1081 | bottom |
| `.onyx-prefs .pref-category-nav` | @media (max-width: 640px), (ma | ui-sheets.css:887, ui-sheets.css:902 |  |
| `.onyx-prefs .pref-category-nav__landmark` | @media (max-width: 640px), (ma | ui-sheets.css:903, ui-sheets.css:907 |  |
| `.onyx-room-more-menu` | @media (max-width: 599.98px) | ui-sheets.css:988, ui-sheets.css:1077 | bottom |
| `.onyx-sheet .rset-toggle-track` |  | ui-sheets.css:1317, ui-sheets.css:1347 |  |
| `.onyx-call-join` | @media (hover: none) | calls-engine.css:49, calls-engine.css:51 |  |
| `.onyx-call-meta .onyx-sec-chip` |  | calls-engine.css:144, calls-engine.css:577 |  |
| `.onyx-call-bar-center > .onyx-cbtn` | @container onyx-call (max-widt | calls-engine.css:198, calls-engine.css:200 |  |
| `.onyx-call-bar-center > .onyx-cbtn` | @media (max-width: 640px) | calls-engine.css:238, calls-engine.css:240 |  |
| `.onyx-call-people` | @media (max-height: 620px) and | calls-engine.css:281, calls-engine.css:290 | gap |
| `.onyx-call-people[data-density]` | @media (max-height: 620px) and | calls-engine.css:281, calls-engine.css:290 | gap |
| `.onyx-call-bar-center > .onyx-cbtn` | @media (max-height: 500px) | calls-engine.css:318, calls-engine.css:320 |  |
| `.onyx-call-grid` | @media (max-width: 767px) | calls-engine.css:369, calls-engine.css:378 |  |
| `.onyx-call-pip-card` | @media (max-height: 500px) and | calls-engine.css:514, calls-engine.css:521 | width |
| `.onyx-call-pip-card[data-corner]` | @media (max-height: 500px) and | calls-engine.css:514, calls-engine.css:521 | width |

## G14. Classes painted by more than one file

507 classes are the key (rightmost) element of rules in two or more files (rule count in parentheses; every rule location is in style-map.json `multiFileClasses`).

| files | classes |
|---|---|
| app.css + ui-sheets.css | `.notify-toggle` (9) `.onyx-you-link` (9) `.onyx-spotlight-panel` (9) `.onyx-prefs` (8) `.pref-category-tab` (8) `.onyx-spotlight-close` (7) `.onyx-spotlight` (7) `.onyx-shortcuts-sheet` (7) `.onyx-spotlight-option` (7) `.onyx-account` (6) `.onyx-spotlight-hint` (6) `.onyx-account-nav__item` (5) `.onyx-shortcuts-close` (5) `.onyx-spotlight-input` (5) `.onyx-prefs-body` (5) `.pref-category-nav` (5) `.pref-category-content` (5) `.chb-skin` (4) `.onyx-account-nav` (4) `.onyx-account-section` (4) `.onyx-member-identity` (4) `.onyx-you` (4) `.onyx-you-close` (4) `.onyx-you-leave` (4) `.jump-to-date-close` (4) `.onyx-member-action--primary` (4) `.onyx-spotlight-search` (4) `.onyx-spotlight-results` (4) `.pref-category-tabs` (4) `.onyx-sheet-title` (4) `.onyx-toast__dismiss` (3) `.chb-filter` (3) `.chb-sort` (3) `.chb-topic` (3) `.onyx-account-drop-confirm` (3) `.onyx-member-pronouns` (3) `.onyx-member-ledger` (3) `.onyx-member-confirm` (3) `.onyx-you-identity` (3) `.onyx-you-group__title` (3) `.onyx-spotlight-backdrop` (3) `.onyx-spotlight-foot` (3) `.pref-category-tab__summary` (3) `.onyx-reclaim-lead` (2) `.onyx-newmsg-sheet` (2) `.onyx-newmsg-actions` (2) `.onyx-toast` (2) `.onyx-toast--success` (2) `.onyx-toast--danger` (2) `.onyx-toast--warning` (2) `.guest-claim-sheet__form` (2) `.guest-claim-sheet__hint` (2) `.chb-toolbar` (2) `.chb-status` (2) `.chb-list` (2) `.chb-name` (2) `.chb-pill` (2) `.chb-count` (2) `.chb-count--live` (2) `.chb-ledger` (2) `.chb-join` (2) `.chb-create` (2) `.chb-skins` (2) `.chb-create-actions` (2) `.onyx-scheduled-empty` (2) `.onyx-account-section__title` (2) `.onyx-profile-nick` (2) `.onyx-profile-account` (2) `.onyx-member-name` (2) `.onyx-member-nickline` (2) `.onyx-member-actions` (2) `.onyx-moderation-actions` (2) `.notify-group` (2) `.onyx-you-nick` (2) `.onyx-you-desc` (2) `.onyx-you-lede` (2) `.onyx-you-group` (2) `.onyx-you-group__hint` (2) `.onyx-you-leave-row` (2) `.jump-to-date-head` (2) `.jump-to-date-title` (2) `.onyx-spotlight-sigil` (2) `.onyx-dmsafe-panel` (2) `.onyx-spotlight-group` (2) `.onyx-spotlight-section` (2) `.onyx-spotlight-title` (2) `.shortcuts-overlay` (2) `.shortcuts-overlay__row` (2) `.onyx-moddesk-close` (2) `.onyx-invshare-preview` (2) `.onyx-invshare-url` (2) `.pref-category-tab__label` (2) `.pref-action-card__icon` (2) `.notif-center` (2) |
| app.css + pol-thread.css | `.boost-pill` (11) `.topic-chip` (10) `.onyx-msg-menu-trigger` (10) `.onyx-msg-menu` (10) `.onyx-msg-menu-item` (10) `.onyx-thread-indicator` (9) `.onyx-react-picker` (9) `.shell-topic-action` (8) `.shell-topic-card-follow` (8) `.is-active` (8) `.shell-command-menu` (8) `.shell-topic-follow` (7) `.onyx-audience-toggle` (7) `.onyx-react-choice` (7) `.boost-add` (7) `.shell-emoji-choice` (6) `.onyx-jump-latest` (6) `.onyx-system` (5) `.onyx-thread-sheet` (5) `.shell-topic-create-input` (5) `.topic-filter-bar` (5) `.onyx-react-search` (5) `.shell-emoji-picker` (5) `.shell-command-item` (5) `.shell-emoji-search` (5) `.shell-emoji-grid` (5) `.onyx-topic-tools` (4) `.onyx-thread` (4) `.onyx-sender` (4) `.onyx-react-grid` (4) `.shell-msg-codeblock` (4) `.shell-composer-tool--emoji` (4) `.onyx-thread-head` (3) `.onyx-thread-msg-text` (3) `.shell-topic-actions` (3) `.shell-topic-card` (3) `.shell-topic-card-main` (3) `.shell-topic-card-meta` (3) `.shell-topic-card-preview` (3) `.topic-chip__unread` (3) `.onyx-topic` (3) `.onyx-composer-target` (3) `.shell-msg-spoiler` (3) `.shell-command-usage` (3) `.boost-bar` (3) `.you` (3) `.boost-count` (3) `.onyx-jump-latest--unread` (3) `.onyx-day-divider-label` (2) `.onyx-thread-title` (2) `.onyx-thread-desc` (2) `.onyx-thread-msg` (2) `.onyx-thread-msg-from` (2) `.onyx-thread-state` (2) `.shell-topic-create` (2) `.shell-topic-forum` (2) `.shell-topic-card-title` (2) `.shell-topic-card-author` (2) `.onyx-audience-toggle-set` (2) `.onyx-composer-error` (2) `.onyx-msg-menu-delete-confirm` (2) `.onyx-msg-menu-backdrop` (2) `.shell-msg-text` (2) `.shell-msg-link` (2) `.shell-msg-codeblock-lang` (2) `.onyx-feed-empty` (2) `.onyx-feed-empty-title` (2) `.onyx-feed-empty-body` (2) `.shell-command-item--active` (2) `.shell-command-desc` (2) `.boost-emoji` (2) `.onyx-jump-latest-count` (2) |
| app.css + pol-shell.css | `.onyx-rail-sub` (8) `.onyx-rail-name` (7) `.onyx-dmsafe-trigger` (5) `.onyx-gem` (4) `.onyx-conn-live` (4) `.onyx-rail-section-heading` (4) `.onyx-rail-copy` (4) `.onyx-rail-unread` (4) `.guest-claim-chip__dismiss` (4) `.onyx-nav-btn--active` (4) `.onyx-home-empty` (4) `.onyx-home-action` (4) `.onyx-coach` (4) `.onyx-coach-eyebrow` (4) `.onyx-conn` (3) `.onyx-rail-section` (3) `.onyx-rail-star-on` (3) `.guest-claim-chip` (3) `.onyx-nav-btn--dialog-open` (3) `.onyx-home-empty-copy` (3) `.onyx-room-more-toggle` (3) `.shell-ribbon-badge` (3) `.onyx-room-header-id` (3) `.onyx-room-header-actions` (3) `.onyx-conn-connecting` (2) `.onyx-rail-filter-unread-on` (2) `.onyx-rail-filter-empty` (2) `.onyx-rail-mention` (2) `.onyx-rail-keywarn` (2) `.guest-claim-chip__text` (2) `.guest-claim-chip__actions` (2) `.chb-close` (2) `.onyx-account-hint` (2) `.onyx-profile-badge` (2) `.onyx-home-masthead` (2) `.onyx-home-title` (2) `.onyx-home-inbox` (2) `.onyx-home-invite` (2) `.onyx-home-rooms` (2) `.onyx-home-actions` (2) `.onyx-coach-text` (2) `.onyx-dmsafe-bar` (2) `.onyx-dmsafe-chip` (2) `.pref-action-card` (2) `.onyx-search-toggle-open` (2) `.shell-ribbon-inbox` (2) `.notif-center__head` (2) |
| app.css + pol-shell.css + rx-shell.css | `.onyx-palette-launcher` (16) `.onyx-topbar` (14) `.onyx-rail-star` (12) `.onyx-nav-btn` (12) `.onyx-nav-icon` (11) `.onyx-rail-new` (9) `.onyx-rail-browse` (9) `.shell-ribbon-bell` (9) `.onyx-rail` (8) `.onyx-rail-filter-input` (8) `.onyx-rail-time` (7) `.onyx-palette-kbd` (7) `.onyx-moddesk-toggle` (7) `.onyx-rail-active` (6) `.onyx-rail-filter-unread` (6) `.room-notify-name` (6) `.onyx-primary-nav` (6) `.onyx-brand` (5) `.onyx-rail-filter` (5) `.onyx-rail-filter-clear` (5) `.onyx-rail-empty` (5) `.guest-claim-chip__keep` (5) `.onyx-home-inner` (5) `.onyx-topbar-search` (5) `.onyx-room-header-btn` (5) `.onyx-room-header-name` (5) `.onyx-rail-meta` (4) `.onyx-rail-color` (4) `.onyx-topbar-global` (4) `.onyx-room-header-topic` (4) `.onyx-rail-row` (3) `.onyx-call-join-label` (3) |
| app.css + calls-engine.css | `.onyx-call-person` (18) `.onyx-sec-chip` (11) `.onyx-call-bar-center` (10) `.onyx-join-banner` (8) `.onyx-call-name` (8) `.onyx-call-role` (8) `.onyx-call-more` (8) `.onyx-cbtn-leave` (7) `.onyx-call-pip` (6) `.onyx-join-banner-copy` (6) `.onyx-join-banner-actions` (5) `.onyx-call-more-wrap` (5) `.onyx-join-banner-hide` (4) `.onyx-call-people-count` (4) `.onyx-calls` (3) `.onyx-call-faces` (3) `.onyx-call-stage-status` (3) `.onyx-call-where` (3) `.onyx-calls-title` (2) `.onyx-call-badge` (2) `.onyx-call-timer` (2) |
| pol-shell.css + rx-shell.css | `.onyx-shi` (37) `.onyx-ident` (11) `.onyx-rail-foot` (7) `.onyx-room-header-icon` (6) `.onyx-ident-nick` (4) `.onyx-room-more-search` (4) `.onyx-topbar-title` (4) `.onyx-nav-glyph` (4) `.onyx-nav-badge` (4) `.onyx-rail-title` (4) `.onyx-rail-tile` (4) `.onyx-room-header-titles` (4) `.onyx-search-toggle` (3) `.onyx-rail-zero` (3) `.onyx-palette-launcher-label` (3) `.onyx-rail-new-label` (3) `.onyx-room-back` (3) `.onyx-room-header-topic-row` (3) `.onyx-ident-badge` (2) `.guest-claim-chip__icon` (2) |
| pol-shell.css + ui-sheets.css | `.notif-center__dismiss` (7) `.notif-center__row` (6) `.notif-center__filter` (5) `.notif-center__glyph` (5) `.onyx-profile-pop` (5) `.notif-center__open` (4) `.notif-center__close` (3) `.notif-center__empty` (3) `.pref-category-nav__landmark` (3) `.shell-ribbon-bell-icon` (3) `.pref-reset-all` (2) `.onyx-profile-summary` (2) `.onyx-profile-backdrop` (2) |
| pol-stats.css + pol-public.css | `.r-btn` (16) `.primary` (6) `.data-hero` (6) `.label` (6) `.data-card` (4) `.r-wrap` (3) `.r-kicker` (3) `.ui-root` (2) `.r` (2) `.r-section` (2) `.sub` (2) |
| calls-c4.css + calls-engine.css | `.onyx-call-grid` (28) `.onyx-call-video` (11) `.onyx-tile-btn` (9) `.onyx-tile-tag` (5) `.onyx-tile-top` (4) `.onyx-tile-nick` (4) `.onyx-call-more-share` (3) `.onyx-tile-tag-text` (3) `.onyx-call-primary` (2) `.onyx-cbtn-share` (2) |
| app.css + pol-roster.css | `.onyx-roster-filter` (7) `.onyx-member-message` (7) `.onyx-member-presence-dot` (5) `.onyx-roster-head` (4) `.onyx-away` (3) `.onyx-roster-count` (3) `.onyx-member-presence-dot--away` (3) `.onyx-avatar--sm` (2) `.onyx-roster-empty` (2) `.onyx-member-role` (2) |
| calls-c8.css + calls-engine.css | `.onyx-call-caption-translate` (6) `.onyx-call-react-item` (5) `.onyx-call-captions-copy` (5) `.onyx-call-captions` (4) `.onyx-vs-btn` (4) `.onyx-call-more-react` (3) `.onyx-vs-select` (3) `.onyx-vs-range` (2) `.onyx-vs-toggle` (2) `.onyx-cbtn-react` (2) |
| app.css + pol-shell.css + ui-sheets.css | `.onyx-member-card` (10) `.onyx-room-more-menu` (10) `.chb-card` (7) `.chb-sort-btn` (5) `.onyx-you-head` (4) `.notif-center__filters` (4) `.onyx-account-actions` (3) `.notif-center__list` (3) `.onyx-room-more-scrim` (3) |
| calls-c6.css + calls-engine.css | `.onyx-call-pip-btn` (8) `.onyx-call-pip-faces` (5) `.onyx-call-pip-body` (4) `.onyx-call-ring-meta` (3) `.onyx-call-pip-handle` (3) `.onyx-call-pip-live` (3) `.onyx-call-pip-corner` (3) `.onyx-call-ring-sub` (2) `.onyx-call-pip-cap` (2) |
| pol-thread.css + gap-convo.css | `.onyx-attach-remove` (6) `.onyx-message-search__body` (6) `.onyx-message-search__deep` (6) `.onyx-message-search` (5) `.onyx-attach-row` (3) `.onyx-attach-status` (3) `.shell-attachment-progress` (3) `.onyx-attach-name` (2) |
| app.css + gap-oper.css | `.onyx-moddesk-hint` (3) `.onyx-moddesk-form` (3) `.oper-desk` (3) `.onyx-moddesk-eyebrow` (2) `.onyx-moddesk-offline` (2) `.onyx-moddesk-errors` (2) `.oper-event-console` (2) |
| account2.css + ui-sheets.css | `.a2-btn` (6) `.a2-input` (4) `.a2-row--fill` (3) `.a2-status` (3) `.a2-body` (2) `.a2-section` (2) |
| app.css + calls-c4.css + calls-engine.css | `.onyx-call-stage` (16) `.onyx-call-avatar-lg` (14) `.onyx-call-more-item` (10) `.onyx-cbtn-cap` (6) `.onyx-call-you` (3) |
| roomsettings.css + ui-sheets.css | `.rset-toggle-track` (5) `.rset-toggle-thumb` (5) `.rset-toggle` (4) `.rset-section` (2) `.rset-toggle-text` (2) |
| app.css + gap-usermodes.css | `.onyx-schedule-pop` (2) `.onyx-schedule-sub` (2) `.onyx-schedule-custom` (2) `.onyx-schedule-when` (2) `.onyx-scheduled-list` (2) |
| pol-thread.css + polish.css | `.shell-composer-tools-item` (15) `.shell-composer-tool--more` (6) `.shell-composer-tools-action` (4) `.shell-composer-more-wrap` (3) |
| rx-shell.css + gap-organize.css | `.onyx-railmenu-item` (8) `.gorg-menu-label` (2) `.gorg-menu-hint` (2) `.onyx-railmenu-label` (2) |
| app.css + gap-account.css | `.onyx-account-field` (5) `.pref-reset` (5) `.pref-toggle` (2) `.pref-actions` (2) |
| roomsettings.css + gap-chanserv.css | `.rset-input` (4) `.rset-access-row` (3) `.rset-select` (2) `.rset-flags` (2) |
| app.css + gap-appearance.css + pol-thread.css | `.onyx-day-divider` (8) `.onyx-message--compact` (8) `.shell-composer-popovers` (5) |
| pol-shell.css + roomsettings.css + rx-shell.css | `.onyx-room-topic-toggle` (6) `.onyx-room-header-sub` (5) `.onyx-room-privacy` (4) |
| app.css + gap-auth.css | `.conn-link` (9) `.conn-title` (6) `.conn-actions` (2) |
| pol-roster.css + rx-shell.css | `.onyx-mlist-close` (7) `.onyx-mlist-group-head` (7) `.onyx-mlist-find` (5) |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css + calls-engine.css | `.onyx-call-btn` (24) `.onyx-cbtn` (22) |
| app.css + pol-shell.css + rx-shell.css + calls-engine.css | `.onyx-call-join` (11) `.onyx-voice-chip-status` (6) |
| app.css + pol-shell.css + roomsettings.css + rx-shell.css | `.onyx-facepile` (8) `.room-notify` (4) |
| app.css + calls-c6.css + calls-engine.css | `.onyx-call-people` (17) `.onyx-call-avatar` (8) |
| app.css + pol-roster.css + rx-shell.css | `.onyx-roster-filter-input` (12) `.onyx-roster-care` (4) |
| app.css + gap-oper.css + ui-sheets.css | `.onyx-sheet-close` (11) `.onyx-moddesk-sheet` (5) |
| app.css + rx-shell.css + ui-sheets.css | `.onyx-sheet-backdrop` (8) `.onyx-toaster` (6) |
| app.css + pol-shell.css + calls-engine.css | `.onyx-voice-chip` (8) `.onyx-header-voice` (4) |
| app.css + gap-people.css + ui-sheets.css | `.chb-check` (6) `.onyx-member-action` (6) |
| app.css + gap-organize.css + ui-sheets.css | `.notify-group-title` (5) `.notify-row` (3) |
| app.css + pol-shell.css + roomsettings.css | `.onyx-convohead` (3) `.onyx-dmsafe` (3) |
| gap-appearance.css + pol-thread.css | `.onyx-mention` (9) `.shell-msg-spoiler-label` (4) |
| pol-shell.css + pol-thread.css | `.shell-composer-tool` (7) `.shell-composer-action-label` (3) |
| app.css + rx-shell.css | `.onyx-nav-label` (5) `.onyx-facepile-face` (3) |
| app.css + gap-appearance.css | `.onyx-home-row` (5) `.shell-msg-blockquote` (2) |
| app.css + gap-shell.css | `.onyx-reconnect` (2) `.onyx-reconnect-msg` (2) |
| app.css + gap-people.css | `.onyx-member-mod` (2) `.moderation-desk__ban-mask` (2) |
| app.css + gap-organize.css | `.notify-hint` (2) `.onyx-home-head` (2) |
| app.css + gap-claim.css | `.pref-group` (2) `.pref-group-head` (2) |
| gap-appearance.css + pol-studio.css | `.ap` (2) `.ap-background-host` (2) |
| app.css + pol-thread.css + calls-c11.css + calls-c6.css + rx-shell.css + gap-commands.css + gap-shell.css + ui-sheets.css + calls-engine.css | `.onyx-sheet` (40) |
| app.css + pol-shell.css + calls-c8.css + calls-c11.css + roomsettings.css + calls-c6.css + calls-c4.css + calls-engine.css | `.onyx-ci` (49) |
| app.css + gap-appearance.css + pol-shell.css + pol-thread.css + gap-convo.css + rx-shell.css + gap-organize.css + pol-ios.css | `.onyx-composer` (18) |
| app.css + gap-appearance.css + pol-shell.css + pol-thread.css + rx-shell.css + gap-organize.css + pol-ios.css | `.onyx-frame` (15) |
| pol-shell.css + pol-thread.css + pol-roster.css + gap-convo.css + rx-shell.css + gap-watch.css | `.pt-ico` (77) |
| app.css + pol-thread.css + calls-c6.css + rx-shell.css + ui-sheets.css + pol-ios.css | `.onyx-sheet-layer` (29) |
| app.css + gap-appearance.css + pol-thread.css + gap-convo.css + gap-organize.css + gap-commands.css | `.onyx-message` (28) |
| app.css + pol-shell.css + pol-thread.css + pol-roster.css + rx-shell.css + ui-sheets.css | `.onyx-roster` (24) |
| app.css + gap-appearance.css + pol-shell.css + pol-thread.css + pol-roster.css + rx-shell.css | `.onyx-avatar` (11) |
| app.css + gap-appearance.css + pol-shell.css + rx-shell.css + gap-organize.css | `.onyx-rail-item` (22) |
| app.css + gap-appearance.css + pol-thread.css + rx-shell.css + gap-organize.css | `.onyx-thread-pane` (11) |
| app.css + gap-appearance.css + pol-roster.css + rx-shell.css + gap-people.css | `.onyx-member` (11) |
| app.css + pol-shell.css + roomsettings.css + rx-shell.css + gap-organize.css | `.onyx-room-header` (10) |
| app.css + pol-shell.css + pol-thread.css + rx-shell.css + gap-organize.css | `.onyx-main` (9) |
| app.css + calls-c11.css + calls-c6.css + calls-engine.css | `.onyx-call-ring` (14) |
| app.css + pol-shell.css + rx-shell.css + ui-sheets.css | `.room-notify-seg` (12) |
| app.css + gap-account.css + gap-usermodes.css + ui-sheets.css | `.pref-switch` (11) |
| app.css + calls-c8.css + calls-c4.css + calls-engine.css | `.onyx-call-bar` (11) |
| app.css + pol-thread.css + gap-organize.css + gap-commands.css | `.onyx-body` (9) |
| app.css + pol-shell.css + account2.css + rx-shell.css | `.onyx-rail-avatar` (6) |
| app.css + gap-oper.css + gap-people.css + ui-sheets.css | `.onyx-moddesk-head` (4) |
| calls-c11.css + calls-c4.css + calls-engine.css | `.onyx-tile` (25) |
| calls-c11.css + calls-c6.css + calls-engine.css | `.onyx-call-pip-card` (19) |
| app.css + pol-thread.css + gap-organize.css | `.onyx-ts` (11) |
| gap-appearance.css + pol-roster.css + rx-shell.css | `.onyx-mlist-main` (10) |
| roomsettings.css + gap-chanserv.css + gap-people.css | `.rset-btn` (10) |
| app.css + pol-shell.css + gap-organize.css | `.onyx-rail-label` (9) |
| app.css + roomsettings.css + ui-sheets.css | `.onyx-sheet-head` (8) |
| app.css + pol-shell.css + pol-ios.css | `.onyx-mobile-nav` (7) |
| app.css + gap-commands.css + ui-sheets.css | `.onyx-spotlight-icon` (7) |
| pol-shell.css + pol-roster.css + rx-shell.css | `.onyx-members-toggle` (7) |
| app.css + calls-c11.css + calls-engine.css | `.onyx-call-sheet` (6) |
| app.css + pol-shell.css + pol-thread.css | `.onyx-coach-dismiss` (5) |
| gap-chanserv.css + gap-shell.css + ui-sheets.css | `.onyx-sheet-x` (5) |
| app.css + gap-import.css + gap-usermodes.css | `.pref-desc` (4) |
| app.css + gap-appearance.css + gap-claim.css | `.pref-label` (3) |
| calls-c11.css + calls-c4.css | `.onyx-tile-video` (6) |
| pol-thread.css + ui-sheets.css | `.onyx-sheet-grip` (5) |
| pol-studio.css + gap-oper.css | `.ap-lede` (3) |
| pol-studio.css + pol-shell.css | `.on` (3) |
| pol-thread.css + gap-organize.css | `.onyx-row-avatar` (3) |
| pol-shell.css + calls-engine.css | `.onyx-voice-chip-count` (2) |
| pol-shell.css + roomsettings.css | `.onyx-room-header-topic-open` (2) |
| polish.css + pol-ios.css | `.a2hs-sheet` (2) |
| roomsettings.css + gap-organize.css | `.rset-heading` (2) |

### G14.1 Cross-file property fights (712): one class, same state, same context, same property, different values in different files

Full selectors for every value are in style-map.json `fights`. 468 fights are won by a later file raising specificity (marked ↑); 74 would change winner if the files were wrapped in @layer in link order (marked **flip**: an earlier file out-specifies a later one). Each value is `file:line(specificity abc) value`, in cascade order.

| class | state | context | property: values in cascade order |
|---|---|---|---|
| `.a2-body` | `(base)` |  | **padding** ↑: account2.css:6(010) `var(--pad-panel)` → ui-sheets.css:739(020) `0` |
| `.a2-input` | `(base)` |  | **flex** ↑: account2.css:18(020) `1 1 auto` → ui-sheets.css:1401(040) `1` |
| `.a2-status` | `(base)` |  | **margin-top** ↑: account2.css:123(010) `var(--space-3)` → ui-sheets.css:626(020) `var(--space-4)` |
| `.ap` | `(base)` |  | **background** **flip**: gap-appearance.css:287(030) `transparent` → pol-studio.css:26(010) `var(--onyx-bg)` |
| `.ap-background-host` | `(base)` |  | **background** **flip**: gap-appearance.css:287(030) `transparent` → pol-studio.css:36(010) `var(--onyx-bg)` |
| `.ap-lede` | `(base)` |  | **font-size**: pol-studio.css:96(010) `var(--text-lg)` → gap-oper.css:420(010) `0.875rem`<br>**line-height**: pol-studio.css:97(010) `var(--leading-body)` → gap-oper.css:420(010) `var(--leading-snug)`<br>**margin**: pol-studio.css:94(010) `var(--space-3) 0 0` → gap-oper.css:420(010) `0` |
| `.boost-count` | `(base)` |  | **color** ↑: app.css:2673(010) `var(--onyx-dim)` → pol-thread.css:413(020) `var(--onyx-dim)` → pol-thread.css:419(040) `var(--onyx-text)` |
| `.boost-pill` | `(base)` |  | **background** ↑: app.css:2668(010) `var(--onyx-panel-2)` → pol-thread.css:406(030) `var(--onyx-panel)`<br>**font-size** ↑: app.css:2667(010) `var(--text-2xs)` → pol-thread.css:409(030) `var(--text-sm)`<br>**gap** ↑: app.css:2666(010) `var(--space-1)` → pol-thread.css:405(030) `6px`<br>**padding** ↑: app.css:2669(010) `2px var(--space-2)` → pol-thread.css:404(030) `0 var(--space-2)` |
| `.boost-pill` | `.you` |  | **border-color** ↑: app.css:2671(020) `var(--onyx-accent)` → app.css:4027(020) `var(--onyx-dim)` → pol-thread.css:417(030) `color-mix(in oklab, var(` |
| `.chb-card` | `(base)` |  | **background** ↑: pol-shell.css:288(020) `var(--onyx-panel-2)` → ui-sheets.css:750(020) `transparent` → ui-sheets.css:751(030) `color-mix(in oklab, var(`<br>**border** ↑: app.css:1069(010) `1px solid var(--onyx-lin` → ui-sheets.css:750(020) `0`<br>**border-color** ↑: pol-shell.css:289(020) `var(--onyx-dim)` → ui-sheets.css:752(030) `var(--onyx-line)`<br>**border-radius** ↑: app.css:1069(010) `8px` → ui-sheets.css:750(020) `0`<br>**padding** ↑: app.css:1069(010) `8px 10px` → ui-sheets.css:750(020) `var(--space-3) var(--spa` |
| `.chb-check` | `(base)` |  | **align-items** ↑: app.css:1097(010) `baseline` → gap-people.css:133(020) `center` → ui-sheets.css:765(020) `center` → ui-sheets.css:765(020) `center`<br>**gap** ↑: app.css:1097(010) `8px` → gap-people.css:134(020) `var(--space-2)`<br>**min-height**: gap-people.css:135(020) `36px` → ui-sheets.css:765(020) `32px` → ui-sheets.css:765(020) `32px` |
| `.chb-close` | `(base)` |  | **border** ↑: app.css:1055(010) `none` → pol-shell.css:303(020) `0` |
| `.chb-count--live` | `(base)` |  | **color** ↑: app.css:1075(010) `var(--onyx-accent)` → ui-sheets.css:755(020) `var(--onyx-text)` |
| `.chb-create` | `(base)` |  | **gap** ↑: app.css:1083(010) `12px` → ui-sheets.css:760(020) `var(--space-4)` |
| `.chb-ledger` | `(base)` |  | **color** ↑: app.css:1080(010) `var(--onyx-accent)` → ui-sheets.css:758(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:1080(010) `0.75rem` → ui-sheets.css:758(020) `var(--text-sm)` |
| `.chb-list` | `(base)` |  | **gap** ↑: app.css:1067(010) `8px` → ui-sheets.css:748(020) `0` |
| `.chb-pill` | `(base)` |  | **color** ↑: app.css:1073(010) `var(--onyx-accent)` → ui-sheets.css:756(020) `var(--onyx-dim)` |
| `.chb-skin` | `[aria-pressed=""]` |  | **border-color** ↑: app.css:1094(020) `var(--onyx-accent)` → ui-sheets.css:763(030) `var(--onyx-text)` |
| `.chb-skins` | `(base)` |  | **padding** ↑: app.css:1091(010) `8px 10px` → ui-sheets.css:761(020) `var(--space-3)` |
| `.chb-sort` | `(base)` |  | **gap** ↑: app.css:1059(010) `4px` → ui-sheets.css:744(020) `2px` |
| `.chb-sort-btn` | `[aria-pressed=""]` |  | **border-color** ↑: app.css:1060(020) `var(--onyx-accent)` → pol-shell.css:304(030) `var(--onyx-dim)` → ui-sheets.css:746(030) `transparent`<br>**color** ↑: app.css:1060(020) `var(--onyx-accent)` → pol-shell.css:304(030) `var(--onyx-text)` → ui-sheets.css:746(030) `var(--onyx-text)` |
| `.chb-toolbar` | `(base)` |  | **gap** ↑: app.css:1057(010) `8px` → ui-sheets.css:742(020) `var(--space-2)`<br>**margin** ↑: app.css:1057(010) `12px 0` → ui-sheets.css:742(020) `0 0 var(--space-3)` |
| `.chb-topic` | `(base)` |  | **margin** ↑: app.css:1077(010) `4px 0` → ui-sheets.css:757(020) `2px 0 var(--space-2)` |
| `.conn-link` | `(base)` |  | **margin-top** ↑: app.css:1994(010) `calc(-1 * var(--space-2)` → gap-auth.css:74(020) `0` → gap-auth.css:74(020) `0` |
| `.data-card` | `(base)` |  | **background** **flip**: pol-stats.css:640(020) `var(--pg-panel)` → pol-public.css:403(010) `var(--onyx-panel)`<br>**border** **flip**: pol-stats.css:638(020) `1px solid var(--pg-line)` → pol-public.css:401(010) `1px solid var(--onyx-lin`<br>**padding** **flip**: pol-stats.css:637(020) `var(--space-5)` → pol-public.css:400(010) `var(--space-6)` |
| `.gorg-menu-label` | `(base)` |  | **font-size** **flip**: rx-shell.css:202(020) `var(--text-md)` → gap-organize.css:268(010) `var(--text-sm)`<br>**font-weight** **flip**: rx-shell.css:202(020) `400` → gap-organize.css:268(010) `600` |
| `.guest-claim-chip` | `(base)` |  | **border-radius**: app.css:972(010) `8px` → pol-shell.css:1109(010) `var(--radius)`<br>**gap**: app.css:970(010) `8px` → pol-shell.css:1105(010) `var(--space-3)`<br>**padding**: app.css:973(010) `6px 10px` → pol-shell.css:1106(010) `var(--space-3)` |
| `.guest-claim-chip__actions` | `(base)` |  | **gap** ↑: app.css:979(010) `6px` → pol-shell.css:1115(020) `var(--space-1)`<br>**margin-left** ↑: app.css:979(010) `auto` → pol-shell.css:1115(020) `0` |
| `.guest-claim-chip__dismiss` | `(base)` |  | **color** ↑: app.css:992(010) `var(--onyx-dim)` → pol-shell.css:1134(020) `var(--onyx-faint)` |
| `.guest-claim-chip__keep` | `(base)` |  | **background** ↑: app.css:983(010) `var(--onyx-accent)` → pol-shell.css:1123(020) `var(--onyx-panel-2)`<br>**border** ↑: app.css:984(010) `1px solid var(--onyx-acc` → pol-shell.css:1124(020) `1px solid var(--onyx-lin`<br>**border-radius** ↑: app.css:985(010) `6px` → pol-shell.css:1125(020) `var(--radius)`<br>**color** ↑: app.css:982(010) `var(--onyx-accent-ink)` → pol-shell.css:1122(020) `var(--onyx-text)`<br>**padding** ↑: app.css:986(010) `2px 10px` → pol-shell.css:1118(020) `0 var(--space-3)` |
| `.guest-claim-sheet__form` | `(base)` |  | **gap** ↑: app.css:1011(010) `6px` → ui-sheets.css:785(020) `var(--space-2)` |
| `.jump-to-date-close` | `(base)` |  | **background** ↑: app.css:2686(010) `none` → ui-sheets.css:265(020) `transparent`<br>**border** ↑: app.css:2687(010) `1px solid var(--onyx-lin` → ui-sheets.css:266(020) `0`<br>**padding** ↑: app.css:2687(010) `var(--space-1) 10px` → ui-sheets.css:261(020) `0` |
| `.label` | `(base)` |  | **color**: pol-stats.css:538(020) `var(--pg-dim)` → pol-public.css:375(020) `var(--onyx-dim)`<br>**font-weight**: pol-stats.css:540(020) `700` → pol-public.css:377(020) `650` |
| `.notif-center` | `(base)` |  | **position** ↑: app.css:3777(010) `absolute` → ui-sheets.css:526(020) `relative`<br>**right** ↑: app.css:3779(010) `0` → ui-sheets.css:528(020) `auto`<br>**top** ↑: app.css:3778(010) `calc(100% + var(--space-` → ui-sheets.css:527(020) `auto` |
| `.notif-center__close` | `(base)` |  | **font-size** **flip**: pol-shell.css:53(020) `var(--text-lg)` → ui-sheets.css:262(010) `0`<br>**line-height** **flip**: pol-shell.css:54(020) `1` → ui-sheets.css:263(010) `0`<br>**min-height** **flip**: pol-shell.css:51(020) `32px` → ui-sheets.css:259(010) `var(--sheet-close)`<br>**min-width** **flip**: pol-shell.css:50(020) `32px` → ui-sheets.css:258(010) `var(--sheet-close)` |
| `.notif-center__empty` | `(base)` |  | **border** ↑: pol-shell.css:84(010) `1px dashed var(--onyx-li` → ui-sheets.css:575(020) `0`<br>**margin** ↑: pol-shell.css:79(010) `var(--space-2) 0 0` → ui-sheets.css:573(020) `var(--space-2) 0`<br>**padding** ↑: pol-shell.css:80(010) `var(--space-5) var(--spa` → ui-sheets.css:574(020) `var(--space-7) var(--spa` |
| `.notif-center__filter` | `(base)` |  | **font-size** ↑: pol-shell.css:71(020) `var(--text-2xs)` → ui-sheets.css:533(030) `var(--text-sm)`<br>**min-height** ↑: pol-shell.css:68(020) `28px` → ui-sheets.css:533(030) `32px` |
| `.notif-center__filters` | `(base)` |  | **display**: app.css:3794(010) `flex` → pol-shell.css:60(010) `grid`<br>**margin** ↑: app.css:3794(010) `var(--space-2) 0` → ui-sheets.css:532(020) `0` |
| `.notif-center__glyph` | `(base)` |  | **border-radius** ↑: pol-shell.css:126(010) `var(--radius)` → ui-sheets.css:553(020) `50%`<br>**height** ↑: pol-shell.css:121(010) `28px` → ui-sheets.css:553(020) `32px`<br>**width** ↑: pol-shell.css:120(010) `28px` → ui-sheets.css:553(020) `32px` |
| `.notif-center__list` | `(base)` |  | **margin** ↑: app.css:3795(010) `0` → ui-sheets.css:539(020) `0 calc(-1 * var(--space-` |
| `.notif-center__open` | `(base)` |  | **grid-template-columns**: pol-shell.css:103(020) `28px minmax(0, 1fr)` → ui-sheets.css:552(020) `32px minmax(0, 1fr)`<br>**min-height**: pol-shell.css:108(020) `44px` → ui-sheets.css:552(020) `52px`<br>**padding**: pol-shell.css:109(020) `var(--space-2)` → ui-sheets.css:552(020) `var(--space-2) var(--spa` |
| `.notif-center__row` | `[data-unread=""]` |  | **background** ↑: pol-shell.css:99(020) `color-mix(in oklab, var(` → ui-sheets.css:541(030) `transparent` |
| `.notif-center__row` | `(base)` |  | **border-left** ↑: pol-shell.css:96(010) `2px solid transparent` → ui-sheets.css:540(020) `0` |
| `.notify-group` | `(base)` |  | **border-top** ↑: app.css:2278(010) `1px solid var(--onyx-lin` → ui-sheets.css:1312(030) `0`<br>**margin-top** ↑: app.css:2278(010) `var(--space-4)` → ui-sheets.css:1310(030) `0`<br>**padding-top** ↑: app.css:2278(010) `var(--space-3)` → ui-sheets.css:1311(030) `0` |
| `.notify-group-title` | `(base)` |  | **margin-bottom** ↑: gap-organize.css:551(020) `var(--space-2)` → gap-organize.css:551(020) `var(--space-2)` → ui-sheets.css:1288(030) `0` |
| `.notify-row` | `(base)` |  | **margin** ↑: app.css:2284(010) `var(--space-2) 0` → ui-sheets.css:1314(020) `var(--space-1) 0` |
| `.notify-toggle` | `(base)` |  | **background** ↑: app.css:2288(010) `var(--onyx-panel-2)` → ui-sheets.css:1364(020) `transparent`<br>**border** ↑: app.css:2288(010) `1px solid var(--onyx-lin` → ui-sheets.css:1365(020) `0`<br>**color** ↑: app.css:2288(010) `var(--onyx-text)` → ui-sheets.css:1363(020) `transparent`<br>**min-width** ↑: app.css:2288(010) `64px` → ui-sheets.css:1356(020) `52px`<br>**padding** ↑: app.css:2288(010) `var(--space-1) var(--spa` → ui-sheets.css:1359(020) `0` |
| `.onyx-account` | `(base)` |  | **width** ↑: app.css:1245(010) `min(560px, 94vw)` → ui-sheets.css:699(020) `min(var(--sheet-w-lg), 1` |
| `.onyx-account-drop-confirm` | `(base)` |  | **gap** ↑: app.css:1352(010) `8px` → ui-sheets.css:1448(020) `var(--space-1)` |
| `.onyx-account-hint` | `(base)` |  | **margin** ↑: app.css:1266(010) `0 0 8px` → pol-shell.css:227(020) `0` |
| `.onyx-account-nav` | `(base)` |  | **gap** ↑: app.css:1261(010) `12px` → ui-sheets.css:713(020) `2px`<br>**margin** ↑: app.css:1261(010) `12px 0 4px` → ui-sheets.css:714(020) `0` |
| `.onyx-account-nav__item` | `(base)` |  | **color** ↑: app.css:1262(010) `var(--onyx-accent)` → ui-sheets.css:722(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:1262(010) `0.8125rem` → ui-sheets.css:721(020) `var(--text-sm)` |
| `.onyx-attach-remove` | `(base)` |  | **grid-column** ↑: pol-thread.css:1308(020) `3` → gap-convo.css:86(030) `4` |
| `.onyx-attach-row` | `(base)` |  | **grid-template-columns** ↑: pol-thread.css:1297(010) `minmax(0, 1fr) auto auto` → gap-convo.css:82(020) `minmax(0, 1fr) auto auto` |
| `.onyx-audience-toggle` | `(base)` |  | **border-radius** ↑: app.css:699(010) `6px` → pol-thread.css:1216(030) `var(--radius)`<br>**font-size** ↑: app.css:694(010) `0.6875rem` → pol-thread.css:1213(020) `var(--text-xs)`<br>**font-weight** ↑: app.css:695(010) `600` → pol-thread.css:1214(020) `650`<br>**padding** ↑: app.css:700(010) `2px 8px` → pol-thread.css:1211(020) `0 var(--space-2)` → pol-thread.css:1216(030) `0 var(--space-2)` |
| `.onyx-audience-toggle-set` | `(base)` |  | **border-color** ↑: app.css:707(010) `var(--onyx-accent)` → pol-thread.css:1217(030) `var(--onyx-dim)`<br>**color** ↑: app.css:706(010) `var(--onyx-accent)` → pol-thread.css:1217(030) `var(--onyx-text)` |
| `.onyx-avatar` | `(base)` |  | **box-shadow**: app.css:147(020) `0 0 0 1px var(--nick-tin` → app.css:209(020) `0 0 0 2px var(--onyx-bg)` → pol-thread.css:1032(020) `0 0 0 1px var(--nick-tin` → rx-shell.css:47(020) `0 0 0 2px var(--onyx-bg)`<br>**font-size** **flip**: gap-appearance.css:186(040) `0.625rem` → gap-appearance.css:190(040) `0.8125rem` → pol-thread.css:622(020) `1.1rem` → pol-thread.css:1968(020) `0.6rem` → rx-shell.css:47(020) `0.66rem`<br>**height** **flip**: gap-appearance.css:186(040) `1.5rem` → gap-appearance.css:190(040) `2.5rem` → pol-thread.css:622(020) `4rem` → pol-thread.css:1968(020) `1.75rem`<br>**width** **flip**: gap-appearance.css:186(040) `1.5rem` → gap-appearance.css:190(040) `2.5rem` → pol-thread.css:622(020) `4rem` → pol-thread.css:1968(020) `1.75rem` |
| `.onyx-body` | `(base)` |  | **color** ↑: app.css:712(010) `var(--onyx-text)` → app.css:714(020) `var(--onyx-dim)` → pol-thread.css:189(020) `var(--onyx-dim)` → pol-thread.css:451(020) `var(--onyx-text)` → gap-commands.css:20(020) `var(--onyx-text)`<br>**font-size** ↑: pol-thread.css:140(030) `var(--text-md)` → pol-thread.css:2256(020) `var(--text-md)` → gap-organize.css:672(040) `1.0625rem`<br>**line-height** ↑: pol-thread.css:2256(020) `var(--leading-snug)` → gap-organize.css:673(040) `1.72` |
| `.onyx-brand` | `(base)` |  | **gap** ↑: app.css:237(010) `10px` → pol-shell.css:583(020) `var(--space-2)` |
| `.onyx-call-avatar` | `(base)` |  | **border-color**: app.css:3373(020) `var(--onyx-panel)` → calls-engine.css:153(020) `var(--onyx-bg)`<br>**margin-left**: app.css:3373(020) `-6px` → calls-engine.css:153(020) `-4px` |
| `.onyx-call-avatar-lg` | `(base)` |  | **font-size** ↑ **flip**: app.css:3371(010) `1.5rem` → app.css:3463(030) `1.125rem` → calls-c4.css:140(020) `var(--text-md)` → calls-engine.css:162(010) `1.375rem`<br>**height** ↑ **flip**: app.css:3371(010) `72px` → app.css:3463(030) `56px` → calls-c4.css:140(020) `40px` → calls-engine.css:162(010) `64px`<br>**width** ↑ **flip**: app.css:3371(010) `72px` → app.css:3463(030) `56px` → calls-c4.css:140(020) `40px` → calls-engine.css:162(010) `64px` |
| `.onyx-call-bar` | `(base)` |  | **border-radius** ↑: app.css:3469(010) `0 0 6px 6px` → calls-c4.css:67(030) `0`<br>**display**: app.css:3468(010) `grid` → calls-engine.css:171(010) `flex`<br>**gap**: app.css:3468(010) `12px` → calls-engine.css:172(010) `var(--space-2)`<br>**min-height**: app.css:3468(010) `56px` → calls-engine.css:172(010) `0`<br>**padding**: app.css:3468(010) `8px 12px` → calls-engine.css:172(010) `var(--space-2) var(--spa` |
| `.onyx-call-bar` | `(base)` | @media (max-width: 640px) | **padding**: app.css:3574(010) `10px 12px calc(10px + en` → calls-engine.css:236(010) `var(--space-2) var(--spa` |
| `.onyx-call-bar-center` | `(base)` |  | **flex-wrap**: app.css:3475(010) `wrap` → calls-engine.css:174(010) `nowrap`<br>**gap**: app.css:3475(010) `6px` → calls-engine.css:174(010) `var(--space-1)` |
| `.onyx-call-btn` | `(base)` |  | **min-height** ↑ **flip**: app.css:3415(010) `36px` → calls-c11.css:107(020) `var(--target-floor)` → calls-c6.css:64(020) `var(--target-min)` → calls-c4.css:55(020) `28px` → calls-engine.css:84(020) `36px` → calls-engine.css:542(010) `36px` → calls-engine.css:543(020) `28px` → calls-engine.css:544(020) `var(--target-min)` → calls-engine.css:547(020) `28px`<br>**padding** ↑: app.css:3415(010) `0 14px` → calls-c11.css:107(020) `0 var(--space-2)` → calls-c4.css:55(020) `0 var(--space-2)`<br>**white-space**: calls-c11.css:71(020) `normal` → calls-engine.css:84(020) `nowrap` |
| `.onyx-call-btn` | `(base)` | @media (max-width: 767px) | **min-height**: calls-c6.css:243(020) `52px` → calls-c6.css:269(020) `var(--target-min)` → calls-engine.css:551(020) `52px` → calls-engine.css:552(020) `var(--target-min)` → calls-engine.css:553(020) `var(--target-min)` → calls-engine.css:553(020) `var(--target-min)` |
| `.onyx-call-caption-translate` | `(base)` |  | **min-height**: calls-c8.css:72(010) `var(--target-floor)` → calls-engine.css:548(010) `28px` |
| `.onyx-call-captions-copy` | `(base)` |  | **min-height**: calls-c8.css:72(010) `var(--target-floor)` → calls-engine.css:548(010) `28px` |
| `.onyx-call-grid` | `[data-columns=""]` |  | **max-width**: calls-c4.css:72(020) `56rem` → calls-engine.css:345(020) `none`<br>**width**: calls-c4.css:72(020) `100%` → calls-engine.css:346(020) `min(100%, calc((var(--gr` |
| `.onyx-call-join` | `(base)` |  | **min-height** ↑: app.css:3393(010) `30px` → pol-shell.css:939(030) `32px` → calls-engine.css:40(010) `32px` |
| `.onyx-call-more` | `(base)` |  | **border**: app.css:3490(010) `1px solid var(--onyx-lin` → calls-engine.css:186(010) `0`<br>**border-radius**: app.css:3490(010) `6px` → calls-engine.css:186(010) `0`<br>**bottom**: app.css:3489(010) `calc(100% + 6px)` → calls-engine.css:183(010) `auto`<br>**left**: app.css:3489(010) `50%` → calls-engine.css:183(010) `auto`<br>**min-width**: app.css:3490(010) `220px` → calls-engine.css:185(010) `0`<br>**padding**: app.css:3490(010) `6px` → calls-engine.css:185(010) `var(--space-2) 0 0`<br>**position**: app.css:3489(010) `absolute` → calls-engine.css:183(010) `relative`<br>**transform**: app.css:3489(010) `translateX(-50%)` → calls-engine.css:183(010) `none`<br>**z-index**: app.css:3489(010) `20` → calls-engine.css:183(010) `61` |
| `.onyx-call-more-item` | `(base)` |  | **border** ↑: app.css:3494(010) `0` → calls-engine.css:189(030) `1px solid var(--onyx-lin`<br>**padding** ↑: app.css:3493(010) `0 10px` → calls-engine.css:189(030) `0 var(--space-3)`<br>**width** ↑: app.css:3493(010) `100%` → calls-engine.css:189(030) `auto` |
| `.onyx-call-more-wrap` | `(base)` |  | **position**: app.css:3487(010) `relative` → calls-engine.css:178(010) `static` |
| `.onyx-call-name` | `(base)` |  | **font-size** **flip**: app.css:3464(030) `0.75rem` → calls-engine.css:163(010) `var(--text-md)` |
| `.onyx-call-people` | `(base)` |  | **align-items**: app.css:3433(010) `center` → calls-engine.css:160(010) `flex-start`<br>**gap**: app.css:3434(010) `28px 36px` → calls-engine.css:160(010) `var(--space-4) var(--spa`<br>**padding**: app.css:3434(010) `24px 24px 28px` → calls-engine.css:160(010) `var(--space-4) var(--spa` |
| `.onyx-call-people` | `(base)` | @media (max-width: 640px) | **gap**: app.css:3572(010) `20px 16px` → calls-engine.css:217(010) `var(--space-3)`<br>**padding**: app.css:3572(010) `20px 12px` → calls-engine.css:218(010) `var(--space-2) var(--spa` |
| `.onyx-call-person` | `(base)` |  | **gap**: app.css:3438(010) `6px` → calls-engine.css:161(010) `var(--space-1)`<br>**width** **flip**: app.css:3438(010) `112px` → app.css:3462(030) `72px` → calls-engine.css:161(010) `96px` |
| `.onyx-call-person` | `(base)` | @media (max-width: 640px) | **width** ↑: app.css:3573(010) `96px` → calls-engine.css:225(010) `68px` → calls-engine.css:225(030) `68px` |
| `.onyx-call-pip-body` | `(base)` | @media (max-width: 767px) | **gap**: calls-c6.css:210(010) `var(--space-1)` → calls-engine.css:505(010) `var(--space-2)` |
| `.onyx-call-pip-btn` | `(base)` | @media (max-width: 767px) | **font-size**: calls-c6.css:212(010) `var(--text-2xs)` → calls-engine.css:507(010) `var(--text-sm)`<br>**min-height**: calls-c6.css:212(010) `28px` → calls-engine.css:507(010) `var(--target-min)` → calls-engine.css:550(010) `28px`<br>**padding**: calls-c6.css:212(010) `0 var(--space-2)` → calls-engine.css:507(010) `0 var(--space-3)` |
| `.onyx-call-pip-card` | `(base)` | @media (max-width: 767px) | **right**: calls-c6.css:201(010) `var(--space-3)` → calls-engine.css:502(010) `max(var(--space-3), env(`<br>**top**: calls-c6.css:200(010) `calc(var(--mobile-nav-h)` → calls-engine.css:501(010) `calc(env(safe-area-inset`<br>**width**: calls-c6.css:204(010) `160px` → calls-engine.css:503(010) `min(320px, calc(100vw - ` |
| `.onyx-call-pip-card` | `[data-corner]` | @media (max-width: 767px) | **right**: calls-c6.css:201(020) `var(--space-3)` → calls-engine.css:502(020) `max(var(--space-3), env(`<br>**top**: calls-c6.css:200(020) `calc(var(--mobile-nav-h)` → calls-engine.css:501(020) `calc(env(safe-area-inset`<br>**width**: calls-c6.css:204(020) `160px` → calls-engine.css:503(020) `min(320px, calc(100vw - ` |
| `.onyx-call-pip-faces` | `(base)` | @media (max-width: 767px) | **flex-basis**: calls-c6.css:211(010) `100%` → calls-engine.css:506(010) `auto` |
| `.onyx-call-ring` | `::after` |  | **animation**: app.css:3446(031) `onyx-call-breathe 1.6s e` → app.css:3447(051) `none` → calls-c11.css:167(031) `none` |
| `.onyx-call-role` | `(base)` |  | **font-size**: app.css:3460(010) `0.75rem` → calls-engine.css:164(010) `var(--text-2xs)`<br>**margin-top**: app.css:3460(010) `-4px` → calls-engine.css:164(010) `-2px` |
| `.onyx-call-stage` | `(base)` |  | **margin** ↑ **flip**: app.css:3424(010) `12px 14px` → app.css:3553(020) `20px 0 0` → calls-engine.css:125(010) `var(--space-2) 0 var(--s` → calls-engine.css:471(020) `var(--space-5) 0 0`<br>**position** ↑: app.css:3424(010) `relative` → calls-engine.css:57(020) `sticky` |
| `.onyx-call-stage` | `(base)` | @media (max-width: 640px) | **margin**: app.css:3571(010) `12px` → calls-engine.css:209(010) `var(--space-1) 0 var(--s` |
| `.onyx-call-stage-status` | `(base)` |  | **font-size**: app.css:3429(010) `0.75rem` → calls-engine.css:135(010) `var(--text-sm)`<br>**padding**: app.css:3428(010) `10px 14px 0` → calls-engine.css:135(010) `0` |
| `.onyx-call-timer` | `(base)` |  | **color** ↑: app.css:3473(010) `var(--onyx-dim)` → calls-engine.css:141(020) `var(--onyx-text)` |
| `.onyx-call-you` | `(base)` |  | **color** ↑: app.css:3459(010) `var(--onyx-faint)` → calls-c4.css:113(020) `var(--onyx-dim)` |
| `.onyx-cbtn` | `(base)` |  | **height**: app.css:3479(010) `44px` → calls-engine.css:175(010) `48px`<br>**width**: app.css:3479(010) `56px` → calls-engine.css:175(010) `60px` |
| `.onyx-cbtn` | `(base)` | @media (max-width: 640px) | **width** ↑: app.css:3576(010) `48px` → calls-engine.css:241(020) `100%` → calls-engine.css:241(020) `100%` |
| `.onyx-cbtn-cap` | `(base)` |  | **line-height** ↑: app.css:3486(010) `1` → calls-c4.css:27(020) `inherit` |
| `.onyx-cbtn-leave` | `(base)` |  | **margin-left**: app.css:3484(010) `6px` → calls-engine.css:177(010) `var(--space-2)` |
| `.onyx-ci` | `(base)` |  | **height** ↑: app.css:3339(010) `18px` → app.css:3397(020) `16px` → app.css:3456(020) `14px` → app.css:3504(020) `14px` → calls-c8.css:49(020) `14px` → calls-c11.css:42(020) `14px` → roomsettings.css:39(020) `14px` → calls-c6.css:170(020) `14px` → calls-c6.css:185(020) `16px` → calls-c4.css:53(020) `14px` → calls-c4.css:108(020) `14px` → calls-c4.css:123(020) `14px` → calls-engine.css:90(020) `16px` → calls-engine.css:91(020) `16px` → calls-engine.css:193(020) `16px` → calls-engine.css:479(020) `20px`<br>**width** ↑: app.css:3338(010) `18px` → app.css:3397(020) `16px` → app.css:3456(020) `14px` → app.css:3504(020) `14px` → calls-c8.css:49(020) `14px` → calls-c11.css:42(020) `14px` → roomsettings.css:39(020) `14px` → calls-c6.css:170(020) `14px` → calls-c6.css:185(020) `16px` → calls-c4.css:53(020) `14px` → calls-c4.css:108(020) `14px` → calls-c4.css:123(020) `14px` → calls-engine.css:90(020) `16px` → calls-engine.css:91(020) `16px` → calls-engine.css:193(020) `16px` → calls-engine.css:479(020) `20px` |
| `.onyx-coach` | `(base)` |  | **background** ↑: app.css:2548(010) `var(--onyx-panel)` → pol-shell.css:1073(020) `transparent`<br>**border** ↑: app.css:2548(010) `1px solid var(--onyx-acc` → pol-shell.css:1074(020) `0`<br>**border-radius** ↑: app.css:2548(010) `var(--radius)` → pol-shell.css:1076(020) `0`<br>**display** ↑: app.css:2547(010) `flex` → pol-shell.css:1080(040) `none`<br>**flex-direction** ↑: app.css:2547(010) `column` → pol-shell.css:1069(020) `row`<br>**gap** ↑: app.css:2547(010) `2px` → pol-shell.css:1071(020) `var(--space-2)`<br>**padding** ↑: app.css:2548(010) `10px var(--space-8) 10px` → pol-shell.css:1072(020) `var(--space-2) var(--spa` |
| `.onyx-coach-dismiss` | `(base)` |  | **color**: app.css:2554(010) `var(--onyx-dim)` → pol-shell.css:1082(010) `var(--onyx-faint)` |
| `.onyx-coach-eyebrow` | `(base)` |  | **color** ↑: app.css:2550(010) `var(--onyx-accent)` → app.css:4025(010) `var(--onyx-dim)` → pol-shell.css:1078(020) `var(--onyx-faint)` |
| `.onyx-coach-text` | `(base)` |  | **color** ↑: app.css:2551(010) `var(--onyx-text)` → pol-shell.css:1081(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:2551(010) `var(--text-md)` → pol-shell.css:1081(020) `var(--text-sm)` |
| `.onyx-composer` | `(base)` |  | **align-items**: app.css:750(010) `center` → pol-thread.css:1091(010) `stretch`<br>**background**: app.css:753(010) `var(--onyx-panel)` → pol-thread.css:1095(010) `var(--onyx-bg)`<br>**border-top**: app.css:754(010) `1px solid var(--onyx-lin` → pol-thread.css:1096(010) `0`<br>**display** ↑: app.css:749(010) `flex` → pol-shell.css:570(040) `none`<br>**gap**: app.css:751(010) `10px` → pol-thread.css:1093(010) `var(--space-2)`<br>**padding**: app.css:752(010) `10px 16px` → pol-thread.css:1094(010) `var(--space-2) var(--spa` |
| `.onyx-composer` | `(base)` | @media (min-width: 768px) | **padding-inline** **flip**: gap-appearance.css:227(040) `var(--space-4)` → pol-thread.css:2067(020) `max(var(--space-4), calc` |
| `.onyx-conn` | `(base)` |  | **border** ↑: app.css:272(010) `1px solid var(--onyx-lin` → pol-shell.css:607(020) `0`<br>**border-radius** ↑: app.css:273(010) `999px` → pol-shell.css:608(020) `var(--radius)`<br>**font-size** ↑: app.css:269(010) `var(--text-2xs)` → pol-shell.css:609(020) `var(--text-sm)`<br>**padding** ↑: app.css:274(010) `var(--space-1) var(--spa` → pol-shell.css:606(020) `0 var(--space-2)` |
| `.onyx-convohead` | `(base)` |  | **margin** ↑: app.css:2771(010) `0 0 var(--space-2)` → pol-shell.css:933(020) `0` → roomsettings.css:23(020) `0` |
| `.onyx-dmsafe` | `(base)` |  | **margin** ↑: app.css:2893(010) `0 0 10px` → pol-shell.css:933(020) `0` → roomsettings.css:24(020) `0` |
| `.onyx-dmsafe-bar` | `(base)` |  | **flex-wrap** ↑: app.css:2894(010) `wrap` → pol-shell.css:934(020) `nowrap`<br>**justify-content** ↑: app.css:2894(010) `space-between` → pol-shell.css:934(020) `flex-start` |
| `.onyx-facepile` | `(base)` |  | **padding** ↑: app.css:206(010) `4px 0 4px 4px` → roomsettings.css:26(020) `0 var(--space-1) 0 0` |
| `.onyx-facepile-face` | `(base)` |  | **margin-left**: app.css:208(020) `-0.55rem` → rx-shell.css:46(020) `-0.3rem` |
| `.onyx-feed-empty-body` | `(base)` |  | **margin** ↑: app.css:2558(010) `0` → pol-thread.css:628(020) `var(--space-1) 0 0` |
| `.onyx-feed-empty-title` | `(base)` |  | **font-weight** ↑: app.css:2557(010) `600` → pol-thread.css:627(020) `650`<br>**margin** ↑: app.css:2557(010) `0 0 var(--space-1)` → pol-thread.css:627(020) `0` |
| `.onyx-frame` | `(base)` |  | **height**: app.css:3609(010) `100vh` → app.css:3610(010) `100dvh` → pol-ios.css:65(010) `var(--vvh, 100dvh)` |
| `.onyx-gem` | `(base)` |  | **border-radius** ↑: app.css:251(010) `3px` → pol-shell.css:585(020) `2px`<br>**height** ↑: app.css:248(010) `14px` → pol-shell.css:585(020) `11px`<br>**width** ↑: app.css:247(010) `14px` → pol-shell.css:585(020) `11px` |
| `.onyx-header-voice` | `(base)` |  | **flex**: app.css:3382(010) `none` → calls-engine.css:35(010) `0 1 auto` |
| `.onyx-home-action` | `(base)` |  | **min-height** ↑: app.css:2522(010) `36px` → pol-shell.css:1063(020) `40px`<br>**padding** ↑: app.css:2522(010) `6px var(--space-3)` → pol-shell.css:1063(020) `0 var(--space-4)` |
| `.onyx-home-empty` | `(base)` |  | **background** ↑: app.css:2494(010) `var(--onyx-panel)` → pol-shell.css:1058(020) `transparent`<br>**border** ↑: app.css:2494(010) `1px solid var(--onyx-lin` → pol-shell.css:1059(020) `0`<br>**gap** ↑: app.css:2493(010) `10px` → pol-shell.css:1056(020) `var(--space-4)`<br>**padding** ↑: app.css:2494(010) `var(--space-3)` → pol-shell.css:1057(020) `0` |
| `.onyx-home-head` | `(base)` |  | **align-items** ↑: app.css:2496(010) `flex-start` → gap-organize.css:626(020) `center` |
| `.onyx-home-inner` | `(base)` |  | **gap** ↑: app.css:2474(010) `var(--space-4)` → pol-shell.css:1052(020) `var(--space-5)`<br>**max-width** ↑: app.css:2474(010) `720px` → pol-shell.css:1052(020) `640px`<br>**padding** ↑: app.css:2474(010) `var(--space-4) 0 var(--s` → pol-shell.css:1052(020) `var(--space-8) var(--spa` |
| `.onyx-home-invite` | `(base)` |  | **background** ↑: app.css:2494(010) `var(--onyx-panel)` → pol-shell.css:1092(020) `transparent`<br>**border** ↑: app.css:2494(010) `1px solid var(--onyx-lin` → pol-shell.css:1093(020) `0`<br>**border-radius** ↑: app.css:2494(010) `var(--radius)` → pol-shell.css:1095(020) `0`<br>**flex-direction** ↑: app.css:2493(010) `column` → pol-shell.css:1086(020) `row`<br>**gap** ↑: app.css:2493(010) `10px` → pol-shell.css:1090(020) `var(--space-3)`<br>**padding** ↑: app.css:2494(010) `var(--space-3)` → pol-shell.css:1091(020) `var(--space-3) 0 0` |
| `.onyx-home-masthead` | `(base)` |  | **gap** ↑: app.css:2475(010) `6px` → pol-shell.css:1053(020) `var(--space-1)` |
| `.onyx-home-row` | `(base)` |  | **min-height** ↑: app.css:2501(010) `44px` → gap-appearance.css:203(030) `52px` |
| `.onyx-home-title` | `(base)` |  | **font-size** ↑: app.css:2477(010) `var(--text-2xl)` → pol-shell.css:1054(020) `1.75rem`<br>**font-weight** ↑: app.css:2477(010) `600` → pol-shell.css:1054(020) `700` |
| `.onyx-invshare-url` | `(base)` |  | **font-size** ↑: app.css:3247(010) `var(--text-2xs)` → ui-sheets.css:781(020) `var(--text-sm)` |
| `.onyx-join-banner` | `(base)` | @media (max-width: 640px) | **align-items**: app.css:3564(010) `stretch` → calls-engine.css:110(010) `center` → calls-engine.css:112(010) `flex-start`<br>**flex-direction**: app.css:3564(010) `column` → calls-engine.css:110(010) `row`<br>**margin**: app.css:3564(010) `12px` → calls-engine.css:110(010) `var(--space-1) 0 var(--s` |
| `.onyx-join-banner` | `(base)` |  | **background**: app.css:3402(010) `var(--onyx-panel-2)` → calls-engine.css:78(010) `var(--onyx-panel)`<br>**gap**: app.css:3401(010) `14px` → calls-engine.css:76(010) `var(--space-2) var(--spa`<br>**margin**: app.css:3401(010) `12px 14px` → calls-engine.css:77(010) `var(--space-2) 0 var(--s`<br>**padding**: app.css:3401(010) `12px 14px` → calls-engine.css:77(010) `var(--space-2) var(--spa` |
| `.onyx-join-banner-copy` | `(base)` |  | **flex**: app.css:3406(010) `1` → calls-engine.css:80(010) `1 1 14rem`<br>**min-width**: app.css:3406(010) `200px` → calls-engine.css:80(010) `0` |
| `.onyx-join-banner-hide` | `(base)` |  | **height**: app.css:3411(010) `28px` → calls-engine.css:85(010) `32px`<br>**width**: app.css:3411(010) `28px` → calls-engine.css:85(010) `32px` |
| `.onyx-jump-latest` | `(base)` |  | **background** ↑: app.css:3158(010) `var(--onyx-panel)` → pol-thread.css:590(020) `var(--onyx-panel-2)`<br>**border-radius** ↑: app.css:3160(010) `var(--radius)` → pol-thread.css:589(020) `var(--r-pill)`<br>**font-size** ↑: app.css:3155(010) `var(--text-2xs)` → pol-thread.css:593(020) `var(--text-sm)`<br>**gap** ↑: app.css:3151(010) `var(--space-1)` → pol-thread.css:586(020) `6px`<br>**padding** ↑: app.css:3153(010) `var(--space-1) var(--spa` → pol-thread.css:588(020) `0 var(--space-3) 0 var(-` |
| `.onyx-member` | `(base)` |  | **flex-wrap**: app.css:2736(020) `wrap` → pol-roster.css:189(020) `nowrap`<br>**font-size** ↑: app.css:737(010) `0.8125rem` → pol-roster.css:193(020) `var(--text-md)`<br>**gap** ↑: app.css:735(010) `6px` → pol-roster.css:190(020) `0`<br>**min-height** ↑ **flip**: app.css:2736(020) `36px` → gap-appearance.css:202(040) `48px` → pol-roster.css:191(020) `40px`<br>**padding** ↑: app.css:736(010) `3px 0` → pol-roster.css:192(020) `0` |
| `.onyx-member-actions` | `(base)` |  | **display** ↑: app.css:1609(010) `flex` → ui-sheets.css:1105(020) `grid`<br>**gap** ↑: app.css:1609(010) `8px` → ui-sheets.css:1105(020) `var(--space-2)` |
| `.onyx-member-card` | `(base)` |  | **background** ↑: app.css:1580(010) `var(--onyx-panel-2)` → pol-shell.css:431(030) `var(--onyx-panel)` → ui-sheets.css:1098(030) `var(--onyx-panel)`<br>**border-radius** ↑: app.css:1582(010) `8px` → ui-sheets.css:1097(030) `var(--radius)`<br>**gap** ↑: app.css:1585(010) `10px` → ui-sheets.css:1094(030) `var(--space-4)`<br>**margin** ↑: app.css:1586(010) `8px 0 8px 16px` → pol-shell.css:429(030) `0`<br>**max-width** ↑: app.css:1587(010) `340px` → pol-shell.css:427(030) `100%` → ui-sheets.css:1093(030) `100%`<br>**padding** ↑: app.css:1588(010) `12px` → ui-sheets.css:1095(030) `var(--sheet-pad)`<br>**width**: pol-shell.css:426(030) `min(360px, 100%)` → ui-sheets.css:1092(030) `min(380px, 100%)` |
| `.onyx-member-identity` | `(base)` |  | **gap** ↑: app.css:1590(010) `10px` → ui-sheets.css:1101(020) `var(--space-3)` |
| `.onyx-member-message` | `(base)` |  | **background** ↑: app.css:2758(010) `transparent` → pol-roster.css:294(020) `var(--onyx-panel)`<br>**color** ↑: app.css:2761(010) `var(--onyx-text)` → pol-roster.css:297(020) `var(--onyx-dim)`<br>**min-height** ↑: app.css:2764(010) `24px` → pol-roster.css:291(020) `0`<br>**padding** ↑: app.css:2765(010) `2px var(--space-2)` → pol-roster.css:292(020) `0` |
| `.onyx-member-mod` | `(base)` |  | **display** ↑: app.css:1625(010) `flex` → gap-people.css:65(020) `grid`<br>**gap** ↑: app.css:1625(010) `8px` → gap-people.css:66(020) `var(--space-2)` |
| `.onyx-member-name` | `(base)` |  | **font-size** ↑: app.css:1603(010) `0.9375rem` → ui-sheets.css:1102(020) `var(--text-lg)`<br>**font-weight** ↑: app.css:1603(010) `700` → ui-sheets.css:1102(020) `650` |
| `.onyx-member-nickline` | `(base)` |  | **font-size** ↑: app.css:1604(010) `0.8125rem` → ui-sheets.css:1104(020) `var(--text-sm)`<br>**margin** ↑: app.css:1604(010) `2px 0 0` → ui-sheets.css:1104(020) `0` |
| `.onyx-member-presence-dot` | `(base)` |  | **background** ↑: app.css:2740(010) `var(--onyx-dim)` → pol-roster.css:237(020) `var(--onyx-text)`<br>**bottom** ↑: app.css:2743(010) `-1px` → pol-roster.css:234(020) `-2px`<br>**height** ↑: app.css:2744(010) `8px` → pol-roster.css:236(020) `10px`<br>**right** ↑: app.css:2746(010) `-1px` → pol-roster.css:233(020) `-2px`<br>**width** ↑: app.css:2747(010) `8px` → pol-roster.css:235(020) `10px` |
| `.onyx-member-presence-dot--away` | `(base)` |  | **box-shadow** ↑: app.css:2749(010) `inset 0 0 0 2px var(--on` → pol-roster.css:243(020) `inset 0 0 0 1.5px var(--` |
| `.onyx-member-pronouns` | `(base)` |  | **font-size** ↑: app.css:1604(010) `0.8125rem` → ui-sheets.css:1104(020) `var(--text-sm)`<br>**margin** ↑: app.css:1604(010) `2px 0 0` → ui-sheets.css:1104(020) `0` |
| `.onyx-member-role` | `(base)` |  | **padding** ↑: app.css:2754(010) `0 6px` → pol-roster.css:262(020) `0` |
| `.onyx-mention` | `(base)` |  | **background** **flip**: gap-appearance.css:243(030) `color-mix(in oklab, var(` → pol-thread.css:173(010) `color-mix(in oklab, var(` |
| `.onyx-mention` | `:hover` |  | **background** **flip**: gap-appearance.css:245(040) `color-mix(in oklab, var(` → pol-thread.css:180(020) `color-mix(in oklab, var(` |
| `.onyx-mention` | `:focus-within` |  | **background** **flip**: gap-appearance.css:245(040) `color-mix(in oklab, var(` → pol-thread.css:180(020) `color-mix(in oklab, var(` |
| `.onyx-message` | `:not()` |  | **line-height** **flip**: gap-appearance.css:165(040) `1.4` → gap-appearance.css:173(040) `1.62` → pol-thread.css:106(020) `var(--leading-body)` |
| `.onyx-message` | `:not():not()` |  | **margin-top** **flip**: gap-appearance.css:167(050) `var(--space-1)` → gap-appearance.css:175(050) `var(--space-5)` → pol-thread.css:110(030) `var(--space-3)` → gap-organize.css:669(050) `var(--space-5)`<br>**min-height** **flip**: gap-appearance.css:187(050) `calc(1.5rem + var(--spac` → gap-appearance.css:191(050) `calc(2.5rem + var(--spac` → pol-thread.css:112(030) `calc(2rem + var(--space-`<br>**padding-top** **flip**: gap-appearance.css:168(050) `2px` → gap-appearance.css:176(050) `var(--space-2)` → pol-thread.css:111(030) `var(--space-1)` |
| `.onyx-message--compact` | `(base)` |  | **line-height** ↑ **flip**: app.css:3169(010) `1.45` → gap-appearance.css:170(030) `1.35` → gap-appearance.css:178(030) `1.6` → pol-thread.css:2241(020) `var(--leading-snug)`<br>**padding** ↑: app.css:3169(010) `1px 0` → pol-thread.css:2239(020) `1px var(--space-2) 1px c` |
| `.onyx-mlist-main` | `(base)` |  | **min-height** **flip**: gap-appearance.css:202(040) `48px` → pol-roster.css:202(020) `40px` |
| `.onyx-mobile-nav` | `(base)` | @media (max-width: 599.98px) | **display** ↑: app.css:4057(020) `flex` → pol-shell.css:1206(040) `none` → pol-ios.css:110(040) `none`<br>**gap**: app.css:4059(020) `2px` → pol-shell.css:1412(020) `0`<br>**padding**: app.css:4061(020) `var(--space-1) var(--spa` → pol-shell.css:1414(020) `0 var(--space-1) var(--s` |
| `.onyx-moddesk-close` | `(base)` |  | **position** ↑: app.css:3067(010) `absolute` → ui-sheets.css:732(030) `static` |
| `.onyx-moddesk-errors` | `(base)` |  | **font-size** ↑: app.css:3077(010) `var(--text-sm)` → gap-oper.css:401(020) `var(--oc-fs)` |
| `.onyx-moddesk-form` | `(base)` |  | **border-top** ↑: app.css:3081(010) `1px solid var(--onyx-lin` → gap-oper.css:390(020) `0` → gap-oper.css:395(020) `0`<br>**padding-top** ↑: app.css:3081(010) `var(--space-3)` → gap-oper.css:390(020) `0` → gap-oper.css:395(020) `0` |
| `.onyx-moddesk-hint` | `(base)` |  | **font-size** ↑: app.css:3075(010) `var(--text-sm)` → gap-oper.css:392(020) `var(--oc-fs-meta)` → gap-oper.css:401(020) `var(--oc-fs)` |
| `.onyx-moddesk-offline` | `(base)` |  | **font-size** ↑: app.css:3076(010) `var(--text-sm)` → gap-oper.css:401(020) `var(--oc-fs)` |
| `.onyx-moddesk-sheet` | `(base)` |  | **padding** ↑: app.css:3062(010) `var(--space-4)` → ui-sheets.css:730(020) `0 var(--sheet-pad) var(-` |
| `.onyx-moddesk-toggle` | `(base)` |  | **min-height** ↑: app.css:3054(010) `24px` → pol-shell.css:667(020) `32px` |
| `.onyx-moderation-actions` | `(base)` |  | **gap** ↑: app.css:1644(010) `8px` → ui-sheets.css:1585(030) `var(--space-2)` |
| `.onyx-msg-menu` | `(base)` |  | **background** ↑: app.css:1452(010) `var(--onyx-panel-2)` → pol-thread.css:280(020) `var(--onyx-panel)`<br>**border-radius** ↑: app.css:1454(010) `6px` → pol-thread.css:282(020) `var(--radius)`<br>**gap** ↑: app.css:1457(010) `2px` → pol-thread.css:285(020) `0`<br>**margin** ↑: app.css:1458(010) `4px 0 4px 16px` → pol-thread.css:279(020) `0`<br>**max-width** ↑: app.css:1459(010) `280px` → pol-thread.css:285(020) `none`<br>**padding** ↑: app.css:1460(010) `6px` → pol-thread.css:285(020) `var(--space-1)` |
| `.onyx-msg-menu-item` | `:hover` |  | **background** ↑: app.css:1472(020) `var(--onyx-panel)` → pol-thread.css:304(030) `var(--onyx-panel-2)` |
| `.onyx-msg-menu-item` | `(base)` |  | **border** ↑: app.css:1464(010) `none` → pol-thread.css:294(030) `0`<br>**border-radius** ↑: app.css:1465(010) `6px` → pol-thread.css:295(030) `4px`<br>**font-size** ↑: app.css:1468(010) `0.8125rem` → pol-thread.css:298(030) `var(--text-sm)`<br>**padding** ↑: app.css:1469(010) `6px 10px` → pol-thread.css:292(030) `0 var(--space-3)` |
| `.onyx-msg-menu-trigger` | `(base)` |  | **border** ↑: app.css:1437(010) `1px solid transparent` → pol-thread.css:239(020) `0`<br>**border-radius** ↑: app.css:1438(010) `6px` → pol-thread.css:240(020) `4px`<br>**color** ↑: app.css:1439(010) `var(--onyx-faint)` → pol-thread.css:241(020) `var(--onyx-dim)`<br>**padding** ↑: app.css:1444(010) `0 6px` → pol-thread.css:237(020) `0` |
| `.onyx-msg-menu-trigger` | `:hover` |  | **border-color** ↑: app.css:1448(020) `var(--onyx-line)` → pol-thread.css:246(030) `transparent` |
| `.onyx-msg-menu-trigger` | `[aria-expanded=""]` |  | **border-color** ↑: app.css:1448(020) `var(--onyx-line)` → pol-thread.css:246(030) `transparent` |
| `.onyx-nav-badge` | `(base)` |  | **font-size** ↑: pol-shell.css:709(010) `0.625rem` → rx-shell.css:364(020) `0.6875rem`<br>**height** ↑: pol-shell.css:706(010) `16px` → rx-shell.css:362(020) `18px`<br>**left** ↑: pol-shell.css:704(010) `calc(100% - 7px)` → rx-shell.css:360(020) `calc(100% - 3px)`<br>**line-height** ↑: pol-shell.css:711(010) `16px` → rx-shell.css:365(020) `18px`<br>**min-width** ↑: pol-shell.css:705(010) `16px` → rx-shell.css:361(020) `18px`<br>**padding** ↑: pol-shell.css:707(010) `0 4px` → rx-shell.css:363(020) `0 5px`<br>**top** ↑: pol-shell.css:703(010) `-6px` → rx-shell.css:359(020) `-9px` |
| `.onyx-nav-btn` | `(base)` |  | **border** ↑: app.css:2349(010) `1px solid transparent` → pol-shell.css:682(020) `0`<br>**color** ↑: app.css:2347(010) `var(--onyx-dim)` → pol-shell.css:681(020) `var(--onyx-faint)`<br>**min-height** ↑: app.css:2346(010) `44px` → app.css:3673(020) `var(--target-min)` → pol-shell.css:678(020) `40px`<br>**padding** ↑: app.css:2345(010) `var(--space-2) 2px` → app.css:3672(020) `var(--space-2) 0` → pol-shell.css:679(020) `0` |
| `.onyx-nav-btn` | `(base)` | @media (max-width: 599.98px) | **font-size**: app.css:4066(020) `var(--text-xs)` → pol-shell.css:1424(020) `0.6875rem` |
| `.onyx-nav-icon` | `(base)` |  | **background**: app.css:2367(020) `var(--onyx-accent)` → app.css:2372(010) `currentColor` → pol-shell.css:699(020) `currentColor` → pol-shell.css:700(020) `var(--onyx-accent)` |
| `.onyx-newmsg-sheet` | `(base)` |  | **gap**: app.css:612(010) `10px` → ui-sheets.css:777(010) `var(--space-3)` |
| `.onyx-palette-launcher` | `(base)` |  | **color** ↑: app.css:2801(010) `var(--onyx-dim)` → pol-shell.css:594(020) `var(--onyx-faint)`<br>**flex** ↑: app.css:2805(010) `none` → pol-shell.css:589(020) `1 1 auto`<br>**padding** ↑: app.css:2797(010) `var(--space-1) 10px` → pol-shell.css:593(020) `0 var(--space-2) 0 10px` |
| `.onyx-palette-launcher` | `:hover` |  | **color** ↑: app.css:2807(020) `var(--onyx-text)` → pol-shell.css:598(030) `var(--onyx-dim)` |
| `.onyx-prefs-body` | `(base)` |  | **grid-template-columns** ↑: app.css:3259(010) `200px minmax(0, 1fr)` → ui-sheets.css:692(020) `212px minmax(0, 1fr)` |
| `.onyx-primary-nav` | `(base)` |  | **align-items** ↑: app.css:2321(010) `stretch` → pol-shell.css:671(020) `center`<br>**gap** ↑: app.css:2322(010) `var(--space-1)` → app.css:3620(020) `var(--space-1)` → pol-shell.css:672(020) `2px`<br>**padding** ↑: app.css:2323(010) `10px 6px` → app.css:3619(020) `var(--space-2) var(--spa` → pol-shell.css:673(020) `var(--space-2) 0` |
| `.onyx-profile-account` | `(base)` |  | **font-size** ↑: app.css:1550(010) `0.8125rem` → ui-sheets.css:791(020) `var(--text-sm)` |
| `.onyx-profile-nick` | `(base)` |  | **font-size** ↑: app.css:1549(010) `0.875rem` → ui-sheets.css:790(020) `var(--text-lg)`<br>**font-weight** ↑: app.css:1549(010) `700` → ui-sheets.css:790(020) `650` |
| `.onyx-rail` | `(base)` |  | **padding** ↑: app.css:414(010) `12px` → pol-shell.css:725(020) `0 var(--space-2) var(--s` |
| `.onyx-rail-avatar` | `(base)` |  | **border-radius** ↑: app.css:586(010) `var(--radius)` → pol-shell.css:440(020) `50%` → pol-shell.css:855(020) `50%`<br>**height** ↑: app.css:585(010) `24px` → pol-shell.css:855(020) `28px`<br>**width** ↑: app.css:584(010) `24px` → pol-shell.css:855(020) `28px` |
| `.onyx-rail-color` | `(base)` |  | **border-radius** ↑: app.css:575(010) `3px` → pol-shell.css:821(020) `2px`<br>**height** ↑: app.css:577(010) `10px` → pol-shell.css:821(020) `14px`<br>**width** ↑: app.css:578(010) `4px` → pol-shell.css:821(020) `3px` |
| `.onyx-rail-copy` | `(base)` |  | **flex-direction** ↑: app.css:548(010) `column` → pol-shell.css:831(020) `row` |
| `.onyx-rail-empty` | `(base)` |  | **color** ↑: app.css:537(010) `var(--onyx-dim)` → pol-shell.css:791(020) `var(--onyx-faint)` → rx-shell.css:296(030) `var(--onyx-dim)`<br>**padding** ↑: pol-shell.css:791(020) `var(--space-1) var(--spa` → rx-shell.css:296(030) `0` |
| `.onyx-rail-filter` | `(base)` |  | **gap** ↑: app.css:485(010) `6px` → pol-shell.css:741(020) `var(--space-1)`<br>**margin** ↑: app.css:487(010) `0 0 var(--space-3)` → pol-shell.css:741(020) `0 0 var(--space-2)` |
| `.onyx-rail-filter-clear` | `(base)` |  | **font-size**: app.css:511(020) `var(--text-2xs)` → pol-shell.css:766(020) `var(--text-xs)`<br>**padding**: app.css:512(020) `3px var(--space-2)` → pol-shell.css:765(020) `0 var(--space-2)` |
| `.onyx-rail-filter-input` | `(base)` |  | **padding** ↑: app.css:499(010) `5px var(--space-2)` → pol-shell.css:756(020) `0 var(--space-2) 0 28px` |
| `.onyx-rail-filter-unread` | `(base)` |  | **font-size**: app.css:511(020) `var(--text-2xs)` → pol-shell.css:766(020) `var(--text-xs)`<br>**padding**: app.css:512(020) `3px var(--space-2)` → pol-shell.css:765(020) `0 var(--space-2)` |
| `.onyx-rail-filter-unread-on` | `(base)` |  | **border-color**: app.css:515(020) `var(--onyx-accent)` → pol-shell.css:770(020) `var(--onyx-dim)`<br>**color**: app.css:516(020) `var(--onyx-accent)` → pol-shell.css:770(020) `var(--onyx-text)` |
| `.onyx-rail-foot` | `(base)` |  | **display** ↑: pol-shell.css:739(030) `none` → pol-shell.css:876(010) `flex` → rx-shell.css:316(040) `none` |
| `.onyx-rail-item` | `(base)` |  | **flex** ↑: app.css:545(020) `1` → rx-shell.css:66(030) `1 1 auto`<br>**min-height** **flip**: gap-appearance.css:200(040) `44px` → pol-shell.css:800(020) `32px` |
| `.onyx-rail-label` | `(base)` |  | **letter-spacing** ↑: app.css:533(010) `0.08em` → pol-shell.css:776(020) `var(--tracking-kicker)`<br>**margin**: app.css:528(020) `0` → app.css:535(010) `0 0 var(--space-2)` → pol-shell.css:776(020) `var(--space-2) 0 var(--s` |
| `.onyx-rail-meta` | `(base)` |  | **gap**: app.css:559(010) `6px` → pol-shell.css:828(010) `4px` |
| `.onyx-rail-name` | `(base)` |  | **color** ↑: app.css:459(020) `var(--onyx-accent)` → pol-shell.css:817(030) `var(--onyx-text)`<br>**font-weight** ↑: app.css:460(020) `650` → app.css:562(020) `650` → pol-shell.css:817(030) `650` → pol-shell.css:819(030) `700` |
| `.onyx-rail-new` | `(base)` |  | **color** ↑: app.css:510(020) `var(--onyx-dim)` → pol-shell.css:784(020) `var(--onyx-dim)` → pol-shell.css:790(030) `var(--onyx-text)`<br>**font-size**: app.css:511(020) `var(--text-2xs)` → pol-shell.css:785(020) `var(--text-xs)`<br>**padding**: app.css:512(020) `3px var(--space-2)` → pol-shell.css:781(020) `0 var(--space-2)` |
| `.onyx-rail-section-heading` | `(base)` |  | **justify-content** ↑: app.css:524(010) `space-between` → pol-shell.css:1464(030) `flex-end` |
| `.onyx-rail-star` | `(base)` |  | **border**: app.css:509(020) `1px solid var(--onyx-lin` → pol-shell.css:863(020) `0`<br>**color**: app.css:510(020) `var(--onyx-dim)` → app.css:595(020) `var(--onyx-faint)` → pol-shell.css:864(020) `var(--onyx-faint)`<br>**padding**: app.css:512(020) `3px var(--space-2)` → app.css:596(020) `3px 6px` → pol-shell.css:862(020) `0`<br>**width**: app.css:507(020) `auto` → pol-shell.css:860(020) `28px` |
| `.onyx-rail-star-on` | `(base)` |  | **color**: app.css:598(020) `var(--onyx-accent)` → app.css:4021(020) `var(--onyx-text)` → pol-shell.css:872(020) `var(--onyx-dim)` |
| `.onyx-rail-sub` | `(base)` |  | **color** ↑: app.css:553(010) `var(--onyx-faint)` → pol-shell.css:826(020) `var(--onyx-faint)` → pol-shell.css:827(030) `var(--onyx-dim)`<br>**font-size** ↑: app.css:554(010) `var(--text-2xs)` → pol-shell.css:826(020) `var(--text-xs)` |
| `.onyx-rail-unread` | `(base)` |  | **border-radius** ↑: app.css:565(010) `var(--radius)` → pol-shell.css:848(020) `var(--r-pill)`<br>**font-size** ↑: app.css:567(010) `var(--text-xs)` → pol-shell.css:842(020) `0.6875rem`<br>**padding** ↑: app.css:570(010) `1px 5px` → pol-shell.css:840(020) `0 5px` |
| `.onyx-railmenu-item` | `(base)` |  | **min-height** **flip**: rx-shell.css:182(030) `34px` → gap-organize.css:253(020) `var(--target-min)`<br>**padding** **flip**: rx-shell.css:183(030) `0 var(--space-3)` → gap-organize.css:254(020) `var(--space-1) var(--spa` |
| `.onyx-react-choice` | `:hover` |  | **background** ↑: app.css:1505(020) `var(--onyx-panel)` → pol-thread.css:337(030) `var(--onyx-panel-2)` |
| `.onyx-react-choice` | `(base)` |  | **font-size** ↑: app.css:1502(010) `1.125rem` → pol-thread.css:333(030) `1.25rem`<br>**padding** ↑: app.css:1503(010) `4px` → pol-thread.css:332(030) `0` |
| `.onyx-react-grid` | `(base)` |  | **grid-template-columns** ↑: app.css:1494(010) `repeat(6, 1fr)` → pol-thread.css:326(020) `repeat(8, minmax(0, 1fr)` |
| `.onyx-react-picker` | `(base)` |  | **background** ↑: app.css:1474(010) `var(--onyx-panel-2)` → pol-thread.css:280(020) `var(--onyx-panel)`<br>**border-radius** ↑: app.css:1476(010) `6px` → pol-thread.css:282(020) `var(--radius)`<br>**gap** ↑: app.css:1479(010) `6px` → pol-thread.css:315(020) `var(--space-2)`<br>**margin** ↑: app.css:1480(010) `4px 0 4px 16px` → pol-thread.css:279(020) `0`<br>**max-width** ↑: app.css:1481(010) `280px` → pol-thread.css:315(020) `none`<br>**padding** ↑: app.css:1482(010) `6px` → pol-thread.css:315(020) `var(--space-2)` |
| `.onyx-react-search` | `(base)` |  | **background** ↑: app.css:1485(010) `var(--onyx-panel)` → pol-thread.css:319(020) `var(--onyx-bg)`<br>**border-radius** ↑: app.css:1487(010) `6px` → pol-thread.css:321(020) `var(--radius)`<br>**font-size** ↑: app.css:1489(010) `0.8125rem` → pol-thread.css:324(020) `var(--text-sm)`<br>**padding** ↑: app.css:1490(010) `6px 10px` → pol-thread.css:318(020) `0 var(--space-3)` |
| `.onyx-reclaim-lead` | `(base)` |  | **font-size** ↑: app.css:354(010) `0.8125rem` → ui-sheets.css:786(020) `var(--text-md)`<br>**margin** ↑: app.css:353(010) `0 0 12px` → ui-sheets.css:786(020) `0 0 var(--space-4)` |
| `.onyx-reconnect-msg` | `(base)` |  | **white-space**: app.css:315(010) `nowrap` → gap-shell.css:334(010) `normal` |
| `.onyx-room-header` | `(base)` |  | **min-height** ↑: app.css:3818(010) `48px` → pol-shell.css:898(020) `52px`<br>**padding** ↑: app.css:3819(010) `var(--space-2) var(--spa` → pol-shell.css:899(020) `var(--space-2) var(--spa`<br>**row-gap** **flip**: pol-shell.css:897(020) `2px` → roomsettings.css:9(010) `var(--space-1)` |
| `.onyx-room-header-actions` | `(base)` |  | **gap** ↑: app.css:3853(010) `var(--space-2)` → pol-shell.css:936(020) `2px` |
| `.onyx-room-header-id` | `(base)` |  | **align-items** ↑: app.css:3828(010) `baseline` → pol-shell.css:907(020) `center`<br>**flex** ↑: app.css:3825(010) `1 1 auto` → pol-shell.css:905(020) `1 1 0`<br>**gap** ↑: app.css:3829(010) `var(--space-3)` → pol-shell.css:908(020) `var(--space-2)` |
| `.onyx-room-header-name` | `(base)` |  | **font-size** ↑: app.css:3834(010) `var(--text-md)` → pol-shell.css:922(020) `var(--text-lg)`<br>**font-weight** ↑: app.css:3835(010) `650` → pol-shell.css:923(020) `700` |
| `.onyx-room-more-menu` | `(base)` | @media (max-width: 599.98px) | **animation** **flip**: pol-shell.css:1296(020) `onyx-sheet-in var(--dur-` → ui-sheets.css:1000(010) `ui-sheet-rise var(--dur-`<br>**border-radius** **flip**: pol-shell.css:1294(020) `calc(var(--radius) * 2) ` → ui-sheets.css:998(010) `12px 12px 0 0`<br>**bottom** **flip**: pol-shell.css:1288(020) `0` → ui-sheets.css:993(010) `0` → ui-sheets.css:1077(010) `var(--kb-inset, 0px)`<br>**padding** **flip**: pol-shell.css:1292(020) `0 var(--space-2) calc(va` → ui-sheets.css:996(010) `var(--sheet-grip-zone) v`<br>**z-index** **flip**: pol-shell.css:1289(020) `59` → ui-sheets.css:994(010) `61` |
| `.onyx-room-more-menu` | `(base)` |  | **min-width** ↑: app.css:3866(010) `200px` → pol-shell.css:970(020) `248px` |
| `.onyx-room-more-scrim` | `(base)` | @media (max-width: 599.98px) | **background** **flip**: pol-shell.css:1282(020) `color-mix(in srgb, #000 ` → ui-sheets.css:985(010) `var(--sheet-veil)`<br>**z-index** **flip**: pol-shell.css:1282(020) `58` → ui-sheets.css:984(010) `60` |
| `.onyx-room-more-toggle` | `[aria-expanded=""]` |  | **border-color** ↑: app.css:3756(020) `var(--onyx-dim)` → pol-shell.css:955(040) `transparent` → pol-shell.css:955(040) `transparent` |
| `.onyx-room-privacy` | `(base)` |  | **color** **flip**: pol-shell.css:930(030) `var(--onyx-faint)` → roomsettings.css:36(010) `var(--onyx-dim)` |
| `.onyx-room-topic-toggle` | `(base)` |  | **color** **flip**: pol-shell.css:929(020) `var(--onyx-faint)` → roomsettings.css:53(010) `var(--onyx-dim)` |
| `.onyx-roster-care` | `(base)` |  | **border** ↑: app.css:1426(010) `1px solid var(--onyx-lin` → pol-roster.css:318(020) `0`<br>**font-size** ↑: app.css:1430(010) `0.75rem` → pol-roster.css:321(020) `var(--text-sm)`<br>**padding** ↑: app.css:1432(010) `2px 10px` → pol-roster.css:316(020) `var(--space-1) 0` |
| `.onyx-roster-count` | `(base)` |  | **color** ↑: app.css:2720(010) `var(--onyx-dim)` → pol-roster.css:62(020) `var(--onyx-faint)` |
| `.onyx-roster-empty` | `(base)` |  | **margin** ↑: app.css:2735(010) `var(--space-2) 0` → pol-roster.css:127(020) `var(--space-3) var(--spa` |
| `.onyx-roster-filter` | `(base)` |  | **margin** ↑: app.css:2721(010) `var(--space-1) 0 var(--s` → pol-roster.css:94(020) `var(--space-1) var(--spa` → pol-roster.css:436(020) `0 var(--space-1) var(--s` |
| `.onyx-roster-filter-input` | `(base)` |  | **background** ↑: app.css:2723(010) `var(--onyx-bg)` → pol-roster.css:107(020) `transparent`<br>**border** ↑: app.css:2724(010) `1px solid var(--onyx-lin` → pol-roster.css:108(020) `0`<br>**min-height** ↑: app.css:2730(010) `32px` → pol-roster.css:105(020) `30px` → pol-roster.css:441(020) `0`<br>**padding** ↑: app.css:2731(010) `var(--space-1) var(--spa` → pol-roster.css:106(020) `0` |
| `.onyx-roster-filter-input` | `:focus-visible` |  | **outline** ↑: app.css:2734(020) `var(--focus-ring)` → pol-roster.css:112(030) `none` |
| `.onyx-roster-head` | `(base)` |  | **align-items** ↑: app.css:2718(010) `baseline` → pol-roster.css:45(020) `center`<br>**justify-content** ↑: app.css:2718(010) `space-between` → pol-roster.css:47(020) `flex-start` |
| `.onyx-schedule-pop` | `(base)` |  | **width**: app.css:1132(010) `min(280px, calc(100vw - ` → gap-usermodes.css:364(010) `min(320px, calc(100vw - ` |
| `.onyx-schedule-when` | `(base)` |  | **flex** ↑: app.css:1163(010) `1` → gap-usermodes.css:366(020) `1 1 160px` |
| `.onyx-search-toggle-open` | `(base)` |  | **border-color** ↑: app.css:3756(010) `var(--onyx-dim)` → pol-shell.css:955(030) `transparent` |
| `.onyx-sec-chip` | `[data-tone=""]` |  | **color** ↑: app.css:3505(020) `var(--onyx-text)` → app.css:3506(020) `var(--onyx-warn)` → app.css:3507(020) `var(--onyx-bad)` → calls-engine.css:150(030) `var(--onyx-dim)` |
| `.onyx-sec-chip` | `(base)` |  | **height** ↑: app.css:3500(010) `28px` → calls-engine.css:144(020) `32px`<br>**padding** ↑: app.css:3500(010) `0 9px` → calls-engine.css:144(020) `0` |
| `.onyx-sender` | `(base)` |  | **margin-right** ↑: app.css:680(010) `8px` → app.css:3176(020) `6px` → pol-thread.css:129(030) `var(--space-2)` → pol-thread.css:2255(020) `var(--space-2)` |
| `.onyx-sheet` | `(base)` |  | **animation**: app.css:3941(020) `onyx-sheet-in var(--dur-` → ui-sheets.css:95(020) `ui-sheet-pop var(--dur-b`<br>**animation-name**: app.css:3949(030) `onyx-sheet-side-in` → ui-sheets.css:142(030) `ui-sheet-side` → ui-sheets.css:159(030) `ui-sheet-drop`<br>**border-radius** **flip**: app.css:3948(030) `0` → ui-sheets.css:88(020) `var(--radius)` → ui-sheets.css:141(030) `0`<br>**max-height** **flip**: app.css:3946(030) `none` → ui-sheets.css:87(020) `var(--sheet-max-h)` → ui-sheets.css:139(030) `none` → ui-sheets.css:158(030) `min(calc(var(--vvh, 100d` |
| `.onyx-sheet-backdrop` | `(base)` |  | **animation** **flip**: rx-shell.css:245(030) `none` → ui-sheets.css:83(010) `ui-sheet-veil-in var(--d`<br>**background** **flip**: app.css:3326(030) `var(--onyx-bg)` → app.css:3915(010) `color-mix(in srgb, #000 ` → rx-shell.css:245(030) `transparent` → ui-sheets.css:82(010) `var(--sheet-veil)` → ui-sheets.css:153(030) `color-mix(in srgb, #000 ` |
| `.onyx-sheet-close` | `(base)` |  | **border** ↑: app.css:3987(010) `1px solid var(--onyx-lin` → ui-sheets.css:266(020) `0` → ui-sheets.css:266(010) `0`<br>**min-height** ↑: app.css:3982(010) `32px` → ui-sheets.css:259(020) `var(--sheet-close)` → ui-sheets.css:259(010) `var(--sheet-close)`<br>**min-width** ↑: app.css:3981(010) `32px` → ui-sheets.css:258(020) `var(--sheet-close)` → ui-sheets.css:258(010) `var(--sheet-close)` |
| `.onyx-sheet-head` | `(base)` |  | **margin-bottom** ↑: app.css:3967(010) `var(--space-3)` → roomsettings.css:128(020) `0` → ui-sheets.css:531(020) `0` → ui-sheets.css:778(020) `var(--space-1)` |
| `.onyx-sheet-layer` | `(base)` |  | **padding**: app.css:3903(010) `var(--space-4)` → ui-sheets.css:79(010) `var(--space-6) var(--spa` |
| `.onyx-sheet-layer` | `[data-placement=""]` |  | **padding**: app.css:3909(020) `0` → ui-sheets.css:135(020) `0` → ui-sheets.css:150(020) `52px var(--space-4) var(`<br>**place-items**: app.css:3908(020) `stretch end` → ui-sheets.css:149(020) `start end` |
| `.onyx-sheet-title` | `(base)` |  | **font-size** ↑: app.css:3972(010) `var(--text-lg)` → ui-sheets.css:210(020) `var(--text-lg)` → ui-sheets.css:1526(061) `var(--text-md)` |
| `.onyx-sheet-x` | `(base)` |  | **height** ↑ **flip**: gap-chanserv.css:188(020) `14px` → gap-shell.css:296(041) `16px` → ui-sheets.css:69(010) `18px` → ui-sheets.css:569(030) `14px` → ui-sheets.css:957(020) `14px`<br>**width** ↑ **flip**: gap-chanserv.css:188(020) `14px` → gap-shell.css:296(041) `16px` → ui-sheets.css:68(010) `18px` → ui-sheets.css:569(030) `14px` → ui-sheets.css:957(020) `14px` |
| `.onyx-shi` | `(base)` |  | **height** ↑ **flip**: pol-shell.css:524(010) `20px` → pol-shell.css:789(030) `14px` → pol-shell.css:853(030) `14px` → pol-shell.css:868(030) `15px` → pol-shell.css:888(030) `18px` → pol-shell.css:1083(020) `16px` → pol-shell.css:1138(020) `16px` → rx-shell.css:81(030) `16px` → rx-shell.css:193(030) `18px` → rx-shell.css:294(020) `22px` → rx-shell.css:351(030) `19px` → rx-shell.css:354(020) `16px`<br>**width** ↑ **flip**: pol-shell.css:523(010) `20px` → pol-shell.css:789(030) `14px` → pol-shell.css:853(030) `14px` → pol-shell.css:868(030) `15px` → pol-shell.css:888(030) `18px` → pol-shell.css:1083(020) `16px` → pol-shell.css:1138(020) `16px` → rx-shell.css:81(030) `16px` → rx-shell.css:193(030) `18px` → rx-shell.css:294(020) `22px` → rx-shell.css:351(030) `19px` → rx-shell.css:354(020) `16px` |
| `.onyx-shi` | `(base)` | @media (max-width: 599.98px) | **height** **flip**: pol-shell.css:1235(020) `24px` → pol-shell.css:1263(020) `22px` → pol-shell.css:1337(030) `18px` → pol-shell.css:1339(040) `20px` → rx-shell.css:327(020) `28px`<br>**width** **flip**: pol-shell.css:1235(020) `24px` → pol-shell.css:1263(020) `22px` → pol-shell.css:1337(030) `18px` → pol-shell.css:1339(040) `20px` → rx-shell.css:327(020) `28px` |
| `.onyx-shortcuts-close` | `(base)` |  | **border**: app.css:2882(010) `1px solid var(--onyx-lin` → ui-sheets.css:266(010) `0`<br>**font-size**: app.css:2886(010) `var(--text-lg)` → ui-sheets.css:262(010) `0`<br>**line-height**: app.css:2887(010) `1` → ui-sheets.css:263(010) `0`<br>**min-height**: app.css:2880(010) `32px` → ui-sheets.css:259(010) `var(--sheet-close)`<br>**min-width**: app.css:2879(010) `32px` → ui-sheets.css:258(010) `var(--sheet-close)` |
| `.onyx-shortcuts-sheet` | `(base)` |  | **display** ↑: app.css:2840(010) `flex` → ui-sheets.css:514(020) `block`<br>**width** ↑: app.css:2837(010) `min(560px, 100%)` → ui-sheets.css:514(020) `min(680px, 100%)` |
| `.onyx-spotlight-backdrop` | `(base)` |  | **background** **flip**: app.css:2833(010) `rgb(0 0 0 / 55%)` → app.css:3326(030) `var(--onyx-bg)` → ui-sheets.css:435(010) `var(--sheet-veil)` |
| `.onyx-spotlight-close` | `(base)` |  | **border**: app.css:2882(010) `1px solid var(--onyx-lin` → ui-sheets.css:266(010) `0`<br>**font-size**: app.css:2886(010) `var(--text-lg)` → ui-sheets.css:262(010) `0`<br>**line-height**: app.css:2887(010) `1` → ui-sheets.css:263(010) `0`<br>**min-height**: app.css:2880(010) `32px` → ui-sheets.css:259(010) `var(--sheet-close)`<br>**min-width**: app.css:2879(010) `32px` → ui-sheets.css:258(010) `var(--sheet-close)` |
| `.onyx-spotlight-foot` | `(base)` |  | **padding**: app.css:3008(010) `var(--space-2) var(--spa` → ui-sheets.css:497(010) `var(--space-2) var(--spa` |
| `.onyx-spotlight-group` | `(base)` |  | **margin-top**: app.css:2967(020) `6px` → ui-sheets.css:465(020) `var(--space-2)` |
| `.onyx-spotlight-hint` | `(base)` |  | **color** ↑: app.css:2997(010) `var(--onyx-dim)` → ui-sheets.css:490(010) `var(--onyx-faint)` → ui-sheets.css:491(030) `var(--onyx-dim)`<br>**font-size**: app.css:2998(010) `var(--text-2xs)` → ui-sheets.css:490(010) `var(--text-sm)` |
| `.onyx-spotlight-icon` | `[data-icon=""]` |  | **-webkit-mask-image**: gap-commands.css:173(020) `var(--onyx-i-person)` → gap-commands.css:174(020) `var(--gap-i-clock)` → ui-sheets.css:486(020) `var(--onyx-i-hash)` → ui-sheets.css:487(020) `var(--onyx-i-person)`<br>**mask-image**: gap-commands.css:173(020) `var(--onyx-i-person)` → gap-commands.css:174(020) `var(--gap-i-clock)` → ui-sheets.css:486(020) `var(--onyx-i-hash)` → ui-sheets.css:487(020) `var(--onyx-i-person)` |
| `.onyx-spotlight-input` | `(base)` |  | **font-size**: app.css:2873(010) `var(--text-md)` → ui-sheets.css:459(010) `var(--text-lg)`<br>**padding**: app.css:2874(010) `6px 0` → ui-sheets.css:459(010) `10px 0` |
| `.onyx-spotlight-option` | `(base)` |  | **border-left**: app.css:2983(010) `2px solid transparent` → ui-sheets.css:471(010) `0`<br>**gap**: app.css:2979(010) `10px` → ui-sheets.css:468(010) `var(--space-3)`<br>**min-height**: app.css:2980(010) `36px` → ui-sheets.css:469(010) `40px`<br>**padding**: app.css:2981(010) `6px var(--space-2)` → ui-sheets.css:470(010) `0 var(--space-3)` |
| `.onyx-spotlight-panel` | `(base)` |  | **animation**: app.css:2847(010) `onyx-switcher-in var(--d` → ui-sheets.css:443(010) `ui-sheet-drop var(--dur-`<br>**box-shadow**: app.css:2846(010) `0 12px 32px rgb(0 8 16 /` → ui-sheets.css:441(010) `var(--elev-3)`<br>**max-height**: app.css:2838(010) `min(70vh, 560px)` → ui-sheets.css:439(010) `min(64vh, 560px)`<br>**width**: app.css:2837(010) `min(560px, 100%)` → ui-sheets.css:438(010) `min(600px, 100%)` |
| `.onyx-spotlight-results` | `(base)` |  | **padding**: app.css:2963(010) `6px` → ui-sheets.css:463(010) `var(--space-2)` |
| `.onyx-spotlight-search` | `(base)` |  | **gap**: app.css:2861(010) `var(--space-2)` → ui-sheets.css:447(010) `var(--space-3)`<br>**padding**: app.css:2862(010) `10px var(--space-3)` → ui-sheets.css:449(010) `0 var(--space-2) 0 var(-` |
| `.onyx-spotlight-section` | `(base)` |  | **padding**: app.css:2970(010) `6px var(--space-2) var(-` → ui-sheets.css:464(010) `var(--space-2) var(--spa` |
| `.onyx-system` | `(base)` |  | **font-size** ↑: app.css:151(010) `0.75rem` → pol-thread.css:2280(020) `var(--text-sm)` |
| `.onyx-thread` | `(base)` |  | **gap** ↑: app.css:674(010) `2px` → app.css:3168(020) `0` → pol-thread.css:2237(020) `0` |
| `.onyx-thread-desc` | `(base)` |  | **font-size** ↑: app.css:163(010) `0.75rem` → pol-thread.css:996(020) `var(--text-sm)` |
| `.onyx-thread-head` | `(base)` |  | **align-items** ↑: app.css:161(010) `baseline` → pol-thread.css:988(020) `center`<br>**gap** ↑: app.css:161(010) `8px` → pol-thread.css:989(020) `var(--space-3)` |
| `.onyx-thread-indicator` | `(base)` |  | **background** ↑: app.css:164(010) `none` → pol-thread.css:438(030) `transparent`<br>**border** ↑: app.css:164(010) `none` → pol-thread.css:439(030) `1px solid transparent`<br>**font-size** ↑: app.css:164(010) `0.75rem` → pol-thread.css:443(030) `var(--text-sm)`<br>**padding** ↑: app.css:164(010) `2px 4px` → pol-thread.css:437(030) `0 var(--space-2) 0 6px` |
| `.onyx-thread-msg` | `(base)` |  | **border** ↑: app.css:165(010) `1px solid var(--onyx-lin` → pol-thread.css:1021(020) `0`<br>**border-radius** ↑: app.css:165(010) `6px` → pol-thread.css:1022(020) `0`<br>**padding** ↑: app.css:165(010) `8px` → pol-thread.css:1019(020) `var(--space-2) var(--spa` |
| `.onyx-thread-msg-text` | `(base)` |  | **margin** ↑: app.css:167(010) `4px 0 0` → pol-thread.css:1036(020) `0` |
| `.onyx-thread-pane` | `(base)` | @media (min-width: 600px) | **padding-inline** **flip**: gap-appearance.css:223(050) `var(--space-4)` → rx-shell.css:612(030) `max(var(--space-4), calc` |
| `.onyx-thread-sheet` | `(base)` |  | **gap**: app.css:160(010) `12px` → pol-thread.css:982(010) `0`<br>**padding**: app.css:160(010) `16px` → pol-thread.css:982(010) `0` |
| `.onyx-thread-state` | `(base)` |  | **font-size** ↑: app.css:168(010) `0.75rem` → pol-thread.css:1051(020) `var(--text-sm)` |
| `.onyx-thread-title` | `(base)` |  | **font-size** ↑: app.css:162(010) `0.9375rem` → pol-thread.css:995(020) `var(--text-lg)` |
| `.onyx-tile` | `(base)` |  | **aspect-ratio** ↑: calls-c4.css:83(010) `16 / 9` → calls-c4.css:137(020) `auto` → calls-engine.css:349(020) `16 / 9`<br>**height**: calls-c4.css:137(020) `100%` → calls-engine.css:349(020) `auto`<br>**min-height**: calls-c4.css:137(020) `260px` → calls-engine.css:349(020) `0`<br>**width**: calls-c4.css:139(020) `160px` → calls-engine.css:349(020) `min(100%, calc(var(--gri` |
| `.onyx-tile` | `(base)` | @media (max-width: 767px) | **aspect-ratio**: calls-c4.css:155(020) `3 / 4` → calls-c4.css:156(030) `16 / 9` → calls-c4.css:159(020) `16 / 9` → calls-c4.css:160(020) `16 / 9` → calls-engine.css:379(020) `16 / 9` |
| `.onyx-tile-nick` | `(base)` |  | **font-size**: calls-c4.css:106(010) `var(--text-2xs)` → calls-c4.css:111(010) `var(--text-xs)` → calls-engine.css:350(010) `var(--text-sm)` |
| `.onyx-toast` | `(base)` |  | **align-items**: app.css:930(010) `flex-start` → ui-sheets.css:804(010) `center`<br>**border-radius**: app.css:935(010) `8px` → ui-sheets.css:808(010) `var(--radius)`<br>**gap**: app.css:931(010) `8px` → ui-sheets.css:805(010) `var(--space-3)`<br>**padding**: app.css:936(010) `8px 10px` → ui-sheets.css:807(010) `var(--space-2) var(--spa` |
| `.onyx-toaster` | `(base)` |  | **bottom**: app.css:917(010) `16px` → ui-sheets.css:800(010) `calc(var(--composer-h) +`<br>**max-width**: app.css:925(010) `min(360px, 90vw)` → ui-sheets.css:801(010) `min(380px, calc(100vw - `<br>**right**: app.css:916(010) `16px` → ui-sheets.css:799(010) `var(--space-5)`<br>**z-index**: app.css:918(010) `60` → ui-sheets.css:798(010) `90` |
| `.onyx-topbar` | `(base)` |  | **display** ↑: app.css:229(010) `flex` → pol-shell.css:574(020) `grid`<br>**gap** ↑: app.css:231(010) `var(--space-4)` → app.css:3709(010) `var(--space-3)` → pol-shell.css:577(020) `var(--space-4)`<br>**min-height** ↑: app.css:3711(010) `52px` → pol-shell.css:578(020) `48px`<br>**padding** ↑: app.css:232(010) `10px var(--space-4)` → app.css:3710(010) `var(--space-2) var(--spa` → pol-shell.css:579(020) `0 var(--space-3) 0 var(-` |
| `.onyx-topbar-global` | `(base)` |  | **gap** ↑: app.css:3724(010) `var(--space-2)` → pol-shell.css:601(020) `var(--space-1)` |
| `.onyx-topbar-search` | `(base)` |  | **justify-content** ↑: app.css:3718(010) `center` → pol-shell.css:587(020) `stretch` |
| `.onyx-topic` | `(base)` |  | **overflow** ↑: app.css:258(010) `hidden` → pol-thread.css:1332(020) `visible`<br>**white-space** ↑: app.css:260(010) `nowrap` → pol-thread.css:1333(020) `normal` |
| `.onyx-topic-tools` | `(base)` |  | **display** ↑: app.css:176(010) `flex` → pol-thread.css:638(011) `block`<br>**gap**: app.css:176(010) `8px` → pol-thread.css:2548(010) `var(--space-2)`<br>**padding** ↑: app.css:176(010) `4px 0` → pol-thread.css:638(011) `0 0 var(--space-2)` |
| `.onyx-ts` | `(base)` |  | **color** ↑: app.css:3171(020) `var(--onyx-dim)` → pol-thread.css:133(030) `var(--onyx-dim)` → pol-thread.css:2249(030) `var(--onyx-faint)`<br>**display** ↑: pol-thread.css:2246(030) `inline-block` → gap-organize.css:676(040) `none`<br>**font-size** ↑: app.css:3172(020) `var(--text-2xs)` → pol-thread.css:134(030) `var(--text-2xs)` → pol-thread.css:150(030) `0.65625rem` → pol-thread.css:2251(030) `var(--text-2xs)`<br>**opacity** ↑: pol-thread.css:151(030) `0` → pol-thread.css:156(030) `1` → pol-thread.css:156(030) `1` → gap-organize.css:675(040) `0.55` |
| `.onyx-voice-chip` | `(base)` |  | **height**: app.css:3384(010) `30px` → calls-engine.css:36(010) `32px`<br>**max-width**: app.css:3384(010) `100%` → calls-engine.css:36(010) `24rem` |
| `.onyx-you` | `(base)` |  | **padding** ↑: app.css:2400(010) `var(--space-4)` → ui-sheets.css:609(020) `0 var(--sheet-pad) var(-`<br>**width** ↑: app.css:2401(010) `min(440px, calc(100vw - ` → ui-sheets.css:608(020) `min(460px, 100%)` |
| `.onyx-you-close` | `(base)` |  | **border**: app.css:2416(010) `1px solid var(--onyx-lin` → ui-sheets.css:266(010) `0`<br>**color**: app.css:2414(010) `var(--onyx-text)` → ui-sheets.css:264(010) `var(--onyx-dim)`<br>**padding**: app.css:2418(010) `var(--space-1) var(--spa` → ui-sheets.css:261(010) `0` |
| `.onyx-you-desc` | `(base)` |  | **font-size** ↑: app.css:2411(010) `var(--text-2xs)` → ui-sheets.css:625(020) `var(--text-sm)` |
| `.onyx-you-group` | `(base)` |  | **margin-top** ↑: app.css:2424(010) `var(--space-4)` → ui-sheets.css:629(020) `var(--space-5)` |
| `.onyx-you-group__title` | `(base)` |  | **letter-spacing** ↑: app.css:2431(010) `0.08em` → ui-sheets.css:630(020) `var(--tracking-kicker)`<br>**margin** ↑: app.css:2427(010) `0 0 var(--space-1)` → ui-sheets.css:630(020) `0 0 2px` |
| `.onyx-you-head` | `(base)` |  | **gap** ↑: app.css:2407(010) `var(--space-3)` → pol-shell.css:1044(030) `14px` → ui-sheets.css:618(030) `14px` |
| `.onyx-you-leave` | `(base)` |  | **border** ↑: app.css:2461(010) `1px solid var(--onyx-lin` → ui-sheets.css:673(030) `1px solid color-mix(in o`<br>**color** ↑: app.css:2459(010) `var(--onyx-text)` → ui-sheets.css:671(030) `var(--onyx-bad)` |
| `.onyx-you-leave-row` | `(base)` |  | **justify-content** ↑: app.css:2456(010) `flex-end` → ui-sheets.css:667(020) `stretch`<br>**margin-top** ↑: app.css:2456(010) `var(--space-4)` → ui-sheets.css:667(020) `var(--space-6)` |
| `.onyx-you-lede` | `(base)` |  | **margin** ↑: app.css:2422(010) `var(--space-3) 0 0` → ui-sheets.css:627(020) `var(--space-4) 0 0` |
| `.onyx-you-link` | `(base)` |  | **border-radius** ↑: app.css:2446(010) `var(--radius)` → ui-sheets.css:646(020) `0`<br>**display** ↑: app.css:2438(010) `block` → ui-sheets.css:638(020) `flex`<br>**margin** ↑: app.css:2441(010) `0 0 6px` → ui-sheets.css:641(020) `0`<br>**padding** ↑: app.css:2442(010) `10px var(--space-3)` → ui-sheets.css:642(020) `var(--space-2) 40px var(` |
| `.onyx-you-nick` | `(base)` |  | **font-weight** ↑: app.css:2410(010) `650` → ui-sheets.css:624(020) `700`<br>**margin** ↑: app.css:2410(010) `var(--space-1) 0 0` → ui-sheets.css:624(020) `2px 0 0` |
| `.oper-event-console` | `(base)` |  | **border-top** ↑: app.css:3106(010) `1px solid var(--onyx-lin` → gap-oper.css:394(020) `0`<br>**padding-top** ↑: app.css:3106(010) `var(--space-3)` → gap-oper.css:394(020) `0` |
| `.pref-actions` | `(base)` |  | **margin-top** ↑: app.css:3286(010) `var(--space-2)` → gap-account.css:133(020) `0` |
| `.pref-category-content` | `(base)` |  | **padding** ↑: app.css:3266(010) `var(--space-4)` → ui-sheets.css:696(020) `var(--space-5) var(--she` |
| `.pref-category-tab` | `[aria-selected=""]` |  | **border-color** ↑: app.css:3263(020) `var(--onyx-line)` → ui-sheets.css:695(030) `transparent` |
| `.pref-category-tab` | `(base)` |  | **min-height** ↑: app.css:3262(010) `44px` → ui-sheets.css:694(020) `48px`<br>**padding** ↑: app.css:3262(010) `6px 10px` → ui-sheets.css:694(020) `6px 12px` |
| `.pref-desc` | `(base)` |  | **margin-bottom**: gap-import.css:268(020) `0` → gap-usermodes.css:111(020) `var(--space-2)` |
| `.pref-label` | `(base)` |  | **margin** ↑: app.css:3272(010) `0 0 6px` → gap-claim.css:32(020) `0` |
| `.pref-switch` | `(base)` |  | **background** ↑: app.css:3282(010) `var(--onyx-bg)` → ui-sheets.css:1327(020) `var(--onyx-bg)` → ui-sheets.css:1340(040) `var(--onyx-text)`<br>**border-color** ↑: app.css:3284(030) `var(--onyx-accent)` → ui-sheets.css:1340(040) `var(--onyx-text)`<br>**height** ↑: app.css:3282(010) `20px` → ui-sheets.css:1323(020) `24px`<br>**width** ↑: app.css:3282(010) `34px` → ui-sheets.css:1322(020) `40px` |
| `.pref-switch` | `::after` |  | **background** ↑ **flip**: app.css:3283(011) `var(--onyx-dim)` → app.css:3285(031) `var(--onyx-accent)` → ui-sheets.css:1336(021) `var(--onyx-dim)` → ui-sheets.css:1342(041) `var(--onyx-panel)`<br>**height** ↑: app.css:3283(011) `14px` → ui-sheets.css:1335(021) `18px`<br>**transform** ↑: app.css:3285(031) `translateX(14px)` → ui-sheets.css:1342(041) `translateX(16px)`<br>**transition** ↑: app.css:3283(011) `transform var(--dur-fast` → ui-sheets.css:1337(021) `transform var(--dur-fast`<br>**width** ↑: app.css:3283(011) `14px` → ui-sheets.css:1334(021) `18px` |
| `.pt-ico` | `(base)` | @media (max-width: 599.98px) | **height**: pol-shell.css:1265(040) `21px` → pol-roster.css:395(040) `20px` → pol-roster.css:395(040) `20px`<br>**width**: pol-shell.css:1265(040) `21px` → pol-roster.css:395(040) `20px` → pol-roster.css:395(040) `20px` |
| `.pt-ico` | `(base)` |  | **height** ↑ **flip**: pol-thread.css:30(010) `18px` → pol-thread.css:421(030) `16px` → pol-thread.css:447(030) `16px` → pol-thread.css:595(020) `16px` → pol-thread.css:623(020) `28px` → pol-thread.css:654(020) `14px` → pol-thread.css:672(020) `14px` → pol-thread.css:923(020) `20px` → pol-thread.css:1079(020) `16px` → pol-thread.css:1183(031) `20px` → pol-thread.css:1257(030) `16px` → pol-thread.css:1447(020) `16px` → pol-thread.css:1449(020) `18px` → pol-thread.css:1616(020) `14px` → pol-thread.css:1722(020) `16px` → pol-thread.css:1722(020) `16px` → pol-thread.css:1722(020) `16px` → pol-thread.css:2145(030) `20px` → pol-thread.css:2200(020) `14px` → pol-roster.css:84(020) `16px` → pol-roster.css:101(020) `14px` → pol-roster.css:170(020) `14px` → pol-roster.css:300(030) `16px` → gap-convo.css:64(020) `28px` → gap-watch.css:102(020) `16px` → gap-watch.css:102(020) `16px` → gap-watch.css:430(020) `16px`<br>**transform** ↑ **flip**: pol-thread.css:672(020) `scaleY(-1)` → pol-thread.css:1618(040) `rotate(45deg)` → pol-roster.css:179(040) `rotate(-90deg)` → gap-watch.css:114(030) `rotate(180deg)`<br>**transition**: pol-roster.css:174(020) `transform var(--dur-fast` → gap-watch.css:113(020) `transform var(--dur-fast`<br>**width** ↑ **flip**: pol-thread.css:29(010) `18px` → pol-thread.css:421(030) `16px` → pol-thread.css:447(030) `16px` → pol-thread.css:595(020) `16px` → pol-thread.css:623(020) `28px` → pol-thread.css:654(020) `14px` → pol-thread.css:672(020) `14px` → pol-thread.css:923(020) `20px` → pol-thread.css:1079(020) `16px` → pol-thread.css:1183(031) `20px` → pol-thread.css:1257(030) `16px` → pol-thread.css:1447(020) `16px` → pol-thread.css:1449(020) `18px` → pol-thread.css:1616(020) `14px` → pol-thread.css:1722(020) `16px` → pol-thread.css:1722(020) `16px` → pol-thread.css:1722(020) `16px` → pol-thread.css:2145(030) `20px` → pol-thread.css:2200(020) `14px` → pol-roster.css:84(020) `16px` → pol-roster.css:101(020) `14px` → pol-roster.css:169(020) `14px` → pol-roster.css:300(030) `16px` → gap-convo.css:64(020) `28px` → gap-watch.css:102(020) `16px` → gap-watch.css:102(020) `16px` → gap-watch.css:430(020) `16px` |
| `.r-btn` | `(base)` |  | **background** **flip**: pol-stats.css:105(020) `var(--pg-raised)` → pol-public.css:423(010) `transparent`<br>**border** **flip**: pol-stats.css:102(020) `1px solid var(--pg-line)` → pol-public.css:420(010) `1px solid var(--onyx-lin`<br>**color** **flip**: pol-stats.css:104(020) `var(--pg-text)` → pol-public.css:422(010) `var(--onyx-text)`<br>**font-size**: pol-stats.css:106(020) `var(--text-md)` → pol-public.css:1088(020) `var(--text-sm)`<br>**line-height** **flip**: pol-stats.css:108(020) `var(--leading-tight)` → pol-public.css:426(010) `1.2`<br>**min-height**: pol-stats.css:100(020) `var(--target-min)` → pol-public.css:418(010) `var(--target-min)` → pol-public.css:1088(020) `36px` → pol-public.css:1412(020) `48px`<br>**padding** **flip**: pol-stats.css:101(020) `var(--space-2) var(--spa` → pol-public.css:419(010) `0 var(--space-5)` → pol-public.css:1088(020) `0 var(--space-3)` |
| `.r-section` | `(base)` |  | **padding-block** **flip**: pol-stats.css:49(020) `clamp(var(--space-7), 5v` → pol-public.css:356(010) `var(--space-7) 0` |
| `.room-notify` | `(base)` |  | **border-bottom** ↑: app.css:2305(010) `1px solid var(--onyx-lin` → roomsettings.css:22(020) `0`<br>**display** ↑: app.css:2305(010) `flex` → pol-shell.css:991(020) `grid` → rx-shell.css:215(020) `grid`<br>**gap** ↑: app.css:2305(010) `6px` → pol-shell.css:993(020) `2px` → rx-shell.css:217(020) `2px`<br>**padding** ↑: app.css:2305(010) `6px var(--space-3)` → pol-shell.css:994(020) `0` → roomsettings.css:22(020) `0` → rx-shell.css:218(020) `0` |
| `.room-notify-name` | `(base)` |  | **color** ↑: app.css:2306(010) `var(--onyx-dim)` → pol-shell.css:1004(020) `var(--onyx-text)` → rx-shell.css:225(020) `var(--onyx-dim)`<br>**font-size** ↑: app.css:2306(010) `var(--text-2xs)` → pol-shell.css:1003(020) `var(--text-sm)` → rx-shell.css:224(020) `var(--text-sm)` |
| `.room-notify-seg` | `(base)` |  | **background** ↑: app.css:2307(010) `transparent` → pol-shell.css:1012(020) `var(--onyx-bg)` → rx-shell.css:236(030) `var(--onyx-bg)`<br>**color** ↑: app.css:2307(010) `var(--onyx-text)` → pol-shell.css:1011(020) `var(--onyx-dim)` → rx-shell.css:235(030) `var(--onyx-dim)`<br>**font-size** ↑: app.css:2307(010) `var(--text-2xs)` → pol-shell.css:1010(020) `var(--text-sm)` → rx-shell.css:234(030) `var(--text-sm)`<br>**min-height** ↑: pol-shell.css:1008(020) `30px` → rx-shell.css:231(030) `32px`<br>**padding** ↑: app.css:2307(010) `2px 10px` → pol-shell.css:1009(020) `0 var(--space-2)` → rx-shell.css:232(030) `0 var(--space-2)` |
| `.room-notify-seg` | `[aria-checked=""]` |  | **border-color** ↑: app.css:2308(020) `var(--onyx-accent)` → pol-shell.css:1016(030) `var(--onyx-dim)` → rx-shell.css:241(030) `var(--onyx-dim)`<br>**color** ↑: app.css:2308(020) `var(--onyx-accent)` → pol-shell.css:1016(030) `var(--onyx-text)` → rx-shell.css:241(030) `var(--onyx-text)`<br>**font-weight** ↑: app.css:2308(020) `600` → pol-shell.css:1016(030) `650` → rx-shell.css:241(030) `650` |
| `.rset-btn` | `(base)` |  | **align-self** ↑: roomsettings.css:190(010) `flex-start` → gap-chanserv.css:74(030) `center` → gap-chanserv.css:204(020) `auto` → gap-chanserv.css:204(020) `auto`<br>**min-width**: gap-chanserv.css:204(020) `5.5rem` → gap-chanserv.css:204(020) `5.5rem` → gap-people.css:159(020) `0` |
| `.rset-input` | `(base)` |  | **width** ↑: roomsettings.css:174(010) `100%` → gap-chanserv.css:84(020) `auto` → gap-chanserv.css:202(020) `auto` → gap-chanserv.css:202(020) `auto` |
| `.rset-select` | `(base)` |  | **width** ↑: roomsettings.css:174(010) `100%` → gap-chanserv.css:85(020) `auto` |
| `.rset-toggle` | `(base)` |  | **align-items** ↑: roomsettings.css:234(010) `flex-start` → ui-sheets.css:1345(020) `center`<br>**min-height** ↑: roomsettings.css:237(010) `40px` → ui-sheets.css:1345(020) `48px` |
| `.rset-toggle-thumb` | `(base)` |  | **background** ↑: roomsettings.css:269(010) `var(--onyx-faint)` → roomsettings.css:274(020) `var(--onyx-text)` → ui-sheets.css:1336(020) `var(--onyx-dim)` → ui-sheets.css:1342(030) `var(--onyx-panel)`<br>**height** ↑: roomsettings.css:267(010) `12px` → ui-sheets.css:1335(020) `18px`<br>**transform** ↑: roomsettings.css:274(020) `translateX(14px)` → ui-sheets.css:1342(030) `translateX(16px)`<br>**width** ↑: roomsettings.css:266(010) `12px` → ui-sheets.css:1334(020) `18px` |
| `.rset-toggle-track` | `(base)` |  | **background** ↑: roomsettings.css:259(010) `var(--onyx-bg)` → roomsettings.css:273(020) `var(--onyx-panel-2)` → ui-sheets.css:1327(020) `var(--onyx-bg)` → ui-sheets.css:1340(030) `var(--onyx-text)`<br>**border-color** ↑: roomsettings.css:273(020) `var(--onyx-dim)` → ui-sheets.css:1340(030) `var(--onyx-text)`<br>**height** ↑: roomsettings.css:255(010) `18px` → ui-sheets.css:1323(020) `24px`<br>**width** ↑: roomsettings.css:254(010) `32px` → ui-sheets.css:1322(020) `40px` |
| `.shell-command-item` | `(base)` |  | **align-items** ↑: app.css:2599(020) `baseline` → pol-thread.css:1369(030) `center`<br>**border-radius** ↑: app.css:2604(020) `var(--radius)` → pol-thread.css:1369(030) `4px` |
| `.shell-command-usage` | `(base)` |  | **font-weight** ↑: app.css:2612(010) `650` → pol-thread.css:1372(020) `600` |
| `.shell-composer-popovers` | `(base)` |  | **bottom** ↑: app.css:2572(010) `calc(100% + 6px)` → pol-thread.css:1355(020) `calc(100% - var(--space-`<br>**left** ↑: app.css:2570(010) `16px` → pol-thread.css:1355(020) `var(--space-4)`<br>**right** ↑: app.css:2571(010) `16px` → pol-thread.css:1355(020) `var(--space-4)` |
| `.shell-composer-popovers` | `(base)` | @media (min-width: 768px) | **left** **flip**: gap-appearance.css:229(050) `var(--space-4)` → pol-thread.css:2069(030) `max(var(--space-4), calc`<br>**right** **flip**: gap-appearance.css:230(050) `var(--space-4)` → pol-thread.css:2070(030) `max(var(--space-4), calc` |
| `.shell-emoji-choice` | `(base)` |  | **border-radius** ↑: app.css:2643(020) `var(--radius)` → pol-thread.css:1387(030) `4px`<br>**padding** ↑: app.css:2646(020) `6px 0` → pol-thread.css:1387(030) `0` |
| `.shell-emoji-grid` | `(base)` |  | **grid-template-columns** ↑: app.css:2635(010) `repeat(auto-fill, minmax` → pol-thread.css:1386(020) `repeat(auto-fill, minmax`<br>**max-height** ↑: app.css:2637(010) `200px` → pol-thread.css:1386(020) `220px` |
| `.shell-emoji-picker` | `(base)` |  | **width** ↑: app.css:2624(010) `min(320px, 100%)` → pol-thread.css:1375(020) `min(340px, 100%)` |
| `.shell-msg-codeblock` | `(base)` |  | **margin** ↑: app.css:2251(010) `6px 0` → pol-thread.css:2143(030) `var(--space-1) 0` → pol-thread.css:2275(020) `2px 0` |
| `.shell-msg-codeblock-lang` | `(base)` |  | **font-size** ↑: app.css:2255(010) `0.6875rem` → pol-thread.css:2321(020) `var(--text-2xs)`<br>**position** ↑: app.css:2255(010) `absolute` → pol-thread.css:2312(020) `sticky`<br>**right** ↑: app.css:2255(010) `8px` → pol-thread.css:2314(020) `auto`<br>**top** ↑: app.css:2255(010) `4px` → pol-thread.css:2313(020) `auto` |
| `.shell-ribbon-badge` | `(base)` |  | **background** ↑: app.css:3771(010) `var(--onyx-panel-2)` → pol-shell.css:652(020) `var(--onyx-accent)`<br>**border** ↑: app.css:3772(010) `1px solid var(--onyx-lin` → pol-shell.css:653(020) `0`<br>**color** ↑: app.css:3770(010) `var(--onyx-text)` → pol-shell.css:651(020) `var(--onyx-accent-ink)`<br>**font-size** ↑: app.css:3766(010) `var(--text-xs)` → pol-shell.css:649(020) `0.625rem`<br>**line-height** ↑: app.css:3768(010) `18px` → pol-shell.css:650(020) `16px`<br>**min-width** ↑: app.css:3764(010) `18px` → pol-shell.css:646(020) `16px`<br>**padding** ↑: app.css:3765(010) `0 var(--space-1)` → pol-shell.css:648(020) `0 4px` |
| `.shell-ribbon-bell` | `(base)` |  | **color** ↑: app.css:3737(010) `var(--onyx-text)` → pol-shell.css:636(020) `var(--onyx-dim)`<br>**min-height** ↑: app.css:3733(010) `32px` → pol-shell.css:634(020) `36px`<br>**padding** ↑: app.css:3734(010) `0 var(--space-3)` → pol-shell.css:635(020) `0` |
| `.shell-ribbon-bell-icon` | `(base)` |  | **height** **flip**: pol-shell.css:641(020) `20px` → ui-sheets.css:596(010) `18px`<br>**width** **flip**: pol-shell.css:641(020) `20px` → ui-sheets.css:595(010) `18px` |
| `.shell-topic-action` | `(base)` |  | **background** ↑: app.css:179(010) `none` → pol-thread.css:2525(031) `transparent`<br>**border-radius** ↑: app.css:179(010) `999px` → pol-thread.css:2527(031) `var(--r-pill)`<br>**font-size** ↑: app.css:179(010) `0.75rem` → pol-thread.css:2530(031) `var(--text-sm)`<br>**padding** ↑: app.css:179(010) `2px 10px` → pol-thread.css:2524(031) `0 var(--space-3)` |
| `.shell-topic-actions` | `(base)` |  | **display**: app.css:181(010) `inline-flex` → pol-thread.css:2562(010) `flex`<br>**gap**: app.css:181(010) `6px` → pol-thread.css:2562(010) `var(--space-2)` |
| `.shell-topic-card` | `(base)` |  | **border-radius**: app.css:183(010) `8px` → pol-thread.css:2564(010) `var(--radius)` |
| `.shell-topic-card-follow` | `(base)` |  | **background** ↑: app.css:190(010) `none` → pol-thread.css:2525(031) `transparent`<br>**border-radius** ↑: app.css:190(010) `999px` → pol-thread.css:2527(031) `var(--r-pill)`<br>**font-size** ↑: app.css:190(010) `0.75rem` → pol-thread.css:2530(031) `var(--text-sm)`<br>**margin** ↑: app.css:190(010) `0 10px 8px` → pol-thread.css:2545(031) `0 var(--space-3) var(--s`<br>**padding** ↑: app.css:190(010) `2px 10px` → pol-thread.css:2524(031) `0 var(--space-3)` |
| `.shell-topic-card-main` | `(base)` |  | **gap** ↑: app.css:184(010) `4px` → pol-thread.css:2566(031) `var(--space-1)`<br>**padding** ↑: app.css:184(010) `8px 10px` → pol-thread.css:2566(031) `var(--space-3)` |
| `.shell-topic-card-meta` | `(base)` |  | **font-size**: app.css:186(010) `0.75rem` → pol-thread.css:2569(010) `var(--text-sm)` |
| `.shell-topic-card-preview` | `(base)` |  | **font-size**: app.css:187(010) `0.75rem` → pol-thread.css:2569(010) `var(--text-sm)` |
| `.shell-topic-create` | `(base)` |  | **display**: app.css:177(010) `inline-flex` → pol-thread.css:2551(010) `flex`<br>**gap**: app.css:177(010) `6px` → pol-thread.css:2551(010) `var(--space-2)` |
| `.shell-topic-create-input` | `(base)` |  | **border-radius**: app.css:178(010) `6px` → pol-thread.css:2557(010) `var(--radius)`<br>**font-size**: app.css:178(010) `0.75rem` → pol-thread.css:2559(010) `var(--text-sm)`<br>**padding**: app.css:178(010) `2px 8px` → pol-thread.css:2556(010) `0 var(--space-3)` |
| `.shell-topic-follow` | `(base)` |  | **background** ↑: app.css:192(010) `none` → pol-thread.css:2525(031) `transparent`<br>**border-radius** ↑: app.css:192(010) `999px` → pol-thread.css:2527(031) `var(--r-pill)`<br>**font-size** ↑: app.css:192(010) `0.75rem` → pol-thread.css:2530(031) `var(--text-sm)`<br>**padding** ↑: app.css:192(010) `2px 10px` → pol-thread.css:2524(031) `0 var(--space-3)` |
| `.shell-topic-forum` | `(base)` |  | **gap**: app.css:182(010) `8px` → pol-thread.css:2563(010) `var(--space-2)`<br>**padding**: app.css:182(010) `4px 0` → pol-thread.css:2563(010) `var(--space-1) 0 var(--s` |
| `.shortcuts-overlay` | `(base)` |  | **gap** ↑: app.css:3019(010) `14px` → ui-sheets.css:515(020) `var(--space-5)` |
| `.sub` | `(base)` |  | **color** **flip**: pol-stats.css:422(030) `var(--pg-dim)` → pol-public.css:394(020) `var(--onyx-dim)`<br>**margin** **flip**: pol-stats.css:421(030) `var(--space-2) 0 0` → pol-public.css:393(020) `var(--space-4) 0 0`<br>**max-width** **flip**: pol-stats.css:420(030) `55ch` → pol-public.css:392(020) `62ch` |
| `.topic-chip` | `(base)` |  | **border-radius** ↑: app.css:199(010) `999px` → pol-thread.css:2527(031) `var(--r-pill)`<br>**font-size** ↑: app.css:199(010) `0.75rem` → pol-thread.css:632(010) `var(--text-sm)` → pol-thread.css:2530(031) `var(--text-sm)`<br>**gap** ↑: app.css:199(010) `2px` → pol-thread.css:2536(031) `3px`<br>**padding** ↑: app.css:199(010) `2px 10px` → pol-thread.css:2524(031) `0 var(--space-3)` |
| `.topic-chip__unread` | `(base)` |  | **font-size**: app.css:202(010) `0.6875rem` → pol-thread.css:2546(010) `var(--text-2xs)`<br>**padding**: app.css:202(010) `0 6px` → pol-thread.css:2546(010) `0 5px` |
| `.topic-filter-bar` | `(base)` |  | **gap** ↑: app.css:198(010) `6px` → pol-thread.css:2518(020) `var(--space-2)`<br>**padding** ↑: app.css:198(010) `4px 0` → pol-thread.css:2518(020) `var(--space-1) 0` |
| `.you` | `.boost-pill` |  | **border-color** ↑: app.css:2671(020) `var(--onyx-accent)` → app.css:4027(020) `var(--onyx-dim)` → pol-thread.css:417(030) `color-mix(in oklab, var(` |

## G15. Specificity

Histogram (a,b,c → selectors): 0,0,0→16 · 0,0,1→12 · 0,1,0→3544 · 0,1,1→377 · 0,1,2→40 · 0,1,3→4 · 0,2,0→1923 · 0,2,1→251 · 0,2,2→27 · 0,3,0→751 · 0,3,1→130 · 0,3,2→7 · 0,4,0→140 · 0,4,1→46 · 0,4,2→1 · 0,5,0→27 · 0,5,1→11 · 0,6,0→4 · 0,6,1→3 · 0,6,2→1 · 1,0,0→2 · 1,2,0→6 · 1,3,0→3

Outliers (268: ids, ≥4 class-level parts, or ≥4 compounds deep):

| file:line | selector | specificity | compounds |
|---|---|---|---|
| gap-appearance.css:278 | `:root[data-shell-scheme='light'][data-scene='appearance'] #onyx-scene` | 1,3,0 | 2 |
| pol-shell.css:1455 | `.onyx-rail[data-collection="rooms"]:not(:has(> [data-testid="sidebar-favorites"])) #sidebar-channels-label` | 1,3,0 | 2 |
| gap-organize.css:62 | `.onyx-rail[data-collection="rooms"]:has(> .gorg-folder) #sidebar-channels-label` | 1,3,0 | 2 |
| gap-appearance.css:271 | `:root[data-scene='appearance'] #onyx-scene` | 1,2,0 | 2 |
| gap-appearance.css:273 | `:root[data-shell-scheme='light'] #onyx-scene` | 1,2,0 | 2 |
| gap-appearance.css:280 | `:root[data-high-contrast='true'] #onyx-scene` | 1,2,0 | 2 |
| gap-appearance.css:290 | `:root[data-reduce-transparency='true'] #onyx-scene` | 1,2,0 | 2 |
| pol-shell.css:1455 | `.onyx-rail[data-collection="messages"] #sidebar-dms-label` | 1,2,0 | 2 |
| ui-sheets.css:1429 | `.onyx-sheet :is( .onyx-account-drop-go, [data-testid="steward-close-confirm"], [data-testid="ban-add-submit"],` | 1,2,0 | 2 |
| gap-appearance.css:259 | `#onyx-scene` | 1,0,0 | 1 |
| gap-appearance.css:282 | `#onyx-scene` | 1,0,0 | 1 |
| ui-sheets.css:1525 | `:root[data-kb="open"] .onyx-sheet-layer > .onyx-sheet:has(:is(input, textarea, select):focus) > :is(.onyx-shee` | 0,6,2 | 4 |
| ui-sheets.css:1519 | `:root[data-kb="open"] .onyx-sheet-layer > .onyx-sheet:has(:is(input, textarea, select):focus) :is(.onyx-sheet-` | 0,6,1 | 4 |
| ui-sheets.css:1520 | `:root[data-kb="open"] .onyx-sheet-layer > .onyx-sheet:has(:is(input, textarea, select):focus) > :is(.onyx-shee` | 0,6,1 | 4 |
| ui-sheets.css:1526 | `:root[data-kb="open"] .onyx-sheet-layer > .onyx-sheet:has(:is(input, textarea, select):focus) .onyx-sheet-titl` | 0,6,1 | 4 |
| pol-thread.css:1177 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool:hover:not(:disabled)` | 0,6,0 | 4 |
| pol-public.css:1710 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-open, .not-found-page__action, .onyxos-bu` | 0,6,0 | 2 |
| pol-public.css:1714 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-open, .not-found-page__action, .onyxos-bu` | 0,6,0 | 2 |
| rx-shell.css:271 | `.onyx-overlays .onyx-sheet-layer.onyx-railmenu-layer[data-placement] > .onyx-sheet.onyx-railmenu` | 0,6,0 | 3 |
| app.css:3447 | `.onyx-call-stage[data-motion="still"] .onyx-call-person[data-speaking="true"] .onyx-call-ring::after` | 0,5,1 | 3 |
| pol-thread.css:1206 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool--more[aria-expanded='true` | 0,5,1 | 4 |
| pol-thread.css:2537 | `.onyx-frame .onyx-thread-pane button.shell-topic-action:hover:not(:disabled)` | 0,5,1 | 3 |
| gap-shell.css:75 | `.onyx-frame .onyx-rail button.gs-join-go:hover:not(:disabled)` | 0,5,1 | 3 |
| gap-shell.css:76 | `.onyx-frame .onyx-rail button.gs-join-go:disabled:hover` | 0,5,1 | 3 |
| gap-shell.css:259 | `.onyx-frame .gs-leave button.gs-btn.gs-btn--danger:hover` | 0,5,1 | 3 |
| gap-shell.css:353 | `.onyx-frame .onyx-room-header .onyx-room-more .onyx-room-more-menu > a.gs-more-ledger` | 0,5,1 | 5 |
| ui-sheets.css:835 | `.onyx-sheet :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), sele` | 0,5,1 | 2 |
| ui-sheets.css:837 | `.onyx-sheet :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), sele` | 0,5,1 | 2 |
| ui-sheets.css:1527 | `:root[data-kb="open"] .onyx-newmsg-sheet:has(input:focus) :is(.onyx-newmsg-help, .onyx-newmsg-hint, .onyx-newm` | 0,5,1 | 3 |
| ui-sheets.css:1528 | `:root[data-kb="open"] .guest-claim-sheet:has(input:focus) .guest-claim-sheet__hint` | 0,5,1 | 3 |
| gap-appearance.css:166 | `:root[data-density='compact'] .onyx-message:not(.onyx-message--compact):not(.onyx-continuation)` | 0,5,0 | 2 |
| gap-appearance.css:174 | `:root[data-density='roomy'] .onyx-message:not(.onyx-message--compact):not(.onyx-continuation)` | 0,5,0 | 2 |
| gap-appearance.css:187 | `:root[data-density='compact'] .onyx-message:not(.onyx-message--compact):not(.onyx-continuation)` | 0,5,0 | 2 |
| gap-appearance.css:191 | `:root[data-density='roomy'] .onyx-message:not(.onyx-message--compact):not(.onyx-continuation)` | 0,5,0 | 2 |
| gap-appearance.css:223 | `:root[data-width='full'] .onyx-frame > .onyx-main > .onyx-thread-pane` | 0,5,0 | 4 |
| gap-appearance.css:228 | `:root[data-width='full'] .onyx-main > .onyx-composer > .shell-composer-popovers` | 0,5,0 | 4 |
| pol-thread.css:260 | `.onyx-message:hover:not(:focus-within):not(.onyx-message--active) > .onyx-row-actions` | 0,5,0 | 2 |
| pol-thread.css:262 | `.onyx-continuation:hover:not(:focus-within):not(.onyx-message--active) > .onyx-ts` | 0,5,0 | 2 |
| pol-thread.css:1179 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool:disabled` | 0,5,0 | 4 |
| pol-thread.css:1181 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool[aria-expanded='true']` | 0,5,0 | 4 |
| pol-thread.css:1184 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool > .shell-composer-action-` | 0,5,0 | 5 |
| pol-thread.css:1222 | `.onyx-composer .onyx-composer-bar > .onyx-composer-send--ready:hover:not(:disabled)` | 0,5,0 | 3 |
| pol-thread.css:2059 | `.onyx-main > .onyx-thread-pane > .onyx-thread-frame > :not(.onyx-jump-latest):not(.onyx-room-intro)` | 0,5,0 | 4 |
| pol-thread.css:2367 | `:root[data-kb="open"] .onyx-frame .onyx-main > .onyx-composer` | 0,5,0 | 4 |
| pol-thread.css:2471 | `.onyx-frame .onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool` | 0,5,0 | 5 |
| pol-public.css:1705 | `.public-frame:has(.public-frame__main :is(.r-btn.primary, .onyx-land-open, .not-found-page__action, .onyxos-bu` | 0,5,0 | 2 |
| gap-oper.css:217 | `.onyx-moddesk-sheet .oper-desk .oc-btn:hover:not(:disabled)` | 0,5,0 | 3 |
| gap-oper.css:221 | `.onyx-moddesk-sheet .oper-desk .oc-btn-primary:hover:not(:disabled)` | 0,5,0 | 3 |
| gap-oper.css:223 | `.onyx-moddesk-sheet .oper-desk .oc-btn-danger:hover:not(:disabled)` | 0,5,0 | 3 |
| gap-oper.css:285 | `.onyx-moddesk-sheet .oper-desk .oc-chip:hover:not(:disabled)` | 0,5,0 | 3 |
| gap-oper.css:407 | `.onyx-sheet-layer > .onyx-moddesk-sheet[data-testid="oper-sheet"] .onyx-moddesk-bar > .onyx-sheet-close` | 0,5,0 | 4 |
| gap-oper.css:409 | `.onyx-sheet-layer > .onyx-moddesk-sheet[data-testid="oper-sheet"] .onyx-moddesk-bar > .onyx-sheet-close` | 0,5,0 | 4 |
| gap-organize.css:658 | `.onyx-frame[data-reader="true"] .onyx-main > .onyx-thread-pane > .onyx-thread-frame > *` | 0,5,0 | 5 |
| gap-organize.css:669 | `.onyx-frame[data-reader="true"] .onyx-message:not(.onyx-message--compact):not(.onyx-continuation)` | 0,5,0 | 2 |
| ui-sheets.css:1580 | `.onyx-sheet.onyx-moderation-review:is([data-kind="kick"], [data-kind="ban"]) .onyx-member-confirm:not(:disable` | 0,5,0 | 2 |
| calls-engine.css:440 | `.onyx-call-stage[data-size="expanded"] .onyx-call-grid[data-columns="1"] > .onyx-tile` | 0,5,0 | 3 |
| calls-engine.css:440 | `.onyx-call-stage[data-size="fullscreen"] .onyx-call-grid[data-columns="1"] > .onyx-tile` | 0,5,0 | 3 |
| gap-shell.css:375 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > a.gs-more-ledger::before` | 0,4,2 | 4 |
| pol-stats.css:602 | `.stats-page .stats-feed-step[data-step-state='current'] .stats-feed-step__heading > strong` | 0,4,1 | 4 |
| pol-stats.css:603 | `.stats-page .stats-feed-step[data-step-state='attention'] .stats-feed-step__heading > strong` | 0,4,1 | 4 |
| pol-stats.css:604 | `.stats-page .stats-feed-step[data-step-state='unavailable'] .stats-feed-step__heading > strong` | 0,4,1 | 4 |
| pol-stats.css:685 | `.stats-page :is(.stats-window-options, .stats-control-group) button:hover:not(:disabled)` | 0,4,1 | 3 |
| pol-stats.css:955 | `.stats-page .data-list > div > .data-room-row:first-child` | 0,4,1 | 4 |
| pol-stats.css:1052 | `.stats-page :is(.stats-refresh, .data-action, .public-room-comparison__share, .public-room-comparison__clear, ` | 0,4,1 | 2 |
| pol-studio.css:556 | `.background-picker__card[data-kind='scene'] .background-picker__swatch i:nth-child(2)` | 0,4,1 | 3 |
| pol-thread.css:1177 | `.onyx-composer .onyx-composer-bar > button:hover:not(:disabled)` | 0,4,1 | 3 |
| pol-thread.css:1197 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool--more::before` | 0,4,1 | 4 |
| pol-thread.css:2537 | `.onyx-frame .onyx-thread-pane button.topic-chip:hover` | 0,4,1 | 3 |
| pol-thread.css:2537 | `.onyx-frame .onyx-thread-pane button.shell-topic-follow:hover` | 0,4,1 | 3 |
| pol-thread.css:2537 | `.onyx-frame .onyx-thread-pane button.shell-topic-card-follow:hover` | 0,4,1 | 3 |
| pol-thread.css:2541 | `.onyx-frame .onyx-thread-pane button.topic-chip.is-active` | 0,4,1 | 3 |
| pol-thread.css:2541 | `.onyx-frame .onyx-thread-pane button.shell-topic-action.is-active` | 0,4,1 | 3 |
| pol-thread.css:2541 | `.onyx-frame .onyx-thread-pane button.shell-topic-follow.is-active` | 0,4,1 | 3 |
| pol-thread.css:2541 | `.onyx-frame .onyx-thread-pane button.shell-topic-card-follow.is-active` | 0,4,1 | 3 |
| calls-c4.css:42 | `.onyx-cq[data-tier="2"] .onyx-cq-bars > span[data-on="true"]` | 0,4,1 | 3 |
| calls-c4.css:44 | `.onyx-cq[data-tier="3"] .onyx-cq-bars > span[data-on="true"]` | 0,4,1 | 3 |
| gap-organize.css:70 | `.onyx-rail [data-testid="sidebar-channels"]:has(> ul:empty) > .onyx-rail-label` | 0,4,1 | 3 |
| gap-usermodes.css:69 | `button.um-btn.um-btn--primary:hover:not(:disabled)` | 0,4,1 | 1 |
| gap-usermodes.css:72 | `button.um-btn.um-btn--quiet:hover:not(:disabled)` | 0,4,1 | 1 |
| gap-shell.css:76 | `.onyx-frame .onyx-rail button.gs-join-go:disabled` | 0,4,1 | 3 |
| gap-shell.css:78 | `.onyx-frame .onyx-rail button.gs-join-go:focus-visible` | 0,4,1 | 3 |
| gap-shell.css:99 | `.onyx-frame .onyx-rail button.gs-rail-activity:hover` | 0,4,1 | 3 |
| gap-shell.css:100 | `.onyx-frame .onyx-rail button.gs-rail-activity:focus-visible` | 0,4,1 | 3 |
| gap-shell.css:140 | `.onyx-frame .gs-seg button.gs-seg-btn:hover` | 0,4,1 | 3 |
| gap-shell.css:141 | `.onyx-frame .gs-seg button.gs-seg-btn[aria-pressed="true"]` | 0,4,1 | 3 |
| gap-shell.css:142 | `.onyx-frame .gs-seg button.gs-seg-btn:focus-visible` | 0,4,1 | 3 |
| gap-shell.css:255 | `.onyx-frame .gs-leave button.gs-btn:hover` | 0,4,1 | 3 |
| gap-shell.css:256 | `.onyx-frame .gs-leave button.gs-btn.gs-btn--ghost` | 0,4,1 | 3 |
| gap-shell.css:257 | `.onyx-frame .gs-leave button.gs-btn:focus-visible` | 0,4,1 | 3 |
| gap-shell.css:258 | `.onyx-frame .gs-leave button.gs-btn.gs-btn--danger` | 0,4,1 | 3 |
| gap-shell.css:296 | `.onyx-frame .gs-motd button.gs-motd-dismiss .onyx-sheet-x` | 0,4,1 | 4 |
| gap-shell.css:297 | `.onyx-frame .gs-motd button.gs-motd-dismiss:hover` | 0,4,1 | 3 |
| gap-shell.css:298 | `.onyx-frame .gs-motd button.gs-motd-dismiss:focus-visible` | 0,4,1 | 3 |
| gap-shell.css:318 | `.onyx-frame .gs-motd button.gs-motd-more:hover` | 0,4,1 | 3 |
| gap-shell.css:319 | `.onyx-frame .gs-motd button.gs-motd-more:focus-visible` | 0,4,1 | 3 |
| gap-shell.css:353 | `.onyx-frame .onyx-room-header .onyx-room-more .onyx-room-more-menu > button` | 0,4,1 | 5 |
| gap-shell.css:370 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > a.gs-more-ledger` | 0,4,1 | 4 |
| ui-sheets.css:360 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)::before` | 0,4,1 | 3 |
| ui-sheets.css:1056 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button:active` | 0,4,1 | 4 |
| ui-sheets.css:1189 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)::before` | 0,4,1 | 3 |
| ui-sheets.css:1341 | `.onyx-sheet .pref-toggle[aria-checked="true"] .pref-switch::after` | 0,4,1 | 3 |
| ui-sheets.css:1484 | `html:has(.onyx-overlays [data-shortcut-scope]) .onyx-roster:popover-open` | 0,4,1 | 2 |
| ui-sheets.css:1572 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > .onyx-room-more-cancel::before` | 0,4,1 | 4 |
| calls-engine.css:147 | `.onyx-call-meta .onyx-sec-chip > span[aria-hidden="true"]:not(.onyx-ci)` | 0,4,1 | 3 |
| app.css:3693 | `.onyx-primary-nav .onyx-nav-btn:hover .onyx-nav-label` | 0,4,0 | 3 |
| app.css:3693 | `.onyx-primary-nav .onyx-nav-btn:focus-visible .onyx-nav-label` | 0,4,0 | 3 |
| gap-appearance.css:165 | `:root[data-density='compact'] .onyx-message:not(.onyx-message--compact)` | 0,4,0 | 2 |
| gap-appearance.css:173 | `:root[data-density='roomy'] .onyx-message:not(.onyx-message--compact)` | 0,4,0 | 2 |
| gap-appearance.css:186 | `:root[data-density='compact'] .onyx-row-avatar .onyx-avatar` | 0,4,0 | 3 |
| gap-appearance.css:190 | `:root[data-density='roomy'] .onyx-row-avatar .onyx-avatar` | 0,4,0 | 3 |
| gap-appearance.css:194 | `:root[data-density='compact'] .onyx-rail .onyx-rail-item` | 0,4,0 | 3 |
| gap-appearance.css:195 | `:root[data-density='compact'] .onyx-frame .onyx-mlist-main` | 0,4,0 | 3 |
| gap-appearance.css:195 | `:root[data-density='compact'] .onyx-roster .onyx-member` | 0,4,0 | 3 |
| gap-appearance.css:200 | `:root[data-density='roomy'] .onyx-rail .onyx-rail-item` | 0,4,0 | 3 |
| gap-appearance.css:201 | `:root[data-density='roomy'] .onyx-frame .onyx-mlist-main` | 0,4,0 | 3 |
| gap-appearance.css:201 | `:root[data-density='roomy'] .onyx-roster .onyx-member` | 0,4,0 | 3 |
| gap-appearance.css:227 | `:root[data-width='full'] .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| gap-appearance.css:244 | `:root[data-shell-scheme='light'] .onyx-mention:hover` | 0,4,0 | 2 |
| gap-appearance.css:244 | `:root[data-shell-scheme='light'] .onyx-mention:focus-within` | 0,4,0 | 2 |
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
| pol-shell.css:570 | `.onyx-frame[data-convo="false"] > .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| pol-shell.css:953 | `.onyx-frame .onyx-room-header .onyx-room-more-toggle[aria-expanded="true"]` | 0,4,0 | 3 |
| pol-shell.css:953 | `.onyx-frame .onyx-room-header .onyx-room-more-toggle[aria-expanded="true"]` | 0,4,0 | 3 |
| pol-shell.css:964 | `.onyx-frame .onyx-room-header .onyx-members-toggle:hover` | 0,4,0 | 3 |
| pol-shell.css:1080 | `.onyx-home .onyx-home-empty.is-first-room ~ .onyx-coach` | 0,4,0 | 3 |
| pol-shell.css:1205 | `.onyx-frame:not([data-convo="false"]):not([data-nav-drawer="true"]) > .onyx-topbar` | 0,4,0 | 2 |
| pol-shell.css:1205 | `.onyx-frame:not([data-convo="false"]):not([data-nav-drawer="true"]) > .onyx-mobile-nav` | 0,4,0 | 2 |
| pol-shell.css:1208 | `.onyx-frame:not([data-convo="false"]):not([data-nav-drawer="true"]) > .onyx-main` | 0,4,0 | 2 |
| pol-shell.css:1265 | `.onyx-frame .onyx-room-header .onyx-members-toggle .pt-ico` | 0,4,0 | 4 |
| pol-shell.css:1275 | `.onyx-frame .onyx-room-header .onyx-call-join .onyx-ci` | 0,4,0 | 4 |
| pol-shell.css:1339 | `.onyx-rail .onyx-rail-filter .onyx-rail-new .onyx-shi` | 0,4,0 | 4 |
| pol-shell.css:1470 | `:root[data-kb="open"] .onyx-frame > .onyx-main` | 0,4,0 | 3 |
| pol-thread.css:220 | `.onyx-thread > .onyx-message:first-child > .onyx-row-actions` | 0,4,0 | 3 |
| pol-thread.css:259 | `.onyx-message:hover:not(:focus-within):not(.onyx-message--active)` | 0,4,0 | 1 |
| pol-thread.css:419 | `.onyx-message .boost-pill.you .boost-count` | 0,4,0 | 3 |
| pol-thread.css:1160 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool` | 0,4,0 | 4 |
| pol-thread.css:1396 | `.onyx-composer .onyx-composer-bar > .shell-composer-more-wrap > .shell-composer-tool` | 0,4,0 | 4 |
| pol-thread.css:1618 | `.onyx-message-search__save[open] > .onyx-message-search__save-toggle .pt-ico` | 0,4,0 | 3 |
| pol-thread.css:2122 | `.onyx-sheet-layer.onyx-thread-pop > .onyx-sheet.onyx-thread-sheet` | 0,4,0 | 2 |
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
| pol-roster.css:440 | `.onyx-roster .onyx-roster-filter:not(.onyx-roster-filter--open):not(:focus-within)` | 0,4,0 | 2 |
| pol-public.css:1649 | `.public-frame :is(.r-btn.primary, .not-found-page__action, .onyxos-button--primary, .guides-hero-actions .guid` | 0,4,0 | 2 |
| calls-c6.css:226 | `.onyx-sheet-layer.onyx-call-ring-layer > .onyx-sheet.onyx-call-ring` | 0,4,0 | 2 |
| calls-c6.css:266 | `.onyx-call-stage[data-reconnecting="true"] .onyx-cbtn:disabled` | 0,4,0 | 2 |
| calls-c4.css:157 | `.onyx-call-grid > .onyx-tile:nth-child(n+5) .onyx-tile-video` | 0,4,0 | 3 |
| gap-convo.css:132 | `.onyx-composer .gap-attach-quality-opt:hover:not(:disabled)` | 0,4,0 | 2 |
| gap-convo.css:163 | `.onyx-composer .gap-attach-keep:hover:not(:disabled)` | 0,4,0 | 2 |
| gap-convo.css:259 | `:root[data-reduce-motion='true'] .onyx-message.gap-landed` | 0,4,0 | 2 |
| gap-oper.css:14 | `.onyx-sheet-layer[data-placement="side"] > .onyx-moddesk-sheet[data-testid="oper-sheet"]` | 0,4,0 | 2 |
| gap-oper.css:18 | `.onyx-sheet-layer[data-placement="side"] > .onyx-moddesk-sheet[data-testid="oper-sheet"]` | 0,4,0 | 2 |
| gap-oper.css:89 | `.onyx-moddesk-sheet .oper-desk .oc-tab:hover` | 0,4,0 | 3 |
| gap-oper.css:90 | `.onyx-moddesk-sheet .oper-desk .oc-tab[aria-selected="true"]` | 0,4,0 | 3 |
| gap-oper.css:95 | `.onyx-moddesk-sheet .oper-desk .oc-tab:focus-visible` | 0,4,0 | 3 |
| gap-oper.css:200 | `.onyx-moddesk-sheet .oper-desk .oc-input:focus-visible` | 0,4,0 | 3 |
| gap-oper.css:218 | `.onyx-moddesk-sheet .oper-desk .oc-btn:disabled` | 0,4,0 | 3 |
| gap-oper.css:219 | `.onyx-moddesk-sheet .oper-desk .oc-btn:focus-visible` | 0,4,0 | 3 |
| gap-oper.css:286 | `.onyx-moddesk-sheet .oper-desk .oc-chip[aria-pressed="true"]` | 0,4,0 | 3 |
| gap-oper.css:291 | `.onyx-moddesk-sheet .oper-desk .oc-chip:disabled` | 0,4,0 | 3 |
| gap-oper.css:292 | `.onyx-moddesk-sheet .oper-desk .oc-chip:focus-visible` | 0,4,0 | 3 |
| rx-shell.css:100 | `.onyx-rail .onyx-rail-row:is(:hover, :focus-within, .onyx-rail-row--menu) > :is(.onyx-rail-star, .onyx-rail-mo` | 0,4,0 | 3 |
| rx-shell.css:100 | `.onyx-rail .onyx-rail-entry:is(:hover, :focus-within, .onyx-rail-row--menu) > .onyx-rail-more` | 0,4,0 | 3 |
| rx-shell.css:103 | `.onyx-rail .onyx-rail-row:is(:hover, :focus-within, .onyx-rail-row--menu) .onyx-rail-meta` | 0,4,0 | 3 |
| rx-shell.css:103 | `.onyx-rail .onyx-rail-entry:is(:hover, :focus-within, .onyx-rail-row--menu) .onyx-rail-meta` | 0,4,0 | 3 |
| rx-shell.css:105 | `.onyx-rail .onyx-rail-entry:is(:hover, :focus-within, .onyx-rail-row--menu) .onyx-rail-time` | 0,4,0 | 3 |
| rx-shell.css:106 | `.onyx-rail .onyx-rail-row:is(:hover, :focus-within) > .onyx-rail-item` | 0,4,0 | 3 |
| rx-shell.css:106 | `.onyx-rail .onyx-rail-entry:is(:hover, :focus-within) > .onyx-rail-item` | 0,4,0 | 3 |
| rx-shell.css:194 | `.onyx-railmenu .onyx-railmenu-item:hover:not(:disabled)` | 0,4,0 | 2 |
| rx-shell.css:196 | `.onyx-railmenu .onyx-railmenu-item:disabled .onyx-shi` | 0,4,0 | 3 |
| rx-shell.css:204 | `.onyx-frame .onyx-railmenu .onyx-railmenu-item:has(.gorg-menu-hint)` | 0,4,0 | 3 |
| rx-shell.css:246 | `.onyx-railmenu-layer[data-anchored="true"] > .onyx-sheet.onyx-railmenu` | 0,4,0 | 2 |
| rx-shell.css:270 | `.onyx-overlays .onyx-sheet-layer.onyx-railmenu-layer[data-placement]` | 0,4,0 | 2 |
| rx-shell.css:316 | `.onyx-rail[data-collection="rooms"]:has(.onyx-rail-zero) .onyx-rail-foot` | 0,4,0 | 2 |
| rx-shell.css:382 | `.onyx-frame > .onyx-roster[popover]:not(:popover-open)` | 0,4,0 | 2 |
| rx-shell.css:425 | `.onyx-rail .onyx-rail-filter .onyx-rail-new .onyx-shi` | 0,4,0 | 4 |
| rx-shell.css:436 | `.onyx-frame .onyx-rail .onyx-rail-filter .onyx-rail-new` | 0,4,0 | 4 |
| rx-shell.css:530 | `:root[data-kb="open"] .onyx-frame .onyx-room-header` | 0,4,0 | 3 |
| rx-shell.css:531 | `:root[data-kb="open"] .onyx-frame .onyx-room-header-topic-row` | 0,4,0 | 3 |
| rx-shell.css:688 | `.onyx-railmenu-layer[data-anchored="true"] > .onyx-sheet.onyx-railmenu` | 0,4,0 | 2 |
| gap-import.css:59 | `.hi-btn--quiet.hi-btn--danger:hover:not(:disabled)` | 0,4,0 | 1 |
| gap-organize.css:646 | `:root .onyx-frame[data-reader="true"] > :is(.onyx-primary-nav, .onyx-topbar, .onyx-rail, .onyx-roster, .onyx-m` | 0,4,0 | 3 |
| gap-organize.css:647 | `:root .onyx-frame[data-reader="true"] > .onyx-main` | 0,4,0 | 3 |
| gap-organize.css:654 | `.onyx-frame[data-reader="true"] .onyx-room-header-actions > :not(.onyx-room-more)` | 0,4,0 | 3 |
| gap-organize.css:655 | `.onyx-frame[data-reader="true"] .onyx-main > .onyx-thread-pane` | 0,4,0 | 3 |
| gap-organize.css:658 | `.onyx-frame[data-reader="true"] .onyx-main > .onyx-thread-pane > *` | 0,4,0 | 4 |
| gap-organize.css:663 | `.onyx-frame[data-reader="true"] .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| gap-organize.css:667 | `.onyx-frame[data-reader="true"] .onyx-message:not(.onyx-message--compact)` | 0,4,0 | 2 |
| gap-organize.css:670 | `.onyx-frame[data-reader="true"] .onyx-message > .onyx-body` | 0,4,0 | 3 |
| gap-organize.css:675 | `.onyx-frame[data-reader="true"] .onyx-message > .onyx-ts` | 0,4,0 | 3 |
| gap-organize.css:676 | `.onyx-frame[data-reader="true"] .onyx-continuation > .onyx-ts` | 0,4,0 | 3 |
| gap-organize.css:754 | `.onyx-frame[data-reader="true"] .onyx-main > .onyx-thread-pane` | 0,4,0 | 3 |
| gap-organize.css:755 | `.onyx-frame[data-reader="true"] .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| gap-commands.css:38 | `.onyx-sheet-layer.gap-help > .onyx-sheet.gap-help-sheet` | 0,4,0 | 2 |
| gap-claim.css:167 | `.gc-actions > .gc-btn:last-child:nth-child(even)` | 0,4,0 | 2 |
| ui-sheets.css:348 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet:has(> :is(.onyx-sheet-head, .jump-to-date-head))` | 0,4,0 | 2 |
| ui-sheets.css:374 | `.onyx-sheet-layer[data-swipe="true"] > .onyx-sheet > :is(.onyx-sheet-head, .jump-to-date-head)` | 0,4,0 | 3 |
| ui-sheets.css:570 | `.notif-center .notif-center__row:hover .notif-center__dismiss` | 0,4,0 | 3 |
| ui-sheets.css:570 | `.notif-center .notif-center__row:focus-within .notif-center__dismiss` | 0,4,0 | 3 |
| ui-sheets.css:749 | `.chb .chb-row + .chb-row .chb-card` | 0,4,0 | 4 |
| ui-sheets.css:1339 | `.onyx-sheet .pref-toggle[aria-checked="true"] .pref-switch` | 0,4,0 | 3 |
| ui-sheets.css:1401 | `.onyx-sheet .a2-add .a2-row--fill > .a2-input` | 0,4,0 | 4 |
| ui-sheets.css:1402 | `.onyx-sheet .a2-add .a2-row--fill > .a2-btn` | 0,4,0 | 4 |
| ui-sheets.css:1418 | `.onyx-sheet .onyx-danger-zone > :is(h3, .onyx-steward-label:first-child)` | 0,4,0 | 3 |
| ui-sheets.css:1456 | `.onyx-sheet :is(.onyx-account-drop-arm, .onyx-steward-btn-danger, .onyx-moddesk-danger, .pref-reset--danger):n` | 0,4,0 | 2 |
| ui-sheets.css:1557 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > .onyx-room-more-cancel` | 0,4,0 | 4 |
| ui-sheets.css:1603 | `:root[data-kb="open"] .onyx-frame :is(.onyx-sheet-layer, .onyx-spotlight, .onyx-profile-pop, .onyx-room-more-m` | 0,4,0 | 3 |
| ui-sheets.css:1604 | `:root[data-kb="open"] .onyx-frame .onyx-toaster` | 0,4,0 | 3 |
| pol-ios.css:110 | `:root[data-kb="open"] .onyx-frame > .onyx-mobile-nav` | 0,4,0 | 3 |
| pol-ios.css:112 | `:root[data-kb="open"] .onyx-main > .onyx-composer` | 0,4,0 | 3 |
| calls-engine.css:386 | `.onyx-call-grid:has(> .onyx-tile:nth-child(5)) > .onyx-tile` | 0,4,0 | 2 |
| calls-engine.css:428 | `.onyx-call-stage[data-size="expanded"] .onyx-call-people > .onyx-call-person` | 0,4,0 | 3 |
| calls-engine.css:428 | `.onyx-call-stage[data-size="fullscreen"] .onyx-call-people > .onyx-call-person` | 0,4,0 | 3 |
| calls-engine.css:438 | `.onyx-call-stage[data-size="expanded"] .onyx-call-grid > .onyx-tile` | 0,4,0 | 3 |
| calls-engine.css:438 | `.onyx-call-stage[data-size="fullscreen"] .onyx-call-grid > .onyx-tile` | 0,4,0 | 3 |
| calls-engine.css:452 | `.onyx-call-stage[data-size="expanded"] .onyx-call-people > .onyx-call-person` | 0,4,0 | 3 |
| calls-engine.css:452 | `.onyx-call-stage[data-size="fullscreen"] .onyx-call-people > .onyx-call-person` | 0,4,0 | 3 |
| calls-engine.css:460 | `.onyx-call-stage[data-size="expanded"] .onyx-call-grid > .onyx-tile` | 0,4,0 | 3 |
| calls-engine.css:460 | `.onyx-call-stage[data-size="fullscreen"] .onyx-call-grid > .onyx-tile` | 0,4,0 | 3 |
| app.css:3122 | `.onyx-moddesk-sheet .moderation-desk__rail > div span:first-child` | 0,3,2 | 4 |
| pol-stats.css:825 | `.stats-page .stats-heatmap thead th:first-child` | 0,3,2 | 4 |
| pol-stats.css:904 | `.stats-page .public-room-comparison__table tr:last-child :is(th, td)` | 0,3,2 | 4 |
| pol-stats.css:906 | `.stats-page .public-room-comparison__table thead th:first-child` | 0,3,2 | 4 |
| pol-stats.css:559 | `.stats-page .stats-primary-metric .note i` | 0,3,1 | 4 |
| pol-stats.css:659 | `.stats-page .data-card .stats-window-copy p` | 0,3,1 | 4 |
| pol-thread.css:1183 | `.onyx-composer .onyx-composer-bar > button .pt-ico` | 0,3,1 | 4 |
| pol-thread.css:1184 | `.onyx-composer .onyx-composer-bar > button > .shell-composer-action-label` | 0,3,1 | 4 |
| pol-thread.css:2451 | `.onyx-frame .shell-msg-lightbox .shell-msg-lightbox-actions > button` | 0,3,1 | 4 |
| pol-thread.css:2471 | `.onyx-frame .onyx-composer .onyx-composer-bar > button` | 0,3,1 | 4 |
| calls-c8.css:119 | `.onyx-call-sheet-layer .onyx-voice-settings .onyx-call-sheet-head h2` | 0,3,1 | 4 |
| gap-oper.css:403 | `.onyx-moddesk-sheet .oper-desk .onyx-moddesk-form :is(input, select)` | 0,3,1 | 4 |
| gap-oper.css:403 | `.onyx-moddesk-sheet .oper-desk .onyx-moddesk-row :is(input, select)` | 0,3,1 | 4 |
| ui-sheets.css:232 | `.onyx-sheet-layer .onyx-sheet .onyx-sheet-head-actions > button` | 0,3,1 | 4 |
| ui-sheets.css:844 | `.onyx-sheet-layer .onyx-sheet .onyx-sheet-head-actions > button` | 0,3,1 | 4 |
| ui-sheets.css:871 | `.onyx-sheet-layer .onyx-sheet .onyx-sheet-head-actions > button` | 0,3,1 | 4 |
| ui-sheets.css:973 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button` | 0,3,1 | 4 |
| ui-sheets.css:979 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button` | 0,3,1 | 4 |
| ui-sheets.css:1013 | `.onyx-frame .onyx-room-more .onyx-room-more-menu > button` | 0,3,1 | 4 |
| pol-stats.css:825 | `.stats-page .stats-heatmap tbody th` | 0,2,2 | 4 |
| pol-stats.css:883 | `.stats-page .public-room-comparison__prompt p strong` | 0,2,2 | 4 |
| pol-stats.css:905 | `.stats-page .public-room-comparison__table thead th` | 0,2,2 | 4 |
| pol-stats.css:907 | `.stats-page .public-room-comparison__table tbody th` | 0,2,2 | 4 |
| pol-stats.css:909 | `.stats-page .public-room-comparison__table td strong` | 0,2,2 | 4 |

## G16. Dead rules (selectors matching nothing the Elm views render)

Method: a class is live when it appears as a whitespace-separated token in any Elm string literal under src/ (comments excluded), in a ports.js / media/*.ts string, or extends a literal dynamic prefix (a literal ending in "-"/"_" followed by `++`). Everything else is dead. Data-attribute selectors are dead when the attribute is never written. 97 rules (310 declarations) are fully dead; 9 rules carry dead selector-list members; 68 distinct styled classes are never emitted.

Dynamic prefixes honoured: `conn-point-icon-- (src/View/Connect.elm:319)`, `guides-page-- (src/View/Guides.elm:247)`, `onyx-home-outbox- (src/View/Home.elm:244)`, `onyx-land-sketch-avatar-- (src/View/Landing.elm:120)`, `onyx-land-claim-icon-- (src/View/Landing.elm:206)`, `oc-btn- (src/View/OperKit.elm:172)`, `public-info-page-- (src/View/PublicInfo.elm:140)`, `onyx-button-- (src/View/Studio.elm:174)`, `ts-audit__badge-- (src/View/Studio.elm:1151)`, `onyx-toast-- (src/View/Toast.elm:39)`, `trust-page-- (src/View/Trust.elm:223)`.

### G16.1 Fully dead rules

| file:line | selector | decls | never emitted |
|---|---|---|---|
| app.css:469 | `.onyx-rail-count` | 3 | `.onyx-rail-count` |
| app.css:615 | `.onyx-newmsg-header` | 3 | `.onyx-newmsg-header` |
| app.css:616 | `.onyx-newmsg-header > div:nth-child(2)` | 2 | `.onyx-newmsg-header` |
| app.css:617 | `.onyx-newmsg-header h2` | 2 | `.onyx-newmsg-header` |
| app.css:618 | `.onyx-newmsg-mark` | 3 | `.onyx-newmsg-mark` |
| app.css:619 | `.onyx-newmsg-eyebrow` | 5 | `.onyx-newmsg-eyebrow` |
| app.css:626 | `.onyx-newmsg-close` | 8 | `.onyx-newmsg-close` |
| app.css:740 | `.onyx-member-prefix` | 3 | `.onyx-member-prefix` |
| app.css:800 | `.onyx-calls-toggle` | 7 | `.onyx-calls-toggle` |
| app.css:810 | `.onyx-calls-toggle-open` | 2 | `.onyx-calls-toggle-open` |
| app.css:1052 | `.chb-head` | 3 | `.chb-head` |
| app.css:1053 | `.chb-title` | 2 | `.chb-title` |
| app.css:1054 | `.chb-desc` | 3 | `.chb-desc` |
| app.css:1055 | `.chb-close` | 5 | `.chb-close` |
| app.css:1084 | `.chb-eyebrow` | 2 | `.chb-eyebrow` |
| app.css:1085 | `.chb-create-header h2` | 2 | `.chb-create-header` |
| app.css:1086 | `.chb-create-lead` | 2 | `.chb-create-lead` |
| app.css:1116 | `.onyx-composer .onyx-schedule-open` | 7 | `.onyx-schedule-open` |
| app.css:1126 | `.onyx-composer .onyx-schedule-open:disabled` | 2 | `.onyx-schedule-open` |
| app.css:1210 | `.onyx-scheduled-head` | 3 | `.onyx-scheduled-head` |
| app.css:1211 | `.onyx-scheduled-title` | 3 | `.onyx-scheduled-title` |
| app.css:1213 | `.onyx-scheduled-desc` | 3 | `.onyx-scheduled-desc` |
| app.css:1250 | `.onyx-account-head` | 3 | `.onyx-account-head` |
| app.css:1251 | `.onyx-account-title` | 3 | `.onyx-account-title` |
| app.css:1252 | `.onyx-account-close` | 6 | `.onyx-account-close` |
| app.css:1390 | `.onyx-steward-head` | 3 | `.onyx-steward-head` |
| app.css:1391 | `.onyx-steward-title` | 3 | `.onyx-steward-title` |
| app.css:1392 | `.onyx-steward-room` | 2 | `.onyx-steward-room` |
| app.css:1393 | `.onyx-steward-close` | 5 | `.onyx-steward-close` |
| app.css:1514 | `.onyx-member-profile` | 8 | `.onyx-member-profile` |
| app.css:1524 | `.onyx-member-profile:hover` | 2 | `.onyx-member-profile` |
| app.css:1536 | `.onyx-profile-head` | 3 | `.onyx-profile-head` |
| app.css:1537 | `.onyx-profile-title` | 2 | `.onyx-profile-title` |
| app.css:1538 | `.onyx-profile-desc` | 3 | `.onyx-profile-desc` |
| app.css:1539 | `.onyx-profile-close` | 8 | `.onyx-profile-close` |
| app.css:1568 | `.onyx-member-nick` | 8 | `.onyx-member-nick` |
| app.css:1578 | `.onyx-member-nick:hover` | 1 | `.onyx-member-nick` |
| app.css:1591 | `.onyx-member-avatar` | 10 | `.onyx-member-avatar` |
| app.css:2234 | `.onyx-leave` | 2 | `.onyx-leave` |
| app.css:2274 | `.notify-head` | 3 | `.notify-head` |
| app.css:2275 | `.notify-title` | 3 | `.notify-title` |
| app.css:2276 | `.notify-close` | 6 | `.notify-close` |
| app.css:2409 | `.onyx-you-title` | 2 | `.onyx-you-title` |
| app.css:2413 | `.onyx-you-close` | 6 | `.onyx-you-close` |
| app.css:2482 | `.onyx-home-signal` | 9 | `.onyx-home-signal` |
| app.css:2486 | `.onyx-home-signal-lead` | 3 | `.onyx-home-signal-lead` |
| app.css:2487 | `.onyx-home-signal-lead strong` | 1 | `.onyx-home-signal-lead` |
| app.css:2488 | `.onyx-home-signal-metrics` | 3 | `.onyx-home-signal-metrics` |
| app.css:2489 | `.onyx-home-signal-metrics div` | 3 | `.onyx-home-signal-metrics` |
| app.css:2490 | `.onyx-home-signal-metrics dt` | 2 | `.onyx-home-signal-metrics` |
| app.css:2491 | `.onyx-home-signal-metrics dd` | 3 | `.onyx-home-signal-metrics` |
| app.css:2750 | `.onyx-roster .onyx-member-prefix` | 2 | `.onyx-member-prefix` |
| app.css:2752 | `.onyx-member-identity .onyx-member-nick` | 3 | `.onyx-member-nick` |
| app.css:2753 | `.onyx-away .onyx-member-nick` | 2 | `.onyx-member-nick` |
| app.css:2755 | `.onyx-member-row-actions` | 3 | `.onyx-member-row-actions` |
| app.css:2756 | `.onyx-member-row-actions .onyx-member-profile` | 1 | `.onyx-member-row-actions` `.onyx-member-profile` |
| app.css:3016 | `.onyx-shortcuts-header` | 4 | `.onyx-shortcuts-header` |
| app.css:3017 | `.onyx-shortcuts-header h2` | 2 | `.onyx-shortcuts-header` |
| app.css:3018 | `.onyx-shortcuts-description` | 3 | `.onyx-shortcuts-description` |
| app.css:3073 | `.onyx-moddesk-eyebrow` | 5 | `.onyx-moddesk-eyebrow` |
| app.css:3074 | `.onyx-moddesk-room` | 5 | `.onyx-moddesk-room` |
| app.css:3254 | `.onyx-prefs-head` | 5 | `.onyx-prefs-head` |
| app.css:3255 | `.onyx-prefs-head > div` | 2 | `.onyx-prefs-head` |
| app.css:3256 | `.onyx-prefs-title` | 2 | `.onyx-prefs-title` |
| app.css:3257 | `.onyx-prefs-desc` | 3 | `.onyx-prefs-desc` |
| app.css:3258 | `.onyx-prefs-close` | 7 | `.onyx-prefs-close` |
| app.css:3302 | `.pref-placeholder` | 1 | `.pref-placeholder` |
| app.css:3471 | `.onyx-call-bar-left` | 4 | `.onyx-call-bar-left` |
| app.css:3476 | `.onyx-call-bar-right` | 5 | `.onyx-call-bar-right` |
| app.css:3557 | `.onyx-call-bar-right` @@media (max-width: 880px) | 1 | `.onyx-call-bar-right` |
| app.css:3792 | `.notif-center__head` | 3 | `.notif-center__head` |
| app.css:3793 | `.notif-center__head > span` | 2 | `.notif-center__head` |
| app.css:4018 | `.onyx-member-prefix` | 1 | `.onyx-member-prefix` |
| app.css:4031 | `.onyx-newmsg-mark` | 1 | `.onyx-newmsg-mark` |
| gap-appearance.css:271 | `:root[data-scene='appearance'] #onyx-scene` | 1 | `[data-scene]` |
| gap-appearance.css:278 | `:root[data-shell-scheme='light'][data-scene='appearance'] #onyx-scene` | 1 | `[data-scene]` |
| gap-appearance.css:285 | `:root[data-scene] body` | 1 | `[data-scene]` |
| gap-appearance.css:286 | `:root[data-scene='appearance'] .ap, :root[data-scene='appearance'] .ap-background-host` | 1 | `[data-scene]` |
| gap-appearance.css:291 | `:root[data-reduce-transparency='true'][data-scene] body` | 1 | `[data-scene]` |
| pol-shell.css:47 | `.notif-center__head` | 2 | `.notif-center__head` |
| pol-shell.css:48 | `.notif-center__title` | 3 | `.notif-center__title` |
| pol-shell.css:49 | `.notif-center .notif-center__close` | 6 | `.notif-center__close` |
| pol-shell.css:282 | `.onyx-moddesk-form--danger` | 1 | `.onyx-moddesk-form--danger` |
| pol-shell.css:283 | `.onyx-moddesk-form--danger label:first-of-type` | 1 | `.onyx-moddesk-form--danger` |
| pol-shell.css:303 | `.chb .chb-close` | 4 | `.chb-close` |
| pol-shell.css:452 | `.onyx-steward-notices` | 4 | `.onyx-steward-notices` |
| pol-shell.css:453 | `.onyx-steward-notice` | 7 | `.onyx-steward-notice` |
| pol-public.css:1373 | `.invite-preview-title` | 1 | `.invite-preview-title` |
| roomsettings.css:130 | `.rset-room` | 3 | `.rset-room` |
| calls-c6.css:87 | `.onyx-room-more-menu > button.onyx-call-dm-start` | 3 | `.onyx-call-dm-start` |
| gap-oper.css:407 | `.onyx-sheet-layer > .onyx-moddesk-sheet[data-testid="oper-sheet"] .onyx-moddesk-bar > .onyx-sheet-cl` | 1 | `.onyx-moddesk-bar` |
| gap-oper.css:409 | `.onyx-sheet-layer > .onyx-moddesk-sheet[data-testid="oper-sheet"] .onyx-moddesk-bar > .onyx-sheet-cl` @@media (max-width: 767.98 | 1 | `.onyx-moddesk-bar` |
| gap-oper.css:444 | `.oper-desk .onyx-moddesk-eyebrow` @@media (max-height: 520px | 1 | `.onyx-moddesk-eyebrow` |
| gap-people.css:116 | `.moderation-desk__ban-review` | 1 | `.moderation-desk__ban-review` |
| gap-people.css:119 | `.moderation-desk__review-summary` | 3 | `.moderation-desk__review-summary` |
| gap-people.css:124 | `.moderation-desk__ban-review .moderation-desk__ban-mask` | 3 | `.moderation-desk__ban-review` |
| gap-shell.css:341 | `.gs-conn-signin` | 2 | `.gs-conn-signin` |

### G16.2 Rules with dead selector-list members

| file:line | dead members |
|---|---|
| app.css:2102 | `.onyx-leave` |
| app.css:2808 | `.onyx-shortcuts-close:focus-visible` |
| app.css:2877 | `.onyx-shortcuts-close` |
| app.css:3750 | `.onyx-calls-toggle-open` |
| calls-c6.css:76 | `.onyx-call-dm-start:focus-visible` |
| ui-sheets.css:246 | `.onyx-you-close`<br>`.notif-center__close`<br>`.onyx-shortcuts-close` |
| ui-sheets.css:270 | `.onyx-you-close:focus-visible`<br>`.onyx-shortcuts-close:focus-visible` |
| ui-sheets.css:1024 | `.onyx-you-close:hover`<br>`.notif-center__close:hover`<br>`.onyx-shortcuts-close:hover` |
| ui-sheets.css:1418 | `.onyx-sheet .onyx-moddesk-form--danger > label:first-of-type` |

### G16.3 Never-emitted classes

`.chb-close` (app.css,pol-shell.css) · `.chb-create-header` (app.css) · `.chb-create-lead` (app.css) · `.chb-desc` (app.css) · `.chb-eyebrow` (app.css) · `.chb-head` (app.css) · `.chb-title` (app.css) · `.gs-conn-signin` (gap-shell.css) · `.invite-preview-title` (pol-public.css) · `.moderation-desk__ban-review` (gap-people.css) · `.moderation-desk__review-summary` (gap-people.css) · `.notif-center__close` (pol-shell.css,ui-sheets.css) · `.notif-center__head` (app.css,pol-shell.css) · `.notif-center__title` (pol-shell.css) · `.notify-close` (app.css) · `.notify-head` (app.css) · `.notify-title` (app.css) · `.onyx-account-close` (app.css) · `.onyx-account-head` (app.css) · `.onyx-account-title` (app.css) · `.onyx-call-bar-left` (app.css) · `.onyx-call-bar-right` (app.css) · `.onyx-call-dm-start` (pol-shell.css,calls-c6.css) · `.onyx-calls-toggle` (app.css) · `.onyx-calls-toggle-open` (app.css) · `.onyx-home-signal` (app.css) · `.onyx-home-signal-lead` (app.css) · `.onyx-home-signal-metrics` (app.css) · `.onyx-leave` (app.css) · `.onyx-member-avatar` (app.css) · `.onyx-member-nick` (app.css) · `.onyx-member-prefix` (app.css) · `.onyx-member-profile` (app.css) · `.onyx-member-row-actions` (app.css) · `.onyx-moddesk-bar` (gap-oper.css) · `.onyx-moddesk-eyebrow` (app.css,gap-oper.css) · `.onyx-moddesk-form--danger` (pol-shell.css,ui-sheets.css) · `.onyx-moddesk-room` (app.css) · `.onyx-newmsg-close` (app.css) · `.onyx-newmsg-eyebrow` (app.css) · `.onyx-newmsg-header` (app.css) · `.onyx-newmsg-mark` (app.css) · `.onyx-prefs-close` (app.css) · `.onyx-prefs-desc` (app.css) · `.onyx-prefs-head` (app.css) · `.onyx-prefs-title` (app.css) · `.onyx-profile-close` (app.css) · `.onyx-profile-desc` (app.css) · `.onyx-profile-head` (app.css) · `.onyx-profile-title` (app.css) · `.onyx-rail-count` (app.css) · `.onyx-schedule-open` (app.css) · `.onyx-scheduled-desc` (app.css) · `.onyx-scheduled-head` (app.css) · `.onyx-scheduled-title` (app.css) · `.onyx-shortcuts-close` (app.css,ui-sheets.css) · `.onyx-shortcuts-description` (app.css) · `.onyx-shortcuts-header` (app.css) · `.onyx-steward-close` (app.css) · `.onyx-steward-head` (app.css) · `.onyx-steward-notice` (pol-shell.css) · `.onyx-steward-notices` (pol-shell.css) · `.onyx-steward-room` (app.css) · `.onyx-steward-title` (app.css) · `.onyx-you-close` (app.css,ui-sheets.css) · `.onyx-you-title` (app.css) · `.pref-placeholder` (app.css) · `.rset-room` (roomsettings.css)

### G16.4 Attribute values never seen as literals (lower confidence: the value may be computed)

| file:line | selector | unseen |
|---|---|---|
| pol-thread.css:84 | `.pt-ico[data-icon="calendar"]` | `[data-icon="calendar"]` |
| pol-thread.css:85 | `.pt-ico[data-icon="chart"]` | `[data-icon="chart"]` |

### G16.5 Classes the views emit in class / classList that no stylesheet mentions (2)

`and` (src/View/Attention.elm:428) · `gorg-more` (src/View/Organize.elm:958)

## G17. Component families (classes by naming pattern, where each is defined)


### avatar / facepile (34 classes, 8 multi-file, 1 dead)

| defined in | classes |
|---|---|
| app.css | `.conn-identity-avatar` `.onyx-avatar--md` `.onyx-avatar--owner` `.onyx-avatar--service` `.onyx-call-avatar-md` `.onyx-call-avatar-sm` `.onyx-facepile-away` `.onyx-facepile-overflow` `.onyx-home-avatar` `.onyx-home-avatar-person` `.onyx-member-avatar` **dead** `.onyx-member-avatar-slot` |
| pol-shell.css | `.onyx-call-ring-avatar` `.onyx-face` `.onyx-ident-avatar` `.onyx-room-header-avatar` `.onyx-you-avatar` |
| pol-public.css | `.onyx-land-sketch-avatar` `.onyx-land-sketch-avatar--gold` `.onyx-land-sketch-avatar--lapis` `.onyx-land-sketch-avatar--shu` |
| pol-thread.css | `.onyx-room-intro-face` `.onyx-thread-msg-face` `.pins-item-face` |
| gap-convo.css | `.gap-skeleton-avatar` |
| app.css + gap-appearance.css + pol-shell.css + pol-thread.css + pol-roster.css + rx-shell.css | `.onyx-avatar` |
| app.css + pol-roster.css | `.onyx-avatar--sm` |
| app.css + calls-c6.css + calls-engine.css | `.onyx-call-avatar` |
| app.css + calls-c4.css + calls-engine.css | `.onyx-call-avatar-lg` |
| app.css + pol-shell.css + roomsettings.css + rx-shell.css | `.onyx-facepile` |
| app.css + rx-shell.css | `.onyx-facepile-face` |
| app.css + pol-shell.css + account2.css + rx-shell.css | `.onyx-rail-avatar` |
| pol-thread.css + gap-organize.css | `.onyx-row-avatar` |
| calls-c4.css | `.onyx-tile-avatar` |

### divider (5 classes, 2 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-public.css | `.ab-seam` |
| gap-chanserv.css | `.cs-rule-group` |
| app.css + gap-appearance.css + pol-thread.css | `.onyx-day-divider` |
| app.css + pol-thread.css | `.onyx-day-divider-label` |
| pol-stats.css | `.r-divider` |

### sheet / dialog / popover (83 classes, 24 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.guest-claim-sheet` `.guest-claim-sheet__actions` `.guest-claim-sheet__cancel` `.guest-claim-sheet__error` `.guest-claim-sheet__label` `.guest-claim-sheet__lede` `.guest-claim-sheet__submit` `.jump-to-date-sheet` `.onyx-call-sheet-body` `.onyx-call-sheet-close` `.onyx-call-sheet-head` `.onyx-overlays` `.onyx-profile-sheet` `.shortcuts-overlay__desc` `.shortcuts-overlay__group-name` `.shortcuts-overlay__kbd` `.shortcuts-overlay__keys` `.shortcuts-overlay__rows` `.shortcuts-overlay__sep` |
| pol-thread.css | `.onyx-react-backdrop` `.onyx-thread-backdrop` `.shell-msg-lightbox` `.shell-msg-lightbox-actions` `.shell-msg-lightbox-backdrop` `.shell-msg-lightbox-close` `.shell-msg-lightbox-dialog` `.shell-msg-lightbox-img` `.shell-msg-lightbox-save` `.shell-msg-lightbox-save-label` `.shell-msg-lightbox-spacer` `.shell-msg-lightbox-stage` `.shell-msg-lightbox-zoom` |
| app.css + ui-sheets.css | `.guest-claim-sheet__form` `.guest-claim-sheet__hint` `.onyx-newmsg-sheet` `.onyx-sheet-title` `.onyx-shortcuts-sheet` `.onyx-spotlight-backdrop` `.shortcuts-overlay` `.shortcuts-overlay__row` |
| gap-import.css | `.bk-card--modal` `.bk-dialog` `.bk-dialog--inspect` `.bk-dialog-actions` `.bk-dialog-body` `.bk-modal-copy` `.bk-modal-row` |
| ui-sheets.css | `.onyx-sheet-head-actions` `.onyx-sheet-heading` `.onyx-sheet-kicker` `.onyx-sheet-spacer` `.onyx-sheet-sub` |
| polish.css | `.a2hs-sheet__actions` `.a2hs-sheet__detail` `.a2hs-sheet__status` `.onyx-sheet-lede` |
| app.css + gap-oper.css + ui-sheets.css | `.onyx-moddesk-sheet` `.onyx-sheet-close` |
| app.css + pol-thread.css | `.onyx-msg-menu-backdrop` `.onyx-thread-sheet` |
| gap-watch.css | `.onyx-watch-sheet` `.onyx-watch-sheet-actions` |
| account2.css | `.a2-sheet` |
| polish.css + pol-ios.css | `.a2hs-sheet` |
| gap-oper.css | `.ap-sheet` |
| gap-commands.css | `.gap-help-sheet` |
| calls-engine.css | `.onyx-call-more-scrim` |
| calls-c6.css | `.onyx-call-ring-layer` |
| app.css + calls-c11.css + calls-engine.css | `.onyx-call-sheet` |
| app.css + pol-shell.css | `.onyx-nav-btn--dialog-open` |
| pol-shell.css + ui-sheets.css | `.onyx-profile-backdrop` |
| rx-shell.css | `.onyx-railmenu-layer` |
| app.css + pol-shell.css + ui-sheets.css | `.onyx-room-more-scrim` |
| app.css + pol-thread.css + calls-c11.css + calls-c6.css + rx-shell.css + gap-commands.css + gap-shell.css + ui-sheets.css + calls-engine.css | `.onyx-sheet` |
| app.css + rx-shell.css + ui-sheets.css | `.onyx-sheet-backdrop` |
| pol-thread.css + ui-sheets.css | `.onyx-sheet-grip` |
| app.css + roomsettings.css + ui-sheets.css | `.onyx-sheet-head` |
| app.css + pol-thread.css + calls-c6.css + rx-shell.css + ui-sheets.css + pol-ios.css | `.onyx-sheet-layer` |
| gap-chanserv.css + gap-shell.css + ui-sheets.css | `.onyx-sheet-x` |
| calls-c11.css | `.onyx-stage-hands-sheet-list` |
| pol-public.css | `.onyxos-source__sheet` |
| app.css + gap-appearance.css + pol-thread.css | `.shell-composer-popovers` |
| pol-shell.css | `.shortcuts-overlay__group` |

### heading / kicker / label (257 classes, 39 multi-file, 13 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-eyebrow` **dead** `.chb-invite-heading` `.chb-invite-label` `.chb-skin-label` `.chb-title` **dead** `.conn-alt-title` `.conn-hint` `.conn-identities-eyebrow` `.conn-identities-title` `.conn-label` `.conn-point-title` `.jump-to-date__hint` `.moderation-cockpit__hint` `.notify-title` **dead** `.onyx-account-passkey-meta` `.onyx-account-persona-offers-label` `.onyx-account-title` **dead** `.onyx-call-hint` `.onyx-calls-kicker` `.onyx-calls-rooms-title` `.onyx-dmsafe-kicker` `.onyx-dmsafe-number-label` `.onyx-home-label` `.onyx-invshare-label` `.onyx-keychange-col-label` `.onyx-keychange-kicker` `.onyx-keychange-lede` `.onyx-keychange-sub` `.onyx-keychange-title` `.onyx-member-meta` `.onyx-moderation-title` `.onyx-newmsg-eyebrow` **dead** `.onyx-newmsg-hint` `.onyx-prefs-title` **dead** `.onyx-profile-title` **dead** `.onyx-reclaim-label` `.onyx-schedule-headings` `.onyx-schedule-title` `.onyx-scheduled-meta` `.onyx-scheduled-title` **dead** `.onyx-steward-label` `.onyx-steward-title` **dead** `.onyx-you-title` **dead** `.person-safety__note-label` `.person-safety__title` `.pref-section-title` |
| pol-public.css | `.a11y-kicker` `.a11y-lede` `.ab-eyebrow` `.ab-kicker` `.ab-lede` `.ab-scene__label` `.ab-scene__title` `.ab-title` `.dl-checksum-label` `.dl-kicker` `.dl-lede` `.dl-section-title` `.guides-index__eyebrow` `.guides-kicker` `.guides-route__title` `.guides-route-map__eyebrow` `.guides-share__eyebrow` `.guides-snapshot__eyebrow` `.invite-lede` `.invite-preview-title` **dead** `.onyx-land-kicker` `.onyx-land-lede` `.onyx-land-shelf-label` `.onyx-land-sketch-caption` `.onyx-land-sketch-meta` `.onyxos-eyebrow` `.onyxos-lede` `.onyxos-section-heading` `.public-frame__current-kicker` `.public-frame__current-label` `.public-frame__footer-title` `.public-frame__nav-more-title` `.public-related__title` `.trust-article-heading` |
| pol-thread.css | `.onyx-intro-title` `.onyx-message-search__section-title` `.onyx-message-search__target-kicker` `.onyx-message-search__vault-label` `.onyx-outbox-label` `.onyx-room-intro-title` `.onyx-thread-headings` `.onyx-thread-msg-meta` `.pins-context-kicker` `.pins-title` `.room-media-index-context-kicker` `.room-media-index-meta` `.room-media-index-title` `.shell-composer-context-label` `.shell-msg-preview-title` |
| pol-studio.css | `.ap-background-stage__heading` `.ap-ghint` `.ap-glabel` `.ap-label` `.ap-readiness-title` `.onyx-field__label` `.ts-audit__label` `.ts-eyebrow` `.ts-factory__hint` `.ts-preview__bar-title` `.ts-section__heading` `.ts-simple-look__hint` `.ts-token-label` |
| gap-import.css | `.bk-detail-label` `.bk-section-title` `.bk-title` `.hi-activity-sub` `.hi-batch-meta` `.hi-conv-meta` `.hi-dest-label` `.hi-hint` `.hi-kicker` `.hi-review-bar-title` `.hi-review-sub` `.hi-review-title` `.hi-tally-label` |
| pol-stats.css | `.data-room-heading` `.public-room-comparison__lede` `.r-title` `.roadmap-kicker` `.roadmap-lede` `.stats-chart-caption` `.stats-feed-step__heading` `.stats-title-accent` `.status-kicker` `.status-lede` `.status-observation__label` |
| calls-c8.css | `.onyx-call-caption` `.onyx-call-caption-nick` `.onyx-call-caption-text` `.onyx-call-caption-tr` `.onyx-call-captions-head` `.onyx-call-captions-log` `.onyx-call-captions-source` `.onyx-call-captions-state` `.onyx-call-captions-title` `.onyx-vs-label` `.onyx-vs-title` |
| gap-oper.css | `.ap-hint` `.oc-hint` `.oc-lede` `.oc-meta` `.oc-meta-inline` `.oc-more-hint` `.oc-more-title` `.oc-replies-title` `.oc-sub` `.oc-sub-title` |
| gap-watch.css | `.onyx-watch-handoff-label` `.onyx-watch-heading` `.onyx-watch-hint` `.onyx-watch-kicker` `.onyx-watch-label` `.onyx-watch-link-label` `.onyx-watch-meta` `.onyx-watch-review-title` `.onyx-watch-title` |
| roomsettings.css | `.rset-access-meta` `.rset-bridge-label` `.rset-event-title` `.rset-group-indicator-label` `.rset-hint` `.rset-insights-title` `.rset-label` `.rset-readonly-label` `.rset-roles-label` |
| gap-usermodes.css | `.um-blocks__title` `.um-held__title` `.um-hint` `.um-hint--inline` `.um-label` `.um-memo__title` `.um-requests__title` `.um-selfname__label` |
| gap-organize.css | `.gorg-digest-kicker` `.gorg-note-label` `.gorg-reader-label` `.gorg-rset-hint` `.gorg-rset-title` `.gorg-saved-meta` `.gorg-sub` |
| pol-shell.css | `.conn-strength-label` `.notif-center__title` **dead** `.onyx-account-section__subtitle` `.onyx-conn-label` `.onyx-rail-line--sub` `.onyx-room-more-title` |
| account2.css | `.a2-heading` `.a2-hint` `.a2-label` `.a2-ready__label` `.a2-reclaim__title` |
| app.css + ui-sheets.css | `.jump-to-date-title` `.onyx-account-section__title` `.onyx-you-group__hint` `.onyx-you-group__title` `.onyx-you-lede` |
| app.css + pol-shell.css | `.onyx-account-hint` `.onyx-coach-eyebrow` `.onyx-home-title` `.onyx-rail-section-heading` `.onyx-rail-sub` |
| gap-shell.css | `.gs-door-sub` `.gs-leave-title` `.gs-motd-pack-title` `.gs-motd-title` |
| pol-shell.css + rx-shell.css | `.onyx-rail-new-label` `.onyx-rail-title` `.onyx-room-header-titles` `.onyx-topbar-title` |
| pol-stats.css + pol-public.css | `.label` `.r-kicker` `.sub` |
| calls-c8.css + calls-engine.css | `.onyx-call-caption-translate` `.onyx-call-captions` `.onyx-call-captions-copy` |
| gap-commands.css | `.gap-keys-pref-hint` `.gap-keys-pref-title` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-call-join-label` `.onyx-rail-meta` |
| calls-c6.css | `.onyx-call-ring-kicker` `.onyx-call-ring-title` |
| calls-c6.css + calls-engine.css | `.onyx-call-ring-meta` `.onyx-call-ring-sub` |
| gap-people.css | `.onyx-member-mod-title` `.onyx-roster-more-hint` |
| pol-roster.css | `.onyx-mlist-group-title` `.onyx-mlist-title` |
| app.css + gap-oper.css | `.onyx-moddesk-eyebrow` **dead** `.onyx-moddesk-hint` |
| calls-c11.css | `.onyx-stage-hint` `.onyx-stage-title` |
| pol-studio.css + gap-oper.css | `.ap-lede` |
| app.css + gap-auth.css | `.conn-title` |
| gap-chanserv.css | `.cs-join-title` |
| gap-auth.css | `.ga-question-label` |
| gap-convo.css | `.gap-drop-title` |
| gap-account.css | `.gap-review-title` |
| gap-claim.css | `.gc-kicker` |
| app.css + gap-organize.css + ui-sheets.css | `.notify-group-title` |
| app.css + gap-organize.css | `.notify-hint` |
| calls-engine.css | `.onyx-call-meta` |
| app.css + calls-engine.css | `.onyx-calls-title` |
| app.css + rx-shell.css | `.onyx-nav-label` |
| app.css + pol-shell.css + gap-organize.css | `.onyx-rail-label` |
| pol-shell.css + roomsettings.css + rx-shell.css | `.onyx-room-header-sub` |
| app.css + gap-usermodes.css | `.onyx-schedule-sub` |
| app.css + pol-thread.css | `.onyx-thread-title` |
| app.css + gap-appearance.css + gap-claim.css | `.pref-label` |
| roomsettings.css + gap-organize.css | `.rset-heading` |
| gap-appearance.css + pol-thread.css | `.shell-msg-spoiler-label` |
| polish.css | `.time-scrubber__label` |

### button-like by declarations (per-instance class name) (107 classes, 16 multi-file, 4 dead)

| defined in | classes |
|---|---|
| app.css | `.conn-cancel` `.conn-identities-dismiss` `.conn-identities-go` `.conn-identity-forget` `.jump-to-date__copy` `.jump-to-date__jump` `.jump-to-date__preset` `.notify-remove` `.onyx-account-cert-bind` `.onyx-account-cert-remove-go` `.onyx-account-data-download` `.onyx-account-data-history` `.onyx-account-device-publish` `.onyx-account-device-remove-legacy` `.onyx-account-drop-arm` `.onyx-account-drop-cancel` `.onyx-account-drop-go` `.onyx-account-email-save` `.onyx-account-keytrans-refresh` `.onyx-account-logout` `.onyx-account-passkey-add` `.onyx-account-passkey-cancel` `.onyx-account-passkey-refresh` `.onyx-account-passkey-remove` `.onyx-account-passkey-remove-go` `.onyx-account-passkey-rename` `.onyx-account-passkey-save` `.onyx-account-password-save` `.onyx-account-recovery-clear` `.onyx-account-recovery-copy` `.onyx-account-recovery-done` `.onyx-account-recovery-generate` `.onyx-account-recovery-refresh` `.onyx-account-refresh` `.onyx-account-session__drop` `.onyx-account-totp-confirm-go` `.onyx-account-totp-copy` `.onyx-account-totp-disable` `.onyx-account-totp-enroll` `.onyx-calls-room` `.onyx-home-room` `.onyx-keychange-accept` `.onyx-keychange-dismiss` `.onyx-keychange-retry` `.onyx-leave` **dead** `.onyx-member-nick` **dead** `.onyx-member-profile` **dead** `.onyx-reclaim-cancel` `.onyx-reconnect-retry` `.onyx-scheduled-cancel` `.shell-msg-channel-link` |
| pol-thread.css | `.onyx-message-search__saved-delete` `.onyx-message-search__saved-run` `.onyx-message-search__vault-mode` `.room-media-index-filter` `.room-media-index-jump` `.room-media-index-retry` `.shell-msg-media-consent` `.shell-msg-preview-consent` |
| pol-shell.css | `.onyx-account-persona-claim-go` `.onyx-account-persona-off` `.onyx-account-persona-wear` `.onyx-calls-join-video` `.onyx-calls-join-voice` `.onyx-calls-leave` `.onyx-calls-mute` |
| gap-organize.css | `.gorg-link` `.gorg-note-add` `.gorg-preset-option` `.gorg-reader-exit` `.gorg-saved-open` |
| pol-public.css | `.dl-copy` `.guides-copy` `.guides-download` `.guides-reset` |
| account2.css | `.a2-link` `.a2-reclaim__dismiss` `.a2-reclaim__signin` |
| app.css + pol-thread.css | `.onyx-jump-latest` `.onyx-thread-indicator` `.shell-topic-follow` |
| polish.css | `.time-scrubber__bar` `.time-scrubber__close` `.time-scrubber__copy` |
| pol-studio.css | `.ts-audit__fix` `.ts-token-revert` `.ts-token-swatch` |
| app.css + ui-sheets.css | `.onyx-you-leave` `.onyx-you-link` |
| gap-import.css | `.bk-inspect` |
| app.css + gap-auth.css | `.conn-link` |
| gap-convo.css | `.gap-collapsed-show` |
| gap-commands.css | `.gap-keys-pref` |
| pol-shell.css + ui-sheets.css | `.notif-center__close` **dead** |
| app.css + pol-shell.css + rx-shell.css + calls-engine.css | `.onyx-call-join` |
| app.css + pol-shell.css + pol-thread.css | `.onyx-coach-dismiss` |
| calls-c4.css | `.onyx-cq-prompt-x` |
| app.css + pol-shell.css | `.onyx-dmsafe-trigger` |
| app.css + pol-roster.css | `.onyx-member-message` |
| pol-thread.css + gap-convo.css | `.onyx-message-search__deep` |
| pol-roster.css + rx-shell.css | `.onyx-mlist-find` |
| app.css + pol-roster.css + rx-shell.css | `.onyx-roster-care` |
| gap-people.css | `.onyx-roster-more` |
| gap-watch.css | `.onyx-watch-range` |
| app.css + gap-account.css | `.pref-reset` |
| app.css + pol-shell.css + rx-shell.css | `.shell-ribbon-bell` |
| pol-stats.css | `.status-quiet-link` |

### input / textarea / field (51 classes, 6 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-field` `.chb-field-desc` `.chb-field-error` `.conn-field` `.conn-input` `.notify-input` `.onyx-account-field-label` `.onyx-steward-field` |
| gap-oper.css | `.ap-field` `.ap-input` `.oc-field` `.oc-input` `.oc-input-mono` `.oc-textarea` |
| gap-organize.css | `.gorg-field-label` `.gorg-input` `.gorg-note-input` `.gorg-quiet-field` `.gorg-textarea` |
| gap-import.css | `.bk-field` `.bk-fields` `.bk-select-input` `.hi-dest-input` |
| pol-thread.css | `.onyx-composer-field` `.onyx-message-search__input` `.onyx-message-search__query-field` `.onyx-message-search__save-input` |
| pol-studio.css | `.onyx-field` `.onyx-field__input` `.ts-save-input` `.ts-token-text-field` |
| pol-public.css | `.form-field` `.form-field-error` `.onyx-land-sketch-input` |
| gap-shell.css | `.gs-join-field` `.gs-join-input` |
| gap-watch.css | `.onyx-watch-field` `.onyx-watch-input` |
| gap-usermodes.css | `.um-input` `.um-input--area` |
| account2.css + ui-sheets.css | `.a2-input` |
| account2.css | `.a2-textarea` |
| app.css + gap-account.css | `.onyx-account-field` |
| pol-shell.css | `.onyx-rail-filter-field` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-rail-filter-input` |
| app.css + pol-roster.css + rx-shell.css | `.onyx-roster-filter-input` |
| calls-c8.css | `.onyx-vs-field` |
| gap-appearance.css | `.pref-input` |
| roomsettings.css + gap-chanserv.css | `.rset-input` |
| roomsettings.css | `.rset-textarea` |
| app.css + pol-thread.css | `.shell-topic-create-input` |

### button (202 classes, 32 multi-file, 2 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-actions` `.chb-invite-actions` `.conn-alt-btn` `.conn-identities-actions` `.conn-offer-btn` `.conn-submit` `.conn-submit--quiet` `.jump-to-date__actions` `.notify-add-btn` `.onyx-call-btn-ghost` `.onyx-call-btn-primary` `.onyx-calls-primary` `.onyx-convohead-action` `.onyx-home-caught-up-button` `.onyx-ident-action` `.onyx-keychange-actions` `.onyx-member-advanced-actions` `.onyx-member-row-actions` **dead** `.onyx-moddesk-actions` `.onyx-moddesk-danger` `.onyx-newmsg-primary` `.onyx-newmsg-secondary` `.onyx-primary-nav-context` `.onyx-reclaim-actions` `.onyx-reclaim-submit` `.onyx-scheduled-actions` `.onyx-steward-actions` `.onyx-steward-btn` `.onyx-steward-btn-danger` `.onyx-steward-btn-primary` `.person-safety__actions` `.pref-action-card__body` `.pref-action-card__title` `.pref-reset--danger` `.pref-row-action` |
| pol-public.css | `.ab-cta` `.ab-cta--section` `.dl-actions` `.dl-cta` `.guides-action` `.guides-card-actions` `.guides-hero-actions` `.guides-progress__actions` `.guides-share__actions` `.invite-actions` `.not-found-page__action` `.onyx-land-action` `.onyx-land-cta` `.onyx-land-sketch-send` `.onyxos-button` `.onyxos-button--primary` `.onyxos-hero__actions` `.public-frame__nav-actions` `.public-frame__nav-primary` |
| pol-studio.css | `.ap-action` `.ap-action--apply` `.ap-action--quiet` `.ap-background-actions` `.onyx-button` `.onyx-button--ghost` `.onyx-button--primary` `.ts-eyedropper-button` `.ts-factory__actions` `.ts-pv-actions` `.ts-pv-btn` `.ts-pv-btn--danger` `.ts-pv-btn--primary` `.ts-pv-btn--send` `.ts-scheme-toggle__btn` `.ts-seed-btn` |
| gap-import.css | `.bk-actions` `.bk-btn` `.bk-btn--action` `.bk-btn--link` `.bk-btn-label` `.hi-btn` `.hi-btn--danger` `.hi-btn--primary` `.hi-btn--quiet` `.hi-note-actions` |
| gap-oper.css | `.ap-actions` `.ap-btn` `.oc-btn` `.oc-btn-align` `.oc-btn-danger` `.oc-btn-primary` `.oc-btn-quiet` `.oc-btn-small` `.oc-review-danger` |
| pol-thread.css | `.onyx-composer-send` `.onyx-composer-send--ready` `.onyx-composer-send-label` `.onyx-earlier-button` `.onyx-latest-button` `.onyx-message-search__button` `.onyx-row-action` `.onyx-row-actions` |
| pol-shell.css | `.chb-ghost` `.chb-submit` `.notif-center__action` `.onyx-home-action--primary` `.onyx-home-action--quiet` `.onyx-moddesk-form--danger` **dead** `.onyx-nav-btn--selected` |
| gap-organize.css | `.gorg-btn` `.gorg-btn--danger` `.gorg-btn--primary` `.gorg-folder-row-actions` `.gorg-note-actions` `.gorg-outbox-actions` `.gorg-tucked-action` |
| gap-usermodes.css | `.um-actions` `.um-btn` `.um-btn--danger` `.um-btn--primary` `.um-btn--quiet` `.um-btn--soft` `.um-request__actions` |
| app.css + ui-sheets.css | `.chb-create-actions` `.onyx-member-action--primary` `.onyx-member-actions` `.onyx-moderation-actions` `.onyx-newmsg-actions` `.pref-action-card__icon` |
| pol-stats.css | `.data-action` `.data-action--ledger` `.data-room-actions` `.public-room-comparison__actions` `.r-cta` `.status-check__button` |
| app.css + pol-shell.css | `.guest-claim-chip__actions` `.onyx-home-action` `.onyx-home-actions` `.onyx-nav-btn--active` `.onyx-room-header-actions` `.pref-action-card` |
| gap-watch.css | `.onyx-watch-actions` `.onyx-watch-btn` `.onyx-watch-btn-danger` `.onyx-watch-btn-primary` `.onyx-watch-confirm-actions` `.onyx-watch-text-btn` |
| gap-account.css | `.gap-actions` `.gap-btn` `.gap-btn--primary` `.gap-btn--quiet` `.gap-list-actions` |
| gap-claim.css | `.gc-actions` `.gc-btn` `.gc-btn--danger` `.gc-btn--primary` `.gc-btn--quiet` |
| gap-shell.css | `.gs-btn` `.gs-btn--danger` `.gs-btn--ghost` `.gs-leave-actions` `.gs-seg-btn` |
| gap-commands.css | `.onyx-action-lead` `.onyx-action-nick` `.onyx-action-star` `.onyx-message--action` |
| gap-chanserv.css | `.cs-btn-danger` `.cs-join-actions` `.cs-knock-actions` |
| polish.css | `.first-run-notify__actions` `.polish-ghost` `.polish-primary` |
| gap-people.css | `.gp-actions` `.gp-btn-danger` `.onyx-member-action--danger` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-nav-btn` `.onyx-primary-nav` `.onyx-room-header-btn` |
| account2.css | `.a2-btn--danger` `.a2-btn--primary` |
| app.css + pol-shell.css + ui-sheets.css | `.chb-sort-btn` `.onyx-account-actions` |
| calls-c6.css | `.onyx-call-btn-danger` `.onyx-call-ring-actions` |
| calls-engine.css | `.onyx-call-btn-label` `.onyx-call-btn-long` |
| calls-c4.css + calls-engine.css | `.onyx-call-primary` `.onyx-tile-btn` |
| roomsettings.css | `.rset-actions` `.rset-btn-primary` |
| app.css + pol-thread.css | `.shell-topic-action` `.shell-topic-actions` |
| account2.css + ui-sheets.css | `.a2-btn` |
| app.css + gap-auth.css | `.conn-actions` |
| gap-auth.css | `.ga-actions` |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css + calls-engine.css | `.onyx-call-btn` |
| calls-c6.css + calls-engine.css | `.onyx-call-pip-btn` |
| ui-sheets.css | `.onyx-danger-zone` |
| app.css + gap-people.css + ui-sheets.css | `.onyx-member-action` |
| rx-shell.css | `.onyx-rail-emptystate-actions` |
| calls-c11.css | `.onyx-stage-actions` |
| calls-c8.css + calls-engine.css | `.onyx-vs-btn` |
| app.css + gap-account.css | `.pref-actions` |
| pol-stats.css + pol-public.css | `.r-btn` |
| roomsettings.css + gap-chanserv.css + gap-people.css | `.rset-btn` |
| pol-shell.css + pol-thread.css | `.shell-composer-action-label` |
| pol-thread.css + polish.css | `.shell-composer-tools-action` |

### card (45 classes, 15 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-public.css | `.ab-who-card` `.dl-card` `.dl-card--soon` `.dl-card-head` `.guides-card` `.guides-card__meta` `.guides-card--optional` `.guides-card--principles` `.guides-route__card` `.public-info-card` |
| app.css + pol-thread.css | `.shell-topic-card` `.shell-topic-card-author` `.shell-topic-card-follow` `.shell-topic-card-main` `.shell-topic-card-meta` `.shell-topic-card-preview` `.shell-topic-card-title` |
| pol-stats.css | `.roadmap-card` `.roadmap-card-head` `.stats-card-heading` `.stats-card-quiet` `.stats-flow-card` `.stats-heatmap-card` |
| calls-c4.css | `.onyx-tile-bottom` `.onyx-tile-name` `.onyx-tile-q` `.onyx-tile-spacer` `.onyx-tile-talk` |
| gap-import.css | `.bk-card` `.hi-card` |
| app.css + pol-shell.css + ui-sheets.css | `.chb-card` `.onyx-member-card` |
| app.css | `.chb-card-head` `.conn-card` |
| gap-claim.css | `.gc-card` `.gc-card--prefs` |
| gap-oper.css | `.oc-card` `.oc-card-head` |
| calls-c4.css + calls-engine.css | `.onyx-tile-nick` `.onyx-tile-top` |
| pol-stats.css + pol-public.css | `.data-card` |
| gap-convo.css | `.gap-drop-card` |
| pol-shell.css + rx-shell.css | `.onyx-rail-tile` |
| calls-c11.css + calls-c4.css + calls-engine.css | `.onyx-tile` |
| calls-c11.css + calls-c4.css | `.onyx-tile-video` |

### badge / count / dot (95 classes, 27 multi-file, 1 dead)

| defined in | classes |
|---|---|
| pol-studio.css | `.ap-tag` `.ts-audit__badge` `.ts-audit__badge--aa` `.ts-audit__badge--aa-large` `.ts-audit__badge--aaa` `.ts-audit__badge--fail` `.ts-audit__badge--na` `.ts-badge` `.ts-badge--modified` `.ts-preview__bar-dot` `.ts-pv-badge` `.ts-pv-badge--accent` `.ts-pv-badge--hot` `.ts-pv-chan__count` `.ts-pv-member__dot` `.ts-token-badge` |
| app.css | `.chb-count--started` `.notify-count` `.onyx-call-badge-hand` `.onyx-calls-pip` `.onyx-dot` `.onyx-home-count` `.onyx-home-unread` `.onyx-member-dot` `.onyx-rail-count` **dead** `.onyx-reconnect-dot` `.onyx-voice-count` `.pref-count` `.provenance-badge` `.shell-topic-card-unread` |
| pol-thread.css | `.onyx-earlier-count` `.onyx-message-search__count` `.onyx-message-search__server-count` `.onyx-thread-count` `.onyx-unread-divider` `.onyx-unread-divider-label` `.unread` |
| gap-organize.css | `.gorg-folder-count` `.gorg-folder-count--mention` `.gorg-folder-row-count` `.gorg-note-count` `.gorg-preset-dot` `.gorg-tucked-count` |
| calls-c6.css + calls-engine.css | `.onyx-call-pip-body` `.onyx-call-pip-cap` `.onyx-call-pip-corner` `.onyx-call-pip-faces` `.onyx-call-pip-handle` `.onyx-call-pip-live` |
| pol-shell.css | `.onyx-call-pip-leave` `.onyx-nav-badge--mention` `.onyx-rail-has-unread` `.onyx-room-back-count` `.onyx-you-conn-dot` |
| app.css + pol-shell.css | `.onyx-profile-badge` `.onyx-rail-filter-unread-on` `.onyx-rail-unread` `.shell-ribbon-badge` |
| gap-usermodes.css | `.um-inbox-link__count` `.um-requests__count` `.um-tag` `.um-tag--lock` |
| app.css + pol-thread.css | `.boost-count` `.onyx-jump-latest--unread` `.onyx-jump-latest-count` |
| app.css + calls-engine.css | `.onyx-call-badge` `.onyx-call-people-count` `.onyx-call-pip` |
| app.css + pol-roster.css | `.onyx-member-presence-dot` `.onyx-member-presence-dot--away` `.onyx-roster-count` |
| account2.css | `.a2-dot` `.a2-dot--avatar` |
| app.css + ui-sheets.css | `.chb-count` `.chb-count--live` |
| gap-shell.css | `.gs-activity-conn-dot` `.gs-door-dot` |
| calls-c6.css | `.onyx-call-pip-more` `.onyx-call-pip-where` |
| pol-shell.css + rx-shell.css | `.onyx-ident-badge` `.onyx-nav-badge` |
| calls-c4.css + calls-engine.css | `.onyx-tile-tag` `.onyx-tile-tag-text` |
| gap-chanserv.css | `.cs-slow-dot` |
| gap-account.css | `.gap-badge` |
| gap-claim.css | `.gc-facts-counts` |
| pol-public.css | `.guides-progress__count` |
| gap-oper.css | `.oc-tag` |
| calls-c11.css + calls-c6.css + calls-engine.css | `.onyx-call-pip-card` |
| pol-roster.css | `.onyx-mlist-group-count` |
| rx-shell.css | `.onyx-nav-label-count` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-rail-filter-unread` |
| roomsettings.css | `.rset-bridge-dot` |
| polish.css | `.shell-composer-tools-kbd` |
| pol-stats.css | `.stats-result-count` |

### chip (41 classes, 12 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-studio.css | `.ap-chip` `.ap-chip--theme` `.ap-chips` `.ap-theme-chip` `.ap-theme-chip--custom` `.ap-theme-chip--on` `.ts-theme-chip` `.ts-theme-chip__label` `.ts-theme-chip__scheme` `.ts-theme-chip--custom` `.ts-theme-chip-del` `.ts-theme-chip-wrap` |
| pol-shell.css | `.guest-claim-chip__hint` `.guest-claim-chip__line` `.guest-claim-chip__nick` `.onyx-account-chip` `.onyx-account-chips` `.onyx-account-chips__desc` `.onyx-account-chips__label` |
| app.css + pol-shell.css | `.guest-claim-chip` `.guest-claim-chip__dismiss` `.guest-claim-chip__text` `.onyx-dmsafe-chip` |
| app.css | `.onyx-dmsafe-chip-plain` `.onyx-dmsafe-chip-warn` `.topic-chip__hash` |
| pol-thread.css | `.onyx-message-search__recall-chip` `.topic-chip__label` `.topic-chip--all` |
| gap-oper.css | `.oc-chip` `.oc-chips` |
| pol-stats.css | `.public-room-comparison__chip` `.public-room-comparison__chips` |
| app.css + pol-thread.css | `.topic-chip` `.topic-chip__unread` |
| pol-shell.css + rx-shell.css | `.guest-claim-chip__icon` |
| app.css + pol-shell.css + rx-shell.css | `.guest-claim-chip__keep` |
| app.css + calls-engine.css | `.onyx-sec-chip` |
| app.css + pol-shell.css + calls-engine.css | `.onyx-voice-chip` |
| pol-shell.css + calls-engine.css | `.onyx-voice-chip-count` |
| app.css + pol-shell.css + rx-shell.css + calls-engine.css | `.onyx-voice-chip-status` |

### empty state (45 classes, 11 multi-file, 1 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-empty-title` `.is-empty` `.jump-to-date__empty` `.onyx-account-empty` `.onyx-account-personas-empty` `.onyx-dmsafe-empty` `.onyx-empty` `.onyx-empty-small` `.onyx-keychange-col-empty` `.onyx-newmsg-empty` `.onyx-profile-empty` `.onyx-react-empty` `.pref-placeholder` **dead** |
| rx-shell.css | `.onyx-rail-emptystate` `.onyx-rail-emptystate-alt` `.onyx-rail-emptystate-go` `.onyx-rail-emptystate-mark` `.onyx-rail-emptystate-title` |
| pol-stats.css | `.channel-spark-empty` `.data-empty` `.public-room-comparison__empty` |
| gap-organize.css | `.gorg-empty` `.gorg-empty-body` `.gorg-empty-title` |
| pol-shell.css | `.moderation-cockpit__empty` `.moderation-cockpit__empty-wrap` `.onyx-room-header-topic-empty` |
| app.css + pol-thread.css | `.onyx-feed-empty` `.onyx-feed-empty-body` `.onyx-feed-empty-title` |
| app.css + pol-shell.css | `.onyx-home-empty` `.onyx-home-empty-copy` `.onyx-rail-filter-empty` |
| pol-thread.css | `.pins-empty` `.room-media-index-empty` |
| gap-account.css | `.gap-empty` |
| gap-shell.css | `.gs-activity-empty` |
| pol-shell.css + ui-sheets.css | `.notif-center__empty` |
| gap-oper.css | `.oc-empty` |
| gap-convo.css | `.onyx-message-search__empty` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-rail-empty` |
| pol-shell.css + rx-shell.css | `.onyx-rail-zero` |
| app.css + pol-roster.css | `.onyx-roster-empty` |
| app.css + ui-sheets.css | `.onyx-scheduled-empty` |
| gap-watch.css | `.onyx-watch-empty` |

### list / row / item (170 classes, 19 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.chb-invitee-row` `.chb-row--live` `.chb-skins-row` `.conn-alt-row` `.conn-identities-list` `.moderation-desk__ban-list` `.moderation-desk__ban-row` `.moderation-desk__log-list` `.notify-item` `.notify-list` `.notify-row-copy` `.notify-row-hint` `.notify-row-title` `.onyx-account-cert-item` `.onyx-account-cert-list` `.onyx-account-device-list` `.onyx-account-passkey-list-title` `.onyx-account-passkey-row` `.onyx-account-persona-list` `.onyx-account-persona-row` `.onyx-account-totp-row` `.onyx-call-peer-list` `.onyx-calls-rooms-list` `.onyx-dmsafe-ready-row` `.onyx-home-list` `.onyx-home-outbox-item` `.onyx-home-outbox-list` `.onyx-home-row-copy` `.onyx-home-row-meta` `.onyx-home-row-name` `.onyx-moddesk-row` `.onyx-scheduled-item` `.onyx-steward-item` `.onyx-steward-list` `.pref-row` `.pref-row-copy` `.pref-row-preview` `.pref-rows` |
| pol-thread.css | `.onyx-edit-history-item` `.onyx-edit-history-list` `.onyx-message-search__saved-list` `.onyx-message-search__saved-row` `.onyx-message-search__server-list` `.onyx-message-search__server-row` `.pins-item` `.pins-item-body` `.pins-item-body--deleted` `.pins-item-body--locked` `.pins-item-body--missing` `.pins-item-from` `.pins-item-main` `.pins-item-meta` `.pins-item-state` `.pins-item-unpin` `.pins-item-when` `.pins-list` `.pins-list-item` `.room-media-index-item` `.room-media-index-list` `.room-media-index-row` `.room-media-index-row--file` `.room-media-index-row--link` `.room-media-index-row--picture` |
| gap-oper.css | `.oc-item` `.oc-item-compact` `.oc-item-main` `.oc-item-note` `.oc-item-sub` `.oc-item-title` `.oc-list` `.oc-replies-list` `.oc-row` `.oc-row-between` `.oc-row-tight` |
| gap-organize.css | `.gorg-folder-list` `.gorg-folder-row` `.gorg-folder-row-name` `.gorg-row-more` `.gorg-rset-row` `.gorg-saved-list` `.gorg-saved-row` `.gorg-tucked-list` `.gorg-tucked-row` |
| pol-public.css | `.a11y-list` `.a11y-topic-list` `.dl-artifact-list` `.dl-checksum-row` `.guides-index__list` `.guides-route__item` `.onyx-land-shelf-list` `.public-related__list` |
| pol-studio.css | `.ap-readiness-row` `.ts-audit__list` `.ts-audit__row` `.ts-header__title-row` `.ts-save-row` `.ts-section__heading-row` `.ts-token-color-row` |
| gap-usermodes.css | `.um-held__item` `.um-list` `.um-list__name` `.um-list__row` `.um-memo__list` `.um-memo__row` `.um-requests__list` |
| gap-import.css | `.bk-detail-list` `.hi-activity-row` `.hi-batch-row` `.hi-left-list` `.hi-tally-cell` |
| pol-stats.css | `.data-list` `.data-room-row` `.data-row` `.stats-feed-timeline-list` `.stats-flow-list` |
| gap-account.css | `.gap-inline-row` `.gap-list` `.gap-list-row` `.gap-list-text` `.gap-subhead-row` |
| roomsettings.css | `.onyx-dmsafe-rows` `.rset-access-list` `.rset-roles-list` `.rset-roles-row` |
| account2.css | `.a2-list` `.a2-row` `.a2-row--between` |
| app.css + ui-sheets.css | `.chb-list` `.onyx-account-nav__item` `.onyx-you-leave-row` |
| gap-chanserv.css | `.cs-mlock-row` `.cs-my-rooms-list` `.cs-row` |
| gap-commands.css | `.gap-help-item` `.gap-help-row` `.gap-help-rows` |
| gap-shell.css | `.gs-act-row` `.gs-activity-list` `.gs-motd-pack-list` |
| gap-watch.css | `.onyx-watch-end-row` `.onyx-watch-review-list` `.onyx-watch-roster-list` |
| pol-shell.css | `.chb-row` `.onyx-account-passkey-list` |
| gap-auth.css | `.ga-alt-row` `.ga-signin-row` |
| app.css + pol-thread.css | `.shell-command-item` `.shell-command-item--active` |
| polish.css | `.shell-composer-tools-item-desc` `.shell-composer-tools-item-title` |
| account2.css + ui-sheets.css | `.a2-row--fill` |
| gap-convo.css | `.gap-skeleton-row` |
| app.css + pol-shell.css + ui-sheets.css | `.notif-center__list` |
| pol-shell.css + ui-sheets.css | `.notif-center__row` |
| app.css + gap-organize.css + ui-sheets.css | `.notify-row` |
| pol-thread.css + gap-convo.css | `.onyx-attach-row` |
| app.css + calls-c4.css + calls-engine.css | `.onyx-call-more-item` |
| calls-c8.css + calls-engine.css | `.onyx-call-react-item` |
| app.css + gap-appearance.css | `.onyx-home-row` |
| gap-people.css | `.onyx-member-mod-row` |
| pol-roster.css | `.onyx-mlist-rows` |
| rx-shell.css | `.onyx-rail-entry` |
| app.css + gap-appearance.css + pol-shell.css + rx-shell.css + gap-organize.css | `.onyx-rail-item` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-rail-row` |
| pol-shell.css + rx-shell.css | `.onyx-room-header-topic-row` |
| app.css + gap-usermodes.css | `.onyx-scheduled-list` |
| calls-c11.css | `.onyx-stage-hand-row` |
| calls-c8.css | `.onyx-vs-key-row` |
| roomsettings.css + gap-chanserv.css | `.rset-access-row` |
| pol-thread.css + polish.css | `.shell-composer-tools-item` |

### icon button (37 classes, 14 multi-file, 9 dead)

| defined in | classes |
|---|---|
| app.css | `.notify-close` **dead** `.onyx-account-close` **dead** `.onyx-dmsafe-close` `.onyx-newmsg-close` **dead** `.onyx-prefs-close` **dead** `.onyx-profile-close` **dead** `.onyx-schedule-close` `.onyx-scheduled-close` `.onyx-steward-close` **dead** |
| pol-thread.css | `.onyx-message-search__button--close` `.onyx-thread-close` `.pins-close` `.room-media-index-close` `.shell-composer-context-close` |
| app.css + ui-sheets.css | `.jump-to-date-close` `.onyx-moddesk-close` `.onyx-shortcuts-close` **dead** `.onyx-you-close` **dead** |
| gap-organize.css | `.gorg-icon-btn` `.gorg-more--close` |
| gap-watch.css | `.onyx-watch-close` `.onyx-watch-icon-btn` |
| app.css + pol-shell.css | `.chb-close` **dead** |
| gap-chanserv.css | `.cs-join-close` |
| app.css + calls-c11.css + calls-c6.css + calls-c4.css + calls-engine.css | `.onyx-cbtn` |
| app.css + calls-c4.css + calls-engine.css | `.onyx-cbtn-cap` |
| calls-c8.css | `.onyx-cbtn-hand` |
| app.css + calls-engine.css | `.onyx-cbtn-leave` |
| calls-c8.css + calls-engine.css | `.onyx-cbtn-react` |
| calls-c4.css + calls-engine.css | `.onyx-cbtn-share` |
| calls-c11.css | `.onyx-cbtn-wide` |
| ui-sheets.css | `.onyx-member-card-close` |
| pol-roster.css + rx-shell.css | `.onyx-mlist-close` |
| pol-public.css | `.onyxos-close` |
| pol-shell.css + pol-thread.css | `.shell-composer-tool` |
| app.css + pol-thread.css | `.shell-composer-tool--emoji` |
| pol-thread.css + polish.css | `.shell-composer-tool--more` |

### switch / toggle (60 classes, 17 multi-file, 2 dead)

| defined in | classes |
|---|---|
| app.css | `.conn-switch` `.conn-toggle` `.conn-toggle-body` `.conn-toggle-description` `.conn-toggle-label` `.onyx-calls-toggle` **dead** `.onyx-calls-toggle-open` **dead** `.onyx-member-advanced-toggle` `.onyx-moddesk-toggles` `.onyx-notify-toggle` `.onyx-notify-toggle-open` `.pref-toggle-text` `.pref-toggle-title` |
| pol-shell.css | `.onyx-account-push-toggle` `.onyx-jump-toggle` `.onyx-media-toggle` `.onyx-media-toggle-open` `.onyx-pins-toggle` `.onyx-pins-toggle-open` `.onyx-room-settings-toggle` `.onyx-scrubber-toggle` |
| roomsettings.css + ui-sheets.css | `.rset-toggle` `.rset-toggle-text` `.rset-toggle-thumb` `.rset-toggle-track` |
| gap-organize.css | `.gorg-switch` `.gorg-switch-knob` `.gorg-tucked-toggle` |
| pol-thread.css | `.onyx-edited-toggle` `.onyx-message-search__save-toggle` `.onyx-topic-tools-toggle` |
| gap-usermodes.css | `.um-fold__toggle` `.um-more__toggle` `.um-switch` |
| gap-account.css | `.gap-switch` `.gap-switches` |
| app.css + pol-thread.css | `.onyx-audience-toggle` `.onyx-audience-toggle-set` |
| app.css + pol-shell.css | `.onyx-room-more-toggle` `.onyx-search-toggle-open` |
| calls-c8.css | `.onyx-vs-toggle-label` `.onyx-vs-toggle-text` |
| pol-studio.css | `.ts-advanced__toggle` `.ts-scheme-toggle` |
| app.css + gap-people.css + ui-sheets.css | `.chb-check` |
| gap-commands.css | `.gap-keys-pref-switch` |
| pol-public.css | `.guides-step-toggle` |
| gap-import.css | `.hi-check` |
| app.css + ui-sheets.css | `.notify-toggle` |
| pol-shell.css + pol-roster.css + rx-shell.css | `.onyx-members-toggle` |
| pol-roster.css | `.onyx-members-toggle-count` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-moddesk-toggle` |
| pol-shell.css + roomsettings.css + rx-shell.css | `.onyx-room-topic-toggle` |
| pol-shell.css + rx-shell.css | `.onyx-search-toggle` |
| calls-c8.css + calls-engine.css | `.onyx-vs-toggle` |
| gap-watch.css | `.onyx-watch-roster-toggle` |
| app.css + gap-account.css + gap-usermodes.css + ui-sheets.css | `.pref-switch` |
| app.css + gap-account.css | `.pref-toggle` |
| roomsettings.css | `.rset-toggle-label` |
| pol-stats.css | `.status-check` |

### toast / banner / notice (25 classes, 10 multi-file, 2 dead)

| defined in | classes |
|---|---|
| app.css | `.jump-to-date__notice` `.onyx-join-banner-failed` `.onyx-join-banner-warn` `.onyx-notices` `.onyx-toast__body` `.onyx-toast__undo` `.onyx-toast--info` |
| app.css + ui-sheets.css | `.onyx-toast` `.onyx-toast__dismiss` `.onyx-toast--danger` `.onyx-toast--success` `.onyx-toast--warning` |
| app.css + calls-engine.css | `.onyx-join-banner` `.onyx-join-banner-actions` `.onyx-join-banner-copy` `.onyx-join-banner-hide` |
| pol-shell.css | `.onyx-room-more-alerts` `.onyx-steward-notice` **dead** `.onyx-steward-notices` **dead** |
| gap-people.css | `.gp-notice` `.gp-notices` |
| account2.css | `.a2-reclaim--alert` |
| pol-thread.css | `.onyx-message-search__server-notice` |
| app.css + rx-shell.css + ui-sheets.css | `.onyx-toaster` |
| ui-sheets.css | `.ui-icon--alert` |

### pill (6 classes, 2 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.boost-pill--more` `.boost-pill--summary` |
| pol-public.css | `.ab-pillars` |
| app.css + pol-thread.css | `.boost-pill` |
| app.css + ui-sheets.css | `.chb-pill` |
| pol-shell.css | `.chb-pill--in` |

### skeleton / loading (18 classes, 1 multi-file, 0 dead)

| defined in | classes |
|---|---|
| gap-convo.css | `.gap-loading` `.gap-skeleton` `.gap-skeleton-body` `.gap-skeleton-line` `.gap-skeleton-line--short` `.gap-skeleton-name` |
| pol-public.css | `.guides-progress` `.guides-progress__eyebrow` `.guides-progress__head` `.guides-progress__meter` `.guides-progress__status` |
| pol-thread.css | `.onyx-pending` `.onyx-pending-note` `.room-media-index-skeleton` `.room-media-index-status--loading` |
| app.css | `.chb-invite-progress` `.onyx-account-pending` |
| pol-thread.css + gap-convo.css | `.shell-attachment-progress` |

### menu / palette / dropdown (86 classes, 29 multi-file, 0 dead)

| defined in | classes |
|---|---|
| app.css | `.onyx-msg-menu-delete-confirm-actions` `.onyx-msg-menu-delete-confirm-cancel` `.onyx-msg-menu-delete-confirm-copy` `.onyx-msg-menu-delete-confirm-delete` `.onyx-msg-menu-delete-confirm-title` `.onyx-msg-menu-translation` `.onyx-msg-menu-translation-action` `.onyx-msg-menu-translation-actions` `.onyx-msg-menu-translation-copy-status` `.onyx-msg-menu-translation-head` `.onyx-msg-menu-translation-note` `.onyx-msg-menu-translation-text` `.onyx-spotlight-empty` `.onyx-spotlight-empty-sub` `.onyx-spotlight-empty-text` `.onyx-spotlight-status` |
| app.css + ui-sheets.css | `.onyx-spotlight` `.onyx-spotlight-close` `.onyx-spotlight-foot` `.onyx-spotlight-group` `.onyx-spotlight-hint` `.onyx-spotlight-input` `.onyx-spotlight-option` `.onyx-spotlight-panel` `.onyx-spotlight-results` `.onyx-spotlight-search` `.onyx-spotlight-section` `.onyx-spotlight-sigil` `.onyx-spotlight-title` |
| gap-organize.css | `.gorg-menu` `.gorg-menu-close` `.gorg-menu-copy` `.gorg-menu-face` `.gorg-menu-head` `.gorg-menu-item` `.gorg-menu-items` `.gorg-menu-note` `.gorg-menu-sub` `.gorg-menu-tile` `.gorg-menu-title` `.gorg-menu-titles` |
| rx-shell.css | `.onyx-railmenu` `.onyx-railmenu-close` `.onyx-railmenu-face` `.onyx-railmenu-head` `.onyx-railmenu-hint` `.onyx-railmenu-item--danger` `.onyx-railmenu-notify` `.onyx-railmenu-sub` `.onyx-railmenu-tile` `.onyx-railmenu-title` `.onyx-railmenu-titles` |
| pol-studio.css | `.background-picker` `.background-picker__card` `.background-picker__card--selected` `.background-picker__copy` `.background-picker__grid` `.background-picker__group` `.background-picker__heading` `.background-picker__meta` `.background-picker__swatch` `.ts-public-look-picker` |
| app.css + pol-thread.css | `.onyx-msg-menu` `.onyx-msg-menu-delete-confirm` `.onyx-msg-menu-item` `.onyx-msg-menu-trigger` `.onyx-react-picker` `.shell-command-menu` `.shell-emoji-picker` |
| pol-thread.css | `.onyx-msg-menu-head` `.onyx-msg-menu-head-from` `.onyx-msg-menu-head-text` `.onyx-msg-menu-pop` `.shell-nick-menu` |
| rx-shell.css + gap-organize.css | `.gorg-menu-hint` `.gorg-menu-label` `.onyx-railmenu-item` `.onyx-railmenu-label` |
| app.css + pol-shell.css + rx-shell.css | `.onyx-palette-kbd` `.onyx-palette-launcher` |
| calls-c8.css | `.onyx-call-react-menu` |
| pol-shell.css + rx-shell.css | `.onyx-palette-launcher-label` |
| app.css + pol-shell.css + ui-sheets.css | `.onyx-room-more-menu` |
| app.css + gap-commands.css + ui-sheets.css | `.onyx-spotlight-icon` |
| pol-public.css | `.public-frame__menu-toggle` |
| pol-stats.css | `.stats-spotlight-metrics` |

### segmented control (21 classes, 3 multi-file, 0 dead)

| defined in | classes |
|---|---|
| gap-organize.css | `.gorg-choice` `.gorg-choice--on` `.gorg-choice-label` `.gorg-choice-meta` `.gorg-choices` |
| gap-usermodes.css | `.um-choice` `.um-choice__hint` `.um-choice__title` `.um-choice--on` |
| pol-studio.css | `.ap-chips--choices` `.ap-choice-toggle` `.ap-choice-toggles` |
| app.css | `.conn-strength-seg` `.pref-segment` `.pref-segments` |
| gap-shell.css | `.gs-seg` `.gs-seg-count` |
| app.css + pol-thread.css | `.onyx-react-choice` `.shell-emoji-choice` |
| gap-import.css | `.hi-seg` |
| app.css + pol-shell.css + rx-shell.css + ui-sheets.css | `.room-notify-seg` |

### select (9 classes, 2 multi-file, 0 dead)

| defined in | classes |
|---|---|
| gap-import.css | `.bk-select` `.bk-select-label` `.bk-select-wrap` |
| account2.css | `.a2-select` |
| app.css | `.conn-identity-select` |
| gap-organize.css | `.gorg-select` |
| calls-c8.css + calls-engine.css | `.onyx-vs-select` |
| gap-watch.css | `.onyx-watch-select` |
| roomsettings.css + gap-chanserv.css | `.rset-select` |

### tabs (15 classes, 4 multi-file, 0 dead)

| defined in | classes |
|---|---|
| pol-studio.css | `.onyx-tabs` `.onyx-tabs__content` `.onyx-tabs__list` `.onyx-tabs__trigger` |
| app.css + ui-sheets.css | `.pref-category-tab` `.pref-category-tab__label` `.pref-category-tab__summary` `.pref-category-tabs` |
| gap-oper.css | `.oc-tab` `.oc-tablist` `.oc-tabs` |
| gap-chanserv.css | `.cs-tab` `.cs-tabs` |
| pol-public.css | `.onyx-land-tabs` `.onyxos-console__tabs` |

### G17.1 Base-class property matrix (live classes; unconditional `.class { }` rules only, last declaration in cascade order)


**button** — 55 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-btn` | account2.css, ui-sheets.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.ap-action` | pol-studio.css | `var(--target-min)` |  | `0 var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` |  |  |
| `.ap-btn` | gap-oper.css | `44px` |  | `0 var(--space-4)` | `0.875rem` | `650` | `var(--radius)` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.bk-btn` | gap-import.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.conn-alt-btn` | app.css | `var(--target-min)` |  | `0 var(--space-3)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.conn-offer-btn` | app.css | `var(--target-min)` |  | `0 var(--space-4)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.conn-submit` | app.css | `48px` |  | `0 var(--space-4)` | `var(--text-md)` | `700` | `var(--radius)` | `0` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.gap-btn` | gap-account.css | `32px` |  | `4px 12px` | `var(--text-sm, 13px)` |  | `var(--radius, 6px)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.gc-btn` | gap-claim.css | `36px` |  | `0 var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.gorg-btn` | gap-organize.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.guides-action` | pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.hi-btn` | gap-import.css | `36px` |  | `0 var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.notify-add-btn` | app.css |  |  | `6px var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-action-star` | gap-commands.css |  |  |  |  | `700` |  |  |  | `var(--onyx-faint)` |
| `.onyx-call-btn` | app.css, calls-c11.css, calls-c6.css, calls-c4.css, calls-engine.css | `36px` |  | `0 14px` |  | `650` | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-call-btn-danger` | calls-c6.css |  |  |  |  |  |  |  | `var(--onyx-bad)` | `var(--onyx-bad-ink)` |
| `.onyx-call-btn-primary` | app.css |  |  |  |  |  |  |  | `var(--onyx-text)` | `var(--onyx-bg)` |
| `.onyx-call-pip-btn` | calls-c6.css, calls-engine.css | `30px` |  | `0 var(--space-3)` | `var(--text-sm)` |  |  |  |  |  |
| `.onyx-calls-primary` | app.css |  |  | `10px 22px` |  | `650` | `6px` | `0` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-convohead-action` | app.css | `28px` |  | `var(--space-1) 10px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-earlier-button` | pol-thread.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--r-pill)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-home-action` | app.css, pol-shell.css | `36px` |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-home-caught-up-button` | app.css | `36px` |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-ident-action` | app.css |  |  | `4px 12px` |  |  | `999px` | `1px solid var(--onyx-line)` | `none` | `inherit` |
| `.onyx-land-action` | pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-land-sketch-send` | pol-public.css |  | `32px` |  |  |  | `var(--radius)` |  | `var(--onyx-panel-2)` |  |
| `.onyx-latest-button` | pol-thread.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--r-pill)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-member-action` | app.css, gap-people.css, ui-sheets.css |  |  | `4px 12px` | `0.8125rem` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-nav-btn` | app.css, pol-shell.css, rx-shell.css | `44px` |  | `var(--space-2) 2px` | `var(--text-xs)` | `600` | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-dim)` |
| `.onyx-newmsg-primary` | app.css |  |  | `6px var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-newmsg-secondary` | app.css |  |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-primary-nav` | app.css, pol-shell.css, rx-shell.css |  |  | `10px 6px` |  |  |  |  | `var(--onyx-panel)` |  |
| `.onyx-reclaim-submit` | app.css |  |  | `6px 14px` |  | `600` | `6px` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-room-header-btn` | app.css, pol-shell.css, rx-shell.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-row-action` | pol-thread.css | `0` | `30px` | `0` |  |  | `4px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-row-actions` | pol-thread.css |  |  | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.onyx-steward-btn` | app.css |  |  | `4px 12px` | `0.8125rem` |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-steward-btn-danger` | app.css |  |  |  |  |  |  |  | `transparent` | `var(--onyx-bad)` |
| `.onyx-steward-btn-primary` | app.css |  |  |  |  | `700` |  |  | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-tile-btn` | calls-c4.css, calls-engine.css |  | `28px` | `0` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `color-mix(in srgb, var(--onyx-bg) 78%, t` | `var(--onyx-text)` |
| `.onyx-watch-btn` | gap-watch.css | `var(--gw-control)` |  | `0 14px` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-watch-btn-danger` | gap-watch.css |  |  |  |  |  |  |  | `transparent` | `var(--onyx-bad)` |
| `.onyx-watch-btn-primary` | gap-watch.css |  |  |  |  |  |  |  | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-watch-text-btn` | gap-watch.css | `var(--gw-control)` |  | `0 var(--space-1)` | `var(--text-sm)` |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyxos-button` | pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.polish-ghost` | polish.css | `var(--target-min)` |  | `var(--space-2) var(--space-4)` |  | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.polish-primary` | polish.css | `var(--target-min)` |  | `var(--space-2) var(--space-4)` |  | `650` | `6px` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.pref-action-card` | app.css, pol-shell.css | `44px` |  | `10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.pref-row-action` | app.css | `24px` |  | `var(--space-1) 10px` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.r-btn` | pol-stats.css, pol-public.css | `var(--target-min)` |  | `0 var(--space-5)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.rset-btn` | roomsettings.css, gap-chanserv.css, gap-people.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.rset-btn-primary` | roomsettings.css |  |  |  |  | `600` |  |  | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.shell-composer-action-label` | pol-shell.css, pol-thread.css |  |  |  | `var(--text-sm)` | `600` |  |  |  |  |
| `.shell-topic-action` | app.css, pol-thread.css |  |  | `2px 10px` | `0.75rem` |  | `999px` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.ts-pv-btn` | pol-studio.css | `20px` |  | `0 var(--space-2)` | `10px` | `650` | `4px` | `1px solid transparent` |  |  |

**button-like by declarations (per-instance class name)** — 89 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-link` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-3)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.bk-inspect` | gap-import.css | `28px` |  | `0` | `var(--text-2xs)` |  |  | `0` | `none` | `var(--onyx-dim)` |
| `.conn-cancel` | app.css | `48px` |  | `0 var(--space-5)` |  | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.conn-identities-dismiss` | app.css | `48px` |  | `0 var(--space-4)` |  | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.conn-identities-go` | app.css | `48px` |  | `0 var(--space-4)` | `var(--text-md)` | `700` | `var(--radius)` | `0` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.conn-identity-forget` | app.css | `var(--target-min)` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.conn-link` | app.css, gap-auth.css | `32px` |  | `0` | `var(--text-sm)` | `600` |  | `0` | `none` | `var(--onyx-dim)` |
| `.dl-copy` | pol-public.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.gap-collapsed-show` | gap-convo.css | `var(--target-floor)` |  | `2px var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.gap-keys-pref` | gap-commands.css | `var(--target-min)` |  | `var(--space-2) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.gorg-link` | gap-organize.css |  |  | `2px var(--space-1)` | `var(--text-sm)` | `600` | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.gorg-note-add` | gap-organize.css | `32px` |  | `0 var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px dashed var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.gorg-preset-option` | gap-organize.css | `var(--target-min)` |  | `var(--space-2) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.gorg-reader-exit` | gap-organize.css | `28px` |  | `0 var(--space-3)` | `var(--text-xs)` | `700` | `var(--r-pill)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.gorg-saved-open` | gap-organize.css | `var(--target-min)` |  | `var(--space-2) var(--space-3)` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-text)` |
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
| `.onyx-call-join` | app.css, pol-shell.css, rx-shell.css, calls-engine.css | `32px` |  | `0 10px` | `0.8125rem` | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-calls-join-video` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-calls-join-voice` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-calls-leave` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-bad)` |
| `.onyx-calls-mute` | pol-shell.css | `36px` |  | `var(--space-2) var(--space-4)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-calls-room` | app.css | `36px` |  | `6px 8px` |  |  | `6px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-coach-dismiss` | app.css, pol-shell.css, pol-thread.css |  | `32px` |  |  |  | `var(--radius)` | `0` | `none` | `var(--onyx-faint)` |
| `.onyx-cq-prompt-x` | calls-c4.css |  | `28px` |  |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-dmsafe-trigger` | app.css, pol-shell.css | `28px` |  | `var(--space-1) 10px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-home-room` | app.css | `44px` |  | `var(--space-2) 10px` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-jump-latest` | app.css, pol-thread.css |  |  | `var(--space-1) var(--space-3)` | `var(--text-2xs)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.onyx-keychange-accept` | app.css | `32px` |  | `6px var(--space-3)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-accent)` | `var(--onyx-accent)` | `var(--onyx-accent-ink)` |
| `.onyx-keychange-dismiss` | app.css | `32px` |  | `6px var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-keychange-retry` | app.css |  |  | `0` |  |  |  | `0` | `transparent` | `var(--onyx-text)` |
| `.onyx-member-message` | app.css, pol-roster.css | `24px` |  | `2px var(--space-2)` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-mlist-find` | pol-roster.css, rx-shell.css |  | `28px` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-reclaim-cancel` | app.css |  |  | `6px 14px` |  |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-reconnect-retry` | app.css |  |  | `2px var(--space-3)` | `var(--text-2xs)` | `600` | `999px` | `1px solid currentColor` | `transparent` | `inherit` |
| `.onyx-roster-care` | app.css, pol-roster.css, rx-shell.css |  |  | `2px 10px` | `0.75rem` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-roster-more` | gap-people.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-scheduled-cancel` | app.css |  |  | `4px 12px` | `0.8125rem` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-thread-indicator` | app.css, pol-thread.css |  |  | `2px 4px` | `0.75rem` |  |  | `none` | `none` | `var(--onyx-dim)` |
| `.onyx-watch-range` | gap-watch.css |  | `var(--gw-control)` |  |  |  |  |  | `transparent` |  |
| `.onyx-you-leave` | app.css, ui-sheets.css |  |  | `6px 14px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-you-link` | app.css, ui-sheets.css |  |  | `10px var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.pref-reset` | app.css, gap-account.css | `32px` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.room-media-index-filter` | pol-thread.css | `32px` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` | `600` | `4px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.room-media-index-jump` | pol-thread.css | `var(--target-floor)` |  | `2px var(--space-3)` | `var(--text-xs)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.room-media-index-retry` | pol-thread.css | `var(--target-floor)` |  | `2px var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.shell-msg-channel-link` | app.css |  |  | `0` |  |  |  | `0` | `none` | `var(--onyx-accent)` |
| `.shell-msg-media-consent` | pol-thread.css | `var(--target-floor)` |  | `var(--space-2) var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px dashed var(--pt-seam)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.shell-msg-preview-consent` | pol-thread.css |  | `72px` | `var(--space-1)` | `var(--text-2xs)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-dim)` |
| `.shell-ribbon-bell` | app.css, pol-shell.css, rx-shell.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.shell-topic-follow` | app.css, pol-thread.css |  |  | `2px 10px` | `0.75rem` |  | `999px` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.status-quiet-link` | pol-stats.css | `var(--target-min)` |  | `var(--space-2) var(--space-4)` |  | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.ts-token-revert` | pol-studio.css | `var(--target-floor)` |  | `0 var(--space-2)` | `var(--text-xs)` | `600` | `var(--radius)` | `1px solid color-mix(in oklab, var(--onyx` | `transparent` | `var(--onyx-warn)` |
| `.ts-token-swatch` | pol-studio.css |  | `32px` | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |

**icon button** — 12 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.cs-join-close` | gap-chanserv.css |  | `32px` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.gorg-icon-btn` | gap-organize.css |  | `32px` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-faint)` |
| `.jump-to-date-close` | app.css, ui-sheets.css |  |  | `var(--space-1) 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.onyx-cbtn` | app.css, calls-c11.css, calls-c6.css, calls-c4.css, calls-engine.css |  | `48px` |  | `0.6875rem` | `650` | `6px` | `1px solid transparent` | `transparent` | `var(--onyx-dim)` |
| `.onyx-cbtn-leave` | app.css, calls-engine.css |  |  |  |  |  |  |  | `var(--onyx-bad)` | `var(--onyx-bad-ink)` |
| `.onyx-dmsafe-close` | app.css | `28px` |  |  | `var(--text-lg)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-mlist-close` | pol-roster.css, rx-shell.css |  | `28px` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-moddesk-close` | app.css, ui-sheets.css | `32px` |  |  | `var(--text-lg)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-scheduled-close` | app.css |  |  |  | `1.125rem` |  |  | `none` | `transparent` | `var(--onyx-dim)` |
| `.onyx-watch-icon-btn` | gap-watch.css |  | `var(--gw-control)` | `0` |  |  | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-dim)` |
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
| `.onyx-sec-chip` | app.css, calls-engine.css |  | `28px` | `0 9px` | `0.75rem` | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-voice-chip` | app.css, pol-shell.css, calls-engine.css |  | `32px` | `0 10px` | `0.8125rem` | `650` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-voice-chip-status` | app.css, pol-shell.css, rx-shell.css, calls-engine.css |  |  |  |  | `500` |  |  |  | `var(--onyx-dim)` |
| `.topic-chip` | app.css, pol-thread.css | `var(--target-floor)` |  | `2px 10px` | `var(--text-sm)` |  | `999px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.ts-theme-chip` | pol-studio.css | `var(--target-min)` |  | `var(--space-1) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-dim)` |
| `.ts-theme-chip-del` | pol-studio.css |  | `28px` | `0` | `var(--text-lg)` |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-faint)` |

**pill** — 2 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.boost-pill` | app.css, pol-thread.css |  |  | `2px var(--space-2)` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.chb-pill` | app.css, ui-sheets.css |  |  | `0 6px` | `0.6875rem` |  | `6px` | `1px solid var(--onyx-accent)` |  | `var(--onyx-accent)` |

**input / textarea / field** — 28 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-input` | account2.css, ui-sheets.css | `var(--target-floor)` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.a2-textarea` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-2)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.ap-input` | gap-oper.css | `96px` |  | `var(--space-2) var(--space-3)` | `16px` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.bk-select-input` | gap-import.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.chb-field-desc` | app.css |  |  |  | `0.75rem` |  |  |  |  | `var(--onyx-dim)` |
| `.chb-field-error` | app.css |  |  |  | `0.75rem` |  |  |  |  | `var(--onyx-warn)` |
| `.conn-input` | app.css | `48px` |  | `0 14px` | `max(1rem, 16px)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.gorg-field-label` | gap-organize.css |  |  |  | `var(--text-xs)` | `600` |  |  |  | `var(--onyx-dim)` |
| `.gorg-input` | gap-organize.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.gorg-note-input` | gap-organize.css |  |  | `var(--space-2) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.gorg-textarea` | gap-organize.css |  |  | `var(--space-2) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.gs-join-field` | gap-shell.css | `32px` |  | `0 2px 0 var(--space-2)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.gs-join-input` | gap-shell.css |  | `30px` | `0` | `var(--text-sm)` |  |  | `0` | `transparent` | `var(--onyx-text)` |
| `.hi-dest-input` | gap-import.css | `36px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--gi-field)` | `var(--onyx-text)` |
| `.notify-input` | app.css |  |  | `6px 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-account-field` | app.css, gap-account.css |  |  | `4px 8px` | `0.8125rem` |  | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-account-field-label` | app.css |  |  |  | `0.75rem` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-land-sketch-input` | pol-public.css |  |  |  | `var(--text-md)` |  |  |  |  | `var(--onyx-faint)` |
| `.onyx-rail-filter-input` | app.css, pol-shell.css, rx-shell.css |  |  | `5px var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-roster-filter-input` | app.css, pol-roster.css, rx-shell.css | `32px` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-steward-field` | app.css |  |  | `6px 10px` | `0.8125rem` |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-watch-input` | gap-watch.css | `var(--target-min)` |  | `0 var(--space-3)` | `16px` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.pref-input` | gap-appearance.css | `36px` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.rset-input` | roomsettings.css, gap-chanserv.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.rset-textarea` | roomsettings.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.shell-topic-create-input` | app.css, pol-thread.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.ts-save-input` | pol-studio.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.um-input` | gap-usermodes.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |

**select** — 7 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-select` | account2.css | `var(--target-floor)` |  | `var(--space-1) var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.bk-select-label` | gap-import.css |  |  |  | `var(--text-xs)` | `650` |  |  |  | `var(--onyx-faint)` |
| `.conn-identity-select` | app.css | `56px` |  | `var(--space-2) var(--space-3)` |  |  |  | `0` | `transparent` | `var(--onyx-text)` |
| `.gorg-select` | gap-organize.css | `36px` |  | `0 var(--space-2)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.onyx-vs-select` | calls-c8.css, calls-engine.css | `40px` |  | `0 var(--space-2)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-watch-select` | gap-watch.css | `var(--gw-control)` |  | `0 var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |
| `.rset-select` | roomsettings.css, gap-chanserv.css | `36px` |  | `var(--space-1) var(--space-2)` | `var(--text-md)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` | `var(--onyx-text)` |

**badge / count / dot** — 49 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.a2-dot` | account2.css |  | `8px` |  |  |  | `50%` | `1px solid var(--onyx-dim)` | `transparent` |  |
| `.ap-tag` | pol-studio.css |  |  |  | `var(--text-md)` | `700` |  |  |  | `var(--onyx-text)` |
| `.chb-count` | app.css, ui-sheets.css |  |  |  | `0.75rem` |  |  |  |  | `var(--onyx-dim)` |
| `.cs-slow-dot` | gap-chanserv.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.gap-badge` | gap-account.css |  |  | `0 6px` | `var(--text-2xs, 11px)` | `600` | `999px` | `1px solid var(--onyx-line)` |  | `var(--onyx-dim)` |
| `.gorg-folder-count` | gap-organize.css |  | `18px` | `0 5px` | `0.6875rem` | `700` | `var(--r-pill)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.gorg-folder-row-count` | gap-organize.css |  |  |  |  | `400` |  |  |  | `var(--onyx-faint)` |
| `.gorg-note-count` | gap-organize.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-faint)` |
| `.gorg-preset-dot` | gap-organize.css |  | `16px` |  |  |  | `50%` | `2px solid var(--onyx-dim)` |  |  |
| `.gorg-tucked-count` | gap-organize.css |  |  |  | `var(--text-xs)` |  |  |  |  | `var(--onyx-faint)` |
| `.gs-activity-conn-dot` | gap-shell.css |  | `7px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.gs-door-dot` | gap-shell.css |  | `7px` |  |  |  | `50%` |  | `var(--onyx-warn)` |  |
| `.notify-count` | app.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.oc-tag` | gap-oper.css |  |  | `0 var(--space-2)` | `var(--oc-fs-meta)` |  | `999px` | `1px solid var(--onyx-line)` |  | `var(--onyx-dim)` |
| `.onyx-call-badge` | app.css, calls-engine.css |  | `24px` |  |  |  | `50%` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-call-pip` | app.css, calls-engine.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.onyx-call-pip-card` | calls-c11.css, calls-c6.css, calls-engine.css |  |  |  |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.onyx-call-pip-corner` | calls-c6.css, calls-engine.css |  | `var(--target-floor)` | `0` |  |  | `var(--radius)` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-call-pip-live` | calls-c6.css, calls-engine.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-call-pip-more` | calls-c6.css |  |  |  | `var(--text-2xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-calls-pip` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.onyx-dot` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.onyx-earlier-count` | pol-thread.css |  |  | `0 6px` | `var(--text-2xs)` |  | `var(--r-pill)` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-home-count` | app.css |  |  |  |  | `600` |  |  |  | `var(--onyx-text)` |
| `.onyx-home-unread` | app.css |  |  | `1px 6px` | `var(--text-2xs)` | `600` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-ident-badge` | pol-shell.css, rx-shell.css |  |  | `0 6px` | `var(--text-xs)` | `600` | `var(--r-pill)` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-member-dot` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-text)` |  |
| `.onyx-member-presence-dot` | app.css, pol-roster.css |  | `8px` |  |  |  | `50%` | `2px solid var(--onyx-panel)` | `var(--onyx-dim)` |  |
| `.onyx-mlist-group-count` | pol-roster.css |  |  |  |  | `600` |  |  |  | `var(--onyx-faint)` |
| `.onyx-nav-badge` | pol-shell.css, rx-shell.css |  | `16px` | `0 4px` | `0.625rem` | `700` | `var(--r-pill)` |  | `var(--onyx-text)` | `var(--onyx-bg)` |
| `.onyx-profile-badge` | app.css, pol-shell.css |  |  | `2px 8px` | `0.75rem` |  | `6px` |  | `var(--onyx-panel)` |  |
| `.onyx-rail-unread` | app.css, pol-shell.css |  |  | `1px 5px` | `var(--text-xs)` | `700` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-reconnect-dot` | app.css |  | `8px` |  |  |  | `50%` |  | `var(--onyx-warn)` |  |
| `.onyx-roster-count` | app.css, pol-roster.css |  |  |  | `var(--text-xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.onyx-thread-count` | pol-thread.css |  |  |  | `var(--text-xs)` | `650` |  |  |  | `var(--onyx-dim)` |
| `.onyx-tile-tag` | calls-c4.css, calls-engine.css |  | `24px` | `0 var(--space-2)` | `var(--text-2xs)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `color-mix(in srgb, var(--onyx-bg) 78%, t` | `var(--onyx-text)` |
| `.onyx-unread-divider-label` | pol-thread.css |  |  |  | `var(--text-xs)` | `700` |  |  |  |  |
| `.onyx-voice-count` | app.css |  |  |  | `0.75rem` | `600` |  |  |  | `var(--onyx-dim)` |
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
| `.um-tag` | gap-usermodes.css |  |  | `1px 6px` | `var(--text-2xs)` |  | `999px` | `1px solid var(--onyx-line)` |  | `var(--onyx-dim)` |

**card** — 21 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.ab-who-card` | pol-public.css |  |  | `var(--space-5)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.bk-card` | gap-import.css |  |  | `var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |
| `.chb-card` | app.css, pol-shell.css, ui-sheets.css |  |  | `8px 10px` |  |  | `8px` | `1px solid var(--onyx-line)` |  |  |
| `.data-card` | pol-stats.css, pol-public.css |  |  | `var(--space-6)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.dl-card` | pol-public.css |  |  | `var(--space-5)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.gap-drop-card` | gap-convo.css |  |  | `var(--space-7) var(--space-5)` |  |  | `var(--radius)` | `2px dashed var(--onyx-accent)` | `var(--onyx-panel)` |  |
| `.gc-card` | gap-claim.css |  |  | `var(--space-3) var(--space-4)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.guides-card` | pol-public.css |  |  | `var(--space-6)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.oc-card` | gap-oper.css |  |  | `var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.onyx-member-card` | app.css, pol-shell.css, ui-sheets.css |  |  | `12px` |  |  | `8px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.onyx-tile` | calls-c11.css, calls-c4.css, calls-engine.css |  |  |  |  |  | `var(--radius)` | `2px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.onyx-tile-nick` | calls-c4.css, calls-engine.css |  | `24px` | `0 var(--space-2)` | `var(--text-sm)` | `650` | `var(--radius)` | `1px solid var(--onyx-line)` | `color-mix(in srgb, var(--onyx-bg) 78%, t` | `var(--onyx-text)` |
| `.onyx-tile-video` | calls-c11.css, calls-c4.css |  | `100%` |  |  |  |  |  | `var(--onyx-bg)` |  |
| `.roadmap-card` | pol-stats.css |  |  | `var(--space-6) var(--space-4)` |  |  | `0` |  |  |  |
| `.shell-topic-card` | app.css, pol-thread.css |  |  |  |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.shell-topic-card-author` | app.css, pol-thread.css |  |  |  |  | `650` |  |  |  | `var(--onyx-text)` |
| `.shell-topic-card-follow` | app.css, pol-thread.css |  |  | `2px 10px` | `0.75rem` |  | `999px` | `1px solid var(--onyx-line)` | `none` | `var(--onyx-dim)` |
| `.shell-topic-card-main` | app.css, pol-thread.css |  |  | `8px 10px` |  |  |  | `none` | `none` | `inherit` |
| `.shell-topic-card-meta` | app.css, pol-thread.css |  |  |  | `var(--text-sm)` |  |  |  |  | `var(--onyx-dim)` |
| `.shell-topic-card-preview` | app.css, pol-thread.css |  |  |  | `var(--text-sm)` |  |  |  |  | `var(--onyx-dim)` |
| `.shell-topic-card-title` | app.css, pol-thread.css |  |  |  | `var(--text-md)` | `700` |  |  |  |  |

**tabs** — 5 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.cs-tab` | gap-chanserv.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `4px` | `1px solid transparent` | `transparent` | `var(--onyx-dim)` |
| `.cs-tabs` | gap-chanserv.css |  |  | `2px` |  |  | `var(--radius)` |  | `var(--onyx-panel-2)` |  |
| `.oc-tabs` | gap-oper.css |  |  | `var(--space-2) calc(var(--sheet-pad, 20p` |  |  |  |  | `var(--onyx-panel)` |  |
| `.onyx-land-tabs` | pol-public.css |  |  | `3px` |  |  | `calc(var(--radius) + 3px)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.pref-category-tab` | app.css, ui-sheets.css | `44px` |  | `6px 10px` |  |  | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-text)` |

**segmented control** — 11 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.ap-choice-toggle` | pol-studio.css | `52px` |  | `var(--space-3) var(--space-4)` | `var(--text-md)` | `600` | `0` | `0` | `transparent` | `var(--onyx-text)` |
| `.ap-choice-toggles` | pol-studio.css |  |  |  |  |  | `10px` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.conn-strength-seg` | app.css |  | `4px` |  |  |  | `2px` |  | `var(--onyx-line)` |  |
| `.gorg-choice` | gap-organize.css | `var(--target-min)` |  | `0 var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-text)` |
| `.gorg-choice-meta` | gap-organize.css |  |  |  | `var(--text-xs)` |  |  |  |  | `var(--onyx-faint)` |
| `.gs-seg` | gap-shell.css |  |  | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.gs-seg-count` | gap-shell.css |  |  |  | `var(--text-2xs)` | `400` |  |  |  | `var(--onyx-faint)` |
| `.hi-seg` | gap-import.css | `40px` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-react-choice` | app.css, pol-thread.css |  |  | `4px` | `1.125rem` |  | `6px` | `none` | `transparent` |  |
| `.pref-segment` | app.css | `32px` |  | `var(--space-1) var(--space-3)` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.room-notify-seg` | app.css, pol-shell.css, rx-shell.css, ui-sheets.css |  |  | `2px 10px` | `var(--text-2xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |

**switch / toggle** — 27 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.conn-switch` | app.css |  | `26px` |  |  |  | `13px` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.conn-toggle-description` | app.css |  |  |  | `var(--text-sm)` |  |  |  |  | `var(--onyx-dim)` |
| `.conn-toggle-label` | app.css |  |  |  | `var(--text-md)` | `650` |  |  |  |  |
| `.gap-keys-pref-switch` | gap-commands.css |  | `20px` |  |  |  | `999px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.gorg-switch` | gap-organize.css | `0` | `24px` | `0` |  |  | `var(--r-pill)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` |  |
| `.gorg-switch-knob` | gap-organize.css |  | `16px` |  |  |  | `50%` |  | `var(--onyx-dim)` |  |
| `.guides-step-toggle` | pol-public.css | `32px` |  | `0 var(--space-3)` | `var(--text-sm)` | `600` | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.notify-toggle` | app.css, ui-sheets.css |  |  | `var(--space-1) var(--space-3)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-account-push-toggle` | pol-shell.css | `28px` |  | `4px 12px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-audience-toggle` | app.css, pol-thread.css |  |  | `2px 8px` | `0.6875rem` | `600` | `6px` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-edited-toggle` | pol-thread.css |  |  | `2px 3px` | `var(--text-xs)` |  | `3px` |  |  | `var(--onyx-dim)` |
| `.onyx-media-toggle-open` | pol-shell.css |  |  |  |  | `650` |  |  | `var(--onyx-panel-2)` |  |
| `.onyx-moddesk-toggle` | app.css, pol-shell.css, rx-shell.css | `24px` |  | `var(--space-1) 10px` | `var(--text-sm)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-notify-toggle` | app.css |  |  | `var(--space-1) 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-text)` |
| `.onyx-notify-toggle-open` | app.css |  |  |  |  |  |  |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-pins-toggle-open` | pol-shell.css |  |  |  |  | `650` |  |  | `var(--onyx-panel-2)` |  |
| `.onyx-room-topic-toggle` | pol-shell.css, roomsettings.css, rx-shell.css | `var(--target-floor)` |  | `0 var(--space-2)` | `var(--text-xs)` |  | `var(--radius)` | `1px solid var(--onyx-line)` | `transparent` | `var(--onyx-dim)` |
| `.onyx-search-toggle-open` | app.css, pol-shell.css |  |  |  |  |  |  |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-topic-tools-toggle` | pol-thread.css | `28px` |  | `0 var(--space-2) 0 var(--space-1)` | `var(--text-sm)` | `600` | `var(--radius)` |  |  | `var(--onyx-dim)` |
| `.pref-switch` | app.css, gap-account.css, gap-usermodes.css, ui-sheets.css |  | `20px` |  |  |  | `999px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.pref-toggle` | app.css, gap-account.css | `44px` |  | `var(--space-2) 10px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.pref-toggle-title` | app.css |  |  |  | `var(--text-sm)` | `600` |  |  |  |  |
| `.rset-toggle` | roomsettings.css, ui-sheets.css | `40px` |  | `var(--space-2)` |  |  | `var(--radius)` | `1px solid transparent` | `transparent` | `var(--onyx-text)` |
| `.rset-toggle-label` | roomsettings.css |  |  |  | `var(--text-md)` | `600` |  |  |  |  |
| `.rset-toggle-thumb` | roomsettings.css, ui-sheets.css |  | `12px` |  |  |  | `50%` |  | `var(--onyx-faint)` |  |
| `.rset-toggle-track` | roomsettings.css, ui-sheets.css |  | `18px` |  |  |  | `999px` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.ts-scheme-toggle` | pol-studio.css |  |  | `2px` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |

**toast / banner / notice** — 5 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.gp-notice` | gap-people.css |  |  |  | `var(--text-xs)` |  |  |  |  | `var(--onyx-dim)` |
| `.gp-notices` | gap-people.css |  |  | `var(--space-2)` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-bg)` |  |
| `.onyx-join-banner` | app.css, calls-engine.css |  |  | `var(--space-2) var(--space-2) var(--spac` |  |  | `6px` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` |  |
| `.onyx-join-banner-hide` | app.css, calls-engine.css |  | `32px` |  |  |  | `6px` | `0` | `transparent` | `var(--onyx-dim)` |
| `.onyx-toast` | app.css, ui-sheets.css | `48px` |  | `var(--space-2) var(--space-2) var(--spac` |  |  | `var(--radius)` | `1px solid var(--onyx-line)` | `var(--onyx-panel)` | `var(--onyx-text)` |

**avatar / facepile** — 15 parallel implementations

| class | files | min-height | height | padding | font-size | font-weight | border-radius | border | background | color |
|---|---|---|---|---|---|---|---|---|---|---|
| `.conn-identity-avatar` | app.css |  | `32px` |  | `var(--text-sm)` | `750` | `50%` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.gap-skeleton-avatar` | gap-convo.css |  | `2rem` |  |  |  | `50%` |  | `var(--onyx-panel-2)` |  |
| `.onyx-avatar` | app.css, gap-appearance.css, pol-shell.css, pol-thread.css, pol-roster.css, rx-shell.css |  |  |  |  | `800` | `50%` |  | `var(--onyx-avatar-bg)` | `var(--onyx-avatar-fg)` |
| `.onyx-call-avatar` | app.css, calls-c6.css, calls-engine.css |  |  |  |  | `700` | `50%` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-call-avatar-lg` | app.css, calls-c4.css, calls-engine.css |  | `64px` |  | `1.375rem` |  |  |  |  |  |
| `.onyx-call-avatar-md` | app.css |  | `40px` |  | `0.9375rem` |  |  |  |  |  |
| `.onyx-call-avatar-sm` | app.css |  | `24px` |  | `0.6875rem` |  |  |  |  |  |
| `.onyx-face` | pol-shell.css |  | `28px` |  | `0.625rem` | `700` | `50%` | `1px solid var(--onyx-line)` | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-facepile-face` | app.css, rx-shell.css |  |  | `0` |  |  | `50%` | `none` | `none` |  |
| `.onyx-facepile-overflow` | app.css |  | `2rem` | `0 8px` | `0.72rem` | `600` | `999px` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-home-avatar` | app.css |  | `28px` |  | `var(--text-sm)` | `600` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-land-sketch-avatar` | pol-public.css |  | `36px` |  | `var(--text-sm)` | `750` | `50%` |  | `var(--onyx-panel-2)` | `var(--onyx-text)` |
| `.onyx-rail-avatar` | app.css, pol-shell.css, account2.css, rx-shell.css |  | `24px` |  | `var(--text-2xs)` | `700` | `var(--radius)` |  | `var(--onyx-panel-2)` | `var(--onyx-dim)` |
| `.onyx-room-intro-face` | pol-thread.css |  | `4rem` |  |  |  | `50%` | `0` | `transparent` | `var(--onyx-text)` |
| `.onyx-you-avatar` | pol-shell.css |  | `52px` |  | `1rem` |  |  |  |  | `var(--onyx-text)` |
<!-- END GENERATED STYLE INVENTORY -->
