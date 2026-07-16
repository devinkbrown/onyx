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

test('contains the mini voice view at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <section
      class="voice-pip"
      role="region"
      aria-label="Mini voice view for Accessibility Voice Operations"
      tabindex="0"
      style="--voice-pip-x: 12px; --voice-pip-y: 12px"
    >
      <div class="voice-pip__handle">
        <div class="voice-pip__title">
          <span class="voice-pip__kicker">voice room</span>
          <span class="voice-pip__target">Accessibility-Voice-Operations</span>
        </div>
        <span class="voice-pip__status">3 live</span>
      </div>
      <div class="voice-pip__body">
        <div class="voice-pip__participants" aria-label="6 voice participants">
          <span class="voice-pip__participant"><span class="onyx-avatar onyx-avatar--sm">A</span></span>
          <span class="voice-pip__participant"><span class="onyx-avatar onyx-avatar--sm">B</span></span>
          <span class="voice-pip__participant"><span class="onyx-avatar onyx-avatar--sm">C</span></span>
          <span class="voice-pip__participant"><span class="onyx-avatar onyx-avatar--sm">D</span></span>
          <span class="voice-pip__participant"><span class="onyx-avatar onyx-avatar--sm">E</span></span>
          <span class="voice-pip__more">+1</span>
        </div>
        <div class="voice-pip__actions">
          <button class="onyx-button onyx-button--ghost onyx-button--sm">Mute</button>
          <button class="onyx-button onyx-button--danger onyx-button--sm">Leave</button>
        </div>
      </div>
    </section>
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

  const pip = page.getByRole('region', { name: 'Mini voice view for Accessibility Voice Operations' });
  const leave = page.getByRole('button', { name: 'Leave' });
  await pip.focus();
  await expect(pip).toBeFocused();
  await leave.focus();
  await expect(leave).toBeFocused();

  const geometry = await pip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const participants = element.querySelector<HTMLElement>('.voice-pip__participants')!;
    const avatars = Array.from(element.querySelectorAll<HTMLElement>('.onyx-avatar'));
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('.onyx-button'));
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      pipClientWidth: element.clientWidth,
      pipScrollWidth: element.scrollWidth,
      pipLeft: rect.left,
      pipRight: rect.right,
      pipTop: rect.top,
      pipBottom: rect.bottom,
      pipHeight: rect.height,
      participantsClientWidth: participants.clientWidth,
      participantsScrollWidth: participants.scrollWidth,
      avatarWidths: avatars.map((avatar) => avatar.getBoundingClientRect().width),
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.pipScrollWidth).toBe(geometry.pipClientWidth);
  expect(geometry.pipLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.pipRight).toBeLessThanOrEqual(320);
  expect(geometry.pipTop).toBeGreaterThanOrEqual(0);
  expect(geometry.pipBottom).toBeLessThanOrEqual(256);
  expect(geometry.pipHeight).toBeLessThanOrEqual(232);
  expect(geometry.participantsScrollWidth).toBe(geometry.participantsClientWidth);
  for (const width of geometry.avatarWidths) expect(width).toBeLessThanOrEqual(48);
  for (const height of geometry.buttonHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(60);
  }
});
