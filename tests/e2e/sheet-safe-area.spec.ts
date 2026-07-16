import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);

const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;
const VIEWPORT_HEIGHT = 664;

async function renderSheet(
  page: import('@playwright/test').Page,
  insets: { top: number; bottom: number } = { top: SAFE_TOP, bottom: SAFE_BOTTOM },
): Promise<void> {
  await page.setViewportSize({ width: 390, height: VIEWPORT_HEIGHT });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: insets.top,
      topMax: insets.top,
      right: 0,
      rightMax: 0,
      bottom: insets.bottom,
      bottomMax: insets.bottom,
      left: 0,
      leftMax: 0,
    },
  });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <div class="onyx-sheet">
      <aside class="onyx-sheet__panel" role="dialog" aria-label="Preferences">
        <header class="onyx-sheet__header">
          <div>
            <p>panel</p>
            <h2>Preferences</h2>
            <p>Display &amp; behaviour — applied live.</p>
          </div>
          <button class="onyx-sheet__close" type="button" aria-label="Close preferences">×</button>
        </header>
        <div class="onyx-sheet__body">
          <div style="height: 1100px"></div>
          <button type="button" data-last-action>Last preference</button>
        </div>
      </aside>
    </div>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        --pad-panel-lg: 24px;
        --space-1: 4px;
        --space-2: 8px;
        --space-4: 16px;
        --r-md: 12px;
        --dur: 0ms;
        --ease: linear;
        --font-display: sans-serif;
        --font-mono: monospace;
        --font-serif: serif;
      }
      ${primitivesCss}
    `,
  });
}

test.describe('Sheet mobile safe-area geometry', () => {
  test('keeps header and final action outside emulated device cutouts', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
    await renderSheet(page);

    const close = page.getByRole('button', { name: 'Close preferences' });
    const body = page.locator('.onyx-sheet__body');
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const lastAction = page.locator('[data-last-action]');

    const closeBox = await close.boundingBox();
    const lastActionBox = await lastAction.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(lastActionBox).not.toBeNull();
    expect(closeBox!.y).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(lastActionBox!.y + lastActionBox!.height).toBeLessThanOrEqual(
      VIEWPORT_HEIGHT - SAFE_BOTTOM,
    );
  });

  test('preserves the existing panel padding when safe-area insets are zero', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
    await renderSheet(page, { top: 0, bottom: 0 });

    const padding = await page.evaluate(() => {
      const header = getComputedStyle(document.querySelector<HTMLElement>('.onyx-sheet__header')!);
      const body = getComputedStyle(document.querySelector<HTMLElement>('.onyx-sheet__body')!);
      return {
        header: [header.paddingTop, header.paddingRight, header.paddingBottom, header.paddingLeft],
        body: [body.paddingTop, body.paddingRight, body.paddingBottom, body.paddingLeft],
      };
    });

    expect(padding.header).toEqual(['24px', '24px', '24px', '24px']);
    expect(padding.body).toEqual(['24px', '24px', '24px', '24px']);
  });

  test('contains the sheet header and close action at 200% text', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
    await renderSheet(page, { top: 0, bottom: 0 });
    await page.setViewportSize({ width: 320, height: VIEWPORT_HEIGHT });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
      document.documentElement.style.setProperty('--pad-panel-lg', '1.25rem');
      document.documentElement.style.setProperty('--space-1', '0.25rem');
      document.documentElement.style.setProperty('--space-2', '0.5rem');
      document.documentElement.style.setProperty('--space-4', '1rem');
    });

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.onyx-sheet__panel')!;
      const header = document.querySelector<HTMLElement>('.onyx-sheet__header')!;
      return {
        panel: [panel.clientWidth, panel.scrollWidth],
        header: [header.clientWidth, header.scrollWidth],
      };
    });
    const closeBox = await page.getByRole('button', { name: 'Close preferences' }).boundingBox();

    expect(geometry.panel[1]).toBe(geometry.panel[0]);
    expect(geometry.header[1]).toBe(geometry.header[0]);
    expect(closeBox).not.toBeNull();
    expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(320);
  });
});
