# IRCXNet Roadmap — what sets this apart, and what to build next

*2026-07-02 · covers Orochi (server), Onyx (client), the community site, and stats.*

## The competitive read

**Against modern IRCds (Ergo, Solanum, InspIRCd, UnrealIRCd):** Ergo is the only
real peer — integrated services, always-on multiclient, aggressive IRCv3. Orochi
already exceeds it in four places no IRCd touches: in-protocol **voice/video**
(KaguraVox/Vis, 64-seat rooms), a **post-quantum CRDT mesh** (Suimyaku/Tsumugi)
instead of legacy S2S, **hot upgrades with zero disconnects** (Helix), and
**live public telemetry** (chanstats). No IRCd ships a first-party web client,
a stats surface, and a community site as one coherent product. That coherence
IS the product.

**Against Matrix/Element:** Matrix wins on federation + E2EE, loses on weight,
sync latency, and self-host pain (Synapse). We will never out-federate Matrix;
we can out-*feel* it: instant everything, one binary, a client that loads in
under a second. Their E2EE is table stakes we currently lack for DMs — the
Tsumugi primitives (ECDH + AES-GCM, already shipping for media) close that gap
without inventing new crypto.

**Against Discord:** the UX bar — voice rooms, pins, push, search, "it
remembers everything." Discord's weaknesses are exactly our identity: no
self-hosting, surveillance economics, no protocol. Every Discord-parity feature
we add must ride an open primitive (IRCv3 draft, IRCX PROP) — that's the moat:
**"Discord comforts on 30-year-old open wire."**

**Against web-IRC (The Lounge, IRCCloud, gamja/soju):** all require a bouncer or
paid cloud for continuity. Orochi's session-sync already replaces the bouncer.
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

## Phase 2 — Reach (the tab is closed and it still works) ✅ COMPLETE 2026-07-02
4. **Web Push** *(server + client)* — IRCv3 `draft/webpush`-shaped: VAPID
   (ES256), per-account push subscriptions in the account store, RFC 8291
   aes128gcm payloads, sent for mentions/DMs when no session is attached. The
   SW already handles `push` events — the server half is the work. Zig has the
   P-256/HKDF/AES-GCM pieces in-tree.
   ✅ **SHIPPED 2026-07-02** — crypto/webpush.zig (RFC 8291 KAT-pinned +
   ES256 VAPID) + daemon worker (in-house HTTPS transport), WEBPUSH
   SUBSCRIBE/UNSUBSCRIBE/LIST, tegami trigger, ISUPPORT `VAPID=` discovery
   (no NOTE data channel — lifecycle on the Event Spine), client toggle +
   SW payload mapping. Live on both nodes (node-local subscriptions;
   cross-mesh propagation is future work).
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
6. **E2EE DMs over Tsumugi** — reuse the shipping media ratchet (ECDH +
   AES-GCM) for DM payloads between Onyx clients; keys pinned via certfp +
   METADATA discovery; graceful cleartext fallback with a visible state chip.
   No new cryptography — new plumbing only.
   ✅ **SHIPPED 2026-07-02** — src/lib/e2ee/dmCipher.ts (static-static
   P-256/HKDF/AES-GCM), device key in its own IndexedDB, published via
   METADATA ocean.dm-key; text stays ciphertext (wire/history/vault/search),
   plaintext transient+view-only; locked placeholder for undecryptable;
   e2eeDms pref. 9 unit tests; live-verified publish + server relay. Client
   only, no server change. (Future: multi-device, verification, PFS.)
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

## Phase 5 — Operations ← IN PROGRESS
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
14. **Nightly vault-safe backups** of accounts.db + chanstats snapshots.
    ✅ **SERVER SHIPPED 2026-07-08** — Orochi `[backup]` emits timestamped
    account-store snapshots and chanstats snapshots plus `latest.json` on a
    configurable cadence. Deployment still needs the target directory pointed at
    the operator's vault/sync path.
    ✅ **WEBSITE SURFACED 2026-07-08** — `/status` reads a public backup
    `latest.json` manifest when served and shows snapshot readiness without
    requiring an account or operator socket.

## Phase 6 — Time-Native Client + Washi Access ← NEXT
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
    ⏭️ **NEXT** — pure Onyx work. Reuse the local vault, `?at=` time travel,
    and richer cross-room review handoffs before adding new server surface.
16. **Reader mode** *(client)* — a calm single-pane transcript view for long
    room history, optimized for reading and sharing moments. This is the
    Sumi-e roadmap item that makes the "network that remembers" visible.
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
    ⏭️ **CLIENT NEXT** — continue remaining dense-surface audit rows until every
    app panel has pass/fix evidence.

## Master roadmap backlog folded into Onyx/public-site scope

Source: `/home/kain/OROCHI_ONYX_MASTER_ROADMAP.md`, filtered to Onyx and the
main website. Orochi daemon work stays out of this client roadmap unless the
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
19. **Native onboarding and account claim** *(client)* — remove the NickServ
    cliff from first use with registration, identify, certificate, and future
    passkey flows expressed as first-party forms over the real server commands.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Connect now exposes a first-party
    claim path from guest nick to registered account, recovery email, and
    device login; the guest Account panel now returns directly to Connect with
    concrete claim steps instead of pointing users at bot-era NickServ flows.
