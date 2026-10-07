# Onyx Elm rewrite

1:1 parity port of the Onyx SolidJS client with a revamped Elm UI,
tracked against every onyx-server feature in [COVERAGE.md](COVERAGE.md).

TypeScript sources are the behavior oracle; Elm tests mirror their
vectors (`src/lib/**/*.test.ts`, `onyx-client-contract.v2.json`).

## Layout

- `src/Wire.elm` — IRC framing/parsing/formatting (port of `lib/irc/parser.ts`).
- `src/Base64Url.elm` — canonical unpadded base64url + UTF-8 bytes.
- `src/GroupControl.elm` — E2EEGROUP routing codec + OGC1 payload
  (ports of `lib/e2ee/groupControl.ts`, `groupControlPayload.ts` pure surface).
- `src/GroupEnvelope.elm` — `ONYXROOM1` envelope parse/pack/AAD/display
  (port of `lib/e2ee/groupEnvelope.ts` pure surface + keyring validators).
- `tests/` — oracle-mirrored vectors (`elm-test`).
- `tools/` — offline/sandbox setup scripts (not part of the app).
- `COVERAGE.md` — server-feature → oracle → Elm status matrix.

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
/tmp/elm make src/Wire.elm --output /dev/null        # typecheck spot-check
node /tmp/elmtools/package/bin/elm-test              # full suite
```

`elm.json` pins must stay complete (direct + indirect + test-indirect):
an incomplete closure fails with `ERROR IN DEPENDENCIES` when the
registry is unreachable, because the solver cannot fetch candidates.
