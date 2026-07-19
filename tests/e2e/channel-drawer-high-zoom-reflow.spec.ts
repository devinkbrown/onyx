import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(new URL('../../src/shell/shell.css', import.meta.url), 'utf8');
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('keeps the channel drawer dense and keyboard reachable at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="shell">
      <div class="shell-sidebar-slot shell-sidebar--mobile-open">
        <aside class="shell-sidebar" aria-label="Channel drawer">
          <header class="shell-sidebar-head">
            <span class="shell-sidebar-network"><span class="shell-sidebar-dot"></span>Onyx</span>
            <span class="shell-notify-controls">
              <button class="shell-notify-btn" aria-label="All activity">A</button>
              <button class="shell-notify-btn" aria-label="Highlights only">H</button>
              <button class="shell-notify-btn" aria-label="Do not disturb">D</button>
            </span>
          </header>
          <div class="shell-sidebar-scroll" data-testid="drawer-scroll">
            <section class="shell-sidebar-section">
              <p class="shell-sidebar-section-label">Channels</p>
              <ul class="shell-channel-list">
                <li><button class="shell-channel-item shell-channel-item--active" aria-current="page"><span class="shell-channel-sigil">#</span><span class="shell-channel-name">root</span><span class="shell-channel-time">22:49</span></button></li>
                <li><button class="shell-channel-item shell-channel-item--unread"><span class="shell-channel-sigil">#</span><span class="shell-channel-name">accessibility</span><span class="shell-channel-badge">12</span></button></li>
                <li><button class="shell-channel-item"><span class="shell-channel-sigil">#</span><span class="shell-channel-name">release</span><span class="shell-channel-time">18:04</span></button></li>
                <li><button class="shell-channel-item"><span class="shell-channel-sigil">#</span><span class="shell-channel-name">support</span></button></li>
              </ul>
            </section>
            <section class="shell-sidebar-section">
              <p class="shell-sidebar-section-label">Direct messages</p>
              <ul class="shell-dm-list">
                <li><button class="shell-channel-item"><span class="shell-channel-sigil">@</span><span class="shell-channel-name">trev</span></button></li>
                <li><button class="shell-channel-item" data-testid="last-room"><span class="shell-channel-sigil">@</span><span class="shell-channel-name">vickysomething</span><span class="shell-channel-badge">3</span></button></li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
      <nav class="shell-mobile-nav" aria-label="Primary navigation">
        <button class="shell-mobile-nav-btn"><b aria-hidden="true">#</b>Channels</button>
      </nav>
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
        --space-7: 1.75rem;
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
        --shu: #f66;
        --shu-bright: #f99;
        --gold: #c90;
        --ok: #4ade80;
        --font-mono: monospace;
        --font-sans: sans-serif;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      p { margin: 0; }
      ${shellCss}
      ${accessibilityCss}
    `,
  });

  const drawer = page.getByRole('complementary', { name: 'Channel drawer' });
  const scroll = page.getByTestId('drawer-scroll');
  const rooms = drawer.locator('.shell-channel-item');
  const lastRoom = page.getByTestId('last-room');
  await expect(drawer).toBeVisible();
  await expect(rooms).toHaveCount(6);

  const initialGeometry = await drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const header = element.querySelector<HTMLElement>('.shell-sidebar-head')!;
    const scroller = element.querySelector<HTMLElement>('.shell-sidebar-scroll')!;
    const labels = Array.from(element.querySelectorAll<HTMLElement>('.shell-sidebar-section-label'));
    const rows = Array.from(element.querySelectorAll<HTMLElement>('.shell-channel-item'));
    const badge = element.querySelector<HTMLElement>('.shell-channel-badge')!;
    const time = element.querySelector<HTMLElement>('.shell-channel-time')!;
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      drawerLeft: rect.left,
      drawerRight: rect.right,
      drawerBottom: rect.bottom,
      headerHeight: header.getBoundingClientRect().height,
      headerFontSize: Number.parseFloat(getComputedStyle(element.querySelector<HTMLElement>('.shell-sidebar-network')!).fontSize),
      scrollerClientHeight: scroller.clientHeight,
      scrollerScrollHeight: scroller.scrollHeight,
      scrollerScrollWidth: scroller.scrollWidth,
      scrollerClientWidth: scroller.clientWidth,
      labelFontSizes: labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize)),
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      rowFontSizes: rows.map((row) => Number.parseFloat(getComputedStyle(row).fontSize)),
      sigilFontSizes: Array.from(element.querySelectorAll<HTMLElement>('.shell-channel-sigil')).map((sigil) => Number.parseFloat(getComputedStyle(sigil).fontSize)),
      badgeHeight: badge.getBoundingClientRect().height,
      badgeScrollHeight: badge.scrollHeight,
      badgeFontSize: Number.parseFloat(getComputedStyle(badge).fontSize),
      timeFontSize: Number.parseFloat(getComputedStyle(time).fontSize),
    };
  });

  expect(initialGeometry.documentScrollWidth).toBe(initialGeometry.documentClientWidth);
  expect(initialGeometry.drawerLeft).toBeGreaterThanOrEqual(0);
  expect(initialGeometry.drawerRight).toBeLessThanOrEqual(320);
  expect(initialGeometry.drawerBottom).toBeLessThanOrEqual(200);
  expect(initialGeometry.headerHeight).toBeLessThanOrEqual(64);
  expect(initialGeometry.headerFontSize).toBeGreaterThanOrEqual(14);
  expect(initialGeometry.headerFontSize).toBeLessThanOrEqual(16);
  expect(initialGeometry.scrollerScrollHeight).toBeGreaterThan(initialGeometry.scrollerClientHeight);
  expect(initialGeometry.scrollerScrollWidth).toBe(initialGeometry.scrollerClientWidth);
  for (const height of initialGeometry.rowHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(60);
  }
  for (const fontSize of initialGeometry.rowFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(16);
  }
  for (const fontSize of initialGeometry.sigilFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(16);
  }
  for (const fontSize of initialGeometry.labelFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(16);
  }
  expect(initialGeometry.badgeHeight).toBeGreaterThanOrEqual(24);
  expect(initialGeometry.badgeHeight).toBeGreaterThanOrEqual(initialGeometry.badgeScrollHeight);
  expect(initialGeometry.badgeFontSize).toBeGreaterThanOrEqual(12);
  expect(initialGeometry.badgeFontSize).toBeLessThanOrEqual(14);
  expect(initialGeometry.timeFontSize).toBeGreaterThanOrEqual(11);
  expect(initialGeometry.timeFontSize).toBeLessThanOrEqual(14);

  await lastRoom.focus();
  await expect(lastRoom).toBeFocused();
  const focusedGeometry = await scroll.evaluate((element) => {
    const scrollerRect = element.getBoundingClientRect();
    const focusedRect = (document.activeElement as HTMLElement).getBoundingClientRect();
    const style = getComputedStyle(document.activeElement as HTMLElement);
    return {
      scrollTop: element.scrollTop,
      focusedTop: focusedRect.top,
      focusedBottom: focusedRect.bottom,
      scrollerTop: scrollerRect.top,
      scrollerBottom: scrollerRect.bottom,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusedGeometry.scrollTop).toBeGreaterThan(0);
  expect(focusedGeometry.focusedTop).toBeGreaterThanOrEqual(focusedGeometry.scrollerTop);
  expect(focusedGeometry.focusedBottom).toBeLessThanOrEqual(focusedGeometry.scrollerBottom);
  expect(focusedGeometry.outlineStyle).not.toBe('none');
  expect(focusedGeometry.outlineWidth).toBeGreaterThanOrEqual(2);
});
