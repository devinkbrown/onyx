# Onyx client complete commercial overhaul

Status: source-backed audit and execution roadmap
Date: 2026-09-07
Quality bar: commercial quality, consumer quality, beautiful, usable, accessible, truthful
Scope: the complete Onyx client experience, from the first public page through daily chat, calls, privacy, storage, PWA, desktop, operator tools, and release evidence

This is the product and design contract for a major overhaul. It is intentionally larger than a shell refresh. Every feature and UI family is accounted for, every default surface receives a disposition, and every high-consequence state receives an acceptance requirement.

No deployment, commit, push, server change, or native-release claim is authorized by this document.

## Executive decision

Onyx needs a complete product-composition overhaul.

The current client has substantial capability: local-first history, durable drafts and outbox behavior, fail-closed DM encryption, calls and media foundations, accessibility primitives, public status surfaces, room organization, moderation, operator tools, and a large test suite. The commercial weakness is that these capabilities are presented as several overlapping products:

- a consumer chat application;
- an IRC protocol console;
- a network/operator dashboard;
- a privacy and cryptography workbench;
- a local data-management application;
- a call and media suite;
- a public infrastructure status site.

The overhaul must make one coherent product visible:

> Onyx is a calm, private place for rooms, conversations, and calls that remembers where you stopped.

The transport, store, crypto, and compatibility kernel should be preserved unless a source-backed defect requires change. The presentation layer, information architecture, onboarding, terminology, defaults, state model, visual system, and cross-surface ownership should be rebuilt deliberately.

The target outcome is not “more features.” It is:

1. A new user can understand Onyx and reach first value without knowing IRC.
2. A returning user can immediately see what changed and continue reading.
3. A conversation is comfortable to read, write, search, and recover.
4. Privacy and local-first behavior are understandable without exposing unnecessary machinery.
5. Calls, media, notifications, storage, and recovery tell the truth about their current state.
6. Advanced, moderation, operator, diagnostic, and protocol features remain powerful but do not dominate ordinary use.
7. The same product language works on desktop, tablet, mobile, browser, PWA, and any future signed native shell.

## 1. Audit basis and evidence boundary

### Repository snapshot

| Item | Current evidence |
|---|---|
| Client checkout | /home/kain/onyx |
| Branch | onyx-solid |
| HEAD | 846f7a62, docs: point the client 0.7 roadmap at the major-release tracks |
| Static source inventory | 1,210 source files; 177 non-test TSX; 358 non-test TS; 85 CSS files; 589 source test files; 72 Playwright specs |
| Core shell | AppShell is approximately 1,559 lines; shell.css is approximately 9,231 lines |
| Core conversation | MessageView is approximately 2,372 lines; Composer is approximately 1,772 lines |
| Settings | PreferencesPanel is approximately 3,749 lines; ThemeStudio is approximately 2,854 lines |
| Calls | VoiceBar is approximately 1,853 lines; WatchTogetherActivity is approximately 1,238 lines |
| Other high-density surfaces | Connect approximately 1,687 lines; ChannelSettings approximately 1,301 lines; PresenceRibbon approximately 1,472 lines |

### Verification completed for this audit

| Gate | Result |
|---|---|
| pnpm typecheck | Passed |
| pnpm exec eslint --no-cache . | Passed |
| pnpm test -- --maxWorkers=1 | Passed: 598 of 598 files; 7,271 of 7,271 tests |
| pnpm build | Passed; 589 modules transformed |
| pnpm check:server-contract | Passed |
| pnpm check:server-contract-v2 | Passed |
| UI budget measurement | Completed; current payload exceeds the enforced baseline |
| pnpm test:e2e | Not run in this pass |
| Browser, visual, screen-reader, native, live-server, multi-device E2EE and real-media verification | Not run in this pass |

The green source gates establish a strong implementation baseline. They do not establish commercial readiness. Browser behavior, cross-browser layout, assistive technology, live server behavior, multi-device encryption, real calls, native packaging, and install/upgrade behavior still require evidence.

### Current UI payload problem

The budget check currently fails and must be treated as a release-quality issue, not as a future optimization.

| Artifact | Current raw | Current gzip | Gate result |
|---|---:|---:|---|
| Eager JavaScript | 673,646 bytes | 199,694 bytes | Over documented ceiling |
| Eager CSS | 143,404 bytes | 28,326 bytes | Over documented ceiling |
| Eager index JavaScript | 90,902 bytes | 30,132 bytes | Over target |
| Shared runtime | 502,666 bytes | 143,776 bytes | Over target |
| AppShell JavaScript | 590,564 bytes | 175,945 bytes | Over target |
| AppShell CSS | 367,965 bytes | 53,634 bytes | Over target |
| Lazy media | 123,704 bytes | 36,578 bytes | Approximately at target |

The overhaul must reduce eager work by moving route-only, operator, import/export, calls, advanced settings, visualization, and specialized media code behind intentional boundaries. It must not simply raise the baseline.

### Worktree safety

The existing uncommitted user work must be preserved. At audit time it includes operator wording and behavior, shell CSS/grid work, command tests, and mobile breakpoint work:

- src/lib/commands/registry.ts
- src/lib/commands/slash.test.ts
- src/lib/oper/operDesk.test.ts
- src/lib/oper/operDesk.ts
- src/shell/OperDesk.test.tsx
- src/shell/OperDesk.tsx
- src/shell/shell-grid.contract.test.ts
- src/shell/shell.css
- src/lib/mobile/breakpoints.ts

No overhaul work should overwrite, revert, or silently absorb these changes. Every later slice must begin with a fresh worktree/diff review.

## 2. Commercial and consumer definition of done

The overhaul is complete only when all of the following are true.

### First value

A person with no IRC background can:

1. Understand what Onyx is in one short screen.
2. Join an invited room or create a useful private conversation.
3. Continue as a guest or create an account while understanding the consequence.
4. Send a message and understand whether it was sent, saved locally, queued, blocked, or failed.
5. Start a DM from an obvious control.
6. Understand the basic DM privacy state without reading cryptographic terminology.
7. Find people, notifications, settings, help, and their way back.
8. Return later and land on one coherent Home/catch-up view.

Acceptance must work at 320px width and desktop width, with keyboard-only operation and no dead-end state.

### Everyday use

- Home, Rooms, Messages, Calls, and You are stable product destinations.
- A transcript is calm to read and has one understandable unread boundary.
- Reply, reaction, topic, thread, search, pin, save, edit, delete, and translation actions are grouped by intent.
- The composer makes writing, attaching, and sending obvious; advanced actions are progressive.
- Drafts and queued sends form one durable outbox model.
- Notifications have one effective preference model.
- Calls have one join, active, reconnect, failed, and ended model.
- All major surfaces have loading, empty, populated, offline, permission, unsupported, pending, failure, and success states.
- Destructive actions state scope and consequence and provide undo or recovery when technically possible.

### Visual and interaction quality

- Public and authenticated surfaces consume one applied token system.
- Conversation and people have visual priority over telemetry, protocol, moderation, and operator controls.
- No unexplained jargon, duplicate primary controls, ornamental operator chrome, or placeholder capability appears in default consumer mode.
- Every control has a visible label or reliable accessible name, a predictable focus state, and a minimum 44px target.
- Dialogs, sheets, popovers, menus, live regions, autocomplete, and message semantics work with keyboard and screen readers.
- Long names, long messages, large text, 200% zoom, forced colors, dark/light themes, reduced motion, reduced transparency, reduced data, narrow widths, and short mobile heights are supported.

### Privacy, safety, and truthfulness

- No message-content or identity tracking is required for product success measurement.
- Every data operation states whether it is local, server-side, encrypted, retained, exportable, reversible, or destructive.
- Encryption failures fail closed and tell the user what can be done.
- A changed DM key requires deliberate review; acceptance is never the only prominent action.
- Block, mute, report, moderation, operator actions, and safety receipts have distinct meanings.
- Public pages and runtime UI never imply that a staged, unavailable, unsigned, or unverified capability is production-ready.
- Network, host, certificate, node, diagnostic, and operator metadata are permissioned and progressive-disclosure content.

### Performance and supportability

- The current documented budget is met or improved.
- Calls, advanced settings, imports, operator tools, specialized charts, and heavy media remain lazy.
- Transcript, member, and search lists are bounded or virtualized.
- Errors have stable copy and a support-safe identifier that excludes message content, credentials, tokens, cookies, and private capability URLs.
- Storage quota, eviction, corruption, migration, recovery, and export are testable.

### Migration and release

- Existing onyx:* storage, legacy ocean-* migrations, drafts, outbox, vault history, saved searches, themes, invites, and deep links remain compatible.
- Mixed-version server behavior and E2EE compatibility are explicitly tested.
- Typecheck, lint, unit tests, build, browser E2E, accessibility, cross-browser, PWA, storage migration, multi-device E2EE, real media, and native packaging evidence are attached before release claims.

## 3. Product and visual direction

### Post-overhaul performance evidence

The checked-in UI budget baseline is a reviewed post-overhaul measurement from a fresh production build. Route-only/app-only work is isolated, eager JS/CSS dropped substantially, optional media remains bounded, and the AppShell/runtime values reflect the intentionally expanded commercial surface. This is artifact evidence only; it does not claim browser, native, visual, accessibility, live-server, or real-media verification.

### Astra’s design thesis

Astra’s design pass establishes the visual direction:

> A quiet, personal place that remembers where you stopped.

The product should feel warm and precise rather than glossy or game-like. Rooms can have identity, but the transcript should remain the reading plane. The interface should have a recognizable Onyx mark and accent language without turning every surface into a themed dashboard.

Avoid:

- dark backgrounds plus neon glow as the default identity;
- giant Home metric cards and activity graphs;
- serif or nautical language everywhere;
- a permanent server tower and several simultaneous rails;
- security proof cards that imply stronger guarantees than the system has verified;
- identical rounded containers around every element;
- ambient animation behind text or important controls;
- operator terminology in consumer flows.

### Proposed token direction

These are design seeds for implementation and contrast testing, not a final production palette.

| Role | Seed | Use |
|---|---|---|
| Ink | #101820 | Dark reading canvas and light-theme primary text |
| Slate | #263641 | Dark secondary surfaces |
| Paper | #F3F6F5 | Light reading canvas and dark-theme primary text |
| Mist | #ADC0C9 | Secondary text and quiet structure |
| Tide | #397386 | Primary action, selection, links, and focus |
| Coral | #B7463E | Destructive, failed, and urgent states |

Semantic tokens must be separate from raw colors:

- surface.canvas, surface.raised, surface.overlay, surface.inverse;
- text.primary, text.secondary, text.muted, text.inverse;
- border.subtle, border.strong, border.focus;
- action.primary, action.secondary, action.selected;
- status.info, status.success, status.warning, status.danger;
- protection.ready, protection.review, protection.unavailable;
- content.link, content.mention, content.topic.

Rules:

- Never use color alone for selection, unread, safety, or failure.
- Never use universal green to imply security or correctness.
- Room accents cannot override focus, warning, danger, or protection semantics.
- Normal text must meet 4.5:1 contrast; UI boundaries and large text must meet 3:1.
- Forced-colors and high-contrast modes use solid/system-readable surfaces.
- Security status must include a label and evidence affordance, not only a colored chip.

### Typography

| Use | Recommendation |
|---|---|
| Message and form text | Instrument Sans, 16px, 1.5 line height |
| Secondary text | Instrument Sans, 14px, 1.4 |
| Timestamps and metadata | Instrument Sans tabular numerals, 12–13px |
| Conversation title | Instrument Sans 600, 20px, 1.25 |
| Page title | Instrument Sans 600, 24–28px, 1.2 |
| Home/welcome accent | Fraunces 28–36px, used sparingly |
| Exact identifiers/fingerprints | JetBrains Mono 14px, 1.5 |

Messages should read within roughly 60–72 characters where practical. Use sentence case, left alignment, rem-based sizing, multilingual fallbacks, and no tight tracking. Resolve the current token ladder’s confusing 11px/12px small-text distinction.

### Geometry and motion

- Spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Radius: 4 for tags, 8 for controls, 12 for media and popovers, 16 for sheets.
- Keep content surfaces mostly flat; use one overlay level and one modal level.
- Minimum control target: 44px; prefer 48px on touch.
- Focus: visible 2px outline with offset, never a low-contrast shadow.
- Control transition: about 120ms; disclosure: about 180ms; sheets: at most 220ms.
- Reduced motion removes sliding, spring, unread animation, and automatic scroll; transitions become immediate.
- Reduced transparency uses opaque surfaces.
- Reduced data stops preview, media, and ambient scene downloads.

