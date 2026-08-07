# Onyx official product overhaul roadmap

Status: historical council decision; implementation underway
Date: 2026-07-28
Primary product repository: `/home/kain/onyx`
Canonical public-site repository: `/home/kain/landing`
Engine repository: `/home/kain/onyx-server`

> This document preserves the checkout paths and source snapshot used by the
> original council review. For current public status, setup, and release truth,
> use [`README.md`](README.md), [`docs/README.md`](docs/README.md), and the live
> source/tests. “Not started” or count snapshots later in this record are
> historical evidence, not current completion claims.

## 1. Executive decision

Onyx will launch as an **independent community communication platform** for
friends, clubs, creators, open communities, and public-interest groups.

The public category is not “IRC client,” “mesh daemon,” or “enterprise
sovereignty.” The public job is:

> **Rooms, calls, and private DMs — without the ads.**

Supporting line:

> Open Onyx in your browser. Encrypt what should stay between people. Run your
> own node when you are ready.

The product will be overhauled, not rewritten:

- Keep the Onyx Server engine, IRC/IRCX transport, E2EE modules, vault, imports,
  media engine, and the existing test capital.
- Replace the split public story with one canonical website.
- Simplify onboarding around joining people, not selecting infrastructure.
- Build a new application shell in controlled slices behind a cohort flag.
- Move technical and advanced surfaces out of the first-week experience.
- Treat security claims as release-gated facts, never aspirational copy.

The council explicitly rejected a greenfield client rewrite. The current client
contains too much proven protocol, crypto, media, vault, accessibility, and test
work to discard safely.

## 2. Current source truth

### Server

The durable E2EE group-control mesh tranche is committed locally in
`/home/kain/onyx-server`:

- Commit: `bff1a3d feat(e2ee): activate durable group control mesh`
- Full gate: 7,884 passed, 4 expected skips, 0 failures across 7,888 tests.
- No push or deployment was performed.
- The activation document explicitly blocks production activation until
  custody and receipt drain visibility exists.

This is strong protocol infrastructure. It is not by itself proof that public
group-E2EE onboarding, multi-device membership, recovery, and live rollout are
ready.

### Client

Observed at `onyx-solid@acba09f` with unrelated user work preserved:

- 872 source files.
- 442 unit-test files.
- 54 Playwright specifications.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm build`: pass.
- Unit tests: 5,520 passed, 1 failed.
- The only unit failure is the in-progress `/onyxos` route missing from the
  route-entrypoint expectation.

The client is well tested but structurally overgrown:

| Surface | Current size |
|---|---:|
| `src/lib/store/store.ts` | 17,119 lines |
| `src/shell/PreferencesPanel.tsx` | 3,713 lines |
| `src/theme/ThemeStudio.tsx` | 2,859 lines |
| `src/lib/cadence-media/MediaEngine.ts` | 2,794 lines |
| `src/shell/MessageView.tsx` | 2,100 lines |
| `src/app/Connect.tsx` | 1,755 lines |
| `src/shell/AppShell.tsx` | 1,100 lines |

Current production-build pressure:

| Artifact | Raw | Gzip |
|---|---:|---:|
| AppShell JS | 432.26 KB | 128.87 KB |
| Runtime JS | 360.70 KB | 106.08 KB |
| AppShell CSS | 257.51 KB | 37.88 KB |
| Preferences JS | 125.75 KB | 35.66 KB |

These are reasons to constrain and progressively reshape the shell. They are
not reasons to throw away the working transport and security core.

### Public site

There are currently two separate front doors:

1. `/home/kain/landing` builds a static SEO/community site.
2. `/home/kain/onyx/src/routes/Landing.tsx` builds a separate Solid landing
   experience.

`/home/kain/onyx/deploy.sh` builds the SPA and then copies
`/home/kain/landing/dist/.` over the staged output. The static landing site
therefore owns the live root.

The two sites currently disagree in message and tone:

- “A small network you can join.”
- “Nobody’s product.”
- “A first-party client we keep as our sauce.”
- “Come live on the water.”
- “People, not a product.”

Those lines describe an intentionally niche personal project. They directly
conflict with an official, maintained, mainstream product launch.

## 3. Verified immediate defects

These ship before design-system or V2-shell work:

1. **Loading is rendered as outage.**
   `src/routes/Landing.tsx` starts public resources at `null`, while
   `src/lib/stats/status.ts` maps `null` to unavailable. A normal cold load
   therefore advertises “status unavailable.”

2. **The desktop Connect flow clips its own explanation.**
   `src/app/connect.css` creates a scroll container for common laptop heights
   while keeping the final action sticky. The guest identity/destination/
   continuity explanation is visibly clipped without a clear scroll cue.

3. **The route-entrypoint contract is red.**
   The uncommitted `/onyxos` route is present in `src/index.tsx` but absent from
   `src/pwa/routeEntrypoints.test.ts` expectations.

4. **Two public narratives exist.**
   The static overlay owns live `/`, but the client still carries a full second
   landing route, metadata, tests, and primary navigation.

5. **Primary navigation is not focused.**
   The chat-product navigation currently includes too many destinations,
   including OnyxOS. OnyxOS is a separate deep product story and does not
   belong in the launch-critical chat navigation.

## 4. Product definition

### Primary audiences

1. Friend groups and clubs that want rooms and calls without an ad network.
2. Creators and open communities that need a durable home and easy invites.
3. Civic, educational, privacy-conscious, and open-source groups that want an
   exit from platform lock-in without operating an enterprise stack.
4. Technical operators who may later run an Onyx Server node.

The first three audiences drive the homepage and app. Operators get a separate
developer and self-host path.

### Three public jobs

#### Gather

Rooms, DMs, presence, voice/video, replies, reactions, catch-up, search, and
invites should feel immediately familiar.

#### Keep private

Onyx shows what is private, what the server can see, what is encrypted only in
transit, and what is end-to-end encrypted. It does not collapse different
security states into one decorative padlock.

#### Own the exit

No ads, no third-party tracking, an open protocol, portable history, imports,
and an open Onyx Server engine mean a community is not trapped.

### Public vocabulary

| Internal or specialist term | Public wording |
|---|---|
| IRC mesh | Open chat network |
| Channel | Room, except where `#name` is useful |
| Onyx Server pure Zig | The open engine that runs Onyx |
| Helix live upgrade | Updates without dropping the room |
| CadenceVox / CadenceVis | Voice and video |
| Host cloak | Your IP address stays private |
| E2EE group-control mesh | Private group messages, only after the live product gate |
| Product sauce | Official Onyx app |
| Self-host | Run your own node |

### Copy that must not return

- Nobody’s product.
- Small network as the product identity.
- Product sauce as a virtue.
- Discord killer.
- Fully encrypted or fully E2EE.
- Post-quantum as the consumer headline.
- Protocol acronyms above the fold.
- Passkeys are shipping before server support is live.
- Group E2EE is done because the relay/control layer is committed.

## 5. Market position

Onyx does not win by matching every feature count. It wins by combining a
consumer-grade community experience with honest private text and an open exit.

