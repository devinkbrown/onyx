// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { normalizeCase, parseIRCMessage } from '../../src/lib/irc/parser';

test('Elm browser registers over the isolated local WSS listener', async ({ page, context, baseURL }) => {
  const localWs = process.env.ONYX_ELM_LAB_WS;
  if (!localWs || !baseURL) throw new Error('local_lab_endpoints_missing');
  const sent: string[] = [];
  const received: string[] = [];
  let opened = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.origin !== localWs.replace(/\/$/, '')) { socket.close(); return; }
    const upstream = socket.connectToServer();
    opened += 1;
    socket.onMessage(frame => {
      if (typeof frame === 'string' && !isPrivateAuthenticationFrame(frame)) sent.push(frame);
      upstream.send(frame);
    });
    upstream.onMessage(frame => {
      if (typeof frame === 'string' && !isPrivateAuthenticationFrame(frame)) received.push(frame);
      socket.send(frame);
    });
  });
  const nick = process.env.ONYX_ELM_LAB_NICK || 'ElmLabGuest';
  const room = '#elm-lab-guest';
  const parseFrames = (frames: string[]) => frames.map(parseIRCMessage);
  await page.goto(`/app/?ws=${encodeURIComponent(localWs)}&nick=${encodeURIComponent(nick)}&join=${encodeURIComponent(room)}`);
  await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => opened).toBeGreaterThan(0);
  await expect.poll(() => parseFrames(sent).some(message => message.command === 'CAP' && message.params[0] === 'LS')).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === '001')).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === '005')).toBe(true);
  await expect.poll(() => parseFrames(sent).some(message => message.command === 'CAP' && message.params[0] === 'END')).toBe(true);

  const sentMessages = parseFrames(sent);
  const capLsIndex = sentMessages.findIndex(message => message.command === 'CAP' && message.params[0] === 'LS');
  const nickIndex = sentMessages.findIndex(message => message.command === 'NICK');
  const userIndex = sentMessages.findIndex(message => message.command === 'USER');
  expect(capLsIndex).toBeGreaterThanOrEqual(0);
  expect(nickIndex).toBeGreaterThan(capLsIndex);
  expect(userIndex).toBeGreaterThan(capLsIndex);

  await expect.poll(() => parseFrames(sent).some(message => message.command === 'JOIN' && message.params[0] === room)).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === 'JOIN' && message.nick === nick && message.params[0] === room)).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === '366' && message.params[0] === nick && message.params[1] === room)).toBe(true);
  await page.locator('#client-rooms').getByRole('button', { name: new RegExp(room) }).click();
  await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toHaveAttribute('data-conversation', room);

  const canary = 'elm-lab-guest-send-canary';
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const isCanaryPrivmsg = (message: ReturnType<typeof parseIRCMessage>) =>
    message.command === 'PRIVMSG' && message.params[0] === room && message.params[1] === canary;
  await composer.fill(canary);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => parseFrames(sent).some(isCanaryPrivmsg)).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.nick === nick && isCanaryPrivmsg(message))).toBe(true);
  await expect(page.getByText(canary, { exact: true })).toBeVisible();
  expect(sent.every(frame => !frame.includes('\r') && !frame.includes('\n'))).toBe(true);
  // The server echo confirms the send: the row must stop saying "queued".
  const guestRow = page.locator('.onyx-message', { hasText: canary });
  await expect(guestRow.locator('.onyx-pending-note'), JSON.stringify({ sent: sent.filter(f => f.includes(canary)), echo: received.filter(f => f.includes(canary)) })).toHaveCount(0, { timeout: 10_000 });
});

