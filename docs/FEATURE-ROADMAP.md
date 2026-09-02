<!-- SPDX-FileCopyrightText: 2026 Devin Brown <devin.kyle.brown@gmail.com> -->
<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Onyx Client 0.7 — Feature Roadmap

This is the **client-half planning index** for the 0.7 release.

For the authoritative cross-repo view (daemon P0/P1/P2, drift reconciliation,
exit criteria, and all document links), see:

> **[`onyx-server/docs/FEATURE-ROADMAP.md`](../../onyx-server/docs/FEATURE-ROADMAP.md)**

---

## Client P0 — tag blockers

| # | Item | Owner | Gate |
| --- | --- | --- | --- |
| **C-01** | Full identity surface (WHOIS → profile). Account, cloaked host, E2EE key, local note, presence — one component, one data path. In-flight: `WhoisSheet.tsx` (+43), `PeopleProfileCard.tsx` (+14). | `onyx-ui` (`onyx-irc` data path) | `pnpm typecheck && pnpm test` |
| **C-02** | Store strangler — first three domains (connection, roster, messages). Extract behind facades; `store.ts` shrinks; NAMES append guard and `useStore` reactivity contract preserved. | `onyx-store` | `pnpm typecheck && pnpm test` |
| **C-10** | Group E2EE product path. Room owner enables encryption, sees exact member+device set, re-key on member removal, fail-closed on seal failure. **Server S-12 is DONE — this item is now unblocked.** | `onyx-crypto` | `pnpm typecheck && pnpm test && pnpm check:server-contract-v2` |

---

## Client P1 — targeted for 0.7

| # | Item | Owner | Gate |
| --- | --- | --- | --- |
| [C-03](ROADMAP-2026-Q4.md#c-03--operator-desk) | Operator desk (ward list, flood verdicts, mesh health, audit trail) | `onyx-ui` (`onyx-irc`) | `pnpm typecheck && pnpm test` |
| [C-04](ROADMAP-2026-Q4.md#c-04--call-surface-completion) | Call surface: quality indicators, active-speaker ordering, codec-failure state | `onyx-media` | `pnpm typecheck && pnpm test` |
| [C-05](ROADMAP-2026-Q4.md#c-05--search-that-scales-past-the-vault) | Search: server-history path via S-06 (server-first) | `onyx-vault` | `pnpm typecheck && pnpm test && pnpm check:server-contract-v2` |
| [C-06](ROADMAP-2026-Q4.md#c-06--notification-decision-surface) | "Why was I (not) notified" trace surface | `onyx-notify` | `pnpm typecheck && pnpm test` |
| [C-07](ROADMAP-2026-Q4.md#c-07--accessibility-from-css-coverage-to-a-tested-contract) | A11y: focus-trap + live-region primitives replacing conventions | `onyx-a11y` | `pnpm typecheck && pnpm test` |
| [C-09](ROADMAP-2026-Q4.md#c-09--public-roadmap-honesty-pass) | Roadmap cross-link honesty pass | `doc-writer` | (manual) |
| [CL-01…CL-06](ROADMAP-2026-Q4.md#release-track--polish-cl-xx) | Polish track (command discoverability, a11y enforcement, dead surfaces) | `solidjs-coder` · `onyx-a11y` | `pnpm typecheck && pnpm lint && pnpm test` |
| [CP-01…CP-06](ROADMAP-2026-Q4.md#release-track--performance-cp-xx) | Performance track (render budget, bundle budget, store cost) | `onyx-perf` | `pnpm typecheck && pnpm test && pnpm build` |

---

## Client P2 — opportunistic

Full descriptions in [`ROADMAP-2026-Q4.md`](ROADMAP-2026-Q4.md).

[C-08](ROADMAP-2026-Q4.md#c-08--render-budget-under-windowing) render budget ·
[C-11](ROADMAP-2026-Q4.md#c-11--multi-device-dm-parity) multi-device DM parity ·
[C-13](ROADMAP-2026-Q4.md#c-13--vault-retention-and-storage-pressure-ux) vault retention UX ·
[C-15](ROADMAP-2026-Q4.md#c-15--presence-and-typing-at-mesh-scale) presence at mesh scale ·
[C-16](ROADMAP-2026-Q4.md#c-16--composer-rich-input-parity) composer rich input ·
[C-18](ROADMAP-2026-Q4.md#c-18--oper-desk-mesh-operations) oper desk mesh operations ·
[C-19](ROADMAP-2026-Q4.md#c-19--pwa-update-and-offline-correctness) PWA offline correctness.

---

## Era-3 game-changers and product phases

- **Era-3 game-changers (40 items):** [`docs/era3-40-game-changers.md`](era3-40-game-changers.md) — acceptance ledger. None required for 0.7.
- **Cross-repo 50 game-changers:** [`docs/features/GAME-CHANGERS-50.md`](features/GAME-CHANGERS-50.md) — GB/GS/GC-01…50 spanning daemon and client (15 `Both` · 20 `Server` · 15 `Client`); Top-10 must-ship-for-0.7 shortlist. Carries a **declared overlap table** against `INVENTED-FEATURES-CATALOG.md` F-01…F-68 (see § Relationship to F-01…F-68). Master catalog: [`onyx-server/docs/features/GAME-CHANGERS-50.md`](../../onyx-server/docs/features/GAME-CHANGERS-50.md).
- **Product overhaul phases (P0–P6):** [`docs/PRODUCT_OVERHAUL_ROADMAP.md`](PRODUCT_OVERHAUL_ROADMAP.md)
- **Desktop / packaging / signing:** [`docs/PUBLIC_LAUNCH_ROADMAP.md`](PUBLIC_LAUNCH_ROADMAP.md)

---

## Cross-cutting wire contracts

The safety rule: capability and token additions ship **server-first**; client-driven reinterpretations of existing wire data ship **client-first**.

Full tables: [`ROADMAP-2026-Q4.md` § Cross-cutting](ROADMAP-2026-Q4.md#cross-cutting-client--server-wire-contracts).

Key 0.7 contracts for the client:

| ID | Description | Order | 0.7 status |
| --- | --- | --- | --- |
| X-1 | Group E2EE group-control | server-first | Server DONE · client C-10 |
| X-4 | Operator introspection events | server-first | Server P1 · client C-03/C-18 |
| X-9 | NAMES burst semantics | client-first | Client C-02 |
| X-11 | Command metadata surface | server-first | Server L-04 · client C-33 |

Contract verification: `pnpm check:server-contract` and `pnpm check:server-contract-v2`.
