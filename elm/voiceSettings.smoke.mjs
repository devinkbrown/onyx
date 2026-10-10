/* v3/calls-c9 — voice settings + push-to-talk bridge smoke. Headless in
   node: the PTT runtime (scope rules, repeat, modifiers, editable
   targets, foreign modals, release on keyup / blur / hidden page /
   reconfigure), `onyx:voice-settings` round-trip through the wire()
   bridge, and the enumerateDevices bridge (unavailable / failed /
   ready with capability flags). Run with:
     node --test elm/voiceSettings.smoke.mjs
   Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire, pushToTalk, voiceDevices } = globalThis.OnyxPorts;

function key(k, extra = {}) {
  const ev = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, keyCode: 0, defaultPrevented: false, target: { tagName: "BODY" }, prevented: 0, ...extra };
  ev.preventDefault = () => { ev.prevented += 1; };
  return ev;
}

function rig({ live = true, modal = false } = {}) {
  const calls = [];
  const notes = [];
  const state = { live };
  const doc = { hidden: false, querySelector: () => (modal ? {} : null) };
  const engine = {
    pttPress: () => calls.push("press"),
    pttRelease: () => calls.push("release"),
    setPushToTalk: (on) => calls.push(["ptt", on]),
  };
  const ptt = pushToTalk.create({ isLive: () => state.live, engine: () => engine, notify: (n) => notes.push(n), doc });
  ptt.configure({ pushToTalk: true, pushToTalkKey: "Space" });
  return { ptt, calls, notes, state, doc };
}

test("Space binding matches the space key", () => {
  assert.equal(pushToTalk.matches(" ", "Space"), true);
  assert.equal(pushToTalk.matches("Space", "Space"), true);
  assert.equal(pushToTalk.matches("a", "Space"), false);
  assert.equal(pushToTalk.matches("F8", "F8"), true);
  assert.equal(pushToTalk.matches("F8", null), false);
});

test("hold opens, keyup closes, auto-repeat never re-presses", () => {
  const { ptt, calls, notes } = rig();
  const down = key(" ");
  ptt.onKeyDown(down);
  assert.equal(down.prevented, 1, "Space must not scroll while held");
  const rep = key(" ", { repeat: true });
  ptt.onKeyDown(rep);
  assert.equal(rep.prevented, 1);
  ptt.onKeyUp(key(" "));
  assert.deepEqual(calls.filter((c) => typeof c === "string"), ["press", "release"]);
  assert.deepEqual(notes, ["ptt-down", "ptt-up"]);
});

test("blur and a hidden page release the hold", () => {
  const { ptt, notes, doc } = rig();
  ptt.onKeyDown(key(" "));
  ptt.onBlur();
  assert.deepEqual(notes, ["ptt-down", "ptt-up"]);
  ptt.onKeyDown(key(" "));
  doc.hidden = true;
  ptt.onVisibility();
  assert.deepEqual(notes, ["ptt-down", "ptt-up", "ptt-down", "ptt-up"]);
  assert.equal(ptt.held(), false);
});

test("scope rules: typing targets, modifiers, IME, claimed keys, modals, no call", () => {
  const cases = [
    key(" ", { target: { tagName: "TEXTAREA" } }),
    key(" ", { target: { tagName: "INPUT" } }),
    key(" ", { target: { tagName: "DIV", isContentEditable: true } }),
    key(" ", { ctrlKey: true }),
    key(" ", { metaKey: true }),
    key(" ", { altKey: true }),
    key(" ", { isComposing: true }),
    key(" ", { keyCode: 229 }),
    key(" ", { defaultPrevented: true }),
    key(" ", { repeat: true }),
    key("a"),
  ];
  const { ptt, notes } = rig();
  cases.forEach((ev) => ptt.onKeyDown(ev));
  assert.deepEqual(notes, []);
  const modal = rig({ modal: true });
  modal.ptt.onKeyDown(key(" "));
  assert.deepEqual(modal.notes, []);
  const idle = rig({ live: false });
  const ev = key(" ");
  idle.ptt.onKeyDown(ev);
  assert.deepEqual(idle.notes, []);
  assert.equal(ev.prevented, 0, "outside a call Space keeps its normal meaning");
});

test("disabled or unbound PTT is inert; reconfiguring mid-hold releases", () => {
  const { ptt, notes, calls } = rig();
  ptt.onKeyDown(key(" "));
  ptt.configure({ pushToTalk: false, pushToTalkKey: "Space" });
  assert.deepEqual(notes, ["ptt-down", "ptt-up"]);
  assert.deepEqual(calls.at(-1), ["ptt", false]);
  ptt.onKeyDown(key(" "));
  assert.deepEqual(notes, ["ptt-down", "ptt-up"]);
  ptt.configure({ pushToTalk: true, pushToTalkKey: "" });
  ptt.onKeyDown(key(" "));
  assert.deepEqual(notes, ["ptt-down", "ptt-up"]);
});

function stub() {
  return { subscribe() {} };
}

function corePorts() {
  return {
    wsConnect: stub(), wsSend: stub(), wsClose: stub(), vaultPut: stub(), vaultGet: stub(),
    passkeyCreate: stub(), passkeyGet: stub(), passkeySettleRequest: stub(), dmSealRequest: stub(),
    dmOpenRequest: stub(), dmPublishKey: stub(), roomSealRequest: stub(), roomOpenRequest: stub(),
    groupControlInstall: stub(), groupDirectoryDerive: stub(), clipboardCopy: stub(), clipboardResult: { send() {} },
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("prefs round-trip: save writes onyx:voice-settings, the next boot replays it", async () => {
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage, addEventListener() {} };
  try {
    let save = null;
    const feed1 = [];
    wire({ ports: { ...corePorts(), voicePrefsSave: { subscribe(fn) { save = fn; } }, voiceSettingsFeed: { send: (v) => feed1.push(v) } } });
    await sleep(5);
    assert.deepEqual(feed1, [], "nothing stored yet: no replay");
    const prefs = { muteOnJoin: false, pushToTalk: true, pushToTalkKey: "F8", outputVolume: 40 };
    save({ json: JSON.stringify(prefs) });
    save({ json: "[1,2]" });
    save({ json: "{not json" });
    assert.deepEqual(JSON.parse(storage.getItem(pushToTalk.storageKey)), prefs);
    const feed2 = [];
    wire({ ports: { ...corePorts(), voicePrefsSave: stub(), voiceSettingsFeed: { send: (v) => feed2.push(v) } } });
    await sleep(5);
    assert.deepEqual(feed2, [{ kind: "prefs", prefs }]);
  } finally {
    delete globalThis.window;
  }
});

test("devices bridge: unavailable, failed, and ready with capability flags", async () => {
  assert.deepEqual((await voiceDevices(null, null)).error, "unavailable");
  const failing = { mediaDevices: { enumerateDevices: () => Promise.reject(new Error("denied")) } };
  assert.equal((await voiceDevices(failing, null)).error, "failed");
  const nav = {
    mediaDevices: {
      enumerateDevices: () => Promise.resolve([
        { deviceId: "m1", kind: "audioinput", label: "" },
        { deviceId: "s1", kind: "audiooutput", label: "Desk" },
      ]),
      getSupportedConstraints: () => ({ noiseSuppression: true, echoCancellation: false }),
      selectAudioOutput: () => Promise.resolve(null),
    },
  };
  const ready = await voiceDevices(nav, { setVoiceActivity() {} });
  assert.equal(ready.kind, "devices");
  assert.equal(ready.devices.length, 2);
  assert.deepEqual(ready.caps, { selectAudioOutput: true, noiseSuppression: true, echoCancellation: false, voiceActivity: true });
  const plain = await voiceDevices(nav, null);
  assert.equal(plain.caps.voiceActivity, false);
});
