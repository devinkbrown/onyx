/* v3/gap-auth — real-bundle DOM smoke for the new sign-in paths.
   Boots elm/index.html with a freshly compiled `app.js` and the real
   `ports.js` inside jsdom at /app, with a stub WebSocket standing in for
   the Onyx Server, and plays the server's side of:

     - the pre-001 CHALLENGE proof of work (the client must answer with a
       nonce the server's BLAKE3 rule accepts) and the CHALLENGE question;
     - a two-factor account: SASL PLAIN refused with the 904, the code
       step, then a fresh plain guest connection and
       `IDENTIFY <account> <password> <code>` composed ports-side (the
       password never appears in the page);
     - forgot password: RESETPASS request, then confirm with code + new
       password, then the done step.

   Run with:
     node --test elm/authGate.smoke.mjs                (repo root)
   Env: ELM=<elm 0.19.1>, ONYX_ELM_DIST=<built dir>, ESBUILD=<esbuild>
   (same as bundleBoot.smoke.mjs). Needs the repo jsdom devDependency. */
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


const SEED = "0102030405060708090a0b0c0d0e0f10";
const RESET_CODE = "0123456789abcdef0123456789abcdef";

const waitUntil = async (dom, pred, label, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
    await tick(dom, 1);
  }
  assert.fail("timed out waiting for " + label);
};

/* Play CAP LS → ACK → END and welcome for `nick` on `sock`. */
async function register(dom, sock, nick, caps = "message-tags server-time") {
  sock.serverOpen();
  await tick(dom);
  sock.serverSay(`:onyx.test CAP * LS :${caps}`);
  await tick(dom);
  const capReq = sock.lines().find((l) => l.startsWith("CAP REQ"));
  assert.ok(capReq, "CAP REQ; sent: " + JSON.stringify(sock.lines()));
  sock.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, ""));
  await tick(dom);
}

const welcome = (nick) => [`:onyx.test 001 ${nick} :Welcome to Onyx ${nick}`, `:onyx.test 376 ${nick} :End of MOTD`];

async function submitGuest(dom, window, doc, nick) {
  typeInto(window, q(doc, "#conn-nick"), nick);
  await tick(dom);
  pressEnter(window, q(doc, "#conn-nick"));
  await tick(dom);
}

test("CHALLENGE pow before 001 is solved by the bundle and answered with a valid nonce", async () => {
  const { dom, doc, window, errors, log, root } = await boot("/app?ws=" + encodeURIComponent(PIN));
  try {
    await submitGuest(dom, window, doc, "kai");
    const sock = log.sockets[0];
    sock.serverOpen();
    await tick(dom);
    sock.serverSay(`:onyx.test NOTICE * :CHALLENGE pow ${SEED}`);
    await waitUntil(dom, () => sock.lines().some((l) => l.startsWith("CHALLENGE ")), "the CHALLENGE answer");
    const answerLine = sock.lines().find((l) => l.startsWith("CHALLENGE "));
    const answer = answerLine.slice("CHALLENGE ".length);
    assert.equal(answer, "23", "the first nonce the server's rule accepts for this seed");
    assert.equal(window.OnyxPorts.challenge.powOk(SEED, answer), true);
    /* The connect form explains the pause. */
    q(doc, '[data-testid="conn-challenge-note"]');
    /* The server then admits the connection. */
    sock.serverSay(`:onyx.test CAP * LS :message-tags`);
    await tick(dom);
    const capReq = sock.lines().find((l) => l.startsWith("CAP REQ"));
    if (capReq) { sock.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, "")); await tick(dom); }
    sock.serverSay(...welcome("kai"));
    await tick(dom);
    assert.equal(doc.querySelector('[data-testid="connect"]'), null, "the gate yields once registered");
    assert.equal(doc.querySelector('[data-testid="conn-challenge-note"]'), null, "the note is gone");
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
    root.cleanup();
  }
});

