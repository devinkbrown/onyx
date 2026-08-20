import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { RawIrcActor } from './support/rawIrcActor';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 640 },
  { name: 'landscape-phone', width: 844, height: 390 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'zoom-320', width: 320, height: 256, highZoom: true },
] as const;

const NEED_ROOMS = Array.from({ length: 8 }, (_, index) => `#need${index}`);

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error
        ? reject(error)
        : resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function portOpen(port: number): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', reject);
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, child?: ChildProcess): Promise<void> {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (child && child.exitCode !== null) throw new Error(`local Onyx server exited (${child.exitCode}) before listen`);
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('local Onyx server did not listen before timeout');
}

type LocalMesh = {
  wsUrl: string;
  ircPort: number;
  start(): Promise<void>;
  stop(): Promise<void>;
};

async function createRestartableServer(workRoot: string): Promise<LocalMesh> {
  const ircPort = await freePort();
  const wsPort = await freePort();
  await mkdir(workRoot, { recursive: true });
  const config = join(workRoot, 'onyx-server.toml');
  await writeFile(config, `[node]\nid = 1\n[network]\nname = "Onyx Home"\nserver_name = "127.0.0.1"\n[listen]\nhost = "127.0.0.1"\nirc = ${ircPort}\nws = ${wsPort}\nws_plain = true\n[sasl]\nenabled = true\naccount_db = "${join(workRoot, 'accounts.db')}"\n[limits]\nnum_shards = 1\n`, { mode: 0o600 });
  let child: ChildProcess | undefined;
  return {
    wsUrl: `ws://127.0.0.1:${wsPort}`,
    ircPort,
    async start() {
      if (await portOpen(wsPort) && await portOpen(ircPort)) return;
      child = spawn('zig', ['build', 'run', '--', config], {
        cwd: '/home/kain/onyx-server',
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      });
      await waitForPort(wsPort, child);
      await waitForPort(ircPort, child);
    },
    async stop() {
      if (child && child.exitCode === null) {
        try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        await Promise.race([
          new Promise<void>((resolve) => child?.once('exit', () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
        ]);
      }
      const until = Date.now() + 10_000;
      while (Date.now() < until && (await portOpen(wsPort) || await portOpen(ircPort))) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      child = undefined;
    },
  };
}

async function waitHttp(url: string, child: ChildProcess): Promise<void> {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`vite exited (${child.exitCode}) before listen`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok || response.status === 404) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`vite did not listen at ${url}`);
}

async function startPinnedPreview(wsUrl: string, workRoot: string): Promise<{ origin: string; stop(): Promise<void> }> {
  const port = 4100 + (process.pid % 400);
  const origin = `http://127.0.0.1:${port}`;
  const outDir = join(workRoot, 'dist');
  await new Promise<void>((resolve, reject) => {
    const build = spawn('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: process.cwd(),
      env: { ...process.env, VITE_IRC_WS: wsUrl },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    build.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    build.once('error', reject);
    build.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`pinned home preview build failed: ${stderr.slice(-400)}`)));
  });
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', outDir], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitHttp(`${origin}/app/`, child);
  return {
    origin,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    },
  };
}

async function connectGuest(page: Page, origin: string, nick: string): Promise<void> {
  await page.goto(`${origin}/app/`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => '__onyx' in window)).toBe(false);
  const guestTab = page.getByRole('tab', { name: 'Guest' });
  if (await guestTab.isVisible()) await guestTab.click();
  await page.locator('#conn-nick').fill(nick);
  await page.getByTestId('conn-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
}

async function goHome(page: Page): Promise<void> {
  const desktopHome = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Home' });
  if (await desktopHome.isVisible()) await desktopHome.click();
  else await page.getByRole('button', { name: 'Open Home' }).click();
  await expect(page.getByRole('main', { name: 'Network home' })).toBeVisible();
}

async function joinRoom(page: Page, room: string): Promise<void> {
  const input = page.locator('#shell-join-input').or(page.getByRole('textbox', { name: /Room name to join/i }));
  await expect(input.first()).toBeVisible({ timeout: 20_000 });
  await input.first().fill(room);
  const namedJoin = page.getByRole('button', { name: `Join ${room}` });
  if (await namedJoin.isVisible()) await namedJoin.click();
  else await page.getByRole('button', { name: 'Join channel' }).click();
  await expect(page.getByRole('textbox', { name: `Message ${room}` })).toBeVisible({ timeout: 30_000 });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const home = document.querySelector<HTMLElement>('.home');
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      homeOverflowX: home ? getComputedStyle(home).overflowX : 'visible',
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(['hidden', 'clip', 'auto']).toContain(geometry.homeOverflowX);
}