### Responsive wireframes

Desktop default:

~~~text
+-----------------------------------------------------------------------+
| Onyx mark | Home | Rooms | Messages | Calls | You        status  avatar |
+-------------+----------------------+----------------------+-----------+
| Your rooms  | Room name            |                      | People    |
| New message | topic       People   |      transcript      | context   |
| Favorites   | Search    Call  More |      reading plane   | tools     |
| Rooms       +----------------------+----------------------+-----------+
| DMs         |                      | composer             |           |
+-------------+----------------------+----------------------+-----------+
~~~

Tablet:

~~~text
+---------------------------------------------------------------+
| Onyx | Home Rooms Messages Calls You       room  People More  |
+----------------------+----------------------------------------+
| temporary collection |               transcript               |
| rooms, DMs, browse   |               composer                 |
+----------------------+----------------------------------------+
~~~

Mobile:

~~~text
+--------------------------------------+
| < Rooms   room name       People More |
+--------------------------------------+
| topic / privacy / call status        |
|                                      |
|          transcript                  |
|                                      |
| reply / composer / attach / send     |
+--------------------------------------+
| Home       Rooms     Messages Calls You |
+--------------------------------------+
~~~

At mobile keyboard height, hide bottom navigation and nonessential secondary headers, cap composer growth, preserve focus, and keep route exit and send-failure recovery visible.

Proposed responsive thresholds should be validated rather than blindly replacing existing breakpoints:

- 1,120px and above: persistent collection plus optional context pane;
- 720px to 1,119px: flexible two-pane layout;
- below 720px: one pane with temporary sheets.

## 4. Canonical information architecture

### Primary destinations

The authenticated product has five stable destinations:

1. Home — what changed, what needs attention, and where to continue.
2. Rooms — room list, discovery, creation, folders, favorites.
3. Messages — DMs, mentions, saved or followed conversations.
4. Calls — active, recent, incoming, and discoverable calls.
5. You — profile, privacy, devices, notifications, appearance, data, help.

You may open as a dialog on narrow screens, but it must remain a predictable destination and not an unexplained transient mode.

### Location model

Every view must answer four questions:

- Where am I?
- What is the primary thing I can do here?
- What changed since last time?
- How do I get back without losing work?

The shell state model must have one owner for:

- current destination;
- current room or DM;
- collection/sidebar visibility;
- context/people visibility;
- active call;
- modal/sheet/popover stack;
- focus restoration target;
- pending route intent.

### Overlay policy

- Default room header: room identity, topic, people, call, search, More.
- More contains room details, notifications, export, media, advanced tools, moderation, and operator tools according to permission.
- One modal or sheet may claim primary attention at a time.
- Toasts are for noncritical confirmation. Failures requiring action remain inline.
- Escape closes the topmost owned layer and restores focus.
- Any route that opens a dialog has a direct route-safe fallback.

### Terminology migration

| Current or internal language | Consumer-facing default |
|---|---|
| Nick | Name |
| Reclaim | Recover my name |
| Protected name | Reserved name |
| Node | Server |
| Room ledger | Room details or room activity |
| Presence heatline | Recent activity |
| Room desk | Room tools |
| Room care | Moderation and safety |
| Capability matrix | What works here |
| Device memory | Saved on this device |
| Reviewed span | Marked as read |
| Cold vault | Older saved history |
| Formation | Create a room |
| Oper desk | Operator workspace |
| SASL or protocol mode | Advanced connection settings |

Internal/protocol wording remains available in Advanced, diagnostics, and developer/operator surfaces.

## 5. Exhaustive feature and UI audit

The following inventory is the design disposition for every observed client-facing family. “Keep” means preserve the kernel or capability while changing the default presentation. “Merge” means one canonical entry point must replace competing surfaces. “Advanced” means available but not mounted in ordinary chat chrome. “Retire” means remove, archive, or stop exposing an orphaned duplicate after migration evidence exists.

### 5.1 Public routes and front door

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| Router and bootstrap; src/index.tsx, src/routes/AppRoute.tsx | Public routes, lazy loading, stale-chunk recovery, vault/PWA initialization, Connect | Make one public-to-product narrative; remove stale “minimal slice/later wave” comments; define route ownership and canonical deep links | First paint, lazy failure, stale chunk, unauthenticated, restored route, browser refresh |
| Landing; src/routes/Landing.tsx | Explains Onyx, rooms, calls, local-first continuity, join/download | Make one promise and three task CTAs: join a room, start privately, try locally; remove infrastructure-first copy | 320px, conversion comprehension, CTA failure, no-JS fallback where applicable |
| ProductPreview; src/routes/ProductPreview.tsx | Presentational product explanation | Turn into an honest guided preview with real vocabulary and no fake product state | Keyboard, reduced motion, empty/unavailable capability |
| About and public frame; src/routes/About.tsx, src/ui/public/PublicFrame.tsx | Brand, principles, public navigation | Apply the same tokens and typography as the app; explain product, privacy, and local-first value in plain language | Theme, contrast, mobile nav, route announcement |
| Guides and community; src/routes/Guides.tsx | Education, first-room guidance, safety explanations | Merge into the first-run journey; retain a searchable help destination for later | Resume, dismiss, deep link, no duplicate onboarding prompts |
| Invite; src/routes/Invite.tsx | Preview, copy, join, sign-in | Make invite acceptance the shortest path to first value; preserve invalid/stale/expired link context | Clipboard denied, invalid, expired, server mismatch, guest/account choice |
| Download and install; src/routes/Download.tsx, app.zon | Browser/PWA and desktop catalog | Browser/PWA first; label native as preview until capabilities, signing, updater, and installers are proven | Unsupported platform, checksum, unsigned package, install/upgrade/recovery |
| Stats, status, comparison; src/routes/Stats.tsx, Status.tsx, PublicRoomComparison.tsx | Public network proof and room data | Keep trust/status storytelling; move analytical comparison behind secondary discovery | Freshness, degraded feed, unavailable feed, source/freshness explanation |
| Roadmap; src/routes/Roadmap.tsx | Public product roadmap | Present outcomes and availability truth; separate shipped, active, planned, and exploratory | Stale data, unknown status, deep link, accessible accordions |
| OnyxOS, integrations, agents | Adjacent technical/product surfaces | Separate “available today” from “planned” and return users to the core product | Capability unavailable, external link, version freshness |
| Trust pages; src/routes/TrustPages.tsx, PublicInfo.tsx | Privacy, guidelines, contact, accessibility, glossary | Add canonical policy, security contact, incident path, data location, abuse process, and versioned claims; resolve security.txt TODO | Legal copy version, contact failure, print, keyboard |
| NotFound; src/routes/NotFound.tsx | Unknown-route recovery | Explain what happened and offer Home, Rooms, and search; preserve the attempted destination safely | Direct deep link, stale route, offline |
| Public appearance | Public theme controls | Keep simple appearance choices; do not expose full Theme Studio from the public funnel | Contrast, reduced motion, reset, persistence |

### 5.2 Connection, identity, and first-run

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| Connect; src/app/Connect.tsx | Guest, sign-in, registration, remembered identity, server, passkey, recovery, reclaim | Replace mode switching with a guided identity journey; use “continue as guest” as an explicit option; translate IRC terms | Invite context, server error, protected/reserved name, passkey cancel, recovery failure, retry |
| Remembered identities | Return identity selection | Make identity, device, and privacy consequence obvious; allow safe removal without erasing unrelated local history | Empty, stale, locked, deleted, multiple identities |
| Guest continuity | Anonymous participation | Explain what is local, what is temporary, and how to keep the name without interruption | Claim later, dismiss, lost local state, offline |
| GuestClaimPrompt; src/shell/GuestClaimPrompt.tsx | Prompt to keep a name | Show only after meaningful value; one visible recommendation at a time; never block conversation | Register, email verification, failure, later |
| FirstHourCoach; src/shell/FirstHourCoach.tsx | Two first-hour tips | Merge into a quiet, resumable checklist: join, send, find people, privacy, return | Dismiss, resume, completed, reduced motion |
| FirstRunNotifyPrompt | Browser notification permission | Ask only after engagement; explain browser/device scope and unsupported states | Granted, denied, unsupported, later, PWA |
| AddToHomeScreenSheet | PWA installation | Ask after value and never compete with first message or recovery | Browser-specific prompt, dismissed, installed, unavailable |

### 5.3 Product frame and navigation

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| AppShell; src/shell/AppShell.tsx | Mounts nearly every runtime and rail | Introduce a clear shell state machine and route-level lazy boundaries; keep core transcript fast | Initial, reconnect, session reclaim, offline, modal stack, keyboard |
| PrimaryNavigation; src/shell/PrimaryNavigation.tsx | Home, Rooms, Messages, Calls, You | Keep five destinations with labels and stable order; replace glyph-only ambiguity | Selected, unread, mention, keyboard, narrow width |
| ServerRail; src/shell/ServerRail.tsx | Single active Onyx server rail | Use one Onyx identity mark; hide server/network switching until multiple networks exist; move diagnostics out | One server, many servers, disconnected, unsupported |
| ChannelSidebar; src/shell/ChannelSidebar.tsx | Rooms, DMs, filters, favorites, folders, join | Split Your conversations, Discover, Create; make New message and New room explicit | Empty, loading, offline, pending join, permission, search no result |
| RoomSwitcherSheet | Mobile room navigation | Temporary sheet with current location, search, unread, and safe return | Focus trap, back, keyboard, long list, route persistence |
| HomeView and HomeBriefingView | Catch-up, mentions, invites, queue, vault, formation | Make one Home inbox: Needs attention, Continue reading, Waiting to send, Browse or start | First visit, quiet, populated, offline, mark-read undo |
| PresenceRibbon | Room identity, topic, privacy, call, people, search, inbox, More | Reduce to identity/topic/people/call/search/More; move stats, export, protocol and operator controls | Long topic, no topic, permission, active call, offline |
| ContextRail | Insights, moderation, operator tools | Optional context pane; never compete with transcript; permission-gate advanced content | Closed, open, mobile sheet, denied, stale data |
| MemberList and Facepile | People, roles, filtering, actions | People first: name, presence, shared context, message action; hide network metadata by default | Loading, empty, huge list, blocked, role, keyboard |
| PresenceHeatline and activity surfaces | Activity visualization | Rename Recent activity, collapse by default, remove from ordinary chat if not actionable | No data, stale, reduced data, screen reader summary |
| ChannelBrowser | Discover public rooms | Task-focused browse with purpose, people, privacy, activity, and join action | Empty directory, capability unavailable, join rejected |
| CreateRoomFormation and room creation | Start room with formation rules | Offer immediate private room or DM; explain formation as optional community guidance | Invite, eligibility, no invitee, server refusal |
| ChannelOrganizationSection | Folders/categories/favorites | Make organization easy and local; preserve deterministic ordering and recovery | Empty folder, rename, drag alternative, mobile |

