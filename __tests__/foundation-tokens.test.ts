import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Package A design-token foundation', () => {
  const root = path.resolve(__dirname, '..');
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  const layout = readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');

  it('uses next/font variables without a Google Fonts stylesheet', () => {
    expect(layout).toContain('Fraunces');
    expect(layout).toContain('JetBrains_Mono');
    expect(layout).toContain("variable: '--font-inter'");
    expect(layout).toContain("variable: '--font-fraunces'");
    expect(layout).toContain("variable: '--font-jbmono'");
    expect(layout).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('keeps Inter wired through the body font token', () => {
    expect(css).toContain('--font-ui: var(--font-inter),system-ui,sans-serif;');
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-ui\);/s);
    expect(css).not.toContain('--ui-font: system-ui');
    expect([...css.matchAll(/(^|\n)\s*:root\s*\{/g)]).toHaveLength(1);
  });

  it('publishes the shared token and utility contract', () => {
    [
      '--text-2xs',
      '--text-hero',
      '--sp-1',
      '--sp-16',
      '--elev-tint-1',
      '--elev-highlight',
      '--elev-shadow-3',
      '--lux',
      '--mention-bg',
      '--reaction-bg',
      '--reaction-bg-active',
      '--unread',
      '--scrim',
      '--glass-blur',
      '--t-micro',
      '--t-overlay-in',
      '--ease-spring',
      '--z-toast',
      '--r-2xl',
      '--gold',
      '--t-fast',
      '--bg-4',
      '--radius-xl',
      '.elev-1',
      '.elev-2',
      '.elev-3',
      '.glass-2',
      '.label-caps',
    ].forEach((token) => expect(css, token).toContain(token));
  });

  it('defines luxury, elevation, mention, and reaction tokens for every theme surface', () => {
    const themeIds = ['abyss', 'midnight', 'bathyal', 'coral', 'kelp', 'brine', 'onyx', 'amoled', 'arctic', 'ash', 'light'];
    for (const themeId of themeIds) {
      const match = css.match(new RegExp(`\\[data-theme="${themeId}"\\]\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
      expect(match, `${themeId} theme exists`).toBeTruthy();
      const block = match?.[1] ?? '';
      expect(block, `${themeId} --lux`).toContain('--lux:');
      expect(block, `${themeId} --elev-tint-1`).toContain('--elev-tint-1:');
      expect(block, `${themeId} --mention-bg`).toContain('--mention-bg:');
      expect(block, `${themeId} --reaction-bg`).toContain('--reaction-bg:');
    }

    const highContrast = css.match(/\[data-contrast="high"\],\s*\n\[data-high-contrast="true"\]\s*\{([\s\S]*?)\n\}/);
    expect(highContrast?.[1]).toContain('--lux:');
    expect(highContrast?.[1]).toContain('--elev-tint-1:');
    expect(highContrast?.[1]).toContain('--mention-bg:');
    expect(highContrast?.[1]).toContain('--reaction-bg:');
  });

  it('keeps reduced-motion, contrast, and density systems consolidated', () => {
    expect([...css.matchAll(/prefers-reduced-motion/g)]).toHaveLength(1);
    expect(css).toMatch(/\[data-contrast="high"\],\s*\n\[data-high-contrast="true"\]\s*\{/);
    expect(css).toMatch(/\.density-compact \.msg-item,\s*\n\[data-density="compact"\] \.msg-item/);
    expect(css).toMatch(/\.density-ultra \.msg-item,\s*\n\[data-density="ultra"\] \.msg-item/);
  });
});
