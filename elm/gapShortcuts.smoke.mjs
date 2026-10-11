/* v3/gap-commands — the shell chords of the oracle `shortcutsRegistry`
   through the ONE `shortcut` port (ports.js `classifyShortcut`), the
   focus-only keys ports.js runs itself (`runLocalShortcut`: J/K message
   focus, Enter / Alt+Enter composer focus, Alt+S room list, Alt+M
   member list), the single-key switch (WCAG 2.1.4) and the palette
   recents storage (`wireGapPrefs`).
   Scope rules: Ctrl/Cmd+, also while typing; composer chords
   (Ctrl+Shift+U / L) also from the composer; every other chord never
   while typing, never under a foreign modal, never during IME.
   Run with:
     node --test elm/gapShortcuts.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { classifyShortcut, runLocalShortcut, wireGapPrefs, wireShortcuts } = globalThis.OnyxPorts;

const noModal = { querySelector: () => null };
const foreignModal = { querySelector: (sel) => (sel.includes('aria-modal="true"') ? {} : null) };
const inCall = { querySelector: (sel) => (sel.includes('data-call-keys="on"') ? {} : null) };

const body = { tagName: "BODY", isContentEditable: false, getAttribute: () => null, closest: () => null };
const input = { tagName: "INPUT", isContentEditable: false, getAttribute: () => null, closest: () => null };
const composer = { tagName: "TEXTAREA", id: "shell-composer-input", getAttribute: () => null, closest: () => null };
const buttonTarget = { tagName: "BUTTON", getAttribute: () => null, closest: (sel) => (sel.includes("button") ? {} : null) };

function key(overrides = {}) {
  return {
    key: "a",
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    target: body,
    ...overrides,
  };
}

const on = { singleKeys: true, now: 1000 };

test("Alt+↑/↓ step conversations; Alt+Shift+↑/↓ step unread ones", () => {
  assert.deepEqual(classifyShortcut(key({ key: "ArrowUp", altKey: true }), noModal, on), { name: "conv-prev", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "ArrowDown", altKey: true }), noModal, on), { name: "conv-next", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "ArrowUp", altKey: true, shiftKey: true }), noModal, on), { name: "unread-prev", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "ArrowDown", altKey: true, shiftKey: true }), noModal, on), { name: "unread-next", prevent: true });
  // Typing (Alt+↑ moves the caret on macOS) and modals keep the key.
  assert.equal(classifyShortcut(key({ key: "ArrowUp", altKey: true, target: input }), noModal, on), null);
  assert.equal(classifyShortcut(key({ key: "ArrowUp", altKey: true }), foreignModal, on), null);
});

test("Ctrl/Cmd+, opens preferences, even from the composer", () => {
  assert.deepEqual(classifyShortcut(key({ key: ",", ctrlKey: true }), noModal, on), { name: "prefs", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: ",", metaKey: true, target: composer }), noModal, on), { name: "prefs", prevent: true });
  assert.equal(classifyShortcut(key({ key: ",", ctrlKey: true }), foreignModal, on), null);
});

test("Ctrl/Cmd+Shift shell chords outside calls", () => {
  const table = { A: "account", E: "mark-read", D: "dnd", M: "room-mute", U: "attach", L: "schedule" };
  for (const [k, name] of Object.entries(table)) {
    assert.deepEqual(classifyShortcut(key({ key: k, ctrlKey: true, shiftKey: true }), noModal, on), { name, prevent: true });
    assert.deepEqual(classifyShortcut(key({ key: k.toLowerCase(), metaKey: true, shiftKey: true }), noModal, on), { name, prevent: true });
  }
});

test("a live call keeps M / E / L for itself; A / D / U stay the shell's", () => {
  assert.deepEqual(classifyShortcut(key({ key: "M", ctrlKey: true, shiftKey: true }), inCall, on), { name: "call-mute", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "E", ctrlKey: true, shiftKey: true }), inCall, on), { name: "call-camera", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "L", ctrlKey: true, shiftKey: true }), inCall, on), { name: "call-leave", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "A", ctrlKey: true, shiftKey: true }), inCall, on), { name: "account", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "D", ctrlKey: true, shiftKey: true }), inCall, on), { name: "dnd", prevent: true });
});

test("only the composer chords fire from the composer; no chord fires from other fields", () => {
  assert.deepEqual(classifyShortcut(key({ key: "U", ctrlKey: true, shiftKey: true, target: composer }), noModal, on), { name: "attach", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "L", ctrlKey: true, shiftKey: true, target: composer }), noModal, on), { name: "schedule", prevent: true });
  for (const k of ["A", "E", "D", "M"]) {
    assert.equal(classifyShortcut(key({ key: k, ctrlKey: true, shiftKey: true, target: composer }), noModal, on), null);
  }
  for (const k of ["U", "L"]) {
    assert.equal(classifyShortcut(key({ key: k, ctrlKey: true, shiftKey: true, target: input }), noModal, on), null);
  }
});

test("Ctrl+B stars, Ctrl+Alt+E exports — never while typing (AltGr text wins)", () => {
  assert.deepEqual(classifyShortcut(key({ key: "b", ctrlKey: true }), noModal, on), { name: "room-star", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "´", code: "KeyE", metaKey: true, altKey: true }), noModal, on), { name: "export", prevent: true });
  assert.equal(classifyShortcut(key({ key: "b", ctrlKey: true, target: composer }), noModal, on), null);
  assert.equal(classifyShortcut(key({ key: "€", code: "KeyE", ctrlKey: true, altKey: true, target: input }), noModal, on), null);
});

test("Alt+M / Alt+S / Alt+Enter are local focus keys, layout-safe on macOS", () => {
  assert.deepEqual(classifyShortcut(key({ key: "µ", code: "KeyM", altKey: true }), noModal, on), { name: "members", prevent: true, local: true });
  assert.deepEqual(classifyShortcut(key({ key: "ß", code: "KeyS", altKey: true }), noModal, on), { name: "sidebar-focus", prevent: true, local: true });
  assert.deepEqual(classifyShortcut(key({ key: "Enter", altKey: true }), noModal, on), { name: "composer-focus", prevent: true, local: true });
  assert.equal(classifyShortcut(key({ key: "Enter", altKey: true, target: buttonTarget }), noModal, on), null);
});

test("Enter focuses the composer unless a control owns it", () => {
  assert.deepEqual(classifyShortcut(key({ key: "Enter" }), noModal, on), { name: "composer-focus", prevent: true, local: true });
  assert.equal(classifyShortcut(key({ key: "Enter", target: buttonTarget }), noModal, on), null);
  assert.equal(classifyShortcut(key({ key: "Enter", target: input }), noModal, on), null);
  assert.equal(classifyShortcut(key({ key: "Enter", shiftKey: true }), noModal, on), null);
  // Not a character key: the single-key switch leaves Enter alone.
  assert.deepEqual(classifyShortcut(key({ key: "Enter" }), noModal, { singleKeys: false }), { name: "composer-focus", prevent: true, local: true });
});

test("J / K / N / U single keys, never while typing or with modifiers", () => {
  assert.deepEqual(classifyShortcut(key({ key: "j" }), noModal, on), { name: "message-next", prevent: true, local: true });
  assert.deepEqual(classifyShortcut(key({ key: "k" }), noModal, on), { name: "message-prev", prevent: true, local: true });
  assert.deepEqual(classifyShortcut(key({ key: "n" }), noModal, on), { name: "next-unread", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "u" }), noModal, on), { name: "follow", prevent: true });
  for (const k of ["j", "k", "n", "u", "g"]) {
    assert.equal(classifyShortcut(key({ key: k, target: input }), noModal, on), null);
    assert.equal(classifyShortcut(key({ key: k, target: composer }), noModal, on), null);
    assert.equal(classifyShortcut(key({ key: k.toUpperCase(), shiftKey: true }), noModal, on), null);
    assert.equal(classifyShortcut(key({ key: k, isComposing: true }), noModal, on), null);
    assert.equal(classifyShortcut(key({ key: k }), foreignModal, on), null);
  }
  // J / K leave a focused control alone.
  assert.equal(classifyShortcut(key({ key: "j", target: buttonTarget }), noModal, on), null);
});

test("G then H / G then D inside 1.2s; anything else cancels the sequence", () => {
  assert.deepEqual(classifyShortcut(key({ key: "g" }), noModal, { singleKeys: true, now: 1000 }), { name: "", prevent: true, local: true });
  assert.deepEqual(classifyShortcut(key({ key: "h" }), noModal, { singleKeys: true, now: 1500 }), { name: "go-home", prevent: true });
  classifyShortcut(key({ key: "g" }), noModal, { singleKeys: true, now: 3000 });
  assert.deepEqual(classifyShortcut(key({ key: "d" }), noModal, { singleKeys: true, now: 3100 }), { name: "go-date", prevent: true });
  // Too slow.
  classifyShortcut(key({ key: "g" }), noModal, { singleKeys: true, now: 5000 });
  assert.equal(classifyShortcut(key({ key: "h" }), noModal, { singleKeys: true, now: 6300 }), null);
  // A modified chord in between cancels it; the plain key after is just itself.
  classifyShortcut(key({ key: "g" }), noModal, { singleKeys: true, now: 7000 });
  classifyShortcut(key({ key: "ArrowDown", altKey: true }), noModal, { singleKeys: true, now: 7100 });
  classifyShortcut(key({ key: "x" }), noModal, { singleKeys: true, now: 7150 });
  assert.equal(classifyShortcut(key({ key: "h" }), noModal, { singleKeys: true, now: 7200 }), null);
});

test("the single-key switch silences ?, /, J, K, N, U and G", () => {
  const off = { singleKeys: false, now: 1 };
  for (const k of ["?", "/", "j", "k", "n", "u", "g"]) {
    assert.equal(classifyShortcut(key({ key: k, shiftKey: k === "?" }), noModal, off), null);
  }
  // Modifier chords are untouched.
  assert.deepEqual(classifyShortcut(key({ key: "k", ctrlKey: true }), noModal, off), { name: "palette-toggle", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "ArrowDown", altKey: true }), noModal, off), { name: "conv-next", prevent: true });
});

function dom(html) {
  const d = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { pretendToBeVisual: true });
  /* jsdom has no layout: everything not [hidden] reports one box. */
  d.window.Element.prototype.getClientRects = function () {
    return this.closest("[hidden]") || this.dataset.offscreen === "true" ? [] : [{}];
  };
  return d.window.document;
}

