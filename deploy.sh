#!/usr/bin/env bash
# Onyx deploy — build to dist/, stage everything there, then sync into the
# live-served out/ in one pass.
#
# ARCHITECTURE (learned the hard way): nginx serves /home/kain/onyx/out
# directly at eshmaki.me. Vite therefore builds to dist/ — NOT out/ — so that
# plain `pnpm build` runs (tests, gates, e2e web servers) can never wipe or
# half-replace production. ONLY this script writes out/.
#
# The full deploy = SPA build + SPA route copies + sw stamp + the community
# site overlay from /home/kain/landing (root index.html, /guides/, /community/,
# favicon). The overlay is part of THIS script so it cannot be forgotten —
# a bare SPA sync would silently take the community site off the air.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
LANDING=/home/kain/landing

echo "==> building static export -> dist/"
NODE_OPTIONS="--disable-warning=DEP0205" pnpm build

test -f dist/index.html || { echo "FAIL: dist/index.html missing — build broken, NOT deploying"; exit 1; }
test -f dist/sw.js      || { echo "FAIL: dist/sw.js missing"; exit 1; }

# SPA route entrypoints. The app is client-routed (solid-router) but the build
# emits only dist/index.html, so a HARD load / refresh / direct link to a route
# (e.g. /app, the 'Open Onyx' target) 404s under nginx's
# `try_files $uri $uri/ $uri/index.html =404`. Materialise each client route as
# its own index.html copy. Keep this list in sync with the <Route> table in index.tsx.
echo "==> materialising SPA route entrypoints (app, about, appearance, stats, status, roadmap)"
for route in app about appearance stats status roadmap; do
  mkdir -p "dist/${route}"
  cp dist/index.html "dist/${route}/index.html"
done

echo "==> stamping service-worker cache: onyx-shell-${VERSION}"
sed -i "s/onyx-shell-__BUILD_VERSION__/onyx-shell-${VERSION}/" dist/sw.js
grep -q "onyx-shell-${VERSION}" dist/sw.js \
  || { echo "FAIL: sw.js placeholder not found — check public/sw.js has 'onyx-shell-__BUILD_VERSION__'"; exit 1; }

# Community site overlay — staged into dist/ BEFORE the live sync so the swap
# is one rsync, never a window where the root 404s.
if [ -d "${LANDING}" ]; then
  echo "==> building + staging the community site overlay"
  (cd "${LANDING}" && node build.mjs >/dev/null && node build.mjs --check >/dev/null)
  for reserved in app about appearance assets; do
    if [ -e "${LANDING}/dist/${reserved}" ]; then
      echo "FAIL: landing dist/${reserved} would clobber the SPA"; exit 1
    fi
  done
  cp -r "${LANDING}/dist/." dist/
else
  echo "WARN: ${LANDING} missing — deploying the bare SPA (no community site!)"
fi

echo "==> syncing dist/ -> out/ (live)"
mkdir -p out
rsync -a --delete dist/ out/

echo "==> deployed onyx-shell-${VERSION} — live at https://eshmaki.me (nginx root: $(pwd)/out)"
