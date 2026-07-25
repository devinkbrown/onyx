# Onyx Roadmap — what sets this apart, and what to build next

*Started 2026-07-02 · **status refresh 2026-07-21** · covers **Onyx Server**
(daemon), **Onyx** (SolidJS client), the community site (landing), and stats.
Brand: **Onyx** = network/product/client; **Onyx Server** = pure-Zig engine.
"IRCXNet" is retired public identity only.*

> **Product-complete north-star (eras, exit criteria, fleet scale):**  
> [`/home/kain/ONYX_PRODUCT_COMPLETE_ROADMAP.md`](/home/kain/ONYX_PRODUCT_COMPLETE_ROADMAP.md)  
> Design research synthesis: [`/home/kain/research/ONYX_PLATFORM_DESIGN_SYNTHESIS.md`](/home/kain/research/ONYX_PLATFORM_DESIGN_SYNTHESIS.md)  
> Token-preserving Claude + Codex ops: [`/home/kain/CLAUDE_CODEX_SCALED_WORKFLOW.md`](/home/kain/CLAUDE_CODEX_SCALED_WORKFLOW.md)  
> This file remains the detailed ✅ archaeology + competitive notes.

## Status at a glance (2026-07-21)

| Phase | Theme | Status |
|-------|--------|--------|
| **1** Memory (vault, time-travel, search) | Client | ✅ **COMPLETE** |
| **2** Reach (Web Push, offline outbox) | Client + server | ✅ **COMPLETE** (client offline memos are **MEMO-only**, no `TEGAMI`) |
| **3** Privacy (E2EE DMs, ephemeral rooms) | Client + server | ✅ **COMPLETE** |
| **4** Presence (pins, heatline, events) | Client + server | ✅ **COMPLETE** (Comic Chat in-Onyx **dropped**) |
| **5** Operations (status, stats, backup) | Server + website + client harden | ✅ **COMPLETE** (ops deploy paths remain operator work) |
| **6** Time-Native + Atmosphere (Home, reader, a11y) | Client | 🟡 **MOSTLY SHIPPED** — remaining: richer cross-room handoffs, finish remaining dense-surface a11y audit rows (dense nicklist AppShell e2e **closed**) |
| **7+** (later sections in this file) | Product entry, Atmosphere, Cadence media, etc. | 🟡 **Many slices shipped**; read per-item ✅ / ⏭️ below — do not treat headers alone as authoritative |
| **Onyx Server CSB / MESSAGE_V2 / Helix** | Daemon | ✅ **P0s closed 2026-07-17** (see `onyx-server/CLAUDE_CSB_TAKEOVER_ROADMAP.md`); deploy is human-gated |
| **Engine rename** | Daemon | ✅ **Source rebrand to Onyx Server 2026-07-19**; live `onyx-server.service` / `onyx-run` still production names until deploy |
| **Era 2 B2 / B8 (client)** | Media polish + sessions | ✅ **B2 R1–R6 closed**; ✅ **B8** list+`SESSION DROP` + recovery codes closed |

**Wiring audit notes (2026-07-21)** — evidence in
[`.ai/roadmap-source-ledger.md`](.ai/roadmap-source-ledger.md):

- **B2 R3/R5** — bandwidth-ladder soft toasts (`bandwidthLadderFeedback` →
  `VoiceBar`) and codec-failure toasts (`codecFailure` → `useCadenceMedia`
  `onError` / `onDecodeError`) are wired; not pure-module stubs.
- **B8** — Account **Sessions & devices** lists attachments and revokes via
  `SESSION DROP #<n>`; **Recovery codes** UI + Connect LOGIN path wire
  `RECOVERYCODES` STATUS/GENERATE/CLEAR/LOGIN (`recoveryCodes.ts`,
  `RecoveryCodesSection`, store fold).
- **Background consolidation** — all canvas presets on shared
  `composeSignature` pipeline (five signature families + scenes).
- **Dense nicklist e2e** — real AppShell 48-member roster journey
  (`tests/e2e/member-list-dense-reflow.spec.ts`).
- **Offline memos** — client accepts **`NOTE MEMO` only** (no `TEGAMI`
  dual-accept).

**Active client bugs fixed this refresh (2026-07-19)**

- **Join video opened Voice settings** (audio device sheet) instead of starting a
  video call — `AppShell.joinVoice` misused `openVoiceSettings()` as a loading
  affordance. Fixed: Join voice/video enter the call; settings only via the
  in-call gear.
- **`&` local channels** treated as DMs in reader-memory default and Home quiet-
  boost open/label paths (`startsWith('#')` only). Fixed: `#` and `&` are rooms.

**How to read this doc:** item-level `✅ SHIPPED` lines win over phase headers.
Phase 6 still says `← NEXT` in places; most sub-items under it already shipped —
use the ⏭️ **NEXT** bullets for remaining pure-Onyx work.

## The competitive read

**Against modern IRCds (Ergo, Solanum, InspIRCd, UnrealIRCd):** Ergo is the only
real peer — integrated services, always-on multiclient, aggressive IRCv3. Onyx Server
already exceeds it in four places no IRCd touches: in-protocol **voice/video**
(CadenceVox/Vis, 64-seat rooms), a **post-quantum CRDT mesh** (Cadence/Mooring)
instead of legacy S2S, **hot upgrades with zero disconnects** (Helix), and
**live public telemetry** (chanstats). No IRCd ships a first-party web client,
a stats surface, and a community site as one coherent product. That coherence
IS the product.

**Against Matrix/Element:** Matrix wins on federation + E2EE, loses on weight,
sync latency, and self-host pain (Synapse). We will never out-federate Matrix;
we can out-*feel* it: instant everything, one binary, a client that loads in
under a second. Their E2EE is table stakes we currently lack for DMs — the
Mooring primitives (ECDH + AES-GCM, already shipping for media) close that gap
without inventing new crypto.

**Against Discord:** the UX bar — voice rooms, pins, push, search, "it
remembers everything." Discord's weaknesses are exactly our identity: no
self-hosting, surveillance economics, no protocol. Every Discord-parity feature
we add must ride an open primitive (IRCv3 draft, IRCX PROP) — that's the moat:
**"Discord comforts on 30-year-old open wire."**

**Against web-IRC (The Lounge, IRCCloud, gamja/soju):** all require a bouncer or
paid cloud for continuity. Onyx Server's session-sync already replaces the bouncer.
What none of them have: push when the tab is closed, local-first scrollback,
voice. Those three make Onyx categorically different, not incrementally better.

**Unique assets nobody can copy quickly:** the Comic Chat data plane (+ the
reverse-engineered renderer in /home/kain/comicchat), IRCX key ladders, the
stats↔chat↔site triangle on one identity, pure-Zig ownership of every layer
down to TLS.

## The thesis

> **The network that remembers, reaches you, and feels alive** — local-first
> memory in the client, server push that works with the tab closed, presence
> you can see before you join, and heritage features (Comic Chat, IRCX) nobody
> else can offer at all.

---

## Phase 1 — Memory (local-first client) ✅ COMPLETE 2026-07-02
1. **Local History Vault** *(client)* — IndexedDB persistence of channel/DM
   scrollback. Instant history on open (before the network answers), offline
   reading, cross-session continuity for guests. Preference-gated, pruned,
   defensive (feature-detect, never blocks the UI).
   ✅ **SHIPPED 2026-07-02** — `src/lib/vault/` (historyVault + vaultSync),
   `hydrateHistory` store action, "Local history" preferences toggle (off =
   erase), 14 unit tests, verified live via `tools/vault-live.mjs`.
2. **Time travel** *(client + stats)* — `CHATHISTORY AROUND` already exists
   server-side: add `/app?join=#c&at=<ts>` handling and make the stats daily
   charts + busiest-day records deep-link into the moment itself. Scrollback
   becomes navigable history.
   ✅ **SHIPPED 2026-07-02** — `parseAtParam` (epoch s/ms + ISO), store
   `travelTo` → AROUND fetch → time-sorted batch merge → `timeTravelLandingId`
   scroll+pulse; stats `travelUrl` on daily-chart dots + busiest-day record;
   verified live via `tools/travel-live.mjs`.
