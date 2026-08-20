# Onyx commercial UI system

**Status:** Complete — rooms/network language locked; experience mode id is `network-ops` (migrates legacy `irc-ops`); protocol essays keep real CAP/config tokens under open-wire framing.
**Scope:** Presentation and information hierarchy only. Kernel frozen.
**Slice 1 (implemented here):** Room header commercial chrome — `PresenceRibbon` + ribbon CSS + focused tests.
**Reviewer:** Codex · **Writer (this tree):** implementer lane · **Claude:** off for this pass.

This document is the durable source of truth for the commercial redesign. Implementation slices must not invent product claims, server capabilities, or kernel rewrites.

---

## 1. Commercial identity

**Onyx** is a public place to talk and gather — rooms, messages, and voice/video
in one conversation home, with honest connection/protection status and history
that stays on this device. Usability target: Discord/Twitch-class community
platform density (rail · rooms · stage/feed), not a SaaS marketing shell.

Not: a terminal for operators. Not: a clone of any big chat brand. Not: a
feature-matrix UI.

**Brand house**

| Name | Role |
|------|------|
| **Onyx** | Network / product / client |
| **Onyx Server** | Engine / daemon / protocol |
| IRCXNet | Retired public identity; wire/legacy only |

**Design signature to keep (identity, not chrome density)**

- Quiet-threshold ocean tokens (`src/styles/tokens.css`) — mineral night + quiet cyan signal
- Instrument Sans + restrained Fraunces + JetBrains Mono (default cut; no Anton marketing)
- Matte surfaces, fine borders, quiet cyan signal — no neon/glow spectacle
- Room-identity accents when present
- Truthful call and protection state
- Local-first vault language (“on this device”)

**CallsHub is the visual grammar reference, not a template to paste into the ribbon.** Borrow type hierarchy (identity > place status > chrome), truthful call lifecycle labels, and calm empty copy. Do not port hub display titles or proof cards into the room header.

---

## 2. Information architecture (product frame)

Names stay; presentation density changes.

```
Landing  →  Connect (guest / sign in / register / invite)  →  Shell
                                                              ├ Home
                                                              ├ Rooms
                                                              ├ Messages
                                                              ├ Calls     (discovery only; join stays explicit)
                                                              └ You
```

Shell-local surface state (`primarySurface`, `sidebarMode`, mobile bottom nav) already exists. Commercial work is **density hierarchy + composition**, not new protocol routes.

**Public copy prefers:** rooms, messages, call, people, keep this name, on this device, reconnecting.
**Avoid leading with:** CAP, SASL, NAMES, WHOIS, OPER, buffer, query.

---

## 3. Remove · Merge · De-emphasize · Keep

### Remove from default room chrome (or relocate)

| Item | Destination |
|------|-------------|
| Dense ribbon icon cluster (pins, DND, mark-read as peer primary icons) | **More** → This room / conditional quiet |
| TimeScrubber default-on | Pref / More / reader mode |
| WatchTogether strip default | Pref / stage context |
| Oper / capability matrix as product chrome | Status / You → Advanced |
| Sidebar “unread only” + dense filters as primary | Collapsed Filter disclosure |
| Guest claim **expanded form** in first mobile viewport | Compact chip → sheet |
| Dual Appearance + Preferences + Account as three ribbon doors | **You** hub (Account rail + More/Menu You entry) |

### Merge

| Merge | Into |
|-------|------|
| Room tools (pins, notify, settings, export, topic edit) | Room sheet / **More → This room** (slice 1 uses More) |
| Appearance + prefs + account entry | **You** hub (Account + Menu) |
| Home digests | Needs you → Continue → Live now → Explore → More activity |
| Composer attach/format/schedule | Standard primary: **+** · message · emoji · **More tools** · Send; schedule/jump in More (slice 4) |

### De-emphasize

Heatline, sparklines, room insights, system join/part noise, channel folders, portable vault / import / blocked hosts / a11y ledger (You → Advanced), status buffer as a “room”, mono ops labels on primary nav.

### Keep for power users (never delete capability)

Cmd-K Spotlight + time grammar; message search; reader / jump-to-date / time scrubber (explicit); full Preferences matrix; channel settings / ACCESS / PROP; E2EE DM safety; voice stage / captions; outbox / offline memo; ServerRail when ≥3 servers; MemberList product (toggle, never remove).

---

## 4. Room-header contract — four zones

**Purpose:** In one glance answer *where am I*, *can I talk*, *who’s here*, *am I connected*.