const transcript = `
  <textarea id="shell-composer-input"></textarea>
  <div data-transcript-key="r:#c"><ul class="onyx-thread">
    <li class="onyx-message" role="article" tabindex="-1" id="m1">one</li>
    <li class="onyx-system" role="article" tabindex="-1" id="s1">joined</li>
    <li class="onyx-message" role="article" tabindex="-1" id="m2">two</li>
    <li class="onyx-message" role="article" tabindex="-1" id="m3" hidden>hidden</li>
    <li class="onyx-message" role="article" tabindex="-1" id="m4">four</li>
  </ul></div>`;

test("J / K walk the visible message rows; the first press lands on the newest", () => {
  const doc = dom(transcript);
  doc.defaultView.HTMLElement.prototype.scrollIntoView = function () {};
  assert.equal(runLocalShortcut("message-next", doc), true);
  assert.equal(doc.activeElement.id, "m4");
  assert.equal(runLocalShortcut("message-prev", doc), true);
  assert.equal(doc.activeElement.id, "m2");
  runLocalShortcut("message-prev", doc);
  assert.equal(doc.activeElement.id, "m1");
  runLocalShortcut("message-prev", doc);
  assert.equal(doc.activeElement.id, "m1", "clamps at the top");
  runLocalShortcut("message-next", doc);
  assert.equal(doc.activeElement.id, "m2", "skips system and hidden rows");
});

