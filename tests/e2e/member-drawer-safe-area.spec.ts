import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(
  new URL('../../src/shell/shell.css', import.meta.url),
  'utf8',
);
const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
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

test('keeps the modal close reachable and contained at 400% text in forced colors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 0,
      topMax: 0,
      right: 24,
      rightMax: 24,
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
      <aside class="shell-members" role="dialog" aria-modal="true" aria-label="Member list for #root">
        <div class="shell-members-head">
          <span class="shell-members-title">members</span>
          <span class="shell-members-head-actions">
            <span class="shell-members-head-meta">
              <span class="shell-members-count" aria-label="6 members">6</span>
            </span>
            <button type="button" class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--sm shell-members-close" aria-label="Close member list">
              <span class="onyx-icon-button__glyph" aria-hidden="true">×</span>
            </button>
          </span>
        </div>
        <div class="shell-members-scroll" role="region" aria-label="Channel members in #root">
          <button type="button" class="onyx-popover__trigger">Member action</button>
        </div>
      </aside>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --font-sans: sans-serif;
        --font-mono: monospace;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --dur: 0ms;
        --ease: linear;
        --ink: #07101a;
        --stone: #102234;
        --stone-2: #173047;
        --washi: #f4f8fb;
        --washi-mute: #9ba9b5;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --seam: #45677d;
        --seam-faint: #365064;
      }
      html, body { margin: 0; width: 100%; }
      ${primitivesCss}
      ${shellCss}
      ${accessibilityCss}
    `,
  });

  const drawer = page.getByRole('dialog', { name: 'Member list for #root' });
  const closeButton = drawer.getByRole('button', { name: 'Close member list' });
  await closeButton.focus();
  await expect(closeButton).toBeFocused();

  const geometry = await page.evaluate(() => {
    const body = document.body;
    const drawer = document.querySelector<HTMLElement>('.shell-members')!;
    const close = document.querySelector<HTMLElement>('.shell-members-close')!;
    const drawerRect = drawer.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    return {
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      drawerClientWidth: drawer.clientWidth,
      drawerScrollWidth: drawer.scrollWidth,
      closeLeft: closeRect.left,
      closeRight: closeRect.right,
      drawerLeft: drawerRect.left,
      safeRight: drawerRect.right - 24,
      outlineStyle: getComputedStyle(close).outlineStyle,
    };
  });

  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  expect(geometry.drawerScrollWidth).toBe(geometry.drawerClientWidth);
  expect(geometry.closeLeft).toBeGreaterThanOrEqual(geometry.drawerLeft);
  expect(geometry.closeRight).toBeLessThanOrEqual(geometry.safeRight);
  expect(geometry.outlineStyle).not.toBe('none');
});
