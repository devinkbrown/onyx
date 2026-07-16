import { expect, test } from '@playwright/test';

test.describe('theme motion accessibility', () => {
  test('keeps the OS reduced-motion duration above inline theme tokens', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/');
    await expect(page.getByTestId('connect-screen')).toBeVisible();

    const motion = await page.evaluate(() => {
      const root = document.documentElement;
      const button = document.querySelector<HTMLElement>('.onyx-button');
      const durations = button ? getComputedStyle(button).transitionDuration.split(', ') : [];
      return {
        mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        inlineDuration: root.style.getPropertyValue('--dur').trim(),
        computedDuration: getComputedStyle(root).getPropertyValue('--dur').trim(),
        transitionDurations: durations,
      };
    });

    expect(motion.mediaMatches).toBe(true);
    expect(motion.inlineDuration).not.toBe('0ms');
    expect(motion.computedDuration).toBe('0s');
    expect(motion.transitionDurations.length).toBeGreaterThan(0);
    expect(motion.transitionDurations.every((duration) => duration === '0s')).toBe(true);
  });
});
