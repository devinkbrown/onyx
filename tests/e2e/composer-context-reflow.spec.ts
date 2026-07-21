import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(new URL('../../src/shell/shell.css', import.meta.url), 'utf8');
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains composer context and controls at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <form class="shell-composer" data-testid="composer">
      <div class="shell-composer-measure">
        <div class="shell-composer-topic">
          <span class="shell-composer-topic-label">Topic</span>
          <span class="shell-composer-topic-name">Accessibility review with a deliberately long title</span>
          <button class="shell-composer-topic-clear" type="button" aria-label="Clear topic">×</button>
        </div>
        <div class="shell-composer-context">
          <span class="shell-composer-context-label">Replying to Alexandria</span>
          <span class="shell-composer-context-text">A long quoted message stays contained and readable.</span>
          <button class="shell-composer-context-close" type="button" aria-label="Cancel reply">×</button>
        </div>
        <div class="shell-composer-inner">
          <button class="shell-composer-tool" type="button" aria-label="Attach file">+</button>
          <textarea class="shell-composer-textarea" aria-label="Message" rows="1">Ready to send</textarea>
          <button class="shell-composer-send" type="submit" aria-label="Send message">→</button>
        </div>
      </div>
    </form>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --mnav-h: 56px;
        --shell-measure: 100%;
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
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --gold: #c90;
        --gold-bright: #fd5;
        --font-sans: sans-serif;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      ${shellCss}
      ${accessibilityCss}
      .shell-composer { position: fixed; inset: auto 0 56px; }
      .mobile-nav-fixture { position: fixed; inset: auto 0 0; height: 56px; border-top: 1px solid CanvasText; }
    `,
  });

  const composer = page.getByTestId('composer');
  const controls = [
    page.getByRole('button', { name: 'Clear topic' }),
    page.getByRole('button', { name: 'Cancel reply' }),
    page.getByRole('button', { name: 'Attach file' }),
    page.getByRole('button', { name: 'Send message' }),
  ];
  for (const control of controls) {
    await control.focus();
    await expect(control).toBeFocused();
  }

  const geometry = await composer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const inner = element.querySelector<HTMLElement>('.shell-composer-inner')!;
    const focused = document.activeElement as HTMLElement;
    const focusedStyle = getComputedStyle(focused);
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('button'));
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      composerClientWidth: element.clientWidth,
      composerScrollWidth: element.scrollWidth,
      composerHeight: rect.height,
      composerTop: rect.top,
      composerBottom: rect.bottom,
      innerClientWidth: inner.clientWidth,
      innerScrollWidth: inner.scrollWidth,
      buttonSizes: buttons.map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return { width: buttonRect.width, height: buttonRect.height };
      }),
      labelFontSizes: [
        element.querySelector<HTMLElement>('.shell-composer-topic-label')!,
        element.querySelector<HTMLElement>('.shell-composer-context-label')!,
      ].map((label) => Number.parseFloat(getComputedStyle(label).fontSize)),
      textFontSize: Number.parseFloat(getComputedStyle(element.querySelector<HTMLElement>('.shell-composer-context-text')!).fontSize),
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.composerScrollWidth).toBe(geometry.composerClientWidth);
  expect(geometry.innerScrollWidth).toBe(geometry.innerClientWidth);
  expect(geometry.composerHeight).toBeLessThanOrEqual(200);
  expect(geometry.composerTop).toBeGreaterThanOrEqual(0);
  expect(geometry.composerBottom).toBeLessThanOrEqual(200);
  for (const size of geometry.buttonSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  for (const fontSize of geometry.labelFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(18);
  }
  expect(geometry.textFontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.textFontSize).toBeLessThanOrEqual(18);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});
