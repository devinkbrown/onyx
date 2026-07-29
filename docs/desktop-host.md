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
| Manifest | `app.zon` (`.version` currently `0.1.2`) |
| Host entry | `desktop/main.zig` |
| Host runner | `desktop/runner.zig` (from `@native-sdk/cli` vite scaffold) |
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
  fallback `0.1.2`), not a stale `0.1.0`:

  `zig-out/package/onyx-<version>-<target>-<optimize>[.app]`

  Example: `zig-out/package/onyx-0.1.2-linux-ReleaseFast`

## What is achieved

- Coherent Native SDK **WebView frontend** host scaffold for Onyx.
- Declared platforms in `app.zon`: **macos, linux, windows** (system WebView).
- Production source: packaged assets from `dist/` via **`zero://app` only**
  (`frontend.productionSource` / explicit `.origin = "zero://app"`).
  **`zero://inline` is not allowed** — productionSource does not require it.
- Dev source: `NATIVE_SDK_FRONTEND_URL` + existing Vite on
  **`http://127.0.0.1:3000`** (exact allowlisted origin; no path).
- External links: **deny** in **both** `app.zon` and runtime
  `SecurityPolicy` in `desktop/main.zig` (not one side only).
- Manifest capabilities: `webview` only (no elevated bridge commands yet).
- Client-side surface detection + non-optimistic capability matrix tests.
- Package scripts: `desktop:build` / `test` / `dev` use **host-native**
  `zig build` (auto platform). Explicit `desktop:*:linux` and
  `desktop:*:null` diagnostics exist separately.
- Honest status: **installers, signing, updater, public downloads, and
  desktop deploy are not done.**
- **Windows x86_64 unsigned zip lane (v0.1.2):** `pnpm desktop:release:windows`
  (`tools/release-windows.mjs`) runs Native SDK `native package` via
  `zig build package -Dplatform=windows -Dtarget=x86_64-windows`, then
  fail-closed layout validation + deterministic zip + SHA-256. **Not** an
  MSI/EXE installer. **Windows runtime is not verified on a real Windows
  machine** in this lane.
- **Linux x86_64 unsigned tar.gz lane (v0.1.2):** `pnpm desktop:release:linux`
  (`tools/release-unix.mjs linux`) runs Native SDK package for system
  WebView (WebKitGTK 6 + GTK 4), fail-closed ELF x86_64 +
  `package-manifest.zon` (target/version/optimize) + SPA resources, then
  one tar.gz + SHA-256 + embedded notice. **Not** AppImage/Flatpak/deb.
- **FreeBSD / OpenBSD portable web/PWA (v0.1.2):** `pnpm desktop:release:freebsd`
  / `pnpm desktop:release:openbsd` — architecture-neutral tar.gz of the
  built `dist/` SPA plus a **127.0.0.1-only** launcher. **Not** native
  desktop hosts: **Native SDK has no BSD backend.**
- **macOS unsigned DMG lane (v0.1.2):** `pnpm desktop:release:macos` runs
  **only on Darwin** and **fails closed** on Linux/other hosts (never
  fabricates a `.app`/DMG without a real Mac + Apple tools). Produces
  Native SDK WKWebView `.app` + unsigned DMG when green.

## What is not done

- Code signing (Authenticode / Apple codesign), notarization, auto-updater,
  public download deployment, store installers (AppImage/Flatpak/MSI/etc.).
- Verified Windows GUI launch on real Windows hardware/VMs.
- Verified macOS GUI launch / Gatekeeper path on real Apple hardware
  (**blocker:** this release machine is Linux — macOS package/DMG must be
  produced on a Mac; see table below).
- Native FreeBSD/OpenBSD desktop hosts (impossible with current Native SDK
  platforms: macos/linux/windows only).
- Extra native permissions (filesystem, notifications bridge, etc.).
- Chromium/CEF path (`-Dweb-engine=chromium`) — **out of scope** for this
  scaffold; build graph still panics chromium unless macOS when forced.

## Currently verified boundary (this machine / tree)

