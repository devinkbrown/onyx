import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const voiceOverlaysCss = readFileSync(
  new URL('../../src/shell/voice/overlays/voice-overlays.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('keeps reduced-motion voice reactions visible at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <div class="voice-reactions" data-testid="voice-reactions-overlay" aria-hidden="true">
      <span class="voice-reaction" style="--voice-reaction-start: 0px; --voice-reaction-drift: 0px">
        <span class="voice-reaction__emoji">👍</span>
        <span class="voice-reaction__nick">Alexandria-Accessibility-Operator</span>
      </span>
    </div>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --seam-faint: #234;
        --ink: #020a12;
        --stone: #123;
        --paper: #fff;
        --paper-dim: #ddd;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .mobile-nav-fixture {
        position: fixed;
        inset: auto 0 0;
        height: 64px;
        border-top: 1px solid CanvasText;
      }
      ${voiceOverlaysCss}
      ${accessibilityCss}
    `,
  });

  const overlay = page.getByTestId('voice-reactions-overlay');
  await expect(overlay).toBeAttached();
  const geometry = await overlay.evaluate((element) => {
    const overlayRect = element.getBoundingClientRect();
    const reaction = element.querySelector<HTMLElement>('.voice-reaction')!;
    const reactionRect = reaction.getBoundingClientRect();
    const emoji = element.querySelector<HTMLElement>('.voice-reaction__emoji')!;
    const nick = element.querySelector<HTMLElement>('.voice-reaction__nick')!;
    const nickRect = nick.getBoundingClientRect();
    const navRect = document.querySelector<HTMLElement>('.mobile-nav-fixture')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overlayTop: overlayRect.top,
      overlayBottom: overlayRect.bottom,
      reactionLeft: reactionRect.left,
      reactionRight: reactionRect.right,
      reactionTop: reactionRect.top,
      reactionBottom: reactionRect.bottom,
      navTop: navRect.top,
      emojiFontSize: Number.parseFloat(getComputedStyle(emoji).fontSize),
      nickWidth: nickRect.width,
      nickFontSize: Number.parseFloat(getComputedStyle(nick).fontSize),
      animationName: getComputedStyle(reaction).animationName,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.overlayTop).toBeGreaterThanOrEqual(0);
  expect(geometry.overlayBottom).toBeLessThanOrEqual(geometry.navTop - 8);
  expect(geometry.reactionLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.reactionRight).toBeLessThanOrEqual(320);
  expect(geometry.reactionTop).toBeGreaterThanOrEqual(0);
  expect(geometry.reactionBottom).toBeLessThanOrEqual(geometry.navTop - 8);
  expect(geometry.emojiFontSize).toBeLessThanOrEqual(40);
  expect(geometry.nickWidth).toBeLessThanOrEqual(140);
  expect(geometry.nickFontSize).toBeGreaterThanOrEqual(14);
  expect(geometry.animationName).toBe('voice-reaction-fade');
});