test("CHALLENGE question shows a prompt on the gate and sends the typed answer", async () => {
  const { dom, doc, window, errors, log, root } = await boot("/app?ws=" + encodeURIComponent(PIN));
  try {
    await submitGuest(dom, window, doc, "kai");
    const sock = log.sockets[0];
    sock.serverOpen();
    await tick(dom);
    sock.serverSay(":onyx.test NOTICE * :CHALLENGE question What is the capital of France?");
    await tick(dom);
    assert.match(q(doc, '[data-testid="auth-challenge-question"]').textContent, /capital of France/);
    assert.equal(doc.querySelector('[data-testid="connect"]'), null, "the question replaces the connect form");
    const answer = q(doc, "#auth-answer");
    typeInto(window, answer, "Paris");
    await tick(dom);
    pressEnter(window, answer);
    await tick(dom);
    assert.ok(sock.lines().includes("CHALLENGE Paris"), "answer sent; sent: " + JSON.stringify(sock.lines()));
    /* A wrong answer keeps the prompt with an honest line. */
    sock.serverSay(":onyx.test NOTICE * :CHALLENGE failed");
    await tick(dom);
    assert.match(q(doc, "#auth-answer-error").textContent, /wasn't accepted/);
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
    root.cleanup();
  }
});

test("a two-factor account: 904 asks for the code, then IDENTIFY goes out on a plain guest connection", async () => {
  const PASSWORD = "hunter22";
  const { dom, doc, window, errors, log, root } = await boot("/app?ws=" + encodeURIComponent(PIN));
  try {
    q(doc, '[data-testid="conn-mode-signin"]').click();
    await tick(dom);
    typeInto(window, q(doc, "#conn-nick"), "kai");
    typeInto(window, q(doc, "#conn-password"), PASSWORD);
    await tick(dom);
    pressEnter(window, q(doc, "#conn-password"));
    await tick(dom);
    const first = log.sockets[0];
    first.serverOpen();
    await tick(dom);
    first.serverSay(":onyx.test CAP * LS :sasl=PLAIN message-tags onyx/2fa=IDENTIFY");
    await tick(dom);
    const capReq = first.lines().find((l) => l.startsWith("CAP REQ"));
    first.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, ""));
    await tick(dom);
    assert.ok(first.lines().includes("AUTHENTICATE PLAIN"), "PLAIN offered; sent: " + JSON.stringify(first.lines()));
    first.serverSay("AUTHENTICATE +");
    await tick(dom);
    const blob = first.lines().filter((l) => l.startsWith("AUTHENTICATE ")).pop().slice("AUTHENTICATE ".length);
    assert.equal(Buffer.from(blob, "base64").toString("utf8"), `\0kai\0${PASSWORD}`, "the held password rode SASL PLAIN");
    first.serverSay(":onyx.test 904 kai :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>");
    await tick(dom);
    first.close();
    await tick(dom);

    /* The code step replaces the connect form; nothing reconnected as a guest. */
    q(doc, "#auth-code");
    assert.match(q(doc, "#auth-title").textContent, /Two-step sign-in/);
    assert.equal(log.sockets.length, 1, "no guest reconnect behind the gate");

    const code = q(doc, "#auth-code");
    typeInto(window, code, "123 456");
    await tick(dom);
    pressEnter(window, code);
    await tick(dom);
    assert.equal(log.sockets.length, 2, "submitting the code dials a plain connection");
    const second = log.sockets[1];
    second.serverOpen();
    await tick(dom);
    const nickLine = second.lines().find((l) => l.startsWith("NICK "));
    assert.match(nickLine, /^NICK Guest\d{5}$/, "a guest nick, never the account name: " + nickLine);
    second.serverSay(":onyx.test CAP * LS :message-tags");
    await tick(dom);
    const cap2 = second.lines().find((l) => l.startsWith("CAP REQ"));
    if (cap2) { second.serverSay(":onyx.test CAP * ACK :" + cap2.replace(/^CAP REQ :?/, "")); await tick(dom); }
    assert.equal(second.lines().some((l) => l.startsWith("AUTHENTICATE")), false, "no SASL on the guest connection");
    const guest = nickLine.slice("NICK ".length);
    second.serverSay(...welcome(guest));
    await tick(dom);
    assert.ok(second.lines().includes(`IDENTIFY kai ${PASSWORD} 123456`), "IDENTIFY composed ports-side; sent: " + JSON.stringify(second.lines()));
    assert.equal(doc.body.textContent.includes(PASSWORD), false, "the password never appears in the page");

    second.serverSay(`:onyx.test NOTICE ${guest} :You are now identified as kai`);
    await tick(dom);
    assert.equal(doc.querySelector('[data-testid="auth-gate"]'), null, "the gate yields once identified");
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
    root.cleanup();
  }
});