| Check | Status |
|-------|--------|
| `app.zon` validates (`native validate`) | **PASS** after corrections |
| `native check` structural | **PASS** (web layer included via `.frontend`) |
| TS surface tests + typecheck + web `pnpm build` | **PASS** when gates are run green |
| Package target/version graph defaults | **Configured** in `build.zig` (no macOS hardcode; version from `app.zon` / `0.1.2`) |
| Zig **0.17.0-dev** pin `build -Dplatform=null` | **PASS** (compile + install of null backend) with pinned SDK patch |
| Zig **0.17.0-dev** pin `build test -Dplatform=null` | **PASS** |
| Zig **0.17.0-dev** pin `build -Dplatform=linux` | **Link unblocked** when WebKitGTK 6.0 is installed (`pkg-config webkitgtk-6.0`); still requires exact Zig pin from `.zigversion` |
| Zig **0.17.0-dev** pin x86_64-windows cross-build | **PASS** artifact production (`onyx.exe` + `WebView2Loader.dll`) — **runtime not verified** here |
| `pnpm desktop:release:windows` | **Tooling present** — `zig-out/release/windows-x86_64/onyx-0.1.2-windows-x86_64-ReleaseFast-unsigned.zip`; **unsigned**; Windows runtime **not** verified here |
| `pnpm desktop:release:linux` | **Tooling present** — one tar.gz under `zig-out/release/linux-x86_64/` after ELF/manifest/resources validation; needs WebKitGTK 6 + Zig pin |
| `pnpm desktop:release:freebsd` / `:openbsd` | **Tooling present** — portable web/PWA tar.gz only (SPA + localhost launcher); **not** native BSD hosts |
| `pnpm desktop:release:macos` | **Fail-closed on non-Darwin** — must run on a real Mac; remaining **macOS blocker** for this Linux release host |
| GUI launch / signing / updater / public downloads / deploy | **Not done / not verified** |

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
  `errdefer |err|` payload capture in the app-start path. **No** global regex
  rewrite script is shipped or invoked at install/build time.
- Repo `build.zig` targets Zig **0.17** build APIs (`graph.release_mode`,
  `pathFromRoot` via root join, local sysroot, PATH-based Run path dirs).
  Zig **0.16.x is not supported** for this host tree.
- This tree does **not** vendor the Zig compiler. Build with the official pin
  and **isolated** cache dirs, e.g.:

  ```bash
  export ONYX_ZIG=/path/to/zig-0.17.0-dev.1476+91a29d707/zig
  export ZIG_LOCAL_CACHE_DIR=/tmp/onyx-zig017-cache
  export ZIG_GLOBAL_CACHE_DIR=/tmp/onyx-zig017-global
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
pnpm desktop:release:windows       # package + fail-closed validate + unsigned zip + SHA-256
#   outputs: zig-out/release/windows-x86_64/onyx-0.1.2-windows-x86_64-ReleaseFast-unsigned.{zip,sha256,NOTICE.txt}
#   Windows runtime NOT verified on real Windows.
pnpm desktop:package:linux         # zig build package -Dplatform=linux (Native SDK dir)
pnpm desktop:release:linux         # package + ELF/manifest/resources validate + tar.gz + SHA-256
#   outputs: zig-out/release/linux-x86_64/onyx-0.1.2-linux-x86_64-ReleaseFast-unsigned.{tar.gz,sha256,NOTICE.txt}
pnpm desktop:release:freebsd       # portable web/PWA tar.gz (NOT native; no BSD Native SDK backend)
pnpm desktop:release:openbsd       # portable web/PWA tar.gz (NOT native; no BSD Native SDK backend)
#   outputs: zig-out/release/{freebsd,openbsd}-portable-web/onyx-0.1.2-*-portable-web-unsigned.tar.gz
pnpm desktop:package:macos         # zig build package -Dplatform=macos (Darwin only)
pnpm desktop:release:macos         # .app + unsigned DMG — FAILS CLOSED on non-Darwin (no fake macOS assets)
#   outputs (on Mac only): zig-out/release/macos/onyx-0.1.2-macos-ReleaseFast-unsigned.{dmg,sha256,NOTICE.txt}
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
- Vite dev port **3000** (`strictPort: true`) matches the host allowlist.
