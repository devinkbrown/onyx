# Onyx: the next public site and everyday UI redesign

Date: 2026-09-08. Design owner: Astra ULTRA. Repository: `/home/kain/onyx`.

**Implementation-ready design handoff; implementation and runtime acceptance remain pending.** Astra owns only this new document. No application, test, theme, build, deployment, commit, or publication work is part of this handoff.

**First actionable checkpoint is ready: dispatch G1 and L1 below as soon as their first-pass owners release the listed files.** Further screenshot evidence can refine acceptance without holding this roadmap or restarting completed functionality. Main's latest update: foundation has landed, `pnpm typecheck` passed, and a rebuild for fresh screenshots is underway. These are Main-reported results, not commands run by Astra.

## Start here: the decision and the next two writers

Make the public website feel like an invitation into a recognizable social place. Make the application feel like a generous, readable place to spend an evening. The memorable visual is one large, carefully composed fictional game-night conversation, with strong typography and a small supporting mascot. The working app puts the conversation, its people, and the next useful action ahead of decorative panels.

The next wave is **G1: the homepage composition, written by GROK 4.6 CLI**, in parallel with **L1: the transcript and composer, written by LUNA MAX FAST**. Both are authorized writers. They begin only after the current public and shell owners respectively release their files. Do not start additional writers on these paths while the first pass is still changing them. Foundation supplies the actual theme pipeline; neither next-wave writer owns it.

| Next packet | Exact application write set | Exact co-located test write set | First reviewable result |
| --- | --- | --- | --- |
| G1 — GROK CLI | `src/routes/Landing.tsx`, `src/routes/ProductPreview.tsx`, `src/routes/HomeRoomBoard.tsx`, `src/routes/home.css` | `src/routes/Landing.test.tsx`, `src/routes/ProductPreview.test.tsx`, new `src/routes/HomeRoomBoard.test.tsx` | Desktop and phone homepage: copy plus large room scene in one hero; compact trust passage; useful entry choices; no repeated feature-card inventory |
| L1 — LUNA MAX FAST | `src/shell/MessageView.tsx`, `src/shell/message-view-commercial.css`, `src/shell/Composer.tsx`, `src/shell/Composer.css` | `src/shell/MessageView.transcriptChrome.test.tsx`, `src/shell/MessageView.grouping.test.tsx`, `src/shell/MessageView.thread.test.tsx`, `src/shell/MessageView.dayDivider.test.tsx`, `src/shell/Composer.test.tsx` | Populated room and DM: readable message rhythm, discoverable message actions, one coherent composer, and stable 320px/200% text behavior |

All other paths are read-only for these packets. In particular, shared `src/routes/landing.css` is **not** G1's stylesheet: other public routes consume it. Use root-scoped `home.css` selectors and remove obsolete rules inside the owned scope instead of layering another override sheet. New helper files require Main to assign an exact path first. This ownership table assigns future work; it does not claim that either writer was launched by Astra.

Main owns integration, shared seams, all `tests/e2e/` files including `gamer-layout.spec.ts`, full gates, build, screenshots, release, and GitHub after green acceptance. A fresh reviewer grades each writer's result; a writer's own tests are evidence, not independent acceptance.

## Evidence and precedence

The inspected checkout is `onyx-solid`, HEAD `79bcd0e9`, with concurrent first-pass changes. HEAD alone does not identify the visual candidate: record the dirty diff and screenshot time with each handoff. Current source takes precedence over old design inventories. This document supersedes the **aesthetic direction** of earlier roadmaps where explicitly described below; it does not supersede privacy, security, routing, accessibility, or release contracts.

