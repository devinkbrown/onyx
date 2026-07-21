import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const voiceCss = readFileSync(
  new URL('../../src/shell/voice/voice.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

const fixtureCss = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    font-size: 64px;
    --mnav-h: 56px;
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
    --lapis: #168ce0;
    --lapis-bright: #55baff;
    --lapis-deep: #075080;
    --shu: #c34;
    --font-sans: sans-serif;
    --font-mono: monospace;
  }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  .mobile-nav-fixture {
    position: fixed;
    inset: auto 0 0;
    height: 56px;
    border-top: 1px solid CanvasText;
  }
  ${primitivesCss}
  ${voiceCss}
  ${accessibilityCss}
`;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
});

test('keeps every reaction menu target usable at 400% short reflow', async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <span class="onyx-popover" data-placement="top">
      <div class="onyx-popover__panel" role="dialog" aria-label="Send a reaction" data-testid="panel">
        <div class="voice-bar__reactions" role="menu" aria-label="Send a reaction">
          ${['👍', '❤️', '😂', '🎉', '👏', '🔥', '😮', '✋'].map((emoji) => `
            <button class="voice-bar__reaction" role="menuitem" aria-label="React with ${emoji}">${emoji}</button>
          `).join('')}
        </div>
      </div>
    </span>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({ content: fixtureCss });

  const panel = page.getByTestId('panel');
  const lastReaction = page.getByRole('menuitem', { name: 'React with ✋' });
  await lastReaction.focus();
  await expect(lastReaction).toBeFocused();

  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const navTop = document.querySelector<HTMLElement>('.mobile-nav-fixture')!.getBoundingClientRect().top;
    const controls = Array.from(element.querySelectorAll<HTMLElement>('.voice-bar__reaction'));
    const focusedStyle = getComputedStyle(document.activeElement as HTMLElement);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      panelLeft: rect.left,
      panelRight: rect.right,
      panelTop: rect.top,
      panelBottom: rect.bottom,
      navTop,
      sizes: controls.map((control) => {
        const controlRect = control.getBoundingClientRect();
        return { width: controlRect.width, height: controlRect.height };
      }),
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.panelLeft).toBeGreaterThanOrEqual(8);
  expect(geometry.panelRight).toBeLessThanOrEqual(312);
  expect(geometry.panelTop).toBeGreaterThanOrEqual(8);
  expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.navTop - 8);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
  for (const size of geometry.sizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
});

test('scrolls a focused spatial participant into the safe popover region', async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <span class="onyx-popover" data-placement="top">
      <div class="onyx-popover__panel" role="dialog" aria-label="Spatial audio controls" data-testid="panel">
        <div class="voice-bar__spatial">
          <span class="voice-bar__spatial-title">Spatial audio</span>
          <span class="voice-bar__spatial-state">3 positioned</span>
          <div role="application" tabindex="0" aria-label="Spatial position" style="width:160px;height:160px"></div>
          <div role="group" aria-label="Spatial audio participants" style="display:flex;gap:4px;flex-wrap:wrap">
            <button class="voice-bar__spatial-participant" aria-pressed="true">Alexandria</button>
            <button class="voice-bar__spatial-participant" aria-pressed="false">Borealis</button>
            <button class="voice-bar__spatial-participant" aria-pressed="false">Cassiopeia Accessibility Operator</button>
          </div>
        </div>
      </div>
    </span>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({ content: fixtureCss });

  const panel = page.getByTestId('panel');
  const lastParticipant = page.getByRole('button', { name: 'Cassiopeia Accessibility Operator' });
  await lastParticipant.focus();
  await expect(lastParticipant).toBeFocused();

  const geometry = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const focusedStyle = getComputedStyle(focused);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      panelClientHeight: element.clientHeight,
      panelScrollHeight: element.scrollHeight,
      panelScrollTop: element.scrollTop,
      focusedLeft: focusedRect.left,
      focusedRight: focusedRect.right,
      focusedTop: focusedRect.top,
      focusedBottom: focusedRect.bottom,
      focusedWidth: focusedRect.width,
      focusedHeight: focusedRect.height,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.panelScrollHeight).toBeGreaterThan(geometry.panelClientHeight);
  expect(geometry.panelScrollTop).toBeGreaterThan(0);
  expect(geometry.focusedLeft).toBeGreaterThanOrEqual(geometry.panelLeft + 8);
  expect(geometry.focusedRight).toBeLessThanOrEqual(geometry.panelRight - 8);
  expect(geometry.focusedTop).toBeGreaterThanOrEqual(geometry.panelTop + 8);
  expect(geometry.focusedBottom).toBeLessThanOrEqual(geometry.panelBottom - 8);
  expect(geometry.focusedWidth).toBeLessThanOrEqual(geometry.panelClientWidth - 16);
  expect(geometry.focusedHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});