### 5.4 Conversation and message experience

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| MessageView; src/shell/MessageView.tsx | Transcript, grouping, unread, history, topics, threads, gestures | Calm reading plane with grouped messages, real unread seam, obvious jump controls, progressive provenance | First load, empty, older history, new messages, offline, long text, screen reader |
| MessageText; src/shell/message/MessageText.tsx | Formatting, mentions, code, quote, spoiler, links, blocks, media | Use a semantic message-content container; never put block content inside a paragraph; keep previews consent-aware | Rich content, invalid markup prevention, alt text, safe links, keyboard |
| System events | Joins, parts, modes, notices | Collapse and label as system history; keep important safety/server events visible | Long event, permission, mixed message order |
| Message grouping and timestamps | Density and scanability | Use author/time changes and day separators; expose exact time on demand | Locale, timezone, large text, bidi |
| Message unread boundary | Return continuity | One durable “New since your last visit” seam tied to actual read state; make mark-read reversible | Reconnect, multiple devices, route change, search result |
| MessageMenu and message icons | Reply, react, copy, search, translate, topic, edit, pin, ignore, delete | Default row: Reply, React, Copy; More groups secondary and destructive actions | Permission, expired message, destructive confirmation, touch |
| Reactions and boosts | Emoji/reaction controls | Keep fast reaction path; show count, participants, undo, and unsupported state | Optimistic failure, keyboard, reduced motion |
| Topics and TopicChip | Topic/forum navigation | Make topic versus reply/thread distinction explicit and plain-language | Create, switch, empty, archived, permission |
| Threads and thread sheet | Replies and thread context | Keep context close to message; do not create a second hidden transcript | Deep link, stale parent, loading, mobile |
| PinnedMessages and saved items | Persistent message retrieval | Keep Pins for room-shared items; keep Saved for personal items; explain scope | Empty, permission, unpin, offline |
| Reader memory, review trail, time scrubber | Device continuity and history navigation | Present “saved on this device” and “marked as read”; move time travel to Advanced history | No local memory, retention boundary, large vault, exact date |
| Composer; src/shell/Composer.tsx | Input, reply/edit, attach, emoji, slash, nick, schedule, tools | Text, Attach, Emoji, Send are primary; commands, schedule, jump, help in More | Draft, IME, paste, offline, failure, upload, accessibility |
| Attachments and MessageText media | Upload, progress, gallery, previews | Show filename, size, progress, cancel, retry, protection scope, alt text; stable gallery | Offline, failed upload, permission, reduced data, unsafe type |
| Emoji picker and slash/nick suggestions | Composition assistance | Treat as contextual overlays with accessible announcements and keyboard selection | Empty, filtering, IME, touch, screen reader |
| ScheduledMessagesSheet | Scheduling | Keep only where server/encryption semantics support it; explain refusal in plain language | Timezone, offline, encrypted refusal, cancel, dispatch |
| Drafts and outbox | Local drafts, queued sends | One Outbox workspace with saved locally, waiting to send, failed, sent, retry, cancel | Reload, quota, corruption, reconnect, privacy |
| Search; src/shell/search/MessageSearch.tsx | Server/device, hybrid, semantic, saved search | One search entry with explicit scope: this conversation, this device, server | No results, unavailable scope, stale, privacy, deep link |
| JumpToDateSheet and history | Date and history navigation | Make date jump safe and bounded; disclose retention gaps | Invalid date, no history, loading, large vault |
| Translation and provenance | Message translation/source attribution | Show actor, source, action, and scope; never imply server endorsement | Missing source, unavailable translator, copy |

### 5.5 People, privacy, and safety

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| PeopleProfileCard | DM, mention, block, report, room role, profile | Make Message, View profile, Mute, Block, Report distinct; hide host/certificate data from default view | Self, blocked, unavailable, permission, report draft |
| WhoisSheet | Account, bot, host, node, certificate, shared rooms | Move technical identity to Advanced; show only necessary privacy-minimized profile information | Missing, protected, operator-only, copy-safe |
| PersonSafetySheet | Block, mute, report note | Define real report lifecycle or explicitly label local draft; add acknowledgement and recovery | Report unavailable, evidence scope, undo block |
| DmSafetySheet | Device safety number, key readiness, comparison | Lead with plain-language privacy state; expose technical proof behind Review security details | Ready, review, unavailable, locked, recovery |
| DmKeyChangeBanner | Changed key warning | Persistent, calm, action-oriented warning; Review first, accept only after explanation, continue safely where possible | Changed, restored, rejected, no key, multi-device |
| GroupControlRoomIndicator | Group E2EE control state | Clearly distinguish active, staged, unavailable, and ordinary room privacy; never overclaim group protection | Mixed members, missing control, migration, no plaintext fallback |
| E2EE key/device surfaces | Keyring, trust stores, sessions, welcome, signed control | One Devices and privacy model; retain cryptographic detail in an expert drawer | New device, revoked device, mismatch, recovery |
| Blocked users/hosts and muted DMs | Local safety controls | Separate who is blocked, what is muted, and why; make undo discoverable | Empty, import, persistence, offline |
| Moderation reports | Local note into #root today | Do not market as a complete report system; either implement server intake or clearly mark local-only draft | Submission, unavailable, acknowledgement, appeal |

### 5.6 Calls, voice, video, and media

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| CallsHub | Calls destination and directory | Make active and recent calls primary; support clear join/incoming/rejoin paths | Empty, loading, no capability, permission, network |
| Prejoin | Device and destination choice | Show destination, microphone, camera, speaker, privacy, and Join call in one calm step | Permission denied, no device, device change, unsupported |
| IncomingCallOverlay | Accept/decline | Keep high priority but non-destructive; explain room/person and device state | Multiple calls, timeout, blocked, denied |
| OutgoingCallOverlay | Cancel and waiting | Show who is being called, retry, cancel, and network state | No answer, refusal, timeout, reconnect |
| VoiceBar | Persistent call controls | One stable control bar with mute, camera, speaker, leave, More; no competing control clusters | Active, reconnecting, failed, minimized, keyboard |
| VoiceStage and StagePanel | Stage/fullscreen participant view | Consolidate into one call state machine; people occupy the canvas, controls remain stable | One participant, many, screen share, layout, long names |
| ParticipantTile and Facepile | Participant identity | Accessible names, speaking state, mute/camera status, focusable actions | Video failure, hidden, low bandwidth, screen reader |
| VoicePip | Mini call view | Keep as an optional returnable state; never obscure composer or route exit | Drag/keyboard alternative, focus, mobile |
| CaptionsOverlay | Captions, copy, translation | Make captions optional and clearly local/remote; preserve transcript readability | No speech, unavailable, translation source, reduced motion |
| Voice reactions | Reactions | Contextual secondary action; no distracting ambient animation under reduced motion | Send failure, spam control, accessibility |
| WatchTogetherActivity | Shared media controls | Move into activity drawer; label host, participant, local, remote, unavailable states | Join, leave, seek, host, media error, permission |
| Media settings | Camera/mic/speaker/device | One device settings surface shared by prejoin and active calls | No devices, permission, browser support |
| Cadence media and media engine | Runtime capability | Keep media kernel; expose capability truth and lazy-load all heavy paths | Browser, bandwidth, reconnect, security |

### 5.7 Account, settings, appearance, and data

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| YouSettings and Account | Profile, security, account actions | Merge into You with task-based navigation, not implementation categories | Unauthenticated, loading, save failure, destructive confirmation |
| PreferencesPanel | Display, transcript, history, import/export, extensions, accessibility, storage | Split into Profile; Privacy and safety; Devices; Notifications; Appearance; Data and storage; Advanced | Search, deep link, reset, migration, confirmation |
| ChannelSettings | Room topic, access, history, modes, integrations | Sections: Basics; People and access; Privacy and encryption; Notifications; Integrations; Advanced | Permission, dirty form, server refusal, irreversible action |
| AppearancePanel and app Appearance | Theme, density, text size, motion, transparency | One simple appearance page; preserve advanced editor as optional Theme Studio | Light/dark, system, contrast, reset, persistence |
| ThemeStudio | Token editor, custom themes, import/export | Keep as power-user design tool; validate every token and preview against real transcript states | Invalid import, contrast failure, reset, share, reduced motion |
| Backgrounds and animated scenes | Ambient visual identity | Opt-in only; opaque reading surface; no text behind animation; honor reduced data/motion | Download blocked, error, contrast, disabled |
| Notifications and YouNotifications | Inbox, quiet hours, keywords, followed conversations | One notification model with effective-policy explanation and one place to change it | Permission, denied, unsupported, local/server scope |
| Passkeys, recovery, sessions/devices | Account protection | Make device list and recovery path understandable before exposing raw credentials | Add, rename, revoke, lost device, confirmation |
| PortableIdentitySection | Identity portability | Present what moves, where it is encrypted, and how to recover; raw export in Advanced | Export failure, import conflict, duplicate, recovery |
| HistoryImportControls | IRC/Slack/Discord imports | Separate Move history in, Take data out, Erase this device; show scope and progress | Token handling, preview, failure, cancel, erase |
| Account data verbs | Account record download/export | Plain-language export center with privacy-safe progress and receipt | Expiry, retry, download failure |
| Storage/vault retention | Local history, retention, quota | Make local storage legible; never hide deletion behind vague “clear” | Quota, eviction, corruption, migration, restore |
| PWA readiness and service worker | Install, update, offline | Browser/PWA support is canonical; update ready offers Update now or Later | Offline, quota, update failure, reload safety |
| Accessibility panel | Contrast, motion, transparency, data, text | Make normal accessibility settings first-class, not advanced | Forced colors, zoom, screen reader, reset |
| ShortcutsOverlay and Spotlight | Keyboard accelerators and command search | Accelerators supplement visible controls; Spotlight has task nouns, not internal verbs | No keyboard, conflicts, touch alternative |

### 5.8 Moderation, operator, integrations, and specialized tools

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| ModerationCockpit | Room moderation, modes, bans, review | Separate permissioned moderation workspace from daily chat; add reason, scope, expiry, receipt | Unauthorized, offline, confirmation, undo/appeal |
| BanListPanel | Ban list | Table/list with identity, reason, expiry, action, audit history | Empty, loading, permission, stale |
| ModerationActionReview | Action confirmation | Preflight exact affected user/scope and consequence; no vague confirmation | Failure, retry, audit receipt |
| OperDesk | Broadcast, kill, rehash, privileges | Remove from default chrome; explicit Operator workspace only | Permission, target, preview, destructive receipt, server evidence |
| OperEventConsole | Observe masks and events | Advanced console with saved filters; no consumer exposure | Unsupported mask, empty, live/replay distinction |
| CapabilityMatrix | Capability truth | Rename What works here; put important limitations near affected action; technical view Advanced | Unknown, unsupported, staged, version mismatch |
| BridgeStatusBadge | Bridge/integration state | Show actor, destination, direction, freshness, and failure action | Offline, stale, unauthorized |
| Extension audit/actions | Extension permissions and controls | One extension center with install, permissions, source, disable, remove | Untrusted, unavailable, failure, rollback |
| Translation/intelligence | Local or external helpers | Source, actor, action, privacy scope, and failure always visible; opt-in for content processing | No provider, privacy refusal, stale |
| Integrations and webhooks | Room/service connections | Guided integration setup; move secrets and raw payloads to Advanced | Permission, secret exposure, test event, revoke |
| ProvenanceBadge and proof UI | Trust and source evidence | Keep only evidence that helps a real decision; retire decorative proof rails | Missing evidence, stale evidence, inaccessible detail |
| Room insights/events | Analytics and room activity | Collapse or relocate; never compete with transcript; use honest freshness | Empty, stale, unavailable, reduced data |
| Support/help | Accessibility, glossary, contact | One searchable help destination with task-oriented language and version context | Offline, search no result, contact path |

### 5.9 Primitives, layout, icons, and platform

| Surface and source | Current role | Complete-overhaul treatment | Required states and proof |
|---|---|---|---|
| Button, IconButton, FormField | Core controls | Sanctioned control contract: label, loading, disabled, error, focus, target | Keyboard, touch, forced colors, screen reader |
| ModalShell, Sheet, Popover | Overlays | One stack, one focus restoration rule, one Escape rule, consistent headers/actions | Nested layers, mobile, scroll lock, restore |
| Tabs, Tooltip, Spinner | Navigation and feedback | Use tooltip only as supplement; tabs have visible selection and URL-safe deep links | Keyboard, no hover, loading announcement |
| Toast | Noncritical feedback | Inline persistent errors for action-required states; critical errors never disappear on a timer | Screen reader, action, undo, overflow |
| Avatar, facepile, icons | Identity and affordances | Use meaningful labels; icon alone never carries a required action; consistent stroke/size | Missing image, initials, high contrast |
| Stack, Cluster, Frame, Split, ScrollRegion | Layout | Use layout primitives for responsive contracts; remove bespoke one-off geometry | Overflow, long content, zoom, RTL |
| Public header/footer/navigation | Public frame | Same brand and route semantics as product; no separate visual language | Mobile, focus, active route |
| A11y announcer and skip links | Assistive navigation | Test route, modal, message, autocomplete, and notification announcements in real AT | NVDA, VoiceOver, TalkBack, keyboard |
| Background and scene policy | Visual atmosphere | Content owns contrast; scene is subordinate and lazy | Reduced motion/data, failed asset |
| Desktop platform bridge | Native shell | Browser/PWA stays canonical until bridge, notifications, deep links, secure storage, updater, signing are proven | Capability matrix, installer, update, uninstall |

### 5.10 Feature-library coverage

The audit includes the source families behind the UI, not only TSX components:

- Store, activity, IRC, network, credentials, session, and reconnect behavior.
- Rooms, channel navigation memory, hidden rooms, bookmarks, folders, joins, and formation.
- Identity, overrides, profiles, WebAuthn, passkeys, recovery, and certificates.
- E2EE DM cipher/privacy, key pinning, device identity, keyring, trust stores, sessions, welcome, group directory, group control, and signed payloads.
- Vault, search, topics, catch-up, history retention, export, import, and migration.
- Composer, drafts, schedule, upload, preview, reactions, emoji, formatting, and text parsing.
- Notification permission, web push, quiet hours, smart mute, followed conversations, keywords, read state, digest, closed-tab state, and first-run consent.
- Cadence media, call session, media engine, screen wake lock, video, audio, captions, and device handling.
- People, moderation, ignored users, muted DMs, operator actions, and reporting.
- Invite, room formation, stats, interop, integrations, intelligence, and extensions.
- Preferences, platform, mobile keyboard/breakpoints, accessibility, theme, migration, and backgrounds.

