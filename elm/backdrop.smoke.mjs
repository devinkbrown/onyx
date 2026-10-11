/* Background renderer smoke (v3/gap-appearance) — elm/media/backdrop-core.ts,
   the window.OnyxBackdrop core ports.js forwards the Elm `backgroundScene`
   port to, plus the ports.js shell-palette chrome helpers. Bundles the core
   with the repo's esbuild (no browser), then checks:
     - spec validation fails closed (bad ids / motions / surfaces render nothing);
     - catalogue ids: the 17 canvas presets paint themselves, the 7 DOM scenes
       paint their closest canvas preset, unknown ids paint the default;
     - the oracle policy: Off / reduced data → nothing, reduced motion (OS or
       in-app) → still, Adaptive → still on narrow / coarse, animated on desktop;
     - lifecycle against a fake host: mount once, re-present without
       remounting, swap on a new id, tear down on Off / a public surface, and
       never claim data-scene when the canvas has no 2D context;
     - every canvas variant paints a real BackgroundEngine frame (still and
       animated) into a recording 2D context;
     - ports.js caches / restores only `--onyx-theme-*` #rrggbb pairs and flags
       the shell scheme + theme-color.
   Run with: node --test elm/backdrop.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const here = dirname(new URL(import.meta.url).pathname);
const repo = resolve(here, "..");

function findEsbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD;
  let common = "";
  try { common = execFileSync("git", ["-C", here, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(); } catch { /* no git */ }
  for (const root of [repo, common ? resolve(common, "..") : "", "/home/kain/onyx"]) {
    const dir = root && join(root, "node_modules/.pnpm");
    if (!dir || !existsSync(dir)) continue;
    const hit = readdirSync(dir).find((n) => n.startsWith("esbuild@"));
    if (hit) return join(dir, hit, "node_modules/esbuild/bin/esbuild");
  }
  throw new Error("esbuild not found (set ESBUILD=…)");
}

const outDir = mkdtempSync(join(tmpdir(), "onyx-backdrop-smoke-"));
const outFile = join(outDir, "backdrop-core.mjs");
execFileSync(findEsbuild(), [join(here, "media/backdrop-core.ts"), "--bundle", "--format=esm", "--platform=neutral",
  `--tsconfig=${join(repo, "tsconfig.json")}`, `--outfile=${outFile}`, "--log-level=warning"], { cwd: repo });
const core = await import(pathToFileURL(outFile).href);
const { parseSceneSpec, resolveVariantId, policyFor, createBackdrop, startEngine, CANVAS_VARIANTS, SCENE_FALLBACK } = core;

const desktop = { osReducedMotion: false, reducedData: false, viewportWidth: 1440, coarsePointer: false, devicePixelRatio: 1 };
const phone = { ...desktop, viewportWidth: 390, coarsePointer: true, devicePixelRatio: 3 };
const spec = (over = {}) => ({ id: "deep-current", motion: "adaptive", reduceMotion: false, surface: "app", ...over });

test("spec validation fails closed", () => {
  assert.deepEqual(parseSceneSpec(spec()), spec());
  assert.equal(parseSceneSpec(null), null);
  assert.equal(parseSceneSpec(spec({ id: "../x" })), null);
  assert.equal(parseSceneSpec(spec({ id: "Deep" })), null);
  assert.equal(parseSceneSpec(spec({ motion: "fast" })), null);
  assert.equal(parseSceneSpec(spec({ surface: "none" })), null);
  assert.equal(parseSceneSpec(spec({ surface: "landing" })), null);
  assert.equal(parseSceneSpec({ ...spec(), reduceMotion: "yes" }).reduceMotion, false);
});

test("catalogue ids resolve to a canvas preset", () => {
  assert.equal(Object.keys(CANVAS_VARIANTS).length, 17);
  for (const id of Object.keys(CANVAS_VARIANTS)) assert.deepEqual(resolveVariantId(id), { id, fallbackFrom: null });
  assert.equal(Object.keys(SCENE_FALLBACK).length, 7);
  for (const [scene, canvas] of Object.entries(SCENE_FALLBACK)) {
    assert.ok(CANVAS_VARIANTS[canvas], `${scene} falls back to a real preset`);
    assert.deepEqual(resolveVariantId(scene), { id: canvas, fallbackFrom: scene });
  }
  assert.deepEqual(resolveVariantId("nope"), { id: "deep-current", fallbackFrom: "nope" });
  assert.deepEqual(resolveVariantId("constructor"), { id: "deep-current", fallbackFrom: "constructor" });
});

