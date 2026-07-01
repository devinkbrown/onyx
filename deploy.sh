#!/usr/bin/env bash
# Onyx deploy — build the static export and stamp the service-worker cache
# version so already-cached clients re-install on their next visit.
#
# nginx serves /home/kain/onyx/out directly at eshmaki.me, so building IS
# deploying. The source public/sw.js keeps a __BUILD_VERSION__ placeholder
# (clean tree); this script stamps a unique version into the BUILT out/sw.js.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"

echo "==> building static export -> out/"
NODE_OPTIONS="--disable-warning=DEP0205" pnpm build

test -f out/index.html || { echo "FAIL: out/index.html missing — build broken, NOT deploying"; exit 1; }
test -f out/sw.js      || { echo "FAIL: out/sw.js missing"; exit 1; }

# SPA route entrypoints. The app is client-routed (solid-router) but the build
# emits only out/index.html, so a HARD load / refresh / direct link to a route
# (e.g. /app, the 'Open Onyx' target) 404s under nginx's
# `try_files $uri $uri/ $uri/index.html =404`. Materialise each client route as
# its own index.html copy so the `$uri/index.html` branch serves it — no nginx
# change, clean URLs. Keep this list in sync with the <Route> table in index.tsx.
echo "==> materialising SPA route entrypoints (app, about, appearance)"
for route in app about appearance; do
  mkdir -p "out/${route}"
  cp out/index.html "out/${route}/index.html"
done

echo "==> stamping service-worker cache: onyx-shell-${VERSION}"
sed -i "s/onyx-shell-__BUILD_VERSION__/onyx-shell-${VERSION}/" out/sw.js
grep -q "onyx-shell-${VERSION}" out/sw.js \
  || { echo "FAIL: sw.js placeholder not found — check public/sw.js has 'onyx-shell-__BUILD_VERSION__'"; exit 1; }

echo "==> deployed onyx-shell-${VERSION} — live at https://eshmaki.me (nginx root: $(pwd)/out)"