Source presence is not proof of a complete journey. Each family must be connected to the canonical IA, state contract, browser evidence, and release gate.

## 6. Competing-flow consolidation

| Current competing flows | Canonical replacement |
|---|---|
| Connect, Guides, FirstHourCoach, GuestClaimPrompt, notification prompt, Add to Home | One resumable first-run coach with one visible next action |
| Account, YouSettings, Appearance, AppearancePanel, PreferencesPanel, ThemeStudio | You destination with task-based settings and optional Theme Studio |
| HomeBriefingView, SinceDigestCard, CatchUpSummary, MarkAllCaughtUp | One Home inbox and one unread boundary |
| PresenceRibbon, ContextRail, More sheet, ChannelSettings, moderation, operator desk | Room header plus contextual room tools, moderation workspace, operator workspace |
| CallsHub, StagePanel, VoiceStage, VoiceBar, VoicePip, call overlays | One call state machine and one persistent call control contract |
| Profile card, member double-click, ribbon action, Spotlight command | Explicit New message/New conversation plus contextual shortcuts |
| Room ledger, capability matrix, session truth bar, E2EE banners, provenance badges, public stats | One user-facing truth model with technical evidence on demand |
| Legacy tokens, ui-* tokens, Theme Studio, scene policy, bespoke shell CSS | One applied token contract with migrated primitives and retired duplicates |

## 7. Universal state contract

Every route, panel, sheet, list, action, and feature must specify the following before it is considered designed:

| State | Required user-facing behavior |
|---|---|
| First paint | Stable structure, no layout jump, route and purpose announced |
| Loading | Explain what is loading; preserve context; no indefinite spinner |
| Empty | State why it is empty and provide one next action |
| Populated | Show primary content first; secondary metadata progressive |
| Partial | Explain which part is unavailable without hiding usable content |
| Offline | Say what is available locally and what cannot be sent or refreshed |
| Reconnecting | Preserve drafts and focus; show whether retry is automatic |
| Permission denied | Name the permission and give the exact platform or account action |
| Unsupported | Say what is unsupported, why, and the safe alternative |
| Pending | State ownership, expected next event, and cancellation where possible |
| Failure | Keep the user’s work; show retry, copy-safe diagnostics, and recovery |
| Confirmation | State scope, consequence, destination, and reversibility |
| Success | Confirm the durable result and offer the next likely action |
| Stale | Show freshness and let the user refresh or inspect source |
| Reduced motion/data/transparency | Honor preference without hiding meaning |
| Forced colors/high contrast | Preserve borders, selection, focus, and status without decorative color |
| Long content | Wrap or scroll intentionally; never clip controls or identities |
| Keyboard-only | Focus order, visible focus, Escape, Enter/Space, and no hover-only action |
| Touch-only | 44px targets, no hover dependency, safe sheets, keyboard-aware layout |
| Screen reader | Correct role/name/value, live announcement only when useful, no duplicate noise |

Component acceptance should include the state fixture and the browser scenario, not just the happy-path unit test.

## 8. Dependency-aware roadmap

### Phase 0 — Contract, inventory, and baseline

Objective: decide what Onyx is before styling more surfaces.

Work:

- Approve the five-destination IA and consumer vocabulary.
- Inventory every route, component, primitive, library family, command, overlay, and CSS ownership.
- Mark every surface Keep, Merge, Hide by default, Advanced, Retire, or Blocked.
- Create a capability truth table for browser, PWA, native, server, E2EE, calls, notifications, imports, and integrations.
- Create fixture data for first run, quiet room, populated room, unread boundary, offline, queued send, failed upload, changed key, unavailable call, permission denial, and large content.
- Record source and runtime confidence separately.
- Capture the current visual and UI-budget baseline.

Exit:

- One route/shell map.
- One terminology glossary.
- One state taxonomy.
- Every current UI family has an owner and disposition.
- Six baseline user tasks are runnable locally.
- No work begins on a new visual shell while competing flows remain undefined.

### Phase 1 — Design system and primitives

Objective: establish the visual grammar and interaction contracts.

Work:

- Merge legacy app tokens and ui-* tokens into one applied contract.
- Define light, dark, high-contrast, forced-colors, and room-accent semantic themes.
- Implement typography, spacing, radii, borders, focus, elevation, motion, and reduced-data tokens.
- Harden Button, IconButton, FormField, ModalShell, Sheet, Popover, Tabs, Toast, Tooltip, Avatar, and layout primitives.
- Add control states: loading, disabled, invalid, warning, destructive, selected, and success.
- Add visual regression fixtures and accessibility stories for every primitive.
- Replace bespoke raw controls incrementally, beginning with the shell.

Exit:

- New primitives pass keyboard, forced-colors, reduced-motion, and target-size tests.
- Public and authenticated surfaces render from the same token contract.
- Focus and overlay behavior has one implementation.
- The core route is not heavier than the measured budget allows.

### Phase 2 — Public front door and content architecture

Objective: make Onyx understandable before authentication.

Work:

- Redesign Landing, ProductPreview, About, Guides, Invite, Download, Status, Trust, and NotFound.
- Use task-oriented CTAs and remove unexplained infrastructure language.
- Distinguish available, staged, planned, experimental, and unavailable capabilities.
- Establish canonical policies, security contact, accessibility statement, and support routes.
- Test comprehension with people unfamiliar with IRC.

Exit:

- A visitor can explain Onyx and choose a correct first action.
- Invite flow reaches room value without route confusion.
- Download page cannot imply unsigned or unavailable native functionality is production-ready.
- Public pages meet visual, contrast, keyboard, mobile, and route-announcement gates.

### Phase 3 — First-run identity and continuity

Objective: replace fragmented onboarding with one calm path.

Work:

- Rebuild Connect as a guided identity journey.
- Preserve guest continuity and make account conversion voluntary.
- Integrate first room, first message, first DM, privacy explanation, notification consent, and optional install prompt.
- Create one resumable progress model and one visible recommendation at a time.
- Add all auth, server, invite, passkey, protected-name, recovery, and offline branches.

Exit:

- A new user completes join or create, sends a message, starts a DM, and returns to Home.
- No step requires knowing nick, SASL, reclaim, node, or protocol terminology.
- Guest, account, and local data consequences are understood.
- Browser task evidence exists at desktop and 320px.

### Phase 4 — Responsive product frame

Objective: make navigation and hierarchy feel intentional on every device.

Work:

- Rebuild AppShell around the canonical state model.
- Redesign PrimaryNavigation, ServerRail, ChannelSidebar, RoomSwitcherSheet, PresenceRibbon, ContextRail, MemberList, and mobile navigation.
- Remove always-on rails and dense default controls.
- Establish collection, conversation, and context pane behavior at each width.
- Enforce one overlay stack and focus restoration.

Exit:

- Desktop, tablet, and mobile use the same IA and vocabulary.
- Home, Rooms, Messages, Calls, and You are reachable without hidden gesture dependence.
- No essential room action is trapped under an ambiguous More menu on mobile.
- Layout survives 320px, 200% zoom, long names, short heights, keyboard, and touch.

### Phase 5 — Home, rooms, people, and discovery

Objective: make return use and room management effortless.

Work:

- Consolidate HomeBriefingView, SinceDigestCard, CatchUpSummary, and MarkAllCaughtUp.
- Build one attention → continue reading → waiting to send → discover/start ordering.
- Redesign room browse, create, join, invite, favorites, folders, filters, and organization.
- Add an explicit New DM/New conversation journey.
- Simplify member cards and profile actions.

Exit:

- A returning user finds unread, mentions, invites, and queued sends.
- A new room can be joined or created without protocol vocabulary.
- A DM can be started from Home, Messages, People, and Spotlight.
- Mark-read and organization changes are reversible and persist.

### Phase 6 — Conversation core

Objective: make reading and writing feel consumer-grade.

Work:

- Rebuild transcript grouping, day separators, unread seam, jump controls, topics, replies, and threads.
- Fix rich-content semantics in MessageText.
- Simplify MessageMenu and destructive action grouping.
- Rebuild Composer with clear primary controls, IME-safe autocomplete, drafts, attachments, reactions, and progressive tools.
- Unify message actions, pins, saved items, translations, previews, and provenance.

Exit:

- Reading a long conversation is comfortable and navigable.
- Message, reply, react, edit, delete, attach, search, and topic tasks are clear on keyboard and touch.
- Rich content is semantically valid, safe, and accessible.
- Draft and failed-send recovery survives reload and reconnect.

### Phase 7 — Privacy, safety, and account

Objective: make Onyx’s strongest differentiator understandable and trustworthy.

Work:

- Rebuild DmSafetySheet, DmKeyChangeBanner, group protection indicators, device/key management, recovery, profiles, block, mute, and report.
- Separate local-only report drafts from server moderation intake.
- Minimize host/certificate/node exposure.
- Merge Account, YouSettings, and security surfaces into a task-based You destination.
- Add clear privacy scope to imports, exports, previews, translations, and integrations.

Exit:

- Encryption failures fail closed and explain the next safe action.
- Key changes require review and have recovery guidance.
- Users can add, name, revoke, and recover devices.
- Block, mute, report, and moderation are not conflated.
- No claim exceeds verified server or client capability.

### Phase 8 — Return continuity, search, storage, and portability

Objective: make local-first behavior a visible advantage.

Work:

- Unify drafts, scheduled messages, queued sends, retries, and outbox.
- Consolidate server search, device search, semantic search, saved searches, history, date jump, and reviewed anchors.
- Redesign vault retention, quota, corruption, migration, import, export, and erase flows.
- Make local/server scope and encryption visible at the moment of decision.

Exit:

- Users always know where content is saved and what will happen next.
- Large vaults remain responsive.
- Import/export has preview, scope, progress, cancel, and recovery.
- Legacy storage and deep links have migration evidence.

### Phase 9 — Calls and media

Objective: deliver one reliable, honest communication model.

Work:

- Consolidate CallsHub, prejoin, incoming/outgoing overlays, VoiceBar, VoiceStage, StagePanel, VoicePip, participant tiles, captions, reactions, device settings, and WatchTogether.
- Put people and the current call state first.
- Keep media and specialized activity lazy.
- Test permissions, devices, reconnect, failure, bandwidth, captions, and reduced data.

Exit:

- Join, accept, cancel, leave, reconnect, and recover are obvious.
- Device and permission failures retain context and tell the user what to do.
- Call controls are stable across room, Calls, stage, and mini view.
- Real multi-user browser evidence exists.

### Phase 10 — Settings, notifications, PWA, and platform

Objective: make the surrounding product coherent and supportable.

Work:

- Rebuild settings navigation and searchable preferences.
- Unify notifications, quiet hours, keywords, followed conversations, OS badge/title, browser permission, and PWA behavior.
- Make appearance simple by default and Theme Studio advanced.
- Harden service-worker update, offline storage, quota, and cross-tab behavior.
- Keep native desktop availability gated by bridge, secure storage, deep links, updater, signing, and installer evidence.

Exit:

- Every setting has one canonical home.
- Effective notification policy is inspectable.
- PWA install/update/offline behavior is tested on supported browsers.
- Native claims remain truthful until signed runtime evidence exists.

### Phase 11 — Moderation, operator, integrations, and technical surfaces

Objective: preserve power without polluting ordinary use.

Work:

- Move moderation into a permissioned workspace with scope, reason, expiry, receipt, and appeal/undo where possible.
- Move OperDesk and OperEventConsole out of consumer chrome.
- Simplify capability, bridge, provenance, insights, extension, translation, and webhook surfaces.
- Create explicit advanced/developer routes with stable terminology and support-safe diagnostics.

Exit:

- Ordinary users never encounter destructive operator controls by accident.
- Operators get denser tools with better receipts and live evidence.
- Integrations disclose actor, destination, direction, permissions, and failure.

### Phase 12 — Commercial launch hardening

Objective: prove that the overhaul works in the real world.

Work:

- Run usability sessions with new users, returning users, privacy-sensitive users, moderators, and operators.
- Run browser matrix, mobile matrix, screen-reader passes, forced colors, zoom, reduced preferences, offline, storage migration, multi-device E2EE, calls, PWA, and native gates.
- Remove or archive orphaned components and stale documentation.
- Attach a release evidence bundle and support playbook.