Read for this handoff: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/README.md`, `.agents/ROSTER.md`, the frontend-design skill, and the client core contract. Targeted references: [public site contract](PUBLIC_COMPANY_SITE.md), [commercial UI system](COMMERCIAL_UI_SYSTEM.md), [information architecture](architecture/ui-information-architecture.md), and [release evidence](testing-and-release.md). The 1,605-line `CLIENT-COMMERCIAL-OVERHAUL-AUDIT.md` is historical background, not a fresh audit or acceptance receipt. Public Luna retains ownership of `docs/GAMER-REDESIGN-ROADMAP.md`; do not rewrite it in this lane.

| Evidence class | What is known | Limit |
| --- | --- | --- |
| Viewed baseline captures | `/tmp/onyx-before-landing.png`, `/tmp/onyx-before-shell.png`, `/tmp/onyx-before-connect.png` | Supplied captures, not a fresh browser session or proof of current production |
| Viewed interim public captures | `/tmp/onyx-first-landing.png`, `/tmp/onyx-first-landing-mobile.png` show crowded headline spacing, a narrow text column beside underused space, a detached small seal, repeated labels/panels, and a long phone page | Captures still have the old palette/font pipeline; do not reject the proposed foundation using their colors |
| Live source inspection | Route/frame, shell, composer, search, pins, media, call, and theme anchors below were inspected or narrowly searched | Source presence establishes an implementation seam; it does not prove a connected journey or a visual result |
| Main's supplied test checkpoint | 195 secondary focused tests passed; pin privacy fix confirmed by prior Grok review | Reported checkpoint, not rerun by Astra; overall gates pending |
| Main's supplied layout checkpoint | `tests/e2e/gamer-layout.spec.ts` catches baseline timestamp overflow at 320px/200% text; shell writer is addressing it | Test source inspected; no fresh execution or passing result in this handoff |
| Latest first-pass integration checkpoint | Main reports pre-foundation build: 611 modules, budgets passed, shell CSS +0.67%; four browser cases: two passed/two failed. Public/Connect passed all four viewports; shell Home visibility after top-nav change and 344px-wide timestamp overflow at 320px/200% text remain under repair | Interim integration failures, not accepted design. Foundation subsequently landed and typecheck passed; rebuilt candidate and new screenshots are pending |
| Grok review checkpoint | Main reports authenticated Grok 4.6 CLI and a completed read-only source review | No authentication or review rerun needed for this design handoff; Main supplies the existing invocation when dispatching |

Two stale findings must not become new implementation projects: `AppShell.tsx` passes `activeSurface` to `VoicePip`, whose current guard suppresses duplicate controls when the shell owns them; `asideOccupant()` already consults `membersVisible()`. Calls' static sample is a design enhancement opportunity, not evidence of broken real navigation.

Concurrent source changed during this audit: `src/routes/home.css` now gives `.home-hero-mark` `position: relative`, disables its pseudo-element, and changes the headline to `16ch` / `-0.035em`. The earlier containing-block issue and `8ch` / `-0.08em` treatment are therefore **historical screenshot findings, source-addressed but awaiting a new capture**, not outstanding confirmed defects. The broader composition recommendation still stands.

`RoomInviteShare.tsx` still conditionally mounts the populated result `role="status"` inside `Show when={copyStatus()}` at inspection. Secondary owner should retain visible feedback while mounting the empty polite, atomic live region before the asynchronous operation resolves. Keep the node stable for repeated copy/share results; do not use `display:none` or `hidden` on the announcer. Confirm with a screen reader as well as DOM checks. Existing copy/share epochs and cancellation behavior stay intact.

## Bounded UX and layout audit

This is a source-grounded design audit across the requested surface map. Only the five captures above were visually inspected. Unscreenshoted recommendations are design proposals and state-review requirements, not invented runtime bugs.

| Surface and source anchors | Design problem or opportunity | Concrete target and truth boundary |
| --- | --- | --- |
| Homepage — `routes/Landing.tsx`, `ProductPreview.tsx`, `HomeRoomBoard.tsx`, `home.css` | Interim hero separates the emotional invitation from the actual product; repeated grids dilute hierarchy | One copy/room-scene composition, compact trust passage, one plain community passage with useful links; preview label always visible |
| Shared public navigation — `ui/public/PublicHeader.tsx`, `PublicNav.tsx`, `PublicFooter.tsx`, `public-frame.css`; `ui/navigation/publicRouteManifest.ts` | Tiny branding and repeated route shelves compete with a clearer destination system | Stronger mark/wordmark scale, generous header targets, one footer organized by existing destinations; retain About, Download, Open Onyx and mobile parity |
| About / guides / download — `routes/About.tsx`, `Guides.tsx`, `Download.tsx`, their CSS; `downloadMeta.ts` | First pass mostly restyles existing long compositions; these need different layouts for different jobs | About tells the product story; guides are usable task articles with a compact index; download begins with browser use, then actual artifact availability |
| Status / stats / roadmap — `routes/Status.tsx`, `Stats.tsx`, `Roadmap.tsx`, `PublicRoomComparison.tsx` | These are evidence and reference pages, not additional marketing heroes | Short title, answer/data first, clear freshness and unavailable states; no invented trend, incident, uptime, release date, or live count |
| Privacy / rules / contact / accessibility / integrations / agents / glossary — `routes/TrustPages.tsx`, `PublicInfo.tsx`; route manifest | Long prose needs a common reading layout without turning policy into decorative tiles | Readable article, meaningful headings and page-local contents where needed; preserve factual copy and actual contact destinations |
| Connect — `app/Connect.tsx`, `connect.css`, `ConnectPulse.tsx` | Baseline floats a form on an expansive decorative background; destination context is secondary | Center the task: destination, display name, Join; account alternatives below; remembered identities, recovery, passkey support and errors remain real |
| Invite — `routes/Invite.tsx`, `invite.css`; `shell/RoomInviteShare.tsx` | Invitation should explain what opens before asking someone to join | Strong room identity and access boundary; omit unknown people/counts/topic; show malformed/unknown/feed-unavailable honestly; preserve exact invite destination |
| App navigation — `shell/AppShell.tsx`, `PrimaryNavigation.tsx`, `commercial-navigation.css`, `shell-frame-commercial.css`, `harbor-phone.css` | Baseline spends much of desktop width on rails and leaves the empty center without a useful hierarchy | Retain first-pass 56px app bar, 256px collection, optional closed People/details, five phone destinations; current surface, selected collection and open drawer remain distinct |
| Home — `shell/HomeView.tsx`, `home/HomeBriefingView.tsx`, `home/homeController.ts`, `home-view.css` | Baseline empty Home is a large title plus duplicate room actions; populated Home needs a clear reading order | Unread/mentions and genuine resume rows first; one first-room invitation when empty; local history/outbox warnings near affected tasks, no fabricated friend activity |
| Rooms / DMs collection — `shell/ChannelSidebar.tsx`, `ChannelBrowser.tsx`, `NewMessageSheet.tsx` | Rooms and personal conversations deserve recognizable rows, not the same generic card anatomy | Room icon/name/topic and unread state; circular person avatar/name/last safe preview for DMs; filter, favorite, folder and keyboard behavior retained |
| Chat transcript — `shell/MessageView.tsx`, `message-view-commercial.css`; `message/MessageText.tsx`, `MessageMenu.tsx` | This is the highest-duration surface; baseline overflow demonstrates that metadata must yield to reading width | Author groups, stable unread separator, wrapping metadata and long text, accessible action reveal; retain virtualization, scroll anchors, locked/deleted semantics |
| Composer — `shell/Composer.tsx`, `Composer.css` | Existing attachment, emoji, schedule, reply and edit tools need one understandable visual hierarchy | One input vessel; labeled context above input; plus/emoji, quiet More tools, Send; pending/upload failure/offline state stays actionable |
| DM safety — `shell/DmKeyChangeBanner.tsx`, `DmSafetySheet.tsx`, `ChannelSidebar.tsx`; `lib/e2ee/replyPrivacy.ts` | Security boundaries must survive more attractive previews and denser layouts | Locked placeholder in body, reply, thread, preview and accessible name; changed-key decision visible; no universal encryption claim |
| People — `shell/MemberList.tsx`, `PeopleProfileCard.tsx`, `WhoisSheet.tsx`, `people/PersonSafetySheet.tsx` | Optional People can become useful social context without consuming the default transcript | Searchable scannable roster, readable role labels, profile action grouping; presence only from real data; preserve role, ignored-user and drawer focus behavior |
| Calls — `shell/CallsHub.tsx`, `calls-hub.css`, `voice/VoiceStage.tsx`, `VoiceBar.tsx`, `VoicePip.tsx` | First-pass hub exists; stage hierarchy and permission/reconnection states need comparable polish | Idle chooses a room; ringing/provisional/established each get accurate copy; one persistent control owner; actual participants and media protection only |
| Search — `shell/search/MessageSearch.tsx`, `message-search.css`; `useMessageSearch.ts` | Existing conversation/device/server choices can overwhelm the query and results | Query and target first; provenance on each result group; saved searches and advanced recall disclosed; no DM query/ciphertext sent to server search |
| Threads — embedded `ThreadPanel` / `threadDisplayText` in `shell/MessageView.tsx` | Parent, replies, close/back and return-to-message need a strong hierarchy on narrow screens | One contextual pane/sheet, never a forced third desktop column; parent visible, close returns focus, unavailable parent explicit; existing reply path preserved |
| Pins — `shell/PinnedMessages.tsx`, `pinned-messages.css` | New privacy fix is valuable completed work; refine reading and empty/missing states around it | Compact message excerpts, author/context and jump action; op-only unpin; missing/deleted/locked stay truthful in text and ARIA |
| Settings / account — `shell/PreferencesPanel.tsx`, `voice/settings/VoiceSettings.tsx`, `app/Account.tsx`, `YouSettings.tsx`, `Appearance.tsx` | Secondary first pass improves presentation; long settings still benefit from category and action hierarchy | Existing You dialog leads to task categories; account/security groups, inline save feedback, clear destructive boundary; preserve preferences and theme customization |
| Notifications — `shell/NotificationCenter.tsx`, `YouNotifications.tsx`, `NotificationControls.tsx`, `ChannelNotifyControl.tsx` | Labels were improved; entry, alert scope and empty/denied states still need visual consistency | Readable inbox rows and contextual controls; no unexplained count pills; existing mention/read behavior and private notification text retained |
| Media — `shell/RoomMediaIndex.tsx`, `room-media-index.css`; Composer upload UI | Pictures/files/links already exist with device-memory provenance | Real picture grid with aspect ratios, file rows with filename/size/state, link rows with domain and jump; failed/blocked/unloaded states; no extra unfurl/fetch permissions |
| Moderation — `shell/ModerationCockpit.tsx`, `moderation/ModerationActionReview.tsx`, `BanListPanel.tsx`, `ChannelSettings.tsx` | Existing operations need a legible decision flow, not gamer-styled destructive buttons everywhere | Target, scope, action, reason where supported, confirmation and server result; permission revocation/offline/error states; no optimistic claim that a sanction succeeded |

## Cohesive visual direction

### Palette and real token pipeline

Keep the prior Astra palette intent: graphite `#202429`, slate `#2D333A`, paper `#F5F7F8`, muted text `#B4BFCA`, cobalt `#65ADF5`, coral `#FF987D`. Graphite and slate provide readable separation; paper carries content; cobalt identifies the principal action/selection; coral is a restrained social illustration accent. **Coral is not danger.** Danger, warning, success and protection state continue to use validated semantic status tokens and text/icon cues.

