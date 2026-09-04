# Game Changers 50 — client view

**Status:** architecture proposal, uncommitted. **Docs only.**
**Master catalog:** `/home/kain/onyx-server/docs/features/GAME-CHANGERS-50.md`
**Author:** stack-architect · **Date:** 2026-09-01

This is the **onyx client view** of one unified 50-feature catalog spanning both halves of the
product. The catalog is **50 total, not 50 per repo**: **15 `Both`** (full-stack, wire + UI),
**20 `Server`** (daemon-only), **15 `Client`** (SPA-only).

The master catalog also carries a **declared-overlap table against the server repo's existing
`INVENTED-FEATURES-CATALOG.md` (F-01…F-68)** — several entries here are the *implementation plan*
for an existing F-item rather than a new idea, and **seven** original premises were falsified and
corrected — four of them by an adversarial refute pass that caught four features proposed as new
which were already fully built. Read that section before treating any entry as novel.

The **master copy is single-source-of-truth** and lives in the server repo — the full per-feature
detail (why game-changing, novelty, implementation home, owning agent, complexity, target release,
dependencies, wire notes) is there for all 50. This file keeps the client-relevant slice inline so a
client contributor doesn't need the other repo open, and deliberately **does not duplicate** the
Server-only entries, which would only drift.

---

## What this means for the client

Two findings shaped the client half of the catalog.

**1. The client is already mature, so "new feature" mostly means "new surface."**
Verified at HEAD: a real service worker and PWA layer (`src/pwa/serviceWorkerRuntime.ts`,
`src/pwa/readiness.ts`), message *and* member windowing (`src/shell/MessageView.tsx`,
`src/shell/memberWindow.ts`), a serious E2EE group stack (25 non-test source modules under `src/lib/e2ee/`), hybrid
lexical+semantic vault search (`src/lib/vault/searchVaultHybrid.ts`, `searchVaultSemantic.ts`,
`embeddingIndex.ts`), a WASM media codec in a worker (`src/lib/cadence-media/OpcodecWasm.ts`), and
ethics infrastructure that predates its own UI (`src/lib/intelligence/provenance.ts`).

So most client entries below are **exposure work**: capability the client already owns but does not
yet show the user. That is why so many land at **M** rather than XL.

**2. Two structural exceptions dominate everything else.**
`src/lib/store/store.ts` is **18,225 lines at HEAD** — the client's velocity ceiling (**GC-01**). And
`src/lib/extensions/` ships `manifest.ts` + `clientActions.ts` with **no isolation host at all**
(**GC-02**) — verified: no sandbox or iframe usage anywhere under `src/lib/extensions/`. Extensions
without a sandbox are same-origin code with full store and DOM reach, so the sandbox has to land
*before* the ecosystem.

---

## Top 10 must-ship for 0.7 (whole product)

Client-relevant rows are bolded.

| # | ID | Feature | Scope |
|---|----|---------|-------|
> **Revised after a refute pass.** The original list ranked Live Captions #2 and the Transparency
> Ledger #5. Both were substantially already built — `src/shell/voice/overlays/CaptionsOverlay.tsx`
> (268 lines, with passing `role="log"` tests) ships the captions surface, and the server's
> `key_transparency.zig` already runs an MMR with client-verifiable inclusion proofs exposed as
> `KEYTRANS`. They are replaced below.

| # | ID | Feature | Scope |
|---|----|---------|-------|
| 1 | GS-01 | server.zig Strangler (102,026 lines → modules) | Server |
| 2 | **GB-06** | **Raid Shield** — mesh-coordinated raid clamp + honest client banner | **Both** |
| 3 | **GC-01** | **store.ts Strangler** (18,225 lines → domain facades) | **Client** |
| 4 | GS-03 | Class-based Admission Fabric | Server |
| 5 | **GC-09** | **Vault Encryption at Rest** — the IndexedDB vault is plaintext on disk today | **Client** |
| 6 | GS-02 | Sketch Telemetry Plane | Server |
| 7 | **GB-14** | **Consent-Gated Unfurl Proxy** — client half already exists | **Both** |
| 8 | **GC-02** | **Extension Sandbox Host** — ship isolation before third-party code | **Client** |
| 9 | GS-11 | Link Supervision (circuit breakers on S2S) | Server |
| 10 | GS-18 | Mesh ACL Filters | Server |

