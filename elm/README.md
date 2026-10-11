# Onyx Elm client (v3)

The Elm client is the Onyx web product: the build `./deploy.sh` ships with
`ONYX_CLIENT=elm`. The SolidJS client in `src/` is deprecated; it is kept as the
behavioural oracle that the status docs compare against, and its TypeScript tests are
the source of many Elm test vectors (`src/lib/**/*.test.ts`,
`onyx-client-contract.v2.json`).

Status docs live in [`design/INDEX.md`](design/INDEX.md): the roadmap
([V3_ROADMAP.md](V3_ROADMAP.md)), the protocol matrix ([COVERAGE.md](COVERAGE.md)),
the client parity map, the server feature map, the design direction and the calls design.

## Layout

- `src/Main.elm` — `Browser.application` entry: ports, subscriptions, routing.
- `src/App.elm` — the model, `Msg` and `update`: protocol folds, composer, store
  actions. Effects are data (`List Outbound`); `Main` turns them into port calls.
  New work lives in feature modules (`src/Organize*.elm`, `Chanserv.elm`,
  `WatchTogether.elm`, `OperConsole.elm`, `GapShell.elm`, …) wired in through blocks
  tagged `-- v3/<slice>` and the `settleSteps` list.
- `src/Wire.elm`, `Base64Url.elm`, `GroupControl.elm`, `GroupEnvelope.elm`, `DmCipher.elm`,
  `Keyring.elm`, … — pure protocol and crypto-adjacent modules (validation, parsing,
  packing, transcripts, fail-closed display rules).
- `src/View.elm` and `src/View/*.elm` — every rendered surface.
- `ports.js` (+ `historyImport.js`, `media/*.ts` for the Cadence voice engine and the
  background renderer) — the JS side: WebSocket, IndexedDB vault, WebCrypto, WebAuthn,
  WebRTC, uploads, notifications, service worker registration.
- `app.css` + `css/*.css` — styles (tokens first, then per-surface sheets; the `index.html` link order IS the cascade order and is documented there).
- `tests/` — elm-test vectors; `*.smoke.mjs` — jsdom smoke suites over the real bundle and
  `ports.js`; `tools/` — build (`build.sh`), screenshots (`screens*.mjs`), CSS coverage,
  contrast audit, style map, call end-to-end.
- `design/` — design and status documents (see `design/INDEX.md`).

Crypto (AES-GCM, Ed25519, ECDH, SCRAM), WebSocket, IndexedDB, WebAuthn,
WebRTC, and HTTP live behind ports; Elm owns validation, parsing,
packing, transcripts, and fail-closed display rules.

## Toolchain (offline + sandboxed)

The environment has no `elm`/`elm-test` on PATH, the Elm registry is
slow/flaky, and some sandboxes forbid AF_UNIX sockets. Bootstrap:

```sh
# 1. Elm compiler binary (once)
curl -sL -o /tmp/elm.gz \
  https://github.com/elm/compiler/releases/download/0.19.1/binary-for-linux-64-bit.gz
gunzip -f /tmp/elm.gz && chmod +x /tmp/elm

# 2. elm-test runner (once) — deps, skipping its networked prepare step
mkdir -p /tmp/elmtools && cd /tmp/elmtools
curl -sL -o elm-test.tgz \
  https://registry.npmjs.org/elm-test/-/elm-test-0.19.1-revision17.tgz
tar xzf elm-test.tgz && cd package
npm --cache /tmp/npmcache install --ignore-scripts --no-audit --no-fund

# 3. Package cache from GitHub (registry mirror for pinned versions)
export ELM_HOME=/tmp/elmhome
./tools/vendor-elm-packages.sh

# 4. Complete test-only pins (already committed in elm.json), then if the
#    sandbox blocks AF_UNIX bind, patch the runner to TCP loopback:
/tools/patch-elm-test-tcp.sh /tmp/elmtools/package
```

`tools/vendor-elm-packages.sh` also fetches `elm/bytes` (needed by
`elm-explorations/test`); extend it if `elm.json` gains dependencies.

## Gates

```sh
export PATH=/tmp:$PATH ELM_HOME=/tmp/elmhome
cd elm
/tmp/elm make src/Main.elm --output /dev/null                  # typecheck the app
node /tmp/elmtools/package/bin/elm-test --compiler /tmp/elm    # full suite
for s in *.smoke.mjs; do node "$s" || echo "FAIL $s"; done     # smoke suites
node tools/css-coverage.mjs                                    # 0 unstyled, 0 undefined vars
bash tools/build.sh                                            # → dist-elm/ (never touches out/)
node tools/screens.mjs --vp all --out <dir>                    # real-Chromium aspect-ratio matrix
```

CSS changes also pass the pixel-regression harness (`tools/css-regress.mjs`: shoot the
~600-shot matrix before and after, then `diff` — a step is accepted only when every diff is zero
or an intentional, listed fix) and the CSS guard smokes (`cssGuard.smoke.mjs`:
no `:not(#_)`, one `--z-*` ladder, one 768px seam, one focus-ring token). `tools/css-inert.mjs`
asks Chromium which declarations are never used. See `design/STYLE_MAP.md` §5.4.

`elm.json` pins must stay complete (direct + indirect + test-indirect):
an incomplete closure fails with `ERROR IN DEPENDENCIES` when the
registry is unreachable, because the solver cannot fetch candidates.