| Zone | Role | Always? |
|------|------|---------|
| **Z1 Identity** | Sigil + name (copy) · topic ellipsis · secondary heatline/facepile | Name yes; topic if set; secondary may collapse |
| **Z2 Place** | Call control / call lifecycle status · optional voice occupancy · optional event chip | Call per truth table; chips if data |
| **Z3 People** | Roster toggle + count | **Always on channel**, including **0** |
| **Z4 Edge** | Connection status + More · Inbox as reach instrument | Conn + More always |

**Not primary / not zones:** pins, mark-read, DND, AI policy (when shown, quiet or in More), **Jump to date** (More → This room / Conversation), heatline/facepile (presence-as-place **secondary** — facepile **hidden at narrow/mobile**; may collapse before Call/People/Conn/name).

### Primary visible controls by surface

| Control | Channel | DM | Status / Home |
|---------|---------|----|---------------|
| Room identity | `#` name | `@` nick | `✦ Status` / `Onyx` |
| Call | yes (truth table) | no channel join; 1:1 ring via overlays | no |
| People | yes, count `0…n` | no | no |
| Connection | always | always | always |
| More | always | always | always |
| Event chip | if visible scheduled event | — | — |
| Voice occupancy | if `voiceCount > 0` | — | — |
| Inbox | desktop keep | keep | keep |
| Date (jump-to-date) | **More → This room** (not primary) | **More → Conversation** | no |

### More menu (grouped — not a junk drawer)

| Group | Items |
|-------|--------|
| **Alerts** (channel; outside `role=menu`) | `ChannelNotifyControl` radiogroup · AI policy badge if non-default |
| **This room** (channel) | Channel settings · Mute/Unmute · Export transcript · **Pinned messages** · **Jump to date** · Mark as read (if unread) · DND quiet item if active |
| **Conversation** (DM) | **Jump to date** |
| **Workspace** | Appearance · Preferences · Account (`Guest` \| account) |

**ARIA shape:** Visible section kickers are normal text (`p.shell-ribbon-more-label`) **outside** `role=menu`, associated via `aria-labelledby` on the section and its menu. Each `role=menu` contains **only** `role=menuitem` children (no heading nodes inside the menu). Alerts radiogroup stays outside any menu. Roving Arrow/Home/End walks every menuitem under the More panel root.

**Forbidden in More:** Call, People, connection status, live event chip, active voice occupancy.

**Stable strings:** trigger `More actions` · panel `More channel and workspace actions` · kickers `Alerts` / `This room` / `Conversation` / `Workspace`.

### Call truth table (aligned with `classifyCallsHubPresentation`)

| Presentation | Ribbon | Join |
|--------------|--------|------|
| **idle**, joinable | Primary **Call** (`Join call`) | `onJoinVoice(false)` only |
| **idle**, people in room voice | Occupancy chip + Call if joinable | Chip uses existing join path |
| **ringing_in / ringing_out** (this room) | Sparse Incoming / Calling — **not** established styling | **No accept/decline in ribbon** |
| **provisional** (`in_call` ∧ `callStartedAt == null`) | `Connecting…` / non-active | No second join; no established paint |
| **established** (this room) | Occupancy / In call with active mark | Join hidden/inert |
| **call elsewhere** | No fake local established | Do not invent |

**No auto-join / no auto-accept.** Overlays own accept/decline.
`buildVoiceRoomStatus` speaker/raised/muted/local health **must not regress**.

### People / members

- Channel: always render People (`ribbon-members`); count includes `0`.
- Click → existing `onToggleMembers` / `toggleMemberList` / mobile drawer — **toggle only**.
- `aria-pressed` tracks **actual open surface**: AppShell passes `membersOpen={membersVisible()}` (desktop column `showMemberList` **or** mobile drawer open, and roster non-empty). Must be **`false`** when the mobile drawer is closed, when the roster is empty, or when the column is hidden.
- Label: `{n} members — toggle member list`.
- **Never delete** MemberList column/drawer product.

### Secondary facepile

- Rendered in Z1 identity for channels (`shell-ribbon-facepile` wrapper around `Facepile`).
- **Desktop / roomy conversation only.** Hidden at narrow conversation container (`@container conversation max-width: 760px`), viewport ≤760px, and mobile shell (≤900px) so it cannot crowd Call / People / More / connection.

### Member-column persistence — **DEFERRED (not implemented in slice 1)**

Remembering desktop open/closed under an `onyx:` localStorage (or prefs) key is **explicitly deferred**. Current behavior remains in-memory store `showMemberList` (default `true`) without durable persistence work in this slice. Do not pretend it is shipped.

### Connection