Exit:

- No unresolved P0/P1 issue in first run, message safety, privacy, accessibility, recovery, performance, or truthfulness.
- All required gates pass with recorded evidence.
- Legacy route/component retirement is deliberate and reversible until the migration window closes.

## 9. Epic backlog

| ID | Priority | Epic | Depends on | Acceptance signal |
|---|---|---|---|---|
| O-01 | P0 | Canonical IA and route ownership | None | One route/shell map reviewed |
| O-02 | P0 | Terminology and copy ledger | O-01 | No consumer flow requires IRC vocabulary |
| O-03 | P0 | Capability truth matrix | O-01 | Every capability labeled available/staged/unavailable |
| O-04 | P0 | Surface disposition inventory | O-01 | All routes/components classified |
| O-05 | P0 | State fixture catalog | O-03 | All universal states render deterministically |
| O-06 | P0 | UI payload budget split | O-04 | Enforced budget returns green |
| O-07 | P0 | Unified token contract | O-04 | Public and app surfaces share semantic tokens |
| O-08 | P0 | Primitive interaction contract | O-07 | Controls pass keyboard, focus, target, and forced-color tests |
| O-09 | P0 | Overlay and focus stack | O-08 | Modal, sheet, popover, Escape, and restoration are consistent |
| O-10 | P0 | Public front door rewrite | O-01, O-02, O-07 | Visitor chooses correct first action |
| O-11 | P0 | Invite-to-value journey | O-10 | Valid and invalid invites have safe recovery |
| O-12 | P0 | Guided identity journey | O-02, O-03 | Guest/account/passkey/recovery path is understandable |
| O-13 | P0 | First-run progress model | O-12 | One next action and resumable progress |
| O-14 | P0 | Product shell state machine | O-07, O-09 | Location, collection, context, and modal ownership are singular |
| O-15 | P0 | Responsive navigation | O-14 | Desktop/tablet/mobile IA parity |
| O-16 | P0 | Room sidebar and room switcher | O-15 | Browse/create/join/DM actions are separated |
| O-17 | P0 | Home catch-up consolidation | O-05, O-14 | One unread seam and one Home inbox |
| O-18 | P0 | Explicit New conversation | O-15 | DM starts from visible controls |
| O-19 | P0 | Room browse/create/invite | O-16 | First room can be reached without IRC terms |
| O-20 | P1 | People and profile safety | O-16 | Message, mute, block, and report are distinct |
| O-21 | P0 | Transcript reading plane | O-05, O-08 | Long transcript is calm, bounded, and accessible |
| O-22 | P0 | Rich message semantic fix | O-21 | No block content inside paragraph semantics |
| O-23 | P1 | Message action hierarchy | O-21 | Default actions are short and destructive actions grouped |
| O-24 | P0 | Composer simplification | O-08, O-21 | Send, attach, emoji, and text are immediate |
| O-25 | P1 | Attachments and media safety | O-24 | Progress, retry, cancel, alt text, and protection scope |
| O-26 | P0 | Unified drafts and outbox | O-24, O-05 | Reload/offline/reconnect preserve user work |
| O-27 | P1 | Topics, replies, and threads | O-21 | Each context is understandable and deep-linkable |
| O-28 | P1 | Search and history scope | O-17, O-21 | User can tell device versus server results |
| O-29 | P1 | Pins, saves, and reviewed history | O-17, O-28 | Shared and personal retrieval are distinct |
| O-30 | P0 | DM privacy language | O-03, O-20 | Privacy state is plain and truthful |
| O-31 | P0 | Key-change and device UX | O-30 | Review, accept, revoke, and recover are safe |
| O-32 | P1 | Group protection truth | O-03, O-31 | Staged group E2EE is never overclaimed |
| O-33 | P1 | Account and You consolidation | O-12, O-31 | One settings destination per task |
| O-34 | P1 | Block/mute/report lifecycle | O-20, O-30 | Local draft versus server report is explicit |
| O-35 | P1 | Moderation workspace | O-03, O-34 | Scope, reason, expiry, receipt, and permission |
| O-36 | P1 | Call state machine | O-03, O-08 | Prejoin, active, reconnect, failure, ended |
| O-37 | P1 | Call controls and stage | O-36 | Stable controls across room and Calls |
| O-38 | P1 | Captions and shared activity | O-36 | Local/remote/unavailable states are labeled |
| O-39 | P1 | Notification policy | O-17, O-33 | One effective notification explanation |
| O-40 | P1 | Appearance and Theme Studio | O-07, O-08 | Simple defaults; advanced editor isolated |
| O-41 | P1 | Storage, import, export, erase | O-03, O-26 | Scope, encryption, progress, recovery |
| O-42 | P1 | PWA and offline hardening | O-26, O-41 | Install, update, quota, and offline evidence |
| O-43 | P2 | Desktop capability gate | O-03, O-42 | No native claim without runtime/signing evidence |
| O-44 | P2 | Operator workspace | O-03, O-35 | Operator controls out of consumer chrome |
| O-45 | P2 | Extension/integration center | O-03, O-44 | Permissions, actor, destination, revoke |
| O-46 | P1 | Accessibility browser program | O-08, O-15, O-21 | Keyboard, screen reader, zoom, forced colors |
| O-47 | P1 | Cross-browser and mobile program | O-15, O-24, O-36 | Chromium, WebKit, Firefox, mobile evidence |
| O-48 | P0 | Visual regression fixtures | O-07, O-08 | Key states reviewed every release |
| O-49 | P0 | Support-safe diagnostics | O-03, O-05 | IDs contain no private content or secrets |
| O-50 | P0 | Legacy retirement and docs sync | All prior epics | No orphaned default path or stale promise |

## 10. Consumer journey acceptance suite

Each journey requires a desktop, 320px mobile, keyboard, reduced-motion, offline/error variant where relevant, and a recorded expected result.

1. Direct first visit: understand Onyx and choose an action.
2. Invite acceptance: inspect invite, join, recover from stale invite.
3. Continue as guest: enter a room and understand local continuity.
4. Account creation: create identity without losing the current room or draft.
5. Return visit: land on Home and find what changed.
6. Quiet product: understand no active rooms and discover a useful next action.
7. Browse and join: search, inspect purpose/privacy, join, and leave safely.
8. Create a room: choose purpose, people, privacy, and invite without formation confusion.
9. Start a DM: use visible New conversation, select person, and see privacy status.
10. Daily conversation: read, reply, react, attach, edit, and search.
11. Long transcript: jump older/newer, preserve scroll, use keyboard and screen reader.
12. Offline send: draft locally, show queued state, reconnect, retry, and confirm result.
13. Changed key: see warning, review details, decide safely, and recover from rejection.
14. Account/device recovery: add, rename, revoke, lose, and recover a device.
15. Call: prejoin, permissions, active controls, reconnect, leave, and return to chat.
16. Notifications: opt in, deny, change effective policy, and find missed activity.
17. Data portability: export, import preview, conflict, cancel, recovery, and erase device.
18. Moderation: permitted moderator performs a scoped action and sees a receipt.
19. Operator: authorized operator enters separate workspace and sees live evidence.
20. PWA/update: install, go offline, update later, recover after reload.
21. Stale route: refresh a deep link after a lazy chunk update and recover safely.

## 11. Correct model and agent scaling

The work should be divided by decision complexity and file ownership, not by arbitrary equal-sized tickets.

| Role | Model and effort | Best use | Do not assign |
|---|---|---|---|
| Astra product/design auditor | gpt-6-astra, medium, normal speed | Whole-product audit, IA, design direction, feature/UI inventory, cross-surface coherence, roadmap synthesis, final design critique | Large mechanical edits across unrelated files |
| Astra final adjudicator | gpt-6-astra, high or xhigh only when needed | Resolve conflicts between visual, accessibility, security, performance, and consumer requirements; review the final candidate | Routine token renames or repetitive test updates |
| Sol integration lead | gpt-5.6-sol, high or xhigh | Cross-cutting shell facades, state ownership, route migration, integration seams, release orchestration | Isolated copy or one-component CSS changes |
| Terra bounded implementation | gpt-5.6-terra, medium/high | SolidJS components, responsive CSS, bounded feature slices, browser tests, focused refactors | Security/key semantics without an independent review |
| Luna mechanical support | gpt-5.6-luna, low/medium | Inventory generation, token replacement proposals, fixture scaffolding, docs synchronization, repetitive test matrices | Product decisions, privacy claims, E2EE, calls, release judgment |
| Independent reviewer | Fresh model/context | Commercial UX red team, accessibility red team, security/privacy review, performance review, release-gate review | Reviewing only its own writer’s work |

Recommended campaign shape:

1. One Astra owns the audit, visual language, and coherence contract.
2. One Sol owns the shell and cross-cutting integration seams.
3. Two to four Terra agents work in disjoint lanes: public/first-run, shell/navigation, conversation/local-first, privacy/calls.
4. Luna handles bounded inventory, fixtures, mechanical token work, and documentation only.
5. A fresh reviewer checks each completed lane, with a separate final Astra adjudication.

Parallel work rules:

- Explicitly declare file ownership before each slice.
- Do not let multiple agents edit AppShell, shell.css, token files, or route ownership concurrently.
- Keep crypto, auth, moderation, operator, and media decisions behind their bounded owners.
- Writer agents do not grade their own work.
- A roadmap item is not complete because its source tests pass; it needs user-journey and runtime evidence.

## 12. Validation and release gates

### Local source gates

Run from /home/kain/onyx:

~~~bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:server-contract
pnpm check:server-contract-v2
node tools/check-ui-budgets.mjs
~~~

The full test command must report file and test counts. A build must not be treated as a browser or deployment result.

### Browser matrix

Required scenarios:

- Chromium desktop at ordinary and narrow widths.
- Firefox desktop.
- WebKit/Safari desktop and iOS-like viewport.
- Android-like viewport and touch input.
- 320px width, short viewport height, 200% zoom.
- Keyboard-only.
- Screen reader: NVDA or JAWS on Windows; VoiceOver on macOS/iOS; TalkBack on Android where available.
- Forced colors/high contrast.
- Reduced motion, transparency, and data.
- Offline, reconnecting, stale lazy chunk, storage quota, and service-worker update.

### Visual review matrix

Review fixture states for:

- public landing, invite, connect, Home, empty rooms, populated room;
- unread seam, long transcript, rich message, failed upload, queued send;
- DM ready, changed key, locked message, device recovery;
- call prejoin, active stage, reconnect, device failure, captions;
- settings search, destructive confirmation, storage export, PWA update;
- moderation and operator permissioned workspaces;
- light, dark, high contrast, forced colors, reduced motion, reduced data, large text.

### Release evidence boundaries

Before a commercial release claim:

- confirm clean generated artifacts and inspect the worktree;
- prove route and deep-link refresh behavior in a browser;
- prove real server interactions for join, room, DM, permissions, and moderation;
- prove two-device DM/E2EE behavior and key-change handling;
- prove real call/media permission, reconnect, and failure behavior;
- prove PWA install/update/offline/storage recovery;
- prove native runtime, packaging, signing, updater, and uninstall only if desktop is advertised;
- attach screenshots, recordings, logs, test counts, and known limitations to the release evidence bundle.

## 13. Success measures

Use privacy-preserving task measures rather than message-content surveillance.

### Consumer outcomes

- New user completes first room and first message without help.
- Returning user finds the correct unread boundary and resumes reading.
- DM starts from a visible control in under one minute.
- Offline draft and queued send are understood without support intervention.
- Call join and recovery are understandable without protocol language.

### Quality outcomes

- Zero P0/P1 unresolved issues in first run, privacy, safety, accessibility, state truthfulness, or recovery.
- No duplicate canonical settings, catch-up, call, outbox, or primary-navigation paths.
- No default consumer surface contains operator-only controls.
- All high-consequence actions have scope and receipt.
- UI budget is green and heavy surfaces are lazy.

### Accessibility outcomes

- Keyboard complete on every primary journey.
- Screen-reader complete for route, dialog, message, composer, autocomplete, notification, and call states.
- 320px, 200% zoom, forced colors, large text, reduced motion, transparency, and data passes.
- Touch targets meet 44px minimum.

### Truth and support outcomes

- Every advertised capability has a current evidence source.
- Every failure has an action and support-safe identifier.
- Every local/server/encrypted/retained/destructive boundary is visible at decision time.
- Native and staged features remain explicitly labeled until their gates pass.

## 14. Immediate next tranche

