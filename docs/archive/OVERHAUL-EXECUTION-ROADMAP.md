> **Archived 2026-11-06.** Historical record from the SolidJS era; paths and status here are not current. See [`../README.md`](../README.md).

# Onyx overhaul — execution roadmap

Status: active execution plan · Date: 2026-10-04 · Branch: `onyx-solid`
Scope: Onyx SolidJS client + public website in this repo only.
Daemon work lives in `/home/kain/onyx-server` and is out of scope here.

This file consolidates `docs/CLIENT-COMMERCIAL-OVERHAUL-AUDIT.md` (O-01…O-50),
`docs/PRODUCT_OVERHAUL_ROADMAP.md` (P0…P6), `docs/FEATURE-ROADMAP.md` (C-xx),
and `docs/COMMERCIAL_UI_SYSTEM.md` (ribbon slices 1–7) into one ordered,
dependency-aware execution sequence. Source and tests remain authoritative
over prose. Kernel freeze holds for every wave unless a source-backed defect
requires a change: `src/lib/irc/`, `src/lib/e2ee/`, `src/lib/vault/`
(crypto boundaries), `src/lib/cadence-media/`, wire `ocean.*` keys,
`onyx:` storage keys, first-import `migrateStorage`.

Existing uncommitted user work (brand art, shell/connect CSS, voice-stage
reflow e2e) is preserved. Slices must not overwrite it; rebase review first.

## W0 — Contract and inventory (this wave starts now)

| Slice | Maps to | Deliverable | Gate |
|---|---|---|---|
| W0-A | O-01, P0 | Route/entrypoint ownership: `ROUTE_ENTRYPOINTS` ↔ `<Route>` sync guard test | new contract test + typecheck |
| W0-B | O-02, P0 | Terminology ledger: consumer ↔ internal glossary checked in, first 12 surfaces migrated | ledger doc + lint |
| W0-C | O-04, P0 | Surface disposition inventory: every route/component Keep/Merge/Advanced/Retire | inventory doc |
| W0-D | O-03, O-05 | Capability truth matrix + universal-state fixture catalog | matrix doc + fixtures |
| W0-E | O-06, CP-xx | Eager payload budget back to green without raising baseline | budget script green + build |
| W0-F | stack | Use newer tech where it is safe: in-range minors now, majors as spikes | see table |

Stack modernization (evidence: npm registry, 2026-10-04):

| Package | Repo | Latest | Decision |
|---|---|---|---|
| `solid-js` | ^1.9.5 | 1.9.15 | in-range minor now |
| `vite-plugin-solid` | ^2.11.6 | 2.11.14 | in-range minor now |
| `zustand` | ^5.0.13 | 5.0.15 | in-range patch now |
| `tailwindcss` / `@tailwindcss/vite` | ^4.1.7 | 4.3.3 | in-range minor now |
| `@playwright/test` | ^1.60.0 | 1.63.0 | in-range minor now |
| `typescript` | ^5 | latest 5.x | in-range minor now (NOT 7.x native port) |
| `vitest` + coverage | ^4.1.7 | 5.0.3 | spike: move together with Vite 8 pairing |
| `vite` | ^7.1.0 | 8.3.2 (rolldown) | spike: needs `vite-plugin-solid` peer proof + budget re-measure |
| `@solidjs/router` | ^0.15.3 | 1.0.0 | spike: breaking-change review + route tests |
| `eslint` | ^9 | 10.12.0 | blocked: `typescript-eslint` latest stable is 8.x (no ESLint 10 support) |

Rules: minors via `pnpm update` + full gates; majors only with a compat
spike, test evidence, and a rollback point. Never let a toolchain bump
silently move the UI budget or break `vite-plugin-solid` output.

Route ownership (from `src/index.tsx` + `tools/materialize-route-entrypoints.mjs`):

| Route document | Owner chunk | Entry point |
|---|---|---|
| `/` Landing (eager) | landing | — (root) |
| `/app` chat shell | AppRoute lazy | `app` |
| `/about` | lazy | `about` |
| `/appearance` | lazy | `appearance` |
| `/stats` | lazy | `stats` |
| `/status` | lazy | `status` |
| `/roadmap` | lazy | `roadmap` |
| `/invite` | lazy | `invite` |
| `/onyxos` | lazy | `onyxos` |
| `/download` + `/install` alias | lazy | `download` / `install→download` |
| `/guides` + `/community` alias | lazy | `guides` / `community` |
| `/privacy` `/guidelines` `/contact` | lazy TrustPages | `privacy`/`guidelines`/`contact` |
| `/accessibility` `/glossary` `/integrations` `/agents` | lazy PublicInfo | same names |
| `/*notFound` | lazy PublicInfo | 404 flat, noindex |

## W1 — Design system and primitives (O-07…O-09, P3)

Merge legacy app tokens + `ui-*` tokens into one applied contract;
semantic light/dark/high-contrast/forced-colors themes; harden Button,
IconButton, FormField, ModalShell, Sheet, Popover, Tabs, Toast, Tooltip,
Avatar, layout primitives; one overlay/focus/Escape stack. Exit: keyboard,
forced-colors, reduced-motion, 44px-target tests green on every primitive.

## W2 — Public front door (O-10…O-11, P1)

One promise + three task CTAs on Landing; ProductPreview honest preview;
Invite shortest path with invalid/expired recovery; Download truthful about
unsigned/native-preview; Trust pages get policy/security-contact/incident
path. Exit: unbriefed-visitor comprehension + CTA-failure coverage.

## W3 — Identity and first run (O-12…O-13, P2-part)

Connect becomes a guided journey (guest → account → recovery), one next
action, resumable progress; GuestClaim stays chip→sheet, never blocks
composer. Exit: join→send→DM→return journeys on desktop + 320px.