test('Elm browser identifies a private account and sends an authenticated canary', async ({ page, context, baseURL }) => {
  const localWs = process.env.ONYX_ELM_LAB_WS;
  const account = process.env.ONYX_ELM_LAB_ACCOUNT;
  const password = process.env.ONYX_ELM_LAB_PASSWORD;
  if (!localWs || !baseURL || !account || !password) throw new Error('local_lab_endpoints_missing');
  const room = '#elm-lab-guest';
  const canary = 'elm-lab-auth-send-canary';
  const sent: string[] = [];
  const received: string[] = [];
  const parseFrames = (frames: string[]) => frames.map(parseIRCMessage);
  const intercepted = { echo: null as string | null, release: null as (() => void) | null };
  let opened = 0;
  let currentNick = 'ElmLabGuest';
  let caseMapping: string | null = null;
  let identifyCommandSent = false;
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== baseURL) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin !== localWs.replace(/\/$/u, '')) { socket.close(); return; }
    const upstream = socket.connectToServer();
    opened += 1;
    socket.onMessage(frame => {
      if (typeof frame === 'string') {
        const parsed = parseIRCMessage(frame);
        if (parsed.command === 'IDENTIFY' && parsed.params.length === 2) identifyCommandSent = true;
        if (!isPrivateAuthenticationFrame(frame)) sent.push(frame);
      }
      upstream.send(frame);
    });
    upstream.onMessage(frame => {
      if (typeof frame === 'string') {
        if (!isPrivateAuthenticationFrame(frame)) received.push(frame);
        const parsed = parseIRCMessage(frame);
        if (parsed.command === '001' && parsed.params[0]) currentNick = parsed.params[0];
        if (parsed.command === '005') {
          const advertised = parsed.params.find(value => value.startsWith('CASEMAPPING='))?.slice('CASEMAPPING='.length).toLowerCase();
          if (advertised) caseMapping = advertised;
        }
        if (parsed.command === 'NICK' && parsed.nick?.toLowerCase() === currentNick.toLowerCase() && parsed.params[0]) currentNick = parsed.params[0];
        if (parsed.command === 'PRIVMSG' && parsed.nick?.toLowerCase() === currentNick.toLowerCase() && parsed.params[0] === room && parsed.params[1] === canary) {
          intercepted.echo = frame;
          intercepted.release = () => socket.send(frame);
          return;
        }
      }
      socket.send(frame);
    });
  });

  await page.goto(`/app/?ws=${encodeURIComponent(localWs)}&nick=ElmLabGuest&join=${encodeURIComponent(room)}`);
  await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => opened).toBeGreaterThan(0);
  await expect.poll(() => parseFrames(received).some(message => message.command === '001')).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === '005')).toBe(true);
  if (!caseMapping || !['ascii', 'strict-rfc1459', 'rfc1459'].includes(caseMapping)) throw new Error('owner_scoped_outbox_admission_missing');
  await expect.poll(() => parseFrames(sent).some(message => message.command === 'JOIN' && message.params[0] === room)).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === 'JOIN' && message.params[0] === room)).toBe(true);
  await expect.poll(() => parseFrames(received).some(message => message.command === '366' && message.params[1] === room)).toBe(true);
  await page.getByTestId('connection-open').click();
  const dialog = page.getByTestId('connection-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.locator('#connection-account').fill(account);
  await dialog.locator('#connection-password').fill(password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect.poll(() => parseFrames(received).some(message => message.command === 'NOTICE' && message.params.at(-1) === `You are now identified as ${account}`)).toBe(true);
  await expect(dialog.getByText(`Signed in as ${account}.`, { exact: true })).toBeVisible();
  expect(identifyCommandSent).toBe(true);
  await dialog.getByRole('button', { name: 'Close connection dialog' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('#client-rooms').getByRole('button', { name: new RegExp(room) }).click();
  await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toHaveAttribute('data-conversation', room);

  const isCanaryPrivmsg = (message: ReturnType<typeof parseIRCMessage>) =>
    message.command === 'PRIVMSG' && message.params[0] === room && message.params[1] === canary;
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill(canary);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => parseFrames(sent).filter(isCanaryPrivmsg).length).toBe(1);
  await expect.poll(() => intercepted.echo !== null).toBe(true);

  const namespace = `custom:${new URL(localWs).origin}${new URL(localWs).pathname}`;
  const ownerKey = JSON.stringify([namespace, 'account', account.toLowerCase()]);
  if (!caseMapping || !['ascii', 'strict-rfc1459', 'rfc1459'].includes(caseMapping)) throw new Error('owner_scoped_outbox_admission_missing');
  const foldedRoom = normalizeCase(room, caseMapping);
  const targetKey = JSON.stringify([namespace, caseMapping, foldedRoom]);
  const admittedCanaryRows = () => page.evaluate(async ({ owner, target }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('onyx-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('owner_scoped_outbox_admission_missing'));
    });
    try {
      if (!db.objectStoreNames.contains('outbox_owned')) throw new Error('owner_scoped_outbox_admission_missing');
      const rows = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('outbox_owned', 'readonly');
        const store = tx.objectStore('outbox_owned');
        if (!store.indexNames.contains('by-owner')) throw new Error('owner_scoped_outbox_admission_missing');
        let matches = 0;
        const request = store.index('by-owner').openCursor(owner);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(matches); return; }
          const row = cursor.value as { operation?: unknown; targetKey?: unknown; state?: unknown };
          if (row.operation === 'privmsg' && row.targetKey === target && (row.state === 'transport-admitted' || row.state === 'delivery-unknown' || row.state === 'server-accepted')) matches += 1;
          cursor.continue();
        };
        request.onerror = () => reject(new Error('owner_scoped_outbox_admission_missing'));
      });
      return rows;
    } finally { db.close(); }
  }, { owner: ownerKey, target: targetKey });
  await expect.poll(admittedCanaryRows, { timeout: 12_000 }).toBeGreaterThan(0);
  expect(parseFrames(received).some(message => message.command === 'NOTICE' && message.params.at(-1) === `You are now identified as ${account}`)).toBe(true);
  expect(intercepted.echo).not.toBeNull();
  intercepted.release?.();
  if (intercepted.echo) {
    const authEcho = parseIRCMessage(intercepted.echo);
    expect(authEcho.nick?.toLowerCase()).toBe(currentNick.toLowerCase());
    expect(isCanaryPrivmsg(authEcho)).toBe(true);
  }
  await expect(page.getByText(canary, { exact: true })).toBeVisible();
  // Once the held echo is released, the signed-in row must stop saying "queued".
  const authRow = page.locator('.onyx-message', { hasText: canary });
  await expect(authRow.locator('.onyx-pending-note'), JSON.stringify({ sent: sent.filter(f => f.includes(canary)), echo: intercepted.echo })).toHaveCount(0, { timeout: 10_000 });
});

