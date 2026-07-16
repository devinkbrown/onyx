import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(new URL('../../src/shell/shell.css', import.meta.url), 'utf8');
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('keeps every ribbon capability reachable at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="shell">
      <header class="shell-ribbon" data-testid="ribbon">
        <div class="shell-ribbon-inner">
          <div class="shell-ribbon-identity">
            <span class="shell-ribbon-channel"><span class="shell-ribbon-sigil">#</span>root</span>
          </div>
          <div class="shell-ribbon-right" data-testid="rail">
            <div class="shell-ribbon-group" role="group" aria-label="Channel">
              <button class="shell-ribbon-event-chip" aria-label="Live event: Accessibility review">
                <span class="shell-ribbon-event-mark" aria-hidden="true"></span>
                <span class="shell-ribbon-event-text">Accessibility review</span>
              </button>
              <button class="shell-ribbon-voice-chip" aria-label="3 people in voice">
                <span class="shell-ribbon-voice-mark" aria-hidden="true"></span>
                <span class="shell-ribbon-voice-text">3 in voice</span>
              </button>
              <button class="shell-ribbon-iconbtn shell-ribbon-settings" aria-label="Channel settings">
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
              </button>
            </div>
            <span class="shell-ribbon-divider" aria-hidden="true"></span>
            <div class="shell-ribbon-group" role="group" aria-label="Workspace">
              <button class="shell-ribbon-iconbtn shell-ribbon-appearance" aria-label="Appearance — theme and background">
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
              </button>
              <button class="shell-ribbon-iconbtn shell-ribbon-preferences" aria-label="Open preferences">
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /></svg>
              </button>
              <button class="shell-ribbon-account" aria-label="Account: Alexandria — open account panel">
                <span class="shell-ribbon-account-text"><span class="shell-ribbon-account-name">Alexandria</span></span>
              </button>
            </div>
            <span class="shell-ribbon-divider" aria-hidden="true"></span>
            <span class="shell-ribbon-conn" data-state="connected" role="status" aria-label="Connection: connected">
              <span class="shell-ribbon-conn-label">connected</span>
            </span>
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
        --washi: #fff;
        --washi-dim: #ddd;
        --washi-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --gold: #c90;
        --gold-bright: #fd5;
        --ok: #4ade80;
        --font-mono: monospace;
        --font-sans: sans-serif;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      ${shellCss}
      ${accessibilityCss}
    `,
  });

  const ribbon = page.getByTestId('ribbon');
  const rail = page.getByTestId('rail');
  const event = page.getByRole('button', { name: 'Live event: Accessibility review' });
  const voice = page.getByRole('button', { name: '3 people in voice' });
  const account = page.getByRole('button', { name: 'Account: Alexandria — open account panel' });
  const connection = page.getByRole('status', { name: 'Connection: connected' });

  await expect(event).toBeVisible();
  await expect(voice).toBeVisible();
  await expect(account).toBeVisible();
  await expect(connection).toBeVisible();
  await event.focus();
  await expect(event).toBeFocused();
  await account.focus();
  await expect(account).toBeFocused();
  await rail.evaluate((element) => { element.scrollLeft = element.scrollWidth; });

  const geometry = await ribbon.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scroller = element.querySelector<HTMLElement>('.shell-ribbon-right')!;
    const scrollerRect = scroller.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('.shell-ribbon-right button'));
    const accountElement = element.querySelector<HTMLElement>('.shell-ribbon-account')!;
    const accountRect = accountElement.getBoundingClientRect();
    const conn = element.querySelector<HTMLElement>('.shell-ribbon-conn')!;
    const connRect = conn.getBoundingClientRect();
    const focusedStyle = getComputedStyle(document.activeElement as HTMLElement);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      ribbonLeft: rect.left,
      ribbonRight: rect.right,
      ribbonHeight: rect.height,
      railClientWidth: scroller.clientWidth,
      railScrollWidth: scroller.scrollWidth,
      railScrollLeft: scroller.scrollLeft,
      railLeft: scrollerRect.left,
      railRight: scrollerRect.right,
      buttonSizes: buttons.map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return { width: buttonRect.width, height: buttonRect.height };
      }),
      iconSizes: Array.from(element.querySelectorAll<SVGElement>('.shell-ribbon-ico')).map((icon) => {
        const iconRect = icon.getBoundingClientRect();
        return { width: iconRect.width, height: iconRect.height };
      }),
      textFontSizes: [
        element.querySelector<HTMLElement>('.shell-ribbon-event-text')!,
        element.querySelector<HTMLElement>('.shell-ribbon-voice-text')!,
        element.querySelector<HTMLElement>('.shell-ribbon-account-name')!,
        element.querySelector<HTMLElement>('.shell-ribbon-conn-label')!,
      ].map((text) => Number.parseFloat(getComputedStyle(text).fontSize)),
      accountLeft: accountRect.left,
      accountRight: accountRect.right,
      connectionLeft: connRect.left,
      connectionRight: connRect.right,
      connectionHeight: connRect.height,
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.ribbonLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.ribbonRight).toBeLessThanOrEqual(320);
  expect(geometry.ribbonHeight).toBeLessThanOrEqual(60);
  expect(geometry.railScrollWidth).toBeGreaterThan(geometry.railClientWidth);
  expect(geometry.railScrollLeft).toBeGreaterThan(0);
  for (const size of geometry.buttonSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  for (const size of geometry.iconSizes) {
    expect(size.width).toBeLessThanOrEqual(24);
    expect(size.height).toBeLessThanOrEqual(24);
  }
  for (const fontSize of geometry.textFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(16);
  }
  expect(geometry.accountLeft).toBeGreaterThanOrEqual(geometry.railLeft);
  expect(geometry.accountRight).toBeLessThanOrEqual(geometry.railRight);
  expect(geometry.connectionLeft).toBeGreaterThanOrEqual(geometry.railLeft);
  expect(geometry.connectionRight).toBeLessThanOrEqual(geometry.railRight);
  expect(geometry.connectionHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});
