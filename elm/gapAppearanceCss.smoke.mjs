/* v3/gap-appearance — CSS contract smoke (no browser).
   The appearance features live in CSS that nothing type-checks, so pin the
   contract the Elm/ports side relies on:
     - every ShellPalette slot (src/ShellPalette.elm `slotNames`) is bridged
       onto --onyx-* from its --onyx-theme-<slot> token, with house fallbacks;
     - the Raise-contrast switch (<html data-high-contrast>) and the OS signal
       (@media (prefers-contrast: more)) set the SAME properties from the
       --onyx-theme-hc-<slot> set;
     - Text size (data-font-scale sm / lg), Density (compact / roomy) and
       Conversation width (full) each have rules;
     - Text size reaches everything: no font-size in px survives in the shell
       CSS except the 16px input guard (iOS zoom) and the Theme Studio preview
       miniature (.ts-pv-*).
   Run with: node --test elm/gapAppearanceCss.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const read = (rel) => readFileSync(join(here, rel), "utf8");
const gap = read("css/gap-appearance.css");
const palette = read("src/ShellPalette.elm");

const slots = (() => {
  const m = /slotNames =\s*\[([^\]]+)\]/.exec(palette);
  assert.ok(m, "ShellPalette.slotNames found");
  return [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]);
})();

/** The declarations of the first block whose selector text matches. */
function block(css, selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `${selector} present`);
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  for (; i < css.length && depth > 0; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
  }
  return css.slice(open + 1, i - 1);
}
const props = (body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();

test("every palette slot is bridged onto --onyx-* with a house fallback", () => {
  assert.equal(slots.length, 13);
  const root = block(gap, ":root {");
  for (const slot of slots) {
    assert.match(root, new RegExp(`--onyx-${slot}:\\s*var\\(--onyx-theme-${slot},\\s*#[0-9a-f]{6}\\)`), `bridge for ${slot}`);
  }
});

test("high contrast: the switch and prefers-contrast set the same properties", () => {
  const sw = block(gap, ":root[data-high-contrast='true'] {");
  const mq = block(gap, "@media (prefers-contrast: more)");
  const mqRoot = block(mq, ":root {");
  assert.deepEqual(props(sw), props(mqRoot));
  for (const slot of slots.filter((s) => !["bg", "panel", "panel-2"].includes(s))) {
    assert.match(sw, new RegExp(`--onyx-${slot}:\\s*var\\(--onyx-theme-hc-${slot},`), `hc ${slot} (switch)`);
    assert.match(mqRoot, new RegExp(`--onyx-${slot}:\\s*var\\(--onyx-theme-hc-${slot},`), `hc ${slot} (media)`);
  }
  // High contrast never moves the grounds.
  for (const ground of ["bg", "panel", "panel-2"]) assert.doesNotMatch(sw, new RegExp(`--onyx-${ground}:`));
  assert.match(sw, /--focus-width:\s*3px/);
});

test("Text size, Density and Conversation width each have rules", () => {
  for (const needle of [
    ":root[data-font-scale='sm']",
    ":root[data-font-scale='lg']",
    ":root[data-density='compact']",
    ":root[data-density='roomy']",
    ":root[data-width='full']",
  ]) assert.ok(gap.includes(needle), `${needle} has a rule`);
  assert.match(gap, /html \{ font-size: 100%; \}/, "the root is the browser size, not 15px");
  // Touch keeps 44px rows: Compact only shrinks rows under a fine pointer.
  const compactRows = /@media \(hover: hover\) and \(pointer: fine\) \{[^@]*data-density='compact'\] \.onyx-rail \.onyx-rail-item \{ min-height: 28px/.test(gap);
  assert.ok(compactRows, "compact row heights are fine-pointer only");
});

test("Conversation width: the measure reaches the log and composer (display: contents frame)", () => {
  // The old `.onyx-thread-pane > *` cap cannot touch rows inside the
  // display:contents frame, so the gutters carry it instead.
  assert.match(read("app.css"), /\.onyx-thread-frame \{ display: contents; \}/);
  const wide = block(gap, "@media (min-width: 1200px)");
  assert.match(wide, /:root:not\(\[data-width='full'\]\) \.onyx-main > \.onyx-thread-pane/);
  assert.match(wide, /:root:not\(\[data-width='full'\]\) \.onyx-main > \.onyx-composer/);
  assert.match(wide, /padding-inline:\s*max\(var\(--space-4\),\s*calc\(\(100% - var\(--shell-measure\)\) \/ 2\)\)/);
});

test("the duration ladder derives from the theme's --dur without a cycle", () => {
  // `--dur: var(--dur-base)` next to `--dur-base: var(--dur, 220ms)` is a cycle:
  // both compute invalid and every transition is dropped until a theme commits.
  assert.doesNotMatch(read("app.css"), /--dur:\s*var\(--dur-base\)/);
  assert.match(gap, /--dur-base:\s*var\(--dur,\s*220ms\)/);
});

test("no shell font-size is left in px (Text size reaches everything)", () => {
  const files = ["app.css", ...readdirSync(join(here, "css")).filter((f) => f.endsWith(".css") && f !== "gap-appearance.css").map((f) => `css/${f}`)];
  const offenders = [];
  for (const file of files) {
    const css = read(file);
    for (const m of css.matchAll(/font-size:\s*([0-9.]+)px/g)) {
      const open = css.lastIndexOf("{", m.index);
      const selector = css.slice(Math.max(css.lastIndexOf("}", open), css.lastIndexOf(";", open)) + 1, open).trim();
      const input16 = Number(m[1]) >= 16 && /input|field|search/.test(selector);
      const studioPreview = file === "css/pol-studio.css" && selector.includes(".ts-pv");
      if (!input16 && !studioPreview) offenders.push(`${file}: ${selector.slice(-60)} ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the scene layer never takes a hit and is dropped under reduced transparency", () => {
  const scene = block(gap, "#onyx-scene {");
  assert.match(scene, /pointer-events:\s*none/);
  assert.match(scene, /z-index:\s*-1/);
  assert.match(gap, /:root\[data-reduce-transparency='true'\] #onyx-scene \{ display: none; \}/);
});