**Five of the top ten need client work.** The client is still on the critical path for 0.7.

---

## The 15 `Client` entries (full detail)

| ID | Feature | Cx | Target | Owning agents |
|----|---------|----|--------|---------------|
| GC-01 | **store.ts Strangler** — 18,225-line store → domain facades, reactivity unchanged | XL | **0.7 P0** | onyx-store, solidjs-coder |
| GC-02 | **Extension Sandbox Host** — worker/iframe isolation + deny-by-default permissions | L | **0.7 P0** | onyx-render, solidjs-coder, onyx-crypto |
| GC-03 | **Vault Worker Offload** — embedding/index/search off the main thread | M | 0.7 P1 | onyx-vault, onyx-perf |
| GC-04 | **Composer Command Surface** — chainable, saveable, bindable macros | M | 0.7 P1 | onyx-cmdk, solidjs-coder |
| GC-05 | **Offline-First Outbox** — compose offline, reconcile with visible conflicts | L | 0.7 P1 | onyx-vault, solidjs-coder, onyx-store |
| GC-06 | **Render Budget Governor** — 60fps under raid load by deferring cosmetic work | M | 0.7 P1 | onyx-perf, solidjs-coder |
| GC-07 | **Formation Mode** — complete keyboard-modal navigation | M | 0.7 P1 | onyx-cmdk, onyx-a11y, solidjs-coder |
| GC-08 | **Accessibility Conformance** — WCAG 2.2 AA verified, not asserted | M | **0.7 P0** | onyx-a11y, solidjs-coder |
| GC-09 | **Vault Encryption at Rest** — encrypt IndexedDB under a non-extractable device key, fail-closed | L | **0.7 P0** | onyx-vault, onyx-crypto, solidjs-coder |
| GC-10 | **Provenance-Labeled Translation** — on-device, honestly labeled | M | 0.7 P1 | solidjs-coder, onyx-render, onyx-a11y |
| GC-11 | **Trust Center** — who can read this, on which devices, verified how | M | 0.7 P1 | onyx-crypto, solidjs-coder, onyx-a11y |
| GC-12 | **Multi-Network Workspace** — several networks side by side, state isolated | L | post-0.7 | onyx-store, solidjs-coder, onyx-irc |
| GC-13 | **Catch-Up Digest v2** — one ranked briefing, not forty badges | M | 0.7 P1 | solidjs-coder, onyx-store |
| GC-14 | **Media Room UX** — spatial pad, active speaker, captions in place | M | 0.7 P1 | onyx-media, onyx-ui, onyx-a11y |
| GC-15 | **Portability Suite** — guided import/export wizard, verified round trip | M | 0.7 P1 | onyx-vault, solidjs-coder |

Per-entry rationale, implementation paths, dependencies, and guard rails: see the master catalog.

### Existing seams these build on (verified at HEAD)

