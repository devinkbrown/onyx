# Onyx Public Product Overhaul

**Status:** execution roadmap
**Date:** 2026-07-28
**Product:** Onyx
**Native home:** OnyxOS
**Engine:** Onyx Server

This roadmap turns Onyx from an IRC-shaped project with a capable client into a
public communication product that a person can understand, trust, and enjoy
without knowing anything about IRC, federation, meshes, or self-hosting.

It supersedes the **positioning, public information architecture, and visual
direction** in an earlier internal product-completeness roadmap. That roadmap
remains useful as shipped-feature archaeology. Source, tests, and honest live
product behavior remain authoritative.

## 1. The decision

Onyx will be a first-class part of OnyxOS, but it will not be trapped inside
OnyxOS.

- **Onyx** is the consumer product, network, and cross-platform client.
- **OnyxOS** is the flagship native home for Onyx and demonstrates the deepest
  integration of identity, notifications, local history, media, accessibility,
  and system security.
- **Onyx Server** is the open operator engine. It is important proof and an
  ownership path, not the first concept a new user must learn.
- **Cadence** is the media technology inside Onyx. It is an ingredient brand,
  not a competing destination in primary navigation.
- IRCv3 and IRCX remain valuable compatibility and transport foundations. They
  are implementation detail until a visitor asks how Onyx stays open.

The dependency direction is deliberate:

```text
Onyx on the web, desktop, and mobile
              │
              ├── uses Onyx Server and the open wire
              │
              └── becomes a native system experience on OnyxOS

Onyx does not wait for OnyxOS to launch.
OnyxOS does not fork Onyx into a separate product.
```

## 2. The public promise

### Primary promise

> **A place for your people that you can actually trust.**

Onyx gives groups fast rooms, calls, and catch-up; shows the real protection
state of each conversation; keeps useful history on the device; and runs on an
engine people can inspect or operate.

This wording is intentionally human. It does not ask a visitor to understand
the topology before understanding the value.

### First audience and job

The initial audience is a real group that wants one dependable place to stay
together: a community, creative team, open-source project, local organization,
friend group, or family. Their job is:

> “Give us one place where joining is easy, conversation feels alive, and we
> are not surrendering the group to an advertising or lock-in business.”

The first release is not positioned as an enterprise suite, a protocol hobby,
an “IRC client,” or a universal Discord replacement.

### Public proof, not a feature dump

The website will demonstrate one connected story:

1. Join a room as a guest.
2. See a clear Home catch-up rather than an empty channel list.
3. Start or enter a call.
4. Open a direct conversation and see its honest protection state.
5. Inspect service health or the open engine only when desired.

The signature element is the **Proof Rail**: a compact, contextual strip that
explains what is happening without turning the interface into a dashboard. It
can show:

- delivery and connection state;
- where history comes from;
- the current conversation's protection state;
- whether a call is hop-protected or end-to-end protected;
- a plain-language link to supporting detail.

## 3. Truth contract

Marketing, interface copy, documentation, and runtime state must use the same
claims.

| Capability | Safe public statement now | Do not claim yet |
|---|---|---|
| Rooms and DMs | Text rooms and direct conversations on Onyx | Every room is end-to-end encrypted |
| DM encryption | Direct-message E2EE foundations fail closed when trust is unavailable | Audited Signal-equivalent privacy |
| Group encryption | Group control and replay foundations exist in Onyx Server | Finished, easy, multi-device group E2EE |
| Calls | Voice, video, screen sharing, and stages with honest security state | Every call is end-to-end encrypted |
| Passkeys | Client surfaces and protocol work exist | Passkeys work on every production account path |
| History | Local encrypted history, search, export, and time navigation exist | The server can never observe metadata |
| Network | The engine and wire are open and can be operated independently | No downtime, no moderation, or no operator trust |
| OnyxOS | Onyx is planned as a native first-class OnyxOS experience | OnyxOS is required or ready for general release |

Before a launch claim changes, it needs:

1. a source or runtime owner;
2. a focused automated test;
3. an end-to-end product proof;
4. wording reviewed against failure and partial-support states.

