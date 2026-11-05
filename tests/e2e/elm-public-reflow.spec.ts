// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

const routes = ['/', '/about/', '/download/', '/install/', '/guides/', '/community/', '/status/', '/stats/', '/roadmap/', '/onyxos/', '/invite/?join=%23root', '/appearance/', '/privacy/', '/guidelines/', '/contact/', '/accessibility/', '/glossary/', '/integrations/', '/agents/'];
for (const width of [320, 390, 768, 1440]) {
  test(`public pages retain their content at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
      await expect(page.getByRole('main')).toBeVisible();
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('main *')].filter(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.right > innerWidth + 1;
        }).slice(0, 5).map(element => element.className),
      }));
      expect(geometry.document, `${route}: ${geometry.overflow.join(', ')}`).toBeLessThanOrEqual(width);
      if (width === 390 && ['/', '/about/', '/invite/?join=%23root'].includes(route)) {
        await page.screenshot({ path: test.info().outputPath(`${route === '/' ? 'landing' : route.startsWith('/about') ? 'about' : 'invite'}.png`), fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}

test('primary action is legible and public navigation stays keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const contrast = await page.locator('.site-intro .site-cta-primary').evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
        const s = Number(value) / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    const fg = luminance(style.color), bg = luminance(style.backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.goto('/about/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  const toggle = page.locator('.site-menu-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#public-primary-navigation')).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

const contrastOf = (element: Element) => {
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
      const s = Number(value) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  const background = (node: Element | null): string => {
    for (let current = node; current; current = current.parentElement) {
      const value = getComputedStyle(current).backgroundColor;
      if (value && !/rgba\(.*,\s*0\)$/.test(value) && value !== 'transparent') return value;
    }
    return 'rgb(255, 255, 255)';
  };
  const fg = luminance(getComputedStyle(element).color), bg = luminance(background(element));
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
};

for (const colorScheme of ['light', 'dark'] as const) {
  test(`body text, muted text, and links meet AA in ${colorScheme}`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
    for (const selector of ['.site-lede', '.site-note', '.site-claim dd', '.site-ledger-go', '.site-foot-links a', '.site-intro .site-cta-primary']) {
      const ratio = await page.locator(selector).first().evaluate(contrastOf);
      expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    }
    await context.close();
  });
}

test('landing phone menu opens natively and masthead targets are 44px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  const summary = page.locator('.site-menu-details > summary');
  await expect(summary).toBeVisible();
  for (const target of [summary, page.locator('.site-mast .site-brand'), page.locator('.site-mast .site-mast-open')]) {
    const box = await target.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  }
  await summary.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('navigation', { name: 'Site menu' });
  await expect(panel).toBeInViewport();
  await expect(panel.getByRole('link', { name: 'House rules' })).toBeVisible();
  const linkBox = await panel.getByRole('link', { name: 'About' }).boundingBox();
  expect(linkBox!.height).toBeGreaterThanOrEqual(44);
});

test('wide screens keep the primary pair inline and hide the menu toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about/');
  await expect(page.locator('.site-menu-toggle')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Download' })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('.site-menu-details')).toBeHidden();
});

test('reduced motion disables transitions on public pages', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  const duration = await page.locator('.site-intro .site-cta-primary').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every(value => parseFloat(value) === 0)).toBe(true);
  await context.close();
});
