import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const primitivesCss = readFileSync(
  new URL('../../src/primitives/primitives.css', import.meta.url),
  'utf8',
);
const accessibilityCss = readFileSync(
  new URL('../../src/styles/a11y-media.css', import.meta.url),
  'utf8',
);

test('contains field guidance and errors at 400% short reflow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.setContent(`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <main class="settings-scroll">
      <div class="onyx-field">
        <label class="onyx-field__label" for="certificate">Certificate identity fingerprint</label>
        <p class="onyx-field__description" id="certificate-description">
          Paste the identity supplied by your network operator.
        </p>
        <input
          id="certificate"
          class="onyx-field__input"
          aria-invalid="true"
          aria-describedby="certificate-description certificate-error"
          value="sha256:0123456789abcdef0123456789abcdef"
        >
        <p class="onyx-field__error" id="certificate-error">
          ERR_CERTIFICATE_IDENTITY_REJECTED_0123456789ABCDEF
        </p>
      </div>
    </main>
  `);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        font-size: 64px;
        --r-md: 0.5rem;
        --dur: 0ms;
        --ease: linear;
        --seam: #456;
        --seam-faint: #234;
        --ink: #020a12;
        --stone: #123;
        --stone-2: #234;
        --paper: #fff;
        --paper-dim: #ddd;
        --paper-mute: #aaa;
        --shu: #c34;
        --shu-bright: #f66;
        --lapis: #168ce0;
        --lapis-bright: #55baff;
        --font-mono: monospace;
      }
      html, body { margin: 0; width: 100%; }
      .settings-scroll {
        position: fixed;
        top: 12px;
        right: 24px;
        bottom: 84px;
        left: 8px;
        overflow: auto;
      }
      ${primitivesCss}
      ${accessibilityCss}
    `,
  });

  const field = page.locator('.onyx-field');
  const input = page.getByRole('textbox', { name: 'Certificate identity fingerprint' });
  await input.focus();
  await expect(input).toBeFocused();

  const geometry = await field.evaluate((element) => {
    const fieldRect = element.getBoundingClientRect();
    const inputRect = element.querySelector<HTMLInputElement>('.onyx-field__input')!.getBoundingClientRect();
    const copy = Array.from(element.querySelectorAll<HTMLElement>(
      '.onyx-field__label, .onyx-field__description, .onyx-field__error',
    ));
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      fieldLeft: fieldRect.left,
      fieldRight: fieldRect.right,
      inputLeft: inputRect.left,
      inputRight: inputRect.right,
      inputHeight: inputRect.height,
      copyWidths: copy.map((item) => [item.clientWidth, item.scrollWidth]),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.fieldLeft).toBeGreaterThanOrEqual(8);
  expect(geometry.fieldRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.inputLeft).toBeGreaterThanOrEqual(geometry.fieldLeft);
  expect(geometry.inputRight).toBeLessThanOrEqual(geometry.fieldRight);
  expect(geometry.inputHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.inputHeight).toBeLessThanOrEqual(60);
  for (const [clientWidth, scrollWidth] of geometry.copyWidths) {
    expect(scrollWidth).toBe(clientWidth);
  }
});
