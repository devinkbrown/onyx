/* v3/css — smoke test for the pixel-regression harness's diff engine
   (elm/tools/css-regress.mjs `diff`): identical dirs pass, a changed block
   fails with the right pixel count and region, a size change is reported, and
   --noise A B ignores pixels where two baselines of the same build differ
   (dilated), but not changes elsewhere. Skipped when playwright-core (the PNG
   codec the harness borrows) is not installed.
   Run with: node --test elm/cssRegress.smoke.mjs   (from the repo root) */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const cli = join(here, "tools/css-regress.mjs");

function loadPng() {
  for (const d of [join(repo, "node_modules/.pnpm"), "/home/kain/onyx/node_modules/.pnpm"]) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d).find((n) => n.startsWith("playwright-core@"));
    if (hit) return createRequire(import.meta.url)(join(d, hit, "node_modules/playwright-core/lib/utilsBundle")).PNG;
  }
  return null;
}
const PNG = loadPng();

function png(w, h, paint) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    const c = paint(x, y) ?? [20, 24, 30];
    p.data[i] = c[0]; p.data[i + 1] = c[1]; p.data[i + 2] = c[2]; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}
const block = (x0, y0, n, c) => (x, y) => (x >= x0 && x < x0 + n && y >= y0 && y < y0 + n ? c : null);
const dir = (files) => {
  const d = mkdtempSync(join(tmpdir(), "css-regress-"));
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(d, name), buf);
  return d;
};
const run = (...args) => spawnSync(process.execPath, [cli, "diff", ...args], { encoding: "utf8", cwd: repo });

test("identical shots pass; a changed block fails with its pixel count", { skip: !PNG }, () => {
  const a = dir({ "x--a.png": png(80, 80, () => null) });
  const same = dir({ "x--a.png": png(80, 80, () => null) });
  const changed = dir({ "x--a.png": png(80, 80, block(10, 12, 5, [255, 0, 0])) });
  try {
    const ok = run(a, same);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /identical: 1 {3}changed: 0/);
    const bad = run(a, changed);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /DIFF x--a\.png: 25px in 1 region/);
  } finally { for (const d of [a, same, changed]) rmSync(d, { recursive: true, force: true }); }
});

test("a size change and a missing shot are reported", { skip: !PNG }, () => {
  const a = dir({ "x--a.png": png(40, 40, () => null), "y--a.png": png(40, 40, () => null) });
  const b = dir({ "x--a.png": png(40, 44, () => null) });
  try {
    const r = run(a, b);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /SIZE x--a\.png: 40x40 -> 40x44/);
    assert.match(r.stdout, /MISSING-IN-CURRENT y--a\.png/);
  } finally { for (const d of [a, b]) rmSync(d, { recursive: true, force: true }); }
});

test("--noise A B ignores a flaky region but not a change elsewhere", { skip: !PNG }, () => {
  const base = dir({ "n--a.png": png(120, 60, block(20, 20, 4, [200, 200, 0])) });
  const noiseB = dir({ "n--a.png": png(120, 60, block(20, 20, 4, [10, 200, 200])) });
  const curFlaky = dir({ "n--a.png": png(120, 60, block(20, 20, 4, [90, 90, 90])) });
  const curReal = dir({ "n--a.png": png(120, 60, (x, y) => (x >= 20 && x < 24 && y >= 20 && y < 24 ? [90, 90, 90] : x >= 90 && x < 93 && y >= 40 && y < 43 ? [255, 0, 0] : null)) });
  try {
    const flaky = run(base, curFlaky, "--noise", base, noiseB);
    assert.equal(flaky.status, 0, flaky.stdout);
    const real = run(base, curReal, "--noise", base, noiseB);
    assert.equal(real.status, 1);
    assert.match(real.stdout, /DIFF n--a\.png: 9px/);
  } finally { for (const d of [base, noiseB, curFlaky, curReal]) rmSync(d, { recursive: true, force: true }); }
});

test("the matrix is the documented size and every scenario resolves", async () => {
  const mod = await import("./tools/screens-css-regress.mjs");
  const count = (t) => t.scenarios.length * (t.vps === "all" ? 15 : t.vps.length);
  const total = ["core", "sheets", "public"].reduce((n, k) => n + count(mod.SET[k]), 0);
  assert.ok(total >= 500 && total <= 700, `default matrix is ~600 shots, got ${total}`);
  assert.deepEqual(mod.SET.seam.vps, ["w767x900", "w768x900", "w769x900"]);
  for (const entry of Object.values(mod.SET).flatMap((t) => t.scenarios)) assert.equal(typeof mod.default[mod.keyOf(entry)] === "function" || !entry.includes(":"), true, entry);
});