3. **Vault-backed global search** — extend the deep-search UI to query the
   vault across ALL targets locally, merged with server SEARCH per target.
   ✅ **SHIPPED 2026-07-02** — `searchVault` (all-targets IDB scan), an
   "Saved on this device" section in the search panel, `openVaultResult`
   (navigate/join/create-DM + landing scroll); also fixed the pre-existing
   click-dead results strips (pointer-events). Verified live via
   `tools/vault-search-live.mjs`.
   ✅ **SHIPPED 2026-07-19 (Era 1 A1)** — Hybrid device-memory search is the
   **default** UI mode (`searchVaultHybrid` + RRF_K=60 fuses exact-substring and
   on-device related-token rankings). Mode cycle is hybrid → exact → related
   terms; Preferences **History & data → Default search mode** seeds a fresh
   search (default **Text + related**). Search Center copy, provenance chips
   (**This device** / **This server**), and `docs/search-and-history.md` all
   state the boundary honestly — no cloud AI, no "hybrid not yet wired" claim.
   Evidence: `src/lib/prefs/vaultSearchMode.ts`,
   `src/shell/search/useMessageSearch.ts`, `src/shell/search/MessageSearch.tsx`,
   `src/lib/vault/searchVaultHybrid.ts`; ledger
   `.ai/roadmap-source-ledger.md` (A1 closed).

## Phase 2 — Reach (the tab is closed and it still works) ✅ COMPLETE 2026-07-02
4. **Web Push** *(server + client)* — IRCv3 `draft/webpush`-shaped: VAPID
   (ES256), per-account push subscriptions in the account store, RFC 8291
   aes128gcm payloads, sent for mentions/DMs when no session is attached. The
   SW already handles `push` events — the server half is the work. Zig has the
   P-256/HKDF/AES-GCM pieces in-tree.
   ✅ **SHIPPED 2026-07-02** — crypto/webpush.zig (RFC 8291 KAT-pinned +
   ES256 VAPID) + daemon worker (in-house HTTPS transport), WEBPUSH
   SUBSCRIBE/UNSUBSCRIBE/LIST, offline-memo trigger, ISUPPORT `VAPID=` discovery
   (no NOTE data channel — lifecycle on the Event Spine), client toggle +
   SW payload mapping. Live on both nodes (node-local subscriptions;
   cross-mesh propagation is future work).
   ✅ **CLIENT WIRE HONESTY 2026-07-21** — Offline memo delivery is **MEMO-only**
   on the client: `NOTE MEMO :from <nick> :<text>` folds into `offlineMemo`;
   historical `TEGAMI` is **not** dual-accepted (`store.ts` / `parser.ts`,
   `427209d`). DM sidebar surfaces calm “N offline” counts (`708a8c5`).
5. **Offline outbox** — messages composed offline queue in the vault and send
   on reconnect (labeled-response for acks).
   ✅ **SHIPPED 2026-07-02** — vault `outbox` store (DB v2, 24h expiry),
   offline sendMessage queues + dimmed "queued" placeholder, `flushOutbox`
   on reconnect (waits for joins, retries, toasts). Unblocked three
   pre-existing bugs along the way: no instant offline detection (now
   window offline/online → drop/reconnect), the shell unmounting to the
   connect form on any blip (now stays up while autoReconnect owns
   recovery), and guests reconnecting into ghost channels (now re-JOINs).
   Verified live via `tools/outbox-live.mjs`.

## Phase 3 — Privacy (close the Matrix gap where it matters) ✅ COMPLETE 2026-07-02
6. **E2EE DMs over Mooring** — reuse the shipping media ratchet (ECDH +
   AES-GCM) for DM payloads between Onyx clients; keys pinned via certfp +
   METADATA discovery; graceful cleartext fallback with a visible state chip.
   No new cryptography — new plumbing only.
   ✅ **SHIPPED 2026-07-02** — src/lib/e2ee/dmCipher.ts (static-static
   P-256/HKDF/AES-GCM), device key in its own IndexedDB, published via
   METADATA ocean.dm-key; text stays ciphertext (wire/history/vault/search),
   plaintext transient+view-only; locked placeholder for undecryptable;
   e2eeDms pref. 9 unit tests; live-verified publish + server relay. Client
   only, no server change. (Future: multi-device, verification, PFS.)
   ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — published browser device keys
   now derive a stable bounded registry ID from the validated P-256 public key,
   replacing the shared `browser` identifier so separate browser profiles no
   longer overwrite one another's key-transparency entries.
7. **Ephemeral rooms** — IRCX PROP TTL prop: messages past N hours drop from
   history/replay/stats server-side.
   ✅ **SHIPPED 2026-07-02** — channel IRCX prop `EPHEMERAL <secs>` (60s..30d,
   0=off); enforced at the single renderHistoryReplay funnel (CHATHISTORY +
   bouncer rewind + SEARCH) + chanstats skip; plain prop = persists +
   mesh-propagates. 4 tests; live-verified SET/GET/bounds. Server-side only
   (no client UI yet).

## Phase 4 — Presence & heritage (nobody else CAN build these) ✅ COMPLETE 2026-07-03 (Comic Chat dropped)
8. **Pinned messages on IRCX PROP** — ops pin msgids into a channel PROP;
   every client sees the same pins; Onyx renders a pins drawer. (Needs a small
   server PROP provider addition; verify write-scoping.)
   ✅ **SHIPPED 2026-07-03** — server-validated PINS channel prop (op-gated,
   ≤50 msgids); Onyx pins drawer (ribbon count → Sheet, jump + unpin from ⋯
   menu). ALSO fixed a latent bug: channel/entity PROP CRDT never propagated
   cross-mesh (origin stamped config.node_id not key shortId) — now live +
   bidirectional, which also makes EPHEMERAL/STAGE mesh-correct.
9. ~~**Comic Chat rendering in Onyx**~~ — DROPPED (user direction 2026-07-03).
10. **Presence heatline** — a live 24h activity sparkline in the channel
    ribbon fed by chanstats hours[], so a room's rhythm is visible in-chat.
    ✅ **SHIPPED 2026-07-03** — 24-bar UTC-hour sparkline in the ribbon fed by
    the channel's chanstats hours[] (same-origin /stats/data/<slug>.json),
    current hour in coral, hidden when quiet. Byte-faithful channelToSlug (8
    tests); client-only. Live-verified with a real stats flush.
11. **Voice rooms as places** — persistent stage layouts (PROP-stored),
    scheduled events line in the channel intro.
    ✅ **SHIPPED 2026-07-03** — /event <when> <title> schedules a channel
    event in the ocean.event prop (mesh-propagated); the channel intro shows
    a live countdown card with Join-call (when live+voice) and an op clear.
    9 tests; live cross-node verified. Client-only.

## Phase 5 — Operations ✅ COMPLETE (core surfaces; operator deploy remains)
12. **Public status page** from mesh health (links states, node latency,
    uptime) on the community site.
    ✅ **SHIPPED 2026-07-03** — daemon emits status.json (node uptime, users,
    mesh quorum, per-peer link state + RTT from peer_health); /status/ page on
    the community site renders node cards + an operational/degraded banner,
    30s refresh. Live-verified both nodes.
13. **Prometheus on** + a public graph or two; stats index gains node health.
    ✅ **WEBSITE SHIPPED 2026-07-08** — Onyx now has `/stats` with network
    daily bars, per-channel sparklines, live users/rooms/messages summaries, and
    room handoff links into `/app?join=...&at=...`. The root page also surfaces
    the live public pulse. Server Prometheus remains the richer metrics source;
    this closes the public website graph surface from the chanstats/status feeds.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — The Onyx `/stats` and `/status`
    feed boundary now caps channels, days, spark points, peers, backup entries,
    strings, counters, and timestamps before sorting or rendering. Non-finite,
    negative, control-bearing, and out-of-range feed values fail safely instead
    of driving unbounded work or invalid relative-time/date output. Responses
    also have an eight-second timeout and 256 KiB streaming ceiling before JSON
    parsing, so a hanging or oversized same-origin feed never materializes into
    the app first.
