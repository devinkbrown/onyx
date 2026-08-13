import { expect, test } from '@playwright/test';

/**
 * The four supporting public-contract routes. None of them appears in the
 * primary navigation, so each must still be fully operable from the shared
 * frame alone at 400% zoom.
 */
const routes = [
  { path: '/accessibility/', mainLabel: 'Onyx accessibility', heading: 'Accessibility' },
  { path: '/glossary/', mainLabel: 'Onyx glossary', heading: 'Glossary' },
  { path: '/integrations/', mainLabel: 'Onyx integrations', heading: 'Integrations' },
  { path: '/agents/', mainLabel: 'Onyx agent safety', heading: 'Agent safety' },
] as const;

for (const route of routes) {
  test(`keeps the PublicFrame ${route.path} route usable at 400% zoom`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto(route.path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '64px';
    });

    const frame = page.locator('.public-frame');
    const header = frame.locator('.public-frame__header');
    const footer = frame.locator('.public-frame__footer');
    const main = frame.getByRole('main', { name: route.mainLabel });
    const skip = frame.getByRole('link', { name: 'Skip to content' });
    const toggle = header.locator('.public-frame__menu-toggle');

    await expect(frame.locator('main#public-main')).toHaveCount(1);
    await expect(frame.locator('header.public-frame__header')).toHaveCount(1);
    await expect(frame.locator('footer.public-frame__footer')).toHaveCount(1);
    await expect(main.locator('main, header, footer, nav')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();

    // A supporting route is never a current primary destination.
    await expect(header.locator('[aria-current]')).toHaveCount(0);

    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#public-main$/u);
    await expect(main).toBeFocused();

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAccessibleName('Open navigation menu');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const primary = header.getByRole('navigation', { name: 'Primary navigation' });
    await expect(primary).toBeVisible();
    await expect(primary.locator(`a[href="${route.path}"]`)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

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

      return {
        documentClientWidth: viewportWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        // The eager global stylesheet clips the body horizontally, so the
        // document scroll width alone could hide a real overflow. Measure the
        // clipping element itself: a clip that hides nothing has no scroll.
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        // Nothing these routes own may add their own horizontal clip on top.
        routeOverflow: Array.from(document.querySelectorAll<HTMLElement>(
          '.public-frame, .public-frame__main, .ui-root.data-page',
        )).map((element) => ({
          className: element.className,
          overflowX: getComputedStyle(element).overflowX,
        })),
        mainCount: document.querySelectorAll('main').length,
        skipTargetCount: document.querySelectorAll('main#public-main').length,
        toggle: bounds(document.querySelector<HTMLElement>('.public-frame__menu-toggle')!),
        surfaces: Array.from(document.querySelectorAll<HTMLElement>(
          '.public-frame, .public-frame__header, .public-frame__main, .public-frame__footer,'
          + ' .ui-root.data-page, .data-hero, .r-section, .data-card',
        )).map((element) => ({
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          ...bounds(element),
        })),
        // Nothing on these routes is allowed an internal horizontal scroll.
        internalScrollers: Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
          .slice(0, 12),
        overflowers: Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
          .map((element) => ({
            label: `${element.tagName.toLowerCase()}.${element.className}:${element.textContent?.slice(0, 40)}`,
            left: element.getBoundingClientRect().left,
            right: element.getBoundingClientRect().right,
          }))
          .filter(({ left, right }) => left < -1 || right > viewportWidth + 1)
          .slice(0, 12),
        heroFontSize: Number.parseFloat(getComputedStyle(
          document.querySelector<HTMLElement>('.data-hero h1')!,
        ).fontSize),
        cardCopyFontSize: Number.parseFloat(getComputedStyle(
          document.querySelector<HTMLElement>('.data-card p')!,
        ).fontSize),
        controls: Array.from(document.querySelectorAll<HTMLElement>(
          '.public-frame__header a, .public-frame__header button, .public-frame__footer a',
        )).filter(visible).map(bounds),
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        forcedColors: matchMedia('(forced-colors: active)').matches,
      };
    });

    expect(geometry.reducedMotion).toBe(true);
    expect(geometry.forcedColors).toBe(true);
    expect(geometry.mainCount).toBe(1);
    expect(geometry.skipTargetCount).toBe(1);
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

    expect(geometry.toggle.width).toBe(44);
    expect(geometry.toggle.height).toBe(44);
    expect(geometry.heroFontSize).toBeLessThanOrEqual(64);
    expect(geometry.cardCopyFontSize).toBeGreaterThanOrEqual(16);
    expect(geometry.cardCopyFontSize).toBeLessThanOrEqual(24);

    for (const control of geometry.controls) {
      expect(control.left, control.text).toBeGreaterThanOrEqual(0);
      expect(control.right, control.text).toBeLessThanOrEqual(320);
      expect(control.width, control.text).toBeGreaterThanOrEqual(44);
      expect(control.height, control.text).toBeGreaterThanOrEqual(44);
    }
  });
}