1. Preserve the current dirty worktree and capture a fresh diff before any edits.
2. Check in this roadmap only when explicitly authorized; until then it is a local planning artifact.
3. Generate the route, component, primitive, library, and CSS ownership inventory from source.
4. Build the capability truth matrix and state fixture catalog.
5. Fix the eager payload budget before increasing shell scope.
6. Have Astra review the first design-system and IA prototypes for coherence.
7. Implement O-07, O-08, O-09, and O-14 as the foundation.
8. Implement O-10 through O-18 as the first consumer-facing tranche.
9. Run browser and accessibility evidence before declaring any visual slice complete.
10. Continue through conversation, privacy, calls, settings, platform, and advanced work in dependency order.

The current client is not a blank slate. Its foundations are unusually deep. The complete overhaul should make that depth feel simple: rooms familiar, conversations comfortable to read, privacy honest, recovery dependable, and advanced power available only when the user asks for it.

## 15. Astra refinement / heavy polish addendum — 2026-09-07

This addendum records the next refinement pass against the roadmap above. It is an implementation-status note, not a release approval.

### AppShell correction

The two reported AppShell failures were stale test assumptions, not confirmed product regressions. The assumptions have been corrected to match the current contract: the active room is exposed as a room-current state without an E2EE claim, and Context focus returns to its trigger when the rail closes. CallsHub assertions likewise distinguish provisional, ringing, and established presentation from media/security claims. Evidence locations: [AppShell.current.test.tsx](../src/shell/AppShell.current.test.tsx) and [AppShell.calls-hub.test.tsx](../src/shell/AppShell.calls-hub.test.tsx).

These are source/test corrections only. No browser, assistive-technology, live-network, E2EE, media, PWA, or native signoff is implied.

### Completed fixes recorded in this pass

| Area | Current evidence | Boundary |
|---|---|---|
| AppShell room semantics and Context focus | [AppShell.current.test.tsx](../src/shell/AppShell.current.test.tsx) | Component-test evidence; browser focus behavior remains gated |
| CallsHub route/state ownership, including stale timestamp handling | [AppShell.calls-hub.test.tsx](../src/shell/AppShell.calls-hub.test.tsx), [AppShell.tsx](../src/shell/AppShell.tsx) | Presentation contract only; real call/media behavior remains unverified |
| Durable queued-send reload, retry/drop races, and E2EE plaintext refusal | [store.outbox.test.ts](../src/lib/store/store.outbox.test.ts), [store.ts](../src/lib/store/store.ts) | Test/store evidence; real offline/reconnect and quota recovery remain gated |
| Scheduled-send due/pending separation | [scheduledSend.ts](../src/lib/composer/scheduledSend.ts), [dispatch.ts](../src/lib/schedule/dispatch.ts) | Library evidence; persistence across every lifecycle still requires acceptance |
| PWA update coordination and failed recovery | [updateRecovery.test.ts](../src/pwa/updateRecovery.test.ts), [updateRecovery.ts](../src/pwa/updateRecovery.ts) | Unit evidence; installed-browser update continuity remains gated |
| Media-history retry and tab preservation | [RoomMediaIndex.test.tsx](../src/shell/RoomMediaIndex.test.tsx), [RoomMediaIndex.tsx](../src/shell/RoomMediaIndex.tsx) | Component evidence; partial real-media recovery remains gated |
| Notification aging, focus handoff, and stale-row handling | [NotificationCenter.test.tsx](../src/shell/NotificationCenter.test.tsx), [NotificationCenter.tsx](../src/shell/NotificationCenter.tsx) | Component evidence; notification permission/device races remain gated |
| Invite validation, exactly-once handoff, copy status, and Enter behavior | [Invite.test.tsx](../src/routes/Invite.test.tsx), [Invite.tsx](../src/routes/Invite.tsx) | Route-test evidence; native-shell handoff remains gated |
| Modal ownership and focus isolation | [ModalShell.test.tsx](../src/primitives/ModalShell.test.tsx), [focusTrap.ts](../src/primitives/focusTrap.ts) | Unit/component evidence; screen-reader verification remains gated |

### Newly identified P1 risks

| Priority | Risk / required outcome |
|---|---|
| P1 | Durable offline admission: every permitted queued action must be admitted durably before UI success, with E2EE plaintext refusal, quota/corruption handling, and recovery receipts. |
| P1 | Update continuity across navigation and ringing calls: a service-worker/lazy update must not strand navigation, discard work, or interrupt an honestly represented incoming call. |
| P1 | Scheduled in-flight persistence: reload, close, offline transition, clock shift, and duplicate dispatch must preserve one explicit scheduled/in-flight outcome. |
| P1 | Mobile new-conversation handoff: the visible entry point must hand off to the composer/person flow without losing route, draft, focus, or invite context. |
| P1 | Context breakpoint focus: opening/closing the Context rail at each breakpoint must preserve ownership, restoration, and escape behavior. |
| P1 | Shared modal isolation: nested/shared modal and sheet primitives must isolate focus, keyboard shortcuts, inert content, dismissal, and restoration. |
| P1 | Lazy retry: failed lazy routes, media panels, and chunks need bounded retry/recovery without duplicate work or false success. |
| P1 | Notification busy/clock races: permission, aging, synchronized removal, and navigation must not produce stale announcements or incorrect focus. |
| P1 | Partial media recovery: device-history and real media failures must preserve available content and provide truthful retry/cancel states. |
| P1 | Invite native/Enter semantics: browser and native surfaces must agree on validation, plain Enter, modifier behavior, exactly-once handoff, and copy feedback. |

### Ordered execution roadmap

1. Establish fixtures and state contracts for the ten P1 risks; capture failure reproduction and ownership.
2. Finish durable offline admission, scheduled in-flight persistence, and lazy retry; verify reload, quota, corruption, offline, reconnect, and duplicate-dispatch paths.
3. Finish update continuity, including navigation and ringing-call preservation, then test installed PWA update/recovery behavior.
4. Finish mobile new-conversation handoff, breakpoint Context focus, shared modal isolation, and Invite browser/native/Enter semantics.
5. Finish notification busy/clock races and partial media recovery; validate retained state, cancellation, and truthful error copy.
6. Run real-browser and assistive-technology journeys, then live network/E2EE/media/PWA/native acceptance.
7. Resolve every P0/P1 finding, attach evidence, refresh the release bundle, and only then adjudicate commercial readiness.

### Explicit release gates

All gates below are required. Source files, unit/component tests, typecheck, lint, and build are implementation evidence—not commercial signoff.

- [ ] Real Chromium, Firefox, and WebKit/Safari journeys pass on desktop and mobile-like viewports.
- [ ] 320px width, short-height mobile, 200% zoom, large text, forced colors/high contrast, reduced motion/transparency/data pass.
- [ ] Keyboard-only and screen-reader journeys pass for navigation, Context, modals/sheets, composer, Invite, notifications, calls, and recovery.
- [ ] Live network behavior passes for join, navigation, reconnect, offline admission, scheduled sends, notifications, and update continuity.
- [ ] Multi-device E2EE behavior passes, including durable-admission refusal, key-change states, and no plaintext-at-rest leakage.
- [ ] Real media behavior passes for permissions, ringing, active calls, partial failure, reconnect, device history, and teardown.
- [ ] Installed PWA behavior passes for offline startup, quota/corruption recovery, service-worker update, and navigation continuity.
- [ ] Native surfaces pass only with an actual runtime/package/signing/update/uninstall evidence bundle; otherwise they remain explicitly unverified.
- [ ] No unresolved P0/P1 remains, and each claimed fix has reproducible evidence, known limitations, and a support-safe receipt.

No deployment, commit, push, or native-release action is authorized by this addendum.

## 16. Astra second heavy audit and Luna implementation checkpoint — 2026-09-07

This checkpoint preserves the prior roadmap and evidence. It records a second Astra heavy audit followed by a bounded Luna implementation pass. Astra's verdict remains **RELEASE HOLD**: browser, screen-reader, installed-PWA, live-network, real-media, and fresh full-suite/build evidence are still absent.

### Astra second-audit P0 findings

- **False draft-save success:** the UI could report durable success before the draft was actually durably admitted.
- **Incomplete durable erase fencing:** erase completion did not yet establish a sufficiently fenced durable boundary across all relevant persistence paths.

Luna implemented the bounded persistence slice in `historyVault.ts`, `vaultSync.ts`, `portableTransfer.ts`, `store.ts`, `drafts.ts`, and `Composer.tsx`. Evidence: **5 focused files / 152 tests passed**, typecheck passed, targeted lint reported no errors with **3 pre-existing warnings**, and the diff check passed. This is source/test evidence only and still requires adversarial and browser verification; it is not evidence of commercial release readiness.

### Luna implementation evidence

| Slice | Evidence | Boundary |
|---|---|---|
| Durable history, vault sync, portable transfer, store, drafts, and Composer admission/erase behavior | `historyVault.ts`, `vaultSync.ts`, `portableTransfer.ts`, `store.ts`, `drafts.ts`, `Composer.tsx`; 5 focused files / 152 tests; typecheck; targeted lint; diff check | Source/test evidence; adversarial, browser, quota, corruption, and live persistence verification remain open |
| ContextRail retry with fresh `createResource` loading | 4 files / 25 tests; typecheck; lint; diff clean | Component/source evidence; lazy-route and browser recovery remain open |
| Focus integration across `focusTrap`, `ModalShell`, `Sheet`, `Preferences`, and `WatchTogether` | 5 files / 182 tests; combined focused suite; typecheck; lint; diff clean | Focus/component evidence; browser, breakpoint, keyboard, and screen-reader verification remain open |
| Consumer refinement: ChannelBrowser offline cached-join truthfulness, FirstHourCoach reactive props, NotificationControls policy copy | 5 files / 91 tests; typecheck; lint; diff clean | Source/test and copy evidence; real reconnect/admission and permission/device behavior remain open |
| Earlier refinement evidence: scheduling; Stage; NotificationCenter + RoomInviteShare | scheduling **76/76**; Stage **5/5**; NotificationCenter + RoomInviteShare **24** | Preserve as implementation evidence only; no runtime or release conclusion |

Commands used for the bounded checks included the relevant focused test commands, `pnpm typecheck`, targeted `pnpm lint`, and `git diff --check`. These commands establish implementation evidence, not browser, network, media, PWA, native, or commercial acceptance.

### Surface ledger update

| Surface | Current checkpoint | Remaining gate |
|---|---|---|
| Persistence / drafts | Bounded durable-admission and erase-fencing slice implemented and tested | Adversarial cross-tab/delayed erase, quota/corruption, cancellation/uncertainty, and newer-write races |
| Focus / modal | Focus integration and ContextRail retry fixes have focused evidence | Browser breakpoint behavior, keyboard traversal, inertness, and screen-reader verification |
| Recovery / lazy | Fresh `createResource` retry path covered in focused tests | AppShell/route lazy retry, update continuity, stale chunk recovery, and browser verification |
| Room discovery | ChannelBrowser cached offline join is truthful in source/tests | Real reconnect admission, join outcome, and live-network evidence |
| Calls / Stage | Prior Stage evidence remains 5/5; no commercial media claim | Real transport, permissions, ringing, reconnect, partial failure, and media acceptance |
| Notifications / invites | NotificationCenter + RoomInviteShare evidence remains 24; policy copy refined | Permission/device races, live delivery, invite handoff, and browser/native behavior |
| PWA | No installed-PWA acceptance added by this pass | Offline startup, update continuity, quota/corruption recovery, and installed-browser evidence |
| Public routes | Consumer refinements are source/test evidence only | AppShell route lazy retry, deep-link refresh, browser matrix, and full journey evidence |

### Remaining priority roadmap

1. Finish AppShell/route lazy retry and update continuity.
2. Add cross-tab and delayed-erase adversarial tests.
3. Cover cancellation/uncertainty and draft quota, corruption, and newer-write races.
4. Prove ChannelBrowser real reconnect admission.
5. Verify Context breakpoint behavior and browser focus integration.
6. Run the full browser matrix, including keyboard, screen reader, zoom, forced colors, reduced motion/data, and mobile-like viewports.
7. Complete live transport, E2EE, media, PWA, and native acceptance where those surfaces are advertised.
8. Consolidate visual tokens and CSS after behavior and acceptance evidence stabilize.

### Explicit next Luna slices

These are proposed disjoint scopes, not completed work. Each slice requires its own focused tests, typecheck/lint, `git diff --check`, and an evidence note that states what remains unverified.

