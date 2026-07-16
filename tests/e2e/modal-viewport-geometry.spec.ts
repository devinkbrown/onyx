import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);

const viewports = [
  { width: 390, height: 664 },
  { width: 1440, height: 900 },
] as const;

async function renderModal(
  page: Page,
  viewport: (typeof viewports)[number],
  content: 'short' | 'tall',
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <div class="onyx-modal">
      <div class="onyx-modal__backdrop" aria-hidden="true"></div>
      <section class="onyx-modal__dialog" role="dialog" aria-label="Account">
        <header class="onyx-modal__header">
          <div>
            <p class="onyx-modal__kicker">dialog</p>
            <h2>Account</h2>
            <p>Signed in as alice</p>
          </div>
          <button class="onyx-modal__close" type="button" aria-label="Close account">×</button>
        </header>
        <div class="onyx-modal__body">
          ${content === 'tall' ? '<div style="height: 1600px"></div>' : ''}
          <button type="button" data-final-action>Final action</button>
        </div>
      </section>
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

test.describe('ModalShell viewport geometry', () => {
  test('keeps a tall dialog inside the viewport and the body independently scrollable', async ({ page }) => {
    for (const viewport of viewports) {
      await renderModal(page, viewport, 'tall');

      const dialog = page.locator('.onyx-modal__dialog');
      const body = page.locator('.onyx-modal__body');
      const beforeScroll = await body.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(beforeScroll.scrollHeight).toBeGreaterThan(beforeScroll.clientHeight);

      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

      const dialogBox = await dialog.boundingBox();
      const finalActionBox = await page.locator('[data-final-action]').boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(finalActionBox).not.toBeNull();
      expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);
      expect(finalActionBox!.y + finalActionBox!.height).toBeLessThanOrEqual(
        dialogBox!.y + dialogBox!.height,
      );
    }
  });

  test('preserves the intended width and top margin for short dialogs', async ({ page }) => {
    for (const viewport of viewports) {
      await renderModal(page, viewport, 'short');

      const dialogBox = await page.locator('.onyx-modal__dialog').boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.width).toBeCloseTo(Math.min(544, viewport.width - 32), 1);
      expect(dialogBox!.y).toBeCloseTo(Math.min(viewport.height * 0.12, 96), 1);
      expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);
    }
  });
});