These six colors describe the default look, not literal colors to paste into route CSS. Consume the existing `--ui-surface-*`, `--ui-text-*`, `--ui-action-*`, `--ui-border-*`, and `--ui-status-*` roles. Foundation owns `src/theme/ThemeProvider.tsx`, `themes.ts`, `semanticTokens.ts`, palette/contrast machinery, `src/styles/`, `src/ui/tokens/`, font imports and dependencies. The provider writes runtime variables to the root; editing a CSS fallback alone is not evidence that the intended theme is applied.

Foundation must hand off actual computed family/token samples on a public page and the shell, including filled-button text. Default dark, a real persisted light preset, a custom theme and forced-colors must work. Dark-seed paper cannot be forced as text in light themes; action foregrounds use their paired semantic ink. Validate text at 4.5:1, large text at 3:1, and meaningful control/focus boundaries at 3:1. These are acceptance targets, not a claim that screenshots already pass.

### Typography and shape

- Anton is the display voice for one homepage headline and occasional large destination titles. Instrument Sans is the interface and reading face, including all chat text, navigation, buttons and metadata. Keep custom font choices through aliases. This explicitly supersedes the old Fraunces/ocean visual lock and old blanket Anton prohibition in the commercial/public design docs; it does not rewrite those documents in this lane.
- Suggested hero copy: **“Good company. Great nights.”** Lede: “A place for your friends to talk, play, and catch up. Open a room in your browser.” Keep it inclusive of clubs and ordinary conversation. Headline is one color, left aligned, two or three intentional lines; no highlighted last word. Use Anton's natural width rather than extreme negative tracking. Starting bounds: 56–104px desktop, 44–60px phone, line-height 1.03–1.10, tracking 0 to -0.02em; reflow takes precedence over exact line breaks.
- Interface titles 24–36px; sections 20–24px; body/chat 16px with 1.45–1.6 line-height; secondary metadata 13–14px. Use rem-based sizes and no fixed line boxes that clip at 200% text. Mono belongs to copyable technical values, not everyday timestamps or decorative labels.
- Spacing ladder: 4, 8, 12, 16, 24, 32, 48, 64px equivalents in existing tokens. Public content max-width about 1240px; prose 60–68ch; conversation body roughly 70–80ch without wasting the remaining space on a permanent empty panel.
- People are circles; rooms use rounded-square identity marks; ordinary message rows have no surrounding card. Controls use 8–12px radii, the single public room scene 16–20px, sheets the existing primitive radius. Avoid identical rectangles or an all-square replacement theme.
- No repeated all-caps eyebrows, gratuitous numbered boxes, competing shadows, decorative data badges, gradients behind every section, or always-running background motion. Optional single entrance transition is subordinate to reduced-motion. Existing SVG icons and supplied brand assets are sufficient; no asset generation or new package blocks G1.