## 4. Product architecture: overhaul, do not rewrite

The current client is buggy and its presentation architecture is too large, but
the tested protocol and product kernel is valuable. A greenfield replacement
would discard years of behavior and create a long period with two incomplete
clients.

Preserve:

- `src/lib/irc/`
- `src/lib/e2ee/`
- `src/lib/vault/`
- `src/lib/cadence-media/`
- the message render pipeline
- the theme factory and accessibility preferences
- wire and server-contract tests

Replace or reshape progressively:

- public website positioning and navigation;
- first-run, guest, account, and recovery flows;
- the application shell and information architecture;
- presentation components around Home, Rooms, DMs, and Calls;
- the monolithic store through domain facades behind the stable `useStore`
  bridge;
- visual tokens, responsive behavior, and interaction feedback.

No phase creates a second production client. New surfaces enter behind routes,
facades, or explicit flags and take ownership only after behavioral parity.

## 5. Target information architecture

### Desktop

```text
Home        what needs attention, catch-up, followed rooms, drafts
Rooms       joined rooms, discovery, room settings
DMs         people and direct conversations
Calls       active calls, stages, recent call context
You         identity, devices, notifications, appearance, advanced
```

### Mobile

```text
Home | Rooms | Messages | Calls | You
```

Calls is a truthful destination, not a fake activity feed: it returns a person
to an active call or explains that a new call begins inside a room. Active call
controls remain persistent on the conversation surface.

Power-user and operator controls live under **Advanced**. Channel prefixes,
CAP negotiation, topology, node identifiers, and protocol names do not appear
in the default path unless they explain a real user choice or failure.

### Website

Primary navigation is limited to:

- Product
- Trust
- OnyxOS
- Download or Open Onyx

Community, status, roadmap, accessibility, developer, and operator material
remain reachable through secondary navigation and the footer.

Self-hosting is a strong secondary path. It must not compete visually with
“Open Onyx” during the first decision.

## 6. Visual direction: Human Instrument

> **Superseded (S1).** The Human Instrument palette table below is historical
> direction only. Shipped token authority is `src/styles/tokens.css` (`:root` /
> ocean flagship) and the public `--public-*` spine in
> `src/ui/public/public-frame.css`. Do not treat the hexes in this section as
> production values.

Onyx should feel precise enough to trust and warm enough to inhabit. The design
is neither a black-and-acid engineering exhibit nor a generic friendly SaaS
template.

### Core tokens

| Token | Value | Role |
|---|---:|---|
| Mineral | `#172321` | focused dark surfaces and high-contrast text |
| Shell | `#F3F0E8` | daylight canvas |
| Fog | `#D9DED8` | boundaries and quiet structure |
| Current | `#176B68` | primary action and connection |
| Signal | `#D66A45` | human attention and warm emphasis |
| Proof | `#A8C45A` | verified or healthy state, never decoration alone |

Both light and dark modes are first-class. Status is never communicated by
color alone.

### Type roles

- **Human display:** a restrained variable serif for one-line promises and
  editorial moments.
- **Interface:** a highly legible humanist sans for navigation, conversation,
  forms, and settings.
- **Evidence:** a mono face used only for identifiers, security evidence,
  timestamps, and operator detail.

Large uppercase headings, tiny mono copy, and decorative jargon are exceptions,
not the house style.

### Layout and motion

- One strong composition per screen, not a grid of equally weighted cards.
- Conversation remains the spatial center of the product.
- The Proof Rail provides the recognizable horizontal signature.
- Motion confirms causality: joining, sending, reconnecting, opening a call,
  and changing protection state.
- Reduced-motion, forced-colors, keyboard navigation, zoom, and short laptop
  viewports are release gates.

## 7. OnyxOS native contract

OnyxOS integration is a product advantage only when it makes ordinary actions
better. The integration boundary will be a typed adapter, with a web fallback
for every capability.

