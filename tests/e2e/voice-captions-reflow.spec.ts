import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const voiceOverlaysCss = readFileSync(
  new URL('../../src/shell/voice/overlays/voice-overlays.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains interactive live captions at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <section class="voice-captions" data-testid="captions-overlay">
      <div class="voice-captions__head">
        <span>Live captions</span>
        <div class="voice-captions__tools">
          <span>Server</span>
          <button class="voice-captions__copy" aria-label="Copy live caption transcript">Copy transcript</button>
        </div>
      </div>
      <p class="voice-captions__copy-state">On-device caption translation is available.</p>
      <div class="voice-captions__log" role="log" aria-label="Live captions">
        <p class="voice-caption-line">
          <span class="voice-caption-speaker">Alexandria</span>
          <span class="voice-caption-text">A long live caption that must remain readable at high zoom.</span>
          <button class="voice-captions__copy voice-caption-translate">Translate</button>
        </p>
        <p class="voice-caption-line">
          <span class="voice-caption-speaker">Borealis</span>
          <span class="voice-caption-text">The transcript stays above the mobile navigation.</span>
        </p>
      </div>
    </section>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --r-lg: 0.75rem;
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
        --shu: #c34;
        --font-display: sans-serif;
        --font-serif: serif;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .mobile-nav-fixture {
        position: fixed;
        inset: auto 0 0;
        height: 64px;
        border-top: 1px solid CanvasText;
      }
      ${primitivesCss}
      ${voiceOverlaysCss}
      ${accessibilityCss}
    `,
  });

  const overlay = page.getByTestId('captions-overlay');
  const copy = page.getByRole('button', { name: 'Copy live caption transcript' });
  const translate = page.getByRole('button', { name: 'Translate' });
  await copy.focus();
  await expect(copy).toBeFocused();
  await translate.focus();
  await expect(translate).toBeFocused();

  const geometry = await overlay.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const tools = element.querySelector<HTMLElement>('.voice-captions__tools')!;
    const translateButton = element.querySelector<HTMLElement>('.voice-caption-translate')!;
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('.voice-captions__copy'));
    const navRect = document.querySelector<HTMLElement>('.mobile-nav-fixture')!.getBoundingClientRect();
    const translateStyle = getComputedStyle(translateButton);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overlayClientWidth: element.clientWidth,
      overlayScrollWidth: element.scrollWidth,
      overlayLeft: rect.left,
      overlayRight: rect.right,
      overlayTop: rect.top,
      overlayBottom: rect.bottom,
      overlayHeight: rect.height,
      navTop: navRect.top,
      toolsClientWidth: tools.clientWidth,
      toolsScrollWidth: tools.scrollWidth,
      translatePointerEvents: translateStyle.pointerEvents,
      translateOutlineStyle: translateStyle.outlineStyle,
      translateOutlineWidth: Number.parseFloat(translateStyle.outlineWidth),
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.overlayScrollWidth).toBe(geometry.overlayClientWidth);
  expect(geometry.overlayLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.overlayRight).toBeLessThanOrEqual(320);
  expect(geometry.overlayTop).toBeGreaterThanOrEqual(0);
  expect(geometry.overlayBottom).toBeLessThanOrEqual(geometry.navTop - 8);
  expect(geometry.overlayHeight).toBeLessThanOrEqual(176);
  expect(geometry.toolsScrollWidth).toBe(geometry.toolsClientWidth);
  expect(geometry.translatePointerEvents).toBe('auto');
  expect(geometry.translateOutlineStyle).not.toBe('none');
  expect(geometry.translateOutlineWidth).toBeGreaterThanOrEqual(2);
  for (const height of geometry.buttonHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(60);
  }
});
