// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, type Page, type BrowserContext } from '@playwright/test';

export async function assertLocalElmLive(page: Page, context: BrowserContext): Promise<void> {
  const localWs = process.env.ONYX_ELM_LAB_WS;
  const base = process.env.ONYX_ELM_LAB_BASE;
  if (!localWs || !base) throw new Error('local_lab_endpoints_missing');
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== base) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin !== new URL(localWs).origin) { socket.close(); return; }
    socket.connectToServer();
  });
  await page.goto(`/app/?ws=${encodeURIComponent(localWs)}&nick=${encodeURIComponent(process.env.ONYX_ELM_LAB_NICK || 'ElmLabGuest')}`);
  await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 45_000 });
}
