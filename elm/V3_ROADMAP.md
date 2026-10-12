# Onyx v3 (Elm) — build-out roadmap

Goal: the Elm client becomes a complete, shippable Onyx — every surface a
user could reach in the (now removed; tag `solid-client-final`) SolidJS client is reachable here, and it works and
feels finished, not just correct in unit tests.

This file is the plan and the status per slice. What is missing, row by row, is in
[`design/CLIENT_PARITY_MAP.md`](design/CLIENT_PARITY_MAP.md) (client) and
[`design/SERVER_FEATURE_MAP.md`](design/SERVER_FEATURE_MAP.md) (server); the protocol ledger is
[`COVERAGE.md`](COVERAGE.md); the index of design docs is [`design/INDEX.md`](design/INDEX.md).

## Where we are (2026-10-11)

Measured on release `609cb240` (every slice below merged), in a clean worktree:

| Gate | Result |
|---|---|
| `elm make src/Main.elm` | OK |
| `elm-test` | **5,320 tests** in 144 test modules, 0 failed |
| `*.smoke.mjs` (jsdom suites over the real bundle and `ports.js`) | **89 suites**, 0 failed |
| `node elm/tools/css-coverage.mjs` | 2,726 classes used, 0 unstyled, 0 undefined variables |
| Routes (`elm/src/Route.elm`) | 19 routable paths (`/`, `/about`, `/app`, `/appearance`, `/stats`, `/status`, `/roadmap`, `/invite`, `/guides`, `/community`, `/privacy`, `/guidelines`, `/contact`, `/accessibility`, `/glossary`, `/integrations`, `/agents`, `/onyxos`, `/download`) plus the `/install` alias and a 404 page |
| Size | 192 Elm modules (about 180,000 lines), 31 stylesheets |

On 2026-10-10 the baseline was 2,571 elm-tests and 60 smoke suites, and the in-shell experience was
the weak part: a bare three-column skeleton with no way to choose a name, no navigation, plain-text
messages, and dozens of features that existed in `App.elm` with no UI. Since then the shell, conversation,
settings, account, moderation, operator, calls and public-site slices all landed (progress log below).
The client parity map now counts 1,154 of its 1,419 reachable Solid capabilities as FULL (81%), 166 as PARTIAL
and 94 as MISSING (it was 935 / 228 / 226 of 1,420).

**Status words.** *done* = implemented, tested, and a user can reach it. *partial* = reachable with a named
gap. *todo* = not built. A row is not *done* because a fold exists.

**What is still open** (rows and evidence: *Remaining gaps* in the parity map; no High-ranked gap remains):
- **Needs the server:** ordinary members cannot join a Watch Together activity (only operators can write the channel property); there are no DM calls (no 1:1 media target); video is deliberately off on the live network (node SendQ).
- **Home catch-up depth:** resume points, recently visited rooms, Invites tier, formation strip, vault-backed offline catch-up. **Context rail** and a combined mobile Room control desk.
- **Settings and data:** the "App & tools" tab, storage persist/estimate, clear cards for anchors/follows/topic reads, portable export beyond vault rows (the residence file ignores folders and quiet hours), saved searches and the auto-join memory still device-wide, cold paint and offline reload.
- **Conversation:** swipe-to-reply and long-press, archived-search and left-room jumps, caret-aware nick completion, sealed (encrypted) rows cannot be edited.
- **Commands:** palette time grammar and a handful of palette rows and chords.
- **Calls:** local recording, SFU/network stats readout, changed media key not folded into the DM key review.
- **Ship:** a CSP (the page still has an inline boot script), a Playwright suite and pixel baselines for the Elm build.
- **Smaller defects found by the doc refresh:** fragment-only URL changes refetch on `/stats/` and `/download/`, the timed block's auto-lift only lives as long as the tab, the card's Block skips the opt-in server `SILENCE` mirror, closing the Account panel keeps the typed passwords, closed-tab push ignores quiet hours.

## Rules for every slice

