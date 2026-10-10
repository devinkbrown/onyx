/* v3/ship — real-bundle DOM smoke (roadmap 0.6 / 7.4, partial).
   Boots elm/index.html with a freshly compiled `app.js` and the real
   `ports.js` inside jsdom at /app, with a stub WebSocket standing in for
   the Onyx Server. Drives the ship-bar path through real DOM events:
   connect gate renders → fill the form → a WebSocket is dialed at the
   pinned endpoint → registration lines go out → server welcome lands →
   the shell replaces the gate → join a room → send a line.

   This proves the compiled bundle + ports + index.html boot script wire
   together without runtime errors. It does NOT check layout (jsdom has
   no layout engine): 375/768/1280 geometry and screenshots stay pending
   a real browser (see V3_ROADMAP.md 0.6).

   Run with:
     node --test elm/bundleBoot.smoke.mjs              (repo root)
   Env:
     ELM=<path to elm 0.19.1>   compiler (default: `elm` on PATH)
     ONYX_ELM_DIST=<dir>        smoke a built dir (e.g. elm/dist-elm from
                                tools/build.sh) instead of compiling
   Needs the repo jsdom devDependency. */
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
  return { dir: here, appJs, voiceJs: join(out, "voice.js"), cleanup() { rmSync(out, { recursive: true, force: true }); } };
}

function findEsbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD;
  let common = "";
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

async function boot(path) {
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

test("compiled bundle boots at /app, connects through the gate, joins and sends", async () => {
  const { dom, doc, window, errors, log, loader, root } = await boot("/app?ws=" + encodeURIComponent(PIN));
  try {
    assert.ok(loader.fetched.some((f) => /^app(\.[0-9a-f]+)?\.js$/.test(f)), "index.html loads the app bundle");
    assert.ok(loader.fetched.some((f) => /^ports(\.[0-9a-f]+)?\.js$/.test(f)), "index.html loads ports.js");
    /* v3/calls-engine: the voice engine mounts before ports.js wires it. */
    assert.ok(loader.fetched.some((f) => /^voice(\.[0-9a-f]+)?\.js$/.test(f)), "index.html loads the voice engine");
    assert.equal(typeof window.OnyxVoiceEngine?.joinVoice, "function", "window.OnyxVoiceEngine is mounted");
    assert.deepEqual(errors, [], "boot runs without runtime errors");

    /* 1. Connect gate renders, no socket yet. */
    q(doc, '[data-testid="connect"]');
    assert.equal(log.sockets.length, 0, "no dial before the user submits");
    const nick = q(doc, "#conn-nick");
    const submit = q(doc, '[data-testid="conn-submit"]');
    assert.equal(submit.getAttribute("type"), "submit");

    /* 2. Fill the form and press Enter (keyboard submit). */
    typeInto(window, nick, "kai");
    await tick(dom);
    pressEnter(window, nick);
    await tick(dom);
    assert.equal(log.sockets.length, 1, "submitting the gate dials one WebSocket");
    const sock = log.sockets[0];
    assert.equal(sock.url, PIN, "the pinned endpoint is dialed");

    sock.serverOpen();
    await tick(dom);
    /* 3. Registration goes out in App.update order (CAP LS first, so
          SASL can run before NICK/USER complete registration). */
    assert.deepEqual(sock.lines().slice(0, 3), ["CAP LS 302", "NICK kai", "USER webchat 0 * :kai (webchat)"]);
    /* One CRLF-terminated command per frame (no empty lines between). */
    for (const frame of sock.sent) assert.match(frame, /^[^\r\n]+\r\n$/, "frame " + JSON.stringify(frame));

    /* 4. Welcome lands: the gate yields to the shell on Home. */
    /* The live node's CAP LS 302 reply spans lines (`*` continuations);
       the client must answer it, or registration stalls forever. */
    sock.serverSay(
      ":onyx.test CAP * LS * :message-tags server-time",
      ":onyx.test CAP * LS :echo-message batch",
    );
    await tick(dom);
    const capReq = sock.lines().find((l) => l.startsWith("CAP REQ"));
    assert.ok(capReq, "client answers CAP LS with CAP REQ; sent: " + JSON.stringify(sock.lines()));
    sock.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, ""));
    await tick(dom);
    assert.ok(sock.lines().includes("CAP END"), "CAP END after ACK; sent: " + JSON.stringify(sock.lines()));
    sock.serverSay(
      ":onyx.test 001 kai :Welcome to Onyx kai",
      ":onyx.test 376 kai :End of MOTD",
    );
    await tick(dom);
    assert.equal(doc.querySelector('[data-testid="connect"]'), null, "the gate is gone once live");
    q(doc, '[data-testid="home"]');
    assert.equal(q(doc, '[data-testid="nav-home"]').getAttribute("aria-current"), "page");

    /* 5. Browse rooms → LIST → Join #lounge. */
    q(doc, '[data-testid="sidebar-browse-rooms"]').click();
    await tick(dom);
    assert.ok(sock.lines().some((l) => /^LIST\b/.test(l)), "browsing rooms requests LIST");
    sock.serverSay(
      ":onyx.test 321 kai Channel :Users Name",
      ":onyx.test 322 kai #lounge 4 :hang out",
      ":onyx.test 323 kai :End of /LIST",
    );
    await tick(dom);
    q(doc, 'button[aria-label="Join #lounge"]').click();
    await tick(dom);
    assert.ok(sock.lines().includes("JOIN #lounge"), "Join sends JOIN #lounge");
    sock.serverSay(
      ":kai!u@onyx.test JOIN #lounge",
      ":onyx.test 353 kai = #lounge :kai alice",
      ":onyx.test 366 kai #lounge :End of /NAMES list.",
    );
    await tick(dom);

    /* Joined: the directory row turns into "Open" (oracle browser
       behavior — a confirmed join settles the attempt, opening is the
       user's next step). */
    q(doc, 'button[aria-label="Open #lounge"]').click();
    await tick(dom);
    assert.equal(q(doc, ".onyx-composer-target").textContent, "#lounge", "the room is open");

    /* 6. Keyboard send: type, Enter in the composer. */
    const composer = q(doc, "#shell-composer-input");
    typeInto(window, composer, "hello from the bundle");
    await tick(dom);
    pressEnter(window, composer);
    await tick(dom);
    assert.ok(
      sock.lines().some((l) => /^(@\S+ )?PRIVMSG #lounge :hello from the bundle$/.test(l)),
      "Enter sends PRIVMSG #lounge: " + JSON.stringify(sock.lines().slice(-4)),
    );
    assert.equal(composer.value, "", "the composer clears after send");

    /* 7. An inbound DM surfaces in the Messages section. */
    sock.serverSay(":alice!a@onyx.test PRIVMSG kai :psst");
    await tick(dom);
    assert.match(q(doc, '[data-testid="sidebar-dms"]').textContent, /alice/);

    for (const frame of sock.sent) assert.match(frame, /^[^\r\n]+\r\n$/, "frame " + JSON.stringify(frame));
    assert.deepEqual(errors, [], "no runtime errors across the flow");
  } finally {
    dom.window.close();
    root.cleanup();
  }
});
