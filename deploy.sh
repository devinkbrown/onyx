#!/usr/bin/env bash
# Onyx deploy — build to dist/, stage everything there, then sync into the
# live-served out/ in one pass.
#
# ARCHITECTURE (learned the hard way): nginx serves /home/kain/onyx/out
# directly at eshmaki.me. Vite therefore builds to dist/ — NOT out/ — so that
# plain `pnpm build` runs (tests, gates, e2e web servers) can never wipe or
# half-replace production. ONLY this script writes out/.
#
# The full deploy = SPA build + route-correct SPA documents + sw stamp + the community
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
# `try_files $uri $uri/ $uri/index.html =404`. The materializer owns the route
# list and stamps route-specific metadata into every document so crawlers and
# link unfurlers do not see the root page before JavaScript hydrates.
echo "==> materialising route-correct SPA entrypoints"
node tools/materialize-route-entrypoints.mjs dist

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

# Static files must remain readable/traversable by nginx. Some landing build
# environments create output under a restrictive umask, and `rsync -a` would
# otherwise preserve those modes into the live tree.
echo "==> normalising static asset permissions"
find dist -type d -exec chmod 0755 {} +
find dist -type f -exec chmod 0644 {} +

# nginx runs as `http` on the production host. The checkout lives below kain's
# private home directory, so world traversal must stay disabled; grant only the
# web-service account execute/traverse permission on that one parent. If this
# ACL is lost, every otherwise-valid route becomes a misleading nginx 404.
# Reassert it on every deploy so a home-directory permission repair cannot
# silently take the freshly-built site offline. Other hosts can override the
# account with ONYX_WEB_USER; hosts without that account need no ACL change.
WEB_USER="${ONYX_WEB_USER:-http}"
LIVE_PARENT="$(dirname "$(pwd)")"
if id -u "${WEB_USER}" >/dev/null 2>&1; then
  command -v setfacl >/dev/null 2>&1 \
    || { echo "FAIL: setfacl is required to grant ${WEB_USER} traverse access to ${LIVE_PARENT}"; exit 1; }
  echo "==> ensuring ${WEB_USER} can traverse ${LIVE_PARENT}"
  setfacl -m "u:${WEB_USER}:--x" "${LIVE_PARENT}"
fi

echo "==> syncing dist/ -> out/ (live)"
mkdir -p out
rsync -a --delete dist/ out/

echo "==> deployed onyx-shell-${VERSION} — live at https://eshmaki.me (nginx root: $(pwd)/out)"