| Entry | Already exists | Missing piece |
|---|---|---|
| GC-01 | `src/lib/store/store.ts` (18,225 lines at HEAD), `useStore` bridge | domain facades |
| GC-02 | `src/lib/extensions/manifest.ts`, `clientActions.ts` | **the sandbox host itself** |
| GC-03 | `src/lib/vault/embeddingIndex.ts`, `searchVaultHybrid.ts` | worker boundary |
| GC-04 | `src/lib/commands/`, `src/lib/composer/`, `src/lib/keyboard/` | macro layer |
| GC-05 | `src/lib/vault/outboxStatus.ts`, `outboxFlushDecision.ts`, `src/pwa/` | reconcile + conflict UI |
| GC-06 | `MessageView.tsx`, `memberWindow.ts` windowing | frame-budget scheduler |
| GC-07 | `src/lib/formation/formationLoop.ts`, `formationMemory.ts` | complete modal system |
| GC-08 | `src/lib/a11y/`, `src/shell/AccessibilityStatement.tsx` | conformance pass |
| GC-09 | `src/lib/vault/historyVault.ts`, `src/lib/vault/persistentStorage.ts`, bounded hydration at `historyVault.ts:495` | **at-rest AEAD + device-key custody** |
| GC-10 | `src/lib/intelligence/translateMessage.ts`, `provenance.ts`, `AiPolicyBadge.tsx` | the surface |
| GC-11 | 25 non-test source modules in `src/lib/e2ee/` (`groupTrustStore`, `keyPinning`, …) | one inspectable panel |
| GC-12 | `src/lib/identity/`, `src/lib/credentials.ts`, `src/lib/net/` | workspace partitioning |
| GC-13 | `src/lib/catchup/summary.ts`, `homeInbox.ts`, `CatchUpSummary.tsx` | ranking |
| GC-14 | `src/lib/cadence-media/spatialAudio.ts`, `activeSpeaker.ts` | the surface |
| GC-15 | `src/lib/import/`, `src/lib/export/`, `portableTransfer.ts` | wizard + verification |

---

## The 15 `Both` entries — the client's wire obligations

These are the full-stack differentiators. Every one has a client half, and every wire-affecting one
**deploys client-first**: the client must tolerate a server that does not yet speak the new CAP
*before* the server starts speaking it.

| ID | Feature | Client-side home | Cx | Target |
|----|---------|------------------|----|--------|
| GB-01 | **Loom** — CRDT documents/canvases inside a channel | new `src/lib/loom/`, `src/shell/Loom*.tsx` | XL | post-0.7 |
| GB-02 | **Ambient Rooms** — always-on near-zero-bitrate voice presence | `src/lib/cadence-media/MediaEngine.ts`, `voiceActivity.ts` | L | 0.7 P1 |
| GB-03 | **Moderation Leaves** — verifier UI for a moderation leaf on the *existing* `KEYTRANS` MMR | new `src/lib/ledger/` + GC-11 tab | M | 0.7 P1 |
| GB-04 | **Programmable Rooms** — sandboxed WASM room apps | new `src/lib/roomapps/` | XL | post-0.7 |
| GB-05 | **Time-Travel Rooms** — scrub a room to any past moment | `src/shell/MessageView.tsx`, new `src/lib/timetravel/` | L | post-0.7 |
| GB-06 | **Raid Shield** — mesh-wide admission clamp + banner | `src/shell/`, `src/lib/moderation/` | L | **0.7 P0** |
| GB-07 | **Searchable Call Memory** — persist + index call transcripts (captions themselves already ship) | `src/lib/vault/`, `searchVaultHybrid.ts`, existing `voice/overlays/CaptionsOverlay.tsx` | L | 0.7 P1 |
| GB-08 | **Device Attestation** — signed, mesh-revocable device identity | `src/lib/e2ee/groupDeviceDirectory.ts`, `trustedGroupSignerStore.ts` | L | 0.7 P1 |
| GB-09 | **Rateless History Reconciliation** — transfer only the difference | `src/lib/vault/vaultSync.ts`, `historyVault.ts` | L | post-0.7 |
| GB-10 | **Mesh-Federated Search** — fan the *already-shipped* `SEARCH` verb across the mesh, fused with local | `src/lib/vault/searchVaultHybrid.ts`, `src/lib/search/rankingBoost.ts` | L | post-0.7 |
| GB-11 | **Adaptive Transport** — negotiate wss/WebTransport/native, switch live | `src/lib/net/` | L | 0.7 P1 |
| GB-12 | **Continuity** — hand a session (scroll, draft, live call) to another device | `src/lib/vault/vaultResumeMemory.ts`, `src/lib/catchup/resumePoints.ts` | M | 0.7 P1 |
| GB-13 | **Mesh Presence Heatmap** — real activity, no member-list disclosure | `src/lib/stats/networkIndex.ts`, `src/shell/ChannelBrowser.tsx` | M | 0.7 P1 |
| GB-14 | **Consent-Gated Unfurl Proxy** — server fetches, under consent | `src/lib/preview/unfurlPrivacy.ts`, `linkPreview.ts` | M | **0.7 P0** |
| GB-15 | **Deterministic Replay Bug Reports** — a report the maintainer can replay | new `src/lib/diagnostics/traceCapture.ts` | L | post-0.7 |

