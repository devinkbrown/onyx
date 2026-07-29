# Onyx public-launch roadmap (executable)

This is the **total-overhaul** plan for a public Onyx 1.0 surface: one SolidJS
client, honest claims, and gated distribution. Status below is evidence-based —
do not mark distribution green without a green gate.

Companions:

- [`PUBLIC_COMPANY_SITE.md`](./PUBLIC_COMPANY_SITE.md) — company-site contract
  (IA, audiences, Home proof order, forbidden claims)
- [`desktop-host.md`](./desktop-host.md) — Zig + Native SDK host

## Status legend

| Mark | Meaning |
|------|---------|
| **DONE** | Verified in tree with passing gates cited in that phase |
| **PARTIAL** | Structure or docs exist; runtime/link/deploy not green |
| **PENDING** | Not started or blocked; no ship claim |

## Claim ledger (truth table)

| Claim | Status | Evidence |
|-------|--------|----------|
| Public Landing route ships as the marketing entry | **DONE** | `src/routes/Landing.tsx` + tests; web build |
| Company-site contract (one Deep Current product, audience paths, gated IA) | **DONE** | `docs/PUBLIC_COMPANY_SITE.md` |
| Home proof order: browser → pillars → live → audiences → trust/tech | **DONE** | Landing section order + tests |
| Product pillars are Rooms / Messages / Calls / Continuity | **DONE** | Landing product board; Continuity = resume + local history + on-device import |
| Desktop installers available on Home | **PENDING** | Explicitly gated; Home says browser-first only until Phase 6 green |
| Browser SPA is the same product as desktop-hosted SPA | **DONE** | Single Vite `dist/`; no frontend fork |
| Client surface model is `browser \| pwa \| zig-desktop` | **DONE** | `src/lib/platform.ts` + unit tests |
| Native capability matrix exists and is non-optimistic | **DONE** | `capabilitiesForSurface` — all flags **false** for minimal host |
| Zig desktop scaffold (manifest + structural check) | **PARTIAL / structural DONE** | `app.zon` `native validate` + `native check` PASS; host sources present |
| Zig source compile of full Native SDK host (null backend) | **DONE** on Zig **0.17.0-dev** pin | `zig build -Dplatform=null` / `test` with pin `0.17.0-dev.1476+91a29d707`, patched `@native-sdk/cli@0.6.2`, isolated caches |
| Native GUI link / run (Linux WebKitGTK 6) | **PENDING** | Missing `webkitgtk-6.0`; link fails after successful compile |
| Downloadable installers | **PENDING** | No package artifacts shipped |
| Code signing | **PENDING** | Not configured |
| Auto-updater | **PENDING** | Capability `updater: false`; no pipeline |
| Public desktop downloads | **PENDING** | No CDN/release artifacts; no `/download` route |
| Desktop deploy to production hosts | **PENDING** | Only web `deploy.sh` → `out/` for the SPA site |
| Dedicated Product / Communities / Organizations / Trust routes | **PENDING** | Contracted in `PUBLIC_COMPANY_SITE.md`; Home has pillars + audience entries only |
| Contact / legal pages | **PENDING** | Gated — no fake legal copy |
| Chromium/CEF parity | **NOT CLAIMED** | System WebView only |
| Zig 0.17-dev as host toolchain | **DONE (pinned)** | Official pin `0.17.0-dev.1476+91a29d707` + pnpm patch; runtime/signing/installer/updater/deploy still unverified |

---

## Phase 0 — Distinctive Onyx public site

**Goal:** A non-template Landing / About / Status surface that matches the Deep Current identity and sells the real product honestly — one product, no sector skins, Open Onyx primary.

| Item | Status |
|------|--------|
| Company-site contract (`PUBLIC_COMPANY_SITE.md`) | **DONE** |
| Landing route + hero / CTA / structure | **DONE** |
| Home pillars Rooms / Messages / Calls / Continuity | **DONE** (Continuity replaces premature desktop product card) |
| Audience proof paths on Home (incl. Gaming & Organizations) | **DONE** (entries only; dedicated routes gated) |
| Desktop-download CTAs claiming shippable installers | **PENDING** (must stay off until packaging green) |
| About / product explanation pages | **PARTIAL** — `/about/` exists; Product/Communities/Organizations/Trust pages gated |
| Contact / legal | **PENDING** — do not invent copy |

---

## Phase 1 — Friendly first run

**Goal:** A new user can open the site, understand Onyx, and connect without IRC jargon walls.

| Item | Status |
|------|--------|
| Browser connect path | **DONE** (existing `/app` + Connect) |
| First-run copy honesty about desktop availability | **DONE** on Landing — browser-first; desktop only after release gates |
| Account / invite onboarding polish | **PENDING** (product kernel exists; public funnel TBD) |

---

## Phase 2 — Connected shell for the general public

**Goal:** Redesign the **connected** shell UX for a general audience **on top of** the existing, tested protocol / store / media / E2EE kernel. Do not rewrite the kernel.

| Item | Status |
|------|--------|
| Protocol, store, media, E2EE kernel | **DONE** (pre-existing; out of this scaffold slice) |
| Product-frame navigation foundation (Home / Rooms / Messages / Calls / You) | **PARTIAL** — local shell surface state + CallsHub discovery; does not join/start calls |
| Calls hub (truthful discovery, explicit Join still required) | **PARTIAL** — `CallsHub` wired in AppShell; live call still starts only via Join call |
| Rooms / Messages collection split in sidebar | **PARTIAL** — mode props + primary nav; not a full IA redesign |
| General-public shell redesign (Home / conversation / composer / profile polish) | **PENDING** — next commercial redesign surfaces after this foundation |
| Accessibility + performance bar for shell | **PENDING** (see Phase 5) |

