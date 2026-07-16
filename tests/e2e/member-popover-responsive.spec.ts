import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(
  new URL('../../src/shell/shell.css', import.meta.url),
  'utf8',
);

const VIEWPORT_WIDTH = 320;
const SAFE_INLINE = 24;

test('contains member details and actions at 200% text', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 568 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 0,
      topMax: 0,
      right: SAFE_INLINE,
      rightMax: SAFE_INLINE,
      bottom: 0,
      bottomMax: 0,
      left: SAFE_INLINE,
      leftMax: SAFE_INLINE,
    },
  });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <span class="onyx-popover">
      <div class="onyx-popover__panel" role="dialog" aria-label="Member details for alice">
        <div class="shell-member-card">
          <div class="shell-member-card-head">
            <div class="onyx-avatar onyx-avatar--md onyx-avatar--owner" aria-hidden="true">AL</div>
            <div>
              <p class="shell-member-card-nick">alice</p>
              <p class="shell-member-card-role">Owner in #general</p>
              <p class="shell-member-card-account">~alice-account-with-an-extremely-long-unbroken-identity</p>
            </div>
          </div>
          <div class="shell-member-card-badges">Owner</div>
          <div class="shell-member-card-actions">
            <button class="onyx-button onyx-button--ghost onyx-button--sm" type="button">Message</button>
            <button class="onyx-button onyx-button--ghost onyx-button--sm" type="button">Profile</button>
          </div>
        </div>
      </div>
    </span>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 32px;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --space-4: 1rem;
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --seam: #456;
        --seam-faint: #234;
        --ink: #020a12;
        --stone: #123;
        --stone-2: #234;
        --washi: #fff;
        --washi-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --font-mono: monospace;
        --font-sans: sans-serif;
      }
      html, body { margin: 0; width: 100%; }
      ${primitivesCss}
      ${shellCss}
    `,
  });

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.onyx-popover__panel')!;
    const card = document.querySelector<HTMLElement>('.shell-member-card')!;
    return {
      panel: [panel.clientWidth, panel.scrollWidth],
      card: [card.clientWidth, card.scrollWidth],
      panelLeft: panel.getBoundingClientRect().left,
      panelRight: panel.getBoundingClientRect().right,
    };
  });

  expect(geometry.panel[1]).toBe(geometry.panel[0]);
  expect(geometry.card[1]).toBe(geometry.card[0]);
  expect(geometry.panelLeft).toBeGreaterThanOrEqual(SAFE_INLINE);
  expect(geometry.panelRight).toBeLessThanOrEqual(VIEWPORT_WIDTH - SAFE_INLINE);
});