14. **Nightly vault-safe backups** of accounts.db + chanstats snapshots.
    ✅ **SERVER SHIPPED 2026-07-08** — Onyx Server `[backup]` emits timestamped
    account-store snapshots and chanstats snapshots plus `latest.json` on a
    configurable cadence. Deployment still needs the target directory pointed at
    the operator's vault/sync path.
    ✅ **WEBSITE SURFACED 2026-07-08** — `/status` reads a public backup
    `latest.json` manifest when served and shows snapshot readiness without
    requiring an account or operator socket.

## Phase 6 — Time-Native Client + Atmosphere & Access ← NEXT
15. **Catch-up Home** *(client)* — promote the vault, unread state, followed
    conversations, mentions, scheduled events, and quiet room activity into the
    first screen after connection. The app should open as a place to return to,
    not just the last channel buffer.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home catch-up now promotes
    followed rooms, followed topics via their parent room, and followed DMs
    above ambient unread activity while preserving mentions/DM priority.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now surfaces joined-room
    scheduled events from the existing `ocean.event` prop, with live-first
    ordering and stale-event expiry shared with the channel intro.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now reads the local history
    vault for recently left rooms and shows remembered previews without joining
    the room or asking the server.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now adds a quiet activity
    section for recently active joined rooms that are already read, keeping
    low-pressure movement visible without promoting it to catch-up urgency.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home catch-up now adds compact
    since-you-left recaps from the existing hydrated buffers and hands each
    target into Spotlight with a prefilled navigation query.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now adds joined-room rhythm
    heatlines from chanstats and folds each room's scheduled-event context into
    the return screen.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home return recaps now include a
    review-from-start handoff that opens the room, pulses the first unread line,
    and reuses the existing `?at=` time-travel path.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Browse all channels now deduplicates
    repeated mesh `LIST` rows by room name before rendering the Home directory.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now records recent catch-up
    review ranges locally and lets the return screen reopen or search those
    reviewed spans.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Recent catch-up reviews on Home now
    open reviewed-preview text directly in message search after navigating to
    the reviewed target, extending the cross-room handoff beyond Spotlight.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — Home now has a one-tap "Mark all
    caught up" affordance (`src/shell/MarkAllCaughtUp.tsx`, mounted in
    `HomeView.tsx`): a pure `planCatchUpAll` (`src/lib/catchup/markCaughtUp.ts`)
    enumerates every unread channel + DM deterministically and advances read-state
    through the existing per-target `markRead` action (which also syncs the IRCv3
    read marker so sibling sessions agree). Clears the full backlog, self-hides
    when nothing is unread, and parks focus on a live status line on success.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — Home now has a **"Pick up where you
    left off"** section (`src/shell/HomeView.tsx:544`). A pure `buildResumePoints`
    (`src/lib/catchup/resumePoints.ts:71`) attaches the store's authoritative
    `firstUnreadId` boundary to each ranked catch-up item and drops any target
    with no genuine boundary, so one tap `navigate`s to the room/DM and
    `focusMessage`es the *exact* first-unread message (`src/shell/HomeView.tsx:216`)
    rather than the start of a heuristic window.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Search is now a global Search
    Center reachable from Home and `Cmd/Ctrl-F` even without an active room. It
    searches the device vault across targets, supports named save/run/delete
    queries, disables server search without a concrete room or DM, and hydrates
    archived results through the existing `travelTo` + message-focus path.
    Saved queries now support exact, related-term, and combined (hybrid RRF)
    modes without overstating token similarity as embeddings or model inference.
    ✅ **CLIENT / DOCS HONESTY SHIPPED 2026-07-19 (Era 1 A1)** — Hybrid is the
    live default, not a roadmap promise: UI labels end with “on this device,”
    Preferences default is **Text + related**, and
    `docs/search-and-history.md` documents hybrid / exact / related terms with
    provenance chips for device vs archived server paths.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Every live Search Center entry
    path now shares a 512-character work bound, including typed input,
    command-palette prefills, recall pivots, and server history requests. A
    pasted or programmatic query can no longer drive unbounded local token/vector
    work or an oversized `SEARCH` command.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Search inside an E2EE-capable
    DM now matches only transient decrypted text from loaded lines and keeps the
    query on this device. Full-history server search is suppressed, while vault
    and archived panes discard ciphertext envelopes instead of presenting or
    deriving recall terms from them. Legacy Mooring envelopes also fail closed
    when an old row omitted its encrypted flag, including after the local E2EE
    preference is disabled. Flagged encrypted vault rows are now excluded before
    lexical matching or candidate embedding, so an optional local provider never
    receives a ciphertext envelope that cannot yield a useful text match.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Saved-search deletion and
    clear operations now verify IndexedDB transaction completion and readback
    instead of treating a best-effort request as success. A failed deletion
    keeps the saved row visible and reports the device-storage failure in the
    Search Center; existing encrypted DM history also remains device-only even
    if the E2EE preference is later disabled.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Cross-conversation vault
    search now has a true global work bound in addition to per-target retention.
    A migrated newest-first IndexedDB time index limits each lexical or
    related-term pass to 4,096 materialized rows before matching or embedding,
    preventing a device with many remembered targets from turning one query
    into an unbounded full-vault allocation. Superseded related-term jobs stop
    scheduling work, and explicitly configured async embedding providers are
    limited to four concurrent calls per search. Each stored sender/body
    candidate also has a 32 KiB lowercase/tokenization work cap, so one malformed
    legacy or imported row cannot bypass the global row bound with an enormous
    string. Matched bodies are reduced to a match-aware 4 KiB reactive/render
    excerpt before entering result state, while navigation keeps the exact
    target/message id.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Device-local reviewed anchors now
    surface in Spotlight as a bounded newest-first recall set searchable by
    review, target, and saved preview. Recall navigates to the reviewed room or
    DM, focuses the exact stored message id, and passes that id through vault
    time travel; malformed imported timestamps fail closed without blocking the
    safe exact-id handoff.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Preferences now provides
    separate count-aware, two-step controls for clearing reviewed catch-up
    anchors and saved Search Center queries. Both operations verify removal by
    readback, retain confirmation on failure, restore focus on cancel, and prove
    that unrelated vault rows, topic cursors, and other local-memory stores are
    not changed.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Search Center saved-query
    operations now use lifecycle and operation epochs, so rapid close/reopen,
    target/query changes, unmounts, and overlapping IndexedDB completions cannot
    overwrite newer rows or status. Persistence remains tied only to the
    explicit Save action, and refresh/save/delete pending, success, and failure
    outcomes are announced without treating a stale completion as current.
    ⏭️ **NEXT** — pure Onyx work. Reuse the local vault, `?at=` time travel,
    and richer cross-room review handoffs before adding new server surface.
