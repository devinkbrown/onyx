// Playwright repro: voice opens tiny tray; video flashes then fails.
// Uses DEV app (window.__onyx) + live WSS. Fake media devices.
//
//   node tools/voice-ui-repro.mjs
//   ONYX_APP=http://127.0.0.1:5174/app ONYX_WS=wss://eshmaki.me:8080 node tools/voice-ui-repro.mjs
//
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.ONYX_APP ?? 'http://127.0.0.1:5174/app';
const WS = process.env.ONYX_WS ?? 'wss://eshmaki.me:8080';
const CHAN = process.env.ONYX_CHAN ?? `#vqa${Date.now().toString(36).slice(-6)}`;
const OUT = process.env.ONYX_REPRO_OUT ?? '/tmp/onyx-voice-repro';
const args = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];

mkdirSync(OUT, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitStableConnected(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let streak = 0;
  let last = 'unknown';
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__onyx?.store?.getState()?.status ?? 'no-store');
    streak = last === 'connected' ? streak + 1 : 0;
    if (streak >= 3) return last;
    await sleep(800);
  }
  throw new Error(`not connected (last=${last})`);
}

async function snapshot(page, label) {
  return page.evaluate(({ label, chan }) => {
    const s = window.__onyx?.store?.getState?.();
    if (!s) return { label, error: 'no store' };
    const v = s.voice ?? {};
    const stream = v.localStream;
    const camera = v.cameraStream;
    const stage = document.querySelector('.voice-stage');
    const bar = document.querySelector('.voice-bar, [data-testid="voice-bar"]');
    const stageRect = stage?.getBoundingClientRect?.();
    const barRect = bar?.getBoundingClientRect?.();
    const conv = document.querySelector('.shell-conversation, .shell-main, [data-testid="conversation"]');
    const convRect = conv?.getBoundingClientRect?.();
    const parts =
      s.voiceChannelParticipants?.get?.(chan.toLowerCase()) ??
      s.voiceChannelParticipants?.get?.(chan);
    const toasts = (s.toasts ?? []).map((t) => ({
      variant: t.variant,
      title: t.title,
      description: t.description,
    }));
    const notifs = (s.notifications ?? []).slice(-6).map((n) => n.text ?? String(n));
    return {
      label,
      status: s.status,
      nick: s.ourNick,
      callState: v.callState,
      callChannel: v.callChannel,
      callStartedAt: v.callStartedAt,
      cameraOn: v.cameraOn,
      mediaE2ee: v.mediaE2ee ?? v.e2eeState ?? null,
      audioTracks: stream ? stream.getAudioTracks().map((t) => ({ id: t.id, ready: t.readyState, enabled: t.enabled, muted: t.muted })) : [],
      videoTracks: stream
        ? stream.getVideoTracks().map((t) => ({ id: t.id, ready: t.readyState, enabled: t.enabled, muted: t.muted, settings: t.getSettings?.() }))
        : [],
      cameraTracks: camera
        ? camera.getVideoTracks().map((t) => ({ id: t.id, ready: t.readyState, enabled: t.enabled }))
        : [],
      peers: v.peers instanceof Map ? v.peers.size : v.peers ? Object.keys(v.peers).length : 0,
      participants: parts ? Array.from(parts) : [],
      stage: stage
        ? {
            className: stage.className,
            text: (stage.textContent ?? '').trim().slice(0, 120),
            w: Math.round(stageRect.width),
            h: Math.round(stageRect.height),
            top: Math.round(stageRect.top),
            visible: stageRect.width > 0 && stageRect.height > 0,
          }
        : null,
      bar: bar
        ? { w: Math.round(barRect.width), h: Math.round(barRect.height), visible: barRect.height > 0 }
        : null,
      conversation: conv
        ? { w: Math.round(convRect.width), h: Math.round(convRect.height) }
        : null,
      toasts,
      notifs,
      loadingStage: !!document.querySelector('[data-testid="voice-stage-loading"]'),
      videoEls: Array.from(document.querySelectorAll('video')).map((el) => ({
        w: el.videoWidth,
        h: el.videoHeight,
        paused: el.paused,
        muted: el.muted,
        readyState: el.readyState,
        className: el.className,
      })),
    };
  }, { label, chan: CHAN });
}

