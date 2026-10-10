/* v3/transcript scroll-bridge smoke test — `scrollPolicy` / `scrollState`:
   stick-to-bottom on new rows, offset preservation on history prepends,
   away/pinned reports on change only, jump-to-latest, unread-divider
   landing on open, and conversation-switch re-attach. Fake DOM (rows
   with heights inside a scrolling pane). Run with:
     node --test elm/transcriptScroll.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { createTranscriptScroller, wireTranscriptScroll } = globalThis.OnyxPorts;

function row(h) {
  return { h };
}

function makeDom({ heights, clientHeight = 200, key = "#a", dividerAt = null }) {
  const listeners = {};
  let top = 0;
  const rows = heights.map(row);
  const pane = {
    clientHeight,
    addEventListener(t, f) { listeners[t] = f; },
    removeEventListener(t) { delete listeners[t]; },
    getBoundingClientRect() { return { top: 0, bottom: clientHeight }; },
    get scrollHeight() { return rows.reduce((a, r) => a + r.h, 0); },
    get scrollTop() { return top; },
    set scrollTop(v) { top = Math.max(0, Math.min(v, Math.max(0, this.scrollHeight - clientHeight))); },
  };
  const offsetOf = (el) => {
    let y = 0;
    for (const r of rows) {
      if (r === el) return y;
      y += r.h;
    }
    return -1;
  };
  const bind = (r) => {
    r.getBoundingClientRect = () => {
      const t = offsetOf(r) - top;
      return { top: t, bottom: t + r.h };
    };
    return r;
  };
  rows.forEach(bind);
  const ul = { get children() { return rows; } };
  const log = {
    key,
    getAttribute(n) { return n === "data-transcript-key" ? this.key : null; },
    querySelector(sel) {
      if (sel === "ul") return ul;
      if (sel === ".onyx-unread-divider") return dividerAt == null ? null : rows[dividerAt];
      return null;
    },
    contains(el) { return rows.includes(el); },
    closest() { return pane; },
  };
  const doc = { current: log, querySelector() { return this.current; } };
  return {
    pane, rows, log, doc, listeners,
    append(h) { rows.push(bind(row(h))); },
    prepend(...hs) { rows.unshift(...hs.map((h) => bind(row(h)))); },
    scrollTo(v) { pane.scrollTop = v; listeners.scroll && listeners.scroll(); },
  };
}

function scroller(dom) {
  const sent = [];
  const frames = [];
  const s = createTranscriptScroller({
    doc: dom.doc,
    send: (v) => sent.push(v),
    raf: (fn) => frames.push(fn),
  });
  return { s, sent, flush: () => { while (frames.length) frames.shift()(); } };
}

test("attach pins to the bottom and reports pinned once", () => {
  const dom = makeDom({ heights: Array(20).fill(30) });
  const { s, sent } = scroller(dom);
  s.sync();
  assert.equal(dom.pane.scrollTop, 600 - 200);
  assert.deepEqual(sent, [{ key: "#a", atBottom: true }]);
  s.sync();
  assert.equal(sent.length, 1, "no duplicate report without a change");
});

test("new rows keep a pinned reader at the bottom", () => {
  const dom = makeDom({ heights: Array(20).fill(30) });
  const { s, sent } = scroller(dom);
  s.sync();
  dom.append(30);
  dom.append(50);
  s.sync();
  assert.equal(dom.pane.scrollTop, 680 - 200);
  assert.deepEqual(sent, [{ key: "#a", atBottom: true }]);
});

test("scrolling up reports away; new rows then leave the offset alone", () => {
  const dom = makeDom({ heights: Array(20).fill(30) });
  const { s, sent } = scroller(dom);
  s.sync();
  dom.scrollTo(100);
  assert.deepEqual(sent.at(-1), { key: "#a", atBottom: false });
  dom.append(30);
  s.sync();
  assert.equal(dom.pane.scrollTop, 100);
  assert.equal(sent.length, 2);
});

test("prepending older history preserves the visible row's offset", () => {
  const dom = makeDom({ heights: Array(20).fill(30) });
  const { s } = scroller(dom);
  s.sync();
  dom.scrollTo(95); // row 3 (90..120) is the first visible row
  const anchor = dom.rows[3];
  const before = anchor.getBoundingClientRect().top;
  dom.prepend(40, 40, 25);
  s.sync();
  assert.equal(dom.pane.scrollTop, 95 + 105);
  assert.equal(anchor.getBoundingClientRect().top, before);
});

test("jump to latest pins after the next frame and reports pinned", () => {
  const dom = makeDom({ heights: Array(20).fill(30) });
  const { s, sent, flush } = scroller(dom);
  s.sync();
  dom.scrollTo(0);
  dom.append(30);
  s.policy({ action: "bottom", key: "#a" });
  // A render landing before the frame already follows the bottom.
  s.sync();
  assert.equal(dom.pane.scrollTop, 630 - 200);
  flush();
  assert.equal(dom.pane.scrollTop, 630 - 200);
  assert.deepEqual(sent.at(-1), { key: "#a", atBottom: true });
  s.policy({ action: "nope" });
  s.policy(null);
});

test("opening a conversation lands on the unread divider", () => {
  const dom = makeDom({ heights: Array(30).fill(30), dividerAt: 10 });
  const { s, sent } = scroller(dom);
  s.sync();
  assert.equal(dom.pane.scrollTop, 300 - 48);
  assert.deepEqual(sent, [{ key: "#a", atBottom: false }]);
});

test("a conversation switch re-attaches and re-reports under the new key", () => {
  const dom = makeDom({ heights: Array(20).fill(30) });
  const { s, sent } = scroller(dom);
  s.sync();
  dom.scrollTo(0);
  dom.log.key = "#b";
  s.sync();
  assert.equal(dom.pane.scrollTop, 400);
  assert.deepEqual(sent.at(-1), { key: "#b", atBottom: true });
  assert.equal(s.state().key, "#b");
  dom.doc.current = null;
  s.sync();
  assert.equal(s.state().attached, false);
});

test("wire: no ports no-ops; ports subscribe and observe the body", () => {
  assert.equal(wireTranscriptScroll({ ports: {} }, {}), null);
  let policyFn = null;
  const sent = [];
  let observed = null;
  let callback = null;
  class MO {
    constructor(cb) { callback = cb; }
    observe(target, opts) { observed = { target, opts }; }
  }
  const dom = makeDom({ heights: Array(20).fill(30) });
  dom.doc.body = { tag: "body" };
  const app = {
    ports: {
      scrollPolicy: { subscribe(fn) { policyFn = fn; } },
      scrollState: { send: (v) => sent.push(v) },
    },
  };
  const frames = [];
  const sc = wireTranscriptScroll(app, { doc: dom.doc, MutationObserver: MO, raf: (fn) => frames.push(fn) });
  assert.ok(sc);
  assert.equal(typeof policyFn, "function");
  assert.equal(observed.target, dom.doc.body);
  assert.equal(observed.opts.subtree, true);
  callback([]);
  assert.deepEqual(sent, [{ key: "#a", atBottom: true }]);
  policyFn({ action: "bottom", key: "#a" });
  frames.forEach((f) => f());
});
