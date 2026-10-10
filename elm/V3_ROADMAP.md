# Onyx v3 (Elm) — build-out roadmap

Goal: the Elm client becomes a complete, shippable Onyx — every surface a
user can reach in the SolidJS client is reachable here, and it works and
feels finished, not just correct in unit tests.

Baseline (2026-10-10): the protocol/core layer is near-complete (2571
elm-tests, 60 port smoke suites green, all public routes at parity). The
**in-app shell is where it falls down**: a first-time user saw a bare
three-column IRC skeleton with no way to choose a name, no navigation,
no settings entry for guests, plain-text messages, and dozens of
features that exist in `App.elm` but have no UI at all.

Source of truth for gaps: a Solid↔Elm surface inventory (component by
component, by copy/aria/testid). Each row below names the oracle file.

## Rules for every slice

- One slice = one commit: `App` fold + `View` + vectors + COVERAGE row.
- Oracle-mirrored copy, aria names and `data-testid`s.
- Gates: `elm make src/Main.elm`, full `elm-test`, all `*.smoke.mjs`.
- No new wire paths when a fold already exists; UI wires existing folds.
- Mobile width (375px) must not scroll horizontally.

## Phase 0 — Front door (unblocks everything)

| # | Surface | Oracle | Status |
|---|---|---|---|
| 0.1 | Connect gate: guest / sign in / create account / recovery code, room field, status copy, Cancel | `app/Connect.tsx` | **done** (`c18b9591`) |
| 0.2 | Leave / disconnect returns to the gate | `ServerRail` disconnect | **done** (`c18b9591`) |
| 0.3 | Remembered identities + "Stay signed in" (needs a ports listing seam over `onyx:credentials`) | `Connect.tsx`, `lib/credentials.ts` | todo |
| 0.4 | Invite preview aside when arriving via `?join=` | `Connect.tsx` `conn-context` | todo |
| 0.5 | Session-expired "Sign in again" banner | `SessionReclaimBanner` | todo |

## Phase 1 — Shell skeleton that feels like Onyx

| # | Surface | Oracle | Size |
|---|---|---|---|
| 1.1 | Primary navigation: Home / Rooms / Messages / Calls / You (desktop rail + mobile bottom nav) | `PrimaryNavigation`, `navigation/shellNavigationModel` | M · **done** (v3/nav) |
| 1.2 | "You" entry for guests and accounts (settings hub: Account / This device / Help) | `YouSettings`, `YouHubNav`, `Account.tsx` guest branch | M · **done** (v3/nav) |
| 1.3 | Appearance reachable from the shell (link + in-shell sheet) | `AppearancePanel`, `ServerRail` | S · **done** (v3/nav; link to `/appearance` — in-shell sheet not built) |
| 1.4 | Home briefing: welcome, first-room prompt, invite friends, recaps, Mark all caught up | `home/HomeBriefingView`, `HomeView` | L |
| 1.1 | Primary navigation: Home / Rooms / Messages / Calls / You (desktop rail + mobile bottom nav) | `PrimaryNavigation`, `navigation/shellNavigationModel` | M |
| 1.2 | "You" entry for guests and accounts (settings hub: Account / This device / Help) | `YouSettings`, `YouHubNav`, `Account.tsx` guest branch | M |
| 1.3 | Appearance reachable from the shell (link + in-shell sheet) | `AppearancePanel`, `ServerRail` | S |
| 1.4 | Home briefing: welcome, first-room prompt, invite friends, recaps, Mark all caught up | `home/HomeBriefingView`, `HomeView` | **done** (v3/home; recaps/vault/resume narrowed) |
| 1.5 | Sectioned sidebar: Favorites (starred), Rooms, DMs with previews, filter, unread/mention badges, New conversation | `ChannelSidebar` | M |
| 1.6 | New conversation (DM starter) sheet | `NewMessageSheet` | S |
| 1.4 | Home briefing: welcome, first-room prompt, invite friends, recaps, Mark all caught up | `home/HomeBriefingView`, `HomeView` | L |
| 1.5 | Sectioned sidebar: Favorites (starred), Rooms, DMs with previews, filter, unread/mention badges, New conversation | `ChannelSidebar` | **done** (v3/sidebar) |
| 1.6 | New conversation (DM starter) sheet | `NewMessageSheet` | **done** (v3/sidebar) |
| 1.7 | Quick switch (Ctrl+K) → action palette | `chat/spotlight/Spotlight`, `RoomSwitcherSheet` | **done** (v3/switcher: rooms + DMs + shell actions, fuzzy rank, combobox; no recents / time grammar) |
| 1.8 | Keyboard shortcuts overlay (`?`) | `ShortcutsOverlay` | **done** (v3/switcher: one `shortcut` port, rows narrowed to handled chords) |
| 1.9 | First-hour coach + first-run notifications prompt | `FirstHourCoach`, `FirstRunNotifyPrompt` | **done** (v3/home: coach only; notify prompt todo) |
| 1.10 | Empty-room intro ("Say hi") | `MessageView` intro | **done** (v3/home) |

