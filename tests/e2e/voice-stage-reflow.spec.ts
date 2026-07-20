import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const voiceCss = readFileSync(
  new URL('../../src/shell/voice/voice.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);
const voiceStageDockRule = voiceCss.match(/\.voice-stage\s*\{[^}]+\}/u)?.[0];
if (!voiceStageDockRule) throw new Error('voice-stage docking rule is missing');

test('reflows participant tiles and exposes their actions at 400% short zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="voice-stage" data-testid="voice-stage">
      <div class="voice-stage__grid" data-count="4" role="list" aria-label="Call participants" data-testid="grid">
        ${['Alexandria', 'Borealis', 'Cassiopeia', 'Delphinus'].map((nick, index) => `
          <article class="voice-tile" role="listitem" aria-label="${nick}">
            <div class="voice-tile__avatar-wrap">
              <span class="onyx-avatar" aria-hidden="true">${nick[0]}</span>
              <span class="voice-tile__camera-off">camera off</span>
            </div>
            <div class="voice-tile__topbar">
              <span class="voice-tile__hand-badge" aria-label="Hand raised">H</span>
              <span class="voice-tile__quality voice-tile__quality--t0" aria-label="Good connection quality">
                <span class="on"></span><span class="on"></span><span class="on"></span>
              </span>
              <button class="voice-tile__pip" aria-label="Open ${nick} in picture-in-picture">P</button>
              <button class="voice-tile__pin" aria-label="Pin ${nick}" data-pin-index="${index}">I</button>
            </div>
            <div class="voice-tile__bar">
              <span class="voice-tile__nick">${nick} Accessibility Operator</span>
              <span class="voice-tile__badges">
                <span class="voice-tile__badge" aria-label="Muted">
                  <svg class="voice-tile__badge-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /></svg>
                </span>
              </span>
            </div>
          </article>
        `).join('')}
      </div>
    </main>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --seam: #456;
        --seam-faint: #234;
        --stone-line: #567;
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
        --gold: #c90;
        --gold-bright: #fd5;
        --shu: #c34;
        --ok: #4ade80;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      .voice-stage { height: 192px !important; }
      .onyx-avatar {
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        border: 1px solid CanvasText;
      }
      .mobile-nav-fixture {
        position: fixed;
        inset: auto 0 0;
        height: 64px;
        border-top: 1px solid CanvasText;
      }
      ${voiceCss}
      ${accessibilityCss}
    `,
  });

  const stage = page.getByTestId('voice-stage');
  const firstPin = page.getByRole('button', { name: 'Pin Alexandria' });
  const lastPin = page.getByRole('button', { name: 'Pin Delphinus' });
  await firstPin.focus();
  await expect(firstPin).toBeFocused();
  await lastPin.focus();
  await expect(lastPin).toBeFocused();

  const geometry = await stage.evaluate((element) => {
    const grid = element.querySelector<HTMLElement>('.voice-stage__grid')!;
    const gridRect = grid.getBoundingClientRect();
    const tiles = Array.from(element.querySelectorAll<HTMLElement>('.voice-tile'));
    const actions = Array.from(element.querySelectorAll<HTMLElement>('.voice-tile__pin, .voice-tile__pip'));
    const bars = Array.from(element.querySelectorAll<HTMLElement>('.voice-tile__bar'));
    const icons = Array.from(element.querySelectorAll<HTMLElement>('.voice-tile__badge-icon'));
    const nicks = Array.from(element.querySelectorAll<HTMLElement>('.voice-tile__nick'));
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const focusedStyle = getComputedStyle(focused);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      stageClientWidth: element.clientWidth,
      stageScrollWidth: element.scrollWidth,
      gridClientWidth: grid.clientWidth,
      gridScrollWidth: grid.scrollWidth,
      gridClientHeight: grid.clientHeight,
      gridScrollHeight: grid.scrollHeight,
      gridScrollTop: grid.scrollTop,
      tileWidths: tiles.map((tile) => tile.getBoundingClientRect().width),
      tileHeights: tiles.map((tile) => tile.getBoundingClientRect().height),
      actionSizes: actions.map((action) => {
        const rect = action.getBoundingClientRect();
        return { width: rect.width, height: rect.height, opacity: Number.parseFloat(getComputedStyle(action).opacity) };
      }),
      barHeights: bars.map((bar) => bar.getBoundingClientRect().height),
      iconSizes: icons.map((icon) => {
        const rect = icon.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      nickFontSizes: nicks.map((nick) => Number.parseFloat(getComputedStyle(nick).fontSize)),
      focusedLeft: focusedRect.left,
      focusedRight: focusedRect.right,
      focusedTop: focusedRect.top,
      focusedBottom: focusedRect.bottom,
      gridLeft: gridRect.left,
      gridRight: gridRect.right,
      gridTop: gridRect.top,
      gridBottom: gridRect.bottom,
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.stageScrollWidth).toBe(geometry.stageClientWidth);
  expect(geometry.gridScrollWidth).toBe(geometry.gridClientWidth);
  expect(geometry.gridScrollHeight).toBeGreaterThan(geometry.gridClientHeight);
  expect(geometry.gridScrollTop).toBeGreaterThan(0);
  for (const width of geometry.tileWidths) expect(width).toBeGreaterThanOrEqual(geometry.gridClientWidth - 2);
  for (const height of geometry.tileHeights) expect(height).toBeGreaterThanOrEqual(160);
  for (const action of geometry.actionSizes) {
    expect(action.width).toBeGreaterThanOrEqual(44);
    expect(action.height).toBeGreaterThanOrEqual(44);
    expect(action.opacity).toBe(1);
  }
  for (const height of geometry.barHeights) expect(height).toBeLessThanOrEqual(48);
  for (const size of geometry.iconSizes) {
    expect(size.width).toBeLessThanOrEqual(24);
    expect(size.height).toBeLessThanOrEqual(24);
  }
  for (const fontSize of geometry.nickFontSizes) expect(fontSize).toBeGreaterThanOrEqual(14);
  expect(geometry.focusedLeft).toBeGreaterThanOrEqual(geometry.gridLeft);
  expect(geometry.focusedRight).toBeLessThanOrEqual(geometry.gridRight);
  expect(geometry.focusedTop).toBeGreaterThanOrEqual(geometry.gridTop);
  expect(geometry.focusedBottom).toBeLessThanOrEqual(geometry.gridBottom);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});

test('keeps the spotlight filmstrip pointer and keyboard reachable at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="voice-stage voice-stage--spotlight" data-testid="voice-stage">
      <div class="voice-stage__primary">
        <article class="voice-tile" aria-label="Spotlight participant">
          <div class="voice-tile__topbar">
            <button class="voice-tile__pip" aria-label="Open spotlight participant in picture-in-picture">P</button>
            <button class="voice-tile__pin" aria-label="Unpin spotlight participant">I</button>
          </div>
          <div class="voice-tile__bar"><span class="voice-tile__nick">Spotlight Accessibility Operator</span></div>
        </article>
      </div>
      <div class="voice-stage__filmstrip" role="list" aria-label="Other participants" data-testid="filmstrip">
        ${['Borealis', 'Cassiopeia', 'Delphinus'].map((nick) => `
          <article class="voice-tile voice-stage__filmstrip-tile" role="listitem" aria-label="${nick}">
            <div class="voice-tile__topbar">
              <button class="voice-tile__pip" aria-label="Open ${nick} in picture-in-picture">P</button>
              <button class="voice-tile__pin" aria-label="Pin ${nick}">I</button>
            </div>
            <div class="voice-tile__bar"><span class="voice-tile__nick">${nick} Accessibility Operator</span></div>
          </article>
        `).join('')}
      </div>
    </main>
    <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
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
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      .voice-stage { height: 192px !important; }
      .mobile-nav-fixture {
        position: fixed;
        inset: auto 0 0;
        height: 64px;
        border-top: 1px solid CanvasText;
      }
      ${voiceCss}
      ${accessibilityCss}
    `,
  });

  const stage = page.getByTestId('voice-stage');
  const filmstrip = page.getByTestId('filmstrip');
  const lastPin = page.getByRole('button', { name: 'Pin Delphinus' });
  await lastPin.focus();
  await expect(lastPin).toBeFocused();

  const geometry = await stage.evaluate((element) => {
    const stageRect = element.getBoundingClientRect();
    const strip = element.querySelector<HTMLElement>('.voice-stage__filmstrip')!;
    const stripRect = strip.getBoundingClientRect();
    const stripTiles = Array.from(strip.querySelectorAll<HTMLElement>('.voice-tile'));
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const focusedStyle = getComputedStyle(focused);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      stageClientWidth: element.clientWidth,
      stageScrollWidth: element.scrollWidth,
      stageClientHeight: element.clientHeight,
      stageScrollHeight: element.scrollHeight,
      stageScrollTop: element.scrollTop,
      stageOverflowY: getComputedStyle(element).overflowY,
      stripClientWidth: strip.clientWidth,
      stripScrollWidth: strip.scrollWidth,
      stripScrollLeft: strip.scrollLeft,
      stripGap: Number.parseFloat(getComputedStyle(strip).gap),
      stripPaddingBottom: Number.parseFloat(getComputedStyle(strip).paddingBottom),
      stripTileWidths: stripTiles.map((tile) => tile.getBoundingClientRect().width),
      stripTileHeights: stripTiles.map((tile) => tile.getBoundingClientRect().height),
      focusedLeft: focusedRect.left,
      focusedRight: focusedRect.right,
      focusedTop: focusedRect.top,
      focusedBottom: focusedRect.bottom,
      stripLeft: stripRect.left,
      stripRight: stripRect.right,
      stageTop: stageRect.top,
      stageBottom: stageRect.bottom,
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  await expect(filmstrip).toBeVisible();
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.stageScrollWidth).toBe(geometry.stageClientWidth);
  expect(geometry.stageScrollHeight).toBeGreaterThan(geometry.stageClientHeight);
  expect(geometry.stageOverflowY).toBe('auto');
  expect(geometry.stageScrollTop).toBeGreaterThan(0);
  expect(geometry.stripScrollWidth).toBeGreaterThan(geometry.stripClientWidth);
  expect(geometry.stripScrollLeft).toBeGreaterThan(0);
  expect(geometry.stripGap).toBeLessThanOrEqual(8);
  expect(geometry.stripPaddingBottom).toBeLessThanOrEqual(4);
  for (const width of geometry.stripTileWidths) {
    expect(width).toBeGreaterThanOrEqual(220);
    expect(width).toBeLessThanOrEqual(geometry.stageClientWidth - 16);
  }
  for (const height of geometry.stripTileHeights) expect(height).toBeGreaterThanOrEqual(160);
  expect(geometry.focusedLeft).toBeGreaterThanOrEqual(geometry.stripLeft);
  expect(geometry.focusedRight).toBeLessThanOrEqual(geometry.stripRight);
  expect(geometry.focusedTop).toBeGreaterThanOrEqual(geometry.stageTop);
  expect(geometry.focusedBottom).toBeLessThanOrEqual(geometry.stageBottom);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});

