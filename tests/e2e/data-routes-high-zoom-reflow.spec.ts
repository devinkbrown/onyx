import { expect, test } from '@playwright/test';

const routes = [
  {
    path: '/roadmap/',
    heading: 'A place for your people that you can trust',
    heroSelector: '.r-section h1',
    copySelector: '.r-card p',
  },
  {
    path: '/status/',
    heading: 'Network health, in public',
    heroSelector: '.data-hero h1',
    copySelector: '.data-card p',
  },
  {
    path: '/stats/',
    heading: 'The rooms in motion',
    heroSelector: '.data-hero h1',
    copySelector: '.data-card p',
  },
  {
    path: '/invite/?join=%23root',
    heading: 'Join #root',
    heroSelector: '.data-hero h1',
    copySelector: '.data-card p',
  },
] as const;

for (const route of routes) {
  test(`${route.path} contains its data surfaces at 400% zoom`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto(route.path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '64px';
    });

    const heading = page.getByRole('heading', { name: route.heading, exact: true });
    await expect(heading).toBeVisible();
    await page.locator('.r-section').first().scrollIntoViewIfNeeded();

    const geometry = await page.evaluate(({ heroSelector, copySelector }) => {
      const surfaces = Array.from(document.querySelectorAll<HTMLElement>(
        '.data-hero, .data-summary, .data-card, .roadmap-track, .peer-table, .r-section, .r-card',
      )).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          left: rect.left,
          right: rect.right,
        };
      });
      const heroTitle = document.querySelector<HTMLElement>(heroSelector)!;
      const cardCopy = document.querySelector<HTMLElement>(copySelector);
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        heroFontSize: Number.parseFloat(getComputedStyle(heroTitle).fontSize),
        cardCopyFontSize: cardCopy === null
          ? null
          : Number.parseFloat(getComputedStyle(cardCopy).fontSize),
        overflowers: Array.from(document.body.querySelectorAll<HTMLElement>('*'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              className: `${element.tagName.toLowerCase()}.${element.className}:${element.textContent?.slice(0, 42)}`,
              left: rect.left,
              right: rect.right,
            };
          })
          .filter(({ left, right }) => left < -1 || right > document.documentElement.clientWidth + 1)
          .slice(0, 16),
        surfaces,
      };
    }, {
      heroSelector: route.heroSelector,
      copySelector: route.copySelector,
    });

    expect(geometry.documentScrollWidth, JSON.stringify(geometry.overflowers)).toBe(geometry.documentClientWidth);
    for (const surface of geometry.surfaces) {
      expect(surface.scrollWidth, surface.className).toBe(surface.clientWidth);
      expect(surface.left, surface.className).toBeGreaterThanOrEqual(0);
      expect(surface.right, surface.className).toBeLessThanOrEqual(320);
    }
    expect(geometry.heroFontSize).toBeLessThanOrEqual(64);
    if (geometry.cardCopyFontSize !== null) {
      expect(geometry.cardCopyFontSize).toBeGreaterThanOrEqual(16);
      expect(geometry.cardCopyFontSize).toBeLessThanOrEqual(24);
    }
  });
}