### Homepage composition: five useful beats

1. **Invitation and room scene together.** Header at a legible scale. A 5/7 desktop grid gives the copy room to breathe and makes the product scene the larger visual. Hero CTA “Open Onyx” goes to `/app/`; “See the public room” is a quieter link to the existing `/invite/?join=%23root` destination. Put the preview label above its scene, inside every screenshot crop. Integrate the seal at the scene edge, approximately 96–144px desktop, where it can play a supporting role; omit it on phone if it adds a separate scroll block. No tilted laptop frame or detached mascot column.
2. **Trust immediately after the scene.** One compact line of four factual items at desktop; a two-column definition list or simple stacked text on phone. Keep exact bounded DM/history wording grounded in current source; group rooms are not marketed as universally E2EE. Link the relevant detail to the existing privacy page. No little badge wall.
3. **One community passage with a useful choice.** “For the next match. And the conversation after.” A short paragraph includes friends, clubs and everyday hangouts. Recompose `HomeRoomBoard` into one low-chrome area with the existing public-room, invite, and guide destinations. No repeated abstract network diagrams, no generic feature grid, no second fake room browser. Keep user-driven selection keyboard operable if tabs remain.
4. **A compact device/help passage.** Browser-first use is one sentence and a Download link; guidance is a Guides link. It can be part of the community passage at phone widths. No duplicated install promises or platform cards on Home.
5. **Quiet extras and footer.** Consolidate repeat links while retaining existing destinations and public-frame landmarks. Status/Stats retain telemetry on their own routes. Do not add a pricing, integrations, games catalogue, or social-proof section.

Preview direction: “Friday co-op”, a plain room topic, three fictional people and three short messages such as “One more round?”, “Give me five minutes”, “I’ll meet you in voice.” Display **“Fictional game-night preview — not a live room.”** Room/Home/Messages controls only select local sample content. Inner sample call/composer controls remain inert and excluded from keyboard navigation; explanatory accessible content stays available. No fake microphone meter, animated participant joins, game logo, integration badge, live clock, online count, or working-looking Join action. The real shell never receives these fictional rows.

The art direction's distinctive element is the proportion and detail of this social scene beside the display headline. Everything else is quieter. At ordinary 390px text size, target roughly four to five viewport heights for the entire home page, substantially shorter than the interim capture. This is a composition budget, **not** permission to clip content or enforce a height at 320px or 200% text.

## Wireframes and responsive behavior

These are target layouts, not screenshots or claims of current implementation. Bracketed controls are real only when they correspond to existing product actions; the public scene is explicitly fictional.

### Public desktop, approximately 1440 × 900

```text
 Onyx                                        About   Download   [Open Onyx]

 ┌──────────── 5 columns ────────────┐  ┌────────── 7 columns ─────────────┐
 │ Good company.                    │  │ Fictional game-night preview   │
 │ Great nights.                    │  │ Not a live room                │
 │                                  │  │ [Room] [Home] [Messages]       │
 │ A place for your friends to      │  │ ┌────────────┬────────────────┐│
 │ talk, play, and catch up.         │  │ │ Friday     │ Friday co-op   ││
 │ Open a room in your browser.     │  │ │ Studio     │ topic          ││
 │                                  │  │ │ Mika       │ M One more…    ││
 │ [Open Onyx] See the public room  │  │ │            │ J Give me…     ││
 │                                  │  │ │            │ Y Meet you…    ││
 │                                  │  │ └────────────┴────────────────┘│
 └──────────────────────────────────┘  └─────────────────────seal───────┘
 No ads       No third-party trackers       Private DMs       Device history

 For the next match. And the conversation after.
 One paragraph.   Public room / Invite friends / Getting started
 Browser/device sentence and link.                    Quiet extras / footer
```

### Public phone, 390px and 320px

