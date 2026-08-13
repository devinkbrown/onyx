import { expect, test } from '@playwright/test';

test('keeps the PublicFrame OnyxOS route usable at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/onyxos/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const frame = page.locator('.public-frame');
  const header = frame.locator('.public-frame__header');
  const footer = frame.locator('.public-frame__footer');
  const main = frame.getByRole('main', { name: 'OnyxOS and Onyx' });
  const skip = frame.getByRole('link', { name: 'Skip to content' });
  const toggle = header.locator('.public-frame__menu-toggle');

  await expect(frame.locator('main#public-main')).toHaveCount(1);
  await expect(frame.locator('header.public-frame__header')).toHaveCount(1);
  await expect(frame.locator('footer.public-frame__footer')).toHaveCount(1);
  await expect(main.locator('main, header, footer')).toHaveCount(0);
  await expect(header.locator('a[href="/onyxos/"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: /communication,\s*at home in the system/i })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#public-main$/u);
  await expect(main).toBeFocused();

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName('Open navigation menu');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // Route-owned contextual navigation must stay reachable, never collapsed away.
  const sections = frame.getByRole('navigation', { name: 'OnyxOS sections' });
  await sections.scrollIntoViewIfNeeded();
  for (const [label, href] of [
    ['Onyx', '#onyx-native'],
    ['Method', '#method'],
    ['Source', '#source'],
    ['Workbench', '#workbench'],
  ] as const) {
    const link = sections.getByRole('link', { name: label });
    await expect(link).toHaveAttribute('href', href);
    expect(await link.evaluate((element) => getComputedStyle(element).display)).not.toBe('none');
    await link.focus();
    await expect(link).toBeFocused();
    const outline = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  }

  // The stage tabs keep a keyboard path and a cue that does not rely on colour.
  const tablist = frame.getByRole('tablist', { name: 'Compatibility stages' });
  await tablist.scrollIntoViewIfNeeded();
  const stageTabs = tablist.getByRole('tab');
  await expect(stageTabs).toHaveCount(4);
  await stageTabs.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(stageTabs.nth(1)).toBeFocused();
  await expect(stageTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(frame.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'onyxos-method-tab-implementation');
  const selectedCue = await stageTabs.nth(1).locator('span').first()
    .evaluate((element) => getComputedStyle(element).textDecorationLine);
  expect(selectedCue).toContain('underline');

  // Source specimen: present, and the one surface allowed to scroll internally.
  const specimen = frame.locator('.onyxos-source__sheet pre');
  await specimen.scrollIntoViewIfNeeded();
  await expect(specimen).toBeVisible();
  await expect(specimen).toHaveAttribute('tabindex', '0');
  await expect(frame.locator('.onyxos-source__facts')).toBeVisible();
  await expect(frame.getByRole('link', { name: /open the full source/i }))
    .toHaveAttribute('href', '/source/onyxos/safer_record_event_log_entry.c');
  await specimen.focus();
  await expect(specimen).toBeFocused();

  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('navigation', { name: 'Footer navigation' })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const bounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.getAttribute('aria-label') ?? element.className ?? element.textContent ?? '',
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    };
    const visible = (element: HTMLElement) => element.getClientRects().length > 0;
    const inSpecimen = (element: Element) => element.closest('.onyxos-source__sheet pre') !== null;
    const specimenElement = document.querySelector<HTMLElement>('.onyxos-source__sheet pre')!;

    return {
      documentClientWidth: viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      // The eager global stylesheet clips the body horizontally, so the
      // document scroll width alone could hide a real overflow. Measure the
      // clipping element itself: a clip that hides nothing has no scroll.
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      // Nothing this route owns may add its own horizontal clip on top.
      routeOverflow: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame, .public-frame__main, .onyxos-page',
      )).map((element) => ({
        className: element.className,
        overflowX: getComputedStyle(element).overflowX,
      })),
      mainCount: document.querySelectorAll('main').length,
      skipTargetCount: document.querySelectorAll('main#public-main').length,
      toggle: bounds(document.querySelector<HTMLElement>('.public-frame__menu-toggle')!),
      // Every route surface plus the shared frame; the specimen is checked apart.
      surfaces: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame, .public-frame__header, .public-frame__main, .public-frame__footer,'
        + ' .onyxos-page, .onyxos-sections, .onyxos-hero, .onyxos-native, .onyxos-native__grid,'
        + ' .onyxos-method, .onyxos-console, .onyxos-console__tabs, .onyxos-console__body,'
        + ' .onyxos-source, .onyxos-source__intro, .onyxos-source__facts, .onyxos-source__sheet,'
        + ' .onyxos-workbench, .onyxos-command, .onyxos-close',
      )).map((element) => ({
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        ...bounds(element),
      })),
      // Nothing outside the specimen may hold hidden horizontal content.
      internalScrollers: Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
        .filter((element) => !inSpecimen(element) && element.scrollWidth > element.clientWidth + 1)
        .map((element) => {
          const trail: string[] = [];
          for (let node: Element | null = element; node; node = node.parentElement) {
            trail.unshift(`${node.tagName.toLowerCase()}${node.className ? `.${node.className}` : ''}`);
          }
          return `${trail.join(' > ')} [${element.clientWidth}/${element.scrollWidth}] "${element.textContent?.slice(0, 30)}"`;
        })
        .slice(0, 12),
      overflowers: Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
        .filter((element) => !inSpecimen(element))
        .map((element) => ({
          label: `${element.tagName.toLowerCase()}.${element.className}:${element.textContent?.slice(0, 40)}`,
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
        }))
        .filter(({ left, right }) => left < -1 || right > viewportWidth + 1)
        .slice(0, 12),
      specimen: {
        scrollWidth: specimenElement.scrollWidth,
        clientWidth: specimenElement.clientWidth,
        overflowX: getComputedStyle(specimenElement).overflowX,
        right: specimenElement.getBoundingClientRect().right,
      },
      heroFontSize: Number.parseFloat(getComputedStyle(
        document.querySelector<HTMLElement>('.onyxos-hero h1')!,
      ).fontSize),
      nativeCopyFontSize: Number.parseFloat(getComputedStyle(
        document.querySelector<HTMLElement>('.onyxos-native__grid p')!,
      ).fontSize),
      controls: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame__header a, .public-frame__header button, .public-frame__footer a,'
        + ' .onyxos-sections a, .onyxos-button, .onyxos-console__tabs button',
      )).filter(visible).map(bounds),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forcedColors: matchMedia('(forced-colors: active)').matches,
    };
  });

  expect(geometry.reducedMotion).toBe(true);
  expect(geometry.forcedColors).toBe(true);
  expect(geometry.mainCount).toBe(1);
  expect(geometry.skipTargetCount).toBe(1);
  // The reflow must be real, not a clipped document.
  for (const surface of geometry.routeOverflow) {
    expect(['visible', 'auto'], surface.className).toContain(surface.overflowX);
  }
  expect(geometry.overflowers).toEqual([]);
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  expect(geometry.internalScrollers).toEqual([]);

  for (const surface of geometry.surfaces) {
    expect(surface.scrollWidth, surface.className).toBe(surface.clientWidth);
    expect(surface.left, surface.className).toBeGreaterThanOrEqual(0);
    expect(surface.right, surface.className).toBeLessThanOrEqual(320);
  }

  // Source lines are evidence: the specimen scrolls itself rather than reflowing.
  expect(geometry.specimen.overflowX).toBe('auto');
  expect(geometry.specimen.right).toBeLessThanOrEqual(320);
  expect(geometry.specimen.scrollWidth).toBeGreaterThan(geometry.specimen.clientWidth);

  expect(geometry.toggle.width).toBe(44);
  expect(geometry.toggle.height).toBe(44);
  expect(geometry.heroFontSize).toBeLessThanOrEqual(64);
  expect(geometry.nativeCopyFontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.nativeCopyFontSize).toBeLessThanOrEqual(24);

  for (const control of geometry.controls) {
    expect(control.left, control.text).toBeGreaterThanOrEqual(0);
    expect(control.right, control.text).toBeLessThanOrEqual(320);
    expect(control.width, control.text).toBeGreaterThanOrEqual(44);
    expect(control.height, control.text).toBeGreaterThanOrEqual(44);
  }
});
