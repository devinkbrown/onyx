import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains stacked toasts at 400% short reflow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 12,
      topMax: 12,
      right: 24,
      rightMax: 24,
      bottom: 20,
      bottomMax: 20,
      left: 8,
      leftMax: 8,
    },
  });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <main class="shell">
      <ol class="onyx-toaster" aria-live="polite" aria-label="Notifications">
        <li class="onyx-toast onyx-toast--success" role="status">
          <div class="onyx-toast__body">
            <strong>Saved locally</strong>
            <p>A deliberately long notification remains readable without widening the viewport.</p>
          </div>
          <button type="button" aria-label="Dismiss Saved locally">×</button>
        </li>
        <li class="onyx-toast onyx-toast--danger" role="alert">
          <div class="onyx-toast__body">
            <strong>Connection interrupted</strong>
            <p>Reconnect controls remain available while this announcement rail scrolls.</p>
          </div>
          <button type="button" aria-label="Dismiss Connection interrupted">×</button>
        </li>
      </ol>
      <nav class="shell-mobile-nav" aria-label="Mobile navigation">Navigation</nav>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --mnav-h: 56px;
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --seam: #456;
        --seam-faint: #234;
        --ink: #020a12;
        --stone: #123;
        --stone-2: #234;
        --washi: #fff;
        --washi-dim: #ddd;
        --washi-mute: #aaa;
        --danger: #d44;
        --ok: #4b8;
        --gold: #da4;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --font-mono: monospace;
        --font-sans: sans-serif;
      }
      html, body { margin: 0; width: 100%; }
      ${primitivesCss}
      ${accessibilityCss}
    `,
  });

  const toaster = page.getByRole('list', { name: 'Notifications' });
  const dismiss = page.getByRole('button', { name: 'Dismiss Connection interrupted' });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();

  const geometry = await toaster.evaluate((element) => {
    const toasterRect = element.getBoundingClientRect();
    const toasts = Array.from(element.querySelectorAll<HTMLElement>('.onyx-toast'));
    const dismissRect = element.querySelectorAll<HTMLElement>('button')[1]!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      toasterClientWidth: element.clientWidth,
      toasterScrollWidth: element.scrollWidth,
      toasterClientHeight: element.clientHeight,
      toasterScrollHeight: element.scrollHeight,
      toasterTop: toasterRect.top,
      toasterRight: toasterRect.right,
      toasterBottom: toasterRect.bottom,
      toastWidths: toasts.map((toast) => [toast.clientWidth, toast.scrollWidth]),
      dismissTop: dismissRect.top,
      dismissBottom: dismissRect.bottom,
      dismissRight: dismissRect.right,
      dismissWidth: dismissRect.width,
      dismissHeight: dismissRect.height,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.toasterScrollWidth).toBe(geometry.toasterClientWidth);
  for (const [clientWidth, scrollWidth] of geometry.toastWidths) {
    expect(scrollWidth).toBe(clientWidth);
  }
  expect(geometry.toasterTop).toBeGreaterThanOrEqual(12);
  expect(geometry.toasterRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.toasterBottom).toBeLessThanOrEqual(256 - 20 - 56 - 8);
  expect(geometry.toasterScrollHeight).toBeGreaterThan(geometry.toasterClientHeight);
  expect(geometry.dismissTop).toBeGreaterThanOrEqual(geometry.toasterTop);
  expect(geometry.dismissBottom).toBeLessThanOrEqual(geometry.toasterBottom + 1);
  expect(geometry.dismissRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.dismissWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.dismissHeight).toBeGreaterThanOrEqual(44);
});
