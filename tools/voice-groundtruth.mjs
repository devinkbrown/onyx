// Ground truth: two fake-media browsers join #root voice (then video) on the LIVE
// network via the dev server (DEV exposes window.__onyx). Reports full state.
import { chromium } from '@playwright/test';

const APP = 'http://localhost:5174/app';
const WS = process.env.WS || 'wss://eshmaki.me:8080';
const CHAN = '#root';
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const b = await chromium.launch({ args });

async function user(nick, withVideo) {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', (m) => { if (/media|voice|codec|opus|opvox|error/i.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 160)); });
  await p.goto(APP, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForFunction(() => !!(window).__onyx?.store?.getState, { timeout: 20000 }).catch(() => {});
  await p.evaluate(({ WS, nick }) => (window).__onyx.store.getState().connect({ url: WS, nick }), { WS, nick });
  await p.waitForFunction(() => (window).__onyx.store.getState().status === 'connected', { timeout: 40000 }).catch(() => {});
  // ensure in #root
  await p.evaluate((c) => { const s = (window).__onyx.store.getState(); s.joinChannel?.(c); s.navigate?.({ kind: 'channel', channel: c }); }, CHAN);
  return { ctx, p, nick, withVideo, logs };
}

const A = await user('vqaA' + (Date.now() % 9999), false);
const B = await user('vqaB' + (Date.now() % 9999), true);
await A.p.waitForTimeout(3000);

// join voice (A) / video (B)
for (const U of [A, B]) {
  await U.p.evaluate(async ({ c, v }) => { await (window).__onyx.store.getState().joinVoiceChannel(c, v); }, { c: CHAN, v: U.withVideo }).catch(() => {});
}
await A.p.waitForTimeout(9000);

const snap = (U) => U.p.evaluate((c) => {
  const s = (window).__onyx.store.getState();
  const v = s.voice || {};
  const parts = s.voiceChannelParticipants?.get?.(c.toLowerCase()) ?? s.voiceChannelParticipants?.get?.(c);
  return {
    status: s.status,
    callChannel: v.callChannel,
    audioTracks: v.localStream ? v.localStream.getAudioTracks().length : 0,
    videoTracks: v.localStream ? v.localStream.getVideoTracks().length : 0,
    peers: v.peers ? (v.peers.size ?? Object.keys(v.peers).length) : 0,
    participants: parts ? Array.from(parts) : [],
    notifications: (s.notifications || []).map((n) => n.text).filter(Boolean).slice(-4),
  };
}, CHAN);

const a = await snap(A), bb = await snap(B);
console.log('A(voice):', JSON.stringify(a, null, 0));
console.log('B(video):', JSON.stringify(bb, null, 0));
if (A.logs.length) console.log('A logs:', A.logs.slice(-5).join(' | '));
if (B.logs.length) console.log('B logs:', B.logs.slice(-5).join(' | '));
await b.close();