## The 20 `Server` entries (index only)

Daemon-only value with no client surface. Listed so client contributors know what is coming and
what they may eventually consume; **full detail in the master catalog.**

GS-01 server.zig Strangler · GS-02 Sketch Telemetry Plane · GS-03 Class-based Admission Fabric ·
GS-04 Roaring Unread Index · GS-05 Scheduled Automation · GS-06 Rendezvous Channel Homing ·
GS-07 S2S Delta Compression · GS-08 Adaptive Media FEC · GS-09 ICE + PMTUD ·
GS-10 Media Epoch Keys · GS-11 Link Supervision · GS-12 WAL-backed Durable Store ·
GS-13 GCRA Rate Governor · GS-14 Sparse-Merkle Anti-Entropy · GS-15 Modern Congestion Control ·
GS-16 qlog Observability Export · GS-17 Durable Monotonic IDs · **GS-18 Mesh ACL Filters (top-10)** ·
GS-19 Lock-free Hot Maps · GS-20 Playout Discipline

Three of these are client-visible indirectly and worth tracking: **GS-17** (stable sortable message
IDs — the dedupe key GC-05's offline replay and GB-09's reconciliation both need), **GS-04**
(server-side unread bitmaps, which make GC-13's ranked digest cheap), and **GS-13** (rate limits that
report as standard-replies with retry hints, so the client can back off politely).

---

## Client guard rails these entries must not trip

Each of these is a failure class this codebase has already paid for. A client entry that touches the
relevant surface must state how it stays clear.

- **Reactivity contract (GC-01, GC-13, GC-03).** Reads via `useStore`; writes via immutable `set()`;
  `getState()` is a **non-reactive snapshot**, not a live read; **never destructure Solid props**.
  A facade that hands back a snapshot where a reactive read was expected produces silently stale UI
  with no error — the strangler's single biggest risk.
- **The message render path is the XSS sink (GC-02, GC-10, GC-13, GB-04, GB-07).** Parse → typed
  tokens → JSX text nodes. **Never** `innerHTML` / `dangerouslySetInnerHTML`. Extension output,
  room-app UI, captions, and translated text are all *new renderable content* and all route the
  typed-token path.
- **E2EE fails closed (GC-05, GC-11, GB-08, GB-12).** A failed seal is an **error**, never a silent
  plaintext downgrade. Unknown trust renders as **unknown**, never as "verified."
- **NAMES 353 append-vs-replace (GB-05, GB-13).** A late or overlapping `353 NAMREPLY` must
  **APPEND**; only a burst *we* initiated may REPLACE (`src/lib/irc/client.ts:1355-1357`,
  `no-implicit-names`). Replace-on-every-353 collapsed `#root` to 2 members in production.
- **PREFIX is learned from `005`, per connection (GC-12, GB-13).** The server advertises the exotic
  `PREFIX=(YQqov)*!.@+` (`src/lib/irc/parser.ts:290,293`). Hardcoded prefixes mangle nicks; a
  *global* prefix table breaks the moment GC-12 connects to two networks.
- **Live-region discipline (GC-08, GB-05, GB-07).** The message log is `aria-live`. Windowing,
  history replay, and time-travel must not re-announce the transcript.