- One slice = one commit: `App` fold + `View` + vectors + COVERAGE row.
- Oracle-mirrored copy, aria names and `data-testid`s.
- Gates: `elm make src/Main.elm`, full `elm-test`, all `*.smoke.mjs`, `css-coverage` 0 / 0, and for anything visual
  `node elm/tools/screens.mjs --vp all` with zero PROBLEM lines (15 viewports, 320×568 to 3440×1440).
- No new wire paths when a fold already exists; UI wires existing folds.
- No horizontal scroll at 320 px; 44 px touch targets on touch devices.

**v3 ship bar:** connect → Home → open room → send → DM → settings → appearance, keyboard-only and at 375 px, with
elm-program-test flows, real-browser screenshots and the aspect-ratio matrix green.

## Phase 0 — Front door (unblocks everything)

| # | Surface | Oracle | Status |
|---|---|---|---|
| 0.1 | Connect gate: guest / sign in / create account / recovery code, room field, status copy, Cancel | `app/Connect.tsx` | **done** (`c18b9591`); v3/gap-auth adds the two-step sign-in, forgot password, passkey sign-in and honest failure copy |
| 0.2 | Leave / disconnect returns to the gate | `ServerRail` disconnect | **done** (`c18b9591`; v3/gap-shell: Leave asks first) |
| 0.3 | Remembered identities + "Stay signed in" (ports listing seam over `onyx:credentials`) | `Connect.tsx`, `lib/credentials.ts` | **done** (v3/rx-public): `credentialsRequest` / `credentialsListed` / `credentialsReady` ports (metadata only; `use` arms the SASL holder ports-side), `Remembered` + the "Welcome back" panel in `View.Connect`, Solid's v2 store read and carried through writes; `rememberedIdentities.smoke.mjs`, `RememberedTest` |
| 0.4 | Invite preview aside when arriving via `?join=` | `Connect.tsx` `conn-context` | **done** (v3/rx-public): room, inviter (`by`), topic, company (`with`), access-rules note |
| 0.5 | Session-expired "Sign in again" banner | `SessionReclaimBanner` | **done** (v3/account2: four-phase banner in the shell notices strip) |
| 0.6 | Real-browser run of the Elm build at phone / tablet / desktop sizes | `tests/e2e/` | **partial.** The logic half is `ShipFlowTest` (elm-program-test, 6 keyboard-only flows) and `bundleBoot.smoke.mjs` (jsdom boots a fresh `--optimize` bundle with the real `ports.js`). The browser half is `elm/tools/screens.mjs`: real Chromium (playwright-core) against the built bundle and a fake IRC server, 15 viewports with per-slice scenario files and PROBLEM lines for overflow and page errors; `elm/tools/call-e2e.mjs` drives two real browsers through a call on a throwaway local node. **Not there:** a `pnpm test:e2e`-style Playwright suite for Elm, axe, pixel baselines |

## Phase 1 — Shell skeleton that feels like Onyx

