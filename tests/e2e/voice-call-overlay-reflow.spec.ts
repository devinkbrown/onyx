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

test('contains incoming call content at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <div class="onyx-modal" role="dialog" aria-modal="true" aria-labelledby="call-title">
      <div class="onyx-modal__backdrop"></div>
      <div class="onyx-modal__dialog">
        <header class="onyx-modal__header">
          <div>
            <p class="onyx-modal__kicker">Onyx</p>
            <h2 id="call-title">Incoming call</h2>
            <p>Voice request over the media mesh.</p>
          </div>
          <button class="onyx-modal__close" aria-label="Decline call">×</button>
        </header>
        <div class="onyx-modal__body">
          <div class="voice-call-body" data-testid="incoming-call-overlay">
            <div class="voice-call-token" aria-hidden="true">
              <span class="onyx-avatar">AL</span>
            </div>
            <div class="voice-call-meta">
              <p class="voice-call-kicker">calling</p>
              <p class="voice-call-name">Alexandria-Accessibility-Operator</p>
              <p class="voice-call-subtext">Answer to join the voice session.</p>
            </div>
            <div class="voice-call-actions">
              <button class="onyx-button onyx-button--danger onyx-button--md" aria-label="Decline call from Alexandria">Decline</button>
              <button class="onyx-button onyx-button--primary onyx-button--md" aria-label="Accept call from Alexandria">Accept</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --pad-panel: 1.1rem;
        --pad-panel-lg: 1.5rem;
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
        --shu: #c34;
        --font-display: sans-serif;
        --font-serif: serif;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .onyx-avatar { display: grid; place-items: center; border-radius: 999px; }
      ${primitivesCss}
      ${voiceOverlaysCss}
      ${accessibilityCss}
    `,
  });

  const body = page.locator('.onyx-modal__body');
  const close = page.getByRole('button', { name: 'Decline call', exact: true });
  const accept = page.getByRole('button', { name: 'Accept call from Alexandria' });
  await accept.focus();
  await expect(accept).toBeFocused();
  await close.focus();
  await expect(close).toBeFocused();

  const geometry = await body.evaluate((element) => {
    const bodyRect = element.getBoundingClientRect();
    const tokenRect = element.querySelector<HTMLElement>('.voice-call-token')!.getBoundingClientRect();
    const avatarRect = element.querySelector<HTMLElement>('.onyx-avatar')!.getBoundingClientRect();
    const nameRect = element.querySelector<HTMLElement>('.voice-call-name')!.getBoundingClientRect();
    const actionRects = Array.from(element.querySelectorAll<HTMLElement>('.voice-call-actions .onyx-button'))
      .map((button) => button.getBoundingClientRect());
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: element.clientWidth,
      bodyScrollWidth: element.scrollWidth,
      bodyLeft: bodyRect.left,
      bodyRight: bodyRect.right,
      tokenLeft: tokenRect.left,
      tokenRight: tokenRect.right,
      tokenWidth: tokenRect.width,
      avatarWidth: avatarRect.width,
      avatarHeight: avatarRect.height,
      nameLeft: nameRect.left,
      nameRight: nameRect.right,
      actions: actionRects.map((rect) => ({ left: rect.left, right: rect.right, height: rect.height })),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  expect(geometry.tokenLeft).toBeGreaterThanOrEqual(geometry.bodyLeft);
  expect(geometry.tokenRight).toBeLessThanOrEqual(geometry.bodyRight);
  expect(geometry.tokenWidth).toBeLessThanOrEqual(96);
  expect(geometry.avatarWidth).toBeLessThanOrEqual(64);
  expect(geometry.avatarHeight).toBeLessThanOrEqual(64);
  expect(geometry.nameLeft).toBeGreaterThanOrEqual(geometry.bodyLeft);
  expect(geometry.nameRight).toBeLessThanOrEqual(geometry.bodyRight);
  for (const action of geometry.actions) {
    expect(action.left).toBeGreaterThanOrEqual(geometry.bodyLeft);
    expect(action.right).toBeLessThanOrEqual(geometry.bodyRight);
    expect(action.height).toBeGreaterThanOrEqual(44);
    expect(action.height).toBeLessThanOrEqual(60);
  }
});