- States: `connected` | `connecting` | `reconnecting` | `disconnected` (+ `error` if used).
- Desktop: mono chip + visible word.
- Narrow / mobile: **may drop the word**; must keep a **visible state affordance** (border/dot color) + `sr-only` / `aria-live=polite` text.
- **Must not** `display: none` the whole `.shell-ribbon-conn` under container ≤760 or phone layouts.

### Dimensions

| Token | Desktop | ~390 mobile |
|-------|---------|-------------|
| Ribbon height | 52–56px (prefer **56**) | **56–60px** |
| Primary Call / People / More | min **40×40** | min **44×44** |
| Inbox chrome | ≥36 | ≥44 hit area |
| Jump to date | menuitem in More | menuitem in More |
| Name | max ~22ch | max ~13–15ch / ~48vw |
| Topic | if space | hide ≤600 / phone |
| Action labels (`Call`) | if width allows | hide; icon + aria |

### Focus / Escape (preserve)

1. Esc closes More → focus restore to More trigger.
2. Choose menuitem → `closeMoreThen` closes panel before handoff.
3. Arrow/Home/End roving on `role=menuitem`; radiogroup not in menu.
4. Open focuses first menuitem (microtask).
5. No focus-trap leak into transcript while More is open.

### Illumination (sparse)

- Never tide-glow the whole ribbon bar.
- Sparse marks only: live event, non-connected conn emphasis, established/active call, People `aria-pressed`.
- `prefers-reduced-motion: reduce` freezes pulse; static color remains.

---

## 5. Mobile parity

- Same IA labels and actions; different chrome budget.
- Mobile room: Call · People · More (+ chips when data); connection compact but **present**.
- Guest claim: compact “Keep <nick>?” chip → Sheet (never expanded form in the room column).
- Bottom nav safe-area and virtual-keyboard contracts stay.

---

## 5b. Guest claim contract (slice 2)

**Purpose:** Let a connected guest protect the nick they already hold without
disconnecting, without blocking the composer, and without false product claims.

### Surface

| Piece | Behavior |
|-------|----------|
| Compact chip | `Keep <current nick>?` + Keep / Dismiss. Self-gates on guest + live nick. Never expands in-flow. |
| Durable dismiss | Per guest identity/device via `onyx:guest-claim-dismissed` + device-memory owner key. Ownerless key purged. |
| Sheet | Real `Sheet` focus trap + Escape + return-focus to chip Keep control. |
| Form | Nick **read-only** (live `ourNick`), optional email, password **min 8**. |
| Account guest CTA | **Close Account first**, then open the same sheet via `guestClaimState` on a microtask (no stacked ModalShell + Sheet focus traps). **Must not** `disconnect()`. |

### Auth funnel

1. `registerAccount(currentNick, email?, password)` while connected.
2. On `VERIFICATION_REQUIRED` → verify form → `verifyAccount`.
3. On REGISTER/VERIFY success → **one** `identify(nick, password)` after `registerPending` falls — never before, never twice.
4. `900` / `server.account` closes sheet and hides chip.
5. Failures surface `registerError` / `accountActionError` (IDENTIFY). A real numeric **464** after a current IDENTIFY must set `accountActionError { command: IDENTIFY, code: 464, description }` (correlated only with `_identifyReplyContext`) so the sheet leaves “identifying” without disconnecting; ordinary 464 notification/service-notice behavior is preserved. Clear `_identifyReplyContext` on accepted 900, terminal FAIL/WARN IDENTIFY, and correlated 464.
6. **Client-gone no-op:** after `registerAccount` / `verifyAccount`, arm `phase` + `requestInFlight` only when `getState().registerPending` is true. If the store no-ops (live client missing), do **not** IDENTIFY; show a reconnect-required local error and **retain the room**.
7. **In-flight dismiss:** while REGISTER, VERIFY, or IDENTIFY is busy, refuse Sheet backdrop / Escape / close-button `onOpenChange(false)` and disable **Not now** (wire requests cannot be canceled). Idle Escape + focus restore to the chip Keep control must still work.

### Honest copy (required)

- Prefer: keep this nick, stay connected, password protect, recovery email optional, passkeys **after** account.
- **Forbidden** in chip/sheet/Account guest CTA: “settings across the mesh”, automatic multi-device E2EE, urgency/scarcity (“before someone else”), “no reconnect needed” success framing that implies Connect-style re-auth, passkeys as a guest step.

### Acceptance gates (slice 2)

