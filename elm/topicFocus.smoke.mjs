/* Topic-chip focus smoke test — `topicChipFocus` port: after a forum-card
   open the bridge hands focus to the now-active filter chip
   (`.topic-filter-bar .topic-chip.is-active`), mirroring the `openTopic`
   `queueMicrotask` handoff. Missing chips and missing documents no-op.
   Run with:
     node --test elm/topicFocus.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function harness() {
  let focusHandler = null;
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
      channelNotifySave: stub(),
      starredSave: stub(),
      topicChipFocus: { subscribe(fn) { focusHandler = fn; } },
    },
  };
  globalThis.window = { localStorage: { getItem: () => null } };
  wire(app);
  return { fire: () => focusHandler() };
}

test("focuses the active filter chip with preventScroll", async () => {
  const h = harness();
  const focused = [];
  const chip = { focus(opts) { focused.push(opts); } };
  const queried = [];
  globalThis.document = {
    querySelector(sel) { queried.push(sel); return chip; },
  };
  try {
    h.fire();
    assert.deepEqual(queried, [".topic-filter-bar .topic-chip.is-active"]);
    assert.deepEqual(focused, [{ preventScroll: true }]);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("missing chips and missing documents no-op", async () => {
  const h = harness();
  globalThis.document = { querySelector() { return null; } };
  try {
    h.fire();
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
  const h2 = harness();
  try {
    h2.fire();
  } finally {
    delete globalThis.window;
  }
});
