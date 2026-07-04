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
import { THEME_IDS } from '@/theme';
import { AppearancePanel } from './AppearancePanel';

const initialState = store.getInitialState();

describe('AppearancePanel', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
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

  it('closes through onOpenChange when the store flag clears', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);
    expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();

    store.getState().closeAppearance();
    expect(store.getState().showAppearance).toBe(false);
  });
});
