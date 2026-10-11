// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-calls.mjs — extra screens.mjs scenarios for the call UI: the
 * pre-join banner + presence chip, the voice stage and control bar, the
 * More sheet, the video grid (video is OFF on the live network; these
 * shots switch it on in a FAKE engine only), the PiP dock, the ring
 * dialog, captions + reactions, voice settings, privacy, the guest and
 * DM "not available" states, and the Calls hub.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-calls.mjs \
 *     --only call-banner,call-voice,call-video
 *
 * Nothing here touches a network: screens.mjs serves a fake IRC server,
 * and these scenarios (1) proxy its WebSocket through Playwright's
 * routeWebSocket so they can inject `NOTE MEDIA …` roster lines and a
 * 900 sign-in, and (2) install a fake `window.OnyxVoiceEngine` BEFORE
 * voice.js runs (voice-engine.ts never replaces an existing one), which
 * reports an in-call snapshot and paints canvas "camera" streams.
 */

const NET = 'onyx.test';
const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Click the first VISIBLE element matching any selector. */
async function clickVisible(page, selectors, h, ms) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page, ms);
        return true;
      }
    }
  }
  return false;
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

/** Proxy the fake server's socket so a scenario can inject lines. */
async function tap(page, { signedIn = true } = {}) {
  const t = { ws: null, nick: 'kn', sent: [] };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    t.ws = ws;
    ws.onMessage((m) => {
      if (typeof m === 'string') {
        t.sent.push(m);
        const nick = /^NICK (\S+)/m.exec(m);
        if (nick) t.nick = nick[1];
      }
      server.send(m);
      // SASL finished before registration (what a signed-in session
      // sees): the 900 lands ahead of the welcome.
      if (signedIn && typeof m === 'string' && /^CAP END/m.test(m)) {
        ws.send(`:${NET} 900 ${t.nick} ${t.nick}!u@${NET} ${t.nick} :You are now logged in as ${t.nick}`);
      }
    });
  });
  t.inject = (...lines) => { for (const l of lines) t.ws?.send(l); };
  return t;
}

/** The fake engine: in-call snapshots, peers, canvas camera streams.
    Serialised into the page by addInitScript (no closures over module
    scope). */
function fakeEngine(opts) {
  const { video, peers, joinDelay } = opts;
  const subs = [];
  const emit = (ev) => { for (const p of subs) { try { p(ev); } catch { /* */ } } };
  const local = (fields) => { for (const p of subs) { try { if (p.local) p.local(fields); } catch { /* */ } } };
  const streams = {};
  const palette = ['#2c3e50', '#3b2f4a', '#24423c', '#4a3324', '#283548', '#3d2a33', '#2f3f2a', '#40382a', '#2a3a44'];
  function canvasStream(tile, i) {
    if (streams[tile]) return streams[tile];
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const paint = () => {
      g.fillStyle = palette[i % palette.length];
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.beginPath(); g.arc(320, 150, 70, 0, Math.PI * 2); g.fill();
      g.fillRect(200, 240, 240, 140);
    };
    paint();
    window.setInterval(paint, 200);
    streams[tile] = c.captureStream(5);
    return streams[tile];
  }
  let channel = null;
  const eng = {
    videoEnabled: !!video,
    subscribe(push) { subs.push(push); },
    joinVoice(ch, o) {
      channel = ch;
      // joinDelay: a join that stays in flight (capture / enrolment).
      if (joinDelay) return new Promise(() => {});
      setTimeout(() => {
        emit({ state: 'in_call', nick: '', channel: ch, shareSupported: true, e2eeActive: true, localFingerprint: '4821 9930 1177 5042 8813 2290' });
        emit({ peers: peers.map((p) => ({ nick: p.nick, kind: p.video ? 'video' : 'voice', hasVideo: !!p.video, speaking: !!p.speaking, muted: !!p.muted })) });
        if (o && o.video && video) {
          emit({ localStream: canvasStream('self', 8) });
          local({ camera: true });
        }
      }, 30);
      return Promise.resolve();
    },
    leaveRoom() { emit({ state: 'idle', nick: '', channel: null }); channel = null; },
    setMuted() {}, setDeafened() {}, setOutput() {}, setPushToTalk() {},
    startCamera() { if (!video) return Promise.resolve(false); emit({ localStream: canvasStream('self', 8) }); return Promise.resolve(true); },
    stopCamera() { emit({ localStream: null }); },
    startScreenShare() { return Promise.resolve(false); },
    stopScreenShare() {},
    startCall() { return Promise.reject(Object.assign(new Error('Direct calls are not available'), { name: 'NotSupportedError' })); },
    acceptIncomingCall() { return Promise.resolve(); },
    rejectCall() {}, hangup() {},
    streamForTile(tile) {
      const m = /^peer:(.+)$/.exec(tile);
      if (!m) return tile === 'self' && video ? canvasStream('self', 8) : null;
      const i = peers.findIndex((p) => p.nick.toLowerCase() === m[1].toLowerCase());
      return i >= 0 && peers[i].video ? canvasStream(tile, i) : null;
    },
    ring(nick) { emit({ state: 'ringing_in', nick, channel: null }); },
    // Confirmed local fields on the live call (media failures ride here).
    __local: local,
    get channel() { return channel; },
  };
  window.OnyxVoiceEngine = eng;
}

