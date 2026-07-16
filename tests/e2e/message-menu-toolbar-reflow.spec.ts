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

test('contains full message toolbar targets at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <article class="shell-msg-group" aria-label="Message from Alexandria" data-testid="message-row">
      <p>A message remains readable while its complete action toolbar is revealed.</p>
      <div class="msg-menu" role="group" aria-label="Actions for message from Alexandria" data-testid="menu">
        <div class="msg-menu-bar" data-testid="toolbar">
          <button class="msg-menu-btn" aria-label="React with thumbs up"><span class="msg-menu-icon">T</span></button>
          <button class="msg-menu-btn" aria-label="React with heart"><span class="msg-menu-icon">H</span></button>
          <span class="onyx-popover">
            <button class="onyx-popover__trigger" aria-label="Choose reaction for message from Alexandria">
              <span class="msg-menu-btn" aria-hidden="true"><span class="msg-menu-icon">R</span></span>
            </button>
          </span>
          <button class="msg-menu-btn" aria-label="Reply to Alexandria"><span class="msg-menu-icon">Y</span></button>
          <button class="msg-menu-btn" aria-label="Start a topic from message"><span class="msg-menu-icon">S</span></button>
          <span class="onyx-popover">
            <button class="onyx-popover__trigger" aria-label="More actions for message from Alexandria">
              <span class="msg-menu-btn" aria-hidden="true"><span class="msg-menu-icon">M</span></span>
            </button>
          </span>
        </div>
      </div>
    </article>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
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
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --font-sans: sans-serif;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      .shell-msg-group {
        position: relative;
        width: 100%;
        min-height: 112px;
        padding: 56px 8px 8px;
        border-bottom: 1px solid CanvasText;
      }
      .shell-msg-group p { margin: 0; font: 16px/1.4 sans-serif; }
      ${primitivesCss}
      ${messageMenuCss}
      ${accessibilityCss}
    `,
  });

  const row = page.getByTestId('message-row');
  const menu = page.getByTestId('menu');
  const toolbar = page.getByTestId('toolbar');
  const lastAction = page.getByRole('button', { name: 'More actions for message from Alexandria' });

  await row.hover();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await lastAction.focus();
  await expect(lastAction).toBeFocused();

  const geometry = await menu.evaluate((element) => {
    const menuRect = element.getBoundingClientRect();
    const bar = element.querySelector<HTMLElement>('.msg-menu-bar')!;
    const barRect = bar.getBoundingClientRect();
    const semanticControls = Array.from(element.querySelectorAll<HTMLElement>('button'));
    const visualControls = Array.from(element.querySelectorAll<HTMLElement>('.msg-menu-btn'));
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const focusedStyle = getComputedStyle(focused);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      menuLeft: menuRect.left,
      menuRight: menuRect.right,
      menuTop: menuRect.top,
      barClientWidth: bar.clientWidth,
      barScrollWidth: bar.scrollWidth,
      barLeft: barRect.left,
      barRight: barRect.right,
      barOpacity: Number.parseFloat(getComputedStyle(bar).opacity),
      barTransform: getComputedStyle(bar).transform,
      semanticSizes: semanticControls.map((control) => {
        const rect = control.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      visualSizes: visualControls.map((control) => {
        const rect = control.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      focusedLeft: focusedRect.left,
      focusedRight: focusedRect.right,
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.menuLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.menuRight).toBeLessThanOrEqual(320);
  expect(geometry.menuTop).toBeGreaterThanOrEqual(0);
  expect(geometry.barScrollWidth).toBe(geometry.barClientWidth);
  expect(geometry.barLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.barRight).toBeLessThanOrEqual(320);
  expect(geometry.barOpacity).toBe(1);
  expect(geometry.barTransform).toBe('none');
  for (const size of geometry.semanticSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  for (const size of geometry.visualSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.focusedLeft).toBeGreaterThanOrEqual(geometry.barLeft);
  expect(geometry.focusedRight).toBeLessThanOrEqual(geometry.barRight);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});
