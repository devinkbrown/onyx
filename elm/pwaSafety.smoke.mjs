/* v3/gap-pwa-safety smoke — the Elm build's service-worker registration
   (gated: real container, https/loopback, after load, HEAD-probed as
   JavaScript, silent on every failure; visible/online re-checks), the
   polish update strip ignoring the page's own boot check, the bounded
   `serviceWorker.ready` wait for Web Push, and the page-restore
   reconcile (bfcache / freeze) with the immediate keepalive probe.
   Fakes only — no browser. Run with: node --test elm/pwaSafety.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

const tick = (n = 6) => new Promise((resolve) => {
  let left = n;
  const step = () => (left-- <= 0 ? resolve() : setTimeout(step, 0));
  step();
});

function target() {
  const listeners = {};
  return {
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); },
    fire(name, event) { (listeners[name] || []).slice().forEach((fn) => fn(event || {})); },
    count(name) { return (listeners[name] || []).length; },
  };
}

function fakeWorker(state = "installing") {
  const t = target();
  const worker = Object.assign(t, {
    state,
    posted: [],
    postMessage(m) { worker.posted.push(m); },
    become(next) { worker.state = next; t.fire("statechange"); },
  });
  return worker;
}

function fakeRegistration() {
  const t = target();
  const reg = Object.assign(t, {
    installing: null,
    waiting: null,
    active: null,
    updates: 0,
    update() { reg.updates += 1; return Promise.resolve(reg); },
    // A newer worker starts installing (browser or our update check).
    found(worker) { reg.installing = worker; t.fire("updatefound"); },
  });
  return reg;
}

function fakeEnv(opts = {}) {
  const {
    protocol = "https:",
    hostname = "eshmaki.me",
    readyState = "complete",
    head = { ok: true, type: "application/javascript; charset=utf-8" },
    secure = true,
    registerRejects = false,
    hasContainer = true,
  } = opts;
  const win = Object.assign(target(), { location: { protocol, hostname }, isSecureContext: secure });
  const doc = Object.assign(target(), { readyState, visibilityState: "visible" });
  const reg = fakeRegistration();
  const registered = [];
  const container = Object.assign(target(), {
    controller: opts.controller || null,
    register(url, options) {
      registered.push([url, options]);
      return registerRejects ? Promise.reject(new Error("bad script")) : Promise.resolve(reg);
    },
    getRegistration() { return Promise.resolve(opts.existing || null); },
  });
  const nav = hasContainer ? { serviceWorker: container, onLine: true } : { onLine: true };
  const fetched = [];
  const fetch = (url, init) => {
    fetched.push([url, init]);
    return Promise.resolve({
      ok: head.ok,
      redirected: false,
      headers: { get: (k) => (k.toLowerCase() === "content-type" ? head.type : null) },
    });
  };
  let clock = 1000;
  const timers = [];
  return {
    win, doc, nav, reg, container, registered, fetched, timers,
    advance(ms) { clock += ms; },
    env: {
      window: win,
      document: doc,
      navigator: nav,
      fetch,
      now: () => clock,
      setInterval: (fn, ms) => { timers.push([fn, ms]); return timers.length; },
    },
  };
}

/* ── registration gate ─────────────────────────────────────────────── */

test("https: HEAD-probes /sw.js, then registers it at scope / with updateViaCache none", async () => {
  const e = fakeEnv();
  const reg = await OnyxPorts.registerServiceWorker(e.env);
  assert.equal(reg, e.reg);
  assert.deepEqual(e.fetched.map(([url, init]) => [url, init.method, init.cache]), [["/sw.js", "HEAD", "no-store"]]);
  assert.deepEqual(e.registered, [["/sw.js", { scope: "/", updateViaCache: "none" }]]);
  assert.equal(OnyxPorts.swUrl, "/sw.js");
});

test("waits for load before touching the network", async () => {
  const e = fakeEnv({ readyState: "interactive" });
  const pending = OnyxPorts.registerServiceWorker(e.env);
  await tick();
  assert.equal(e.fetched.length, 0, "nothing before load");
  e.win.fire("load");
  assert.equal(await pending, e.reg);
  assert.equal(e.registered.length, 1);
});

test("loopback http (localhost, 127.0.0.1, [::1]) registers; other http never does", async () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]", "app.localhost"]) {
    const e = fakeEnv({ protocol: "http:", hostname });
    assert.equal(await OnyxPorts.registerServiceWorker(e.env), e.reg, hostname);
  }
  for (const [protocol, hostname, secure] of [["http:", "eshmaki.me", false], ["http:", "192.168.1.4", false], ["file:", "", false]]) {
    const e = fakeEnv({ protocol, hostname, secure });
    assert.equal(await OnyxPorts.registerServiceWorker(e.env), null, `${protocol}//${hostname}`);
    assert.equal(e.fetched.length + e.registered.length, 0, "no probe, no register");
  }
});