| # | Surface | Oracle | Size | Status |
|---|---|---|---|---|
| 1.0 | Shell frame + tokens: token ladder, one frame grid, `View.Sheet` primitive with one focus-trap mechanism, `role="log"` transcript container, 375 px gate | (new; absorbs 7.1, 7.2, 7.6) | L | **done** (v3/frame, then v3/rx-shell and v3/rx-sheets: the frame on every aspect ratio, overlays per viewport class, pinned heads, Escape closes one sheet) |
| 1.1 | Primary navigation: Home / Rooms / Messages / Calls / You (desktop rail + mobile bottom nav) | `PrimaryNavigation`, `navigation/shellNavigationModel` | M | **done** (v3/nav) |
| 1.2 | "You" entry for guests and accounts (settings hub: Account / This device / Help) | `YouSettings`, `YouHubNav`, `Account.tsx` guest branch | M | **done** (v3/nav) |
| 1.3 | Appearance reachable from the shell (link + in-shell sheet) | `AppearancePanel`, `ServerRail` | S | **partial** (v3/nav): the You hub links to the `/appearance` route; an in-shell sheet is not built |
| 1.4 | Home briefing: welcome, first-room prompt, invite friends, recaps, Mark all caught up | `home/HomeBriefingView`, `HomeView` | L | **partial.** Done (v3/home, v3/gap-organize, v3/gap-shell, v3/gap-claim): welcome, first-room prompt, invite friends, "Since you left" digest with first-unread landing, offline-memory note, queued-send Open / Remove, MOTD card, legacy-history claim card, Mark all caught up. **Open:** resume points, recently visited rooms, Invites tier, formation strip, vault-backed offline catch-up |
| 1.4a | Land on Home after connect; Home absorbs the catch-up digest | (new) | M | **done** |
| 1.5 | Sectioned sidebar: Favorites (starred), Rooms, DMs with previews, filter, unread/mention badges, New conversation; folders, hidden rooms, closed conversations | `ChannelSidebar` | M | **done** (v3/sidebar, v3/gap-organize; v3/rx-shell adds the row menu) |
| 1.6 | New conversation (DM starter) sheet | `NewMessageSheet` | S | **done** (v3/sidebar) |
| 1.7 | Quick switch (Ctrl+K) → action palette | `chat/spotlight/Spotlight`, `RoomSwitcherSheet` | S | **done** (v3/switcher: rooms, DMs, shell actions, fuzzy rank, combobox; v3/gap-commands: People, recents, the oracle action rows, `#room` / `mute N` grammar). **Open (Low):** time grammar and a few rows |
| 1.8 | Keyboard shortcuts overlay (`?`) | `ShortcutsOverlay` | S | **done** (v3/switcher: one `shortcut` port; v3/gap-commands: shell chords, J/K, `g h` / `g d`, the single-key switch). **Open (Low):** Ctrl/Cmd+H, Ctrl/Cmd+Shift+R; Alt+M only focuses the always-visible member rail |
| 1.9 | First-hour coach + first-run notifications prompt | `FirstHourCoach`, `FirstRunNotifyPrompt` | S | **done** (v3/home coach; v3/polish: dismissal persisted in `onyx:first-hour-seen`, quiet notify sheet after the first send) |
| 1.10 | Empty-room intro ("Say hi") | `MessageView` intro | S | **done** (v3/home) |

## Phase 2 — Messages that render like a modern chat

| # | Surface | Oracle | Size | Status |
|---|---|---|---|---|
| 2.0 | Transcript engine: `Html.Keyed` + `Html.Lazy` rows, scroll anchoring port, unread divider, jump-to-latest, windowing | (new) | L | **done** (v3/transcript: keyed + lazy rows, `role=log`, `scrollPolicy` / `scrollState` bridge, Jump to latest pill; windowing is `threadWindowFor` + Show earlier) |
| 2.0b | Density modes (Default / Compact) + grouping as view-model | (new) | S | **done** (v3/transcript, `TranscriptRows`) |
| 2.1 | Rich message text: clickable links (safe schemes only), channel links, mentions | `message/MessageText` | M | **done** (2026-10-10) |
| 2.2 | mIRC formatting (bold / italic / underline / colour / reset) | `MessageText` | M | **done** (2026-10-10) |
| 2.3 | Markdown subset: inline code, code blocks, blockquote, spoiler | `MessageText` | M | **done** (2026-10-10) |
| 2.4 | Composer: emoji picker, nick completion, slash-command suggestions, More tools | `Composer` | M | **done** (v3/composer, v3/polish tray; v3/gap-convo: caret-aware emoji insert, paste / drop, per-room drafts). **Open (Low):** nick Tab-completion and "Insert /" ignore the caret |
| 2.5 | "Add a boost" on the boost bar | `BoostBar` | S | **done** (`boost` slice: ＋ opener per row into the reaction picker) |
| 2.6 | Jump to date + time scrubber | `JumpToDateSheet`, `TimeScrubber` | S | **done** (`boost` slice: sheet + topbar entry over `requestTravelTo`; v3/polish: 24 h UTC scrubber from the room More menu) |
| 2.7 | Catch-up: "Since you left" digest, mark caught up | `CatchUpSummary`, `SinceDigestCard` | M | **done on Home** (v3/gap-organize: digest per catch-up row, jump to the first unread line, skips your own lines). **Open (Low):** the in-room card above the unread divider |
| 2.8 | BlockKit structured-action modal + send review | `message/BlockKitModal` | M | **done** (v3/gap-import: strict `[onyx:block]` decoder, inline cards, URL / copy buttons, origin-scoped send review, "Inspect structured data" dialog) |
| 2.9 | Local edit-history view, context trail | `MessageView` | M | **partial.** Edit history is done (v3/rx-convo: disclosure on edited rows over `revisionsFor`; v3/gap-convo: server-native `+draft/edit` edits fold in place). **Open (Low):** the reader-memory / context-trail strip |