test("a wrong two-factor code returns to the code step with the server's reason", async () => {
  const PASSWORD = "hunter22";
  const { dom, doc, window, errors, log, root } = await boot("/app?ws=" + encodeURIComponent(PIN));
  try {
    q(doc, '[data-testid="conn-mode-signin"]').click();
    await tick(dom);
    typeInto(window, q(doc, "#conn-nick"), "kai");
    typeInto(window, q(doc, "#conn-password"), PASSWORD);
    await tick(dom);
    pressEnter(window, q(doc, "#conn-password"));
    await tick(dom);
    const first = log.sockets[0];
    first.serverOpen();
    await tick(dom);
    first.serverSay(":onyx.test CAP * LS :sasl=PLAIN message-tags");
    await tick(dom);
    const capReq = first.lines().find((l) => l.startsWith("CAP REQ"));
    first.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, ""));
    await tick(dom);
    first.serverSay("AUTHENTICATE +");
    await tick(dom);
    first.serverSay(":onyx.test 904 kai :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>");
    await tick(dom);
    first.close();
    await tick(dom);
    typeInto(window, q(doc, "#auth-code"), "000000");
    await tick(dom);
    pressEnter(window, q(doc, "#auth-code"));
    await tick(dom);
    const second = log.sockets[1];
    second.serverOpen();
    await tick(dom);
    const guest = second.lines().find((l) => l.startsWith("NICK ")).slice(5);
    second.serverSay(`:onyx.test CAP * LS :message-tags`);
    await tick(dom);
    const cap2 = second.lines().find((l) => l.startsWith("CAP REQ"));
    if (cap2) { second.serverSay(":onyx.test CAP * ACK :" + cap2.replace(/^CAP REQ :?/, "")); await tick(dom); }
    second.serverSay(...welcome(guest));
    await tick(dom);
    assert.ok(second.lines().includes(`IDENTIFY kai ${PASSWORD} 000000`));
    second.serverSay(":onyx.test FAIL IDENTIFY TOTP_REQUIRED :Two-factor code required: IDENTIFY <account> <password> <6-digit-code>");
    await tick(dom);
    assert.match(q(doc, "#auth-code-error").textContent, /didn't work/);
    assert.equal(q(doc, "#auth-code").value, "", "the wrong code is cleared");
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
    root.cleanup();
  }
});

test("forgot password: request a code, confirm with the code and a new password, land on done", async () => {
  const { dom, doc, window, errors, log, root } = await boot("/app?ws=" + encodeURIComponent(PIN));
  try {
    q(doc, '[data-testid="conn-mode-signin"]').click();
    await tick(dom);
    typeInto(window, q(doc, "#conn-nick"), "kai");
    await tick(dom);
    q(doc, '[data-testid="conn-forgot"]').click();
    await tick(dom);
    assert.match(q(doc, "#auth-title").textContent, /Reset your password/);
    assert.equal(q(doc, "#auth-reset-account").value, "kai");
    q(doc, '[data-testid="auth-reset-request"]').click();
    await tick(dom);
    assert.equal(log.sockets.length, 1, "requesting a code dials a plain connection");
    const sock = log.sockets[0];
    sock.serverOpen();
    await tick(dom);
    const nickLine = sock.lines().find((l) => l.startsWith("NICK "));
    assert.match(nickLine, /^NICK Guest\d{5}$/);
    const guest = nickLine.slice(5);
    sock.serverSay(":onyx.test CAP * LS :message-tags");
    await tick(dom);
    const capReq = sock.lines().find((l) => l.startsWith("CAP REQ"));
    if (capReq) { sock.serverSay(":onyx.test CAP * ACK :" + capReq.replace(/^CAP REQ :?/, "")); await tick(dom); }
    sock.serverSay(...welcome(guest));
    await tick(dom);
    assert.ok(sock.lines().includes("RESETPASS kai"), "RESETPASS <account>; sent: " + JSON.stringify(sock.lines()));
    sock.serverSay(`:onyx.test NOTICE ${guest} :RESETPASS: if that account has a verified email, a reset code has been sent.`);
    await tick(dom);
    assert.match(q(doc, "#auth-title").textContent, /Check your email/);

    typeInto(window, q(doc, "#auth-reset-code"), RESET_CODE);
    typeInto(window, q(doc, "#auth-reset-password"), "a better passphrase");
    typeInto(window, q(doc, "#auth-reset-confirm"), "a better passphrase");
    await tick(dom);
    pressEnter(window, q(doc, "#auth-reset-confirm"));
    await tick(dom);
    assert.ok(
      sock.lines().includes(`RESETPASS kai ${RESET_CODE} :a better passphrase`),
      "RESETPASS <account> <code> :<new password>; sent: " + JSON.stringify(sock.lines()),
    );
    assert.equal(q(doc, "#auth-reset-password").value, "", "the new password is cleared once sent");
    sock.serverSay(":onyx.test RESETPASS SUCCESS kai :Password reset; log in with your new password");
    await tick(dom);
    assert.match(q(doc, "#auth-title").textContent, /Password changed/);
    q(doc, "#auth-done").click();
    await tick(dom);
    assert.equal(doc.querySelector('[data-testid="auth-gate"]'), null, "Sign in returns to the connect form");
    assert.equal(q(doc, "#conn-nick").value, "kai", "the account name is prefilled");
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
    root.cleanup();
  }
});