test("Enter / Alt+Enter focus the composer; nothing to focus keeps the key", () => {
  const doc = dom(transcript);
  assert.equal(runLocalShortcut("composer-focus", doc), true);
  assert.equal(doc.activeElement.id, "shell-composer-input");
  const empty = dom("<p>landing</p>");
  assert.equal(runLocalShortcut("composer-focus", empty), false);
  assert.equal(runLocalShortcut("message-next", empty), false);
});

test("Alt+S focuses the current room in the list", () => {
  const doc = dom(`<button class="onyx-rail-item" aria-current="false" id="a">#a</button>
    <button class="onyx-rail-item" aria-current="location" id="b">#b</button>`);
  assert.equal(runLocalShortcut("sidebar-focus", doc), true);
  assert.equal(doc.activeElement.id, "b");
});

test("Alt+M opens the member sheet when narrow, moves into the rail when wide", () => {
  const narrow = dom(`<button data-testid="members-toggle" id="t">Members</button><section id="onyx-members"><button id="first">ana</button></section>`);
  let clicked = 0;
  narrow.getElementById("t").addEventListener("click", () => { clicked += 1; });
  assert.equal(runLocalShortcut("members", narrow), true);
  assert.equal(clicked, 1);
  const wide = dom(`<button data-testid="members-toggle" data-offscreen="true">Members</button><section id="onyx-members"><button id="first">ana</button></section>`);
  assert.equal(runLocalShortcut("members", wide), true);
  assert.equal(wide.activeElement.id, "first");
});