- Focused: `pnpm exec vitest run src/shell/GuestClaimPrompt.test.tsx src/shell/guestClaimState.test.ts src/app/Account.test.tsx src/lib/store/store.account.test.ts --maxWorkers=1`
- `pnpm typecheck` · `pnpm lint` · `git diff --check`
- Bounded store fold-back only for IDENTIFY/464 correlation above; no protocol/media/E2EE kernel rewrites; no commit/push/deploy from this lane.

---

## 6. Six ranked implementation slices

| # | Slice | Ownership (presentation) | Status |
|---|-------|--------------------------|--------|
| **1** | Room header commercial chrome | `PresenceRibbon.tsx`, `shell.css` (ribbon), `PresenceRibbon.*.test.*`, this doc | **This slice** |
| **2** | Guest claim compact + sheet | `GuestClaimPrompt.*`, `guestClaimState.ts`, Account guest CTA, this doc | **This slice** |
| **3** | Home Needs you / Continue hierarchy | `HomeView.*`, `home-view.css`, `HomeView*.test.tsx`, this doc | **This slice** |
| **4** | Composer public default (+ tray) | `Composer.tsx`, `Composer.test.tsx`, composer CSS in `shell.css`, this doc | **Done** (denser More tools tray) |
| **5** | You hub tiers | AppShell you surface, Preferences structure, Appearance, Account | **Done** (You + Account; ops matrix off Activity in Standard) |
| **6** | Rooms/Messages collection polish | `ChannelSidebar.*`, sidebar CSS + shell/landing copy | **Done** |

**Deferred beyond top 6:** transcript type density; default-off TimeScrubber/Watch; Connect copy; Landing claim alignment when packaging ledger green; **member-column persistence**.

**Kernel freeze:** do not redesign by rewriting `src/lib/irc/`, `src/lib/store/`, `src/lib/cadence-media/`, `src/lib/e2ee/`, vault crypto boundaries, or wire METADATA keys `ocean.*`.

---

## 6b. Home screen contract (slice 3)

**Purpose:** Answer *what needs me* and *where do I continue* — not an admin dashboard.

| Band | Content | Truth rule |
|------|---------|------------|
| **Welcome** | Personal greeting + **Browse rooms** + **Search messages** | No fabricated claims |
| **Outbox / connection** | Queued sends, offline “on this device” note | Bodies never on Home |
| **Needs you** | Unread DMs + direct mentions (`buildAwayDigest.attention`) | **Direct mentions from muted rooms stay in Needs you**; only ambient unread from muted rooms stays quiet; fail-closed |
| **Continue** | Exact first-unread resume + followed rooms | Same `firstUnreadId` / memory boundary |
| **Live now** | Real scheduled events + non-idle call state only | **Never auto-join** media; navigate only |
| **Explore** | Directory stats (when present) + recent rooms | No invented occupancy |
| **Caught up** | Empty copy when nothing needs attention | No fake people/badges |
| **More activity** | Pulse, room rhythm, quiet tiers/boosts, review history, remembered rooms | Collapsed by default |

**Copy:** Prefer rooms, messages, on this device, first unread, pick up where you left off.
**Avoid on primary surface:** device memory, last-read boundary, chanstats heatlines, reviewed spans, Join #root.

**Visual:** Spacious reading flow (Instrument Sans body/titles, restrained Fraunces lede, mono for status/time). One sparse cyan signal line on Needs you → Continue. Matte cards with fine borders; no animated active-nav glow. Desktop ~1440 and mobile ~390; ≥44px touch; visible focus; `prefers-reduced-motion`.

**Strata markers retained:** `data-home-stratum` attention | followed | quiet | resume | memory; plus `data-home-band` needs-you | continue | live-now | explore | caught-up | more-activity.

**Kernel freeze:** no store/protocol/navigation-kernel edits; preserve `buildCatchUp` / `buildAwayDigest` / `buildResumePoints` / outbox / reader handoff / cold vault paint.

### Slice 3 acceptance gates

- Focused: `pnpm exec vitest run src/shell/HomeView*.test.tsx --maxWorkers=1`
- `pnpm typecheck` · `pnpm lint` · `git diff --check`
- No commit/push/deploy from this lane.

---

## 6c. Composer public default (slice 4)

**Purpose:** General-public message entry feels like one calm vessel — attach and send are obvious; power tools remain one disclosure away.

### Standard primary row (exact order)

| Slot | Control | Notes |
|------|---------|--------|
| 1 | **Attach** (`+`) | Paperclip replaced by plus glyph; same upload/paste/drop flow |
| 2 | **Message** textarea | Drafts, slash autocomplete, nick completion, Enter/Shift+Enter/IME intact |
| 3 | **Emoji** | Existing non-modal emoji dialog |
| 4 | **More tools** | Disclosure only — not a junk drawer of untruthful chrome |
| 5 | **Send** | Only luminous primary action when armed |