## Client build order

1. **GC-01** first — it is the prerequisite for GB-01, GB-12, GC-04, GC-12, GC-13, and it does not
   get cheaper by waiting.
2. **0.7 P0:** GC-09 (at-rest encryption — it must precede anything that persists more sensitive
   content, i.e. GB-07 and GB-03), GC-02 (sandbox before ecosystem), GC-08 (a11y), then the client
   halves of GB-14 and GB-06.
3. **0.7 P1 surfaces:** GC-03, GC-06, GC-11, GC-13, GC-10, GC-14, GC-04, GC-07, GC-15, GC-05, plus
   the client half of GB-07.
4. **post-0.7:** GC-12 (blocked on GC-01), then the client halves of GB-01, GB-05, GB-09, GB-10, GB-15.

## Verdict for the client half

**GO** for GC-01, GC-02, GC-08, GC-09 and the client halves of GB-14 and GB-06 — no unresolved
CRITICAL, and each has a cited guard to copy.

**REVISE / blueprint-first** for GC-12 (cross-network state partitioning is a privacy-CRITICAL design,
not an implementation detail) and the client halves of GB-01, GB-04, GB-05, GB-09.

**Confidence:**

> **This section previously overstated its own rigor and is corrected.** A refute pass found the
> catalog had verified *substrate consumers* rigorously but never asked *"does this surface already
> exist?"* — so four features were proposed as new while already built.

- **RETRACTED** — the claim that "there is **no** caption surface for the daemon's existing
  `MEDIA CAPTION` frames." That was **false**. `src/shell/voice/overlays/CaptionsOverlay.tsx` (268
  lines) renders speaker-tagged captions with per-nick color, a `ProvenanceBadge`, and clipboard
  export; `src/lib/store/store.ts:10444-10473` parses both `MEDIA CAPTION` and `MEDIA TRANSCRIPT`;
  and `VoiceOverlays.test.tsx` already asserts the `role="log"` live region *including* the
  live-region-scoping case GC-08 listed as outstanding. GB-07 was rewritten accordingly.
- **RETRACTED** — the implicit claim that a Theme Studio needed building. `src/theme/ThemeStudio.tsx`
  **already exists at 2,854 lines** (generative palette factory, live preview, JSON import/export,
  eyedropper, AA-clean-by-construction), and sharing ships via `src/shell/ThemeImportDialog.tsx` +
  `src/lib/theme/themeShare.ts`. The old GC-09 also misdirected its home to `src/lib/theme/` and
  `src/lib/color/`; the theme system lives at **`src/theme/`**. GC-09 was replaced.
- **CONFIRMED** — `src/lib/extensions/` has **no** isolation host: 4 files with zero `iframe`,
  `sandbox`, `new Worker`, or `postMessage` hits. GC-02's premise survives verification.
- **CONFIRMED** — the vault has **no at-rest encryption**: `src/lib/vault/historyVault.ts` writes
  rows straight to IndexedDB, and its `encrypted` fields (`:424`, `:533-534`) are wire-level E2EE
  markers, not storage encryption. This is GC-09's premise.
- **CONFIRMED** — the NAMES and PREFIX guard-rail citations below, re-verified against
  `git show HEAD:` (not just the working tree).
- **CORRECTED** — line counts. All three monolith figures were wrong; they now cite HEAD, with the
  caveat that these files carry uncommitted changes and the roadmaps quote different numbers.
- **PLAUSIBLE** — complexity ratings and release targets. Architectural judgment, not measurement.
  GC-01 and GC-12 in particular need their own blueprints before a coder starts.
- **NOT CHECKED** — current test-suite and bundle-budget headroom for these additions, and whether
  `docs/ui-performance-baseline.json` is still current enough to be GC-06's baseline.

---

*Master catalog (all 50 with full per-feature detail):
`/home/kain/onyx-server/docs/features/GAME-CHANGERS-50.md`*
