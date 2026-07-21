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

test('keeps horizontal tabs usable at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="settings-surface">
      <div class="onyx-tabs">
        <div class="onyx-tabs__list" role="tablist" aria-label="Token group" aria-orientation="horizontal">
          <button class="onyx-tabs__trigger" role="tab" aria-selected="true">Surfaces</button>
          <button class="onyx-tabs__trigger" role="tab" aria-selected="false" tabindex="-1">Text</button>
          <button class="onyx-tabs__trigger" role="tab" aria-selected="false" tabindex="-1">Accents</button>
          <button class="onyx-tabs__trigger" role="tab" aria-selected="false" tabindex="-1">Status</button>
          <button class="onyx-tabs__trigger" role="tab" aria-selected="false" tabindex="-1">Borders</button>
          <button class="onyx-tabs__trigger" role="tab" aria-selected="false" tabindex="-1">Typography</button>
        </div>
        <div class="onyx-tabs__content" role="tabpanel" tabindex="0">
          <label>Surface colour <input value="#001122"></label>
        </div>
      </div>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --pad-panel: 1.1rem;
        --r-md: 0.5rem;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --seam: #456;
        --seam-faint: #234;
        --ink: #020a12;
        --stone: #123;
        --stone-2: #234;
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --font-mono: monospace;
        --font-sans: sans-serif;
      }
      html, body { margin: 0; width: 100%; }
      .settings-surface { width: 100%; padding: 8px 24px 8px 8px; }
      ${primitivesCss}
      ${accessibilityCss}
    `,
  });

  const tablist = page.getByRole('tablist', { name: 'Token group' });
  const lastTab = page.getByRole('tab', { name: 'Typography' });
  await lastTab.focus();
  await expect(lastTab).toBeFocused();

  const geometry = await tablist.evaluate((element) => {
    const listRect = element.getBoundingClientRect();
    const lastRect = element.lastElementChild!.getBoundingClientRect();
    const panelRect = element.nextElementSibling!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      listClientWidth: element.clientWidth,
      listScrollWidth: element.scrollWidth,
      listHeight: listRect.height,
      listLeft: listRect.left,
      listRight: listRect.right,
      lastLeft: lastRect.left,
      lastRight: lastRect.right,
      lastHeight: lastRect.height,
      panelTop: panelRect.top,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.listScrollWidth).toBeGreaterThan(geometry.listClientWidth);
  expect(geometry.listHeight).toBeLessThanOrEqual(60);
  expect(geometry.listLeft).toBeGreaterThanOrEqual(8);
  expect(geometry.listRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.lastLeft).toBeGreaterThanOrEqual(geometry.listLeft);
  expect(geometry.lastRight).toBeLessThanOrEqual(geometry.listRight + 1);
  expect(geometry.lastHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.panelTop).toBeLessThan(100);
});