test("an SPA fallback (HTML) or a missing /sw.js is skipped silently — register() never runs", async () => {
  for (const head of [{ ok: true, type: "text/html" }, { ok: false, type: "text/plain" }, { ok: true, type: "" }]) {
    const e = fakeEnv({ head });
    assert.equal(await OnyxPorts.registerServiceWorker(e.env), null);
    assert.equal(e.fetched.length, 1);
    assert.equal(e.registered.length, 0, "register() would log a console error");
  }
});

test("no container (node / jsdom) and a rejecting register both resolve null, never throw", async () => {
  assert.equal(await OnyxPorts.registerServiceWorker({}), null);
  assert.equal(await OnyxPorts.registerServiceWorker(fakeEnv({ hasContainer: false }).env), null);
  const e = fakeEnv({ registerRejects: true });
  assert.equal(await OnyxPorts.registerServiceWorker(e.env), null);
  e.env.fetch = () => Promise.reject(new TypeError("offline"));
  assert.equal(await OnyxPorts.registerServiceWorker(e.env), null);
});

test("a long-lived tab re-checks for a newer worker while visible and online, at most every 30 min", async () => {
  const e = fakeEnv();
  await OnyxPorts.registerServiceWorker(e.env);
  assert.equal(e.timers.length, 1);
  assert.equal(e.timers[0][1], 30 * 60 * 1000);
  e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 0, "too soon after registering");
  e.advance(30 * 60 * 1000);
  e.doc.visibilityState = "hidden";
  e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 0, "hidden tabs wait");
  e.doc.visibilityState = "visible";
  e.nav.onLine = false;
  e.timers[0][0]();
  assert.equal(e.reg.updates, 0, "offline waits");
  e.nav.onLine = true;
  e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 1);
  e.timers[0][0]();
  assert.equal(e.reg.updates, 1, "throttled");
});

/* ── update strip (polish bridge) ───────────────────────────────────── */

function polishBridge(e, registration) {
  const events = [];
  let approve = null;
  const reloads = { n: 0 };
  e.win.location.reload = () => { reloads.n += 1; };
  const app = {
    ports: {
      pwaEvent: { send: (ev) => events.push(ev) },
      pwaUpdateApprove: { subscribe: (fn) => { approve = fn; } },
    },
  };
  OnyxPorts.wirePolish(app, { window: e.win, navigator: e.nav, registration });
  return { events, approve: () => approve(), reloads };
}

test("the page's own boot check never announces (network-first: this document is current)", async () => {
  const e = fakeEnv({ controller: {} });
  const boot = fakeWorker("installing");
  e.reg.installing = boot;
  const b = polishBridge(e, Promise.resolve(e.reg));
  await tick();
  boot.become("installed");
  boot.become("activated");
  e.container.fire("controllerchange");
  await tick();
  assert.deepEqual(b.events, []);
});

test("an update found during boot (before registration settles) is the boot check too", async () => {
  const e = fakeEnv({ controller: {} });
  e.container.getRegistration = () => Promise.resolve(e.reg);
  let settle;
  const registration = new Promise((r) => { settle = r; });
  const b = polishBridge(e, registration);
  await tick();
  const soft = fakeWorker();
  e.reg.found(soft);
  soft.become("installed");
  settle(e.reg);
  await tick();
  assert.deepEqual(b.events, []);
});

test("a later update under a controller announces once; approve reloads (sw.js skips waiting)", async () => {
  const e = fakeEnv({ controller: {} });
  const b = polishBridge(e, Promise.resolve(e.reg));
  await tick();
  const next = fakeWorker();
  e.reg.found(next);
  next.become("installed");
  next.become("activated");
  const again = fakeWorker();
  e.reg.found(again);
  again.become("installed");
  assert.deepEqual(b.events, [{ kind: "update-available" }]);
  b.approve();
  await tick();
  assert.equal(b.reloads.n, 1, "no waiting worker: plain reload");
});

test("approve with a waiting worker posts ONYX_SKIP_WAITING and reloads on controllerchange", async () => {
  const e = fakeEnv({ controller: {} });
  const waiting = fakeWorker("installed");
  e.reg.waiting = waiting;
  e.container.getRegistration = () => Promise.resolve(e.reg);
  const b = polishBridge(e, Promise.resolve(null));
  await tick();
  assert.deepEqual(b.events, [{ kind: "update-available" }], "a worker left waiting by an earlier visit");
  b.approve();
  await tick();
  assert.deepEqual(waiting.posted, [{ type: "ONYX_SKIP_WAITING" }]);
  assert.equal(b.reloads.n, 0);
  e.container.fire("controllerchange");
  assert.equal(b.reloads.n, 1);
});

test("the very first install (no controller yet) never announces", async () => {
  const e = fakeEnv({ controller: null });
  const b = polishBridge(e, Promise.resolve(e.reg));
  await tick();
  const first = fakeWorker();
  e.reg.found(first);
  first.become("installed");
  assert.deepEqual(b.events, []);
});