## Phase 2 — Messages that render like a modern chat

| # | Surface | Oracle | Size |
|---|---|---|---|
| 2.1 | Rich message text: clickable links (safe schemes only), channel links, mentions | `message/MessageText` | M |
| 2.2 | mIRC formatting (bold/italic/underline/colour/reset) | `MessageText` | M |
| 2.3 | Markdown subset: inline code, code blocks, blockquote, spoiler | `MessageText` | M |
| 2.4 | Composer: emoji picker, nick completion, slash-command suggestions, More tools | `Composer` | **done** (v3/composer; More tools tray still todo) |
| 2.5 | "Add a boost" on the boost bar | `BoostBar` | S |
| 2.6 | Jump to date + time scrubber | `JumpToDateSheet`, `TimeScrubber` | M |
| 2.4 | Composer: emoji picker, nick completion, slash-command suggestions, More tools | `Composer` | M |
| 2.5 | "Add a boost" on the boost bar | `BoostBar` | **done** (`boost` slice: ＋ opener per row into the existing reaction picker) |
| 2.6 | Jump to date sheet (time scrubber stays todo) | `JumpToDateSheet` (+ `TimeScrubber` ahead) | **done** (`boost` slice: sheet + topbar entry over `requestTravelTo`; no scrubber yet) |
| 2.7 | Catch-up: "Since you left" digest, mark caught up | `CatchUpSummary`, `SinceDigestCard` | M |
| 2.8 | BlockKit structured-action modal + send review | `message/BlockKitModal` | M |
| 2.9 | Local edit-history view, context trail | `MessageView` | M |

## Phase 3 — Rooms and people

| # | Surface | Oracle | Size |
|---|---|---|---|
| 3.1 | Room header: privacy, facepile, heatline, voice chip, overflow menu (settings, invite, export, jump, mark read, room care) | `PresenceRibbon`, `PresenceHeatline` | M |
| 3.2 | Room settings sheet: topic, notifications, rules, history policy, roles, encryption, visibility, integrations, bridge status | `ChannelSettings` | L |
| 3.3 | Per-room notify level, quiet hours, calm mode | `ChannelNotifyControl`, `NotificationControls`, `CalmModeControl` | **done** (`v3/notify`: room All/@/Mute strip in the thread header + Notifications sheet with desktop/sound/DND; quiet-hours schedule + calm presets narrowed out — no `App` state) |
| 3.4 | Invite friends share sheet | `RoomInviteShare` | S |
| 3.5 | Member list: filter, avatars, presence/away, DM action | `MemberList` | M · **done** (v3/roster: Filter members field + Escape clear, header count, avatar + presence dot, role/away in words, per-row Message + double-click DM; no windowing, loading skeleton, or modal/mobile copy) |
| 3.6 | Profile card: Message / Report / moderation controls | `PeopleProfileCard` | S · **done** (v3/roster: Message primary + oracle testids; Report opens the person-safety sheet; moderation controls were already ported) |
| 3.7 | DM E2EE safety number + key-change banner | `DmSafetySheet`, `DmKeyChangeBanner` | M |
| 3.4 | Invite friends share sheet | `RoomInviteShare` | S · **done** (v3/dmsafety: sheet from Home + room header "Invite friends"; copy via `ClipboardCopy`; no native-share port) |
| 3.5 | Member list: filter, avatars, presence/away, DM action | `MemberList` | M |
| 3.6 | Profile card: Message / Report / moderation controls | `PeopleProfileCard` | S |
| 3.7 | DM E2EE safety number + key-change banner | `DmSafetySheet`, `DmKeyChangeBanner` | M · **done** (v3/dmsafety: DM header posture chip + Verify panel + inline key-change row with accept/keep-locked; ports `dmSafetyRequest`/`dmKeyAcceptRequest`) |
| 3.8 | Room insights strip, context rail, scheduled-event line, bridge badge, group-control mark | `RoomInsightsStrip`, `ContextRail`, `ScheduledEventLine`, `BridgeStatusBadge` | S each |
| 3.9 | Harbor confirm sheet for room verbs | `HarborConfirmSheet` | S |

