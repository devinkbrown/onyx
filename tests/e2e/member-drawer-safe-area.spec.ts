import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(
  new URL('../../src/shell/shell.css', import.meta.url),
  'utf8',
);

const VIEWPORT_WIDTH = 844;
const SAFE_RIGHT = 47;

test('keeps mobile member drawer content outside the right safe area', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');

  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 390 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 0,
      topMax: 0,
      right: SAFE_RIGHT,
      rightMax: SAFE_RIGHT,
      bottom: 0,
      bottomMax: 0,
      left: 0,
      leftMax: 0,
    },
  });

  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <main class="shell">
      <aside class="shell-members" aria-label="Member list for #root">
        <div class="shell-members-head">
          <span>members</span>
          <span class="shell-members-count" data-edge-control>6</span>
        </div>
        <div class="shell-members-scroll">
          <button type="button" class="onyx-popover__trigger" data-member-action>Member action</button>
        </div>
      </aside>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        --font-sans: sans-serif;
        --font-mono: monospace;
        --space-1: 4px;
        --space-2: 8px;
        --space-3: 12px;
        --r-sm: 4px;
        --dur: 0ms;
        --ease: linear;
        --ink: #07101a;
        --washi: #f4f8fb;
        --washi-mute: #9ba9b5;
        --seam-faint: #365064;
      }
      ${shellCss}
    `,
  });

  const drawer = page.getByRole('complementary', { name: 'Member list for #root' });
  const drawerBox = await drawer.boundingBox();
  const edgeControlBox = await page.locator('[data-edge-control]').boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(edgeControlBox).not.toBeNull();
  expect(drawerBox!.x + drawerBox!.width).toBe(VIEWPORT_WIDTH);
  expect(edgeControlBox!.x + edgeControlBox!.width).toBeLessThanOrEqual(
    VIEWPORT_WIDTH - SAFE_RIGHT,
  );
});
