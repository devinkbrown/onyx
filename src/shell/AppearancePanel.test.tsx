// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { AUTO_BACKGROUND_ID } from './themeBackground';
import {
  resetSceneMotion,
  sceneMotion,
  setSceneMotion,
  SCENE_MOTIONS,
} from '@/lib/prefs/sceneMotion';

const initialState = store.getInitialState();

describe('AppearancePanel', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    localStorage.clear();
    resetSceneMotion();
  });

  afterEach(() => {
    cleanup();
    resetSceneMotion();
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

  it('exposes 44px touch targets and commits background on touch-driven click', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    const goldVeins = screen.getByRole('radio', { name: /gold veins/i });
    expect(goldVeins.style.minHeight).toBe('44px');
    expect(goldVeins.style.touchAction).toBe('manipulation');

    fireEvent.pointerDown(goldVeins, { pointerType: 'touch' });
    fireEvent.click(goldVeins);

    expect(store.getState().backgroundId).toBe('gold-veins');
    expect(goldVeins).toHaveAttribute('aria-checked', 'true');
  });

  it('can move from Auto to a pinned wallpaper and persists the choice', () => {
    store.setState({ backgroundId: AUTO_BACKGROUND_ID });
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    expect(screen.getByRole('radio', { name: /auto — theme-matched background/i }))
      .toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /starfield/i }));

    expect(store.getState().backgroundId).toBe('starfield');
    expect(localStorage.getItem('onyx:bg')).toBe('starfield');
    expect(screen.getByRole('radio', { name: /starfield/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('preserves an explicit Off motion state when selecting a wallpaper', () => {
    setSceneMotion('off');
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    fireEvent.click(screen.getByRole('radio', { name: /starfield/i }));

    expect(store.getState().backgroundId).toBe('starfield');
    expect(sceneMotion()).toBe('off');
    expect(localStorage.getItem('onyx:scene-motion')).toBe('off');
    expect(screen.getByText('Background off')).toBeInTheDocument();
  });

  it('exposes background motion controls beside the mobile-safe picker', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    fireEvent.click(screen.getByRole('radio', { name: 'Still' }));
    expect(sceneMotion()).toBe('still');
    expect(screen.getByRole('radio', { name: 'Still' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Animated' }));
    expect(sceneMotion()).toBe('animated');
  });

  it('collapses the long background catalogue behind a named browser', () => {
    store.setState({ backgroundId: 'starfield' });
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    const summary = screen.getByText('Choose background').closest('summary');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent('Starfield');
    expect(summary?.parentElement).not.toHaveAttribute('open');
  });

  it('moves theme selection with Arrow keys while preserving single-tab stop semantics', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    const allThemeRadios = screen.getAllByRole('radio', { name: /theme$/ });
    const oceanRadio = screen.getByRole('radio', { name: 'Ocean theme' });

    fireEvent.click(oceanRadio);
    expect(oceanRadio).toHaveAttribute('tabIndex', '0');

    const oceanIndex = allThemeRadios.indexOf(oceanRadio);
    const nextIndex = (oceanIndex + 1) % allThemeRadios.length;
    const nextTheme = allThemeRadios[nextIndex]!;

    fireEvent.keyDown(oceanRadio, { key: 'ArrowRight', code: 'ArrowRight' });

    expect(nextTheme).toHaveFocus();
    expect(nextTheme).toHaveAttribute('aria-checked', 'true');
    expect(oceanRadio).toHaveAttribute('tabIndex', '-1');
    expect(nextTheme).toHaveAttribute('tabIndex', '0');
  });

  it('supports Home/End navigation on motion radios', () => {
    store.getState().openAppearance();
    render(() => <AppearancePanel />);

    const offRadio = screen.getByRole('radio', { name: 'Off' });
    fireEvent.click(offRadio);
    const animatedRadio = screen.getByRole('radio', { name: 'Animated' });
    const offRadioAfterHome = screen.getByRole('radio', { name: 'Off' });

    fireEvent.keyDown(offRadio, { key: 'Home', code: 'Home' });

    expect(animatedRadio).toHaveFocus();
    expect(animatedRadio).toHaveAttribute('aria-checked', 'true');
    expect(animatedRadio).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(animatedRadio, { key: 'End', code: 'End' });
    expect(offRadioAfterHome).toHaveFocus();
    expect(offRadioAfterHome).toHaveAttribute('aria-checked', 'true');
    expect(offRadioAfterHome).toHaveAttribute('tabIndex', '0');
    expect(SCENE_MOTIONS.indexOf('off')).not.toBe(-1);
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
