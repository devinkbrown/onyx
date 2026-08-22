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
| Home proof order: invite → room preview → trust → community prose → extras | **DONE** | Landing section order + tests |
| Product pillars are Rooms / Messages / Calls / Continuity | **DONE** | Landing product board; Continuity = resume + local history + on-device import |
| Desktop installers available on Home | **PENDING** | Explicitly gated; Home says browser-first only until Phase 6 green |
| Browser SPA is the same product as desktop-hosted SPA | **DONE** | Single Vite `dist/`; no frontend fork |
| Client surface model is `browser \| pwa \| zig-desktop` | **DONE** | `src/lib/platform.ts` + unit tests |
| Native capability matrix exists and is non-optimistic | **DONE** | `capabilitiesForSurface` — all flags **false** for minimal host |
| Zig desktop scaffold (manifest + structural check) | **PARTIAL / structural DONE** | `app.zon` `native validate` + `native check` PASS; host sources present |
| Zig source compile of full Native SDK host (null backend) | **DONE** on Zig **0.17.0-dev** pin | `zig build -Dplatform=null` / `test` with pin `0.17.0-dev.1476+91a29d707`, patched `@native-sdk/cli@0.6.2`, isolated caches |
| Native GUI link / run (Linux WebKitGTK 6) | **DONE on current Linux host (Xvfb)** | Exact Zig pin + GTK4/WebKitGTK6 build/test pass; packaged binary resolves `resources/dist` from its executable, loads at `zero://app/`, renders the Solid landing route, and produces a nonblank native-window capture from an unrelated cwd |
| Downloadable installers | **PARTIAL** | Windows bundles the offline WebView2 installer; Linux/FreeBSD/OpenBSD include `install.sh`; packages remain unsigned |
| Code signing | **PENDING** | Not configured |
| Auto-updater | **PENDING** | Capability `updater: false`; no pipeline |
| Public desktop downloads | **PARTIAL** | `/download` six-lane surface (win/linux/macos-x86_64/macos-arm64/fbsd/obsd) + site-local `/downloads/v0.1.3/` staging; artifacts not committed; deploy stages only with explicit env; macOS via matching-arch Darwin/GHA matrix |
| Desktop deploy to production hosts | **PENDING** | Only web `deploy.sh` → `out/` for the SPA site |
| Dedicated Product / Communities / Organizations / Trust routes | **PENDING** | Contracted in `PUBLIC_COMPANY_SITE.md`; Home has pillars + audience entries only |
| Contact / legal pages | **PENDING** | Gated — no fake legal copy |
| Chromium/CEF parity | **NOT CLAIMED** | System WebView only |
| Zig 0.17-dev as host toolchain | **DONE (pinned)** | Official pin `0.17.0-dev.1476+91a29d707` + pnpm patch; Linux Xvfb runtime is green, while other platform runtimes/signing/updater/deploy remain separate |

---

## Phase 0 — Distinctive Onyx public site

**Goal:** A non-template Landing / About / Status surface that matches the Deep Current identity and sells the real product honestly — one product, no sector skins, Open Onyx primary.

| Item | Status |
|------|--------|
| Company-site contract (`PUBLIC_COMPANY_SITE.md`) | **DONE** |
| Landing route + hero / CTA / structure | **DONE** |
| Home pillars Rooms / Messages / Calls / Continuity | **DONE** (Continuity replaces premature desktop product card) |
| Audience proof paths on Home (incl. Gaming & Organizations) | **DONE** (entries only; dedicated routes gated) |
| Desktop-download CTAs claiming shippable installers | **PARTIAL** — Home may link `/download/` for unsigned native packages; no signed multi-platform ship claim |
| About / product explanation pages | **PARTIAL** — `/about/` exists; Product/Communities/Organizations/Trust pages gated |
| Contact / legal | **PENDING** — do not invent copy |

---

## Phase 1 — Friendly first run

**Goal:** A new user can open the site, understand Onyx, and connect without IRC jargon walls.

