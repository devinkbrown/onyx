import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const voiceCss = readFileSync(
  new URL('../../src/shell/voice/voice.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains and scrolls the voice control rail at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="call-fixture" aria-label="Voice room">
      <div class="call-fixture__stage"></div>
      <div class="voice-bar" data-testid="voice-bar">
        <div class="voice-bar__identity">
          <div class="voice-bar__channel">
            <span class="voice-bar__channel-name">Accessibility lounge</span>
            <span class="voice-bar__count">12 connected</span>
          </div>
        </div>
        <div class="voice-bar__sep" aria-hidden="true"></div>
        <div class="voice-bar__controls" data-testid="voice-controls">
          <div class="voice-bar__group" role="group" aria-label="Media controls">
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Mute microphone">M</button>
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Deafen">D</button>
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Turn on camera">C</button>
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Share screen">S</button>
          </div>
          <div class="voice-bar__sep" aria-hidden="true"></div>
          <div class="voice-bar__group" role="group" aria-label="Engagement controls">
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Raise hand">H</button>
            <span class="onyx-popover">
              <button class="onyx-popover__trigger" aria-label="Send a reaction">
                <span class="onyx-icon-button onyx-icon-button--md" aria-hidden="true">R</span>
              </button>
            </span>
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Show live captions">CC</button>
          </div>
          <div class="voice-bar__sep" aria-hidden="true"></div>
          <div class="voice-bar__group" role="group" aria-label="View controls">
            <span class="onyx-popover">
              <button class="onyx-popover__trigger" aria-label="Spatial audio controls">
                <span class="onyx-icon-button onyx-icon-button--md" aria-hidden="true">A</span>
              </button>
            </span>
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Switch to spotlight layout">G</button>
            <button class="onyx-icon-button onyx-icon-button--md" aria-label="Open voice settings">V</button>
          </div>
          <div class="voice-bar__sep" aria-hidden="true"></div>
          <button class="onyx-icon-button voice-bar__leave" aria-label="Leave voice call">X</button>
        </div>
        <div class="voice-bar__right">
          <span class="voice-cq" aria-label="Connection quality">
            <span class="voice-cq__bars" aria-hidden="true">
              <span class="voice-cq__bar voice-cq__bar--on"></span>
              <span class="voice-cq__bar voice-cq__bar--on"></span>
              <span class="voice-cq__bar voice-cq__bar--on"></span>
              <span class="voice-cq__bar voice-cq__bar--off"></span>
            </span>
          </span>
        </div>
      </div>
      <nav class="mobile-nav-fixture" aria-label="Mobile navigation"></nav>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
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
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --lapis-deep: #075080;
        --shu: #c34;
        --ok: #4ade80;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      .call-fixture { height: 100%; display: flex; flex-direction: column; }
      .call-fixture__stage { flex: 1 1 auto; min-height: 0; }
      .mobile-nav-fixture {
        flex: 0 0 64px;
        height: 64px;
        border-top: 1px solid CanvasText;
      }
      ${primitivesCss}
      ${voiceCss}
      ${accessibilityCss}
    `,
  });

  const bar = page.getByTestId('voice-bar');
  const firstControl = page.getByRole('button', { name: 'Mute microphone' });
  const lastControl = page.getByRole('button', { name: 'Leave voice call' });

  await firstControl.focus();
  await expect(firstControl).toBeFocused();
  await lastControl.focus();
  await expect(lastControl).toBeFocused();

  const geometry = await bar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const controlsElement = element.querySelector<HTMLElement>('.voice-bar__controls')!;
    const controlsRect = controlsElement.getBoundingClientRect();
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const semanticControls = Array.from(element.querySelectorAll<HTMLElement>('button'));
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      barClientWidth: element.clientWidth,
      barScrollWidth: element.scrollWidth,
      barHeight: rect.height,
      barLeft: rect.left,
      barRight: rect.right,
      controlsClientWidth: controlsElement.clientWidth,
      controlsScrollWidth: controlsElement.scrollWidth,
      controlsScrollLeft: controlsElement.scrollLeft,
      focusedLeft: focusedRect.left,
      focusedRight: focusedRect.right,
      controlsLeft: controlsRect.left,
      controlsRight: controlsRect.right,
      outlineStyle: getComputedStyle(focused).outlineStyle,
      outlineWidth: Number.parseFloat(getComputedStyle(focused).outlineWidth),
      controlHeights: semanticControls.map((control) => control.getBoundingClientRect().height),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.barScrollWidth).toBe(geometry.barClientWidth);
  expect(geometry.barLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.barRight).toBeLessThanOrEqual(320);
  expect(geometry.barHeight).toBeLessThanOrEqual(64);
  expect(geometry.controlsScrollWidth).toBeGreaterThan(geometry.controlsClientWidth);
  expect(geometry.controlsScrollLeft).toBeGreaterThan(0);
  expect(geometry.focusedLeft).toBeGreaterThanOrEqual(geometry.controlsLeft);
  expect(geometry.focusedRight).toBeLessThanOrEqual(geometry.controlsRight);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
  for (const height of geometry.controlHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(48);
  }
});

test('gives a regular phone call one calm identity row and one control row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <div class="voice-bar" data-testid="voice-bar">
      <div class="voice-bar__identity">
        <div class="voice-bar__people">
          <div class="voice-bar__people-faces"><span class="onyx-avatar">DJ</span></div>
          <div class="voice-bar__channel">
            <span class="voice-bar__people-names">You</span>
            <span class="voice-bar__channel-name">#root</span>
            <span class="voice-bar__meta"><span class="voice-bar__timer">00:08</span><span class="voice-bar__dot">·</span><span class="voice-bar__count">1 person</span></span>
          </div>
        </div>
      </div>
      <div class="voice-bar__sep"></div>
      <div class="voice-bar__controls" data-testid="voice-controls">
        <div class="voice-bar__group">
          <button class="voice-bar__action onyx-icon-button"><span>M</span><span class="voice-bar__action-label">Mute</span></button>
          <button class="voice-bar__action onyx-icon-button"><span>V</span><span class="voice-bar__action-label">Video</span></button>
          <button class="voice-bar__action onyx-icon-button"><span>I</span><span class="voice-bar__action-label">Invite</span></button>
        </div>
        <div class="voice-bar__more-wrap"><button class="voice-bar__action onyx-icon-button"><span>…</span><span class="voice-bar__action-label">More</span></button></div>
        <button class="voice-bar__action voice-bar__leave onyx-icon-button"><span>L</span><span class="voice-bar__action-label">Leave</span></button>
      </div>
      <div class="voice-bar__right"><span class="voice-sec">S</span><span class="voice-cq">Q</span></div>
    </div>
  `);
  await page.addStyleTag({ content: `
    *, *::before, *::after { box-sizing: border-box; }
    :root { --ink:#020a12; --stone:#123; --stone-2:#234; --stone-3:#345; --paper:#fff; --paper-dim:#ddd; --paper-mute:#aaa; --seam:#456; --seam-faint:#234; --lapis:#168ce0; --lapis-bright:#55baff; --lapis-deep:#075080; --shu:#c34; --ok:#4ade80; --r-md:10px; --r-pill:999px; --font-sans:sans-serif; --font-mono:monospace; --dur:0ms; --ease:linear; }
    html, body { margin:0; width:100%; overflow:hidden; background:var(--ink); }
    .onyx-avatar { display:grid; place-items:center; width:36px; height:36px; border-radius:50%; }
    ${primitivesCss}
    ${voiceCss}
  ` });

  const geometry = await page.getByTestId('voice-bar').evaluate((element) => {
    const bar = element.getBoundingClientRect();
    const identity = element.querySelector<HTMLElement>('.voice-bar__identity')!.getBoundingClientRect();
    const controls = element.querySelector<HTMLElement>('.voice-bar__controls')!.getBoundingClientRect();
    const actions = Array.from(element.querySelectorAll<HTMLElement>('.voice-bar__action')).map((action) => action.getBoundingClientRect());
    return {
      barHeight: bar.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      identityBottom: identity.bottom,
      controlsTop: controls.top,
      actionTops: actions.map((action) => action.top),
      actionHeights: actions.map((action) => action.height),
    };
  });
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.barHeight).toBeGreaterThanOrEqual(88);
  expect(geometry.barHeight).toBeLessThanOrEqual(108);
  expect(geometry.controlsTop).toBeGreaterThanOrEqual(geometry.identityBottom);
  expect(Math.max(...geometry.actionTops) - Math.min(...geometry.actionTops)).toBeLessThanOrEqual(1);
  for (const height of geometry.actionHeights) expect(height).toBeGreaterThanOrEqual(44);
});