```text
 Onyx                   [Open Onyx] [Menu]
 Good company.
 Great nights.
 Short lede, comfortably wrapped.
 [                 Open Onyx                 ]
 See the public room

 Fictional game-night preview — not a live room
 [Room] [Home] [Messages]  ← controls wrap if needed
 Friday co-op
 M  One more round?
 J  Give me five minutes.
 Y  I'll meet you in voice.
 (No tiny replica sidebar, fake input or repeated navbar)

 No ads                 No third-party trackers
 Private DMs            History on this device
 Exact short qualifiers remain readable.

 Community paragraph / useful entry links
 Browser/device link / quiet footer
```

### App desktop: keep first-pass frame, improve its contents

```text
 Onyx    Home  Rooms  Messages  Calls  You       Search   Notifications
 ┌──── collection: 256px ────┬──────────── conversation ────────────────┐
 │ Rooms        [Browse]    │ Friday co-op       [Call] [People] [More]│
 │ Filter rooms             │ Short topic; one visible room header    │
 │ ★ Friday co-op      3    ├─────────────────────────────────────────┤
 │   Studio hours           │ M Mika                          19:42  │
 │   Weekend plans          │   First message, comfortably readable. │
 │                          │   Grouped continuation message.         │
 │ [Start a room]           │ ─────────── New messages ───────────── │
 │                          │ J Jun                           19:44  │
 │                          │   Reply and reaction affordances.       │
 │                          │               [Jump to latest]          │
 │                          ├─────────────────────────────────────────┤
 │                          │ Existing active-call dock, if any       │
 │                          │ Reply/edit/upload context, if any       │
 │                          │ [ Message Friday co-op                ] │
 │                          │ [+] [Emoji] [More tools]         [Send] │
 └──────────────────────────┴─────────────────────────────────────────┘
 People/details opens on request: 288–320px only when the center still fits.
 At narrower widths use one overlay/sheet; do not squeeze three columns in.
```

Top app bar starts at 56px and must grow/reflow when text requires it. Do not hard-code a competing shell height in a child stylesheet. Home/Calls need not retain an irrelevant collection column; Main preserves the current navigation model. The diagram shows intended visual adjacency of existing docks; L1 does not move parent-owned call controls or alter `AppShell`.

### App phone: a full-width conversation

```text
 [Rooms/back] Friday co-op     [Call] [People] [More]
 One short topic, expandable if needed
 ─────────────────────────────────────────────────
 M Mika   19:42                 ← metadata may wrap
   Message body uses the available width.
 ─────────────── New messages ─────────────────────
 J Jun    19:44
   Message body.               [message actions]

 [Call context] [Mic] [Return] [Leave]   ← only if active
 Reply to Mika [Cancel]                 ← only if armed
 [Message Friday co-op                           ]
 [+] [Emoji] [More tools]                   [Send]
 Home       Rooms       Messages       Calls       You
 ───────────────────── bottom safe area ───────────
```

At 320px/200% text, header tools can wrap into a second row and message times can move below names. Body text does not ellipsize. Author names may wrap; an abbreviated room-list name still has an accessible full name. Phone destinations keep visible labels and ≥44px targets, growing vertically if necessary. Safe-area inset is applied once by the owning container. Virtual keyboard geometry follows the existing shell controller: composer and Leave remain reachable; navigation may follow its existing keyboard policy, never cover the input. Use a visible overflow control as a touch alternative to long-press. Focus cannot disappear into a closed People/context drawer.

### Home, Calls and contextual reading

```text
 HOME: populated                       HOME: no rooms
 Welcome back                          A room for your people
 Needs your attention                  One sentence explaining the first step
 • Mika — mention + real unread count  [Browse rooms]  Start a room
 • Friday — first unread message       One compact invitation hint
 Continue your conversations           No sample activity or empty grid
 • recent rooms / DMs
 Local history or queued-send notice only when relevant

 CALLS: idle                           CALLS: established
 A call starts in a room               Friday co-op + actual call state
 [Choose a room]                       Actual participants / stage
 Short explanation; optional small     [Return to call]
 explicitly fictional illustration     Persistent mic/leave owner unchanged

 SEARCH / THREAD / PINS                YOU / SETTINGS
 [Back/Close] Title + conversation     [Close] You
 Query or parent context              Account / Appearance / Notifications
 Results or replies, one scroll area  Voice and video / Data / Accessibility
 Provenance or availability status     One category's controls and feedback
 Jump/reply via existing action        Destructive actions in explicit group
```

## Prioritized implementation sequence

### P0 — receive the first pass and establish the visual candidate

Main obtains owner completion receipts for foundation, shell, public and secondary paths; preserve their dirty changes. Foundation is now reported landed and must demonstrate computed tokens/fonts through the real provider on both a public route and shell. Shell closes or explicitly hands off hidden Home after the top-nav change and timestamp overflow with reproducible test results. Secondary receives the stable invite-announcer refinement if still applicable. Capture a new desktop and phone checkpoint after the patches meet, including populated chat; empty Home alone cannot grade a chat redesign.

Acceptance: ownership is unambiguous, changed files are recorded, and fresh captures distinguish source-addressed issues from remaining visual work. This roadmap can be handed off immediately; it does not wait for P0. G1/L1 begin once their respective files are released, but neither can claim visual completion using the old foundation captures.

### P1 — homepage transformation and daily conversation: G1 + L1

**G1 acceptance:** At 1440px the room scene and headline form one balanced hero; no detached empty right column. At 390px and 320px the scene becomes readable social content, not a scaled desktop screenshot. Trust follows preview and precedes the community passage. Hero has one filled primary action; preview tabs are keyboard operable and all sample content is visibly labeled. No network call or media action occurs by using sample controls. No audience taxonomy, repeated feature tiles or decorative how-to diagrams. Every real CTA retains its existing destination. Public supporting routes do not inherit accidental homepage styles.

