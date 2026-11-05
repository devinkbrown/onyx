// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`network history and latest navigation work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const sent: string[] = [];
    await page.routeWebSocket('wss://history-ui.test/ws', socket => {
      let nick = 'guest';
      let batch = 0;
      const history = (start: number, end: number) => {
        const ref = `history${++batch}`;
        socket.send(`:server BATCH +${ref} chathistory #history`);
        for (let index = start; index <= end; index++) {
          const stamp = new Date(Date.UTC(2026, 9, 9, 10, 0, index)).toISOString();
          socket.send(`@batch=${ref};time=${stamp};msgid=m${index} :alice!u@h PRIVMSG #history :History message ${index}`);
        }
        socket.send(`:server BATCH -${ref}`);
      };
      socket.onMessage(message => {
        const line = String(message).trim();
        sent.push(line);
        if (line.startsWith('NICK ')) nick = line.slice(5);
        if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :batch server-time chathistory');
        if (line.startsWith('CAP REQ ')) socket.send(`:server CAP ${nick} ACK ${line.slice(8)}`);
        const whoisMatch = line.match(/^WHOIS (\S+)(?: (\S+))?$/);
        const queriedNick = whoisMatch?.[2] ?? whoisMatch?.[1];
        if (queriedNick) {
          if (queriedNick.toLowerCase() === nick.toLowerCase()) {
            socket.send(`:server 311 ${nick} ${queriedNick} u h * :Guest user`);
          } else if (queriedNick.toLowerCase() === 'alice') {
            socket.send(`:server 311 ${nick} ${queriedNick} u h * :Alice`);
          } else {
            socket.send(`:server 401 ${nick} ${queriedNick} :No such nick`);
          }
          socket.send(`:server 318 ${nick} ${queriedNick} :End of /WHOIS list`);
        }
        if (line === 'CAP END') {
          socket.send(`:server 001 ${nick} :Welcome`);
          socket.send(`:server 005 ${nick} CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ CHANTYPES=#& STATUSMSG=!.@+ :supported`);
          socket.send(`:${nick}!u@h JOIN #history`);
        }
        if (line === 'MODE #history') socket.send(`:server 324 ${nick} #history +nt`);
        if (line === 'PROP #history') socket.send(`:server 819 ${nick} #history :End of properties`);
        if (line === 'NAMES #history') {
          socket.send(`:server 353 ${nick} = #history :${nick} alice`);
          socket.send(`:server 366 ${nick} #history :End of names`);
        }
        if (line.startsWith('CHATHISTORY LATEST #history')) history(150, 199);
        if (line.startsWith('CHATHISTORY BEFORE #history')) history(120, 149);
      });
    });
    await page.goto('/app/?ws=wss%3A%2F%2Fhistory-ui.test%2Fws');
    if (width < 960) await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.locator('#client-rooms').getByRole('button', { name: /#history/ }).click();
    await expect(page.getByText('History message 199', { exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Load older messages from the network' }).click();
    await expect.poll(() => sent.some(line => line.startsWith('CHATHISTORY BEFORE #history msgid=m150'))).toBe(true);
    await expect(page.getByText('History message 120', { exact: true })).toBeVisible();
    await expect(page.getByTestId('channel-intro')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load older messages from the network' })).toHaveCount(0);
  });
}

test('chat-name changes stay pending until confirmation and recover from rejection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  let confirm: ((line: string) => void) | undefined;
  let nick = 'guest';
  await page.routeWebSocket('wss://identity-ui.test/ws', socket => {
    confirm = line => socket.send(line);
    socket.onMessage(message => {
      const line = String(message).trim();
      if (line.startsWith('NICK ') && line !== 'NICK taken' && line !== 'NICK freshname') nick = line.slice(5);
      if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :');
      if (line === 'CAP END') socket.send(`:server 001 ${nick} :Welcome`);
      if (line === 'NICK taken') socket.send(`:server 433 ${nick} taken :Nickname in use`);
    });
  });
  await page.goto('/app/?ws=wss%3A%2F%2Fidentity-ui.test%2Fws');
  await expect(page.locator('.onyx-conn-live')).toBeVisible();
  const connectionOpen = page.getByTestId('connection-open');
  await expect(connectionOpen).toHaveAccessibleName(/^Connect\./);
  await connectionOpen.click();
  await page.locator('#connection-nick').fill('taken');
  await page.getByRole('button', { name: 'Use this name', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already in use');
  await page.locator('#connection-nick').fill('freshname');
  await page.getByRole('button', { name: 'Use this name', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Waiting for confirmation…' })).toBeDisabled();
  await expect(page.locator('.onyx-connect-facts')).toContainText(nick);
  confirm!(`:${nick}!u@h NICK :freshname`);
  await expect(page.locator('.onyx-connect-success')).toHaveText('Your chat name is now freshname.');
  await expect(page.locator('.onyx-connect-facts')).toContainText('freshname');
});


for (const width of [390, 1280]) {
  test(`live messages follow the tail without moving an earlier reader at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    let inject: ((index: number) => void) | undefined;
    await page.routeWebSocket('wss://reading-ui.test/ws', socket => {
      let nick = 'guest';
      inject = index => socket.send(`:alice!u@h PRIVMSG #reading :Reading fixture message ${index} with enough text to wrap comfortably.`);
      socket.onMessage(message => {
        const line = String(message).trim();
        if (line.startsWith('NICK ')) nick = line.slice(5);
        if (line.startsWith('CAP LS')) socket.send(':server CAP * LS :');
        const whoisMatch = line.match(/^WHOIS (\S+)(?: (\S+))?$/);
        const queriedNick = whoisMatch?.[2] ?? whoisMatch?.[1];
        if (queriedNick) {
          if (queriedNick.toLowerCase() === nick.toLowerCase()) {
            socket.send(`:server 311 ${nick} ${queriedNick} u h * :Guest user`);
          } else if (queriedNick.toLowerCase() === 'alice') {
            socket.send(`:server 311 ${nick} ${queriedNick} u h * :Alice`);
          } else {
            socket.send(`:server 401 ${nick} ${queriedNick} :No such nick`);
          }
          socket.send(`:server 318 ${nick} ${queriedNick} :End of /WHOIS list`);
        }
        if (line === 'CAP END') {
          socket.send(`:server 001 ${nick} :Welcome`);
          socket.send(`:server 005 ${nick} CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ CHANTYPES=#& STATUSMSG=!.@+ :supported`);
          socket.send(`:${nick}!u@h JOIN #reading`);
        }
        if (line === 'MODE #reading') socket.send(`:server 324 ${nick} #reading +nt`);
        if (line === 'PROP #reading') socket.send(`:server 819 ${nick} #reading :End of properties`);
        if (line === 'NAMES #reading') {
          socket.send(`:server 353 ${nick} = #reading :${nick} alice`);
          socket.send(`:server 366 ${nick} #reading :End of names`);
        }
      });
    });
    await page.goto('/app/?ws=wss%3A%2F%2Freading-ui.test%2Fws');
    if (width < 960) await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.locator('#client-rooms').getByRole('button', { name: /#reading/ }).click();
    for (let index = 0; index < 200; index++) inject!(index);
    const row = (index: number) => page.getByText(`Reading fixture message ${index} with enough text to wrap comfortably.`, { exact: true });
    await expect(row(199)).toBeInViewport();
    await row(120).scrollIntoViewIfNeeded();
    await expect(page.locator('.onyx-reading-bar')).toBeVisible();
    inject!(200);
    await expect(row(200)).toBeVisible();
    await expect(row(120)).toBeInViewport();
    await expect(row(200)).not.toBeInViewport();
    await page.locator('.onyx-reading-bar').getByRole('button', { name: 'Back to latest' }).click();
    await expect(row(200)).toBeInViewport();
    await expect(page.locator('.onyx-reading-bar')).toHaveCount(0);
    for (let index = 201; index < 400; index++) inject!(index);
    await expect(row(399)).toBeInViewport();
    const earlier = page.getByRole('button', { name: /Show earlier messages/ });
    await earlier.click();
    await earlier.click();
    await expect(row(1)).toBeVisible();
    await page.getByLabel('Message', { exact: true }).fill('Sent from an earlier reading window');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('Sent from an earlier reading window', { exact: true })).toBeInViewport();
    await expect(page.locator('.onyx-reading-bar')).toHaveCount(0);
  });
}
