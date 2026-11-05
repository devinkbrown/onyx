// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * v3/connect-gate: a visit to /app without a pinned ?nick= meets the gate
 * before the shell. Every choice runs on the live guest socket through the
 * existing flows (confirmed NICK, runtime IDENTIFY, guest-claim hand-off),
 * against a mock wire only.
 */
const MOCK_WS = 'wss://connect-gate.test/ws';

type Wire = { sent: string[]; socket: () => WebSocketRoute | null };

async function mockWire(page: Page): Promise<Wire> {
  const sent: string[] = [];
  let current: WebSocketRoute | null = null;
  await page.routeWebSocket(MOCK_WS, socket => {
    current = socket;
    let nick = 'guest';
    let registered = false;
    socket.onMessage(message => {
      const line = String(message).trim();
      sent.push(line);
      if (line.startsWith('NICK ')) {
        const next = line.slice(5).trim();
        if (registered && next === 'taken') socket.send(`:server 433 ${nick} taken :Nickname is already in use`);
        else if (registered) { socket.send(`:${nick}!u@h NICK ${next}`); nick = next; }
        else nick = next;
      }
      if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :');
      if (line === 'CAP END') {
        registered = true;
        socket.send(`:server 001 ${nick} :Welcome`);
        socket.send(`:server 005 ${nick} CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ CHANTYPES=#& :supported`);
      }
      if (line === 'JOIN #lounge') {
        socket.send(`:${nick}!u@h JOIN #lounge`);
        socket.send(`:server 353 ${nick} = #lounge :${nick} alice`);
        socket.send(`:server 366 ${nick} #lounge :End of names`);
        socket.send(':alice!u@h PRIVMSG #lounge :Welcome to the lounge.');
      }
    });
  });
  return { sent, socket: () => current };
}

for (const width of [320, 390, 1280]) {
  test(`guest gate picks a name and a room, then opens the shell at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 568 : 800 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const wire = await mockWire(page);
    await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}`);

    const gate = page.getByTestId('connect');
    await expect(gate).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Join Onyx', level: 1 })).toBeVisible();
    await expect(page.locator('.onyx-shell')).toHaveCount(0);
    await expect(page.getByTestId('connect-status')).toContainText('Connected');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const box of await gate.locator('button, input').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await page.getByLabel('Display name').fill('kai');
    await page.getByLabel('Room').fill('lounge');
    await page.getByTestId('connect-submit').click();
    await expect.poll(() => wire.sent).toContain('NICK kai');
    await expect.poll(() => wire.sent).toContain('JOIN #lounge');
    await expect(gate).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toHaveAttribute('data-conversation', '#lounge');
    await expect(page.getByText('Welcome to the lounge.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // The connection dialog stays reachable for status and reconnect.
    await page.getByTestId('connection-open').click();
    await expect(page.getByRole('dialog', { name: 'Your connection' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('a taken name keeps the gate up with the refusal, then a free name passes', async ({ page }) => {
  const wire = await mockWire(page);
  await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}`);
  await expect(page.getByTestId('connect-status')).toContainText('Connected');
  await page.getByLabel('Display name').fill('taken');
  await page.getByLabel('Display name').press('Enter');
  await expect(page.getByRole('alert')).toContainText('already in use');
  await expect(page.getByTestId('connect')).toBeVisible();
  await page.getByLabel('Display name').fill('freshname');
  await page.getByLabel('Display name').press('Enter');
  await expect(page.getByTestId('connect')).toHaveCount(0);
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.locator('#home-title')).toBeFocused();
  expect(wire.sent.filter(line => line.startsWith('NICK '))).toEqual(['NICK guest', 'NICK taken', 'NICK freshname']);
});

test('sign in hands the DOM-owned password to the runtime and clears it', async ({ page }) => {
  const wire = await mockWire(page);
  await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}`);
  await expect(page.getByTestId('connect-status')).toContainText('Connected');
  await page.getByTestId('connect-mode-signin').click();
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Account name')).toBeFocused();
  await page.keyboard.type('alice');
  await page.getByLabel('Password').fill('fixture-secret-1');
  await page.getByLabel('Password').press('Enter');
  await expect.poll(() => wire.sent).toContain('IDENTIFY alice fixture-secret-1');
  await expect(page.locator('#connection-password')).toHaveValue('');
  await expect(page.getByTestId('connect-submit')).toHaveText('Signing in…');
  expect(await page.locator('#app').evaluate(element => element.innerHTML.includes('fixture-secret-1'))).toBe(false);
  // The account landing retires the gate.
  wire.socket()!.send(':server 900 guest guest!u@h alice :You are now logged in as alice');
  await expect(page.getByTestId('connect')).toHaveCount(0);
  await expect(page.locator('.onyx-shell')).toBeVisible();
});

test('create account confirms the name, then opens the private claim flow', async ({ page }) => {
  const wire = await mockWire(page);
  await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}`);
  await expect(page.getByTestId('connect-status')).toContainText('Connected');
  await page.getByTestId('connect-mode-register').click();
  await expect(page.getByTestId('connect').locator('input[type="password"]')).toHaveCount(0);
  await page.getByLabel('Account name').fill('kai');
  await page.getByTestId('connect-submit').click();
  await expect.poll(() => wire.sent).toContain('NICK kai');
  await expect(page.getByTestId('connect')).toHaveCount(0);
  await expect(page.getByTestId('guest-claim-sheet')).toBeVisible();
  expect(wire.sent.some(line => /^(REGISTER|IDENTIFY|PASS) /u.test(line))).toBe(false);
});

test('look around first opens Home without changing the name', async ({ page }) => {
  const wire = await mockWire(page);
  await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}`);
  await page.getByTestId('connect-skip').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.locator('#home-title')).toBeFocused();
  expect(wire.sent.filter(line => line.startsWith('NICK '))).toEqual(['NICK guest']);
});

test('a pinned ?nick= skips the gate', async ({ page }) => {
  await mockWire(page);
  await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}&nick=pinned`);
  await expect(page.locator('.onyx-shell')).toBeVisible();
  await expect(page.getByTestId('connect')).toHaveCount(0);
});
