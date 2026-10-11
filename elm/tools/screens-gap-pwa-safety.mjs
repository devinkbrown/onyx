// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-pwa-safety.mjs — screens.mjs scenarios for the v3/gap-pwa-safety
 * slice (re-exports the shell scenarios, since --extra is single-use):
 *
 *   notify-sheet  the Notifications sheet with the closed-tab push row
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-pwa-safety.mjs --only notify-sheet,room,connect
 *
 * The harness serves an SPA fallback for /sw.js (HTML), so these runs
 * also prove the service-worker registration stays silent (no console
 * PROBLEM) when no worker script is deployed.
 */
import shell from './screens-shell.mjs';

/** Click the first VISIBLE element matching any selector. */
async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page);
        return true;
      }
    }
  }
  return false;
}

export default {
  ...shell,
  'notify-sheet': async (page, h) => {
    await shell['you-hub'](page, h);
    if (!(await clickVisible(page, ['[data-testid="shell-notifications"]'], h))) {
      await page.keyboard.press('Escape');
      await clickVisible(page, ['[data-testid="shell-notifications"]'], h);
    }
    await page.waitForSelector('[data-testid="notify-push-row"]', { timeout: 4000 });
    const row = await page.$('[data-testid="notify-push-row"]');
    if (row) await row.scrollIntoViewIfNeeded().catch(() => {});
    await h.settle(page, 300);
  },
};