test("policy: the oracle contract", () => {
  assert.equal(policyFor(spec({ motion: "off" }), desktop).mode, "off");
  assert.equal(policyFor(spec(), { ...desktop, reducedData: true }).mode, "off");
  assert.equal(policyFor(spec(), { ...desktop, osReducedMotion: true }).mode, "still");
  assert.equal(policyFor(spec({ reduceMotion: true }), desktop).mode, "still");
  assert.equal(policyFor(spec(), desktop).mode, "animated");
  assert.equal(policyFor(spec(), phone).mode, "still");
  assert.equal(policyFor(spec({ motion: "animated" }), phone).mode, "animated");
  assert.equal(policyFor(spec({ motion: "still" }), desktop).mode, "still");
  const live = policyFor(spec(), desktop);
  assert.ok(live.frameCapFps <= 30 && live.dprCap <= 2, "desktop is capped (30fps, DPR 2)");
  assert.ok(policyFor(spec({ motion: "animated" }), phone).frameCapFps <= 21, "phones animate at the mobile cap");
});

function fakeHost(env = desktop, alive = true) {
  const log = { mounts: 0, unmounts: 0, live: [], engines: [] };
  const host = {
    mountCanvas() { log.mounts += 1; return { dataset: {} }; },
    unmountCanvas() { log.unmounts += 1; },
    setLive(surface) { log.live.push(surface); },
    environment: () => env,
    createEngine(canvas, variant, policy) {
      const e = { variant: variant.id, policy, started: 0, disposed: 0, presented: [],
        start() { this.started += 1; }, dispose() { this.disposed += 1; },
        applyPresentation(p) { this.presented.push(p); }, get alive() { return alive; } };
      log.engines.push(e);
      return e;
    },
  };
  return { host, log };
}

test("lifecycle: mount once, re-present, swap, tear down", () => {
  const { host, log } = fakeHost();
  const b = createBackdrop(host);
  b.render(spec());
  assert.equal(log.mounts, 1);
  assert.equal(log.engines[0].started, 1);
  assert.equal(log.live.at(-1), "app");
  assert.deepEqual(b.state(), { id: "deep-current", mode: "animated", surface: "app", fallbackFrom: null });

  b.render(spec({ motion: "still" }));
  assert.equal(log.mounts, 1, "a motion change re-presents, never remounts");
  assert.equal(log.engines[0].presented.at(-1).staticMode, true);

  b.render(spec({ id: "starfield" }));
  assert.equal(log.engines[0].disposed, 1, "the old engine is disposed");
  assert.equal(log.mounts, 2);
  assert.equal(log.engines[1].variant, "bioluminescence");
  assert.equal(b.state().fallbackFrom, "starfield");

  b.render(spec({ id: "starfield", motion: "off" }));
  assert.equal(log.engines[1].disposed, 1);
  assert.equal(log.live.at(-1), null, "Off clears data-scene");
  assert.equal(b.state().id, null);

  b.render(spec());
  b.render({ id: "", motion: "off", reduceMotion: false, surface: "none" });
  assert.equal(log.live.at(-1), null, "a public surface tears down");
  assert.equal(log.unmounts, log.mounts, "every canvas is removed");
});

test("lifecycle: no 2D context never claims data-scene", () => {
  const { host, log } = fakeHost(desktop, false);
  const b = createBackdrop(host);
  b.render(spec());
  assert.ok(!log.live.includes("app"), "fails closed");
  assert.equal(log.unmounts, log.mounts);
  assert.equal(b.state().id, null);
});

test("refresh re-derives the policy (resize to a phone freezes Adaptive)", () => {
  let env = desktop;
  const { host, log } = fakeHost();
  host.environment = () => env;
  const b = createBackdrop(host);
  b.render(spec());
  assert.equal(b.state().mode, "animated");
  env = phone;
  b.refresh();
  assert.equal(b.state().mode, "still");
  assert.equal(log.mounts, 1);
});

/* A recording 2D context: every method is a no-op that counts; gradients
   accept colour stops. Enough for the variants to paint a full frame. */
function recordingCanvas() {
  const calls = { n: 0 };
  const gradient = { addColorStop() { calls.n += 1; } };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createLinearGradient" || key === "createRadialGradient" || key === "createConicGradient") return () => gradient;
      if (key === "getImageData" || key === "createImageData") return () => ({ data: new Uint8ClampedArray(4) });
      if (key === "measureText") return () => ({ width: 10 });
      return () => { calls.n += 1; };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = {
    width: 0, height: 0, dataset: {}, style: {}, clientWidth: 800, clientHeight: 600, parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };
  return { canvas, calls };
}

