/* Conversation reveal bridge tests. Geometry and animation frames are
   controlled so scroll/focus assertions cover the render boundary and races.
   Run: node --test elm/threadReveal.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;
const stub = () => ({ subscribe() {}, send() {} });

function harness({ followState = false } = {}) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  let frames = [];
  let receive;
  const followStates = [];
  const observers = [];
  const MutationObserver = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends MutationObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  dom.window.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  // Explicit required ports only. A catch-all stub would activate optional
  // background work unrelated to conversation navigation.
  const ports = {
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
    transcriptDownload: stub(),
    mediaSave: stub(),
    threadReveal: { subscribe(callback) { receive = callback; } },
  };
  if (followState) {
    ports.threadFollowState = { send(state) { followStates.push(state); } };
  }
  wire({ ports });
  assert.equal(typeof receive, "function");
  return {
    dom,
    followStates,
    send(request) { receive(request); },
    frame() {
      const pending = frames;
      frames = [];
      for (const callback of pending) callback(0);
    },
    settle() { this.frame(); this.frame(); },
    get queued() { return frames.length; },
    cleanup() {
      // Teardown is explicit: closing jsdom also mutates its body, and an
      // observer must not run after this test removes its document globals.
      for (const observer of observers) observer.disconnect();
      dom.window.close();
      delete globalThis.window;
      delete globalThis.document;
    },
  };
}

function pane(h, { target = "#room", direction = "column", height = 800, viewport = 180, scroll = 51 } = {}) {
  const node = h.dom.window.document.createElement("section");
  node.className = "onyx-thread-pane";
  node.setAttribute("data-conversation", target);
  node.style.flexDirection = direction;
  Object.defineProperties(node, {
    scrollHeight: { value: height, configurable: true },
    clientHeight: { value: viewport, configurable: true },
  });
  node.getBoundingClientRect = () => ({ top: 100 });
  node.scrollTop = scroll;
  h.dom.window.document.body.appendChild(node);
  return node;
}

function row(h, parent, id, top) {
  const node = h.dom.window.document.createElement("li");
  node.setAttribute("data-message-id", id);
  node.setAttribute("tabindex", "-1");
  node.textContent = "Message " + id;
  node.getBoundingClientRect = () => ({ top });
  const focus = node.focus.bind(node);
  const focusOptions = [];
  node.focus = (options) => { focusOptions.push(options); focus(options); };
  parent.appendChild(node);
  return { node, focusOptions };
}

function setGeometry(transcript, { height = transcript.scrollHeight, viewport = transcript.clientHeight } = {}) {
  Object.defineProperties(transcript, {
    scrollHeight: { value: height, configurable: true },
    clientHeight: { value: viewport, configurable: true },
  });
}

function readerScroll(h, transcript, position) {
  transcript.scrollTop = position;
  transcript.dispatchEvent(new h.dom.window.Event("scroll"));
}

async function renderMutations(h) {
  // MutationObserver delivery happens at a microtask checkpoint; a frame is
  // then explicitly flushed rather than waiting for a wall-clock timeout.
  await Promise.resolve();
  h.frame();
}

test("latest waits for the rendered transcript then reaches the normal scroll end", () => {
  const h = harness();
  try {
    const transcript = pane(h);
    h.send({ target: "#room", mode: "latest", rowId: "" });
    assert.equal(transcript.scrollTop, 51);
    h.frame();
    assert.equal(transcript.scrollTop, 51);
    h.frame();
    assert.equal(transcript.scrollTop, 620);
    assert.equal(h.dom.window.document.activeElement, h.dom.window.document.body);
  } finally { h.cleanup(); }
});

test("latest reaches zero in the reversed mobile scroll container", () => {
  const h = harness();
  try {
    const transcript = pane(h, { direction: "column-reverse", scroll: -170 });
    h.send({ target: "#room", mode: "latest", rowId: "" });
    h.settle();
    assert.equal(transcript.scrollTop, 0);
  } finally { h.cleanup(); }
});

test("latest clamps a short normal transcript at zero", () => {
  const h = harness();
  try {
    const transcript = pane(h, { height: 80, viewport: 180 });
    h.send({ target: "#room", mode: "latest", rowId: "" });
    h.settle();
    assert.equal(transcript.scrollTop, 0);
  } finally { h.cleanup(); }
});

test("row ids are compared as complete data values, including selector punctuation", () => {
  const h = harness();
  try {
    const transcript = pane(h, { scroll: 40 });
    const decoy = row(h, transcript, "other", 115);
    const unusualId = 'message"] [data-message-id="other\\line\n雪';
    const requested = row(h, transcript, unusualId, 180);
    h.send({ target: "#room", mode: "row", rowId: unusualId });
    h.settle();
    assert.equal(transcript.scrollTop, 108);
    assert.equal(h.dom.window.document.activeElement, requested.node);
    assert.deepEqual(requested.focusOptions, [{ preventScroll: true }]);
    assert.deepEqual(decoy.focusOptions, []);
  } finally { h.cleanup(); }
});

test("earlier reveals the first stable message row after the new window renders", () => {
  const h = harness();
  try {
    const transcript = pane(h, { scroll: 200 });
    const decoration = h.dom.window.document.createElement("div");
    decoration.textContent = "Earlier messages";
    transcript.appendChild(decoration);
    row(h, transcript, "old-window", 400);
    h.send({ target: "#room", mode: "earlier", rowId: "ignored" });
    h.frame();
    const first = row(h, transcript, "new-window-first", 124);
    transcript.insertBefore(first.node, decoration.nextSibling);
    h.frame();
    assert.equal(transcript.scrollTop, 212);
    assert.equal(h.dom.window.document.activeElement, first.node);
    assert.deepEqual(first.focusOptions, [{ preventScroll: true }]);
  } finally { h.cleanup(); }
});

test("a superseded reveal cannot move focus while the latest request scrolls", () => {
  const h = harness();
  try {
    const transcript = pane(h);
    const obsolete = row(h, transcript, "obsolete", 400);
    h.send({ target: "#room", mode: "row", rowId: "obsolete" });
    h.send({ target: "#room", mode: "latest", rowId: "" });
    h.settle();
    assert.equal(transcript.scrollTop, 620);
    assert.deepEqual(obsolete.focusOptions, []);
    assert.equal(h.dom.window.document.activeElement, h.dom.window.document.body);
  } finally { h.cleanup(); }
});

test("switching conversations before rendering invalidates the pending reveal", () => {
  const h = harness();
  try {
    const transcript = pane(h);
    const obsolete = row(h, transcript, "same-id", 400);
    h.send({ target: "#room", mode: "row", rowId: "same-id" });
    h.frame();
    transcript.setAttribute("data-conversation", "#other");
    h.frame();
    assert.equal(transcript.scrollTop, 51);
    assert.deepEqual(obsolete.focusOptions, []);
    assert.equal(h.dom.window.document.activeElement, h.dom.window.document.body);
  } finally { h.cleanup(); }
});

test("an absent row preserves both scroll position and the current focus", () => {
  const h = harness();
  try {
    const transcript = pane(h, { scroll: 71 });
    row(h, transcript, "present", 400);
    const opener = h.dom.window.document.createElement("button");
    h.dom.window.document.body.appendChild(opener);
    opener.focus();
    h.send({ target: "#room", mode: "row", rowId: "missing" });
    h.settle();
    assert.equal(transcript.scrollTop, 71);
    assert.equal(h.dom.window.document.activeElement, opener);
  } finally { h.cleanup(); }
});

test("an absent transcript and an empty earlier window safely do nothing", () => {
  const h = harness();
  try {
    h.send({ target: "#room", mode: "latest", rowId: "" });
    assert.doesNotThrow(() => h.settle());
    const transcript = pane(h);
    h.send({ target: "#room", mode: "earlier", rowId: "" });
    h.settle();
    assert.equal(transcript.scrollTop, 51);
    assert.equal(h.dom.window.document.activeElement, h.dom.window.document.body);
  } finally { h.cleanup(); }
});

test("unsupported requests do not schedule a scroll or invalidate a valid reveal", () => {
  const h = harness();
  try {
    const transcript = pane(h);
    h.send({ target: "#room", mode: "latest", rowId: "" });
    h.send(null);
    h.send({ target: 4, mode: "latest", rowId: "" });
    h.send({ target: "#room", mode: "unknown", rowId: "" });
    assert.equal(h.queued, 1);
    h.settle();
    assert.equal(transcript.scrollTop, 620);
  } finally { h.cleanup(); }
});

test("appended messages follow a reader near the latest normal transcript row", async () => {
  const h = harness();
  try {
    const transcript = pane(h);
    await renderMutations(h);
    assert.equal(transcript.scrollTop, 620);
    readerScroll(h, transcript, 600);
    setGeometry(transcript, { height: 950 });
    row(h, transcript, "newest", 320);
    await Promise.resolve();
    assert.equal(transcript.scrollTop, 600);
    h.frame();
    assert.equal(transcript.scrollTop, 770);
    assert.equal(h.dom.window.document.activeElement, h.dom.window.document.body);
  } finally { h.cleanup(); }
});

test("a delayed automatic scroll event cannot cancel the next tail follow", async () => {
  const h = harness({ followState: true });
  try {
    const transcript = pane(h, { height: 800, viewport: 180 });
    await renderMutations(h);
    assert.equal(transcript.scrollTop, 620);
    assert.deepEqual(h.followStates, [{ target: "#room", following: true }]);

    setGeometry(transcript, { height: 1100 });
    row(h, transcript, "following-append", 400);
    await Promise.resolve();
    assert.equal(h.queued, 1);

    // A scroll event from the previous automatic position can arrive after
    // content grew but before the pending follow frame. No position changed.
    transcript.dispatchEvent(new h.dom.window.Event("scroll"));
    assert.deepEqual(h.followStates, [{ target: "#room", following: true }]);
    h.frame();
    assert.equal(transcript.scrollTop, 920);
    assert.deepEqual(h.followStates, [{ target: "#room", following: true }]);
  } finally { h.cleanup(); }
});

test("native scroll anchoring is suppressed only while following the current pane", async () => {
  const h = harness();
  try {
    const current = pane(h);
    current.style.setProperty("overflow-anchor", "auto", "important");
    await renderMutations(h);
    assert.equal(current.style.getPropertyValue("overflow-anchor"), "none");
    assert.equal(current.style.getPropertyPriority("overflow-anchor"), "");

    readerScroll(h, current, 200);
    assert.equal(current.style.getPropertyValue("overflow-anchor"), "auto");
    assert.equal(current.style.getPropertyPriority("overflow-anchor"), "important");
    setGeometry(current, { height: 1100 });
    row(h, current, "reader-position", 400);
    await renderMutations(h);
    assert.equal(current.scrollTop, 200);
    assert.equal(current.style.getPropertyValue("overflow-anchor"), "auto");
    assert.equal(current.style.getPropertyPriority("overflow-anchor"), "important");

    h.send({ target: "#room", mode: "latest", rowId: "" });
    h.settle();
    assert.equal(current.scrollTop, 920);
    assert.equal(current.style.getPropertyValue("overflow-anchor"), "none");

    current.remove();
    const next = pane(h, { target: "#next" });
    next.style.setProperty("overflow-anchor", "auto");
    await renderMutations(h);
    assert.equal(current.style.getPropertyValue("overflow-anchor"), "auto");
    assert.equal(current.style.getPropertyPriority("overflow-anchor"), "important");
    assert.equal(next.style.getPropertyValue("overflow-anchor"), "none");

    readerScroll(h, next, 200);
    assert.equal(next.style.getPropertyValue("overflow-anchor"), "auto");
  } finally { h.cleanup(); }
});

test("several mutation batches coalesce to one latest-layout follow frame", async () => {
  const h = harness();
  try {
    const transcript = pane(h);
    await renderMutations(h);
    for (let index = 0; index < 4; index += 1) {
      row(h, transcript, `burst-${index}`, 300 + index);
      await Promise.resolve();
    }
    assert.equal(h.queued, 1);
    setGeometry(transcript, { height: 1200 });
    h.frame();
    assert.equal(transcript.scrollTop, 1020);
    assert.equal(h.queued, 0);
  } finally { h.cleanup(); }
});

test("appended messages keep a reader near the reversed mobile tail at zero", async () => {
  const h = harness();
  try {
    const transcript = pane(h, { direction: "column-reverse", scroll: -170 });
    await renderMutations(h);
    assert.equal(transcript.scrollTop, 0);
    readerScroll(h, transcript, -20);
    setGeometry(transcript, { height: 950 });
    row(h, transcript, "newest", 320);
    await renderMutations(h);
    assert.equal(transcript.scrollTop, 0);
  } finally { h.cleanup(); }
});

for (const [direction, readingPosition] of [["column", 200], ["column-reverse", -180]]) {
  test(`appended messages preserve an away reader's ${direction} scroll offset`, async () => {
    const h = harness();
    try {
      const transcript = pane(h, { direction });
      await renderMutations(h);
      readerScroll(h, transcript, readingPosition);
      setGeometry(transcript, { height: 950 });
      row(h, transcript, "newest", 320);
      await renderMutations(h);
      assert.equal(transcript.scrollTop, readingPosition);
      assert.equal(h.dom.window.document.activeElement, h.dom.window.document.body);
    } finally { h.cleanup(); }
  });

  test(`a queued ${direction} automatic follow yields to a reader who scrolls away`, async () => {
    const h = harness();
    try {
      const transcript = pane(h, { direction });
      await renderMutations(h);
      setGeometry(transcript, { height: 950 });
      row(h, transcript, "newest", 320);
      await Promise.resolve();
      // The append already scheduled a follow, but the reader moves before
      // that animation frame is allowed to change the scroll position.
      readerScroll(h, transcript, readingPosition);
      h.frame();
      assert.equal(transcript.scrollTop, readingPosition);
    } finally { h.cleanup(); }
  });
}

test("resize follows the tail while preserving a reader's deliberate earlier position", async () => {
  const h = harness();
  try {
    const transcript = pane(h);
    await renderMutations(h);
    setGeometry(transcript, { viewport: 240 });
    h.dom.window.dispatchEvent(new h.dom.window.Event("resize"));
    assert.equal(transcript.scrollTop, 620);
    h.frame();
    assert.equal(transcript.scrollTop, 560);
    readerScroll(h, transcript, 200);
    setGeometry(transcript, { viewport: 120 });
    h.dom.window.dispatchEvent(new h.dom.window.Event("resize"));
    h.frame();
    assert.equal(transcript.scrollTop, 200);
  } finally { h.cleanup(); }
});

test("replacing a pane invalidates its already queued resize scroll", async () => {
  const h = harness();
  try {
    const oldPane = pane(h);
    await renderMutations(h);
    readerScroll(h, oldPane, 603);
    h.dom.window.dispatchEvent(new h.dom.window.Event("resize"));
    oldPane.remove();
    const nextPane = pane(h, { target: "#next", height: 1200, viewport: 300, scroll: 19 });
    await renderMutations(h);
    assert.equal(oldPane.scrollTop, 603);
    assert.equal(nextPane.scrollTop, 900);
    // A detached old pane's listener must no longer change the current
    // conversation's follow state.
    readerScroll(h, oldPane, 0);
    setGeometry(nextPane, { height: 1400 });
    row(h, nextPane, "next-message", 320);
    await renderMutations(h);
    assert.equal(oldPane.scrollTop, 0);
    assert.equal(nextPane.scrollTop, 1100);
  } finally { h.cleanup(); }
});

test("unmounting a pane prevents its queued follow callback from changing detached DOM", async () => {
  const h = harness();
  try {
    const transcript = pane(h);
    await renderMutations(h);
    readerScroll(h, transcript, 603);
    h.dom.window.dispatchEvent(new h.dom.window.Event("resize"));
    transcript.remove();
    // Even before the removal observer updates followedPane, isConnected
    // must protect the detached element from the pending resize callback.
    h.frame();
    assert.equal(transcript.scrollTop, 603);
    await renderMutations(h);
    assert.equal(transcript.scrollTop, 603);
  } finally { h.cleanup(); }
});

test("a queued automatic follow cannot override a newer explicit row reveal", async () => {
  const h = harness();
  try {
    const transcript = pane(h, { scroll: 40 });
    const requested = row(h, transcript, "requested", 180);
    await Promise.resolve();
    h.send({ target: "#room", mode: "row", rowId: "requested" });
    h.settle();
    assert.equal(transcript.scrollTop, 108);
    assert.equal(h.dom.window.document.activeElement, requested.node);
    assert.deepEqual(requested.focusOptions, [{ preventScroll: true }]);
  } finally { h.cleanup(); }
});

test("follow state publishes only when its current target or following value changes", async () => {
  const h = harness({ followState: true });
  try {
    const transcript = pane(h);
    await renderMutations(h);
    assert.deepEqual(h.followStates, [{ target: "#room", following: true }]);
    readerScroll(h, transcript, 620);
    readerScroll(h, transcript, 600);
    row(h, transcript, "latest", 320);
    await renderMutations(h);
    assert.equal(h.followStates.length, 1);
    readerScroll(h, transcript, 200);
    readerScroll(h, transcript, 180);
    h.dom.window.dispatchEvent(new h.dom.window.Event("resize"));
    h.frame();
    assert.deepEqual(h.followStates, [
      { target: "#room", following: true },
      { target: "#room", following: false },
    ]);
    h.send({ target: "#room", mode: "latest", rowId: "" });
    h.settle();
    assert.deepEqual(h.followStates, [
      { target: "#room", following: true },
      { target: "#room", following: false },
      { target: "#room", following: true },
    ]);
  } finally { h.cleanup(); }
});

test("a reused pane publishes the new conversation target without accepting a stale reveal", async () => {
  const h = harness({ followState: true });
  try {
    const transcript = pane(h);
    await renderMutations(h);
    transcript.setAttribute("data-conversation", "#next");
    const current = row(h, transcript, "current", 180);
    await renderMutations(h);
    assert.deepEqual(h.followStates, [
      { target: "#room", following: true },
      { target: "#next", following: true },
    ]);
    h.send({ target: "#room", mode: "row", rowId: "current" });
    h.settle();
    assert.deepEqual(current.focusOptions, []);
    assert.equal(h.followStates.length, 2);
    readerScroll(h, transcript, 200);
    assert.deepEqual(h.followStates.at(-1), { target: "#next", following: false });
  } finally { h.cleanup(); }
});

test("replacing a pane projects the new target and drops the old pane's scroll listener", async () => {
  const h = harness({ followState: true });
  try {
    const oldPane = pane(h);
    await renderMutations(h);
    readerScroll(h, oldPane, 200);
    oldPane.remove();
    const nextPane = pane(h, { target: "#next" });
    await renderMutations(h);
    assert.deepEqual(h.followStates, [
      { target: "#room", following: true },
      { target: "#room", following: false },
      { target: "#next", following: true },
    ]);
    readerScroll(h, oldPane, 0);
    assert.equal(h.followStates.length, 3);
    readerScroll(h, nextPane, 200);
    assert.deepEqual(h.followStates.at(-1), { target: "#next", following: false });
  } finally { h.cleanup(); }
});
