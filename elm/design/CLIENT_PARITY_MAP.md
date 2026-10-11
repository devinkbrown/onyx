# Client parity map — SolidJS (deprecated) → Elm (the product)

Branch `v3/map-oracle` at `7e03d47f` (2026-10-10). Read-only cartography: no code changed.

**Question answered:** for every user-facing capability the deprecated SolidJS client
(`src/`) offered, does the Elm client (`elm/`) have it, and how completely? The two
status docs, `elm/COVERAGE.md` and `elm/V3_ROADMAP.md`, are cross-checked rather than
trusted; where they are stale or overstate, the row says so.

## How this map was built

- **Solid inventory.** Every action in `src/lib/store/store.ts` (both action blocks,
  6392–10432 and 15569–18340), every arm of the inbound `_handleMessage` switch
  (10432–15569), every slash verb, palette row and keyboard chord, and every component
  under `src/shell/**`, `src/app/**`, `src/routes/**`, `src/chat/**`, `src/pwa/**`,
  `src/theme/**`, `src/backgrounds/**` plus the feature modules in `src/lib/**`.
- **Reachability.** A Solid capability counts only if a user can reach it. Each row is
  tagged `UI`, `slash`, `palette`, `shortcut`, `auto` (runs without user action) or
  `DEAD` (store/lib code with no non-test caller). A lot of `store.ts` is DEAD legacy
  (streams, raids, polls, spatial pad, breakout sidebar, focus mode…); those rows are
  `N/A` and are not gaps.
- **Elm lookup.** For each capability: the `Msg` and its fold in `elm/src/App.elm`, the
  `View` that dispatches it, and any port in `elm/src/Main.elm` / `elm/ports.js`.
  Evidence is `file:line` from grep at `7e03d47f`; Elm paths are relative to `elm/src/`.
- **Server cross-check** where it decides the answer (for example, which raw slash verbs
  the Onyx Server actually implements): `/home/kain/onyx-server/src/daemon`.

### Status vocabulary

| Status | Meaning |
|---|---|
| **FULL** | Reachable in Elm and behaviourally equivalent to Solid, or better. |
| **PARTIAL** | Reachable, but something specific is missing; the note names it. |
| **CORE-ONLY** | Elm has the fold, state or port, but no UI, slash verb or shortcut reaches it. |
| **MISSING** | Nothing in Elm. |
| **N/A** | Solid's version was DEAD code, or the feature is absent by design (no OPER/491, STARTTLS, WEBIRC, DCC, pseudo-clients, `+w`, `ocean/*` caps). |

"⚠ shared" marks a defect both clients have. Those rows count as parity, but they are
still product bugs, and fixing them is the cheapest way for Elm to beat Solid.

## Summary

| Section | Rows | FULL | PARTIAL | CORE-ONLY | MISSING | N/A |
|---|---:|---:|---:|---:|---:|---:|
| [D Shell, navigation, Home, banners, PWA](#d--shell-navigation-home-banners-notification-center-pwa) | 186 | 94 | 38 | 4 | 38 | 12 |
| [E Conversation](#e--conversation--transcript-message-rendering-menus-composer-search-media-threads-topics) | 178 | 114 | 26 | 5 | 26 | 7 |
| [K Command surfaces](#k--command-surfaces--slash-verbs-command-palette-keyboard-shortcuts-gestures) | 107 | 88 | 6 | 0 | 12 | 1 |
| [F Sheets & settings](#f--sheets--settings-preferences-appearance-themes-backgrounds-notification-settings-room-settings) | 125 | 44 | 32 | 10 | 37 | 2 |
| [J Public website](#j--public-website-routes-pages-route-a11y-static-metadata) | 120 | 80 | 20 | 1 | 9 | 10 |
| [H Calls](#h--calls--voice-video-screen-share-stage-watch-together) | 112 | 64 | 15 | 3 | 22 | 8 |
| [I Moderation, operators, people](#i--moderation-operators-people-stewardship) | 99 | 72 | 9 | 1 | 6 | 11 |
| [G Connect, account, security](#g--connect-account-security-identity-e2ee-ux) | 98 | 67 | 11 | 1 | 13 | 6 |
| [V Data & vault](#v--data--vault--history-vault-outbox-saved-searches-importexport-notification--pwa-runtime) | 97 | 34 | 20 | 2 | 38 | 3 |
| [A Store actions I](#a--store-actions-i--connection-messaging-accounts-channels-panels) | 182 | 128 | 12 | 2 | 9 | 31 |
| [B Store actions II](#b--store-actions-ii--stage-away-oper-scheduling-prefs-folders-identity-e2ee-keys-calls-legacy) | 149 | 49 | 12 | 1 | 10 | 77 |
| [C Inbound protocol](#c--inbound-protocol--every-server-line-the-solid-client-handles) | 143 | 101 | 27 | 1 | 6 | 8 |
| **All rows** | **1596** | **908** | **223** | **31** | **258** | **176** |

**How to read the totals.**
- Sections A–C walk the Solid store and protocol layer. D–K and V walk what users see. The two views overlap: one capability can appear as a store action in A/B and as a control in D–K, so 1596 is a row count, not a count of distinct features.
- Leaving out N/A, 1420 rows describe something a Solid user could actually reach. Of those, 64% are FULL, 16% PARTIAL, 2% CORE-ONLY and 18% MISSING.
- The protocol and store layers are close to parity (A and C are about 80% FULL). The gaps sit in what users see: settings (F, 35% FULL), data/vault (V, 36%) and command surfaces (K, 58%).
- N/A is large in B because most of that half of `store.ts` is dead legacy code (streams, raids, polls, spatial pad, breakout sidebar, focus mode, forum posts, announcements).
- [Section N](#n--every-narrowing-recorded-in-elmcoveragemd-classified) classifies all 146 narrowings recorded in `elm/COVERAGE.md`: FIX 72 · STALE 45 · KEEP 17 · ORACLE-GAP 3 · BOUND 9.

### Headline findings

1. **What users see is behind; the core is close to parity.** `COVERAGE.md` measures parity at the protocol level ("fold + vectors"), and at that level it is mostly right. It never measures whether a user can reach the feature. That gap is what this map adds: 31 CORE-ONLY rows, and many PARTIAL ones, are features whose fold exists but whose control does not.
2. **Some settings do nothing, or do the wrong thing, today.**
   - Theme looks don't recolor the app shell (`app.css:5–14` hard-codes the `--onyx-*` palette).
   - Text size and Density write `data-*` attributes that no Elm CSS reads.
   - Opting out of local history is ignored.
   - The encrypted-DM toggle needs a reload.
   - Backgrounds persist but never render.
   - Moderation controls are gated on an "Experience level" users cannot set.
3. **Privacy and isolation regressions against Solid.**
   - Photos upload with EXIF/GPS intact.
   - The vault, blocklists, keywords and per-room notify settings are device-global, not per account.
   - Elm writes the `onyx:credentials` store in a different schema and wipes a migrating user's saved Solid identities.
   - Staged attachments follow you into the next room.
4. **Protocol behaviour that is wrong on the live server.**
   - Server-native edits (`PRIVMSG +draft/edit=…`, the only shape onyx-server sends) are not recognised, so every edit shows as a duplicate message.
   - Pre-registration 433 has no `nick_` retry, so a taken name hangs on "Connecting".
   - A wrong password reads "Couldn't reach Onyx".
   - Labeled DMs to an offline nick vanish on 401.
   - Elm never renders its server log, so ERROR reasons, MOTD, WALLOPS, KNOCK and every unhandled numeric are invisible.
5. **Shared defects (⚠).** Both clients send unhandled registry slash verbs raw. On onyx-server that makes these return 421: `/me`, `/msg`, `/query`, `/j`, `/op`, `/deop`, `/voice`, `/devoice`, `/ban`, `/unban`, `/back`, `/unaway`, `/quote`, `/raw`, `/ctcp`, `/stage`. Both clients also swallow inbound CTCP ACTION. Fixing these makes Elm better than Solid, not just equal.
6. **Things that run only on the old Solid deployment.**
   - The Elm build registers no service worker, so Web Push hangs on `serviceWorker.ready` and update detection is inert.
   - On the public site, direct visits to `/download/` never load the catalog, and the skip link and every in-page anchor do nothing.
7. **The live video-off switch leaks** (`fbe04585`). "Join with video" bypasses `VIDEO_ENABLED`, and the Camera button still shows. This is the one gap that can hurt other people in a call.
8. **Solid was weaker than its code suggests.**
   - Its `<Toaster>` was never mounted, so none of its ~48 toasts ever showed.
   - Mini PiP, `startDmCall`, friends and watch list, custom status, `reclaimNick`, `tempBan` and the Add-a-boost opener had no reachable UI.
   - Several Home briefing props were computed but never rendered.
   Elm has working versions of all of these. They count as Elm-better rows, not parity.

## Top 30 gaps (user impact first)

Each gap lists the rows that hold its evidence and the shape of the fix. "⚠ shared" means
Solid had the same defect.

| # | Gap | Surface | Rows | Sketch |
|---|---|---|---|---|
| 1 | **Video-off switch leaks.** `cameraSupported` never reaches Elm, so Camera still shows. "Join with video" calls `engine.joinVideo`, which bypasses `VIDEO_ENABLED`, so it can publish the ~2 Mbit/s camera that `fbe04585` blocked to protect the node's SendQ. | Calls | H gap 1, B128 | back-fill `cameraSupported` in `ports.js`; force `video=false` in `voice-engine.ts joinVoice`; gate `View/Calls.elm:254` |
| 2 | **Every edit shows as a duplicate message.** onyx-server sends edits only as `PRIVMSG +draft/edit=<msgid>` (`server.zig:42417`). Elm has no `draft/edit` handling and folds only an `EDIT` command the server never sends. | Conversation | C57 | in `foldChat` detect the tag and route to `foldEdit` (live + history merge) |
| 3 | **Photos upload with EXIF/GPS intact.** `Upload.stripJpegExif`/`stripPngExif` exist, but `ports.js` posts the raw File. Solid stripped. | Conversation | E gap 1 | strip in the `uploadSend` bridge; Original/Compact picker |
| 4 | **Registry slash verbs are broken** (⚠ shared). `/me /msg /query /j /op /deop /voice /devoice /ban /unban /back /unaway /quote /raw /ctcp /stage` → 421. `/kick /topic /invite nick /part` lack a channel; `/away` keeps one word. Inbound CTCP ACTION is swallowed. `/share` and bare `/invite` are missing in Elm, though `/help` lists `/share`. | Commands | K1–K19, K29, K34, K35, B12/B13, C55 | translation table beside `parseSlashLocal`; ACTION row type; `/share` via `InviteShare` + `ClipboardCopy` |
| 5 | **No service worker is ever registered.** Web Push hangs on `serviceWorker.ready`, there is no update detection and no offline shell. Push is also never reconciled after a reload. | Data / public | V76/V77/V80, J9, D168/D169, N141 | register `/sw.js` in `ports.js`; time-limit `swReady()`; drop the `webPushOn` gate on the boot check |
| 6 | **Sign-in failures mislead or hang.** A wrong password reads "Couldn't reach Onyx" and keeps reconnecting. A taken nick hangs registration (no `nick_` retry). A registered-nick guest join gets "Erroneous nickname". | Account | C122–C124 | `failSasl` notification + `autoReconnect = False`; ×4 underscore retry while `Registering`; registered copy |
| 7 | **Themes don't recolor the app shell.** It is painted from a fixed `--onyx-*` palette (`app.css:5–14`), so light looks stay dark. | Settings | F gap 1 | derive `--onyx-*` from the theme tokens |
| 8 | **Text size and Density do nothing.** No Elm CSS reads `data-font-scale`/`data-density`. | Settings | F gap 2 | port the scale/density rules |
| 9 | **The local-history opt-out is ignored**, and there is no clear-history control. | Settings / data | F gap 3, V26/V27 | gate `flushVaultBuffer` on `prefs.localHistory`; `VaultClear` port |
| 10 | **Per-account isolation is missing.** The vault, blocklists, keywords and per-room notify are device-global; Solid scoped them by owner. | Data / security | V4, I gap 2, F | owner key on vault rows and every journal key |
| 11 | **Saved identities are wiped, and there is no "Welcome back" / "Stay signed in".** Elm writes `onyx:credentials` as `{v:1,slots}` over Solid's `{version:2,…}`; `Credentials.elm` is test-only. | Account | G34, G15–G19 | read/merge v2; list/select/forget ports + Connect block |
| 12 | **Staged attachments follow you to another room** and send there. | Conversation | E gap 3 | clear or key `attachments` per target on `selectChannel` |
| 13 | **Jumps never scroll into view** (pins, media index, vault hits, `?at=`, search, jump-to-date). `historyLanding` has no consumer. | Conversation | E gap 2, A14/A15/A20/A129 | feed `threadAnchorIndex`; scroller "message" action |
| 14 | **No Activity / server-log view.** ERROR reasons (kills, bans), MOTD, WALLOPS, server NOTICEs, KNOCK 710–714, 477/480 and unhandled numerics are all invisible. | Shell | C113/C112/C86/C127, A175, D18/D33 | Rail "Activity" entry rendering `serviceLog`; ERROR → notification |
| 15 | **Encrypted-DM toggle only takes effect after a reload.** | Settings / security | F gap 4 | set `model.e2eeDms` in the pref fold; publish/withdraw the key |
| 16 | **Quiet hours are missing.** Solid silenced 22:00–08:00 by default; Elm alerts overnight. | Settings | B51, F gap 5 | `dndQuietStart/End` in `notifyDndActive` |
| 17 | **Delivery and connection feedback gaps.** Labeled DMs to an offline nick vanish on 401. There is no browser offline/online or page-restore handling. `/join` and accepted invites don't open the room. FAIL SESSION has no inbox row. | Shell / conversation | C92, C131, A1, G30, C36, C7 | `notDeliveredToast` in `fold401`; `online`/`offline`/`pageshow` ports; `selectChannel` on self-JOIN |
| 18 | **Download page is dead on a direct visit.** Skip link, every in-page `#anchor`, and in-app `/app/?join=…` links are broken. No scroll reset or route announcement either. | Public | J55, J22/J16, J19/J91/J95, J15/J17 | route-entry fold in `Main.init`; fragment port; reparse deep links in `UrlChanged` |
| 19 | **Drafts are lost on reload** (Solid persisted per owner with a "Saved here" status). | Conversation | E gap 4, A112/A113 | `composerDraftsSave` port |
| 20 | **Hide room, close/reopen conversation, DM mute and Leave-with-confirm have no UI.** Every DM ever opened stays listed. | Shell | B58–B60, D39/D44/D117/D118/D126, A22 | owner-keyed sets + room-header More items + confirm sheet |
| 21 | **Moderation controls are hidden behind an "Experience level" users cannot set.** | Moderation | I gap 1 | segmented control, or gate on `isChannelOp` |
| 22 | **DM key-change handling** (security). Accept re-pins the whole device set; a change is detected only on seal/open; the alert goes only to the service log. A media peer key change is also unannounced. | Security | N104/N105, G89, B119, C117, H gap 5 | pin the single key; diff on the 761 fold; toast + inbox row |
| 23 | **No paste or drag-and-drop attachments.** | Conversation | E gap 5 | `ports.js` paste/drop → `uploadPicked` |
| 24 | **Calls fail silently.** No media-error, decode, "Removed from voice" or codec toasts; no "joining…" state during permission/enrolment. | Calls | H gaps 3–4 | `emitLocal({mediaError})` → `CallDock` toasts; provisional state |
| 25 | **No app badge or "(n)" title, and clicking a desktop alert only focuses the window.** | Shell / data | D174/D175, V68/V69/V73, A116 | `attentionSet` port; `notifyClicked` → `ChannelSelect` |
| 26 | **Watch Together is missing**, though the About page advertises it. | Calls | H102–H111 | `WatchTogether` over `PROP ocean.watch` |
| 27 | **Home catch-up is shallow.** No "Since you left" digest, resume points, recently visited rooms or offline memory; queued rows lack Open/Remove. | Shell / data | D141–D155, V82/V83, V39/V40 | port `catchup/*` + `sinceDigest` |
| 28 | **The palette is about a quarter of Solid's; 17 of 21 shortcuts and J/K and `g` sequences are missing.** | Commands | K46–K102 | People/recents/Preferences/Copy link rows; nav chords |
| 29 | **Room folders, calm presets and smart mute are missing.** | Settings | B80–B85, F | `Sidebar` folders; `NotifyCenter` tiers |
| 30 | **Small data-loss / privacy bugs in the composer.** Ctrl/Cmd+F wipes the visible draft (`App.elm:39566`). Quoting an E2EE row inserts ciphertext (`View/Thread.elm:1653`). Collapsed senders can't be shown again. | Conversation | E gaps 6–8, A182 | drop `composer = ""`; `loadedActionText`; Show-all banner |

Just outside the 30:
- no third-party history importers, and portable export/import is vault-rows only (V53–V57)
- no background renderer (F)
- BlockKit-lite missing (E)
- Protection toggles and Recover a name (G68/G78, A79/A80)
- `?signin=1` ignored (G10)
- webhooks limited to owners of rooms with 3–30 members (I)
- member list not windowed (I)
- room ownership transfer cannot complete (⚠ shared, I)
- peer accounts from extended-join ignored, so the Guest badge is wrong (I)
- context rail (D12)

## Prioritised gap list, by surface

Order is user impact first: things that are broken or that every user hits, then things a
group of users relies on, then polish. Each line points at the section row(s) with the
evidence and gives a one-line implementation sketch. "⚠ shared" means Solid had the same
defect; fixing it makes Elm better than Solid rather than equal to it.

### Shell and navigation

1. **[High] No Activity / server-log view** (C113/C112/C86, A175, D18/D33). `serviceLog` is kept but never rendered, so ERROR reasons (kill/ban/shutdown, C127), MOTD, WALLOPS, server NOTICEs, KNOCK 710–714, 477/480 (the browser then waits 8 s, C101) and every unhandled numeric are invisible. Fix: add a Rail "Activity — Network updates" entry rendering `serviceLog`, and make ERROR a notification.
2. **[High] Hide room and close/reopen conversation are missing** (D39/D44/D117/D127, B59/B60). Every DM ever opened stays listed. Add owner-keyed `hiddenRooms`/`closedConversations` sets, filter them in `Sidebar.sections`, add items to the room-header More menu, and auto-reopen on inbound traffic.
3. **[High] No Leave-room action with a confirm step in the room header** (D118). Only `/part` exists. Add `RoomLeaveAsk`/`RoomLeaveConfirm` with a `View.Sheet` confirm.
4. **[High] No app badge and no "(n)" attention title** (D174/D175, V68/V69, B112). Add an `attentionSet` port fed by `unreadAttentionCount`.
5. **[High] Home catch-up is shallow** (D141–D143/D152, roadmap 1.4a/2.7). Missing: resume points, invites tier, recently visited rooms, offline vault-backed catch-up, and the "Since you left" digest (D155).
6. **[Med] Connection lifecycle.**
   - There is no browser `offline`/`online` handling (C131) and no `pageshow`/`resume` reconnect (A1/G30).
   - `/join` and accepted invites don't switch to the room (C36).
   - Fix: add lifecycle ports, and call `selectChannel` on the self-JOIN outside replay.
7. **[Med] DM mute, Mark as read, Export transcript and Room ledger are missing from the room More menu** (D115/D119/D123/D126). They reuse the existing folds `MuteDm`, `/read`, `/export` and `statsRoomHref`.
8. **[Med] Room folders missing** (D36/D37, roadmap 4.2).
9. **[Med] Web Push arming is not reachable from the first-run "Turn on" or the Notifications sheet toggle** (D87/D177). Route both through `WebPushToggle`, and register the service worker first.
10. **[Med] No join-by-name field in the rail** (D45). There is no Solid-style context rail or desktop People toggle (D12/D14).
11. **[Med] The formation "hang label" toggle is inert** (D163). No port feeds `CreateHangLabelInput`.
12. **[Low]** In-app route announcer and skip link (D179/D180). Roving arrow keys in the sidebar and More menu (D46/D129). Inbox summary region, ledger links and follow-topic jump (D73–D83). Header copy-name button, DND indicator and AI-policy badge (D93/D124/D109). Formation friend chips and native share. PWA readiness panel.

### Conversation

1. **[High] Every edit shows as a duplicate message** (C57). onyx-server sends edits only as `PRIVMSG +draft/edit=<msgid>` (`onyx-server/src/daemon/server.zig:42417`). Elm has zero `draft/edit` handling, so the edit is delivered as a new row. Fix: detect the tag in `foldChat` (`App.elm:34673`) and in the history merge, and route to `foldEdit`.
2. **[High] Labeled DMs to an offline nick vanish on 401 with no "not delivered" toast** (C92). Fix: call `notDeliveredToast` in the `fold401` label branch.
3. **[High] Photos upload with EXIF/GPS intact** (E, privacy). Solid strips EXIF before upload, and Elm has the pure strip code (`Upload.stripJpegExif`/`stripPngExif`). But `ports.js uploadSend` posts the original File; there is no `exif` anywhere in `ports.js`. Strip in the bridge before the POST, and add the Original/Compact picker.
4. **[High] Jump targets never scroll into view.** This covers pins, the media index, vault hits, `?at=` and search hits. `historyLanding` is not fed into `threadAnchorIndex`, and the scroller has no "message" landing action.
5. **[High] Staged attachments follow you to another room.** `attachments` is not cleared or keyed by target on `selectChannel`/`swapComposerDraft` (`App.elm:7758`).
6. **[High] Drafts are lost on reload.** Per-target drafts live only in memory; Solid persisted them per owner (`onyx:composer-drafts`) with a "Saved here" status.
7. **[High] No paste or drag-and-drop attachments.** Only the picker exists.
8. **[Med] Ctrl/Cmd+F wipes the visible draft.** `SearchHotkey` sets `composer = ""` (`App.elm:39566`).
9. **[Med] Hidden (collapsed) senders cannot be shown again.** The "Hiding messages from … Show all" banner is missing.
10. **[Med] Quote inserts ciphertext for E2EE rows** (`View/Thread.elm:1653` should use `loadedActionText`).
11. **[Med] Focus does not move to the composer** on reply, edit or quote. The message menu and reaction picker have no arrow-key roving.
12. **[Med] BlockKit-lite structured messages missing** (roadmap 2.8). Swipe-to-reply is missing, and long-press is unreliable on iOS.
13. **[Med] Search panel lacks focus-on-open/restore and the "no matches", history-off and ledger blocks.**
14. **[Low]** Caret-aware insertion. The full `:shortcode:` map (274 entries) for inline rendering. Edit-history disclosure (roadmap 2.9; `revisionsFor` exists, no UI). Reader-memory strip. History-loading skeleton. Topic-chip unread from the ledger. Reaction-density and topic-tools controls. Link previews for vault-restored rows.

### Sheets and settings

1. **[High] Themes don't recolor the app shell** (F, gap 1). The shell paints from a fixed `--onyx-*` palette (`app.css:5–14`; ~926 uses vs 13 theme-token uses). Light looks leave the shell dark. Derive `--onyx-*` from the theme tokens.
2. **[High] Text size and Density do nothing** (F, gap 2). `data-font-scale`/`data-density` are written to `<html>` but no Elm CSS reads them.
3. **[High] The encrypted-DM toggle only takes effect after a reload** (F, gap 4). It writes `prefs.e2eeDms`, but every gate reads `model.e2eeDms`, which is set once at boot.
4. **[High] Quiet hours missing** (B51, F). Solid silenced 22:00–08:00 by default, so Elm now alerts overnight. Extend `notifyDndActive` with `dndQuietStart/End`.
5. **[High] Hide room, close/reopen conversation, and DM mute have no UI** (B58–B60). `MuteDm`/`UnmuteDm` are CORE-ONLY. Add to the room-header More menu and the sidebar filter.
6. **[Med] Calm / Regular / Power notification presets and smart-mute rules are missing.**
7. **[Med] Room folders are missing** (B80–B85, roadmap 4.2).
8. **[Med] No background renderer at all** (F). The picker, preview and Background-motion settings persist choices that never render.
9. **[Med] Eight preferences can't be changed:** width, reader mode, experience level, voice/video entry, topic tools, reaction density, blocked hosts, watch-together. Their CSS (width/reader) is not ported either.
10. **[Med] Room settings sheet lacks** hide, leave-confirm, close-DM, transcript export and topic-draft durability. Keyword and per-room notify storage is not per-account.
11. **[Low]** "App & tools" tab (PWA readiness, refresh shell, storage persist/estimate, extensions); high contrast does not follow `prefers-contrast: more`; AI-policy badge; native share; app badge / "(n)" title.

### Public site

1. **[High] Download catalog never loads on a direct visit** (J55; Status/Stats also wait for the first Tick, J52/J63). Run the `UrlChanged` route-entry fold from `Main.init` when `Route.fromUrl` matches.
2. **[High] Skip link and every in-page `#anchor` are inert** (J22/J16; WCAG 2.4.1). In `LinkClicked`, handle fragment-only changes with a `scrollToFragment` port (scroll, focus, `replaceUrl`).
3. **[High] In-app links into `/app/?join=&at=&topic=&as=&signin=` lose their params** (J19/J20/J91/J95). Reparse with `parseDeepLinkQuery` in the `UrlChanged` fold when the route becomes `App`.
4. **[Med] No scroll reset on page change** (J15). Call `Browser.Dom.setViewport 0 0` on path changes.
5. **[Med] No route-change announcement for screen readers** (J17). Add a persistent `role=status` node fed from a Route→label table.
6. **[Med] Stats share links ignore `?room`/`?compare`/`?window` on hard load** (J79). Seed them in `App.init`.
7. **[Med] Static-file links render the 404 page** (J21, ⚠ shared). Treat paths with a file extension or under `/downloads/` and `/source/` as `LoadUrl`.
8. **[Med] Public menu and tab widgets lack focus management** (J27/J37/J83/J86/J93). Add one `focusAfterRender` port, plus roving tabindex on the landing board.
9. **[Low] Head metadata not updated on in-app navigation; landing preview reduced to a static sketch; partial `ocean-*` migration** (J4/J5/J8/J34/J11).

### Calls

1. **[High] The video-off switch leaks** (H, gap 1). `cameraSupported` never reaches Elm, so Camera still shows, and "Join with video" (banner + hub) calls `engine.joinVideo`, which bypasses `VIDEO_ENABLED`. Back-fill `cameraSupported` in `ports.js`, force `video=false` in `voice-engine.ts joinVoice`, and gate `View/Calls.elm:254`.
2. **[High] Watch Together is missing entirely** (H102–H111). `View/About.elm` and `CALLS_DESIGN.md` still advertise it. Add a `WatchTogether` module over `PROP ocean.watch`, plus a room card and a prefs toggle.
3. **[High] Media failures are silent** (errors, decode failures, "Removed from voice", codec/encoder). Emit `{mediaError, errorKind}` from `voice-core.ts`; turn them into toasts in `CallDock`.
4. **[Med] No provisional "joining…" state** during the permission prompt / IDENTITY ADD wait (up to 20 s).
5. **[Med] Media peer key change goes unannounced** (`voice-engine.ts:74`). Reuse the DM key-change toast/banner.
6. **[Med] Missing in-call features:** local recording (WebM), screen wake lock, OS Media Session controls, in-call "Invite with room link", and real SFU topology/bitrate (STATS is never folded).
7. **[Low] Smaller call gaps:** spatial-audio pad; stage-size buttons; tile role badges; "local media unavailable"; palette "Start voice"; the DM "Call" item always fails because the adapter has no DM path, so hide it.

### Moderation and operators

1. **[High] No "Experience level" control** (I, gap 1). The card's Kick/Ban/Op/Voice controls and the desk action list are gated on a mode the user cannot change (`Prefs.elm:449`, `View/Profile.elm:765`). Add the segmented control in `View/Prefs.elm`, or gate on `isChannelOp` alone.
2. **[Med] Webhooks only for owners of rooms with 3–30 members** (via Room care); Solid let any op manage them. Render the forms in `View/RoomSettings.elm` for ops.
3. **[Med] Member list renders every row** in rooms of up to 4096. Window it, or use CSS `content-visibility`.
4. **[Med] Guest badge / account row wrong for registered peers.** Elm ignores the account from extended-join and `ACCOUNT` lines.
5. **[Med] Room ownership transfer can never complete** (⚠ shared). The offer lives only in the offerer's memory, so the recipient never sees it.
6. **[Low]** Desk form stages a kick even when no kinds are allowed; the timed block skips review and the self-mask/everyone guards; no prose spine notices; network name hard-coded "Onyx"; members cannot open the read-only desk; Room care lacks Invite/Leave.

### Account and security

1. **[High] Sign-in failures mislead or hang** (C122–C124).
   - A wrong password reads "Couldn't reach Onyx just now" and keeps reconnecting (`failSasl` only logs).
   - A taken nick hangs registration: there is no `nick_` ×4 retry when there are no aliases (`foldNickError`, `App.elm:10119`).
   - A registered-nick guest join shows "Erroneous nickname".
   - FAIL SESSION has no inbox row (C7).
2. **[High] Remembered identities / "Stay signed in" missing** (G15–G19, roadmap 0.3). `Credentials.elm` is imported only by tests. Add list/select/save/forget ports and a "Welcome back" block in `View/Connect.elm`.
3. **[High] The credential store schema clashes with Solid** (G34). Elm writes `onyx:credentials` as `{v:1,slots}` over Solid's `{version:2,activeKey,entries}`, wiping a migrating user's saved identities. Read and merge the v2 shape.
4. **[High] Blocklists are not per-account** (I, gap 2). Elm uses plain `onyx:ignored-users`/`onyx:muted-dms`; Solid used owner-scoped keys. Blocks are lost on migration and shared across accounts.
5. **[Med] DM key-change handling (security).**
   - Accept re-pins the whole live device set instead of the single pending key (N104).
   - A change is detected only on seal/open, not when the directory updates (N105).
   - The alert goes only to the service log (G89, B119); it needs a toast and an inbox row.
6. **[Med] No Protection toggles** ("Require sign-in" / "Hold this name", G68). No "Recover a name" (G78; `Services.recover` has no caller). No connect-time reclaim (G13). `?signin=1` is ignored (G10), although Elm's own invite page builds it.
7. **[Low]** "Sign in as X" button, invite preview aside, page-restore reconnect, session age/sign-on time, clear secrets when Account closes, show/hide password, `?reader=1`, `ocean-*` migration, group-room "active" indicator.

### Data and vault

1. **[High] No service worker is ever registered** (J9/V76/V80, N141). Web Push hangs on `serviceWorker.ready` forever, there is no update detection, and there is no offline shell. Register `/sw.js` in `ports.js` and time-limit `swReady()`.
2. **[High] Push is never reconciled after a reload** (V77). `requestWebPushCheck` only runs when `webPushOn`, which boots False.
3. **[High] The vault is not owner-scoped** (V4). A second identity on the device sees the first one's history and search recall. Stamp an owner key in the ports vault store.
4. **[High] The local-history opt-out is ignored, and there is no clear-history control** (V26/V27, F). Gate `flushVaultBuffer` on `prefs.localHistory` and add a `VaultClear` port.
5. **[High] No third-party history importers** (V53–V57, roadmap 4.5): Discord JSON, package and bot, Slack, IRC logs.
6. **[Med] Portable export/import is vault-rows only** (V41/V45–V50). There is no review/cancel step and no gzip.
7. **[Med] Clicking a desktop alert only focuses the window** (V73). Throttled alerts are dropped instead of coalesced (V74).
8. **[Med] No `(N)` tab title and no app badge** (V68/V69, B112).
9. **[Med] Saved-search clear/export/import are CORE-ONLY** (V22/V23).
10. **[Med] No "Since you left" digest, no offline Home memory card, no cold paint of the last room from the vault** (V82/V83/V2/V3). Home queued rows lack Open/Remove (V39/V40).

### Command surfaces (slash, palette, keyboard)

1. **[Closed — v3/gap-commands] Registry slash verbs that need translation were broken** (K1–K19/K34/K35, ⚠ shared). Now translated beside `parseSlashLocal` (`planSlash`), with inbound CTCP ACTION as action rows; content verbs ride the composer's seal/hold. Original defect:
   - `/me`, `/msg`, `/query`, `/j`, `/op`, `/deop`, `/voice`, `/devoice`, `/ban`, `/unban`, `/back`, `/unaway`, `/quote`, `/raw`, `/ctcp` and `/stage` hit 421 on Onyx Server.
   - `/kick`, `/topic`, `/invite <nick>` and bare `/part` go out without a channel.
   - `/away <multi-word>` loses all but the first word (B12).
   - Inbound CTCP ACTION is swallowed, so `/me` lines from other IRC clients vanish.
   - Fix: add a translation table beside `parseSlashLocal` and an action row type.
2. **[Closed — v3/gap-commands] `/share` (and bare `/invite`) were missing in Elm** (K8/K29); both work and `/help` lists only working verbs.
3. **[Mostly closed — v3/gap-commands] The palette was about a quarter of Solid's** (K46–K83); People, recents, Preferences, Theme Studio, Scheduled, Copy room/node link, Start voice, Mark all read, catch-up, theme rows and the `#room` / `mute N` grammar now ship. Still missing: hide/close, translate, reader mode/width/motion, AI-policy and extension rows, time grammar (K63, K65, K69–K71, K74–K76, K79, K82, K83 partly). Original gap: Missing: People rows, recents, Preferences, Scheduled, Copy room link, Start voice, Mark all read, theme switching, and the grammar verbs.
4. **[Closed — v3/gap-commands] 17 of 21 Solid shortcuts were missing,** plus J/K and `g h`/`g d` (K89–K102); all now go through the one `shortcut` port (reader mode, K94, stays missing: no reader mode in Elm).
5. **[Low] No swipe-to-reply** (K105).

## Where Elm is better than Solid

Consolidated from the per-section "Elm better" lists, which carry the evidence.

**Security and privacy**
- **DM key-lookup hold.** A DM to a peer whose `ocean.dm-key` lookup hasn't answered is held. It never goes out in plaintext, and sending unencrypted needs explicit per-peer consent (`App.dmKeyUnresolved`, `DmKeyHoldTest`). Solid had an open-then-send race. Scheduled DMs wait for the lookup too.
- **Raw content verbs can't leak plaintext.** `/msg`, `/notice`, `/privmsg`, `/me`, `/query`, `/whisper` and `/edit` refuse to send plaintext into designated or unresolved DMs and required-encryption rooms (`App.elm:11171`). Solid's raw fallthrough had no guard.
- **More fail-closed gates.**
  - No plaintext EDIT in protected conversations.
  - Attachments are held before upload.
  - Stage `ACCEPT_SPEAK` voices only people the host invited (the voice-hijack fix).
  - The oper event replay feed is gated.
  - The `mediaSave` sink accepts only http(s) and blob links.
  - Server-time parsing fails closed, so a bad tag can't produce `Invalid Date` ordering.
- **"Not encrypted" chip** on plaintext DMs. Solid showed nothing.

**Feedback that actually shows**
- **Toasts render, with Undo and auto-expiry.** Solid's `<Toaster>` was only ever mounted in tests, so none of its ~48 `addToast` calls were visible (A, D).
- **The offline-memo toast fires.** Solid's listener read `detail.from` while the store sent `channel`.
- **Join failures are explained by cause:** permission, no device, account required, encryption. There is a reconnecting state with "Connection lost." and "Reconnected" announcements.
- **More inbound responses are visible.** 775/776 access notes show as room rows, and FAIL ACCOUNTINFO clears its loader (in Solid it stayed stuck). STATUSMSG (`@#chan`) messages file under the room with an audience badge.

**Features Solid had in code but no one could reach**
- Mini call PiP renders. Solid's `VoicePip` never mounted.
- Friends and watch list, with rail presence. Away and custom status with expiry.
- Mid-session nick reclaim (GHOST+NICK with retry), plus a Cancel button while connecting.
- Timed bans with auto-lift and an extban builder with live preview.
- "Add a boost" and "Reply in thread" on any message.
- Room colour labels render, and `/color clear` works.

**Calls**
- Call chords Ctrl/Cmd+Shift+M/E/H/C/L/G/F/S, with `aria-keyshortcuts` and a leave-confirm when more than two people are in the call. A user-bound push-to-talk key.
- Per-peer media fingerprints in the privacy sheet.
- Pages of 16 participants with dominant-speaker reordering, and a screenshare layout with a grid escape.
- iOS/WebKit hardening: audio unlock, capture recovery, and Share hidden where there is no picker.
- Video kept off on the live network to protect SendQ. This is a product decision; see top gap 1 for where it leaks.

**Shell and conversation**
- **One ordered Escape stack and one overlay-focus mechanism.** Phones get sheets with swipe-down dismiss.
- **Phone navigation.** A conversation opens as its own page with a back count. Nav items carry unread and mention badges.
- **Keyboard inset on iOS.** It uses `visualViewport`; Solid's API was Chromium-only.
- **Transcript.**
  - Keyed and lazy rows.
  - An optional compact IRC-style density.
  - An "uncertain delivery" row state.
  - A composer audience toggle (ops/voiced only).
  - The time scrubber is reachable from the room More menu.
- **New verbs.** `/modex` and `/import`.
- **Per-row discard.** Queued sends and drafts can be discarded one by one, and the Notifications sheet has a snooze-for-minutes field.
- **Moderation reach.**
  - The room and oper desks open in every experience mode.
  - The member list has an Away section and per-row Message.
  - Room settings › Roles names who holds each role.

**Public site**
- One bundle, so there are no lazy-chunk failures.
- More footer destinations and a richer 404 page.
- Same-route `?room=` links re-seed the stats inspector.

## Where `COVERAGE.md` and `V3_ROADMAP.md` are stale or overstate

Each section has its own drift list with evidence, and [section N](#n--every-narrowing-recorded-in-elmcoveragemd-classified) classifies
every narrowing. The items that change decisions:

**Overstated: marked done, but broken or unreachable**
- **COVERAGE:88 REDACT/EDIT "done".** Onyx Server's only edit shape, `PRIVMSG +draft/edit`, is unhandled, so edits duplicate (C57).
- **COVERAGE:32 nick errors "underscored retry ×4".** No `_` retry exists. "904/905 … 4003-equivalent" is also wrong: there is no close code and reconnect stays armed (C122/C124).
- **"Generic numeric log, like the oracle" (many rows).** Solid's log was visible in its Activity view; Elm's `serviceLog` has no view (C113).
- **COVERAGE:88 / :108 landing.** "`?at=` … + landing" and "`jumpToPinned` focuses loaded rows via `historyLanding`": nothing reads `historyLanding` (A14, E gap 2).
- **COVERAGE:201 uploads.** "EXIF file ops stay ports-side": `ports.js` strips nothing (E gap 1).
- **COVERAGE:189 E2EE toggle "done".** It only applies after a reload (F gap 4).
- **COVERAGE:213 / V3_ROADMAP 4.1 Preferences "done".** About half the panel is missing. Text size and Density are inert, and the local-history opt-out is ignored (F).
- **COVERAGE:195 themes.** Themes recolor the Appearance page and Theme Studio, not the shell (F gap 1).
- **COVERAGE:202 / V3_ROADMAP 3.3 notifications "done".** Quiet hours and calm modes are missing, and quiet hours changes default alert behaviour (B51).
- **COVERAGE:91 Ignore/mute "done".** `MuteDm`/`UnmuteDm` are CORE-ONLY, and the storage is not per-account (B58, I gap 2).
- **COVERAGE:184 / :188 vault and saved searches.** Vault export/import "done" ignores the portable bundle, owner scoping, cold paint and clear controls. Saved-search clear/export/import outbounds have no emitter (V22/V23).
- **COVERAGE:63 / :137 GHOST/RECOVER/RELEASE "done".** Only builders exist; `Services.recover`/`release` have no caller (G78, A80).
- **COVERAGE:122 MEDIA STATS/LAYER/BREAKOUT/POS "done".** `Media.elm` folds none of them. SFU cascade and codec toasts have copy but no feed (H).
- **COVERAGE:218 C4 camera "done".** Since `fbe04585` the camera is supposed to be off, and the gating leaks (H gap 1).
- **COVERAGE:76 MODEX "done".** `modexModes` has no view, so `/modex` output is invisible (C).
- **COVERAGE:198 PublicFrame skip link, Download catalog, Stats query helpers "done".** None work on a hard load (J22/J55/J79).
- **V3_ROADMAP:8 "all public routes at parity".** Overstated (J).
- **COVERAGE:206 / :209 moderation.** The card moderation controls are hidden behind an unsettable experience level. The desk opens from the room-header More menu, not the topbar (I).
- **COVERAGE:224 Web Push arming "stays in the Notifications sheet".** It is only in the Account panel (D).
- **COVERAGE:19 transport.** Cites `Wire.splitWireFrame`, which only tests use; framing happens in `ports.js` (C).

**Understated: marked missing or ahead, but already done**
- COVERAGE narrowings that later slices resolved: 45 of 146 (section N), including the following.
  - Password entry, TimeScrubber, local clock, menu pin, per-target drafts.
  - Escape-to-cancel, textarea composer, More tools tray, member-card Message/Report.
  - Focus trap, sectioned rail and collection pages.
  - `stopScreenShare` in the engine, media-panel CSS, minification, real-browser screenshots.
- COVERAGE:197 "All 13 routes": there are 20 Route constructors plus `/install`.
- V3_ROADMAP 2.1–2.3 (rich text) and 7.5 (deploy path via `deploy.sh ONYX_CLIENT=elm` + `tools/elm-overlay.mjs`, esbuild minify) have landed. Only CSP is still pending.

**Structural**
- **COVERAGE:198.** The "App core" row is one ~25 KB cell that contradicts itself.
- **COVERAGE:246–247.** These rows render outside any table.
- **No COVERAGE row** covers Web Push, the desktop-alert runtime, app badge, attention title, service-worker registration, backgrounds, Protection toggles or Recover a name.
- **V3_ROADMAP duplicate rows.**
  - Phase 1 (1.1–1.7), Phase 2 (2.4–2.6), Phase 3 (3.4–3.7) and the C1–C12 summary each appear twice, with contradictory statuses.
  - Row 6.7 lumps Stage (done) with Watch Together (not started).
- **Stale code comments.**
  - `View/About.elm:100` advertises Watch Together, and `View/About.elm:51` claims `prefers-contrast` handling; neither exists.
  - `View/Formation.elm:10` says "no friends store".
  - `ports.js:1151` says the login UI is unbuilt.
  - `View/Topbar.elm:163` says there is "no pre-connect form".
  - Module docs in `View/NotFound`, `View/Invite` and `View/Guides` cite metadata ports that don't exist.

## Detailed map

One table per surface. Row ids (D1, E12, …) are what the summary, top-30 and gap lists cite. Each section ends with its own stale-doc notes, Elm-better notes and ranked gaps with implementation sketches.

### D — Shell, navigation, Home, banners, notification center, PWA

Solid walked: `src/shell/AppShell.tsx` (all mounts/effects/drawers), `ChannelSidebar.tsx`, `PrimaryNavigation.tsx` + `navigation/shellNavigationModel.ts`, `ServerRail.tsx`, `YouHubNav.tsx`, `app/YouSettings.tsx`, `HomeView.tsx` + `home/*`, `CatchUpSummary`/`SinceDigestCard`/`MarkAllCaughtUp`/`FirstHourCoach`/`FirstRunNotifyPrompt`, `ContextRail.tsx`, `PresenceRibbon.tsx` (every chip + More item), `PresenceHeatline`, `Facepile`+`facepile.ts`, `TopicChip`, `RoomSwitcherSheet`, `ChannelBrowser`, `CreateRoomFormation`, `startRoom`, `ReconnectStatusBanner`, `session/*`, `OfflineMemoToast`, `NotificationCenter`, `YouNotifications`, `GuestClaimPrompt`+state, `roomIdentity`, `themeBackground`, `lib/{channel,catchup,firstHour,formation,mobile}/*`, `closedConversations`/`hiddenRooms`/`channelNavigationMemory`/`channelColorMemory`/`bookmarks`, `src/pwa/*`, `src/ui/a11y/*`, `primitives/Toast.tsx`, `components/RelativeTime.tsx`.
Elm checked: `Nav.elm`, `Sidebar.elm`, `Home.elm`, `NotifyCenter.elm`, `Polish.elm`, `View.elm`, `View/{Nav,Rail,Home,Topbar,RoomHeader,Browser,Formation,Inbox,Polish,GuestClaim,Toast,CallPresence,Notify,Roster,RoomSettings,Thread,Appearance,Account}.elm`, `Facepile.elm`, `AiPolicy.elm`, `App.elm` folds (grep), `ports.js` (polish/PWA/viewport), `index.html`.
Hosted-but-owned-elsewhere surfaces (Account, Prefs, Pins, Scheduled, Jump, Whois, voice cluster, DmSafety, Stage, Shortcuts, palette, slash verbs) are not re-mapped here.
**Key Solid finding:** `primitives/Toast.tsx` `<Toaster>` is never mounted and nothing reads store `toasts` (`src/lib/store/store.ts:9052`), so every Solid `addToast` (copy, hide room, offline memo, undo, A2HS…) is invisible — Solid toasts are DEAD; Elm renders them.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| D1 | Primary nav Home/Rooms/Messages/Calls/You, desktop rail + mobile bottom bar, aria-current/pressed/expanded/haspopup | `src/shell/PrimaryNavigation.tsx:85`, `AppShell.tsx:1566` (UI) | FULL | `Nav.elm` items; `View/Nav.elm:65,78,141`; `App.elm:39383`→`43970` | Elm adds collection unread badges |
| D2 | Home destination clears conversation + closes drawers | `AppShell.tsx:989` (UI) | FULL | `App.elm:43976` | also closes search/pins/media |
| D3 | Rooms/Messages collection select (sidebar mode) + mobile drawer open | `AppShell.tsx:995,1000` (UI) | FULL | `App.elm:43995`; `View/Rail.elm:40` data-collection | Elm phone = full-screen page, not modal drawer |
| D4 | Calls primary surface (hub, Open rooms, Return to call) | `AppShell.tsx:1022,1515` (UI) | FULL | `App.elm:39379,41145`; `View.elm:273` | calls mapper owns hub depth |
| D5 | You = transient dialog, never a location | `AppShell.tsx:1027` (UI) | FULL | `App.elm:43973`; `View/Nav.elm:232`; `View/Topbar.elm:157` | Elm You hub sheet; identity chip opens it |
| D6 | Active section follows conversation / calls | `AppShell.tsx:1285` (auto) | FULL | `Nav.elm` `reconcile` | — |
| D7 | Server rail brand + active-server entry with network unread/mention badge + aria count | `ServerRail.tsx:53-80` (UI) | PARTIAL | `View/Topbar.elm:36`; `View/Nav.elm:103` | No network-wide total; Elm badges per collection instead |
| D8 | Rail Appearance link | `ServerRail.tsx:95` (UI) | FULL | `View/Nav.elm:336`; `App.elm:44014` PushUrl | via You hub → `/appearance` route |
| D9 | Rail Disconnect | `ServerRail.tsx:105` (UI) | FULL | `View/Nav.elm:381`; `App.elm:37596` | "Leave Onyx" in You hub (+palette) |
| D10 | Mobile drawer a11y: background inert, Tab trap, Escape, focus restore | `AppShell.tsx:766-878` (UI) | FULL | `View/Sheet.elm` scope; `App.elm:44279` overlayStack | Elm uses pushed pages + one Sheet focus mechanism |
| D11 | Close stale drawers/desk when view changes globally | `AppShell.tsx:956-987,1123` (auto) | FULL | `Nav.elm` reconcile; `App.elm:44349` settleRoomMenu | — |
| D12 | Desktop People column: closed until asked, header toggle, single occupant vs Context | `AppShell.tsx:913,1249,1266` (UI) | PARTIAL | `View/Roster.elm:124`; `css/pol-roster.css:327` | ≥1100px roster always shown; no hide toggle, no aria-expanded |
| D13 | Mobile People drawer from header (closes on room change) | `AppShell.tsx:913-929,966` (UI) | FULL | `View/Roster.elm:136` popovertarget | popover sheet |
| D14 | Context rail (toggle + rail: ledger, Room insights, Room tools, Oper desk/events, Escape) | `ContextRail.tsx:48-149`; `PresenceRibbon.tsx:1506` (UI) | PARTIAL | `View/RoomSettings.elm:1090`; `View/RoomHeader.elm:281`; `View/Topbar.elm:48` | No rail; pieces reached via Room settings › Insights, More › Moderation, topbar Operator |
| D15 | Mobile Room control desk (advanced modes): ledger, insights, moderation, oper, Back/Close | `AppShell.tsx:1040,1594` (UI) | PARTIAL | same as D14 | No combined desk; no "tools appear after grant" note |
| D16 | New conversation sheet from Messages "+ New"; start → DM, composer focus | `ChannelSidebar.tsx:867`; `AppShell.tsx:1212` (UI) | FULL | `View/Rail.elm:167`; `App.elm:41999,42008` | Elm inserts empty DM shell |
| D17 | Ctrl/Cmd+F opens message search (not under a modal) | `AppShell.tsx:224` (shortcut) | FULL | `App.elm:39559` | keyboard mapper owns |
| D18 | Activity/status view (server log buffer; capability matrix in advanced modes) | `AppShell.tsx:1498-1500` (UI) | CORE-ONLY | `App.elm:738` serviceLog folded (`8656`), no view | log only feeds Account notice filters |
| D19 | Room-current sr-only orientation (label + unread/mention detail) | `AppShell.tsx:1296`; `PresenceRibbon.tsx:616` (UI) | PARTIAL | `View/RoomHeader.elm:80` | header label lacks unread/mention detail |
| D20 | Lazy-surface failure: Retry ×2 / Reload app / Close | `AppShell.tsx:174` (UI) | N/A | — | Elm ships one bundle |
| D21 | Update hold while any composer draft is non-empty | `AppShell.tsx:418` (auto) | MISSING | `App.elm:45572` polishWorkActive (calls only) | update can reload over drafts |
| D22 | Update hold during voice call | `AppShell.tsx:399` (auto) | FULL | `App.elm:45572,45821` | — |
| D23 | Header voice join (gUM first, provisional stage, fail toast, join/rejoin banner) | `AppShell.tsx:486`, `1466` (UI) | FULL | `App.elm:41150`; `CallUi.elm:389`; `View/CallPresence.elm:254` | calls mapper owns depth |
| D24 | Animated theme background behind shell (`auto` = theme signature) | `AppShell.tsx:1367`; `themeBackground.ts:22` (auto) | MISSING | `ThemeLook.elm` resolveBackgroundId; `View/Appearance.elm:71` empty host | nothing paints a scene anywhere |
| D25 | Time scrubber surface | `AppShell.tsx:1481` (UI, pref) | FULL | `View/RoomHeader.elm:279`; `View/Polish.elm:246,276` | Elm: More toggle, not pref-gated |
| D26 | Watch Together activity | `AppShell.tsx:1484` (UI, pref) | CORE-ONLY | `Prefs.elm:421` flag only | no surface |
| D27 | Session reclaim banner in conversation column | `AppShell.tsx:1415` (auto) | FULL | `View.elm:259` | account mapper owns depth |
| D28 | Sidebar network header: name (IRCXNet→Onyx, custom label), status dot, polite "Connection X" | `ChannelSidebar.tsx:73,598` (UI) | PARTIAL | `View/Topbar.elm:36,72`; `View/Nav.elm:396` | static "Onyx"; pill not a live region |
| D29 | Advanced-mode notification chips (desktop/calm/sound/push/DND/quiet hours) | `ChannelSidebar.tsx:610`; `NotificationControls.tsx:375-468` (UI) | PARTIAL | `View/Notify.elm:100`; `View/Account.elm:476` | no calm preset, no quiet hours |
| D30 | Filter: query, Unread-only, Clear, Escape clears, auto-open, "on" marker | `ChannelSidebar.tsx:625-690` (UI) | FULL | `View/Rail.elm:182-272`; `App.elm:41778-41786` | Elm field always visible |
| D31 | Filter-empty copy | `ChannelSidebar.tsx:745` (UI) | FULL | `View/Rail.elm:91`; `Sidebar.elm:186` | — |
| D32 | "Activity · #room" ledger link for active room | `ChannelSidebar.tsx:696` (UI) | PARTIAL | `View/RoomSettings.elm:1097`; `View/Pins.elm:66` | only inside Room settings/Pins |
| D33 | Activity (status) entry row | `ChannelSidebar.tsx:730` (UI) | MISSING | — | see D18 |
| D34 | Favorites section (starred, alpha) | `ChannelSidebar.tsx:754` (UI) | FULL | `View/Rail.elm:103`; `Sidebar.elm:156` | — |
| D35 | Star/unstar per room (owner-gated) | `ChannelSidebar.tsx:581` (UI) | FULL | `View/Rail.elm:416`; `App.elm:41787` | — |
| D36 | Room folders in sidebar + collapse toggle (persisted) | `ChannelSidebar.tsx:781,798` (UI) | MISSING | `Sidebar.elm:36` narrowing | no folder state |
| D37 | Folder management (create/assign/delete) | `ChannelOrganizationSection.tsx:39-155`; `app/Account.tsx:1110` (UI) | MISSING | `View/Account2.elm:21` | — |
| D38 | Drag reorder (`setChannelOrder`) | `src/lib/store/store.ts:17831` (DEAD) | N/A | — | no caller |
| D39 | Hidden rooms filtered from list; auto-reveal on mention / own msg / leave | `ChannelSidebar.tsx:284`; `store.ts:11677,12977` (auto) | MISSING | — | no hiddenRooms state |
| D40 | Room row: name, topic line, activity stamp, unread 99+/mention badge, aria | `ChannelSidebar.tsx:521` (UI) | FULL | `View/Rail.elm:331-415`; `Sidebar.elm:208` | — |
| D41 | Rooms zero state: Browse / Start a room / Invite friends | `ChannelSidebar.tsx:825,833,841` (UI) | PARTIAL | `View/Rail.elm:117,143-161` | no Invite friends in rail |
| D42 | Collection heading with counts | `ChannelSidebar.tsx:383` (UI) | PARTIAL | `View/Rail.elm:76` | no counts |
| D43 | Messages: recency sort, initial, preview, key-change ⚠, offline-memo stamp, badge | `ChannelSidebar.tsx:878-955` (UI) | FULL | `View/Rail.elm:462-568`; `Sidebar.elm:145,355` | Elm adds time + friend dot |
| D44 | Closed conversations hidden; reopen on open/new inbound | `ChannelSidebar.tsx:365`; `store.ts:8027,13061` (auto) | MISSING | — | no closedConversations state |
| D45 | Join-a-room-by-name form | `ChannelSidebar.tsx:968` (UI) | PARTIAL | `App.elm:12981` `/join` | slash only; no field |
| D46 | Roving arrow/Home/End focus, single tab stop | `ChannelSidebar.tsx:428` (UI) | MISSING | `View/Rail.elm:11` narrowing | — |
| D47 | Mobile switcher sheet head ("Switch rooms", Close) | `RoomSwitcherSheet.tsx:28-42` (UI) | FULL | `View/Topbar.elm:58`; `View/Rail.elm:76` | page title + nav back |
| D48 | Home "Start a room" (first hour) focuses sidebar join field | `startRoom.ts:20`; `AppShell.tsx:1010` (UI) | PARTIAL | `View/Home.elm:305` | Elm always opens formation |
| D49 | You head: nick, guest/signed-in, close | `app/Account.tsx:661`; `app/YouSettings.tsx:53` (UI) | FULL | `View/Nav.elm:265-291` | Elm adds connection + status block |
| D50 | Guest vs account lede | `YouSettings.tsx:54` (UI) | FULL | `View/Nav.elm:293` | — |
| D51 | Account group (guest → Keep this name) | `YouSettings.tsx:60` (UI) | FULL | `View/Nav.elm:302`; `App.elm:44019` | — |
| D52 | Notifications: Calm presets + keywords | `YouSettings.tsx:75-85`; `CalmModeControl.tsx` (UI) | PARTIAL | `View/Nav.elm:323`; `View/Notify.elm:357` | no Calm/Regular/Power |
| D53 | Privacy: Private messages (e2eeDms), Safer link previews (httpsOnly) | `YouSettings.tsx:93,106` (UI) | FULL | `View/Appearance.elm:232,234` | on `/appearance` |
| D54 | Blocked users on this device | `YouSettings.tsx:122` (UI) | FULL | `View/Notify.elm:422` | in Notifications sheet |
| D55 | Appearance entry | `YouSettings.tsx:133` (UI) | FULL | `View/Nav.elm:336` | route, not in-shell sheet |
| D56 | Text size + density radiogroups | `YouSettings.tsx:147-190` (UI) | FULL | `View/Appearance.elm:124,157` | — |
| D57 | Reduce motion / reduce background motion | `YouSettings.tsx:198,211` (UI) | FULL | `View/Appearance.elm:246,256` | — |
| D58 | Voice devices entry | `YouSettings.tsx:227` (UI) | FULL | `View/Nav.elm:352` | — |
| D59 | Language tools (translation target) | `YouSettings.tsx:240` (UI) | FULL | `View/Appearance.elm:372` | — |
| D60 | Help: About, Network status | `YouSettings.tsx:261` (UI) | FULL | `View/Nav.elm:357-379` | Elm adds Guides |
| D61 | Advanced: All preferences, Theme Studio | `YouSettings.tsx:283,295` (UI) | FULL | `View/Nav.elm:343`; `View/Appearance.elm:266` | account advanced tools → account mapper |
| D62 | YouHubNav lateral rail across You sheets (current marker) | `YouHubNav.tsx:50`; `YouNotifications.tsx:199` (UI) | MISSING | — | no cross-sheet hub nav |
| D63 | Reconnect banner phases + countdown + Back online 3s, calm live region | `ReconnectStatusBanner.tsx:39-142` (auto) | FULL | `View/Topbar.elm:248`; `App.elm:16872` | — |
| D64 | "Try again now" | `ReconnectStatusBanner.tsx:128` (UI) | FULL | `View/Topbar.elm:277`; `App.elm:39392` | hidden while connecting (deliberate) |
| D65 | Session truth bar | `session/SessionTruthBar.tsx` (DEAD) | N/A | — | never mounted |
| D66 | Offline memo toast | `OfflineMemoToast.tsx:17` (DEAD: reads `detail.from`, store sends `channel` `store.ts:10937`) | N/A | `App.elm:20717-20745` | Elm fires it — better |
| D67 | Toast region (render, auto-dismiss, grouping) | `primitives/Toast.tsx:58` never mounted (DEAD) | N/A | `View/Toast.elm:22`; `App.elm:10468,10526` | Elm better |
| D68 | Undo toasts (block/unblock) | `IgnoredUsersControl.tsx:63,78` (DEAD render) | N/A | `View/Toast.elm:58`; `App.elm:31103,31126` | Elm better |
| D69 | Guest claim chip: Keep / dismiss (per-owner persisted) | `GuestClaimPrompt.tsx:341-372` (UI) | FULL | `View/GuestClaim.elm:54-90`; `App.elm:39418`; `ports.js:5590` | Elm chip on Home only |
| D70 | Guest claim sheet REGISTER→VERIFY→IDENTIFY, busy-guarded close | `GuestClaimPrompt.tsx:377-528` (UI) | FULL | `View/GuestClaim.elm:168-278`; `App.elm:39434` | — |
| D71 | Suppress guest chip during first-hour guest handoff | `GuestClaimPrompt.tsx:132` (auto) | MISSING | `View/GuestClaim.elm:8` narrowing | — |
| D72 | Bell + attention-only unread badge (9+) | `NotificationCenter.tsx:258-279` (UI) | FULL | `View/Inbox.elm:27-64` | topbar; no 9+ cap |
| D73 | Inbox unread summary (polite) | `NotificationCenter.tsx:286` (UI) | MISSING | — | — |
| D74 | Mark notifications read | `NotificationCenter.tsx:293` (UI) | FULL | `View/Inbox.elm:109`; `App.elm:37779` | — |
| D75 | Header Room ledger link + "history only" explanation | `NotificationCenter.tsx:297,310` (UI) | MISSING | — | — |
| D76 | Filters All / Needs you / Other + counts | `NotificationCenter.tsx:314` (UI) | FULL | `View/Inbox.elm:117`; `App.elm:37770` | — |
| D77 | Per-filter empty copy | `NotificationCenter.tsx:114` (UI) | FULL | `View/Inbox.elm:122-138` | — |
| D78 | Row: glyph, category, from, channel, rel. time, preview, unread state | `NotificationCenter.tsx:344-366` (UI) | FULL | `View/Inbox.elm:174-231` | Elm adds "Read" label |
| D79 | Activate row: mark read, open room/DM, close | `NotificationCenter.tsx:171` (UI) | FULL | `App.elm:37776,18628` | — |
| D80 | Follow notification opens its named topic | `NotificationCenter.tsx:180` (UI) | PARTIAL | `App.elm:18622` | opens room without topic |
| D81 | Non-jumpable rows disabled | `NotificationCenter.tsx:353` (UI) | PARTIAL | `View/Inbox.elm:201` | always enabled |
| D82 | Per-row Room ledger link | `NotificationCenter.tsx:369` (UI) | MISSING | — | — |
| D83 | Dismiss row; focus moves to next/prev dismiss | `NotificationCenter.tsx:202,378` (UI) | PARTIAL | `View/Inbox.elm:233`; `App.elm:37773` | no focus hand-off |
| D84 | Inbox focus entry/trap/Escape → bell | `NotificationCenter.tsx:154,225` (UI) | FULL | `View/Sheet.elm`; `App.elm:44336` | — |
| D85 | You → Notifications sheet | `YouNotifications.tsx:191` (UI) | FULL | `View/Nav.elm:323`; `App.elm:39305`; `View/Notify.elm:100` | — |
| D86 | Three-layer explanation + status (permission/push/host honesty) | `YouNotifications.tsx:200,205` (UI) | PARTIAL | `View/Notify.elm:118,160` | desktop on/off only |
| D87 | Turn on alerts = permission + closed-tab push + toast | `YouNotifications.tsx:137,219` (UI) | PARTIAL | `View/Notify.elm:189`; `View/Account.elm:476` | push only in Account panel |
| D88 | Turn off closed-tab alerts | `YouNotifications.tsx:160,231` (UI) | PARTIAL | `View/Account.elm:476`; `App.elm:43380` | Account panel only |
| D89 | Auto web-push recovery when connected | `YouNotifications.tsx:108` (auto) | FULL | `App.elm:43389` | — |
| D90 | "What can ping" kinds list | `YouNotifications.tsx:238` (UI) | MISSING | — | copy-only |
| D91 | "This room" policy copy + All/@/Mute in sheet | `YouNotifications.tsx:254-259` (UI) | PARTIAL | `View/Notify.elm:50` (header More) | not in sheet; no policy copy |
| D92 | Live permission monitor | `YouNotifications.tsx:121` (auto) | FULL | `App.elm:31218` | — |
| D93 | Name button copies room/DM name + toast | `PresenceRibbon.tsx:637` (UI) | MISSING | `View/RoomHeader.elm:99` plain h2 | — |
| D94 | DM "Private" chip | `PresenceRibbon.tsx:678` (UI) | FULL | `View/RoomHeader.elm:106` | dm mapper |
| D95 | Topic in header | `PresenceRibbon.tsx:711` (UI) | FULL | `View/RoomHeader.elm:412-470` | Elm: More/Less + "No topic set" |
| D96 | 24h heatline + present + ledger (advanced modes) | `PresenceRibbon.tsx:699`; `PresenceHeatline.tsx:44` (UI) | PARTIAL | `View/RoomSettings.elm:1096` Room pulse | not in header |
| D97 | Facepile (cap+overflow) → people card + moderation review | `PresenceRibbon.tsx:705`; `Facepile.tsx:72` (UI) | FULL | `View/RoomHeader.elm:488-561`; `App.elm:42058` | — |
| D98 | DM Verify safety number | `PresenceRibbon.tsx:721` (UI) | FULL | `View/RoomHeader.elm:106` | dm mapper |
| D99 | Scheduled event chip: countdown, live, click → travel to moment | `PresenceRibbon.tsx:741`, `510` (UI) | PARTIAL | `View/RoomHeader.elm:476`; `View/RoomSettings.elm:912-975` | no travel click; Elm adds Join/Clear |
| D100 | Voice occupancy chip (speaking/raised/muted/local health) | `PresenceRibbon.tsx:761` (UI) | FULL | `View/CallPresence.elm:145-190` | Elm better (faces, return-to-call) |
| D101 | Call lifecycle pills | `PresenceRibbon.tsx:775-805` (UI) | FULL | `View/CallPresence.elm:195-222` | — |
| D102 | Join call (voiceEntry pref) | `PresenceRibbon.tsx:820` (UI) | FULL | `View/CallPresence.elm:225-245` | — |
| D103 | Join call in More when header join is pref-hidden | `PresenceRibbon.tsx:985` (UI) | MISSING | — | voiceEntry off = no room join |
| D104 | Group-control indicator | `PresenceRibbon.tsx:835` (UI) | FULL | `View/RoomHeader.elm:481` | — |
| D105 | People toggle with count + aria-expanded | `PresenceRibbon.tsx:851` (UI) | PARTIAL | `View/Roster.elm:124-152` | narrow only; no aria-expanded |
| D106 | Search button (aria-pressed) | `PresenceRibbon.tsx:875` (UI) | FULL | `View/RoomHeader.elm:200`; `App.elm:39553` | — |
| D107 | Inbox in header | `PresenceRibbon.tsx:895` (UI) | FULL | `View/Topbar.elm:50` | relocated |
| D108 | More › Alerts All/@/Mute | `PresenceRibbon.tsx:953` (UI) | FULL | `View/RoomHeader.elm:248`; `App.elm:39311` | no roving keys |
| D109 | More › AI policy badge | `PresenceRibbon.tsx:956` (UI) | CORE-ONLY | `AiPolicy.elm` (never imported) | prop never read |
| D110 | More › Search messages (phones) | `PresenceRibbon.tsx:576` (UI) | FULL | `View/RoomHeader.elm:253` | — |
| D111 | More › Invite friends | `PresenceRibbon.tsx:1008` (UI) | FULL | `View/RoomHeader.elm:261`; `App.elm:41757` | — |
| D112 | More › Room settings | `PresenceRibbon.tsx:1030` (UI) | FULL | `View/RoomSettings.elm:61` | — |
| D113 | More › Room control desk | `PresenceRibbon.tsx:1048` (UI) | PARTIAL | see D15 | — |
| D114 | More › Room care (3–30) | `PresenceRibbon.tsx:1071` (UI) | FULL | `View/Stewardship.elm:24`; `View/RoomSettings.elm:755` | relocated |
| D115 | More › Room ledger | `PresenceRibbon.tsx:1093` (UI) | PARTIAL | `View/RoomSettings.elm:1097` | not in More |
| D116 | More › Mute/Unmute room | `PresenceRibbon.tsx:1111` (UI) | FULL | `View/Notify.elm:72`; `App.elm:14703` | via Alerts "Mute" |
| D117 | More › Hide/Show room (+toast) | `PresenceRibbon.tsx:1147` (UI) | MISSING | — | — |
| D118 | More › Leave room → confirm sheet | `PresenceRibbon.tsx:1192`; `HarborConfirmSheet.tsx` (UI) | PARTIAL | `App.elm:12982` `/part` | slash only, no confirm |
| D119 | More › Export transcript (txt) | `PresenceRibbon.tsx:1215` (UI) | PARTIAL | `App.elm:13017,14597` `/export` | slash only |
| D120 | More › Pictures, files, links | `PresenceRibbon.tsx:1263` (UI) | FULL | `View/RoomHeader.elm:332`; `App.elm:38409` | — |
| D121 | More › Pinned messages (count) | `PresenceRibbon.tsx:1285` (UI) | FULL | `View/RoomHeader.elm:293` | — |
| D122 | More › Jump to date | `PresenceRibbon.tsx:594` (UI) | FULL | `View/RoomHeader.elm:358`; `App.elm:38652` | — |
| D123 | More › Mark as read (when unread) | `PresenceRibbon.tsx:1305` (UI) | PARTIAL | `App.elm:13004` `/read` | slash only |
| D124 | More › "Do not disturb is on" → Preferences | `PresenceRibbon.tsx:1328` (UI) | MISSING | — | — |
| D125 | DM More › media + jump to date | `PresenceRibbon.tsx:1365,1378` (UI) | FULL | `View/RoomHeader.elm:276-278` | Elm adds DM call |
| D126 | DM More › Mute/Unmute DM (+toast) | `PresenceRibbon.tsx:1383` (UI) | CORE-ONLY | `App.elm:31136,31181` no dispatcher | `/mute` is room-only |
| D127 | DM More › Close conversation → confirm | `PresenceRibbon.tsx:1428`; `HarborConfirmSheet.tsx:69` (UI) | MISSING | — | — |
| D128 | More › You account chip | `PresenceRibbon.tsx:1475` (UI) | FULL | `View/Topbar.elm:104-160` | identity chip |
| D129 | More menu roving arrows/Home/End, first-item focus | `PresenceRibbon.tsx:535-552` (UI) | PARTIAL | `View/RoomHeader.elm:234` | group of buttons; Escape/scrim only |
| D130 | Header connection indicator (live) | `PresenceRibbon.tsx:1528` (UI) | FULL | `View/Topbar.elm:72` | relocated |
| D131 | Topic filter bar (All / #topic + unread) | `TopicChip.tsx:124`; `MessageView.tsx:1838` (UI, pref) | FULL | `View/Thread.elm:917` | transcript mapper |
| D132 | Topic chip "Split" | `TopicChip.tsx:96` (DEAD: onSplit never passed) | N/A | — | — |
| D133 | Home title (What did you miss? / quiet) | `home/HomeBriefingView.tsx:289` (UI) | FULL | `View/Home.elm:75`; `Home.elm:327` | — |
| D134 | Offline local-memory note (queued sends/drafts/topic drafts) | `HomeBriefingView.tsx:291`; `homeController.ts:361` (UI) | MISSING | — | — |
| D135 | Catch-up signal strip | `HomeBriefingView.tsx:192,296` (UI) | FULL | `View/Home.elm:76,125` | — |
| D136 | Caught-up note | `HomeBriefingView.tsx:299` (UI) | FULL | `View/Home.elm:81` | — |
| D137 | Inbox totals + source label (live / saved on device) | `HomeBriefingView.tsx:320` (UI) | PARTIAL | `View/Home.elm:146` | no source label |
| D138 | Mark all caught up + polite announce + focus | `home/HomeMarkCaughtUp.tsx:20-57` (UI) | FULL | `View/Home.elm:148,86`; `App.elm:39083,30694` | no focus move |
| D139 | Mentions / Unread tiers (avatar, meta, rel. time, count) | `HomeBriefingView.tsx:334,356,99` (UI) | PARTIAL | `View/Home.elm:163-223` | no relative time |
| D140 | Row resumes at first-unread boundary (focusMessage) | `homeController.ts:878,899` (UI) | PARTIAL | `App.elm:39108`; `Home.elm:285` | aria promises boundary; select marks read first |
| D141 | Invites tier (INVITE → Join) | `HomeBriefingView.tsx:378`; `lib/catchup/homeInbox.ts:49` (UI) | MISSING | — | — |
| D142 | Continue reading (resume points) | `HomeBriefingView.tsx:396`; `lib/catchup/resumePoints.ts` (UI) | MISSING | — | — |
| D143 | Offline catch-up from device memory | `homeController.ts:376-424,860` (auto) | MISSING | — | catchUpMemory absent |
| D144 | Outbox journal + Try sending now | `HomeBriefingView.tsx:427` (UI) | FULL | `View/Home.elm:226-258` | — |
| D145 | Outbox row states (admitted/uncertain/expiring) | `HomeBriefingView.tsx:440-448` (UI) | PARTIAL | `View/Home.elm:259-273` | age label only |
| D146 | Outbox row Open | `HomeBriefingView.tsx:457` (UI) | MISSING | — | — |
| D147 | Outbox row Remove (confirm) | `HomeBriefingView.tsx:465` (UI) | PARTIAL | `App.elm:40351` PrefsOutboxRemove (Preferences) | not on Home |
| D148 | "On this device" cold-memory cards | `HomeBriefingView.tsx:486` (UI) | MISSING | — | — |
| D149 | Formation strip (founder/joiner: Open, Reshare) | `HomeBriefingView.tsx:514`; `home/HomeFormationStrip.tsx`; `lib/formation/*` (UI) | MISSING | — | — |
| D150 | Quiet state + Browse / Start a room | `HomeBriefingView.tsx:525` (UI) | FULL | `View/Home.elm:294-307` | — |
| D151 | Your rooms: Joined (≤12, Open) | `HomeBriefingView.tsx:221,552` (UI) | FULL | `View/Home.elm:325-371` | Elm adds DM cards |
| D152 | Your rooms: Recently visited (Join) | `HomeBriefingView.tsx:253` (UI) | MISSING | — | joinHistory absent |
| D153 | Welcome name / home tip / invite / recaps / more activity | `HomeView.tsx:20-32` props unrendered (DEAD) | N/A | `View/Home.elm:74,113,115` | Elm renders greeting/coach/invite |
| D154 | CatchUpSummary, MarkAllCaughtUp components | `CatchUpSummary.tsx`, `MarkAllCaughtUp.tsx` (DEAD) | N/A | — | — |
| D155 | Since-you-left digest card in room | `SinceDigestCard.tsx:13`; `MessageView.tsx:2077` (UI) | MISSING | — | — |
| D156 | "Say hi" coach in composer (guest room landing) | `Composer.tsx:1963`; `lib/firstHour/firstHour.ts:108` (UI) | PARTIAL | `View/Home.elm:375,429` | empty rooms only; any guest |
| D157 | Coach dismissal persisted | `firstHour.ts:90` (UI) | FULL | `App.elm:39086` | — |
| D158 | Composer autofocus on first-hour room landing | `firstHour.ts:125`; `Composer.tsx:689` (auto) | MISSING | — | — |
| D159 | Empty-room intro | `MessageView.tsx:2060` (UI) | FULL | `View/Home.elm:408`; `View/Thread.elm:100` | — |
| D160 | Browse rooms: search, Live/A–Z, refresh, status, pills, ledger, Join/Open/Retry, admission, offline | `ChannelBrowser.tsx:20-330` (UI) | FULL | `View/Browser.elm:21-284`; `App.elm:39444-39518` | — |
| D161 | Start a room from browse toolbar / empty state | `ChannelBrowser.tsx:205,240` (UI) | MISSING | — | rail/Home have it |
| D162 | Formation: name, skins, first line, offline, error | `CreateRoomFormation.tsx:208-285` (UI) | FULL | `View/Formation.elm:53-125` | — |
| D163 | Formation: Suggest next hang | `CreateRoomFormation.tsx:257` (UI) | PARTIAL | `View/Formation.elm:94`; `App.elm:39482` | `CreateHangLabelInput` never dispatched → toggle inert |
| D164 | Formation: invitees (3 target, progress) | `CreateRoomFormation.tsx:286-356` (UI) | FULL | `View/Formation.elm:130-175` | — |
| D165 | Formation: friend quick-add chips | `CreateRoomFormation.tsx:295` (UI) | MISSING | `App.elm:721` friends exist | — |
| D166 | Formation: native share | `CreateRoomFormation.tsx:366` (UI) | MISSING | — | no share port |
| D167 | Formation: copy invite receipt + create gate | `CreateRoomFormation.tsx:162,186` (UI) | FULL | `View/Formation.elm:190,220`; `App.elm:39494,39497` | — |
| D168 | Service worker registration (`/sw.js`) | `pwa/serviceWorkerRuntime.ts:35`; `index.tsx:13` (auto) | MISSING | `ports.js:9747` (comment) | registers none |
| D169 | Controller-change reload (once, coordinator-gated) | `serviceWorkerRuntime.ts:36` (auto) | PARTIAL | `ports.js:9914-9933` | only after approve |
| D170 | Update-available strip (deferred copy) | `pwa/UpdateAvailable.tsx:7` (UI) | FULL | `View/Polish.elm:589`; `App.elm:45813` | needs existing SW |
| D171 | PWA readiness / refresh shell / persist storage panel | `PreferencesPanel.tsx:2670,3714` (UI) | MISSING | — | — |
| D172 | A2HS visit memory + prompt capture | `pwa/AddToHomeScreenRuntime.tsx:13` (auto) | FULL | `ports.js:9793,9851` | — |
| D173 | A2HS sheet (gate, iOS copy, Add, Not now) | `pwa/AddToHomeScreenSheet.tsx:34` (UI) | FULL | `View/Polish.elm:501`; `App.elm:45599,45753` | — |
| D174 | OS app badge = unread mentions | `pwa/AppBadgeRuntime.tsx:42`; `routes/AppRoute.tsx:45` (auto) | MISSING | — | — |
| D175 | Attention title "(n) Onyx" | `pwa/AttentionTitleRuntime.tsx:20` (auto) | MISSING | `View.elm:145` | title = room name |
| D176 | First-run notify offer gate | `FirstRunNotifyPrompt.tsx:44` (auto) | FULL | `App.elm:45581`; `View/Polish.elm:449` | — |
| D177 | First-run Turn on (permission + push + toast) | `FirstRunNotifyPrompt.tsx:77,109` (UI) | PARTIAL | `App.elm:45743` | desktop permission only |
| D178 | First-run Not now persisted | `FirstRunNotifyPrompt.tsx:115` (UI) | FULL | `App.elm:45750` | — |
| D179 | Route announcer (polite route label) | `ui/a11y/RouteLifecycle.tsx:126`; `index.tsx:124` (auto) | MISSING | — | — |
| D180 | Skip-to-content on app document | `index.html:70` (UI) | MISSING | `View/PublicFrame.elm:148` | public pages only |
| D181 | SkipLinkSet primitive | `ui/a11y/SkipLinkSet.tsx:67` (DEAD) | N/A | — | — |
| D182 | Self-updating relative `<time>` + ISO title | `components/RelativeTime.tsx`; `ScheduledMessagesSheet.tsx:92` (UI) | FULL | `View/Scheduled.elm:114` | — |
| D183 | Virtual-keyboard inset (mobile) | `lib/mobile/virtualKeyboardOverlay.ts`; `AppShell.tsx:840` (auto) | FULL | `ports.js:9955` | Elm visualViewport works on iOS too |
| D184 | Mobile breakpoint switch (900px) | `lib/mobile/breakpoints.ts:16`; `AppShell.tsx:839` (auto) | FULL | CSS 768px | layout-only |
| D185 | Message bookmarks (add/remove) | `store.ts:9984` (DEAD) | N/A | — | no caller |
| D186 | Channel bookmarks / categories libs | `lib/channel/bookmarks.ts`, `categories.ts` (portable identity only) | N/A | — | account mapper |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- `COVERAGE.md:30` "You hub omits … the Notifications/Preferences hub links" — stale: `View/Nav.elm:323` (Notifications), `:343` (Preferences). "device toggles / language … later slices" — reachable via Appearance (`View/Appearance.elm:232-372`). "no focus trap/Escape" — stale (`View/Sheet.elm`, `App.elm:44335` "you"). "Rooms/Messages drawer reuses the unsectioned rail" — stale (`View/Rail.elm:40-114`).
- `COVERAGE.md:199` "no … `Rooms`·`Messages` collection modes (Elm carries none of … the primary nav yet)" — stale: `View/Rail.elm:40` data-collection + `Nav.elm`.
- `COVERAGE.md:196` "dismissal not persisted (`onyx:first-hour-seen`)" and "first-run notifications prompt not ported" — stale (`App.elm:39086`, `View/Polish.elm:449`). "Invite friends copy" — Home now opens the share sheet; `HomeInviteCopy` (`App.elm:39105`) is CORE-ONLY.
- `COVERAGE.md:224` "Web Push arming stays in the Notifications sheet" — wrong: `WebPushToggle` is dispatched only from the Account panel (`View/Account.elm:476`).
- `View/Formation.elm:10` "friend quick-add row has no Elm friends store yet" — stale (`App.elm:721` friends); "hang label renders once fed" — nothing ever dispatches `CreateHangLabelInput` (`App.elm:39482`), so the visible hang toggle never sends anything (`App.elm:15949`).
- `V3_ROADMAP.md:78` (3.1) lists room care and heatline as todo — understated: Room care via roster header (`View/Stewardship.elm:24`) and Room settings (`View/RoomSettings.elm:755`); hourly pulse in Room settings › Insights (`View/RoomSettings.elm:1096`). Export / mark read are still slash-only (accurate).
- `V3_ROADMAP.md:42-49` / `COVERAGE.md:196` treat welcome, recaps and invite friends as oracle Home features. The oracle never renders them: `HomeBriefingView.tsx:23-35` props are unused. Elm's greeting, coach and invite are additions. Duplicate status-less rows for 1.1–1.6 at `V3_ROADMAP.md:43-49`.
- `View/Toast.elm:3` "mirroring `primitives/Toast.tsx`": the oracle never mounts that toaster, so parity tests are against a surface no Solid user saw.

#### Elm better than Solid
- Toasts actually render, with Undo and Tick-driven expiry (`View/Toast.elm:22`, `App.elm:10526`). Solid never mounts a toaster.
- The offline-memo toast fires (`App.elm:20717`). The Solid listener reads `detail.from` while the store sends `channel` (`store.ts:10937`).
- Unread/mention badges on the Rooms/Messages nav items (`View/Nav.elm:103,205`).
- On phones a conversation opens as a pushed page with a back button showing how many others are waiting (`View/RoomHeader.elm:137`).
- Rail extras: room colour labels (`View/Rail.elm:376`; Solid never renders `channelColors`), call presence count (`:409`), friend presence dot on DMs (`:507`), DM time stamp.
- Home: greeting, quick-start coach, Invite friends and DM cards (`View/Home.elm:74,113,115,334`). Solid computes these but drops them.
- Room header: topic More/Less expander (`View/RoomHeader.elm:441`); the voice chip shows faces and returns to an active call (`View/CallPresence.elm:160`); the event line adds Join call and op Clear (`View/RoomSettings.elm:954,970`).
- Time scrubber is always reachable from More (`View/Polish.elm:246`), not hidden behind a pref.
- The keyboard inset uses visualViewport (`ports.js:9955`), so it also works on iOS Safari. Solid's VirtualKeyboard API is Chromium-only.

#### Gaps (ranked by user impact)
- [High] Hide room / Close DM conversation (D39, D44, D117, D127): add owner-keyed `hiddenRooms`/`closedConversations` sets to `App` (save port like starred), filter them in `Sidebar.sections`, add More items in `View/RoomHeader.moreMenu`, and auto-reveal/reopen in the PRIVMSG fold.
- [High] Leave room from the header with a confirm step (D118): add `RoomLeaveAsk`/`RoomLeaveConfirm` Msgs reusing the `/part` fold, a `View.Sheet` confirm, and a More item.
- [High] App badge + attention title (D174, D175): add an `attentionSet` port (`setAppBadge`/`clearAppBadge` in `ports.js`) fed from mention totals, and prefix `View.documentTitle` with "(n)".
- [High] Service worker registration (D168, D169): register `/sw.js` in `ports.js` `wirePolish` (`updateViaCache:'none'`). Today offline shell, update detection and Web Push all depend on a worker the Elm build never installs.
- [High] Home catch-up depth (D141–D143, D152): add `Home.resumePoints`, an invites tier from INVITE notifications, recently visited rooms (persisted `joinHistory`) and offline vault-backed catch-up in `View/Home.elm`.
- [Med] Room folders (D36, D37): folder state in `App`, grouping plus collapse in `Sidebar.sections`/`View/Rail.elm`, management in the Account panel.
- [Med] DM mute UI (D126): dispatch the existing `MuteDm`/`UnmuteDm` from a DM More item in `View/RoomHeader.moreMenu`.
- [Med] Mark as read / Export transcript / Room ledger in More (D115, D119, D123): buttons that reuse the `/read` and `/export` folds (`App.elm:13004,14597`) plus a ledger link.
- [Med] Since-you-left digest card (D155): port `sinceDigest` into `View/Thread.elm`, shown above the unread divider.
- [Med] Web Push arming in the Notifications sheet and first-run Turn on (D87, D177): route `Polish.NotifyEnable` and the sheet toggle through `WebPushToggle`.
- [Med] Calm presets and quiet hours (D29, D52): `Notify` tiers plus a radiogroup in `View/Notify.elm`.
- [Med] Join a room by name in the rail (D45): an input in `View/Rail.elm` dispatching the `/join` fold.
- [Med] Context rail / desktop People toggle (D12, D14): optional column-4 rail and a roster hide toggle with `aria-expanded`.
- [Med] Formation hang label is inert (D163): feed `CreateHangLabelInput` from `ports.js` (next-Saturday label), or drop the toggle.
- [Med] Activity / server-log view (D18, D33): render `serviceLog` as a read-only "Activity" rail entry and view.
- [Low] Route announcer and app skip link (D179, D180): live region in `View.elm` keyed on route, and a skip link in `appFrame`.
- [Low] Roving keys in the sidebar and More menu (D46, D129): `ports.js` roving handler on `[data-sidebar-item]` / menu items.
- [Low] Inbox extras (D73, D75, D80, D82, D83): summary live region, ledger links, follow-topic jump through `ChannelTopicSelect`, dismiss focus hand-off.
- [Low] Header copy-name button, DND indicator, AI-policy badge (D93, D124, D109): wire `AiPolicy.parseAiPolicyProp` into the room props, show it in More, and add a `ClipboardCopy` on the h2.
- [Low] Formation friend chips and native share (D165, D166); browse-sheet Start button (D161); outbox Open/Remove on Home (D146, D147); PWA readiness panel (D171); animated background (D24); YouHubNav (D62); collection counts and network label (D28, D42).

### E — Conversation — transcript, message rendering, menus, composer, search, media, threads, topics

Solid walked: `src/shell/MessageView.tsx` (whole file), `messageWindow.ts`, `threadIndex.ts`, `message/{MessageText,MessageMenu,BlockKitModal,BlockKitActionConfirmation}.tsx`, `message/rowGesture.ts`, `Composer.tsx` (whole file), `TypingIndicator`, `BoostBar`, `PinnedMessages`, `JumpToDateSheet`, `TimeScrubber`, `ScheduledMessagesSheet`, `search/MessageSearch.tsx` + `useMessageSearch.ts`, `RoomMediaIndex`, `ProvenanceBadge`, `AiPolicyBadge`, and the listed `src/lib/*` modules (import-graph checked for dead code).
Elm checked: `View/Thread.elm` (whole file), `View/Composer.elm` (whole), `View/MessageText.elm`, `MessageText.elm`, `ComposerAssist.elm`, `Emoji.elm`, `Upload.elm`, `View/Polish.elm`, `View/Search.elm`, `View/Pins.elm`, `View/Media.elm`, `View/Scheduled.elm`, `View/Boost.elm`, `TranscriptRows.elm`, `TopicRead.elm`, `AiPolicy.elm`, the relevant `App.elm` folds and the `ports.js` scroll/upload/translate bridges. Elm paths drop the `elm/src/` prefix. Slash verbs, palette entries and global chords are left to other mappers.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| E1 | Chronological render, with a stable re-sort when a replay arrives out of order | `src/shell/MessageView.tsx:283` (auto) | FULL | `View/Thread.elm:114` | Elm buffer is newest-first and gets reversed at render time |
| E2 | Consecutive-author grouping (same nick, under 5 min, non-system) | `MessageView.tsx:253` (auto) | FULL | `TranscriptRows.elm:108` | Compact density never groups (Elm-only layout) |
| E3 | Group head: avatar, nick tint, author name | `MessageView.tsx:2267` (UI) | FULL | `View/Thread.elm:501-541` | |
| E4 | Row clock in the local zone with the 12h/24h pref | `MessageView.tsx:168` (pref) | FULL | `App.elm:1934`, `View/Thread.elm:498` | 12h is a fixed English `h:MM AM/PM` |
| E5 | Row accessible label (queued/edited/mention flags, never ciphertext) | `MessageView.tsx:190` (auto) | FULL | `App.elm:8389`, `View/Thread.elm:565` | |
| E6 | Day dividers: Today / Yesterday / long date | `MessageView.tsx:219,2152` (auto) | FULL | `View/Thread.elm:249,1483` | Fixed English, not locale-rendered |
| E7 | "New messages" divider above the captured unread boundary | `MessageView.tsx:2160` (auto) | FULL | `View/Thread.elm:259`, `App.elm:30663` | |
| E8 | System event rows (join/part/quit/kick/mode/topic/nick), hidden by the hide-events pref | `MessageView.tsx:2173` (auto/pref) | FULL | `View/Thread.elm:299-309` | |
| E9 | Deleted/redacted placeholder "[message deleted]" | `MessageView.tsx:624` (auto) | FULL | `App.elm:291` | |
| E10 | Locked E2EE placeholder (ciphertext never painted) | `MessageView.tsx:612,626` (auto) | FULL | `App.elm:291-322`, `View/Thread.elm:556` | |
| E11 | Inbound `/me` action rows `* nick text` | `MessageView.tsx:627` (DEAD for inbound) | N/A | `src/lib/store/store.ts:12684` `break`; `App.elm:34737` | Both clients swallow inbound CTCP ACTION |
| E12 | Webhook JSON NOTICE flattened to IRC-safe text | `MessageView.tsx:630` (auto) | FULL | `App.elm:34789` | Done at fold time instead of render time |
| E13 | Queued/pending marker | `MessageView.tsx:2285` (auto) | FULL | `View/Thread.elm:576-583` | Elm adds "delivery uncertain" |
| E14 | Mention/keyword row highlight | `MessageView.tsx:2238` (auto) | FULL | `View/Thread.elm:560` | |
| E15 | Edited marker | `MessageView.tsx:2288` (auto) | FULL | `View/Thread.elm:584` | |
| E16 | Local edit history: expandable list of prior versions kept on this device | `MessageView.tsx:649-711` (UI) | PARTIAL | `View/Thread.elm:2150` | Only a title tooltip with "N revisions"; no list of prior bodies |
| E17 | Reply-context line (sanitized, clipped to 80 chars) | `MessageView.tsx:2292` (auto) | FULL | `View/Thread.elm:2279` | |
| E18 | Thread indicator opens the thread panel | `MessageView.tsx:576,2306`; `threadIndex.ts` (UI) | FULL | `View/Thread.elm:699`, `App.elm:42666` | |
| E19 | Thread panel: parent, replies log, missing-parent and empty states | `MessageView.tsx:735-807` (UI) | FULL | `View/Thread.elm:722-860` | Elm adds a reply count |
| E20 | Reply from the thread panel (closes the sheet, arms the reply) | `MessageView.tsx:1567` (UI) | FULL | `View/Thread.elm:870`, `App.elm:42674` | |
| E21 | Tap-to-reveal action bar; Enter/Space on a focused row | `MessageView.tsx:1637,1648` (UI) | PARTIAL | `View/Thread.elm:569` | Rows are not tab stops and Enter/Space do not reveal; `:focus-within` covers touch |
| E22 | Right-click on a row opens the ⋯ menu | `MessageView.tsx:2209` (UI) | PARTIAL | `View/Thread.elm:454` | Only a touch `contextmenu` opens it; mouse right-click keeps the native menu |
| E23 | Swipe-to-reply (touch, 72px arm, spring back) | `message/rowGesture.ts:14`; `MessageView.tsx:2213` (UI) | MISSING | — | No row gesture handling |
| E24 | Long-press (450ms) opens the menu | `rowGesture.ts:14` (UI) | PARTIAL | `View/Thread.elm:454` | Depends on the browser firing `contextmenu` on touch; iOS Safari does not |
| E25 | Hover/focus quick-action toolbar plus the ⋯ trigger | `message/MessageMenu.tsx:652-745` (UI) | FULL | `View/Thread.elm:390-446,630` | Elm bar is React/Reply/Reply-in-thread; Copy moved into the menu |
| E26 | Device-local collapse filter (hide one nick's lines) | `MessageView.tsx:945` (auto) | FULL | `View/Thread.elm:115,1352` | |
| E27 | "Hiding messages from … Show all" banner | `MessageView.tsx:1955-1982` (UI) | MISSING | `App.elm:38856` | Hidden rows take their menus with them, so a hidden sender can't be restored this session |
| E28 | Empty-feed states (room "Say hi"/"Still waters", DM) | `MessageView.tsx:1983-2024` (UI) | FULL | `View/Home.elm:408`, `View/Thread.elm:82-101` | |
| E29 | Skeleton while history loads | `MessageView.tsx:2027` (auto) | MISSING | — | |
| E30 | "Very beginning of the conversation" intro | `MessageView.tsx:2050-2073` (auto) | FULL | `View/Thread.elm:149-155` | Scheduled-event line sits in the header, not the intro |
| E31 | Offline/connecting banner | `MessageView.tsx:1808` (auto) | FULL | `View/Topbar.elm:249` | One global banner with different copy |
| E32 | Screen-reader conversation brief ("Current conversation: …") | `MessageView.tsx:1823` (auto) | MISSING | — | |
| E33 | `role=log` "Message history" live region | `MessageView.tsx:1897` (auto) | FULL | `View/Thread.elm:193-202` | |
| E34 | aria-live muted while the window grows or the conversation switches | `MessageView.tsx:1219,1770` (auto) | MISSING | `View/Thread.elm:196` | Log is always `polite`, so prepends can be re-announced |
| E35 | Stay pinned to the bottom as rows arrive | `MessageView.tsx:1473` (auto) | FULL | `ports.js:3322,3326-3329` | |
| E36 | Keep the scroll anchor when older rows prepend | `MessageView.tsx:1307` (auto) | FULL | `ports.js:3330-3333` | |
| E37 | Open a conversation on its unread divider | `MessageView.tsx:1500` (auto) | FULL | `ports.js:3368-3373` | |
| E38 | Jump-to-latest pill with an "N new" count | `MessageView.tsx:2384-2404` (UI) | FULL | `View/Thread.elm:659`, `App.elm:39269` | |
| E39 | Bounded render window plus "Show earlier" (grow, then page) | `MessageView.tsx:1319,2101`; `messageWindow.ts` (UI) | FULL | `View/Thread.elm:137`, `App.elm:39196`, `MessageWindow.elm` | |
| E40 | "Back to latest" when a historical page hides newer rows | `MessageView.tsx:2393` (UI) | FULL | `View/Thread.elm:167` | |
| E41 | Window pages to the active search match | `MessageView.tsx:1675` (auto) | FULL | `App.elm` `threadAnchorIndex` searchIdx | |
| E42 | Landing on a target message (?at=, pins, media, vault, review): page, scroll, focus, 1.4s pulse | `MessageView.tsx:1528-1554` (auto) | CORE-ONLY | `App.elm:13638,528` | `historyLanding` is set but nothing reads it; anchor passes `landingIndex = Nothing` |
| E43 | Scroll and pulse to the active visible search match | `search/MessageSearch.tsx:85,419` (UI) | PARTIAL | `View/Thread.elm:559` | Highlight class only; no row scroll in `ports.js` |
| E44 | Page older history from the server | none (DEAD) | N/A | `App.elm:39196`, `View/Thread.elm:137` | Elm has the rewind fold, but its button only renders when hiddenBefore>0, so it is unreachable |
| E45 | Reader-memory strip (device memory, reviewed span, context trail, other rooms, Start/New/Latest/Home/Find text) | `MessageView.tsx:426-561,2081` (pref readerMode) | MISSING | `Prefs.elm:605` | The pref is stored but has no UI |
| E46 | In-room "Since you left" digest with "Review unread" (records review, clears divider) | `MessageView.tsx:1101,1394,2074` (UI) | MISSING | — | Moved to Home by design (V3_ROADMAP 1.4a); the divider review-clear is also gone |
| E47 | Typing indicator line | `TypingIndicator.tsx:39,105` (auto) | FULL | `App.elm:8430`, `View/Thread.elm:161` | 3 typers read "3 people…" instead of three names |
| E48 | Transcript density | `preferences.ts:49` (pref, CSS only) | FULL | `View/Thread.elm:190,543`, `View/Appearance.elm:167` | Elm Compact is an IRC-style line layout |
| E49 | Topic filter chips (All plus per-topic, with unread badge) | `MessageView.tsx:1838` (pref topicTools) | FULL | `View/Thread.elm:901-926,1250` | |
| E50 | Topic-chip unread counts from the per-topic read ledger | `MessageView.tsx:1072-1099` (auto) | PARTIAL | `View/Thread.elm:1297`, `App.elm:35464` | Chips count from the divider/first-unread only; the ledger feeds only the sidebar cursor |
| E51 | Start a new topic (validated, max 50 chars) | `MessageView.tsx:1617,1845` (UI) | FULL | `View/Thread.elm:983`, `App.elm:42710` | Folded into a "Topics" disclosure |
| E52 | Forum view toggle | `MessageView.tsx:1863` (UI) | FULL | `View/Thread.elm:1008`, `App.elm:42731` | |
| E53 | Pin forum (persisted), forum auto-opens when pinned | `MessageView.tsx:990,1584,1872` (UI/auto) | FULL | `View/Thread.elm:1015`, `App.elm:42777,35303` | |
| E54 | Forum cards (count, unread, latest, preview); open focuses the chip | `MessageView.tsx:1602,1905-1953` (UI) | FULL | `View/Thread.elm:1048-1162`, `App.elm:42750` | |
| E55 | Follow room/topic toggle and per-card Follow | `MessageView.tsx:1882,1939` (UI) | FULL | `View/Thread.elm:1031,1138`, `App.elm:42804` | |
| E56 | Topic-tools on/off preference control | `PreferencesPanel` (UI) | CORE-ONLY | `Prefs.elm:617` | Elm reads the pref but nothing sets it |
| E57 | Boost chips: toggle own, aria-pressed, reactor title (4 + N) | `BoostBar.tsx:9,50-67` (UI) | FULL | `View/Thread.elm:2219-2249`, `App.elm:8360` | |
| E58 | Reaction density rendering (full / compact +N / counts-only / hidden) | `BoostBar.tsx:33-82`; `reactions/density.ts:22` (pref) | FULL | `View/Thread.elm:2165-2200`, `App.elm:8312` | |
| E59 | Reaction-density preference control | `PreferencesPanel.tsx:3628` (UI) | CORE-ONLY | `Prefs.elm:619` | No Elm view sets it |
| E60 | "Add a boost" opener on the boost bar | `BoostBar.tsx:84` (DEAD: `MessageView.tsx:2303` never passes `onAdd`) | N/A | `View/Thread.elm:423,2203` | Reachable only in Elm |
| E61 | Reaction picker (search, grid, "no matches", Escape) | `MessageMenu.tsx:655-707` (UI) | FULL | `View/Thread.elm:2027-2101`, `App.elm:38602-38640` | Search field is not auto-focused |
| E62 | Menu capability gating (live, own, edit/redact caps, channel, encrypted) | `MessageMenu.tsx:109` (auto) | FULL | `App.elm:7926`, `View/Thread.elm:1542` | |
| E63 | Reply | `MessageMenu.tsx:347,710` (UI) | FULL | `View/Thread.elm:429,1622`, `App.elm:38506` | Composer focus: see E114 |
| E64 | Copy text, with toast and sr status | `MessageMenu.tsx:449,472,721` (UI) | FULL | `View/Thread.elm:1640`, `App.elm:38728,39901` | |
| E65 | Quote in composer (prefix, toast, focus) | `MessageMenu.tsx:799` (UI) | PARTIAL | `View/Thread.elm:1653`, `App.elm:38459` | Sends `m.body`, so decrypted E2EE rows quote the ciphertext envelope; no composer focus |
| E66 | Copy moment link | `MessageMenu.tsx:491,826` (UI) | FULL | `View/Thread.elm:1658`, `App.elm:38936` | |
| E67 | Room ledger link | `MessageMenu.tsx:838` (UI) | FULL | `View/Thread.elm:1667` | |
| E68 | Search this text (first 8 words, URLs stripped) | `MessageMenu.tsx:151,512,850` (UI) | PARTIAL | `View/Thread.elm:1681`, `App.elm:38746` | Seeds the whole message text, not the suggested query |
| E69 | Translate on this device (pending/done/busy/failed, 4-concurrent cap) | `MessageMenu.tsx:378,862`; `intelligence/translateMessage.ts` (UI) | FULL | `View/Thread.elm:1695`, `App.elm:38773`, `ports.js:4016` | |
| E70 | Translation panel: Retry / Copy translation / Dismiss / copy status | `MessageMenu.tsx:1005-1073` (UI) | FULL | `View/Thread.elm:1855-1971` | |
| E71 | Device-provenance badge on the translation | `MessageMenu.tsx:1012` (UI) | MISSING | `View/Thread.elm:1884` | Header shows only the language label |
| E72 | "On-device translation is unavailable" note | `MessageMenu.tsx:1000` (UI) | FULL | `View/Thread.elm:1866` | |
| E73 | Translation target language and readiness probe | `intelligence/localLanguage.ts`; `YouSettings` (UI) | FULL | `View/Appearance.elm:372`, `App.elm:38751`, `ports.js:3985-4012` | |
| E74 | Start topic from here (label suggestion, warning toast, arms reply) | `MessageMenu.tsx:134,353,875` (UI) | FULL | `View/Thread.elm:1722`, `App.elm:38895` | |
| E75 | Edit own message (edit cap, plain msg, not encrypted) | `MessageMenu.tsx:372,887` (UI) | FULL | `View/Thread.elm:1731`, `App.elm:38521` | |
| E76 | Pin/Unpin (ops, channels) | `MessageMenu.tsx:560,899` (UI) | FULL | `View/Thread.elm:1740`, `App.elm:38844` | |
| E77 | Ignore/Unignore sender, with toast | `MessageMenu.tsx:911` (UI) | FULL | `View/Thread.elm:1766`, `App.elm:31090` | Elm toast offers Undo |
| E78 | Hide/Show sender in this feed, with toast | `MessageMenu.tsx:951` (UI) | FULL | `View/Thread.elm:1803`, `App.elm:38856` | One-way in practice (E27) |
| E79 | Delete for everyone with inline confirm (Keep/Delete) | `MessageMenu.tsx:522-547,746,985` (UI) | FULL | `View/Thread.elm:1832,1990`, `App.elm:38718,42849` | Focus does not move to "Keep message" |
| E80 | Menu keyboard: focus first item on open, Arrow/Home/End roving, focus restore | `MessageMenu.tsx:592-638,792` (UI) | MISSING | `View/Thread.elm:2106` | Escape only; the menu is not on the overlay-focus helper |
| E81 | Menu and picker mutually exclusive; reopening resets the translation | `MessageMenu.tsx:576` (auto) | FULL | `App.elm:38567-38624` | |
| E82 | Links: http(s) only, new tab, noopener | `message/MessageText.tsx:917` (auto) | FULL | `View/MessageText.elm:84`, `MessageText.elm:319` | |
| E83 | URL scan trims trailing punctuation | `format/parseMessage.ts:100` (auto) | FULL | `MessageText.elm:390,431` | |
| E84 | @mention token, self-mention styled | `MessageText.tsx:939` (auto) | FULL | `View/MessageText.elm:90` | |
| E85 | #channel button opens or joins the room | `MessageText.tsx:954`; `MessageView.tsx:2300` (UI) | FULL | `View/MessageText.elm:104`, `App.elm:39060` | |
| E86 | mIRC bold/italic/underline/strike/mono/colour/hex/reverse/reset | `MessageText.tsx:776`; `format/ircFormat.ts` (auto) | FULL | `MessageText.elm:79-298` | |
| E87 | Markdown bold/italic/strike/inline code | `MessageText.tsx:867-899` (auto) | FULL | `View/MessageText.elm:62-71`, `MessageText.elm:553-583` | |
| E88 | Code block with language label | `MessageText.tsx:998` (auto) | FULL | `View/MessageText.elm:34` | |
| E89 | Blockquote `> ` | `MessageText.tsx:1014` (auto) | FULL | `View/MessageText.elm:46` | |
| E90 | Spoiler `\|\|…\|\|`, click or keyboard to reveal | `MessageText.tsx:728` (UI) | FULL | `View/MessageText.elm:74` | Native `details`; label stays "Reveal spoiler" once open |
| E91 | Newlines rendered as line breaks | `MessageText.tsx:853` (auto) | FULL | `View/MessageText.elm:57` | |
| E92 | `:shortcode:` emoji | `MessageText.tsx:970`; `format/emoji.ts:9` (274 codes) (auto) | PARTIAL | `View/MessageText.elm:114`, `Emoji.elm` | Only the 28 curated codes resolve; `:smile:` and most others stay literal |
| E93 | 4000-char parse cap | `parseMessage.ts:86` (auto) | FULL | `MessageText.elm:34` | |
| E94 | Attachment receipts: inline image/video or file chip with size | `MessageText.tsx:205-254` (auto) | FULL | `View/Thread.elm:2677-2731` | |
| E95 | Inline media unfurl for direct image/video/audio links (pref, https, blocklist) | `MessageText.tsx:256,1194` (pref) | FULL | `View/Thread.elm:2308-2358` | |
| E96 | Consent click before loading cross-origin media | `MessageText.tsx:292` (UI) | FULL | `View/Thread.elm:2431` | Consent keyed per row |
| E97 | Media error falls back to an "open attachment" link | `MessageText.tsx:307` (auto) | FULL | `View/Thread.elm:2453` | |
| E98 | Image lightbox (focus trap, Escape, Save, Close) | `MessageText.tsx:145` (UI) | FULL | `View/Thread.elm:2484-2528`, `App.elm:38456` | |
| E99 | Open Graph link-preview card for the first link | `MessageText.tsx:1063,1176`; `preview/linkPreview.ts` (pref) | PARTIAL | `View/Thread.elm:2535-2658`, `App.elm:35935,36944` | Fetched at fold time; rows restored from the vault never fetch a card |
| E100 | Preview thumbnail: consent click, hide on error | `MessageText.tsx:1131-1158` (UI) | PARTIAL | `View/Thread.elm:2648` | Consent works; a broken thumbnail is not hidden |
| E101 | BlockKit-lite message block (title/text/fields/selects/buttons, safety hint) | `MessageText.tsx:535`; `integrations/blockKitLite.ts:64` (auto) | MISSING | — | `[onyx:block]` payload renders as raw text |
| E102 | BlockKit URL buttons and copy-value buttons (Copied/failed) | `MessageText.tsx:404-503` (UI) | MISSING | — | |
| E103 | BlockKit actions: origin-scoped review dialog, then send | `MessageText.tsx:619-673`; `BlockKitActionConfirmation.tsx:32` (UI) | MISSING | — | |
| E104 | BlockKit modal block ("Inspect structured data") | `message/BlockKitModal.tsx:186` (UI) | MISSING | — | |
| E105 | Extension client actions (open-url/copy-text manifest, audit) | `extensions/clientActions.ts`; `PreferencesPanel.tsx:2522` (UI) | MISSING | — | Preferences/palette surface; listed for completeness |
| E106 | Textarea: Enter sends, Shift+Enter newline, auto-grow | `Composer.tsx:697,902,1742` (UI) | FULL | `View/Composer.elm:98,628` | |
| E107 | Destination and offline state in placeholder and accessible name | `Composer.tsx:368-383` (UI) | PARTIAL | `View/Composer.elm:100-119` | aria-label is just "Message"; DMs don't get the "@" prefix |
| E108 | Compose brief (destination plus state line) | `Composer.tsx:388,1371` (UI) | MISSING | — | |
| E109 | Per-room draft swap on conversation switch | `Composer.tsx:601-635` (auto) | FULL | `App.elm:7758` | |
| E110 | Drafts survive reload (`onyx:composer-drafts`, per owner) with "Saved here" / "Only on this tab" status | `composer/drafts.ts:4`; `Composer.tsx:706,1363` (auto) | MISSING | `App.elm:3424` | Drafts live in memory only |
| E111 | Reply bar (live re-resolve, withdrawn placeholder, Cancel) | `Composer.tsx:293,1415` (UI) | FULL | `View/Composer.elm:300` | |
| E112 | Edit bar (Cancel restores the draft) | `Composer.tsx:1332,1429` (UI) | FULL | `View/Composer.elm:273`, `App.elm:38542` | |
| E113 | Escape order: emoji, schedule, tools, edit, reply | `Composer.tsx:871-900` (UI) | FULL | `View/Composer.elm:606-642,225` | |
| E114 | Composer takes focus when reply/edit/quote arms or a focus is requested | `Composer.tsx:610,656,668` (auto) | MISSING | `App.elm:38506,38521,38459` | None of these folds emits a focus |
| E115 | Topic-mode chip with clear | `Composer.tsx:1341,1398` (UI) | FULL | `View/Composer.elm:386-442` | Elm can also pick any known topic |
| E116 | Typing start/stop (non-slash input; stop on send/cancel) | `Composer.tsx:766-786,1142` (auto) | FULL | `App.elm:38290,38516` | |
| E117 | Slash-suggestion popover (listbox, arrows/Tab/Enter/Escape, hover) | `Composer.tsx:796,1517` (UI) | FULL | `View/Composer.elm:703`, `ComposerAssist.elm:505` | |
| E118 | @ / prefix nick-suggestion popover | `Composer.tsx:821,1544` (UI) | FULL | `View/Composer.elm:725` | |
| E119 | Tab nick cycling at the caret | `Composer.tsx:847`; `composer/nickComplete.ts` (UI) | PARTIAL | `ComposerAssist.elm:398` | Caret isn't tracked, so it only completes at the end of the draft |
| E120 | Combobox ARIA on the field | `Composer.tsx:1761-1776` (UI) | FULL | `View/Composer.elm:655` | |
| E121 | Emoji picker (search, 36 results, insert, Escape back to composer) | `Composer.tsx:729,1573` (UI) | PARTIAL | `View/Composer.elm:760`, `App.elm:38347` | Inserts at the end of the draft, not the caret |
| E122 | Emoji recents/favourites/skin tone/custom emoji | `emojiMemory.ts` (store-only, DEAD) | N/A | — | No Solid UI reads them |
| E123 | Attach button and multi-file picker | `Composer.tsx:1011,1710` (UI) | FULL | `View/Composer.elm:343`, `App.elm:38358`, `ports.js:6908` | |
| E124 | Attachment caps (5 files, 25 MB) with copy | `upload/attachmentCaps.ts:7`; `Composer.tsx:926` (UI) | FULL | `App.elm:35813` | |
| E125 | Paste files from the clipboard | `Composer.tsx:1038` (UI) | MISSING | — | |
| E126 | Drag-and-drop files (drag state) | `Composer.tsx:1045-1062` (UI) | MISSING | — | |
| E127 | Strip photo EXIF/GPS before upload | `upload/photoPolicy.ts:127`; `Composer.tsx:964` (auto) | CORE-ONLY | `Upload.elm:51-52`, `ports.js:6934`, `App.elm:35810` | Strip functions are never called; the raw File is posted |
| E128 | Photo quality (Original/Compact) and "Send original" | `photoPolicy.ts:154,190`; `Composer.tsx:1462-1488` (UI) | MISSING | `Upload.elm:27` | `photoQualityOptions` is unused |
| E129 | Staged file: thumbnail and size | `Composer.tsx:1446-1461` (UI) | PARTIAL | `View/Composer.elm:445` | Name and status only |
| E130 | Upload progress (%, bar) | `Composer.tsx:1489-1495`; `upload/upload.ts:215` (auto) | FULL | `View/Composer.elm:453-480`, `App.elm:38391` | |
| E131 | Remove a staged file (disabled while uploading) | `Composer.tsx:1002,1501` (UI) | PARTIAL | `View/Composer.elm:485` | Always enabled |
| E132 | Staged files cleared/aborted on room or account switch | `Composer.tsx:246-263,1085` (auto) | PARTIAL | `App.elm:9554,7758` | Account switch clears; room switch keeps them, so they send to the newly opened room |
| E133 | Protected-DM attachment refusal | `Composer.tsx:916,1012` (UI) | FULL | `View/Composer.elm:345-366`, `App.elm:38371` | |
| E134 | Offline: attachments/edits refused, commands not queued | `Composer.tsx:1170-1180,1291` (auto) | FULL | `App.elm:35852-35858`, `ComposerSend` fold | |
| E135 | Attachment receipt message (caption plus `[file]` lines) | `upload/attachmentMessage.ts:69`; `Composer.tsx:1263` (auto) | FULL | `App.elm:36100-36126` | Caption on its own line |
| E136 | Send outcomes: refused / may-have-sent copy, draft kept | `Composer.tsx:1302-1316` (auto) | FULL | `View/Thread.elm:579`, `View/Composer.elm:179` | |
| E137 | Blocked-DM send refusal with toast | `Composer.tsx:1158` (auto) | FULL | `App.elm:34500` | |
| E138 | Outbox chrome (queued/failed, retry) | `Composer.tsx:1375-1396` (UI) | FULL | `View/Composer.elm:204-216` | |
| E139 | Composer hint (Enter / Tab / Shift+Enter / paste) | `Composer.tsx:1965` (UI) | MISSING | — | |
| E140 | More tools tray: Send later, Jump to date, Room ledger, slash tip | `Composer.tsx:1843-1927` (UI) | FULL | `View/Polish.elm:83-196` | Elm also has Attach and Emoji |
| E141 | "Insert /" at the caret | `Composer.tsx:508` (UI) | PARTIAL | `App.elm:45722` | Prefixes "/" at the start of the draft |
| E142 | Schedule popover (presets, custom datetime, errors, "View N scheduled") | `Composer.tsx:555-595,1619-1700` (UI) | FULL | `View/Composer.elm:496-596`, `App.elm:37323-37389` | |
| E143 | Schedule disabled reasons | `Composer.tsx:531` (UI) | FULL | `View/Polish.elm:130-142` | |
| E144 | Scheduled sheet: state labels, ledger, cancel/remove uncertain | `ScheduledMessagesSheet.tsx:40-100` (UI) | FULL | `View/Scheduled.elm:23-129`, `App.elm:37296` | |
| E145 | Scheduled auto-dispatch (due + connected, protected/E2EE holds) | `schedule/dispatch.ts:132` (auto) | FULL | `App.elm:12277` | |
| E146 | Search panel takes focus on open and returns it on close | `search/MessageSearch.tsx:404`; `useMessageSearch.ts:235` (UI) | PARTIAL | `View/RoomHeader.elm:208`, `App.elm:39553` | Opens, but focus stays on the trigger |
| E147 | Visible search: count, Previous/Next | `MessageSearch.tsx:563-610` (UI) | FULL | `View/Search.elm:163-182`, `App.elm:39679` | |
| E148 | Search keys: Enter / Shift+Enter / Ctrl+Enter / Escape | `MessageSearch.tsx:453-487` (UI) | FULL | `View/Search.elm:69,422` | |
| E149 | Placeholder variants; input disabled with no conversation and history off | `MessageSearch.tsx:514-519` (UI) | PARTIAL | `View/Search.elm:138` | One placeholder only |
| E150 | "Device history is off" state with "Open history preferences" | `MessageSearch.tsx:620` (UI) | MISSING | — | |
| E151 | Room ledger link in search | `MessageSearch.tsx:611` (UI) | MISSING | — | |
| E152 | Saved searches: save, run, delete, count, persisted, cross-tab | `MessageSearch.tsx:355-700` (UI) | FULL | `View/Search.elm:441-509`, `App.elm:39705-39730`, `ports.js:1460` | |
| E153 | Saved-search error status copy | `MessageSearch.tsx:702` (UI) | MISSING | — | |
| E154 | Recall-term chips | `MessageSearch.tsx:710` (UI) | FULL | `View/Search.elm:202-224` | |
| E155 | Archived server search (button, counts, errors, notices, open result) | `MessageSearch.tsx:726-793` (UI) | FULL | `View/Search.elm:287-405`, `App.elm:39713,39716` | |
| E156 | "E2EE DM search stays on this device" notice | `MessageSearch.tsx:795` (UI) | FULL | `View/Search.elm:410` | |
| E157 | "No matches yet" empty state | `MessageSearch.tsx:801` (UI) | MISSING | — | |
| E158 | Device recall mode (hybrid/exact/semantic) "Advanced" control | `MessageSearch.tsx:807-848` (UI) | PARTIAL | `View/Search.elm:247` | Cycle button only shows once vault hits exist |
| E159 | Vault ("remembered elsewhere") hits open at the message | `MessageSearch.tsx:850-890`; `useMessageSearch.ts:650` (UI) | PARTIAL | `View/Search.elm:233-277`, `App.elm:36978` | Travels by timestamp but never scrolls to the row (E42); shows time only |
| E160 | Provenance badges on search sections | `MessageSearch.tsx:557,639,712,738,854`; `ProvenanceBadge.tsx` (UI) | FULL | `View/Search.elm:55` | |
| E161 | Live status regions and screen-reader key help | `MessageSearch.tsx:893-923` (UI) | PARTIAL | `View/Search.elm:188-193` | No help text and no `aria-keyshortcuts` on the input |
| E162 | Ctrl/Cmd+F opens search without touching the draft | `AppShell.tsx:224` (shortcut) | PARTIAL | `App.elm:39559` | `SearchHotkey` sets `composer = ""`, wiping the visible draft |
| E163 | Jump-to-date sheet (presets, UTC fields, validation, offline/loading notices, Copy moment, ledger) | `JumpToDateSheet.tsx:43-340` (UI) | FULL | `View/Boost.elm:26-230`, `App.elm:38652-38700` | |
| E164 | Jump-to-date openers (composer tools, room More) | `Composer.tsx:498`; `PresenceRibbon.tsx:595` (UI) | FULL | `View/Polish.elm:143`, `View/RoomHeader.elm:365` | |
| E165 | Time scrubber: 24 UTC hour bars, 60s refresh, roving keys, click to travel, date, Copy moment, ledger | `TimeScrubber.tsx:34-321`; `AppShell.tsx:1480` (pref) | FULL | `View/Polish.elm:246-427`, `App.elm:45827-45970` | Opened from room More, not a pref |
| E166 | Pinned-messages drawer opener | `PresenceRibbon.tsx:1286` (UI) | FULL | `View/RoomHeader.elm:325`, `App.elm:39181` | |
| E167 | Pin rows: from / time / state (Deleted/Locked/Loaded) / body | `PinnedMessages.tsx:84,247-275` (UI) | FULL | `View/Pins.elm:149-192` | |
| E168 | Jump to a pin: loaded one lands; unloaded one loads via history (with feedback) | `PinnedMessages.tsx:147-162` (UI) | PARTIAL | `App.elm:39187` `jumpToPinned` | Loaded pins only set the unused landing field (E42) |
| E169 | Unpin from the drawer (ops) | `PinnedMessages.tsx:167,287` (UI) | FULL | `View/Pins.elm:193`, `App.elm:39193` | |
| E170 | Pins context, ledger link, op/non-op empty copy, load feedback | `PinnedMessages.tsx:188-226` (UI) | FULL | `View/Pins.elm:50-146` | |
| E171 | Pins server-provenance badge | `PinnedMessages.tsx:194` (UI) | MISSING | — | |
| E172 | Local DM pins | `dmPins.ts`; `store.ts:16729` (DEAD) | N/A | — | No Solid shell caller |
| E173 | Room media panel (Pictures/Files/Links tabs, loading, retry, empty) | `RoomMediaIndex.tsx:148-200`; `PresenceRibbon.tsx:1557` (UI) | FULL | `View/Media.elm:33-180`, `View/RoomHeader.elm:350` | |
| E174 | Media: picture consent and fallback; links open in a new tab | `RoomMediaIndex.tsx:271-359` (UI) | FULL | `View/Media.elm:197-310` | |
| E175 | Media: jump to the item's message | `RoomMediaIndex.tsx:312,332,376` (UI) | PARTIAL | `App.elm:38452,13761` | Loaded rows only set the unused landing field (E42) |
| E176 | Room AI-policy badge | `AiPolicyBadge.tsx`; `PresenceRibbon.tsx:956` (UI) | CORE-ONLY | `AiPolicy.elm` | Module is never imported |
| E177 | Message multi-select / bulk actions | `store.ts:2110` (DEAD) | N/A | — | No UI caller |
| E178 | `format/byteSize`, `format/duration`, `text/{highlightRanges,mentionParse,truncateMiddle}`, `topics/suggestTopic` | no non-test importers (DEAD) | N/A | — | No search-hit highlight or char counter in Solid either |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- **COVERAGE, Boost/jump-to-date row:** "Narrowings: no `TimeScrubber`; openers are topbar-only (no composer More-tools …)". This is understated: the scrubber exists (`View/Polish.elm:276`, opened from `View/RoomHeader.elm:279`) and the tray has a Jump to date entry (`View/Polish.elm:143`). The same row cites `BoostBar.tsx (onAdd)` as the oracle, but that path is unreachable in Solid (`MessageView.tsx:2303` never passes `onAdd`).
- **COVERAGE, Thread paging row:** "no scroll/DOM coupling (preserve-scroll, aria-live muting, jump pill counts)". Preserve-scroll (`ports.js:3330-3333`) and pill counts (`View/Thread.elm:659`) both exist now. Only the aria-live muting is still missing.
- **COVERAGE, Message render windowing row:** "thread paging state, earlier-messages affordance, and reader handoffs stay ahead". The first two have landed (`View/Thread.elm:137`, `App.elm:39196`). Reader handoffs are still missing (E45).
- **COVERAGE, Message timestamps row:** "clock shows UTC, not the oracle's local zone / 12h preference". Stale: `App.elm:1934` `formatRowClock` uses the `Time.here` zone and `Prefs.Clock`.
- **COVERAGE, Composer assist row:** "the composer stays a single-line `input` … the More tools tray are not ported". Stale: the composer is a textarea with Shift+Enter (`View/Composer.elm:98,628`) and the tray is ported (`View/Polish.elm:43`).
- **COVERAGE, App core/shell row (composer and menu narrowings):** it lists "no per-target drafts", "no message-menu popover Edit entry", "no Escape-to-cancel" and "text buttons instead of icon buttons". All four are now done: `App.elm:7758`, `View/Thread.elm:1731`, `View/Composer.elm:225` and the icon toolbar at `View/Thread.elm:408-419`.
- **COVERAGE, Uploads row:** "EXIF pure byte layer done … EXIF file ops stay ports-side". This is overstated. `ports.js:6934-6960` posts the raw File and `App.elm:35810` says "originals stage as-is", so photos still upload with their EXIF/GPS data.
- **COVERAGE, Uploads/media row:** "loaded jumps focus via the landing machinery". Overstated: `historyLanding` (`App.elm:528`) has no reader, and `threadAnchorIndex` passes `landingIndex = Nothing`. Pin and media jumps therefore don't move the transcript.
- **COVERAGE, translation narrowing:** "no caption-transcript row (no Elm captions yet)". Stale: Elm has captions and caption translation (calls C8, `CallCaptionTranslate`).
- **V3_ROADMAP Phase 2 table:** rows 2.1–2.3 carry no status, but the progress log says rich message text landed. The table is behind (understated). 2.8 BlockKit and 2.9 edit history are correctly listed as deferred; edit history is still only a revision-count tooltip (E16).
- **V3_ROADMAP 7.1:** "Focus traps + Escape + focus restore on every overlay — done … except the image lightbox". Overstated: the message menu, reaction picker, search panel and composer menus have no focus move or restore. COVERAGE row 220 itself lists them as "Not migrated".

#### Elm better than Solid
- **Reply in thread** quick action (`View/Thread.elm:430`) opens the thread panel for any message. Solid only offers the indicator once replies already exist.
- **Add a boost** is reachable from the toolbar and the bar (`View/Thread.elm:423,2203`). The Solid `onAdd` path was never wired.
- **Ignore from the menu** gives an Undo toast (`App.elm:31098-31103`).
- **Delivery uncertain** is shown as a row state (`View/Thread.elm:579`); Solid only shows "Queued".
- **STATUSMSG audience toggle** in the composer (`View/Composer.elm:85-97`); Solid has no equivalent.
- **Unresolved DM key hold** with an explicit "Send unencrypted" consent (`View/Composer.elm:187-195`).
- **Composer topic picker** lets you pick any known conversation, not just clear the current one (`View/Composer.elm:386-442`).
- **Menu header** shows the sender and a preview (`View/Thread.elm:1617`).
- **More tools tray** also carries Attach and Emoji, so the phone bar can be a single row (`View/Polish.elm:115,153`).
- **Time scrubber** is discoverable from room More (`View/RoomHeader.elm:279`); in Solid it is a hidden Preferences toggle.
- **Compact IRC-style density** (`View/Thread.elm:543`).
- **Keyed and lazy rows** (`View/Thread.elm:278-296`).

#### Gaps (ranked by user impact)
- `[High]` **Photo EXIF/GPS leak.** In the `ports.js` `uploadSend`, read the File's bytes, run the JPEG/PNG EXIF strip (mirror `Upload.stripJpegExif`/`stripPngExif`) and post the Blob. Add the Original/Compact picker to `View.Composer.stagedRow`.
- `[High]` **Landing never scrolls (pins, media, vault, ?at=, search).** Feed `model.historyLanding` into `App.threadAnchorIndex` as `landingIndex`. Add a `scrollPolicy` action `"message"` in the `ports.js` scroller (center, focus, pulse) and clear it on arrival.
- `[High]` **Staged attachments follow you to another room.** Clear `model.attachments` (and abort pending sends) in `swapComposerDraft`/`selectChannel` (`App.elm:7758`), or key staged files by target.
- `[High]` **Drafts lost on reload.** Add a `composerDraftsSave`/load port over the owner-scoped `onyx:composer-drafts` slot and render the "Saved here" status in `View.Composer`.
- `[High]` **No paste or drag-drop attachments.** Add `ports.js` paste/drop listeners on `#shell-composer-input` and the composer form that hand held files to `uploadPicked`, plus a drag-state class.
- `[Med]` **Hidden senders can't be restored.** Add the "Hiding messages from … Show all" banner to `View.Thread.channelTranscript` with a new `CollapsedShowAll` Msg.
- `[Med]` **Quote inserts ciphertext for E2EE rows.** Pass `App.loadedActionText m` at `View/Thread.elm:1653`, and emit `PrefsFocus {id="shell-composer-input"}` from the `MessageQuote` fold.
- `[Med]` **Composer focus on reply/edit/quote.** Emit `PrefsFocus` for the composer from the `ReplyArm`, `EditArm` and `MessageQuote` folds.
- `[Med]` **Message menu keyboard pattern.** Register `.onyx-msg-menu` and `.onyx-react-picker` with `installOverlayFocus` and add Arrow/Home/End roving.
- `[Med]` **Ctrl/Cmd+F wipes the draft.** Drop `composer = ""` from the `SearchHotkey` fold (`App.elm:39559`).
- `[Med]` **BlockKit-lite.** Port `blockKitLite.ts` as `BlockKit.elm`, render it in `View.Thread.messageBody`, and route actions through a `View.Sheet` review dialog (`BlockKitStage`/`Confirm` Msgs).
- `[Med]` **Swipe-to-reply and iOS long-press.** Add a pointer gesture handler in `ports.js` (or Elm pointer decoders on `rowShell`) that dispatches `ReplyArm` and `MessageMenuOpen`.
- `[Med]` **Search panel states.** Focus the input on `SearchOpen` and restore focus on close; add the "No matches yet", history-off and room-ledger blocks to `View.Search.panel`.
- `[Low]` **Caret-aware insertion** for nick completion, emoji and "/". Add a `selectionStart` field to `ComposerInput` through the keydown/input decoders.
- `[Low]` **`:shortcode:` coverage.** Extend `Emoji.elm` with the 274-entry `EMOJI_MAP` for inline rendering.
- `[Low]` **Edit history view.** Turn `editTitle` into a disclosure button that lists `App.revisionsFor` bodies.
- `[Low]` **Reader-memory strip and in-room unread review.** Build these as a new `View.Thread` block backed by the vault and review-history ports.
- `[Low]` **Small a11y and chrome items.** History-loading skeleton, sr conversation brief, composer brief and hint line, aria-live muting during window changes.
- `[Low]` **Topic-chip unread from the ledger.** Use `TopicRead.projectRoomTopicUnread` in `View.Thread.topicUnreadFor`.
- `[Low]` **Missing pref controls and badges.** Add reaction-density and topic-tools controls to `View.Prefs`; render `AiPolicy` in `View.RoomHeader`; add provenance badges to the translation and pins.
- `[Low]` **Cards for vault-restored rows.** Fetch link previews for vault-restored rows in the `VaultRowsReceived` fold (`App.elm:36944`).

### K — Command surfaces — slash verbs, command palette, keyboard shortcuts, gestures

Walked: `src/lib/commands/registry.ts` (`SLASH_COMMANDS` 214–260), the slash arm of
`sendMessage` (`store.ts` 8113–8530, raw fallthrough `client.sendRaw(cmd.toUpperCase(), …args)`
at 8528), `src/chat/spotlight/commands.ts` (palette rows 300–1480), `useSpotlight.ts`,
`src/lib/keyboard/shortcutsRegistry.ts` + `useKeyboardShortcuts.ts`, `src/shell/message/rowGesture.ts`.
Elm: `App.elm` composer send path (38992–39058), `parseSlashLocal` (10981), `sendRawSlashCommand`
(11164), `runSlashLocal` (14474–15011), registry `slashCommands` (12976), `Switcher.elm`
(`actionEntries` 234, `shortcutGroups` 609), `ports.js` `classifyShortcut` (3483), `CALL_CHORDS` (3478).
Server cross-check: `/home/kain/onyx-server/src/daemon` has no `ME`, `MSG`, `J`, `OP`, `DEOP`, `VOICE`,
`DEVOICE`, `BAN`, `UNBAN`, `BACK`, `UNAWAY`, `QUOTE`, `RAW`, `CTCP`, `STAGE`, `SHARE` verbs; unknown verbs
answer `421` (`dispatch.zig:2370`).

**Shared defect, called out once:** both clients send every registry verb they do not handle locally
as a raw uppercase IRC line. Verbs that need client-side translation therefore do not work in
EITHER client — `/me` becomes `ME …` (421), `/msg` → `MSG` (421), `/op nick` → `OP nick` (421),
`/kick nick` → `KICK nick` with no channel, `/topic text` → `TOPIC text` with no channel. Both
clients also SWALLOW inbound CTCP `ACTION` (`store.ts:12684–12703` `break`; Elm `App.elm:7443`
`foldCtcpQuery` + `isCtcpQueryBody` 7533), so `/me` lines from other IRC clients vanish. These
rows are marked FULL (parity) with "⚠ shared" in the note; they are gaps against the product,
not against Solid, and they are where Elm can cheaply beat Solid.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| K1 | `/me <action>` | `registry.ts:215`, raw `store.ts:8528` (slash) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K2 | `/topic <text>` | `registry.ts:216` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K3 | `/nick <nick>` | `registry.ts:217` (slash, raw) | FULL | `App.elm:11164` | NICK is a real verb |
| K4 | `/join #room`, alias `/j` | `registry.ts:218` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K5 | `/part [#room]`, alias `/leave` | `registry.ts:219` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K6 | `/msg <nick> <text>`, alias `/query` | `registry.ts:220` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K7 | `/whois <nick>` opens profile sheet | `store.ts:8494` (slash) | FULL | `App.elm:14627` / `14634` usage toast | — |
| K8 | `/invite` bare = copy room link; `/invite <nick>` = wire | `store.ts:8376` (slash) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K9 | `/event <when> <title>` / `/event clear` | `store.ts:8122` (slash) | FULL | `App.elm:14990` → `runSlashEvent` 13850 | — |
| K10 | `/webhook create\|list\|delete` | `registry.ts:224` (slash, raw) | FULL | `App.elm:11164` | server `WEBHOOK` module exists |
| K11 | `/notice <target> <text>` | `registry.ts:226` (slash, raw) | FULL | `App.elm:11164`, `rawContentVerbs` guard | Elm better: refuses plaintext into designated/unresolved DMs |
| K12 | `/away [message]` | `registry.ts:227` (slash, raw) | FULL | `App.elm:11164` | — |
| K13 | `/back`, alias `/unaway` | `registry.ts:228` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K14 | `/mode <target> [modes]` | `registry.ts:229` (slash, raw) | FULL | `App.elm:11164` | — |
| K15 | `/modex [#room[,nick]]` (IRCX MODEX) | — | FULL | `App.elm:14648` | Elm-only addition |
| K16 | `/kick <nick> [reason]` | `registry.ts:230` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K17 | `/ban <mask>`, `/unban <mask>` | `registry.ts:231-232` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K18 | `/op` `/deop` `/voice` `/devoice` | `registry.ts:233-236` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K19 | `/quote <raw>`, alias `/raw` | `registry.ts:237` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K20 | `/clear` local scrollback | `store.ts:8139` (slash) | FULL | `App.elm:14553` | — |
| K21 | `/ignore [nick]`, `/unignore <nick>`, bare list | `store.ts:8160` (slash) | FULL | `App.elm:14476/14494/14512` | — |
| K22 | `/read`, alias `/markread` | `store.ts:8198` (slash) | FULL | `App.elm:14609` | — |
| K23 | `/star`, `/unstar [#channel]` | `store.ts:8207` (slash) | FULL | `App.elm:14814/14817` | — |
| K24 | `/mute`, `/unmute [#channel]` | `store.ts:8226` (slash) | FULL | `App.elm:14703/14737` | — |
| K25 | `/autojoin`, `/unautojoin` | `store.ts:8253` (slash) | FULL | `App.elm:14820/14854` | — |
| K26 | `/highlight`, `/unhighlight` | `store.ts:8280` (slash) | FULL | `App.elm:14655/14673` | — |
| K27 | `/snooze <min>`, `/dnd [on\|off\|min]` | `store.ts:8307` (slash) | FULL | `App.elm:14697/14700` | — |
| K28 | `/color`, alias `/colour` | `store.ts:8349` (slash) | FULL | `App.elm:14888` | — |
| K29 | `/share` copy room deep link | `store.ts:8376-8399` (slash) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K30 | `/export [txt\|json]` | `store.ts:8401` (slash) | FULL | `App.elm:14597` | — |
| K31 | `/import` vault snapshot | — (Solid imports via Preferences) | FULL | `App.elm:14603` | Elm-only verb |
| K32 | `/notify all\|mentions\|mute` | `store.ts:8427` (slash) | FULL | `App.elm:14771` | — |
| K33 | `/ping [nick]` | `registry.ts:248` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K34 | `/ctcp <nick> <cmd>` | `registry.ts:249` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K35 | `/stage [on\|off]` | `registry.ts:250` (slash, raw) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K36 | `/history` opens search | `store.ts:8156` (slash) | FULL | `App.elm:14571` | — |
| K37 | `/search <query>` | `store.ts:8147` (slash) | FULL | `App.elm:14577` | — |
| K38 | `/help [command]` | `store.ts:8459` (slash) | FULL | `App.planSlash` / `runSlashPlan` (`GapCommandsTest`) | closed by v3/gap-commands |
| K39 | Oper verbs `/broadcast` (`/wallops`) `/kill` `/rehash` `/privs` `/events` `/observe` | `store.ts:8510` `parseOperSlashCommand` (slash) | FULL | `App.elm:14993-15011` → `runSlashOper` | shared `planOperAction` gate |
| K40 | Text verbs `/shrug` `/tableflip` `/unflip` `/lenny` `/disapprove` | `registry.ts:255-259` (slash) | FULL | `App.elm:11101` `expandSlashTextCommand` | — |
| K41 | Unknown verb raw passthrough | `store.ts:8528` (slash) | FULL | `App.elm:11164` | Elm better: `plaintextWouldLeak` refusal for content verbs |
| K42 | Offline slash refusal copy | `Composer.tsx:1291` (UI) | FULL | `App.elm:39033` | identical copy |
| K43 | Slash suggestions (prefix, aliases, oper-hidden, Tab/Enter) | `Composer.tsx:401,1524` (UI) | FULL | `ComposerAssist.elm`, `View/Composer.elm` | see E section |
| K44 | Palette: `Go to #room` rows | `commands.ts:1430` (palette) | FULL | `Switcher.elm:171` | — |
| K45 | Palette: `Open DM with nick` rows | `commands.ts:1449` (palette) | FULL | `Switcher.elm:180` | — |
| K46 | Palette: People rows (`Message <nick>` from rosters) | `commands.ts:1403` (palette) | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K47 | Palette: recents (owner-scoped, ranked first) | `registry.ts` recents + `Spotlight.tsx` (palette) | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K48 | Palette: Browse rooms | `commands.ts:1195` | FULL | `Switcher.elm:236` | — |
| K49 | Palette: Start a room | `commands.ts:1203` | FULL | `Switcher.elm:237` | — |
| K50 | Palette: Join room… (typed name) | `commands.ts:1211` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K51 | Palette: New conversation | — | FULL | `Switcher.elm:238` | Elm-only |
| K52 | Palette: Jump to date… | `commands.ts:1280` | FULL | `Switcher.elm:242` | — |
| K53 | Palette: Notifications | — | FULL | `Switcher.elm:247` | Elm-only |
| K54 | Palette: Appearance — theme & background | `commands.ts:1227` | FULL | `Switcher.elm:248` | — |
| K55 | Palette: You | — | FULL | `Switcher.elm:249` | Elm-only |
| K56 | Palette: Open keyboard shortcuts | `commands.ts:1077` | FULL | `Switcher.elm:250` | — |
| K57 | Palette: Disconnect | `commands.ts:1347` | FULL | `Switcher.elm:251` | — |
| K58 | Palette: Preferences — display & behaviour | `commands.ts:1235,1066` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K59 | Palette: Open Theme Studio | `commands.ts:1243` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K60 | Palette: Show/Hide member list | `commands.ts:1251` | PARTIAL | — | v3/gap-commands: Alt+M shows/hides the member list; no palette row |
| K61 | Palette: Focus composer | `commands.ts:1259` | PARTIAL | — | v3/gap-commands: Enter / Alt+Enter focus the composer; no palette row |
| K62 | Palette: Scheduled messages | `commands.ts:1272` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K63 | Palette: AI policy row for active room | `commands.ts:1305` | MISSING | `AiPolicy.elm` (no UI) | — |
| K64 | Palette: Start voice in current room | `commands.ts:1317` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K65 | Palette: Start video in current room | `commands.ts:1331` | N/A | video off on live network (`fbe04585`) | revisit when video ships |
| K66 | Palette: Copy node address | `commands.ts:1355` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K67 | Palette: Copy room link | `commands.ts:1365` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K68 | Palette: Switch theme: <theme> rows | `commands.ts:1464` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K69 | Palette: Switch background rows | `commands.ts:1473` | MISSING | — | — |
| K70 | Palette: extension action rows | `commands.ts:1162` | MISSING | — | extensions not ported (see F) |
| K71 | Palette time grammar: "jump [#room] <time>" (`timeGrammar.ts`) | `commands.ts:328,354,568` | MISSING | — | — |
| K72 | Palette: Catch up — jump to first unread in X | `commands.ts:418` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K73 | Palette: Mark all read | `commands.ts:444` | FULL | `Switcher.build` / `App.runGapPaletteTarget` | closed by v3/gap-commands |
| K74 | Palette: Reopen reviewed anchors | `commands.ts:493` | MISSING | — | no review history in Elm |
| K75 | Palette: vault search mode toggle / `vault exact\|semantic\|hybrid` | `commands.ts:524,942` | MISSING | mode toggle lives in search panel | — |
| K76 | Grammar: hide room / close conversation | `commands.ts:594-657` | MISSING | — | Elm has no hidden rooms / closed conversations |
| K77 | Grammar: leave / PART room | `commands.ts:671-713` | MISSING | — | — |
| K78 | Grammar: unread / star / unstar / dm nick | `commands.ts:732-787` | PARTIAL | — | v3/gap-commands: palette star/unstar/mark-read/DM rows; no typed grammar |
| K79 | Grammar: schedule message "<text> in 2h" | `commands.ts:801` | MISSING | — | — |
| K80 | Grammar: mute N / DND on\|off / away set\|clear | `commands.ts:822-896` | PARTIAL | — | v3/gap-commands: `mute N` / DND / away rows; no `away set\|clear` grammar |
| K81 | Grammar: focus mode / go home / search X | `commands.ts:907-930` | PARTIAL | — | v3/gap-commands: palette search/home rows; no focus-mode or `search X` grammar |
| K82 | Grammar: translate to X / clear | `commands.ts:976-988` | MISSING | — | — |
| K83 | Grammar: reader mode / density / width / motion | `commands.ts:1005-1056` | PARTIAL | — | v3/gap-commands: density toggle row; reader mode, width and motion stay in Preferences |
| K84 | Shortcut Ctrl/Cmd+K palette | `shortcutsRegistry.ts` (shortcut) | FULL | `ports.js:3492` | — |
| K85 | Shortcut `/` palette when not typing | `useSpotlight.ts:32` | FULL | `ports.js:3509` | — |
| K86 | Shortcut `?` shortcuts overlay | `shortcutsRegistry.ts` | FULL | `ports.js:3512` | — |
| K87 | Shortcut Escape closes topmost overlay | `useKeyboardShortcuts.ts:670` | FULL | `ports.js:3488` + `App.escapeMsg` | Elm single ordered stack (better) |
| K88 | Shortcut Ctrl/Cmd+F search | `shortcutsRegistry.ts` | FULL | `ports.js:5770` `isFindHotkey`, `App.elm:39559` | — |
| K89 | Shortcut Enter focuses composer | `useKeyboardShortcuts.ts:781` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K90 | Shortcut Ctrl/Cmd+H / `g h` Go home | `shortcutsRegistry.ts`, `useKeyboardShortcuts.ts:750` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K91 | Shortcut Alt+↓ / Alt+↑ next / previous room | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K92 | Shortcut `n` next unread | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K93 | Shortcut `u` follow conversation | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K94 | Shortcut Ctrl/Cmd+Shift+R reader mode | `shortcutsRegistry.ts` | MISSING | — | no reader mode in Elm |
| K95 | Shortcut Ctrl/Cmd+, preferences | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K96 | Shortcut Ctrl/Cmd+Shift+A account | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K97 | Shortcut Alt+M member list / Alt+S focus sidebar | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K98 | Shortcut Ctrl/Cmd+Shift+E mark read | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K99 | Shortcut Ctrl/Cmd+Shift+U attach / Ctrl+Shift+L schedule (composer) | `useKeyboardShortcuts.ts:701` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K100 | Shortcut Ctrl/Cmd+Shift+D DND / Ctrl+B star / Ctrl+Shift+M mute room / Ctrl+Alt+E export | `shortcutsRegistry.ts` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K101 | `j` / `k` transcript message navigation | `useKeyboardShortcuts.ts:721` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K102 | `g d` jump to date | `useKeyboardShortcuts.ts:756` | FULL | `ports.js classifyShortcut` → `App.runAppChord` | closed by v3/gap-commands |
| K103 | Call chords Ctrl/Cmd+Shift+M/E/H/C/L/G/F/S | (Solid VoiceBar local keys; see H) | FULL | `ports.js:3478`, `Switcher.elm:637` | Elm-wide, `aria-keyshortcuts` |
| K104 | Push-to-talk talk key | `useCadenceMedia.ts` (see H) | FULL | `ports.js:3751` `createPushToTalk` | — |
| K105 | Swipe-to-reply on touch rows | `rowGesture.ts` (gesture) | MISSING | — | — |
| K106 | Long-press opens message menu | `rowGesture.ts` (gesture) | FULL | `View/Thread.elm:450-458` `contextmenu` | — |
| K107 | Swipe-down to dismiss sheets | — | FULL | `View/Sheet.elm:207` | Elm-only |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- COVERAGE "Ctrl/Cmd+K action palette … done" lists narrowings "no recents, time grammar, people/extension/theme rows" but omits that ~40 grammar/palette actions (hide, leave, star, mute N, DND, away, focus, reader, density, width, translate, schedule, catch-up, mark all read, copy link/node, theme/background switch) are missing — the palette is ~25% of Solid's.
- COVERAGE: "overlay lists only the chords this client handles … no Alt+↑/↓, J/K, G-sequences yet" — accurate, but understates: 17 of Solid's 21 registry chords are absent.
- The `/help` list (`App.elm:13065`) advertises `/share`, which Elm does not handle (raw `SHARE` → 421).
- Neither doc records that `/me`, `/msg`, `/j`, `/op`, `/ban`, `/quote` etc. are broken on Onyx Server in both clients, nor that inbound CTCP ACTION is dropped.

#### Elm better than Solid
- Raw content verbs (`/msg`, `/notice`, `/privmsg`, `/me`, `/query`, `/whisper`, `/edit`…) refuse to leak plaintext into designated/unresolved DMs or required-encryption rooms (`App.elm:11171`, `rawContentVerbs`); Solid's raw fallthrough had no such guard.
- `/modex` and `/import` verbs.
- One ordered Escape stack + one focus mechanism; call chords are modifier-only with `aria-keyshortcuts` and a user-bound PTT key.
- Swipe-down-to-dismiss sheets on phones.

#### Gaps (ranked by user impact)
- `[High]` `/me` + inbound ACTION — in `parseSlashLocal` add `me` → `PRIVMSG <target> :\x01ACTION …\x01` through `sendComposerText` (seal path intact); in `foldCtcpQuery`/`isCtcpQueryBody` let `ACTION` through to a `msgType = "action"` row rendered `* nick text` in `View/Thread.elm`.
- `[High]` Translate registry verbs instead of raw: `/msg`/`/query` → select DM + send; `/op /deop /voice /devoice /ban /unban /kick /topic /invite <nick> /part` → fill the active channel and build `MODE`/`KICK`/`TOPIC`/`INVITE`/`PART`; `/back`/`/unaway` → `AWAY`; `/quote`/`/raw` → send the tail verbatim; `/j` → `JOIN`; `/ctcp` → wrapped PRIVMSG. One table in `App.elm` beside `parseSlashLocal`.
- `[High]` `/share` (and bare `/invite`) — reuse `InviteShare.payload` + `ClipboardCopy` tag `room-link`; toast copy from `store.ts:8384`.
- `[Med]` Palette breadth — add People rows (roster nicks → `MemberMessage`), Preferences, Scheduled messages, Copy room link, Start voice, Mark all read, Theme rows in `Switcher.actionEntries`; recents via a `palette-recents` ports key.
- `[Med]` Navigation chords — Alt+↑/↓, `n`, `g h`, `g d`, Enter-to-composer, Ctrl+, in `ports.js classifyShortcut` → `Switcher` Msgs; list them in `shortcutGroups`.
- `[Med]` `j`/`k` message focus + Ctrl+Shift+E mark read (outside calls) — `TranscriptRows` focus index + `ChannelSelect` read marker.
- `[Low]` Palette time grammar (port `timeGrammar.ts` to `Switcher`), grammar verbs (mute N, away, DND), theme/background switch rows.
- `[Low]` Swipe-to-reply — a ports pointer helper on `[data-row]` dispatching `ReplyArm`.

### F — Sheets & settings (preferences, appearance, themes, backgrounds, notification settings, room settings)
Solid walked: `src/shell/PreferencesPanel.tsx` (all 6 tabs, every card/toggle/segmented/button), `src/lib/prefs/{preferences,sceneMotion,vaultSearchMode}.ts`, `src/app/Appearance.tsx`, `src/shell/AppearancePanel.tsx`, `src/theme/*` (ThemeStudio every control, ThemeProvider, publicLooks/PublicLookPicker, themeStorage, highContrastTheme), `src/shell/ThemeImportDialog.tsx`, `src/backgrounds/**` (Background/engine/catalogue/picker/backgroundPolicy/reactivity/scenes), `NotificationControls`, `CalmModeControl`, `SmartMuteSection`, `ChannelOrganizationSection`, `KeywordListControl`, `IgnoredUsersControl`, `ChannelNotifyControl`, `ChannelSettings.tsx` (every section), `HarborConfirmSheet`+`roomVerbConfirm`, `RoomInviteShare`+state, `RoomInsightsStrip`, `ScheduledEventLine`, `BridgeStatusBadge`, `GroupControlRoomIndicator`, `CapabilityMatrixSection`, `AccessibilityStatement`, `app/YouSettings.tsx`, lib/notifications/{quietHours,calmMode,smartMute*,highlightMemory,channelNotify*}, `lib/irc/aiPolicyProp.ts`, `lib/customCssRemoval.ts`, `lib/invite/*`.
Elm checked: `Prefs.elm`, `PrefsPanel.elm`, `View/Prefs.elm`, `View/Appearance.elm`, `Studio.elm`, `View/Studio.elm`, `ThemeLook.elm`, `ThemeTokens.elm`, `RoomSettings.elm`, `View/RoomSettings.elm`, `View/Notify.elm`, `NotifyCenter.elm`, `Notify.elm`, `View/Account2.elm`, `InviteShare.elm`, `View/DmSafety.elm`, `Retention.elm`, `HistoryPolicy.elm`, `AiPolicy.elm`, `App.elm` folds, `Main.elm`, `ports.js`, `index.html`, `app.css` + `css/*.css` (grep of every `data-*` pref selector and every `var(--…)` consumer).
**Headline:** Elm renders no background at all (no canvas/scene code anywhere in `ports.js`/views), Elm chrome is painted from a fixed `--onyx-*` palette so theme Looks barely recolor the shell, and Text size / spacing Density are persisted + stamped on `<html>` but no Elm CSS consumes `data-font-scale`/`data-density`.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| F1 | Open device Preferences sheet from You hub | `src/shell/YouHubNav.tsx:41`, `src/app/YouSettings.tsx:288` (UI) | FULL | `View/Nav.elm:344` → `App.elm:44036` `prefsOpen` (`App.elm:44400`) | |
| F2 | Mod+, opens Preferences (allowed from editable fields) | `src/lib/keyboard/shortcutsRegistry.ts:84`, `useKeyboardShortcuts.ts:694` (shortcut) | MISSING | `Switcher.elm:564` `Shortcut` has no prefs chord | |
| F3 | Palette "Open preferences" grammar + "Preferences — display & behaviour" action | `src/chat/spotlight/commands.ts:1066`, `:1235` (palette) | MISSING | `Switcher.elm:235-252` action list has no Preferences | COVERAGE excuse "no palette exists yet" is stale |
| F4 | Category deep-link (`openPreferences('history')` from search; DND-on ribbon item) | `src/shell/search/MessageSearch.tsx:628`, `PresenceRibbon.tsx:1330` (UI) | MISSING | `PrefsSelectCategory` only dispatched by tabs (`View/Prefs.elm:119`) | |
| F5 | Category tablist, roving Arrow/Home/End, horizontal on ≤42rem | `PreferencesPanel.tsx:3082-3230` (UI) | PARTIAL | `View/Prefs.elm:66-132`, `PrefsPanel.elm:59`, `App.elm:40328` | 5 of 6 tabs (no App & tools); aria-orientation fixed vertical |
| F6 | Reset to defaults (prefs + scene motion) with re-arming live announcement | `PreferencesPanel.tsx:3130`, `:3210` (UI) | FULL | `View/Prefs.elm:83`, `App.elm:44498` | |
| F7 | Preference storage status line (unknown/pending/saved/unavailable) | `PreferencesPanel.tsx:3495`, `preferences.ts:267` (UI) | MISSING | — | |
| F8 | Display: Appearance launcher card (nested sheet, focus restore) | `PreferencesPanel.tsx:3394`, `:3520` (UI) | PARTIAL | `View/Prefs.elm:282` → `YouHubGo Nav.YouAppearance` (route push) | Leaves the sheet for `/appearance` route |
| F9 | Message density Compact/Cozy/Roomy (spacing) | `PreferencesPanel.tsx:3521`, `preferences.css:16-84` (UI) | PARTIAL | Prefs placeholder `View/Prefs.elm:165`; chips `View/Appearance.elm:132`; stamped `ports.js:6051` | Inert: no Elm CSS reads `data-density`; placeholder tells users to use these inert chips |
| F10 | Font scale / Text size Small/Medium/Large | `PreferencesPanel.tsx:3529`, `Appearance.tsx:79`, `preferences.css:92` (UI) | PARTIAL | `View/Appearance.elm:99-124`, `ports.js:6052` | Inert: no `data-font-scale` CSS in `elm/app.css`/`css/*`; absent from Prefs Display |
| F11 | Conversation width measured/full | `PreferencesPanel.tsx:3539`, `preferences.css:111` (UI) | CORE-ONLY | `Prefs.elm:711` (`"width"`), `App.elm:1573` | No UI, no CSS |
| F12 | Reader mode toggle + Mod+Shift+R | `PreferencesPanel.tsx:3547`, `useKeyboardShortcuts.ts:547`, `preferences.css:1636` (UI/shortcut) | CORE-ONLY | `App.elm:44438` bool key, `App.elm:1574` | No toggle, chord, or `data-reader` CSS |
| F13 | Experience level Standard/Advanced/Network Ops | `PreferencesPanel.tsx:3554`; gates `AppShell.tsx:1499` (UI) | CORE-ONLY | read `View/Bans.elm:476`, `View/Profile.elm:769` | Not settable in Elm (inherits stored value; Reset clears) |
| F14 | Clock 24h/12h | `PreferencesPanel.tsx:3562` (UI) | FULL | `View/Prefs.elm:170`, `View/Appearance.elm:197` | |
| F15 | Notification mode Calm/Regular/Power (drives alert tier) | `CalmModeControl.tsx:35`, `PreferencesPanel.tsx:3584`, `NotificationControls.tsx:383`, `NotificationRuntime.tsx:158` (UI/auto) | MISSING | `Notify.elm:37` input has no preset | No `onyx:calm` read/write |
| F16 | Hide join, part & quit | `PreferencesPanel.tsx:3585`, `preferences.css:102` (UI) | PARTIAL | `View/Prefs.elm:182`, `View/Thread.elm:304`, `PrefsPanel.elm` `hidesEvent` | Hides only join/part/quit; Solid hides every system row |
| F17 | Time scrubber (persisted show/hide) | `PreferencesPanel.tsx:3594` (UI) | PARTIAL | `View/Polish.elm:276`, `App.elm:45827` | Session toggle from room More only, not a persisted pref |
| F18 | Show join voice/video controls | `PreferencesPanel.tsx:3601` (UI) | CORE-ONLY | `View/CallPresence.elm:226` reads `prefs.voiceEntry` | No toggle |
| F19 | Show topic/forum/follow tools | `PreferencesPanel.tsx:3608` (UI) | CORE-ONLY | `View/Thread.elm:938` | No toggle |
| F20 | Watch together activity toggle | `PreferencesPanel.tsx:3615` (UI) | MISSING | — | Watch-together surface itself absent |
| F21 | Blocked hosts (unfurl suffix blocklist, commit on blur/Enter) | `PreferencesPanel.tsx:543`, `:3622` (UI) | CORE-ONLY | `App.elm:35927` `liveUnfurlPrivacy` | No editor |
| F22 | Reaction density Full/Fewer/Total/Hidden | `PreferencesPanel.tsx:3623` (UI) | CORE-ONLY | `View/Thread.elm:2172`, `:2233` | No control |
| F23 | Link previews toggle | `PreferencesPanel.tsx:3632` (UI) | FULL | `View/Appearance.elm:233`, `App.elm:35925` | Moved to Appearance › Privacy |
| F24 | HTTPS-only previews | `PreferencesPanel.tsx:3639` (UI) | FULL | `View/Appearance.elm:234` | |
| F25 | Encrypted DMs toggle | `PreferencesPanel.tsx:3646`, `YouSettings.tsx:93` (UI) | PARTIAL | `View/Appearance.elm:232` → `App.elm:40260` sets `prefs.e2eeDms`; gates read `model.e2eeDms` (`App.elm:35653`, `:10578`) seeded only at boot (`Main.elm:917`) | Toggle has no effect until reload |
| F26 | Personal mute & block (ignored names) list | `IgnoredUsersControl.tsx:28`, `PreferencesPanel.tsx:3653` (UI) | FULL | `View/Notify.elm:410`, `App.elm:11264` | In Notifications sheet |
| F27 | Local history switch (erase on off, retry, verified copy) | `PreferencesPanel.tsx:600`, `:3667` (UI) | MISSING | `prefs.localHistory` never read (no hit in `App.elm`/`ports.js`) | Elm keeps writing the vault even if user opted out |
| F28 | Clear reviewed catch-up anchors (confirm) | `PreferencesPanel.tsx:1277` (UI) | MISSING | — | No review-history store |
| F29 | Default device-search mode | `PreferencesPanel.tsx:3669` (UI) | FULL | `View/Prefs.elm:208`, `App.elm:39695` | |
| F30 | Discard queued sends (count, re-confirm drift, verified readback) | `PreferencesPanel.tsx:2162` (UI) | FULL | `View/Prefs.elm:460`, `App.elm:44528`, `outboxReview` port | Elm adds per-row discard |
| F31 | Discard local drafts (room + topic drafts) | `PreferencesPanel.tsx:1946` (UI) | PARTIAL | `View/Prefs.elm:536`, `App.elm:44689` | Room composer drafts only; no topic drafts |
| F32 | Clear followed conversations | `PreferencesPanel.tsx:1768` (UI) | MISSING | — | |
| F33 | Clear all saved searches (+query text, verified) | `PreferencesPanel.tsx:1404` (UI) | CORE-ONLY | `SearchClearRequest` `App.elm:1037` → `Main.elm:1469` port; never emitted | |
| F34 | Clear topic read positions | `PreferencesPanel.tsx:1612` (UI) | MISSING | — | |
| F35 | On-device history: keep count + max age (prune) | `PreferencesPanel.tsx:2835` (UI) | FULL | `View/Prefs.elm:398`, `App.elm:39569` | |
| F36 | Clear local history (vault + outbox, confirm) | `PreferencesPanel.tsx:2942` (UI) | MISSING | — | |
| F37 | Portable vault export (JSON download) | `PreferencesPanel.tsx:1146`, `:823` (UI) | PARTIAL | `View/Prefs.elm:228`, `ports.js:6820` | Messages only (`onyx-vault`); no drafts/follows/saved searches/prefs/handoffs |
| F38 | Compressed `.json.gz` export + import | `PreferencesPanel.tsx:1159`, `:978` (UI) | MISSING | `ports.js:6886` accepts `.json` only | |
| F39 | Save vault to file (FS Access) / Share vault file (Web Share) | `PreferencesPanel.tsx:1169-1204` (UI) | MISSING | — | |
| F40 | Import portable JSON with Review step, cross-tab lock, merge | `PreferencesPanel.tsx:1205-1249`, `:1084` (UI) | PARTIAL | `View/Prefs.elm:229` → `App.elm:37003` | Imports immediately, messages only, result goes to server log not panel |
| F41 | Discord JSON / Discord package / Discord bot / Slack / IRC-log importers | `PreferencesPanel.tsx:3359-3387` (UI) | MISSING | — | |
| F42 | Installed-app readiness rows + Install guide link | `PreferencesPanel.tsx:2670`, `:2760` (UI) | MISSING | — | No App & tools tab |
| F43 | Refresh app shell (update recovery) | `PreferencesPanel.tsx:2749` (UI) | MISSING | only prompted banner `View/Polish.elm` `updateBanner` | |
| F44 | Keep vault on this device (storage.persist) | `PreferencesPanel.tsx:2773-2798` (UI) | MISSING | no `navigator.storage` in `ports.js` | |
| F45 | Origin storage estimate + refresh/retry | `PreferencesPanel.tsx:2799` (UI) | MISSING | — | |
| F46 | Extension action manifest review/import/export/clear | `PreferencesPanel.tsx:2394` (UI) | MISSING | — | |
| F47 | Extension action audit list + Clear | `PreferencesPanel.tsx:2331` (UI) | MISSING | — | |
| F48 | Local language tools (readiness + translation target select) | `PreferencesPanel.tsx:2606`, `YouSettings.tsx` language (UI) | PARTIAL | `View/Appearance.elm:344`, `App.elm:38757` | Lives on Appearance; no "Caption transcript copy" row |
| F49 | Background motion Adaptive/Animated/Still/Off | `PreferencesPanel.tsx:3731`, `AppearancePanel.tsx:243` (UI) | PARTIAL | `View/Prefs.elm:243`, `App.elm:44472` | Persisted only; no scene renderer to obey it |
| F50 | Reduce motion | `PreferencesPanel.tsx:3739` (UI) | FULL | `View/Prefs.elm:251`, `app.css:3135` | |
| F51 | Reduce transparency | `PreferencesPanel.tsx:3746` (UI) | FULL | `View/Prefs.elm:258`, `app.css:3149` | |
| F52 | Raise contrast (+ OS `prefers-contrast: more`, per-theme derived HC tokens) | `PreferencesPanel.tsx:3753`, `ThemeProvider.tsx:204`, `:331`, `highContrastTheme.ts` (UI/auto) | PARTIAL | `View/Prefs.elm:265`, `app.css:3143` | Static 3-token block; ignores OS signal; not per-theme |
| F53 | Client access audit ledger (+ public ledger link) | `PreferencesPanel.tsx:677`, `:3760` (UI) | MISSING | — | |
| F54 | You hub inline device controls (calm, keywords, privacy, blocked, reading comfort, motion, language) | `src/app/YouSettings.tsx:82-251` (UI) | PARTIAL | `View/Nav.elm:320-350` link-outs | Entries open sheets/route; calm mode absent |
| F55 | `/appearance` page shell (back/home, lede, device note) | `src/app/Appearance.tsx:64` (UI) | FULL | `View/Appearance.elm:72-92` | |
| F56 | Look picker (Ocean/Pearl + active extra) | `PublicLookPicker.tsx:7`, `publicLooks.ts` (UI) | FULL | `View/Appearance.elm:94`, `:313`, `ThemeLook.elm:269` | |
| F57 | Chosen look recolors the app (tokens + color-scheme incl. light) | `ThemeProvider.tsx:204` `applyThemeToDom` (auto) | PARTIAL | tokens written `ports.js:6046`; shell CSS uses fixed `--onyx-*` (`app.css:4-14`; ~926 `--onyx` vs 13 theme-var uses) | Only Appearance/Studio/avatars change; Pearl/Frost shell stays dark |
| F58 | All looks: 18 built-in + custom chips | `Appearance.tsx:149`, `AppearancePanel.tsx:205` (UI) | FULL | `View/Appearance.elm:272`, `App.elm:40411` | Custom chips use static swatch |
| F59 | Motion & data: Reduce motion + Use less data | `Appearance.tsx:121-141` (UI) | FULL | `View/Appearance.elm:239-256`, `App.elm:40281`, `:40298` | |
| F60 | Background stage: hover/focus preview (160 ms), Cancel preview / Apply, Saved/Preview label | `Appearance.tsx:171-181`, `BackgroundPicker.tsx:43` (UI) | PARTIAL | `View/Appearance.elm:281-298`, `App.elm:40435-40480`, `ports.js:6180` | State machine complete; nothing paints the preview |
| F61 | Escape cancels a dirty background preview | `Appearance.tsx:58` (shortcut) | MISSING | — | |
| F62 | PWA update held while theme/background edit is dirty | `Appearance.tsx:42`, `ThemeStudio.tsx:888` (auto) | MISSING | `App.elm:45572` holds only for calls | |
| F63 | In-shell Appearance sheet (motion radios, effective-motion readout, immediate background browser, Open Theme Studio) | `AppearancePanel.tsx:48`, `:85`, `:262` (UI) | PARTIAL | route only (V3_ROADMAP 1.3) | No effective-motion readout ("Still · Reduced motion") |
| F64 | Theme share & import dialog (code/link, Ready preview, copy share link) | `ThemeImportDialog.tsx:38`, `AppearancePanel.tsx:197` (UI) | FULL | `View/Account2.elm:262`, `App.elm:41882-41918`, `View/Appearance.elm:274` | Also a You hub entry |
| F65 | `?theme=` one-time import + URL strip | `ThemeProvider.tsx:265`, `:125` (auto) | FULL | `App.elm:40228`, `StudioStripShareParam` | |
| F66 | Cross-tab theme coherence (storage events) | `ThemeProvider.tsx:291-316` (auto) | PARTIAL | `ports.js:4084` → `App.elm:40910` | Custom-theme list syncs; active theme id change in another tab not adopted |
| F67 | Legacy theme-id remaps | `themeStorage.ts:9` (auto) | FULL | `ThemeLook.elm:156` | |
| F68 | Palette: Switch theme (×18), Switch background (×24), Open Theme Studio | `commands.ts:1464`, `:1470`, `:1243` (palette) | PARTIAL | `Switcher.elm:248` single "Appearance" action | |
| F69 | Theme Studio header, modified badge, Choose-a-look shelf | `ThemeStudio.tsx:1189-1210` (UI) | FULL | `View/Studio.elm:189`, `:221` | |
| F70 | Generate: dark/light, primary/accent seed colour, 6 sliders, live regen after first Generate | `ThemeStudio.tsx:1229-1350`, `:781` (UI) | FULL | `View/Studio.elm:374-428`, `App.elm:40520-40570` | No 120 ms debounce |
| F71 | Eyedropper accent sample (status/errors) | `ThemeStudio.tsx:1281`, `:955` (UI) | FULL | `View/Studio.elm:514`, `App.elm:40865` | |
| F72 | Randomize / Seed from current / Export seed / Import seed (fail-closed + warnings) | `ThemeStudio.tsx:1351-1381` (UI) | FULL | `View/Studio.elm:429-433`, `:562`, `App.elm:40603` | |
| F73 | Adjust hue/sat/warmth/contrast + Bake/Revert | `ThemeStudio.tsx:1408-1451` (UI) | FULL | `View/Studio.elm:595`, `App.elm:40656` | |
| F74 | Base theme grid + delete custom theme | `ThemeStudio.tsx:1466-1516` (UI) | FULL | `View/Studio.elm:663`, `:728`, `App.elm:40774` | |
| F75 | Studio background grid (immediate apply) | `ThemeStudio.tsx:1523` (UI) | PARTIAL | `View/Studio.elm:736`, `App.elm:40809` | Persists `onyx:bg`; not rendered |
| F76 | Token editor tabs (color/radius/duration/font/easing) + per-token revert | `ThemeStudio.tsx:1562`, `:443` (UI) | FULL | `View/Studio.elm:795-980`, `App.elm:40504`, `:40950` | |
| F77 | Live preview + WCAG contrast audit + auto-fix to AA | `ThemeStudio.tsx:304`, `:1591` (UI) | FULL | `View/Studio.elm:995`, `:1091`, `App.elm:40693` | |
| F78 | Reset + Save named theme (inline name, Enter/Escape) | `ThemeStudio.tsx:1600-1646` (UI) | FULL | `View/Studio.elm:1173`, `:1210`, `App.elm:40704`, `:40737` | |
| F79 | Share link / Import blob / Export blob (clipboard) | `ThemeStudio.tsx:1667-1710` (UI) | FULL | `View/Studio.elm:1202`, `:1234`, `:1264`, `App.elm:40827`, `:40843` | |
| F80 | Animated canvas background behind the app shell (17 variants) | `AppShell.tsx:1367`, `backgrounds/Background.tsx:50`, `variants/*` (auto) | MISSING | no canvas/scene code in `ports.js`; `View.elm` mounts none | |
| F81 | DOM/SVG scenes (Aurora Borealis, Lightning, Neon Night, Phoenix, Retro Arcade, Starfield, Volcanic) | `backgrounds/scenes/*.tsx` (auto) | MISSING | — | |
| F82 | Background picker (5 groups, auto + 24, labelled radios) | `BackgroundPicker.tsx:70` (UI) | PARTIAL | `View/Appearance.elm:437`, `ThemeLook.elm:364` | Faithful UI; selection never rendered |
| F83 | Auto = theme signature background | `shell/themeBackground.ts` `resolveBackgroundId` (auto) | CORE-ONLY | `App.elm:2182` → only a `data-background-id` attr (`pol-studio.css:31` empty host) | |
| F84 | Scene policy (adaptive still/off for reduced-motion/data-saver/narrow, fps/DPR caps, pause unfocused, preview motion) | `backgroundPolicy.ts:141`, `appearanceRuntime.ts`, `lib/a11y/reducedData.ts` (auto) | MISSING | `App.elm:2193` `appearancePreviewMotion` unused | |
| F85 | Scene reactivity (voice RMS bloom, accent hue, time-of-day warmth) | `backgrounds/reactivity.ts` (auto) | MISSING | — | |
| F86 | Scene atmosphere on Connect/public pages | `app/Connect.tsx:93`, `ui/public/PublicFrame.tsx:36` (auto) | MISSING | — | |
| F87 | Notifications settings entry points (You hub, palette, Prefs link) | `ChannelSidebar.tsx:610`, `YouHubNav.tsx` (UI) | FULL | `View/Nav.elm:326`, `Switcher.elm:247`, `View/Prefs.elm:197`, `App.elm:39304` | |
| F88 | Desktop notifications toggle (permission request, blocked/unsupported copy) | `NotificationControls.tsx:367`, `:314` (UI) | FULL | `View/Notify.elm:131-200` | |
| F89 | Notification sound toggle | `NotificationControls.tsx:394` (UI) | FULL | `View/Notify.elm:239` | |
| F90 | Web push (closed-tab) toggle + auto re-bind on owner/SW change | `NotificationControls.tsx:405`, `:198`, `YouNotifications.tsx:214` (UI/auto) | PARTIAL | `View/Account.elm:476`, `App.elm:43380` | Account panel only; no "What can ping" page |
| F91 | Do-not-disturb toggle (manual + timed expiry) | `NotificationControls.tsx:419`, `:335` (UI) | FULL | `View/Notify.elm:256`, `App.elm:39344` | Elm adds snooze-minutes input |
| F92 | Quiet hours schedule (start/end selects; default 22→08 silencing) | `NotificationControls.tsx:430-479`, `store.ts:16624`, `:16661` (UI/auto) | MISSING | `Account2.elm:253` "no quiet-hours state" | Elm alerts fire overnight where Solid was silent by default |
| F93 | Effective-alerts explanation + SR state summary | `NotificationControls.tsx:359-366` (UI) | MISSING | — | |
| F94 | Extra ping keywords add/remove (+ validation status, per-account storage) | `KeywordListControl.tsx:20`, `highlightMemory.ts:35` (UI) | PARTIAL | `View/Notify.elm:347`, `App.elm:31050`, `ports.js:4405` | No "Enter a short word"/save-fail status; stored device-global, not per account |
| F95 | Room header notify strip All/@/Mute (roving keys) | `ChannelNotifyControl.tsx:80`, `PresenceRibbon.tsx:953` (UI) | PARTIAL | `View/Notify.elm:49`, `View/RoomHeader.elm:248`, `App.elm:11369` | No Arrow/Home/End; `onyx:channel-notify` unscoped (`ports.js:4469`) |
| F96 | Smart mute (keyword OS-alert mute + mute system alerts) | `SmartMuteSection.tsx:18`, `NotificationRuntime.tsx:102` (UI) | MISSING | `App.elm:31699` smartMuted = ignored names only | |
| F97 | Room folders (create/assign/delete; sidebar grouping) | `ChannelOrganizationSection.tsx:15`, `ChannelSidebar.tsx:770` (UI) | MISSING | `Sidebar.elm:36` narrowing | |
| F98 | "Do not disturb is on" item in room More menu | `PresenceRibbon.tsx:1323` (UI) | MISSING | — | |
| F99 | Room settings sheet from room More + context line (online / host access) | `PresenceRibbon.tsx:1547`, `ChannelSettings.tsx:619` (UI) | FULL | `View/RoomHeader.elm:273`, `View/RoomSettings.elm:83`, `:132` | |
| F100 | Topic editor (+t gating, read-only fallback, Save) | `ChannelSettings.tsx:627-678` (UI) | FULL | `View/RoomSettings.elm:206` | |
| F101 | Per-device topic draft durability | `ChannelSettings.tsx:187`, `:646` (auto) | MISSING | — | COVERAGE narrowing |
| F102 | In-sheet invite builder (guest-name prefill, E2EE badge+param, share, Open invite) | `ChannelSettings.tsx:682-773` (UI) | PARTIAL | header `InviteShareOpen` `View/RoomHeader.elm:265` | No guest name, E2EE badge/param, native share, open link |
| F103 | Export transcript txt/json | `ChannelSettings.tsx:776-817` (UI) | PARTIAL | `/export` `App.elm:19339` | Slash only, no button |
| F104 | Hide / Show room | `ChannelSettings.tsx:820-852` (UI) | MISSING | `Sidebar.elm:36` (no hidden rooms) | |
| F105 | Leave room with harbor confirm | `ChannelSettings.tsx:854`, `HarborConfirmSheet.tsx`, `roomVerbConfirm.ts:15` (UI/palette) | PARTIAL | `/part` `App.elm:12982` | Slash only, no confirm |
| F106 | Close conversation (DM) with harbor confirm | `roomVerbConfirm.ts:21`, `PresenceRibbon.tsx:1432` (UI) | MISSING | — | |
| F107 | Per-room notify select in sheet | `ChannelSettings.tsx:877-900` (UI) | FULL | `View/RoomSettings.elm:267` | |
| F108 | Room rules m/i/t/n/s switches; member read-only summary | `ChannelSettings.tsx:909-951` (UI) | FULL | `View/RoomSettings.elm:304` | |
| F109 | Join key (+k) / member limit (+l) | `ChannelSettings.tsx:954-980` (UI) | FULL | `View/RoomSettings.elm:337-370` | |
| F110 | Ephemeral history (EPHEMERAL presets) | `ChannelSettings.tsx:985-1021` (UI) | FULL | `View/RoomSettings.elm:380` | |
| F111 | Roles: ACCESS list/refresh/add(level,mask,timeout)/remove | `ChannelSettings.tsx:1024-1153` (UI) | FULL | `View/RoomSettings.elm:414`, `:482`, `App.elm:44932` | Elm also lists role holders |
| F112 | Encryption policy off/optional/required | `ChannelSettings.tsx:1156-1192` (UI) | FULL | `View/RoomSettings.elm:649` | |
| F113 | History visibility public/members/opers | `ChannelSettings.tsx:1195-1239`, `historyPolicy.ts` (UI) | FULL | `View/RoomSettings.elm:694`, `HistoryPolicy.elm` | |
| F114 | Public insights strip (Room pulse, rhythm, metrics, ledger) | `RoomInsightsStrip.tsx:111`, `ChannelSettings.tsx:1244`, `AppShell.tsx:1621` (UI) | PARTIAL | `View/RoomSettings.elm:1070` | Sheet only; no error state; not in mobile More |
| F115 | Bridge status badge | `BridgeStatusBadge.tsx:36`, `ChannelSettings.tsx:1253` (UI) | FULL | `View/RoomSettings.elm:774`, `:796` | Also in header |
| F116 | Incoming webhooks create/list/delete + notices | `ChannelSettings.tsx:1256-1305` (UI) | PARTIAL | `View/RoomSettings.elm:734`; `/webhook` `App.elm:12987` | UI only via Room care in 3–30 member band |
| F117 | Group-control room indicator | `GroupControlRoomIndicator.tsx:96`, `PresenceRibbon.tsx:835` (UI) | PARTIAL | `View/RoomSettings.elm:852`, `:882` | No activation/"active" state |
| F118 | Scheduled event line (countdown, Join call, op Clear) | `ScheduledEventLine.tsx:15`, `MessageView.tsx:2071` (UI) | FULL | `View/RoomSettings.elm:912`, `View/RoomHeader.elm:479` | |
| F119 | AI-policy badge (room More) + palette entry | `AiPolicyBadge.tsx`, `PresenceRibbon.tsx:954`, `commands.ts:1305` (UI/palette) | CORE-ONLY | `AiPolicy.elm` parsers, imported nowhere | |
| F120 | Invite friends sheet (room/network link, copy, status, native share) | `RoomInviteShare.tsx:26`; openers `PresenceRibbon.tsx:1011`, `ChannelSidebar.tsx:842` (UI) | PARTIAL | `View/DmSafety.elm:430`, `InviteShare.elm`, `App.elm:41757` | No `navigator.share` (fallback line always shown) |
| F121 | Session capability matrix | `CapabilityMatrixSection.tsx`, `Account.tsx:1109`, `AppShell.tsx:1499` (UI) | PARTIAL | `View/Account.elm:278` | Account only; no experience-mode status-stack surface |
| F122 | Accessibility statement (About) | `AccessibilityStatement.tsx:95`, `routes/About.tsx:228` (UI) | FULL | `View/About.elm:109` | |
| F123 | Purge retired `onyx:custom-css` payload on boot | `lib/customCssRemoval.ts:34` (auto) | MISSING | — | Low: Elm never reads it |
| F124 | Invite room pulse helper | `lib/invite/inviteRoomPulse.ts` (DEAD) | N/A | — | No non-test importer |
| F125 | DND modal (`openDndModal`) | `store.ts:16668` (DEAD) | N/A | — | No caller |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- COVERAGE:189 "runtime toggle **done** (Appearance Privacy … re-applied through `AppearanceSetPref`)" — overstated: the fold only updates `prefs.e2eeDms` (`App.elm:40260`); every gate reads `model.e2eeDms` (`App.elm:35653`, `:10578`, `:5030`), set only from the boot flag (`Main.elm:917/989`). Toggle needs a reload.
- COVERAGE:213 / V3_ROADMAP 4.1 "**done**" — roughly half the panel is absent (App & tools, local-history switch, 5 clear-* cards, gzip/save/share/review transfer, width/reader/experience/reaction/voice/topic/watch/blocked-hosts). Its "no command palette entry (no palette exists yet)" is stale: `Switcher.elm` palette exists and still lacks the entry.
- COVERAGE:213 + `View/Prefs.elm:165` placeholder ("set density in Appearance") — the Appearance Density and Text size chips are inert: `ports.js:6051-6052` stamps `data-density`/`data-font-scale` but no rule in `elm/app.css` or `elm/css/*.css` reads them.
- COVERAGE:202 / V3_ROADMAP 3.3 "**done**" while quiet hours + calm presets (2 of the 3 named components) are absent; Solid's default quiet hours (22→08, `store.ts:16624`) silenced alerts, so Elm behaviour differs by default, not just in UI.
- COVERAGE:195 says "14 themes"; both clients ship 18 (`ThemeTokens.elm:13`, `themes.ts:1138-1275`). Also "done" implies themes work, but Elm chrome is painted from fixed `--onyx-*` (`app.css:4-14`) so theme choice barely shows outside Appearance/Studio.
- Backgrounds are untracked: no COVERAGE or V3_ROADMAP row for the 24-option renderer, scene policy or reactivity. `View/Appearance.elm` header says the canvas engine "lands with the backgrounds slice" and `pol-studio.css:29` mentions a "Ports-side scene canvas mount", but no such slice or ports code exists.
- `View/About.elm:51` (Elm's accessibility statement) claims "The interface honors prefers-contrast: more" — Elm has no `prefers-contrast` query or handler anywhere.
- UNDERSTATED: `VaultImport.elm` module doc says "There is no file-pick UI … nothing calls this parser", but `App.elm:37020` calls it and `View/Prefs.elm:229` exposes the picker.
- V3_ROADMAP 4.2 "partial" for smart mute + folders is accurate. V3_ROADMAP 1.3 "in-shell sheet not built" is also accurate.

#### Elm better than Solid
- Queued sends and room drafts get per-row Discard buttons with previews (`View/Prefs.elm:490`, `:568`). Solid only offers bulk discard.
- The Notifications sheet has a 1–1440 minute snooze field plus Clear (`View/Notify.elm:310-330`). In Solid a timed DND needs the slash command; its DND modal is dead code.
- Room settings › Roles lists who currently holds Owner/Op/Voice, in words (`View/RoomSettings.elm:433`).
- The bridge badge also appears in the room header (`View/RoomHeader.elm:480`). Solid shows it only inside the settings sheet.
- Appearance gains a Message layout control (Default / IRC-compact, `View/Appearance.elm:167`), plus Timestamps, Privacy and Language on one page.
- The Prefs Conversation tab links straight to the Notifications sheet (`View/Prefs.elm:197`), and the palette has a Notifications action (`Switcher.elm:247`).

#### Gaps (ranked by user impact)
- `[High]` Theme looks don't recolor the shell. Derive `--onyx-bg/panel/panel-2/line/text/dim/faint/accent` from theme tokens, either in `app.css` (`:root{--onyx-bg:var(--ink);…}`) or in `appearanceApplyFor` (`App.elm:1561`), so Pearl/Frost turn light.
- `[High]` Text size and Density do nothing. Port the `preferences.css` font-scale/density rules into `elm/app.css`, keyed on `:root[data-font-scale]`/`[data-density]` and targeting the `.onyx-message`/`.onyx-thread` classes, then replace the Prefs placeholder with a real `segmented`.
- `[High]` The local-history opt-out is ignored. Gate `flushVaultBuffer`/`VaultPersist` on `model.prefs.localHistory`, add a `PrefsTogglePref "localHistory"` switch with a `vaultClear` port erase/retry, and add a "Clear local history" card.
- `[High]` The encrypted-DM toggle needs a reload. In the `AppearanceSetPref "e2eeDms"` fold (and `prefsReset`), also set `model.e2eeDms` and publish/withdraw the DM key the way the 001 path does.
- `[High]` Quiet hours are missing (default 22→08 silence lost). Add `dndQuietStart/End` model fields with `onyx:dnd-quiet-*` ports, a `quiet` input to `Notify.shouldNotify`, and two hour selects in `View/Notify.elm` `dndSection`.
- `[Med]` Calm/Regular/Power presets are missing. Add a `NotifyCenter.CalmPreset` with `onyx:calm` storage and `classifyNotification` in the alert decision, plus a segmented control in `View.Notify` and `View/Prefs.elm` Conversation.
- `[Med]` No background renderer. Add a ports-side scene host for `.ap-background-host` (Appearance) and a shell host that reads `renderedBackground`/`sceneMotion`, starting with the solid and low-detail canvas variants.
- `[Med]` Hidden prefs can't be changed (width, reader + Mod+Shift+R, experience level, voiceEntry, topicTools, reactionDensity, blockedHosts). Add `toggle`/`segmented` rows in `View/Prefs.elm`, extend `Prefs.updatePreference`/`prefsBoolValue`, and port the width/reader CSS.
- `[Med]` Clear controls are missing. Emit the existing `SearchClearRequest` from a confirm card, and add followed / topic-read / reviewed-anchor clears in `View/Prefs.elm` History.
- `[Med]` Room verbs are missing from the sheet. Add Hide/Show room (model `hiddenRooms` + sidebar filter), a Leave confirm sheet (overlayStack + `/part`), DM Close conversation, and an Export button that reuses `runSlashExport`.
- `[Med]` Keyword and per-room notify storage aren't scoped per account. Key `highlightWordsSave`/`channelNotifySave` (`ports.js:4396`/`:4454`) by `deviceMemoryOwner`, as `highlightMemory.ts:35` does.
- `[Med]` Portable vault fidelity. Export drafts/follows/saved searches/prefs, and add a staged Review step (count summary + confirm/cancel) before the `VaultImportFile` merge, with status shown in the panel.
- `[Low]` Smart mute keyword rules and room folders (V3_ROADMAP 4.2). New `onyx:smart-mute` state feeding `Notify.smartMuted`; folder model in `Sidebar`.
- `[Low]` Preferences reachability: Mod+, chord (`Switcher.Shortcut`), palette "Preferences" action, `PrefsOpenAt category` deep links (search history-off, DND More item).
- `[Low]` App & tools tab: PWA readiness rows, Refresh app shell, `navigator.storage.persist`/`estimate` ports, extension manifest/audit.
- `[Low]` High contrast should follow OS `prefers-contrast: more` and per-theme HC derivation. Port `highContrastOverrides` into `Studio`/`Theme`, and add a media-query listener.
- `[Low]` AI-policy badge in the room More menu (wire `AiPolicy.parseAiPolicyProp` over `props`). Native `navigator.share` port for Invite friends. Guest-name and E2EE badge in the invite builder.
- `[Low]` Webhooks UI for ops outside the Room care band. Insights error state. Escape cancels a background preview. Theme-edit update hold. Storage status line. Access-audit ledger. Custom-CSS purge.

### J — Public website: routes, pages, route a11y, static metadata
Solid walked: `src/index.tsx` (route table, providers, boot side effects), every `src/routes/*` page (Landing, HomeRoomBoard, ProductPreview, About, Download+downloadMeta, Guides, Invite, NotFound, OnyxOS, PublicInfo, Roadmap, Stats (all 1047 lines) + PublicRoomComparison, Status, TrustPages, pageMeta), `src/ui/public/*`, `src/ui/navigation/publicRouteManifest.ts`, `src/ui/a11y/*`, `src/ui/proof/*`, `src/ui/lab/SystemSpecimen.tsx`, `Mascot.tsx`, `PublicLookPicker`/`publicLooks`, `src/lib/stats/*`, `src/lib/guides/*`, `src/lib/invite/*`, `tools/materialize-route-entrypoints.mjs`, `public/`, `StaleChunkRecovery.tsx`, `pwa/serviceWorkerRuntime.ts`, plus the @solidjs/router 0.15.4 anchor/scroll handler.
Elm checked: `Route.elm`, `View.elm`, every public `View/*.elm` page, `Download/Guides/Invite/Stats/Status.elm`, `App.elm` LinkClicked/UrlChanged/Tick/HttpResult and per-page folds, `Main.elm` init, `elm/index.html`, `elm/tools/build.sh`, `ports.js`, plus `deploy.sh` + `tools/elm-overlay.mjs`, which is the only place the Elm build gets per-route documents, OG metadata, sw.js and the manifest.
Key mechanics: `Browser.application` intercepts **every** `<a>` (fragment links included) and `LinkClicked → PushUrl` (`App.elm:36600-36606`). Nothing restores scroll or focus. `App.init` seeds only the invite query and the roadmap fragment. Feed fetches (download catalog, status, stats query) are wired to `UrlChanged`, which never fires on a cold load.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| J1 | Route table: 19 paths + `/install` alias, slash/slashless forms | `src/index.tsx:125-138` (UI) | FULL | `Route.elm:44-72` | 20 constructors incl. NotFound |
| J2 | Catch-all 404 "Route terminus", app-miss action (Open Onyx vs Back to home) | `src/routes/NotFound.tsx:31-51` (UI) | FULL | `View.elm:124-125`, `View/NotFound.elm:206-229` | Elm adds "Other places to go". App-miss test is `startsWith "/app"`, so it also matches `/apple…` |
| J3 | Per-route document title | `src/routes/pageMeta.ts:59` (auto) | FULL | `View.elm:145-200` | — |
| J4 | Runtime description/OG/Twitter/canonical/WebPage JSON-LD on client nav | `src/routes/pageMeta.ts:55-123` (auto) | PARTIAL | no meta port (grep `og:`/`canonical` in `ports.js`: none) | Title only. After SPA nav the head keeps the hard-loaded page's canonical/description |
| J5 | 404 runtime `robots noindex` + strip canonical/og:url/JSON-LD | `src/routes/NotFound.tsx:8-29` (auto) | PARTIAL | `View/NotFound.elm:195-197` (says "ports-side"; no port exists) | Only the hard-loaded `404.html` is noindex |
| J6 | Per-route static entrypoint docs (title/desc/canonical/OG/Twitter) for hard loads/crawlers | `tools/materialize-route-entrypoints.mjs:17-116,134-181,218-230` (auto) | FULL | `tools/elm-overlay.mjs:105-139`, `deploy.sh:796-803` | Only via `deploy.sh ONYX_CLIENT=elm`. `elm/tools/build.sh` emits none. `elm/index.html` has no description/OG/canonical/favicon |
| J7 | Flat `404.html` noindex document | `materialize-route-entrypoints.mjs:194-216,235` (auto) | FULL | `tools/elm-overlay.mjs:141-143` | — |
| J8 | Invite-card OG/description meta | `src/routes/Invite.tsx:81-83` (auto) | CORE-ONLY | `Invite.elm:683-689` (only caller `tests/InviteTest.elm:131`) | Title applied. The OG list is never written to the head |
| J9 | Service worker registration + replaced-controller self-heal reload | `src/index.tsx:12-16`, `src/pwa/serviceWorkerRuntime.ts:29-55` (auto) | MISSING | `ports.js:9747` ("registers NO service worker") | New visitors get no offline shell and no update detection. Web Push waits on `serviceWorker.ready` (`ports.js:8284`) forever |
| J10 | Manifest, icons, apple-touch, robots, sitemap | `public/manifest.json`, `index.html:14-18` (auto) | FULL | `elm/index.html:13-14`, `tools/elm-overlay.mjs:18-22` | Static files. The overlay keeps route heads |
| J11 | Legacy `ocean-*` → `onyx:*` storage migration at boot | `src/lib/migrateStorage.ts:22-40`, `src/index.tsx:5` (auto) | PARTIAL | `ports.js:5121-5133` | Only identity-profile keys. Other `ocean-*` prefs are not copied |
| J12 | Lazy route chunks + stale-chunk recovery (Reload / Continue home / Try again), "Loading page…" | `src/index.tsx:60-90`, `src/app/StaleChunkRecovery.tsx` (auto) | N/A | single bundle | Absent by design |
| J13 | Global command palette on every route incl. public pages | `src/index.tsx:97-108,143` (shortcut) | PARTIAL | `View.elm:340` (overlays render only in `appFrame`) | Public pages render no palette |
| J14 | Global update-available banner on every route | `src/index.tsx:144-146` (auto) | PARTIAL | `View.elm:345`, `ports.js:9897-9906` | App frame only, and it needs a SW that Elm never registers |
| J15 | Scroll to top on page change | `@solidjs/router dist/index.js:1021-1028,1518` (auto) | MISSING | `App.elm:36600-36606` (PushUrl only; no `setViewport`) | The next page opens at the previous scroll offset |
| J16 | In-page `#anchor` links scroll the target into view | `@solidjs/router dist/index.js:1021-1028` (auto) | MISSING | `App.elm:36602` (every `<a>` intercepted) | About topics, Download `#keep-here`, Stats/OnyxOS section navs, Guides index/route/Go-to, Roadmap legend: all inert |
| J17 | Route-change live announcement (route label / "Route not found") | `src/ui/a11y/RouteLifecycle.tsx:117-139`, `RouteAnnouncer.tsx:70-145` (auto) | MISSING | — | SPA navigation is silent for screen readers |
| J18 | `SkipLinkSet` primitive | `src/ui/a11y/SkipLinkSet.tsx:67-93` (DEAD) | N/A | — | No caller |
| J19 | SPA nav from public CTAs into `/app/?join=&at=&topic=&as=` honours the params | `src/app/Connect.tsx:242-264` (UI; read on each AppRoute mount) | PARTIAL | `App.elm:3317,3410,3842` (init only); `App.elm:36608-36632` | Guides "Open the public room", Stats Open room/Join, Invite Join click all land in a plain gate. Works only on hard load |
| J20 | `?signin=1` opens sign-in mode | `src/app/Connect.tsx:245` (UI) | MISSING | `App.elm:2600-2607` (emitted, never read) | Invite "Sign in" lands in guest mode |
| J21 | Links to static files (`/downloads/*.NOTICE.txt`/`.sha256`, `/source/onyxos/*.c`) | `src/routes/Download.tsx:192-205`, `OnyxOS.tsx:220` (UI) | FULL | `App.elm:36600-36606` | Shared bug: both routers SPA-intercept these and show the 404 terminus |
| J22 | "Skip to content" moves focus to `#public-main` | `src/ui/public/PublicSkipLink.tsx:4-40` (UI) | PARTIAL | `View/PublicFrame.elm:148,213` | Link renders, but the click is intercepted (pushUrl only): no focus, no scroll. WCAG 2.4.1 |
| J23 | Brand home link, `aria-current` on Home | `src/ui/public/PublicHeader.tsx:12-37` (UI) | FULL | `View/PublicFrame.elm:151-164` | Mark drawn in CSS (no raster lockup) |
| J24 | Primary nav About/Download from manifest + `aria-current` | `src/ui/public/PublicNav.tsx:55-70` (UI) | FULL | `View/PublicFrame.elm:42-46,110-125` | — |
| J25 | Header "Open Onyx" → `/app/` | `src/ui/public/PublicNav.tsx:73` (UI) | FULL | `View/PublicFrame.elm:179` | — |
| J26 | Menu toggle (`aria-expanded`/controls/label); closes on navigate + Escape | `src/ui/public/PublicNav.tsx:17-23,65,74-85` (UI) | FULL | `View/PublicFrame.elm:180-202`; `App.elm:39550,39744-39752,36631,44205` | — |
| J27 | Menu focus: focus first link on open, Tab trap, Escape restores toggle focus, close at desktop breakpoint | `src/ui/public/PublicNav.tsx:15-51` (UI) | PARTIAL | narrowing documented `View/PublicFrame.elm:20-23` | None of the four focus behaviours exist |
| J28 | Optional context line between header and main | `src/ui/public/PublicFrame.tsx:40-42` (UI) | FULL | `View/PublicFrame.elm:207-212` | — |
| J29 | Labelled `main#public-main tabindex=-1` | `src/ui/public/PublicFrame.tsx:43` (UI) | FULL | `View/PublicFrame.elm:213` | — |
| J30 | Footer identity + Explore links | `src/ui/public/PublicFooter.tsx:5-35` (UI) | FULL | `View/PublicFrame.elm:65-76,214-229` | Elm: 9 links + Open Onyx (Solid: 5) |
| J31 | Public scene-atmosphere host | `src/ui/public/PublicFrame.tsx:35-37` (CSS `display:none`) | N/A | `View/PublicFrame.elm:147` | Hidden in Solid too |
| J32 | Retire bootstrap `.html-shell-skip` | `src/ui/public/PublicFrame.tsx:23-31` (auto) | N/A | overlay replaces `<body>` | — |
| J33 | Landing hero: h1, lede, Open Onyx, See the public room, device note | `src/routes/Landing.tsx:47-65` (UI) | FULL | `View/Landing.elm:162-180` | Device-note copy reworded |
| J34 | Interactive fictional product preview (Room/Home/Messages tabs, arrow keys, mascot) | `src/routes/ProductPreview.tsx:74-178` (UI) | PARTIAL | `View/Landing.elm:98-131` | Static `aria-hidden` sketch; no tabs |
| J35 | Trust claims list + privacy link | `src/routes/Landing.tsx:20-25,73-86` (UI) | FULL | `View/Landing.elm:59-65,183-201` | — |
| J36 | Room-board tabs swap title/copy/action/note; public-room footnote | `src/routes/HomeRoomBoard.tsx:54-115` (UI) | FULL | `View/Landing.elm:202-243`; `App.elm:41718` | — |
| J37 | Board-tab keyboard (Arrow/Home/End + focus), roving tabindex, `aria-controls`/tabpanel ids, polite note | `src/routes/HomeRoomBoard.tsx:59-71,80-101` (UI) | PARTIAL | `View/Landing.elm:207-226` | Click only; no roving or ARIA wiring |
| J38 | Board quick links + "More to explore" shelf | `src/routes/HomeRoomBoard.tsx:103-108`, `Landing.tsx:11-18,92-104` (UI) | FULL | `View/Landing.elm:227-251` | Slashless hrefs (canonical form is `/x/`) |
| J39 | About hero, product-sketch figure, CTAs, context line | `src/routes/About.tsx:19-77` (UI) | FULL | `View/About.elm:170-220,333-335` | — |
| J40 | About topic nav (Rooms/People/Join/Hosting/Accessibility) | `src/routes/About.tsx:79-85` (UI) | PARTIAL | `View/About.elm:221-227` | Inert (J16) |
| J41 | About Rooms/People/Join/Hosting sections + quiet operator links | `src/routes/About.tsx:87-213` (UI) | FULL | `View/About.elm:228-313` | — |
| J42 | Accessibility statement disclosure (5 topics + client audit list) | `src/routes/About.tsx:215-231`, `src/shell/AccessibilityStatement.tsx:15` (UI) | FULL | `View/About.elm:27-167,314-328` | Copy inherited verbatim; claims not re-verified for Elm |
| J43 | `/accessibility` `/glossary` `/integrations` `/agents` pages (content, main label, context, title) | `src/routes/PublicInfo.tsx:15-20,55-97` (UI) | FULL | `View/PublicInfo.elm:28-170`; `View.elm:83-85` | — |
| J44 | Slashless PublicInfo aliases | `src/routes/PublicInfo.tsx:23-42` (UI) | FULL | `View/PublicInfo.elm:76-104` | — |
| J45 | Privacy facts page | `src/routes/TrustPages.tsx:106-140` (UI) | FULL | `View/Trust.elm:159-180` | — |
| J46 | House rules (12) + security-report link | `src/routes/TrustPages.tsx:22-35,91-105` (UI) | FULL | `View/Trust.elm:129-156` | — |
| J47 | Contact page (GitHub new tab, SECURITY.md) | `src/routes/TrustPages.tsx:141-164` (UI) | FULL | `View/Trust.elm:183-199` | — |
| J48 | Status feed fetch with 3-path fallback + bounded normalize | `src/lib/stats/status.ts:76-138` (auto) | FULL | `Status.elm:57-61,416`; `App.elm:41110-41138` | — |
| J49 | One honest sentence per feed state (7 states) | `src/routes/Status.tsx:18-56,101-112` (UI) | FULL | `Status.elm:235`; `View/Status.elm:52-63` | — |
| J50 | "Check again" (busy/disabled) | `src/routes/Status.tsx:114-125` (UI) | FULL | `View/Status.elm:64-79`; `App.elm:40999` | — |
| J51 | 30 s auto-recheck | `src/routes/Status.tsx:65-70` (auto) | FULL | `App.elm:37477-37491` | Driven by Tick |
| J52 | Status fetches immediately on load | `src/routes/Status.tsx:64` (auto) | PARTIAL | `App.elm:37486` (Tick only; init has no fetch) | Cold load shows "no public report" in the live region for ≤1 s |
| J53 | Roadmap pointer section | `src/routes/Status.tsx:130-137` (UI) | FULL | `View/Status.elm:83-88` | — |
| J54 | Download hero, `/install` kicker, keep-here section, honesty aside | `src/routes/Download.tsx:365-486` (UI) | FULL | `View/Download.elm:36-97`; `App.elm:2591` | `#keep-here` CTA inert (J16) |
| J55 | Download catalog fetch + live catalog receipt | `src/routes/Download.tsx:373-386,498-508` (auto) | PARTIAL | `App.elm:2403-2413,36661-36666` | Never fetched on a hard load of `/download/` or `/install/`: page shows "Catalog unavailable" and withholds all download controls |
| J56 | Per-lane availability states + withheld-control copy | `src/routes/Download.tsx:96-115,172-206` (UI) | FULL | `View/Download.elm:169-273` | — |
| J57 | Archive download (`download` attr), Honesty notice, SHA-256 file links | `src/routes/Download.tsx:184-205` (UI) | FULL | `View/Download.elm:238-257` | Notice/sha links hit J21 |
| J58 | Per-lane SHA-256 sidecar fetch + catalog fallback + loading copy | `src/routes/Download.tsx:38-47,101-106,219-239` (auto) | FULL | `App.elm:41008-41044,41075-41093` | — |
| J59 | Copy hash / Copy steps (Copied / Copy failed, 1.6 s revert) | `src/routes/Download.tsx:59-89` (UI) | FULL | `View/Download.elm:392-414`; `App.elm:40031-40040` | — |
| J60 | Per-lane install steps + notes | `src/routes/Download.tsx:242-285` (UI) | FULL | `View/Download.elm:274-358` | Collapsed inside `<details>` |
| J61 | macOS coming-soon card | `src/routes/Download.tsx:295-358` (UI) | FULL | `View/Download.elm:420-466` | — |
| J62 | Verify-a-download block | `src/routes/Download.tsx:519-536` (UI) | FULL | `View/Download.elm:99-109` | — |
| J63 | Stats index fetch + 30 s poll | `src/routes/Stats.tsx:349,363-367` (auto) | FULL | `App.elm:2222,37506-37526` | On cold load the first fetch waits ≤1 s for Tick |
| J64 | Feed observation label, ledger, Refresh data (index + inspected room) | `src/routes/Stats.tsx:567-595` (UI) | FULL | `View/Stats.elm:52-62,149-156`; `App.elm:40042-40061` | — |
| J65 | Network summary (people online, rooms moving, messages, latest day ± delta) | `src/routes/Stats.tsx:596-622` (UI) | FULL | `View/Stats.elm:157-190` | — |
| J66 | Signal-path timeline (3 checks) + note | `src/routes/Stats.tsx:40-136,626-657` (UI) | FULL | `View/Stats.elm:193-225` | — |
| J67 | Stats section nav anchors | `src/routes/Stats.tsx:659-664` (UI) | PARTIAL | `View/Stats.elm:68-73` | Inert (J16) |
| J68 | 7/14-day window toggle + status + URL replaceState | `src/routes/Stats.tsx:518-527,674-707` (UI) | FULL | `View/Stats.elm:668-688`; `App.elm:40129-40141` | — |
| J69 | Network pulse bars + sr-only list + chart note | `src/routes/Stats.tsx:711-745` (UI) | FULL | `View/Stats.elm:228-372` | — |
| J70 | Room spotlight + "Join the conversation" | `src/routes/Stats.tsx:749-782` (UI) | FULL | `View/Stats.elm:374-409` | Deep link hits J19 |
| J71 | Inspect → URL `?room=` + scroll/focus reveal (user-activated only) | `src/routes/Stats.tsx:257-265,412-423` (UI) | FULL | `App.elm:40072-40083`; `ports.js:6218-6237` | — |
| J72 | Inspector defaults to busiest room; match-gated loading copy | `src/routes/Stats.tsx:375-397` (auto) | FULL | `App.elm:41047-41071` | — |
| J73 | Inspector metrics (8) + hour/day/flow cards + week×hour heatmap | `src/routes/Stats.tsx:831-972` (UI) | FULL | `View/Stats.elm:460-640` | First-seen shown as a UTC label, not locale |
| J74 | Compare toggle (max 2, disabled when full) + URL `compare` | `src/routes/Stats.tsx:424-444` (UI) | FULL | `App.elm:40085-40116` | — |
| J75 | Comparison Copy link (copying/copied/failed) + Clear selection | `src/routes/PublicRoomComparison.tsx:150-215` (UI) | FULL | `View/Stats.elm:740-790`; `App.elm:40118,40143-40160` | — |
| J76 | Comparison chips, missing-from-export, 5-row table, headline, feed note | `src/routes/PublicRoomComparison.tsx:218-318` (UI) | FULL | `View/Stats.elm:791-890` | — |
| J77 | Directory search + scope (All/Here now/24h) + sort (4) + result count | `src/routes/Stats.tsx:456-475,996-1022` (UI) | FULL | `View/Stats.elm:901-987`; `Stats.elm:1739-1780` | — |
| J78 | Room row: sparkline, numbers, Compare, Inspect, Open room, Room ledger | `src/routes/Stats.tsx:267-341` (UI) | FULL | `View/Stats.elm:989-1074` | — |
| J79 | Shareable stats state restored on load (`?room` `?compare` `?window`) | `src/routes/Stats.tsx:353-361` (auto) | PARTIAL | `App.elm:36673-36686` (UrlChanged only); `App.elm:3660-3668` (init blanks) | Hard-loaded share links ignore their query |
| J80 | Roadmap hero, legend, priority cards, no-dates note | `src/routes/Roadmap.tsx:64-139` (UI) | FULL | `View/Roadmap.elm:133-162` | — |
| J81 | Active priority from `#roadmap-x` on load and navigation | `src/routes/Roadmap.tsx:31-35,43-54` (auto) | FULL | `App.elm:1367-1387,3633,36631` | — |
| J82 | Legend click selects priority (modified clicks stay native) | `src/routes/Roadmap.tsx:56-62,89-101` (UI) | FULL | `View/Roadmap.elm:60-97`; `App.elm:39754` | — |
| J83 | Scroll to + focus the selected roadmap card | `src/routes/Roadmap.tsx:37-41,61` (UI) | MISSING | narrowing `View/Roadmap.elm:14-15` | Card neither scrolls nor takes focus |
| J84 | OnyxOS sections, hero, native grid, source specimen, workbench, close | `src/routes/OnyxOS.tsx:121-250` (UI) | FULL | `View/Onyxos.elm:183-280` | Section nav inert (J16); source link hits J21 |
| J85 | OnyxOS method tabs: click select | `src/routes/OnyxOS.tsx:174-206` (UI) | FULL | `App.elm:40984-40992` | — |
| J86 | Method tabs: Arrow/Home/End roving with focus following | `src/routes/OnyxOS.tsx:86-119` (UI) | PARTIAL | `View/Onyxos.elm:120-140`; `App.elm:40994-40997` | Selection roves; DOM focus stays on the old (now `tabindex -1`) tab |
| J87 | Invite card from query (join/as/at/topic/reader/by/with) + live title | `src/lib/invite/inviteCard.ts:81-105`, `src/routes/Invite.tsx:47-55` (auto) | FULL | `App.elm:1401`; `View.elm:164-165` | — |
| J88 | Invite heading/welcome/room mark; no-room recovery; access note | `src/routes/Invite.tsx:150-180` (UI) | FULL | `View/Invite.elm:64-122` | — |
| J89 | Invite preview card (title, description, topic) | `src/routes/Invite.tsx:165-177` (UI) | PARTIAL | `View/Invite.elm:92-117` | Title dropped; description shown only with `?by=` |
| J90 | Display name field, validation, `?as=` prefill | `src/routes/Invite.tsx:57-60,112-115,192-202` (UI) | FULL | `View/Invite.elm:145-165`; `App.elm:39763,36622-36627` | — |
| J91 | Join link click → `/app` with join/as/at/topic | `src/routes/Invite.tsx:204` (UI) | PARTIAL | `View/Invite.elm:134-141` | SPA nav drops the params (J19) |
| J92 | Enter-submit join (full page load) | `src/routes/Invite.tsx:186-190` (UI) | FULL | `App.elm:40973-40982` (LoadUrl) | — |
| J93 | Invalid submit focuses the name field | `src/routes/Invite.tsx:117-125` (UI) | MISSING | narrowing `App.elm:40974-40976` | Error is shown; focus stays put |
| J94 | Copy invite link + assertive/polite status | `src/routes/Invite.tsx:90-110,207-239` (UI) | FULL | `App.elm:39766-39773`; `View/Invite.elm:168-190` | — |
| J95 | "Sign in" (`?signin=1`) + "How Onyx works" links | `src/routes/Invite.tsx:75-79,219-226` (UI) | PARTIAL | `View/Invite.elm:178-183` | Sign-in intent lost (J19 + J20) |
| J96 | Hold update-reload while a name is typed | `src/routes/Invite.tsx:38-44` (auto) | N/A | `ports.js:9914-9935` | Elm never auto-reloads (approval only) |
| J97 | `/guides` + `/community` surfaces (kicker/title/main label/context) | `src/routes/Guides.tsx:39-59,430-438` (UI) | FULL | `Guides.elm:142-200`; `View.elm:118-122` | — |
| J98 | Guides hero + "Join a room" | `src/routes/Guides.tsx:230-240` (UI) | FULL | `View/Guides.elm:248-255` | — |
| J99 | Task index, route-map cards, "Go to: next" anchors | `src/routes/Guides.tsx:246-250,285-300,359` (UI) | PARTIAL | `View/Guides.elm:191-208,257-268,337-345` | Inert (J16) |
| J100 | Progress meter, count, "Next:" status | `src/routes/Guides.tsx:264-280` (UI) | FULL | `View/Guides.elm:270-293` | — |
| J101 | Persisted progress `onyx:guides-progress-v1` (allowlisted ids) | `src/lib/guides/progress.ts:3-57`, `src/routes/Guides.tsx:171-189` (auto) | FULL | `ports.js:6282-6305`; `App.elm:40000-40017,40957` | — |
| J102 | Room-starter route (Done / Start here / Then, `aria-current=step`) | `src/lib/guides/roomStarter.ts:53-69` (UI) | FULL | `Guides.elm:225`; `View/Guides.elm:191-208` | — |
| J103 | Safety snapshot with call-recording note substitution | `src/routes/Guides.tsx:62-69`, `src/lib/guides/roomStarter.ts:22-28` (UI) | FULL | `Guides.elm:51-76` | — |
| J104 | Copy plan + status | `src/routes/Guides.tsx:191-206` (UI) | FULL | `App.elm:40024-40029`; `View/Guides.elm:313-333` | — |
| J105 | Download plan as text (data URL, filename) | `src/routes/Guides.tsx:161-163,330` (UI) | FULL | `View/Guides.elm:230-231,322` | — |
| J106 | Reset plan | `src/routes/Guides.tsx:185-189` (UI) | FULL | `App.elm:40019-40022` | — |
| J107 | How-to cards: Mark done toggles, optional card, external links in new tab | `src/routes/Guides.tsx:376-420` (UI) | FULL | `View/Guides.elm:123-188` | — |
| J108 | Principles card | `src/routes/Guides.tsx:366-374` (UI) | FULL | `View/Guides.elm:356-361` | — |
| J109 | Public route manifest (ids/groups/primary-nav projection) | `src/ui/navigation/publicRouteManifest.ts:56-113` (UI) | FULL | `View/PublicFrame.elm:42-76` | Hard-coded, not data-driven |
| J110 | PublicLookPicker (public looks + active extra; radio roving) | `src/theme/PublicLookPicker.tsx:7-48`, `src/theme/publicLooks.ts:37-80` (UI) | FULL | `View/Appearance.elm:62,96,313-329`; `View/Studio.elm:220-240` | — |
| J111 | `/appearance` route | `src/index.tsx:128` (UI) | FULL | `View.elm:115-116` | Page detail belongs to the theming section |
| J112 | `/app` route → connect gate / shell | `src/index.tsx:127`, `src/routes/AppRoute.tsx:29-51` (UI) | FULL | `View.elm:130-135` | App runtimes belong to other sections |
| J113 | Encryption-policy chip + `?e2ee=` on room invite share | `src/lib/invite/encryptionPolicyBadge.ts`, `src/shell/ChannelSettings.tsx:261-266,723-732` (UI) | MISSING | `InviteShare.elm` (no policy) | Overlaps room-settings section |
| J114 | Copy call invite link from voice bar | `src/lib/invite/roomCallInvite.ts:18-35`, `src/shell/voice/VoiceBar.tsx:1198-1218` (UI) | MISSING | — | Overlaps calls section |
| J115 | `inviteRoomPulse` | `src/lib/invite/inviteRoomPulse.ts` (DEAD) | N/A | — | — |
| J116 | Stats backup-manifest fetch | `src/lib/stats/backups.ts:64` (DEAD) | N/A | `Stats.elm:2-7` (decode only) | — |
| J117 | Channel pulse feed (feeds the shell scrubber/heatline) | `src/lib/stats/channelStats.ts:68` (auto) | FULL | `App.elm:45911-45964` | Out of section |
| J118 | ProofRail / ProofReceipt | `src/ui/proof/*` (DEAD) | N/A | — | — |
| J119 | SystemSpecimen lab surface | `src/ui/lab/SystemSpecimen.tsx` (DEAD) | N/A | — | — |
| J120 | Mascot SVG component | `src/components/brand/Mascot.tsx` (DEAD) | N/A | — | — |

Row counts: FULL 80 · PARTIAL 20 · CORE-ONLY 1 · MISSING 9 · N/A 10 (120 rows).

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- `V3_ROADMAP.md:8` says "all public routes at parity". Overstated. A hard load of `/download/` never fetches the catalog (J55). SPA navigation into `/app` drops `join`/`as`/`signin` (J19, J20). The skip link and all in-page anchors are inert (J22, J16). There is no route announcer (J17), no SW registration (J9), and stats share links are ignored on hard load (J79).
- `COVERAGE.md:198` says "PublicFrame chrome **done** (… skip link …)". The link renders, but `Browser.application` intercepts it into a `PushUrl`; focus never reaches `#public-main`.
- `COVERAGE.md:198` says "Download page **done** … App catalog + available-lane sidecar fetch fold". The fetch exists only in `UrlChanged` (`App.elm:36661`); `init`/`Main.init` never request it, and the only test (`tests/ViewTest.elm:4757`) drives `UrlChanged`.
- `COVERAGE.md:198` says "Stats page **done** (… query/deeplink/href helpers …)". `?room/?compare/?window` are parsed only on `UrlChanged` (`App.elm:36680-36682`); `init` blanks them (`App.elm:3660-3668`).
- `COVERAGE.md:198` says "Landing revamp **done** … copy 1:1". Slightly overstated: the device-note copy is reworded, and the interactive ProductPreview is replaced by a static sketch (J34).
- `COVERAGE.md:197` says "All 13 routes resolve". Understated: `Route` has 20 constructors (19 paths + NotFound) plus the `/install` alias.
- `V3_ROADMAP.md:131` (7.5) says "Pending: deploy path (deliberately none) … minification (no uglify/esbuild resolvable)". Understated: `deploy.sh:796-803` has `ONYX_CLIENT=elm` with `tools/elm-overlay.mjs`, and `elm/tools/build.sh:43-74` minifies with esbuild. CSP is still pending, since the inline boot script remains at `elm/index.html:52-221`.
- `COVERAGE.md:207` says "no minification or CSP". Minification is done (`elm/tools/build.sh:61-66`); CSP is still open.
- Module docs `View/NotFound.elm:195-197`, `View/Invite.elm:11-12,16-17` and `View/Guides.elm:12` say document metadata and the update-hold "stay ports-side". No such ports exist in `ports.js`.

#### Elm better than Solid
- One optimized bundle. Public routes have no lazy-chunk "Loading page…" fallbacks and no stale-chunk failure mode (Solid needs `withLazyRoute` + `StaleChunkRecovery`, `src/index.tsx:60-90`).
- More reachable destinations: the footer has 9 links plus Open Onyx (`View/PublicFrame.elm:65-76,222`), and the phone menu adds "More from Onyx" (`View/PublicFrame.elm:52-60,174-175`). Solid shows 5 footer links and 2 nav items.
- The 404 terminus adds "Other places to go" (Guides/Status/About) (`View/NotFound.elm:224-228`).
- Same-route query navigation (e.g. "Room ledger" `/stats/?room=` from the directory, Composer, JumpToDate or ConnectPulse) re-seeds inspector/compare/window via `UrlChanged` (`App.elm:36673-36686`). Solid reads the query once at mount (`src/routes/Stats.tsx:353-361`), so on `/stats` such links most likely only change the URL.

#### Gaps (ranked by user impact)
- `[High]` Download catalog never loads on a hard visit (J55). Same root cause makes Status/Stats wait for Tick (J52, J63). Fix: in `Main.init`, run the same route-entry fold `UrlChanged` uses (`requestDownloadCatalog` / `requestStatus` / `requestStatsIndex` plus stats query seeding) when `Route.fromUrl url` matches.
- `[High]` SPA navigation into `/app/?join=&at=&topic=&as=&signin=` loses the params (J19, J20, J91, J95). Fix: in the `App.elm` `UrlChanged` fold, when the route becomes `App`, reparse with `parseDeepLinkQuery` into `pendingDeepLink*`, seed `connectForm.nick` from `as` and the mode from `signin`. Alternative: make public→app links `LoadUrl`.
- `[High]` Skip link and every in-page `#anchor` are inert (J22, J16, J40, J67, J99). Fix: in `LinkClicked`, when only the fragment differs, emit a new `scrollToFragment` port (scrollIntoView + focus, temporary `tabindex=-1`) and `replaceUrl`.
- `[High]` No service worker registration (J9): no offline shell, no update banner, and Web Push hangs on `serviceWorker.ready`. Fix: in `ports.js` `wire`, `navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'})` plus a guarded `controllerchange` reload.
- `[Med]` No scroll reset when the page changes (J15). Fix: in `UrlChanged`, when the path changes and there is no fragment, run `Task.perform (\_ -> NoOp) (Browser.Dom.setViewport 0 0)` from `Main.perform`.
- `[Med]` No route-change announcement (J17). Fix: a persistent visually hidden `role=status` node in `View.view` fed by a `routeAnnouncement` field set in `UrlChanged` from a Route→label table (`RouteLifecycle` labels).
- `[Med]` Stats share links ignore their query on hard load (J79). Fix: seed `statsInspected`/`statsCompare`/`statsWindow` from `url.query` in `App.init` (`App.elm:3660-3668`).
- `[Med]` Static-file links (download notice/sha, OnyxOS source) render the 404 terminus (J21; shared bug). Fix: guard in `LinkClicked`: paths under `/downloads/` or `/source/`, or with a file extension, become `LoadUrl`.
- `[Med]` Public menu focus management missing (J27). Fix: a `focusById`/trap port fired from `ToggleNavMenu`/`NavMenuEscape`; close on a desktop-breakpoint resize.
- `[Med]` Keyboard focus follow-through is missing on tabs and cards (J37, J86, J83, J93). Fix: one generic `focusAfterRender` port emitted by `SelectBoardTab`, `OnyxosStageKey`, `SelectRoadmapPriority` and `InviteJoinSubmit` (plus roving tabindex/`aria-controls` in `View/Landing.elm`).
- `[Low]` Palette and update banner are absent on public routes (J13, J14). Fix: render `View.Switcher.palette` + `View.Polish.updateBanner` alongside `frame` in `View.view`.
- `[Low]` Head metadata is not updated on SPA nav (J4, J5, J8). Fix: a `documentMeta` port called from `UrlChanged` that writes description/canonical/OG, `robots noindex` for NotFound, and `Invite.inviteOgMeta`.
- `[Low]` Landing preview is a static sketch (J34), the invite preview card is trimmed (J89), and legacy `ocean-*` keys are not migrated (J11). Restore the tabbed preview in `View/Landing.elm`; add a one-shot copy loop in `elm/index.html` before `Elm.Main.init`.
- `[Low]` No E2EE-policy chip/param on room invite share (J113) and no voice-bar call invite (J114). Fix: `InviteShare.payload` + `View/RoomSettings`/`View/CallStage` buttons (owned by the room-settings and calls sections).

### H — Calls — voice, video, screen share, stage, Watch Together
Solid walked: `src/shell/CallsHub.tsx`, `StagePanel.tsx`, `WatchTogetherActivity.tsx`, all of `src/shell/voice/**` (VoiceBar every control/popover, VoiceStage, ParticipantTile, VoicePip, CallJoinBanner, CallStatusAnnouncer, callRejoinState, voiceParticipants, 4 overlays, VoiceSettings), `src/media/useCadenceMedia.ts`, `src/lib/media/*`, user-visible parts of `src/lib/cadence-media/*`, `callMediaSession.ts`, `screenWakeLock.ts`, `mediaEngineMount.ts`, store voice/DM/stage/stream actions (`store.ts:15569–15690`, `17890–18333`), MEDIA inbound (`store.ts:11022–11190`), CTCP STAGE (`store.ts:12597`), AppShell join/rejoin/mount (`AppShell.tsx:332–660`, `1410–1725`), PresenceRibbon voice arm, spotlight palette.
Elm checked: `Cadence`, `Media`, `CallUi`, `CallDock`, `CallMedia`, `CallCaptions`, `VoiceSettings`, `Stage`, `View/{Calls,CallPresence,CallStage,CallVideo,CallDock,CallOverlays,VoiceSettings,StageMode}.elm`, App folds (`App.elm:41139–41720`, `45215–45500`), `elm/media/{voice-engine,voice-core,platform}.ts`, `ports.js` voice bridge (`2182–2560`, `3738–3900`, `4092–4360`), `design/calls/CALLS_DESIGN.md`.
**Shipped state (commit fbe04585):** video is switched OFF on the live network (`media/voice-engine.ts:101` `VIDEO_ENABLED = false`; `startCamera` refuses); intended UI: no camera button, no "Join with video". **But see H21/H12b: the hide never takes effect and video join bypasses the switch.**

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| H1 | Calls hub: status pip, title, intro, "What happens next" truth copy per presentation | `src/shell/CallsHub.tsx:59` (UI) | FULL | `View/Calls.elm:166`, `Media.classifyHubPresentation` | Elm status `<p>` lacks `aria-live=polite` |
| H2 | Hub "Return to call" (provisional/established) | `CallsHub.tsx:174`, `AppShell.tsx:1174` (UI) | FULL | `App.elm:41144` `CallsReturnToCall` | — |
| H3 | Hub "Choose a room" | `CallsHub.tsx:166`, `AppShell.tsx:1166` (UI) | FULL | `App.elm:41139` `CallsChooseRoom` | Elm just closes hub to reveal rail (no mobile Rooms drawer open) |
| H4 | Hub never joins (navigation-only rule) | `CallsHub.tsx:3` (UI) | PARTIAL | `View/Calls.elm:245–256` | Elm hub adds "Join call in X" / "Join with video in X"; video button ungated by `cameraSupported` (see H12b) |
| H5 | Room header voice chip (count, ≤3 faces, status, click joins audio / returns) | `PresenceRibbon.tsx:758` (UI) | FULL | `View/CallPresence.elm:150` | local-health arm omits "captions" (Solid `PresenceRibbon.tsx:146`) |
| H6 | Header lifecycle pills Incoming/Calling/Connecting…/In call | `PresenceRibbon.tsx:388` (UI) | FULL | `View/CallPresence.elm:198` | — |
| H7 | Header "Join call"/"Call" button (voiceEntry pref) | `PresenceRibbon.tsx:821` (UI) | FULL | `View/CallPresence.elm:230` | — |
| H8 | voiceEntry off → More menu "Join call" fallback | `PresenceRibbon.tsx:984` (UI) | MISSING | `View/CallPresence.elm:226` (hidden) | Elm hides; empty room then only joinable via hub |
| H9 | Palette "Start voice / Start video in current room" | `src/chat/spotlight/commands.ts:1317` (palette) | MISSING | `Switcher.elm:637` (chords only) | no switcher action |
| H10 | Scheduled-event "Join call" | `ScheduledEventLine.tsx:77` (UI) | FULL | `View/RoomSettings.elm:955` | — |
| H11 | Join flow: synchronous provisional surface, in-gesture capture, engine boot, rollback | `AppShell.tsx:486` (UI) | PARTIAL | `App.elm:41150` `CallJoin`; `media/voice-core.ts:713` | in-gesture capture kept; no provisional state until engine `in_call` (permission prompt + ≤20 s IDENTITY ADD wait show nothing) |
| H12 | Join failure → toast + "Couldn't join. Try again." banner + Try again | `AppShell.tsx:557`, `CallJoinBanner.tsx:14` (UI) | FULL | `View/CallPresence.elm:313`, `CallDock.elm:608` | Elm classifies permission/no-device/account/encryption; no toast |
| H12b | "Join with video" (pre-join) | `commands.ts:1340` (palette only) | PARTIAL | `View/CallPresence.elm:279–290`, `View/Calls.elm:254` | Shown despite video-off: `cameraSupported` never forwarded; `joinVoice({video})`→`engine.joinVideo` bypasses `VIDEO_ENABLED` (voice-core.ts:803) |
| H13 | Rejoin banner after transport loss | `callRejoinState.ts:9`, `AppShell.tsx:461` (auto/UI) | FULL | `CallUi.elm:378` `bannerFor`, CallDock rejoin memory | — |
| H14 | Join-muted preference applied after capture | `store.ts:17991` (UI pref) | FULL | `App.elm:41180`, `VoiceSettings.elm:102` | Elm default ON (Solid default off, `voiceSettingsPersistence.ts:34`) — provisional §7.2 |
| H15 | Leave call (bar) | `VoiceBar.tsx:1863`, `store.ts:18026` (UI) | FULL | `View/CallStage.elm:327` `call-leave`, `App.elm:41195` | — |
| H16 | Bar people: avatars + names "You, alice +2" | `VoiceBar.tsx:1365` (UI) | PARTIAL | `View/CallStage.elm:327` | Elm shows where + "· N people" only |
| H17 | Call timer (role=timer, anchored to start) | `VoiceBar.tsx:704` (UI) | FULL | `CallUi.elm:602`, `View/CallStage.elm:327` | "—" while reconnecting |
| H18 | Participant count | `VoiceBar.tsx:1389` (UI) | FULL | `CallUi.peopleLabel` (`CallUi.elm:592`) | — |
| H19 | Active-speaker chip (sticky dominant tracker) | `VoiceBar.tsx:1002`, `:1405` (auto) | PARTIAL | `App.elm:45410` (Ctrl+Shift+S), `CallMedia.advanceSpeaker` | chip dropped by spec; tracker drives spotlight/tile order |
| H20 | Mute / unmute | `VoiceBar.tsx:1447`, `store.ts:18088` (UI) | FULL | `View/CallStage.elm:327` `call-mute`, `App.elm:41211` | + Ctrl+Shift+M |
| H21 | Camera on/off | `VoiceBar.tsx:1463`, `store.ts:18066` (UI) | PARTIAL | `View/CallStage.elm:435`/`482`, `App.elm:41366`, `ports.js:2410` | Video off by design; hide broken (default `cameraSupported=True`, CallJoin resets it) → button shows, click silently does nothing |
| H22 | Invite with room link (clipboard, toast, `invite-status`) | `VoiceBar.tsx:1198`, `:1477` (UI) | MISSING | `View/CallStage.elm:554` (absent) | room invite share exists elsewhere (`InviteShare.elm`), not in call |
| H23 | "More call tools" popover (dialog, Escape) | `VoiceBar.tsx:1523` (UI) | FULL | `View/CallStage.elm:554`, `App.elm:41262` | focus trap via ports `[data-call-dialog]` |
| H24 | Deafen / undeafen | `VoiceBar.tsx:1548`, `store.ts:18095` (UI) | FULL | `View/CallStage.elm:554` `deafen-button`, `App.elm:41393` | engine-confirmed |
| H25 | Screen share start/stop, pending/unavailable labels, `screenshare-status` | `VoiceBar.tsx:1050`, `:1566` (UI) | FULL | `View/CallStage.elm:515`, `CallMedia.elm:174–270`, `App.elm:41383` | hidden on iOS; stop rejoins as voice (`voice-core.ts:878`) |
| H26 | Record local audio → WebM download, statuses, auto-finalize on end | `VoiceBar.tsx:1108`, `:1584` (UI) | MISSING | `media/voice-core.ts:181` (no record API) | engine has `startRecording`; adapter doesn't expose |
| H27 | Raise / lower hand (✋ reaction out) | `VoiceBar.tsx:1604`, `store.ts:18130` (UI) | FULL | `View/CallOverlays.elm:60`, `App.elm:41489` | + Ctrl+Shift+H |
| H28 | Reaction picker (8 quick, roving arrows/Home/End) | `VoiceBar.tsx:371`, `:1619` (UI) | FULL | `View/CallOverlays.elm:87`, `:181`, `App.elm:41565` | disabled for DM calls |
| H29 | Captions toggle | `VoiceBar.tsx:1653` (UI) | FULL | `View/CallOverlays.elm:104`, `App.elm:41518` | + Ctrl+Shift+C |
| H30 | Spatial audio popover: per-peer XY pad (drag, arrows/Home), peer picker, SR readout, unavailable state | `VoiceBar.tsx:1673–1800` (UI) | MISSING | `media/voice-core.ts:181` (no pan API) | spec defers "post-ship"; engine `setPeerPan` unused |
| H31 | Layout toggle grid ↔ spotlight | `VoiceBar.tsx:1808` (UI) | FULL | `View/CallStage.elm:554` `layout-button`, `App.elm:41444` | Ctrl+Shift+G 3-way cycle |
| H32 | Stage size cycle compact→expanded→fullscreen | `VoiceBar.tsx:1834` (UI) | FULL | `View/CallStage.elm:554`, `App.elm:41456` | — |
| H33 | Open voice settings | `VoiceBar.tsx:1847` (UI) | FULL | `View/CallOverlays.elm:146` | — |
| H34 | Security chip (hop/E2EE/degraded/insecure, padlock honesty) | `VoiceBar.tsx:125` (UI) | FULL | `View/CallStage.elm:654`, `CallUi.elm:897` | Elm adds "Stage broadcast" level |
| H35 | Privacy sheet: media path, reserved privacy code, local fingerprint | `VoiceBar.tsx:196` (UI) | FULL | `View/CallStage.elm:679` | Elm adds per-peer fingerprints |
| H36 | SFU topology (bar badge + sheet row) from live loss + room STATS | `VoiceBar.tsx:460`, `:317` (auto) | CORE-ONLY | `CallUi.elm:1043` | no producer: adapter never emits `sfu`, no STATS fold → always "SFU path unknown" |
| H37 | Connection-quality pip (4 bars + bitrate; tooltip jitter/loss) | `VoiceBar.tsx:620` (auto) | PARTIAL | `View/CallVideo.elm:516` | tier only; no bitrate/jitter/loss |
| H38 | Turn-off-camera prompt on sustained Poor | `VoiceBar.tsx:663` (auto) | FULL | `View/CallVideo.elm:543`, `App.elm:41412` | moot while video off |
| H39 | Bandwidth-ladder step-down toasts | `VoiceBar.tsx:569` (auto) | FULL | `CallMedia.elm:527`, `App.elm:36446` | — |
| H40 | Live regions `invite-status` / `record-status` | `VoiceBar.tsx:1491`, `:1511` (UI) | MISSING | — | features absent (H22, H26) |
| H41 | Screen wake lock while in call | `VoiceBar.tsx:864`, `screenWakeLock.ts` (auto) | MISSING | — | — |
| H42 | OS Media Session call controls (togglemicrophone/togglecamera/hangup, neutral metadata) | `VoiceBar.tsx:750`, `callMediaSession.ts` (auto) | MISSING | — | — |
| H43 | Local VAD → own speaking indicator | `VoiceBar.tsx:917` (auto) | FULL | `media/voice-core.ts:455` | Elm also broadcasts `MEDIA SPEAKING` |
| H44 | Persistent full call bar across rooms / Home / Calls | `AppShell.tsx:1529` (UI) | PARTIAL | `View/CallDock.elm:303` | elsewhere Elm shows mini view (Mute/Return/Leave) only |
| H45 | Stage status line (prejoin/connecting/live/ended) | `VoiceStage.tsx:197` (UI) | PARTIAL | `CallUi.elm:417`, `View/CallStage.elm:144` | no "local media unavailable — you can stay and listen" |
| H46 | Audio-only avatar strip vs video mode | `VoiceStage.tsx:166` (auto) | FULL | `View/CallStage.elm:144` | density + collapsed list |
| H47 | Grid layout, responsive columns | `VoiceStage.tsx:285` (UI) | FULL | `View/CallVideo.elm:228` | + pages of 16 |
| H48 | Spotlight (pinned → speaker → self) + filmstrip | `VoiceStage.tsx:311` (UI) | FULL | `View/CallVideo.elm:281` | — |
| H49 | Screenshare layout (primary + filmstrip) | `VoiceStage.tsx:350` (auto) | FULL | `View/CallVideo.elm:182` | Elm also remote shares + grid escape |
| H50 | Pin / unpin to spotlight | `ParticipantTile.tsx:358`, `store.ts:18116` (UI) | FULL | `View/CallVideo.elm:385`, `App.elm:41462` | — |
| H51 | Stage chrome buttons Compact / Expand / Fullscreen | `VoiceStage.tsx:221` (UI) | PARTIAL | `App.elm:41459` `CallStageSizeSet` (Esc only) | no direct buttons; cycle via More / Ctrl+Shift+F |
| H52 | Esc exits fullscreen stage | `VoiceStage.tsx:188` (shortcut) | FULL | `App.elm:44306` | — |
| H53 | Roster join/leave announcer | `CallStatusAnnouncer.tsx:42` (auto) | FULL | `View/CallStage.elm:807`, `CallUi.elm:701` | + "raised a hand" |
| H54 | Tile video binding + avatar fallback | `ParticipantTile.tsx:166` (auto) | FULL | `View/CallVideo.elm:313`, `ports.js:2500` | — |
| H55 | Tile badges: speaking, muted, deafened, camera off, hand, you | `ParticipantTile.tsx:381` (UI) | FULL | `View/CallVideo.elm:313` | + "Video paused" |
| H56 | Tile role badge ~ @ + | `ParticipantTile.tsx:405` (UI) | PARTIAL | `View/CallStage.elm` personCell | video tiles draw none; audio cells show role word |
| H57 | Tile native video PiP (open/close/pending state) | `ParticipantTile.tsx:343` (UI) | PARTIAL | `View/CallVideo.elm:357`, `App.elm:41481` | label always "Open…"; no active/pending state |
| H58 | Tile per-peer quality pips | `ParticipantTile.tsx:323` (DEAD: never passed) | N/A | `View/CallVideo.elm:416` | Elm renders when engine reports |
| H59 | Mini voice PiP (drag, keys, persisted) | `VoicePip.tsx:189` (DEAD) | N/A | `View/CallDock.elm:303` | Solid never visible: AppShell passes `activeSurface` (`VoicePip.tsx:191`); Elm ships it |
| H60 | Incoming DM ring dialog (Accept/Decline, accepting, error) | `IncomingCallOverlay.tsx:54` (auto) | FULL | `View/CallDock.elm:102`, `App.elm:41277` | no server ring verb; unreachable in practice both sides |
| H61 | Outgoing DM ring + 30 s timeout + Cancel | `store.ts:18177` (DEAD: no caller) | N/A | `View/CallDock.elm:183`, `voice-core.ts:833` | Elm "Call" item always fails closed ("Direct calls aren't available yet") |
| H62 | Live captions overlay (last 3, source line, role=log) | `CaptionsOverlay.tsx:58` (UI) | FULL | `View/CallOverlays.elm:287` | — |
| H63 | Copy caption transcript | `CaptionsOverlay.tsx:77` (UI) | FULL | `App.elm:41586` | — |
| H64 | Per-caption on-device translate / retry | `CaptionsOverlay.tsx:156` (UI) | FULL | `View/CallOverlays.elm:369` | — |
| H65 | Caption provenance badges, "You · local"/"Remote", nick colour | `CaptionsOverlay.tsx:196`, `:230` (UI) | PARTIAL | `View/CallOverlays.elm:369` | nick + text only |
| H66 | "On-device caption translation is unavailable" note | `CaptionsOverlay.tsx:206` (UI) | PARTIAL | — | dropped by design (button hidden) |
| H67 | Floating reactions (emoji + nick, 2.6 s) | `ReactionsOverlay.tsx:22` (auto) | FULL | `View/CallOverlays.elm:247` | max 3 vs 24 |
| H68 | MEDIA CAPTION / TRANSCRIPT replay fold | `store.ts:11037` (auto) | FULL | `Media.elm:169` | — |
| H69 | Peer ✋ → raised hand 15 s | `useCadenceMedia.ts:404` (auto) | FULL | `CallCaptions.elm:137` | — |
| H70 | MEDIA presence folds JOIN/ROSTER/LEAVE/SPEAKING/SILENT/MUTE/UNMUTE/HAND/REACT | `store.ts:11098` (auto) | FULL | `Media.elm:217`, `:255` | Elm treats `MUTE … video` as camera-off (better) |
| H71 | Voice settings sheet (bar + You hub) | `VoiceSettings.tsx:468`, `src/app/YouSettings.tsx:232` (UI) | FULL | `View/VoiceSettings.elm:92`, `:38` | — |
| H72 | Device pickers mic/speaker/camera, enumeration states, stale reset, devicechange | `VoiceSettings.tsx:173` (UI) | FULL | `View/VoiceSettings.elm:142` | — |
| H73 | Choose speaker (`selectAudioOutput`) | `VoiceSettings.tsx:216` (UI) | FULL | `View/VoiceSettings.elm:191` | — |
| H74 | Output volume (live) | `VoiceSettings.tsx:352` (UI) | FULL | `View/VoiceSettings.elm:230`, `ports.js:3828` | — |
| H75 | Join muted toggle | `VoiceSettings.tsx:370` (UI) | FULL | `View/VoiceSettings.elm:315` | — |
| H76 | Voice activity + sensitivity | `VoiceSettings.tsx:377` (UI, inert) | N/A | `View/VoiceSettings.elm:322`, `ports.js:3860` | Solid persists only, never applied; Elm shows only if engine has `setVoiceActivity` |
| H77 | Noise suppression / echo cancellation | `VoiceSettings.tsx:403` (UI) | FULL | `View/VoiceSettings.elm:352` | capability-gated |
| H78 | Push-to-talk: toggle, key capture/clear, runtime guards, blur release | `VoiceSettings.tsx:423`, `useCadenceMedia.ts:543` (UI) | FULL | `View/VoiceSettings.elm:399`, `ports.js:3751` | + hidden-page release, bar hint |
| H79 | Stage strip (live / op-dormant), hint, availability | `StagePanel.tsx:63` (UI) | FULL | `View/StageMode.elm:304` | — |
| H80 | Start stage (+m, PROP STAGE 1) | `StagePanel.tsx:127`, `store.ts:15642` (UI) | FULL | `App.elm:45220`, `Stage.elm:247` | — |
| H81 | End stage | `StagePanel.tsx:147` (UI) | FULL | `App.elm:45232` | + bar "End stage" |
| H82 | Join as audience | `StagePanel.tsx:140` (UI) | FULL | `App.elm:45240` | — |
| H83 | Leave stage | `StagePanel.tsx:158` (UI) | FULL | `App.elm:45252` | — |
| H84 | Stage raise / lower hand | `StagePanel.tsx:171` (UI) | FULL | `App.elm:45256` | — |
| H85 | Speak-invite alert Accept / Decline | `StagePanel.tsx:181` (UI) | FULL | `View/StageMode.elm:453`, `App.elm:45278` | — |
| H86 | Host raised-hands queue + Invite to speak | `StagePanel.tsx:210` (UI) | FULL | `View/StageMode.elm:276` | + local Dismiss, 375px sheet |
| H87 | Inbound CTCP STAGE fold (moderator invite, host +v on accept) | `store.ts:12597` (auto) | FULL | `Stage.elm:353` | Elm: only invited accept earns +v |
| H88 | moveToAudience / grantSpeaker / revokeSpeaker | `store.ts:15616` (DEAD) | N/A | — | no callers |
| H89 | Engine mount + idle lazy preload, reduced-data skip | `AppShell.tsx:355`, `mediaEngineMount.ts` (auto) | PARTIAL | `elm/index.html:50` | voice.js loaded eagerly at boot |
| H90 | Generic media error toast + inbox "Voice: …" | `useCadenceMedia.ts:321` (auto) | MISSING | `media/voice-core.ts:410` | adapter only logs |
| H91 | Codec init/ladder-exhaust toast | `useCadenceMedia.ts:329` (auto) | CORE-ONLY | `CallDock.elm:628` | needs `errorKind` codec/encoder; adapter never emits |
| H92 | Per-peer decode-failure toast (rate-limited) | `useCadenceMedia.ts:348` (auto) | MISSING | `media/voice-core.ts:414` | logs only |
| H93 | Room near capacity toast | `useCadenceMedia.ts:430` (auto) | MISSING | — | adapter lacks `onRoomNearFull` |
| H94 | "Removed from voice by X" (VOICE_KICK) | `MediaEngine.ts:1965` → onError (auto) | MISSING | `media/voice-core.ts:410` | Elm shows plain "Call ended" |
| H95 | Peer recording started/stopped + consent toasts | `useCadenceMedia.ts:418` (auto, no sender) | N/A | — | engine never puts RECORD_START on the wire |
| H96 | Media peer key changed → "Encryption key changed" warning | `useCadenceMedia.ts:466` (auto) | MISSING | `media/voice-engine.ts:74` | Elm refuses handshake silently |
| H97 | Update reload held during a call | `AppShell.tsx:396` (auto) | FULL | `App.elm:45572` | — |
| H98 | Capability detection: display capture, native PiP, recording | `VoiceBar.tsx:415`, `ParticipantTile.tsx:85` (auto) | FULL | `ports.js:2298`, `media/platform.ts` | recording n/a (H26) |
| H99 | Engine internals: bandwidth ladder, hi-res probe, replay window, media MAC, VAD meter | `MediaEngine.ts` (auto) | FULL | `media/voice-engine.ts:51`, `Cadence.elm` | same engine bundled; Elm camera 320×176@12 |
| H100 | Streaming / Go Live / raid / stream polls / breakout + spatial pad flags | `store.ts:18239–18330` (DEAD) | N/A | `Media.elm:541` (builder uncalled) | — |
| H101 | Voice window events (audio-level/presence/network/mooring/e2ee) | `useCadenceMedia.ts:375` (DEAD: no listeners) | N/A | — | — |
| H102 | Watch Together enable preference | `PreferencesPanel.tsx:3619` (UI) | CORE-ONLY | `Prefs.elm:421` | persisted field; no toggle, no surface |
| H103 | WT activity card: state, progress, host, count, Close | `WatchTogetherActivity.tsx:965`, `AppShell.tsx:1483` (UI) | MISSING | — | — |
| H104 | WT start editor (title/URL/duration, validation) → review → confirm (PROP `ocean.watch`) | `WatchTogetherActivity.tsx:612–780` (UI) | MISSING | — | — |
| H105 | WT host Play / Pause / Seek (local tick) | `WatchTogetherActivity.tsx:1046` (UI) | MISSING | — | — |
| H106 | WT host handoff offer / accept / cancel | `WatchTogetherActivity.tsx:1088` (UI) | MISSING | — | — |
| H107 | WT end activity with confirmation | `WatchTogetherActivity.tsx:1140` (UI) | MISSING | — | — |
| H108 | WT join / leave (cap 128, host can't leave) | `WatchTogetherActivity.tsx:1185` (UI) | MISSING | — | — |
| H109 | WT participant roster disclosure | `WatchTogetherActivity.tsx:1006` (UI) | MISSING | — | — |
| H110 | WT open media URL (http/https only) | `WatchTogetherActivity.tsx:1230` (UI) | MISSING | — | — |
| H111 | WT stale-revision guards + participation live region | `WatchTogetherActivity.tsx:372` (auto) | MISSING | — | — |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- **fbe04585 claim "Elm hides the camera button and 'Join with video' while it is off"** — false in practice. `ports.js:2410–2412` back-fills only `shareSupported`/`pipSupported`; `voiceCapabilities().cameraSupported` (`ports.js:2313`) never reaches a snapshot; `voice-core.ts` never emits it; `CallMedia.blankLocal` defaults `True` and `CallJoin` resets to it (`App.elm:41181`). The CallsC4Test vector only feeds `cameraSupported` by hand. Worse, `joinVoice(ch,{video:true})` → `engine.joinVideo` (`voice-core.ts:803`, `:697`) is not covered by `VIDEO_ENABLED` (only `startCamera` is wrapped, `voice-engine.ts:102`), so "Join with video" still publishes camera.
- COVERAGE §12 MEDIA row "done … STATS/LAYER/BREAKOUT/POS …": `Media.elm` folds none of STATS/LAYER/BREAKOUT/POS/PROFILE; `mediaBreakout`/`mediaOffer` builders have no caller.
- C1 "SFU cascade copy" done: copy exists, data never arrives — the sheet always reads "SFU path unknown".
- C6 "codec / encoder toasts": unreachable — the adapter never emits `errorKind` codec/encoder (only join-path error names).
- C4 narrowing "CadenceMediaEngine has none [stopScreenShare] — bridge reports the share still live": stale; `voice-core.ts:878` implements stop (stopBroadcast + voice rejoin).
- C8 narrowing "reaction chips show the glyph only": understated — chips render avatar initial + nick + glyph (`View/CallOverlays.elm:262–276`).
- C1 narrowing "no connection-quality pip (C4)": superseded by C4 (pip at `View/CallVideo.elm:516`).
- `View/Calls.elm:9–14` module doc "No join / accept / start control exists for any presentation" contradicts the hub's own Join buttons (`:245–256`).
- V3_ROADMAP lines 186–191 repeat the C-slice line twice with conflicting done marks (C4/C5 vs C6/C7/C10); row 6.7 lumps Stage (done, C11) with Watch Together (not started).
- `View/About.elm:100` advertises Watch Together a11y features that do not exist in Elm. `CALLS_DESIGN.md` says WT is "unchanged from the oracle" — it is unported.

#### Elm better than Solid
- Mini voice PiP actually renders (`View/CallDock.elm:303`); Solid's `VoicePip` is unreachable because AppShell always passes `activeSurface` (`VoicePip.tsx:191`).
- Call keyboard chords Ctrl/Cmd+Shift+M/E/H/C/L/G/F/S with a leave-confirm sheet for >2 people (`App.elm:45410`, `View/StageMode.elm:518`); Solid has none.
- Reconnecting state, "Connection lost." banner, "Reconnected" announcer, controls disabled while reconnecting (`View/CallDock.elm:476`, `:505`).
- Classified join-failure copy (permission / no device / account required / encryption) vs Solid's single generic line (`CallDock.elm:608`).
- Privacy sheet lists every peer with their media fingerprint (`View/CallStage.elm:679`).
- Sidebar rail voice count + "Rooms with voice" hub list + last-call outcome on hub (`View/CallPresence.elm:59`, `:340`).
- Video: paging of 16, dominant-speaker tile reordering, remote screen shares force the screenshare layout with a grid escape (`View/CallVideo.elm:228`, `:400`).
- Local VAD is broadcast as `MEDIA SPEAKING` so cross-node peers see you speak (`voice-core.ts:455`); `MUTE … video` no longer misread as mic mute (`Media.elm:255`).
- iOS/WebKit hardening: share hidden without a picker, audio unlock, call audio session, capture recovery on foreground/route change (`media/platform.ts`, `voice-core.ts`). The adapter also enrolls the device key (IDENTITY ADD) so E2EE handshakes are admitted.
- Stage: only an invited ACCEPT_SPEAK earns +v, host-local Dismiss, 375px hands sheet, speakers-only stage cells + audience facepile, forced "Stage broadcast" chip (`Stage.elm:353`, `View/StageMode.elm`).
- Push-to-talk bar hint and hidden-page release; VAD/sensitivity toggles hidden instead of Solid's inert, persisted-only controls.

#### Gaps (ranked by user impact)
- `[High]` Video-off switch leaks: in `ports.js` `mountVoiceFeedPush`, back-fill `cameraSupported` on every snapshot (idle too) and push one at boot. In `voice-engine.ts`, force `opts.video=false` in `joinVoice` when `!VIDEO_ENABLED`. In `App.CallJoin`, keep `cameraSupported` and coerce `video` to False. Gate the `View/Calls.elm` video button.
- `[High]` Watch Together missing: add a `WatchTogether` module (port `watchTogether.ts` parse/serialize + controller tick/play/pause/seek/join/leave/handoff), a `View.WatchTogether` card in `View/Thread.elm`, Msgs `Watch*`, publishing `PROP ocean.watch` via `writeChannelProp`, and the toggle in `View/Prefs.elm`.
- `[High]` Media failures are silent: `voice-core.ts` `onError`/`onDecodeError`/VOICE_KICK should `emitLocal({mediaError, errorKind})`. Fold it in `CallDock` into toasts (codec/encoder via `codecToast`, generic "Media error", "Removed from voice").
- `[Med]` No feedback during permission prompt / enrollment: in `CallJoin`, set `calls` provisional (InCall, no `startedAt`) locally, or have `ports.js` push `{state:'in_call'}` before `engine.joinVoice`; failure already rolls back via `joinFailed`.
- `[Med]` Media peer key change unannounced: `voice-engine.ts verifyPeerMediaKey` 'changed' → push `{peerKeyChanged:nick}`. Fold into the existing DM key-change toast/banner in `App`.
- `[Med]` Local recording: expose `startRecording`/`stopRecording` on the adapter, add `voiceCommand` verb `record` and a Download port hand-off, plus a More item and a `record-status` region in `View/CallStage.moreTools`.
- `[Med]` Screen wake lock + OS Media Session: in `ports.js`, on `voiceCallHub` in_call, acquire `navigator.wakeLock` (re-acquire on visibility). Register `mediaSession` handlers that send `call-mute`/`call-camera`/`call-leave` on the `shortcut` port.
- `[Med]` In-call Invite: add a `CallInvite` Msg that reuses `InviteShare` link + `ClipboardCopy`. Put the More item and an `invite-status` live region in `View/CallStage.elm:554`.
- `[Med]` SFU topology always unknown: wire `onRoomStats` + 1 Hz `getNetworkStats` loss in `voice-core.ts` → `emitLocal({sfu})`. This also feeds H37 bitrate/jitter/loss for the pip tooltip.
- `[Low]` Spatial audio pad: adapter `setPeerPosition(nick,pos)` → `engine.registry.setPositionForNick`. Add a More popover with a pointer-drag assist in ports.
- `[Low]` Stage chrome Compact/Expand/Fullscreen buttons (`CallStageSizeSet` already exists). Tile role badges; native PiP active label. "Local media unavailable" status in `CallUi.stageStatus`.
- `[Low]` Palette "Start voice/video in current room" in `Switcher`; voiceEntry-off "Join call" fallback in the room header More menu.
- `[Low]` Bar people faces/names; captions provenance/source tags; "captions" in the chip's local-health arm (`CallMedia.roomStatus`).
- `[Low]` Hide the DM "Call" item (`View/CallDock.elm:183`) while the adapter has no DM path, rather than offering an action that always fails.
- `[Low]` Room-near-capacity toast; lazy-load `voice.js` (respect reduced data) instead of eager boot load.

### I — Moderation, operators, people, stewardship
Solid, walked in full: `src/shell/ModerationCockpit.tsx`, `moderation/BanListPanel.tsx`, `moderation/ModerationActionReview.tsx`, `OperDesk.tsx`, `OperEventConsole.tsx`, `MemberList.tsx`, `memberWindow.ts`, `PeopleProfileCard.tsx`, `Facepile.tsx` (card host), `people/PersonSafetySheet.tsx` + `personSafetyState.ts`, `WhoisSheet.tsx`, `RoomStewardshipSheet.tsx` + `roomStewardshipState.ts`, `ContextRail.tsx`/`AppShell.tsx` (entry gating), `ChannelSettings.tsx` (webhooks/ACCESS), `src/lib/moderation/*`, `lib/oper/operDesk.ts`, `lib/people/*`, `lib/rooms/*`, `lib/memberGroups.ts`, the identity/contact memory libs, and store actions 7640–7752, 8160–8529 (slash), 8723, 9696–9870, 10134, 10359–10402, 15717–15725, 16325–16760, 17196–17460. Reachability came from a non-test caller grep over `src/shell src/app src/chat src/routes src/pwa src/theme src/media`.
Elm, checked: `Moderation.elm`, `View/ModDesk.elm`, `View/Bans.elm`, `OperDesk.elm`, `EventReplay.elm`, `Spine.elm`, `Roster.elm`, `View/Roster.elm`, `View/Profile.elm`, `PersonSafety.elm`, `IdentityOverrides.elm`, `Stewardship.elm`, `View/Stewardship.elm`, `Webhook.elm`, `View/RoomSettings.elm` (webhook and ACCESS parts), `View/Account2.elm` (People), `View/RoomHeader.elm`, `View/Topbar.elm`, `Prefs.elm`, the App.elm folds, and `ports.js`/`index.html` (blocklists, temp-ban timers, receipts).
In the Solid column, "adv+" means the surface only renders when `experienceMode` is advanced or network-ops (`ContextRail.tsx:123`, `PresenceRibbon.tsx:1041`).

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| I1 | Room desk entry point | `src/shell/ContextRail.tsx:127`, `src/shell/AppShell.tsx:1622` (UI adv+) | FULL | `View/RoomHeader.elm:281` More→Moderation, `View/ModDesk.elm:51`, `App.elm:42475` | Elm opens for ops in every experience mode, which Solid does not |
| I2 | Read-only desk view for non-moderators (fallback copy + mode state) | `src/shell/ModerationCockpit.tsx:279` (UI adv+) | PARTIAL | `View/Bans.elm:27`; `App.elm:42475` refuses non-ops | The branch exists, but the sheet only opens for ops, so members never see it |
| I3 | Authority rail (Connected / Moderator / Last room update) + boundary note | `src/shell/ModerationCockpit.tsx:253` (UI adv+) | FULL | `View/Bans.elm:313`, `:615` | Moderator is hard-coded "Yes" because the sheet is op-gated |
| I4 | Offline coaching line | `src/shell/ModerationCockpit.tsx:273` (UI adv+) | FULL | `View/Bans.elm:334` | |
| I5 | Safeguard toggles +m / +i / +t with On/Off state | `src/shell/ModerationCockpit.tsx:280`, `:162` (UI adv+) | FULL | `View/Bans.elm:346`, `App.elm:42437` | |
| I6 | Invite someone (`INVITE nick chan`) + "People here" hint | `src/shell/ModerationCockpit.tsx:296`, `:167` (UI adv+) | FULL | `View/Bans.elm:397`, `App.elm:42415` | Elm sorts candidates alphabetically; Solid keeps join order |
| I7 | Member action form (member + mode-gated action + optional reason) → review | `src/shell/ModerationCockpit.tsx:308` (UI adv+) | PARTIAL | `View/Bans.elm:469`, `App.elm:42347` | In standard mode the action select is empty, yet submit still stages "kick" (default `App.elm:236`, no kinds check) |
| I8 | Block an address mask → review | `src/shell/ModerationCockpit.tsx:352` (UI adv+) | FULL | `View/Bans.elm:437`, `App.elm:42383` | |
| I9 | Review-first modal (errors, Permission/Scope/Receipt facts, summary, impact, blocked reason) | `src/shell/moderation/ModerationActionReview.tsx:322` (UI) | FULL | `View/Profile.elm:831`, `App.elm:42821` | |
| I10 | Review invalidated on authority change (account/server/client/device) and room switch | `src/shell/ModerationCockpit.tsx:140`, `:184` (auto) | PARTIAL | `App.elm:42821` | Elm only re-checks live op and connection at confirm; the draft is not cleared on room switch |
| I11 | Dispatch reviewed action (KICK, MODE ±b/±o/±v) | `src/lib/moderation/applyMemberModeration.ts:7` (UI) | FULL | `App.elm:10922` | |
| I12 | Validation rules (self-moderation, match-everyone mask, caps, control chars) | `src/lib/moderation/actionModel.ts:97` (UI) | FULL | `Moderation.elm:193`, `:524` | Copy is verbatim |
| I13 | Block list auto-fetch when op + connected | `src/shell/moderation/BanListPanel.tsx:115` (auto) | FULL | `App.elm:35689` room open, `:18674` op grant, `:5170` welcome | Elm fetches more eagerly (on every room open) |
| I14 | Refresh list (`MODE #c +b`) | `src/shell/moderation/BanListPanel.tsx:190` (UI adv+) | FULL | `View/Bans.elm:59`, `App.elm:19059` | |
| I15 | List status strings (loading / refreshing / empty / error / unavailable / idle) | `src/shell/moderation/BanListPanel.tsx:163` (UI adv+) | FULL | `View/Bans.elm:202` | |
| I16 | Block rows: mask + "Set by" | `src/shell/moderation/BanListPanel.tsx:206` (UI adv+) | FULL | `View/Bans.elm:263` | |
| I17 | Review lift (unban) with authority recheck | `src/shell/moderation/BanListPanel.tsx:128`, `:135` (UI adv+) | FULL | `View/Bans.elm:285`, `App.elm:18739`, `:18762` | Elm uses a simpler inline confirm with no facts or impact copy; it snapshots account and endpoint |
| I18 | Server activity log (echoed KICK/MODE, 12 newest) | `src/shell/ModerationCockpit.tsx:366`, `store.ts:18498` (UI adv+) | FULL | `View/Bans.elm:545`, `App.elm:18238`, `:28871` | |
| I19 | Open-wire `MODE` disclosure | `src/shell/ModerationCockpit.tsx:385` (UI adv+) | FULL | `View/Bans.elm:581` | |
| I20 | Timed block with auto-lift + extban builder | `store.ts:16415` tempBan (DEAD; the cockpit says "not exposed") | N/A | `View/Bans.elm:76`, `App.elm:20522`, `:20427` | Elm-only. Sends without review and has no match-everyone or self-mask guard |
| I21 | Card moderation controls (Op/Deop, Voice/Devoice, Kick, Ban → review) | `src/shell/PeopleProfileCard.tsx:428` (UI adv+) | PARTIAL | `View/Profile.elm:765` | Gated by experienceMode, which Elm cannot change (I22), so the controls are hidden for most users |
| I22 | "Experience level" pref (gates desk actions and card moderation) | `src/shell/PreferencesPanel.tsx:3555` (UI) | MISSING | `Prefs.elm:449` default, `:620` load-only; no View or Msg | Load-only, from the shared `onyx:preferences` key |
| I23 | Raw moderation slash verbs (`/kick` `/mode` `/invite nick` …) | `store.ts:8529` raw fallthrough (slash) | FULL | `App.elm:39055`, `:11164` | |
| I24 | Operator desk entry | `src/shell/ContextRail.tsx:134` (inside the adv+ Show at :123), `AppShell.tsx:1627` (UI adv+, needs a room) | FULL | `View/Topbar.elm:48`, `View/ModDesk.elm:77`, `App.elm:42493` | Elm puts it on the global topbar with no room or mode needed |
| I25 | Oper authority rail (role, network, signed-in nick) | `src/shell/OperDesk.tsx:115` (UI) | FULL | `View/ModDesk.elm:204` | Network is hard-coded "Onyx"; Solid uses the ISUPPORT `networkName` |
| I26 | Announce (`EVENT BROADCAST`), counter, review | `src/shell/OperDesk.tsx:142` (UI) | FULL | `View/ModDesk.elm:243` | |
| I27 | Event Spine subscribe / unsubscribe by category | `src/shell/OperDesk.tsx:171`, `:192` (UI) | FULL | `View/ModDesk.elm:266`, `:283` | |
| I28 | List subscriptions / Show my privileges | `src/shell/OperDesk.tsx:205`, `:213` (UI) | FULL | `View/ModDesk.elm:294`, `:301` | |
| I29 | Reload node config (`REHASH`, reviewed) | `src/shell/OperDesk.tsx:221` (UI) | FULL | `View/ModDesk.elm:308` | |
| I30 | Observe mask + List / Clear watches | `src/shell/OperDesk.tsx:233`, `:258` (UI) | FULL | `View/ModDesk.elm:318`, `:339` | |
| I31 | Disconnect (`KILL`, reason required, reviewed) | `src/shell/OperDesk.tsx:277` (UI) | FULL | `View/ModDesk.elm:355` | |
| I32 | Inline review with wire preview; fields clear after send | `src/shell/OperDesk.tsx:316`, `:96` (UI) | FULL | `View/ModDesk.elm:410`, `App.elm:17606` | |
| I33 | Plan errors list + "Sent …" receipt | `src/shell/OperDesk.tsx:136`, `:352` (UI) | FULL | `View/ModDesk.elm:235`, `:392` | |
| I34 | Oper choke point (refusal toast when oper status is lost) | `store.ts:15725` operAction (auto) | FULL | `App.elm:17643` | |
| I35 | Oper slash verbs `/broadcast` `/wallops` `/kill` `/rehash` `/privs` `/events` `/observe` | `store.ts:8514` (slash) | FULL | `App.elm:14284`, `:14993` | |
| I36 | Event console: 25/50/100 limit + Refresh (`EVENT REPLAY JSON ALL n`) | `src/shell/OperEventConsole.tsx:94`, `:70` (UI; also in Account panel `Account.tsx:1108`) | FULL | `View/ModDesk.elm:473`, `App.elm:17678` | Elm has it only in the oper sheet |
| I37 | Replay status (requested / waiting / n of expected / floor) | `src/shell/OperEventConsole.tsx:122` (UI) | FULL | `View/ModDesk.elm:493` | |
| I38 | Local category / severity / text filters + empty state | `src/shell/OperEventConsole.tsx:140`, `:207` (UI) | FULL | `View/ModDesk.elm:540`, `:584` | |
| I39 | Structured event rows | `src/shell/OperEventConsole.tsx:184` (UI) | FULL | `View/ModDesk.elm:576`, `:606` | |
| I40 | Recent spine-tagged prose notices (last 40) | `src/shell/OperEventConsole.tsx:213` (UI) | MISSING | none | Elm keeps no `serviceNotices` list |
| I41 | `OPER` login / oper panel | `store.ts:15717` (DEAD) | N/A | — | No OPER verb (491) by design |
| I42 | Roster grouped by role in learned PREFIX order, with counts | `src/shell/MemberList.tsx:317`, `lib/memberGroups.ts:105` (UI) | FULL | `Roster.elm:47`, `View/Roster.elm:237` | |
| I43 | Presence: away dim, presence dot, Away word | `src/shell/MemberList.tsx:197` (UI) | FULL | `Roster.elm:77`, `View/Roster.elm:319` | Elm adds a separate collapsible Away section |
| I44 | Role badge glyph (@ + etc.) | `src/shell/MemberList.tsx:220` (UI) | FULL | `View/Roster.elm:271` | By design Elm shows words only; mode letters never render |
| I45 | Filter field, Escape clears, v/t count, "No members match" | `src/shell/MemberList.tsx:594`, `:601`, `:571`, `:647` (UI) | FULL | `View/Roster.elm:194`, `:224`, `:161`, `App.elm:41722` | Elm folds the filter into an icon at ≤20 members |
| I46 | Windowed / virtualized roster for large rooms | `src/shell/MemberList.tsx:345`, `memberWindow.ts` (auto) | MISSING | `View/Roster.elm:267` renders every row | Rooms can hold up to 4096 users (`App.elm:22995`) |
| I47 | Loading skeleton + "sync" refreshing label | `src/shell/MemberList.tsx:629`, `:559` (UI) | MISSING | none | No `rosterSyncing` state in Elm |
| I48 | Room ledger link in roster header | `src/shell/MemberList.tsx:551` (UI) | MISSING | none | The ledger link is available in the card (I62) |
| I49 | Mobile roster drawer (dialog, close, "N here", "Find someone") | `src/shell/MemberList.tsx:523`, `:578`, `:595` (UI) | FULL | `View/Roster.elm:70`, `:124`, `:182` | Popover sheet below 1100px; copy differs |
| I50 | Double-click row → DM (no-op on self) | `src/shell/MemberList.tsx:181` (UI) | FULL | `View/Roster.elm:301` | Elm adds a per-row Message icon (`:347`) |
| I51 | Row → people card; card also from facepile | `src/shell/MemberList.tsx:175`, `Facepile.tsx:112` (UI) | FULL | `View/Roster.elm:309`, `View/RoomHeader.elm:547`, `App.elm:42058` | |
| I52 | Card identity: display name (override > published > nick), pronouns, Away, about | `src/shell/PeopleProfileCard.tsx:85`, `:276` (UI) | FULL | `View/Profile.elm:375`, `:399` | |
| I53 | Card "Guest" badge + account row | `src/shell/PeopleProfileCard.tsx:96`, `:301` (UI) | PARTIAL | `View/Profile.elm:452`, `:535` | Elm knows a peer's account only from WHOIS 330; it ignores extended-join, so many accounts read as Guest |
| I54 | Card Message (blocked peer → toast) | `src/shell/PeopleProfileCard.tsx:157` (UI) | FULL | `View/Profile.elm:561`, `App.elm:42142` | |
| I55 | Card Mention (append to room composer + toast) | `src/shell/PeopleProfileCard.tsx:174` (UI) | FULL | `View/Profile.elm:569`, `App.elm:42064` | Elm also switches to the room |
| I56 | Card Block (confirm) / Unblock (toast) | `src/shell/PeopleProfileCard.tsx:250` (UI) | FULL | `View/Profile.elm:578`, `:588` | Elm's unblock toast has Undo |
| I57 | Card Report → report sheet | `src/shell/PeopleProfileCard.tsx:264` (UI) | FULL | `View/Profile.elm:596` | |
| I58 | Advanced: account, room role, network oper role, hostmask | `src/shell/PeopleProfileCard.tsx:374` (UI) | FULL | `View/Profile.elm:620` | |
| I59 | Copy name + toast | `src/shell/PeopleProfileCard.tsx:191` (UI) | FULL | `View/Profile.elm:698`, `App.elm:42126`, `:39931` | |
| I60 | Network profile (card → WHOIS sheet) | `src/shell/PeopleProfileCard.tsx:204` (UI) | FULL | `View/Profile.elm:705`, `App.elm:42136` | |
| I61 | `/whois nick` (+ usage toast) | `store.ts:8494` (slash) | FULL | `App.elm:14627` | |
| I62 | WHOIS sheet: summary, loading, error, empty note | `src/shell/WhoisSheet.tsx:107` (UI) | FULL | `View/Profile.elm:26`, `:68`, `:92` | |
| I63 | WHOIS details: account/name/identity/host/node/role/away/idle/signed-on/transport/cert/rooms+ledger/notes | `src/shell/WhoisSheet.tsx:137` (UI) | FULL | `View/Profile.elm:114`, `:240`, `:283` | Signed-on shows ISO UTC, not locale |
| I64 | WHOIS request timeout | `store.ts:9862` (auto) | FULL | `App.elm:10900`, `:42046` | |
| I65 | Block confirm sheet → device ignore + quiet toast | `src/shell/people/PersonSafetySheet.tsx:69` (UI) | FULL | `View/Profile.elm:976`, `App.elm:42241` | |
| I66 | Report: reasons, optional note (500), guest flag | `src/shell/people/PersonSafetySheet.tsx:154` (UI) | FULL | `View/Profile.elm:990`, `:1027` | |
| I67 | Report submit: owner receipt, offline warn, JOIN #root + append + navigate | `src/shell/people/PersonSafetySheet.tsx:81` (UI) | FULL | `App.elm:10787`, `ports.js:6434` | |
| I68 | Report-receipt viewer | `lib/people/personReportReceipt.ts:56` (DEAD) | N/A | — | Neither client reads receipts back |
| I69 | Ignore list manager (add/remove, undo) | `src/shell/IgnoredUsersControl.tsx:86` via `YouSettings.tsx:129` (UI) | FULL | `View/Notify.elm:442`, `:499`, `App.elm:11264` | |
| I70 | Message-menu Ignore / Unignore | `src/shell/message/MessageMenu.tsx:926` (UI) | FULL | `View/Thread.elm:1794` | |
| I71 | `/ignore` (bare lists) / `/unignore` | `store.ts:8160` (slash) | FULL | `App.elm:14476`, `:14512` | |
| I72 | Blocklists (ignored users, muted DMs) scoped per account | `lib/ignoredUsers.ts:50`, `lib/mutedDMs.ts` (auto) | PARTIAL | `ports.js:4374`, `index.html:79` | Elm uses the unscoped key that Solid purges, so Solid users' per-account blocks don't load and the list is shared across accounts |
| I73 | Blocked-DM compose refusal | `src/shell/Composer.tsx:1158` (auto) | FULL | `App.elm:34476`, `:34500` | |
| I74 | DM mute / unmute toggle | `src/shell/PresenceRibbon.tsx:1392` (UI) | CORE-ONLY | `App.elm:31136`; no View dispatches `MuteDm`/`UnmuteDm` | Muted-DM suppression still applies (`App.elm:22872`) |
| I75 | Room care entry (3–30 people) | `src/shell/PresenceRibbon.tsx:1064` (UI) | FULL | `View/Roster.elm:110`, `View/Stewardship.elm:26`, `View/RoomSettings.elm:753` | Opens from the roster footer, not the More menu |
| I76 | Owner + helpers display | `src/shell/RoomStewardshipSheet.tsx:166`, `:172` (UI) | FULL | `View/Stewardship.elm:149` | No "no owner yet" fallback |
| I77 | Add helper (MODE +o, cap two) | `src/shell/RoomStewardshipSheet.tsx:197` (UI) | FULL | `View/Stewardship.elm:183`, `App.elm:21382` | Elm uses free text, not a candidate select; the cap appears only on refusal |
| I78 | Remove helper (MODE -o) | `src/shell/RoomStewardshipSheet.tsx:189` (UI) | FULL | `View/Stewardship.elm:212`, `App.elm:21400` | |
| I79 | Invite friends from Room care | `src/shell/RoomStewardshipSheet.tsx:248` (UI) | PARTIAL | `View/Stewardship.elm:223` | Hint text only, no button (the More menu has Invite) |
| I80 | Offer / hand over / cancel transfer (+q / -q) | `src/shell/RoomStewardshipSheet.tsx:262`, `lib/rooms/roomStewardshipActions.ts:71` (UI) | FULL | `View/Stewardship.elm:234`, `App.elm:21418`, `:21494` | Bug in both: offers are in-session memory, so the recipient never sees them and Hand-over can't enable |
| I81 | Take view: Accept / Not now | `src/shell/RoomStewardshipSheet.tsx:474`, `:486` (UI) | FULL | `View/Stewardship.elm:109`, `App.elm:21449` | Same dead end as I80 |
| I82 | Close room (+si) with confirm | `src/shell/RoomStewardshipSheet.tsx:347`, `:371` (UI) | FULL | `View/Stewardship.elm:308`, `App.elm:21520` | |
| I83 | Delete room (typed name, `CHANNEL DROP` + PART) | `src/shell/RoomStewardshipSheet.tsx:397` (UI) | FULL | `View/Stewardship.elm:350`, `App.elm:21536` | |
| I84 | Last-member hint + Leave room button | `src/shell/RoomStewardshipSheet.tsx:422`, `:430` (UI) | PARTIAL | `View/Stewardship.elm:507` | Hint only, no Leave button |
| I85 | Status line, name-mismatch hint, Done | `src/shell/RoomStewardshipSheet.tsx:435`, `:454` (UI) | FULL | `View/Stewardship.elm:95`, `:521`, `:162` | |
| I86 | Webhooks create / list / delete + recent notices | `src/shell/ChannelSettings.tsx:577`, `:1256` (UI, any op, any size) | PARTIAL | `View/Stewardship.elm:423`, `App.elm:21573`, `View/RoomSettings.elm:745` | Owner-only, and only in 3–30 rooms; other ops get read-only text |
| I87 | IRCX ACCESS list / add / delete / refresh | `src/shell/ChannelSettings.tsx:513`, `:550`, `:557` (UI) | FULL | `View/RoomSettings.elm:482` | The room-settings slice owns the details |
| I88 | Friends add / remove + MONITOR presence | `store.ts:9709`, `:9724` (DEAD UI) | N/A | `View/Account2.elm:641`, `App.elm:25464` | Elm-only People sheet |
| I89 | Watch list add / remove | `store.ts:17210`, `:17223` (DEAD) | N/A | `View/Account2.elm:700` | Elm-only |
| I90 | Friend quick-add in room formation | `src/shell/CreateRoomFormation.tsx:296` (UI; reads friends that Solid can't add) | MISSING | `View/Formation.elm:10` | Elm now has friends but doesn't use them here |
| I91 | MONITOR on DM open | `store.ts:8035` (auto) | FULL | `App.elm:35693` | |
| I92 | Local display-name override (read in card; setter) | `src/shell/PeopleProfileCard.tsx:68` (auto); setter `store.ts:17352` DEAD | FULL | read `View/Profile.elm:399`; setter `App.elm:42616` CORE-ONLY | Neither client has a setter UI |
| I93 | Nick colour overrides | `store.ts:16551` (DEAD) | N/A | `App.elm:42567` CORE-ONLY | |
| I94 | Soft-ignore toggle | `store.ts:10390` (DEAD) | N/A | `App.elm:42537` CORE-ONLY | |
| I95 | User notes | `store.ts:16509` (DEAD) | N/A | none | |
| I96 | Nick aliases (433 fallback; setter) | `store.ts:14921` (auto); setter `:17196` DEAD | FULL | `App.elm:10139`, `:37809` | No setter UI in either client |
| I97 | Invisible-mode memory | `store.ts:17423` (DEAD) | N/A | — | |
| I98 | Announcements panel / audit log / user activity | `store.ts:16608`, `:10134`, `:9787` (auto write, no UI) | N/A | `App.elm:18218` audit CORE-ONLY | |
| I99 | Legacy moderation panel / profile modals / sort / compact prefs | `store.ts:16327`, `:16967`, `:17297` (DEAD) | N/A | — | |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- **COVERAGE.md:206 (roster) is stale.** It says the roster renders a "decorative prefix glyph plus role in words". The roster renders no glyph: `View/Roster.elm:19` says "Mode letters never render", and `rosterRow` (`:271`) never uses `role.symbol`.
- **COVERAGE.md:209 names the wrong entry point.** It says the desk opens from an "op-gated topbar **Moderation** button". It now lives in the room header's More menu (`View/RoomHeader.elm:281`); the topbar only carries Operator (`View/Topbar.elm:48`).
- **COVERAGE.md:209 leaves narrowings out.** It does not say that the timed block sends with no review and no match-everyone or self-mask guard (`App.elm:20427`). It also does not say the standard-mode desk shows an empty action select but still stages a kick (`App.elm:236`, `:42347`).
- **V3_ROADMAP.md:83 and COVERAGE.md:206 overstate the card moderation controls.** They say the controls "were already ported", but `Moderation.kindsForMode` gates them on `experienceMode`. Elm has no setter for it (`Prefs.elm:449` defaults to standard; there is no View or Msg). COVERAGE.md:213 lists "experience … toggles not surfaced", but no row draws the link to moderation.
- **COVERAGE.md:198 understates the member card.** It still lists "no Message/Report buttons and no moderation controls". All three now exist (`View/Profile.elm:561`, `:596`, `:765`).
- **COVERAGE.md:202 overstates ignored users.** It marks them "done" without noting that Elm persists blocklists under the plain `onyx:ignored-users` and `onyx:muted-dms` keys (`ports.js:4374` admits this). Solid scopes them per account and purges the plain key, so existing blocks don't come across.
- **COVERAGE.md:223 understates the webhook limit.** It says "webhooks link to Room care" but doesn't say that ops who aren't owners, and owners of rooms under 3 or over 30 people, cannot manage webhooks at all.
- **V3_ROADMAP.md:81, :84, :86, :87 are stale duplicates.** They are leftover not-done rows for 3.4–3.7 that contradict the done rows at :82, :83, :85, :88.
- **`View/Formation.elm:10` has a stale code comment.** It says there is "no Elm friends store yet", but friends landed in v3/account2 (`App.elm:25464`).

#### Elm better than Solid
- **Desk reachability.** The room desk and the oper desk open in every experience mode. Solid hides both unless the mode is advanced or network-ops (`ContextRail.tsx:123` wraps the oper desk too). The oper desk sits on the global topbar and needs no open room (`View/Topbar.elm:48`).
- **People sheet.** Friends and watch list can be added, removed and messaged, with online-first ordering, and friend presence shows on sidebar DM rows (`View/Account2.elm:608`, `View/Rail.elm:493`). Solid's add/remove actions are DEAD.
- **Timed block and extban builder.** Elm has an auto-lift timed block with a live-validated extban preview (`View/Bans.elm:76`, `:137`). Solid deliberately left these out, so treat this as divergence (see the caveat in I20).
- **Roster.** Away people gather in one collapsible section, groups are native disclosures, the filter folds away at ≤20 members, rows have a per-row Message button, and your own row is tagged "you" (`Roster.elm:77`, `View/Roster.elm:237`, `:347`).
- **Card actions.** Unblock gives an Undo toast (`App.elm:31113`), and Mention switches to the room before inserting (`App.elm:42064`).
- **Block list.** Elm loads it whenever a moderator opens a room, and again after a welcome (`App.elm:35689`, `:5170`), not only while the panel is mounted.

#### Gaps (ranked by user impact)
- `[High]` **Experience level.** Add an "Experience level" segmented control to `View/Prefs.elm` with a new `PrefsSetExperienceMode` Msg that writes `Prefs.experienceMode` and saves through `appearanceStorePrefs`. Alternatively, drop the mode gate on card and desk moderation (`View/Profile.elm:765`, `View/Bans.elm:476`) and gate on `isChannelOp` alone.
- `[High]` **Per-account blocklists.** Add the owner suffix to `BlocklistsSave` (`ports.js:4376`) and replace the boot-flag read with an owner-scoped `BlocklistsLoaded` reload like `FriendsLoaded`. That way existing Solid `onyx:ignored-users:owner:*` lists load and accounts stay isolated.
- `[Med]` **DM mute toggle.** Add a "Mute/Unmute conversation" item for DMs to the More menu in `View/RoomHeader.elm`, dispatching `MuteDm`/`UnmuteDm`.
- `[Med]` **Webhooks for all ops.** Render the webhook forms in `View/RoomSettings.elm` `integrationsSection` when `ctx.isOp`, and gate `requestWebhookCreate`/`List`/`Delete` (`App.elm:21573`) on `isChannelOp` rather than `stewardOwnerMembers`.
- `[Med]` **Roster windowing.** Window the rows in `View/Roster.elm` using a scroll-offset port plus `Html.Lazy`/`Html.Keyed`, or CSS `content-visibility`, so 4096-member rooms stay smooth.
- `[Med]` **Peer accounts.** Store the peer account on `App.Member` from extended-join (`foldJoin`, `App.elm:23491`) and from peer `ACCOUNT` lines, then read it in `View/Profile.elm` `cardFor` for the Guest badge and account row.
- `[Med]` **Room transfer (both clients).** Accept-to-take never reaches the recipient. Add a wire signal (for example a TAGMSG or NOTE offer the recipient folds into `roomTransfers`) or replace the flow with direct `+q` and a review.
- `[Low]` **Desk action form.** Hide `deskMemberForm` when `kindsForMode` is empty, and in `ModerationDeskSubmitMember` (`App.elm:42347`) refuse kinds that aren't in it.
- `[Low]` **Timed block safety.** Run `BanAddSubmit` through `Moderation.validateDraft` (match-everyone and self-mask checks) and the review sheet before `requestTempBan`.
- `[Low]` **Oper prose notices.** Keep a bounded `serviceNotices` list in App and render spine-tagged rows in `View/ModDesk.eventConsole`.
- `[Low]` **Review snapshot.** Capture `accountName` and `endpoint` in `ModerationPropose`/`ModerationDeskSubmit*`, compare them in `ModerationConfirm`, and clear `moderationDraft` when `activeChannel` changes.
- `[Low]` **Room care buttons.** Add Invite friends (`InviteShareOpen`) and a last-member Leave button to `View/Stewardship.elm`.
- `[Low]` **Roster polish.** Add a loading skeleton and "sync" label (needs `rosterSyncing` state) and a ledger link in the `View/Roster.elm` header.
- `[Low]` **Read-only desk.** Let `ModerationSheetOpen` open for members so the read-only branch at `View/Bans.elm:27` becomes reachable.
- `[Low]` **Network name.** Show the oper desk network from ISUPPORT `NETWORK`, not "Onyx" (`View/ModDesk.elm:211`).
- `[Low]` **Formation quick-add.** Add friend chips from `model.friends` to `View/Formation.elm`.

### G — Connect, account, security, identity, E2EE UX
Solid, all read in full: `src/app/Connect.tsx` (every mode, field, aside and action), `connectPageLifecycle.ts`, `StaleChunkRecovery.tsx`, `ConnectPulse.tsx` (no importer), `nodes.ts`, `Account.tsx` (all sections plus the advanced group), `AccountDataVerbs.tsx`, `shell/{Passkeys,RecoveryCodes,SessionsDevices}Section.tsx`, `SessionReclaimBanner.tsx`, `PortableIdentitySection.tsx`, `DmSafetySheet.tsx`, `DmKeyChangeBanner.tsx`, `GuestClaimPrompt.tsx` (the claim flow), `GroupControlRoomIndicator.tsx`, `lib/credentials.ts`, `lib/deeplink.ts`, `lib/migrateStorage.ts`, and the store account and E2EE actions (`store.ts` 5835–6010, 8541–8880, 17493–17815).
Elm: `View/Connect.elm`, `View/Account.elm`, `View/Account2.elm`, `View/GuestClaim.elm`, `View/DmSafety.elm`, `View/Topbar.elm` (reclaim), `View/Nav.elm` (You hub), `View/RoomSettings.elm` (group mark), the `App.elm` connect/claim/account/E2EE folds, `Credentials.elm`, `Passkey.elm`, `Services.elm`, `Session.elm`, `GroupEnvelope.elm`, `Main.elm` init/ports, `ports.js` (credentials, SASL, probe, room crypto), `index.html` flags.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| G1 | Guest join: display name, optional room, land on Home or in the room | `src/app/Connect.tsx:737` (UI) | FULL | `App.elm:24615` submitConnect, `View/Connect.elm:156` | — |
| G2 | Room field normalization plus the "#lounge" error | `Connect.tsx:754` (UI) | FULL | `App.elm:24528`, `App.elm:24684` | — |
| G3 | Nick validation (IRC rules) | `Connect.tsx:748` (UI) | FULL | `App.elm:24625` (`Invite.nicknameError`) | — |
| G4 | Sign in: name + account password → SASL PLAIN/SCRAM | `Connect.tsx:786` (UI) | FULL | `App.elm:24725`, `View/Connect.elm:197`, ports `sasl` | Elm clears the password after submit, so a failed sign-in means retyping it |
| G5 | Recovery-code sign-in (toggle, ≥8 chars, RECOVERYCODES LOGIN after 001) | `Connect.tsx:1410`, `:774` (UI) | FULL | `View/Connect.elm:209`, `App.elm:24707` | — |
| G6 | Create account: name / optional email / password / confirm validation | `Connect.tsx:795` (UI) | FULL | `View/Connect.elm:238`, `App.elm:24635` | Elm also shows live short-password and mismatch hints |
| G7 | Password strength meter | `Connect.tsx:1443` (UI) | FULL | `View/Connect.elm:290`, `App.elm:24480` | — |
| G8 | Register → verification-code step → signed-in account | `Connect.tsx:1208`, `:837` (UI) | FULL | `App.elm:24746` settleConnectGate → claim sheet `View/GuestClaim.elm:245` | The verify step moves into the in-shell sheet; Elm sends IDENTIFY on the live socket instead of reconnecting with SASL |
| G9 | Mode links (Join as guest / Sign in / Create account), clears errors | `Connect.tsx:1618`, `:651` (UI) | FULL | `View/Connect.elm:389`, `App.elm:37532` | — |
| G10 | `?signin=1` opens Sign-in mode (the /invite "Sign in" link) | `Connect.tsx:245`, `routes/Invite.tsx:77` (UI) | MISSING | `App.elm:2604` builds the link; nothing in init reads it | The invite page's Sign in link lands on the guest form |
| G11 | Phase-aware status copy (connecting / registered name / nick in use / bad password / unreachable) | `Connect.tsx:496` (UI) | FULL | `App.elm:24383`, `View/Connect.elm:94` | No "Ready / Connecting / Couldn't join" phase label |
| G12 | "This name is protected — Sign in as X" action | `Connect.tsx:1528` (UI) | PARTIAL | `App.elm:24402` (status copy only) | No one-click switch to Sign-in mode |
| G13 | Connect-time GHOST reclaim ("That name is taken — reclaim it?" + password) | `Connect.tsx:1541`, `:940` (UI) | MISSING | `App.elm:24426` connectShowReclaim is exported but no View uses it; `App.elm:28418` | Solid's `ghost()` needs a live client, so it may do nothing there |
| G14 | Show/Hide password toggle (Connect and Account) | `Connect.tsx:186`, `Account.tsx:140` (UI) | MISSING | `View/Connect.elm:325` plain inputs | — |
| G15 | Stay signed in (saves the password, private device) | `Connect.tsx:1482`, `:693` (UI) | MISSING | `ports.js:1151` ("needs a login UI") | Listed as a narrowing in COVERAGE.md:29 |
| G16 | Remembered identities list ("Welcome back", per-identity status) | `Connect.tsx:1134` (UI) | MISSING | `Credentials.elm` is imported only by tests | — |
| G17 | Remembered action: Resume / Sign in / Use identity | `Connect.tsx:971` (UI) | MISSING | — | Returning users retype their name and password every visit |
| G18 | Forget a remembered identity | `Connect.tsx:1024` (UI) | MISSING | — | — |
| G19 | "Not now" dismiss of remembered identities | `Connect.tsx:1195` (UI) | MISSING | — | — |
| G20 | Invite preview aside (title, inviter copy, topic, access-rules note) | `Connect.tsx:1088` (UI) | PARTIAL | `View/Connect.elm:41` ("Join #room" title + room hint) | No description, topic or access note |
| G21 | Invite `?as=` pre-fills the guest name | `Connect.tsx:280` (auto) | FULL | `App.elm:3326`, `App.elm:3410` | — |
| G22 | `?join=` / `?at=` / `?topic=` queued for the post-connect join | `Connect.tsx:256` (auto) | FULL | `App.elm:15438`, `App.elm:3842` | — |
| G23 | `?reader=1` turns on reader mode | `Connect.tsx:266` (auto) | MISSING | `Invite.elm:565` (share card only), `App.elm:1419` | Elm builds `reader=1` into links but `/app` ignores it |
| G24 | Automatic fastest-node selection (HEAD probe, pin) | `Connect.tsx:371`, `app/nodes.ts` (auto) | FULL | `Nodes.elm`, `Main.elm:1056`, `ports.js:3932` | Elm probes when you submit; Solid probes as the page loads |
| G25 | Fields lock while dialing; cancel the dial | `Connect.tsx:545` (lock only) | FULL | `View/Connect.elm:80`, `App.elm:37577` | Elm adds a Cancel button |
| G26 | Shell stays up through a drop (autoReconnect) | `Connect.tsx:1080` (auto) | FULL | `App.elm:24306` | — |
| G27 | Deliberate disconnect returns to the gate | `Connect.tsx:1047` (UI) | FULL | `App.elm:37596` | — |
| G28 | Passkey sign-in on Connect | `Connect.tsx:105` PRESENT_PASSKEY_SIGNIN=false (DEAD) | N/A | v3/gap-auth: `View.AuthGate.signInLinks` → `AuthGate.PasskeyStart` → `Passkey.webauthnAuth` on a plain guest connection → AUTH-CHALLENGE/ALLOW-CRED → get ceremony → AUTH-FINISH → `NOTICE … You are now identified as` | Elm now offers it (the server path is complete); Solid still hides it |
| G29 | Update reload deferred while the form holds typed data | `Connect.tsx:330` (auto) | FULL | `App.elm:46222` | Elm reloads only after the user approves |
| G30 | bfcache/freeze page restore → reconnectNow, or mark offline | `connectPageLifecycle.ts:34` (auto) | MISSING | no pageshow/freeze listener in `ports.js` | — |
| G31 | Stale lazy-chunk recovery screen | `StaleChunkRecovery.tsx`, `Connect.tsx:1666` (auto) | N/A | single Elm bundle | Absent by design |
| G32 | ConnectPulse live network rail | `ConnectPulse.tsx` (DEAD, no importer) | N/A | — | — |
| G33 | Legacy `ocean-*` → `onyx:*` storage migration | `migrateStorage.ts:13` (auto) | MISSING | `ports.js:5128` purges only identity-profile keys | — |
| G34 | Credential store compatibility (`onyx:credentials`) | `credentials.ts:300` v2 `{version,activeKey,entries}` (auto) | PARTIAL | `ports.js:1161` `{v:1,slots}`; `index.html:168` | An Elm token write wipes Solid's saved identities, and Elm can't read Solid's tokens |
| G35 | Saved sign-in targets in the device-transfer bundle | `credentials.ts:686`, `vault/portableTransfer.ts:171` (UI via Prefs) | MISSING | `ports.js:1154` | — |
| G36 | Session resume (TOKEN / MTOKEN / RESUME, mesh first) | `lib/irc/sessionReclaim.ts` (auto) | FULL | `Session.elm` planSessionReclaim, `ports.js:1205` | Across a reload it only resumes after a password sign-in |
| G37 | Session reclaim banner (4 phases, Sign in again, dismiss) | `SessionReclaimBanner.tsx:87`, `:98` (UI) | FULL | `View/Account2.elm:47`, `App.elm:41952` | — |
| G38 | Guest "Keep <nick>?" chip + dismiss (saved per owner) | `GuestClaimPrompt.tsx:357`, `:367` (UI) | PARTIAL | `View/GuestClaim.elm:79`, `View/Home.elm:112` | Chip shows on Home only; no first-hour suppression |
| G39 | Claim sheet: REGISTER → VERIFY → IDENTIFY; can't close while busy | `GuestClaimPrompt.tsx:458`, `:513` (UI) | FULL | `View/GuestClaim.elm:177`, `App.elm:39434`, `:39441` | — |
| G40 | Guest "Keep this name" from You / Account | `Account.tsx:690` (UI) | FULL | `View/Nav.elm:304`, `App.elm:44020` | Guest explainer and steps list missing |
| G41 | Refresh on open (ACCOUNTINFO, TOTP / KEYTRANS / E2EEKEY status, VHOST LIST, codes, passkeys, sessions) | `Account.tsx:475` (auto) | FULL | `App.elm:26722` | — |
| G42 | Overview: account, email, registered, loading | `Account.tsx:723` (UI) | FULL | `View/Account.elm:107` | Elm also shows nick, secure, enforce and flags |
| G43 | Last account-action error banner ("command: description", alert) | `Account.tsx:777` (UI) | PARTIAL | `View/Account.elm:168` | Description only; not announced as an alert |
| G44 | Section index with active-section tracking + mobile drill-in/back | `Account.tsx:252`, `:711` (UI) | PARTIAL | `View/Account.elm:85` | Plain anchors: no active state, no mobile master/detail |
| G45 | Change email (password-checked ACCOUNTSET) | `Account.tsx:789` (UI) | FULL | `View/Account.elm:985`, `App.elm:27108` | — |
| G46 | Change password | `Account.tsx:826` (UI) | FULL | `View/Account.elm:1043`, `App.elm:27142` | — |
| G47 | Two-factor status + Enable | `Account.tsx:893` (UI) | FULL | `View/Account.elm:563`, `App.elm:37899` | — |
| G48 | Copy TOTP secret / otpauth link with feedback | `Account.tsx:907` (UI) | FULL | `View/Account.elm:600`, `App.elm:37927` | Success shows as a label change, with no status line |
| G49 | Confirm two-factor with a 6-digit code | `Account.tsx:946` (UI) | FULL | `View/Account.elm:676`, `App.elm:37913` | — |
| G50 | Disable two-factor | `Account.tsx:976` (UI) | FULL | `View/Account.elm:713`, `App.elm:37902` | — |
| G51 | Session rows (this device, attached/detached, age, sign-on time) | `SessionsDevicesSection.tsx:153` (UI) | PARTIAL | `View/Account.elm:223` | No age or sign-on time; rows read "Session N" |
| G52 | Refresh session list | `SessionsDevicesSection.tsx:89` (UI) | FULL | `View/Account.elm:189`, `App.elm:37888` | — |
| G53 | Revoke one session (SESSION DROP sid=/#n) | `SessionsDevicesSection.tsx:164` (UI) | FULL | `View/Account.elm:246`, `App.elm:38230` | — |
| G54 | Revoke other devices (bulk, confirm) | `SessionsDevicesSection.tsx:100` (UI) | FULL | `View/Account2.elm:141`, `App.elm:41870` | Inline confirm instead of `window.confirm` |
| G55 | Recovery codes: remaining count + Refresh | `RecoveryCodesSection.tsx:71` (UI) | FULL | `View/Account.elm:1130`, `:1167` | — |
| G56 | Generate new codes (two-step, optional password) | `RecoveryCodesSection.tsx:102` (UI) | FULL | `View/Account.elm:1149`, `App.elm:38046` | — |
| G57 | Clear all codes | `RecoveryCodesSection.tsx:36` (UI) | FULL | `View/Account.elm:1175`, `App.elm:38065` | — |
| G58 | New codes shown once + Copy all + Done | `RecoveryCodesSection.tsx:171` (UI) | FULL | `View/Account.elm:1243`, `App.elm:38076` | — |
| G59 | Passkeys: browser / server unsupported notices | `PasskeysSection.tsx:191`, `:199` (UI) | FULL | `View/Account.elm:1295` | — |
| G60 | Add a passkey (label + device ceremony) | `PasskeysSection.tsx:208` (UI) | FULL | `View/Account.elm:1314`, `App.elm:38096` | — |
| G61 | List / refresh passkeys (label, created, use count) | `PasskeysSection.tsx:257` (UI) | FULL | `View/Account.elm:1371`, `App.elm:38090` | — |
| G62 | Rename a passkey (hidden when the server doesn't support it) | `PasskeysSection.tsx:298` (UI) | FULL | `View/Account.elm:1510`, `App.elm:38119` | — |
| G63 | Remove a passkey (inline confirm) | `PasskeysSection.tsx:323` (UI) | FULL | `View/Account.elm:1479`, `App.elm:38141` | — |
| G64 | Sign out (LOGOUT) | `Account.tsx:1009` (UI) | FULL | `View/Account.elm:259`, `App.elm:37894` | Panel stays open, showing the guest copy |
| G65 | Download account record | `AccountDataVerbs.tsx:148` (UI) | FULL | `View/Account.elm:1555`, `App.elm:39500` | — |
| G66 | Save this device's history | `AccountDataVerbs.tsx:178` (UI) | FULL | `View/Account.elm:1570`, `App.elm:39503` | — |
| G67 | Delete account (type the name + password → DROP) | `AccountDataVerbs.tsx:207` (UI) | FULL | `View/Account.elm:1610`, `App.elm:27196` | Inline form instead of a Sheet |
| G68 | Protection toggles: Require sign-in (secure) / Hold this name (enforce) | `Account.tsx:1033` (UI) | MISSING | `Services.elm:906` accountSet; `View/Account.elm:132` shows them read-only | Not tracked in COVERAGE or ROADMAP |
| G69 | Bind this connection's certificate + notices | `Account.tsx:1080` (UI) | FULL | `View/Account.elm:743`, `App.elm:37955` | — |
| G70 | Remove a certificate fingerprint | `Account.tsx:1093` (UI) | FULL | `View/Account.elm:760`, `App.elm:37973` | — |
| G71 | Publish this device's key | `Account.tsx:1123` (UI) | FULL | `View/Account.elm:839`, `App.elm:38198`, `:38204` | — |
| G72 | List device keys / remove the legacy "browser" key + notices | `Account.tsx:1126`, `:1133` (UI) | FULL | `View/Account.elm:854`, `:861` | — |
| G73 | Refresh key transparency root | `Account.tsx:1137` (UI) | FULL | `View/Account.elm:801`, `App.elm:38037` | Has its own section in Elm |
| G74 | KEYTRANS PROOF | `store.ts:8878` (DEAD) | N/A | `requestKeytransProof` (core only) | — |
| G75 | Personas: list + Wear | `Account.tsx:1161` (UI) | FULL | `View/Account.elm:911`, `App.elm:37999` | — |
| G76 | Take persona off | `Account.tsx:1182` (UI) | FULL | `View/Account.elm:900`, `App.elm:38002` | — |
| G77 | Claim a persona host from open offers | `Account.tsx:1200` (UI) | FULL | `View/Account.elm:941`, `App.elm:38005` | — |
| G78 | Recover a name (RECOVER nick [password]) | `Account.tsx:1232` (UI) | CORE-ONLY | `Services.elm:920` builder with no caller | No password argument; not tracked as a gap in any doc |
| G79 | Residence file: download / copy JSON | `PortableIdentitySection.tsx:155` (UI) | FULL | `View/Account2.elm:187`, `App.elm:41926`, `:41936` | — |
| G80 | Residence import (favorites + folders + quiet hours) | `PortableIdentitySection.tsx:199` (UI) | PARTIAL | `App.elm:41949` | Favorites only; Elm has no folders or quiet-hours state |
| G81 | Session capability matrix | `Account.tsx:1109` (UI) | FULL | `View/Account.elm:274` | — |
| G82 | Typed secrets cleared when the panel closes or the owner changes | `Account.tsx:449` (auto) | PARTIAL | `App.elm:5419` (901 only); `App.elm:37320` close | Email, current, drop and recovery passwords survive closing the panel |
| G83 | Self-edit of METADATA profile (display name, bio, accent, links) | `store.ts:17493` via a window event nothing dispatches (DEAD) | N/A | `App.elm:42852` OwnMetadataSet (core only) | Not editable in either client |
| G84 | Automatic NICK reclaim timer after 900 while on an alias | `store.ts:4018`, `:14778` (auto) | FULL | `App.elm` startNickReclaim / fireNickReclaim | — |
| G85 | In-shell alias reclaim dialog (GHOST + NICK with password) | `store.ts:8796` reclaimNick (DEAD UI) | N/A | `View/Topbar.elm:135`, `:168`, `App.elm:24187` | Elm better |
| G86 | DM sealed to every peer device key; fails closed | `store.ts:5955` (auto) | FULL | `App.elm:8811`, `ports dmSealRequest` | — |
| G87 | DM open with trust-on-first-use pinning + locked placeholder | `store.ts:17625` (auto) | FULL | `App.elm:34958`, `DmCipher.elm:77` | — |
| G88 | DM notification once decrypted | `store.ts:17669` (auto) | FULL | `App.elm:31538` | — |
| G89 | Key-change toast + Inbox error notification | `store.ts:17703` (auto) | PARTIAL | `App.elm:43087` (serviceLog), `View/Rail.elm:477` (aria) | No toast or Inbox row; you only see it inside the DM |
| G90 | Safety-number Verify panel (readiness rows, grouped number, device count) | `PresenceRibbon.tsx:723`, `DmSafetySheet.tsx` (UI) | FULL | `View/DmSafety.elm:113`, `:186`, `App.elm:41728` | — |
| G91 | Key-change review: both numbers, Accept (save, reopen held messages), Keep locked, retry | `DmKeyChangeBanner.tsx` (UI) | FULL | `View/DmSafety.elm:292`, `App.elm:30839`, `:30866` | Elm adds a "Try again" for computing the numbers |
| G92 | Encrypt-DMs preference toggle | `PreferencesPanel.tsx:3650` (UI) | FULL | `View/Appearance.elm:232` | — |
| G93 | Device DM key published automatically on connect | `store.ts:11286`, `:17606` (auto) | FULL | `App.elm:5031` | — |
| G94 | Offline queue refuses E2EE DMs / required rooms | `store.ts:8071` (auto) | FULL | `App.elm:8643`, `:8646` | — |
| G95 | DM list preview never shows ciphertext | `dmPrivacyChrome.ts:102` (auto) | FULL | `Sidebar.elm:355` | — |
| G96 | Group room seal/open (ONYXROOM1) + "missing room key" placeholder | `store.ts:5861` (auto) | FULL | `App.elm:8621`, `:8953`, `ports.js:9197`, `GroupEnvelope.elm:100` | — |
| G97 | Group room-controls indicator | `PresenceRibbon.tsx:835`, `GroupControlRoomIndicator.tsx:96` (UI) | PARTIAL | `View/RoomSettings.elm:852`, `:882`; `RoomSettings.elm:857` | Never shows "active"; no "identity pending" state |
| G98 | Group device publication + trusted-signer pins | `groupDevicePublisher.ts`, `trustedGroupSignerStore.ts` (auto) | FULL | `App.elm:21199`, `ports.js:9411` | — |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- `COVERAGE.md:137` says "RECOVER/RELEASE reclaim (`Services.recover`/`release`, …)" is done. Neither `Services.recover` nor `Services.releaseNick` has a caller in `src/`, and Elm has no "Recover a name" UI (G78).
- `COVERAGE.md:63` lists GHOST/RECOVER/RELEASE as **done**. Only the builders exist. RECOVER and RELEASE can't be reached, and GHOST is used only by the in-shell alias dialog, not by the connect form (G13).
- `COVERAGE.md:31` says "password entry UI still ahead". That is stale and understates Elm: the connect gate's sign-in password field exists (`View/Connect.elm:197`).
- `COVERAGE.md:29` lists the connect narrowings but leaves out several gaps:
  - no connect-time GHOST reclaim (G13);
  - no "Sign in as X" action (G12);
  - `?signin=1` ignored (G10);
  - `?reader=1` ignored (G23);
  - no show/hide password (G14).
- `COVERAGE.md:54` says "credential hygiene" is done, but `ports.js:1161` writes a `{v:1,slots}` shape over Solid's v2 `onyx:credentials` store (G34).
- No row in either doc tracks the missing Account sections: Protection toggles (G68) and Recover a name (G78).
- `V3_ROADMAP.md:44` and `:84` are leftover copies of rows 1.2 and 3.7 with no status. They contradict `:40` and `:88`, which say **done**.
- Stale code comments:
  - `ports.js:1151–1155` says the login UI "has not built yet"; the login UI exists.
  - `View/Topbar.elm:163` says "Elm auto-connects, so there is no pre-connect form". The connect gate now exists.
  - `Credentials.elm` is documented as the port of `credentials.ts`, but no `src` module imports it (tests only).
- These claims are accurate: `V3_ROADMAP.md` 0.3 (remembered identities / Stay signed in) and 0.4 (invite aside) are marked todo.

#### Elm better than Solid
- **Cancel while dialing.** Elm can cancel a dial in flight (`View/Connect.elm:80`, `App.elm:37577`). Solid only locks the form.
- **Alias reclaim in the shell.** Elm has a dialog from the identity chip that sends GHOST + NICK (`View/Topbar.elm:135`, `:168`, `App.elm:24187`). Solid's `reclaimNick` has no UI.
- **DM header status chip.** Elm shows Private / key changed / Not encrypted (`View/DmSafety.elm:156`). Solid mounts the sheet with `hideTrigger` (`AppShell.tsx:1475`), so it shows no chip.
- **Safety-number retry.** Elm has a "Try again" button (`View/DmSafety.elm:356`); Solid only has copy telling you to try again.
- **DM key hold.** Elm holds a DM until the peer-key lookup answers, then offers an explicit "send unencrypted" (`App.elm:45042`, `:45092`, `View/Composer.elm:192`). This closes a race where Solid can send plaintext right after opening the DM.
- **Raw slash plaintext guard.** Elm blocks raw slash verbs that would send plaintext to an E2EE DM or a required room (`App.elm:11180`, `:46232`). Solid's `/msg` falls through to a raw `MSG` (`store.ts:8529`).
- **Overview facts.** Elm's account Overview also shows nick, secure, enforce and flags (`View/Account.elm:112`).
- **Register hints.** The create-account form shows live hints as you type (`View/Connect.elm:246`).
- **Gate footer links.** The connect gate links to About, Privacy, House rules and Status (`View/Connect.elm:110`).

#### Gaps (ranked by user impact)
- `[High]` **Remembered identities + Stay signed in (G15–G19).**
  - In `ports.js`, add list / select / save / forget ports over the `onyx:credentials` store.
  - Wire the `Credentials.elm` access/sort logic into new `ConnectRemembered{Select,Act,Forget,Dismiss}` and `ConnectStaySignedIn` Msgs.
  - Render the "Welcome back" block in `View/Connect.elm`.
- `[High]` **Credential schema collision (G34).** Make `ports.js` `read/writeCredentialsStore` and the `index.html` boot read use Solid's v2 `{version:2,activeKey,entries[].sessionToken/meshToken}` shape, merging instead of overwriting.
- `[Med]` **Protection toggles (G68).** Add `AccountProtectPasswordInput` and `AccountProtectionToggle "secure"|"enforce" Bool` → `Services.accountSet acct pw field "on"/"off"`, plus a Protection section in `View/Account.elm`.
- `[Med]` **`?signin=1` (G10).** Read it in `App.init` (`bootParams`) and set `connectForm.mode = ConnectSignIn`.
- `[Med]` **Connect-time reclaim (G13).** When `connectShowReclaim` is true, render a reclaim form in `View/Connect.elm`. `ConnectReclaimSubmit` should stage GHOST (+NICK) for after 001 on a fresh dial.
- `[Med]` **Key-change alert (G89).** In the `DmOpenFailed`, seal-failed and scheduled `keyChanged` arms of `App.elm`, add a once-per-change `addToast` + `addNotification` ("<peer>'s encryption key changed — verify before continuing").
- `[Med]` **Recover a name (G78).** Add `RecoverNickInput`, `RecoverPasswordInput` and `RecoverSubmitted` Msgs. Extend `Services.recover` with an optional password, and add a section to `View/Account.elm`.
- `[Low]` **"Sign in as X" button (G12).** In `View/Connect.elm`, dispatch `ConnectModeSet ConnectSignIn` when the registered-name error shows.
- `[Low]` **Invite preview aside (G20).** Render `App.inviteCard` (title, description, topic, access note) in `View/Connect.elm`.
- `[Low]` **Page-restore reconnect (G30).** Have `ports.js` send a `pageRestored` port on `pageshow(persisted)` / `resume`; `App` calls `reconnectNow` when `autoReconnect`.
- `[Low]` **Session row meta (G51).** Render age and sign-on time from `signonMs` in `View/Account.elm` sessionRow.
- `[Low]` **Clear secrets on close (G82).** Have `SetAccountOpen False` clear the email, current, new, drop and recovery password fields.
- `[Low]` **Show/hide password (G14).** Add a shared toggle for the password fields in `View/Connect.elm` and `View/Account.elm`.
- `[Low]` **`?reader=1` (G23).** Parse it in `App.init` and set `prefs.readerMode`.
- `[Low]` **Device-transfer sign-in targets (G35).** Add account handoffs to the Elm device-transfer bundle once G16 exists.
- `[Low]` **`ocean-*` migration (G33).** Add a one-shot copy-only migration in `index.html` before the flags are read.
- `[Low]` **Group indicator (G97).** Add an activation projection so `RoomSettings.groupMark` can show "active" and "identity pending".
- `[Low]` **Guest chip placement (G38).** Also render `guestClaimChip` in the conversation column, not just Home.
- `[Low]` **Account nav and error banner (G43–G44).** Add active-section tracking and a mobile drill-in to `View/Account.elm` sectionNav; show `command: description` with `role=alert`.

### V — Data & vault — history vault, outbox, saved searches, import/export, notification & PWA runtime
Solid walked: `src/lib/vault/*` (historyVault, vaultSync, outbox*, savedSearch*, retentionPolicy, searchVault*, embeddingIndex, dmSearchPrivacy, persistentStorage, storageEstimate, portable*, vaultResumeMemory, searchBounds, editHistory), `src/lib/import/*`, `src/shell/HistoryImportControls.tsx`, `src/shell/importFileLimits.ts`, `PreferencesPanel.tsx` (History & data / Import & export / App & tools), `src/lib/export/*`, `src/lib/notifications/*` (runtime, webPush, closed-tab, permission, digests, readState), `YouNotifications.tsx`, `NotificationCenter.tsx`, `home/homeController.ts` + `HomeBriefingView.tsx`, `src/pwa/*`, `public/sw.js`, misc libs (backgroundTask, autoJoin/ctcp memory, platform, net/*, clipboard, persistParse).
Elm checked: `VaultImport`, `Retention`, `Outbox`, `SavedSearches`, `Transcript`, `Push`, `Notify`, `NotifyCenter`, `Home`, `View/Prefs`, `View/Search`, `View/Inbox`, `View/Home`, `View/Account`, `View/Composer`, `View/Thread`, `View.elm`, `App.elm` folds, `Main.elm` ports, `ports.js`, `index.html`, `tools/build.sh`, `tools/elm-overlay.mjs`.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| V1 | Persist conversation buffers to IndexedDB (signature-gated, 400/target) | `src/lib/vault/vaultSync.ts:423` (auto) | FULL | `App.elm:43819` flushVaultBuffer, `App.elm:43707` signature, `ports.js:204` vaultPut | — |
| V2 | Hydrate vault rows when a conversation buffer appears | `vaultSync.ts:294` hydrate (auto) | PARTIAL | `App.elm:35640` selectChannel | Fetch only on select of an EMPTY buffer; buffers with live rows never hydrate |
| V3 | Cold-paint last-active room before connect (resume memory) | `vaultSync.ts:373`, `vaultResumeMemory.ts:48` (auto) | MISSING | — | No `onyx:vault-resume-target`; offline reload shows nothing until select |
| V4 | Owner-scoped device memory (vault rows keyed per server+account) | `historyVault.ts:1451` owner_key (auto) | MISSING | `ports.js:13` single `onyx-vault` store | Shared device: next identity reads/searches prior identity's history |
| V5 | Time travel `?at=` / open-at-message (loadAround) | `store.ts:7109` (auto/UI) | FULL | `App.elm:35752` requestTravelTo, `App.elm:43893` mergeVaultAround | — |
| V6 | Ciphertext-only E2EE persistence | `historyVault.ts:113` OMIT_AT_REST (auto) | FULL | `App.elm:43779` chatToVaultRow | — |
| V7 | Tombstones persisted, excluded from recall/time travel | `historyVault.ts:2266` (auto) | FULL | `App.elm:43779`, `ports.js:116` | — |
| V8 | Local edit history (prior bodies of own edits) | `editHistory.ts:20`, `MessageView.tsx:651` (UI) | FULL | `App.elm:7068`, `View/Thread.elm:2157` | — |
| V9 | Room media index reads vault | `RoomMediaIndex.tsx:115` (UI) | FULL | `App.elm:38428`, `View/RoomHeader.elm:350` | — |
| V10 | Device recall pane "Remembered elsewhere" in search | `search/MessageSearch.tsx:851` (UI) | FULL | `App.elm:36953`, `View/Search.elm:233` | — |
| V11 | Exact / related / hybrid engines (hash vectorizer, RRF, boosts) | `searchVaultHybrid.ts`, `searchVaultSemantic.ts` (auto) | FULL | `ports.js:579`, `ports.js:599` | Ollama provider DEAD in Solid |
| V12 | In-search matching-mode switch | `MessageSearch.tsx:832` Advanced (UI) | PARTIAL | `View/Search.elm:251` CycleVaultSearchMode | Toggle only rendered when hits exist; label fixed "Saved on this device" |
| V13 | Open a vault hit at its message | `MessageSearch.tsx:879` (UI) | FULL | `View/Search.elm:267`, `App.elm:36978` | — |
| V14 | Encrypted-DM vault privacy classification | `search/useMessageSearch.ts:316` (auto) | FULL | `App.elm:1303`, `App.elm:36971` | — |
| V15 | Device recall chips (lexical pivots) | `MessageSearch.tsx:711` (UI) | FULL | `App.elm:29502`, `View/Search.elm:222` | — |
| V16 | Default search-mode preference | `PreferencesPanel.tsx:3669` (UI) | FULL | `View/Prefs.elm:207`, `App.elm:39695` | — |
| V17 | Palette "Switch vault search to …" / `vault <mode>` | `chat/spotlight/commands.ts:519`, `:942` (palette) | MISSING | — | Switcher has no vault commands |
| V18 | Save current search with a name | `MessageSearch.tsx:656` (UI) | FULL | `View/Search.elm:449`, `App.elm:39730` | — |
| V19 | Run saved search | `MessageSearch.tsx:673` (UI) | FULL | `View/Search.elm:495`, `App.elm:39705` | — |
| V20 | Delete saved search | `MessageSearch.tsx:689` (UI) | FULL | `View/Search.elm:505`, `App.elm:39724` | — |
| V21 | Cross-tab saved-search invalidation | `savedSearches.ts:119` (auto) | FULL | `ports.js:1460`, `App.elm:37714` | Single default DB (no owner DBs) |
| V22 | Clear all saved searches (count + confirm) | `PreferencesPanel.tsx:1404` (UI) | CORE-ONLY | `App.elm:1037` SearchClearRequest, `App.elm:37685` | Outbound never emitted; no Prefs card |
| V23 | Saved searches travel in portable export/import | `portableTransfer.ts:162`, `:295` (UI) | CORE-ONLY | `App.elm:1038`–`1040`, `App.elm:37707`, `ports.js:6569` | Export/pick ports + fold exist; nothing emits `SearchExportRequest`/`SearchImportPick` |
| V24 | On-device history keep/age policy | `PreferencesPanel.tsx:2835` (UI) | FULL | `View/Prefs.elm:398`, `View/Account.elm:312`, `App.elm:39569` | — |
| V25 | Retention applied at boot across all targets | `routes/AppRoute.tsx:41` (auto) | PARTIAL | `ports.js:6002` save-time + per-write trim | No boot prune: idle targets keep over-age rows until a write/save |
| V26 | Local history on/off (off = erase + stop persisting, retry erase) | `PreferencesPanel.tsx:600` (UI) | MISSING | — | No `localHistory` pref; persistence always on |
| V27 | Clear local history (confirm, verified erase) | `PreferencesPanel.tsx:2942` (UI) | MISSING | — | No vault-clear port |
| V28 | Clear reviewed catch-up anchors | `PreferencesPanel.tsx:1277` (UI) | MISSING | — | No reviewed-anchor state (see V84) |
| V29 | Clear topic read positions | `PreferencesPanel.tsx:1612` (UI) | MISSING | `TopicRead.elm` state exists | No clear control |
| V30 | Clear followed conversations | `PreferencesPanel.tsx:1768` (UI) | MISSING | `App.elm:31288` follow keys exist | No clear control |
| V31 | Discard local drafts (room + topic, confirm) | `PreferencesPanel.tsx:1946` (UI) | PARTIAL | `View/Prefs.elm:536` | In-memory room drafts only; no topic drafts; drafts not persisted across reload |
| V32 | Discard queued sends (all, count re-confirm) | `PreferencesPanel.tsx:2162` (UI) | FULL | `View/Prefs.elm:460`, `App.elm:40375` | Elm adds per-row Discard |
| V33 | Offline send → durable outbox (100 cap, 24h TTL) | `store.ts:8089` (auto) | FULL | `App.elm:10599`, `ports.js:894` | — |
| V34 | Reconnect flush with wire-admission / claim guards | `store.ts:7147` flushOutbox (auto) | FULL | `App.elm:30035`, `App.elm:37132`, `ports.js:962` | — |
| V35 | Auto-retry 5×4s + terminal classification | `store.ts:7318` (auto) | FULL | `App.elm:37287`, `Outbox.elm` | — |
| V36 | Composer outbox chrome + Retry now | `shell/Composer.tsx:1375`, `:1389` (UI) | PARTIAL | `View/Composer.elm:212` | Queue never read at boot: offline reload shows no chrome until 001/Prefs open |
| V37 | Queued / delivery-uncertain placeholder rows | `MessageView.tsx:2285` (UI) | FULL | `View/Thread.elm:557`, `:580` | — |
| V38 | Home queued-sends card + Try sending now | `home/HomeBriefingView.tsx:411` (UI) | PARTIAL | `View/Home.elm:226`, `:254` | No uncertain/admitted row states (prunePending hard-coded 0) |
| V39 | Open a queued send (re-materialise placeholder + focus) | `HomeBriefingView.tsx:458`, `store.ts:7368` (UI) | MISSING | — | — |
| V40 | Remove one queued send from Home (two-step confirm) | `HomeBriefingView.tsx:466`, `store.ts:7419` (UI) | PARTIAL | `View/Prefs.elm:490` | Per-row discard exists only in Prefs |
| V41 | Export portable vault JSON | `PreferencesPanel.tsx:1151` (UI) | PARTIAL | `View/Prefs.elm:228`, `App.elm:40345`, `ports.js:6821` | Vault rows only; drops drafts, topic drafts, followed, read cursors, saved searches, reviews, sign-in targets, prefs |
| V42 | Export compressed vault (.json.gz) | `PreferencesPanel.tsx:1164` (UI) | MISSING | — | — |
| V43 | Save vault (plain / gzip) to file via File System Access | `PreferencesPanel.tsx:1175`, `:1185` (UI) | MISSING | — | — |
| V44 | Share vault file (Web Share) | `PreferencesPanel.tsx:1200` (UI) | MISSING | — | — |
| V45 | Import portable JSON | `PreferencesPanel.tsx:972`, `:1206` (UI) | PARTIAL | `View/Prefs.elm:229`, `App.elm:37003`, `ports.js:6882` | Merges immediately; no 64 MiB guard; result only in service log; non-vault sections ignored |
| V46 | Import compressed (.json.gz) | `PreferencesPanel.tsx:1003` (UI) | MISSING | — | Picker accepts `.json` only |
| V47 | Staged import review (counts) + Import reviewed / Cancel | `PreferencesPanel.tsx:1219` (UI) | MISSING | — | — |
| V48 | Cross-tab import lock + owner-change abort | `PreferencesPanel.tsx:1096`, `portableImportLock.ts:27` (auto) | MISSING | — | — |
| V49 | Import applies prefs, scene motion, retention handoff | `portableTransfer.ts:228` (UI) | MISSING | — | `preferenceHandoff` ignored |
| V50 | Saved sign-in targets (account handoffs) transfer | `portableTransfer.ts:167` (UI) | MISSING | — | — |
| V51 | Export result echo | `PreferencesPanel.tsx:867` (UI) | FULL | `App.elm:36989` | Counts messages/conversations only |
| V52 | Import & export route picker (6 tools, roving keys) | `PreferencesPanel.tsx:3237` (UI) | PARTIAL | `View/Prefs.elm:221` | Only Portable vault route |
| V53 | Discord JSON (DiscordChatExporter) multi-file import + review | `shell/HistoryImportControls.tsx:372` (UI) | MISSING | — | — |
| V54 | Discord data-package folder import + review | `HistoryImportControls.tsx:439` (UI) | MISSING | — | — |
| V55 | Discord bot-token server import (proxy consent, progress, cancel, pins) | `HistoryImportControls.tsx:635`, `:834` (UI) | MISSING | — | Uses `/discord-import` proxy |
| V56 | Slack workspace JSON import + review | `HistoryImportControls.tsx:893` (UI) | MISSING | — | — |
| V57 | Classic IRC log (weechat/irssi/mIRC) into a named room + review | `HistoryImportControls.tsx:928` (UI) | MISSING | — | — |
| V58 | Import byte/count limits with copy | `shell/importFileLimits.ts:6` (UI) | MISSING | `VaultImport.elm:22` row ceilings only | No file-size gate before FileReader |
| V59 | `/export [txt\|json]` local transcript | `store.ts:8400` (slash) | FULL | `App.elm:19339`, `Transcript.elm` | Toast says "Export started" even if download fails |
| V60 | Room More → Export local transcript | `shell/PresenceRibbon.tsx:1216` (UI) | MISSING | — | — |
| V61 | Ctrl/Cmd+Alt+E export shortcut | `lib/keyboard/shortcutsRegistry.ts:150` (shortcut) | MISSING | — | — |
| V62 | Download device-history copy (account data verbs) | `app/AccountDataVerbs.tsx:100` (UI) | FULL | `View/Account.elm:1575`, `App.elm:16422` | — |
| V63 | Vault persistence status + "Keep vault on this device" | `PreferencesPanel.tsx:2794`, `persistentStorage.ts:51` (UI) | MISSING | — | No App & tools tab |
| V64 | Origin storage estimate + refresh | `PreferencesPanel.tsx:2820`, `storageEstimate.ts:43` (UI) | MISSING | — | — |
| V65 | Installed-app readiness checks + Refresh app shell | `PreferencesPanel.tsx:2750`, `pwa/readiness.ts:82` (UI) | MISSING | — | — |
| V66 | Service-worker registration (offline shell cache) | `index.tsx:13`, `pwa/serviceWorkerRuntime.ts:26` (auto) | MISSING | `ports.js:9749` comment | Elm registers no SW; `sw.js` deployed but never registered |
| V67 | Update reload held while protected work active | `pwa/updateCoordinator.ts:7`; holds `AppShell.tsx:399`, `:418`, `Composer.tsx:213` (auto) | PARTIAL | `App.elm:45572` polishWorkActive | Only calls hold; drafts/uploads/connect form/theme edits don't |
| V68 | Installed-app icon badge = unread attention | `pwa/AppBadgeRuntime.tsx:42` (auto) | MISSING | — | No setAppBadge |
| V69 | Tab title "(N) Onyx" attention count | `pwa/AttentionTitleRuntime.tsx:20` (auto) | MISSING | `View.elm:146` documentTitle | Title shows room name, never a count |
| V70 | Alert decision (kind/self/mute/focus/DND/permission/throttle) | `notifications/decision.ts` shouldNotify (auto) | FULL | `Notify.elm`, `App.elm:31644` | — |
| V71 | Desktop notification + beep emission | `NotificationRuntime.tsx:161` (auto) | PARTIAL | `App.elm:31644`, `ports.js:5693`, `:5669` | No calm-preset, smart-mute rule, or quiet-hours gates |
| V72 | Encrypted-message alert body redaction | `notificationBody.ts:38` (auto) | FULL | `App.elm:31623` notificationBodyFor | — |
| V73 | Alert click opens the conversation / followed topic | `NotificationRuntime.tsx:212` (auto) | MISSING | `ports.js:5706` | Click only focuses the window |
| V74 | Throttled alerts coalesce into "N new alerts in X" | `NotificationRuntime.tsx:195`, `:286` (auto) | MISSING | — | Throttled alerts are dropped |
| V75 | Live permission monitor (site-settings changes) | `permissionMonitor.ts:45` (auto) | PARTIAL | `ports.js:5742` | Read at boot and after a request only |
| V76 | Turn closed-tab push on/off (WEBPUSH SUBSCRIBE/UNSUBSCRIBE) | `YouNotifications.tsx:219`, `:231`; `NotificationControls.tsx:405` (UI) | PARTIAL | `View/Account.elm:476`, `App.elm:21691` toggleWebPush, `ports.js:8432` | No SW registered ⇒ `serviceWorker.ready` never settles on fresh browsers ⇒ stuck "Turning on…" |
| V77 | Push state reconcile + silent recovery on reload/reconnect | `YouNotifications.tsx:105` (auto) | PARTIAL | `App.elm:21672` requestWebPushCheck | Gated on `webPushOn`, which boots False ⇒ never checks/recovers after reload |
| V78 | One-tap "Turn on alerts" (permission + desktop pref + push) | `armClosedTab.ts:24`; `YouNotifications.tsx:150`; `FirstRunNotifyPrompt.tsx:77` (UI) | PARTIAL | `App.elm:45748` | First-run/desktop only request permission; push is a separate Account toggle |
| V79 | Closed-tab status copy, "What can ping" kinds, host honesty | `closedTabCopy.ts:54`, `YouNotifications.tsx:239` (UI) | MISSING | `View/Account.elm:490` | Elm copy is "Push is on/off." only |
| V80 | SW push → OS notification (E2EE-redacted) + click opens `/app?join=` | `public/sw.js:377`, `:438` (auto) | PARTIAL | `App.elm` parseDeepLinkJoin | Works only where a legacy Solid SW registration persists |
| V81 | Away-digest tiers (attention / followed / quiet, calm preset) | `home/homeController.ts:425`, `awayDigest.ts:102` (UI) | PARTIAL | `Home.elm:217` composeInbox | Mentions/unread only; no followed/continue tier or calm preset |
| V82 | "Since you left" digest card in a room | `MessageView.tsx:2074`, `sinceDigest.ts:80` (auto UI) | MISSING | — | — |
| V83 | Home "On this device" cold vault rooms while offline | `HomeBriefingView.tsx:486`, `homeController.ts:496` (UI) | MISSING | `View/Home.elm:13` narrowing | — |
| V84 | Reviewed catch-up anchors (record on caught-up, palette recall, reader span) | `homeController.ts:915`, `commands.ts:483`, `MessageView.tsx:1141` (UI/palette) | MISSING | `App.elm:30694` marks read only | — |
| V85 | Home "more activity" (remembered rooms, quiet activity/boosts, reviews) | `homeController.ts:806` (DEAD) | N/A | — | `HomeBriefingView` types `more` but renders nothing |
| V86 | Unread read-state core (incoming / viewed / total mentions) | `readState.ts:24` (auto) | FULL | `App.elm:30663`, `App.elm:18662` | — |
| V87 | Inbox bell, attention badge, filters, mark all read | `NotificationCenter.tsx:293`, `:314` (UI) | FULL | `View/Inbox.elm:52`, `:109`, `:156` | — |
| V88 | Inbox row open (marks read, jumps) | `NotificationCenter.tsx:355` (UI) | PARTIAL | `View/Inbox.elm:204`, `App.elm:18628` | Follow-topic rows open the room without the topic jump |
| V89 | Inbox row dismiss | `NotificationCenter.tsx:383` (UI) | FULL | `View/Inbox.elm:237` | — |
| V90 | Inbox room-ledger links (head + per row) | `NotificationCenter.tsx:297`, `:372` (UI) | MISSING | — | — |
| V91 | Clipboard write with legacy fallback | `lib/clipboard/writeClipboardText.ts` (UI, 20+ callers) | FULL | `ports.js:3968` | — |
| V92 | Auto-join memory | `autoJoinMemory.ts:44`, `store.ts:5447` (auto) | FULL | `App.elm:11576`, `:11603` | Not owner-scoped |
| V93 | CTCP config load | `ctcpMemory.ts:60`, `store.ts:5468` (auto) | FULL | `App.elm:37844` | — |
| V94 | CTCP config setters (version reply / TIME / PING) | `store.ts:16580` (DEAD) | N/A | — | No non-test caller |
| V95 | Connection / reconnect banner copy | `net/partitionBanner.ts:21`, `ReconnectStatusBanner.tsx:46` (auto) | FULL | `App.elm:16872` | mesh-partition/read-only kinds never passed in Solid (DEAD) |
| V96 | Client-surface detection (standalone, native host) | `platform.ts:115` (auto) | PARTIAL | `ports.js:9805`, `Polish.elm:406` | No zig-desktop host bridge in the Elm build |
| V97 | Idle task scheduler / bounded abort / persistParse | `backgroundTask.ts:93`, `net/boundedAbort.ts:32`, `store/persistParse.ts` (internal/DEAD) | N/A | — | Plumbing; persistParse is test-only |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- COVERAGE:184 (vault row) says export/import are done and "Flag flipped partial→done: every header item traces". That overstates it. The oracle's UI export is the PortableTransfer superset (`portableTransfer.ts:159`: drafts, topic drafts, followed, read cursors, saved searches, review history, sign-in targets, prefs + retention). Elm exports vault-kind rows only (`ports.js:6821`) and imports with no review, size limit or gzip. It also has no owner scoping (V4), no cold paint (V3), and no local-history toggle or clear (V26/V27).
- COVERAGE:184 calls the import trigger "`/import` … new surface, no oracle UI". This is wrong: the oracle has Preferences → Import & export → Portable vault "Import portable JSON" with a staged review (`PreferencesPanel.tsx:1206`, `:1219`). Elm itself now also has a Prefs import button (`View/Prefs.elm:229`).
- COVERAGE:188 (saved searches) lists "save/delete/clear/export/import outbounds, file pick + download" as done. Clear, export and import are CORE-ONLY: `SearchClearRequest`, `SearchExportRequest` and `SearchImportPick` (`App.elm:1037`–`1039`) have no emitter anywhere, so no user can reach them.
- COVERAGE:187 claims "View.Composer offline-enabled with live Outbox chrome". In fact the outbox mirror is only loaded on the 001 flush (`App.elm:30035`) or when Prefs opens (`App.elm:44403`). After an offline reload the composer and Home show no queued rows.
- COVERAGE:196 (Home) is UNDERSTATED: it still lists "dismissal not persisted (`onyx:first-hour-seen`)" and "first-run notifications prompt not ported". v3/polish shipped both (`ports.js:9754` POLISH_FLAG_KEYS, `App.elm:45581` firstRunNotifyOffered).
- COVERAGE has no row at all for web push, the desktop-alert runtime, the app badge, the attention title, or SW registration. These are silent gaps, and web push hides two defects (V76/V77).
- V3_ROADMAP:70 shows 2.7 "Since you left digest, mark caught up" as plain `M`. That is partly UNDERSTATED: Mark all caught up shipped in v3/home (`App.elm:30694`). The since-digest card (V82) is still missing.
- V3_ROADMAP:100 shows 4.5 History import as plain `M`. Portable-vault import exists in partial form, while the Discord, Slack and IRC-log importers have not been started. Status should read partial.
- V3_ROADMAP:129 (7.3) is accurate that the Elm build registers no SW. It does not mention that push subscription depends on `serviceWorker.ready`, which never settles without a registration.

#### Elm better than Solid
- Prefs → Queued sends has a per-row Discard (`View/Prefs.elm:490`). The Solid Prefs card is bulk-only (`PreferencesPanel.tsx:2162`).
- `/import` slash verb reopens the vault picker from the composer (`App.elm:13018`). Solid has no slash path for this.
- Retention controls appear on two surfaces: Account "On-device history" (`View/Account.elm:312`) and Prefs (`View/Prefs.elm:398`).
- The document title names the active room (`View.elm:146`). The Solid title is a fixed "Onyx"/"(N) Onyx".

#### Gaps (ranked by user impact)
- [High] Web push hangs on fresh browsers (V76/V80/V66). Register `/sw.js` in `ports.js` at boot (`navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'})`) and feed `controllerchange` into `WebPushRecoveryHint`. Also time-limit `swReady()` in `createWebPush` so the toggle fails with a reason instead of hanging.
- [High] Push is never reconciled after a reload (V77). In `App.requestWebPushCheck` (`App.elm:21672`), drop the `not model.webPushOn` gate for signed-in sessions; the ports intent marker already keeps it opt-in.
- [High] The vault is not owner-scoped (V4). Stamp `owner_key` from `App.deviceMemoryOwner` onto `VaultPersist`/`VaultFetch`/`VaultSearch`/export in `ports.js`, filter reads by it, and clear the in-memory mirror on owner change.
- [High] No local-history toggle and no clear-history control (V26/V27). Add a `localHistory` pref (`Prefs.updatePreference`) that gates `flushVaultBuffer`, a `VaultClear` port with verified erase, and toggle + clear cards in the `View/Prefs` History tab.
- [High] No third-party importers (V53–V57). Write pure Elm parsers mirroring `lib/import/*` that emit `VaultImport` snapshots. Add a Transfer tool picker in `View/Prefs`, multi-file/folder pickers in `ports.js`, and a bot import over the `/discord-import` proxy.
- [Med] Portable export/import completeness (V41/V45–V50, V23). Extend `vaultExportAll` to bundle saved searches, drafts, follows, topic cursors and prefs. Stage `VaultImportFile` into a review state (`prefsImportPending`) with Import/Cancel, add a FileReader size check and `.json.gz` via DecompressionStream, and fan the sections out on confirm.
- [Med] Desktop alert click doesn't open the conversation (V73). In `ports.js` `note.onclick`, send a new `notifyClicked {tag}` port and fold it into `ChannelSelect` (or the follow-topic open).
- [Med] No attention title or app badge (V68/V69). Prefix `View.documentTitle` with `(N)` from `unreadAttentionCount`; add an `appBadge` port fired when the count changes.
- [Med] Saved-search clear is unreachable (V22). Add a History-tab card in `View/Prefs` with a count and confirm that emits `SearchClearRequest`.
- [Med] Vault hydrate on buffer appearance + cold paint (V2/V3). Emit `VaultFetch` on JOIN/first buffer (not only on an empty select), and persist and replay the last-active target via a resume-memory port.
- [Med] Since-you-left digest (V82) and Home offline memory card (V83). Port `sinceDigest.ts` into a pure module rendered above the unread divider in `View/Thread`; add a vault-backed Home card while disconnected.
- [Med] Home queued rows lack Open/Remove (V39/V40). Add `HomeOutboxOpen`/`HomeOutboxRemove` Msgs: Open re-adds the placeholder and focuses it; Remove reuses `OutboxReview {discard=[id]}`. Load the outbox at boot so V36 also works offline.
- [Low] Room More → Export and Ctrl+Alt+E (V60/V61). Add a `runSlashExport` menu item in `View/RoomHeader` and a chord in the shortcut port.
- [Low] Closed-tab alerts sheet parity (V78/V79). Add a "Turn on alerts" arm chaining `NotifyPermissionRequest` → `WebPushProbe`, plus the `closedTabCopy` strings and the kinds list in `View/Notify`.
- [Low] Alert coalescing and live permission monitor (V74/V75). Queue throttled alerts per tag in `App` and flush on `Tick`; have `ports.js` subscribe to `navigator.permissions.query({name:'notifications'}).onchange`.
- [Low] Reviewed anchors (V84/V28), storage persistence/estimate (V63/V64), wider update holds (V67), palette vault commands (V17), inbox ledger links (V90), boot-time retention prune (V25), always-visible mode switch (V12).

### A — Store actions I — connection, messaging, accounts, channels, panels

Walked every action in `src/lib/store/store.ts` 6392–10432 (242 incl. `voice.startScreenshare/stopScreenshare` and the four `e2eeKey*` actions; `sendMessage` non-slash arms + `deliverChatMessage` 5756), grepping non-test callers across `src/**` and internal `get().x` callers (interface block 960–1650 excluded). Elm: `App.elm` Msg (2610–3258) + folds/helpers, `RoomSettings.Msg`, `Polish.Msg`, `Switcher.elm` (palette + shortcuts), `View/*.elm`, `View.elm`, `Main.elm`, `ports.js`. Open/close pairs and same-shape families share rows. "DEAD" = no non-test caller.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| A1 | Page-lifecycle reconcile (`setConnectionStatus`): bfcache `pageshow`/`freeze`→`resume` reconnects or marks reconnecting when offline | `src/app/connectPageLifecycle.ts:67` (auto) | MISSING | ports only hook `visibilitychange` (`ports.js:5758`); no `pageshow`/`resume`/`online` | restored-from-bfcache tab keeps a dead socket until WS close fires |
| A2 | Auto-reconnect countdown (`setReconnectIn`) | `store.ts:782` (auto) | FULL | `App.elm:10279` `scheduleReconnect`; "Retrying in Ns" `App.elm:16901` | |
| A3 | Dismiss session-reclaim banner | `src/shell/SessionReclaimBanner.tsx:98` (UI) | FULL | `App.elm:41952`, `View/Account2.elm:115` | |
| A4 | Latency ping/pong (`setLatency`) | `store.ts:15513` (auto) | FULL | `App.elm:19652` `foldLatencyPong`, `PingDue` `Main.elm:1650` | state-only on both sides; nothing renders latency |
| A5 | LUSERS server stats (`setServerStats`) | `store.ts:15530` (auto) | FULL | `App.elm:19778` `foldLusers` | state-only on both sides |
| A6 | Retry now (`reconnectNow`) | `src/shell/ReconnectStatusBanner.tsx:131` (UI) | FULL | `App.elm:39392`, `View/Topbar.elm:245` | |
| A7 | Connect (guest / SASL) | `src/app/Connect.tsx:720` (UI) | FULL | `ConnectSubmit` `App.elm:37574`, `View/Connect.elm:68` | Connect page detail mapped elsewhere |
| A8 | Reconnect re-JOIN + replacing NAMES burst, suppressed under `onyx/session-sync` | `store.ts` connect `onConnected` (auto) | FULL | `App.elm:23126` `rejoinLiveChannels` (gate `:23128`) | |
| A9 | Disconnect / leave session | `src/app/Connect.tsx:644`, `src/chat/spotlight/commands.ts:1352`, `SessionReclaimBanner.tsx:88` (UI/palette) | FULL | `SessionDisconnect` `App.elm:37596` via `Nav.YouLeave` `App.elm:44033`, palette `Switcher.Leave` `App.elm:44261` | |
| A10 | Join a room (`joinChannel`) | `src/shell/ChannelSidebar.tsx:484` quick-join field, `ChannelBrowser.tsx:140`, `home/homeController.ts:897` invite accept, spotlight (UI/palette) | PARTIAL | `/join` `App.elm:12981`, `BrowserEnterRoom` `View/Browser.elm:241`, `InviteJoinSubmit` `View/Invite.elm:136` | no sidebar quick-join field; no Home invite-accept row |
| A11 | Create room (`createRoom`) | `src/shell/CreateRoomFormation.tsx:194` (UI) | FULL | `CreateSubmit` `App.elm:39497`, `View/Formation.elm:53` | |
| A12 | Focus composer after create-without-first-line (`clearPendingComposerFocus`) | `src/shell/Composer.tsx:663` (auto) | MISSING | only `PrefsFocus` uses `Browser.Dom.focus` (`Main.elm:1184`) | Low |
| A13 | Deep link `?join=&at=&topic=` (`setPendingDeepLinkJoin`) | `src/app/Connect.tsx:267` (auto) | FULL | `App.elm:15297` `parseDeepLinkJoin`, `:35726` `firePendingDeepLinkJoin` | |
| A14 | Time travel (`travelTo`: vault around + `CHATHISTORY AROUND`) | `src/shell/JumpToDateSheet.tsx:131`, spotlight `:337` (UI/palette) | PARTIAL | `JumpToDateSubmit` `App.elm:38669` → `requestTravelTo` `:35752` | rows fetched, but no scroll/highlight to the landing (see A15) |
| A15 | Land on a message (`focusMessage`) | `src/shell/PinnedMessages.tsx:157`, `RoomMediaIndex.tsx:136`, `search/useMessageSearch.ts:673`, keyboard `useKeyboardShortcuts.ts:331` (UI/shortcut) | CORE-ONLY | `App.elm:13636` writes `historyLanding`; no View/port/anchor reads it (`App.elm:29763` excludes landings) | High: jump/pin/search landings never scroll |
| A16 | Clear landing pulse (`clearTimeTravelLanding`) | `src/shell/MessageView.tsx:1547` (auto) | MISSING | — | no landing pulse exists |
| A17 | Flush offline outbox (`flushOutbox`) | `src/lib/vault/vaultSync.ts:100` (auto), `Composer.tsx:1389`, `home/homeController.ts:969` (UI) | FULL | `OutboxFlushRequest` `App.elm:37284`, `View/Home.elm:254`, `View/Composer.elm:212`; `OutboxRetryFired` `Main.elm:1629` | |
| A18 | Open a queued send in its conversation (`openQueuedSend`) | `src/shell/home/HomeBriefingView.tsx:457` (UI) | MISSING | `View/Home.elm:16` doc: no per-row Open | |
| A19 | Remove one queued send (`discardQueuedSend`) | `src/shell/home/HomeBriefingView.tsx:465` (UI) | PARTIAL | `PrefsOutboxRemove` `View/Prefs.elm:490` | Preferences only; not on Home, no success toast |
| A20 | Open vault search hit (`openVaultResult`) | `src/shell/search/MessageSearch.tsx:879`, spotlight `:511` (UI/palette) | PARTIAL | `VaultOpenHit` `App.elm:36978`, `View/Search.elm:267` | opens conversation; never lands on the hit (A15) |
| A21 | Paint device-memory history (`hydrateHistory`) | `src/lib/vault/vaultSync.ts:331` (auto) | PARTIAL | `VaultRowsReceived` `App.elm:36907` | no "Device memory… while the network catches up" toast (string absent) |
| A22 | Leave room (`partChannel`) | `src/shell/HarborConfirmSheet.tsx:62` from room menu/settings/stewardship/spotlight (UI/palette) | PARTIAL | `/part` `App.elm:12982`; stewardship close `App.elm:21560` | no Leave-room button or confirm sheet |
| A23 | Set topic | `src/shell/ChannelSettings.tsx:211` (UI) | FULL | `RoomSettings.TopicSubmit` `View/RoomSettings.elm:214`; `/topic` `App.elm:12979` | |
| A24 | Channel modes (`setChannelMode`: flags, key, limit) | `ChannelSettings.tsx:400`, `ModerationCockpit.tsx:164`, `lib/rooms/roomStewardshipActions.ts:115` (UI) | FULL | `FlagToggle` `View/RoomSettings.elm:330`, `KeySubmit` `:342`, `LimitSubmit` `:357`, `ModerationDeskToggleMode` `View/Bans.elm:369` | |
| A25 | Kick (`kickMember`) | `ModerationCockpit.tsx:203`, `lib/moderation/applyMemberModeration.ts:11` (UI) | FULL | `ModerationPropose` `View/Profile.elm:778` → `ModerationConfirm` `:956`; `ModerationDeskSubmitMember` `View/Bans.elm:534` | |
| A26 | Ban mask (`banMask`) | `ModerationCockpit.tsx:123` (UI) | FULL | `ModerationDeskSubmitBan` `View/Bans.elm:460`, `BanAddSubmit` `:128` | |
| A27 | Unban mask (`unbanMask`) | `src/shell/moderation/BanListPanel.tsx:153` (UI) | FULL | `UnbanReviewConfirmed` `View/Bans.elm:298` | Elm adds a review step |
| A28 | Invite user (`inviteUser`) | `ModerationCockpit.tsx:171` (UI) | FULL | `ModerationDeskSubmitInvite` `View/Bans.elm:421`; `/invite` `App.elm:12985` | |
| A29 | `setChannelAccess` (bulk commit) | — (DEAD) | N/A | — | access commits via inbound fold |
| A30 | ACCESS LIST refresh (`fetchChannelAccess`) | `ChannelSettings.tsx:513` (UI/auto) | FULL | `RoomSettings.AccessRefresh` `View/RoomSettings.elm:508` | |
| A31 | ACCESS ADD (level, mask, timeout) | `ChannelSettings.tsx:550` (UI) | FULL | `AccessSubmit` `View/RoomSettings.elm:567` | |
| A32 | ACCESS DELETE | `ChannelSettings.tsx:557` (UI) | FULL | `AccessRemove` `View/RoomSettings.elm:560` | |
| A33 | Webhook create | `ChannelSettings.tsx:580` (UI) | FULL | `WebhookCreate` `View/Stewardship.elm:454` | lives in stewardship sheet |
| A34 | Webhook list | `ChannelSettings.tsx:585` (UI) | FULL | `View/Stewardship.elm:461` | |
| A35 | Webhook delete | `ChannelSettings.tsx:593` (UI) | FULL | `View/Stewardship.elm:480` | |
| A36 | Op/deop (`opMember`) | `ModerationCockpit.tsx:213`, `roomStewardshipActions.ts:57` (UI) | FULL | `Moderation.elm:51` Op/Deop via `ModerationPropose`; `StewardAddHelper` | |
| A37 | Voice/devoice (`voiceMember`) | `ModerationCockpit.tsx:219` (UI) | FULL | `Moderation.elm:53` Voice/Devoice | |
| A38 | Network profile (`whois` → `openWhois`) | `src/shell/PeopleProfileCard.tsx:210`, `AppShell.tsx:1233` (UI); `/whois` `store.ts:8507` (slash) | FULL | `MemberCardWhois` `View/Profile.elm:705`; `/whois` `App.elm:14627` | |
| A39 | Close whois sheet | `src/shell/WhoisSheet.tsx:102` (UI) | FULL | `WhoisClose` `View/Profile.elm:48` | |
| A40 | TOTP enroll | `src/app/Account.tsx:894` (UI) | FULL | `TotpEnrollRequested` `View/Account.elm:587` | |
| A41 | TOTP confirm | `Account.tsx:613` (UI) | FULL | `TotpConfirmSubmitted` `View/Account.elm:682` | |
| A42 | TOTP disable | `Account.tsx:977` (UI) | FULL | `View/Account.elm:723` | |
| A43 | TOTP status | `Account.tsx:479` (auto on open) | FULL | `openAccountPanel` `App.elm:26741` | |
| A44 | Recovery codes status | `src/shell/RecoveryCodesSection.tsx:23` (UI/auto) | FULL | `View/Account.elm:1172`, `App.elm:26747` | |
| A45 | Recovery codes generate | `RecoveryCodesSection.tsx:32` (UI) | FULL | `View/Account.elm:1154` | |
| A46 | Recovery codes clear | `RecoveryCodesSection.tsx:37` (UI) | FULL | `View/Account.elm:1180` | |
| A47 | Sign in with a recovery code | `src/app/Connect.tsx:782` (UI) | FULL | `ConnectRecoveryToggle` `View/Connect.elm:213`; `App.elm:24718` | |
| A48 | Dismiss fresh codes | `RecoveryCodesSection.tsx:178` (UI) | FULL | `View/Account.elm:1277` | |
| A49 | VHOST list | `Account.tsx:482` (auto) | FULL | `App.elm:26756` | |
| A50 | VHOST use | `Account.tsx:1174` (UI) | FULL | `View/Account.elm:924` | |
| A51 | VHOST claim | `Account.tsx:1205` (UI) | FULL | `View/Account.elm:943` | |
| A52 | VHOST off | `Account.tsx:1182` (UI) | FULL | `View/Account.elm:904` | |
| A53 | Server history search | `src/shell/search/useMessageSearch.ts:414` (UI) | FULL | `SearchRunServer` `View/Search.elm:77` | |
| A54 | Clear settled server search on close | `useMessageSearch.ts:261` (auto) | PARTIAL | `SearchClose` `App.elm:39556` | settled server results survive close/reopen |
| A55 | Navigate (mark read, divider, MARKREAD, roster refresh, DM MONITOR + dm-key GET, memo clear) | ChannelSidebar/spotlight/etc. (UI) | FULL | `ChannelSelect` `View/Rail.elm:369` → `App.elm:35633` | |
| A56 | Send: plain + labeled optimistic echo | `src/shell/Composer.tsx:1154` (UI) | FULL | `ComposerSend` `App.elm:38958`, `View/Composer.elm:68` | |
| A57 | Send: offline queue + pending placeholder | `store.ts:8052` (UI) | FULL | `OutboxQueued` `App.elm:37055` | |
| A58 | Send: refuse to queue E2EE DM / required room | `store.ts:8066`, `:8074` (UI) | FULL | `App.elm:8643`, `:8646` | |
| A59 | Send: E2EE DM seal, fail-closed | `store.ts:5837` (UI) | FULL | `DmSealed` `App.elm:42881` (`Main.elm:1699`) | |
| A60 | Send: required-room ONYXROOM1 seal | `store.ts:5844` (UI) | FULL | `RoomSealed` `App.elm:43095` | |
| A61 | Send: reply tag only for same target | `store.ts:5775` (UI) | FULL | `replyTagFor` `App.elm:7798` | |
| A62 | Send: multiline batches | `store.ts:6046` (UI) | FULL | `Multiline.planMultilineBatches` `App.elm:10626` | |
| A63 | `sendRaw` store action | — (DEAD; callers use `client.sendRaw`) | N/A | — | |
| A64 | REGISTER (`registerAccount`) | `src/app/Connect.tsx:822`, `GuestClaimPrompt.tsx:303` (UI) | FULL | `GuestClaimSubmit` `View/GuestClaim.elm:177`; Connect register → `App.elm:24759` | |
| A65 | VERIFY (`verifyAccount`) | `Connect.tsx:846`, `GuestClaimPrompt.tsx:329` (UI) | FULL | `GuestClaimVerifySubmit` `View/GuestClaim.elm:245` | Connect register routes through claim sheet |
| A66 | IDENTIFY after VERIFY (`identify`) | `src/shell/GuestClaimPrompt.tsx:250` (auto) | FULL | `chainClaimIdentify` `App.elm:24911` | |
| A67 | Register passkey | `src/shell/PasskeysSection.tsx:146` (UI) | FULL | `PasskeyRegisterSubmitted` `View/Account.elm:1318` | |
| A68 | Sign in with passkey (`WEBAUTHN AUTH`) | `src/app/Connect.tsx:925` (DEAD: gated off by `PRESENT_PASSKEY_SIGNIN = false`, `Connect.tsx:105`) | N/A | `Passkey.webauthnAuth` `Passkey.elm:336` never sent; finish fold `App.elm:42864`; no Connect control | coordinator correction: Solid never presents this control; parity holds, future work only |
| A69 | List passkeys | `PasskeysSection.tsx:125` (UI/auto) | FULL | `View/Account.elm:1388`; open refresh `App.elm:26750` | |
| A70 | Remove passkey | `PasskeysSection.tsx:166` (UI) | FULL | `PasskeyRemoveConfirmed` `View/Account.elm:1487` | |
| A71 | Rename passkey | `PasskeysSection.tsx:160` (UI) | FULL | `PasskeyRenameSubmitted` `View/Account.elm:1514` | |
| A72 | Dismiss passkey message | `src/app/Connect.tsx:867` (DEAD with A68) | N/A | — | tied to A68 (coordinator correction) |
| A73 | Sign out (`LOGOUT`) | `src/app/Account.tsx:618` (UI) | FULL | `SessionLogoutRequested` `View/Account.elm:263`; `App.elm:26684` | |
| A74 | ACCOUNTINFO on open | `Account.tsx:478` (auto) | FULL | `App.elm:26730` | |
| A75 | SESSION LIST | `src/shell/SessionsDevicesSection.tsx:36` (UI/auto) | FULL | `SessionListRequested` `View/Account.elm:189` | |
| A76 | Oper event replay | `src/shell/OperEventConsole.tsx:75` (UI) | FULL | `OperEventReplayRequested` `View/ModDesk.elm:488` | |
| A77 | Drop session + revoke others | `SessionsDevicesSection.tsx:45`, `:58` (UI) | FULL | `View/Account.elm:246`, `View/Account2.elm:159` | |
| A78 | ACCOUNTSET email / password | `Account.tsx:507`, `:556` (UI) | FULL | `View/Account.elm:993`, `:1051` | |
| A79 | ACCOUNTSET secure / enforce toggles | `Account.tsx:573` (UI) | MISSING | `View/Account.elm:132` read-only facts | |
| A80 | Recover a name (`RECOVER`) | `src/app/Account.tsx:582` (UI) | MISSING | `Services.recover` `Services.elm:920` has no caller | |
| A81 | Delete account (`DROP`) | `src/app/AccountDataVerbs.tsx:119` (UI) | FULL | `DropSubmitted` `View/Account.elm:1618` | |
| A82 | GHOST nick holder | `src/app/Connect.tsx:945` (UI, connect page) | FULL | `ReclaimSubmit` `View/Topbar.elm:200` → `App.elm:24187` | Elm: in-session dialog, GHOST+NICK+retry |
| A83 | `reclaimNick` | — (DEAD) | N/A | — | Elm ships it as A82 |
| A84 | CERTADD | `Account.tsx:596` (UI) | FULL | `CertBindRequested` `View/Account.elm:754` | |
| A85 | CERTLIST | `Account.tsx:597` (auto after add/del) | FULL | `App.elm:37963` | |
| A86 | CERTDEL | `Account.tsx:604` (UI) | FULL | `CertRemoveSubmitted` `View/Account.elm:762` | |
| A87 | E2EEKEY STATUS | `Account.tsx:480` (auto) | FULL | open refresh `App.elm:26753` | |
| A88 | E2EEKEY LIST | `Account.tsx:1126` (UI) | FULL | `View/Account.elm:858` | |
| A89 | E2EEKEY ADD (publish device key) | `Account.tsx:533` (UI) | FULL | `E2eeKeyPublishRequested` `View/Account.elm:844` | |
| A90 | E2EEKEY DEL legacy | `Account.tsx:1133` (UI) | FULL | `View/Account.elm:865` | |
| A91 | KEYTRANS STATUS | `Account.tsx:481`, `:1137` (auto/UI) | FULL | `KeytransStatusRequested` `View/Account.elm:812` | |
| A92 | KEYTRANS PROOF | — (DEAD) | N/A | `App.elm:26051` unused | |
| A93 | History on join of empty room (`requestHistory`) | `store.ts:11938` (auto) | FULL | `requestJoinHistory` `App.elm:23583` | |
| A94 | Toggle member list | `src/shell/PresenceRibbon.tsx:493`, keyboard `useKeyboardShortcuts.ts:572`, spotlight `:1256` (UI/shortcut/palette) | PARTIAL | `View/Roster.elm` `membersToggle` (popover under 1100px) | cannot hide on wide; no shortcut/palette entry |
| A95 | `openSettings`/`closeSettings` | — (DEAD) | N/A | — | |
| A96 | Open/close account panel | `src/shell/YouHubNav.tsx:24`, `AppShell.tsx:1029`, keyboard `:589` (UI/shortcut) | FULL | `YouHubGo` `View/Nav.elm:386`, `SetAccountOpen` `View/Account.elm:38` | no account shortcut |
| A97 | Open/close appearance | `src/app/YouSettings.tsx:139`, spotlight `:1232` (UI/palette) | FULL | `/appearance` via `YouHubGo`; palette `Switcher.elm:121` | |
| A98 | Set background | `src/shell/AppearancePanel.tsx:57`, `theme/ThemeStudio.tsx:1180`, spotlight `:1109` | FULL | `AppearanceApplyBackground` `View/Appearance.elm:298`, `StudioApplyBackground` `View/Studio.elm:779` | no palette command |
| A99 | Mark read (+ MARKREAD) | navigate, spotlight `:409`, `lib/catchup/markCaughtUp.ts:8` (UI/palette) | FULL | `App.elm:30949`; `HomeMarkAllCaughtUp` `View/Home.elm:154`; `/read` `App.elm:14609` | |
| A100 | Clear local scrollback | `/clear` `store.ts:8139` (slash) | FULL | `App.elm:14553` | |
| A101 | Add inbox notification | `Account.tsx:567`, inbound (auto) | FULL | `addNotification` `App.elm:18547`; `View/Inbox.elm` | |
| A102 | Dismiss notification | `src/shell/NotificationCenter.tsx:158` (UI) | FULL | `NotificationDismissed` `View/Inbox.elm:237` | |
| A103 | Mark notification read (on open) | `NotificationCenter.tsx:177` (UI) | FULL | `NotificationActivated` `View/Inbox.elm:204` | |
| A104 | Mark all notifications read | `NotificationCenter.tsx:293` (UI) | FULL | `NotificationsMarkedRead` `View/Inbox.elm:109` | |
| A105 | `open/closeNotificationCenter` store pair | — (DEAD; center uses local state) | N/A | `View/Inbox.elm:52` | |
| A106 | Toasts (`addToast`) | 48 callers (auto) but nothing renders `s.toasts` and `<Toaster>` is unmounted | FULL | `addToast` `App.elm:10468`; `View/Toast.elm` | Elm better: Solid store toasts are invisible |
| A107 | `dismissToast` (store) | — (DEAD; primitives has its own) | N/A | `ToastDismiss` `View/Toast.elm:73` | |
| A108 | Voice mute/deafen/output (`setVoiceCallState`) | `src/media/useCadenceMedia.ts:207`, VoiceBar (UI/auto) | FULL | `CallToggleMute` `View/CallStage.elm:415`, `CallToggleDeafen` `:576`, `VoiceSettingsMsg` | |
| A109 | Screen share start/stop | `src/shell/voice/VoiceBar.tsx:1067`, `:1077` (UI) | FULL | `CallToggleShare` `View/CallStage.elm:532` | |
| A110 | Peer speaking/muted | `store.ts:11139`, `:11145` (auto) | FULL | `CallPeerState` `Main.elm:1666` | |
| A111 | Reply to message (`setReplyingTo`) | `message/MessageMenu.tsx:349`, swipe `MessageView.tsx:2216`, thread `:1573` (UI) | PARTIAL | `ReplyArm` `View/Thread.elm:429`, `ReplyCancel` `View/Composer.elm:248` | no touch swipe-to-reply |
| A112 | Per-target composer drafts (get/set/clear) | `Composer.tsx:283`, `:709`, `:1144` (UI) | PARTIAL | `App.elm:7740`–`7793` in-memory swap | no device persistence; lost on reload |
| A113 | Draft save receipt ("Saved here / Only on this tab") | `Composer.tsx:284`, `:1365` (UI) | MISSING | — | |
| A114 | Inject composer text (quote, mention, report) | `MessageMenu.tsx:810`, `PeopleProfileCard.tsx:178`, `people/PersonSafetySheet.tsx:113` (UI) | FULL | `MessageQuote` `View/Thread.elm:1653`, `MemberMention` `View/Profile.elm:571` | |
| A115 | Edit own message (arm) | `MessageMenu.tsx:374` (UI) | FULL | `EditArm` `View/Thread.elm:1735`, `EditCancel` `View/Composer.elm:243` | |
| A116 | Open conversation (+topic) | `lib/notifications/NotificationRuntime.tsx:60` desktop click, `NotificationCenter.tsx:180`, `ChannelBrowser.tsx:122` (UI/auto) | PARTIAL | `ChannelSelect`/`NotificationActivated`/`BrowserEnterRoom`; desktop `note.onclick` only focuses (`ports.js:5706`) | desktop notification click doesn't open the conversation |
| A117 | Reconcile topic unread | `lib/topics/TopicReadRuntime.tsx:66` (auto) | FULL | `App.elm:35439` | |
| A118 | Select topic / start topic | `MessageView.tsx:1626`, `MessageMenu.tsx:367` (UI) | FULL | `ChannelTopicSelect` `View/Thread.elm:898`, `MessageStartTopic` `:1726` | |
| A119 | `splitTopicIntoThread` | — (DEAD) | N/A | — | |
| A120 | Boost / react (`addReaction` → `addLocalReaction` fallback) | `MessageView.tsx:2199`, `MessageMenu.tsx:342` (UI) | FULL | `ReactionSend` `View/Thread.elm:2244`, `ReactionPickerChoose` `:2099`; `App.elm:6807` | |
| A121 | Inbound unreact (`removeReaction`) | `store.ts:13598` (auto) | FULL | `foldTagmsgReact` | |
| A122 | Edit send (`EDIT`) + history | `Composer.tsx:1190` (UI) | FULL | `requestEdit` `App.elm:8100` via `:38977` | |
| A123 | Delete (`REDACT`) | `MessageMenu.tsx:524` (UI) | FULL | `MessageMenuDeleteAsk` `View/Thread.elm:1840` → `requestDelete` `App.elm:8154` | |
| A124 | Inbound typing (`setTyping`; `_setTyping` alias DEAD) | `store.ts:13526` (auto) | FULL | `App.elm:6329`, `:6532` | |
| A125 | Send typing start | `Composer.tsx:781` (UI) | FULL | `ComposerInput` → `sendTyping` `App.elm:38319` | |
| A126 | Send typing done | `Composer.tsx:783`, `:1142` (UI) | FULL | `App.elm:10596` | |
| A127 | `open/close ChannelInfo`, `ServerSettings`, `AccessList` | — (DEAD) | N/A | — | |
| A128 | Open/close pinned drawer | `PresenceRibbon.tsx:1286`, `PinnedMessages.tsx:166` (UI) | FULL | `PinnedMessagesOpen` `View/RoomHeader.elm:325`, close `View/Pins.elm:24` | |
| A129 | Fetch unloaded pin (`requestPinnedMessage`) | `PinnedMessages.tsx:161` (UI) | FULL | `PinnedMessageJump` `View/Pins.elm:168` → `App.elm:13646` | loaded pins still don't land (A15) |
| A130 | Open/close jump-to-date | `PresenceRibbon.tsx:595`, `Composer.tsx:501`, keyboard `:365`, spotlight `:1300` | FULL | `JumpToDateOpen` `View/RoomHeader.elm:365`, palette `Switcher.elm:119` | no dedicated shortcut |
| A131 | Pin message | `MessageMenu.tsx:563` (UI) | FULL | `MessagePinToggle` `View/Thread.elm:1761` → `App.elm:13579` | |
| A132 | Unpin message | `PinnedMessages.tsx:171`, `MessageMenu.tsx:562` (UI) | FULL | `PinnedMessageUnpin` `View/Pins.elm:199` | |
| A133 | `_writePins` / `_writeChannelProp` | internal | FULL | `writeChannelProp` `App.elm:13501` | |
| A134 | Schedule room event | `/event` `store.ts:8134` (slash) | FULL | `/event` `App.elm:14990` → `:13797` | |
| A135 | Clear room event | `src/shell/ScheduledEventLine.tsx:80` (UI) | FULL | `RoomSettings.EventClear` `View/RoomSettings.elm:970`; `App.elm:13827` | |
| A136 | Ephemeral retention | `ChannelSettings.tsx:457` (UI) | FULL | `EphemeralSubmit` `View/RoomSettings.elm:394` | |
| A137 | Encryption policy | `ChannelSettings.tsx:476` (UI) | FULL | `EncryptionSubmit` `View/RoomSettings.elm:675` | |
| A138 | History policy | `ChannelSettings.tsx:495` (UI) | FULL | `HistorySubmit` `View/RoomSettings.elm:715` | |
| A139 | PROP fetch on join | `store.ts:11930` (auto) | FULL | `App.elm:23259` | |
| A140 | `requestUserProps` | — (DEAD) | N/A | — | |
| A141 | MONITOR on DM open (`monitorAdd`) | `store.ts:8035` (auto) | FULL | `monitorAddContact` `App.elm:25365` | |
| A142 | `addFriend`/`removeFriend` | — (DEAD) | N/A | `PeopleFriendAdd` `View/Account2.elm:654` | Elm better |
| A143 | `setFriendOnline` | `store.ts:13940` (auto; no friend UI) | N/A | `App.elm:25580`; presence `View/Rail.elm:507` | Elm better |
| A144 | `setUserStatus` (AWAY) | — (DEAD) | N/A | `UserStatusSet` `View/Account2.elm:553` | Elm better |
| A145 | Custom status + expiry + dialog | — (DEAD) | N/A | `StatusEditSave` `View/Account2.elm:502`, `StatusExpiryChoose` `:519` | Elm better |
| A146 | `setUserActivity`/`clearUserActivity` | — (DEAD) | N/A | — | |
| A147 | `openUserProfile`/`openUserProfileCard` pairs | — (DEAD; card uses local state) | N/A | `UserProfileOpened` `View/Roster.elm:309` | |
| A148 | Mute / unmute room | `PresenceRibbon.tsx:1124`, keyboard `useKeyboardShortcuts.ts:464` (UI/shortcut) | PARTIAL | `RoomNotifyLevel` `View/Notify.elm:92`; `/mute` `App.elm:14703` | no room-mute shortcut (chord given to mic) |
| A149 | Notify mode all/mentions/mute (`setChannelNotifyMode`) | `src/shell/ChannelNotifyControl.tsx:76`, `ChannelSettings.tsx:394` (UI) | FULL | `RoomNotifyLevel` `View/RoomSettings.elm:291`; `/notify` `App.elm:14771` | |
| A150 | `channelNotifyMode`/`shouldNotify` store selectors | — (DEAD; lib fns used) | N/A | — | |
| A151 | Thread store actions (`openThread`, close, seen, archive…) | — (DEAD; MessageView keeps local thread state) | N/A | `ThreadOpen` `View/Thread.elm:430` | |
| A152 | Forwarding, bookmarks, search overlay | — (DEAD) | N/A | — | |
| A153 | Open/close keyboard shortcuts | spotlight `:1082`, keyboard `:428`, `homeController.ts:859`, `AppShell.tsx:1732` | FULL | `ShortcutPressed` `Main.elm:1615`; `ShortcutsClose` `View/Switcher.elm:282` | |
| A154 | Capture unread divider | navigate (auto), spotlight `:406` | FULL | `App.elm:30663` | |
| A155 | Clear divider after review (`clearViewUnreadDivider`) | `MessageView.tsx:1431` (UI) | MISSING | — | no since-digest review flow |
| A156 | `markFirstUnread`/`forceMarkFirstUnread` | — (DEAD) | N/A | — | |
| A157 | `clearFirstUnread` | navigate (auto) | FULL | `App.elm:30944` | |
| A158 | Open room browser | `ChannelSidebar.tsx:826`, spotlight `:1200`, `homeController.ts:837` | FULL | `BrowserOpen` `View/Rail.elm:146`, `View/Home.elm:304` | |
| A159 | Open create room | `ChannelSidebar.tsx:834`, `ChannelBrowser.tsx:73`, `HomeBriefingView.tsx:283` | FULL | `CreateRoomOpen` `View/Rail.elm:155` | |
| A160 | Close room browser | `ChannelBrowser.tsx:72` (UI) | FULL | `BrowserClose` `View/Browser.elm:53` | |
| A161 | LIST refresh | `ChannelBrowser.tsx:210` (UI/auto) | FULL | `RefreshChannelList` `View/Browser.elm:96` | |
| A162 | `addAuditEntry` | `store.ts:11894` (auto; never rendered) | N/A | `App.elm:18218` (also unrendered) | |
| A163 | History loading / exhausted flags | internal (auto) | FULL | `markHistoryExhausted` `App.elm:32761` | |
| A164 | `loadHistory` on self-JOIN | `store.ts:11548` (auto) | FULL | `App.elm:23583` | |
| A165 | Raw log (toggle/add/enable/clear) | — (DEAD; never enabled) | N/A | — | |
| A166 | `openMessageSearch`/`closeMessageSearch`/`searchMessages` store actions | — (DEAD; `useMessageSearch` signals) | N/A | `SearchOpen` `View/RoomHeader.elm:208` | |
| A167 | MOTD close, server-rules modal | — (DEAD) | N/A | — | |
| A168 | Mobile sidebar open/close | `src/shell/AppShell.tsx:899`, `:908` (UI) | FULL | `NavSelect` `View/Nav.elm:195` | section pages, not a drawer |
| A169 | `open/close/toggleSpotlight` store actions | — (DEAD; `useSpotlight` signals) | N/A | `PaletteOpen` `View/Switcher.elm:52` | |
| A170 | Set theme | `src/app/Appearance.tsx:160`, `theme/ThemeStudio.tsx:605` (UI) | FULL | `AppearanceSetTheme` `View/Appearance.elm:330`, `View/Studio.elm:41` | |
| A171 | Theme modal, `setMessageDensity` | — (DEAD; density is a pref) | N/A | — | |
| A172 | Join-refusal prompt (set/clear) | `store.ts:15031` (auto), `ChannelBrowser.tsx:129` (UI) | FULL | `App.elm:10210`, `:10225`; browser settle `:16753` | |
| A173 | Media gallery, services panel, clear service notices | — (DEAD) | N/A | `MediaIndexOpen` `View/RoomHeader.elm:350` | |
| A174 | Service notices in Account/oper/webhooks | `store.ts:12339` (auto); shown `Account.tsx:463` | FULL | `accountCertNotices`/`webhookNotices` (App exports) | |
| A175 | Server log "Activity" view (`addServerLog`) | `store.ts:6621` (auto); `ChannelSidebar.tsx:731` + `MessageView.tsx:890` (UI) | CORE-ONLY | `serviceLog` `App.elm:8656`; no View reads it | disconnect/oper/numeric lines invisible |
| A176 | `clearServerLog`, pin/follow channel toggles | — (DEAD) | N/A | — | |
| A177 | Block (ignore) user | `IgnoredUsersControl.tsx:52`, `MessageMenu.tsx:933`, `PersonSafetySheet.tsx:72` (UI) | FULL | `IgnoreUser` `View/Thread.elm:1797` | |
| A178 | Unblock user | `IgnoredUsersControl.tsx:63`, `PeopleProfileCard.tsx:254` (UI) | FULL | `UnignoreUser` `View/Notify.elm:499`, `View/Profile.elm:580` | |
| A179 | `isIgnored` selector | `PeopleProfileCard.tsx:73` (UI) | FULL | ignore set reads in Profile view | |
| A180 | Ignore-list modal, soft-ignore, reveal | — (DEAD) | N/A | `OverrideToggleSoftIgnore` `App.elm:42537` (no view) | |
| A181 | Collapse a sender (`toggleNickCollapse`) | `MessageMenu.tsx:965` (UI) | FULL | `MessageCollapseToggle` `View/Thread.elm:1827` | |
| A182 | Expand collapsed senders ("Show all" banner) | `MessageView.tsx:1975` (UI) | MISSING | rows filtered `View/Thread.elm:1352`; no banner | collapse can only be undone from a hidden row |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- `COVERAGE.md:88`: "`?at=` time-travel AROUND (`App.requestTravelTo` + vault-around + landing)" is marked **done**. Nothing reads the landing. `historyLanding` is set at `App.elm:13638` and `:43955`, and no View or port reads it. `threadAnchorIndex` (`App.elm:29763`) explicitly leaves landings out.
- `COVERAGE.md:108`: "`jumpToPinned` focuses loaded rows via `historyLanding`". The same write-only field, so nothing scrolls and nothing pulses.
- `COVERAGE.md:174`: "WEBAUTHN REGISTER/AUTH exchanges … **done**" overstates AUTH. `Passkey.webauthnAuth` (`Passkey.elm:336`) has no caller, so AUTH is core-only. Solid also hides passkey sign-in (`PRESENT_PASSKEY_SIGNIN = false`, `Connect.tsx:105`), so this is not a parity gap.
- `COVERAGE.md:137`: "RECOVER/RELEASE reclaim (`Services.recover`/`release`, `App.ghostNick`…) **done**". `Services.recover`, `Services.releaseNick` and `App.ghostNick` (`App.elm:28418`) have no callers. Only `reclaimNickWithPassword` (GHOST+NICK) is reachable.
- `COVERAGE.md:213`: Preferences lists "Local drafts" as if they are stored on the device. Elm drafts live only in `composerDrafts` in memory. No port saves them, so a reload loses them.

#### Elm better than Solid
- Toasts render: `View/Toast.elm`, with undo through `ToastUndoFired`. Solid's ~48 `addToast` calls never reach the screen. Nothing reads `s.toasts`, and the primitives `<Toaster>` is only mounted in tests.
- Friends and watch list: `PeopleFriendAdd`/`PeopleWatchAdd` (`View/Account2.elm:654`, `:714`) and rail presence (`View/Rail.elm:507`). Solid `addFriend`/`removeFriend` are DEAD.
- AWAY status and custom status with expiry: `UserStatusSet`, `StatusEditSave` (`View/Account2.elm:553`, `:502`). Solid `setUserStatus`/`setCustomStatus` are DEAD.
- Nick reclaim works during a session, not only on the connect page: `ReclaimSubmit` does GHOST+NICK with a 30s retry (`App.elm:24187`). Solid's `reclaimNick` is DEAD.
- Unban asks for review first (`UnbanReviewConfirmed`, `View/Bans.elm:298`).

#### Gaps (ranked by user impact)
- `[High]` Message landing (A14/A15/A20/A129): use `historyLanding` in `threadAnchorIndex` and add a `TranscriptScroll {action="message"}` path in `ports.js:3389` that scrolls to the row and pulses it. Clear it afterwards (A16).
- `[High]` Leave room (A22): add "Leave room" to the RoomHeader room menu and a confirm sheet (new `RoomLeaveAsk`/`RoomLeaveConfirm` Msg) that sends PART and shows a toast.
- `[Med]` Activity/server log view (A175): add a Rail "Activity" entry and a read-only transcript over `model.serviceLog`.
- `[Med]` Desktop notification click (A116): have `ports.js:5706` send the target back (new `NotifyClicked` port), then dispatch `ChannelSelect` or the topic open.
- `[Med]` Persist composer drafts per owner (A112/A113): add a `DraftsSave` Outbound and port to localStorage, load at boot, and show a receipt line in `View/Composer.elm`.
- `[Med]` Expand collapsed senders (A182): show a "N people collapsed · Show all" banner in `View/Thread.elm` that clears `collapsedNicks`.
- `[Med]` Recover a name (A80) and ACCOUNTSET secure/enforce toggles (A79): add `View/Account.elm` forms that send `Services.recover` and `ACCOUNTSET` with the password.
- `[Med]` Page-lifecycle reconnect (A1): in `ports.js`, listen for `pageshow` (persisted), `resume` and `online`, and dispatch `ReconnectNow` or an offline mark.
- `[Low]` Passkey sign-in (A68/A72): Solid gates it off (`Connect.tsx:105`), so this is future work, not parity. When the product turns it on, add a Connect "Use a passkey" button that sends `Passkey.webauthnAuth`.
- `[Low]` Home queued-send Open/Remove (A18/A19): add per-row buttons to `View/Home.elm` that reuse `PrefsOutboxRemove` and a new open-placeholder Msg.
- `[Low]` Member list hide on wide layouts, plus shortcut and palette entries (A94). Swipe-to-reply (A111). Room-mute shortcut (A148). Sidebar quick-join (A10). Clear settled server search on close (A54). Composer focus after create (A12). "Device memory" toast (A21).

### B — Store actions II — stage, away, oper, scheduling, prefs, folders, identity, E2EE keys, calls, legacy
Walked every action in `src/lib/store/store.ts` 15569–18340 (plus the window event bridge at 18366–18381 and the slash verbs at 8205–8530 that call them). Reachability came from `grep -w` over `src/` (non-test, outside store.ts) plus store-internal callers. A legacy state field with no non-store reader counts as write-only (dead), even when an inbound fold writes it. On the Elm side I checked the `App.elm` Msg folds, the `View/*.elm` dispatchers, `Main.elm`, `ports.js`, `index.html`, `Stage.elm`, `Switcher.elm`, `Sidebar.elm` and `Prefs.elm`. Many actions in this region are dead legacy; they're listed as N/A so the whole region is accounted for.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| B1 | joinStage — join a live stage as audience (JOIN if not member) | `src/shell/StagePanel.tsx:82` (UI), store:15569 | FULL | `App.elm:45240` `StageJoinAudience`, `View/StageMode.elm:419`, `Stage.elm:231` | — |
| B2 | leaveStage — PART "Left stage" + reset | `StagePanel.tsx:157` (UI), store:15587 | FULL | `App.elm:45252`, `View/StageMode.elm:237`, `Stage.elm:272` | Also bound to the C12 call chord |
| B3 | raiseHand / lowerHand (CTCP STAGE RAISE_HAND/LOWER_HAND) | `StagePanel.tsx:170` (UI), store:15599/15605 | FULL | `App.elm:45256` `StageHandToggle`, `View/StageMode.elm:207`, `Stage.elm:285` | Speakers can't raise (same as Solid) |
| B4 | inviteToSpeak (host → CTCP INVITE_SPEAK) | `StagePanel.tsx:219` (UI), store:15611 | FULL | `App.elm:45263` `StageInvite`, `View/StageMode.elm:287` | Elm records the invite so only its answer earns +v |
| B5 | moveToAudience (CTCP MOVE_AUDIENCE) | DEAD, store:15616 | N/A | no Elm builder (`Stage.elm` has none) | No caller in Solid |
| B6 | acceptSpeakInvite / declineSpeakInvite | `StagePanel.tsx:190/199` (UI), store:15621/15627 | FULL | `App.elm:45278/45285`, `View/StageMode.elm:456/457` | `role=alert` invite strip |
| B7 | grantSpeaker / revokeSpeaker (MODE ±v) | DEAD, store:15632/15637 | N/A | auto +v for an invited ACCEPT_SPEAK at `Stage.elm:432` | Solid exposes no manual grant/revoke UI |
| B8 | startStage (MODE +m + PROP STAGE 1; host) | `StagePanel.tsx:73` (UI, ops strip), store:15642 | FULL | `App.elm:45220` (live + `isChannelOp`), `View/StageMode.elm:414`, `Stage.elm:247` | — |
| B9 | endStage (MODE -m + PROP STAGE 0) | `StagePanel.tsx:77` (UI), store:15657 | FULL | `App.elm:45232`, `View/StageMode.elm:260`, `Stage.elm:259` | — |
| B10 | addRaisedHand / removeRaisedHand (inbound queue, 128 cap) | auto (store:12621/12638) | FULL | `Stage.elm:171/189`, `Stage.elm:53` cap; `App.elm:45273` `StageDismissHand`, `View/StageMode.elm:293/473` | Elm adds a host Dismiss button and a 375px hands sheet |
| B11 | openAwayModal / closeAwayModal | DEAD, store:15692 | N/A | — | No away modal in Solid |
| B12 | setAway(message) — custom away text | palette `src/chat/spotlight/commands.ts:887` (palette), store:15694 | PARTIAL | `App.elm:12989` `/away` → raw `sendRawSlashCommand` `App.elm:11164`; presets `App.elm:19562`, `View/Account2.elm:553` | `/away gone to lunch` splits on spaces; the server keeps only params[0] (`server.zig:43292`). No palette `away <msg>` |
| B13 | unsetAway — clear away | palette `commands.ts:899` (palette), store:15698 | PARTIAL | `View/Account2.elm:553` presence Online → `AWAY` `App.elm:19574`; `/back` listed `App.elm:12990` | `/back` and `/unaway` are sent raw as `BACK`, which the server doesn't know (true of both clients). No palette "back" |
| B14 | setIdleAwayMinutes + idle auto-away | DEAD: no setter caller, and `idleAwayMinutes` is never read (store:15702, 5151) | N/A | no idle detector in `App.elm`/`ports.js` | Neither client auto-aways. Solid only persists `onyx:idle-away-minutes` (default 15). See gaps |
| B15 | isAway / awayMessage self state | setAway writes it optimistically; no reader besides WHOIS | FULL | `App.elm:5540/5543` 305/306 fold | Elm tracks the server's answer, not an optimistic flag |
| B16 | openOperPanel / closeOperPanel | DEAD (the desk renders inline when `isOper`, `src/shell/AppShell.tsx:1625`) | N/A | `View/ModDesk.elm:87` → `App.elm:42493` `OperDeskOpen` | Elm opens it from a topbar Operator sheet instead of inline |
| B17 | operLogin (OPER) | DEAD, store:15717 (only adds a "SASL grants oper" note) | N/A | — | No OPER verb by design |
| B18 | operAction choke point (desk + oper slash verbs; isOper/connected gate, toasts) | `src/shell/OperDesk.tsx:91` (UI); slash store:8525 | FULL | `App.elm:42510/42513`, `View/ModDesk.elm:192/432`, `App.elm:14284` `runSlashOper`, refusal `App.elm:17652` | Destructive plans are staged behind a review step |
| B19 | scheduleMessage from the composer (Send later) | `src/shell/Composer.tsx:568` (UI), store:15761 | FULL | `View/Composer.elm:552/574` → `App.elm:11984` `requestScheduleMessage` | Lives in the Polish tray; presets + custom time |
| B20 | Schedule refusals: required-E2EE room / designated E2EE DM | store:15762/15778 (UI) | FULL | `App.elm:11989`, `App.elm:12003` | Elm also holds a DM until its key lookup resolves (`App.elm:12248`) |
| B21 | Palette grammar `schedule <text> at <time>` | `commands.ts:812` (palette) | MISSING | `Switcher.elm:233` action list has no schedule entry | — |
| B22 | cancelScheduledMessage (durable cancel + toast) | `src/shell/ScheduledMessagesSheet.tsx:97` (UI), store:15824 | FULL | `View/Scheduled.elm:135` → `App.elm:12138` | — |
| B23 | _dispatchScheduledMessages (tick, post-001 kick, 819 kick, claims, uncertain toasts) | auto store:5011/11322/12004 | FULL | `App.elm:12277` on the 1s Tick `App.elm:37464`; gating `App.elm:12240` | Prop-sync and E2EE holds match Solid |
| B24 | openScheduledMessages / closeScheduledMessages | `Composer.tsx:1695`, palette `commands.ts:1277`, Ctrl+Shift+L (`shortcutsRegistry.ts:126`) | PARTIAL | `View/Composer.elm:562` `ScheduleViewQueue`, `View/Scheduled.elm:42` | No palette "Scheduled messages" entry, no Ctrl+Shift+L |
| B25 | setSoundEnabled | `src/shell/NotificationControls.tsx:328` (UI), store:16179 | FULL | `App.elm:39337`, `View/Notify.elm:240` | — |
| B26 | setSoundVolume | DEAD (the volume is only read, `NotificationRuntime`) | N/A | read at boot `index.html:145`, `Main.elm:949` | Volume is read-only in both clients |
| B27 | setPushNotificationsEnabled | `NotificationControls.tsx:317`, `src/lib/notifications/armClosedTab.ts:27` (UI) | FULL | `App.elm:39330`, `View/Notify.elm:158`; Web Push `View/Account.elm:476` | — |
| B28 | openSoundSettings / closeSoundSettings | DEAD, store:16200 | N/A | — | — |
| B29 | openGroupDM / closeGroupDM | DEAD, store:16205 | N/A | — | — |
| B30 | addAutoJoin / removeAutoJoin (`/autojoin`, `/unautojoin`) | slash store:8264/8271 | PARTIAL | `App.elm:14820/14854` → `App.elm:11611/11628`; boot `index.html:202` | Elm stores the list under an ownerless key and never reads it. Solid feeds Home memory (`src/shell/home/homeController.ts:475`). Neither actually rejoins, despite the toast |
| B31 | starChannel / unstarChannel | `src/shell/ChannelSidebar.tsx:354` (UI), slash store:8222, palette `commands.ts:758/774`, Ctrl+B (`src/lib/keyboard/useKeyboardShortcuts.ts:449`), portable import | PARTIAL | `View/Rail.elm:438` → `App.elm:41787`; `/star` `App.elm:14814`; `App.elm:11532` | No palette star, no Ctrl+B |
| B32 | addCustomEmoji / removeCustomEmoji / custom-emoji modal | DEAD (only a comment in `persistParse.ts`) | N/A | — | No reader renders custom emoji |
| B33 | addRecentEmoji / incrementEmojiUsage | `Composer.tsx:736-737` (auto on insert) | N/A | none in Elm | Write-only in Solid: the picker never reads recents or counts, so it's effectively dead |
| B34 | setEmojiSkinTone | DEAD, store:16307 | N/A | — | — |
| B35 | setFavoriteEmojis | DEAD, store:17077 | N/A | — | — |
| B36 | openModerationPanel / closeModerationPanel | DEAD (cockpit inline, `AppShell.tsx:1622`) | N/A | `View/ModDesk.elm:62` → `App.elm:42475` | Elm uses an op-gated sheet |
| B37 | addModerationEntry → cockpit "Server activity" | auto store:11901/13328; reader `src/shell/ModerationCockpit.tsx:121` | FULL | `App.elm:18238`, `View/Bans.elm:552` | — |
| B38 | setBanList (368 completion, bounded, ready meta) | auto store:15083 | FULL | `App.elm:18940` | — |
| B39 | fetchBanList (MODE +b, loading/unavailable/error meta) | `src/shell/moderation/BanListPanel.tsx:119/125` (UI) | FULL | `View/Bans.elm:62` → `App.elm:37725`/`19059` | — |
| B40 | tempBan (timed +b with auto-lift and retries) | DEAD, store:16415 (no UI in the cockpit) | N/A | `View/Bans.elm:84/102/128` → `App.elm:20427`, lift `App.elm:20570` | Elm is better: a reachable "Add a timed block" |
| B41 | addHighlightWord / removeHighlightWord | `src/app/KeywordListControl.tsx:31/41` (UI), slash store:8291/8298 | FULL | `View/Notify.elm:362/403`, `App.elm:39317`; `/highlight` `App.elm:14655/14673` | Keyword sort uses codepoint order (COVERAGE narrowing) |
| B42 | openHighlightModal / closeHighlightModal | DEAD, store:16503 | N/A | — | — |
| B43 | setUserNote / getUserNote / deleteUserNote | DEAD, store:16509–16532 | N/A | none | Private notes are never surfaced in Solid |
| B44 | openInviteModal / closeInviteModal | DEAD, store:16546 | N/A | (Elm `InviteShareOpen` is a different surface) | — |
| B45 | setNickColorOverride / clearNickColorOverride | DEAD; `nickColorOverrides` has no reader | N/A | `App.elm:42567/42592` folds with no View dispatcher (CORE-ONLY) | — |
| B46 | setCTCPVersionReply / TimeEnabled / PingEnabled / Enabled | DEAD setters; the persisted config drives auto-replies | N/A | config load `App.elm:37844`, `Main.elm:1646`; replies via `foldCtcpQuery` | Stored config is honoured in both; neither can edit it |
| B47 | addAnnouncement (server NOTICE with no target) | auto store:12210/13088; no reader | N/A | — | Write-only (the panel is dead) |
| B48 | open/closeAnnouncementsPanel, markAnnouncementsRead, clearAnnouncements | DEAD, store:16612–16620 | N/A | — | — |
| B49 | setDndEnabled (manual DND) | `NotificationControls.tsx:347` (UI); palette `commands.ts:875`; Ctrl+Shift+D (`useKeyboardShortcuts.ts:457`); `/dnd` store:8311 | PARTIAL | `View/Notify.elm:294` → `App.elm:39344`; `/dnd` `App.elm:14700` → `14382` | No palette "dnd on/off", no Ctrl+Shift+D |
| B50 | setDndUntil (timed snooze, auto-clear) | `NotificationControls.tsx:343` (UI); palette `mute 30m` `commands.ts:847`; `/snooze` store:8312 | PARTIAL | `View/Notify.elm:305/330` → `App.elm:39358/39361`; `/snooze` `App.elm:14697`; `App.elm:31607` | No palette "mute for N" grammar |
| B51 | setDndQuietHours + isDndActive (daily quiet hours; default 22–08 **on**) | `NotificationControls.tsx:306/311` (UI), `src/shell/PortableIdentitySection.tsx:123`; enforced at `src/lib/notifications/NotificationRuntime.tsx:90` | MISSING | `App.elm:31607` checks only `dndEnabled`/`dndUntil` | Elm alerts overnight where Solid stayed silent by default |
| B52 | openDndModal / closeDndModal | DEAD, store:16668 | N/A | — | — |
| B53 | setTimeFormat | DEAD (replaced by prefs `clock`, `src/lib/prefs/preferences.ts:72`) | N/A | `Prefs.elm:110` `Clock` in the Prefs sheet | The live path belongs to the prefs mapper |
| B54 | setChannelSortOrder | DEAD, store:16683 | N/A | — | — |
| B55 | updateChannelActivity → sidebar stamp, catch-up, quiet activity | auto store:5834/12912; readers `ChannelSidebar.tsx`, `homeController.ts:388/521` | FULL | `Sidebar.elm:36-39` (activity from the newest buffered row) | No separate activity map, by design |
| B56 | openExportModal / closeExportModal | DEAD, store:16694 | N/A | — | — |
| B57 | pinDMMessage / unpinDMMessage / openDMPins / closeDMPins | DEAD, store:16704–16730 | N/A | — | Elm pins are channel pins |
| B58 | muteDM / unmuteDM (+isDMMuted) — "Mute conversation" | `src/shell/PresenceRibbon.tsx:1393/1401` (UI DM menu) | CORE-ONLY | `App.elm:31136/31181` folds; honoured at `App.elm:22872/31509`; no View dispatches `MuteDm` | The DM More menu (`View/RoomHeader.elm:275`) has no Mute item |
| B59 | hideRoom / unhideRoom / isRoomHidden (local hide, never PART) | `src/shell/ChannelSettings.tsx:834/842`, `PresenceRibbon.tsx:1158/1166`, palette `commands.ts:599/621/660` | MISSING | none (`Sidebar.elm:36` narrowing) | — |
| B60 | closeConversation / reopenConversation (auto-reopen on DM view or inbound) | palette `commands.ts:639/651`, `PresenceRibbon.tsx` + `HarborConfirmSheet.tsx:33`; reopen auto store:8027/13061 | MISSING | none (`Sidebar.elm:36`) | Every DM shell stays listed forever |
| B61 | openDMMedia / closeDMMedia | DEAD, store:16815 | N/A | (Elm `MediaIndexOpen` is the room media index) | — |
| B62 | openConnectionProfiles / closeConnectionProfiles | DEAD, store:16820 | N/A | — | — |
| B63 | setCompactSidebar | DEAD, store:16825 | N/A | — | — |
| B64 | setChannelColor / clearChannelColor (`/color #hex\|clear`) | slash store:8360/8368; `channelColors` has no reader | FULL | `App.elm:14888` → `11739/11763`; label at `View/Rail.elm:347` | Elm is better: it renders the label, and `/color clear` works (Solid passes `''`, which `normalizeNickColor` rejects) |
| B65 | setMessageFontSize | DEAD, store:16860 | N/A | — | — |
| B66 | setAccentColor | DEAD, store:16872 | N/A | — | — |
| B67 | setReducedMotion (store) | DEAD (the `VoiceBar.tsx:770` match is a local signal) | N/A | prefs path `PrefsTogglePref` | Live reduce-motion is the prefs one |
| B68 | setChatBackground | DEAD, store:16894 | N/A | — | — |
| B69 | setUiFont | DEAD, store:16906 | N/A | — | — |
| B70 | setBubbleMode | DEAD, store:16918 | N/A | — | — |
| B71 | setSidebarWidth (drag resize) | DEAD, store:16930 | N/A | — | — |
| B72 | setMessageMaxWidth | DEAD, store:16943 | N/A | — | — |
| B73 | setGlassSidebar | DEAD, store:16955 | N/A | — | — |
| B74 | setMemberListSort | DEAD, store:16967 | N/A | — | — |
| B75 | addLatencyReading (60-sample sparkline) | auto store:6456; `latencyHistory` has no reader | N/A | Elm keeps its own history (`maxLatencyHistory`) | Write-only |
| B76 | setConnectedAt | DEAD, store:16978 | N/A | — | — |
| B77 | openServerInfo / closeServerInfo | DEAD, store:16984 | N/A | — | — |
| B78 | setNickAway | DEAD; `awayNicks` has no non-store reader | N/A | `App.elm:17981` away fold (roster marker) | — |
| B79 | toggleFocusMode | palette `commands.ts:910`, but `focusMode` has no reader | N/A | — | No-op in Solid |
| B80 | createFolder | `src/shell/ChannelOrganizationSection.tsx:39` (UI, Account page) | MISSING | none (`View/Rail.elm:11` defers folders) | — |
| B81 | deleteFolder (orphans → first folder) | `ChannelOrganizationSection.tsx:155` (UI) | MISSING | none | — |
| B82 | addChannelToFolder | `ChannelOrganizationSection.tsx:51` (UI) | MISSING | none | — |
| B83 | toggleFolderCollapsed + sidebar folder groups | `ChannelSidebar.tsx:361` (UI) | MISSING | none | — |
| B84 | renameFolder | DEAD, store:17065 | N/A | — | — |
| B85 | setChannelFolders (portable import) | `PortableIdentitySection.tsx:122` (UI) | MISSING | `Account2.elm:466` reports that folders were skipped | Honest refusal copy |
| B86 | openPollCreate / closePollCreate | DEAD, store:17086 | N/A | — | — |
| B87 | openReactionStats / closeReactionStats | DEAD, store:17091 | N/A | — | — |
| B88 | addTopicHistory (TOPIC/332 record, persisted) | auto store:12137 (vault only, no UI reader) | FULL | `App.elm:35126`; `TopicHistoryLoaded` `App.elm:37782` | Elm also uses it for composer topic options (`View/Composer.elm:403`) |
| B89 | markWelcomeSeen | DEAD, store:17107 | N/A | — | — |
| B90 | setSpeakingNick (speaking set, cap) | auto `src/media/useCadenceMedia.ts:266/286/298` | FULL | `Media.elm:124` speaking + `CallMedia` dominant speaker | — |
| B91 | addVoiceChannel / removeVoiceChannel | DEAD, store:17136/17143 | N/A | — | — |
| B92 | addChannelEvent (join/part/quit/kick/mode/nick log) | auto store:11613/11739/13235; `channelEvents` has no reader | N/A | `App.elm:18255` mirror with no View (CORE-ONLY) | Write-only |
| B93 | clearChannelEvents / open/closeEventLog / toggleEventFilter | DEAD, store:17168–17178 | N/A | — | — |
| B94 | addJoinHistory → Home "recent rooms" + Home memory | auto store:11539; readers `homeController.ts:268/472/475` | MISSING | none (`requestJoinHistory` is CHATHISTORY, unrelated) | Home loses the rooms you recently left |
| B95 | setNickAliases (editor) + 433 alias fallback | setter DEAD; fallback auto store:14911 | FULL | `NickAliasesLoaded` `App.elm:37809`, `App.elm:10078` `nextNickAlias` | Neither client has an editor; the fallback matches |
| B96 | addToWatchList / removeFromWatchList | DEAD, store:17210/17223 | N/A | `View/Account2.elm:714/743` → `App.elm:41817/41823` | Elm is better: People sheet |
| B97 | setWatchOnline (MONITOR 730/731) | auto store:14946–14965 | FULL | `App.elm:25599` | — |
| B98 | setMobilePanel | DEAD, store:17244 | N/A | — | — |
| B99 | setHighContrastMode (store) | DEAD (live: prefs `highContrast`, `preferences.ts:64`) | N/A | `PrefsTogglePref` (prefs mapper) | — |
| B100 | setDevMode | DEAD, store:17258 | N/A | — | — |
| B101 | setStreamerMode / setStreamerModeBlurLinks | DEAD, store:17269/17277 | N/A | — | — |
| B102 | setReduceMotion / setCompactMemberList (store) | DEAD, store:17288/17297 | N/A | — | Prefs-owned in both |
| B103 | toggleMessageSelection / clearSelection / enter/exitSelectMode | DEAD, store:17308–17316 | N/A | — | — |
| B104 | toggleForumChannel | `src/shell/MessageView.tsx:993` (UI) | FULL | `View/Thread.elm:1019` → `App.elm:42777` | — |
| B105 | addForumPost | auto store:12738; `forumPosts` has no reader | N/A | — | Write-only |
| B106 | openForumCreate / closeForumCreate | DEAD, store:17339 | N/A | (Elm `TopicCreateSubmit` `View/Thread.elm:983` is the topic flow) | — |
| B107 | toggleSuppressEmbed | DEAD, store:17344 | N/A | — | — |
| B108 | setDisplayNameOverride / clearDisplayNameOverride | DEAD (reader `src/shell/PeopleProfileCard.tsx`) | N/A | read at `View/Profile.elm:399`; `App.elm:42616/42641` CORE-ONLY | Read path matches Solid |
| B109 | setSelfDisplayName / Bio / Pronouns / BannerUrl (local identity memory) | DEAD, store:17375–17410 | N/A | — | Solid has no self-profile editor |
| B110 | setInvisibleMode (MODE ±i) | DEAD, store:17423 | N/A | Elm's "Invisible" sends `AWAY Invisible` (`App.elm:19585`) | — |
| B111 | markChannelRead (badge maps) | auto on focus store:8017; palette `commands.ts:462`; Ctrl+Shift+E (`useKeyboardShortcuts.ts:437`) | PARTIAL | read on select; `/read` `App.elm:14609`; `View/Home.elm:154` → `App.elm:39083` | No palette "Mark all read", no Ctrl+Shift+E |
| B112 | incrementUnread → totalUnreadMentions → app badge + tab title | auto store:13052; `src/pwa/AppBadgeRuntime.tsx:43`, `AttentionTitleRuntime.tsx:21` | PARTIAL | per-row unread exists; no badge or title writer in `ports.js` | No OS app badge, no "(n)" title |
| B113 | setUserProfile / getUserProfile (WHOIS + METADATA) | auto store:13514/15296…; get DEAD | FULL | `App.elm:5979/5992` | — |
| B114 | renameChannel (RENAME) | DEAD: `onyx:channel-rename` is never dispatched (store:18369) | N/A | both send `/rename` raw | — |
| B115 | setOwnMetadata (METADATA * SET) | DEAD: `onyx:metadata-set` is never dispatched (store:18375) | N/A | `App.elm:42852` `OwnMetadataSet` → `9453` (CORE-ONLY) | No self-profile editor in either client |
| B116 | _applyMetadata → profile card (display-name/pronouns/bio) + dm-key directory | auto (METADATA 761) | FULL | `App.elm:9366`, `9257`; `View/Profile.elm:397-516` | Neither renders banner, links or accent |
| B117 | publishDeviceKey (METADATA ocean.dm-key(s) on 001, pref-gated) | auto store:11286 | FULL | `App.elm:5031` `DmPublishKey`; manual `View/Account.elm:844` | Elm adds a manual publish button |
| B118 | _decryptDm (TOFU open, re-open on key arrival, notify after decrypt) | auto store:7617/12949/17579 | FULL | `App.elm:43078/43081` `DmOpenResult/Failed` | — |
| B119 | _flagPeerKeyChange (toast + inbox notification) | auto (`_decryptDm`, `useCadenceMedia.ts:477`) | PARTIAL | `App.elm:12720` flag + service log; inline alert in `View/DmSafety.elm` | No toast and no inbox entry |
| B120 | acceptPeerKeyChange (re-pin, re-open locked rows) | `src/shell/DmKeyChangeBanner.tsx:114` (UI) | FULL | `View/DmSafety.elm:381` → `DmKeyAccepted` `App.elm:41743` | Elm re-pins the full live device set |
| B121 | dismissPeerKeyChange (keep locked) | `DmKeyChangeBanner.tsx:130` (UI) | FULL | `View/DmSafety.elm:388` `DmKeyKeepLocked` | — |
| B122 | loadSafetyNumber / loadPendingKeySafetyNumber | `src/shell/DmSafetySheet.tsx:140`, `DmKeyChangeBanner.tsx:72-73` (UI) | FULL | `View/DmSafety.elm:119` → `DmSafetyResult` `App.elm:41737` | — |
| B123 | clearOfflineMemo (on navigate) | `ChannelSidebar.tsx:888` (UI) | FULL | `App.elm:18118`, on select `App.elm:35707`; stamp `View/Rail.elm:472` | — |
| B124 | setChannelOrder (drag reorder) | DEAD, store:17831 | N/A | — | — |
| B125 | markChannelNsfw / unmarkChannelNsfw / acknowledgeNsfw | DEAD, store:17843–17865 | N/A | — | — |
| B126 | setDisplayTheme / setFontSize | DEAD, store:17876/17880 | N/A | — | The theme is owned by ThemeProvider/Studio |
| B127 | joinVoiceChannel (voice) | `PresenceRibbon.tsx:504`, `AppShell.tsx:636`, `src/shell/ScheduledEventLine.tsx:77`, palette `commands.ts:1326` | PARTIAL | `View/CallPresence.elm:233`, `View/Calls.elm:249`, `View/RoomSettings.elm:955` → `App.elm:41150` | No palette "Start voice call" |
| B128 | Video: joinVoiceChannel(withVideo) / toggleVideo / toggleCamera | `src/shell/voice/VoiceBar.tsx:609/849`, palette `commands.ts:1340`; toggleCamera DEAD | PARTIAL | `View/CallStage.elm:435/502`, `View/CallPresence.elm:279/288` → `App.elm:41366` | Hidden while the engine reports `videoEnabled=false` (`ports.js:2313`); the hub still offers "Join with video" (`View/Calls.elm:254`) |
| B129 | leaveVoiceChannel | `VoiceBar.tsx:753`, `src/shell/voice/VoicePip.tsx:350`, `AppShell.tsx:351` | FULL | `View/CallDock.elm:444`, `View/Calls.elm:285` → `App.elm:41195` | Elm asks to confirm when more than 2 people are in the call |
| B130 | toggleMute | `VoiceBar.tsx:751`, `VoicePip.tsx:418` | FULL | `View/CallStage.elm:415`, `View/CallDock.elm:412` → `App.elm:41211` | — |
| B131 | toggleDeafen | `VoiceBar.tsx:848` | FULL | `View/CallStage.elm:576` → `App.elm:41393` | Moved into More |
| B132 | setCallLayout | `VoiceBar.tsx:852` | FULL | `View/CallStage.elm:599` → `App.elm:41444` | Cycles grid → spotlight → screenshare |
| B133 | setCallStageSize (+Escape back to compact) | `VoiceBar.tsx:857`, `src/shell/voice/VoiceStage.tsx:197/203` | FULL | `View/CallStage.elm:607` → `App.elm:41456`; Escape `App.elm:44306` | — |
| B134 | pinParticipant (toggle; implies spotlight) | `VoiceStage.tsx:168` | FULL | `View/CallVideo.elm:386` → `App.elm:41462` | — |
| B135 | toggleCaptions | `VoiceBar.tsx:851` | FULL | `View/CallOverlays.elm:124` → `App.elm:41518` | — |
| B136 | toggleRaiseHand (sends ✋ + local echo) | `VoiceBar.tsx:850`, `useCadenceMedia.ts:401` | FULL | `View/CallOverlays.elm:74` → `App.elm:41489` | Room calls only, same as Solid's engine `activeRoom` |
| B137 | sendCallReaction | `VoiceBar.tsx:1234` | FULL | `View/CallOverlays.elm:211` → `App.elm:41565` | — |
| B138 | setPeerHandRaised (peer ✋, 15s) | auto `useCadenceMedia.ts:405/411` | FULL | `CallCaptions.elm:139` (15000 ms) | — |
| B139 | openVoiceSettings / closeVoiceSettings | `src/app/YouSettings.tsx:232`, `VoiceBar.tsx:859`, `AppShell.tsx:1714` | FULL | `View/CallOverlays.elm:154`, `View/VoiceSettings.elm:32` → `App.elm:41643` | — |
| B140 | startDmCall (ring out, 30s timeout) | DEAD, store:18177 | N/A | `View/CallDock.elm:201` → `App.elm:41318` | Elm is better: a reachable DM "Call" item |
| B141 | acceptDmCall (join-muted honoured) | `src/shell/voice/overlays/IncomingCallOverlay.tsx:23` | FULL | `View/CallDock.elm:138` → `App.elm:41277` | — |
| B142 | rejectDmCall | `IncomingCallOverlay.tsx:32` | FULL | `View/CallDock.elm:104/129` → `App.elm:41298` | Escape declines |
| B143 | endDmCall (cancel ring / hang up) | `src/shell/voice/overlays/OutgoingCallOverlay.tsx:19`, `VoicePip.tsx:353` | FULL | `View/CallDock.elm:158` `CallCancel` → `App.elm:41309`; `CallLeave` | — |
| B144 | openSpatialPad / closeSpatialPad | DEAD, store:18241 | N/A | — | — |
| B145 | openBreakoutSidebar / closeBreakoutSidebar | DEAD, store:18246 | N/A | — | — |
| B146 | open/closeGoLiveModal, startStream / endStream | DEAD, store:18256/18263/18290 | N/A | — | — |
| B147 | raidChannel (MEDIA BREAKOUT) | DEAD, store:18309 | N/A | — | — |
| B148 | createStreamPoll / voteStreamPoll | DEAD, store:18320/18333 | N/A | — | — |
| B149 | openServerStats / closeServerStats | DEAD, store:18260 | N/A | (Elm `/stats` route is separate) | — |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md
- `COVERAGE.md:91` says "Ignore/mute **done** (… `MuteDm`/`UnmuteDm` actions …)". This is overstated. No View dispatches `MuteDm`/`UnmuteDm` (only the folds at `App.elm:31136/31181` exist), while Solid offers Mute/Unmute conversation in the DM ribbon (`PresenceRibbon.tsx:1393/1401`). The real status is CORE-ONLY.
- `COVERAGE.md:218` marks Calls C4–C5 camera as "done". This went stale with commit fbe04585: the engine now reports `videoEnabled=false`, and the camera button and join-with-video banner are hidden (`View/CallStage.elm:435`, `View/CallPresence.elm:279`). The hub's "Join with video" (`View/Calls.elm:254`) is still ungated, which is inconsistent.
- `COVERAGE.md:216` (C6) cites store `startDmCall` as the oracle source, which implies a port. Solid never calls it, so Elm's DM "Call" item (`View/CallDock.elm:201`) is new capability, not parity.
- `V3_ROADMAP.md:121` lists "6.7 Stage (raised hands) | L" with no status, and `V3_ROADMAP.md:169` lists "Stage/Watch Together (6.7) | deferred". Both understate: stage is done (`COVERAGE.md:226`, `Stage.elm`, `View/StageMode.elm`).
- `COVERAGE.md:202` narrows out the quiet-hours schedule correctly, but it understates the impact. Solid's quiet hours default to 22–08 and are active (store:16624-16625, `isDndActive` enabled:true), so Elm now delivers overnight alerts that Solid silenced.
- `App.elm:12990` (the slash table, not a doc) advertises `/back` "Clear away status" (alias `unaway`). It is sent raw as `BACK`, and Onyx Server has no such verb.

#### Elm better than Solid
- **Timed block with auto-lift:** reachable in Elm (`View/Bans.elm:84-128`, `App.elm:20427/20570`). Solid's `tempBan` has no caller.
- **Starting a DM call:** Elm has a "Call" item in the DM More menu (`View/CallDock.elm:201`). Solid's `startDmCall` is dead.
- **Room colour labels:** Elm renders them (`View/Rail.elm:347`) and `/color clear` works (`App.elm:14911`). Solid's `channelColors` has no reader, and its clear passes `''`, which `normalizeNickColor` rejects.
- **Watch list management:** Elm has the People sheet (`View/Account2.elm:714/743`). Solid's add/remove watch actions are dead.
- **Stage:**
  - The host can dismiss a raised hand (`App.elm:45273`) and gets a 375px hands sheet.
  - `ACCEPT_SPEAK` only voices people the host actually invited (`Stage.recordInvite`).
- **Scheduled sends:** Elm holds a scheduled DM until the peer key lookup resolves (`App.elm:12248`).
- **Away state:** Elm folds `isAway` from the server's 305/306 replies (`App.elm:5540`). Solid sets it optimistically, without a server check.
- **Device key:** besides the automatic publish on 001, Elm has a manual publish button (`View/Account.elm:844`).

#### Gaps (ranked by user impact)
- `[High]` **Hide room and close conversation (B59/B60).** Add `hiddenRooms` and `closedConversations` sets to the `App.Model`, persisted through new ports slots. Add Msgs `RoomHide`/`RoomUnhide`/`ConversationClose`. Filter them in `Sidebar.elm`, and put the items in the `View/RoomHeader.elm` More menu and the room settings. Reopen a closed conversation on an inbound DM or when its DM is selected.
- `[High]` **DM mute UI (B58).** Add "Mute conversation" / "Unmute" to the DM branch of the `View/RoomHeader.elm` More menu, dispatching the existing `MuteDm`/`UnmuteDm` (`App.elm:31136`).
- `[Med]` **Quiet hours schedule, default 22–08 (B51).** Add `dndQuietStart`/`dndQuietEnd` to the Model, load them from `onyx:dnd-quiet-*` in `index.html`, and extend `notifyDndActive` (`App.elm:31607`). Add two selects to `View/Notify.elm`, and apply them on portable import (`Account2.elm`).
- `[Med]` **`/away` message and `/back` (B12/B13).** Give `away`/`back`/`unaway` local arms in `parseSlashLocal` (`App.elm:10981`): join the args into one trailing param, and send `AWAY` with no args for back. Optionally add palette away/back actions in `Switcher.elm`.
- `[Med]` **Room folders (B80–B85).** Add a `channelFolders` model and ports persistence (owner-scoped). Add create/delete/assign Msgs and a folder section in the Account view. Group and collapse folders in `Sidebar.elm`/`View/Rail.elm`, and apply folders on portable import.
- `[Med]` **Palette grammar (B21/B24/B31/B49/B50/B111/B127/B128).** Extend `Switcher.actionEntries` with: schedule-at, Scheduled messages, star/unstar, DND on/off and "mute N min", Mark all read, Start voice/video, hide room, close conversation.
- `[Med]` **App badge and tab-title mention count (B112).** Add a ports `attention` outbound fed from `unreadAttentionCount` that sets `navigator.setAppBadge` and a "(n)" document title.
- `[Low]` **Keyboard shortcuts (B24/B31/B49/B111).** Ctrl+B star, Ctrl+Shift+D DND, Ctrl+Shift+E mark read and Ctrl+Shift+L schedule all need ports `shortcut` names plus `Switcher.Shortcut` arms. Ctrl+Shift+E collides with the in-call camera chord, so that one should only apply outside a call.
- `[Low]` **Home recent rooms and memory (B94, autojoin B30).** Record successful self-JOINs into a bounded `joinHistory`, render "recent rooms" on `View/Home.elm`, and feed the autojoin list into the same section.
- `[Low]` **Key-change toast and inbox entry (B119).** When `peerKeyChanges` gains a key at `App.elm:12720`, call `addToast` plus `addNotification` (`NotificationType` error).
- `[Low]` **Hub "Join with video" is ungated (B128).** Gate the button at `View/Calls.elm:254` on `model.callLocal.cameraSupported`, like `View/CallPresence.elm:279`.
- `[Low]` **Idle auto-away (B14), new in both clients.** Add a ports activity/visibility idle timer that emits `IdleAwayTick`. Fold it to `setUserStatus StatusIdle` after N minutes (read from `onyx:idle-away-minutes`), and restore Online on activity.

### C — Inbound protocol — every server line the Solid client handles

Walked Solid `src/lib/store/store.ts` `_handleMessage` 10432–15569 (pre-switch standard-reply block 10439–11217, every `case` arm 11219–15557 plus `default`), the connect callbacks 6605–6760, reconnect 5091 and the `online`/`offline` listeners 19242; `src/lib/irc/client.ts` (CAP/SASL/nick/LIST/005/keepalive/ERROR, 940–1655), `labels.ts`, `multiline.ts`, `sessionReclaim.ts`, `activitySubscribe.ts`. UI reach was checked in `src/shell` and `src/app`. Elm: `App.elm` `foldLine` 4591–5932 and every fold it calls (`foldStandardReply` 20833, `foldErrorNumeric` 17116, `foldNickError` 10119, `foldCap` 9878, `foldChat` 34673, …), plus `Media.elm`, `Passkey.elm`, `Ircx.elm`, `Isupport.elm`, `ports.js`, `Main.elm` and the views.

**Cross-cutting finding:** Solid's `addServerLog` writes to `serverLog`, which renders as the sidebar **"Activity — Network updates"** status view (`ChannelSidebar.tsx:731` → `MessageView.tsx:888`). Elm's equivalents, `logService`/`logNumeric`, write to `model.serviceLog`. **No view renders `serviceLog`**: only the Account cert/keytrans filters and the webhook filter read it (`App.elm:26797,26825,21639`), and `View/Rail.elm:11` defers the Activity entry. So every row below marked "log only" is **invisible** in Elm, while the same text was visible in Solid.

| # | Capability | Solid (reach) | Elm | Evidence | Gap / note |
|---|---|---|---|---|---|
| **Standard replies (pre-switch)** | | | | | |
| C1 | Passkey service replies: REGISTER-CHALLENGE → create ceremony; REGISTERED shows "Passkey added (label)"; CRED/LIST rows; REMOVED/RENAMED notices; STATUS probe | `store.ts:10481-10612` (auto) | FULL | `Passkey.elm:543,577`; `App.elm:22796` | Panel reach is covered by the Account section |
| C2 | Passkey sign-in: AUTH-CHALLENGE + ALLOW-CRED with an 80 ms settle, then the get ceremony | `store.ts:10614-10697` (auto) | FULL | `Passkey.elm:692,710`; `Main.elm:76` | Passkey sign-in button hidden on both sides |
| C3 | FAIL/WARN WEBAUTHN sets passkeyError; TEMPORARILY_UNAVAILABLE disables the feature; INVALID_SUBCOMMAND shows "does not support renaming" copy | `store.ts:10448-10478` | FULL | `Passkey.elm:522` | |
| C4 | NOTE SESSION TOKEN → persist bearer and update the live client | `store.ts:10702` (auto) | FULL | `App.elm:5872,17492,17310` | |
| C5 | NOTE SESSION MTOKEN (with expires) → mesh token and deadline | `store.ts:10715` (auto) | FULL | `App.elm:17310-17347` | |
| C6 | FAIL SESSION INVALID_TOKEN/NO_SESSION → "reclaim failed" banner, wipe bearers, canonical-only | `store.ts:10742-10765` | FULL | `App.elm:17409,17445` | |
| C7 | Any FAIL SESSION → error inbox row | `store.ts:10767` (auto) | PARTIAL | `App.elm:17429-17455` | `logService` only, so no inbox row (LIST/DROP failures are invisible) |
| C8 | FAIL REGISTER/VERIFY → registerError shown on the claim sheet | `store.ts:10769-10780` | FULL | `App.elm:20885,25888` | |
| C9 | FAIL/WARN IDENTIFY → accountActionError + inbox row | `store.ts:10826,10849` | FULL | `App.elm:20882,21008` | |
| C10 | FAIL/WARN ACCOUNTSET/LOGOUT/RECOVER/DROP/KEYTRANS/CERT* → action error + inbox "X failed (CODE)" | `store.ts:10786-10859` | FULL | `App.elm:20949-20993` | |
| C11 | FAIL ACCOUNTINFO → inbox error | `store.ts:10822,10855` | PARTIAL | `App.elm:20900-20916` | Clears pending silently. Better than Solid (no stranded loader) but no inbox row |
| C12 | FAIL E2EEKEY from Account key actions → accountActionError + inbox | `store.ts:10808,10849` (UI) | PARTIAL | `App.elm:20870,21979-22006` | Routed to the group publisher, otherwise "Group directory:" log line only; the panel never shows the error |
| C13 | NOTE ACCOUNTINFO / ACCOUNTSET → panel fields, re-fetch | `store.ts:10860-10876` | FULL | `App.elm:20894-20899,26588,26658` | |
| C14 | FAIL RENAME → inbox "RENAME failed (CODE)" | `store.ts:10878` | FULL | `App.elm:20918-20934` | |
| C15 | NOTE MEMO offline memo → highlighted DM row + offline-memo stamp | `store.ts:10886-10942` (auto) | FULL | `App.elm:20624`; `View/Rail.elm:472` | Solid `OfflineMemoToast` never fires: the event detail carries `channel`, the toast reads `from` (`OfflineMemoToast.tsx:20`) |
| C16 | FAIL CHATHISTORY → stop spinner, mark exhausted, release pin lookup and TARGETS | `store.ts:10944-10974` | FULL | `App.elm:20876,34127` | |
| C17 | FAIL TOTP → TOTP panel error | `store.ts:10976` | FULL | `App.elm:20888,28361` | |
| C18 | FAIL RECOVERYCODES → panel error | `store.ts:10982` | FULL | `App.elm:20891,28044` | |
| C19 | FAIL SEARCH → server-search error state | `store.ts:10992-11021` | FULL | `App.elm:20873,21067` | |
| C20 | MEDIA presence JOIN/ROSTER/LEAVE/SPEAKING/SILENT/MUTE/UNMUTE/HAND → call roster, speaking, mute, hands | `store.ts:11091-11160` (auto) | FULL | `Media.elm:224-346`; `App.elm:20852-20865` | Forwarding to the voice engine is covered by the calls section |
| C21 | MEDIA REACT → voice reaction overlay | `store.ts:11165-11176` | FULL | `Media.elm:346` | |
| C22 | MEDIA CAPTION/TRANSCRIPT → captions overlay and transcript | `store.ts:11037-11070` | FULL | `Media.elm:159` | |
| C23 | Labeled FAIL → drop the optimistic row + toast "Message not delivered" (mesh-humanized copy) | `store.ts:11201-11210`, `3359` | FULL | `App.elm:31848-31880,16964` | |
| C24 | Unlabeled messaging FAIL (PRIVMSG/NOTICE/TAGMSG/WHISPER) → same toast | `store.ts:11211-11217` | FULL | `App.elm:31832-31845` | |
| C25 | Any other FAIL/WARN/NOTE → serviceNotices (shown only in the oper console and Account filters) | `store.ts:11219` | PARTIAL | `App.elm:20995` | Elm drops these silently. Low impact |
| C26 | FAIL IDENTITY STALE_EPOCH → one bounded attribution retry | `client.ts:1260` (auto) | FULL | `App.elm:20936` | |
| C27 | FAIL/WARN E2EEGROUP eligibility codes | groupControl bridge (auto) | PARTIAL | `App.elm:20867,22775` | Shown in the service log only, which has no view |
| **Switch arms** | | | | | |
| C28 | ACK → promote the labeled pending row | `store.ts:11219` | FULL | `App.elm:5886-5901` | Also admits scheduled sends |
| C29 | EVENT MEDIA / WEBAUTHN plane re-dispatch | `store.ts:11226-11250` | FULL | `App.elm:5866,8484` | |
| C30 | 001 orchestration: IRCX, EVENT ADD MEDIA, LUSERS, publish key, MONITOR resub, TARGETS sweep, outbox flush, scheduled dispatch, `?join=`/`?at=`, recovery login, nick reclaim | `store.ts:11253-11380`, `client.ts:1220` | FULL | `App.elm:5013-5198` | Latency and scheduled dispatch run on the tick (`App.elm:37461`) |
| C31 | 001 welcome text and "Connected to …/Reconnected." lines | `store.ts:11271,6612` (Activity) | PARTIAL | `App.elm:5052-5080` | Log only (invisible) |
| C32 | `?topic=` deep-link slice resolution on JOIN/366/818/819/history | `store.ts:11519,11935,11992,12004` | PARTIAL | `App.elm:4741-4772` | Opens the whole room only; no topic slice |
| C33 | ACCOUNT (account-notify, own only) → identity chip, owner-scoped reload, nick reclaim | `store.ts:11383-11441` | FULL | `App.elm:5373,28501` | |
| C34 | REGISTER SUCCESS / VERIFICATION_REQUIRED, VERIFY SUCCESS → claim sheet phases | `store.ts:11443-11465` | FULL | `App.elm:4854-4858,24938,24981` | |
| C35 | Self JOIN → create room, history, MARKREAD, WHO, ACTIVITY SUBSCRIBE, NAMES, settle create-room (topic, first line) | `store.ts:11497-11552` | FULL | `App.elm:4692-4800,23491,23583` | |
| C36 | Self-JOIN echo focuses the joined room | `store.ts:11522-11529` (auto) | PARTIAL | `App.elm:4741-4772` | Elm focuses only for deep-link, link-click, browser and create. `/join`, invites and server-forced joins land unfocused |
| C37 | Other user JOIN → row "nick (user@host) joined" + channel event | `store.ts:11553-11585` | PARTIAL | `App.elm:23550-23575` | Row has no `(user@host)` mask; `account` from extended-join is not kept |
| C38 | PART → row "X left (reason)" + event; self-part drops the room and goes Home | `store.ts:11619-11744` | FULL | `App.elm:4802,23849` | |
| C39 | QUIT → "X quit: reason" rows in every shared room + event | `store.ts:11746-11802` | FULL | `App.elm:4813,23964` | |
| C40 | KICK → row "A kicked T: reason", event, audit, moderation; self: drop room, Home, reset stage | `store.ts:11804-11908` | FULL | `App.elm:4841,28784`; stage `45362` | Neither client tells you that *you* were kicked (silent removal) |
| C41 | 353/366 NAMES burst (append vs replace), PROP fetch, history kick on 366 | `store.ts:11911-11946,12010-12118` | FULL | `App.elm:4638-4646,23377,23251,23272` | |
| C42 | 818/819/PROP registry; user STATUS/ACTIVITY props → activity chips; ai-policy projection | `store.ts:11948-12008,13414-13457` | FULL | `App.elm:5809-5816,20297` | |
| C43 | TOPIC/332 → topic, topic history, audit (live TOPIC only); replayed TOPIC diverted | `store.ts:12120-12151` | FULL | `App.elm:4863-4873,4948,34999,35239` | |
| C44 | 324 channel modes (authoritative) and 329 creation time | `store.ts:12153-12194` | FULL | `App.elm:5604-5608,29102,29134` | |
| C45 | PRIVMSG/NOTICE delivery: channel and DM rows, highlight, unread, mention/follow/DM inbox, hidden-room reveal | `store.ts:12812-13096` | FULL | `App.elm:34673-34925,30369,31476,31504,31644` | |
| C46 | Global NOTICE to `$$*`/`*` → Activity line (+ announcements store, which has no UI) | `store.ts:12209-12217` | PARTIAL | `App.elm:34688,34634` | Server-sourced: invisible log. Nick-sourced: filed as a DM from the sender |
| C47 | Server NOTICE with no sender (non-service) → Activity | `store.ts:13090-13096` | PARTIAL | `App.elm:34688` | Log only (invisible) |
| C48 | NOTICE sub-parsers: SESSION list rows/end/drop, oper EVENT REPLAY JSON, TOTP:, RECOVERYCODES:, VHOST, ACCOUNTINFO, E2EEKEY/KEYTRANS/CERT replies, Webhook source | `store.ts:12239-12450,12503` | FULL | `App.elm:4878-4940,17515,17541,26141,26608,26637,27393,27718,28018,28321` | |
| C49 | NOTICE text confirmations ("logged out", "account dropped", ACCOUNTSET "… updated") → clear account / re-fetch | `store.ts:12452-12496` | PARTIAL | — | No text-form fold; relies on 901 / NOTE ACCOUNTSET |
| C50 | CTCP SCREENSHARE START → inbox "🖥 X is sharing their screen" | `store.ts:12520` | FULL | `App.elm:7494-7510` | |
| C51 | CTCP EDIT/DELETE from the sender → in-place edit/delete | `store.ts:12533-12590` | FULL | `App.elm:7344` | |
| C52 | CTCP STAGE RAISE/LOWER_HAND, INVITE_SPEAK, ACCEPT/DECLINE_SPEAK | `store.ts:12592-12642` | FULL | `App.elm:45308-45380`; `Stage.elm:389-423` | |
| C53 | CTCP POLL_VOTE → poll emoji reactions | `store.ts:12646-12681` | N/A | — | DEAD: no Solid sender, no poll UI |
| C54 | CTCP VERSION/TIME/PING/CLIENTINFO auto-replies (pref-gated) | `store.ts:12684-12703` | FULL | `App.elm:7452-7480` | |
| C55 | Inbound `\x01ACTION` (/me) from others | `store.ts:12684` (swallowed) | FULL | `App.elm:7536,34737` | **Shared bug**: both clients drop other users' /me lines |
| C56 | CTCP FORUM → forumPosts | `store.ts:12720-12740` | N/A | — | DEAD: `forumPosts` has no consumer |
| C57 | `+draft/edit` tagged PRIVMSG (server-native edit fan-out) → edit the referenced row in place | `store.ts:12748-12775` (auto) | MISSING | `App.elm:5833,7162` (EDIT cmd only) | onyx-server emits edits only as `PRIVMSG +draft/edit` (`server.zig:42417`), so Elm appends a duplicate row |
| C58 | `+draft/reply` / CTCP REPLY wrapper → reply quote | `store.ts:12782-12811` | FULL | `App.elm:7261` | |
| C59 | Labeled self-echo confirms the optimistic row (msgid filed) | `store.ts:12897-12912` | FULL | `App.elm:30216` | |
| C60 | ONYXDM1 DM envelope open; METADATA GET for an unknown peer key on receive | `store.ts:13068-13077` | PARTIAL | `App.elm:34929,35660` | Elm fetches the key only on DM open; stays locked until then |
| C61 | ONYXROOM group envelope open | `store.ts:12865` | FULL | `App.elm:8935` | |
| C62 | WALLOPS → "WALLOPS: text" Activity line (+ announcement, no UI) | `store.ts:13099-13108` | PARTIAL | `App.elm:5869,17989` | Log only (invisible) |
| C63 | NICK → "old → new" rows + events; forced Guest rename → toast "Renamed to …" + inbox | `store.ts:13115-13244` | FULL | `App.elm:4821,28609-28700` | |
| C64 | CHGHOST no-op | `store.ts:13246` | FULL | `App.elm:5918` | |
| C65 | Channel MODE → row "X set mode …", audit, moderation, ban-list delta, ban fetch on op grant | `store.ts:13250-13390` | FULL | `App.elm:4829-4839,29025,18674` | |
| C66 | Own user MODE → Activity line "your user mode: …", +o oper flag | `store.ts:13391-13410` | PARTIAL | `App.elm:29207-29239` | Flag folds; line is log only (invisible) |
| C67 | AWAY (away-notify) → member away dot | `store.ts:13459` | FULL | `App.elm:5818,17836` | |
| C68 | INVITE → inbox "X invited you to #c"; other invitee → channel event | `store.ts:13481-13508` | FULL | `App.elm:4860,25013` | |
| C69 | SETNAME → profile realname | `store.ts:13510` | FULL | `App.elm:5836,6007` | |
| C70 | ACTIVITY typing / react / unreact stream | `store.ts:13520-13551` | FULL | `App.elm:5824,6510,6849,6898` | |
| C71 | TAGMSG typing + `+draft/react` toggle | `store.ts:13553-13640` | FULL | `App.elm:5821,6532,6923` | |
| C72 | REACT command toggle | `store.ts:13642-13716` | FULL | `App.elm:5827,6990` | |
| C73 | RENAME → room migrates (messages, unread, active view) + note row | `store.ts:13718-13784` | FULL | `App.elm:4849,28906` | |
| C74 | 761/766/METADATA → profiles (display-name, accent, links), DM keys | `store.ts:13786-13813` | FULL | `App.elm:5839-5856,8969,9433` | |
| C75 | 762 / 767 / 769 metadata end and errors | default (Activity) | PARTIAL | `App.elm:5568,5845-5853` | 762 silent on both sides; 767/769 log only |
| C76 | MARKREAD echo/GET/relay → read markers, unread re-derive | `store.ts:13815-13846` | FULL | `App.elm:5860,30588` | |
| C77 | REDACT → "[Message deleted]" | `store.ts:13848-13883` | FULL | `App.elm:5830,7120,286` | |
| C78 | EDIT command (forward-compat) | `store.ts:13885-13923` | FULL | `App.elm:5833,7162` | Server never sends it (see C57) |
| C79 | 730/731 MONITOR → friend online flags + DM away state | `store.ts:13925-13961` | PARTIAL | `App.elm:5591-5600,25816,25833` | DM presence write skipped (Elm comment says so) |
| C80 | 732/733 ignored; 734 → inbox "MONITOR list is full (N targets)" | `store.ts:13963-13977` | FULL | `App.elm:5562-5566,5601,25865` | |
| C81 | WHISPER → highlighted whisper row | `store.ts:13979-14004` | FULL | `App.elm:5857,8468`; `Ircx.elm:1022` | |
| C82 | CHATHISTORY TARGETS rows → DM discovery and unread | `store.ts:14006-14035` | FULL | `App.elm:4942,33618` | |
| C83 | BATCH chathistory/search/quarantine/multiline/labeled-response/targets collectors and merge; `?at=` landing | `store.ts:14037-14483` | FULL | `App.elm:5903-5916,32806,32880` | |
| C84 | 321/322/323 LIST → room directory (bounded, quarantine) | `client.ts:1180-1218`; `store.ts:14485-14521` | FULL | `App.elm:4960-4975,16501-16538` | |
| C85 | 308/309 RULES → serverRules | `store.ts:14523-14538` | N/A | `App.elm:5546,25054` | DEAD: no rules UI on either side |
| C86 | 375/372/376 MOTD → MOTD lines in Activity (motd/showMotd have no UI) | `store.ts:14540-14573` | MISSING | `App.elm:4624-4636,4541-4577` | Elm collects it but shows the MOTD nowhere |
| C87 | 004 server version | `store.ts:14657` | N/A | `App.elm:4609` | DEAD: no UI either side |
| C88 | 352 WHO → member away dots | `store.ts:14665-14699` | FULL | `App.elm:4651,17943` | |
| C89 | 900 RPL_LOGGEDIN → account, owner reload, nick reclaim, session commands | `store.ts:14701-14786`; `client.ts:1113` | FULL | `App.elm:5200-5372` | |
| C90 | 901 RPL_LOGGEDOUT → guest, purge, clear tokens | `store.ts:14788-14830`; `client.ts:1136` | FULL | `App.elm:5378-5459` | |
| C91 | 401 → WHOIS sheet "No profile was found…" + inbox "No such nick: X" | `store.ts:14843-14860` | FULL | `App.elm:5659,6074-6150` | |
| C92 | 401 answering a labeled DM send → drop the row + toast "Message not delivered" | `store.ts:14834-14842` | PARTIAL | `App.elm:6080-6113` | Elm drops the row silently (log only, no toast) |
| C93 | 403/404 → inbox "No such channel"/"Cannot send to X: reason" + labeled-send toast | `store.ts:14863-14887` | FULL | `App.elm:17132-17171,16983` | |
| C94 | 405/421/431/441/442/443/451/461/467/476 → inbox error copy | `store.ts:14889-15241` | FULL | `App.elm:17172-17195,17229,17245` | Copy is verbatim on both sides |
| C95 | 432/437 post-registration → inbox "Erroneous nickname: X" / "Nick/channel temporarily unavailable" | `store.ts:14905,14937` | FULL | `App.elm:10127-10160` | |
| C96 | 433 → nick-alias rotation, then inbox "Nickname in use: X" | `store.ts:14911-14935` | FULL | `App.elm:10138-10191` | |
| C97 | 464 → inbox + Account notice; live IDENTIFY → accountActionError | `store.ts:15000-15020` | FULL | `App.elm:17196-17228` | |
| C98 | 471/473/474 → inbox + browser join prompt "Could not join #x: …" | `store.ts:15027-15042,15220-15227`; `ChannelBrowser.tsx:150` | FULL | `App.elm:17232-17240,10211,16780`; `View/Browser.elm:278` | |
| C99 | 475 → join prompt "Incorrect channel password" (no inbox) | `store.ts:15229` | FULL | `App.elm:17241-17244` | |
| C100 | 482 → inbox "You need operator privileges in #x" + ban panel error | `store.ts:15243-15259` | FULL | `App.elm:17248-17271` | |
| C101 | 477 (+R/+a room), 480 (join throttle), 407 → Activity text | default (Activity) | PARTIAL | `App.elm:5671,5720-5730` | Log only; browser waits 8 s, then shows "did not confirm" |
| C102 | KNOCK replies 710/711/713/714 | default (Activity) | PARTIAL | `App.elm:4673-4690` | Log only (invisible) |
| C103 | 600/601/604/605 WATCH → watch-list online/last-seen | `store.ts:14943-14967` | FULL | `App.elm:5571-5590,25779,25797` | |
| C104 | 367/368 ban list → ban panel | `store.ts:15044-15092` | FULL | `App.elm:5803-5807,19108,19232` | |
| C105 | 801–805 ACCESS → Roles access manager | `store.ts:15094-15203` | FULL | `App.elm:5782-5796,8446`; `View/RoomSettings.elm:482` | |
| C106 | 775/776 ACCESS list notes | `store.ts:15205-15218` (no UI) | FULL | `Ircx.elm:696-721`; `App.elm:8456` | Elm better: visible system row in the room |
| C107 | 491 ERR_NOOPERHOST → drop oper badge + inbox | `store.ts:15261` | N/A | `App.elm:5621` | Absent-by-design (OPER); both nevertheless implement it |
| C108 | WHOIS 276/301/311/312/313/317/318/319/320/330/335/338/671 → profile sheet | `store.ts:15269-15492` | FULL | `App.elm:5637,5734-5781,5945` | |
| C109 | 305/306 → own away state | `store.ts:15494-15497` | FULL | `App.elm:5540-5544` | |
| C110 | 381 → oper/admin badge + Activity line | `store.ts:15500-15503` | FULL | `App.elm:5610-5620` | Badge folds; line is log only |
| C111 | PONG latency RTT / 251–255 LUSERS stats | `store.ts:15506-15547` | N/A | `App.elm:19652,19778` | DEAD: no latency/LUSERS UI in Solid (Elm is core-only too) |
| C112 | Default: any unhandled numeric → Activity line | `store.ts:15549-15556` | MISSING | `App.elm:5926-5930,9642` | `logNumeric` goes to the invisible serviceLog (HELP 704-706, 221, 331, 902/906 …) |
| C113 | Activity / status buffer (the view behind every Activity row above) | `ChannelSidebar.tsx:731` (UI) | MISSING | `View/Rail.elm:11` | Deferred in Elm. The root cause of C31/46/47/62/66/86/101/102/112 |
| C114 | 826/827 MODEX named modes | default (Activity) | CORE-ONLY | `App.elm:5530-5539,19441,19469` | `modexModes` has no view consumer; `/modex` output is invisible |
| **E2EE inbound** | | | | | |
| C115 | E2EE.KEYPACKAGE/COMMIT/WELCOME delivery → group control | groupControlIntegration (auto) | FULL | `App.elm:5926-5930,22013` | |
| C116 | E2EEKEY snapshot NOTICE (trusted prefix) → group directory | groupControlBridge (auto) | FULL | `App.elm:4893-4896,21157,21907` | |
| C117 | Peer DM key change → toast "Encryption key changed" + inbox "X's encryption key changed — verify…" | `store.ts:17702-17712` | PARTIAL | `View/DmSafety.elm:97`; `App.elm:12721` | Shows a DM header marker only; no toast or inbox row |
| **client.ts connection behaviours** | | | | | |
| C118 | CAP LS 302 (multiline), REQ in 380-char chunks, ACK/NAK/NEW/DEL, capability matrix refresh | `client.ts:953-1060` | FULL | `App.elm:9878-9970,36789` | |
| C119 | Wanted caps (tls/sts/no-implicit-names/file-upload/bot off; sasl only with creds) | `client.ts:1371-1422` | FULL | `Session.elm:657-667` | STS advertised, never REQ'd, on both sides |
| C120 | SASL select SCRAM-SHA-256 > PLAIN > EXTERNAL; PLAIN/SCRAM exchange, 400-byte chunks, server-signature verify | `client.ts:994-1095,1316,1522` | FULL | `App.elm:9777,9803`; `ports.js:1338-1416` | |
| C121 | SASL 15 s timeout; 903/904/905 honoured only mid-exchange (IRCX reuse) | `client.ts:1011,1097,1143` | FULL | `ports.js:1260`; `App.elm:5476-5506,37643` | |
| C122 | SASL failure UX: inbox error, close 4003, auto-reconnect disarmed, Connect copy "That password was not accepted" | `client.ts:1305`; `store.ts:6662-6669,6752`; `Connect.tsx:512` | PARTIAL | `App.elm:9761-9775,24402`; `ports.js:6702` | Elm logs only, so the Connect gate shows "Couldn't reach Onyx just now"; reconnect is not disarmed |
| C123 | Pre-registration 432 "nickname is registered" → error, close; Connect "That name belongs to an account. Sign in to use it." | `client.ts:1156-1167`; `Connect.tsx:455` | PARTIAL | `App.elm:10196-10199` | Inbox text is "Erroneous nickname: X"; the registered copy goes to the invisible log, so generic copy shows |
| C124 | Pre-registration 433/432/437 → automatic `nick_` retry ×4 | `client.ts:1168-1175` | MISSING | `App.elm:10164-10202` | Alias list only. With no aliases, registration hangs on "Connecting to Onyx." |
| C125 | Server PING → PONG | `client.ts:949` | FULL | `App.elm:4976-4979` | |
| C126 | Keepalive: 25 s idle PING, 15 s pong timeout, close 4001 | `client.ts:1645-1655` | FULL | `ports.js:2596-2618`; `App.elm:4981-4986` | |
| C127 | Server ERROR line → inbox error + status error + Activity | `client.ts:1252`; `store.ts:6752,13110` | PARTIAL | `App.elm:5008-5011` | Log only. Kill/ban/shutdown reasons are invisible; close text reads "Disconnected: " |
| C128 | Close → inbox "Disconnected: reason" ("code N" fallback); auth-fatal suppresses reconnect | `store.ts:6655-6730` | PARTIAL | `App.elm:36799-36905` | No auth-fatal path; empty reason, no close code |
| C129 | Reconnect backoff (5 tries, min(5·2ⁿ,60) s ±20%), countdown banner, Reconnect now, Back online | `store.ts:4048,5091`; `ReconnectStatusBanner.tsx:131` | FULL | `App.elm:10243-10330,16872,16933`; `View/Topbar.elm` | |
| C130 | Rejoin storm on reconnect (suppressed under onyx/session-sync) | `store.ts:6614-6625` | FULL | `App.elm:5130-5135,23126` | |
| C131 | Browser `offline` drops the socket (outbox queues); `online` → reconnect now | `store.ts:19242-19254` (auto) | MISSING | — | No listeners in `ports.js`/`Main.elm` |
| C132 | Inbound frame bounds (text 1 MiB, binary 4 MiB) → error + close 1009 | `client.ts:849,878,913` | PARTIAL | `ports.js:2883,2939,3140` | Binary bound only; no text bound and no error notice |
| C133 | WS subprotocols onyx.irc-media.v1 / text.ircv3.net | `client.ts:29-35` | FULL | `ports.js:2885,2935` | |
| C134 | ISUPPORT fold (PREFIX roster remap, CHANTYPES, CASEMAPPING, NICKLEN, TOPICLEN, CHANLIMIT, MODES, CHANMODES, IRCX, SILENCE, VAPID, ACCOUNTRESIDENCE) | `client.ts:1549-1640`; `store.ts:14575-14655` | FULL | `App.elm:4594-4607,17880`; `Isupport.elm:316-386` | |
| C135 | ISUPPORT NETWORK → network name in OperDesk "Network" row and invite card title/description | `store.ts:6903,14619`; `OperDesk.tsx:122`; `ChannelSettings.tsx:270` | PARTIAL | `Isupport.elm:316`; `App.elm:1401,15830,30739` | Parsed but never displayed; invite copy hardcodes "Onyx" |
| C136 | 001 IRCX + once-per-socket SESSION RESUME (mesh-first) + TOKEN rotate; 900 account switch drops the old bearer | `client.ts:1113-1134,1220,1276`; `sessionReclaim.ts` | FULL | `App.elm:17357-17407,5200-5230`; `Session.elm` | |
| C137 | Labeled-response mint/correlate (labels.ts) | `labels.ts`; `store.ts:3359-3410` | FULL | `Labels.elm`; `App.elm:30173,31825` | |
| C138 | draft/multiline send plan + inbound reassembly (multiline.ts) | `multiline.ts`; `store.ts:14128-14260` | FULL | `Multiline.elm`; `App.elm:32880` | |
| C139 | server-time tag → row timestamps | `store.ts:12835-12840` | FULL | `App.elm` `rowTime`; `Wire.parseServerTime` | |
| C140 | ACTIVITY SUBSCRIBE/UNSUBSCRIBE on self join/part (activitySubscribe.ts) | `activitySubscribe.ts`; `store.ts:11544` | FULL | `App.elm:4787-4793` | |
| C141 | Account attribution (ACCOUNTRESIDENCE, IDENTITY confirm NOTICE) | `client.ts:1260,1633` | FULL | `App.elm:4594-4607,21852` | |
| C142 | Raw line log with SASL/E2EE redaction | `client.ts:130` | N/A | — | DEAD: no raw-log UI in Solid |
| C143 | Hot-upgrade reconnect signal | — | N/A | — | None in Solid or the protocol; reclaim covers it |

#### Stale or overstated claims in COVERAGE.md / V3_ROADMAP.md

I checked 27 claims in COVERAGE.md. These 14 are wrong, overstated or mis-cited:
- **"432/433/437 → underscored retry ×4 then log fall-through"** (Registration row). This is false. `foldNickError` (`App.elm:10119-10202`) only rotates the alias list; there is no `_` suffix anywhere. Pre-registration 433 with no aliases hangs.
- **"904/905 fail-closed (no guest fallback, socket closes 4003-equivalent)"**. This is overstated. `failSasl` goes through `WsDisconnect`, i.e. `socket.close()` with no code (`ports.js:6702`). It does not disarm auto-reconnect and logs only, so Connect shows the generic copy (C122).
- **"password entry UI still ahead (creds enter via SaslCredentialsProvided)"** (SASL row). This is **understated** and stale: `View/Connect.elm:198` has the password field, and the connect-gate row itself says sign-in hands the secret to ports.
- **"REDACT/EDIT done (`App.foldRedact`/`foldEdit`…)"** (Messaging row). This is overstated. Server edits arrive as `PRIVMSG +draft/edit=<msgid>` (onyx-server `server.zig:42417`, folded by Solid at `store.ts:12748`). Elm has no such fold, so edits duplicate rows (C57).
- **"ERROR → service-log reason"** (keepalive row). The code matches the claim, but Solid surfaced ERROR as an inbox error via `onError` (`client.ts:1252` → `store.ts:6752`). This regression is not acknowledged.
- **Many rows say "pinned to the generic numeric log … like the oracle"** (KNOCK 710-714, 477, 480, 407, 221, 331, 767/769, 902/906, SILENCE/ACCEPT, Queries catch-all). The equivalence is overstated. Solid's generic log is the user-visible Activity view (`ChannelSidebar.tsx:731`); Elm's `serviceLog` has no view (`Rail.elm:11` defers it).
- **"App 730–734 folds mirroring the oracle"** (Accounts row). This is overstated: 730/731 skip the DM away write (`App.elm:5591-5597`).
- **foldSessionReply doc says "every FAIL SESSION still surfaces its error, mirroring the oracle"**, and the Sessions row says "LIST/DROP failures only log". Solid adds an error inbox row for every FAIL SESSION (`store.ts:10767`); Elm only logs (C7).
- **"Service FAIL/WARN → UI mapping done"**. Unknown commands fall to `( model, [] )` (`App.elm:20995`), and FAIL E2EEKEY account errors never reach the panel (C12).
- **Transport row cites "`Wire.splitWireFrame`"**. That function is used only by `WireTest`; production framing is the `ports.js:3140` split. The behaviour is fine; the citation is wrong.
- **"PASS/CAP LS 302/REQ/ACK/NAK/LIST/END/NEW/DEL"**. Neither client sends PASS or handles CAP LIST; `foldCap` covers LS/ACK/NAK/NEW/DEL.
- **"MODEX named modes + 826/827 … done"**. This is core plus slash only: `modexModes` has no view and the 827 line is invisible.
- **Absent-by-design says "no OPER (491)"**, yet `App.elm:5610-5636` folds 381/491 (mirroring Solid). The doc is inconsistent.
- **MONITOR/Unread/Connect rows rely on `lastErrorText`**. Because SASL and registered-nick failures never add a `NotifError`, `connectStatusMessage` (`App.elm:24383`) cannot hit its password or registered-name branches in practice.

These claims checked out as accurate: ISUPPORT token set (`Isupport.elm:316`), MODES default 4 (`Isupport.elm:113`), 473–476 copy, 437 verbatim, 480 via `foldErrorNumeric`, 221/271/272/281/282 named arms, netsplit/LINKS/SASLINFO oracle-gaps (grep empty), keepalive 25/15/4001 (`ports.js:2596-2618`), SASL 15 s guard (`ports.js:1260`), CAP LS 302 (`App.elm:36789`), `mediaAvailable` on every MEDIA line (`App.elm:20852`), 001 key publish plus DM-select key fetch, 401 fail-closed WHOIS sheet, WHISPER self-echo suppression (`Ircx.elm:1022`), ACTIVITY unreact (`App.elm:6849`), hot-upgrade "no signal".

#### Elm better than Solid
- 775/776 ACCESS notes become visible system rows in the room (`Ircx.elm:715-721`, `App.elm:8456`); in Solid they are 'Channel' service notices with no UI.
- FAIL ACCOUNTINFO clears `accountInfoPending` (`App.elm:20900-20916`); Solid leaves the loader stranded.
- STATUSMSG `@#chan` inbound files under the bare room with an audience badge (`foldChat` `statusAudience`, `App.elm:34706`); Solid has no handling.
- A nick-sourced global NOTICE is at least visible, filed as a DM (`dmFileBucket`, `App.elm:34634`); in Solid it lands in the Activity view and the `announcements` store, which has no UI.
- The first 001 prefix wins as the trusted server prefix for directory/E2EEKEY gating (`App.elm:21125`).

#### Gaps (ranked by user impact)
- `[High]` C57 server-native edits duplicate rows. In `foldChat` (`App.elm:34673`), before delivery, detect the `+draft/edit`/`draft/edit` tag, apply the `foldEdit` body/`edited` update to the row with that msgid from the same sender, and do the same in the history merge.
- `[High]` C113/C112/C86 there is no Activity/status buffer. Add a Rail "Activity — Network updates" entry and a `View.Activity` that renders `model.serviceLog` (newest last, `maxServiceLog`). Optionally tag the welcome, MOTD, WALLOPS, ERROR, numeric and umode entries.
- `[High]` C122 wrong-password copy and reconnect. In `failSasl` (`App.elm:9761`), `addNotification NotifError reason`, set `autoReconnect = False`, and add a `WsDisconnectWith {code=4003}` port.
- `[High]` C124 pre-registration nick collision hangs. Add a `nickRetries` counter to `foldNickError`: while `Registering`, send `NICK ourNick++"_"` up to 4 times before the alias and error path.
- `[High]` C123 registered-nick guest copy. In `foldNickError`'s 432-registered branch, add `NotifError "That nickname is registered. Sign in as its account before using it."` and disarm reconnect.
- `[High]` C92 labeled 401 makes a DM vanish silently. In `fold401`'s `afterLabel` branch (`App.elm:6087-6113`), call `notDeliveredToast` like `failLabeledSend`.
- `[Med]` C127 server ERROR reason is invisible. In the `"ERROR"` arm (`App.elm:5008`), add `NotifError` with the trailing text and keep it for the Connect copy.
- `[Med]` C131 offline/online handling. In `ports.js`, add `window` `offline` → `wsClose`/`online` → a `BrowserOnline` Msg → `reconnectNow` when `autoReconnect`.
- `[Med]` C36 `/join` and invites don't focus the room. In the self-JOIN branch (`App.elm:4718`), `selectChannel` unless a session-sync/restore replay is under way.
- `[Med]` C117 peer key change has no toast or inbox row. At the key-change detection sites (`App.elm:12721,12831,42927`), add an `addToast` "Encryption key changed" and an inbox `NotifError`, once per change.
- `[Med]` C101/C102 the 477/480/KNOCK outcome is invisible and the browser hangs 8 s. Map 477/480 through `setChannelJoinPrompt` ("Sign in to join this room" / "Joining too fast"); surface 710–714 as inbox system rows.
- `[Med]` C7 FAIL SESSION has no inbox row. In `foldSessionReply`, `addNotification NotifError errText`.
- `[Med]` C12 E2EEKEY account-panel failures. In `foldDirectoryFailure`, when there is no publisher send pending and an account key request is in flight, set `accountActionError` and add an inbox row.
- `[Low]` C79 MONITOR → DM presence dot. Write the DM away flag in `foldMonitorOnline`/`foldMonitorOffline`.
- `[Low]` C135 show `isupport.network` in OperDesk and the invite card copy instead of the hardcoded "Onyx".
- `[Low]` C37 append the `(user@host)` mask to join rows; keep the extended-join account.
- `[Low]` C128 include the close code in "Disconnected:" (pass `event.code` through `wsClosed`).
- `[Low]` C49/C25/C11 text-form logout/ACCOUNTSET confirmations, generic service notices, and the ACCOUNTINFO inbox row.
- `[Low]` C55 (shared bug) render inbound `\x01ACTION` as an action row instead of swallowing it, on both sides.
- `[Low]` C132 add a 1 MiB text-frame bound and an error notice in `ports.js`.

## Appendix

### N — Every narrowing recorded in `elm/COVERAGE.md`, classified

Each COVERAGE row ends with "Narrowings:" (or "narrowed", "stays ahead", "pending", "not ported")
clauses. All of them are listed here, keyed to the COVERAGE.md line of the row. Classes:

- **FIX** — client-fixable gap; the Elm client can close it alone.
- **STALE** — already resolved by a later slice; the narrowing text is out of date (evidence given).
- **KEEP** — deliberate hardening or a better-than-oracle choice; no action.
- **ORACLE-GAP** — Solid never had it either; optional new work, not parity.
- **BOUND** — needs the server, the host media engine, a browser/tooling capability, or an Elm
  platform limit.

| # | COVERAGE row (line) | Narrowing | Class | Evidence / fix sketch |
|---|---|---|---|---|
| N1 | Connect gate (29) | no remembered-identity picker / "Stay signed in" (no credential listing port) | FIX | add `credentialsList`/`credentialsForget` ports over `onyx:credentials`; picker in `View/Connect.elm` |
| N2 | Connect gate (29) | passkey sign-in hidden "like the oracle" | KEEP | oracle hides it too |
| N3 | Connect gate (29) | no invite-preview aside on `?join=` | FIX | reuse `Invite.card` in `View/Connect.elm` aside |
| N4 | Shell nav (30) | Appearance is the `/appearance` route, not an in-shell sheet | FIX | wrap `View/Appearance` body in `View.Sheet` from the You hub |
| N5 | Shell nav (30) | You hub omits device toggles / language / Advanced and Notifications/Preferences links | FIX (part STALE) | Preferences link landed with v3/prefs (`View/Prefs.elm`); language / Advanced still absent |
| N6 | Shell nav (30) | no focus trap / Escape (7.1) | STALE | v3/frame `installOverlayFocus` + `App.escapeMsg` (COVERAGE:220) |
| N7 | Shell nav (30) | Rooms/Messages drawer reuses the unsectioned rail | STALE | sectioned `Sidebar` (COVERAGE:199) and collection pages (`a9bbac3a`) |
| N8 | SASL (31) | "password entry UI still ahead" | STALE | `View/Connect.elm:198` `conn-password` |
| N9 | SESSION (54) | "bouncer rewind stays ahead" | STALE | COVERAGE:56 marks bouncer rewind dedup done |
| N10 | MODEX (76) | query-only; named modes not shown in the room header | FIX | render `model.modexModes` in `View/RoomSettings.elm` Advanced |
| N11 | BATCH (89) | replayed non-chat events (QUIT/NICK/JOIN/MODE) fold live, not scrollback-only | FIX | route batch-tagged non-chat lines to `divertReplayEvent` only |
| N12 | BATCH (89) | no unread bump on merge | KEEP | oracle merges never count live either |
| N13 | BATCH (89) | search/quarantine, multiline, history-targets "narrowed" | STALE | rows 90, 92, 109 mark them done |
| N14 | TARGETS (90) | no replay-JOIN roster divert | FIX | divert `@batch` JOINs away from `foldJoin` |
| N15 | TARGETS (90) | self-identity is nick-only (no equivalent-identity map) | FIX | track account + nick aliases in `isSelf` |
| N16 | TARGETS (90) | "no user-triggered rewind (no CHATHISTORY BEFORE surface)" | STALE | `ThreadShowEarlier` → `requestRewindHistory` (`App.elm:39196`, `39221`) |
| N17 | TARGETS (90) | live inbound DMs file under the wire target, not per peer | FIX (verify) | `dmFileBucket` exists; confirm all DM folds key by peer |
| N18 | TARGETS (90) | eviction ties break key-first vs insertion order | KEEP | cosmetic |
| N19 | Unread core (91) | ASCII-only keyword/nick tokens (oracle `\p{L}\p{N}_`) | FIX | Unicode letter table in `NotifyCenter`/keyword matcher (elm/regex lacks `u`) |
| N20 | Unread core (91) | no retained-row highlight re-projection | FIX | re-run classifier when highlight words change |
| N21 | Unread core (91) | no topic-read reconciliation | STALE | `reconcileChannelTopicUnread` (`App.elm:11387`) |
| N22 | Notifications (91) | no notification-center inbox rows / batching | STALE (part) | `View/Inbox.elm` inbox exists; batching still absent |
| N23 | Notifications (91) | no calm tiers | FIX | port `calmMode.ts` presets into `NotifyCenter` + sheet |
| N24 | Notifications (91) | no quiet-hours schedule (DND = manual + until) | FIX | port `quietHours.ts`; `notifyDndActive` reads a schedule |
| N25 | Notifications (91) | no smart-mute rules | FIX | port `smartMute.ts` + `SmartMuteSection` |
| N26 | Notifications (91) | plain (non-owner-suffixed) storage keys | FIX | owner-scoped keys like `deviceMemoryStorageKey` |
| N27 | Notifications (91) | no permission-request UI trigger | STALE | `notifyPermissionRequest` port (`Main.elm:524`, `1347`) |
| N28 | Ignore/mute (91) | no ignore-list / mute UI surface | STALE | Notifications sheet ignore list (COVERAGE:202), card Block |
| N29 | Ignore/mute (91) | inbound DMs key by wire target | FIX (verify) | as N17 |
| N30 | SEARCH (92) | no `?at=` time-travel fetch half for server results | FIX | issue `CHATHISTORY AROUND` on `ServerOpenResult` |
| N31 | SEARCH (92) | provenance badge missing on advanced mode, pins, media, menu, prefs | FIX | reuse `View.Search` badge helper |
| N32 | CTCP (93) | `+C` channel-mode gating of CTCP | FIX | refuse outbound CTCP into `+C` rooms |
| N33 | CTCP (93) | DCC | KEEP | absent by design (§16) |
| N34 | Thread paging (95) | no scroll/DOM coupling, aria-live muting, jump pill counts | STALE (part) | v3/transcript scroll bridge + pill (COVERAGE:204); aria-live muting + pill counts still absent |
| N35 | Thread paging (95) | no time-travel landing anchor | FIX | map vault ids onto chat rows in `threadAnchorIndex` |
| N36 | Thread paging (95) | no `forceUnread` one-shot | FIX | port `forceMarkFirstUnread` |
| N37 | Unread divider (96) | no review-handoff clear | FIX | clear divider on scroll-to-bottom from `scrollState` |
| N38 | Unread divider (96) | no conversation-brief detail line | FIX | port `MessageView` brief line |
| N39 | MessageWindow (97) | "thread paging state, earlier-messages affordance stay ahead" | STALE | COVERAGE:95 + `ThreadShowEarlier` |
| N40 | Boost/jump (98) | no TimeScrubber | STALE | v3/polish scrubber (COVERAGE:224) |
| N41 | Boost/jump (98) | openers topbar-only (no More tools / Cmd-K / `g d`) | STALE (part) | tray + palette entries landed; `g d` chord still missing |
| N42 | Boost/jump (98) | copy-moment feedback rides the toast; native date/time inputs | KEEP | acceptable |
| N43 | Boost/jump (98) | no focus trap or motion | STALE | v3/frame sheet focus |
| N44 | Timestamps (101) | unparseable tags fall back to receipt time | KEEP | fail-closed hardening (Elm better) |
| N45 | Timestamps (101) | `±HH` accepted where V8 rejects | KEEP | harmless leniency |
| N46 | Timestamps (101) | clock shows UTC, not local / 12h | STALE | `formatRowClock` + `Time.here` (COVERAGE:198 message clock) |
| N47 | IRCX pins (108) | no ProvenanceBadge chrome | FIX | see N31 |
| N48 | IRCX pins (108) | no per-row focus-move | FIX | `Browser.Dom.focus` on the landed row |
| N49 | IRCX pins (108) | no `⋯`-menu pin entry | STALE | menu pin toggle (COVERAGE:198 "menu pin/ignore/collapse") |
| N50 | IRCX pins (108) | no scroll effect for `historyLanding` | STALE (part) | scroll bridge lands dividers; verify pin landing scrolls |
| N51 | Mesh (129) | no LINKS/MAP/MESH/NETSTAT/ROUTE/NETHEALTH surface | ORACLE-GAP | optional oper desk tab |
| N52 | Netsplit (131) | no netsplit/netjoin BATCH render | ORACLE-GAP | collapse into one system row |
| N53 | Group roster (168) | no conflict/unchanged gate ports-side | KEEP | provisions only arrive from verified welcomes |
| N54 | Store seal (172) | "epoch-key provisioning still awaits the E2EEGROUP control plane" | STALE | Welcome open + install done (COVERAGE:166) |
| N55 | Vault (184) | import does not revive reactions/replyTo/flags; strict-ISO subset; `exportedAt` fallback | FIX (Low) | extend `VaultImport.parseVaultExport` |
| N56 | Vault (184) | no Ollama provider | KEEP | oracle library-only, zero callers |
| N57 | Saved searches (188) | owner-scoped DBs narrowed to the default DB | FIX | owner suffix on `onyx-vault-searches` |
| N58 | Saved searches (188) | locale case mapping, non-ISO → nowMs | KEEP | documented |
| N59 | Home (196) | no vault catch-up, resume points, recaps, formation strip, recently-visited, invite tier | FIX | port `catchup/*`, `HomeFormationStrip`, `SinceDigestCard` |
| N60 | Home (196) | coach shows for any guest session (not connect-handoff) | FIX | gate on first-hour handoff flag |
| N61 | Home (196) | dismissal not persisted | STALE | `onyx:first-hour-seen` (COVERAGE:224) |
| N62 | Home (196) | queued rows lack per-row Open/Remove | FIX | reuse `outboxReview` port (Prefs already discards) |
| N63 | Home (196) | inbox rows omit relative time | FIX | `relativeTime` helper |
| N64 | Home (196) | first-run notifications prompt not ported | STALE | v3/polish (COVERAGE:224) |
| N65 | App core / WHOIS (198) | signed-on renders UTC ISO | FIX (Low) | use `model.zone` |
| N66 | App core / card (198) | no Message/Report buttons, no moderation controls | STALE | roster slice (COVERAGE:206) + moderation controls |
| N67 | App core / avatars (198) | service mark empty (no `elm/svg`) | BOUND | vendor `elm/svg` or CSS-mask glyph like `View.Icon` |
| N68 | App core / avatars (198) | astral names hash by code point | FIX (Low) | UTF-16 unit hashing helper |
| N69 | App core / facepile (198) | faces open the card, no popover; `toLower` tiebreak | FIX (Low) | popover via `View.Sheet` |
| N70 | App core / thread panel (198) | replies listed only once the parent row is loaded | FIX | fetch parent via `requestPinnedMessage`-style AROUND |
| N71 | App core / topics (198) | owner trim vs reject; no whole-device wipe port; msg/notice types only | FIX (Low) | add wipe port |
| N72 | App core / moderation desk (198) | candidate order alphabetical; desk clock UTC | FIX (Low) | keep join order; use `model.zone` |
| N73 | App core / identity overrides (198) | no soft-ignore enforcement, no nick-colour rendering, no management UI | ORACLE-GAP | Solid never rendered them either |
| N74 | App core / identity overrides (198) | saves fire-and-forget (no round-trip verify) | FIX (Low) | ack port |
| N75 | App core / export (198) | success toast assumes the download click | FIX (Low) | ack from `TranscriptDownload` |
| N76 | App core / message menu (198) | flattened tiers; text buttons; msgid-less rows get no menu | STALE (part) | icon row toolbar (`View/Thread.elm:381`, `fea215e3`); msgid-less rows still have no menu |
| N77 | App core / translation (198) | no caption-transcript row | STALE | caption translate (COVERAGE:219) |
| N78 | App core / quote + edit (198) | no per-target drafts, no menu Edit, no Escape-to-cancel | STALE | per-target drafts + Escape cancel (COVERAGE:198 later text) |
| N79 | App core / composer (198) | no caret/focus motion (insert at end) | FIX | `setSelectionRange` port |
| N80 | App core / clock (198) | 12-hour shape fixed `h:MM AM/PM` | KEEP | acceptable |
| N81 | App core / search (198) | "no mode toggle" | STALE | vault mode cycle (COVERAGE:184) |
| N82 | Sidebar (199) | no folders / hidden rooms / closed conversations / Activity entry / roving arrows | FIX | port `channel/categories.ts`, `hiddenRooms`, `closedConversations` |
| N83 | Sidebar (199) | no Rooms·Messages collection modes | STALE | collection pages (`a9bbac3a`) |
| N84 | Sidebar (199) | activity from newest buffered row; DM time stamp shown; empty DM shell inserted | KEEP | deliberate |
| N85 | Palette (200) | no recents, time grammar, people/extension/theme rows; no Alt+↑/↓, J/K, G-sequences | FIX | see section K |
| N86 | Uploads (201) | compact recompression + EXIF file ops ports-side | KEEP | correct split |
| N87 | Uploads (201) | media panel: no `partial` vault status; trigger is a toggle; id-less rows jump by stamp | FIX (Low) | — |
| N88 | Uploads (201) | media panel has no CSS | STALE | pol-thread (`a5166772`) |
| N89 | Notify UI (202) | no quiet hours, calm presets, smart mute, room folders | FIX | as N23–N25, N82 |
| N90 | Notify UI (202) | no roving arrows on the strip; keyword sort codepoint | FIX (Low) | — |
| N91 | Notify UI (202) | no focus trap | STALE | v3/frame |
| N92 | Transcript (204) | instant jump; aria-live not muted on prepend; no spacer virtualisation; continuation timestamps inline | FIX (Low) | — |
| N93 | Transcript (204) | compact density is Elm-only | KEEP | Elm addition |
| N94 | Composer assist (205) | no caret tracking; single-line `input` | STALE (part) | the field is a growing `textarea` with Shift+Enter newline (`View/Composer.elm:98`, `629`); caret-position insert still missing (N79) |
| N95 | Composer assist (205) | no recent/usage emoji counters, no focus restore after insert | FIX | port `emojiMemory.ts` |
| N96 | Composer assist (205) | More tools tray not ported | STALE | v3/polish tray |
| N97 | Roster (206) | no windowing, skeleton, "Refreshing members", mobile "Find someone"/"N here", header ledger link | FIX | `rosterSyncing` state + `memberWindow` port |
| N98 | Ship (207) | no real browser (geometry, focus, screenshots, axe) | STALE (part) | `elm/tools/screens*.mjs` real Chromium screenshots (`1bec059d`); axe + Playwright journeys still absent |
| N99 | Ship (207) | "Back online" after the very first connect | STALE | fixed in v3/polish (COVERAGE:224) |
| N100 | Ship (207) | no minification / CSP | STALE (part) | esbuild minify (`8abb6b12`); CSP still pending |
| N101 | Moddesk (209) | no prose spine-notice rows; feed not reset on reconnect; no review-authority snapshot | FIX | — |
| N102 | Moddesk (209) | network name shown as "Onyx" | FIX | fold ISUPPORT `NETWORK` into the model |
| N103 | Moddesk (209) | no focus trap | STALE | v3/frame |
| N104 | DM safety (211) | accept re-pins the whole live device set (oracle pins the single pending key) | FIX (security) | pin only the presented key in `acceptKeys` |
| N105 | DM safety (211) | key change detected only on seal/open, not directory update | FIX (security) | compare pins in the 761 `ocean.dm-key(s)` fold |
| N106 | DM safety (211) | no `navigator.share` | FIX | share port with copy fallback |
| N107 | DM safety (211) | "Not encrypted" chip | KEEP | Elm addition (better honesty) |
| N108 | DM safety (211) | room Invite button in a thread header row | STALE | room header More menu (`View/RoomHeader.elm:265`) |
| N109 | Prefs (213) | no App & tools tab (PWA / extensions / local language) | FIX | — |
| N110 | Prefs (213) | width / reader / experience / reaction-density / scrubber / voice / topic / watch toggles not surfaced | FIX | — |
| N111 | Prefs (213) | no local-history toggle; no clear history / reviewed anchors / saved searches / topic reads / followed | FIX | — |
| N112 | Prefs (213) | no gzip / file-save / share export, no staged import review | FIX | port `portable*` |
| N113 | Prefs (213) | no storage-persistence / estimate cards, no a11y audit ledger | FIX | `navigator.storage` port |
| N114 | Prefs (213) | Hide join/part/quit hides only those three types | KEEP | arguably better |
| N115 | Prefs (213) | "no command palette entry (no palette exists yet)" | STALE (reason) | palette exists; the Preferences row is still missing (K58) |
| N116 | Calls C1 (215) | local health mute-only; no quality pip; no "local media unavailable"; More holds a disabled voice-settings stub; no `aria-keyshortcuts` | STALE | C4, C8/C9, C10, C12 (COVERAGE:218–226) |
| N117 | Calls C1 (215) | chip lives in the topbar (no room header) | STALE | `View/RoomHeader.elm` |
| N118 | Calls C1 (215) | `voiceEntry = off` fallback hides; stage docked in column; focus helper does not `inert` | FIX (Low) | — |
| N119 | Calls C1/C6/C4/C8 | 375px verified by CSS review only | STALE (part) | screens.mjs can now shoot 375px |
| N120 | Calls C1/C6/C8 provisional | join-muted default on; privacy-code slot empty; peer fingerprints via snapshot | BOUND | spec §7 product answers |
| N121 | Calls C6 (216) | PiP position shape differs; no PiP video strip; phone dock top-right | FIX (Low) | — |
| N122 | Calls C6 (216) | removed-by-op / capacity toasts | FIX | map MEDIA FAIL codes |
| N123 | Calls C6 (216) | codec toasts need engine `errorKind`; post-RESUME window not "reconnecting" | BOUND | engine reporting |
| N124 | Calls C4 (218) | `stopScreenShare` missing in the host engine | STALE | `elm/media/voice-core.ts:878` |
| N125 | Calls C4 (218) | 200ms call clock granularity; native PiP label; no tile role badges; camera/share disabled while ringing | FIX (Low) | — |
| N126 | Calls C4 (218) | no `aria-keyshortcuts`; reconnect dimming waits for C10 | STALE | C10, C12 |
| N127 | Calls C4 (218) | remote screen peers force screenshare layout; deafen local-only | BOUND | §7.3 / §7.4, needs server DEAFEN |
| N128 | Calls C8 (219) | caption dimming, captions dock in flow, translate-unavailable note dropped, glyph-only reaction chips | FIX (Low) | — |
| N129 | Calls C8 (219) | DM calls have no reaction plane; VAD/noise only when engine exposes | BOUND | server/engine |
| N130 | Frame (220) | no visual-regression baselines | STALE (part) | screens.mjs exists; no baseline diffing |
| N131 | Frame (220) | no `Feature/X` registry blocks | FIX (arch) | — |
| N132 | Frame (220) | facepile / notify strip / DM safety trigger in the transcript | STALE | moved to `View/RoomHeader.elm` (COVERAGE:223) |
| N133 | Frame (220) | thread / pins / members are sheets, not right-rail panels; backdrop not `inert` | FIX | — |
| N134 | Account2 (221) | portable residence: no folders / quiet hours; prefs not imported; `+` bookmarks not starred | FIX | tied to N82/N24 |
| N135 | Account2 (221) | theme copy feedback no 1.6s reset; share field no select-on-focus | FIX (Low) | — |
| N136 | Account2 (221) | custom-status expiry not timer-enforced | KEEP | oracle does not enforce either |
| N137 | Room settings (223) | sheet lacks invite builder, transcript export, hide / leave, topic-draft durability | FIX | — |
| N138 | Room settings (223) | webhooks only via Room care; group-control mark has no lifecycle; insights no error state | FIX (Low) | — |
| N139 | Room settings (223) | no context rail (3.8 `ContextRail`) or heatline | FIX | Elm's right column is the roster only |
| N140 | Polish (224) | `Insert /` prefixes the draft (no caret) | FIX | caret port (N79) |
| N141 | Polish (224) | Elm build registers no service worker (update strip + push are inert without one) | FIX (High) | ship `sw.js` in `tools/build.sh` + register in `ports.js` |
| N142 | Polish (224) | no zig-desktop surface | BOUND | desktop shell |
| N143 | Calls C11 (226) | no stage verb on the server; Dismiss is local; only the starter hosts | BOUND | server |
| N144 | Calls C11 (226) | "Hand chord drives only the stage hand; captions chord waits for C8" | STALE | C8 merged both chords (COVERAGE:219) |
| N145 | Divergences (233–250) | u32 epochs; UTF-8 byte counting; 32-bit `truncate`; crypto behind ports | BOUND | Elm platform |
| N146 | Security review (247) | reactions + typing remain plaintext metadata in E2EE DMs | BOUND | needs a sealed TAGMSG design server-side |

**Tally:** 146 narrowings → FIX 72 (incl. Low and verify items) · STALE 45 (incl. 10 part-stale, where a remainder is still FIX) · KEEP 17 · ORACLE-GAP 3 · BOUND 9.

#### Structural problems in COVERAGE.md itself
- The "App core" row (line 198) is a single ~25 KB table cell with nested, unbalanced parentheses; several of its own narrowings are contradicted later in the same cell (per-target drafts, Escape-to-cancel, menu Edit).
- Lines 246–247 (DM key hold, security review) sit after the "Known divergences" bullet list with no table header, so they do not render as table rows.
- "All 13 routes resolve" (line 197) — `src/index.tsx` now has 13 app routes plus the PublicInfo/Trust/Install aliases; the count is no longer meaningful.
- The doc's scope is "onyx-server feature coverage"; it never claims UI reachability, so "done" frequently means "fold + vectors", not "a user can reach it". Section B/E/F rows marked CORE-ONLY are the concrete cases.

#### Structural problems in V3_ROADMAP.md
- Phase 1 lists rows 1.1–1.7 twice and Phase 2 lists 2.4–2.6 twice and Phase 3 lists 3.4–3.7 twice with conflicting statuses (one copy "done", the other blank/size-only).
- The C1–C12 summary is duplicated with contradicting flags (C4/C5 "**done**" in one line, plain in the other; C6/C7/C10 the reverse).
- 1.3 says "in-shell sheet not built" (still true); 1.4a "Land on Home… absorbs the catch-up digest" has no status but catch-up (2.7) is not built.
- Still-open rows with no Elm work at all: 0.3 remembered identities, 0.4 invite aside, 2.7 catch-up digest, 2.8 BlockKit, 2.9 edit-history view, 3.9 Harbor confirm, 4.2 smart mute + folders, 4.5 history import, 6.7 Watch Together, 7.6 visual regression baselines.
