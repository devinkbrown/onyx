# Onyx desktop host (Zig + Native SDK)

Minimal **Zig** desktop shell that loads the **same** SolidJS/Vite SPA
(`pnpm build` → `dist/`). No Tauri, Electron, or Rust host.

Onyx host/application code is **Zig**. The Native SDK platform backend still
includes **native platform glue**, and the Windows cross-build compiles SDK
**C++ WebView2** sources (plus `WebView2Loader.dll`). That C++ lives in the
SDK backend, not in Onyx application sources — state it honestly; do not claim
“no C++ WebView wrapper” for the full dependency stack.

This is a **system WebView** host (macOS WKWebView / Linux WebKitGTK 6 /
Windows WebView2). It does **not** claim Chromium/CEF engine parity.

Public-launch tracking: **[`PUBLIC_LAUNCH_ROADMAP.md`](./PUBLIC_LAUNCH_ROADMAP.md)**.

| Piece | Path |
|-------|------|
| Manifest | `app.zon` (`.version` currently `0.1.3`) |
| Host entry | `desktop/main.zig` (Native SDK: macOS/Linux/Windows) |
| Host runner | `desktop/runner.zig` (from `@native-sdk/cli` vite scaffold) |
| BSD host | `desktop/bsd_host.zig` (Zig-native FreeBSD/OpenBSD; GTK/WebKitGTK dlopen) |
| Build graph | `build.zig` / `build.zig.zon` (CLI `--full` Vite scaffold, adapted) |
| Frontend | existing repo root (not a forked `frontend/`) |
| Surface detect | `src/lib/platform.ts` (`browser` \| `pwa` \| `zig-desktop`) |

