import { expect, test } from '@playwright/test';

const routes = [
  { path: '/about/', navName: 'About page navigation', target: '#accessibility' },
  { path: '/roadmap/', navName: 'Primary', target: '/about/' },
  { path: '/status/', navName: 'Primary', target: '/roadmap/' },
  { path: '/stats/', navName: 'Primary', target: '/status/' },
] as const;

test.describe('public route mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of routes) {
    test(`${route.path} keeps its contextual navigation available`, async ({ page }) => {
      await page.goto(route.path);

      const nav = page.getByRole('navigation', { name: route.navName });
      await expect(nav).toBeVisible();

      const authoredPublicLinks = await nav.locator('a[href^="/"]').evaluateAll((links) =>
        links.map((link) => link.getAttribute('href') ?? ''),
      );
      expect(authoredPublicLinks.filter((href) =>
        /^\/(?:app|about|appearance|invite|roadmap|status|stats)(?:\?|#|$)/.test(href),
      )).toEqual([]);

      const target = nav.locator(`a[href="${route.target}"]`);
      await expect(target).toBeAttached();
      expect(await target.evaluate((element) => getComputedStyle(element).display)).not.toBe('none');
      await expect(target).toHaveCSS('min-height', '44px');
      await target.focus();
      await expect(target).toBeFocused();

      const geometry = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        navOverflows: Array.from(document.querySelectorAll<HTMLElement>('.r-status nav'))
          .some((element) => element.scrollWidth > element.clientWidth),
      }));

      expect(geometry.documentOverflow).toBe(0);
      expect(geometry.navOverflows).toBe(true);
    });
  }
});