| Capability | Cross-platform baseline | OnyxOS native behavior |
|---|---|---|
| Identity | account, recovery, device list | system identity broker and secure credential handoff |
| Vault | encrypted browser/device store | OS-protected vault, backup policy, indexed history |
| Notifications | Web Push and in-app inbox | native notification center, focus and quiet modes |
| Calls | browser media and device picker | system device routing, call surface, screen-share picker |
| Presence | app connection and activity | explicit OS presence controls with privacy boundary |
| Sharing | paste, upload, screen share | system share target and file picker |
| Accessibility | web semantics and preferences | OS text, contrast, input, captions, and motion settings |
| Updates | PWA refresh and future wrapper updater | atomic OS package/update integration |

Native integration must not silently expand data access. Every adapter declares
permissions, data lifetime, fallback behavior, and a user-visible off switch.

## 8. Execution phases

### P0 — Repair the front door

**Goal:** no false outage, broken route, clipped form, blank capture, or
contradictory claim in the first minute.

- Keep the route materializer, router, sitemap, and nginx plan synchronized.
- Distinguish feed loading from feed unavailable.
- Verify Connect at short laptop heights with visible scroll affordance and
  reachable primary action.
- Replace fixed screenshot sleeps with route/readiness assertions.
- Create a defect ledger for join, reconnect, send, DM trust, call, and return.
- Reconcile public licensing and availability language.

**Gate:** a new visitor can load the site, open Onyx, join, send, leave, and
return without a critical error or dishonest state.

### P1 — One public story

**Goal:** one canonical website and one public promise.

- End the independent landing-overlay narrative. Establish one source of truth
  for route content and deployment output.
- Replace the IRC-first hero with the public promise and a real product scene.
- Build the interactive join → catch-up → trust proof.
- Reduce primary navigation and move stats from audience size to service health.
- Publish the truth matrix and an understandable Onyx/OnyxOS/Server family page.
- Make the OnyxOS page consumer-facing while keeping clean-room evidence in a
  technical section.

**Gate:** five unbriefed people can explain Onyx after ten seconds and find the
primary action without protocol vocabulary.

### P2 — The dependable golden path

**Goal:** the client earns the website promise.

- Introduce Home / Rooms / DMs / Calls / You navigation.
- Make guest join and account continuation share one comprehensible flow.
- Make Home useful with no prior network knowledge.
- Present empty, loading, offline, reconnecting, partial, and failed states.
- Normalize copy around people and rooms while keeping raw protocol detail
  available under Advanced.
- Validate the golden path on phone, tablet, short laptop, desktop, keyboard,
  touch, and reduced motion.

**Gate:** join, send, reply, reconnect, DM, call, catch up, and sign out pass
repeatable end-to-end journeys.

**Checkpoint — 2026-07-28**

- The connected shell now exposes the same five-part information architecture
  on desktop and mobile: Home, Rooms, Messages, Calls, and You.
- Rooms and direct messages have separate filtered collections without changing
  the protocol/store kernel.
- Calls has a real in-flow surface that returns to an active call or directs a
  person to choose a room; opening it never starts a call or implies one exists.
- You opens the existing account surface. Member access remains in the room
  ribbon, including an empty-roster state, with mobile drawer focus restoration
  preserved.
- Evidence: 104 focused shell/sidebar/ribbon tests pass; the complete unit
  aggregate passes across eight single-worker shards (443 files, 5,527 tests);
  typecheck, lint, production build, and whitespace checks pass.

This checkpoint does not complete P2. Guest/account continuation, full
loading/offline/failure-state normalization, critical Playwright journeys, and
visual validation across the release viewport matrix remain open.

### P3 — A coherent shell and design system

**Goal:** remove visual and behavioral drift without destabilizing the kernel.

- Land semantic design tokens and both color schemes.
- Build shared navigation, action, form, dialog, state, and Proof Rail
  primitives.
- Move giant shell and preference surfaces into bounded feature modules.
- Establish screenshot stories for all major states and viewport classes.
- Budget initial JavaScript, CSS, fonts, images, interaction latency, and memory.

**Gate:** no feature invents its own button, status language, spacing scale,
dialog behavior, or mobile breakpoint.

### P4 — Store strangler

**Goal:** make product change safe.

- Inventory state ownership and side effects in `src/lib/store/store.ts`.
- Add domain facades for identity, connection, rooms, messages, calls, vault,
  notifications, and preferences.
