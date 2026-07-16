import { expect, test } from '@playwright/test';

const routes = [
  { path: '/roadmap/', heading: 'What shipped, what is next' },
  { path: '/status/', heading: 'Mesh health, in public' },
  { path: '/stats/', heading: 'The rooms in motion' },
  { path: '/invite/?join=%23root', heading: 'Join #root' },
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

    const geometry = await page.evaluate(() => {
      const surfaces = Array.from(document.querySelectorAll<HTMLElement>(
        '.data-hero, .data-summary, .data-card, .roadmap-track, .peer-table, .r-section',
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
      const heroTitle = document.querySelector<HTMLElement>('.data-hero h1')!;
      const cardCopy = document.querySelector<HTMLElement>('.data-card p');
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
