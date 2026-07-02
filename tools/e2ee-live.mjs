// E2EE DM live check — two browser contexts (Alice, Bob), each registered.
// Alice DMs Bob; verify (1) Bob's app shows the plaintext, (2) a raw WS
// observer NEVER sees the plaintext on the wire (only the TSUMUGI envelope).
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const errs = [];

const secret = 'lowtide-' + Math.floor(Math.random() * 99999);
const aliceFramesSent = [];

async function user(name, captureSent) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${name}: ${String(e).slice(0, 160)}`));
  if (captureSent) {
    page.on('websocket', (wsock) => {
      wsock.on('framesent', (f) => { if (typeof f.payload === 'string') captureSent.push(f.payload); });
    });
  }
  await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  const nick = name + Math.floor(Math.random() * 9999);
  await page.locator('input').first().fill(nick);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(7000);
  return { ctx, page, nick };
}

const alice = await user('alice', aliceFramesSent);
const bob = await user('bob');

// Prod build hides the store handle — drive through the UI. Alice opens a DM
// to Bob (join field accepts a nick), which fetches Bob's ocean.dm-key; Bob's
// inbound handler fetches Alice's on receipt.
const joinField = (page) => page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first();
await joinField(alice.page).fill(bob.nick);
await alice.page.keyboard.press('Enter');
await alice.page.waitForTimeout(3000); // let the METADATA GET round-trip

const composer = (page) => page.locator('.shell-composer-textarea');
await composer(alice.page).fill(secret);
await alice.page.keyboard.press('Enter');
await alice.page.waitForTimeout(6000);

// Bob's feed must show the plaintext; his DM opens from a notification/sidebar.
await joinField(bob.page).fill(alice.nick);
await bob.page.keyboard.press('Enter');
await bob.page.waitForTimeout(3000);

const aliceShowsPlain = (await alice.page.textContent('.shell-feed').catch(() => '') ?? '').includes(secret);
const bobShowsPlain = (await bob.page.textContent('.shell-feed').catch(() => '') ?? '').includes(secret);
const bobShowsLocked = (await bob.page.locator('.shell-msg-text--locked').count()) > 0;

// What did Alice actually put on the wire for this DM?
const dmFrames = aliceFramesSent.filter((f) => f.includes(`PRIVMSG ${bob.nick}`));
const wireSawEnvelope = dmFrames.some((f) => f.includes('TSUMUGI1'));
const wireLeaked = dmFrames.some((f) => f.includes(secret));

console.log('alice feed shows plaintext:', aliceShowsPlain);
console.log('bob feed shows plaintext:  ', bobShowsPlain, bobShowsLocked ? '(LOCKED)' : '');
console.log('alice DM frames:', dmFrames.map((f) => f.slice(0, 80)));
console.log('wire carried envelope:     ', wireSawEnvelope);
console.log('wire leaked plaintext:     ', wireLeaked);
console.log('page errors:', errs.length ? errs : 'none');

const pass = aliceShowsPlain && bobShowsPlain && wireSawEnvelope && !wireLeaked && errs.length === 0;
console.log(pass ? 'E2EE LIVE: PASS' : 'E2EE LIVE: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
