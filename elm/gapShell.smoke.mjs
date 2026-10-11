/* v3/gap-shell smoke — the browser connectivity bridge (`wireGapShell`:
   boot state and offline/online each becoming one `shellEvent`), the
   single allowlisted `onyx:*` device value, the Start-a-room "next hang"
   label, and the roving arrow keys of the rail and the room More menu
   (mirroring the store's OS network listeners and the `ChannelSidebar` /
   `PresenceRibbon` menus). Page restore belongs to v3/gap-pwa-safety.
   Run with: node --test elm/gapShell.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { gapShell } = globalThis.OnyxPorts;

function fakeStorage(seed = {}) {
  const slots = new Map(Object.entries(seed));
  return {
    getItem(key) { return slots.has(key) ? slots.get(key) : null; },
    setItem(key, value) { slots.set(key, String(value)); },
    removeItem(key) { slots.delete(key); },
  };
}

function capturePort() {
  let handler = null;
  return { port: { subscribe(fn) { handler = fn; } }, fire(p) { return handler(p); }, get armed() { return handler !== null; } };
}

function listeners() {
  const map = {};
  return {
    addEventListener(name, fn) { (map[name] ||= []).push(fn); },
    dispatch(name, ev = {}) { (map[name] || []).forEach((fn) => fn(ev)); },
  };
}

function bridge({ online = true, local = fakeStorage(), now } = {}) {
  const events = [];
  const store = capturePort();
  const app = { ports: { shellEvent: { send(e) { events.push(e); } }, shellStore: store.port } };
  const win = { ...listeners(), localStorage: local };
  const doc = { ...listeners() };
  gapShell.wire(app, { window: win, document: doc, navigator: { onLine: online }, now });
  return { events, win, doc, store, local };
}

test("boot reports connectivity, the stored MOTD dismissal and the hang label", () => {
  const local = fakeStorage({ "onyx:motd-dismissed-at": "1700000000000" });
  const { events } = bridge({ online: false, local, now: new Date(2026, 9, 7, 10, 0).getTime() });
  assert.equal(events.length, 1);
  const boot = events[0];
  assert.equal(boot.event, "boot");
  assert.equal(boot.online, false);
  assert.equal(boot.motdDismissedAt, 1700000000000);
  assert.equal(typeof boot.hangLabel, "string");
  assert.ok(boot.hangLabel.length > 0, "a real label, never empty");
});

test("boot tolerates junk and missing storage", () => {
  const junk = bridge({ local: fakeStorage({ "onyx:motd-dismissed-at": "soon" }) });
  assert.equal(junk.events[0].motdDismissedAt, null);
  const none = bridge({ local: { getItem() { throw new Error("blocked"); } } });
  assert.equal(none.events[0].motdDismissedAt, null);
  assert.equal(none.events[0].online, true);
});

test("the next hang is the coming Saturday at 16:00, never earlier than now", () => {
  const at = (y, m, d, h, min) => gapShell.nextSaturdayHang(new Date(y, m, d, h, min));
  const wed = at(2026, 9, 7, 10, 0); // Wed 7 Oct 2026
  assert.equal(wed.getDay(), 6);
  assert.equal(wed.getHours(), 16);
  assert.equal(wed.getDate(), 10);
  const satMorning = at(2026, 9, 10, 9, 0);
  assert.equal(satMorning.getDate(), 10, "Saturday before 16:00 is today");
  const satEvening = at(2026, 9, 10, 17, 0);
  assert.equal(satEvening.getDate(), 17, "after 16:00 rolls a week");
  const exactly = at(2026, 9, 10, 16, 0);
  assert.equal(exactly.getDate(), 17, "16:00 sharp has already begun");
  assert.equal(gapShell.nextSaturdayHang(new Date(2026, 9, 11, 12, 0)).getDate(), 17, "Sunday looks to next Saturday");
});

test("offline and online become one event each", () => {
  const { events, win } = bridge();
  win.dispatch("offline");
  win.dispatch("online");
  assert.deepEqual(events.slice(1), [{ event: "offline", online: false }, { event: "online", online: true }]);
});

test("page restore is gap-pwa-safety's job: no second restore signal from here", () => {
  const { events, win, doc } = bridge();
  win.dispatch("pagehide", { persisted: true });
  win.dispatch("pageshow", { persisted: true });
  doc.dispatch("freeze");
  doc.dispatch("resume");
  assert.equal(events.length, 1, "only the boot event: restoring is not announced twice");
});

test("the device store writes only the allowlisted key and caps the value", () => {
  const { store, local } = bridge();
  assert.equal(store.armed, true);
  store.fire({ key: "motd-dismissed-at", value: "1799999999999" });
  assert.equal(local.getItem("onyx:motd-dismissed-at"), "1799999999999");
  store.fire({ key: "onyx:credentials", value: "x" });
  store.fire({ key: "../escape", value: "x" });
  store.fire({ key: "motd-dismissed-at", value: "9".repeat(100) });
  assert.equal(local.getItem("onyx:credentials"), null);
  assert.equal(local.getItem("onyx:motd-dismissed-at").length, 32);
  assert.doesNotThrow(() => store.fire(null));
});

test("wiring tolerates an app without the ports", () => {
  assert.equal(gapShell.wire(null), null);
  assert.equal(gapShell.wire({}), null);
  assert.doesNotThrow(() => gapShell.wire({ ports: {} }, { window: listeners(), document: listeners(), navigator: {} }));
});

// ── roving arrow keys ──────────────────────────────────────────────────────

function el(tag, { id = "", classes = [], parent = null, attrs = {}, disabled = false, hidden = false } = {}) {
  const node = {
    tag, id, classes: new Set(classes), parent, children: [], attrs, disabled, hidden,
    ownerDocument: null,
    getClientRects() { return hidden ? [] : [{}]; },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    focus() { node.ownerDocument.focused = node; },
    matches(sel) { return sel.startsWith(".") ? node.classes.has(sel.slice(1)) : sel.startsWith("#") ? node.id === sel.slice(1) : false; },
    closest(sel) {
      for (let n = node; n; n = n.parent) if (n.matches(sel)) return n;
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          const inMenu = c.parent && c.parent.id === "onyx-room-more-menu";
          if (sel.includes("#onyx-room-more-menu >") && inMenu && ((c.tag === "button" && !c.disabled) || (c.tag === "a" && "href" in c.attrs))) out.push(c);
          if (sel === ".onyx-rail-item" && c.classes.has("onyx-rail-item")) out.push(c);
          walk(c);
        }
      };
      walk(node);
      return out;
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
  };
  if (parent) parent.children.push(node);
  return node;
}

function page() {
  const doc = el("document");
  doc.ownerDocument = doc;
  doc.focused = null;
  const wire = (n) => { n.ownerDocument = doc; return n; };
  return { doc, wire };
}

const key = (target, k, extra = {}) => {
  const e = { key: k, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  const hit = gapShell.rovingKey(e);
  return { hit, e };
};

test("rail rows rove with the arrows, wrap, and Home/End jump", () => {
  const { doc, wire } = page();
  const rail = wire(el("nav", { classes: ["onyx-rail"], parent: doc }));
  const rows = ["a", "b", "c"].map((id) => wire(el("button", { id, classes: ["onyx-rail-item"], parent: rail })));
  assert.equal(key(rows[0], "ArrowDown").hit, rows[1]);
  assert.equal(doc.focused, rows[1]);
  assert.equal(key(rows[2], "ArrowDown").hit, rows[0], "wraps forward");
  assert.equal(key(rows[0], "ArrowUp").hit, rows[2], "wraps back");
  assert.equal(key(rows[1], "End").hit, rows[2]);
  assert.equal(key(rows[1], "Home").hit, rows[0]);
});

test("hidden rows are skipped; other keys and modified arrows are left alone", () => {
  const { doc, wire } = page();
  const rail = wire(el("nav", { classes: ["onyx-rail"], parent: doc }));
  const a = wire(el("button", { classes: ["onyx-rail-item"], parent: rail }));
  wire(el("button", { classes: ["onyx-rail-item"], parent: rail, hidden: true }));
  const c = wire(el("button", { classes: ["onyx-rail-item"], parent: rail }));
  assert.equal(key(a, "ArrowDown").hit, c);
  const { hit, e } = key(a, "ArrowDown", { shiftKey: true });
  assert.equal(hit, null);
  assert.equal(e.defaultPrevented, false);
  assert.equal(key(a, "Enter").hit, null);
  assert.equal(key(a, "ArrowDown", { isComposing: true }).hit, null);
  assert.equal(key(a, "ArrowDown", { defaultPrevented: true }).hit, null);
});

test("the room More menu roves and skips disabled items; the toggle opens into it", () => {
  const { doc, wire } = page();
  const toggle = wire(el("button", { classes: ["onyx-room-more-toggle"], parent: doc, attrs: { "aria-expanded": "true" } }));
  const menu = wire(el("div", { id: "onyx-room-more-menu", parent: doc }));
  const first = wire(el("button", { parent: menu }));
  wire(el("button", { parent: menu, disabled: true }));
  const link = wire(el("a", { parent: menu, attrs: { href: "/stats/room" } }));
  const last = wire(el("button", { parent: menu }));
  assert.equal(key(toggle, "ArrowDown").hit, first, "ArrowDown from an open toggle enters the menu");
  assert.equal(key(first, "ArrowDown").hit, link, "the disabled item is skipped");
  assert.equal(key(link, "ArrowDown").hit, last);
  assert.equal(key(last, "ArrowDown").hit, first);
  assert.equal(key(first, "End").hit, last);
  toggle.attrs["aria-expanded"] = "false";
  assert.equal(key(toggle, "ArrowDown").hit, null, "a closed toggle keeps its arrows");
});
