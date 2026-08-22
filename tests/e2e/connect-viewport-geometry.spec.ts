import { expect, test, type Page } from '@playwright/test';

async function openConnect(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connect-screen')).toBeVisible();
}

async function guestGeometry(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.conn-card')!;
    const body = document.querySelector<HTMLElement>('.conn-body')!;
    const submit = document.querySelector<HTMLElement>('[data-testid="conn-submit"]')!;
    const name = document.querySelector<HTMLElement>('#conn-nick')!;
    const room = document.querySelector<HTMLElement>('#conn-room')!;
    const signIn = document.querySelector<HTMLElement>('[data-testid="conn-mode-signin"]')!;
    const register = document.querySelector<HTMLElement>('[data-testid="conn-mode-register"]')!;
    const cardBox = card.getBoundingClientRect();
    const submitBox = submit.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect();
    const roomBox = room.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      cardTop: cardBox.top,
      cardBottom: cardBox.bottom,
      cardLeft: cardBox.left,
      cardRight: cardBox.right,
      submitTop: submitBox.top,
      submitBottom: submitBox.bottom,
      submitHeight: submitBox.height,
      nameTop: nameBox.top,
      nameBottom: nameBox.bottom,
      roomTop: roomBox.top,
      roomBottom: roomBox.bottom,
      signInVisible: signIn.getBoundingClientRect().height > 0,
      registerVisible: register.getBoundingClientRect().height > 0,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      copy: document.querySelector('[data-testid="connect-screen"]')?.textContent ?? '',
    };
  });
}

test.describe('Connect viewport geometry', () => {
  test('keeps guest join complete inside a 1440x900 viewport', async ({ page }) => {
    await openConnect(page, 1440, 900);
    const geometry = await guestGeometry(page);

    expect(geometry.copy).not.toMatch(/claim path|nearest node|handshake|tonight on the water/i);
    expect(geometry.documentHeight).toBe(geometry.viewportHeight);
    expect(geometry.cardTop).toBeGreaterThanOrEqual(0);
    expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.nameTop).toBeGreaterThanOrEqual(0);
    expect(geometry.roomBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.submitTop).toBeGreaterThanOrEqual(geometry.cardTop);
    expect(geometry.submitBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.submitHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.signInVisible).toBe(true);
    expect(geometry.registerVisible).toBe(true);
    expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth);
  });

  test('keeps guest join complete inside a 1366x768 laptop viewport', async ({ page }) => {
    await openConnect(page, 1366, 768);
    const geometry = await guestGeometry(page);

    expect(geometry.documentHeight).toBe(geometry.viewportHeight);
    expect(geometry.nameBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.roomBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.submitBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.submitHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.signInVisible).toBe(true);
    expect(geometry.registerVisible).toBe(true);
  });

  test('preserves the full-width 390px mobile front door with a reachable join action', async ({ page }) => {
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

    expect(beforeScroll.documentWidth).toBe(beforeScroll.viewportWidth);
    expect(beforeScroll.cardLeft).toBeCloseTo(0, 1);
    expect(beforeScroll.cardRight).toBeCloseTo(beforeScroll.viewportWidth, 1);
    expect(beforeScroll.cardMinHeight).toBe(`${beforeScroll.viewportHeight}px`);
    expect(beforeScroll.bodyOverflowY).not.toBe('auto');
    expect(beforeScroll.bodyPaddingTop).toBeGreaterThanOrEqual(20);
    expect(beforeScroll.bodyPaddingBottom).toBeGreaterThanOrEqual(14);

    const submit = page.getByTestId('conn-submit');
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.y).toBeGreaterThanOrEqual(0);
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(beforeScroll.viewportHeight);
    expect(submitBox!.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByRole('heading', { name: /join a room/i })).toBeVisible();
    await expect(page.getByLabel(/display name/i)).toBeVisible();
    await expect(page.getByTestId('conn-mode-signin')).toBeVisible();
    await expect(page.getByTestId('conn-mode-register')).toBeVisible();
  });

  test('keeps the join action reachable on a short 390x667 phone', async ({ page }) => {
    await openConnect(page, 390, 667);
    const submit = page.getByTestId('conn-submit');
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByLabel(/display name/i)).toBeVisible();
  });
});