**L1 acceptance:** Make author/body/action hierarchy and composer anatomy visibly better in a populated room and DM. Preserve grouping and stable unread/scroll behavior. One visible room header; no duplicate orientation banner. Message actions work with keyboard and touch. At 320px/200% text, time/name metadata cannot force horizontal overflow; don't hide timestamps or clip text to satisfy geometry. Keep attachment/emoji/More tools/Send, reply/edit context, typing indicator, draft, queue and failure affordances. Never alter security interpretation, message parsing, persistence or protocol behavior to simplify a mockup.

L1's render boundary gets a read-only `onyx-render`/security review before ship. If a visual change needs a renderer/helper logic change outside its owned set, hand the exact requirement to Main rather than editing that dependency. Embedded thread presentation is in L1's owned `MessageView`; any later thread work waits for L1 to close.

### P2 — entry flow and collection usability: G2 + L2

G2 redesigns Connect/Invite as one coherent entry flow, after public first-pass ownership ends. Desktop allows a modest room-context column beside a 420–480px form; phone shows destination, then the form in normal document flow with minimal framing. Guest join leads; sign-in, registration, remembered identity and recovery retain their complete paths. No decorative success state before connection or access is confirmed.

L2 refines Rooms/Messages collections and People, after shell hands off those paths. Use rows with clear identity, readable selected/unread/favorite states and quiet secondary controls. Preserve late roster updates, roving keyboard navigation, filtering, folder behavior and DM privacy. People is optional, includes empty/loading/ignored states, and never asserts game activity from ordinary presence.

Acceptance: homepage public-room link → invite → Connect retains the selected room; invalid/missing room and refused access explain the actual outcome. Remembered account and guest paths survive back/forward and failure without losing entered data. Rooms, DMs and People work at zero/one/many entries and long names. Keyboard/safe-area sheets restore focus on close. The proposed visual redesign does not add a new authentication state machine.

### P3 — overhaul supporting website layouts and Home/Calls: G3a then G3b; L3

G3a changes the shared public chrome and the three most important supporting pages structurally: About uses a short story and one product scene/explanation; Guides has a compact task index and readable step sections; Download uses browser guidance first and an artifact-led availability table/list second. Desktop contents navigation becomes a normal disclosure or wrapping links on phone; no sticky column at high zoom. Keep existing guide progress/copy-plan controls and download checksums/availability behavior. Remove repetitive oversized headings and nested panels.

G3b applies an appropriate reading/data layout to Status, Stats, Roadmap and informational/trust pages. Status answers the user's availability question first and keeps freshness/unknown explicit. Stats keeps real comparisons, ranges and failed/partial feed states. Roadmap shows current states without invented dates. Trust/info is readable prose with contents only where useful. Preserve existing anchors, canonical paths, aliases and all working routes. `/onyxos/` remains an unlisted working route; it is not promoted into the consumer site.

L3 composes Home and Calls with existing data and callbacks. Home's already-separated `HomeBriefingView` is the first presentation seam; don't rebuild its ranking, persistence or controller. Replace large empty staging areas with a proportionate next action. Calls gets a strong truthful title, readable actual context and clear return/choose-room action. The optional idle illustration is small, explicitly fictional and not a disabled fake application. Ringing/provisional states cannot show an established timer or imply a media connection. Actual call-stage controls remain with their existing owner.

Acceptance: the main website has distinct, usable layouts across its homepage, entry, story, help, download and reference surfaces, not just new colors on every route. No lost link, duplicate landmark, fake artifact, blanket privacy promise or inaccessible article layout. Home's empty, unread, caught-up, cold-memory and queued-send states each have a clear hierarchy. Calls preserves the current lifecycle classifier and never starts a call on navigation.

### P4 — complete the contextual surfaces: serial bounded packets

After G1–G3 and L1–L3 review, Main dispatches the remaining packets from the ownership table below. Search gets a query-first sheet with honest result provenance; pins/media get different layouts for excerpts, pictures, files and links; settings/account/notifications use the same category, row and feedback system; moderation gets clear target and server-result hierarchy. This is presentation work over completed behavior. Do not reopen vault, outbox, search engines, notification decisions, authentication, encryption or moderation protocol work just to complete a visual checklist.

Acceptance: each requested surface has default, empty, busy/error, keyboard, narrow/text-enlarged and privacy/permission-sensitive evidence appropriate to its job. Omissions stay in the final ledger until actually reviewed. Call-stage/overlay redesign and deeper moderation changes require their own exact packet; they are not silently bundled into a stylesheet sweep.

## Subsequent writer ownership: explicit and disjoint

These are application path reservations for successive packets, not authorization to launch every packet at once. For each listed TSX file, its existing same-basename co-located test is reserved to the same packet; a missing test may be added at that exact path only for meaningful behavior coverage. Additional specialized tests named in G1/L1 stay with those owners. Main owns all browser tests and all unlisted/shared dependencies. Transfer any path still held by a first-pass owner before starting it.

