// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encodeTheme } from '@/lib/theme/themeShare';
import { ThemeProvider, useTheme } from './ThemeProvider';
import type { CustomTheme } from './customThemes';

function ThemeIdDisplay() {
  const theme = useTheme();
  return <span data-testid="theme-id">{theme.themeId()}</span>;
}

function encodeJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('boot-time shared theme import security', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    history.replaceState(null, '', '/');
  });

  it('rejects and strips a resource-bearing theme link before persistence or CSSOM', () => {
    const code = encodeJson({
      id: 'custom:remote-resource',
      name: 'Remote resource',
      base: 'ocean',
      overrides: { '--stone': 'url(https://attacker.example/pixel)' },
    });
    history.replaceState(null, '', `/?keep=1&theme=${code}`);

    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe('ocean');
    expect(localStorage.getItem('onyx:custom-themes')).toBeNull();
    expect(localStorage.getItem('onyx:theme')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--stone')).not.toContain('url(');
    expect(location.search).toBe('?keep=1');
  });

  it('still imports, persists, and activates a safe palette share', () => {
    const theme: CustomTheme = {
      id: 'custom:safe-boot',
      name: 'Safe boot',
      base: 'ocean',
      overrides: {
        '--stone': '#123456',
        '--washi': 'oklch(92% 0.02 220)',
        '--r-sm': '8px',
      },
    };
    history.replaceState(null, '', `/?theme=${encodeTheme(theme)}`);

    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe('custom:safe-boot');
    expect(JSON.parse(localStorage.getItem('onyx:custom-themes') ?? 'null'))
      .toEqual([theme]);
    expect(localStorage.getItem('onyx:theme')).toBe('custom:safe-boot');
    expect(document.documentElement.style.getPropertyValue('--stone')).toBe('#123456');
    expect(location.search).toBe('');
  });
});
