import { expect, test } from '@playwright/test';

test.describe('public route mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('/about/ keeps its contextual navigation available', async ({ page }) => {
    await page.goto('/about/');

    const nav = page.getByRole('navigation', { name: 'About topics' });
    await expect(nav).toBeVisible();

    const authoredPublicLinks = await nav.locator('a[href^="/"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
    expect(authoredPublicLinks.filter((href) =>
      /^\/(?:app|about|appearance|invite|roadmap|status|stats)(?:\?|#|$)/.test(href),
    )).toEqual([]);

    const target = nav.locator('a[href="#accessibility"]');
    await expect(target).toBeAttached();
    expect(await target.evaluate((element) => getComputedStyle(element).display)).not.toBe('none');
    await expect(target).toHaveCSS('min-height', '44px');
    await target.focus();
    await expect(target).toBeFocused();

    const geometry = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    }));

    expect(geometry.documentOverflow).toBe(0);
  });

  test('/onyxos/ keeps its contextual section navigation available', async ({ page }) => {
    await page.goto('/onyxos/');

    const nav = page.getByRole('navigation', { name: 'OnyxOS sections' });
    await expect(nav).toBeVisible();

    // Contextual navigation stays in-page; site destinations belong to the frame.
    const authoredPublicLinks = await nav.locator('a[href^="/"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
    expect(authoredPublicLinks).toEqual([]);

    for (const href of ['#onyx-native', '#method', '#source', '#workbench']) {
      const target = nav.locator(`a[href="${href}"]`);
      await expect(target).toBeAttached();
      expect(await target.evaluate((element) => getComputedStyle(element).display)).not.toBe('none');
      await expect(target).toHaveCSS('min-height', '44px');
      await target.focus();
      await expect(target).toBeFocused();
    }

    const geometry = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    }));

    expect(geometry.documentOverflow).toBe(0);
  });

  for (const route of [
    { path: '/roadmap/', target: '/about/' },
    { path: '/status/', target: '/about/' },
    { path: '/stats/', target: '/download/' },
    { path: '/invite/', target: '/about/' },
    { path: '/onyxos/', target: '/download/' },
    { path: '/accessibility/', target: '/about/' },
    { path: '/glossary/', target: '/about/' },
    { path: '/integrations/', target: '/about/' },
    { path: '/agents/', target: '/about/' },
    { path: '/guides/', target: '/about/' },
    { path: '/community/', target: '/about/' },
    { path: '/privacy/', target: '/about/' },
    { path: '/guidelines/', target: '/download/' },
    { path: '/contact/', target: '/about/' },
  ] as const) {
    test(`${route.path} keeps PublicFrame navigation available`, async ({ page }) => {
      await page.goto(route.path);

      const header = page.locator('.public-frame__header');
      const toggle = header.getByRole('button', { name: 'Open navigation menu' });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveCSS('min-height', '44px');
      await toggle.click();

      const nav = header.getByRole('navigation', { name: 'Primary navigation' });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Stats' })).toHaveCount(0);

      const target = nav.locator(`a[href="${route.target}"]`);
      await expect(target).toBeAttached();
      expect(await target.evaluate((element) => getComputedStyle(element).display)).not.toBe('none');
      await expect(target).toHaveCSS('min-height', '44px');
      await target.focus();
      await expect(target).toBeFocused();

      if (route.path === '/stats/') {
        const sections = page.getByRole('navigation', { name: 'Stats sections' });
        await expect(sections).toBeVisible();
        await expect(sections.getByRole('link', { name: /network pulse/i })).toHaveAttribute('href', '#network-overview');
      }

      const geometry = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(geometry.documentOverflow).toBe(0);

      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toBeFocused();
    });
  }
});