| Packet / writer | Exact application paths | Dependency / handoff |
| --- | --- | --- |
| G2 / GROK CLI | `src/app/Connect.tsx`, `src/app/connect.css`, `src/routes/Invite.tsx`, `src/routes/invite.css` | Public first pass released; auth/invite helpers read-only; their behavior is retained |
| L2 / LUNA MAX FAST | `src/shell/ChannelSidebar.tsx`, `src/shell/ChannelBrowser.tsx`, `src/shell/channel-browser.css`, `src/shell/MemberList.tsx`, `src/shell/PeopleProfileCard.tsx`, `src/shell/participant-presence.css` | Shell first pass released; Main alone integrates any needed sidebar/member rules in shared `shell.css` |
| G3a / GROK CLI | `src/ui/public/PublicHeader.tsx`, `src/ui/public/PublicNav.tsx`, `src/ui/public/PublicFooter.tsx`, `src/ui/public/public-frame.css`, `src/routes/About.tsx`, `src/routes/about.css`, `src/routes/Guides.tsx`, `src/routes/guides.css`, `src/routes/Download.tsx`, `src/routes/download.css` | G1 stable; existing public manifest and frame semantics unchanged; preserve artifact catalog helper |
| L3 / LUNA MAX FAST | `src/shell/HomeView.tsx`, `src/shell/home/HomeBriefingView.tsx`, `src/shell/home-view.css`, `src/shell/CallsHub.tsx`, `src/shell/calls-hub.css` | Shell handoff; controller and model read-only; no call engine/control relocation |
| G3b / GROK CLI | `src/routes/Status.tsx`, `src/routes/status.css`, `src/routes/Stats.tsx`, `src/routes/stats.css`, `src/routes/Roadmap.tsx`, `src/routes/roadmap.css`, `src/routes/PublicInfo.tsx`, `src/routes/public-info.css`, `src/routes/TrustPages.tsx`, `src/routes/data-pages.css` | G3a frame stable; Main owns any shared `landing.css` or public metadata adjustment |
| L4a / LUNA MAX FAST | `src/shell/search/MessageSearch.tsx`, `src/shell/search/message-search.css`, `src/shell/PinnedMessages.tsx`, `src/shell/pinned-messages.css`, `src/shell/RoomMediaIndex.tsx`, `src/shell/room-media-index.css` | Secondary handoff; pin privacy fix preserved; query/vault/media helpers read-only |
| G4 / GROK CLI | `src/app/Account.tsx`, `src/app/account.css`, `src/app/YouSettings.tsx`, `src/shell/PreferencesPanel.tsx`, `src/lib/prefs/preferences.css` | Secondary handoff; stylesheet-only ownership in `lib/prefs`; preferences/auth helpers remain read-only |
| L4b / LUNA MAX FAST | `src/shell/NotificationCenter.tsx`, `src/shell/notification-center.css`, `src/shell/YouNotifications.tsx`, `src/shell/you-notifications.css`, `src/shell/voice/settings/VoiceSettings.tsx`, `src/shell/voice/settings/voice-settings.css` | L4a complete; secondary handoff; no notification engine/media engine changes |
| L4c / LUNA MAX FAST | `src/shell/ModerationCockpit.tsx`, `src/shell/moderation-cockpit.css`, `src/shell/moderation/ModerationActionReview.tsx`, `src/shell/moderation/BanListPanel.tsx`, `src/shell/moderation/moderation-desk.css` | L4b complete; security/permission reviewer required; Main owns related `ChannelSettings` integration |

G3a/G3b are route-by-route packets internally: review the frame, then each page, rather than returning one unreviewable sweep. G4 must not edit `src/app/Appearance.tsx` or theme files merely because its settings index links to them. L4b may refine voice settings, not `VoiceStage`, `VoiceBar`, `VoicePip`, overlay CSS or the media engine. Main can prepare a later separate media-stage packet once actual stage captures identify the needed work.

Main retains `AppShell.tsx`, `PrimaryNavigation.tsx`, `PresenceRibbon.tsx`, `ContextRail.tsx`, `ChannelSettings.tsx`, `shell.css`, `shell-frame-commercial.css`, `harbor-phone.css`, `commercial-navigation.css`, all primitives, route manifests, `src/index.tsx`, `pageMeta.ts`, `tools/materialize-route-entrypoints.mjs`, shared `landing.css`, theme/token/font machinery, package files, backend/persistence helpers, and all E2E tests. Existing first-pass ownership takes precedence until explicitly handed back. Astra's single new roadmap remains outside every implementation packet.

## State coverage and acceptance evidence

| Journey | Minimum states and actions | What must not be inferred |
| --- | --- | --- |
| Public preview and links | Room/Home/Messages selection, keyboard traversal, reduced motion, image/font unavailable, every CTA destination | Fictional scene is not real activity; image load is not application readiness |
| Join/invite | Guest, sign-in, registration/verification, remembered identity, invalid input, pending, connection error, unknown/malformed room, access refused, share success/failure/cancel | A copied invite does not grant access; transport connected is not membership confirmed |
| Collections/Home | Empty, one, dense, filtered empty, unread/mention, caught-up, local memory unavailable, reconnecting, queued/failed send | No invented occupancy, unread counts or cloud history |
| Transcript/composer | Long names/URLs, timestamps, same-author groups, unread and scrolled-up arrival, reply/edit/cancel, attachment busy/fail/retry, queue/offline, emoji/More tools, IME composition | Do not send on IME confirmation; layout changes must not lose drafts or alter delivery semantics |
| DMs/threads/pins/search | Decrypted, locked, deleted, changed key, missing parent/pin, unauthorized unpin, no results, partial/failed device/server retrieval, target changed during work | No ciphertext, deleted text or unsafe fallback in body, snippets, tooltips, live regions or accessible names |
| People/moderation | Empty/dense roster, role changes, ignored user, long display name, permission lost while open, server rejection, offline, explicit confirmation | Pending moderation is not accepted; membership/presence is not gaming activity |
| Calls/media | Idle, incoming/outgoing ringing, provisional, established, reconnect/loss where represented, permission denied, device absent, media disabled, ended; navigation during active call | Opening Calls never joins; faked browser devices do not prove real peer audio/video or encryption |
| Account/preferences/notifications | Guest/account, save/pending/error, unsupported feature, denied permission, empty inbox, long labels, actual light/custom/high contrast, destructive cancel/confirm | No supported-device, saved-setting, passkey or notification-delivery claim without its actual result |