## Phase 3 — Rooms and people

| # | Surface | Oracle | Size | Status |
|---|---|---|---|---|
| 3.1 | Room header: privacy, facepile, voice chip, overflow menu (settings, invite, mark read, export, ledger, leave, room care) | `PresenceRibbon`, `PresenceHeatline` | M | **done** except the heatline (v3/frame, v3/roomsettings, v3/gap-shell: Mark as read, Export transcript, Room ledger, Leave room in More; the pulse lives in Room settings › Insights) |
| 3.2 | Room settings sheet: topic, notifications, rules, history policy, roles, encryption, visibility, integrations, bridge status | `ChannelSettings` | M | **done** (v3/roomsettings; v3/gap-chanserv adds welcome message, slow mode, "More rules", mutes / exceptions / invite passes, and registered-room services: register, info, locked rules, account access, auto-kick, successor, "Your rooms"; v3/gap-people: webhooks for any host, transcript export). **Open (Low):** invite builder and Leave are not inside the sheet; no topic-draft durability |
| 3.3 | Per-room notify level, quiet hours, calm mode | `ChannelNotifyControl`, `NotificationControls`, `CalmModeControl` | M | **done** (v3/notify: All / @ / Mute strip + sheet; v3/gap-organize: quiet hours with an on/off switch, Calm / Regular / Power presets, smart mute). **Open (Med):** closed-tab Web Push has no schedule, so it ignores quiet hours |
| 3.4 | Invite friends share sheet | `RoomInviteShare` | S | **done** (v3/dmsafety: sheet from Home + room header; copy via `ClipboardCopy`; no native share) |
| 3.5 | Member list: filter, avatars, presence / away, DM action | `MemberList` | M | **done** (v3/roster: Filter members, count, avatar + presence dot, role / away in words, per-row Message; v3/gap-people: windowed roster). **Open (Low):** loading skeleton |
| 3.6 | Profile card: Message / Report / moderation controls | `PeopleProfileCard` | S | **done** (v3/roster; v3/gap-people: controls gated by server role and rank) |
| 3.7 | DM E2EE safety number + key-change banner | `DmSafetySheet`, `DmKeyChangeBanner` | M | **done** (v3/dmsafety: posture chip, Verify panel, inline key-change row; v3/gap-pwa-safety: directory updates raise the review, sends held, acceptance pins only reviewed keys) |
| 3.8 | Room insights strip, context rail, scheduled-event line, bridge badge, group-control mark | `RoomInsightsStrip`, `ContextRail`, `ScheduledEventLine`, `BridgeStatusBadge` | M | **done** except the context rail (v3/roomsettings: insights in Room settings; event line, bridge badge and group-control mark in the header) |
| 3.9 | Harbor confirm sheet for room verbs | `HarborConfirmSheet` | S | **partial.** Leave room asks first (v3/gap-shell `leaveConfirm`) from the room menu and rail menu. **Open (Med):** the palette Leave row and `/part` skip it; Close conversation has no confirm |

