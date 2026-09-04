# Onyx client roadmap — Q4 2026

**Audience: contributor and maintainer.** The feature plan for the Onyx SolidJS
client, organized in four waves. Every "already shipped" claim below is cited to
a real path in this tree; every gap is a gap because the file that would contain
it does not exist or is demonstrably thin, not because a summary said so.

Companion: **[onyx-server `docs/ROADMAP-2026-Q4.md`](../../onyx-server/docs/ROADMAP-2026-Q4.md)** — the
daemon half. Items whose wire contract spans both repos are listed once in each
file and reconciled in [§ Cross-cutting](#cross-cutting-client--server-wire-contracts).

Related planning documents, all still useful and none superseded by this one:

- [`PRODUCT_OVERHAUL_ROADMAP.md`](PRODUCT_OVERHAUL_ROADMAP.md) — positioning, public IA, visual direction, the P0–P6 product phases.
- [`PUBLIC_LAUNCH_ROADMAP.md`](PUBLIC_LAUNCH_ROADMAP.md) — the desktop/packaging/signing claim ledger.
- [`era3-40-game-changers.md`](era3-40-game-changers.md) — the Era-3 acceptance ledger.

This file is the **subsystem-level engineering roadmap** those three do not
cover: what each `src/lib` and `src/shell` area should gain next, in what order,
and what proves it done.

## How to read an item

Every item carries four fields:

- **Priority** — `P0` ship-blocking · `P1` this wave · `P2` scheduled · `P3` opportunistic.
- **Subsystem** — the owning directory. One item, one owner.
- **Server** — `none` (pure client), `gated` (needs a daemon capability that
  already exists), or `contract` (needs a new wire contract — see § Cross-cutting).
- **Accept** — the observable condition that closes the item. Not "looks better."

Waves are ordered by dependency, not by calendar. **Now** items unblock later
waves; nothing in **Next** should start before its **Now** prerequisites land.

## Wave index

| Wave | Theme | Items |
| --- | --- | --- |
| [Now](#wave-1--now) | Identity surfaces, the store strangler, oper desk foundations | C-01 … C-09 |
| [Next](#wave-2--next) | Group E2EE product path, media depth, search that scales | C-10 … C-19 |
| [Later](#wave-3--later) | Multi-device, moderation at scale, offline-first | C-20 … C-26 |
| [Moonshot](#wave-4--moonshot) | Ambient presence, on-device intelligence, native parity | C-27 … C-31 |

---

## Wave 1 — Now

The theme is **make the client's own surfaces match the depth of its kernel.**
The protocol, crypto, vault, and notification layers are far deeper than the UI
that exposes them; three of the four items below close that gap, and the store
strangler is the prerequisite for almost everything in Wave 2.

### C-01 — Full identity surface (WHOIS → profile)

**P0** · `src/shell/WhoisSheet.tsx`, `src/shell/PeopleProfileCard.tsx` · **server: gated**

`WhoisSheet.tsx` is 223 lines against a daemon that ships a dedicated
`src/daemon/whois.zig` plus IRCX `PROP` metadata, account attribution, host
cloaking, and `whowas`. The sheet shows a fraction of what the server already
answers. `PeopleProfileCard.tsx` is a second, separate identity surface with its
own layout, so the same person renders two different ways depending on entry
point.

Merge them into one identity surface with a single data path: live WHOIS,
account/`PROP` metadata, cloaked-host honesty, shared channels, per-person notes
(`src/lib/userNotes.ts`), presence, and the DM trust state that
`src/lib/e2ee/keyPinning.ts` already computes.

**Accept:** one component renders every identity entry point (member list, message
avatar, DM header, search hit, mention). A person with an account, a cloaked
host, a pinned E2EE key, and a local note shows all four in one pass. WHOIS
timeout and unknown-nick render explicit states, not blank fields.

### C-02 — Store strangler, first three domains

**P0** · `src/lib/store/` · **server: none**

`src/lib/store/store.ts` is **18,335 lines** with roughly 75 sibling test files
targeting it, and no domain facades: `src/lib/store/` contains only `store.ts`,
`index.ts`, `useStore.ts`, and two narrow bridges
(`groupControlBridge.ts`, `channelFoldersPersistence.ts`). This is the P4
"store strangler" from [`PRODUCT_OVERHAUL_ROADMAP.md`](PRODUCT_OVERHAUL_ROADMAP.md),
and it is now the single largest tax on every other item in this file.

Extract three domains behind facades while `useStore` stays the compatibility
bridge: **connection** (socket lifecycle, resume, ISUPPORT), **roster**
(channels, members, PREFIX learning), **messages** (inbound fold, edits,
redactions, read markers).

**Accept:** each extracted domain has its own module and test file; `store.ts`
shrinks by the extracted line count with no net behavior change; the full unit
suite passes; no consumer imports the domain module directly yet — reads still go
through `useStore`, writes through the existing immutable `set()` actions.

**Guard rail:** the roster domain owns the NAMES fold. A late or overlapping
`353` must **append**; only a burst the client itself initiated may replace
(`src/lib/irc/client.ts`). Any refactor that makes replace the default reopens
the production bug that collapsed a large channel to two members.

### C-03 — Operator desk

**P1** · `src/shell/` (new `oper/` module) · **server: gated**

The client's entire operator surface is `src/shell/OperEventConsole.tsx` — the
Event Spine `REPLAY` console. The daemon meanwhile ships `warden.zig` (ward
registry with match/scope/action and a wire codec), `flood_guard.zig`,
`clone_detect.zig`, `shun.zig`, `spamtrap.zig`, `ip_reputation.zig`, `dnsbl.zig`,
`audit_trail.zig`, and a full `svc_*` services family. None of it has a client.

Build an operator desk as a bounded feature module: live Event Spine feed
(existing), ward list with add/remove, active flood/clone verdicts, mesh peer
and link health, session view, and the audit trail.

**Accept:** an operator can see current wards, why a given connection was
throttled, and mesh link health without a raw IRC composer. Every destructive
action has a confirmation step and lands in the audit trail. Non-operators never
render the module (route-level guard, not CSS).

### C-04 — Call surface completion

**P1** · `src/shell/voice/`, `src/lib/cadence-media/` · **server: gated**

The media kernel is deep — `MediaEngine.ts`, `MooringSession.ts`,
`MooringGroup.ts`, `mediaMac.ts`, `spatialAudio.ts`, `replayWindow.ts`,
`activeSpeaker.ts`, `bandwidthLadderFeedback.ts`, `codecFailure.ts`,
`OpcodecWasm.ts` — and the UI covers a fraction: `VoiceBar`, `VoiceStage`,
`VoicePip`, `ParticipantTile`, `CallJoinBanner`.

Surface what the engine already knows: per-participant connection quality,
active-speaker ordering on the stage, the bandwidth ladder's current rung and
why it moved, codec-failure fallback state, and screen-share source selection.

**Accept:** a participant with degraded upstream is visibly distinguished from a
muted one. The stage reorders on active speaker without layout thrash. A codec
failure shows a specific recovery state, never a silent black tile. The honest
padlock (`src/lib/cadence-media/callSecurity.ts`) stays honest — `honestPrivate`
only with Mooring + E2EE seal + MAC.

### C-05 — Search that scales past the vault

**P1** · `src/shell/search/`, `src/lib/vault/` · **server: contract**

`src/lib/vault/` already ships hybrid lexical+semantic search
(`searchVaultHybrid.ts`, `searchVaultSemantic.ts`, `embeddingIndex.ts`),
saved searches with sync, retention policy, and DM search privacy. The UI is a
single `MessageSearch.tsx`. Search is device-local by construction, which means
anything older than this device's vault is invisible.

Add a server-history search path behind the existing privacy boundary: query the
daemon's `search_index.zig` for channels the vault has not seen, merge results
with local hits under the existing hybrid ranking, and mark every hit with its
provenance (device vault vs server history). E2EE DM content must never leave
the device — `src/lib/vault/dmSearchPrivacy.ts` is the gate.

**Accept:** a search for a term older than the local vault returns server hits
labeled as such. An E2EE DM term returns local hits only, and the UI says why.
Ranking is stable across the merge (a local hit does not lose to a worse server
hit).

### C-06 — Notification decision surface

**P1** · `src/lib/notifications/` · **server: none**

`src/lib/notifications/` is one of the most complete areas in the tree —
`decision.ts` with contract and coverage tests, `calmMode.ts`, `quietHours.ts`,
`smartMute.ts`, `keywordMatch.ts`, `followed.ts`, `readState.ts`,
`scheduledEvents.ts`, `sinceDigest.ts`, `digestStability.ts`, `webPush.ts`.
The user-facing controls expose a fraction of that decision tree, so when Onyx
correctly stays silent the user cannot tell whether it was calm mode, quiet
hours, a smart mute, or an unfollowed channel.

Build a "why was I (not) notified" surface: the decision trace for the last N
notifications, and per-channel effective policy resolved from all inputs.

**Accept:** for any recent message the user can see which rule decided, with the
rule named in plain language. Changing a rule updates the resolved policy display
immediately. No new decision logic — this reads `decision.ts`, it does not
duplicate it.

### C-07 — Accessibility: from CSS coverage to a tested contract

**P1** · `src/lib/a11y/`, `src/shell/` · **server: none**

The CSS layer is in better shape than the library layer suggests: 96
`forced-colors` occurrences and 17 `prefers-contrast` occurrences across `src/`,
with 35 shell components using `aria-live` or `role="log"`. But `src/lib/a11y/`
holds only three modules (`mediaPrefs.ts`, `reducedData.ts`, `reducedMotion.ts`),
so the coverage is convention rather than contract, and nothing fails when a new
component skips it.

Promote the conventions to tested primitives: a focus-trap primitive used by
every dialog, a live-region primitive with explicit politeness and
re-announcement suppression, and a preference resolver covering reduced motion,
reduced data, forced colors, and increased contrast.

**Accept:** every dialog routes through the shared focus-trap (Escape, trap,
restore) and a test proves restoration. The message log does not re-announce on
history replay, virtualization scroll, or channel switch. A component that adds
a new dialog without the primitive fails a lint or test gate.

### C-08 — Render budget under windowing

**P2** · `src/shell/MessageView.tsx`, `src/shell/messageWindow.ts` · **server: none**

Windowing already ships: `computeMessageWindow` at
`src/shell/messageWindow.ts:153`, consumed by `MessageView.tsx`. But
`MessageView.tsx` is 2,372 lines and `AppShell.tsx` is 1,550, and the memo graph
around the window recomputes against fresh object literals per call — the file's
own comments flag the pattern.

Profile and bound the per-row cost: memo identity, the embed/unfurl path, and
the reactive reads that fire per keystroke in the composer.

**Accept:** a measured before/after on a large channel, not a claim. Scroll holds
frame budget on a mid-range device. The `aria-live` message-log contract from
C-07 survives the change.

### C-09 — Public roadmap honesty pass

**P2** · `docs/` · **server: none**

[`PUBLIC_LAUNCH_ROADMAP.md`](PUBLIC_LAUNCH_ROADMAP.md) carries an
evidence-based claim ledger; [`PRODUCT_OVERHAUL_ROADMAP.md`](PRODUCT_OVERHAUL_ROADMAP.md)
carries a truth contract. Neither links to this file, and this file's items will
drift out of them.

**Accept:** the three roadmaps cross-link; each claim in the truth contract names
the item here that would change it; no roadmap asserts a capability another
roadmap lists as pending.

---

## Wave 2 — Next

The theme is **turn deep foundations into product paths.** Group E2EE, media,
and search all have substantial kernels and thin or absent user journeys.

### C-10 — Group E2EE product path

**P0** · `src/lib/e2ee/` · **server: contract**

`src/lib/e2ee/` ships thirteen `groupControl*` modules plus `groupEnvelope.ts`,
`groupKeyring.ts`, `groupSession.ts`, `groupTrustStore.ts`, `groupWelcome.ts`,
`groupCommit.ts`, `groupDeviceDirectory.ts`, `groupDevicePublisher.ts`,
`groupDirectoryBroker.ts`, and `trustedGroupSigner.ts`. The daemon has the
matching authority side (`e2ee_group_mesh_authority.zig`,
`e2ee_group_outbox.zig`, `e2ee_group_replay_guard.zig`,
`undertow/e2ee_group_relay.zig`) and a published blueprint
([onyx-server `docs/design/e2ee-everywhere-blueprint.md`](../../onyx-server/docs/design/e2ee-everywhere-blueprint.md)).

What is missing is the journey: enable encryption on a room, understand who can
read it, add a device, remove a member, and recover after a key change — as a
product flow rather than a set of primitives.

**Accept:** a room owner can turn on group encryption and see the exact member
and device set that can read it. Adding a device re-keys without message loss.
Removing a member forward-secures the next message. The
[truth contract](PRODUCT_OVERHAUL_ROADMAP.md) row for group encryption can move
one notch, with a runtime proof — not before.

**Fail-closed guard:** a failed seal is never downgraded to plaintext. If the
group session cannot seal, the send fails visibly.

### C-11 — Multi-device DM parity

**P1** · `src/lib/e2ee/multiDevice.ts`, `src/lib/e2ee/keyPinning.ts` · **server: gated**

Multi-device DM seal fan-out is already `DONE+WIRED` per
[`era3-40-game-changers.md`](era3-40-game-changers.md), with TOFU pinning the
full device set so a new device reads `key-changed` until re-pinned. The gap is
the management surface: no way to name, review, or revoke a device from the
client, and no clear recovery when the pin legitimately changes.

**Accept:** the device list is nameable and revocable from the client. A
legitimate new device produces a guided re-pin, not a dead end. A revoked device
cannot decrypt subsequent DMs, proven by test.

### C-12 — Media: simulcast and layer selection

**P1** · `src/lib/cadence-media/` · **server: contract**

The daemon substrate ships `simulcast_select.zig`, `twcc.zig`, `bbr.zig`,
`cc_cubic.zig`, `l4s.zig`, `raptorq.zig`, `red_fec.zig`, and `loss_recovery.zig`.
The client has `bandwidthLadderFeedback.ts` but no simulcast publish path, so a
sender on good upstream cannot serve both a high and a low layer.

**Accept:** a publisher sends at least two spatial layers; the SFU selects per
receiver; a constrained receiver drops to the low layer without the publisher
degrading for everyone. Measured, not asserted.

### C-13 — Vault: retention and storage pressure UX

**P1** · `src/lib/vault/` · **server: none**

`retentionPolicy.ts`, `storageEstimate.ts`, and `persistentStorage.ts` exist;
the user-facing story does not. On a device near quota the vault silently
degrades.

**Accept:** the user sees current vault size, the retention policy in effect, and
what will be pruned next. Approaching quota produces a specific prompt with
actions (export, prune, request persistent storage), not a generic browser error.

### C-14 — Import/export round-trip

**P2** · `src/lib/import/`, `src/lib/export/`, `src/lib/vault/portableTransfer.ts` · **server: none**

[`importing.md`](importing.md) documents local Discord, Slack, and IRC-log
imports, and `portableTransfer.ts` / `portableCompression.ts` /
`portableFileSave.ts` / `portableShare.ts` / `portableImportLock.ts` cover the
export half. The round trip — export from device A, import to device B, verify
nothing was lost — is not a tested journey.

**Accept:** an export/import round trip preserves message count, ordering,
attachments metadata, and read markers, verified by an automated test. E2EE DM
plaintext never appears in an export artifact.

### C-15 — Presence and typing at mesh scale

**P2** · `src/lib/people/`, `src/lib/store/` · **server: contract**

Presence today is per-connection. On a multi-node mesh a person can be present
on another node, and the client has no consistent model for that.

**Accept:** presence resolves consistently across mesh nodes; a remote-node user
is not shown as offline. Typing indicators do not flap during a node handover.

### C-16 — Composer: rich input parity

**P2** · `src/lib/composer/`, `src/shell/Composer.tsx` · **server: gated**

Drafts persist (`src/lib/composer/drafts.ts`), scheduled send works
(`src/lib/schedule/`), and slash commands are registered
(`src/lib/commands/registry.ts`). Missing: reliable multiline/paste behavior,
attachment previews before send, and reply/quote affordances that match the
render path.

**Accept:** paste of multiline text, an image, and a file each produce a
predictable, previewable draft. The send path uses the same typed-token pipeline
as render — no new markup path.

**Security guard:** the message render path is the XSS boundary. Parsed content
becomes typed tokens and then JSX text nodes. No composer feature may introduce
`innerHTML`.

### C-17 — Theme system: per-room accent

**P3** · `src/lib/theme/`, `src/lib/color/` · **server: none**

Listed as "later" in [`era3-40-game-changers.md`](era3-40-game-changers.md) item
33. The OKLCH factory can support it; the token plumbing cannot yet scope an
accent per room.

**Accept:** a per-room accent derives through the existing palette factory with
contrast enforcement — no hand-picked hex — and passes the AA audit in both
schemes.

### C-18 — Oper desk: mesh operations

**P2** · `src/shell/oper/` · **server: gated**

Extends C-03 once it lands. The daemon exposes mesh peer state, link health
(`link_health.zig`), partition detection, and `status.json`.

**Accept:** an operator can see mesh topology, per-link health, and partition
state, and can distinguish "peer is down" from "we are partitioned from it."

### C-19 — PWA: update and offline correctness

**P2** · `src/pwa/` · **server: none**

`readiness.ts`, `serviceWorkerRuntime.ts`, `updateRecovery.ts`, `manifest.ts`,
`AddToHomeScreenRuntime.tsx`, `AppBadgeRuntime.tsx`, and
`AttentionTitleRuntime.tsx` all exist. What is untested end to end is the
unhappy path: a stuck waiting worker, an offline cold start, and a version skew
between the shell and the vault schema.

**Accept:** a stuck waiting worker recovers within one reload. Offline cold start
paints from the vault. A vault schema newer than the shell refuses to downgrade
rather than corrupting.

---

## Wave 3 — Later

### C-20 — Domain facades complete

**P1** · `src/lib/store/` · **server: none**

Finish C-02 across the remaining domains — identity, media, vault, notifications,
preferences — and remove the last direct `store.ts` consumer.

**Accept:** a change in one domain does not require editing a global store
module. `store.ts` no longer exists as a single file.

### C-21 — Moderation at community scale

**P2** · `src/lib/moderation/`, `src/shell/oper/` · **server: gated**

Per-room moderation queues, bulk actions, and appeal state, built on the
daemon's `svc_akick`, `svc_masskick`, `svc_chanbadwords`, `content_filter.zig`,
and `gag_set.zig`.

**Accept:** a room moderator can triage a report queue without operator
privileges, and every action is attributable in the audit trail.

### C-22 — Message-level threading

**P2** · `src/lib/topics/` · **server: contract**

`src/lib/topics/` and `TopicFilterBar` exist as a partial implementation
(item 6 in [`era3-40-game-changers.md`](era3-40-game-changers.md)). Real
threading needs a stable server-side thread key.

**Accept:** a thread survives reconnect, history replay, and a mesh node change
with a stable identity.

### C-23 — Offline-first send queue

**P2** · `src/lib/vault/outboxFlushDecision.ts`, `src/lib/net/` · **server: gated**

The outbox exists (`outboxFlushDecision.ts`, `outboxStatus.ts`). Offline-first
means composing, reacting, and editing while disconnected and reconciling
deterministically on reconnect.

**Accept:** actions taken offline apply exactly once on reconnect. A conflicting
server state produces a visible, resolvable divergence — never a silent drop.

### C-24 — Native capability rollout

**P2** · `src/lib/platform.ts`, `desktop/` · **server: none**

Every flag in `PlatformCapabilities` is currently `false`
([`PUBLIC_LAUNCH_ROADMAP.md`](PUBLIC_LAUNCH_ROADMAP.md) Phase 4). Turn them on
one at a time, each with an implementation, a web fallback, and a test.

**Accept:** a capability flips to `true` only with an end-to-end proof on the
host and a working fallback on the web. No flag is optimistic.

### C-25 — Extension sandbox hardening

**P3** · `src/lib/extensions/` · **server: none**

**Accept:** a third-party extension cannot reach the store, the vault, or the DOM
outside its host. The permission manifest is enforced at the bridge, not by
convention.

### C-26 — Localization foundation

**P3** · `src/lib/text/` · **server: none**

**Accept:** user-visible strings resolve through one catalog; a missing key fails
loudly in development and falls back to English in production.

---

## Wave 4 — Moonshot

### C-27 — Ambient presence and spatial rooms

**P3** · `src/lib/cadence-media/spatialAudio.ts` · **server: contract**

Spatial audio geometry already ships. A persistent ambient room — always-on
low-bitrate audio with spatial positioning — is the product on top of it.

**Accept:** a room can be joined ambiently at a fraction of full-call bandwidth,
with an unambiguous indicator that the microphone is live.

### C-28 — On-device intelligence

**P3** · `src/lib/intelligence/`, `src/lib/vault/embeddingIndex.ts` · **server: none**

The semantic index is already local and deterministic. Summarization and
catch-up ranking on top of it must stay on-device.

**Accept:** no message content leaves the device for any intelligence feature.
The feature degrades to the existing digest when unavailable.

### C-29 — Cross-device session continuity

**P3** · `src/lib/vault/vaultSync.ts` · **server: contract**

Hand a conversation from phone to desktop mid-scroll, with read markers, drafts,
and call state following.

**Accept:** continuity works without the server ever holding plaintext or
decryptable read state.

### C-30 — Federation-visible identity

**P3** · `src/lib/identity/` · **server: contract**

Portable identity export/import exists (`portableIdentity.ts`). Making an
identity verifiable across independently operated nodes is the harder half.

**Accept:** a person's identity is verifiable across two independently operated
nodes without either node being trusted to assert it.

### C-31 — Native OnyxOS integration

**P3** · `desktop/`, `src/lib/platform.ts` · **server: none**

The P6 phase in [`PRODUCT_OVERHAUL_ROADMAP.md`](PRODUCT_OVERHAUL_ROADMAP.md).

**Accept:** every native enhancement has a permission contract, a cross-platform
fallback, a deterministic test, and a real integration proof.

---

## Cross-cutting: client ↔ server wire contracts

These items cannot ship from one repo alone. The **order** column is the safety
rule: a client that sends a token the daemon does not understand is a broken
session, while a daemon that advertises a capability no client uses is inert.
So **capability and token additions ship server-first**; **client-driven
semantics that reinterpret existing wire data ship client-first**.

| # | Contract | Client item | Server item | Order | Why |
| --- | --- | --- | --- | --- | --- |
| X-1 | Group E2EE control plane | C-10 | S-12 | **server-first** | The client must not emit group-control frames a node will reject. The daemon's authority, outbox, and replay guard must be live and advertised before the client's journey turns on. |
| X-2 | Server-history search | C-05 | S-06 | **server-first** | A search command the daemon does not implement returns an error to the user. The daemon must advertise the capability first. |
| X-3 | Simulcast layer selection | C-12 | S-16 | **server-first** | The SFU must be able to select a layer before publishers send more than one, or the extra layer is pure waste. |
| X-4 | Operator desk surfaces | C-03, C-18 | S-04, S-09 | **server-first** | Ward, flood, and mesh introspection must be queryable before a UI can render them. |
| X-5 | Mesh-wide presence | C-15 | S-08 | **server-first** | Cross-node presence is a daemon-side CRDT question; the client renders whatever converges. |
| X-6 | Stable thread keys | C-22 | S-03 | **server-first** | A thread identity that does not survive a node change is worse than no threading. |
| X-7 | Multi-device DM directory | C-11 | S-13 | **server-first** | Device directory entries are `PROP` metadata the daemon must accept and replicate. |
| X-8 | Notification decision trace | C-06 | — | **client-only** | Reads existing local state. Listed here only to record that it needs nothing from the daemon. |
| X-9 | NAMES burst semantics | C-02 | S-02 | **client-first** | The append-vs-replace rule is a client interpretation of existing `353` traffic. Fixing it does not need a wire change, and the client must be correct before the daemon changes burst timing. |
| X-10 | Cross-device continuity | C-29 | S-19 | **server-first** | Requires a daemon-side handoff token the client then consumes. |

**Contract verification.** Both repos already ship a machine-readable contract:
`onyx-server/docs/reference/protocol/onyx-client-contract.v1.json` and
`onyx-client-contract.v2.json`, checked from this repo by
`pnpm check:server-contract` and `pnpm check:server-contract-v2`
(see `package.json`). Every row above must be reflected in the v2 contract before
its client item is marked done.

## Gates

No item in this file is done without the repository's existing gates. From
[`PRODUCT_OVERHAUL_ROADMAP.md`](PRODUCT_OVERHAUL_ROADMAP.md) § 10, and matching
`package.json`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm check:server-contract-v2
```

Plus, for any item touching a wire-dependent claim, current server-contract
verification against the running daemon — not against a document.

Deployment remains a separate, explicit operator decision. Nothing in this
roadmap authorizes writing `out/`, changing production nginx, restarting
services, or pushing to a public remote.

## Related docs

- [`docs/features/GAME-CHANGERS-50.md`](features/GAME-CHANGERS-50.md) — the **client view** of a cross-repo 50-feature catalog spanning this client and the Onyx Server daemon (15 `Both` · 20 `Server` · 15 `Client`). Five of its Top-10 must-ship-for-0.7 items need client work; the structural entries are the 18,225-line `src/lib/store/store.ts` strangler (**= C-02/C-20**), the missing extension sandbox host (**= C-25**), and the vault's absent at-rest encryption (no existing item). Note its own retraction: ~20 of the 50 restate roadmap items and should be read as implementation plans for them, not as new scope. Master catalog with full per-feature detail: [`onyx-server/docs/features/GAME-CHANGERS-50.md`](../../onyx-server/docs/features/GAME-CHANGERS-50.md).
