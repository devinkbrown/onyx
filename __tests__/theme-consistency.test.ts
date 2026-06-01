import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Regression guard for the theming bug: every theme offered in the picker must
// have a matching CSS [data-theme] block (or be the default 'ocean' that maps
// to :root). Picking a theme with no CSS silently did nothing.
describe('theme picker ↔ CSS consistency', () => {
  const root = path.resolve(__dirname, '..');
  const modal = readFileSync(path.join(root, 'components/modals/ThemeModal.tsx'), 'utf8');
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8');

  const themesBlock = modal.slice(modal.indexOf('const THEMES'), modal.indexOf('];', modal.indexOf('const THEMES')));
  const offered = [...themesBlock.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  const cssThemes = new Set([...css.matchAll(/\[data-theme="([a-z]+)"\]/g)].map((m) => m[1]));

  // 'ocean' is the default that clears data-theme and inherits :root.
  const DEFAULTS = new Set(['ocean', 'system']);

  it('offers more than 3 themes', () => {
    expect(offered.length).toBeGreaterThan(3);
  });

  it('every offered theme has a CSS [data-theme] block', () => {
    const missing = offered.filter((id) => !DEFAULTS.has(id) && !cssThemes.has(id));
    expect(missing, `offered themes with no CSS: ${missing.join(', ')}`).toEqual([]);
  });
});
