# Onyx public company site — contract

**Status:** living contract for public marketing truth.
**Companion claim ledger:** [`PUBLIC_LAUNCH_ROADMAP.md`](./PUBLIC_LAUNCH_ROADMAP.md).
**Homepage implementation:** `src/routes/Landing.tsx` (+ `landing.css`, `Landing.test.tsx`).

This document freezes the **accepted Grok/Codex positioning decisions** so Landing,
future Product/Communities/Organizations/Trust/Technology pages, and release copy
cannot drift into sector skins, premature downloads, or comparison theatre.

---

## Product identity

| Rule | Contract |
|------|----------|
| One product | **Onyx** — one public communication service, one SolidJS client, one Deep Current visual system |
| Engine name | **Onyx Server** — daemon/engine under the glass; not a separate consumer brand |
| No sector skins | Do **not** ship gaming-theme, enterprise-theme, or “creator edition” alternate UIs or landing skins |
| Same client for all | Browser SPA is the product; PWA and future Zig desktop host the **same** SPA when ready |
| Primary CTA | **Open Onyx** → `/app/` — always the primary action on Home |

Deep Current tokens, atmosphere, and voice stay continuous with the connected client.
Audience pages prove fit with **ordered capability evidence**, not rebranded shells.

---

## Durable site IA

Target public information architecture (routes may land over time; **gated** means
not shipped until real content and gates exist):

| Surface | Role | Ship status for this pass |
|---------|------|---------------------------|
| **Home** `/` | Proof funnel + Open Onyx | **Ships** (Landing) |
| **Product** | Rooms / Messages / Calls / Continuity depth | **PARTIAL** — Home pillars only; dedicated route gated |
| **Communities** | Community proof path | **Gated** — no dedicated route yet |
| **Organizations** | Org / team proof path (not “enterprise SSO pack”) | **Gated** — audience entry on Home only |
| **Trust** | Protection honesty, public status, ownership | **PARTIAL** — Home proof strip + `/status/`; full Trust page gated |
| **Technology / Onyx Server** | Protocol, engine, self-host posture | **PARTIAL** — Home technical proof + `/about/`, `/roadmap/` |
| **Download** | Browser now; desktop installers only when green | **Gated** — no download page; no installer CTAs |
| **Status** `/status/` | Live public mesh/status honesty | **Ships** (existing) |
| **About / contact / legal** | Short about; contact; privacy/terms | **PARTIAL** — `/about/` exists; contact/legal copy **gated** (no fake legal) |

Do **not** invent `/download`, `/enterprise`, `/gaming`, pricing, compliance badges,
partner logos, or legal pages in marketing copy until those surfaces exist with
evidence.

Existing supporting routes that remain valid links: `/stats/`, `/roadmap/`,
`/invite/`, `/app/`.

---

## Audience proof paths (same client)

Every audience uses the **same** product. Paths differ only in **which proofs lead**.

| Audience | Lead with | Do not claim |
|----------|-----------|--------------|
| **General public** | Open in browser, rooms + DMs, simple first open | Installer, account walls, IRC jargon as the door |
| **Gaming and creators** | Persistent rooms, live calls, voice/video/screen stages, visible connection/protection | Discord-killer headlines, fake game integrations, “replace X” |
| **Communities** | Rooms that stay open, presence, invites, stages | Moderation suite / policy admin product that is not shipped |
| **Organizations** | Same rooms + DMs + calls + continuity; ownership/honest state | SSO, SCIM, admin policy console, SLA, SOC2 until true |
| **Developers** | Open wire (IRCv3/IRCX over WS), Onyx Server engine, honest media state | Fake SDKs, invented APIs, “enterprise API platform” |
| **Press / procurement** | Status telemetry, roadmap claim ledger, visible protection language, no invented compliance | Fake logos, benchmarks, pricing tables, unsigned installers |
| **Power users** | Continuity (session resume, local history, on-device import/export), identity you carry, fail-honest state | Overstated E2EE / group crypto beyond what UI shows |