- Keep `useStore` as the compatibility bridge while consumers migrate.
- Move one domain at a time with contract and allocation/failure tests.
- Remove the old path only after the last consumer and an end-to-end gate move.

**Gate:** a failure or feature change in one domain does not require editing the
global store or rerunning an unbounded manual regression.

### P5 — Installable everywhere

**Goal:** one product with appropriate platform affordances.

- Treat the PWA as the first installable release.
- Harden offline/update/recovery behavior and manifest/install prompts.
- Evaluate a thin desktop wrapper only for capabilities the web cannot provide
  reliably.
- Defer native mobile clients until measured retention or platform limitations
  justify a separate surface.

**Gate:** browser and installed PWA share identity, history, deep links,
notifications, and recovery behavior without divergent product semantics.

### P6 — Onyx inside OnyxOS

**Goal:** Onyx feels built into the operating system while remaining the same
recognizable product.

- Define and test the typed OnyxOS platform adapter.
- Integrate native identity, credential protection, notifications, vault,
  sharing, media routing, accessibility, and update surfaces incrementally.
- Ship system-owned fallback and permission-denied states.
- Add Onyx to OnyxOS first-run and app discovery only after the communication
  golden path meets the same release gate as the web product.
- Demonstrate the combination publicly as one flagship experience, not as a
  dependency for people on other platforms.

**Gate:** every native enhancement has a permission contract, a cross-platform
fallback, a deterministic test, and a real OnyxOS integration proof.

## 9. Measures that decide the roadmap

### Reliability

- successful page and lazy-route load rate;
- join success and time to first message;
- send acknowledgement latency and failure recovery;
- reconnect and session-resume success;
- DM trust-state correctness;
- call join, audio establishment, and leave success;
- uncaught errors and forced reloads.

### Product

- visitors who open Onyx;
- people who complete first join and first message;
- day-one and day-seven return;
- groups with at least three active people;
- rooms with a second session;
- Home catch-up opened after return;
- call or stage participation;
- invitations accepted.

### Trust

- protection state viewed before sending sensitive content;
- trust-state transitions that require user action;
- recovery completion;
- export and device-removal success;
- claims with current runtime evidence.

Small public audience counts are not hero material. Health and reliability can
be public before scale; growth numbers become useful when they demonstrate a
real network effect.

## 10. Release gates

Every phase must pass:

1. focused unit and integration tests for changed behavior;
2. `pnpm typecheck`;
3. `pnpm lint`;
4. the full unit suite with pass counts;
5. `pnpm build`;
6. critical Playwright journeys on phone and desktop;
7. keyboard, focus, zoom, forced-colors, and reduced-motion checks;
8. visual review at short laptop, desktop, and mobile viewports;
9. current server-contract verification for wire-dependent claims;
10. a fresh reviewer attempting to falsify the changed public promise.

Deployment remains a separate, explicit operator decision. This roadmap does
not authorize writing `out/`, changing production nginx, restarting services,
pushing Git, or deploying either Onyx or OnyxOS.

## 11. Market anchors

Onyx does not need every feature to be unique. It needs the combination to be
coherent and the promise to be easier to understand than the implementation.

- Discord teaches the mainstream category through communities, text, voice,
  video, screen sharing, stages, and activities.
- Slack emphasizes work collaboration, huddles, and assisted information
  retrieval.
- Element and Mattermost emphasize control and deployability.
- Zulip emphasizes organized asynchronous conversation.
- Signal makes private group conversation understandable.

Current reference pages:

- <https://support.discord.com/hc/en-us/articles/360045138571-Beginner-s-Guide-to-Discord>
- <https://discord.com/stages>
- <https://slack.com/features/huddles>
- <https://element.io/pricing>
- <https://mattermost.com/>
- <https://web.zulip.com/features/>
- <https://support.signal.org/hc/en-us/articles/360007319331-Group-chats>

The opportunity is not an unsupported claim that no competitor has any Onyx
feature. It is to make **welcoming community, capable communication, honest
protection, useful local memory, and an open operator engine** feel like one
product rather than five specialist tools.
