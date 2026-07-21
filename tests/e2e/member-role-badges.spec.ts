import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const shellCss = readFileSync(
  new URL('../../src/shell/shell.css', import.meta.url),
  'utf8',
);

test('gives admin and half-op badges distinct intentional role treatments', async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <div class="role-badge-fixture">
      <span class="shell-role-badge shell-role-badge--admin">&amp;</span>
      <span class="shell-role-badge shell-role-badge--halfop">%</span>
    </div>
  `);
  await page.addStyleTag({
    content: `
      :root {
        --font-mono: monospace;
        --r-sm: 4px;
        --gold: rgb(218, 177, 83);
        --gold-deep: rgb(92, 63, 18);
        --paper-mute: rgb(136, 151, 166);
        --seam: rgb(74, 102, 124);
        --stone-2: rgb(20, 34, 46);
      }
      .role-badge-fixture { color: rgb(255, 255, 255); }
      ${shellCss}
    `,
  });

  const styles = await page.evaluate(() => {
    const read = (selector: string) => {
      const style = getComputedStyle(document.querySelector<HTMLElement>(selector)!);
      return {
        color: style.color,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
      };
    };
    return {
      inheritedColor: getComputedStyle(document.querySelector<HTMLElement>('.role-badge-fixture')!).color,
      admin: read('.shell-role-badge--admin'),
      halfop: read('.shell-role-badge--halfop'),
    };
  });

  expect(styles.admin.color).not.toBe(styles.inheritedColor);
  expect(styles.halfop.color).not.toBe(styles.inheritedColor);
  expect(styles.admin.color).not.toBe(styles.halfop.color);
  expect(styles.admin.borderColor).not.toBe(styles.halfop.borderColor);
  expect(styles.admin.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.halfop.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});
