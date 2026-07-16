import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const preferencesCss = readFileSync(
  new URL('../../src/lib/prefs/preferences.css', import.meta.url),
  'utf8',
);

async function renderNarrowPreferences(
  page: import('@playwright/test').Page,
  options: { width?: number; rootFontSize?: number; longImportFeedback?: boolean } = {},
): Promise<void> {
  const width = options.width ?? 240;
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
  await page.setViewportSize({ width, height: 568 });
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
            ${longImportFeedback}
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
        --washi: #fff;
        --washi-dim: #ddd;
        --washi-mute: #aaa;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
      }
      html, body { margin: 0; width: 100%; }
      .onyx-sheet__body { width: 100%; padding: 1rem; overflow: auto; }
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
      tabsClientWidth: tabs.clientWidth,
      widestTab,
      segmentsClientWidth: segments.clientWidth,
      segmentsScrollWidth: segments.scrollWidth,
    };
  });

  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  expect(geometry.tabsClientWidth).toBeGreaterThanOrEqual(geometry.widestTab);
  expect(geometry.segmentsScrollWidth).toBe(geometry.segmentsClientWidth);
});

test('wraps import guidance, long filenames, and validation alerts at 200% text', async ({ page }) => {
  await renderNarrowPreferences(page, {
    width: 320,
    rootFontSize: 32,
    longImportFeedback: true,
  });

  const body = page.locator('.onyx-sheet__body');
  const geometry = await body.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
});
