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
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
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

test('keeps member details above mobile navigation at 400% short reflow', async ({ page, browserName }) => {
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
      <nav class="shell-mobile-nav" aria-label="Mobile navigation">
        <button type="button" class="shell-mobile-nav-btn">Home</button>
      </nav>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --mnav-h: 56px;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --space-4: 1rem;
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
      ${accessibilityCss}
    `,
  });

  const panel = page.getByRole('dialog', { name: 'Member details for alice' });
  const profile = panel.getByRole('button', { name: 'Profile' });
  await profile.focus();
  await expect(profile).toBeFocused();

  const geometry = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const card = element.querySelector<HTMLElement>('.shell-member-card')!;
    const profileRect = element.querySelectorAll<HTMLElement>('.onyx-button')[1]!
      .getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      panelClientHeight: element.clientHeight,
      panelScrollHeight: element.scrollHeight,
      panelTop: panelRect.top,
      panelRight: panelRect.right,
      panelBottom: panelRect.bottom,
      cardClientWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth,
      profileTop: profileRect.top,
      profileBottom: profileRect.bottom,
      profileWidth: profileRect.width,
      profileHeight: profileRect.height,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.cardScrollWidth).toBe(geometry.cardClientWidth);
  expect(geometry.panelTop).toBeGreaterThanOrEqual(12);
  expect(geometry.panelRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.panelBottom).toBeLessThanOrEqual(256 - 20 - 56 - 8);
  expect(geometry.panelClientHeight).toBeLessThanOrEqual(256 - 12 - 20 - 56 - 16);
  expect(geometry.panelScrollHeight).toBeGreaterThan(geometry.panelClientHeight);
  expect(geometry.profileTop).toBeGreaterThanOrEqual(geometry.panelTop);
  expect(geometry.profileBottom).toBeLessThanOrEqual(geometry.panelBottom);
  expect(geometry.profileWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.profileHeight).toBeGreaterThanOrEqual(44);
});
