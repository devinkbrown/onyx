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

  const THEME_IDS = [
    'abyss', 'midnight', 'bathyal', 'coral', 'kelp', 'brine',
    'onyx', 'amoled', 'arctic', 'ash', 'light',
    'lacquer', 'pearl',
  ];

  /** Every theme block must define the full curated token set. */
  const REQUIRED_THEME_TOKENS = [
    '--bg-void:',
    '--bg-deep:',
    '--bg-base:',
    '--bg-elevated:',
    '--bg-float:',
    '--bg-overlay:',
    '--accent:',
    '--accent-hover:',
    '--lux:',
    '--elev-tint-1:',
    '--elev-tint-2:',
    '--elev-tint-3:',
    '--mention-bg:',
    '--reaction-bg:',
    '--reaction-bg-active:',
    '--scrim:',
    '--text-primary:',
    '--text-muted:',
    '--border-subtle:',
    '--border-normal:',
  ];

  const themeBlock = (themeId: string): string => {
    const match = css.match(new RegExp(`\\[data-theme="${themeId}"\\]\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
    expect(match, `${themeId} theme exists`).toBeTruthy();
    return match?.[1] ?? '';
  };

  it('defines luxury, elevation, mention, and reaction tokens for every theme surface', () => {
    for (const themeId of THEME_IDS) {
      const block = themeBlock(themeId);
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
    expect(highContrast?.[1]).toContain('--scrim:');
  });

  it('defines the full curated token set in every theme block, including the showcase themes', () => {
    for (const themeId of THEME_IDS) {
      const block = themeBlock(themeId);
      for (const token of REQUIRED_THEME_TOKENS) {
        expect(block, `${themeId} ${token}`).toContain(token);
      }
    }
  });

  it('gives the showcase themes their flagship palettes', () => {
    const lacquer = themeBlock('lacquer');
    expect(lacquer, 'lacquer near-black canvas').toContain('--bg-void:     #0a0a0c');
    expect(lacquer, 'lacquer champagne lux').toContain('--lux:           #d8b96a');
    expect(lacquer, 'lacquer steel-blue accent').toContain('--accent:        #6e8ca6');

    const pearl = themeBlock('pearl');
    expect(pearl, 'pearl is a light theme').toContain('color-scheme: light');
    expect(pearl, 'pearl antique gold lux').toContain('--lux:           #8f6a14');
    expect(pearl, 'pearl celadon accent').toContain('--accent:        #5d8a72');
    expect(pearl, 'pearl ink text').toContain('--text-primary:   #211f1a');
  });

  it('keeps per-theme muted text annotated with computed contrast ratios', () => {
    for (const themeId of THEME_IDS) {
      const block = themeBlock(themeId);
      const mutedLine = block.split('\n').find((line) => line.includes('--text-muted:'));
      expect(mutedLine, `${themeId} --text-muted has a contrast comment`).toMatch(/\d+(\.\d+)?:1/);
    }
  });

  it('keeps reduced-motion, contrast, and density systems consolidated', () => {
    expect([...css.matchAll(/prefers-reduced-motion/g)]).toHaveLength(1);
    expect(css).toMatch(/\[data-contrast="high"\],\s*\n\[data-high-contrast="true"\]\s*\{/);
    expect(css).toMatch(/\.density-compact \.msg-item,\s*\n\[data-density="compact"\] \.msg-item/);
    expect(css).toMatch(/\.density-ultra \.msg-item,\s*\n\[data-density="ultra"\] \.msg-item/);
  });
});