test('docks the video tray without covering the chat feed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`
    <!doctype html>
    <main class="conversation">
      <section class="voice-stage" aria-label="Voice call participants">
        <div class="voice-stage__grid" data-count="1">
          <article class="voice-tile">Video preview</article>
        </div>
      </section>
      <section class="message-feed" aria-label="Message history">Visible chat</section>
      <form class="composer"><input aria-label="Message channel"></form>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        --space-2: 8px;
        --space-3: 12px;
        --r-md: 8px;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
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
      }
      html, body { margin: 0; height: 100%; }
      .conversation { display: flex; flex-direction: column; height: 720px; overflow: hidden; }
      .message-feed { flex: 1; min-height: 0; overflow: auto; background: #08121d; }
      .composer { flex: none; height: 56px; }
      ${voiceStageDockRule}
    `,
  });

  const geometry = await page.locator('.conversation').evaluate((conversation) => {
    const stage = conversation.querySelector<HTMLElement>('.voice-stage')!.getBoundingClientRect();
    const feed = conversation.querySelector<HTMLElement>('.message-feed')!.getBoundingClientRect();
    const composer = conversation.querySelector<HTMLElement>('.composer')!.getBoundingClientRect();
    return {
      stageBottom: stage.bottom,
      stageHeight: stage.height,
      feedTop: feed.top,
      feedBottom: feed.bottom,
      feedHeight: feed.height,
      composerTop: composer.top,
    };
  });

  expect(geometry.stageBottom).toBeLessThanOrEqual(geometry.feedTop);
  expect(geometry.feedBottom).toBeLessThanOrEqual(geometry.composerTop);
  expect(geometry.stageHeight).toBeLessThanOrEqual(800 * 0.42);
  expect(geometry.feedHeight).toBeGreaterThan(260);
  await expect(page.getByRole('region', { name: 'Message history' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message channel' })).toBeVisible();
});