---

## Phase 3 — One client: web / PWA / Zig desktop

**Goal:** Same SolidJS SPA on three surfaces with truthful detection and no capability lies.

| Item | Status |
|------|--------|
| `browser` surface | **DONE** |
| `pwa` detection (`display-mode: standalone` + iOS `navigator.standalone`) | **DONE** (runtime detect + tests) |
| `zig-desktop` detection (`window.zero` or `zero://app`) | **DONE** (runtime detect + tests) |
| Zig host scaffold (`app.zon`, `desktop/*`, `build.zig`) | **PARTIAL** — structural + null compile green on Zig 0.17 pin |
| `native validate` / `native check` | **DONE** (structural gates) |
| Zig compile of SDK host sources (`-Dplatform=null`) | **DONE** on Zig **0.17.0-dev** pin + patched SDK 0.6.2 |
| Native GUI link + run | **PENDING** (WebKitGTK 6 missing on Linux verify host) |
| Package output version/target defaults | **DONE** in graph: version from `app.zon` (0.1.1), target from selected platform; `null` not packageable |
| Toolchain pin | **DONE** — Zig **0.17.0-dev.1476+91a29d707** / Native SDK **0.6.2** via pnpm `patchedDependencies` |

---

## Phase 4 — Staged native capabilities

**Goal:** Grow the capability matrix only when implemented end-to-end.

Current matrix (`PlatformCapabilities`): `bridge`, `notifications`, `deepLinks`, `windowControls`, `updater`, `secureStorage` — **all false**.

| Capability | Status |
|------------|--------|
| bridge | **PENDING** |
| notifications | **PENDING** |
| deepLinks | **PENDING** |
| windowControls | **PENDING** |
| updater | **PENDING** |
| secureStorage | **PENDING** |

---

## Phase 5 — Accessibility and performance

**Goal:** WCAG-minded public surfaces and a performant connected shell (virtualization, motion prefs, Core Web Vitals).

| Item | Status |
|------|--------|
| Public site a11y pass | **PENDING** |
| Connected shell a11y / perf bar | **PENDING** |
| Prefer-reduced-motion / contrast on host WebView | **PENDING** |

---

## Phase 6 — Packaging, signing, updater, downloads, deploy, release

**Goal:** Ship signed desktop artifacts with an updater and public download path. **None of this is green today.** Do not add Home download CTAs or a public Download route until every row below is green with evidence.

| Gate | Status |
|------|--------|
| `zig build package` produces host-local artifact | **PENDING** (needs green GUI link first) |
| Package target default = selected platform (not hardcoded macOS) | **DONE** (build graph) |
| Package version = `app.zon` / 0.1.1 (not stale 0.1.0) | **DONE** (build graph) |
| Code signing (macOS / Windows / Linux policies) | **PENDING** |
| Auto-updater channel | **PENDING** |
| Public download pages + checksums | **PENDING** |
| Production desktop deploy | **PENDING** |
| Release checklist / human gate | **PENDING** |

---

## Phase 7 — Expanded company-site IA (post-contract)

**Goal:** Land dedicated surfaces from `PUBLIC_COMPANY_SITE.md` without inventing claims.

| Item | Status |
|------|--------|
| Product depth page (Rooms/Messages/Calls/Continuity) | **PENDING** |
| Communities proof page | **PENDING** |
| Organizations proof page (same client; no SSO theatre) | **PENDING** |
| Trust page (protection honesty + status + ownership) | **PENDING** |
| Technology / Onyx Server page | **PENDING** (About/roadmap partial today) |
| Download page (browser/PWA now; desktop only when Phase 6 green) | **PENDING** |
| Short contact + real legal | **PENDING** |

---

## Verified vs not (current tree)

**Verified / DONE enough to claim:**

- Landing as the public entry (web) with Open Onyx primary.
- Company-site contract + Home proof order + Continuity pillar (not desktop card).
- Audience entries including Gaming & creators and Organizations (no sector skins, no Discord-killer copy).
- Structural Zig desktop scaffold: `app.zon`, host sources, `build.zig` package path defaults, platform surface + capability matrix tests.
- `native validate`, `native check`, web `pnpm typecheck` / platform unit tests when run green.
- Zig **0.17.0-dev** pin null-backend compile + test green (`-Dplatform=null`) with checked-in SDK patch.
- Connected **product-frame navigation foundation** (shell-local only): Home / Rooms / Messages / Calls / You; Calls opens `CallsHub` and never auto-joins.

**Explicitly not done (do not claim):**

- Full commercial shell redesign (Home surface, conversation chrome, composer, profile/settings presentation).
- Native GUI link/run (Linux needs `webkitgtk-6.0`).
- Installers, signing, updater, public downloads, desktop deployment.
- Dedicated Product/Communities/Organizations/Trust/Download/legal routes.
- Installer/signing/updater/public desktop deploy (still out of scope until packaging green).

---

## Working order (next actions)

1. Keep Landing/tests aligned with `PUBLIC_COMPANY_SITE.md` when copy changes.
2. Continue commercial total UI redesign **after** nav/calls foundation: Home surface → conversation → composer → profile/You settings (still without touching protocol/store/media/E2EE kernel).
3. Install WebKitGTK 6 for Linux GUI link; re-run `zig build -Dplatform=linux` with the Zig 0.17 pin until green.
4. Prove `zig build package` on a packageable platform with versioned output under `zig-out/package/onyx-0.1.1-…`.
5. Only then design signing + updater + download pages; flip claim ledger rows with evidence.
6. Add gated company-site routes only with real content (Phase 7) — never empty legal or fake download.