## Phase 4 — Settings and account completeness

| # | Surface | Oracle | Size |
|---|---|---|---|
| 4.1 | Device preferences panel: display, accessibility, conversation, history & data, vault, drafts, queued sends | `PreferencesPanel` | L · **done** (v3/prefs; `App & tools`, density, local-history toggle, clear-* controls narrowed — see COVERAGE) |
| 4.2 | Mention keywords, ignored users, smart mute, room folders | `KeywordListControl`, `IgnoredUsersControl`, `SmartMuteSection`, `ChannelOrganizationSection` | **partial** (`v3/notify`: keywords + ignored users done in the Notifications sheet; smart mute + room folders todo) |
| 4.3 | Revoke other devices | `SessionsDevicesSection` | S |
| 4.4 | Portable identity export/import | `PortableIdentitySection` | S |
| 4.5 | History import (Discord / bot / vault) | `HistoryImportControls` | M |
| 4.6 | Theme share/import by code or link dialog | `ThemeImportDialog` | S |
| 4.7 | Friends / watch list, custom status, DND UI (logic already in `App`) | `App` folds | M |

## Phase 5 — Moderation and operators

| # | Surface | Oracle | Size |
|---|---|---|---|
| 5.1 | Moderation cockpit: room desk, invite form, current-room header (move bans out of the main column) | `ModerationCockpit` | S · **done** (v3/moddesk) |
| 5.2 | Oper desk (broadcast / kill / rehash) + event console with filters | `OperDesk`, `OperEventConsole` | M · **done** (v3/moddesk) |

## Phase 6 — Voice and video

| # | Surface | Oracle | Size |
|---|---|---|---|
| 6.1 | In-call voice bar: mute/deafen/camera/screen, quality, fingerprint | `voice/VoiceBar` | L |
| 6.2 | Video stage + participant tiles | `voice/VoiceStage`, `ParticipantTile` | L |
| 6.3 | Incoming/outgoing call overlays, call status announcer | `voice/overlays/*`, `CallStatusAnnouncer` | S |
| 6.4 | Voice settings: devices, voice gate, talk key | `voice/settings/VoiceSettings` | M |
| 6.5 | Picture-in-picture | `voice/VoicePip` | M |
| 6.6 | Captions + reactions overlays | `CaptionsOverlay`, `ReactionsOverlay` | M |
| 6.7 | Stage (raised hands), Watch Together | `StagePanel`, `WatchTogetherActivity` | L |

## Phase 7 — Polish, a11y, ship

| # | Item | Size |
|---|---|---|
| 7.1 | Focus traps + Escape + focus restore on every overlay (shared helper in ports) | M |
| 7.2 | Responsive pass: 375px layouts for every sheet, safe-area insets | M |
| 7.3 | PWA: install sheet, update-available banner | S |
| 7.4 | Browser e2e for the Elm build (Playwright against a static server) incl. connect → join → send | M |
| 7.5 | Build + deploy path for the Elm bundle (`elm make --optimize`, hashed asset, CSP) | M |
| 7.6 | Visual regression screenshots per surface | M |

## Progress log

- 2026-10-10 — Phase 0.1/0.2 connect gate landed (`c18b9591`).
- 2026-10-10 — Phase 2.1–2.3 rich message text (links, mentions, channel jump, mIRC, code, quote, spoiler, emoji) landed.
- 2026-10-10 — Phase 3.3 + 4.2 (keywords/ignored/DND) notification settings landed (`v3/notify`).
- 2026-10-10 — Phase 1.1–1.3 primary navigation (rail + bottom bar), You hub for guests and accounts, Appearance link landed (v3/nav).
- 2026-10-10 — Phase 2.5–2.6 boost slice landed (Add-a-boost opener + jump-to-date sheet over `requestTravelTo`; time scrubber stays todo).
- 2026-10-10 — Phase 4.1 device Preferences sheet (You hub → This device → Preferences): Display / Conversation / History & data / Import & export / Accessibility tabs, queued-send + room-draft discard with count re-confirmation, new `outboxReview` port (v3/prefs; 47 `PrefsPanelTest` vectors + `prefsOutbox.smoke.mjs`).
- 2026-10-10 — Phase 1.5/1.6 sectioned sidebar (Favorites/Rooms/Messages, filter, badges, star toggle, colour labels, DM previews) + New conversation sheet landed (`Sidebar`, `View.Rail`, `View.NewMessage`; 31 `SidebarTest` vectors).

