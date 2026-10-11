/* v3/gap-organize — real-bundle smoke for the organize memory: boots the
   compiled app in jsdom against a stub WebSocket and drives it through the
   real DOM and the real ports.js storage bridge.

   Proves the wiring no unit test can: the owner-scoped read goes out when
   the device-memory owner appears and its answer fills the lists (hidden
   rooms, closed conversations), hiding a room from the row menu writes the
   owner-scoped key, a new line from a closed DM's person reopens it and
   rewrites the key, and nothing outside the allow-listed keys is touched.

   Run with:
     node --test elm/organizeBoot.smoke.mjs              (repo root)
   Env: ELM=<elm 0.19.1> (default: `elm` on PATH) or ONYX_ELM_DIST=<built dir>. */
/* global Response */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jsdom from "jsdom";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://onyx.test";
const PIN = "wss://irc.onyx.test/ws";

/* Serve the page's relative assets from one directory: either the source
   tree plus a freshly compiled app.js, or a built dist dir as-is. */
function assetRoot() {
  if (process.env.ONYX_ELM_DIST) {
    const dist = resolve(process.env.ONYX_ELM_DIST);
    return { dir: dist, appJs: null, cleanup() {} };
  }
  const out = mkdtempSync(join(tmpdir(), "onyx-elm-smoke-"));
  const appJs = join(out, "app.js");
  try {
    execFileSync(process.env.ELM || "elm", ["make", "--optimize", "src/Main.elm", "--output", appJs], {
      cwd: here,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`could not compile the bundle (put elm 0.19.1 on PATH, set ELM=..., or smoke a build with ONYX_ELM_DIST=...): ${err.message}`, { cause: err });
  }
  /* v3/calls-engine: index.html also loads the voice engine bundle
     (voice.js), built by media/build-voice.mjs with the repo's esbuild. */
  try {
    execFileSync(process.execPath, [join(here, "media/build-voice.mjs"), findEsbuild(), out], {
      cwd: here,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`could not bundle the voice engine (needs the repo's esbuild; set ESBUILD=...): ${err.message}`, { cause: err });
  }
  /* v3/gap-appearance: index.html also loads the background renderer
     (backdrop.js), built by media/build-backdrop.mjs. */
  try {
    execFileSync(process.execPath, [join(here, "media/build-backdrop.mjs"), findEsbuild(), out], {
      cwd: here,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`could not bundle the background renderer (needs the repo's esbuild; set ESBUILD=...): ${err.message}`, { cause: err });
  }
  return { dir: here, appJs, voiceJs: join(out, "voice.js"), backdropJs: join(out, "backdrop.js"), cleanup() { rmSync(out, { recursive: true, force: true }); } };
}

function findEsbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD;
  let common;
  try {
    common = execFileSync("git", ["-C", here, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  } catch (err) { common = ""; }
  for (const root of [join(here, ".."), common ? join(common, "..") : ""]) {
    const dir = root && join(root, "node_modules/.pnpm");
    if (!dir || !existsSync(dir)) continue;
    const hit = readdirSync(dir).find((n) => n.startsWith("esbuild@"));
    if (hit) return join(dir, hit, "node_modules/esbuild/bin/esbuild");
  }
  throw new Error("esbuild not found");
}

/* Every subresource request is answered locally; nothing reaches the
   network (non-origin URLs and missing files get a 404). */
function localResources(root, fetched) {
  return {
    interceptors: [
      requestInterceptor((request) => {
        const u = new URL(request.url);
        if (u.origin !== ORIGIN) return new Response("", { status: 404 });
        const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
        fetched.push(rel);
        const file = rel === "app.js" && root.appJs ? root.appJs
          : rel === "voice.js" && root.voiceJs ? root.voiceJs
          : rel === "backdrop.js" && root.backdropJs ? root.backdropJs
          : join(root.dir, rel);
        try {
          const type = rel.endsWith(".js") ? "application/javascript" : rel.endsWith(".css") ? "text/css" : "application/octet-stream";
          return new Response(readFileSync(file), { headers: { "Content-Type": type } });
        } catch (err) {
          return new Response("", { status: 404 });
        }
      }),
    ],
  };
}

/* Minimal browser WebSocket: records dials and sent frames; the test
   plays the server through `serverOpen` / `serverSay`. */
function installSocketStub(window, log) {
  class StubSocket extends window.EventTarget {
    constructor(url, protocols) {
      super();
      this.url = String(url);
      this.protocol = "";
      this.readyState = StubSocket.CONNECTING;
      this.binaryType = "blob";
      this.sent = [];
      log.sockets.push(this);
      void protocols;
    }
    send(data) {
      if (this.readyState !== StubSocket.OPEN) throw new Error("send before open");
      this.sent.push(String(data));
    }
    close(code, reason) {
      if (this.readyState === StubSocket.CLOSED) return;
      this.readyState = StubSocket.CLOSED;
      const ev = new window.Event("close");
      ev.wasClean = true; ev.code = code || 1000; ev.reason = reason || "";
      this.dispatchEvent(ev);
    }
    serverOpen() {
      this.readyState = StubSocket.OPEN;
      this.dispatchEvent(new window.Event("open"));
    }
    serverSay(...lines) {
      /* Like the live node: ONE line per text frame, NO trailing CRLF. */
      for (const l of lines) this.dispatchEvent(new window.MessageEvent("message", { data: l }));
    }
    lines() {
      return this.sent.join("").split("\r\n").filter((l) => l.length > 0);
    }
  }
  StubSocket.CONNECTING = 0; StubSocket.OPEN = 1; StubSocket.CLOSING = 2; StubSocket.CLOSED = 3;
  window.WebSocket = StubSocket;
}

async function boot(path, setup) {
  const root = assetRoot();
  const loader = { fetched: [] };
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(`jsdom: ${e.message}`));
  virtualConsole.on("error", (...a) => errors.push(`console.error: ${a.join(" ")}`));
  const log = { sockets: [] };
  const html = readFileSync(join(root.dir, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: ORIGIN + path,
    runScripts: "dangerously",
    resources: localResources(root, loader.fetched),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      installSocketStub(window, log);
      /* v3/gap-appearance: jsdom has no 2D canvas; model a browser without
         one so the background renderer fails closed (no scene). */
      window.HTMLCanvasElement.prototype.getContext = () => null;
      if (setup) setup(window);
      window.addEventListener("error", (e) => errors.push(`window.error: ${e.message}`));
      if (!window.matchMedia) {
        window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  await new Promise((res) => dom.window.addEventListener("load", res));
  await tick(dom);
  return { dom, doc: dom.window.document, window: dom.window, errors, log, loader, root };
}

/* Elm renders on requestAnimationFrame; give it a few frames. */
function tick(dom, n = 3) {
  return new Promise((res) => {
    let left = n;
    const step = () => (--left <= 0 ? res() : dom.window.requestAnimationFrame(step));
    dom.window.requestAnimationFrame(step);
  });
}

function q(doc, sel) {
  const el = doc.querySelector(sel);
  assert.ok(el, `expected ${sel} in the DOM`);
  return el;
}

function typeInto(window, el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/* Enter in a single-line input: dispatch the keydown the app listens
   to, then — like a browser's implicit submission, which jsdom does not
   perform for synthetic events — submit the owning form unless the app
   prevented the default. */
function pressEnter(window, el) {
  const ev = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  const proceed = el.dispatchEvent(ev);
  if (proceed && el.form) el.form.requestSubmit();
  return proceed;
}


const OWNER = encodeURIComponent(JSON.stringify([PIN, "kai"]));
const key = (base) => `onyx:${base}:owner:${OWNER}`;

async function liveBoot(seed) {
  const booted = await boot("/app?ws=" + encodeURIComponent(PIN), (w) => {
    for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
  });
  const { dom, doc, window, log } = booted;
  typeInto(window, q(doc, "#conn-nick"), "kai");
  await tick(dom);
  pressEnter(window, q(doc, "#conn-nick"));
  await tick(dom);
  const sock = log.sockets[0];
  sock.serverOpen();
  await tick(dom);
  sock.serverSay(":onyx.test CAP * LS :message-tags server-time echo-message batch");
  await tick(dom);
  const capReq = sock.lines().find((l) => l.startsWith("CAP REQ"));
  sock.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, ""));
  await tick(dom);
  sock.serverSay(":onyx.test 001 kai :Welcome to Onyx kai", ":onyx.test 376 kai :End of MOTD");
  await tick(dom);
  for (const room of ["#lounge", "#elm"]) {
    sock.serverSay(
      `:kai!u@onyx.test JOIN ${room}`,
      `:onyx.test 353 kai = ${room} :kai alice`,
      `:onyx.test 366 kai ${room} :End of /NAMES list.`,
    );
  }
  await tick(dom);
  return { ...booted, sock };
}

function visible(doc, sel) {
  return [...doc.querySelectorAll(sel)];
}

test("the stored organize memory loads for the owner and shapes the lists", async () => {
  const b = await liveBoot({
    [key("hidden-rooms")]: JSON.stringify(["#elm"]),
    [key("room-folders")]: JSON.stringify([{ id: "w", name: "Work", rooms: ["#lounge"], collapsed: false }]),
  });
  try {
    const channels = q(b.doc, '[data-testid="sidebar-channels"]');
    assert.doesNotMatch(channels.textContent, /#elm/, "a hidden room is off the list");
    assert.match(q(b.doc, '[data-testid="sidebar-hidden"]').textContent, /1 hidden room/);
    assert.match(q(b.doc, '[data-testid="sidebar-folder-toggle"]').textContent, /Work/, "the folder is drawn");
    assert.deepEqual(b.errors, []);
  } finally {
    b.dom.window.close();
    b.root.cleanup();
  }
});

test("memory stored for another account never shows", async () => {
  const other = encodeURIComponent(JSON.stringify([PIN, "someone-else"]));
  const b = await liveBoot({ [`onyx:hidden-rooms:owner:${other}`]: JSON.stringify(["#elm"]) });
  try {
    assert.equal(b.doc.querySelector('[data-testid="sidebar-hidden"]'), null);
    assert.match(q(b.doc, '[data-testid="sidebar-channels"]').textContent, /#elm/);
  } finally {
    b.dom.window.close();
    b.root.cleanup();
  }
});

test("hiding a room from its row menu writes the owner-scoped key", async () => {
  const b = await liveBoot({});
  try {
    const ls = b.window.localStorage;
    assert.equal(ls.getItem(key("hidden-rooms")), null);
    q(b.doc, 'button[aria-label="Room options for #elm"]').click();
    await tick(b.dom);
    q(b.doc, '[data-testid="organize-hide"]').click();
    await tick(b.dom);
    assert.equal(ls.getItem(key("hidden-rooms")), JSON.stringify(["#elm"]));
    assert.doesNotMatch(q(b.doc, '[data-testid="sidebar-channels"]').textContent, /#elm/);
    /* Show it again: the key goes away (an empty list is no key). */
    q(b.doc, '[data-testid="sidebar-hidden-toggle"]').click();
    await tick(b.dom);
    q(b.doc, '[data-testid="sidebar-unhide"]').click();
    await tick(b.dom);
    assert.equal(ls.getItem(key("hidden-rooms")), null);
    assert.deepEqual(b.errors, []);
  } finally {
    b.dom.window.close();
    b.root.cleanup();
  }
});

test("a closed DM reopens when that person writes, and the key is rewritten", async () => {
  const b = await liveBoot({ [key("closed-conversations")]: JSON.stringify(["alice"]) });
  try {
    const ls = b.window.localStorage;
    b.sock.serverSay(":alice!a@onyx.test PRIVMSG kai :psst");
    await tick(b.dom);
    assert.match(q(b.doc, '[data-testid="sidebar-dms"]').textContent, /alice/, "alice is back on the list");
    assert.equal(ls.getItem(key("closed-conversations")), null, "the stored close was removed");
    assert.deepEqual(b.errors, []);
  } finally {
    b.dom.window.close();
    b.root.cleanup();
  }
});

test("a closed DM stays closed while someone else writes", async () => {
  const b = await liveBoot({ [key("closed-conversations")]: JSON.stringify(["alice"]) });
  try {
    b.sock.serverSay(":bob!b@onyx.test PRIVMSG kai :hi");
    await tick(b.dom);
    const dms = q(b.doc, '[data-testid="sidebar-dms"]').textContent;
    assert.match(dms, /bob/);
    assert.doesNotMatch(dms, /alice/);
    assert.equal(b.window.localStorage.getItem(key("closed-conversations")), JSON.stringify(["alice"]));
  } finally {
    b.dom.window.close();
    b.root.cleanup();
  }
});

test("quiet hours and the notification mode persist device-wide", async () => {
  const b = await liveBoot({});
  try {
    const ls = b.window.localStorage;
    q(b.doc, '[data-testid="you-open"]').click();
    await tick(b.dom);
    const open = visible(b.doc, '[data-testid="shell-notifications"]')[0];
    assert.ok(open, "the You hub links to Notifications");
    open.click();
    await tick(b.dom);
    q(b.doc, '[data-testid="notify-quiet-toggle"]').click();
    await tick(b.dom);
    assert.equal(ls.getItem("onyx:dnd-quiet-enabled"), "true");
    assert.equal(ls.getItem("onyx:dnd-quiet-start"), "22");
    assert.equal(ls.getItem("onyx:dnd-quiet-end"), "8");
    q(b.doc, '[data-testid="notify-preset-calm"]').click();
    await tick(b.dom);
    assert.equal(ls.getItem("onyx:calm"), "calm");
    assert.deepEqual(b.errors, []);
  } finally {
    b.dom.window.close();
    b.root.cleanup();
  }
});