## Phase 4 — Settings and account completeness

| # | Surface | Oracle | Size | Status |
|---|---|---|---|---|
| 4.1 | Device preferences panel: display, accessibility, conversation, privacy, history & data, vault, drafts, queued sends | `PreferencesPanel` | L | **partial.** Tabs: Display · Conversation · Privacy · History & data · Import & export · Accessibility (v3/prefs; v3/gap-appearance: Text size, Density, Conversation width, reaction density, voice entry, topic tools, blocked hosts; v3/gap-account: local-history switch, verified erase, saved-search clear and export). **Open:** the `App & tools` tab (PWA readiness, refresh shell, extensions), storage persist / estimate, clear cards for reviewed anchors / follows / topic reads, topic drafts |
| 4.2 | Mention keywords, ignored users, smart mute, room folders | `KeywordListControl`, `IgnoredUsersControl`, `SmartMuteSection`, `ChannelOrganizationSection` | M | **done** (v3/notify: keywords + ignored users; v3/gap-organize: smart mute, folders, hidden rooms, closed conversations; v3/gap-account: per-account lists) |
| 4.3 | Revoke other devices | `SessionsDevicesSection` | S | **done** (v3/account2: bulk revoke with inline confirm) |
| 4.4 | Portable identity export / import | `PortableIdentitySection` | S | **partial** (v3/account2): the residence file carries favorites only; it writes empty folders and the default quiet window and ignores them on import, and the report still says "Room folders aren't available in this client yet" |
| 4.5 | History import (Discord / Slack / IRC logs / vault) | `HistoryImportControls` | M | **done** except the Discord bot-token route (v3/gap-import: worker-parsed, reviewed before any write, retention-aware, undoable; bot-token needs the `/discord-import` proxy) |
| 4.6 | Theme share / import by code or link dialog | `ThemeImportDialog` | S | **done** (v3/account2: sheet from the You hub and `/appearance`) |
| 4.7 | Friends / watch list, custom status, DND UI | `App` folds | M | **done** (v3/account2: People sheet, You hub status / presence / DND block, friend presence on DM rows; expiry shown, not timer-enforced) |
| 4.8 | Account depth the oracle never showed: Protection ("Require sign-in", "Hold this name"), Recover a name, recognised addresses, grouped names, auto-join, privacy user modes, server blocks, caller-id, offline messages, per-account lists | server `accounts`, `user.query` | M | **done** (v3/gap-account, v3/gap-usermodes) |

## Phase 5 — Moderation and operators

| # | Surface | Oracle | Size | Status |
|---|---|---|---|---|
| 5.1 | Moderation cockpit: room desk, invite form, current-room header | `ModerationCockpit` | S | **done** (v3/moddesk; v3/gap-people: role-gated, read-only "Room safety" for members, timed block review, handover offers) |
| 5.2 | Oper desk (broadcast / kill / rehash) + event console with filters | `OperDesk`, `OperEventConsole` | M | **done** (v3/moddesk) |
| 5.3 | Operator console: live Event Spine feed, network bans, silencing, abuse insight, appeals (user + oper side), content controls, accounts admin, node controls, reports, audit trail | server `oper_cmd.zig` / `server.zig` (no oracle) | L | **done** (v3/gap-oper: seven tabs, every change reviewed). Not done: force actions, GLOBAL audiences, GRANT / REVOKE (the `GRANTS` listing is read-only), AUDIT PROOF verification, VHOST approvals, TRACE, integrations (BOTGRANT / OUTHOOK), `+M` media deny |

## Phase 6 — Voice and video

Replaced by the calls design: spec + prototype in [`design/calls/CALLS_DESIGN.md`](design/calls/CALLS_DESIGN.md) and
[`design/calls/prototype.html`](design/calls/prototype.html). Slices C1–C12 (acceptance criteria in spec §6) supersede the
original rows 6.1–6.7 (voice bar → C2; stage and tiles → C4 / C5; overlays and announcer → C2 / C6; settings → C9; PiP → C7;
captions and reactions → C8; stage → C11).