## Revised sequencing (Fable design research, 2026-10-10)

Full report: [design/V3_DESIGN_DIRECTION.md](design/V3_DESIGN_DIRECTION.md). Diagnosis: the
"very buggy" feel is **frame** quality (no shell grid, no focus management, unkeyed
transcript), not feature count. Changes to the phases above:

**v3 ship bar:** connect → Home → open room → send → DM → settings → appearance,
keyboard-only and at 375px, with elm-program-test flows + Playwright + screenshots green.

| New # | Item | Replaces / moves | Size |
|---|---|---|---|
| 0.6 | Playwright against the static Elm build (375 / 768 / 1280) | pulled from 7.4 | M |
| 1.0 | Shell frame + tokens: Solid token ladder in `app.css`, responsive grid (nav rail / collection sidebar / main / context rail), sheet/dialog primitive with one focus-trap port, `role="log"` transcript container, 375px gate, visual-regression baselines | absorbs 7.1, 7.2, 7.6 | L |
| 1.1→1.7 | Ctrl/Cmd+K becomes an action palette right after primary nav | 1.7 moved up | S · **done** (v3/switcher) |
| 1.4a | Land on Home after connect; Home absorbs the catch-up digest | absorbs 2.7 | M |
| 2.0 | Transcript engine: `Html.Keyed` + `Html.Lazy` rows, scroll anchoring port, unread divider, jump-to-latest, windowing past ~300 rows | new | L · **done** (v3/transcript: keyed + lazy rows, `role=log`, `scrollPolicy`/`scrollState` bridge, Jump to latest pill; windowing stays the existing `threadWindowFor` + Show earlier, no spacer divs) |
| 2.0b | Density modes (Default / Compact) + grouping as view-model | new | S · **done** (v3/transcript: `TranscriptRows` view-model, Appearance → Message layout) |
| 3.1/3.5/3.6 | Room header, members, profile card come **before** 2.4–2.9 | reorder | — |
| 8.x | Long tail: BlockKit (2.8), edit history (2.9), history import (4.5), Stage/Watch Together (6.7) | deferred | — |

**Architecture rules adopted:** keep effects-as-data (`List Outbound`); new UI goes in
`Feature/X.elm` modules (own `Model`/`Msg`/`update`/`view`) wired into `App` through
three alphabetised registry blocks (`-- FEATURE MODELS` / `-- FEATURE MSGS` /
`-- FEATURE UPDATE`); one incoming `shortcut` port (ports.js owns scope rules) and one
outgoing `dialog` focus port; per-feature CSS files; elm-review (`NoUnused.*`, no
`import App` from `Feature/*`).

## Phase 6 replaced by the calls design (2026-10-10)

Spec + prototype: [design/calls/CALLS_DESIGN.md](design/calls/CALLS_DESIGN.md),
[design/calls/prototype.html](design/calls/prototype.html). Slices C1–C12 (acceptance
criteria in spec §6) supersede rows 6.1–6.7:

C1 Presence + join banner (M) · C2 Voice-only stage + control bar v1 + announcer (M) ·
C3 Security chip + privacy sheet (S) · C4 Camera/share/deafen commands + quality (M) ·
C5 Video grid, tiles, layouts, dominant speaker (L) · C6 DM ring overlays (S) ·
C7 PiP (M) · C8 Captions + reactions (M) · C9 Voice settings + PTT (M) ·
C10 Reconnecting + classified errors (S) · C11 Stage mode (L) · C12 Shortcuts + a11y pass (S).

Open product questions are in spec §7 (mic chord vs room-mute chord, join-muted default,
screen-share peers in ROSTER, wire for DEAFEN/RECORD, privacy code, fingerprint forwarding,
ring timeout outcome).
