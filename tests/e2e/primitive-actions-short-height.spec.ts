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

test('contains shared action controls at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="action-surface">
      <div class="action-strip">
        <button class="onyx-button onyx-button--primary onyx-button--md" type="button">
          Manage certificate identities
        </button>
        <button class="onyx-button onyx-button--danger onyx-button--sm" type="button">
          Sign out
        </button>
        <button class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--sm" type="button" aria-label="Add identity">
          <span class="onyx-icon-button__glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </span>
        </button>
      </div>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
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
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --shu: #c34;
        --shu-bright: #f66;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .action-surface { width: 100%; padding: 12px 24px 84px 8px; }
      .action-strip { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
      .onyx-icon-button__glyph svg { display: block; fill: none; stroke: currentColor; }
      ${primitivesCss}
      ${accessibilityCss}
    `,
  });

  const surface = page.locator('.action-surface');
  const actions = page.locator('.action-strip > button');
  const iconButton = page.getByRole('button', { name: 'Add identity' });
  await iconButton.focus();
  await expect(iconButton).toBeFocused();

  const geometry = await surface.evaluate((element) => {
    const surfaceRect = element.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('.action-strip > button'));
    const glyphRect = element.querySelector<HTMLElement>('.onyx-icon-button__glyph')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      surfaceClientWidth: element.clientWidth,
      surfaceScrollWidth: element.scrollWidth,
      surfaceLeft: surfaceRect.left,
      surfaceRight: surfaceRect.right,
      buttons: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }),
      glyphWidth: glyphRect.width,
      glyphHeight: glyphRect.height,
    };
  });

  expect(await actions.count()).toBe(3);
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.surfaceScrollWidth).toBe(geometry.surfaceClientWidth);
  for (const button of geometry.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(geometry.surfaceLeft + 8);
    expect(button.right).toBeLessThanOrEqual(geometry.surfaceRight - 24);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.buttons[1]!.height).toBeLessThanOrEqual(60);
  expect(geometry.buttons[2]!.width).toBe(44);
  expect(geometry.buttons[2]!.height).toBe(44);
  expect(geometry.glyphWidth).toBeLessThanOrEqual(24);
  expect(geometry.glyphHeight).toBeLessThanOrEqual(24);
});
