import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const accountCss = readFileSync(
  new URL('../../src/app/account.css', import.meta.url),
  'utf8',
);

async function renderTotpEnrollment(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 664 });
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
          </div>
          <button class="onyx-modal__close" type="button" aria-label="Close account">×</button>
        </header>
        <div class="onyx-modal__body">
          <div class="acct">
            <section class="acct-section">
              <div class="acct-totp-enroll">
                <p class="acct-totp-note">Add this secret to your authenticator.</p>
                <div class="acct-totp-row">
                  <code class="acct-totp-secret">JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP</code>
                  <button class="onyx-button" type="button">Copy secret</button>
                </div>
              </div>
            </section>
          </div>
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
        --space-3: 12px;
        --space-4: 16px;
        --space-5: 20px;
        --gap-section: 24px;
        --r-sm: 8px;
        --r-md: 12px;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --font-display: sans-serif;
        --font-sans: sans-serif;
        --font-mono: monospace;
        --font-serif: serif;
      }
      ${primitivesCss}
      ${accountCss}
    `,
  });
}

test.describe('Account mobile geometry', () => {
  test('contains a long TOTP enrollment secret without horizontal modal scrolling', async ({ page }) => {
    for (const width of [320, 390]) {
      await renderTotpEnrollment(page, width);

      const geometry = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('.onyx-modal__body')!;
        const row = document.querySelector<HTMLElement>('.acct-totp-row')!;
        const secret = document.querySelector<HTMLElement>('.acct-totp-secret')!;
        const rowBox = row.getBoundingClientRect();
        const secretBox = secret.getBoundingClientRect();
        return {
          bodyClientWidth: body.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          rowLeft: rowBox.left,
          rowRight: rowBox.right,
          secretLeft: secretBox.left,
          secretRight: secretBox.right,
        };
      });

      expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
      expect(geometry.secretLeft).toBeGreaterThanOrEqual(geometry.rowLeft);
      expect(geometry.secretRight).toBeLessThanOrEqual(geometry.rowRight);
    }
  });
});
