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
    await page.goto('/app/?ws=wss%3A%2F%2Fmobile-layout.test%2Fws&nick=guest');
    const phone = width < 768;
    // v3/shell-nav: phones get the bottom bar (Home · Rooms · Messages ·
    // Calls · You); wider screens the icon rail plus the collection sidebar.
    const nav = page.locator(phone ? '.onyx-mobile-nav' : '.onyx-primary-nav');
    await expect(nav).toBeVisible();
    await expect(page.locator(phone ? '.onyx-primary-nav' : '.onyx-mobile-nav')).toBeHidden();
    const rooms = nav.getByTestId('nav-rooms');
    await expect(nav.getByTestId('nav-home')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('home')).toBeVisible();
    if (phone) {
      await expect(rooms).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#client-rooms')).toBeHidden();
      for (const box of await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect()))) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(page.locator('#client-members')).toBeHidden();
    await rooms.click();
    await expect(rooms).toHaveAttribute('aria-current', 'page');
    if (phone) await expect(rooms).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#client-rooms')).toBeVisible();
    await page.locator('#client-rooms').getByRole('button', { name: /#mobile/ }).click();
    const back = page.getByTestId('room-back');
    if (phone) {
      await expect(page.locator('#client-rooms')).toBeHidden();
      await expect(rooms).toHaveAttribute('aria-expanded', 'false');
      await expect(back).toHaveAccessibleName('Back to Rooms');
    } else {
      await expect(page.locator('#client-rooms')).toBeVisible();
      await expect(back).toBeHidden();
    }
    const members = page.getByRole('button', { name: 'Members', exact: true });
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.getByText('A message that should remain readable on a phone.')).toBeInViewport();
    const connectionOpen = page.getByTestId('connection-open');
    await expect(connectionOpen).toHaveAccessibleName(/^Connection\./);
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
    if (phone) await expect(page.locator('#client-rooms')).toBeHidden();
    await expect(page.locator('.onyx-thread-pane')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#client-members')).toBeHidden();
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      composerBottom: document.querySelector('.onyx-composer')!.getBoundingClientRect().bottom,
      height: innerHeight,
      threadRight: document.querySelector('.onyx-thread-pane')!.getBoundingClientRect().right,
      threadWidth: document.querySelector('.onyx-thread-pane')!.getBoundingClientRect().width,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.height);
    if (phone) expect(geometry.threadWidth).toBe(geometry.width);
    else expect(geometry.threadRight).toBe(geometry.width);
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
    // UI slice 2: under 768px the room header folds Pins and Media behind
    // "More conversation tools" (the menu stays open, so focus can return
    // to the tool after its dialog closes).
    const moreTools = page.getByRole('button', { name: 'More conversation tools', exact: true });
    if (phone) {
      await moreTools.click();
      await expect(moreTools).toHaveAttribute('aria-expanded', 'true');
    } else {
      await expect(moreTools).toBeHidden();
    }
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
    // You: a dialog that never becomes the location; full screen on phones.
    const you = nav.getByTestId('nav-you');
    await you.click();
    const youDialog = page.getByRole('dialog', { name: 'You', exact: true });
    await expect(youDialog).toBeFocused();
    await expect(you).toHaveAttribute('aria-expanded', 'true');
    if (phone) {
      const box = (await youDialog.boundingBox())!;
      expect(box.width).toBe(width);
    }
    await page.keyboard.press('Escape');
    await expect(youDialog).toBeHidden();
    await expect(you).toBeFocused();
    await expect(rooms).toHaveAttribute('aria-current', 'page');
    if (phone) {
      await back.click();
      await expect(page.locator('#client-rooms')).toBeVisible();
      await expect(page.locator('#client-rooms')).toBeFocused();
    }
    await nav.getByTestId('nav-calls').click();
    await expect(page.locator('.onyx-main-calls')).toBeVisible();
    await expect(nav.getByTestId('nav-calls')).toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });
}

test('desktop client retains both sidebars beside the icon rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.routeWebSocket('wss://mobile-layout.test/ws', socket => {
    let nick = 'guest';
    socket.onMessage(message => {
      const line = String(message).trim();
      if (line.startsWith('NICK ')) nick = line.slice(5).trim();
      if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :');
      if (line === 'CAP END') {
        socket.send(`:server 001 ${nick} :Welcome`);
        socket.send(`:${nick}!u@h JOIN #mobile`);
      }
    });
  });
  await page.goto('/app/?ws=wss%3A%2F%2Fmobile-layout.test%2Fws&nick=guest');
  await expect(page.locator('.onyx-primary-nav')).toBeVisible();
  await expect(page.locator('#client-rooms')).toBeVisible();
  await page.locator('#client-rooms').getByRole('button', { name: /#mobile/ }).click();
  await expect(page.locator('#client-rooms')).toBeVisible();
  await expect(page.locator('#client-members')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Members', exact: true })).toBeHidden();
  const navWidth = await page.locator('.onyx-primary-nav').evaluate(element => element.getBoundingClientRect().width);
  const railWidth = await page.locator('#client-rooms').evaluate(element => element.getBoundingClientRect().width);
  expect(navWidth).toBe(56);
  expect(railWidth).toBe(280);
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
  await page.goto('/app/?ws=wss%3A%2F%2Fjoin-layout.test%2Fws&nick=guest');
  await page.locator('.onyx-mobile-nav').getByTestId('nav-rooms').click();
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
