// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared helpers for the Fable audit specs.
import { expect, type Page, type TestInfo } from '@playwright/test';
import { createWire, WS } from './elm-audit-wire.mjs';
import { auditPage, describeFocus } from './elm-audit-lib.mjs';

export { WS, createWire, auditPage, describeFocus };

export type Wire = { sent: string[]; push: (...lines: string[]) => void; close: () => void; handler: (socket: any) => void };
export type Collected = { errors: string[]; failedRequests: string[] };

export function isPhone(info: TestInfo) { return /iphone/.test(info.project.name); }
export function viewportWidth(page: Page) { return page.viewportSize()?.width ?? 1280; }

/** Collect console errors/warnings, page errors, failed same-origin requests. */
export function collect(page: Page): Collected {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(`console.${message.type()}: ${message.text()}`); });
  page.on('requestfailed', request => { if (request.url().startsWith('http://127.0.0.1')) failedRequests.push(`${request.url()} ${request.failure()?.errorText}`); });
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1')) failedRequests.push(`${response.status()} ${response.url()}`); });
  return { errors, failedRequests };
}

/** Boot /app with the mock wire. `query` is appended to ?ws=… (e.g. '&nick=kai'). */
export async function boot(page: Page, query = '&nick=kai', wireOptions: Record<string, unknown> = {}, prefs: { seen?: boolean; theme?: string | null } = {}): Promise<Wire> {
  const wire = createWire(wireOptions) as Wire;
  await page.routeWebSocket(WS, wire.handler);
  await page.addInitScript(({ seen, theme }) => {
    try {
      if (seen !== false) localStorage.setItem('onyx:first-hour-seen', '1');
      if (theme) localStorage.setItem('onyx:theme', theme);
    } catch { /* storage unavailable */ }
  }, { seen: prefs.seen, theme: prefs.theme ?? null });
  await page.goto(`/app/?ws=${encodeURIComponent(WS)}${query}`);
  await page.waitForFunction(() => (window as any).__onyxBooted === true);
  if (query.includes('nick=')) await expect(page.locator('.onyx-shell')).toBeVisible();
  return wire;
}

export async function waitLive(page: Page) {
  await expect(page.getByTestId('connection-open')).toHaveAccessibleName(/Live/, { timeout: 15_000 });
}

export async function openRooms(page: Page) {
  if (!(await page.locator('#client-rooms').isVisible())) await page.getByTestId('nav-rooms').locator('visible=true').click();
  await expect(page.locator('#client-rooms')).toBeVisible();
}

export async function openRoom(page: Page, room: string) {
  await waitLive(page);
  await openRooms(page);
  const button = page.locator(`#client-rooms button[title="${room}"]`);
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
  await expect(page.locator('.onyx-thread-pane')).toHaveAttribute('data-conversation', room.toLowerCase());
}

export async function openRoot(page: Page, wireOptions: Record<string, unknown> = {}) {
  const wire = await boot(page, '&nick=kai', wireOptions);
  await openRoom(page, '#root');
  if (!wireOptions.hugeRoot) await expect(page.getByText('Voice call at six, I will set it up.', { exact: true })).toBeVisible();
  else await expect(page.getByText('Buffered message 499 with readable conversation text.', { exact: true })).toBeVisible();
  return wire;
}

export async function openMessageMenu(page: Page, index = 3) {
  const triggers = page.locator('.onyx-msg-menu-trigger');
  const count = await triggers.count();
  const trigger = triggers.nth(Math.min(index, count - 1));
  const row = trigger.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " onyx-message ")][1]');
  await row.scrollIntoViewIfNeeded();
  // On touch the trigger is hidden until its row has focus (long-press
  // opens the menu directly); activate it the way a tap on the row would.
  if (await trigger.isVisible()) await trigger.click();
  else await trigger.dispatchEvent('click');
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Open a conversation tool that phones fold behind the "More conversation tools" button. */
export async function openRoomTool(page: Page, testId: string) {
  const tool = page.getByTestId(testId);
  if (!(await tool.isVisible())) {
    const more = page.locator('#room-tools-more');
    if (await more.isVisible()) await more.click();
  }
  await tool.click();
}

/** Reveal the composer's secondary controls (phones keep them behind "+"). */
export async function openComposerTray(page: Page) {
  const toggle = page.getByRole('button', { name: 'More message options' });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

export async function sendMessage(page: Page, text: string) {
  const input = page.getByLabel('Message', { exact: true });
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.onyx-body', { hasText: text }).last()).toBeVisible();
}

/** Run the in-page audit and return it. */
export async function audit(page: Page, phone: boolean) {
  return page.evaluate(auditPage, phone) as Promise<{ overflow: string | null; overflowers: string[]; smallTargets: string[]; a11y: string[]; contrast: string[]; landmarks: Record<string, any>; headings: string[] }>;
}

export async function focused(page: Page) {
  return page.evaluate(describeFocus) as Promise<{ tag: string; name: string; ring: boolean; path: string; inViewport: boolean; outline: string; boxShadow: string }>;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
  expect(geometry.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(geometry.width);
}

export const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);
