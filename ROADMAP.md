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
   "Elsewhere on this device" section in the search panel, `openVaultResult`
   (navigate/join/create-DM + landing scroll); also fixed the pre-existing
   click-dead results strips (pointer-events). Verified live via
   `tools/vault-search-live.mjs`.

## Phase 2 — Reach (the tab is closed and it still works)
4. **Web Push** *(server + client)* — IRCv3 `draft/webpush`-shaped: VAPID
   (ES256), per-account push subscriptions in the account store, RFC 8291
   aes128gcm payloads, sent for mentions/DMs when no session is attached. The
   SW already handles `push` events — the server half is the work. Zig has the
   P-256/HKDF/AES-GCM pieces in-tree.
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

## Phase 3 — Privacy (close the Matrix gap where it matters)
6. **E2EE DMs over Tsumugi** — reuse the shipping media ratchet (ECDH +
   AES-GCM) for DM payloads between Onyx clients; keys pinned via certfp +
   METADATA discovery; graceful cleartext fallback with a visible state chip.
   No new cryptography — new plumbing only.
7. **Ephemeral rooms** — IRCX PROP TTL prop: messages past N hours drop from
   history/replay/stats server-side.

## Phase 4 — Presence & heritage (nobody else CAN build these)
8. **Pinned messages on IRCX PROP** — ops pin msgids into a channel PROP;
   every client sees the same pins; Onyx renders a pins drawer. (Needs a small
   server PROP provider addition; verify write-scoping.)
9. **Comic Chat rendering in Onyx** — the /home/kain/comicchat RE gives us the
   .avb assets and semantics; render `+V`-less channels' comic data plane as
   actual panels in a toggleable view. The single most unreplicable feature.
10. **Presence heatline** — a live 24h activity sparkline in the channel
    ribbon fed by chanstats hours[], so a room's rhythm is visible in-chat.
11. **Voice rooms as places** — persistent stage layouts (PROP-stored),
    scheduled events line in the channel intro.

## Phase 5 — Operations
12. **Public status page** from mesh health (links states, node latency,
    uptime) on the community site.
13. **Prometheus on** + a public graph or two; stats index gains node health.
14. **Nightly vault-safe backups** of accounts.db + chanstats snapshots.

*Sequencing logic: 1–3 need no server deploys (ship fastest), 4–5 are one
focused server feature each, 6+ are compound. Every phase lands something
user-visible on its own.*