| Slice | Disjoint file scope | Acceptance criteria |
|---|---|---|
| Durable-race adversarial lane | `src/lib/**` persistence test files only: cross-tab, delayed erase, quota, corruption, cancellation, uncertainty, newer-write fixtures | Deterministic tests prove no false durable success, erase fencing, recovery receipts, and explicit uncertain outcomes; no browser or live-network claim until separately verified |
| AppShell/lazy recovery lane | `src/shell/AppShell.tsx`, route lazy-loading/retry owner, and their focused tests only | One bounded retry path, no duplicate work, honest loading/error/recovery states, stale-chunk recovery tests, and update-continuity tests without touching persistence or modal files |
| Context/browser focus lane | ContextRail owner and browser focus fixtures only; no shared persistence or AppShell ownership | Breakpoint open/close, trigger restoration, Escape, keyboard order, and screen-reader-visible state are covered in browser evidence |
| Channel reconnect lane | `src/shell/ChannelBrowser*` and its network/admission tests only | Cached offline state never implies joined; reconnect admission proves server outcome, retry/cancel behavior, and truthful failure states |
| PWA continuity lane | `src/pwa/**` and installed-PWA test harness only | Installed browser proves offline startup, service-worker update, navigation continuity, quota/corruption recovery, and safe reload |
| Media/transport acceptance lane | Existing calls/media test harness and bounded media adapters only | Live transport proves permissions, ringing, real media, reconnect, partial failure, teardown, and truthful UI; no native claim without native evidence |

### Dated release status

**RELEASE HOLD — 2026-09-07.** The implementation evidence above does not clear Astra's verdict or the existing release gates. No deploy, commit, push, or native-release authorization is granted by this checkpoint.

## 17. Astra final source checkpoint — 2026-09-07

This is the final source checkpoint for the commercial overhaul. Historical sections remain unchanged. Astra's final verdict remains **RELEASE HOLD** because no browser, screen-reader, installed-PWA, live-network, real-media, or native acceptance evidence exists.

### Astra final audit and remediation status

Astra identified five source-backed P1s:

1. Protected-DM upload privacy required revalidation at upload time.
2. Post-clear outbox admission required an erase-epoch fence.
3. Disclosure-summary focus traversal required a complete boundary contract.
4. Draft receipts required restoration after navigation by owner and target.
5. Scheduled visibility required to remain durable when the localStorage projection failed.

Luna implemented all five bounded fixes. They are implemented and verified by automated source/test evidence, not by browser or live acceptance:

- Composer/upload privacy is reactive, revalidated for every upload, passes protected context to the adapter, and cleans up rejected uploads.
- Durable outbox erase-epoch capture prevents post-clear stale admission.
- `focusTrap` now covers the summary boundary, uses the shared focusability contract, and has a Preferences final-boundary regression.
- Draft receipts restore by owner and target after navigation.
- Scheduled state is IndexedDB-authoritative, with an explicit projection-degraded status when localStorage projection fails.

### Final automated evidence

- Full `pnpm test`: **601 files / 7,393 tests passed**; the full suite was independently rerun in this session.
- Combined persistence/focus/privacy set: **10 files / 256 passed**.
- Preferences standalone: **100/100**.
- Focus suite: **185/185**.
- Privacy/composer/upload: **82**.
- Persistence: **163**.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with **0 errors and 2 warnings**: AppShell reactivity and Composer `no-useless-assignment`.
- `pnpm build`: passed; Vite processed **610 modules**. The build was independently rerun in this session.
- `node tools/check-ui-budgets.mjs`: passed; eager index JS is **11,759 B gzip** against the **11,819 B** ceiling.
- Current build digest: `1837055fb7e7f5c3b0cf684c47d14138be17420debfbc3ee5357224e25e78d43`.
- `git diff --check`: passed.

These results verify the five bounded source/test remediations and the measured artifact. They do not establish browser, assistive-technology, installed-PWA, live-network, real-media, or native acceptance, and no additional unresolved source P1 is invented after the five are addressed.

### Complete surface ledger and next roadmap

| Surface | Source checkpoint | Next evidence or acceptance work |
|---|---|---|
| Public routes | Route and deep-link source remains covered by automated evidence | Chromium/Firefox/WebKit route journeys, refresh, back/forward, mobile, and failure recovery |
| Shell/navigation/context | Shell, navigation, context, retry, and focus contracts have source/test coverage | Keyboard and screen-reader traversal, breakpoint behavior, inertness, route recovery |
| Discovery/invites | Discovery, cached-state truthfulness, invite handoff, and policy paths are source-covered | Live join/reconnect, invite acceptance, permissions, and multi-device behavior |
| Transcript/messages | Message/transcript source paths remain bounded by existing tests | Live ordering, reconnect, pagination, unread state, E2EE/key changes, and no plaintext |
| Composer/drafts/uploads/outbox/schedules | All five final P1 remediations are implemented and automatically verified | Browser composition, navigation restoration, upload cancellation/privacy, offline admission, durable scheduling |
| Search/history/media | Source and persistence behavior remain implementation evidence | Real indexing/history, media loading, offline/recovery, privacy, and performance journeys |
| Calls/stage/voice/Watch Together | Existing source/test evidence is not media acceptance | Real permissions, ringing, transport, reconnect, partial failure, teardown, and synchronization |
| Notifications | Notification policy and source behavior are covered where tested | Permission/device races, live delivery, background behavior, update continuity |
| Settings/account/appearance | Preferences and appearance source/focus regressions are covered | Full settings journeys, account recovery, responsive/large-text and assistive-tech checks |
| Privacy/trust/moderation | Upload privacy and protected-context remediation is verified in tests | E2EE/key-change, no plaintext, moderation/report flows, and live trust-state verification |
| Primitives/focus | Shared focusability contract, `focusTrap`, and Preferences boundary regression pass | Browser keyboard order, focus restoration, dialogs/sheets, screen reader, and forced colors |
| Tokens/responsive/PWA/recovery/performance | Token/build budget and artifact measurements pass | 320px, short height, 200% zoom, large text, forced colors, reduced motion/data, installed PWA, corruption/quota, service-worker update, and performance runs |
| Native/platform | No native acceptance is claimed | Runtime/package/signing/update/uninstall evidence if native is advertised |

### Explicit remaining acceptance gates

- Chromium, Firefox, and WebKit on desktop and mobile-like viewports.
- 320px width, short-height layouts, 200% zoom, large text, forced colors/high contrast, reduced motion, and reduced data.
- Keyboard-only and screen-reader journeys across navigation, Context, modals/sheets, composer, invites, notifications, calls, and recovery.
- Live reconnect, offline admission, scheduled sends, notifications, update continuity, and other network behavior.
- Multi-device E2EE, key changes, durable-admission refusal, and no plaintext at rest.
- Real media permissions, ringing, reconnect, partial failure, device history, and teardown.
- Installed-PWA offline startup, quota/corruption recovery, service-worker update, and navigation continuity.
- Native runtime, package, signing, update, and uninstall evidence if native is advertised.

### Next Luna slices

Next work is limited to acceptance/evidence collection and nonblocking visual consolidation: execute the browser and assistive-technology matrix; run live reconnect/offline/scheduled/notification/update journeys; validate multi-device E2EE and media behavior; exercise installed-PWA quota, corruption, and service-worker recovery; collect native evidence only if that surface is advertised; and consolidate any remaining visual/token inconsistencies that do not reopen behavior scope. Runtime coverage remains unproven until those gates are actually run.

### Final status

**RELEASE HOLD — 2026-09-07.** The five source-backed P1 fixes are implemented and verified by automated evidence. The product remains on hold solely because the external/runtime acceptance gates above are unrun or unproven.

No deployment, commit, push, or native-release action is authorized by this checkpoint.

## 18. Post-checkpoint draft-receipt closure — 2026-09-07

Astra's final adjudication found the draft receipt P1. Luna fixed it in `src/lib/store/store.ts` and `src/shell/Composer.tsx`. Receipts are now owner/target/text-bound with revisions; survive Calls/navigation/remount; preserve only-in-tab, limit, malformed, and error truth; clear with drafts; and cannot show “Saved here” when live text differs from verified storage.

Focused receipt tests passed: **3 files / 77 passed**. Final full `pnpm test` passed: **601 files / 7,393 tests passed**. Final post-fix gates also passed: `pnpm typecheck`; `pnpm lint` with **0 errors / 2 warnings**; `pnpm build` with **610 modules**; UI budget; and `git diff --check`.

This section supersedes any stale digest or receipt wording in earlier sections. The correct current build digest from the latest budget run is `2399b0741ef772791f8b4d4022dcbb4ebd8ae7760859b9c8b8d62100ab126d4e`. Current eager index JS is **11,759 B gzip** against the **11,819 B** ceiling.

This closes the last source-backed P1 found by Astra in the automated/source scope. Browser, screen-reader, installed-PWA, live-network, real-media, and native acceptance remain unrun/unproven.

**RELEASE HOLD — 2026-09-07.** No deploy, commit, push, or native-release authorization is granted.

## 19. Astra heavy-polish checkpoint and Luna evidence — 2026-09-07

### Astra verdict

Astra performed a fresh read-only audit. Verdict: **RELEASE HOLD**. Ordered heavy-polish priorities:

1. Reconcile budget/artifact.
2. Prove first-value and returning-user live journeys.
3. Prove reconnect/admission truth.
4. Prove installed-PWA update continuity.
5. Prove real keyboard/focus behavior.
6. Run the browser matrix.
7. Improve room-browser copy and retry behavior.
8. Apply update-banner tokens.
9. Measure connected-experience performance.

The exact boundary is source/test/artifact evidence versus runtime acceptance: source and automated tests can establish implementation behavior, but they do not sign off live journeys, installed PWA behavior, real devices, assistive technology, media, or network-connected experience. No runtime signoff is claimed.

### Luna completed implementation slices

- Fresh lazy-route/AppShell retry and stale-chunk recovery.
- ChannelBrowser cached/offline copy plus row-scoped retry and accessibility labels; **15 focused tests**.
- PWA update banner semantic tokens, safe-area handling, keyboard behavior, 44px targets, forced colors, and reduced motion; **3 focused tests**.
- Mobile focus reveal, short-viewport rail cascade, and accessible naming for You nested Appearance.
- Explicit Chromium, Firefox, and WebKit Playwright projects.

### Current source, test, and artifact evidence

- Full `pnpm test`: **602 files / 7,404 tests passed**.
- `pnpm typecheck`: passed.
- `pnpm lint`: **0 errors / 12 warnings**.
- `pnpm build`: passed; **610 modules**.
- UI budget: passed; eager index JS **11,138 B gzip** versus **11,819 B** ceiling; digest `cf1b4f0e20c4d988eeb830c96e0aaf1fa3bcb2c48fbb92ee17fb076b76c260d0`.
- `git diff --check`: passed.

These are source/test/artifact results, not runtime acceptance.

### Browser and runtime evidence

Chromium public-subset initial run passed **42** scenarios; **2 mobile-reflow** and **1 lifecycle** case were later repaired. The targeted `mobile-nav-reflow` rerun passed **2/2**, and `lifecycle-announcer` rerun passed **5/5**. Therefore all **45 unique scenarios** in that Chromium subset are covered by passing evidence across the original run plus targeted reruns.

The Firefox focused public-route subset passed **34/34**, with the corresponding Chromium subset also passing **34/34**. The WebKit project is present and its binary is downloaded, but launch is blocked by missing host dependency `libflite1`; no WebKit pass is claimed.

The connected DEV invite/live network was not run because `localhost:5174` and WS `7080` were unavailable. Installed-PWA, real media, screen-reader, native, and real-device keyboard acceptance remain holds.

### Surface ledger

| Surface | Source evidence | Next gate |
|---|---|---|
| AppShell/routes | Lazy retry and stale-chunk recovery implemented and tested | Browser refresh, deep-link, and live first-value/returning-user journeys |
| ChannelBrowser/discovery | Cached/offline copy, row retry, labels, and 15 focused tests | Live reconnect/admission and invite journeys |
| PWA/update banner | Semantic tokens, safe area, keyboard, 44px, forced-colors, reduced-motion implementation and 3 focused tests | Installed-PWA two-window update continuity and draft/call preservation |
| Focus/responsive shell | Mobile focus reveal, short-viewport rail cascade, and You Appearance naming | Real-device keyboard, screen reader, and full browser matrix |
| Browser projects | Chromium/Firefox/WebKit projects; Chromium and Firefox subsets pass as recorded | Resolve WebKit host dependency and run WebKit |
| Connected experience | No live DEV invite/network run; no runtime signoff | Live server journeys, real media/E2EE, and interaction performance |

### Ordered next roadmap

