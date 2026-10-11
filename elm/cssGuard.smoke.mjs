/* v3/css — guard rails for the stylesheet vocabulary (no browser).
   These pin the decisions of the CSS consolidation so they cannot silently
   drift back (see design/STYLE_MAP.md §5.2):

     1. no `:not(#_)` specificity hacks (the frame's 24px button floor is a
        zero-specificity `:where()` rule, so nothing needs to out-rank it);
     2. every z-index is a rung of the one --z-* ladder defined in app.css;
     3. one mobile/desktop seam at 768px: `max-width: 767.98px` below,
        `min-width: 768px` from — never `767px`, `768px` (inclusive max) or
        `769px`.

   Run with: node --test elm/cssGuard.smoke.mjs   (zero dependencies) */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = ["app.css", ...readdirSync(join(here, "css")).filter((f) => f.endsWith(".css")).map((f) => `css/${f}`)];
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sources = Object.fromEntries(files.map((f) => [f, strip(readFileSync(join(here, f), "utf8"))]));

test("no stylesheet uses :not(#_) to win a specificity fight", () => {
  assert.deepEqual(files.filter((f) => sources[f].includes(":not(#_)")), []);
});

test("z-index values are rungs of the --z-* ladder", () => {
  const offenders = [];
  for (const [f, css] of Object.entries(sources)) {
    for (const m of css.matchAll(/z-index\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (/^(var\(--z-[a-z0-9-]+\)|calc\(var\(--z-[a-z0-9-]+\) [+-] \d+\)|auto|0)$/.test(v)) continue;
      offenders.push(`${f}: z-index: ${v}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every --z-* token that is used is defined once in app.css :root", () => {
  const defined = new Set([...sources["app.css"].matchAll(/(--z-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  assert.ok(defined.size >= 10, "the ladder is defined in app.css");
  const used = new Set();
  for (const css of Object.values(sources)) for (const m of css.matchAll(/var\((--z-[a-z0-9-]+)\)/g)) used.add(m[1]);
  assert.deepEqual([...used].filter((t) => !defined.has(t)), []);
  for (const f of files.filter((x) => x !== "app.css")) {
    assert.doesNotMatch(sources[f], /(--z-[a-z0-9-]+)\s*:/, `${f} redefines a --z token`);
  }
});

test("the 768px seam is written one way: max-width 767.98px below, min-width 768px from", () => {
  const bad = [];
  for (const [f, css] of Object.entries(sources)) {
    for (const m of css.matchAll(/\(\s*(max-width|min-width)\s*:\s*([\d.]+)px\s*\)/g)) {
      const [, feature, px] = m;
      if (feature === "max-width" && (px === "767" || px === "768")) bad.push(`${f}: max-width: ${px}px`);
      if (feature === "min-width" && px === "769") bad.push(`${f}: min-width: ${px}px`);
    }
  }
  assert.deepEqual(bad, []);
});
