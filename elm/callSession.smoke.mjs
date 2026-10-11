/* v3/rx-calls — call session assist + media-failure snapshot smoke
   (elm/ports.js): while a call is live the screen wake lock is held
   (re-acquired when the page is visible again, released on idle) and
   the OS media-session call controls route through the SAME shortcut
   names as the Ctrl+Shift chords; the voice feed keeps honest outcomes
   for the adapter's follow-up idle snapshots and forwards media-error
   detail. Run with: node --test elm/callSession.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { createVoiceSessionAssist, voiceFeed } = globalThis.OnyxPorts;

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeWindow() {
  const listeners = {};
  const handlers = {};
  const sentinels = [];
  const doc = {
    visibilityState: "visible",
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  };
  const win = {
    document: doc,
    MediaMetadata: function MediaMetadata(init) { Object.assign(this, init); },
    navigator: {
      wakeLock: {
        request(kind) {
          const s = { kind, released: false, release() { this.released = true; (this.onrel || []).forEach((f) => f()); }, addEventListener(n, f) { (this.onrel = this.onrel || []).push(f); } };
          sentinels.push(s);
          return Promise.resolve(s);
        },
      },
      mediaSession: {
        metadata: null,
        mic: null,
        setActionHandler(action, fn) { handlers[action] = fn; },
        setMicrophoneActive(on) { this.mic = on; },
      },
    },
  };
  return { win, doc, listeners, handlers, sentinels };
}

test("wake lock + media session follow the call lifecycle", async () => {
  const f = fakeWindow();
  const sent = [];
  const app = { ports: { shortcut: { send: (n) => sent.push(n) } } };
  const assist = createVoiceSessionAssist(app, f.win);

  assist.update({ state: "in_call", channel: "#lounge" });
  await flush();
  assert.equal(f.sentinels.length, 1, "screen lock requested");
  assert.equal(f.sentinels[0].kind, "screen");
  assert.equal(assist.held(), true);
  assert.equal(f.win.navigator.mediaSession.metadata.title, "Call in #lounge");
  f.handlers.togglemicrophone();
  f.handlers.hangup();
  assert.deepEqual(sent, ["call-mute", "call-leave"], "OS controls reuse the chord names");
  assist.setMicrophoneActive(false);
  assert.equal(f.win.navigator.mediaSession.mic, false);

  /* the OS drops the lock when the page hides; visible again re-acquires */
  f.sentinels[0].release();
  assert.equal(assist.held(), false);
  f.listeners.visibilitychange.forEach((fn) => fn());
  await flush();
  assert.equal(f.sentinels.length, 2);
  assert.equal(assist.held(), true);

  /* a repeated live snapshot does not stack locks */
  assist.update({ state: "in_call", channel: "#lounge" });
  await flush();
  assert.equal(f.sentinels.length, 2);

  assist.update({ state: "idle", channel: null });
  assert.equal(f.sentinels[1].released, true, "released on idle");
  assert.equal(f.handlers.togglemicrophone, null);
  assert.equal(f.handlers.hangup, null);
  assert.equal(f.win.navigator.mediaSession.metadata, null);
});

test("no wake lock / media session API: nothing throws", () => {
  const app = { ports: {} };
  const assist = createVoiceSessionAssist(app, { navigator: {}, document: { visibilityState: "visible", addEventListener() {} } });
  assist.update({ state: "in_call", channel: "#c" });
  assist.setMicrophoneActive(true);
  assist.update({ state: "idle" });
  assert.equal(assist.held(), false);
});

test("voice feed: removal / lost capture keep honest outcomes; error detail forwarded", () => {
  const blank = voiceFeed.blank();
  const removed = voiceFeed.next(blank, { state: "idle", errorKind: "removed", mediaError: "You were removed from voice by mara" }, 1);
  assert.equal(removed.snapshot.outcome, "ended");
  assert.equal(removed.snapshot.errorKind, "removed");
  assert.equal(removed.snapshot.mediaError, "You were removed from voice by mara");
  const lost = voiceFeed.next(blank, { state: "idle", errorKind: "capture" }, 1);
  assert.equal(lost.snapshot.outcome, "failed");
  const live = voiceFeed.next(blank, { state: "in_call", channel: "#c", errorKind: "decode", errorPeer: "ben", errorMedia: "voice" }, 5);
  assert.equal(live.snapshot.errorPeer, "ben");
  assert.equal(live.snapshot.errorMedia, "voice");
  assert.equal(live.snapshot.errorKind, "decode");
});
