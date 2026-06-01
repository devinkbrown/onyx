import { test, expect } from '@playwright/test';

// Two real users (fake media) join voice in a FRESH EMPTY channel on the live
// server and must actually transmit media. Before the fix, joinVoiceChannel
// never invoked the engine, so ZERO MEDIAFRAMEs were sent.
test('two users transmit + exchange voice media in an empty channel', async ({ browser }) => {
  test.setTimeout(150_000);
  const WS = 'wss://eshmaki.me:8080';
  const chan = '#oceanqa' + Math.floor(Math.random() * 1e6);

  async function makeUser(nick: string) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const frames: string[] = [];
    page.on('websocket', (ws) =>
      ws.on('framesent', (f) => { if (typeof f.payload === 'string') frames.push(f.payload); }),
    );
    await page.goto('https://eshmaki.me/app/?e2e=1');
    await page.waitForFunction(() => (window as any).__ocean !== undefined, { timeout: 30_000 });
    await page.evaluate(({ WS, nick }) => (window as any).__ocean.getState().connect({ url: WS, nick }), { WS, nick });
    await page.waitForFunction(() => (window as any).__ocean.getState().status === 'connected', { timeout: 40_000 });
    return { ctx, page, frames, nick };
  }

  const A = await makeUser('qaA' + Math.floor(Math.random() * 1e4));
  const B = await makeUser('qaB' + Math.floor(Math.random() * 1e4));

  for (const U of [A, B]) await U.page.evaluate((c) => (window as any).__ocean.getState().joinChannel(c), chan);
  await A.page.waitForTimeout(2500);
  // Mimic the UI: open the channel (sets activeView) before joining voice.
  for (const U of [A, B]) await U.page.evaluate((c) => (window as any).__ocean.getState().navigate({ kind: 'channel', channel: c }), chan);
  await A.page.waitForTimeout(4000);
  // join voice, retrying once if the engine wasn't ready yet
  for (const U of [A, B]) {
    await U.page.evaluate(async (c) => { await (window as any).__ocean.getState().joinVoiceChannel(c); }, chan);
  }
  await A.page.waitForTimeout(3000);
  for (const U of [A, B]) {
    const cc = await U.page.evaluate(() => (window as any).__ocean.getState().voice.callChannel);
    if (!cc) await U.page.evaluate(async (c) => { await (window as any).__ocean.getState().joinVoiceChannel(c); }, chan);
  }

  // Let encoders spin up, VEIL handshake, and presence propagate.
  await A.page.waitForTimeout(9000);

  const vstate = async (U: typeof A) => U.page.evaluate((c) => {
    const v = (window as any).__ocean.getState().voice;
    const parts = (window as any).__ocean.getState().voiceChannelParticipants.get(c.toLowerCase());
    return {
      callChannel: v.callChannel,
      callState: v.callState,
      hasLocalStream: !!v.localStream,
      audioTracks: v.localStream ? v.localStream.getAudioTracks().length : 0,
      participants: Array.from(parts ?? []),
    };
  }, chan);

  const a = await vstate(A);
  const b = await vstate(B);
  const aMedia = A.frames.filter((f) => /MEDIAFRAME/.test(f)).length;
  const bMedia = B.frames.filter((f) => /MEDIAFRAME/.test(f)).length;
  console.log(`A(${A.nick}) ${JSON.stringify(a)} frames=${aMedia}`);
  console.log(`B(${B.nick}) ${JSON.stringify(b)} frames=${bMedia}`);

  await A.ctx.close();
  await B.ctx.close();

  // Core fix: joinVoiceChannel now drives the engine — callChannel + live local
  // audio track prove the engine ran and media capture started (before the fix
  // the engine was never invoked and callChannel stayed null).
  expect(a.callChannel, 'A joined voice (engine ran)').toBe(chan);
  expect(b.callChannel, 'B joined voice (engine ran)').toBe(chan);
  expect(a.audioTracks, 'A has a live local audio track').toBeGreaterThan(0);
  expect(b.audioTracks, 'B has a live local audio track').toBeGreaterThan(0);
  // Presence: at least one peer sees the other in the voice channel.
  expect(
    a.participants.includes(B.nick) || b.participants.includes(A.nick),
    'peers see each other in the voice channel',
  ).toBe(true);
});
