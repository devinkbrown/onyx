import { expect, test } from '@playwright/test';

test('contains the Theme Studio save workflow at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/appearance/');

  await page.getByText('Advanced mode', { exact: true }).click();
  const studio = page.getByTestId('theme-studio');
  await expect(studio).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });
  await studio.scrollIntoViewIfNeeded();

  await page.getByTestId('ts-save-btn').click();
  const nameInput = page.getByRole('textbox', { name: 'Theme name' });
  await expect(nameInput).toBeFocused();

  const geometry = await studio.evaluate((element) => {
    const studioRect = element.getBoundingClientRect();
    const footer = element.querySelector<HTMLElement>('.ts-footer')!;
    const footerRect = footer.getBoundingClientRect();
    const saveRow = element.querySelector<HTMLElement>('.ts-save-row')!;
    const saveRowRect = saveRow.getBoundingClientRect();
    const inputRect = element.querySelector<HTMLInputElement>('.ts-save-input')!.getBoundingClientRect();
    const preview = element.querySelector<HTMLElement>('.ts-preview')!;
    const buttons = Array.from(footer.querySelectorAll<HTMLElement>('.onyx-button'));
    const auditRows = Array.from(element.querySelectorAll<HTMLElement>('.ts-audit__row'));
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      studioClientWidth: element.clientWidth,
      studioScrollWidth: element.scrollWidth,
      studioLeft: studioRect.left,
      studioRight: studioRect.right,
      footerClientWidth: footer.clientWidth,
      footerScrollWidth: footer.scrollWidth,
      footerLeft: footerRect.left,
      footerRight: footerRect.right,
      saveRowClientWidth: saveRow.clientWidth,
      saveRowScrollWidth: saveRow.scrollWidth,
      saveRowLeft: saveRowRect.left,
      saveRowRight: saveRowRect.right,
      inputLeft: inputRect.left,
      inputRight: inputRect.right,
      inputHeight: inputRect.height,
      previewClientWidth: preview.clientWidth,
      previewScrollWidth: preview.scrollWidth,
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      auditWidths: auditRows.map((row) => [row.clientWidth, row.scrollWidth]),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.studioScrollWidth).toBe(geometry.studioClientWidth);
  expect(geometry.studioLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.studioRight).toBeLessThanOrEqual(320);
  expect(geometry.footerScrollWidth).toBe(geometry.footerClientWidth);
  expect(geometry.footerLeft).toBeGreaterThanOrEqual(geometry.studioLeft);
  expect(geometry.footerRight).toBeLessThanOrEqual(geometry.studioRight);
  expect(geometry.saveRowScrollWidth).toBe(geometry.saveRowClientWidth);
  expect(geometry.saveRowLeft).toBeGreaterThanOrEqual(geometry.footerLeft);
  expect(geometry.saveRowRight).toBeLessThanOrEqual(geometry.footerRight);
  expect(geometry.inputLeft).toBeGreaterThanOrEqual(geometry.saveRowLeft);
  expect(geometry.inputRight).toBeLessThanOrEqual(geometry.saveRowRight);
  expect(geometry.inputHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.inputHeight).toBeLessThanOrEqual(60);
  expect(geometry.previewScrollWidth).toBe(geometry.previewClientWidth);
  for (const height of geometry.buttonHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(60);
  }
  for (const [clientWidth, scrollWidth] of geometry.auditWidths) {
    expect(scrollWidth).toBe(clientWidth);
  }
});
