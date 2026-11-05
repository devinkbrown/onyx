// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768]) {
  test(`client fits ${width}px and mobile navigation keeps chat usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text());
    });
    // A deterministic wire fixture exercises joined-room layout without a
    // backend or sending test messages to the public network.
    const sentMessages: string[] = [];
    await page.routeWebSocket('wss://mobile-layout.test/ws', socket => {
      let nick = 'guest';
      socket.onMessage(message => {
        const line = String(message).trim();
        if (line.startsWith('PRIVMSG ')) sentMessages.push(line);
        if (line.startsWith('NICK ')) nick = line.slice(5).trim();
        if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :');
        if (line === 'CAP END') {
          socket.send(`:server 001 ${nick} :Welcome`);
          socket.send(`:server 005 ${nick} CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ CHANTYPES=#& STATUSMSG=!.@+ :supported`);
          socket.send(`:${nick}!u@h JOIN #mobile`);
        }
        if (line === 'MODE #mobile') socket.send(`:server 324 ${nick} #mobile +nt`);
        if (line === 'PROP #mobile') socket.send(`:server 819 ${nick} #mobile :End of properties`);
        if (line === 'NAMES #mobile') {
          socket.send(`:server 353 ${nick} = #mobile :${nick} alice bob`);
          socket.send(`:server 366 ${nick} #mobile :End of names`);
          socket.send(':alice!u@h PRIVMSG #mobile :A message that should remain readable on a phone.');
        }
      });
    });
    await page.goto('/app/?ws=wss%3A%2F%2Fmobile-layout.test%2Fws');
    const rooms = page.getByRole('button', { name: 'Rooms', exact: true });
    const members = page.getByRole('button', { name: 'Members', exact: true });
    await expect(rooms).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#client-rooms')).toBeHidden();
    await expect(page.locator('#client-members')).toBeHidden();
    await rooms.click();
    await expect(page.locator('#client-rooms')).toBeVisible();
    await page.locator('#client-rooms').getByRole('button', { name: /#mobile/ }).click();
    await expect(rooms).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#client-rooms')).toBeHidden();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.getByText('A message that should remain readable on a phone.')).toBeInViewport();
    const connectionOpen = page.getByTestId('connection-open');
    await expect(connectionOpen).toHaveAccessibleName(/^Connect\./);
    await connectionOpen.click();
    const connection = page.getByRole('dialog', { name: 'Your connection' });
    await expect(connection).toBeFocused();
    await expect(connection).toBeInViewport();
    await connection.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#connection-password').fill('never-retain-this');
    await connection.getByRole('button', { name: 'Chat name', exact: true }).click();
    await expect(page.locator('#connection-password')).toHaveCount(0);
    await connection.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#connection-password')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(connection).toBeHidden();
    await expect(connectionOpen).toBeFocused();
    await page.getByLabel('Message', { exact: true }).fill('A mobile reply');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => sentMessages).toContain('PRIVMSG #mobile :A mobile reply');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await members.click();
    await expect(page.locator('#client-members')).toBeVisible();
    await expect(page.locator('#client-rooms')).toBeHidden();
    await expect(page.locator('.onyx-thread-pane')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#client-members')).toBeHidden();
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      composerBottom: document.querySelector('.onyx-composer')!.getBoundingClientRect().bottom,
      height: innerHeight,
      threadWidth: document.querySelector('.onyx-thread-pane')!.getBoundingClientRect().width,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.threadWidth).toBe(geometry.width);
    expect(await page.locator('.onyx-attachments').evaluate(element => Math.abs(element.getBoundingClientRect().top - document.querySelector('.onyx-schedule')!.getBoundingClientRect().top))).toBeLessThan(2);
    await page.setViewportSize({ width, height: 568 });
    await expect.poll(() => page.locator('.onyx-composer').evaluate(element => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(568);
    await expect(page.getByText('A message that should remain readable on a phone.')).toBeInViewport();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('search', { name: 'Message search', exact: true })).toBeInViewport();
    await page.getByRole('searchbox', { name: 'Search messages' }).fill('message');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('search', { name: 'Message search', exact: true })).toBeHidden();
    await page.getByTestId('ribbon-pins').click();
    await expect(page.getByRole('dialog', { name: 'Pinned messages', exact: true })).toBeInViewport();
    await expect(page.getByRole('dialog', { name: 'Pinned messages', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Pinned messages', exact: true })).toBeHidden();
    await expect(page.getByTestId('ribbon-pins')).toBeFocused();
    await page.getByTestId('ribbon-room-media').click();
    await expect(page.getByRole('dialog', { name: 'Pictures, files, and links', exact: true })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Pictures, files, and links', exact: true })).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('mobile-client.png') });
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Notification inbox' })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Notification inbox' })).toBeHidden();
    await page.getByRole('button', { name: 'Calls', exact: true }).click();
    await expect(page.locator('.onyx-main-calls')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('desktop client retains both sidebars', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?ws=wss%3A%2F%2Fmobile-layout.test%2Fws');
  await expect(page.locator('#client-rooms')).toBeVisible();
  await expect(page.locator('#client-members')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeHidden();
});


test('confirmed browser join opens the conversation without a second selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.routeWebSocket('wss://join-layout.test/ws', socket => {
    let nick = 'guest';
    socket.onMessage(message => {
      const line = String(message).trim();
      if (line.startsWith('NICK ')) nick = line.slice(5);
      if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :');
      if (line === 'CAP END') socket.send(`:server 001 ${nick} :Welcome`);
      if (line === 'LIST') {
        socket.send(`:server 321 ${nick} Channel :Users Name`);
        socket.send(`:server 322 ${nick} #root 3 :A welcoming room`);
        socket.send(`:server 323 ${nick} :End of list`);
      }
      if (line === 'JOIN #root') {
        socket.send(`:${nick}!u@h JOIN #root`);
        socket.send(`:server 353 ${nick} = #root :${nick} alice bob`);
        socket.send(`:server 366 ${nick} #root :End of names`);
        for (let index = 0; index < 180; index++) {
          socket.send(`:alice!u@h PRIVMSG #root :Buffered message ${index} with readable conversation text.`);
        }
        socket.send(':alice!u@h PRIVMSG #root :Welcome to the room.');
      }
    });
  });
  await page.goto('/app/?ws=wss%3A%2F%2Fjoin-layout.test%2Fws');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.locator('#client-rooms').getByRole('button', { name: 'Browse rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Join #root', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.getByText('Welcome to the room.', { exact: true })).toBeInViewport();
  await expect(page.locator('#client-rooms')).toBeHidden();
  const earlier = page.getByRole('button', { name: /Show earlier messages/ });
  await expect(earlier).toBeVisible();
  await earlier.click();
  await expect(page.getByText('Buffered message 0 with readable conversation text.', { exact: true })).toBeVisible();
  await page.getByText('Welcome to the room.', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('Welcome to the room.', { exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(page.locator('.onyx-member')).toHaveCount(3);
});