16. **Reader mode** *(client)* — a calm single-pane transcript view for long
    room history, optimized for reading and sharing moments. This is the
    Ink venue roadmap item that makes the "network that remembers" visible.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reader mode now applies a stronger
    transcript measure, reading typography, avatar-free alignment, calmer topic
    chrome, and keyboard-focus metadata/action reveals.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Since-you-left digests now include
    a transcript reader note and render as a quieter chapter marker in reader
    mode, tying catch-up summaries into long-form reading.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message actions now copy shareable
    moment links using the same `/app?join=...&at=...` time-travel path as the
    scrubber, giving reader mode stable anchors into remembered rooms.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reader mode now surfaces a
    device-memory context band for hydrated channel buffers, summarizing
    readable lines, voices, topics, and the visible transcript span.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message moments now hand off into
    prefilled message search, so a remembered anchor can immediately fan out
    across hydrated buffers, vault hits, and full-history search.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The reader memory band now doubles
    as transcript navigation with Start/New/Latest jumps for hydrated buffers
    and unread boundaries.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Since-you-left digests now include
    a review handoff that jumps straight to the unread transcript boundary.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reviewing the since-you-left handoff
    now clears the rendered unread chapter marker, so reader mode has an explicit
    completion state after the catch-up range is opened.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The reader memory strip now includes
    a direct Home return handoff, so long transcript review can land back on the
    catch-up surface without losing the remembered context.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reader mode now recalls the latest
    Home-reviewed catch-up span for the open transcript, with direct jump and
    message-search handoffs over the reviewed preview.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reviewed catch-up spans in reader
    mode now expose hydrated before/after context trails with direct jump
    controls into neighboring transcript lines.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reviewed-span context trails now
    merge hydrated buffer neighbors with local-vault neighbors, filling before
    or after gaps from device memory without adding server surface.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reader mode now marks vault-only
    reviewed anchors as saved on device and hydrates the transcript buffer from
    the local vault before jumping to the reviewed first line.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Command palette time grammar now
    teaches and executes a 20-part client batch: focusable examples, live
    selected-command status, `goto`, `join`, and `open` channel aliases,
    `goto #chan at <time>` jumps, targeted `at #chan <time>` jumps, active
    `at:` jumps, `search`/`find` message handoffs, `home`, `prefs`, and
    `shortcuts` commands, reader on/off/toggle, density projections, measured
    and full-width projections, still/animated motion controls, timed mute, and
    quiet-mode on/off.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The global keyboard layer now adds
    `J`/`K` transcript navigation over rendered message rows, reusing the
    existing message landing pulse so reader-mode review can move line by line.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — The keyboard reading layer now
    carries exact conversation context: `N` captures and focuses the target's
    authoritative first-unread message before read-state advances, while `U`
    follows the selected named conversation when a topic filter is active
    instead of silently following the entire room.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — Command-palette time grammar broadened
    (`src/chat/spotlight/timeGrammar.ts:279`): `parseTimeExpr` now resolves weekday
    names (`tuesday`, `fri 08:30`, `last friday noon`), dayparts (`this
    morning/afternoon/evening/night`), `noon`/`midnight`, and relative
    `N weeks ago` in addition to the existing offsets. Day arithmetic adds whole
    days rather than 24h spans so a requested wall-clock hour survives DST
    transitions (`:177`); unparseable input returns `null` (fail closed).
    ⏭️ **NEXT** — carry reviewed anchors into richer cross-room handoffs without
    adding new server surface.
17. **Accessibility conformance ledger** *(main site + client)* — publish the
    public WCAG 2.2 / EN 301 549 audit path and keep it linked from the front
    door while app panels are audited.
    ✅ **WEBSITE SHIPPED 2026-07-09** — `/accessibility/` on the main site now
    documents keyboard access, motion controls, contrast checks, live-update
    behavior, and the remaining audit path. The public sitemap includes it.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Preferences now includes a compact
    client access audit ledger for connect, shell, composer, channel settings,
    voice controls, and modal focus traps, linked back to the public ledger.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Channel settings, voice controls,
    and Appearance now carry pass evidence in the client audit ledger and the
    public accessibility statement.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home catch-up, reviewed ranges, and
    channel directory cards now expose labelled list semantics and carry pass
    evidence in both the client and public audit ledgers.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message search now carries pass
    evidence for its search landmark, result navigation group, and named
    archived/device-memory result lists.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Notification Center now carries pass
    evidence for its named inbox dialog, labelled notification list, and
    row-specific open/dismiss actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Channel Browser now carries pass
    evidence for its Sheet dialog, named directory search, labelled public
    channel list, and target-specific Join/Open actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Account panel now carries pass
    evidence for named account-management regions, alert/status feedback, and
    target-specific persona actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Channel sidebar now carries pass
    evidence for its complementary navigation landmark, roving channel/DM rows,
    unread/mention names, and target-specific join action.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Keyboard shortcuts now carries pass
    evidence for its named Sheet dialog, labelled close action, and grouped
    shortcut lists generated from the live keymap descriptors, including `J`/`K`
    transcript navigation.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Command palette now carries pass
    evidence for its named dialog, described grammar examples, live
    selected-command status, and literal goto/search/time/reader/mute actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Pinned messages now carries pass
    evidence for its named Sheet dialog, channel-specific pins list,
    target-specific jump buttons, and real unpin controls.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Theme import now carries pass
    evidence for its named import/share dialog, described theme-code input,
    target-specific import/copy actions, and invalid-code feedback.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Thread panel now carries pass
    evidence for its named Sheet dialog, labelled parent/reply articles, and
    reply log scoped to the source message.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Voice settings now carries pass
    evidence for its named Sheet dialog, labelled device/processing/PTT regions,
    described selects, and target-specific PTT key actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Call overlays now carry pass
    evidence for named incoming/outgoing dialogs with target-specific accept,
    decline, and cancel actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message actions now carry pass
    evidence for per-message action groups, named reaction/overflow triggers,
    labelled menus, and row-specific action names.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Member list now carries pass
    evidence for its channel-scoped complementary landmark, labelled role
    groups, named member-detail dialogs, and target-specific member actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Notification controls now carry
    pass evidence for their compact labelled control group, described calm-mode
    radios, and pressed-state desktop/sound/push/DND toggles.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Time scrubber now carries pass
    evidence for its channel-scoped scrubber region, labelled UTC-hour jump
    buttons, date jump input, and target-specific moment copy action.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — Two async outcomes are now announced
    through polite live regions (WCAG 2.2 SC 4.1.3 Status Messages): on-device
    import progress via a `role="status"` node in the history-import controls
    (`src/shell/HistoryImportControls.tsx:210`) and a successful invite-link copy
    in Channel settings (`src/shell/ChannelSettings.tsx:444`) — the status node
    pre-exists its text so screen readers reliably announce the update.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Discord JSON, Slack JSON,
    Discord package, Discord bot-token, and IRC-log import reviews now move
    keyboard focus to their named review heading when preparation completes,
    then restore focus to the initiating chooser or token field after cancel or
    successful merge. This closes the conditional-review focus-loss boundary
    while retaining the existing polite live-status announcements.
    ✅ **CLIENT E2E EVIDENCE SHIPPED 2026-07-21** — Dense nicklist reflow is
    proven on a real AppShell journey: `tests/e2e/member-list-dense-reflow.spec.ts`
    seeds a 48-member mixed-role roster through the production runtime store and
    asserts mobile drawer + desktop column containment, scroll-to-tail, and focus
    reachability (`e65675a`; ledger **Dense nicklist browser evidence** closed).
    Static `member-list-reflow.spec.ts` remains a CSS-only companion.
    ⏭️ **CLIENT NEXT** — continue remaining dense-surface audit rows until every
    app panel has pass/fix evidence.

## Master roadmap backlog folded into Onyx/public-site scope

Source: `/home/kain/ONYX_ONYX_MASTER_ROADMAP.md`, filtered to Onyx and the
main website. Onyx Server daemon work stays out of this client roadmap unless the
client or public site needs to expose the result.

## Phase 8 — Torii Product Entry ← PLANNED
18. **Rich invite entry** *(client + main site)* — make `?join=` links a true
    first-run surface with Open Graph-ready public unfurls, instant guest
    identity, channel context, and a clear path from guest nick to claimed
    account.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Onyx now has a first-class
    `/invite` route that reuses the invite-card model for room, moment, and
    suggested guest metadata, then hands off to `/app` with the same params.
    The main site now links the install/first-run path and generates sitemap
    entries for public app, stats, invite, and documentation routes.
    ✅ **CLIENT + WEBSITE 10-ITEM SLICE SHIPPED 2026-07-09** — Rich invite entry
    now preserves validated named-conversation topics, reader-mode projection,
    copyable canonical invite URLs, a first-run runway, app-side topic handoff,
    app-side reader handoff, public high-contrast ledger notes, public
    reduced-transparency ledger notes, forced-colors/drawer-focus audit notes,
    and install/wrapper release checks.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — The **create** side landed: a
    **Share invite** section in Channel settings
    (`src/shell/ChannelSettings.tsx:393`) lets any member build a rich shareable
    link. A pure `buildInviteLink` (`src/lib/invite/inviteLink.ts:60`) emits both
    the canonical share URL (`<origin>/invite?join=…`) and the in-app deep-link
    (`/app?join=…`) from the active channel plus an optional preferred nick, and
    re-validates every field through `buildInviteCard` so a comma/control-char
    (JOIN-list / CRLF vector) is dropped and a bad channel degrades to a
    network-only invite. Copy success is announced politely (SC 4.1.3).
