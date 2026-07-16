import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(
  new URL('../../src/shell/shell.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('keeps the member drawer dense and keyboard-scrollable at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="shell">
      <aside class="shell-members" role="dialog" aria-label="Member list for root" data-testid="members">
        <div class="shell-members-head" data-testid="members-head">
          <span class="shell-members-title">members</span>
          <span class="shell-members-head-actions">
            <span class="shell-members-head-meta"><span class="shell-members-count" aria-label="5 members">5</span></span>
            <button class="onyx-icon-button onyx-icon-button--sm shell-members-close" aria-label="Close member list">×</button>
          </span>
        </div>
        <div class="shell-members-scroll" role="region" aria-label="Channel members in root" data-testid="member-scroll">
          <section aria-labelledby="operators-label">
            <p class="shell-members-group-label" id="operators-label">Operators — 5</p>
            <ul class="shell-members-group-list" role="list">
              ${['Alexandria', 'Borealis', 'Cassiopeia', 'Delphinus', 'Eridanus'].map((nick, index) => `
                <li class="shell-members-group-item">
                  <span class="onyx-popover">
                    <button class="onyx-popover__trigger" aria-label="Open member details for ${nick}">
                      <span class="shell-member-row${index === 3 ? ' shell-member-row--away' : ''}">
                        <span class="shell-member-avatar">
                          <span class="onyx-avatar onyx-avatar--sm" aria-hidden="true">${nick[0]}</span>
                          <span class="shell-member-presence${index === 3 ? ' shell-member-presence--away' : ''}" aria-hidden="true"></span>
                        </span>
                        <span class="shell-member-nick">${nick} Accessibility Operator</span>
                        <span class="shell-role-badge shell-role-badge--op" aria-hidden="true">OP</span>
                      </span>
                    </button>
                  </span>
                </li>
              `).join('')}
            </ul>
          </section>
        </div>
      </aside>
      <nav class="shell-mobile-nav" aria-label="Mobile navigation"></nav>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --mnav-h: 56px;
        --shell-virtual-keyboard-inset: 0px;
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
        --gold: #c90;
        --gold-bright: #fd5;
        --ok: #4ade80;
        --font-sans: sans-serif;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      ${primitivesCss}
      ${shellCss}
      ${accessibilityCss}
    `,
  });

  const members = page.getByTestId('members');
  const scroll = page.getByTestId('member-scroll');
  const lastMember = page.getByRole('button', { name: 'Open member details for Eridanus' });
  await lastMember.focus();
  await expect(lastMember).toBeFocused();

  const geometry = await members.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const header = element.querySelector<HTMLElement>('.shell-members-head')!;
    const scrollElement = element.querySelector<HTMLElement>('.shell-members-scroll')!;
    const scrollRect = scrollElement.getBoundingClientRect();
    const triggers = Array.from(element.querySelectorAll<HTMLElement>('.shell-members-scroll .onyx-popover__trigger'));
    const rows = Array.from(element.querySelectorAll<HTMLElement>('.shell-member-row'));
    const avatars = Array.from(element.querySelectorAll<HTMLElement>('.onyx-avatar--sm'));
    const nicks = Array.from(element.querySelectorAll<HTMLElement>('.shell-member-nick'));
    const badges = Array.from(element.querySelectorAll<HTMLElement>('.shell-role-badge'));
    const groupLabel = element.querySelector<HTMLElement>('.shell-members-group-label')!;
    const close = element.querySelector<HTMLElement>('.shell-members-close')!;
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const focusedStyle = getComputedStyle(focused);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelLeft: rect.left,
      panelRight: rect.right,
      panelTop: rect.top,
      panelBottom: rect.bottom,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      headerHeight: header.getBoundingClientRect().height,
      scrollClientWidth: scrollElement.clientWidth,
      scrollScrollWidth: scrollElement.scrollWidth,
      scrollClientHeight: scrollElement.clientHeight,
      scrollScrollHeight: scrollElement.scrollHeight,
      scrollScrollTop: scrollElement.scrollTop,
      triggerSizes: triggers.map((trigger) => {
        const triggerRect = trigger.getBoundingClientRect();
        return { width: triggerRect.width, height: triggerRect.height };
      }),
      rowWidths: rows.map((row) => row.getBoundingClientRect().width),
      avatarSizes: avatars.map((avatar) => {
        const avatarRect = avatar.getBoundingClientRect();
        return { width: avatarRect.width, height: avatarRect.height };
      }),
      nickFontSizes: nicks.map((nick) => Number.parseFloat(getComputedStyle(nick).fontSize)),
      badgeSizes: badges.map((badge) => {
        const badgeRect = badge.getBoundingClientRect();
        return { width: badgeRect.width, height: badgeRect.height };
      }),
      groupLabelHeight: groupLabel.getBoundingClientRect().height,
      closeWidth: close.getBoundingClientRect().width,
      closeHeight: close.getBoundingClientRect().height,
      focusedTop: focusedRect.top,
      focusedBottom: focusedRect.bottom,
      scrollTop: scrollRect.top,
      scrollBottom: scrollRect.bottom,
      outlineStyle: focusedStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusedStyle.outlineWidth),
    };
  });

  await expect(scroll).toBeVisible();
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.panelLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.panelRight).toBeLessThanOrEqual(320);
  expect(geometry.panelTop).toBeGreaterThanOrEqual(0);
  expect(geometry.panelBottom).toBeLessThanOrEqual(200);
  expect(geometry.headerHeight).toBeLessThanOrEqual(64);
  expect(geometry.scrollScrollWidth).toBe(geometry.scrollClientWidth);
  expect(geometry.scrollScrollHeight).toBeGreaterThan(geometry.scrollClientHeight);
  expect(geometry.scrollScrollTop).toBeGreaterThan(0);
  for (const size of geometry.triggerSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeLessThanOrEqual(60);
  }
  for (const width of geometry.rowWidths) expect(width).toBeLessThanOrEqual(geometry.scrollClientWidth);
  for (const size of geometry.avatarSizes) {
    expect(size.width).toBeGreaterThanOrEqual(32);
    expect(size.width).toBeLessThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(32);
    expect(size.height).toBeLessThanOrEqual(44);
  }
  for (const fontSize of geometry.nickFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(18);
  }
  for (const size of geometry.badgeSizes) {
    expect(size.width).toBeLessThanOrEqual(28);
    expect(size.height).toBeLessThanOrEqual(28);
  }
  expect(geometry.groupLabelHeight).toBeLessThanOrEqual(44);
  expect(geometry.closeWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.closeHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.focusedTop).toBeGreaterThanOrEqual(geometry.scrollTop);
  expect(geometry.focusedBottom).toBeLessThanOrEqual(geometry.scrollBottom);
  expect(geometry.outlineStyle).not.toBe('none');
  expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2);
});