---

## Home proof order (required)

Home sections must teach in this order of **argument**, even if visual layout
adjusts for rhythm:

1. **Immediate browser entry** — Open Onyx primary; no install required to begin.
2. **Real product pillars** — Rooms, Messages, Calls, Continuity (only claims grounded in client behavior).
3. **Live telemetry** — public stats/status feeds; fail-honest when stale/incomplete.
4. **Audience paths** — general + gaming/creators + communities + organizations + power users (+ developers / press pointers without fake pages).
5. **Trust / Technology evidence** — protection shown-not-assumed; Onyx Server / open wire / local-first memory.

### Product pillars (Home language)

| Pillar | Public language | Grounding (conservative) |
|--------|-----------------|---------------------------|
| **Rooms** | Text rooms that stay open | Channels, presence, topics |
| **Messages** | Direct messages | Same account, side conversations |
| **Calls** | Voice, video, screen for hangouts and stages | Cadence media; join is explicit; protection state visible |
| **Continuity** | Session resume, local history, on-device import/export | `SESSION RESUME`, device vault, vault import/export — **not** cloud landlord history |

Supporting proof (not a fifth pillar competing with Continuity): portable identity,
visible protection state. **Desktop installers are not a product pillar** until
Phase 6 packaging gates are green.

### Gaming proof order (when Gaming is the lens)

1. Persistent rooms
2. Live calls
3. Voice / video
4. Screen share / stage
5. Visible connection and protection receipts
6. Continuity back into the same rooms

No competitor-replacement framing.

### Organizations proof order (when Organizations is the lens)

1. Same client as public (no special “enterprise skin”)
2. Rooms + messages + calls for working groups
3. Continuity (resume + local history)
4. Honest protection / status language
5. Technology / Onyx Server for technical evaluators

Procurement materials and legal pages remain **gated**.

---

## Download and desktop claims

| Claim | Allowed? |
|-------|----------|
| Open full product in the browser today | **Yes** |
| Install-free first run | **Yes** |
| Downloadable / signed desktop installers available now | **No** until installers, signing, updater, checksums, and release gates are green (see roadmap Phase 6) |
| “Desktop ships with the launch” as an unconditional promise | **No** — phrase only as gated future when ledger is green |
| Desktop host scaffold / null compile exists | **Internal / roadmap only** — not Home download CTA |

Home may say: **Browser now.** Desktop downloads open only after release gates
are green. Prefer silence over aspirational download buttons.

---

## Forbidden claim classes (public site)

- Discord-killer / “better than X” comparison headlines
- Fake integrations (game overlays, Slack bridges, etc.) unless implemented and linked
- Fake compliance (SOC2, ISO, HIPAA badges) without evidence
- Fake pricing, logos, partner walls
- Fake legal/privacy/terms pages or lorem legal
- Premature native capability claims (`updater`, system notifications bridge, etc.) while matrix flags are false
- Group E2EE / passkey as default marketing if not the honest default surface
- Invented online counts when telemetry is loading/stale

---

## Brand voice

- Warm, concrete, living-room / studio — not crypto-bro, not enterprise-sales
- Prefer receipts over adjectives
- Protocol codenames below the technical fold
- English subsystem names in technical strips (Cadence, Onyx Server); no retired product codenames in new UI

---

## Acceptance gates for site changes

Before flipping any public claim on Home or future marketing routes:

1. Evidence exists in client or daemon **or** claim is explicitly labeled future/gated.
2. Tests assert the positive claim **and** absence of forbidden premature claims.
3. `PUBLIC_LAUNCH_ROADMAP.md` claim ledger updated if the claim is launch-critical.
4. No new route without real content (no empty shells for legal/download/enterprise).

**This pass (homepage truth repair):** contract document + Landing pillars/audiences/desktop honesty + tests + roadmap alignment. No new routes. No stage/commit/push/deploy implied by this file alone.