Docs: [Frontend](https://native-sdk.dev/frontend) · [Security](https://native-sdk.dev/security) · [Web engines](https://native-sdk.dev/web-engines)

## Client surfaces (`platform.ts`)

| Surface | Detection | Label |
|---------|-----------|--------|
| `browser` | default tab | Browser |
| `pwa` | `matchMedia('(display-mode: standalone)')` or iOS `navigator.standalone` | Installed PWA |
| `zig-desktop` | `window.zero` bridge **or** packaged origin `zero://app` | Zig + Native SDK system WebView |

Capability matrix (`capabilitiesForSurface`): `bridge`, `notifications`,
`deepLinks`, `windowControls`, `updater`, `secureStorage` — **all false** for
the minimal host. Runtime code does **not** hardcode scaffold/progress claims
(e.g. no `desktopHostScaffolded`); launch honesty lives in the roadmap.

## Package target and version (`build.zig`)

- **`-Dpackage-target`** optional. When omitted, the package target **defaults
  to the selected native platform**: `macos` / `linux` / `windows` from
  `-Dplatform` / auto host OS. There is **no** hardcoded macOS package default.
- **`-Dplatform=null`** is **not packageable**. `zig build package` without an
  explicit `-Dpackage-target=…` fails with a clear error; other steps may still
  configure for diagnostics.
- **Output path** uses the **app.zon version** (parsed from `.version = "…"`,
  fallback `0.1.3`), not a stale `0.1.0`:

  `zig-out/package/onyx-<version>-<target>-<optimize>[.app]`

  Example: `zig-out/package/onyx-0.1.3-linux-ReleaseFast`

## What is achieved

- Coherent Native SDK **WebView frontend** host scaffold for Onyx.
- Declared platforms in `app.zon`: **macos, linux, windows** (system WebView).
- Production source: packaged assets from `dist/` via **`zero://app` only**
  (`frontend.productionSource` / explicit `.origin = "zero://app"`).
  **`zero://inline` is not allowed** — productionSource does not require it.
- Packaged asset resolution is executable-relative: Linux/Windows
  `bin/onyx[.exe]` resolves the sibling `resources/dist/`, macOS
  `Contents/MacOS/onyx` resolves `Contents/Resources/dist/`, and source-tree
  runs fall back to the repository `dist/`. Launching an installed binary no
  longer depends on its process working directory.
- The pinned Native SDK patch loads packaged assets through **`zero://app/`**
  while still serving the configured `index.html` entry. This keeps SPA router
  location `/`; loading `zero://app/index.html` leaves Solid Router unmatched
  and produces a background-only window.
- Dev source: `NATIVE_SDK_FRONTEND_URL` + existing Vite on
  **`http://127.0.0.1:3000`** (exact allowlisted origin; no path).
- External links: **deny** in **both** `app.zon` and runtime
  `SecurityPolicy` in `desktop/main.zig` (not one side only).
- Manifest capabilities: `webview` only (no elevated bridge commands yet).
- Client-side surface detection + non-optimistic capability matrix tests.
- Package scripts: `desktop:build` / `test` / `dev` use **host-native**
  `zig build` (auto platform). Explicit `desktop:*:linux` and
  `desktop:*:null` diagnostics exist separately.
- Honest status: **signed multi-platform installers, updater, and notarization
  are not done.** Public unsigned packages currently available: Windows zip,
  Linux tar.gz, and FreeBSD/OpenBSD one-install tarballs (`install.sh`) via
  site-local `/download/` staging. Separate macOS Intel and Apple Silicon DMGs
  remain planned and are shown as coming soon until real Darwin-built artifacts
  are staged.
- **Windows x86_64 unsigned zip lane (v0.1.3):** `pnpm desktop:release:windows`
  (`tools/release-windows.mjs`) runs Native SDK `native package` via
  `zig build package -Dplatform=windows -Dtarget=x86_64-windows`, then
  fail-closed layout validation + deterministic zip + SHA-256. The zip includes
  the pinned full Microsoft WebView2 Evergreen Standalone Installer (x64),
  its SHA-256, and `Install-and-Run-Onyx.cmd`; it does not need to fetch the
  runtime from the network. **Not** an MSI/EXE installer. **Windows GUI runtime
  is not verified on a real Windows machine** in this lane.
- **Linux x86_64 unsigned tar.gz lane (v0.1.3):** `pnpm desktop:release:linux`
  (`tools/release-unix.mjs linux`) runs Native SDK package for system
  WebView (WebKitGTK 6 + GTK 4), fail-closed ELF x86_64 +
  `package-manifest.zon` (target/version/optimize) + SPA resources, then
  one tar.gz + SHA-256 + embedded notice. Its fail-closed `install.sh` resolves
  distro-managed GTK4/WebKitGTK 6 packages through apt, dnf, or pacman and
  supports `--prefix`, `--no-deps`, `--dry-run`, and `--help`. **Not**
  AppImage/Flatpak/deb; the runtime libraries remain distro-managed. On the
  current Linux verification host, the packaged binary was launched under
  Xvfb from a working directory with no `dist/`: WebKitGTK opened the packaged
  HTML/JS/CSS, the Solid landing route rendered, and the window produced a
  nonblank Onyx capture. This is a real WebKitGTK/GTK runtime smoke, not proof
  of a physical interactive desktop session.
- **FreeBSD / OpenBSD native Zig host (v0.1.3):** `pnpm desktop:release:freebsd`
  / `pnpm desktop:release:openbsd` — cross-compile `desktop/bsd_host.zig` to
  `x86_64-freebsd` / `x86_64-openbsd`, stage `bin/onyx` + `resources/dist` +
  idempotent `install.sh`, validate ELF machine + PT_INTERP OS identity +
  launch contract + installer content, then one unsigned tar.gz + SHA-256.
  Runtime **dlopen**s a matching toolkit pair only (GTK4+webkitgtk-6.0 or
  GTK3+webkit2gtk-4.x; never mixed), runs **GtkApplication** +
  `g_application_run`, and serves SPA assets from a **loopback-only** fixed-port
  HTTP server at `http://127.0.0.1:42691/app` (not `file://`, never ephemeral).
  Port **42691** is product-stable for localStorage/IndexedDB/session-resume
  origin; bind failure is fail-closed single-instance (no alternate port).
  **`install.sh` auto-installs only the primary GTK4 pair:** FreeBSD
  `gtk4`+`webkit2-gtk_60`; OpenBSD `gtk+4`+`webkitgtk60`. Default
  `PREFIX=/usr/local`; supports `--prefix`, `--no-deps`, `--dry-run`, `--help`;
  never curl-pipes; root/network only for automatic system package install.
  Host still accepts secondary GTK3 pairs at runtime if already present.
  **Not** Native SDK; **not** portable-web/PWA; **not** codesigned. Cross-build
  on Linux validates ELF/package layout only — **does not claim GUI launch**
  on real FreeBSD/OpenBSD from this host. Public surface: `/download/` + optional
  `pnpm desktop:stage-release-downloads` → `dist/downloads/v0.1.3/` (deploy only
  when `ONYX_STAGE_RELEASE_DOWNLOADS=1`; publish fail-closed with
  `ONYX_PUBLISH_RELEASE_DOWNLOADS=1` requiring all six public lanes
  windows+linux+macos-x86_64+macos-arm64+freebsd+openbsd).
  Legacy aliases: `desktop:stage-bsd-downloads` / `ONYX_*_BSD_DOWNLOADS`.
- **macOS unsigned DMG lanes (v0.1.3):** `pnpm desktop:release:macos` runs
  **only on Darwin** and **fails closed** on Linux/other hosts (never
  fabricates a `.app`/DMG without a real Mac + Apple tools). Architecture is
  **host-derived** from `process.arch` (`x64`→`x86_64`, `arm64`→`arm64`); no
  CLI arch override that can lie about the host. Produces Native SDK WKWebView
  `.app` + unsigned DMG when green:
  - Intel: `onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg` under
    `zig-out/release/macos-x86_64/`
  - Apple Silicon: `onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg` under
    `zig-out/release/macos-arm64/`
  GitHub Actions `workflow_dispatch` matrix
  `.github/workflows/macos-release.yml` on official `macos-15-intel` (x86_64)
  and `macos-15` (arm64) with matching Zig tarballs (exact pin from
  `.zigversion`). Staging copies pre-built DMGs into
  `dist/downloads/v0.1.3/` — it never builds macOS on Linux.

## What is not done

- Code signing (Authenticode / Apple codesign), notarization, auto-updater,
  store installers (AppImage/Flatpak/MSI/etc.). Site-local unsigned six-lane
  staging exists; live publish needs built v0.1.3 artifacts under
  `zig-out/release/` for all of windows+linux+macos-x86_64+macos-arm64+freebsd+openbsd
  (macOS from matching-arch Darwin / GHA matrix only).
- Verified Windows GUI launch on real Windows hardware/VMs.
- Interactive Linux launch on a physical desktop session (the connected gate
  below is headless Xvfb with the real GTK4/WebKitGTK6 stack).
- Verified macOS GUI launch / Gatekeeper path on real Apple hardware
  (**blocker for local Linux host:** package/DMG must be produced on Darwin —
  use `macos-release.yml` matrix (`macos-15-intel` + `macos-15`) or a real Mac;
  still unsigned/unnotarized).
- Verified FreeBSD/OpenBSD GUI launch on real BSD hardware/VMs (cross-build
  on Linux only proves ELF OS/machine + package layout).
- Extra native permissions (filesystem, notifications bridge, etc.).
- Chromium/CEF path (`-Dweb-engine=chromium`) — **out of scope** for this
  scaffold; build graph still panics chromium unless macOS when forced.

## Currently verified boundary (this machine / tree)

| Check | Status |
|-------|--------|
| `app.zon` validates (`native validate`) | **PASS** after corrections |
| `native check` structural | **PASS** (web layer included via `.frontend`) |
| TS surface tests + typecheck + web `pnpm build` | **PASS** when gates are run green |
| Package target/version graph defaults | **Configured** in `build.zig` (no macOS hardcode; version from `app.zon` / `0.1.3`) |
| Zig **0.17.0-dev** pin `build -Dplatform=null` | **PASS** (compile + install of null backend) with pinned SDK patch |
| Zig **0.17.0-dev** pin `build test -Dplatform=null` | **PASS** |
| Zig **0.17.0-dev** pin `build/test -Dplatform=linux` | **PASS** with the exact pin, GTK 4.22.4, and WebKitGTK 6.0 / 2.52.5 on this host |
| Zig **0.17.0-dev** pin x86_64-windows cross-build | **PASS** artifact production (`onyx.exe` + `WebView2Loader.dll`); offline runtime installer is hash-verified, GUI launch is **not verified** here |
| `pnpm desktop:release:windows` | **Tooling present** — unsigned zip with pinned full offline WebView2 x64 installer + install-and-run command; Windows GUI runtime **not** verified here |
| `pnpm desktop:release:linux` | **PASS** — one unsigned tar.gz with `install.sh` after ELF/manifest/resources validation; apt/dnf/pacman resolve distro-managed GTK4 + WebKitGTK 6 |
| Packaged Linux WebKit runtime from unrelated cwd | **PASS under Xvfb** — executable-relative `resources/dist`; packaged HTML/modules/CSS opened; Solid route rendered at `zero://app/`; nonblank Onyx window capture |
| `pnpm desktop:release:freebsd` / `:openbsd` | **Tooling present** — Zig-native `bsd_host` x86_64 ELF + `resources/dist` tar.gz; runtime needs GTK/WebKitGTK on BSD; **GUI not claimed** from Linux cross-build |
| `pnpm desktop:release:macos` | **Fail-closed on non-Darwin** — host arch → `macos-x86_64` or `macos-arm64`; GHA matrix `macos-15-intel` + `macos-15`; unsigned/unnotarized |
| GUI launch on real FreeBSD/OpenBSD / signing / updater | **Not done / not verified** |
| Public `/download` six-lane staging (win/linux/macos×2/bsd) | **Tooling present** (`stage-release-downloads`; binaries not in git; publish requires all six) |

### Linux GUI link dependency

System WebView path links:

- **GTK 4** (`gtk4` pkg-config) — required
- **WebKitGTK 6.0** (`webkitgtk-6.0` / `libwebkitgtk-6.0`) — required for the
  real system-WebView Linux package (older `webkit2gtk-4.1` is **not** enough)

### Zig toolchain (pinned) — newest Zig retrofit

- **Supported / pinned (exact only):** **Zig `0.17.0-dev.1476+91a29d707`**
  (`.zigversion` is the source of truth; also `build.zig.zon`
  `minimum_zig_version`). Wrapper: `tools/desktop-zig.mjs` (`ONYX_ZIG` or
  PATH) accepts **only** that exact `zig version` string — not other
  `0.17.0-dev.*` snapshots. It does **not** download or install Zig.
- Native SDK **`@native-sdk/cli@0.6.2`** is applied via **pnpm
  `patchedDependencies`**: checked-in
  `patches/@native-sdk__cli@0.6.2.patch` (durable artifact). The patch
  retrofits removed Zig 0.17 `**` array/string repetition to typed `@splat`
  (and explicit comptime multi-byte fill only where needed) plus the removed
  `errdefer |err|` payload capture in the app-start path. It also loads the
  configured Linux asset entry through the custom-scheme root
  (`zero://app/`) so client routers see `/`. **No** global regex rewrite
  script is shipped or invoked at install/build time.
- Repo `build.zig` targets Zig **0.17** build APIs (`graph.release_mode`,
  `pathFromRoot` via root join, local sysroot, PATH-based Run path dirs).
  Zig **0.16.x is not supported** for this host tree.
- This tree does **not** vendor the Zig compiler. Build with the official pin
  and **isolated** cache dirs, e.g.:

  ```bash
  export ONYX_ZIG=/path/to/zig-0.17.0-dev.1476+91a29d707/zig
  export ZIG_LOCAL_CACHE_DIR="$PWD/.zig-cache/onyx-zig017-local"
  export ZIG_GLOBAL_CACHE_DIR="$PWD/.zig-cache/onyx-zig017-global"
  pnpm desktop:build:null
  pnpm desktop:test:null
  ```

Chromium/CEF remains optional/macOS-gated in the ejected `build.zig` and is
**not** the product path for this scaffold (system WebView only; no
Chromium-parity claim).

## Commands

```bash
pnpm install                       # applies patched @native-sdk/cli@0.6.2
pnpm build                         # SPA → dist/
pnpm desktop:validate              # native validate app.zon
pnpm desktop:doctor                # host WebView / GTK checks
pnpm desktop:check                 # native check (structural)
pnpm desktop:build                 # zig build (auto platform; needs Zig 0.17 pin)
pnpm desktop:test                  # zig build test (auto platform)
pnpm desktop:dev                   # zig build dev (Vite + shell when host links)
pnpm desktop:build:null            # zig build -Dplatform=null (no WebKit link)
pnpm desktop:test:null             # zig build test -Dplatform=null
pnpm desktop:build:linux           # zig build -Dplatform=linux (diagnostic)
pnpm desktop:test:linux            # zig build test -Dplatform=linux (diagnostic)
pnpm desktop:build:windows         # cross-build x86_64-windows (artifact only)
pnpm desktop:package:windows       # zig build package for windows (Native SDK dir under zig-out/package/)
# Download the official full x64 standalone runtime installer to:
#   zig-out/runtime-cache/MicrosoftEdgeWebView2RuntimeInstallerX64.exe
# The release tool verifies its pinned SHA-256 and MZ/size gates before packaging.
# ONYX_WEBVIEW2_RUNTIME_X64 may point to the same verified installer elsewhere.
pnpm desktop:release:windows       # package + fail-closed validate + unsigned zip + SHA-256
#   outputs: zig-out/release/windows-x86_64/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.{zip,sha256,NOTICE.txt}
#   includes runtime/MicrosoftEdgeWebView2RuntimeInstallerX64.exe + pinned SHA-256
#   includes Install-and-Run-Onyx.cmd; Windows GUI runtime NOT verified on real Windows.
pnpm desktop:package:linux         # zig build package -Dplatform=linux (Native SDK dir)
pnpm desktop:release:linux         # package + ELF/manifest/resources validate + tar.gz + SHA-256
#   outputs: zig-out/release/linux-x86_64/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.{tar.gz,sha256,NOTICE.txt}
#   includes install.sh for apt/dnf/pacman runtime resolution; supports --prefix/--no-deps/--dry-run
pnpm desktop:build:freebsd         # zig build bsd-host -Dbsd-os=freebsd → zig-out/bsd/freebsd-x86_64/onyx
pnpm desktop:build:openbsd         # zig build bsd-host -Dbsd-os=openbsd → zig-out/bsd/openbsd-x86_64/onyx
pnpm desktop:test:bsd              # zig build bsd-test (pure logic; host-native)
pnpm desktop:release:freebsd       # cross-build + stage bin/onyx + resources/dist + tar.gz + SHA-256
pnpm desktop:release:openbsd       # same for OpenBSD
#   outputs: zig-out/release/{freebsd,openbsd}-x86_64/onyx-0.1.3-*-x86_64-ReleaseFast-unsigned.{tar.gz,sha256,NOTICE.txt}
#   GUI launch NOT claimed when packaging from Linux; run bin/onyx on real BSD with a matching GTK+WebKit pair.
pnpm desktop:package:macos         # zig build package -Dplatform=macos (Darwin only)
pnpm desktop:release:macos         # .app + unsigned DMG — FAILS CLOSED on non-Darwin (no fake macOS assets)
#   arch from process.arch (x64→x86_64, arm64→arm64); no --arch override
#   outputs (on matching Mac / GHA matrix only):
#     zig-out/release/macos-x86_64/onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.{dmg,sha256,NOTICE.txt}
#     zig-out/release/macos-arm64/onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.{dmg,sha256,NOTICE.txt}
#   workflow: .github/workflows/macos-release.yml (workflow_dispatch; matrix intel+arm64)
#   staging may copy those DMGs on Linux; it never builds/fabricates them.
pnpm desktop:stage-release-downloads         # optional: copy unsigned win/linux/macos×2/bsd → dist/downloads/v0.1.3/
pnpm desktop:stage-release-downloads:publish # same with --require (all six public lanes must exist)
#   deploy only when ONYX_STAGE_RELEASE_DOWNLOADS=1; publish fail-closed ONYX_PUBLISH_RELEASE_DOWNLOADS=1
#   legacy aliases: desktop:stage-bsd-downloads* / ONYX_*_BSD_DOWNLOADS
# Package other hosts (diagnostic):
# zig build package                # target defaults to host platform; version from app.zon
# zig build package -Dpackage-target=linux
```

Native CLI comes from devDependency `@native-sdk/cli@0.6.2` plus the
checked-in pnpm patch (`pnpm exec native …` or scripts that resolve
`node_modules/.bin`).

## Security notes (minimal host)

- Main-frame navigation allowlist: **`zero://app`**, **`http://127.0.0.1:3000`**.
- External links: **deny** in manifest **and** runtime policy.
- No custom bridge commands; builtin bridge stays default-deny.
- When installers ship, re-open external-link policy only for concrete HTTPS
  prefixes (docs, account, status) and add matching `permissions` /
  `builtin_bridge` entries — see the security doc.

## SPA invariants

- Keep `vite` `build.outDir: 'dist'`.
- Do not point builds at `out/` (only `deploy.sh` writes production `out/`).
- Same routes, assets, and tests for browser, PWA, and zig-desktop host.
- Packaged entry URL stays `zero://app/` so the browser router starts at `/`;
  `index.html` remains an implementation entry file, not a public route.
- Vite dev port **3000** (`strictPort: true`) matches the host allowlist.
