/* Voice engine adapter smoke (elm/media/voice-core.ts) — the
   window.OnyxVoiceEngine surface ports.js drives, against a FAKE Cadence
   engine (the real one needs WebRTC-era browser APIs; elm/tools/call-e2e.mjs
   covers it end-to-end against a local node). Bundles the adapter with the
   repo's esbuild, then checks:
     - the ports.js seam (createVoiceSeam) attaches the transport, taps lines,
       and hands binary datagrams straight to the engine;
     - store-equivalent MEDIA forwarding (EVENT re-shape, NOTE MEDIA, actor
       rules) + own-nick / account tracking;
     - join: capture starts synchronously (WebKit gesture), device-key
       enrollment (IDENTITY ADD) precedes the engine join, mute intent
       deferred until joined, failed joins owe the server a LEAVE;
     - iPhone: share is never advertised; DM ring fails closed.
   Run with: node --test elm/voiceEngine.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const here = dirname(new URL(import.meta.url).pathname);
const repo = resolve(here, "..");

function findEsbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD;
  let common = "";
  try { common = execFileSync("git", ["-C", here, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(); } catch { /* no git */ }
  for (const root of [repo, common ? resolve(common, "..") : "", "/home/kain/onyx"]) {
    const dir = root && join(root, "node_modules/.pnpm");
    if (!dir || !existsSync(dir)) continue;
    const hit = readdirSync(dir).find((n) => n.startsWith("esbuild@"));
    if (hit) return join(dir, hit, "node_modules/esbuild/bin/esbuild");
  }
  throw new Error("esbuild not found (set ESBUILD=…)");
}

const outDir = mkdtempSync(join(tmpdir(), "onyx-voice-smoke-"));
const outFile = join(outDir, "voice-core.mjs");
execFileSync(findEsbuild(), [join(here, "media/voice-core.ts"), "--bundle", "--format=esm", "--platform=neutral",
  `--tsconfig=${join(repo, "tsconfig.json")}`, `--outfile=${outFile}`, "--log-level=warning"], { cwd: repo });
const { createVoiceAdapter } = await import(pathToFileURL(outFile).href);

const require = createRequire(import.meta.url);
require("./ports.js");
const { createVoiceSeam, mediaReceiveRaw } = globalThis.OnyxPorts;

/* ---- fakes ---------------------------------------------------------------- */
function fakeTrack(kind) {
  return { kind, readyState: "live", enabled: true, stop() { this.readyState = "ended"; } };
}
function fakeStream(video) {
  const tracks = [fakeTrack("audio"), ...(video ? [fakeTrack("video")] : [])];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  };
}
function fakeEngine(log) {
  let cb = null;
  let client = null;
  const state = { callState: "idle", callWith: "", callChannel: null, local: null, kind: null };
  const engine = {
    _cb: () => cb,
    _client: () => client,
    _dropCapture() { state.local = null; state.kind = null; },
    setClient(c) { log.push(["setClient", c ? "shim" : null]); client = c; },
    async joinVoice(ch, stream) { return this._join(ch, stream, "voice"); },
    async joinVideo(ch, stream) { return this._join(ch, stream, "video"); },
    async _join(ch, stream, kind) {
      log.push(["join", ch, kind, !!stream]);
      if (engine.failNext) { const e = engine.failNext; engine.failNext = null; client.sendRaw("MEDIA", "JOIN", ch, "voice"); throw e; }
      state.callState = "in_call"; state.callChannel = ch; state.local = stream; state.kind = kind;
      cb.onCallState("in_call", "", ch);
      client.sendRaw("MEDIA", "JOIN", ch, kind);
    },
    leaveRoom(ch) { log.push(["leave", ch]); state.callState = "idle"; state.local = null; state.kind = null; cb.onCallState("idle", "", null); },
    setMuted(m) { log.push(["mute", m]); },
    setDeafened() {}, setOutput() {}, setPushToTalk(on) { log.push(["ptt", on]); }, pttPress() {}, pttRelease() {},
    async startCamera() {}, stopCamera() {}, async startScreenShare() {}, stopBroadcast() {},
    async startCall() { log.push(["engine-startCall"]); }, async acceptIncomingCall() {}, rejectCall() {}, hangup() {},
    getPeers: () => new Map(), getScreenStream: () => null,
    getLocalStream: () => state.local, getLocalKind: () => state.kind,
    getCallState: () => ({ callState: state.callState, callWith: state.callWith, callChannel: state.callChannel }),
    handleMediaMessage(from, ch, verb, detail) { log.push(["media", from, ch, verb, detail]); },
  };
  return { engine, setCb: (c) => { cb = c; } };
}