async function runMode(browser, mode) {
  const withVideo = mode === 'video';
  const nick = `qa${mode}${Math.floor(Math.random() * 1e5)}`;
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone', 'camera'],
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/media|voice|codec|opus|cadence|error|e2ee|mooring|wasm|identity/i.test(t)) {
      logs.push(`[${m.type()}] ${t}`.slice(0, 240));
    }
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`.slice(0, 240)));

  const timeline = [];
  const push = async (label) => {
    const snap = await snapshot(page, label).catch((e) => ({ label, error: String(e) }));
    timeline.push(snap);
    console.log(`\n=== ${mode}/${label} ===`);
    console.log(JSON.stringify(snap, null, 2));
    await page.screenshot({ path: join(OUT, `${mode}-${label}.png`), fullPage: true }).catch(() => {});
    return snap;
  };

  console.log(`\n######## MODE=${mode} nick=${nick} chan=${CHAN} app=${APP} ws=${WS}`);
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__onyx?.store?.getState, { timeout: 25_000 });
  await page.evaluate(({ WS, nick }) => {
    window.__onyx.store.getState().connect({ url: WS, nick });
  }, { WS, nick });
  await waitStableConnected(page);
  await page.evaluate((c) => {
    const s = window.__onyx.store.getState();
    s.joinChannel(c);
    s.navigate({ kind: 'channel', channel: c });
  }, CHAN);
  await sleep(1500);
  await push('after-join-channel');

  // Prefer real ribbon buttons when present (matches user path).
  const voiceBtn = page.getByRole('button', { name: /join voice/i }).first();
  const videoBtn = page.getByRole('button', { name: /join video/i }).first();
  let usedUi = false;
  if (withVideo && (await videoBtn.isVisible().catch(() => false))) {
    usedUi = true;
    await videoBtn.click();
  } else if (!withVideo && (await voiceBtn.isVisible().catch(() => false))) {
    usedUi = true;
    await voiceBtn.click();
  } else {
    // Fall back to store API (still measures stage geometry).
    await page.evaluate(async ({ c, v }) => {
      await window.__onyx.store.getState().joinVoiceChannel(c, v);
    }, { c: CHAN, v: withVideo });
  }
  console.log(`join path: ${usedUi ? 'UI button' : 'store.joinVoiceChannel'}`);

  // Sample while starting (catches flash + collapse).
  for (const ms of [200, 500, 1000, 2000, 4000, 7000, 10000]) {
    await sleep(ms === 200 ? 200 : ms - (ms === 500 ? 200 : ms === 1000 ? 500 : ms === 2000 ? 1000 : ms === 4000 ? 2000 : ms === 7000 ? 4000 : 7000));
    // The above is messy — simpler fixed samples:
  }
  // Re-sample with clean intervals from t0
  // (reset by taking explicit samples now that join has been running ~sum delays)
  // Actually redo cleanly:
  // We already waited ~sum; just take a final series of named samples with short waits.
  await push('t+immediate');
  await sleep(1500);
  await push('t+1.5s');
  await sleep(2500);
  await push('t+4s');
  await sleep(4000);
  await push('t+8s');
  await sleep(4000);
  await push('t+12s');

  // Second path: force store join if UI left us idle/failed
  const last = timeline[timeline.length - 1];
  if (last?.callState === 'idle' || !last?.callStartedAt) {
    console.log('retry via store.joinVoiceChannel…');
    await page.evaluate(async ({ c, v }) => {
      try {
        await window.__onyx.store.getState().joinVoiceChannel(c, v);
      } catch (e) {
        console.error('joinVoiceChannel threw', e);
      }
    }, { c: CHAN, v: withVideo });
    await sleep(2000);
    await push('after-store-retry-2s');
    await sleep(6000);
    await push('after-store-retry-8s');
  }

  // Leave cleanup
  await page.evaluate(() => {
    try { window.__onyx.store.getState().leaveVoiceChannel(); } catch { /* */ }
  });
  await sleep(500);
  await ctx.close();
  return { mode, nick, usedUi, timeline, logs: logs.slice(-30) };
}

const browser = await chromium.launch({ args });
const results = [];
try {
  results.push(await runMode(browser, 'voice'));
  results.push(await runMode(browser, 'video'));
} finally {
  await browser.close();
}

// Summary diagnosis
console.log('\n\n======== DIAGNOSIS SUMMARY ========');
for (const r of results) {
  console.log(`\n-- ${r.mode} (ui=${r.usedUi}) --`);
  const stages = r.timeline
    .filter((t) => t.stage)
    .map((t) => `${t.label}: ${t.stage.w}x${t.stage.h} class=${t.stage.className} callState=${t.callState} started=${t.callStartedAt} a=${t.audioTracks?.length ?? 0} v=${t.videoTracks?.length ?? 0}`);
  console.log(stages.join('\n') || '(no stage ever mounted)');
  const toasts = r.timeline.flatMap((t) => t.toasts ?? []);
  if (toasts.length) console.log('toasts:', JSON.stringify(toasts.slice(-6), null, 0));
  if (r.logs.length) console.log('console:', r.logs.slice(-10).join('\n'));
  const final = r.timeline[r.timeline.length - 1];
  const tiny = final?.stage && final.stage.h > 0 && final.stage.h < 80;
  const flashFail = r.mode === 'video' && r.timeline.some((t) => (t.videoTracks?.length ?? 0) > 0 || t.cameraOn)
    && (final?.callState === 'idle' || (final?.videoTracks?.length ?? 0) === 0);
  console.log('flags:', { tinyStage: !!tiny, flashThenFail: !!flashFail, finalCallState: final?.callState, finalStarted: final?.callStartedAt });
}

console.log(`\nScreenshots: ${OUT}/*.png`);
console.log(JSON.stringify({
  app: APP,
  ws: WS,
  chan: CHAN,
  results: results.map((r) => ({
    mode: r.mode,
    usedUi: r.usedUi,
    final: r.timeline[r.timeline.length - 1],
    stageHeights: r.timeline.map((t) => ({ label: t.label, h: t.stage?.h ?? null, callState: t.callState, started: t.callStartedAt, vtracks: t.videoTracks?.length ?? 0, toasts: t.toasts })),
  })),
}, null, 2));
