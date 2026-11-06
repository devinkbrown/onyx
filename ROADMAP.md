# Onyx client roadmap

*Updated 2026-11-06.* The detailed plan and evidence live in
[`docs/elm-roadmap/`](docs/elm-roadmap/README.md); this page is the short
version. The July 2026 strategy document this file used to hold is in
[`docs/archive/ROADMAP-strategy-2026-07.md`](docs/archive/ROADMAP-strategy-2026-07.md).

## Where things stand

- **Shipped to eshmaki.me:** connect gate, five-destination shell, room header
  and details, grouped transcript, message menu, reactions, replies, edits,
  deletes, pins, search, media, inbox, voice calls, encrypted DMs, encrypted
  rooms, themes and Appearance, PWA with safe automatic updates, history on
  device, You > Advanced, and the public site built from real screenshots.
- **Tested:** elm-test 2895, runtime 385, Chromium mock 36, a 628-check
  Playwright audit (desktop, light, reduced motion, three phone profiles), 60
  ports smokes, deploy controller 122, foundation lab 4/4, encrypted-room lab
  8/8, live shell verification 42/42 (all at `d1025b7f`).
- **Formally accepted:** 4 of 53 roadmap packages (E00, E02, E03, E04).
  Acceptance needs receipts bound to a frozen source cut; most recent work has
  not been through that yet. "Implemented and tested" is not "accepted".

## Open work

Evidence and acceptance:

- Real-device cohorts: Safari, iOS and Android.
- Lab source provenance (blocked until onyx-server settles), then source-bound
  receipts for the session, history and group suites.
- Independent security review of device-trust review for encrypted rooms.
- Encrypted rooms with three or more members, and cross-node delivery.
- Firefox against the real lab server (mock suite: 17 of 21 passed under BiDi).

Performance:

- Emulated-mobile ingest long task (about 396 ms against a 200 ms target) and
  mobile persistence settlement.

Product gaps known in source:

- No localization layer.
- No LISTX fold; the ACCESS write path is unused.
- `AiPolicy` / `HistoryPolicy` room properties aren't wired into the UI.
- No operator dashboard.
- Home still lacks resume points, a quiet-room digest and "mark all caught up".

The ordered package view is in
[`docs/elm-roadmap/prioritized-gaps.md`](docs/elm-roadmap/prioritized-gaps.md)
and the full ledger in
[`docs/elm-roadmap/acceptance-ledger.json`](docs/elm-roadmap/acceptance-ledger.json).

## Out of scope here

Daemon work belongs to the [Onyx Server](https://github.com/devinkbrown/onyx-server)
repository. Server-side gaps that limit the client are noted in the evidence
log when they're observed.
