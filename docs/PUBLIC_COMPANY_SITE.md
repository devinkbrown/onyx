# Onyx public company site — contract

**Status:** living contract for public marketing truth.
**Companion claim ledger:** [`PUBLIC_LAUNCH_ROADMAP.md`](./PUBLIC_LAUNCH_ROADMAP.md).
**Homepage implementation:** `src/routes/Landing.tsx` (+ shared `landing.css`, Home-only `home.css`, `Landing.test.tsx`).

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
| **Download** `/download/` | Browser/PWA first; unsigned Win/Linux/FreeBSD/OpenBSD; macOS planned | **PARTIAL** — four operator zip/tar.gz packages + checksums; not signed; macOS coming soon |
| **Status** `/status/` | Live public mesh/status honesty | **Ships** (existing) |
| **About / contact / legal** | Short about; contact; privacy/terms | **PARTIAL** — `/about/` exists; contact/legal copy **gated** (no fake legal) |

Do **not** invent `/enterprise`, `/gaming`, pricing, compliance badges,
partner logos, or legal pages in marketing copy until those surfaces exist with
evidence. `/download/` may only claim the currently published unsigned lanes
(Windows zip with offline WebView2 installer, plus Linux/FreeBSD/OpenBSD
`install.sh` hosts). Separate
macOS Intel and Apple Silicon packages may be described as coming soon, but the
site must not expose DMG download controls until genuine Darwin-built artifacts
are staged, and must never fabricate a macOS artifact on Linux.

Existing supporting routes that remain valid links: `/stats/`, `/roadmap/`,
`/invite/`, `/app/`, `/download/`.

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
| **Press / procurement** | Status telemetry, roadmap claim ledger, visible protection language, no invented compliance | Fake logos, benchmarks, pricing tables, signed-installer claims without evidence |
| **Power users** | Continuity (session resume, local history, on-device import/export), identity you carry, fail-honest state | Overstated E2EE / group crypto beyond what UI shows |

---

## Home proof order (required)

Home is a **quiet threshold**, not an infomercial. Sections on `/` teach in this
order of **argument** (layout may tighten for rhythm, but not reorder the story):

1. **Immediate browser entry** — one primary **Open Onyx** → `/app/`; optional
   platform-neutral secondary text link to `/download/`. Exact platform
   availability, signing state, and package requirements belong on Download.
2. **Live-room aperture** — one honest **static** product preview, labeled
   preview / not live content (not a laptop mockup; not live nicknames or metrics).
3. **Compact live telemetry** — one strip from public stats/status feeds;
   fail-honest when loading, stale, incomplete, or time-skewed (no invented counts).
4. **One plain-language capability passage** — rooms, messages, calls/voice-video,
   continuity (resume + local history), protection shown-not-assumed — **prose only**,
   not a multi-card feature board.
5. **Operator / power-user link shelf** — text links to Status, Stats, Roadmap,
   About, Download, Invite (and existing footer). No second primary CTA.

**Removed from Home (do not reintroduce):** audience taxonomy grids, six-card
product boards, numbered how-to steps, faux terminals, protocol essays
(IRCv3 / IRCX / WebSocket marketing on body copy), repeated Open Onyx loops,
gold/Anton display shout, multi-primary hero CTAs.

Audience paths, pillar depth, and Trust/Technology essays remain valid **product
truth** for secondary routes and future gated pages — they are **not** required
sections on `/`.

### Product pillars (language allowed on Home as prose)

| Pillar | Public language | Grounding (conservative) |
|--------|-----------------|---------------------------|
| **Rooms** | Text rooms that stay open | Channels, presence, topics |
| **Messages** | Direct messages | Same account, side conversations |
| **Calls** | Voice, video, screen when you need them | Cadence media; join is explicit; protection state visible |
| **Continuity** | Session resume, local history on device | `SESSION RESUME`, device vault, vault import/export — **not** cloud landlord history |

Supporting proof (may appear as one ordinary sentence, not a fifth pillar card):
visible protection state. **Desktop installers are not a product pillar** until
Phase 6 packaging gates are green.

### Gaming proof order (secondary surfaces / when Gaming is the lens)

1. Persistent rooms
2. Live calls
3. Voice / video
4. Screen share / stage
5. Visible connection and protection receipts
6. Continuity back into the same rooms

No competitor-replacement framing. Not a Home section inventory.

### Organizations proof order (secondary surfaces / when Organizations is the lens)

1. Same client as public (no special “enterprise skin”)
2. Rooms + messages + calls for working groups
3. Continuity (resume + local history)
4. Honest protection / status language
5. Technology / Onyx Server for technical evaluators

Procurement materials and legal pages remain **gated**. Not a Home section inventory.

---

## Download and desktop claims

| Claim | Allowed? |
|-------|----------|
| Open full product in the browser today | **Yes** |
| Install-free first run | **Yes** |
| Downloadable / signed multi-platform installers available now | **No** — signing/updater/notarization still pending (see roadmap Phase 6) |
| Windows/Linux/macOS/FreeBSD/OpenBSD unsigned packages + checksums | **Yes** on `/download/` (Windows offline runtime included; install.sh on Linux/BSD; macOS still planned); Home stays platform-neutral |
| macOS DMGs (unsigned/unnotarized Intel + Apple Silicon) | **Yes** when both Darwin-built artifacts are staged; never fabricated on Linux; signing/notarization pending |
| Signed desktop installers / auto-updater | **No** — signing/updater pending |
| “Desktop ships with the launch” as an unconditional promise | **No** — phrase only as gated future when ledger is green |
| Desktop host scaffold / null compile exists | **Internal / roadmap only** for multi-platform ship claims |

Home may say: **Browser now across desktop and mobile**, with a neutral link to
`/download/`. Exact native platform support stays on Download. Prefer silence
over aspirational signed multi-platform CTAs.

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

**This pass (quiet-threshold Home):** contract Home proof order + Landing section
inventory (hero, aperture, telemetry strip, capability prose, operator shelf) +
`home.css` mineral-night scope + tests. Shared `landing.css` remains for About /
Download / footer primitives. No new routes. No stage/commit/push/deploy implied
by this file alone.
