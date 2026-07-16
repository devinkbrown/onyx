import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const messageMenuCss = readFileSync(
  new URL('../../src/shell/message/message-menu.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains message overflow actions at 400% short reflow', async ({ page, browserName }) => {
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
      <div class="msg-menu">
        <span class="onyx-popover">
          <div class="onyx-popover__panel" role="dialog" aria-label="More message actions">
            <div class="msg-menu-overflow">
              <div class="msg-menu-list" role="menu">
                <button class="msg-menu-item" type="button" role="menuitem">
                  <span class="msg-menu-item-icon" aria-hidden="true">C</span>
                  <span>Copy text</span>
                </button>
                <button class="msg-menu-item" type="button" role="menuitem">
                  <span class="msg-menu-item-icon" aria-hidden="true">R</span>
                  <span>Reply in thread</span>
                </button>
                <button class="msg-menu-item" type="button" role="menuitem">
                  <span class="msg-menu-item-icon" aria-hidden="true">E</span>
                  <span>Edit message</span>
                </button>
                <button class="msg-menu-item msg-menu-item--danger" type="button" role="menuitem">
                  <span class="msg-menu-item-icon" aria-hidden="true">D</span>
                  <span>Delete message</span>
                </button>
              </div>
              <p class="msg-menu-translation">
                <span class="msg-menu-translation-head">Translated on this device</span>
                <span class="msg-menu-translation-text">A deliberately long translated line remains readable without widening the sheet.</span>
                <span class="msg-menu-translation-actions">
                  <button class="msg-menu-translation-action" type="button">Copy translation</button>
                </span>
              </p>
            </div>
          </div>
        </span>
      </div>
      <nav class="shell-mobile-nav" aria-label="Mobile navigation">Navigation</nav>
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
        --stone-3: #345;
        --washi: #fff;
        --washi-dim: #ddd;
        --washi-mute: #aaa;
        --shu: #d44;
        --shu-bright: #f66;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --font-mono: monospace;
        --font-sans: sans-serif;
      }
      html, body { margin: 0; width: 100%; }
      ${primitivesCss}
      ${messageMenuCss}
      ${accessibilityCss}
    `,
  });

  const panel = page.getByRole('dialog', { name: 'More message actions' });
  const deleteAction = panel.getByRole('menuitem', { name: 'Delete message' });
  await deleteAction.focus();
  await expect(deleteAction).toBeFocused();

  const geometry = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const list = element.querySelector<HTMLElement>('.msg-menu-list')!;
    const translation = element.querySelector<HTMLElement>('.msg-menu-translation')!;
    const actionRect = element.querySelector<HTMLElement>('.msg-menu-item--danger')!
      .getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      panelTop: panelRect.top,
      panelRight: panelRect.right,
      panelBottom: panelRect.bottom,
      listClientWidth: list.clientWidth,
      listScrollWidth: list.scrollWidth,
      translationClientWidth: translation.clientWidth,
      translationScrollWidth: translation.scrollWidth,
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      actionHeight: actionRect.height,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.listScrollWidth).toBe(geometry.listClientWidth);
  expect(geometry.translationScrollWidth).toBe(geometry.translationClientWidth);
  expect(geometry.panelTop).toBeGreaterThanOrEqual(12);
  expect(geometry.panelRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.panelBottom).toBeLessThanOrEqual(256 - 20 - 56 - 8);
  expect(geometry.actionTop).toBeGreaterThanOrEqual(geometry.panelTop);
  expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.panelBottom);
  expect(geometry.actionHeight).toBeGreaterThanOrEqual(44);
});