test("local keys stand aside under the palette or the shortcuts sheet", () => {
  const doc = dom(transcript + `<div data-shortcut-scope="shortcuts"><button>x</button></div>`);
  assert.equal(runLocalShortcut("composer-focus", doc), false);
  assert.equal(runLocalShortcut("message-next", doc), false);
});

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

function prefsApp() {
  const subs = {};
  const sent = [];
  const port = (name) => ({ subscribe(fn) { subs[name] = fn; } });
  return {
    app: {
      ports: {
        paletteRecentsSave: port("paletteRecentsSave"),
        singleKeysSave: port("singleKeysSave"),
        gapPrefsLoaded: { send(v) { sent.push(v); } },
      },
    },
    subs,
    sent,
  };
}

test("boot snapshot: stored recents (validated) and the single-key switch", () => {
  const storage = fakeStorage({
    "onyx:palette-recents": JSON.stringify({ "wss://n|kai": ["channel:#a", 7, "", "dm:bo"], bad: "nope" }),
    "onyx:single-key-shortcuts": "off",
  });
  const h = prefsApp();
  wireGapPrefs(h.app, { localStorage: storage });
  assert.deepEqual(h.sent, [{ recents: { "wss://n|kai": ["channel:#a", "dm:bo"] }, singleKeys: false }]);
});

test("corrupt storage boots empty with single keys on", () => {
  const h = prefsApp();
  wireGapPrefs(h.app, { localStorage: fakeStorage({ "onyx:palette-recents": "{not json" }) });
  assert.deepEqual(h.sent, [{ recents: {}, singleKeys: true }]);
});

test("saves keep 8 ids per owner, newest owner first, at most 8 owners", () => {
  const owners = {};
  for (let i = 0; i < 8; i++) owners["o" + i] = ["x"];
  const storage = fakeStorage({ "onyx:palette-recents": JSON.stringify(owners) });
  const h = prefsApp();
  wireGapPrefs(h.app, { localStorage: storage });
  h.subs.paletteRecentsSave({ owner: "me", ids: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] });
  const saved = JSON.parse(storage.getItem("onyx:palette-recents"));
  assert.equal(Object.keys(saved).length, 8);
  assert.equal(Object.keys(saved)[0], "me");
  assert.deepEqual(saved.me, ["a", "b", "c", "d", "e", "f", "g", "h"]);
  h.subs.singleKeysSave({ enabled: false });
  assert.equal(storage.getItem("onyx:single-key-shortcuts"), "off");
  h.subs.singleKeysSave({ enabled: true });
  assert.equal(storage.getItem("onyx:single-key-shortcuts"), null);
});

test("the wired listener runs local keys itself and only claims them when they acted", () => {
  const sent = [];
  const listeners = {};
  const doc = dom(transcript);
  globalThis.window = { addEventListener(name, fn) { listeners[name] = fn; } };
  globalThis.document = doc;
  try {
    wireShortcuts({ ports: { shortcut: { send(v) { sent.push(v); } } } });
    let prevented = false;
    const enter = { ...key({ key: "Enter", target: doc.body }), preventDefault() { prevented = true; } };
    listeners.keydown(enter);
    assert.equal(prevented, true);
    assert.equal(doc.activeElement.id, "shell-composer-input");
    const nKey = { ...key({ key: "n", target: doc.body }), preventDefault() {} };
    listeners.keydown(nKey);
    assert.deepEqual(sent, ["next-unread"]);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});
