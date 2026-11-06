# Onyx Elm client

This directory is the Onyx product client: the Elm UI, its private TypeScript
runtime, the browser bridge, the service worker and the stylesheets. Status and
evidence live in the [Elm roadmap evidence log](../docs/elm-roadmap/README.md)
(newest first); candidate-by-candidate verification history is recorded there,
not here.

## Layout

| Path | Role |
| --- | --- |
| `src/Main.elm` | `Browser.application`; owns every port and interprets typed outbound effects. |
| `src/App.elm` | Pure model, `Msg`, `update`, and the inbound IRC line fold. |
| `src/View.elm`, `src/View/*` | App shell and public pages. |
| `src/Wire.elm`, `Session.elm`, `Isupport.elm`, `Labels.elm`, `Modes.elm`, `Ircx.elm`, `Spine.elm`, `Media.elm`, … | Pure protocol and policy modules. |
| `src/DmCipher.elm`, `Keyring.elm`, `Group*.elm` | Pure E2EE codecs and validators (no keys). |
| `runtime/` | Private TypeScript runtime (IRC socket, credentials, identity, session recovery, crypto provider, outbox, owned IndexedDB stores, media, service-worker lifecycle). Bundled to `runtime.js` as `window.OnyxRuntime`. |
| `ports.js` | Browser bridge: vault, prefs, uploads, notifications, crypto helpers, media socket. |
| `index.html` | Base document: pre-paint theme, CSS order, runtime boot. |
| `sw.js` | Service worker; the build stamps a content-addressed envelope. |
| `app.css`, `rail.css`, `convo.css`, `site.css` | Stylesheets, in cascade order. |
| `tests/` | elm-test suites. |
| `*.smoke.mjs` | `node:test` suites over the real `ports.js`. |
| `tools/` | Labs, perf, screenshots, marketing capture, roadmap runner, source manifest. |
| `marketing/` | Product screenshots for the public site. |

Per-module ownership and direct test coverage:
[`docs/elm-roadmap/module-ownership.md`](../docs/elm-roadmap/module-ownership.md).

## Toolchain

- Elm compiler **0.19.1**
- `elm-test` **0.19.1-revision17**, installed with pnpm outside the app
- Test seed **11031904**, fuzz count **100**
- Elm packages pinned in `elm.json`; JS dependencies in the root `pnpm-lock.yaml`

Don't use npm, and don't add Elm or elm-test to the root dependencies. One
working setup:

```sh
mkdir -p /tmp/onyx-elm-tools
printf '{"private":true}\n' > /tmp/onyx-elm-tools/package.json
pnpm --dir /tmp/onyx-elm-tools add --save-exact --ignore-scripts elm-test@0.19.1-revision17
# put the official elm 0.19.1 binary on PATH, then:
export PATH=/tmp/onyx-elm-tools/node_modules/.bin:$PATH
export ELM_HOME=/tmp/onyx-elm-home
```

Helpers:

- `tools/vendor-elm-packages.sh` fills `ELM_HOME` from GitHub when the Elm
  package registry is unreachable.
- `tools/patch-elm-test-tcp.sh <elm-test-package-dir>` makes elm-test use TCP
  loopback in sandboxes that forbid Unix sockets.

## Build and run

From the repository root:

```sh
node tools/build-elm-site.mjs /tmp/onyx-site     # fails closed without elm 0.19.1
node tools/serve-dir.mjs /tmp/onyx-site 8080
```

Open `http://127.0.0.1:8080/app/` (add `?ws=wss://host/ws` to pin a server).

## Tests

```sh
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
node --test elm/*.smoke.mjs
pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit
pnpm test:elm-runtime
pnpm test:e2e:elm
pnpm test:e2e:elm:audit
```

### UI audit suite

`tests/e2e/elm-audit-*.spec.ts` encode the UI audit findings (one test per
finding id), every shell surface, keyboard-only journeys, every public route,
the profile overlay, the brand mark, every built-in look (with AA contrast
checks and screenshots), and the `/stats` widgets against a mocked feed. Specs
talk only to a mock IRC server answered through `page.routeWebSocket`
(`tests/e2e/elm-audit-wire.mjs`).

```sh
pnpm test:e2e:elm:audit                               # chromium, chromium-light, chromium-reduced-motion, iphone-13, iphone-13-light, iphone-se
pnpm test:e2e:elm:audit -- --project iphone-13 elm-audit-findings
ONYX_AUDIT_ORIGIN=http://127.0.0.1:8933 pnpm test:e2e:elm:audit    # against an already-served build
ONYX_FIREFOX_EXECUTABLE=/path/to/firefox pnpm test:e2e:elm:audit -- --project firefox
```

Stock Firefox runs over WebDriver BiDi (`moz-firefox` channel). Under BiDi,
Playwright's trace instrumentation raises `Permission denied to access property
"length"` on every page while plain Firefox logs none, so the specs ignore that
one message.

### Screenshots

```sh
node elm/tools/screens.mjs --site /tmp/onyx-site --vp 390x844,1280x800
node elm/tools/marketing-capture.mjs /tmp/onyx-site elm/marketing
```

Both serve a staged build on loopback against a mocked wire; every non-origin
request is aborted. `screens.mjs` also reports horizontal overflow and small
touch targets.

### Local-server labs and performance

```sh
node elm/tools/lab/run.mjs --server-bin <onyx-server> --server-source <checkout> \
  --scratch-parent /tmp --topology two --suite foundation --scenario logical \
  --receipt /tmp/onyx-elm-lab.json
node elm/tools/perf/run.mjs --suite=measure
```

Suites: `foundation | sessions | history | group` (`group` is the 8-stage
two-browser encrypted-room journey). Details: [`tools/lab/README.md`](tools/lab/README.md)
and [`../docs/elm-roadmap/performance-methodology.md`](../docs/elm-roadmap/performance-methodology.md).

### Roadmap lanes

```sh
node elm/tools/run-roadmap-checks.mjs validate-transcripts
node elm/tools/run-roadmap-checks.mjs elm-full
node elm/tools/run-roadmap-checks.mjs node-smokes
node elm/tools/source-manifest.mjs > /tmp/onyx-elm-source-manifest.json
```

The full lane list and receipt rules are in
[`docs/elm-roadmap/runner.md`](../docs/elm-roadmap/runner.md). A source
manifest identifies an input tree; it isn't a build or acceptance pass. Only
`deploy.sh` may write `out/`.