19. **Native onboarding and account claim** *(client)* — remove the NickServ
    cliff from first use with registration, identify, certificate, and future
    passkey flows expressed as first-party forms over the real server commands.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Connect now exposes a first-party
    claim path from guest nick to registered account, recovery email, and
    device login; the guest Account panel now returns directly to Connect with
    concrete claim steps instead of pointing users at bot-era NickServ flows.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — Passkeys (WebAuthn) are live, no
    longer "future": `src/lib/webauthn/passkey.ts` drives the daemon's `WEBAUTHN`
    register/sign-in ceremony (base64url wire, ES256/EdDSA), with fail-closed
    validation of the server challenge (host-label `rp_id`, ≥16-byte challenge)
    before the device is ever prompted. Surfaced as **Add a passkey** in the
    Account panel (`src/app/Account.tsx`) and **Sign in with a passkey** on
    Connect (`src/app/Connect.tsx`, gated on `isPasskeySupported()`).
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Connect now exposes a bounded
    catalogue of the active and 11 newest sanitized server/nick identities
    instead of silently selecting one entry.
    Users can switch or forget entries individually; capability labels clearly
    distinguish resume-ready credentials, password sign-in, and identity-only
    handoff data, while expired tokens fail closed and selecting an identity
    clears any password typed for the previous one.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — The authenticated account from
    `900 RPL_LOGGEDIN` is now retained across the pre-registration SASL → `001`
    boundary, so a successfully resumed session constructs its shell identity as
    the signed-in account instead of reverting the top-bar chip to “Guest”. Own
    account-notify updates remain scoped to the local nick, preventing a peer's
    logout from clobbering that identity.
    ✅ **CLIENT SLICE SHIPPED 2026-07-21 (Era 2 B8 list+DROP)** — Account
    **Sessions & devices** (`SessionsDevicesSection`) pulls authoritative
    `SESSION LIST` rows and offers `SESSION DROP #<n>` for non-current
    attachments only (`sessionList.ts` + store fold; never fabricates devices).
    ✅ **CLIENT SLICE SHIPPED 2026-07-25 (Era 2 B8 recovery codes)** — Account
    **Recovery codes** (`RecoveryCodesSection`) drives `RECOVERYCODES`
    STATUS/GENERATE/CLEAR; Connect offers offline LOGIN (queued until 001);
    pure Crockford parse helpers in `recoveryCodes.ts`; server stores digests
    under account props `rcd\x00`.
20. **Brand and glossary cleanup** *(main site + client)* — enforce one public
    glossary across home, about, status, roadmap, accessibility, app chrome,
    invite unfurls, and docs. Track the master-roadmap direction to make
    protocol/engine names supporting context instead of public product clutter.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — The main site now has `/glossary/`
    as the public language contract for Onyx (network), Onyx Server (engine),
    invites, guest/account claim, local vault memory, privacy, and protocol
    context, with root/footer navigation into it.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — The eshmaki.me house identity now
    ships as a built-in theme, **"Ink & Vermillion"** (`vermillion`,
    `src/theme/themes.ts:820`, `:1172`): a single vermillion seal accent
    (OKLCH ~33°) over the deepest warm ink, factory-derived so its text pairs
    stay AA. It joins the built-in theme set (now 17,
    `src/theme/themes.ts:48`); `DEFAULT_THEME_ID` remains `ocean`.

## Phase 9 — Ink Venue Model ← PLANNED
21. **Named conversations and forum projection** *(client)* — promote existing
    topic tags into a softer Zulip-style model with topic-aware unread state,
    one-tap split/follow actions, and a durable forum projection for long-lived
    room knowledge.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Topic forum cards now include
    one-tap follow/unfollow controls for named conversations, and channels can
    pin their forum projection so long-lived topics reopen as a durable room
    knowledge surface.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Forum cards now expose device-local
    unread counts, latest-activity dates, descriptive open actions, a labelled
    forum heading, forced-colors treatment, and coarse-pointer controls at least
    44px tall without adding a new server read-state contract.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Named conversations now keep a
    bounded, sanitized device-local read ledger (message id/timestamp metadata
    only) so interleaved topics clear independently across reloads and tabs.
    Opening a topic reprojects room totals, mentions, and the exact remaining
    unread boundary without publishing an over-broad server marker; only the
    whole-room `All` view advances `MARKREAD`. Topic and room follows preserve
    their actual scope, stale notification topics fail safely to the room, and
    the in-app notification dialog closes cleanly after activation.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Topic deep links now wait for
    retained messages, history replay, or the IRCX registry before applying a
    filter, then fail safely to the whole room when the label is stale. Device
    cursor changes reconcile affected inactive rooms across tabs, and live
    custom-highlight classification preserves unread mentions in hidden sibling
    topics instead of diverging from replay projection.
22. **Calm notifications and quiet boosts** *(client)* — formalize calm,
    regular, and power notification presets; keep followed conversations and
    mentions prominent while quiet reactions and ambient movement collect into
    Home instead of interrupting users.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The compact sidebar notification
    controls now expose the same Calm / Regular / Power preset model as
    Preferences, cycling the persisted mode with accessible current/next-state
    labels while keeping boosts non-notifying.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now collects recent quiet
    boosts from hydrated channel and DM buffers into a non-notifying digest,
    ranking boosted messages by reaction count and opening them through the
    existing message-focus/time-travel path.
23. **Presence-as-place header** *(client)* — consolidate facepile, heatline,
    scheduled event, and voice corner into a peripheral room-presence surface
    that shows life in the room without turning presence into a summons.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The room header now folds
    scheduled `ocean.event` context into the existing facepile / heatline /
    voice-corner ribbon as a compact event chip, with live countdown state and
    one-click travel to the event moment.
24. **One-canvas responsive projection** *(client)* — keep Reader, Standard,
    Dense, and mobile as projections of the same information model, avoiding a
    separate mobile information architecture.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Mobile channel views now have a
    visible Home tab in the bottom navigation, so the catch-up surface is a
    touch affordance instead of keyboard-only.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home recap and recent-review action
    cards now stack into touch-sized mobile rows.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Mobile ergonomics pass:
    the app bottom nav is taller and stateful, drawers clear the thumb bar,
    composer/search/caption overlays respect safe-area and bottom-nav space, and
    the main site mobile menu, doc tables, hero CTAs, and install cards use
    scroll-safe touch layouts.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The mobile `/app` Connect front
    door now uses a full-height phone layout with a sticky mode switch, larger
    inputs and submit controls, simplified atmosphere, and no secondary pulse
    rail before a user connects.

## Phase 10 — Atmosphere Layer ← PLANNED
25. **Background system consolidation** *(client)* — collapse the canvas and DOM
    scene set into a smaller Ink-on-Living-Paper system with shared layers,
    capped motion, idle deceleration, and explicit Animated/Still/Off controls.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Background motion controls now feed
    the renderer itself: Animated runs normally, Still starts canvas and DOM
    scenes in static mode, Off skips mounting the background renderer entirely,
    and Preferences reset restores the scene mode to Animated.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Canvas scenes now cap real
    paints, decelerate from actual user inactivity, reset stale FPS evidence on
    activity/resume, and repaint frozen bitmaps after resize or quality changes.
    Off no longer requests a lazy scene chunk, while DOM/SVG scenes share a
    cleanup-safe hidden/blur/idle hold that resumes on focus or input without
    misreporting the user's Animated mode as Still. The shared hold also pauses
    feature-detected SVG SMIL timelines, and the Appearance picker debounces
    transient pointer sweeps so they do not request every crossed scene chunk.
    ✅ **CLIENT SLICE SHIPPED 2026-07-21** — Consolidation closed: every canvas
    catalogue preset routes through the shared `composeSignature` pipeline
    (capped ground → ink → paper grain → vignette → edge seal), including the
    frost / lapis-gradient / obsidian holdouts. Twenty-four selectable ids remain
    for theme `signatureBg` / prefs and group into five signature families plus
    a `scene` family; SceneShell adds static grain + vignette for DOM legibility.
    Animated/Still/Off, reduced-motion freeze, 30fps cap, and idle hold stay
    engine-owned (`9629f2d`; ledger **Background consolidation** closed).