function harness(extra = {}) {
  const log = [];
  const lines = [];
  const binary = [];
  const fake = fakeEngine(log);
  const gum = [];
  const adapter = createVoiceAdapter({
    createEngine(callbacks) { fake.setCb(callbacks); return fake.engine; },
    getUserMedia(constraints) { gum.push(constraints); log.push(["gum", !!constraints.video]); return Promise.resolve(fakeStream(!!constraints.video)); },
    enrollIdentity: async (account) => ({ label: "onyx-0011223344556677", publicHex: "ab".repeat(32), sig: "cd".repeat(64), account }),
    ...extra,
  });
  const events = [];
  const push = (ev) => events.push(ev);
  push.local = (fields) => events.push({ local: fields });
  adapter.subscribe(push);
  adapter.attachTransport({ sendLine: (l) => { lines.push(String(l).replace(/\r\n$/, "")); return true; }, sendBinary: (b) => { binary.push(b); return true; }, url: () => "wss://node.test/" });
  adapter.transportOpen();
  return { adapter, fake, log, lines, binary, events, gum };
}

/* Answer the adapter's IDENTITY ADD like the server does. */
function serverConfirmsEnroll(h) {
  const add = h.lines.find((l) => l.startsWith("IDENTITY ADD "));
  assert.ok(add, "IDENTITY ADD sent");
  const label = add.split(" ")[2];
  h.adapter.receiveLine(`:node.test NOTICE ana :IDENTITY ADDED label=${label}`);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("seam: transport attach, line tap, binary datagrams go straight to the engine", () => {
  const seen = { lines: [], frames: [], opened: 0, closed: 0, transport: null };
  const hook = {
    attachTransport(t) { seen.transport = t; },
    transportOpen() { seen.opened += 1; },
    transportClosed() { seen.closed += 1; },
    receiveLine(l) { seen.lines.push(l); },
    receiveMediaFrame(b) { seen.frames.push(b); },
  };
  const sent = [];
  const raw = { readyState: 1, protocol: "", bufferedAmount: 0, send(b) { sent.push(b); } };
  const facade = { isOpen: () => true, send: (l) => sent.push(l), rawSocket: () => raw };
  const seam = createVoiceSeam({ socket: () => facade, engine: () => hook });
  seam.opened("wss://node.test/");
  assert.equal(seen.opened, 1);
  assert.equal(seen.transport.url(), "wss://node.test/");
  seam.lines([":s NOTE MEDIA #c JOIN ana voice", ":s 001 ana :hi"]);
  assert.deepEqual(seen.lines, [":s NOTE MEDIA #c JOIN ana voice", ":s 001 ana :hi"]);
  assert.equal(seen.transport.sendLine("MEDIA LEAVE #c"), true);
  const datagram = new Uint8Array([1, 2, 3]);
  assert.equal(seen.transport.sendBinary(datagram), true);
  assert.deepEqual(sent, ["MEDIA LEAVE #c", datagram]);
  /* text.ircv3.net never carries binary */
  raw.protocol = "text.ircv3.net";
  assert.equal(seen.transport.sendBinary(datagram), false);
  /* inbound: with an engine, mediaReceiveRaw hands bytes over (no Elm copy) */
  const elmPort = [];
  const app = { ports: { mediaBinaryReceived: { send: (v) => elmPort.push(v) } } };
  const bytes = new Uint8Array(30).buffer;
  assert.equal(mediaReceiveRaw(app, bytes, "", () => {}, seam.binary), "engine");
  assert.equal(seen.frames.length, 1);
  assert.equal(elmPort.length, 0);
  /* without an engine the Elm path is unchanged */
  assert.equal(mediaReceiveRaw(app, bytes, "", () => {}), "forwarded");
  seam.closed();
  assert.equal(seen.closed, 1);
});

test("MEDIA lines: EVENT re-shape + NOTE forward mirror the store glue", () => {
  const h = harness();
  h.adapter.receiveLine(":node.test 001 ana :Welcome");
  h.adapter.receiveLine(":node.test 900 ana ana!u@h ana :You are now logged in");
  h.adapter.receiveLine("@msgid=1 :node.test EVENT ana MEDIA JOIN #c ben voice");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA E2EE-HANDSHAKE #c ben :QUJD");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA MACKEY #c Zm9v");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA JOIN &bad,chan ben voice");
  h.adapter.receiveLine(":node.test PRIVMSG #c :MEDIA not a reply");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA JOIN #c ben video");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA MUTE #c ben video");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA UNMUTE #c ben video");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA MUTE #c ben voice");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA SPEAKING #c ben voice");
  h.adapter.receiveLine(":node.test EVENT ana MEDIA SILENT #c ben voice");
  const media = h.log.filter((e) => e[0] === "media");
  /* presence verbs are translated to the engine's control vocabulary */
  assert.deepEqual(media[0], ["media", "ben", "#c", "JOIN", "voice"]);
  assert.deepEqual(media[1], ["media", "ben", "#c", "E2EE-HANDSHAKE", "QUJD"]);
  /* MACKEY is caller-only (no actor): forwarded with an empty actor, like the store */
  assert.deepEqual(media[2], ["media", "", "#c", "MACKEY", "Zm9v"]);
  assert.deepEqual(media.slice(3), [
    ["media", "ben", "#c", "JOIN", "video"],
    ["media", "ben", "#c", "VIDEO_LEAVE", ""],
    ["media", "ben", "#c", "MUTE", ""],
    ["media", "ben", "#c", "SPEAKING", "ben 1"],
    ["media", "ben", "#c", "SPEAKING", "ben 0"],
  ]);
  const s = h.adapter.stats();
  assert.equal(s.nick, "ana");
  assert.equal(s.account, "ana");
});

test("join: capture is synchronous, enrollment precedes the engine join, mute is deferred", async () => {
  const h = harness();
  h.adapter.receiveLine(":node.test 001 ana :Welcome");
  h.adapter.receiveLine(":node.test 900 ana ana!u@h ana :You are now logged in");
  h.adapter.setMuted(true); /* Elm sends VoiceMute right after VoiceJoin */
  const joined = h.adapter.joinVoice("#c", { video: false });
  /* getUserMedia ran before any await (WebKit user-gesture rule) */
  assert.deepEqual(h.log.filter((e) => e[0] !== "setClient")[0], ["gum", false]);
  assert.equal(h.gum[0].audio.echoCancellation, true);
  await tick(); await tick();
  assert.ok(!h.log.some((e) => e[0] === "join"), "engine join waits for the enrolled key");
  serverConfirmsEnroll(h);
  await joined;
  const order = h.log.map((e) => e[0]);
  assert.ok(order.indexOf("join") < order.lastIndexOf("mute"), "mute applied after the join resolved");
  assert.deepEqual(h.log.find((e) => e[0] === "join"), ["join", "#c", "voice", true]);
  assert.ok(h.events.some((e) => e.state === "in_call" && e.channel === "#c"));
  /* second join on the same connection does not re-enroll */
  const before = h.lines.filter((l) => l.startsWith("IDENTITY ADD")).length;
  h.adapter.leaveRoom("#c");
  await h.adapter.joinVoice("#c", { video: false });
  assert.equal(h.lines.filter((l) => l.startsWith("IDENTITY ADD")).length, before);
});

test("guests are refused with a classified error; failed joins send LEAVE", async () => {
  const guest = harness();
  guest.adapter.receiveLine(":node.test 001 gus :Welcome");
  await assert.rejects(guest.adapter.joinVoice("#c", {}), (e) => e.name === "AccountRequiredError");
  assert.ok(!guest.log.some((e) => e[0] === "join"));

  const h = harness();
  h.adapter.receiveLine(":node.test 001 ana :Welcome");
  h.adapter.receiveLine(":node.test 900 ana ana!u@h ana :You are now logged in");
  h.fake.engine.failNext = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  const p = h.adapter.joinVoice("#c", {});
  await tick(); await tick();
  serverConfirmsEnroll(h);
  await assert.rejects(p, (e) => e.name === "NotAllowedError");
  assert.ok(h.lines.includes("MEDIA LEAVE #c"), "the server-side join is undone");
});

test("iPhone: share never advertised; DM ring fails closed", async () => {
  const h = harness({ platform: { ios: true, standalone: false, canShareScreen: false, canCapture: true } });
  h.adapter.receiveLine(":node.test 001 ana :Welcome");
  h.adapter.receiveLine(":node.test 900 ana ana!u@h ana :You are now logged in");
  const p = h.adapter.joinVoice("#c", {});
  await tick(); await tick();
  serverConfirmsEnroll(h);
  await p;
  const state = h.events.find((e) => e.state === "in_call");
  assert.equal(state.shareSupported, false);
  assert.ok(h.events.filter((e) => e.local).every((e) => e.local.shareSupported === false));
  assert.equal(await h.adapter.startScreenShare("#c"), false);
  await assert.rejects(h.adapter.startCall("ben", "voice"), (e) => e.name === "NotSupportedError");
  assert.ok(!h.log.some((e) => e[0] === "engine-startCall"), "no phantom ring");
});

test("binary datagrams fan out to the engine's handlers", () => {
  const h = harness();
  const got = [];
  h.fake._client = null;
  /* the shim the engine was given exposes binaryHandlers like IRCClient */
  const shimCall = h.log.find((e) => e[0] === "setClient");
  assert.ok(shimCall);
  const client = h.fake.engine._client();
  client.binaryHandlers.add((b) => got.push(b.byteLength));
  h.adapter.receiveMediaFrame(new Uint8Array(40));
  h.adapter.receiveMediaFrame([1, 2, 3]);
  h.adapter.receiveMediaFrame([1, 999]);
  assert.deepEqual(got, [40, 3]);
  assert.equal(client.currentNick, "");
  h.adapter.receiveLine(":node.test 001 ana :Welcome");
  assert.equal(client.currentNick, "ana");
});

test("recovery: capture lost under a live call rejoins with fresh capture", async () => {
  const h = harness();
  h.adapter.receiveLine(":node.test 001 ana :Welcome");
  h.adapter.receiveLine(":node.test 900 ana ana!u@h ana :You are now logged in");
  const p = h.adapter.joinVoice("#c", {});
  await tick(); await tick();
  serverConfirmsEnroll(h);
  await p;
  const joinsBefore = h.log.filter((e) => e[0] === "join").length;
  /* iOS interruption: the engine released its ended capture (still in_call) */
  const cb = h.fake.engine._cb();
  h.fake.engine._dropCapture();
  cb.onLocalStream(null);
  await new Promise((r) => setTimeout(r, 600));
  const joins = h.log.filter((e) => e[0] === "join");
  assert.equal(joins.length, joinsBefore + 1, "rejoined once");
  assert.equal(h.adapter.stats().recoveries, 1);
  assert.equal(h.adapter.stats().joinedRoom, "#c", "still in the call after recovery");
  assert.ok(!h.log.some((e) => e[0] === "leave"), "recovery never hangs up");
  /* a foreground return with live capture does nothing */
  h.adapter.recover("visible");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(h.log.filter((e) => e[0] === "join").length, joinsBefore + 1);
});