20. **Brand and glossary cleanup** *(main site + client)* — enforce one public
    glossary across home, about, status, roadmap, accessibility, app chrome,
    invite unfurls, and docs. Track the master-roadmap direction to make
    protocol/engine names supporting context instead of public product clutter.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — The main site now has `/glossary/`
    as the public language contract for IRCXNet, Onyx, Orochi-as-engine,
    invites, guest/account claim, local vault memory, privacy, and protocol
    context, with root/footer navigation into it.

## Phase 9 — Sumi-e Venue Model ← PLANNED
21. **Named conversations and forum projection** *(client)* — promote existing
    topic tags into a softer Zulip-style model with topic-aware unread state,
    one-tap split/follow actions, and a durable forum projection for long-lived
    room knowledge.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Topic forum cards now include
    one-tap follow/unfollow controls for named conversations, and channels can
    pin their forum projection so long-lived topics reopen as a durable room
    knowledge surface.
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

## Phase 10 — Washi Atmosphere ← PLANNED
25. **Background system consolidation** *(client)* — collapse the canvas and DOM
    scene set into a smaller Ink-on-Living-Paper system with shared layers,
    capped motion, idle deceleration, and explicit Animated/Still/Off controls.
26. **Theme-reactive community identity** *(client + main site)* — allow bounded
    accent, tint, banner, and wordmark expression within contrast-locked OKLCH
    tokens so rooms can feel distinct without unbounded CSS or broken access.
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

## Phase 11 — Kagura Media Presence ← PLANNED
28. **Voice-room-as-place UI** *(client)* — turn voice/video from a button row
    into persistent room presence with stage context, speaker/listener state,
    device health, and call status visible in the room header.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The room header voice chip now
    reports active speaker or listener state, raised-hand fallback, muted peer
    fallback, and local device health such as muted, deafened, sharing, camera,
    and captions while preserving the join-current-room action.
29. **Spatial audio and screenshare controls** *(client)* — add explicit spatial
    audio, screenshare, and watch-together controls that degrade cleanly when a
    node or browser lacks the underlying media feature.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — The voice toolbar now exposes a
    spatial-audio control beside layout controls, opens a compact room-state
    popover when media is available, shows positioned-peer counts from the
    existing spatial store, and disables itself with a clear unavailable label
    when the current media path cannot support it.
30. **Watch-together surface** *(client)* — expose synchronized playback as a
    room activity with clear host, participant, pause, seek, and handoff states.

## Phase 12 — Yorishiro Apps and Integrations ← PLANNED
31. **Block-Kit-lite renderer** *(client)* — render structured webhook/plugin
    components such as buttons, selects, and compact forms from protocol-tagged
    payloads, with text fallback for classic clients.
32. **Client extension surface** *(client)* — prepare a capability-scoped,
    UI-safe extension surface for first-party plugins, starting with command
    palette actions and message/room cards.
33. **Importer and webhook migration path** *(client + main site)* — document
    and surface server-snapshot imports, incoming webhooks, Slack export import,
    IRC-log-to-vault import, and bridge status as switching-cost reducers rather
    than generic integrations.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — `/integrations/` now documents
    incoming webhooks, server snapshots, Slack exports, IRC-log-to-vault import,
    bridge status, provenance, and review-before-publish import behavior.

## Phase 13 — Amanogawa Local Intelligence ← PLANNED
34. **AI provenance chrome** *(client)* — every recap, search answer,
    translation, or moderation suggestion must show where inference ran: this
    device, this server, or an external endpoint.
35. **Vault RAG and semantic recall** *(client)* — add local embeddings over the
    decrypted vault for "when did we decide X?" queries that stay on the user's
    device when content is private.
36. **Local catch-up, captions, and translation** *(client)* — extend catch-up
    and media surfaces with optional local recap, caption, and translation
    affordances, keeping AI out of the front-door interaction model.
37. **Agent-safe public contract** *(client + main site)* — document that channel
    content is hostile input for any agent surface, exclude E2EE payloads, and
    require visible audit trails for agent actions.
    ✅ **WEBSITE SLICE SHIPPED 2026-07-09** — `/agents/` now publishes the
    agent-safety contract: hostile channel input, least-data defaults, E2EE
    plaintext exclusion, this-device/this-server/external provenance labels,
    and visible audit trails for proposed actions.

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
39. **PWA and desktop packaging path** *(client + main site)* — make install,
    update, notification, and wrapped push behavior explicit for browser PWA,
    desktop shell, and future mobile wrappers.
    ✅ **CLIENT + WEBSITE SLICE SHIPPED 2026-07-09** — The web manifest now starts
    installed launches at `/app`, declares app shortcuts for chat/status/stats,
    and the main site has `/install/` documenting install behavior, local memory,
    service-worker update recovery, and the desktop/mobile wrapper path.
40. **Portable import/export** *(client)* — expose device-safe export/import for
    vault history, room snapshots, account handoff data, and reviewed catch-up
    state where protocol support exists.
    ✅ **CLIENT SLICE SHIPPED 2026-07-09** — Preferences now exports a portable
    Onyx JSON snapshot and imports validated snapshots back into IndexedDB and
    local review history, preserving the existing ciphertext-only behavior for
    encrypted DM vault rows while carrying reviewed catch-up checkpoints.

*Sequencing logic: 1–3 need no server deploys (ship fastest), 4–5 are one
focused server feature each, 6+ are compound. Every phase lands something
user-visible on its own.*