| Item | Status |
|------|--------|
| Browser connect path | **DONE** (existing `/app` + Connect) |
| First-run copy honesty about desktop availability | **DONE** on Landing — browser-first; desktop only after release gates |
| Connect first-run ritual | **DONE** — guest display name + Join; Sign in / Create account secondary; public words only (rooms, messages, display name, join); no mesh / node / claim-path |
| After-join first hour | **DONE** — room join focuses the composer with a say-hi hint; empty Home offers Browse rooms / Start a room / Invite friends; at most two dismissible tips; `onyx:first-hour-seen` hides them for returning users |
| After-create 3-in-48h | **DONE** — Home founder strip nags until 3 people have shown up; Reshare reuses the existing invite link + share sheet; joiner Home says hi when invite context exists |
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
| Zig host scaffold (`app.zon`, `desktop/*`, `build.zig`) | **PARTIAL cross-platform / Linux runtime green** — structural + null + Linux compile/test/package and connected Xvfb runtime green on Zig 0.17 pin |
| `native validate` / `native check` | **DONE** (structural gates) |
| Zig compile of SDK host sources (`-Dplatform=null`) | **DONE** on Zig **0.17.0-dev** pin + patched SDK 0.6.2 |
| Native GUI link + run | **DONE for Linux Xvfb gate** (real GTK4/WebKitGTK6; packaged SPA rendered from unrelated cwd); Windows/macOS/BSD runtime gates remain separate |
| Package output version/target defaults | **DONE** in graph: version from `app.zon` (0.1.3), target from selected platform; `null` not packageable |
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

**Goal:** Ship signed desktop artifacts with an updater and public download path. **Signing / updater / multi-platform green is still pending.** FreeBSD/OpenBSD have a narrower verified lane (unsigned tarball + install.sh + optional site staging).

| Gate | Status |
|------|--------|
| `zig build package` produces host-local artifact | **DONE on current Linux host / PARTIAL cross-platform** — Linux package + release archive verified; Windows/macOS lanes remain separate; BSD uses `bsd-host` package stage |
| Package target default = selected platform (not hardcoded macOS) | **DONE** (build graph) |
| Package version = `app.zon` / 0.1.3 (not stale 0.1.0) | **DONE** (build graph) |
| Linux/FreeBSD/OpenBSD one-install `install.sh` in release tarball | **DONE** (packaging tool + unit tests; BSD GUI not claimed on Linux host) |
| Code signing (macOS / Windows / Linux policies) | **PENDING** |
| Auto-updater channel | **PENDING** |
| Public download pages + checksums | **PARTIAL** — `/download` + `/downloads/v0.1.3/` staging; fail-closed publish mode |
| Production desktop deploy | **PENDING** (web deploy may stage public lanes via `ONYX_STAGE_RELEASE_DOWNLOADS=1`) |
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
| Download page (browser/PWA now; six unsigned native lanes) | **PARTIAL** — `/download/` ships win/linux/macos Intel+Apple Silicon/fbsd/obsd truthful surface; signed multi-platform still pending |
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
- Linux native compile/test/package green with GTK4/WebKitGTK6, plus a connected
  Xvfb smoke of the packaged binary from an unrelated cwd. The trace opened
  packaged `resources/dist` assets, the custom-scheme root stayed `/`, and the
  Solid landing route rendered into a nonblank Onyx window.
- Connected **product-frame navigation foundation** (shell-local only): Home / Rooms / Messages / Calls / You; Calls opens `CallsHub` and never auto-joins.

**Explicitly not done (do not claim):**

- Full commercial shell redesign (Home surface, conversation chrome, composer, profile/settings presentation).
- Physical interactive Linux desktop acceptance beyond the headless Xvfb gate,
  plus real Windows/macOS and FreeBSD/OpenBSD GUI acceptance.
- Signed installers, notarization, auto-updater, multi-platform public download ship.
- Verified FreeBSD/OpenBSD GUI launch on real BSD hardware (cross-build proves ELF/layout only).
- Dedicated Product/Communities/Organizations/Trust/legal routes.
- Production publish of BSD tarballs into live `out/` (opt-in staging only; human gate).

---

## Working order (next actions)

1. Keep Landing/tests aligned with `PUBLIC_COMPANY_SITE.md` when copy changes.
2. Continue commercial total UI redesign **after** nav/calls foundation: Home surface → conversation → composer → profile/You settings (still without touching protocol/store/media/E2EE kernel).
3. Keep the Linux packaged-runtime regression green: executable-relative
   `resources/dist`, `zero://app/` router entry, and connected Xvfb render from
   an unrelated cwd; add a physical interactive-session check when available.
4. Run the remaining real-platform gates (Windows GUI, macOS Intel/Apple
   Silicon package + GUI, FreeBSD/OpenBSD GUI) without treating Linux
   cross-builds as runtime proof.
5. Keep `/download/` claim level exact: unsigned Windows zip + Linux/FreeBSD/OpenBSD tar.gz + macOS Intel and Apple Silicon DMGs (matching-arch Darwin-built only, never fabricated on Linux); stage with `pnpm desktop:stage-release-downloads:publish` when publishing (requires all six lanes).
6. Design signing + updater for multi-platform only with evidence; never claim virus-free/codesign for unsigned packages.
7. Add remaining company-site routes only with real content (Phase 7) — never empty legal.
