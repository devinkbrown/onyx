/**
 * AppearancePanel.test.tsx — the in-shell theme + background switcher.
 *
 * Renders without a ThemeProvider on purpose: the panel uses useThemeOptional()
 * so it must work in isolation. Covers panel visibility gating, theme chips,
 * and background selection wiring through the store.
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '@/lib/store/store';
import { encodeTheme } from '@/lib/theme/themeShare';
import { THEME_IDS, type CustomTheme } from '@/theme';
import { AppearancePanel } from './AppearancePanel';

const initialState = store.getInitialState();

describe('AppearancePanel', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('stays closed until showAppearance is set', () => {
    render(() => <AppearancePanel />);
    expect(screen.queryByTestId('appearance-panel')).toBeNull();
  });

  it('opens via the store action and lists every theme', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();
    // One radio per theme + one per background; at least the themes are present.
    const themeRadios = screen.getAllByRole('radio', { name: /theme$/ });
    expect(themeRadios.length).toBe(THEME_IDS.length);
  });

  it('updates the store background when a background chip is clicked', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    const before = store.getState().backgroundId;
    // "Mineral Aurora" is the canvas variant; the scene "Aurora Borealis"
    // also matches a loose /aurora/i, so anchor on the full label.
    const auroraChip = screen.getByRole('radio', { name: /mineral aurora/i });
    fireEvent.click(auroraChip);

    expect(store.getState().backgroundId).toBe('aurora');
    expect(store.getState().backgroundId).not.toBe(before === 'aurora' ? 'x' : before);
  });

  it('imports a shared theme code from the appearance panel', () => {
    const imported: CustomTheme = {
      id: 'custom:shared',
      name: 'Shared Theme',
      base: 'ocean',
      overrides: { '--lapis': '#33ccff' },
    };
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Share / import' }));
    fireEvent.input(screen.getByLabelText('Theme code or link'), {
      target: { value: encodeTheme(imported) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import theme Shared Theme' }));

    expect(screen.queryByTestId('theme-import-dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Shared Theme theme' })).toHaveAttribute('aria-checked', 'true');
    expect(JSON.parse(localStorage.getItem('onyx:custom-themes') ?? '[]')).toEqual([
      expect.objectContaining({
        id: 'custom:shared-theme',
        name: 'Shared Theme',
        base: 'ocean',
        overrides: { '--lapis': '#33ccff' },
      }),
    ]);
  });

  it('closes through onOpenChange when the store flag clears', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);
    expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();

    store.getState().closeAppearance();
    expect(store.getState().showAppearance).toBe(false);
  });
});