| Slice | Surface | Size | Status |
|---|---|---|---|
| C1 | Presence + join banner | M | **done** (`v3/calls-c1`: `CallUi`, `View.CallPresence`, `View.CallStage`; 45 `CallsC1Test` vectors) |
| C2 | Voice-only stage + control bar v1 + announcer | M | **done** (`v3/calls-c1`) |
| C3 | Security chip + privacy sheet | S | **done** (`v3/calls-c1`) |
| C4 | Camera / share / deafen commands + connection quality | M | **done** (`v3/calls-c4`: `CallMedia`, one `voiceCommand` and one `voicePeerState` port; 34 `CallsC4Test`). **Camera is switched off on the live network:** `VIDEO_ENABLED = false` in `media/voice-engine.ts` fails closed on every path (`a96afd2e`), Camera and "Join with video" are hidden |
| C5 | Video grid, tiles, layouts, dominant speaker, paging of 16 | L | **done** (`v3/calls-c4`; `voiceTiles.smoke.mjs`); same video-off caveat |
| C6 | DM ring overlays | S | **done in Elm, unreachable on the server.** The overlays and `CallDock` exist (`v3/calls-c6`; `voiceRing.smoke.mjs`), but the server's `MEDIA` plane has no 1:1 target, so a DM call fails closed and the DM More menu says "Direct calls aren't available yet" |
| C7 | Picture-in-picture | M | **done** (`v3/calls-c6`) |
| C8 | Captions + reactions | M | **done** (`v3/calls-c8`) |
| C9 | Voice settings + push to talk | M | **done** (`v3/calls-c8`) |
| C10 | Reconnecting + classified errors | S | **done** (`v3/calls-c6`; v3/rx-calls: calm per-word toasts, provisional join) |
| C11 | Stage mode (speakers vs audience, raised hands, invites, end / leave) | L | **done** (`v3/calls-c11`: `Stage`, `View.StageMode`; 36 `CallsC11Test`). Stage is a client convention: the server has no stage verb |
| C12 | Shortcuts + a11y pass | S | **done** (`v3/calls-c11`: `callKeys.smoke.mjs`) |
| 6.7b | Watch Together (`PROP ocean.watch`) | L | **done, with server limits** (v3/gap-watch: `WatchTogether`, room card, preference; 178 test blocks). Operators start, play, pause, seek, hand off, claim and end; everyone follows the shared clock and opens the link (a shared timeline, not a media relay). **Ordinary members cannot join or leave** because Onyx Server accepts a channel `PROP` write only from op / owner / founder (913); values are capped at 512 bytes |