26. **Theme-reactive community identity** *(client + main site)* — allow bounded
    accent, tint, banner, and wordmark expression within contrast-locked OKLCH
    tokens so rooms can feel distinct without unbounded CSS or broken access.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Active channels now get a
    deterministic room identity layer: Onyx hashes the channel name into a
    bounded OKLCH accent set, applies only contrast-locked CSS variables on the
    shell root, and uses them for subtle ribbon/conversation chrome. The public
    accessibility ledger now documents that room identity stays token-bounded
    instead of accepting arbitrary community CSS.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Preferences now starts with a
    dedicated Theme and background launcher, giving mobile users a persistent
    path from the bottom `prefs` tab into the Appearance sheet without adding
    another crowded bottom-nav item.
27. **Contrast, transparency, and drawer focus variants** *(client + main site)*
    — mechanically derive `prefers-contrast: more`, forced-colors, and
    reduced-transparency variants from the same tokens already used by the app
    and site; finish mobile drawer focus handoff/trap/restore semantics.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Preferences now includes an
    explicit reduced-transparency control that persists to the app preference
    model, reflects as `data-reduce-transparency`, and shares the same solid
    panel/chrome rules as the OS `prefers-reduced-transparency` path.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Mobile channel/member drawers now
    manage focus as drawers: opening records the bottom-nav trigger, moves
    focus inside, traps `Tab`, closes on `Escape`, and restores focus to the
    trigger on close.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Time scrubber hourly bars now
    activate exactly at the announced `HH:00 UTC` moment for pointer and
    keyboard users.

## Phase 11 — Cadence Media Presence ← PLANNED
28. **Voice-room-as-place UI** *(client)* — turn voice/video from a button row
    into persistent room presence with stage context, speaker/listener state,
    device health, and call status visible in the room header.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The room header voice chip now
    reports active speaker or listener state, raised-hand fallback, muted peer
    fallback, and local device health such as muted, deafened, sharing, camera,
    and captions while preserving the join-current-room action.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — The off-room mini voice view
    keeps its avatar DOM bounded to five while deriving participant, hidden, and
    speaking counts from the complete case-insensitive local/peer/mesh roster.
    Large calls therefore retain truthful count and active-speaker summaries
    without expanding the compact overlay.
    ✅ **CLIENT SLICE SHIPPED 2026-07-21 (Era 2 B2 R1–R6)** — Full MEDIA UI
    polish closed for the researched soft-feedback set: join-muted option,
    connection-quality soft “turn off camera” prompt, Privacy sheet, EVENT MEDIA
    roster, **R3** bandwidth-ladder one-shot toasts
    (`bandwidthLadderFeedback` → `VoiceBar` `ConnectionQualityPip`), and **R5**
    fail-closed codec init/mismatch/decode toasts (`codecFailure` →
    `useCadenceMedia` `onError` / `onDecodeError`, never silent black video)
    (`d415302`; ledger **B2** closed).
29. **Spatial audio and screenshare controls** *(client)* — add explicit spatial
    audio, screenshare, and watch-together controls that degrade cleanly when a
    node or browser lacks the underlying media feature.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The voice toolbar now exposes a
    spatial-audio control beside layout controls, opens a compact room-state
    popover when media is available, shows positioned-peer counts from the
    existing spatial store, and disables itself with a clear unavailable label
    when the current media path cannot support it.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — The in-call toolbar and every stage
    layout now share a case-insensitive union of local, decoded, and mesh-roster
    participants, so cross-node members remain counted and visible while the
    local user shares their screen without duplicate nick tiles.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Screen sharing now exposes a
    disabled, explicitly labelled unavailable state when the browser lacks
    display capture or the media path is unavailable. An already-active share
    always retains its enabled Stop control even if capability state changes.
30. **Watch-together surface** *(client)* — expose synchronized playback as a
    room activity with clear host, participant, pause, seek, and handoff states.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Channels can now surface a
    watch-together activity strip from `ocean.watch` room metadata, showing the
    title, open link, host, participant count, synchronized position/duration,
    and playing/paused/seeking/handoff state without turning it into a chat
    message.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Untrusted `ocean.watch` room
    metadata is now rejected or bounded before parsing/rendering: title, URL,
    host, handoff target, clock values, and the case-insensitive participant
    roster have explicit client work limits while valid wire snapshots retain
    their existing format.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Hosts can now offer control to a
    bounded participant, targets can explicitly accept, and a pending offer
    freezes misleading playback controls. The old host can safely cancel an
    unanswered offer; every transition republishes through the existing
    `ocean.watch` path with host/target authorization rechecked in the pure
    controller.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Every locally authored
    `ocean.watch` snapshot now passes through the same title, URL, identity,
    roster, clock, and wire-size bounds as received metadata. Unsafe URL
    schemes are omitted instead of published, and host/handoff identities are
    preserved when a crowded roster must be reduced to the PROP budget.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Signed-in room members can now
    explicitly join or leave an activity, with their current role and the
    bounded 128-member capacity announced in the strip. Full activities and
    unavailable publishers disable the action honestly, publication failures
    preserve the displayed role, and hosts must hand off before leaving.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — The current host can now end a
    room activity through a named, participant-count-aware confirmation that
    republishes an explicit clear only after rechecking the active channel,
    exact wire snapshot, host authority, and publisher. Cancel restores focus;
    stale state and publication failures leave the activity visible and report
    why it was not cleared.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Signed-in channel members can now
    start an activity when no valid `ocean.watch` snapshot exists. Bounded title,
    optional HTTP(S) URL, and duration inputs remain transient, pass through the
    existing controller/serializer, and require a room-wide review confirmation
    that rechecks channel, identity, current metadata, and publisher before send.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — The activity strip now includes a
    keyboard-operable bounded participant disclosure. Its named list reuses the
    normalized 128-entry roster and derives case-insensitive Host, Pending host,
    and You labels without duplicating identities or rendering raw metadata; it
    closes when the channel or activity changes.
    ✅ **CLIENT ACCESSIBILITY HARDENING SHIPPED 2026-07-16** — Watch activity
    start/end reviews now retain deliberate focus after every confirmation that
    closes: the remounted initiating control receives focus when available, and
    a programmatically focusable polite atomic status receives focus when stale
    activity or authority state removed that control. Successful requests and
    rejected stale confirmations therefore leave both a truthful announcement
    and a deterministic keyboard location.

## Phase 12 — Yorishiro Apps and Integrations ← PLANNED
31. **Block-Kit-lite renderer** *(client)* — render structured webhook/plugin
    components such as buttons, selects, and compact forms from protocol-tagged
    payloads, with text fallback for classic clients.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message rendering now recognizes
    `[onyx:block]` JSON payload lines, sanitizes and clamps the schema, renders
    compact fields, selects, safe links, and disabled command buttons, and leaves
    malformed payloads as readable text fallback for classic clients.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Block-Kit message
    controls now keep the safe split explicit: URL buttons open sanitized
    links, value buttons copy their bounded value with live feedback, and
    command-like payloads still do not execute. The public integrations page
    now documents structured controls as safe link/copy affordances.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Attacker-authored structured
    send/select controls now stage an accessible confirmation showing the exact
    same-conversation target and outgoing plaintext. Inline and detail-modal
    controls dispatch only after explicit confirmation, revalidate every action
    constraint at send time, reset cancelled selects, and restore focus to the
    originating control.
32. **Client extension surface** *(client)* — prepare a capability-scoped,
    UI-safe extension surface for first-party plugins, starting with command
    palette actions and message/room cards.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — First-party client extensions can
    now register sanitized command-palette actions from a manifest-like storage
    surface with explicit `open-url` and `copy-text` capabilities; unsafe URLs,
    duplicate IDs, unknown capabilities, and arbitrary executable payloads are
    rejected before commands are built.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Extension scaffolds now reject
    missing or unsupported schema versions instead of silently reinterpreting
    them as v1. Clipboard actions no longer persist a secret-text fallback or
    record a successful audit entry when the browser clipboard is unavailable
    or rejects the write.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Message links, time-scrubber
    anchors, channel invites, theme values, extension copy actions, and
    Block-Kit copy controls now share one real browser-clipboard boundary.
    Rejected or unavailable writes report failure in the originating surface;
    no copy path stores the intended clipboard text or claims false success.
