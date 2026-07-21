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

test('contains long tooltips at 400% short reflow', async ({ page, browserName }) => {
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
      <span class="onyx-tooltip" data-placement="top">
        <span class="onyx-tooltip__trigger">
          <button type="button" aria-describedby="help-tip">?</button>
        </span>
        <span id="help-tip" role="tooltip" class="onyx-tooltip__content">
          Copy this portable palette seed after contrast validation has completed.
        </span>
      </span>
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
        --dur: 0ms;
        --ease: linear;
        --seam: #456;
        --seam-faint: #234;
        --ink: #020a12;
        --stone: #123;
        --stone-2: #234;
        --paper: #fff;
        --paper-dim: #ddd;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .shell { min-height: 256px; position: relative; }
      .onyx-tooltip { position: absolute; right: 24px; bottom: 70px; }
      .onyx-tooltip__trigger button { width: 44px; height: 44px; }
      .shell-mobile-nav {
        position: fixed;
        right: 0;
        bottom: 20px;
        left: 0;
        height: 56px;
      }
      ${primitivesCss}
      ${accessibilityCss}
    `,
  });

  const trigger = page.getByRole('button', { name: '?' });
  const tooltip = page.getByRole('tooltip');
  await trigger.focus();
  await expect(trigger).toBeFocused();

  const geometry = await tooltip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const navRect = document.querySelector<HTMLElement>('.shell-mobile-nav')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      navTop: navRect.top,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.left).toBeGreaterThanOrEqual(8);
  expect(geometry.top).toBeGreaterThanOrEqual(12);
  expect(geometry.right).toBeLessThanOrEqual(320 - 24);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop - 8);
  expect(geometry.fontSize).toBeGreaterThanOrEqual(14);
});
