#!/usr/bin/env bash
# Ocean deploy — build the static export and stamp the service-worker cache
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

echo "==> stamping service-worker cache: ocean-shell-${VERSION}"
sed -i "s/ocean-shell-__BUILD_VERSION__/ocean-shell-${VERSION}/" out/sw.js
grep -q "ocean-shell-${VERSION}" out/sw.js \
  || { echo "FAIL: sw.js placeholder not found — check public/sw.js has 'ocean-shell-__BUILD_VERSION__'"; exit 1; }

echo "==> deployed ocean-shell-${VERSION} — live at https://eshmaki.me (nginx root: $(pwd)/out)"