33. **Importer and webhook migration path** *(client + main site)* — document
    and surface server-snapshot imports, incoming webhooks, Slack export import,
    IRC-log-to-vault import, and bridge status as switching-cost reducers rather
    than generic integrations.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — `/integrations/` now documents
    incoming webhooks, server snapshots, Slack exports, IRC-log-to-vault import,
    bridge status, provenance, and review-before-publish import behavior.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Portable vault imports now stage
    selected Onyx JSON files in Preferences, show file name plus message,
    target, and reviewed-catch-up counts, and require an explicit "Import
    reviewed file" confirmation before merging local history.
    ✅ **CLIENT SLICE SHIPPED 2026-07-10** — On-device history import from
    external platforms: **Discord** (DiscordChatExporter JSON), **Slack**
    (workspace export channel JSON), and **IRC logs** (weechat/irssi/mIRC text)
    all parse entirely on-device — no bot token, no upload, no third-party API —
    and merge into the local vault via the existing `importVault` path with a
    choose → review-summary → confirm flow. Hardened per an independent
    GPT-5.6/Codex review (bounded memory, collision-safe ids, reaction-count
    preservation, cross-page reply resolution). See `docs/importing.md`.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Network-backed Discord snapshot
    import now states that the bot token goes to this deployment's same-origin
    proxy, requires a fresh explicit acknowledgement before each request, makes
    no request without it, and clears both token and consent after success,
    failure, abort, or unmount.
    (`src/lib/import/{discordImport,slackImport,ircLogImport}.ts`,
    `src/shell/HistoryImportControls.tsx`; 105 unit + 6 integration tests.)
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Every browser file-import path
    now validates selected-file count, per-file bytes, and aggregate recognized
    bytes before calling `file.text()`. Oversized JSON, logs, portable vaults,
    and official package selections reject with actionable limits and no partial
    read/import; unrecognized package files are excluded from byte accounting.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — IRC-log import previews now
    show the exact normalized vault target that will be written and require
    confirmation against that same value. Empty or unsafe raw targets reject
    before file contents are read, and a warning makes any raw-to-canonical
    transformation visible before import.
    ✅ **CLIENT SLICE SHIPPED 2026-07-11** — Added the **official Discord data
    package** path (no third-party tool): `parseDiscordPackage`
    (`src/lib/import/discordPackageImport.ts:272`) reads the folder tree from
    Settings → Privacy & Safety → "Request all of my Data" — `account/user.json`
    (author), `messages/index.json` (channel names), and per-channel
    `messages.json`/`.csv` — correlates channel identity + author, then delegates
    each channel to `parseDiscordExport`, inheriting its validation, per-channel
    `VAULT_KEEP` bounding, and stable-id dedup. Surfaced as
    `DiscordPackageImportControls` in Preferences
    (`src/shell/PreferencesPanel.tsx:911`), progress announced via `role="status"`.

    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Both file-derived Discord
    transforms now bound work before building vault rows: package file/path,
    metadata-channel, CSV/JSON row, field, attachment, and aggregate-text caps;
    direct DiscordChatExporter channel/message scan ceilings aligned to the
    vault validator; bounded vault-safe identities, reactions, and
    public credential-free HTTP(S) attachments; and amortized duplicate-id
    suffixing.
    Oversized metadata cannot starve real channel rows, and both paths retain
    the newest bounded tail before the normal `VAULT_KEEP` prune.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Slack export transforms now
    apply the same vault-aligned channel/message work ceilings, bounded layered
    user directories, vault-safe sender/reaction fields, newest-tail retention,
    amortized duplicate timestamps, and public credential-free attachment
    policy. Internal/LAN, credential-bearing, and non-HTTP file URLs never enter
    imported message text or become ambient browser requests.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — IRC-log transforms now scan
    accepted 128 MiB logs in place instead of duplicating the entire file with
    `split()`, allocate at most one bounded line at a time, reject oversized
    lines without losing safe siblings, and bound channel, sender, message, and
    generated-id fields before vault rows are created. Direct callers beyond
    the selection ceiling retain the newest bounded text window.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — The browser IRC-log chooser now
    decodes accepted files incrementally in 1 MiB UTF-8 chunks instead of
    materializing the full 128 MiB selection with `File.text()` before bounded
    parsing begins. Date rollover and stable line ids survive chunk boundaries,
    oversized physical lines are discarded without being retained, and only one
    bounded line plus the vault's newest 400-message window stays live.

## Phase 13 — Amanogawa Local Intelligence ← PLANNED
34. **AI provenance chrome** *(client)* — every recap, search answer,
    translation, or moderation suggestion must show where inference ran: this
    device, this server, or an external endpoint.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Since-you-left recaps and message
    search surfaces now share typed provenance badges, labelling visible-buffer
    and vault results as "This device" and archived full-history results as
    "This server" with accessible descriptions for future AI-assisted outputs.
35. **Vault RAG and semantic recall** *(client)* — add local embeddings over the
    decrypted vault for "when did we decide X?" queries that stay on the user's
    device when content is private.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Since-you-left digests now extract
    local lexical recall terms from missed visible lines and render them as
    device-local cue chips, adding recall help without network inference.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message search now derives local
    recall pivot chips from visible-buffer and device-vault hits only, letting
    users refine "what did we decide" searches without invoking server history
    or any external inference endpoint.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Device recall pivots now use
    bounded Unicode letter/number tokenization rather than an ASCII-only word
    pattern, so accented and non-Latin remembered text can refine local search
    without changing its on-device provenance or work limits.
36. **Local catch-up, captions, and translation** *(client)* — extend catch-up
    and media surfaces with optional local recap, caption, and translation
    affordances, keeping AI out of the front-door interaction model.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Live caption overlays now include
    the shared provenance badge and explicitly label caption/transcript text as
    "This server" output, keeping media intelligence source-visible before
    local caption or translation paths are added.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Live captions now expose a
    copy-transcript control that copies the current call transcript from local
    client state, giving caption users a device-side handoff without adding an
    inference endpoint.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Reviewing a since-you-left digest
    now records the reviewed span into local review history, so Home and offline
    recall can reopen the same catch-up anchor after the boundary is cleared.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Preferences now exposes a
    local language tools surface with a "This device" provenance badge, caption
    transcript copy readiness, browser-local translator detection, and an
    explicit no-external-translation guarantee. The public agent-safety page now
    documents browser-local language tools under the same provenance contract.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Browser-local caption
    translation now bounds source and translated text, permits at most three
    concurrent caption jobs, and keeps one in-flight request per caption.
    Replaced captions, target changes, and unmounted overlays discard stale
    completions; unavailable, pending, failed, and retry states remain explicit
    and accessible without persisting transcript text or calling an external
    endpoint.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Loaded readable messages now
    expose an explicit Translate on this device action with a four-job global
    cap, per-row single flight, stale-result rejection, and accessible
    unavailable/pending/error/retry/dismiss states. Encrypted rows contribute
    only transient plaintext when unlocked and never expose ciphertext; a
    successful transient translation can be copied through the verified browser
    clipboard boundary without persisting either source or result.
37. **Agent-safe public contract** *(client + main site)* — document that channel
    content is hostile input for any agent surface, exclude E2EE payloads, and
    require visible audit trails for agent actions.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — `/agents/` now publishes the
    agent-safety contract: hostile channel input, least-data defaults, E2EE
    plaintext exclusion, this-device/this-server/external provenance labels,
    and visible audit trails for proposed actions.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Capability-scoped client extension
    commands now record a bounded, payload-safe local audit trail and expose it
    in Preferences with timestamps, capability labels, redacted destination/text
    details, and a clear action.

