import { expect, test } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

const unknownPublicPath = '/route-terminus-browser-proof';

async function headState(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
  }));
}

test.describe('route terminus', () => {
  test.beforeEach(async ({ page }) => {
    await stubPublicFeeds(page);
  });

  test('restores known-route metadata through unknown → known → back/forward', async ({ page }) => {
    await page.goto(unknownPublicPath);
    const localCanonical = await page.evaluate(() => `${location.origin}/`);
    const main = page.getByRole('main', { name: 'Onyx page not found' });
    await expect(main).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Route terminus' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    await expect(main).not.toContainText(unknownPublicPath);
    await expect(page).toHaveTitle('Route terminus — Onyx');
    await expect.poll(() => headState(page)).toEqual({
      title: 'Route terminus — Onyx',
      canonical: null,
      ogUrl: null,
      robots: 'noindex,nofollow',
    });

    await page.getByRole('link', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(page).toHaveTitle('Onyx — live rooms, messages, and calls');
    await expect.poll(() => headState(page)).toEqual({
      title: 'Onyx — live rooms, messages, and calls',
      canonical: localCanonical,
      ogUrl: localCanonical,
      robots: null,
    });

    await page.goBack();
    await expect(page).toHaveURL(unknownPublicPath);
    await expect(page.getByRole('main', { name: 'Onyx page not found' })).toBeVisible();
    await expect.poll(() => headState(page)).toMatchObject({
      title: 'Route terminus — Onyx', canonical: null, ogUrl: null, robots: 'noindex,nofollow',
    });

    await page.goForward();
    await expect(page).toHaveURL(/\/$/u);
    await expect.poll(() => headState(page)).toMatchObject({
      title: 'Onyx — live rooms, messages, and calls', canonical: localCanonical, ogUrl: localCanonical, robots: null,
    });
  });

  test('keeps the terminus keyboard-recoverable without horizontal overflow at 320px / 400%', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto('/app/not-a-real-room');
    await page.evaluate(() => { document.documentElement.style.fontSize = '64px'; });

    const frame = page.locator('.public-frame');
    const main = frame.getByRole('main', { name: 'Onyx page not found' });
    const skip = frame.getByRole('link', { name: 'Skip to content' });
    const action = main.getByRole('link', { name: 'Open Onyx' });
    await expect(main).toBeVisible();
    await expect(action).toBeVisible();
    await expect(skip).toHaveAttribute('href', '#public-main');
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(main).toBeFocused();
    await action.focus();
    await expect(action).toBeFocused();

    const geometry = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const action = document.querySelector<HTMLElement>('.not-found-page__action')!;
      const actionStyle = getComputedStyle(action);
      const offenders = Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { name: element.className, left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
        })
        .filter((entry) => entry.left < -0.5 || entry.right > viewport + 0.5 || entry.scrollWidth > entry.clientWidth + 1);
      return {
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        forcedColors: matchMedia('(forced-colors: active)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        action: { width: action.getBoundingClientRect().width, height: action.getBoundingClientRect().height, outline: actionStyle.outlineStyle, outlineWidth: Number.parseFloat(actionStyle.outlineWidth) },
        offenders,
      };
    });
    expect(geometry.forcedColors).toBe(true);
    expect(geometry.reducedMotion).toBe(true);
    expect(geometry.scrollWidth, JSON.stringify(geometry.offenders)).toBe(geometry.viewport);
    expect(geometry.offenders).toEqual([]);
    expect(geometry.action.width).toBeGreaterThanOrEqual(44);
    expect(geometry.action.height).toBeGreaterThanOrEqual(44);
    expect(geometry.action.outline).not.toBe('none');
    expect(geometry.action.outlineWidth).toBeGreaterThanOrEqual(2);
  });
});