/* ── Web Push: bounded serviceWorker.ready ──────────────────────────── */

const SERVER = "wss://irc.example:6697";
const VAPID = "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";

function pushDeps(container, registration, extra = {}) {
  const map = {};
  return Object.assign({
    supported: true,
    notification: { permission: "granted", requestPermission: () => Promise.resolve("granted") },
    markerStore: {
      get: (k) => (k in map ? map[k] : null),
      set: (k, v) => { map[k] = v; },
      remove: (k) => { delete map[k]; },
    },
    socketOpen: () => true,
    sendLine: () => true,
    serviceWorkerContainer: container,
    registration,
    readyTimeoutMs: 25,
  }, extra);
}

test("enable fails with a typed reason instead of hanging when no worker ever becomes ready", async () => {
  const push = OnyxPorts.createWebPush(pushDeps({ ready: new Promise(() => {}) }, Promise.resolve(null)));
  const started = Date.now();
  const reply = await push.enable({ serverUrl: SERVER, account: "alice", vapidKey: VAPID });
  assert.equal(reply.ok, false);
  assert.match(reply.reason, /background worker isn't running/);
  assert.ok(Date.now() - started < 2000);
  const off = await push.disable({ serverUrl: SERVER, account: "alice" });
  assert.deepEqual(off, { ok: false, reason: "Turning off push failed. Try again." });
  assert.deepEqual(await push.checkActive({ serverUrl: SERVER, account: "alice" }), { active: false, intentDesired: false });
});

test("ready waits for this page's registration, then subscribes and sends WEBPUSH SUBSCRIBE", async () => {
  const lines = [];
  const sub = {
    endpoint: "https://push.example/sub-1",
    toJSON: () => ({ keys: { p256dh: "p256", auth: "auth" } }),
    unsubscribe: () => Promise.resolve(true),
  };
  const reg = { pushManager: { getSubscription: () => Promise.resolve(null), subscribe: () => Promise.resolve(sub) } };
  let settle;
  const registration = new Promise((r) => { settle = r; });
  const push = OnyxPorts.createWebPush(pushDeps({ ready: Promise.resolve(reg) }, registration, {
    sendLine: (l) => { lines.push(l); return true; },
    readyTimeoutMs: 5000,
  }));
  const pending = push.enable({ serverUrl: SERVER, account: "alice", vapidKey: VAPID });
  await tick();
  assert.deepEqual(lines, [], "nothing until the registration attempt settles");
  settle(reg);
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(lines, ["WEBPUSH SUBSCRIBE https://push.example/sub-1 p256 auth"]);
});

/* ── page restore ───────────────────────────────────────────────────── */

test("bfcache restore reconciles once per suspension; plain loads never do", () => {
  const page = target();
  const life = target();
  let restores = 0;
  OnyxPorts.installPageLifecycle(() => { restores += 1; }, { pageTarget: page, lifecycleTarget: life, supportsFreezeResume: true });
  page.fire("pageshow", { persisted: false });
  assert.equal(restores, 0);
  page.fire("pagehide", { persisted: true });
  page.fire("pageshow", { persisted: true });
  page.fire("pageshow", { persisted: true });
  assert.equal(restores, 1);
  page.fire("pagehide", { persisted: true });
  page.fire("pageshow", { persisted: true });
  assert.equal(restores, 2);
});

test("freeze → resume reconciles; a resume without a freeze does not", () => {
  const page = target();
  const life = target();
  let restores = 0;
  const handle = OnyxPorts.installPageLifecycle(() => { restores += 1; }, { pageTarget: page, lifecycleTarget: life, supportsFreezeResume: true });
  life.fire("resume");
  assert.equal(restores, 0);
  life.fire("freeze");
  life.fire("resume");
  life.fire("resume");
  assert.equal(restores, 1);
  handle.stop();
  assert.equal(page.count("pageshow") + life.count("resume"), 0);
  assert.equal(OnyxPorts.installPageLifecycle(() => {}, { pageTarget: null }), null);
});

test("keepalive probe: an immediate PING; silence closes into reconnect, a PONG keeps the socket", async () => {
  const sent = [];
  const closed = [];
  const app = { ports: { pingDue: { send: (v) => sent.push(v) } } };
  const sock = { close: (code, reason) => closed.push([code, reason]) };
  const dead = OnyxPorts.pingKeepalive.create(app, sock, { idleMs: 10000, timeoutMs: 10 });
  dead.probe();
  assert.equal(sent.length, 1, "probe fires at once");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(closed, [[4001, "Ping timeout"]]);

  const live = OnyxPorts.pingKeepalive.create(app, sock, { idleMs: 10000, timeoutMs: 20 });
  live.probe();
  live.observed();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(closed.length, 1, "the answered probe never closes");
  live.clear();
});
