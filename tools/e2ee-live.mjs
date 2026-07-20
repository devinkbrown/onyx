// E2EE DM live check — two registered browser contexts join the same room,
// open a DM through the authoritative member list, and verify both delivery
// and ciphertext-only transport.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const errors = [];
const secret = `lowtide-${Date.now()}`;

async function registeredUser(prefix, captureSent = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const sentFrames = [];
  page.on('pageerror', (error) => errors.push(`${prefix}: ${String(error).slice(0, 160)}`));
  if (captureSent) {
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => {
        if (typeof frame.payload === 'string') sentFrames.push(frame.payload);
      });
    });
  }

  await page.goto('https://eshmaki.me/app/', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Register/i }).click();
  const nick = `${prefix}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 99)}`;
  const password = 'E2eeLive!12345';
  await page.getByPlaceholder('your-nick').fill(nick);
  await page.getByPlaceholder('at least 8 characters').fill(password);
  await page.getByPlaceholder('re-enter your password').fill(password);
  const submit = page.getByRole('button', { name: 'Register a new account' });
  for (let attempt = 0; attempt < 80 && await submit.isDisabled(); attempt += 1) {
    await page.waitForTimeout(250);
  }
  if (await submit.isDisabled()) throw new Error(`${prefix}: registration never became available`);
  await submit.click();
  await page.getByText('CONNECTION: CONNECTED').first().waitFor({ timeout: 40_000 });

  const join = page.getByRole('textbox', { name: 'Channel name to join' });
  await join.fill('#root');
  await join.press('Enter');
  await page.getByRole('region', { name: 'Channel members in #root' }).waitFor({ timeout: 30_000 });
  return { context, page, nick, sentFrames };
}

let alice;
let bob;
let exitCode = 1;
try {
  // Bob joins first so Alice's initial authoritative roster contains him.
  bob = await registeredUser('bobe2');
  alice = await registeredUser('alicee2', true);

  const bobMember = alice.page.getByRole('button', {
    name: new RegExp(`Open member details for ${bob.nick}`, 'i'),
  });
  await bobMember.waitFor({ timeout: 30_000 });
  await bobMember.click();
  await alice.page.getByRole('button', { name: `Send DM to ${bob.nick}` }).click();

  const aliceComposer = alice.page.locator('.shell-composer-textarea');
  await aliceComposer.waitFor({ timeout: 10_000 });
  await alice.page.waitForTimeout(4_000); // peer key METADATA round-trip
  await aliceComposer.fill(secret);
  await aliceComposer.press('Enter');
  await alice.page.waitForTimeout(6_000);

  const bobDm = bob.page.getByRole('button', {
    name: new RegExp(`DM with ${alice.nick}`, 'i'),
  });
  await bobDm.waitFor({ timeout: 30_000 });
  await bobDm.click();
  await bob.page.waitForTimeout(3_000);

  const aliceFeed = await alice.page.locator('.shell-feed').textContent().catch(() => '');
  const bobFeed = await bob.page.locator('.shell-feed').textContent().catch(() => '');
  const dmFrames = alice.sentFrames.filter((frame) => frame.includes(`PRIVMSG ${bob.nick}`));
  const aliceShowsPlain = aliceFeed?.includes(secret) ?? false;
  const bobShowsPlain = bobFeed?.includes(secret) ?? false;
  const wireSawEnvelope = dmFrames.some((frame) => frame.includes('TSUMUGI1'));
  const wireLeaked = dmFrames.some((frame) => frame.includes(secret));

  console.log('alice feed shows plaintext:', aliceShowsPlain);
  console.log('bob feed shows plaintext:  ', bobShowsPlain);
  console.log('alice DM frames:', dmFrames.map((frame) => frame.slice(0, 100)));
  console.log('wire carried envelope:     ', wireSawEnvelope);
  console.log('wire leaked plaintext:     ', wireLeaked);
  console.log('page errors:', errors.length ? errors : 'none');

  const pass = aliceShowsPlain
    && bobShowsPlain
    && wireSawEnvelope
    && !wireLeaked
    && errors.length === 0;
  console.log(pass ? 'E2EE LIVE: PASS' : 'E2EE LIVE: FAIL');
  exitCode = pass ? 0 : 1;
} catch (error) {
  console.error('E2EE LIVE: ERROR', error);
} finally {
  await alice?.context.close();
  await bob?.context.close();
  await browser.close();
}

process.exit(exitCode);
