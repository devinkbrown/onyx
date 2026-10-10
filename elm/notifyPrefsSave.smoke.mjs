/* Notify-prefs smoke test — `onyx:push-notifications` / `onyx:sound` slots:
   Elm owns the desktop/sound toggle folds; the bridge only persists the
   validated booleans, mirroring the oracle `setPushNotificationsEnabled` /
   `setSoundEnabled` writers (index.html boots flags from these same keys).
   Run with:
     node --test elm/notifyPrefsSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const PUSH_KEY = "onyx:push-notifications";
const SOUND_KEY = "onyx:sound";

function harness(store) {
  let pushHandler = null;
  let soundHandler = null;
  const stub = () => ({ subscribe() {} });
  const app = {
    ports: {
      wsConnect: stub(),
      wsSend: stub(),
      wsClose: stub(),
      vaultPut: stub(),
      vaultGet: stub(),
      passkeyCreate: stub(),
      passkeyGet: stub(),
      passkeySettleRequest: stub(),
      dmSealRequest: stub(),
      dmOpenRequest: stub(),
      dmPublishKey: stub(),
      roomSealRequest: stub(),
      roomOpenRequest: stub(),
      groupControlInstall: stub(),
      groupDirectoryDerive: stub(),
      guidesProgressRequest: stub(),
      guidesProgressStore: stub(),
      blocklistsSave: stub(),
      highlightWordsSave: stub(),
      dndSave: stub(),
      notifyPushSave: { subscribe(fn) { pushHandler = fn; } },
      notifySoundSave: { subscribe(fn) { soundHandler = fn; } },
    },
  };
  globalThis.window = { localStorage: store };
  wire(app);
  return { pushHandler, soundHandler };
}

function memStore(initial) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

test("push toggle persists under the boot-read key", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.pushHandler({ enabled: false });
    assert.equal(store.data[PUSH_KEY], "false");
    h.pushHandler({ enabled: true });
    assert.equal(store.data[PUSH_KEY], "true");
  } finally {
    delete globalThis.window;
  }
});

test("sound toggle persists under the boot-read key", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.soundHandler({ enabled: false });
    assert.equal(store.data[SOUND_KEY], "false");
    h.soundHandler({ enabled: true });
    assert.equal(store.data[SOUND_KEY], "true");
  } finally {
    delete globalThis.window;
  }
});

test("non-boolean payloads are skipped without writing", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.pushHandler({ enabled: "yes" });
    h.soundHandler(null);
    assert.equal(PUSH_KEY in store.data, false);
    assert.equal(SOUND_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});