After C12, `v3/rx-calls` added the docked stage, head row + controls-only bar, More tray / sheet, guest and DM states and node-less
device-key enrollment. Provisional answers to the spec's open questions (§7): join muted by default, a reserved privacy-code
slot, snapshot-carried peer fingerprints, a timed-out ring reuses `CallEnded`, deafen stays local-only, remote `kind = screen`
peers force the screenshare layout, the microphone takes Ctrl+Shift+M (the oracle's room-mute chord is not bound).
**Open (Med):** local recording; SFU topology and network stats readout (the adapter never emits `sfu`); a changed media peer key is
announced by a toast only. Details: *Remaining gaps → Calls* in the parity map.

## Phase 7 — Polish, a11y, ship

| # | Item | Size | Status |
|---|---|---|---|
| 7.1 | Focus traps + Escape + focus restore on every overlay (shared helper in ports) | M | **done** (v3/frame `installOverlayFocus` + `App.escapeMsg`; v3/rx-sheets: Escape closes only the topmost sheet; v3/gap-convo `installGapFocus` for the message menu, picker and search). The composer popovers are non-modal without a Tab trap, and the image lightbox keeps its background-isolating helper |
| 7.2 | Responsive pass: every sheet and surface on every viewport class | M | **done** (v3/frame, rx-shell, rx-convo, rx-sheets, rx-calls, rx-public: the 15-viewport matrix from 320×568 to 3440×1440 with zero PROBLEM lines per slice gate). The matrix was run by the slice builders; it was not re-run for this doc refresh |
| 7.3 | PWA: install sheet, update-available banner, service worker | S | **done** (v3/polish: Add to Home Screen over a captured `beforeinstallprompt`, update strip; v3/gap-pwa-safety: `ports.js` registers the deployed `/sw.js` — https / loopback only, after load, HEAD-probed, silent on failure — closed-tab Web Push with a bounded wait, page-restore reconnect). Updates are approval-only; the update strip renders only inside the app frame |
| 7.4 | Browser e2e for the Elm build (connect → join → send) | M | **partial.** Browserless: `ShipFlowTest` (6 keyboard-only flows) + `bundleBoot.smoke.mjs`. Real browser: `elm/tools/screens*.mjs` (24 scenario files) and `call-e2e.mjs`. **Not there:** a Playwright test suite for the Elm build |
| 7.5 | Build + deploy path for the Elm bundle | M | **done except CSP.** `elm/tools/build.sh` → `elm/dist-elm/`: `--optimize` build, esbuild minify (4.2 MB → 1.2 MB), content-hashed local scripts and stylesheets, the voice engine and the background renderer bundled. `./deploy.sh` (no client switch; the Solid pipeline is gone) runs `pnpm build` — `build.sh`, then `tools/build-site.mjs`, which generates every SPA document from the route table (`tools/site/routes.mjs`) — and syncs it; plain builds never touch `out/`. **Pending:** a Content-Security-Policy — `index.html` still has an inline boot script needing a hash or extraction, and nginx sends only `frame-ancestors` |
| 7.6 | Visual regression screenshots per surface | M | **partial.** Real-browser screenshots exist for every slice's scenarios (`screens.mjs`), plus a rendered-contrast audit (`contrast-audit.mjs`) and `css-coverage`. **Not there:** baseline diffing |

## Phase 8 — Long tail

- Discord bot-token server import (4.5; needs a `/discord-import` proxy).
- Context rail and combined mobile Room control desk (3.8); presence heatline (3.1).
- "App & tools" tab and storage controls (4.1).
- Palette time grammar; swipe-to-reply; local recording; SFU stats readout.
- CSP (7.5), a Playwright suite and pixel baselines (0.6, 7.4, 7.6).

## Architecture rules

Adopted from the design direction ([`design/V3_DESIGN_DIRECTION.md`](design/V3_DESIGN_DIRECTION.md)): keep effects-as-data
(`List Outbound`); new UI goes in feature modules (own state, `Msg`, `update`, `view`) wired into `App` through blocks tagged
`-- v3/<slice>` and the `settleSteps` list; one incoming `shortcut` port (ports.js owns scope rules) and one outgoing `dialog`
focus port; per-feature CSS files; elm-review (`NoUnused.*`, no `import App` from `Feature/*`) is the target.

## Progress log

- 2026-10-10 — Phase 0.1/0.2 connect gate landed (`c18b9591`).
- 2026-10-10 — Phase 2.1–2.3 rich message text (links, mentions, channel jump, mIRC, code, quote, spoiler, emoji) landed.
- 2026-10-10 — Phase 3.3 + 4.2 (keywords / ignored / DND) notification settings landed (`v3/notify`).
- 2026-10-10 — Phase 1.1–1.3 primary navigation (rail + bottom bar), You hub for guests and accounts, Appearance link landed (v3/nav).
- 2026-10-10 — Phase 2.5–2.6 boost slice landed (Add-a-boost opener + jump-to-date sheet over `requestTravelTo`).
- 2026-10-10 — Phase 4.1 device Preferences sheet (You hub → This device → Preferences) with queued-send + room-draft discard and a new `outboxReview` port (v3/prefs; 47 `PrefsPanelTest` vectors + `prefsOutbox.smoke.mjs`).
- 2026-10-10 — Phase 1.5/1.6 sectioned sidebar + New conversation sheet landed (`Sidebar`, `View.Rail`, `View.NewMessage`; 31 `SidebarTest` vectors).
- 2026-10-10 — Calls C1–C3 (presence + join banner, voice-only stage + bar v1 + announcer, security chip + privacy sheet) landed (`v3/calls-c1`).
- 2026-10-10 — Calls C6 (DM ring overlays), C7 (picture-in-picture) and C10 (reconnecting + classified errors) landed (`v3/calls-c6`).
- 2026-10-10 — v3/polish: composer More tools tray, time scrubber, first-run notify prompt, persisted first-hour coach, Add to Home Screen + update-available (7.3), Back online only after a recovery (42 `PolishTest` vectors + `polish.smoke.mjs`).
- 2026-10-10 — 1.0 shell frame + tokens landed (`v3/frame`): token ladder, one frame grid, `View.Sheet` primitive, one overlay focus mechanism, one Escape order, global topbar + room header with More menu (24 `FrameTest` vectors + `overlayFocus.smoke.mjs`).
- 2026-10-10 — 0.6 / 7.4 / 7.5 partial (`v3/ship`): elm-program-test vendored, 6 `ShipFlowTest` ship-bar flows, `bundleBoot.smoke.mjs`, `tools/build.sh` hashed static build; fixed reversed same-port command order in `Main.update` and double-CRLF framing in `ports.js`.
- 2026-10-10 — Calls C4–C5 (camera / share / deafen + quality; video grid, tiles, spotlight / screenshare, dominant speaker, paging of 16) landed (`v3/calls-c4`).
- 2026-10-10 — Calls C11 (stage mode) and C12 (call chords, `aria-keyshortcuts`, `?` overlay group, a11y pass) landed (`v3/calls-c11`).
- 2026-10-10 — Phase 0.5 + 4.3 / 4.4 / 4.6 / 4.7 account completeness landed (v3/account2).
- 2026-10-10 — `a96afd2e`: the video-off switch fails closed on every path (voice ships, video stays off on the live network).
- 2026-10-10 — The three design maps landed: client parity map (1,596 rows), server feature map (143 command rows), style map.
- 2026-10-11 — v3/gap-pwa-safety: `/sw.js` registered, update strip, closed-tab Web Push, page-restore reconnect, DM key-change detection and held sends.
- 2026-10-11 — v3/rx-public: remembered identities (0.3), invite preview (0.4), public navigation parity, wide / short layouts.
- 2026-10-11 — v3/gap-commands (planSlash translation, ACTION rows, `/share`, palette rows, chords), v3/gap-watch (Watch Together), v3/gap-shell (Activity sheet, lifecycle, leave confirm, join by name), v3/gap-organize (folders, hidden rooms, quiet hours, presets, smart mute, digest), v3/gap-usermodes (privacy modes, server blocks, offline messages, auto-join) merged.
- 2026-10-11 — v3/gap-import (history import, BlockKit-lite), v3/rx-convo (conversation on every aspect ratio, edit disclosure), v3/gap-chanserv (registered-room services), v3/gap-oper (operator console, 5.3), v3/gap-auth (two-step sign-in, SETPASS, challenge, passkey sign-in) merged.
- 2026-10-11 — v3/rx-calls (docked stage), v3/rx-shell, v3/gap-account (per-account scope, local-history control, Protection, Recover, badge), v3/gap-people (role-gated moderation, windowed roster, handover offers), v3/rx-sheets (overlays per viewport class) merged.
- 2026-10-11 — v3/gap-appearance (themes recolor the shell, Text size / Density / Width, background scenes), v3/gap-claim (claim pre-scoping history), v3/gap-convo (server-native edits, EXIF cleaning, persisted drafts, paste / drop, jump landing) merged: release `609cb240`.
- 2026-10-11 — Docs refresh: parity map, server map, COVERAGE and this roadmap re-verified against `609cb240`.