function isPrivateAuthenticationFrame(frame: string): boolean {
  const command = parseIRCMessage(frame).command;
  return command === 'IDENTIFY' || command === 'AUTHENTICATE';
}

test('the local server terminates a client binary WebSocket frame', async ({ page, context, baseURL }) => {
  const localWs = process.env.ONYX_ELM_LAB_WS;
  if (!localWs || !baseURL) throw new Error('local_lab_endpoints_missing');
  let didCloseResolve: (() => void) | undefined;
  let closed = false;
  const didClose = new Promise<void>(resolve => { didCloseResolve = resolve; });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== baseURL) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.origin !== localWs.replace(/\/$/, '')) { socket.close(); return; }
    const upstream = socket.connectToServer();
    upstream.onClose(() => { closed = true; didCloseResolve?.(); });
    socket.onMessage(frame => {
      if (typeof frame === 'string' && frame.startsWith('CAP LS')) upstream.send(Buffer.from([0x00, 0xff, 0x10]));
      upstream.send(frame);
    });
    upstream.onMessage(frame => socket.send(frame));
  });
  await page.goto(`/app/?ws=${encodeURIComponent(localWs)}&nick=ElmLabBinary`);
  await Promise.race([didClose, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('binary_frame_not_terminated')), 12_000))]);
  expect(closed).toBe(true);
});
