/* Web-push bridge smoke test — the full enable/recover/disable/active
   paths with a fake PushManager, fake Notification API, in-memory
   markers, and a fake socket. Run with:
     node --test elm/webPush.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

const SERVER = "wss://irc.example:6697";
const ACCOUNT = "alice";
const OWNER_KEY = JSON.stringify([SERVER, ACCOUNT]);
const VAPID = "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";

function memMarkers() {
  const map = {};
  return {
    get: (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null),
    set: (key, value) => { map[key] = value; },
    remove: (key) => { delete map[key]; },
  };
}

function fakeSub(endpoint) {
  const sub = {
    endpoint: endpoint || "https://push.example/sub-1",
    unsubscribed: false,
    toJSON: () => ({ keys: { p256dh: "p256dh-1", auth: "auth-1" } }),
    unsubscribe: () => {
      sub.unsubscribed = true;
      return Promise.resolve(true);
    },
  };
  return sub;
}

function memPush(extra) {
  const state = {
    sub: null,
    socketOpen: true,
    permission: "granted",
    promptCalls: 0,
    subscribeCalls: 0,
    lines: [],
    markers: memMarkers(),
    reg: null,
  };
  Object.assign(state, extra || {});
  const reg = {
    pushManager: {
      getSubscription: () => Promise.resolve(state.sub),
      subscribe: () => {
        state.subscribeCalls += 1;
        state.sub = fakeSub("https://push.example/sub-" + state.subscribeCalls);
        return Promise.resolve(state.sub);
      },
    },
    getNotifications: () => Promise.resolve([]),
  };
  state.reg = reg;
  const push = OnyxPorts.createWebPush({
    supported: true,
    serviceWorkerReady: () => Promise.resolve(reg),
    notification: {
      get permission() { return state.permission; },
      requestPermission: () => {
        state.promptCalls += 1;
        return Promise.resolve(state.permission);
      },
    },
    markerStore: state.markers,
    sendLine: (line) => {
      if (!state.socketOpen) return false;
      state.lines.push(line);
      return true;
    },
    socketOpen: () => state.socketOpen,
  });
  return { state, push };
}

const REQ = { serverUrl: SERVER, account: ACCOUNT, vapidKey: VAPID };

test("probe reports support and permission", async () => {
  const { push } = memPush();
  assert.deepEqual(await push.probe(), { supported: true, permission: "granted" });
  const { push: blind } = memPush();
  const noSupport = OnyxPorts.createWebPush({ supported: false });
  assert.deepEqual(await noSupport.probe(), { supported: false, permission: "unsupported" });
  assert.deepEqual(await blind.probe(), { supported: true, permission: "granted" });
});

test("enable subscribes, marks, and registers", async () => {
  const { state, push } = memPush();
  const reply = await push.enable(REQ);
  assert.deepEqual(reply, { ok: true });
  assert.equal(state.subscribeCalls, 1);
  assert.deepEqual(state.lines, [
    "WEBPUSH SUBSCRIBE https://push.example/sub-1 p256dh-1 auth-1",
  ]);
  assert.equal(state.markers.get("onyx:web-push-owner"), OWNER_KEY);
  assert.equal(state.markers.get("onyx:web-push-intent"), OWNER_KEY);
  assert.equal(state.promptCalls, 1);
});

test("enable gates carry the typed reasons without prompting", async () => {
  const { state, push } = memPush();
  assert.deepEqual(await push.enable({}), { ok: false, reason: "Sign in first — push is tied to your account." });
  assert.deepEqual(
    await push.enable({ ...REQ, serverUrl: "" }),
    { ok: false, reason: "Sign in first — push is tied to your account." },
  );
  const closed = memPush({ socketOpen: false });
  assert.deepEqual(await closed.push.enable(REQ), { ok: false, reason: "Reconnect first." });
  assert.deepEqual(await push.enable({ ...REQ, vapidKey: "" }), { ok: false, reason: "Push is not enabled on this server." });
  assert.deepEqual(await push.enable({ ...REQ, vapidKey: "BEE" }), { ok: false, reason: "Push is misconfigured on this server." });
  assert.deepEqual(
    await push.enable({ ...REQ, vapidKey: VAPID + "=" }),
    { ok: false, reason: "Push is misconfigured on this server." },
  );
  assert.equal(state.promptCalls, 0, "no permission prompt before the gates pass");
  assert.equal(state.subscribeCalls, 0);
  assert.equal(state.lines.length, 0);

  const denied = memPush({ permission: "denied" });
  assert.deepEqual(await denied.push.enable(REQ), { ok: false, reason: "Notifications are blocked by the browser." });
  assert.equal(denied.state.subscribeCalls, 0);
  assert.equal(denied.state.markers.get("onyx:web-push-owner"), null);

  const noSupport = OnyxPorts.createWebPush({ supported: false });
  assert.deepEqual(await noSupport.enable(REQ), { ok: false, reason: "This browser does not support push." });
});

test("recover needs intent and never prompts", async () => {
  const { state, push } = memPush();
  assert.deepEqual(await push.recover(REQ), { ok: false, reason: "Push is not enabled on this browser." });
  assert.equal(state.promptCalls, 0);

  // Intent recorded but the endpoint expired: recovery re-binds.
  state.markers.set("onyx:web-push-intent", OWNER_KEY);
  const reply = await push.recover(REQ);
  assert.deepEqual(reply, { ok: true });
  assert.equal(state.promptCalls, 0, "recovery never prompts");
  assert.deepEqual(state.lines, ["WEBPUSH SUBSCRIBE https://push.example/sub-1 p256dh-1 auth-1"]);
  assert.equal(state.markers.get("onyx:web-push-owner"), OWNER_KEY);

  // Recovery with a denied permission fails closed without prompting.
  const denied = memPush({ permission: "denied" });
  denied.state.markers.set("onyx:web-push-intent", OWNER_KEY);
  assert.deepEqual(
    await denied.push.recover(REQ),
    { ok: false, reason: "Notifications are blocked by the browser." },
  );
  assert.equal(denied.state.promptCalls, 0);
});

test("retire paths: foreign and incomplete subscriptions", async () => {
  // A foreign-marked endpoint is retired before the new subscribe.
  const { state, push } = memPush();
  const old = fakeSub("https://push.example/old");
  state.sub = old;
  state.markers.set("onyx:web-push-owner", JSON.stringify([SERVER, "mallory"]));
  state.markers.set("onyx:web-push-intent", OWNER_KEY);
  const reply = await push.enable(REQ);
  assert.deepEqual(reply, { ok: true });
  assert.equal(old.unsubscribed, true);
  assert.equal(state.markers.get("onyx:web-push-owner"), OWNER_KEY);
  assert.ok(state.lines[0].startsWith("WEBPUSH SUBSCRIBE https://push.example/sub-"));

  // Incomplete keys are retired for a fresh subscription.
  const broken = memPush();
  const half = fakeSub("https://push.example/half");
  half.toJSON = () => ({ keys: { p256dh: "only" } });
  broken.state.sub = half;
  broken.state.markers.set("onyx:web-push-owner", OWNER_KEY);
  const reply2 = await broken.push.enable(REQ);
  assert.deepEqual(reply2, { ok: true });
  assert.equal(half.unsubscribed, true);
  assert.ok(broken.state.lines[0].startsWith("WEBPUSH SUBSCRIBE https://push.example/sub-"));

  // A matching subscription is reused, not recreated.
  const reuse = memPush();
  reuse.state.sub = fakeSub("https://push.example/keep");
  reuse.state.markers.set("onyx:web-push-owner", OWNER_KEY);
  assert.deepEqual(await reuse.push.enable(REQ), { ok: true });
  assert.equal(reuse.state.subscribeCalls, 0);
  assert.deepEqual(reuse.state.lines, ["WEBPUSH SUBSCRIBE https://push.example/keep p256dh-1 auth-1"]);
});

test("disable revokes locally and unregisters", async () => {
  const { state, push } = memPush();
  assert.deepEqual(await push.enable(REQ), { ok: true });
  const sub = state.sub;
  const reply = await push.disable({ serverUrl: SERVER, account: ACCOUNT });
  assert.deepEqual(reply, { ok: true });
  assert.equal(sub.unsubscribed, true);
  assert.deepEqual(state.lines[state.lines.length - 1], "WEBPUSH UNSUBSCRIBE https://push.example/sub-1");
  assert.equal(state.markers.get("onyx:web-push-owner"), null);
  assert.equal(state.markers.get("onyx:web-push-intent"), null);

  // Disabling with no subscription still clears markers.
  const { state: s2, push: p2 } = memPush();
  s2.markers.set("onyx:web-push-owner", OWNER_KEY);
  s2.markers.set("onyx:web-push-intent", OWNER_KEY);
  assert.deepEqual(await p2.disable({ serverUrl: SERVER, account: ACCOUNT }), { ok: true });
  assert.equal(s2.markers.get("onyx:web-push-owner"), null);
  assert.equal(s2.markers.get("onyx:web-push-intent"), null);

  const noSupport = OnyxPorts.createWebPush({ supported: false });
  assert.deepEqual(await noSupport.disable({}), { ok: false, reason: "This browser does not support push." });
});

test("checkActive reflects ownership and retires foreigners", async () => {
  const { state, push } = memPush();
  const idle = await push.checkActive({ serverUrl: SERVER, account: ACCOUNT });
  assert.deepEqual(idle, { active: false, intentDesired: false });

  assert.deepEqual(await push.enable(REQ), { ok: true });
  assert.deepEqual(await push.checkActive({ serverUrl: SERVER, account: ACCOUNT }), {
    active: true,
    intentDesired: true,
  });

  // Another account sees inactive and its endpoint is retired, not inherited.
  const foreign = await push.checkActive({ serverUrl: SERVER, account: "mallory" });
  assert.deepEqual(foreign, { active: false, intentDesired: false });
  assert.equal(state.sub.unsubscribed, true);
  assert.equal(state.markers.get("onyx:web-push-owner"), null);
  // Intent survives so the original owner can recover.
  assert.equal(state.markers.get("onyx:web-push-intent"), OWNER_KEY);
});
