import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const voiceSettingsCss = readFileSync(
  new URL('../../src/shell/voice/settings/voice-settings.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains voice settings controls at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="settings-scroll">
      <div class="voice-settings">
        <section class="voice-settings__section">
          <h2 class="voice-settings__section-title">Audio devices</h2>
          <p class="voice-settings__section-copy">Choose devices and tune how Onyx handles room audio.</p>
          <div class="voice-settings__grid">
            <label class="onyx-field">
              <span class="onyx-field__label">Microphone input</span>
              <select class="voice-settings__select">
                <option>Studio microphone with a deliberately long device name</option>
              </select>
            </label>
            <label class="voice-settings__toggle">
              <input type="checkbox" checked>
              <span class="voice-settings__toggle-text">
                <span class="voice-settings__toggle-label">Echo cancellation</span>
                <span class="voice-settings__toggle-description">Reduce feedback from speakers during calls.</span>
              </span>
            </label>
          </div>
          <div class="voice-settings__key-row">
            <div class="onyx-field voice-settings__key-display">
              <span class="onyx-field__label">Talk key</span>
              <span class="voice-settings__key-value">Control+Shift+Space</span>
            </div>
            <button class="onyx-button onyx-button--ghost onyx-button--sm" type="button">Capture key</button>
          </div>
        </section>
      </div>
    </main>
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
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --shu: #c34;
        --font-display: sans-serif;
        --font-serif: serif;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .settings-scroll {
        position: fixed;
        top: 12px;
        right: 24px;
        bottom: 84px;
        left: 8px;
        overflow: auto;
      }
      ${primitivesCss}
      ${voiceSettingsCss}
      ${accessibilityCss}
    `,
  });

  const settings = page.locator('.voice-settings');
  const section = page.locator('.voice-settings__section');
  const select = page.getByRole('combobox', { name: 'Microphone input' });
  const toggle = page.getByRole('checkbox');
  await select.focus();
  await expect(select).toBeFocused();
  await toggle.focus();
  await expect(toggle).toBeFocused();

  const geometry = await settings.evaluate((element) => {
    const section = element.querySelector<HTMLElement>('.voice-settings__section')!;
    const sectionRect = section.getBoundingClientRect();
    const selectRect = element.querySelector<HTMLSelectElement>('.voice-settings__select')!.getBoundingClientRect();
    const toggleLabelRect = element.querySelector<HTMLElement>('.voice-settings__toggle')!.getBoundingClientRect();
    const toggleRect = element.querySelector<HTMLInputElement>('.voice-settings__toggle input')!.getBoundingClientRect();
    const keyRect = element.querySelector<HTMLElement>('.voice-settings__key-value')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      sectionClientWidth: section.clientWidth,
      sectionScrollWidth: section.scrollWidth,
      sectionLeft: sectionRect.left,
      sectionRight: sectionRect.right,
      selectLeft: selectRect.left,
      selectRight: selectRect.right,
      selectHeight: selectRect.height,
      toggleLabelHeight: toggleLabelRect.height,
      toggleWidth: toggleRect.width,
      toggleHeight: toggleRect.height,
      keyLeft: keyRect.left,
      keyRight: keyRect.right,
      keyHeight: keyRect.height,
    };
  });

  await expect(settings).toBeVisible();
  await expect(section).toBeVisible();
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.sectionScrollWidth).toBe(geometry.sectionClientWidth);
  expect(geometry.selectLeft).toBeGreaterThanOrEqual(geometry.sectionLeft);
  expect(geometry.selectRight).toBeLessThanOrEqual(geometry.sectionRight);
  expect(geometry.selectHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.selectHeight).toBeLessThanOrEqual(60);
  expect(geometry.toggleLabelHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.toggleWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.toggleWidth).toBeLessThanOrEqual(60);
  expect(geometry.toggleHeight).toBeGreaterThanOrEqual(24);
  expect(geometry.toggleHeight).toBeLessThanOrEqual(36);
  expect(geometry.keyLeft).toBeGreaterThanOrEqual(geometry.sectionLeft);
  expect(geometry.keyRight).toBeLessThanOrEqual(geometry.sectionRight);
  expect(geometry.keyHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.keyHeight).toBeLessThanOrEqual(60);
});
