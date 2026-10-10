#!/usr/bin/env bash
# Build the static Elm bundle into elm/dist-elm/ (roadmap 7.5, partial).
#
#   elm make --optimize src/Main.elm → dist-elm/app.js
#   + index.html, app.css, css/*.css, ports.js copied alongside
#   + content hashes: every local <script src> / <link href> asset that
#     index.html references (app.js, ports.js, app.css, css/*.css) is
#     renamed to name.<sha256:12>.ext and the tag rewritten, so a deploy
#     can cache assets immutably while index.html stays revalidated.
#
# Build only. This never deploys and never touches out/ (production is
# written by ./deploy.sh alone). Smoke the result with:
#   ONYX_ELM_DIST=elm/dist-elm node --test elm/bundleBoot.smoke.mjs
#
# Usage: elm/tools/build.sh          (ELM=<elm 0.19.1 binary> to override)
set -euo pipefail

ELM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ELM_DIR/dist-elm"
ELM_BIN="${ELM:-elm}"

case "$OUT" in
  */out|*/out/*) echo "refusing to build into out/" >&2; exit 1 ;;
esac

rm -rf "$OUT"
mkdir -p "$OUT"

(cd "$ELM_DIR" && "$ELM_BIN" make --optimize src/Main.elm --output "$OUT/app.js")

cp "$ELM_DIR/index.html" "$ELM_DIR/app.css" "$ELM_DIR/ports.js" "$OUT/"
if compgen -G "$ELM_DIR/css/*.css" >/dev/null; then
  mkdir -p "$OUT/css"
  cp "$ELM_DIR"/css/*.css "$OUT/css/"
fi

# Minify (Elm's own --optimize output is unminified): esbuild comes with the
# repo's Vite toolchain. ESBUILD=<binary> overrides; without one the build
# stays valid, just larger.
ESBUILD_BIN="${ESBUILD:-}"
if [ -z "$ESBUILD_BIN" ]; then
  for root in "$ELM_DIR/.." "$(git -C "$ELM_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.."; do
    for cand in "$root"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild; do
      if [ -x "$cand" ]; then ESBUILD_BIN="$cand"; break 2; fi
    done
  done
fi
if [ -n "$ESBUILD_BIN" ]; then
  # Elm's IIFE ends `}(this));`, attaching Elm to the global object; esbuild
  # treats a bare file as a module where top-level `this` is undefined, so
  # pass globalThis explicitly before minifying.
  node -e '
    const fs = require("fs"); const f = process.argv[1];
    const src = fs.readFileSync(f, "utf8"); const at = src.lastIndexOf("}(this));");
    if (at < 0) { console.error("app.js: expected trailing }(this)); wrapper"); process.exit(1); }
    fs.writeFileSync(f, src.slice(0, at) + "}(globalThis));" + src.slice(at + 9));
  ' "$OUT/app.js"
  for f in "$OUT/app.js" "$OUT/ports.js"; do
    "$ESBUILD_BIN" "$f" --minify --target=es2017 --log-level=warning --outfile="$f" --allow-overwrite
  done
  for f in "$OUT/app.css" "$OUT"/css/*.css; do
    [ -f "$f" ] && "$ESBUILD_BIN" "$f" --minify --log-level=warning --outfile="$f" --allow-overwrite
  done
  echo "minified with $ESBUILD_BIN"
else
  echo "warning: esbuild not found — shipping unminified (set ESBUILD=...)" >&2
fi

node - "$OUT" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const out = process.argv[2];
const indexPath = path.join(out, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const hashed = new Map();

/* Local, relative asset refs only (no scheme, no //, no leading /). */
const ref = /(<script\b[^>]*\bsrc|<link\b[^>]*\bhref)="((?![a-z]+:|\/)[^"?#]+\.(?:js|css))"/gi;
html = html.replace(ref, (whole, lead, rel) => {
  if (!hashed.has(rel)) {
    const file = path.join(out, rel);
    if (!fs.existsSync(file)) throw new Error(`index.html references missing asset ${rel}`);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
    const ext = path.extname(rel);
    const next = rel.slice(0, -ext.length) + "." + digest + ext;
    fs.renameSync(file, path.join(out, next));
    hashed.set(rel, next);
  }
  return `${lead}="${hashed.get(rel)}"`;
});

for (const required of ["app.js", "ports.js", "app.css"]) {
  if (!hashed.has(required)) throw new Error(`index.html no longer references ${required}`);
}
fs.writeFileSync(indexPath, html);
for (const [from, to] of hashed) console.log(`  ${from} -> ${to}`);
NODE

echo "built $OUT"
