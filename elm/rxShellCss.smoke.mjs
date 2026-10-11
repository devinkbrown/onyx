/* v3/rx-shell CSS smoke test — control sizes in css/rx-shell.css must win
   against the frame's 24px target floor.

   app.css gives every frame button `min-height: var(--target-floor)` at
   specificity (0,3,0). A size rule for a shell button written with two
   classes silently lost to it (rail rows, nav buttons, the bell all
   measured 24px tall on touch). This test pins the floor's specificity
   and requires every `min-height` rule in rx-shell.css that aims at a
   control to be at least as specific, so it wins by coming later in the
   cascade. Run with:
     node --test elm/rxShellCss.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/* Specificity of one complex selector as [ids, classes, elements]. */
function specificity(selector) {
  let ids = 0;
  let cls = 0;
  let els = 0;
  let rest = selector;
  // :where() contributes nothing; :is() / :not() / :has() take their most specific argument.
  rest = rest.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  rest = rest.replace(/:(?:is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, arg) => {
    const best = arg
      .split(",")
      .map((a) => specificity(a.trim()))
      .reduce((a, b) => (cmp(a, b) >= 0 ? a : b), [0, 0, 0]);
    ids += best[0];
    cls += best[1];
    els += best[2];
    return " ";
  });
  ids += (rest.match(/#[\w-]+/g) || []).length;
  cls += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  rest = rest.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, " ");
  els += (rest.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids, cls, els];
}

/* Flat list of { selectors, body } for rules with no nested braces
   (media wrappers are skipped, their inner rules are matched). */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const clean = stripComments(css);
  let m = re.exec(clean);
  while (m) {
    const head = m[1].trim();
    if (!head.startsWith("@")) {
      out.push({ selectors: head.split(",").map((s) => s.trim()).filter(Boolean), body: m[2] });
    }
    m = re.exec(clean);
  }
  return out;
}

test("the frame's button floor is (0,3,0)", () => {
  const app = rules(read("app.css"));
  const floor = app.find(
    (r) => /min-height:\s*var\(--target-floor\)/.test(r.body) && r.selectors.some((s) => s.startsWith(".onyx-frame :where(button)")),
  );
  assert.ok(floor, "app.css still carries the frame button floor");
  assert.deepEqual(specificity(floor.selectors[0]), [0, 3, 0]);
});

test("rx-shell.css min-height rules on controls are at least as specific as the floor", () => {
  const floor = [0, 3, 0];
  // Containers (bars, panes), form fields, disclosure rows and :root variants are not buttons.
  const skip = [
    /^:root/,
    /^\.onyx-frame > /,
    /\.onyx-room-header$/,
    /\.onyx-rail-filter-input$/,
    /\.onyx-roster-filter-input$/,
    /\.onyx-mlist-group-head$/,
    /\.onyx-room-header-icon$/,
  ];
  const weak = [];
  for (const rule of rules(read("css/rx-shell.css"))) {
    if (!/(^|[;\s])min-height\s*:/.test(rule.body)) continue;
    for (const selector of rule.selectors) {
      if (skip.some((re) => re.test(selector))) continue;
      if (cmp(specificity(selector), floor) < 0) weak.push(selector);
    }
  }
  assert.deepEqual(weak, [], `min-height rules weaker than the frame floor: ${weak.join(" | ")}`);
});

test("the specificity helper agrees with known selectors", () => {
  assert.deepEqual(specificity(".a .b"), [0, 2, 0]);
  assert.deepEqual(specificity(".onyx-frame :where(button):not(.x):not(.y)"), [0, 3, 0]);
  assert.deepEqual(specificity("a.b:hover > #c"), [1, 2, 1]);
  assert.deepEqual(specificity(".a :is(.b, .c .d)"), [0, 3, 0]);
});
