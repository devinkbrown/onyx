/* v3/rx-shell CSS smoke test — the frame's 24px button floor has ZERO
   specificity, so a control's own size rule always wins.

   app.css gives every frame button `min-height: var(--target-floor)` (24px,
   WCAG 2.5.8). It used to be `.onyx-frame :where(button):not(…):not(…)` —
   specificity (0,3,0) — and silently beat every one- or two-class size rule
   (rail rows, nav buttons, the bell, call buttons all measured 24px on
   touch), which slices then worked around with `:not(#_)` or a doubled
   `.onyx-frame` prefix. The whole selector now sits inside :where(). This
   test pins that, and that no stylesheet reintroduces the hack. Run with:
     node --test elm/rxShellCss.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("the frame's button floor has zero specificity", () => {
  const app = rules(read("app.css"));
  const floor = app.find(
    (r) => /min-height:\s*var\(--target-floor\)/.test(r.body) && r.selectors.some((s) => /^:where\(\.onyx-frame button/.test(s)),
  );
  assert.ok(floor, "app.css still carries the frame button floor, wrapped in :where()");
  assert.deepEqual(specificity(floor.selectors[0]), [0, 0, 0]);
  // And nothing else in app.css brings back a non-zero-specificity floor.
  const strong = app.filter(
    (r) => /min-height:\s*var\(--target-floor\)/.test(r.body) && r.selectors.some((s) => /^\.onyx-frame\b/.test(s) && /\bbutton\b/.test(s)),
  );
  assert.deepEqual(strong.map((r) => r.selectors[0]), []);
});

test("no stylesheet needs :not(#_) to beat the frame floor", () => {
  const files = ["app.css", ...readdirSync(join(here, "css")).filter((f) => f.endsWith(".css")).map((f) => `css/${f}`)];
  const hacks = files.filter((f) => stripComments(read(f)).includes(":not(#_)"));
  assert.deepEqual(hacks, []);
});

test("a one-class control size rule beats the floor in the cascade", () => {
  const floor = specificity(":where(.onyx-frame button:not(.onyx-avatar):not(.onyx-facepile-face))");
  assert.ok(cmp(specificity(".onyx-call-btn"), floor) > 0);
  assert.ok(cmp(specificity("button"), floor) > 0);
});

test("the specificity helper agrees with known selectors", () => {
  assert.deepEqual(specificity(".a .b"), [0, 2, 0]);
  assert.deepEqual(specificity(".onyx-frame :where(button):not(.x):not(.y)"), [0, 3, 0]);
  assert.deepEqual(specificity(":where(.onyx-frame button:not(.x):not(.y))"), [0, 0, 0]);
  assert.deepEqual(specificity("a.b:hover > #c"), [1, 2, 1]);
  assert.deepEqual(specificity(".a :is(.b, .c .d)"), [0, 3, 0]);
});
