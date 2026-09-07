# UI performance budget ratchet

Onyx measures named production payload boundaries after Vite has built `dist/`.
The ratchet is intentionally separate from the build: it can inspect real output
or a fixture tree, and it never changes the baseline automatically.

## Run it

Until the shared `package.json` is available for a script entry, invoke the
checks directly from the repository root:

```bash
pnpm build
node tools/check-ui-budgets.mjs
pnpm exec vitest run tools/check-ui-budgets.test.mjs
```

The budget command consumes the existing build. It does **not** run Vite. For a
measurement-only report or a fixture/output directory, use:

```bash
node tools/check-ui-budgets.mjs --measure-only --json
node tools/check-ui-budgets.mjs --dist path/to/dist --baseline path/to/baseline.json
```

## What is measured

The tool prefers Vite's `.vite/manifest.json` when present. The normal Onyx
build currently emits only `index.html` plus `assets/`, so the equivalent output
classifier reads the module script, stylesheet, module-preload links, and named
emitted chunks. `dist/manifest.json` is the PWA manifest and is deliberately not
treated as a Vite chunk manifest.

| Boundary | Classification |
| --- | --- |
| Total eager JS | Entry module plus every JavaScript file in its static manifest closure / every HTML module preload |
| Total eager CSS | Every stylesheet in the entry's static manifest closure / every initial HTML stylesheet |
| Eager index JS | The Vite entry file / module script in `index.html` |
| Eager index CSS | CSS attached to the Vite entry / stylesheet in `index.html` |
| Shared runtime JS | Emitted `runtime` chunk |
| AppShell JS and CSS | Emitted `AppShell` route chunk and its CSS |
| Optional/lazy media JS | Emitted `media` chunk plus `videoEncodeWorker` |

The total eager roles are the enforcement backstop: arbitrary vendor chunks and
CSS attached to static imports remain counted even when their filenames change.
The index, runtime, shell, and media roles intentionally overlap those totals as
smaller diagnostic boundaries. When a Vite manifest is available, the tool walks
the entry's static import closure and fails if a media artifact enters that eager
graph. Emitted output is also scanned so worker files that Vite omits from the
chunk manifest cannot escape accounting. Missing roles, missing referenced
files, changed artifact counts, and malformed baselines fail closed with a
specific diagnostic.

Each artifact is read once and recorded with raw bytes, gzip bytes, and SHA-256.
Gzip is always Node's `gzipSync` at level 9; this makes local, fixture, and CI
results comparable instead of relying on Vite's display rounding or host tools.
The report digest includes the role, normalized path, byte counts, and content
hash in a stable role/path order.

## Current baseline and ceilings

The earlier architecture packet was useful directional evidence: it recorded
AppShell JS at 432.26 KiB raw / 128.87 KiB gzip, runtime JS at 360.70 / 106.08
KiB, and AppShell CSS at 257.51 / 37.88 KiB. Those values were not copied into
the ratchet. The checked-in baseline below is a reviewed post-commercial-overhaul measurement from a fresh production build. Route-only and app-only work is isolated, eager JS/CSS dropped substantially, optional media remains bounded, and AppShell/runtime values reflect the intentionally expanded commercial surface:

| Boundary | Files | Baseline raw | Baseline gzip | Raw ceiling | Gzip ceiling |
| --- | ---: | ---: | ---: | ---: | ---: |
| Total eager JS | 3 | 108,813 B | 37,042 B | 114,254 B | 38,895 B |
| Total eager CSS | 2 | 73,021 B | 15,853 B | 76,673 B | 16,646 B |
| Eager index JS | 1 | 28,740 B | 11,256 B | 30,177 B | 11,819 B |
| Eager index CSS | 2 | 73,021 B | 15,853 B | 76,673 B | 16,646 B |
| Shared runtime JS | 1 | 502,674 B | 143,790 B | 527,808 B | 150,980 B |
| AppShell JS | 1 | 481,487 B | 144,426 B | 505,562 B | 151,648 B |
| AppShell CSS | 1 | 349,702 B | 51,962 B | 367,188 B | 54,561 B |
| Optional/lazy media JS | 2 | 123,704 B | 36,576 B | 129,890 B | 38,405 B |

Every raw and gzip ceiling is exactly `Math.ceil(baseline * 1.05)`. The 5%
headroom catches meaningful growth without making content-hash or compression
noise a reason to rewrite the baseline. Both raw and gzip ceilings must pass.

## Reviewing a deliberate change

Do not update `docs/ui-performance-baseline.json` merely to make a failure
green. First identify the dependency or CSS that moved, confirm the eager/lazy
boundary is still correct, and record why the increase is necessary. Then:

1. Build once from the reviewed source with `pnpm build`.
2. Capture `node tools/check-ui-budgets.mjs --measure-only --json`.
3. Update baseline bytes, artifact names/hashes, and the build digest from that
   report.
4. Recompute each ceiling with `Math.ceil(bytes * 1.05)`.
5. Run the fixture tests and the enforcing command.

The tool reports the overage, prior baseline, percentage delta, and a boundary-
specific remediation hint. A smaller result passes without rewriting history;
intentional reductions should be pinned in a separate reviewed baseline change
so the ratchet tightens.
