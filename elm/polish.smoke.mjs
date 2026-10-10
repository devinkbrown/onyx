/* v3/polish smoke — the `polishFlags` boot read and the `wirePolish`
   bridge mirror `firstHour.ts` / `firstRunNotify.ts` /
   `addToHomeScreen.ts` / `updateRecovery.ts`: allowlisted "1" flag
   writes, the two-key visit memory, platform words, a silent
   `beforeinstallprompt` capture prompted only on request, and an honest
   service-worker update handoff (nothing without a registration).
   Run with: node --test elm/polish.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { polishFlags, wirePolish } = globalThis.OnyxPorts;

function fakeStorage(seed = {}) {
  const slots = new Map(Object.entries(seed));
  return {
    getItem(key) { return slots.has(key) ? slots.get(key) : null; },
    setItem(key, value) { slots.set(key, String(value)); },
    removeItem(key) { slots.delete(key); },
    get size() { return slots.size; },
  };
}

function capturePort() {
  let handler = null;
  return { port: { subscribe(fn) { handler = fn; } }, fire(p) { return handler(p); } };
}

function fakeWindow(local = fakeStorage(), session = fakeStorage()) {
  const listeners = {};
  let reloads = 0;
  return {
    localStorage: local,
    sessionStorage: session,
    matchMedia() { return { matches: false }; },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    dispatch(name, ev) { (listeners[name] || []).forEach((fn) => fn(ev)); },
    location: { reload() { reloads += 1; } },
    get reloads() { return reloads; },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function bridge(win, nav) {
  const save = capturePort();
  const prompt = capturePort();
  const approve = capturePort();
  const events = [];
  const app = {
    ports: {
      polishFlagSave: save.port,
      pwaInstallPrompt: prompt.port,
      pwaUpdateApprove: approve.port,
      pwaEvent: { send(e) { events.push(e); } },
    },
  };
  wirePolish(app, { window: win, navigator: nav });
  return { save, prompt, approve, events };
}

test("boot flags read the persisted markers and remember visits", () => {
  const local = fakeStorage({ "onyx:first-hour-seen": "1", "onyx:notify-first-send": "1", "onyx:a2hs-dismissed": "0" });
  const first = polishFlags({ window: fakeWindow(local, fakeStorage()), navigator: { userAgent: "Mozilla/5.0 Firefox/130" } });
  assert.equal(first.firstHourSeen, true);
  assert.equal(first.notifyFirstSend, true);
  assert.equal(first.a2hsDismissed, false, "only \"1\" counts");
  assert.equal(first.a2hsReturning, false, "no earlier visit");
  assert.equal(first.navigatorStandalone, null);
  assert.equal(first.platform, "other");
  assert.equal(local.getItem("onyx:a2hs-visit"), "1");

  const session = fakeStorage();
  const later = polishFlags({ window: fakeWindow(local, session), navigator: {} });
  assert.equal(later.a2hsReturning, true, "a new session after a visit is returning");
  const reload = polishFlags({ window: fakeWindow(local, session), navigator: {} });
  assert.equal(reload.a2hsReturning, false, "same session reload resets like the oracle signal");
});

test("platform words and the iOS standalone probe", () => {
  const w = fakeWindow();
  assert.equal(polishFlags({ window: w, navigator: { userAgent: "iPhone OS 17", standalone: false } }).platform, "ios");
  assert.equal(polishFlags({ window: w, navigator: { userAgent: "iPhone OS 17", standalone: false } }).navigatorStandalone, false);
  assert.equal(polishFlags({ window: w, navigator: { platform: "MacIntel", maxTouchPoints: 5 } }).platform, "ios");
  assert.equal(polishFlags({ window: w, navigator: { userAgent: "Chrome/126.0 Mobile" } }).platform, "chromium");
});

test("flag writes are allowlisted \"1\" markers", () => {
  const local = fakeStorage();
  const b = bridge(fakeWindow(local), {});
  b.save.fire({ key: "onyx:notify-first-run-dismissed" });
  b.save.fire({ key: "onyx:preferences" });
  b.save.fire(null);
  assert.equal(local.getItem("onyx:notify-first-run-dismissed"), "1");
  assert.equal(local.getItem("onyx:preferences"), null);
  assert.equal(local.size, 1);
});

test("beforeinstallprompt is captured silently and prompted only on request", async () => {
  const win = fakeWindow();
  const b = bridge(win, {});
  let prevented = 0;
  let prompted = 0;
  win.dispatch("beforeinstallprompt", {
    preventDefault() { prevented += 1; },
    prompt() { prompted += 1; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  assert.equal(prevented, 1);
  assert.equal(prompted, 0, "never auto-prompted");
  assert.deepEqual(b.events, [{ kind: "install-available" }]);
  b.prompt.fire();
  await tick(); await tick(); await tick();
  assert.equal(prompted, 1);
  assert.deepEqual(b.events.at(-1), { kind: "install-outcome", outcome: "accepted" });
  b.prompt.fire();
  assert.deepEqual(b.events.at(-1), { kind: "install-outcome", outcome: "unavailable" }, "the prompt is single-use");
});

test("no service worker: no update is ever announced and approve just reloads", async () => {
  const win = fakeWindow();
  const b = bridge(win, {});
  await tick();
  assert.equal(b.events.length, 0);
  b.approve.fire();
  await tick();
  assert.equal(win.reloads, 1);
});

test("a waiting worker under a controller announces; approve skips waiting then reloads", async () => {
  const win = fakeWindow();
  const posted = [];
  const containerListeners = {};
  const reg = { waiting: { postMessage(m) { posted.push(m); } }, addEventListener() {} };
  const nav = {
    serviceWorker: {
      controller: {},
      getRegistration() { return Promise.resolve(reg); },
      addEventListener(name, fn) { (containerListeners[name] ||= []).push(fn); },
    },
  };
  const b = bridge(win, nav);
  await tick(); await tick();
  assert.deepEqual(b.events, [{ kind: "update-available" }]);
  b.approve.fire();
  await tick(); await tick();
  assert.deepEqual(posted, [{ type: "ONYX_SKIP_WAITING" }]);
  assert.equal(win.reloads, 0, "reload waits for the new controller");
  containerListeners.controllerchange.forEach((fn) => fn());
  assert.equal(win.reloads, 1);
});
