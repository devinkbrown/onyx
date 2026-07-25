import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(new URL('../../src/shell/shell.css', import.meta.url), 'utf8');
const notifyCss = readFileSync(
  new URL('../../src/shell/ChannelNotifyControl.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('keeps channel notification and settings controls reachable at 400% reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="shell">
      <header class="shell-ribbon">
        <div class="shell-ribbon-inner">
          <div class="shell-ribbon-identity">
            <span class="shell-ribbon-channel"># accessibility</span>
          </div>
          <div class="shell-ribbon-right">
            <div class="shell-ribbon-group" role="group" aria-label="Channel actions">
              <button class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-call" aria-label="Join call">Call</button>
              <button class="shell-ribbon-iconbtn shell-ribbon-members" aria-label="12 members">12</button>
              <div class="chan-notify" role="radiogroup" aria-label="Notifications for #accessibility">
                <button class="chan-notify-seg" role="radio" aria-checked="true" aria-label="All messages">All</button>
                <button class="chan-notify-seg" role="radio" aria-checked="false" aria-label="Mentions only" tabindex="-1">@</button>
                <button class="chan-notify-seg" role="radio" aria-checked="false" aria-label="Mute" tabindex="-1">Mute</button>
              </div>
              <button class="shell-ribbon-iconbtn shell-ribbon-settings" aria-label="Channel settings">S</button>
            </div>
          </div>
        </div>
      </header>
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
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --line: #456;
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
      ${shellCss}
      ${notifyCss}
      ${accessibilityCss}
    `,
  });

  const ribbon = page.locator('.shell-ribbon');
  const actionScroller = page.locator('.shell-ribbon-right');
  const notify = page.getByRole('radiogroup', { name: 'Notifications for #accessibility' });
  const selected = page.getByRole('radio', { name: 'All messages' });
  const settings = page.getByRole('button', { name: 'Channel settings' });

  await selected.focus();
  await expect(selected).toBeFocused();
  const notifyGeometry = await notify.evaluate((element) => {
    const segments = Array.from(element.querySelectorAll<HTMLElement>('.chan-notify-seg'));
    return {
      segmentSizes: segments.map((segment) => {
        const segmentRect = segment.getBoundingClientRect();
        return [segmentRect.width, segmentRect.height];
      }),
    };
  });

  for (const [width, height] of notifyGeometry.segmentSizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(width).toBeLessThanOrEqual(52);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(52);
  }

  const radios = page.getByRole('radio');
  for (let index = 0; index < await radios.count(); index += 1) {
    const radio = radios.nth(index);
    await radio.focus();
    await expect(radio).toBeFocused();
    await radio.evaluate((control) => {
      const scroller = control.closest<HTMLElement>('.shell-ribbon-right')!;
      const scrollerRect = scroller.getBoundingClientRect();
      const controlRect = control.getBoundingClientRect();
      const desiredLeft = scroller.scrollLeft
        + controlRect.left
        - scrollerRect.left
        - ((scroller.clientWidth - controlRect.width) / 2);
      const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollLeft = Math.min(maxLeft, Math.max(0, desiredLeft));
    });
    const radioRect = await radio.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const scrollerRect = element.closest<HTMLElement>('.shell-ribbon-right')!.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        scrollerLeft: scrollerRect.left,
        scrollerRight: scrollerRect.right,
      };
    });
    expect(radioRect.left).toBeGreaterThanOrEqual(radioRect.scrollerLeft);
    expect(radioRect.right).toBeLessThanOrEqual(radioRect.scrollerRight + 1);
  }

  await settings.focus();
  await expect(settings).toBeFocused();
  const settingsGeometry = await settings.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scroller = element.closest<HTMLElement>('.shell-ribbon-right')!;
    const scrollerRect = scroller.getBoundingClientRect();
    const ribbonRect = element.closest<HTMLElement>('.shell-ribbon')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right,
      scrollerLeft: scrollerRect.left,
      scrollerRight: scrollerRect.right,
      scrollerClientWidth: scroller.clientWidth,
      scrollerScrollWidth: scroller.scrollWidth,
      ribbonLeft: ribbonRect.left,
      ribbonRight: ribbonRect.right,
    };
  });

  await expect(ribbon).toBeVisible();
  await expect(actionScroller).toBeVisible();
  expect(settingsGeometry.documentScrollWidth).toBe(settingsGeometry.documentClientWidth);
  expect(settingsGeometry.left).toBeGreaterThanOrEqual(settingsGeometry.scrollerLeft);
  expect(settingsGeometry.right).toBeLessThanOrEqual(settingsGeometry.scrollerRight + 1);
  expect(settingsGeometry.left).toBeGreaterThanOrEqual(settingsGeometry.ribbonLeft);
  expect(settingsGeometry.right).toBeLessThanOrEqual(settingsGeometry.ribbonRight);
  expect(settingsGeometry.scrollerScrollWidth).toBeGreaterThan(settingsGeometry.scrollerClientWidth);
});