## Phase 14 — Hyoryu Local-First Roaming ← PLANNED
38. **Full offline-first UX** *(client)* — generalize the vault and outbox so
    read, compose, search, catch-up, and moderation drafts all work during
    disconnection, then reconcile with calm "caught up" cues on reconnect.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message search now keeps
    active-target local-vault hits when they are not already loaded in the live
    buffer, de-duping by message id instead of dropping the whole open room.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — `travelTo()` now falls back to a
    local-vault timestamp window when CHATHISTORY is unavailable, and remembered
    unjoined channel vault results create/navigate a local shell immediately
    while still sending JOIN when connected.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now keeps reviewed catch-up
    ranges visible while disconnected, labelling them as offline recall so
    locally remembered review anchors remain usable before reconnect.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Message search now treats
    full-history server search as connected-only while preserving local buffer
    and vault search during disconnection.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now shows a local-memory mode
    status while disconnected so offline reading, reviewed spans, drafts, and
    queued sends are presented as deliberate behavior.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Reconnect status now keeps its
    visible seconds countdown while assistive technology receives only polite,
    atomic connection-phase updates. A successful recovery briefly shows and
    announces `Back online`, with cleanup-safe timers and no decorative motion.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Offline command submission now
    fails visibly at the composer instead of clearing and silently losing the
    draft. Real IRC commands stay preserved for reconnect, while text-only
    conveniences such as `/shrug` expand to ordinary text and still queue.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home now reads the persisted offline
    outbox and shows the exact queued-send count in local-memory mode, turning
    reconnect reconciliation into visible device state instead of hidden queueing.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — The outbox is now capped at 100
    non-evicting entries, validates persisted rows fail-closed, and emits
    metadata-only committed-change notifications. Home reacts with a
    privacy-preserving destination/age journal that can restore pending rows
    after reload, retry while connected, or remove one entry after confirmation
    without rendering queued message bodies on the Home surface.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Home local-memory mode now counts
    room composer drafts and channel-topic moderation drafts alongside queued
    sends, keeping offline compose state visible without exposing DM draft text.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Preferences now offers an
    independent exact-count, two-step Discard queued sends boundary. It requires
    a committed outbox clear plus physical-store and sanitized empty readbacks,
    publishes only metadata invalidation, never renders queued plaintext, and
    proves that vault history, drafts, reviewed anchors, topic positions, and
    saved searches remain untouched.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Local room-composer and
    channel-topic drafts now have verified, separately testable clear boundaries
    and one count-only Preferences confirmation. Count drift re-confirms,
    partial topic-clear failure rolls room drafts back, and same-tab composer
    updates flow through the store action; DM drafts remain byte-for-structure
    preserved and excluded from portable plaintext transfer.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Channel topic moderation now keeps
    unsaved edits as local offline drafts, disables connected-only saves while
    disconnected, and sends the same draft through TOPIC after reconnect.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Preferences now exposes bounded
    device-memory retention controls for both per-target message count and
    maximum age. The policy is persisted under an `onyx:` key, applied through
    the existing vault pruning path at app startup, and explicitly framed as a
    local browser policy rather than a server EPHEMERAL-room promise.
39. **PWA and desktop packaging path** *(client + main site)* — make install,
    update, notification, and wrapped push behavior explicit for browser PWA,
    desktop shell, and future mobile wrappers.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — The web manifest now starts
    installed launches at `/app`, declares app shortcuts for chat/status/stats,
    and the main site has `/install/` documenting install behavior, local memory,
    service-worker update recovery, and the desktop/mobile wrapper path.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — `/install/` now includes a
    packaging readiness matrix for the browser PWA, desktop wrapper, and future
    mobile wrapper so release lanes reuse the same route, cache, notification,
    and local-state contracts.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — `/install/` now publishes a wrapper
    contract for launch routes, origin storage, notification control, and
    service-worker update behavior so desktop/mobile shells do not fork Onyx.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The web manifest now includes
    install screenshots generated from the live app and a launch handler that
    reuses an existing installed window before opening another shell.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Preferences now exposes
    installed-app readiness for the current device: standalone-window state,
    service-worker control, notification permission, and local storage support.
    The install page now names that in-app readiness panel as the first wrapper
    smoke test before desktop or mobile shell release.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — Preferences now includes
    a Refresh app shell recovery action that asks the service worker for an
    update, activates a waiting worker when present, and reloads the stamped
    shell on demand. The install page now names this as the stale-wrapper
    recovery path. Recovery failures now surface as alerts instead of successful
    checks, and the readiness storage probe restores any pre-existing value at
    its test key even when browser storage fails midway.
    Push payload title/body/tag work is bounded, and notification clicks now
    revalidate a same-origin path before focusing or opening the app, including
    notifications authored by an older worker.
40. **Portable import/export** *(client)* — expose device-safe export/import for
    vault history, room snapshots, account handoff data, and reviewed catch-up
    state where protocol support exists.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Preferences now exports a portable
    Onyx JSON snapshot and imports validated snapshots back into IndexedDB and
    local review history, preserving the existing ciphertext-only behavior for
    encrypted DM vault rows while carrying reviewed catch-up checkpoints.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Portable transfer now carries
    sanitized room composer drafts, excludes DM draft plaintext, previews draft
    counts before import, and merges imported room drafts into the live composer
    state after confirmation.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Portable transfer now carries
    sanitized channel topic drafts separately from room composer drafts, previews
    their count before import, and merges them back into local moderation state.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Portable transfer now carries
    sanitized account handoff targets, preserving saved server/nick launch
    context while excluding passwords, session tokens, mesh tokens, and encrypted
    DM plaintext from the exported JSON.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Portable transfer now carries a
    sanitized Preferences handoff for display density, feature switches,
    contrast/transparency, and scene motion, so a device transfer can restore
    the user's chosen shell behavior without exporting account or message
    secrets.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Portable transfer now carries
    followed room/topic keys that power calm notifications and Home catch-up
    ranking, merging them into the destination device without moving message
    content or notification payloads.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Portable transfer now carries saved
    Search Center queries and the device-memory retention policy. Older exports
    remain valid when either field is absent; imports merge saved queries and
    apply an explicitly present retention preference without exporting
    authentication secrets, tokens, or decrypted DM message bodies.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — A transfer that disables local
    history now treats the device-vault clear as a verified privacy boundary.
    If IndexedDB cannot commit the clear, import stops and reports failure
    instead of merging the remaining snapshot and claiming a partial success.
    The committed clear is also verified through physical message/outbox counts
    and sanitized outbox readback, so a retained row cannot be mistaken for a
    successful device-memory wipe.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Portable vault validation now
    has a 16,384-row aggregate work ceiling across targets in addition to its
    per-target and conversation-count caps, preventing two individually bounded
    dimensions from multiplying into millions of untrusted row validations
    before retention can run.
    Device export shares that global ceiling through a newest-first IndexedDB
    cursor, so a long-lived browser cannot materialize an unbounded full-vault
    array before producing its portable snapshot.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Portable vault validation now
    also bounds every untrusted conversation, message, sender, body, topic,
    reaction, reactor, and reply field before it reaches IndexedDB. Oversized or
    control-bearing wire identifiers are dropped, optional oversized metadata
    is omitted, and exact-limit regression coverage preserves valid exports.
    The IndexedDB import boundary repeats those checks for direct on-device
    Discord/Slack/IRC conversions and reports only imported ids that survive
    the destination retention policy, rather than attempted or pre-prune rows.
    ✅ **CLIENT SLICE SHIPPED 2026-07-16** — Portable transfer now carries
    bounded topic-read cursors as metadata-only navigation state. Imports
    preview the cursor count, merge without moving any transcript content, never
    regress a newer local cursor, publish same-tab updates, and cap parsing work
    before sorting or deduplication; older snapshots remain compatible.
    ✅ **CLIENT HARDENING SHIPPED 2026-07-16** — Preferences can now clear
    topic-read positions through an exact-count, two-step control whose storage
    boundary requires both key removal and empty sanitized readback. Count drift
    requires re-confirmation, failure remains visible, and isolation tests prove
    that messages, followed topics, saved searches, and reviewed anchors remain
    untouched.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-16** — The public `/memory/` guide now
    explains the real device↔server boundary as a visual ledger: Search
    Center, reviewed anchors, topic positions, queued sends/drafts, local
    translation, encrypted-DM search, portable transfer, and verified clear
    controls. Guides, Community privacy, Install/offline, footer navigation, and
    the sitemap link the route; LADON/Ophion media framing remains explicit.

*Sequencing logic: 1–3 need no server deploys (ship fastest), 4–5 are one
focused server feature each, 6+ are compound. Every phase lands something
user-visible on its own.*
