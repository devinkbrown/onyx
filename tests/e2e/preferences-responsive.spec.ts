import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const preferencesCss = readFileSync(
  new URL('../../src/lib/prefs/preferences.css', import.meta.url),
  'utf8',
);

async function renderNarrowPreferences(
  page: import('@playwright/test').Page,
  options: { width?: number; height?: number; rootFontSize?: number; longImportFeedback?: boolean } = {},
): Promise<void> {
  const width = options.width ?? 240;
  const height = options.height ?? 568;
  const rootFontSize = options.rootFontSize ?? 24;
  const longFilename = `portable-${'x'.repeat(180)}.json`;
  const longImportFeedback = options.longImportFeedback
    ? `
      <div class="pref-import-review" role="group" aria-label="Review import">
        <p>${longFilename}: 0 messages, 0 targets, and 0 preference sets.</p>
      </div>
      <p class="pref-status pref-status--error" role="alert">
        ${longFilename} exceeds the portable JSON limit. Choose a smaller portable vault file.
      </p>
    `
    : '';
  const transferRows = Array.from(
    { length: 40 },
    (_, index) => `<p class="pref-desc">Portable transfer detail ${index + 1}: device-local data remains bounded and reviewable.</p>`,
  ).join('');
  await page.setViewportSize({ width, height });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="onyx-sheet__body">
      <div class="pref-panel">
        <div class="pref-category-nav">
          <nav class="pref-category-nav__landmark" aria-label="Preference categories">
            <p class="pref-category-nav__eyebrow">Browse</p>
            <div class="pref-category-tabs" role="tablist" aria-label="Preference categories">
              <button class="pref-category-tab" role="tab" aria-selected="true">Display</button>
              <button class="pref-category-tab" role="tab" aria-selected="false">Conversation</button>
              <button class="pref-category-tab" role="tab" aria-selected="false">History &amp; data</button>
              <button class="pref-category-tab" role="tab" aria-selected="false">Import &amp; export</button>
              <button class="pref-category-tab" role="tab" aria-selected="false">App &amp; tools</button>
              <button class="pref-category-tab" role="tab" aria-selected="false">Accessibility</button>
            </div>
          </nav>
          <button class="pref-reset pref-reset-all" type="button">Reset to defaults</button>
        </div>
        <div class="pref-category-content">
          <section class="pref-category-panel">
            <button class="pref-action-card" type="button">
              <span class="pref-action-card__icon" aria-hidden="true">◐</span>
              <span class="pref-action-card__body">
                <span class="pref-action-card__title">Theme and background</span>
                <span class="pref-desc">
                  Open Appearance for themes, room atmosphere, shared theme import, and background selection.
                </span>
              </span>
            </button>
            <section class="pref-group">
              <div class="pref-group-head">
                <h3 class="pref-label">Followed conversations</h3>
                <span class="pref-count">0 followed conversations</span>
              </div>
              <div class="pref-segments" role="radiogroup" aria-label="Message density">
                <button class="pref-segment" role="radio" aria-checked="true">Compact</button>
                <button class="pref-segment" role="radio" aria-checked="false">Cozy</button>
                <button class="pref-segment" role="radio" aria-checked="false">Roomy</button>
              </div>
            </section>
            <section class="pref-group pref-discord-bot-import">
              <p class="pref-desc">Leaving Discord? Export channels with DiscordChatExporter in JSON mode.</p>
              <ol class="pref-discord-bot-steps">
                <li>Create an application at <a href="https://discord.com/developers/applications">discord.com/developers</a>, then add a Bot to it.</li>
              </ol>
            </section>
            <div class="pref-transfer-workspace">
              <nav class="pref-transfer-tools" aria-label="Import and export tools">
                <p class="pref-transfer-tools__eyebrow">Choose a route</p>
                <div class="pref-transfer-tools__list">
                  <button class="pref-transfer-tool" aria-expanded="true">
                    <span class="pref-transfer-tool__label">Portable vault</span>
                    <span class="pref-transfer-tool__summary">Move Onyx device data</span>
                  </button>
                  <button class="pref-transfer-tool" aria-expanded="false"><span class="pref-transfer-tool__label">Discord JSON</span></button>
                  <button class="pref-transfer-tool" aria-expanded="false"><span class="pref-transfer-tool__label">Discord package</span></button>
                  <button class="pref-transfer-tool" aria-expanded="false"><span class="pref-transfer-tool__label">Discord bot</span></button>
                  <button class="pref-transfer-tool" aria-expanded="false"><span class="pref-transfer-tool__label">Slack JSON</span></button>
                  <button class="pref-transfer-tool" aria-expanded="false"><span class="pref-transfer-tool__label">Classic log</span></button>
                </div>
              </nav>
              <div class="pref-transfer-tool-content">
                <section class="pref-transfer-tool-panel" role="region" aria-label="Portable vault">
                  <h3 class="pref-label">Portable vault</h3>
                  ${transferRows}
                  <button type="button">Export vault</button>
                </section>
              </div>
            </div>
            ${longImportFeedback}
            <button type="button" data-last-preference>Final preference action</button>
          </section>
        </div>
      </div>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: ${rootFontSize}px;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --space-4: 1rem;
        --space-7: 2rem;
        --gap-section: 1rem;
        --r-sm: 0.25rem;
        --r-md: 0.5rem;
        --r-pill: 999px;
        --dur: 0ms;
        --ease: linear;
        --font-mono: monospace;
        --ink: #020a12;
        --line: #345;
        --seam: #567;
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
      }
      html, body { margin: 0; width: 100%; }
      .onyx-sheet__body { width: 100%; height: 100vh; padding: 1.25rem; overflow: auto; }
      ${preferencesCss}
    `,
  });
}

test('contains enlarged preference controls and leaves a usable mobile tab strip', async ({ page }) => {
  await renderNarrowPreferences(page);

  const geometry = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const tabs = document.querySelector<HTMLElement>('.pref-category-tabs')!;
    const widestTab = Math.max(
      ...Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'), (tab) => tab.offsetWidth),
    );
    const segments = document.querySelector<HTMLElement>('.pref-segments')!;
    return {
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      navPosition: getComputedStyle(document.querySelector<HTMLElement>('.pref-category-nav')!).position,
      tabsClientWidth: tabs.clientWidth,
      widestTab,
      segmentsClientWidth: segments.clientWidth,
      segmentsScrollWidth: segments.scrollWidth,
    };
  });

  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  expect(geometry.navPosition).toBe('sticky');
  expect(geometry.tabsClientWidth).toBeGreaterThanOrEqual(geometry.widestTab);
  expect(geometry.segmentsScrollWidth).toBe(geometry.segmentsClientWidth);
});

test('wraps import guidance, long filenames, and validation alerts at 200% text', async ({ page }) => {
  await renderNarrowPreferences(page, {
    width: 280,
    rootFontSize: 32,
    longImportFeedback: true,
  });

  const body = page.locator('.onyx-sheet__body');
  const geometry = await body.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  const appearanceAction = await page.locator('.pref-action-card').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(appearanceAction.scrollWidth).toBe(appearanceAction.clientWidth);
});

test('keeps categories and final controls reachable in a short 200% text split', async ({ page }) => {
  await renderNarrowPreferences(page, {
    width: 320,
    height: 320,
    rootFontSize: 32,
  });

  const body = page.locator('.onyx-sheet__body');
  const tabs = page.locator('.pref-category-tabs');
  const accessibility = page.getByRole('tab', { name: 'Accessibility' });
  const finalPreference = page.locator('[data-last-preference]');

  const initialGeometry = await page.evaluate(() => {
    const sheetBody = document.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const categoryTabs = document.querySelector<HTMLElement>('.pref-category-tabs')!;
    return {
      bodyClientHeight: sheetBody.clientHeight,
      bodyScrollHeight: sheetBody.scrollHeight,
      bodyClientWidth: sheetBody.clientWidth,
      bodyScrollWidth: sheetBody.scrollWidth,
      tabsClientWidth: categoryTabs.clientWidth,
      tabsScrollWidth: categoryTabs.scrollWidth,
    };
  });

  expect(initialGeometry.bodyScrollHeight).toBeGreaterThan(initialGeometry.bodyClientHeight);
  expect(initialGeometry.bodyScrollWidth).toBe(initialGeometry.bodyClientWidth);
  expect(initialGeometry.tabsScrollWidth).toBeGreaterThan(initialGeometry.tabsClientWidth);

  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const stickyGeometry = await page.evaluate(() => {
    const sheetBody = document.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const nav = document.querySelector<HTMLElement>('.pref-category-nav')!;
    const bodyRect = sheetBody.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    return {
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      navTop: navRect.top,
      navBottom: navRect.bottom,
    };
  });
  expect(stickyGeometry.navTop).toBeGreaterThanOrEqual(stickyGeometry.bodyTop);
  expect(stickyGeometry.navBottom).toBeLessThanOrEqual(stickyGeometry.bodyBottom);

  await body.evaluate((element) => {
    element.scrollTop = 0;
  });

  await accessibility.evaluate((element) => {
    element.scrollIntoView({ block: 'nearest', inline: 'end' });
    (element as HTMLElement).focus();
  });
  await expect(accessibility).toBeFocused();

  const tabStripGeometry = await tabs.evaluate((element) => {
    const lastTab = element.lastElementChild as HTMLElement;
    const stripRect = element.getBoundingClientRect();
    const tabRect = lastTab.getBoundingClientRect();
    return {
      stripLeft: stripRect.left,
      stripRight: stripRect.right,
      tabLeft: tabRect.left,
      tabRight: tabRect.right,
    };
  });
  expect(tabStripGeometry.tabLeft).toBeGreaterThanOrEqual(tabStripGeometry.stripLeft);
  expect(tabStripGeometry.tabRight).toBeLessThanOrEqual(tabStripGeometry.stripRight);

  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const finalBox = await finalPreference.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(finalBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(finalBox!.y + finalBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height);
});

for (const viewport of [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
] as const) {
  test(`${viewport.label}: bounds the active transfer workflow without page overflow`, async ({ page }) => {
    await renderNarrowPreferences(page, {
      width: viewport.width,
      height: viewport.height,
      rootFontSize: 16,
    });

    const geometry = await page.evaluate(() => {
      const sheetBody = document.querySelector<HTMLElement>('.onyx-sheet__body')!;
      const workspace = document.querySelector<HTMLElement>('.pref-transfer-workspace')!;
      const routeList = document.querySelector<HTMLElement>('.pref-transfer-tools__list')!;
      const content = document.querySelector<HTMLElement>('.pref-transfer-tool-content')!;
      const bodyRect = sheetBody.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: sheetBody.scrollWidth - sheetBody.clientWidth,
        workspaceLeft: workspaceRect.left,
        workspaceRight: workspaceRect.right,
        bodyLeft: bodyRect.left,
        bodyRight: bodyRect.right,
        routeListClientWidth: routeList.clientWidth,
        routeListScrollWidth: routeList.scrollWidth,
        contentClientHeight: content.clientHeight,
        contentScrollHeight: content.scrollHeight,
        contentOverflowY: getComputedStyle(content).overflowY,
      };
    });

    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
    expect(geometry.workspaceLeft).toBeGreaterThanOrEqual(geometry.bodyLeft);
    expect(geometry.workspaceRight).toBeLessThanOrEqual(geometry.bodyRight);
    expect(geometry.contentClientHeight).toBeLessThanOrEqual(geometry.viewportHeight * 0.59);
    expect(geometry.contentScrollHeight).toBeGreaterThan(geometry.contentClientHeight);
    expect(geometry.contentOverflowY).toBe('auto');

    const lastRoute = page.getByRole('button', { name: 'Classic log', exact: true });
    await lastRoute.evaluate((element) => {
      element.scrollIntoView({ block: 'nearest', inline: 'end' });
      (element as HTMLElement).focus();
    });
    await expect(lastRoute).toBeFocused();

    const routeGeometry = await page.locator('.pref-transfer-tools__list').evaluate((element) => {
      const last = element.lastElementChild as HTMLElement;
      const listRect = element.getBoundingClientRect();
      const routeRect = last.getBoundingClientRect();
      return {
        listLeft: listRect.left,
        listRight: listRect.right,
        routeLeft: routeRect.left,
        routeRight: routeRect.right,
      };
    });
    expect(routeGeometry.routeLeft).toBeGreaterThanOrEqual(routeGeometry.listLeft);
    expect(routeGeometry.routeRight).toBeLessThanOrEqual(routeGeometry.listRight);
    expect(geometry.routeListScrollWidth).toBeGreaterThanOrEqual(geometry.routeListClientWidth);
  });
}

test('keeps the active transfer route distinct in forced colors at 200% text', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await renderNarrowPreferences(page, {
    width: 320,
    height: 640,
    rootFontSize: 32,
  });

  const routeNav = page.getByRole('navigation', { name: 'Import and export tools' });
  const active = routeNav.getByRole('button', { name: 'Portable vault', exact: true });
  const inactive = routeNav.getByRole('button', { name: 'Discord JSON', exact: true });
  const visualState = await routeNav.evaluate((element) => {
    const selected = element.querySelector<HTMLElement>('[aria-expanded="true"]')!;
    const unselected = element.querySelector<HTMLElement>('[aria-expanded="false"]')!;
    const selectedStyle = getComputedStyle(selected);
    const unselectedStyle = getComputedStyle(unselected);
    const labels = Array.from(element.querySelectorAll<HTMLElement>('.pref-transfer-tool__label'));
    return {
      selectedBackground: selectedStyle.backgroundColor,
      unselectedBackground: unselectedStyle.backgroundColor,
      selectedColor: selectedStyle.color,
      unselectedColor: unselectedStyle.color,
      animationName: selectedStyle.animationName,
      transitionDuration: selectedStyle.transitionDuration,
      labelsFit: labels.every((label) => label.scrollWidth <= label.clientWidth),
    };
  });

  expect(visualState.selectedBackground).not.toBe(visualState.unselectedBackground);
  expect(visualState.selectedColor).not.toBe(visualState.unselectedColor);
  expect(visualState.animationName).toBe('none');
  expect(visualState.transitionDuration).toBe('0s');
  expect(visualState.labelsFit).toBe(true);

  await active.focus();
  await expect(active).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(inactive).toBeFocused();
});

test('contains every category and keeps the active one distinct at 400% text', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await renderNarrowPreferences(page, {
    width: 320,
    height: 720,
    rootFontSize: 64,
  });

  const sheetBody = page.locator('.onyx-sheet__body');
  const tablist = page.getByRole('tablist', { name: 'Preference categories' });
  const tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(6);

  const geometry = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const list = document.querySelector<HTMLElement>('.pref-category-tabs')!;
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')!;
    const unselected = list.querySelector<HTMLElement>('[aria-selected="false"]')!;
    const selectedStyle = getComputedStyle(selected);
    const unselectedStyle = getComputedStyle(unselected);
    return {
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      listClientWidth: list.clientWidth,
      selectedBackground: selectedStyle.backgroundColor,
      unselectedBackground: unselectedStyle.backgroundColor,
      selectedColor: selectedStyle.color,
      unselectedColor: unselectedStyle.color,
      selectedCount: list.querySelectorAll('[aria-selected="true"]').length,
    };
  });

  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  expect(geometry.selectedCount).toBe(1);
  expect(geometry.selectedBackground).not.toBe(geometry.unselectedBackground);
  expect(geometry.selectedColor).not.toBe(geometry.unselectedColor);

  for (let index = 0; index < 6; index += 1) {
    const tab = tabs.nth(index);
    await tab.evaluate((element) => {
      element.scrollIntoView({ block: 'nearest', inline: 'center' });
      element.focus();
    });
    await expect(tab).toBeFocused();
    const tabBox = await tab.boundingBox();
    const listBox = await tablist.boundingBox();
    expect(tabBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(tabBox!.x).toBeGreaterThanOrEqual(listBox!.x);
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width);
    expect(tabBox!.width).toBeLessThanOrEqual(geometry.listClientWidth);
  }

  await sheetBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(tablist).toBeVisible();
});