| Provider | Verified strength | Gap Onyx can address |
|---|---|---|
| [Discord](https://docs.discord.com/developers/platform/community-servers) | Community onboarding, discovery, channels, moderation, calls | Discord says its text is not E2EE and has no current plan to make it so; Onyx can combine community UX with private text after live proof |
| [Discord DAVE](https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted) | E2EE voice/video at mainstream scale | Onyx must not imply call-security leadership without equivalent live reliability and platform coverage |
| [Slack](https://slack.com/features) | Mature work collaboration, search, integrations | Centralized work positioning rather than independent public communities |
| [Slack Huddles](https://slack.com/features/huddles) | Easy in-context audio/video/screenshare | Onyx can serve social/community use without paid-workspace framing |
| [Element](https://element.io/pricing) | Decentralized, self-hosted, E2EE text and calls | Strongest technical comparator; primarily positioned around sovereignty and enterprise/public sector rather than approachable public communities |
| [Mattermost](https://mattermost.com/) | Self-hosted mission-critical collaboration and calls | Operational/workplace focus rather than a public consumer network |
| [Zulip](https://zulip.com/features/) | Excellent topic organization and self-hosting | Voice/video uses external providers; less suited to spontaneous social rooms |
| [Telegram](https://www.telegram.org/faq) | Huge groups, usernames, calls, broadcast | Cloud group text is not E2EE; secret chats are a separate device-specific mode |
| [IRCCloud](https://www.irccloud.com/about) | Modern always-connected IRC experience | Far narrower integrated product surface |

The comparison page must be factual and respectful. It should explain choices,
not publish an unmaintainable “we beat everyone” checklist.

## 6. Canonical site and route ownership

Binding council decision:

| Surface | Canonical owner | Live path |
|---|---|---|
| Product marketing and SEO | `/home/kain/landing` | `/` |
| Product app and Connect | `/home/kain/onyx` | `/app` |
| Invites | `/home/kain/onyx` | `/invite` |
| Appearance | `/home/kain/onyx` | `/appearance` |
| Public status data | One canonical public route, linked from both | `/status` |
| Security and trust | `/home/kain/landing` | `/security/` |
| Product overview | `/home/kain/landing` | `/product/` |
| Developers and self-host | `/home/kain/landing` + Onyx Server docs | `/developers/`, `/self-host/` |
| OnyxOS | Separate deep page, absent from primary chat nav | `/onyxos/` |

`src/routes/Landing.tsx` stops being an independent narrative. Its removal or
conversion to a non-copy-owning development stub must happen transactionally
with:

- `src/index.tsx`
- `src/pwa/routeEntrypoints.test.ts`
- `tools/materialize-route-entrypoints.mjs`
- route metadata tests
- landing and deploy-boundary documentation

One public string owner is mandatory. Public copy changes begin in
`/home/kain/landing`; app chrome changes begin in `/home/kain/onyx`.

## 7. Website information architecture

### Primary navigation

Maximum five items plus the primary CTA:

- Product
- Security
- Developers
- Status
- Plans or About
- **Join free** (CTA)

Do not publish “Plans” until a real free/managed/support model exists. Use
“About” during public beta if pricing is undecided.

### Homepage journey

1. **Hero: clear job in three seconds**
   - Headline: “Rooms, calls, and private DMs — without the ads.”
   - Subline: browser entry, honest privacy, optional self-hosting.
   - Primary CTA: Join free.
   - Secondary CTA: Sign in.
   - Operator CTA appears below the consumer proof.

2. **Product proof**
   - A real product-stage preview, not a decorative terminal.
   - Show the same community across Home catch-up, a room, a private DM, and a
     call.
   - Never populate the stage with fake “live” telemetry.

3. **Trust strip**
   - No ads.
   - No third-party trackers.
   - Private DMs.
   - Open engine.
   - IP addresses cloaked on the public network.

4. **Gather**
   - Rooms, replies, reactions, search, catch-up, voice, video, screen sharing.

5. **Keep private**
   - Plain-language security-state matrix.
   - Show a real in-product privacy indicator.

6. **Own the exit**
   - Imports, portable local history, open protocol, self-hostable engine.

7. **Use cases**
   - Friend group.
   - Creator/community.
   - Club/class/project.
   - Public-interest organization.

8. **Community proof**
   - Real scheduled activity and real rooms.
   - No invented member counts.

9. **Developer/self-host proof**
   - Below the main consumer story.

10. **Final CTA**
   - Join a live room.

### New or rebuilt routes

- `/product/`
- `/security/`
- `/communities/` only once discovery/onboarding has real content
- `/developers/`
- `/self-host/`
- `/status/`
- `/about/`
- `/legal/terms/`
- `/legal/privacy/`
- `/support/`

## 8. Visual direction

The council did not approve discarding the current dark identity. The launch
system will deliberately bridge a brighter public site and the existing dark
product before deciding whether the app itself should become light-first.

Working direction: **Luminous Current**

### Palette

These are prototype tokens, not approved production contrast pairs:

| Token | Prototype | Role |
|---|---|---|
| Current ink | `#101722` | Text, dark navigation, trust bands |
| Deep water | `#07131D` | Product and technical surfaces |
| Clear paper | `#F6F8FB` | Main marketing canvas |
| Mist | `#E8EEF4` | Quiet surfaces and dividers |
| Signal cyan | `#0087B8` | Primary action and active state |
| Collaboration violet | `#6757D9` | Shared activity and focus moments |
| Human coral | `#D85C4A` | Live people/events; never generic error red |

Every text/background and control pair must pass WCAG 2.2 AA. Cyan may be
brightened decoratively, but small text and buttons use the contrast-safe ramp.

### Type

- Instrument Sans: interface, body, navigation, and controls.
- Fraunces: restrained editorial emphasis and human stories.
- JetBrains Mono: status, trust facts, code, and technical data only.
- Anton is removed as the dominant public display face; it currently makes
  onboarding feel like a poster rather than a broadly approachable product.

### Layout

- Clear 12-column desktop grid and single-column mobile flow.
- Fewer, shorter sections than the current very long homepage.
- Real screenshots and interaction states carry the product story.
- Avoid repeated uniform card grids and decorative numbering unless the
  content is genuinely sequential.
- Consumer sections are light and breathable; technical trust sections use
  deep-water bands.

### Signature element

A **living conversation ribbon** moves through one continuous product story:

message → reply → catch-up → private DM → voice → portable community.

It is one orchestrated homepage moment, not scattered animation. It must:

- have a static fallback;
- respect reduced motion and reduced data;
- avoid another always-on canvas runtime;
- use real product content;
- remain a marketing signature, not app chrome.

### Required prototypes before a visual commitment

1. Luminous Current: bright marketing canvas + dark product.
2. Deep Current 2: improved dark marketing + dark product.

Capture and review both at 320, 390, 768, 1024, and 1440 pixels. The decision
uses public comprehension, CTA visibility, product recognition, accessibility,
and performance—not agent preference.

## 9. Onboarding overhaul

### Current problem

The Connect surface is visually crafted but asks a newcomer to understand
identity modes, destinations, continuity, nicknames, channels, nodes, and
remembering before they have experienced a room.

### Target flow

#### Invite entry

1. Open invite.
2. Preview the community and destination room.
3. Enter a display name only if needed.
4. Join as guest.
5. See and send the first message.
6. Offer account claim after value is demonstrated.

#### Direct entry

1. Show one primary choice: Join free.
2. Default to Home or a staffed welcome room.
3. Hide node routing; say “Connecting securely.”
4. Offer Sign in and Create account as clear secondary paths.
5. Move continuity/session details to a plain privacy explanation.

#### Account path

- Email is optional only if recovery behavior is clearly explained.
- Passkey UI remains hidden or marked unavailable until server support is
  end-to-end green.
- Account claim never strands the guest session or room context.

### Onboarding acceptance

- A first-time guest can send a real message within 60 seconds.
- No infrastructure selection is required.
- Back/refresh does not lose an in-progress identity without warning.
- Errors explain the next action.
- Mobile keyboard and safe-area behavior pass on real small-height layouts.

## 10. Client transformation

### Navigation model

Launch-default information architecture:

- Home
- Rooms
- DMs
- You

Calls live in room/DM context. Members and details use one drawer at a time.
Mobile uses bottom navigation and avoids simultaneous permanent sidebars.

### V2 shell seam

Create the new shell behind an off-by-default cohort flag:

- query escape hatch: `?shell=v2`;
- persisted local cohort key;
- immediate return to the legacy shell;
- no protocol or store fork.

Suggested file boundaries:

- `src/routes/AppV2Route.tsx`
- `src/product-shell/ProductShell.tsx`
- `src/product-shell/navigation/`
- `src/product-shell/home/`
- `src/product-shell/rooms/`
- `src/product-shell/dms/`
- `src/product-shell/account/`
- `src/product-shell/adapters/`
- `src/product-shell/styles/`

Adapters may select and invoke existing store actions. They may not duplicate
IRC parsing, E2EE, vault, media, outbox, or session-resume logic.

### Migration order

1. Navigation frame and empty/loading/error states.
2. Home catch-up.
3. Room list and room navigation.
4. Message timeline and composer.
5. DMs and explicit security state.
6. Member/details drawer.
7. Voice/call entry.
8. Account and launch preferences.
9. Advanced surfaces.

### Preferences

The default “You” and Settings experience is limited to roughly twelve public
controls:

- account and devices;
- notifications;
- privacy;
- blocked users;
- appearance mode;
- text size/density;
- reduced motion/data;
- voice devices;
- language;
- data export;
- support;
- advanced.

Theme Studio, raw protocol options, background scenes, and operator controls
live under Advanced.

### Store policy

Do not pause launch to split the 17,119-line store.

When a V2 journey touches a store domain:

1. Add a typed selector/action adapter.
2. Add focused contract tests.
3. Extract a pure domain module only when it reduces actual journey risk.
4. Keep the wire fold-back path authoritative.
5. Never maintain legacy and V2 protocol state independently.

## 11. Security and marketing claim ledger

| Claim | Current evidence | Public launch rule |
|---|---|---|
| No ads | Current product posture | Safe if policy and runtime remain true |
| No third-party trackers | Current source/site posture | Safe after production resource audit |
| Host/IP cloaking | Server/client behavior and current copy | Demonstrate on live network before prominent claim |
| E2EE DMs | Client crypto and tests exist | Claim only after live multi-device send/receive/recovery gate |
| E2EE group messages | Server authority committed; client foundation exists | “Coming” until live multi-device membership, migration, recovery, and rollout gates pass |
| Voice/video encryption | Multiple media security states exist | Label the exact active state; never use one universal padlock |
| Passkeys | Client manager exists; server support is a documented gap | Do not market as available until live server ceremony passes |
| Zero-drop upgrades | Helix and mesh gates exist | Use qualified wording and live acceptance evidence, not “never fails” |
| Self-hostable engine | Onyx Server is AGPL with release tooling | Verify current public release assets and quickstart before publishing versioned copy |

Every release candidate includes a marketing-claim diff. A claim without a
named evidence command, test, or live check is removed.

## 12. Moderation, support, and legal

An official public product cannot replace “Nobody’s product” with silence.

### Public-beta minimum

- Named operator/support contact.
- Published support boundary and response target.
- Terms of service.
- Privacy policy.
- Acceptable-use/community guidelines.
- Copyright/abuse reporting path.
- Security disclosure policy.
- Status and incident communication.
- In-product block, mute, and report paths.
- Moderator queue and clear room/user actions.
- Account deletion and data export instructions.

Warden/server moderation is not enough until a non-operator can use the
necessary controls safely from the product.

## 13. Community-density plan

The largest launch risk is an empty, beautiful product.

Before public-beta promotion:

- Staff a welcome room on a published schedule.
- Run a recurring public voice/event session.
- Seed 3–5 rooms with distinct, honest purposes.
- Use invite links that land directly in a relevant room.
- Show live counts only when the feed is current.
- Replace empty feeds with useful guided actions, never fake activity.
- Recruit a small founding cohort of real clubs/communities.

Success is measured in active rooms with repeated human participation, not
registered accounts alone.

## 14. Phased execution

### Phase 0 — truth, defects, and one front door

Target: 1–2 focused weeks.

Work:

1. Fix loading versus unavailable.
2. Fix the common-laptop Connect clip.
3. Fix the route-entrypoint test.
4. Remove OnyxOS from primary chat navigation.
5. Commit the canonical-site ownership rule.
6. Retire the duplicate Solid landing narrative transactionally.
7. Purge small/nobody/sauce language from public metadata and copy.
8. Create the security claim ledger.
9. Draft terms, privacy, support, moderation, and disclosure documents.
10. Publish the staffed-room beta schedule internally.

Primary files:

- `src/lib/stats/status.ts`
- `src/routes/Landing.tsx`
- `src/app/connect.css`
- `src/index.tsx`
- `src/pwa/routeEntrypoints.test.ts`
- `tools/materialize-route-entrypoints.mjs`
- `/home/kain/landing/src/meta.json`
- `/home/kain/landing/src/shared/sections/00-nav.html`
- `/home/kain/landing/src/sections/10-hero.html`
- `/home/kain/landing/src/sections/45-ethos.html`
- `/home/kain/landing/src/sections/48-selfhost.html`
- `/home/kain/landing/build.mjs`

Exit gates:

- Onyx typecheck, lint, unit, and build green.
- Landing `node build.mjs --check` and tests green.
- No normal loading frame says unavailable.
- Connect works at 1366×768, 1440×900, and short mobile viewports.
- One canonical root story.
- No deployment.

### Phase 1 — official website, onboarding, and trust

Target: 4–6 weeks.

Work:

1. Build the new homepage journey.
2. Produce both visual prototypes and select one with evidence.
3. Add Product, Security, Developers, Support, and legal pages.
4. Add the real product-stage demo.
5. Simplify direct and invite onboarding.
6. Make invite links the primary acquisition loop.
7. Fold public settings behind a launch-focused IA.
8. Productize block/mute/report.

Exit gates:

- Stranger comprehension test: category and value understood in ten seconds.
- Guest-to-first-message median below 60 seconds in the beta cohort.
- WCAG 2.2 AA automated and manual keyboard review.
- No fake or stale “live” data.
- Privacy/security claims independently checked against runtime.
- LCP, CLS, and INP budgets met on representative mobile hardware.
- No deployment without explicit authorization.

### Phase 2 — cohort V2 shell and mobile

Target: 8–12 weeks, incremental.

Work:

1. Add the V2 shell flag and adapter layer.
2. Ship Home, Rooms, DMs, and You in migration order.
3. Add mobile bottom navigation and single-drawer layouts.
4. Make DM privacy state obvious and actionable.
5. Prioritize call join/rejoin reliability over new media features.
6. Keep Advanced features reachable but out of the default path.

Exit gates:

- Legacy shell remains a working escape hatch.
- Connect → join → send → echo stays green.
- Reconnect/session resume stays green.
- DM encrypt/decrypt, key-change, and recovery paths stay green.
- Call join, five-minute hold, reconnect, and leave pass.
- No new always-on canvas or media load on first paint.
- V2 initial connected-shell gzip target: at most 180 KB, excluding lazy media
  and advanced surfaces.
- Real five-person groups complete a seven-day trial without returning to the
  incumbent for the primary room.

### Phase 3 — beta reliability, density, and official launch

Target: one or more release cycles.

Work:

1. Resolve beta defects by journey severity.
2. Finish PWA installation, push, and offline behavior.
3. Complete moderation/operator workflows.
4. Run security, accessibility, performance, and privacy reviews.
5. Prove or defer group E2EE, passkeys, and each advanced launch claim.
6. Publish the support and incident model.
7. Roll out the V2 shell by cohort with rollback.
8. Prepare launch assets and press demo around the frozen core journey.

Exit gates:

- All critical journeys pass on desktop and mobile browsers.
- No P0/P1 product defects.
- Zero known misleading security claims.
- Support, legal, moderation, and incident paths are staffed.
- The network has sustained active-room density.
- Explicit deployment and release authorization.

## 15. Launch-critical journeys

These outrank feature count:

1. Open homepage → understand product → join free.
2. Open invite → preview room → join as guest → send first message.
3. Claim guest identity without losing context.
4. Return after closing the tab → resume safely.
5. Catch up from Home.
6. Start and receive a DM with the correct privacy state.
7. Join, hold, and leave a room call.
8. Report/block/mute without learning server commands.
9. Export personal data.
10. Recover from disconnect, stale service worker, and partial network state.

Every phase names which of these journeys it changes and which regression suite
proves it.

## 16. Verification matrix

### Onyx app

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- focused Playwright critical journeys
- full Playwright suite at release candidate
- bundle-size report
- browser console/network audit
- real viewport screenshots

### Public site

- `node build.mjs --check`
- site unit tests
- generated-link and sitemap validation
- structured-data validation
- CSP/header preflight
- WCAG keyboard/screen-reader pass
- Core Web Vitals lab and field plan

### Server-facing claims

- contract check against the current Onyx Server client contract
- Debug and ReleaseSafe focused gates
- multi-node acceptance where the feature depends on mesh behavior
- live rollout evidence only after explicit deployment authorization

## 17. Success metrics

Use privacy-preserving aggregate measurement; no third-party behavioral
tracking is required.

| Stage | Metric |
|---|---|
| Website | Product comprehension and Join-free click-through |
| Onboarding | Successful guest connect and first message within 60 seconds |
| Activation | Invite recipient joins the intended room |
| Retention | Account D1/D7 return and active rooms |
| Community | Weekly rooms with at least five participating humans |
| Reliability | Connect success, reconnect success, message confirmation |
| Calls | Join success and five-minute hold |
| Privacy | Eligible DMs using verified E2EE; zero overclaim incidents |
| Support | Time to acknowledge P0/P1 reports |
| Self-host | Nodes that remain healthy for 30 days |

## 18. Council record

Participants:

- Codex/CLX: source inventory, live gates, market research, synthesis.
- Claude: adversarial product/design and source review.
- Grok: consumer market/category and launch pressure.

Consensus:

- Approve the strategy with amendments.
- Canonical root is `/home/kain/landing`.
- Product is `/home/kain/onyx` at `/app`.
- Retire the duplicate Solid landing narrative.
- Do not rewrite the client or engine.
- Fix verified defects before V2-shell work.
- Keep group-E2EE and passkey claims fail-closed.
- Make moderation, support, legal, and community density launch gates.

Resolved disagreement:

- A light-first total rebrand is not approved.
- The roadmap prototypes a brighter marketing direction and a refined dark
  direction while preserving one token family and the strong dark product
  identity.

## 19. Companion-draft reconciliation

`docs/PRODUCT_OVERHAUL_ROADMAP.md` was produced concurrently as a broader
product/platform draft. It is preserved as a useful companion, especially for
its OnyxOS native adapter contract, installable-product sequence, and **Proof
Rail** concept. This council roadmap is authoritative for public positioning,
canonical route ownership, and launch order.

The reconciled decisions are:

- Onyx remains a standalone web/PWA product. OnyxOS is its flagship future
  native home, not a launch dependency and not a primary chat-navigation item.
- `/home/kain/landing` owns `/`; `/home/kain/onyx` owns `/app`. “One source of
  truth” means one copy owner and deployment contract, not moving the public
  root back into the SPA.
- The living conversation ribbon is the marketing signature. The Proof Rail is
  the restrained in-product surface for delivery, connection, history source,
  and honest protection state.
- The Human Instrument palette and Luminous Current palette are inputs to the
  required bright-versus-refined-dark prototypes. Neither becomes production
  identity without contrast, performance, comprehension, and recognition
  evidence.
- A typed OnyxOS adapter for identity, vault, notifications, media, sharing,
  accessibility, and updates belongs after the cross-platform golden path.
  Every native capability requires explicit permission, data-lifetime,
  fallback, and disable contracts.

## 20. Immediate next implementation tranche

The first tranche is deliberately small and release-independent:

1. Patch loading versus unavailable.
2. Patch the Connect laptop clipping.
3. Repair the route-entrypoint expectation.
4. Write the canonical route/overlay contract.
5. Remove OnyxOS from primary chat navigation.
6. Create one public launch string table.
7. Prepare the transactional retirement plan for `Landing.tsx`.
8. Run app and landing gates.
9. Stop before deployment.

Only after this tranche is green should implementation begin on the new public
homepage or V2 application shell.