async function assertLedgerOrder(page: Page): Promise<void> {
  const home = page.getByRole('main', { name: 'Network home' });
  await expect(home.getByRole('button', { name: 'Browse rooms' })).toBeVisible();
  await expect(home.getByRole('button', { name: 'Search messages' })).toBeVisible();
  const order = await home.evaluate((root) => {
    const needs = root.querySelector('[data-home-band="needs-you"], [data-home-band="caught-up"]');
    const explore = root.querySelector('[data-home-band="explore"]');
    if (!needs || !explore) return false;
    return Boolean(needs.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
}

async function removeGeneratedRoot(root: string): Promise<void> {
  const until = Date.now() + 8_000;
  let lastError: unknown;
  while (Date.now() < until) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`failed to remove ${root}`);
}

test('connected Current Ledger covers busy, caught-up, offline, and failed-outbox desks', async ({ page }) => {
  test.setTimeout(240_000);
  const generatedRoot = join(process.cwd(), '.work', 'home-briefing');
  const workRoot = join(generatedRoot, `${process.pid}-${Date.now()}`);
  const nick = `hqa${process.pid % 10_000}`;
  const actorNick = `hqb${process.pid % 10_000}`;
  const hold = `#hold${process.pid % 10_000}`;
  let mesh: LocalMesh | undefined;
  let vite: { origin: string; stop(): Promise<void> } | undefined;
  let actor: RawIrcActor | undefined;
  try {
    mesh = await createRestartableServer(workRoot);
    vite = await startPinnedPreview(mesh.wsUrl, workRoot);
    await mesh.start();
    actor = new RawIrcActor(mesh.ircPort);
    if (!mesh || !vite || !actor) throw new Error('home briefing harness failed to start');
    await actor.open(actorNick);
    for (const room of NEED_ROOMS) await actor.join(room);

    await connectGuest(page, vite.origin, nick);
    await expect.poll(() => page.evaluate(() => '__onyx' in window)).toBe(false);
    for (const room of NEED_ROOMS) await joinRoom(page, room);
    await goHome(page);
    for (const room of NEED_ROOMS) {
      actor.send(`PRIVMSG ${room} :${nick}: needs-you seed ${room}`);
    }

    const home = page.getByRole('main', { name: 'Network home' });
    await expect(home.getByRole('heading', { name: 'Needs you' })).toBeVisible({ timeout: 30_000 });
    await expect(home.getByText('8 unread')).toBeVisible();
    await expect(home.getByText('2 more items that need you')).toBeVisible({ timeout: 30_000 });
    await expect(home.getByRole('button', { name: /Open #need7/ })).toBeVisible();
    await home.getByText('2 more items that need you').click();
    await expect(home.getByRole('button', { name: /Open #need0/ })).toBeVisible();
    await expect(home).not.toContainText(/ONYXDM1|secret body/i);
    await expect(page.getByRole('region', { name: 'Live now' })).toHaveCount(0);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate((zoom) => {
        document.documentElement.style.fontSize = zoom ? '64px' : '';
      }, 'highZoom' in viewport && viewport.highZoom);
      await expect(home).toBeVisible();
      if ('highZoom' in viewport && viewport.highZoom) {
        const guestClaim = page.getByTestId('guest-claim');
        await expect(guestClaim).toBeVisible();
        const box = await home.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThan(0);
        const browse = home.getByRole('button', { name: 'Browse rooms' });
        const search = home.getByRole('button', { name: 'Search messages' });
        await browse.scrollIntoViewIfNeeded();
        await expect(browse).toBeVisible();
        await search.scrollIntoViewIfNeeded();
        await expect(search).toBeVisible();

        await page.getByTestId('guest-claim-dismiss').click();
        await expect(guestClaim).toHaveCount(0);
        const boxWithoutGuestClaim = await home.boundingBox();
        expect(boxWithoutGuestClaim?.height ?? 0).toBeGreaterThan(0);
        await browse.scrollIntoViewIfNeeded();
        await expect(browse).toBeVisible();
        await search.scrollIntoViewIfNeeded();
        await expect(search).toBeVisible();
      }
      await assertLedgerOrder(page);
      await assertNoHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await expect(home).toBeVisible();
    await assertNoHorizontalOverflow(page);
    const media = await page.evaluate(() => ({
      forced: window.matchMedia('(forced-colors: active)').matches,
      motion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    expect(media.forced).toBe(true);
    expect(media.motion).toBe(true);

    await home.getByRole('button', { name: 'Browse rooms' }).focus();
    await expect(home.getByRole('button', { name: 'Browse rooms' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(home.getByRole('button', { name: 'Search messages' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('searchbox', { name: 'Search messages' })).toBeFocused();
    await page.keyboard.press('Escape');
    await home.getByRole('button', { name: 'Browse rooms' }).click();
    await expect(page.getByRole('dialog').or(page.getByLabel(/channel|rooms/i)).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('video')).toHaveCount(0);

    await home.getByRole('button', { name: /Mark all caught up/ }).click();
    await expect(home.getByRole('region', { name: "You're caught up" })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Live now' })).toHaveCount(0);

    await joinRoom(page, hold);
    await mesh.stop();
    await goHome(page);
    await expect(home.getByText(/On this device:/i)).toBeVisible({ timeout: 30_000 });

    const composer = page.getByRole('textbox', { name: new RegExp(`Offline — queues for ${hold}|Message ${hold}`) });
    if (!(await composer.isVisible())) {
      await page.getByRole('button', { name: hold }).first().click();
    }
    const offlineComposer = page.getByRole('textbox', { name: new RegExp(`Offline — queues for ${hold}|Message ${hold}`) });
    await expect(offlineComposer).toBeVisible({ timeout: 20_000 });
    await offlineComposer.fill(`queued-secret-body-${process.pid}`);
    await page.getByRole('button', { name: 'Send message' }).click();
    await offlineComposer.fill(`failed-secret-body-${process.pid}`);
    await page.getByRole('button', { name: 'Send message' }).click();

    await goHome(page);
    const outbox = home.locator('[data-home-stratum="outbox"]');
    await expect(outbox).toBeVisible();
    await expect(outbox.locator('.home-outbox__target', { hasText: hold })).toHaveCount(2);
    await expect(home).toContainText(/Message bodies stay inside their conversations/);
    await expect(home).not.toContainText(`queued-secret-body-${process.pid}`);
    await expect(home).not.toContainText(`failed-secret-body-${process.pid}`);
    await expect(home).not.toContainText(/ONYXDM1/);

    const firstRemove = home.getByRole('button', { name: `Remove queued message for ${hold}` }).first();
    await firstRemove.click();
    await expect(home.getByRole('button', { name: `Confirm remove queued message for ${hold}` })).toBeVisible();
    await home.getByRole('button', { name: `Confirm remove queued message for ${hold}` }).click();
    await expect(outbox.locator('.home-outbox__target', { hasText: hold })).toHaveCount(1);

    actor.close();
    await expect(home.getByText(/will send when you reconnect|could not be delivered|still waiting/i)).toBeVisible();
    await mesh.start();
    const banActor = new RawIrcActor(mesh.ircPort);
    try {
      await banActor.open(`hqc${process.pid % 10_000}`);
      await banActor.join(hold);
      banActor.send(`MODE ${hold} +b ${nick}!*@*`);
      await expect(home.getByRole('button', { name: 'Try sending now' }).or(home.getByText(/could not be delivered|still waiting|will send when you reconnect/i)).first())
        .toBeVisible({ timeout: 45_000 });
      const retry = home.getByRole('button', { name: 'Try sending now' });
      if (await retry.isVisible()) await retry.click();
      await expect(home.getByText(/could not be delivered|still waiting|will send when you reconnect/i)).toBeVisible();
    } finally {
      banActor.close();
    }
    await expect(home).not.toContainText(`failed-secret-body-${process.pid}`);
  } finally {
    try { actor?.close(); } catch { /* already closed */ }
    try { if (vite) await vite.stop(); } catch { /* preview already gone */ }
    try { if (mesh) await mesh.stop(); } catch { /* mesh already gone */ }
    await removeGeneratedRoot(generatedRoot);
  }
});