Screenshots must name route/surface, state, viewport, active theme, text scale, fixture/live status, timestamp and candidate revision/diff. Main should keep the supplied `before` images and add candidate captures; do not overwrite the originals. Use stable fictional QA data for geometry captures, visibly distinguished from production. Never expose real private DMs, tokens, invite secrets or account details in review artifacts.

Minimum capture set for P1: homepage desktop 1440×900, compact desktop 1024×768, phone 390×844 and 320×640; populated room and DM at those widths; 320px/200% text; actual light and a custom theme; composer reply/upload/More tools; thread open; keyboard focus and People closed/open. Later packets add their touched surfaces and states. Include a short-height/landscape sample (844×390), safe-area and virtual-keyboard evidence. Do not use `overflow-x:hidden`, scale transforms, or screenshot cropping to conceal reflow failures.

The existing 32px-root fixture in `gamer-layout.spec.ts` is useful stress evidence but is **not full browser zoom or text-only zoom equivalence**: fixed-pixel descendants may not enlarge. Main also verifies actual browser/text enlargement and includes the computed theme/font values. A viewport media emulation alone is not proof that a persisted light theme was selected.

### Commands and reviewer handoff

Writers run focused co-located tests and report exact commands, exit codes, pass/fail/skipped counts and remaining concerns. Suggested P1 commands, to be run by the assigned writers after their changes:

```sh
pnpm exec vitest run src/routes/Landing.test.tsx src/routes/ProductPreview.test.tsx src/routes/HomeRoomBoard.test.tsx --maxWorkers=1
pnpm exec vitest run src/shell/MessageView.transcriptChrome.test.tsx src/shell/MessageView.grouping.test.tsx src/shell/MessageView.thread.test.tsx src/shell/MessageView.dayDivider.test.tsx src/shell/Composer.test.tsx --maxWorkers=1
```

The first command assumes G1 adds its explicitly owned meaningful HomeRoomBoard test. G1 should additionally run existing public control/link tests read-only; L1 runs existing message privacy/menu/reflow tests relevant to its diff. Do not rewrite a failing contract merely to accept a new screenshot. Add tests where interaction or privacy behavior changed; do not add assertions that merely mirror a decorative CSS rule.

Main runs the integrated gates after all contributing source stops changing:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
pnpm check:landing-budget
pnpm exec playwright test tests/e2e/gamer-layout.spec.ts tests/e2e/public-landing-polish.spec.ts tests/e2e/public-route-high-zoom-nav.spec.ts tests/e2e/composer-context-reflow.spec.ts tests/e2e/voice-bar-reflow.spec.ts --project=chromium
```

Select the existing route-specific, sheet/focus, DM privacy, call and browser-engine checks needed for each subsequent diff; relevant Firefox/WebKit evidence follows Chromium. `playwright.config.ts` serves the built `dist/` through a dedicated preview with `reuseExistingServer: false`; do not accidentally test another owner's build or occupied preview port. Connected journeys use their documented endpoint/origin contract, separately from deterministic layout fixtures. A fixture reporting `connected` is not a network test.

Independent review packet: exact diff/files; old/new captures; computed tokens/fonts; keyboard and 320px/200% evidence; functional state results; claim/privacy audit; unresolved failures. Ask the reviewer to refute hierarchy, readability, task completion, protected-text handling and call-control ownership. Re-review corrections that affect those conclusions. Main may then perform the separately authorized deployment/publication workflow after green gates; only `deploy.sh` writes `out/`. Astra does not run any of these commands in this documentation lane.

## Explicit omissions and runtime holds

- **Pending:** fresh foundation-plus-shell captures, integrated test/build/browser results, production verification and publication. Foundation landing and Main's passing typecheck are recorded above; neither the supplied 195-test checkpoint nor the pre-foundation build closes the remaining gates.
- **Source-addressed, runtime pending:** interim headline/mascot positioning refinements. **Source follow-up at inspection:** stable invite result live region. **Reported first-pass regressions pending fresh result:** Home hidden after the top-nav change and 344px timestamp overflow at 320px/200% text. These are under shell-owner repair and are not accepted features of the proposed design.
- **Not reimplemented:** session durability, local history/vault, outbox, backend persistence, encryption, pin privacy, authentication, media transport, notification decisions, game integrations or new routing architecture.
- **Not promised:** live member counts, game presence/overlays, party matchmaking, streaming-platform integration, universal group encryption, guaranteed call privacy, unlimited/cloud history, signed installers, native features, package availability or release dates without their existing evidence.
- **Needs a later exact packet if visual evidence warrants it:** active video/screen stage and overlays, Appearance/Theme Studio composition, full person-safety/profile flows, advanced room settings and operator consoles. Existing capabilities remain reachable; their source presence is not claimed as redesign completion.
- **Outside this website scope:** `/home/kain/landing`, Onyx Server, OnyxOS promotion, legal-policy invention, pricing, analytics and public marketing campaigns. The main site's existing routes are redesigned in `/home/kain/onyx`; no external service or generated visual asset is required to start.

Completion means the newly composed website and daily app surfaces have reviewed screenshots and working task/state evidence on the integrated candidate. This roadmap is ready for those writers now; it is not a claim that the redesign has shipped.
