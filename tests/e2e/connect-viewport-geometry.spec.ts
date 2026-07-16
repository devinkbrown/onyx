import { expect, test, type Page } from '@playwright/test';

async function openConnect(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connect-screen')).toBeVisible();
}

test.describe('Connect viewport geometry', () => {
  test('keeps the desktop card and primary guest action inside a 1440x900 viewport', async ({ page }) => {
    await openConnect(page, 1440, 900);

    const geometry = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.conn-card')!;
      const body = document.querySelector<HTMLElement>('.conn-body')!;
      const submit = document.querySelector<HTMLElement>('[data-testid="conn-submit"]')!;
      const cardBox = card.getBoundingClientRect();
      const submitBox = submit.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        cardTop: cardBox.top,
        cardBottom: cardBox.bottom,
        submitTop: submitBox.top,
        submitBottom: submitBox.bottom,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
      };
    });

    expect(geometry.documentHeight).toBe(geometry.viewportHeight);
    expect(geometry.cardTop).toBeGreaterThanOrEqual(0);
    expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.submitTop).toBeGreaterThanOrEqual(geometry.cardTop);
    expect(geometry.submitBottom).toBeLessThanOrEqual(geometry.cardBottom);
    expect(geometry.submitBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.bodyScrollHeight).toBeGreaterThan(geometry.bodyClientHeight);
    expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  });

  test('preserves the full-width, document-scrolling 390px mobile front door', async ({ page }) => {
    await openConnect(page, 390, 844);

    const beforeScroll = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.conn-card')!;
      const body = document.querySelector<HTMLElement>('.conn-body')!;
      const cardBox = card.getBoundingClientRect();
      const bodyStyle = getComputedStyle(body);
      return {
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        cardLeft: cardBox.left,
        cardRight: cardBox.right,
        cardMinHeight: getComputedStyle(card).minHeight,
        bodyOverflowY: bodyStyle.overflowY,
        bodyPaddingTop: Number.parseFloat(bodyStyle.paddingTop),
        bodyPaddingBottom: Number.parseFloat(bodyStyle.paddingBottom),
      };
    });

    expect(beforeScroll.documentHeight).toBeGreaterThan(beforeScroll.viewportHeight);
    expect(beforeScroll.documentWidth).toBe(beforeScroll.viewportWidth);
    expect(beforeScroll.cardLeft).toBeCloseTo(0, 1);
    expect(beforeScroll.cardRight).toBeCloseTo(beforeScroll.viewportWidth, 1);
    expect(beforeScroll.cardMinHeight).toBe(`${beforeScroll.viewportHeight}px`);
    expect(beforeScroll.bodyOverflowY).not.toBe('auto');
    expect(beforeScroll.bodyPaddingTop).toBeGreaterThanOrEqual(22);
    expect(beforeScroll.bodyPaddingBottom).toBeGreaterThanOrEqual(22);

    const submit = page.getByTestId('conn-submit');
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.y).toBeGreaterThanOrEqual(0);
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(beforeScroll.viewportHeight);
    expect(submitBox!.height).toBeGreaterThanOrEqual(44);
  });
});
