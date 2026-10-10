/* v3/ios keyboard bridge smoke test — `installViewportInsets`: publishes
   --kb-inset / --vvh / data-kb from a visualViewport, ignores toolbar
   jitter under 80px, leaves the values alone while pinch-zoomed, and
   throttles bursts of events to one rAF. Fake window. Run with:
     node --test elm/viewportInsets.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { installViewportInsets } = globalThis.OnyxPorts;

function fakeWindow({ innerHeight = 844, height = 844, offsetTop = 0, scale = 1 } = {}) {
  const props = {};
  const attrs = {};
  const listeners = {};
  const frames = [];
  const vv = {
    height,
    offsetTop,
    scale,
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((g) => g !== f); },
  };
  const win = {
    innerHeight,
    visualViewport: vv,
    document: {
      documentElement: {
        clientHeight: innerHeight,
        style: { setProperty(k, v) { props[k] = v; } },
        setAttribute(k, v) { attrs[k] = v; },
      },
    },
    requestAnimationFrame(fn) { frames.push(fn); },
    addEventListener() {},
    removeEventListener() {},
  };
  const fire = (t) => (listeners[t] || []).forEach((f) => f());
  const flush = () => { while (frames.length) frames.shift()(); };
  return { win, vv, props, attrs, fire, flush, frames, listeners };
}

test("no visualViewport: nothing installs", () => {
  assert.equal(installViewportInsets({ document: { documentElement: { style: {} } } }), null);
});

test("closed keyboard publishes 0 and the visual height", () => {
  const f = fakeWindow();
  installViewportInsets(f.win);
  assert.equal(f.props["--kb-inset"], "0px");
  assert.equal(f.props["--vvh"], "844px");
  assert.equal(f.attrs["data-kb"], "closed");
  assert.equal(f.props["--vv-top"], "0px");
});

test("an open keyboard publishes its overlap, rAF-throttled", () => {
  const f = fakeWindow();
  installViewportInsets(f.win);
  f.vv.height = 508; // 336px keyboard
  f.fire("resize");
  f.fire("resize");
  f.fire("scroll");
  assert.equal(f.frames.length, 1, "one frame for a burst of events");
  f.flush();
  assert.equal(f.props["--kb-inset"], "336px");
  assert.equal(f.props["--vvh"], "508px");
  assert.equal(f.attrs["data-kb"], "open");
});

test("a panned visual viewport counts its offset", () => {
  const f = fakeWindow();
  installViewportInsets(f.win);
  f.vv.height = 508;
  f.vv.offsetTop = 100;
  f.fire("scroll");
  f.flush();
  assert.equal(f.props["--kb-inset"], "236px");
  assert.equal(f.props["--vv-top"], "100px");
});

test("toolbar jitter under 80px is not a keyboard", () => {
  const f = fakeWindow();
  installViewportInsets(f.win);
  f.vv.height = 790;
  f.fire("resize");
  f.flush();
  assert.equal(f.props["--kb-inset"], "0px");
  assert.equal(f.props["--vvh"], "790px");
});

test("pinch-zoom leaves the published values alone", () => {
  const f = fakeWindow();
  installViewportInsets(f.win);
  f.vv.scale = 2;
  f.vv.height = 422;
  f.fire("resize");
  f.flush();
  assert.equal(f.props["--vvh"], "844px");
  assert.equal(f.props["--kb-inset"], "0px");
});

test("stop() detaches the listeners", () => {
  const f = fakeWindow();
  const handle = installViewportInsets(f.win);
  handle.stop();
  assert.equal((f.listeners.resize || []).length, 0);
  assert.equal((f.listeners.scroll || []).length, 0);
});