## W4 — Product frame (O-14…O-16, O-18…O-19, P2)

AppShell state machine (destination/room/collection/context/call/modal/focus/
intent single owners); PrimaryNavigation five destinations; ServerRail single
mark until multi-network; ChannelSidebar split Your conversations/Discover/
Create; explicit New message/New room. Exit: IA parity desktop/tablet/mobile.

## W5 — Home and conversation core (O-17, O-21…O-29, P2)

One Home inbox (attention → continue → waiting-to-send → discover); one
unread seam; calm transcript grouping; MessageText block-semantics fix;
Composer primary Attach/Message/Emoji/More/Send; unified drafts+outbox;
scoped search (conversation/device/server); pins vs saved split. Exit:
readable long transcript, reload-safe drafts, reversible mark-read.

## W6 — Privacy and safety language (O-20, O-30…O-34, C-10/C-11)

Plain-language DM protection states; key-change review-first flow;
group-protection honesty (staged never overclaimed); You consolidation;
block/mute/report separation (local-draft vs server intake explicit).
Kernel crypto untouched. Exit: fail-closed evidence + no overclaim strings.

## W7 — Calls honesty (O-36…O-38, C-04)

One call state machine (prejoin/active/reconnect/failed/ended); stable
VoiceBar controls; stage consolidation; captions + WatchTogether labeled
local/remote/unavailable; media stays lazy. Exit: multi-user browser proof.

## W8 — Notifications, appearance, storage (O-39…O-42, C-05/C-13/C-19)

One effective notification policy surface; appearance simple + Theme Studio
advanced; vault retention/quota/corruption/migration UX; import/export/erase
with scope+progress+recovery; PWA install/update/offline evidence.

## W9 — Power surfaces (O-35, O-43…O-45, C-03/C-18)

Moderation workspace (scope/reason/expiry/receipt); OperDesk out of consumer
chrome; What-works-here capability view; extension/integration center with
actor/destination/permissions/revoke; desktop claims gated on signing evidence.

## W10 — Verification and retirement (O-46…O-50, CL/CP tracks)

Keyboard/screen-reader/zoom/forced-colors program; Chromium/WebKit/Firefox +
mobile matrix; visual-regression fixtures; support-safe diagnostics
(no content/credentials/tokens in IDs); orphan removal + docs sync. Exit:
zero open P0/P1 in first-run, safety, privacy, a11y, recovery, perf, truth.

## Execution log

- 2026-10-04 · W4 slice 1 (sidebar calm-density): `src/shell/collection-density.css`
  + import in `ChannelSidebar.tsx` + `collection-density.test.ts` (6 tests).
  Focused: 52 passed across density/ChannelSidebar suites. Typecheck clean.
- 2026-10-04 · W7 slice 1 (call clarity): `CallsHub` `lastCallOutcome`
  (ended/failed/dropped, idle-only, parent-supplied) + `callOutcomeCopy` +
  `.shell-calls-outcome` styles + 6 new tests. Focused: 20 passed.
  Typecheck + eslint clean. Next: AppShell supplies the outcome from the
  voice lifecycle; then transcript calm layer, then Landing rewrite.
- 2026-10-04 · W7 slice 2 (outcome wiring): AppShell derives `lastCallOutcome`
  from shell-owned evidence (failed join / transport drop w/ rejoin pending /
  lived call ended; declined rings stay silent) and passes it to CallsHub.
  3 new AppShell integration tests. Focused: 31 passed. Typecheck clean,
  eslint 0 errors.
- 2026-10-04 · W5 slice 1 (transcript calm): `src/shell/transcript-calm.css`
  (68ch measure, 15.5px/1.55 body, tabular-sans timestamps, calm dividers,
  44px jump pill) + import in `MessageView.tsx` + 6 contract tests.
- 2026-10-04 · W2 slice 1 (landing tasks): third hero CTA "Keep it on this
  device" → `/download/` alongside Open Onyx + See the public room; order
  and hrefs locked in `Landing.test.tsx`. Full lint (0 errors) + full unit
  suite green at this point.

## Ordering rules

1. Docs/contract slices before styling slices (W0 before W1).
2. Consumer path before power tools (W2–W8 before W9).
3. One slice = one epic footprint + one focused test + gates
   (`typecheck`, `lint`, affected `vitest`, `build` where CSS/chunks move).
4. Never write `out/`; never touch `/home/kain/onyx-server`; never push/deploy.
5. SolidJS rules hold: `useStore` reactive reads, no prop destructure,
   immutable `set()` writes, `getState()` snapshots only.

## 2026-10-09 release waves

The deployed rewrite is Elm (`ONYX_CLIENT=elm`); the Solid source/build remains
maintained. Source and browser evidence take priority over the original
Solid-only scope wording above. The current release completes startup/framing
repair, warning cleanup, public-page reflow, mobile conversation navigation,
and panel/focus finishing. See [release evidence](CLIENT-RELEASE-2026-10-09.md).
Remaining feature-roadmap items retain their own gates and status.

### Connection and conversation follow-up — 2026-10-09

Published `onyx-shell-20261009-145542-55bfa9cf-dirty`: connection/identity dialog, DOM-only sign-in credentials, pending-sign-in disconnect recovery, confirmed browser-join activation, empty-chat room actions, date/history controls, and compact mobile composer. Independent identity review passed. Gates: typecheck/lint/build, 7,596 repository tests, 2,556 Elm tests, 286 bridge tests, 15 browser scenarios plus final five-client-scenario geometry pass. Live mobile check confirmed actual registration, #root join, roster, composer, dialog, and clean console with no horizontal overflow.
