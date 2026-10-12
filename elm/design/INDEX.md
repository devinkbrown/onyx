# Onyx v3 (Elm) — design and status docs

Start here. Each document answers one question; the table says which. The Elm client in `elm/`
is the product. The SolidJS client was removed from the tree; it survives only as the behavioural
oracle the maps compare against, at the annotated git tag `solid-client-final`
(`git show solid-client-final:src/<path>`; every `src/…` path cited in these documents points
there).

| If you want to know… | Read | What it is |
|---|---|---|
| Where the build stands and what is next | [`../V3_ROADMAP.md`](../V3_ROADMAP.md) | The phase-by-phase build-out plan with one status per row, today's gate numbers, and the open work. |
| How the shell, pages and Elm code should be shaped | [`V3_DESIGN_DIRECTION.md`](V3_DESIGN_DIRECTION.md) | The design direction: information architecture (five destinations), layout per viewport, Home and catch-up, onboarding, the visual system, and the Elm architecture rules. |
| How voice, video, stage and Watch Together should look and behave | [`calls/CALLS_DESIGN.md`](calls/CALLS_DESIGN.md) and [`calls/prototype.html`](calls/prototype.html) | The calls interface spec (surfaces, states, copy, keyboard, live regions, data contract, slice plan C1–C12, open product questions) and a static dark prototype with a state switcher. |
| Whether a feature of the removed Solid client exists in Elm and how complete it is | [`CLIENT_PARITY_MAP.md`](CLIENT_PARITY_MAP.md) | The client map: every user-facing capability of the Solid client, one row each (FULL / PARTIAL / CORE-ONLY / MISSING / N/A), with `file:line` evidence, the Top-30 gaps, the "Elm is better" list and the **Remaining gaps** section. |
| Whether an Onyx Server command, capability, numeric or reply is supported by Elm | [`SERVER_FEATURE_MAP.md`](SERVER_FEATURE_MAP.md) | The server map: every client-reachable server feature with its Elm status, cross-cutting defects, a scorecard and the prioritised gap list (§22). |
| What the CSS looks like, and where it is inconsistent | [`STYLE_MAP.md`](STYLE_MAP.md) and [`style-map.json`](style-map.json) | The visual-system map: stylesheets, tokens, patterns, scales, dead rules and a consolidation plan. A snapshot at `7e03d47f` (the hand-written analysis predates the rx-\* polish slices); the generated inventory is rebuilt with `node elm/tools/style-map.mjs`. §5.4 records what the v3/css refactor changed and how it was proved (`elm/tools/css-regress.mjs`). |
| Which protocol features have Elm modules and vectors | [`../COVERAGE.md`](../COVERAGE.md) | The protocol matrix: server feature → oracle file → Elm module → status, with the narrowings (what is deliberately or still missing) per row. "done" means a user can reach it. |
| How to build, test and gate the Elm client | [`../README.md`](../README.md) | Toolchain bootstrap, gates, layout. |

## How the status docs relate

- **`CLIENT_PARITY_MAP.md`** compares *clients* (Solid → Elm) by what a user can reach. It is the
  place to look for "is feature X there?".
- **`SERVER_FEATURE_MAP.md`** compares the *server* → Elm. It is the place to look for "does the
  client speak command/numeric Y, and does a user see the reply?".
- **`COVERAGE.md`** is the engineering ledger behind both: protocol folds, ports and tests per
  feature, with the narrowings recorded where a slice stopped short.
- **`V3_ROADMAP.md`** is the plan: slices, order and status. When the maps and the roadmap
  disagree, the maps are checked against code and win; fix the roadmap.

Rule for all of them: a status is whatever the code at the cited `file:line` does. Builder
reports and older doc text are leads, not evidence. When you change behaviour, change the row.

## Regenerating and checking

- Style inventory: `node elm/tools/style-map.mjs` (rewrites `style-map.json` and the generated
  part of `STYLE_MAP.md`).
- Screens (real Chromium against a fake IRC server, 15-viewport aspect-ratio matrix):
  `node elm/tools/screens.mjs --vp all --out <dir> [--extra elm/tools/screens-*.mjs]`.
- Unstyled classes / undefined CSS variables: `node elm/tools/css-coverage.mjs` (must report 0 / 0).
- Contrast audit: `elm/tools/contrast-audit.mjs`. Real two-browser call against a throwaway local
  node: `elm/tools/call-e2e.mjs` (never the live network).