1. Install or resolve WebKit host dependencies; otherwise retain the WebKit hold.
2. Run live server journeys, including DEV invite, first value, returning user, reconnect, and admission truth.
3. Run installed-PWA two-window update, draft, and call continuity.
4. Run real-device keyboard and screen-reader acceptance.
5. Run real media and E2EE acceptance.
6. Add connected-experience performance interaction instrumentation.

**RELEASE HOLD — 2026-09-07.** No deployment authorization is granted.

## 20. Astra P1/P2 release-blocker remediation receipt — 2026-09-07

This is the current authoritative checkpoint. Sections 1–19 remain historical
evidence and are not rewritten. The overall product decision remains **RELEASE
HOLD**; this section records the bounded source remediation and the current
artifact/browser evidence boundary.

### Astra HOLD and the P1 finding

Astra identified a real history-vault race in the prior implementation:
`vaultSync` captured rows, then started an asynchronous erase-epoch observation.
An independent clear could commit before that observation resolved, allowing
the stale snapshot to observe the new epoch and pass `saveMessages`. A local
module generation callback was not a cross-context admission fence.

The finding was a release blocker. It was not closed by moving an `await`, by a
timer delay, or by a test-only mock.

### P1 remediation status

The source now uses an opaque durable IndexedDB write reservation:

- `reserveVaultWrite()` commits only `{ kind: "message-write", epoch }` in
  `vault_meta`; no target, message id, message text, owner identity, or
  plaintext is stored in the reservation.
- `saveMessages()` consumes the reservation and writes the message rows in one
  `readwrite` transaction. A clear transaction removes reservations and
  advances the erase epoch in its own ordered `readwrite` transaction.
- If reservation/write commits before clear, clear removes the committed rows.
  If clear commits first, the delayed write cannot find its reservation and
  aborts. This transaction ordering is the stated linearization point; an
  epoch read by itself is not treated as admission.
- Canceled, failed, and superseded flushes release unconsumed reservations;
  successful writes consume them atomically. An aborted clear transaction leaves
  the reservation available; a committed IDB clear consumes the boundary even
  if later non-IDB verification reports the overall clear as unsuccessful.

The deterministic regression delays the reservation result after its durable
admission, commits an independent clear, proves the stale row cannot return,
then proves a genuine post-clear mutation persists. The reservation metadata
test also checks that no plaintext payload crosses the metadata boundary.
The existing old-epoch and reload regressions remain in place. Current focused
vault evidence after this remediation: **2 files / 104 tests passed**.

This is source/test remediation evidence, not final commercial GO. The overall
release remains on hold until the runtime gates below are green.

### P2 current authoritative production-build evidence

`docs/ui-performance-baseline.json` now records the current reviewed receipt,
with historical measurements retained in the earlier audit sections:

| Gate | Current receipt |
|---|---:|
| Full test files | **602** |
| Full tests | **7,444** |
| Vite transformed modules | **611** |
| Eager JavaScript | **36.46 KiB gzip** |
| Eager index JavaScript | **11,478 B gzip** |
| Build digest | `b8b492ed6c6e994205762a96e123426257d80aeba6597a0b4c82e73dba897c84` |

The checked-in baseline labels this as current-authoritative evidence rather
than silently replacing the historical records above.

### Current browser evidence and runtime holds

| Evidence | Status | Boundary |
|---|---|---|
| Current targeted Chromium receipt | **6/6 passed** | Targeted evidence only; not a full browser/commercial signoff |
| Earlier broader Chromium receipt | **124/130, not green and not rerun** | Must not be counted as a passing matrix |
| Firefox/WebKit matrix | Hold | WebKit host dependency `libflite1` remains unresolved; no WebKit pass claimed |
| Live DEV invite/network and reconnect admission | Hold | Live server and WS journey evidence is absent |
| Installed PWA update/offline continuity | Hold | Installed-browser two-window evidence is absent |
| Keyboard, screen reader, real-device/mobile acceptance | Hold | Targeted Chromium tests do not establish these runtime gates |
| Real media and multi-device E2EE | Hold | Permissions, transport, reconnect, and device acceptance are unproven |
| Native package/signing/update/uninstall | Hold | No native runtime evidence bundle exists |

**RELEASE HOLD — 2026-09-07.** The P1 source remediation is implemented and
the new deterministic tests pass; the P2 receipt is recorded. No final GO,
deployment, commit, push, or native-release authorization is claimed until the
runtime holds and the non-green/unrerun browser evidence are resolved.

## 21. Final current-source evidence receipt — 2026-09-07

Sections 1–20 are preserved as historical checkpoints. This section is the
newest authoritative receipt and supersedes their older current-value wording;
it does not rewrite the historical record.

### Final automated and artifact evidence

The final run from the current source recorded:

| Gate | Result |
|---|---:|
| `pnpm test` | **602 files / 7,445 tests passed / 610.51s** |
| `pnpm typecheck` | **passed** |
| Prior final lint | **0 errors / 32 warnings** |
| `git diff --check` | **passed** |
| `pnpm build` | **611 modules** |
| Current build digest | `4c6aeb6fe9d833a21f2ac1b76601176d3d1d00493ef9b7d2bc82b7eb7441f124` |

The machine-readable receipt is recorded in
`docs/ui-performance-baseline.json`. Its current production-output groups are:

| Boundary | Raw bytes | Gzip bytes |
|---|---:|---:|
| Total eager JS | 109,190 | 37,333 |
| Total eager CSS | 73,248 | 15,894 |
| Eager index JS | 28,953 | **11,481** |
| Eager index CSS | 73,248 | 15,894 |
| Shared runtime JS | 526,493 | 150,456 |
| AppShell JS | 496,211 | 149,166 |
| AppShell CSS | 362,383 | 53,939 |
| Optional/lazy media JS | 126,671 | 37,413 |

The baseline preserves the current dist asset names and SHA-256 hashes from the
machine-readable receipt, and recomputes each 5% ceiling with `Math.ceil`.
Protocol v1/v2 tests passed, deploy-controller tests passed **101/101**, and
production scheduler test hooks were absent from `dist`.

### P1 closure and Astra status

The prior Astra P1 HOLD is remediated in source with durable opaque IndexedDB
write reservations. The reservation metadata contains no message payload or
plaintext; the reservation is consumed in the same readwrite transaction as the
message rows, while clear removes reservations and rows at its ordered durable
boundary. The deterministic cross-context-style regression, opaque-metadata
check, old-epoch regression, and reload regression passed in the focused vault
slice (**2 files / 104 tests**).

Final Astra re-adjudication is **pending**. This receipt is not a final GO and
does not claim full commercial acceptance; the next review must re-adjudicate
the source remediation together with the runtime evidence below.

### Browser evidence and explicit runtime holds

| Evidence | Status | Boundary |
|---|---|---|
| Current targeted Chromium | **6/6 passed** | Targeted evidence only; not full commercial acceptance |
| Earlier broader Chromium | **124/130, not green and not rerun** | Must not be counted as a green browser matrix |
| Live DEV/network acceptance | Hold | No live invite, reconnect, or network admission run |
| WebKit | Hold | Blocked by missing `libflite1`; no sudo to install the dependency |
| Installed PWA / two-window continuity | Hold | Unverified |
| Real media, E2EE, and multi-device behavior | Hold | Unverified |
| Screen reader and real-device keyboard acceptance | Hold | Unverified |
| Native packaging/signing/update/uninstall | Hold | Unverified |
| Connected-experience performance | Hold | Unverified |

**RELEASE HOLD — 2026-09-07.** No deployment or publication claim is made.
No final GO is claimed until Astra completes the next re-adjudication and the
explicit runtime holds, including the non-green/unrerun Chromium evidence, are
resolved.

## 22. Final Astra adjudication — 2026-09-07

Sections 1–21 are preserved historical findings and receipts. This final
bounded source adjudication closes the remaining Astra implementation item while
retaining the release and runtime boundaries.

### Astra finding closures

| Finding | Closure | Evidence |
|---|---|---|
| P1 storage boundary | **Closed in source and focused tests** | `safeStorage()` catches the `window.localStorage` getter and every `getItem`, `setItem`, `removeItem`, `clear`, and write path; blocked preferences remain session-only and truthfully report unavailable state. |
| P2 IndexedDB recovery | **Closed in source and focused tests** | Failed opens are discarded for retry; recovered writes reconcile provisional synchronous clear control with durable IDB; unproven state remains fail-closed. |
| P2 reverse-order concurrent clears | **Closed in source and deterministic regression** | Independent committed clears converge to durable epoch `2`; the current fence is preserved, the numeric mirror is monotonic, and stale intents/pending markers are absent. |

### Current source receipts

- Parent-run focused suite: **3 files / 145 tests passed**, including the
  recovery regressions.
- This continuation: `pnpm exec vitest run
  src/lib/vault/historyVault.test.ts --maxWorkers=1` — **1 file / 88 tests
  passed**.
- `git diff --check` — passed after this documentation update.
- Current production artifact receipt: **PENDING**. No post-remediation
  `pnpm build` or UI budget measurement was run here; no new artifact hashes,
  module counts, bundle sizes, or build test counts are claimed. The JSON
  baseline is explicitly marked `pending-current-build-receipt`.

### Explicit runtime holds

The implementation closure is not connected or full commercial acceptance.
These holds remain:

- live DEV invite, reconnect, network, and admission journeys;
- complete cross-browser/browser-matrix acceptance, including the prior
  non-green Chromium evidence and the WebKit `libflite1` host dependency;
- installed-PWA update, offline, draft, and two-window continuity;
- real-device/mobile keyboard, screen-reader, visual, and accessibility
  acceptance;
- real media, reconnect, multi-device E2EE, and permission journeys;
- native packaging, signing, update, uninstall, and runtime acceptance; and
- connected-experience performance instrumentation and evidence.

**RELEASE HOLD — 2026-09-07.** The Astra P1/P2 source findings are closed by
the cited local evidence. Independent Astra re-adjudication, the pending build
receipt, and the runtime holds remain outstanding. No connected/full commercial
acceptance, deployment, commit, or push is claimed.

## 23. Final exact-source adjudication — 2026-09-07

Sections 1–22 are preserved historical findings and receipts. This section is
the final documentation receipt for the exact source build supplied by the
parent run; it records release evidence without converting unavailable runtime
gates into launch acceptance.

### Exact-source automated and artifact evidence

| Gate | Result |
|---|---|
| `pnpm test` | **602 files / 7,461 tests passed** |
| `pnpm typecheck` | **passed** |
| Full lint | **0 errors / 32 warnings** |
| Focused suite | **7 files / 192 tests passed** |
| `pnpm build` | **611 modules** |
| Build digest | `f5ced093ef88ca41838e7ff12f3d48c6dee318beeb516fb2f11dd486e34ce262` |
| UI performance budget receipt | **current-authoritative**; manifest and ceilings recorded in `docs/ui-performance-baseline.json` |
| Targeted Chromium | **6/6 passed** |
| Landing budget | **passed** |
| Server contract v1 / v2 | **passed** |
| Deploy-controller tests | **101/101 passed** |
| Production scheduler hook scan | **0 hooks found** |
| `git diff --check` | **passed** |

The performance baseline now records the final exact-source artifact names,
sizes, SHA-256 values, module count, test count, and build digest supplied by
the parent-generated receipt. No artifact values are inferred from an older
build.

### Astra final adjudication

| Surface | Decision |
|---|---|
| Source implementation | **SOURCE GO** |
| Static production artifact | **ARTIFACT GO** |
| Remaining P0/P1/P2 source findings | **None** |
| Controlled staged/canary deployment | **Permitted after the documented gates and runtime holds are independently cleared** |

This is release evidence, not unconditional commercial launch acceptance. No
deployment is performed or authorized by this documentation-only update.

### Explicit runtime holds

The following runtime evidence remains unavailable or not green:

- live DEV/WS `5174`/`7080` invite, reconnect, and admission journey;
- WebKit acceptance because host dependency `libflite1` is missing and sudo is
  unavailable;
- installed PWA, two-window, offline, and update continuity;
- real media, E2EE, reconnect, multi-device, and permission journeys;
- screen-reader and real-device/mobile acceptance;
- native packaging, signing, updater, and uninstall acceptance; and
- connected-experience performance instrumentation and evidence.

The prior broad Chromium result remains **124/130, not rerun and not green**.
The targeted **6/6** result is targeted evidence only and is not an aggregate
browser-matrix pass.

**RELEASE HOLD — 2026-09-07.** The exact-source static and automated receipts
are recorded, with Astra at SOURCE GO / ARTIFACT GO and no remaining P0/P1/P2
source finding. Full commercial, connected, browser-matrix, and runtime
acceptance remains unclaimed until the explicit holds are resolved.
