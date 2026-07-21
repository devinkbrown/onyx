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
                  <span>Delete for everyone</span>
                </button>
              </div>
              <p class="msg-menu-translation">
                <span class="msg-menu-translation-head">Translated on this device</span>
                <span class="msg-menu-translation-text">A deliberately long translated line remains readable without widening the sheet.</span>
                <span class="msg-menu-translation-actions">
                  <button class="msg-menu-translation-action" type="button">Copy translation</button>
                </span>
              </p>
              <div class="msg-menu-delete-confirm" role="group" aria-label="Confirm deleting message for everyone" style="display:none">
                <p class="msg-menu-delete-confirm__title">Delete for everyone?</p>
                <p class="msg-menu-delete-confirm__copy">This removes the message from the conversation and cannot be undone.</p>
                <div class="msg-menu-delete-confirm__actions">
                  <button class="msg-menu-delete-confirm__cancel" type="button">Keep message</button>
                  <button class="msg-menu-delete-confirm__delete" type="button">Delete for everyone</button>
                </div>
              </div>
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
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
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
  const deleteAction = panel.getByRole('menuitem', { name: 'Delete for everyone' });
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

  await panel.evaluate((element) => {
    element.querySelector<HTMLElement>('.msg-menu-list')!.style.display = 'none';
    element.querySelector<HTMLElement>('.msg-menu-translation')!.style.display = 'none';
    element.querySelector<HTMLElement>('.msg-menu-delete-confirm')!.style.removeProperty('display');
    // MessageMenu resets the scroll-owned popover when replacing its last menu
    // item with the confirmation so the warning cannot remain clipped above.
    element.scrollTop = 0;
  });

  const confirmation = panel.getByRole('group', { name: 'Confirm deleting message for everyone' });
  const keepMessage = confirmation.getByRole('button', { name: 'Keep message' });
  await keepMessage.focus();
  await expect(keepMessage).toBeFocused();
  const confirmationGeometry = await confirmation.evaluate((element) => {
    const panel = element.closest<HTMLElement>('.onyx-popover__panel')!;
    const panelRect = panel.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button'));
    return {
      panelClientWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      panelClientHeight: panel.clientHeight,
      panelScrollHeight: panel.scrollHeight,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      buttonSizes: buttons.map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return { width: buttonRect.width, height: buttonRect.height };
      }),
    };
  });

  expect(confirmationGeometry.panelScrollWidth).toBe(confirmationGeometry.panelClientWidth);
  expect(confirmationGeometry.left).toBeGreaterThanOrEqual(8);
  expect(confirmationGeometry.right).toBeLessThanOrEqual(320 - 24);
  expect(confirmationGeometry.top).toBeGreaterThanOrEqual(12);
  expect(confirmationGeometry.panelTop).toBeGreaterThanOrEqual(12);
  expect(confirmationGeometry.panelBottom).toBeLessThanOrEqual(256 - 20 - 56 - 8);
  expect(confirmationGeometry.panelScrollHeight).toBeGreaterThanOrEqual(
    confirmationGeometry.panelClientHeight,
  );
  for (const size of confirmationGeometry.buttonSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  // Vertical scrolling is permitted under 400% short reflow. The destructive
  // action still has to become wholly visible when reached by keyboard.
  const confirmDelete = confirmation.getByRole('button', { name: 'Delete for everyone' });
  await confirmDelete.focus();
  await expect(confirmDelete).toBeFocused();
  const focusedGeometry = await confirmDelete.evaluate((button) => {
    const panel = button.closest<HTMLElement>('.onyx-popover__panel')!;
    const panelRect = panel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      buttonTop: buttonRect.top,
      buttonBottom: buttonRect.bottom,
    };
  });
  expect(focusedGeometry.buttonTop).toBeGreaterThanOrEqual(focusedGeometry.panelTop);
  expect(focusedGeometry.buttonBottom).toBeLessThanOrEqual(focusedGeometry.panelBottom);
});
