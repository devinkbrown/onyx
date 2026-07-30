import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(new URL('../../src/shell/shell.css', import.meta.url), 'utf8');

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
]) {
  test(`centers composer text inside the field on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(`
      <!doctype html>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <div class="shell-composer-inner">
        <button class="shell-composer-tool" type="button" aria-label="Attach">+</button>
        <textarea class="shell-composer-textarea" rows="1" aria-label="Message">Ready to send</textarea>
        <button class="shell-composer-send" type="button" aria-label="Send">→</button>
      </div>
    `);
    await page.addStyleTag({
      content: `
        *, *::before, *::after { box-sizing: border-box; }
        :root {
          font-size: 16px;
          --space-1: 4px;
          --space-2: 8px;
          --r-md: 8px;
          --seam: #456;
          --seam-faint: #234;
          --ink: #020a12;
          --stone-2: #123;
          --paper: #fff;
          --paper-dim: #ddd;
          --paper-mute: #aaa;
          --lapis: #168ce0;
          --lapis-bright: #55baff;
          --lapis-deep: #075080;
          --font-sans: sans-serif;
          --dur: 0ms;
          --ease: linear;
        }
        body { margin: 20px; }
        ${shellCss}
      `,
    });

    const geometry = await page.getByRole('textbox', { name: 'Message' }).evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const paddingTop = Number.parseFloat(style.paddingTop);
      const paddingBottom = Number.parseFloat(style.paddingBottom);
      const borderTop = Number.parseFloat(style.borderTopWidth);
      const borderBottom = Number.parseFloat(style.borderBottomWidth);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return {
        fieldHeight: rect.height,
        lineHeight,
        paddingTop,
        paddingBottom,
        contentHeight: rect.height - borderTop - borderBottom - paddingTop - paddingBottom,
      };
    });

    expect(geometry.paddingTop).toBeCloseTo(geometry.paddingBottom, 5);
    expect(geometry.contentHeight).toBeCloseTo(geometry.lineHeight, 1);
    expect(geometry.fieldHeight).toBe(viewport.name === 'phone landscape' ? 40 : viewport.width <= 900 ? 44 : 38);
  });
}
