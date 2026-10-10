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