const VOICE_PEERS = [
  { nick: 'mara', speaking: true },
  { nick: 'jun' },
  { nick: 'iris', muted: true },
  { nick: 'theo' },
  { nick: 'sol' },
];
const VIDEO_PEERS = [
  { nick: 'mara', speaking: true, video: true },
  { nick: 'jun', video: true },
  { nick: 'iris', muted: true, video: true },
  { nick: 'theo' },
  { nick: 'sol', video: true },
];
const MANY_PEERS = ['mara', 'jun', 'iris', 'theo', 'sol', 'ash', 'nova', 'kip'].map((nick, i) => ({ nick, video: i !== 3, speaking: i === 0, muted: i === 2 }));

async function setup(page, h, { video = false, peers = VOICE_PEERS, signedIn = true, room = '#lounge', joinDelay = false } = {}) {
  const t = await tap(page, { signedIn });
  await page.addInitScript(fakeEngine, { video, peers, joinDelay });
  await page.addInitScript(() => {
    try { localStorage.setItem('onyx:preferences', JSON.stringify({ e2eeDms: false })); } catch { /* */ }
  });
  await h.joinRoom(page, 'kn', room);
  await dismissAsks(page, h);
  return t;
}

/** Others already in the room's call (the banner + chip state). */
function roster(t, room, peers, { self = false } = {}) {
  const lines = peers.map((p) => `:${NET} NOTE MEDIA ${room} JOIN ${p.nick} :joined`);
  if (self) lines.push(`:${NET} NOTE MEDIA ${room} JOIN ${t.nick} :joined`);
  for (const p of peers) {
    if (p.speaking) lines.push(`:${NET} NOTE MEDIA ${room} SPEAKING ${p.nick} 1`);
    if (p.muted) lines.push(`:${NET} NOTE MEDIA ${room} MUTE ${p.nick} voice`);
  }
  t.inject(...lines);
}

async function joinCall(page, h, t, { room = '#lounge', peers = VOICE_PEERS, video = false } = {}) {
  roster(t, room, peers);
  await h.settle(page, 300);
  await clickVisible(page, ['[data-testid="call-join-voice"]', '[data-testid="ribbon-join-call"]'], h, 400);
  roster(t, room, [], { self: true });
  // The camera is offered only once the engine reports it (fails closed).
  if (video) await clickVisible(page, ['[data-testid="camera-button"]'], h, 300);
  t.inject(`:${NET} NOTE MEDIA ${room} HAND theo up`);
  await h.settle(page, 600);
}

async function inCall(page, h, opts = {}) {
  const t = await setup(page, h, opts);
  await joinCall(page, h, t, opts);
  return t;
}

async function openCalls(page, h) {
  await clickVisible(page, ['[data-testid="room-back"]'], h, 300);
  await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-calls"]', '.onyx-primary-nav [data-testid="nav-calls"]', '.onyx-calls-toggle'], h, 600);
}