**Not in primary row:** Send later / Schedule, Jump to date. No duplicate accessible schedule/jump controls on the primary row.

### More tools tray

| Item | Behavior |
|------|----------|
| **Send later** | Visible title + concise reason; disabled state truthful (`canSchedule`); opens existing schedule dialog; **closes tray** first |
| **Jump to date** | Visible title + short explanation; closes tray; existing `openJumpToDate` sheet |
| **Slash commands tip** | Honest teaching: type `/` — nothing runs until send |
| **Insert /** | Safe command help only: focuses textarea and inserts `/`; **never** executes a command |

**ARIA:** trigger `More tools` with `aria-expanded` / `aria-controls="shell-composer-tools"`; tray `role="dialog"` `aria-modal="false"` labelled “More composer tools”; Escape closes and restores focus to the trigger (textarea Escape also closes tools).

**Capability truth:** Do **not** invent Export or Format controls. Rich text is unsupported on this composer. Keep schedule dialog, scheduled count, attachments, emoji, slash/nick completion, edit/reply/topic/outbox/error, drafts, offline queue, and all keyboard behavior.

**Visual:** single input vessel; plus + emoji readable; More quiet until open; Send the only glow. At ~390px primary targets ≥44px, usable textarea, no horizontal overflow; tray stacks labelled rows. Preserve reduced-motion and `:focus-visible`.

### Slice 4 acceptance gates

- Focused: `pnpm exec vitest run src/shell/Composer.test.tsx --maxWorkers=1`
- `pnpm typecheck` · `pnpm lint` · `pnpm build` · `git diff --check`
- No store/protocol/E2EE/media/scheduling-helper edits; no commit/push/deploy from this lane.

---

## 7. Acceptance gates

### Slice 1 (room header)

- People control visible on channel at **0** members; `aria-pressed` false at 0 / closed drawer; AppShell wires `membersOpen={membersVisible()}`.
- Secondary facepile hidden on narrow/mobile; retained on roomy desktop.
- Connection control present structurally + a11y text on narrow rules (no full `display: none`).
- Call presentation exact for idle / ringing / provisional / established (no accept in ribbon; no auto-join).
- More groups ordered with **visible** labels outside menus; pins + **Jump to date** live in This room (DM: Conversation); Workspace after; valid menuitem-only menus.
- Existing clock invariants (no timer without event; 30s clock; grace clear).
- Overflow invariants (More disclosure; jump-to-date **in More** one-click; Escape focus restore; close-before-handoff; DM without channel/Alerts group; Join call not split voice/video).
- Focused: `pnpm exec vitest run src/shell/PresenceRibbon.test.ts src/shell/PresenceRibbon.clock.test.tsx src/shell/PresenceRibbon.overflow.test.tsx src/shell/shell.test.tsx --maxWorkers=1`
- `pnpm typecheck` · `pnpm lint` · `pnpm build`
- `git diff --check`
- No protocol/store/media/E2EE edits; no package files; no commit/push/deploy from this lane unless human-gated separately. (AppShell may pass `membersOpen` only.)

### Global commercial shell (later)

- Guest path: land → guest connect → open room → send without opening claim sheet; claim is optional chip/Sheet.
- Connected room is not instrument-dense; power features via More / You Advanced / Cmd-K.
- Claim ledger honesty for desktop download CTAs.
- a11y targets on primary header controls.

---

## 8. Explicit non-goals

- Discord/Slack clone IA or feature invention.
- New backend / invented SFU or social graph.
- CallsHub transplant into the ribbon.
- Kernel rewrite; deploy/push without human gate.
- Mandatory account to chat.
- **Member-column open/closed persistence** (deferred — see §4).

---

## 9. File map (slice 1)

| File | Role |
|------|------|
| `docs/COMMERCIAL_UI_SYSTEM.md` | This durable contract |
| `src/shell/PresenceRibbon.tsx` | 4-zone header implementation |
| `src/shell/shell.css` | Ribbon dimensions, targets, conn compact rules |
| `src/shell/PresenceRibbon.test.ts` | `buildVoiceRoomStatus` pure cases |
| `src/shell/PresenceRibbon.clock.test.tsx` | Event clock lifecycle |
| `src/shell/PresenceRibbon.overflow.test.tsx` | Place strip, More, call presentation |

**Import only (read):** pure `classifyCallsHubPresentation` from `CallsHub.tsx`. Do not edit CallsHub in this slice.