test("every canvas variant paints a real engine frame (still and animated)", () => {
  for (const [id, variant] of Object.entries(CANVAS_VARIANTS)) {
    for (const mode of ["still", "animated"]) {
      const { canvas, calls } = recordingCanvas();
      const policy = policyFor(spec({ id, motion: mode === "still" ? "still" : "animated" }), desktop);
      const engine = startEngine(canvas, variant, policy);
      engine.start();
      assert.equal(engine.alive, true, `${id} ${mode} engine is live`);
      assert.ok(calls.n > 10, `${id} ${mode} painted (${calls.n} draw calls)`);
      engine.dispose();
    }
  }
});

test("a canvas without a 2D context is not alive", () => {
  const { canvas } = recordingCanvas();
  canvas.getContext = () => null;
  const engine = startEngine(canvas, CANVAS_VARIANTS["deep-current"], policyFor(spec(), desktop));
  engine.start();
  assert.equal(engine.alive, false);
});

test("ports.js: shell palette chrome + no-flash cache are fail-closed", () => {
  const require = createRequire(import.meta.url);
  require("./ports.js");
  const { shellSchemeOf, applyShellChrome, restoreShellPalette } = globalThis.OnyxPorts;
  assert.equal(shellSchemeOf("#f5f0e5"), "light");
  assert.equal(shellSchemeOf("#0b0e12"), "dark");
  assert.equal(shellSchemeOf("red"), "dark");

  const store = new Map();
  const meta = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const doc = { querySelector: (sel) => (sel.includes("theme-color") ? meta : null) };
  const props = new Map();
  const root = {
    attrs: {}, ownerDocument: doc,
    setAttribute(k, v) { this.attrs[k] = v; },
    style: { setProperty: (k, v) => props.set(k, v) },
  };
  doc.documentElement = root;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  applyShellChrome(root, [
    ["--onyx-theme-bg", "#f5f0e5"], ["--onyx-theme-text", "#251e15"], ["--ink", "#f5f0e5"],
    ["--onyx-theme-dim", "url(evil)"], ["--onyx-theme-hc-line", "#5a6675"],
  ]);
  assert.equal(root.attrs["data-shell-scheme"], "light");
  assert.equal(meta.attrs.content, "#f5f0e5");
  const cached = JSON.parse(store.get("onyx:shell-palette"));
  assert.deepEqual(cached.pairs.map((p) => p[0]), ["--onyx-theme-bg", "--onyx-theme-text", "--onyx-theme-hc-line"]);

  props.clear();
  assert.equal(restoreShellPalette({ document: doc, localStorage: globalThis.localStorage }), true);
  assert.equal(props.get("--onyx-theme-bg"), "#f5f0e5");
  assert.equal(props.has("--onyx-theme-dim"), false);

  store.set("onyx:shell-palette", JSON.stringify({ v: 1, pairs: [["--onyx-theme-bg", "expression(alert(1))"], ["color", "#000000"]] }));
  props.clear();
  assert.equal(restoreShellPalette({ document: doc, localStorage: globalThis.localStorage }), false);
  assert.equal(props.size, 0, "nothing hostile is ever applied");
  store.set("onyx:shell-palette", "{nope");
  assert.equal(restoreShellPalette({ document: doc, localStorage: globalThis.localStorage }), false);
});

test("ports.js: device display prefs restore only whitelisted values on first paint", () => {
  const require = createRequire(import.meta.url);
  require("./ports.js");
  const { restoreDevicePrefs } = globalThis.OnyxPorts;
  const dataset = {};
  const doc = { documentElement: { dataset } };
  const win = (json) => ({ document: doc, localStorage: { getItem: () => json } });

  assert.equal(restoreDevicePrefs(win(JSON.stringify({ fontScale: "lg", density: "roomy", width: "full", highContrast: true, reduceMotion: false }))), true);
  assert.deepEqual({ ...dataset }, { fontScale: "lg", density: "roomy", width: "full", highContrast: "true", reduceMotion: "false" });

  for (const key of Object.keys(dataset)) delete dataset[key];
  assert.equal(restoreDevicePrefs(win(JSON.stringify({ fontScale: "xxl", density: "<script>", width: 3, highContrast: "yes" }))), false);
  assert.deepEqual({ ...dataset }, {}, "unknown values are never stamped");
  assert.equal(restoreDevicePrefs(win("{nope")), false);
  assert.equal(restoreDevicePrefs(win("[1,2]")), false);
  assert.equal(restoreDevicePrefs(win(null)), false);
  assert.equal(restoreDevicePrefs(win("x".repeat(9000))), false);
});