export default {
  // Pre-join: others in voice — the banner and the header chip.
  'call-banner': async (page, h) => {
    const t = await setup(page, h);
    roster(t, '#lounge', VOICE_PEERS.slice(0, 3));
    await h.settle(page, 500);
  },
  // Guest (no account): calls need an account.
  'call-guest': async (page, h) => {
    const t = await setup(page, h, { signedIn: false });
    roster(t, '#lounge', VOICE_PEERS.slice(0, 3));
    await h.settle(page, 500);
  },
  'call-voice': async (page, h) => {
    await inCall(page, h);
  },
  'call-more': async (page, h) => {
    await inCall(page, h);
    await clickVisible(page, ['[data-testid="call-more"]'], h, 400);
  },
  'call-video': async (page, h) => {
    await inCall(page, h, { video: true, peers: VIDEO_PEERS });
  },
  'call-video-many': async (page, h) => {
    await inCall(page, h, { video: true, peers: MANY_PEERS });
  },
  'call-big': async (page, h) => {
    await inCall(page, h);
    await clickVisible(page, ['[data-testid="call-more"]'], h, 300);
    await clickVisible(page, ['[data-testid="stage-size-button"]'], h, 400);
  },
  'call-captions': async (page, h) => {
    const t = await inCall(page, h);
    await clickVisible(page, ['[data-testid="captions-button"]', '[data-testid="call-captions"]'], h, 300);
    t.inject(`:${NET} NOTE MEDIA #lounge CAPTION mara :ok so the plan for tonight is the release walkthrough first`,
      `:${NET} NOTE MEDIA #lounge REACT jun 🎉`, `:${NET} NOTE MEDIA #lounge REACT sol 👏`);
    await h.settle(page, 500);
  },
  'call-settings': async (page, h) => {
    await inCall(page, h);
    await clickVisible(page, ['[data-testid="call-more"]'], h, 300);
    await clickVisible(page, ['[data-testid="voice-settings-open"]', '[data-testid="call-more-settings"]', 'button:has-text("voice settings")'], h, 500);
  },
  'call-privacy': async (page, h) => {
    await inCall(page, h);
    await clickVisible(page, ['[data-testid="call-security-chip"]'], h, 500);
  },
  // In a call, viewing another room: the mini call view (PiP / dock).
  'call-pip': async (page, h) => {
    const t = await inCall(page, h);
    t.inject(`:${t.nick}!u@${NET} JOIN #design`);
    await h.settle(page, 300);
    await clickVisible(page, ['[data-testid="room-back"]'], h, 300);
    await clickVisible(page, ['button:has-text("#design")', 'a:has-text("#design")'], h, 600);
  },
  'call-hub': async (page, h) => {
    await inCall(page, h);
    await openCalls(page, h);
  },
  'call-hub-idle': async (page, h) => {
    const t = await setup(page, h);
    roster(t, '#lounge', VOICE_PEERS.slice(0, 2));
    await h.settle(page, 200);
    await openCalls(page, h);
  },
  // Browser zoom 200% on a laptop: the same CSS viewport as 640x360.
  'call-zoom200': async (page, h) => {
    await inCall(page, h);
    if ((page.viewportSize()?.width ?? 0) >= 1280) {
      await page.setViewportSize({ width: 640, height: 360 });
      await h.settle(page, 500);
    }
  },
  'call-zoom200-more': async (page, h) => {
    await inCall(page, h);
    if ((page.viewportSize()?.width ?? 0) >= 1280) {
      await page.setViewportSize({ width: 640, height: 360 });
      await h.settle(page, 400);
    }
    await clickVisible(page, ['[data-testid="call-more"]'], h, 400);
  },
  // A large default font size (browser setting): rem-based sizes grow.
  'call-bigfont': async (page, h) => {
    await inCall(page, h);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await h.settle(page, 400);
  },
  // Incoming DM ring (the engine reports ringing_in).
  'call-ring': async (page, h) => {
    await setup(page, h);
    await page.evaluate(() => window.OnyxVoiceEngine.ring('mara'));
    await h.settle(page, 600);
  },
  // The join in flight: provisional stage + the permission hint.
  'call-joining': async (page, h) => {
    const t = await setup(page, h, { joinDelay: true });
    roster(t, '#lounge', VOICE_PEERS.slice(0, 3));
    await h.settle(page, 300);
    await clickVisible(page, ['[data-testid="call-join-voice"]', '[data-testid="ribbon-join-call"]'], h, 600);
  },
  // Media failures are never silent: a calm toast over the live call.
  'call-toast': async (page, h) => {
    await inCall(page, h);
    await page.evaluate(() => window.OnyxVoiceEngine.__local({ errorKind: 'media' }));
    await h.settle(page, 500);
  },
  // A peer's media key changed: the DM key-change language, as a warning toast.
  'call-toast-key': async (page, h) => {
    await inCall(page, h);
    await page.evaluate(() => window.OnyxVoiceEngine.__local({ errorKind: 'peer_key', errorPeer: 'mara' }));
    await h.settle(page, 500);
  },
  // Invite with the room link, from the More tray.
  'call-invite': async (page, h) => {
    await inCall(page, h);
    await clickVisible(page, ['[data-testid="call-more"]'], h, 300);
    await clickVisible(page, ['[data-testid="call-invite"]'], h, 600);
    if (await page.$('[data-testid="call-more-tools"]')) throw new Error('More stayed open behind the invite sheet');
  },
  // Tap / click outside closes More (the scrim); fails the shot when it does not.
  'call-more-dismiss': async (page, h) => {
    await inCall(page, h);
    await clickVisible(page, ['[data-testid="call-more"]'], h, 300);
    if (!(await page.$('[data-testid="call-more-tools"]'))) throw new Error('More did not open');
    const vp = page.viewportSize();
    await page.mouse.click(Math.round(vp.width / 2), 8);
    await h.settle(page, 300);
    if (await page.$('[data-testid="call-more-tools"]')) throw new Error('More did not close on an outside tap');
  },
  // A guest on the Calls hub: sign in, never a join.
  'call-guest-hub': async (page, h) => {
    const t = await setup(page, h, { signedIn: false });
    roster(t, '#lounge', VOICE_PEERS.slice(0, 2));
    await h.settle(page, 200);
    await openCalls(page, h);
  },
  // A DM: the More menu says direct calls are not available yet.
  'call-dm': async (page, h) => {
    await setup(page, h);
    if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]'], h, 300);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-messages"]', '.onyx-primary-nav [data-testid="nav-messages"]'], h, 300);
    await clickVisible(page, ['[data-testid="new-conversation"]'], h, 300);
    await page.fill('#new-message-recipient', 'jun').catch(() => {});
    await page.keyboard.press('Enter');
    await h.settle(page, 600);
    await dismissAsks(page, h);
    await clickVisible(page, ['[data-testid="room-more"]', '.onyx-room-more'], h, 500);
  },
};
