# Getting started

This is for someone who just cloned the client. If you only want to chat, open
<https://eshmaki.me/app/> or read the in-app Guides at `/guides/`.

## Install

- Node.js 20+
- pnpm (never npm or yarn)
- Elm 0.19.1 on `PATH`, and elm-test 0.19.1-revision17 for the Elm suite. See
  [`../elm/README.md`](../elm/README.md#toolchain).
- Chromium for the Playwright suites (`ONYX_CHROMIUM_EXECUTABLE`, default
  `/usr/bin/chromium`)

```bash
git clone https://github.com/devinkbrown/onyx.git
cd onyx
pnpm install
```

## Build and open the client

```bash
node tools/build-elm-site.mjs /tmp/onyx-site
node tools/serve-dir.mjs /tmp/onyx-site 8080
```

- `http://127.0.0.1:8080/` is the public site.
- `http://127.0.0.1:8080/app/` is the app. The connect gate offers guest, sign
  in, or create account.
- Add `?ws=wss://your.host/ws` to use your own Onyx Server. Without it the
  client probes the public node list.

`pnpm build` stages the site into `dist/`, `pnpm preview` serves it on port
4173, and `pnpm dev` builds and serves it on `http://127.0.0.1:3000`.

## Find your way around

| You want to change | Look in |
| --- | --- |
| A screen or component | `elm/src/View/*.elm` |
| State or behaviour | `elm/src/App.elm` plus a focused module |
| IRC parsing or negotiation | `elm/src/Wire.elm`, `Session.elm`, `Isupport.elm` |
| Socket, credentials, keys, storage owners | `elm/runtime/` |
| A browser API (vault, uploads, notifications) | `elm/ports.js` |
| Styles | `elm/app.css`, `rail.css`, `convo.css`, `site.css` |
| Themes | `elm/src/ThemeLook.elm`, `ThemeTokens.elm` |

The full map is [`architecture.md`](architecture.md).

## Before you open a pull request

```bash
pnpm exec tsc -p elm/runtime/tsconfig.json --noEmit
pnpm typecheck && pnpm lint
pnpm test:elm-runtime
(cd elm && elm make src/Main.elm --output /dev/null && elm-test)
node --test elm/*.smoke.mjs
pnpm test:e2e:elm
```

For UI work also run `pnpm test:e2e:elm:audit`. See
[`testing-and-release.md`](testing-and-release.md) and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).
