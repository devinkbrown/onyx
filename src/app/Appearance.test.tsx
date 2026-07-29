// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';

const backgroundHarness = vi.hoisted(() => ({
  mounts: 0,
  ids: [] as string[],
  throwOnId: null as string | null,
}));

vi.mock('@/backgrounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backgrounds')>();
  const { createEffect } = await import('solid-js');
  return {
    ...actual,
    Background: (props: { id?: string }) => {
      backgroundHarness.mounts += 1;
      const element = document.createElement('div');
      element.dataset.testid = 'background-preview';
      createEffect(() => {
        const id = props.id ?? '';
        if (backgroundHarness.throwOnId && id === backgroundHarness.throwOnId) {
          throw new Error(`simulated wallpaper failure: ${id}`);
        }
        backgroundHarness.ids.push(id);
        element.dataset.backgroundId = id;
      });
      return element;
    },
  };
});

import { ThemeProvider, THEME_IDS } from '@/theme';
import { backgroundOptions } from '@/backgrounds';
import { getState } from '@/lib/store';
import {
  resetSceneMotion,
  sceneMotion,
  setSceneMotion,
} from '@/lib/prefs/sceneMotion';
import Appearance, {
  POINTER_PREVIEW_DELAY_MS,
  isTouchPointerEvent,
  prefersNoHoverPreview,
} from './Appearance';

const renderAppearance = () => render(() => (
  <ThemeProvider>
    <Appearance />
  </ThemeProvider>
));

const originalMatchMedia = window.matchMedia;

function installMatchMedia(matchesFor: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matchesFor(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  backgroundHarness.mounts = 0;
  backgroundHarness.ids.length = 0;
  backgroundHarness.throwOnId = null;
  getState().setBackground('obsidian');
  resetSceneMotion();
  window.matchMedia = originalMatchMedia;
});

afterEach(() => {
  cleanup();
  resetSceneMotion();
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
});

describe('Appearance', () => {
  it('renders the customization hero', () => {
    const { getByText } = renderAppearance();
    expect(getByText(/make it/i)).toBeInTheDocument();
  });

  it('offers a chip for every theme and every background', () => {
    const { getAllByRole } = renderAppearance();
    const labels = getAllByRole('button').map((b) => b.textContent ?? '');
    // at least one chip per theme + per background (studio adds more)
    expect(getAllByRole('button').length).toBeGreaterThanOrEqual(THEME_IDS.length + backgroundOptions.length);
    expect(labels.join(' ')).toMatch(/onyx/i);
    expect(labels.join(' ')).toMatch(/gold veins/i);
  });

  it('marks the active theme chip as pressed', () => {
    const { getAllByRole } = renderAppearance();
    const pressed = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBeGreaterThan(0);
  });

  it('settles rapid pointer sweeps on only the final background', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');

    fireEvent.pointerEnter(getBackgroundChip(container, 'Deep Current'), { pointerType: 'mouse' });
    fireEvent.pointerEnter(getBackgroundChip(container, 'Starfield'), { pointerType: 'mouse' });
    fireEvent.pointerEnter(getBackgroundChip(container, 'Mineral Aurora'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS - 1);

    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian']);

    vi.advanceTimersByTime(1);
    expect(preview).toHaveAttribute('data-background-id', 'aurora');
    expect(backgroundHarness.ids).toEqual(['obsidian', 'aurora']);
    expect(backgroundHarness.mounts).toBe(1);
  });

  it('cancels an early pointer leave without changing the selected background', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const starfield = getBackgroundChip(container, 'Starfield');

    fireEvent.pointerEnter(starfield, { pointerType: 'mouse' });
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS - 1);
    fireEvent.pointerLeave(starfield, { pointerType: 'mouse' });
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);

    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian']);
  });

  it('commits a click immediately and cancels its pending pointer preview', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const goldVeins = getBackgroundChip(container, 'Gold Veins');

    fireEvent.pointerEnter(goldVeins, { pointerType: 'mouse' });
    fireEvent.click(goldVeins);

    expect(preview).toHaveAttribute('data-background-id', 'gold-veins');
    expect(goldVeins).toHaveAttribute('aria-pressed', 'true');
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);
    expect(backgroundHarness.ids).toEqual(['obsidian', 'gold-veins']);
  });

  it('makes an explicit wallpaper selection visible after motion was Off', () => {
    setSceneMotion('off');
    const { container } = renderAppearance();

    fireEvent.click(getBackgroundChip(container, 'Gold Veins'));

    expect(getState().backgroundId).toBe('gold-veins');
    expect(sceneMotion()).toBe('animated');
  });

  it('previews keyboard focus immediately and restores selection on blur', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const phoenix = getBackgroundChip(container, 'Phoenix');

    fireEvent.focus(phoenix);
    expect(preview).toHaveAttribute('data-background-id', 'phoenix');
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.blur(phoenix);
    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian', 'phoenix', 'obsidian']);
  });

  it('clears a pending pointer preview when Appearance unmounts', () => {
    const { container, unmount } = renderAppearance();
    const beforeHoverTimers = vi.getTimerCount();

    fireEvent.pointerEnter(getBackgroundChip(container, 'Starfield'), { pointerType: 'mouse' });
    expect(vi.getTimerCount()).toBe(beforeHoverTimers + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(beforeHoverTimers);
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);
    expect(backgroundHarness.ids).toEqual(['obsidian']);
  });

  it('does not arm delayed pointer preview for touch pointerenter', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const starfield = getBackgroundChip(container, 'Starfield');
    const beforeTimers = vi.getTimerCount();

    fireEvent.pointerEnter(starfield, { pointerType: 'touch' });
    expect(vi.getTimerCount()).toBe(beforeTimers);
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);

    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian']);
    expect(getState().backgroundId).toBe('obsidian');
    expect(starfield).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not arm delayed pointer preview when (hover: none)', () => {
    installMatchMedia((query) => query.includes('hover: none'));
    expect(prefersNoHoverPreview()).toBe(true);

    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const beforeTimers = vi.getTimerCount();

    fireEvent.pointerEnter(getBackgroundChip(container, 'Starfield'), { pointerType: 'mouse' });
    expect(vi.getTimerCount()).toBe(beforeTimers);
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);

    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian']);
  });

  it('commits touch tap selection through pointerdown/focus/leave/click ordering', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const goldVeins = getBackgroundChip(container, 'Gold Veins');

    // Mobile order: touch pointer → focus (suppressed preview) → leave → click commit.
    fireEvent.pointerDown(goldVeins, { pointerType: 'touch' });
    fireEvent.focus(goldVeins);
    // Focus must not leave a sticky preview before activation.
    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian']);

    fireEvent.pointerLeave(goldVeins, { pointerType: 'touch' });
    fireEvent.click(goldVeins);

    expect(getState().backgroundId).toBe('gold-veins');
    expect(goldVeins).toHaveAttribute('aria-pressed', 'true');
    expect(preview).toHaveAttribute('data-background-id', 'gold-veins');
    expect(goldVeins.classList.contains('previewing')).toBe(false);
    expect(backgroundHarness.ids).toEqual(['obsidian', 'gold-veins']);
  });

  it('keeps store selection truth after touch activation even if a later mouse preview arms', () => {
    const { container } = renderAppearance();
    const goldVeins = getBackgroundChip(container, 'Gold Veins');
    const starfield = getBackgroundChip(container, 'Starfield');

    fireEvent.pointerDown(goldVeins, { pointerType: 'touch' });
    fireEvent.click(goldVeins);
    expect(getState().backgroundId).toBe('gold-veins');
    expect(goldVeins).toHaveAttribute('aria-pressed', 'true');

    // Synthetic post-touch mouseenter must not desync the pressed chip.
    fireEvent.pointerEnter(starfield, { pointerType: 'mouse' });
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);
    expect(getState().backgroundId).toBe('gold-veins');
    expect(goldVeins).toHaveAttribute('aria-pressed', 'true');
    expect(starfield).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps Appearance chrome when a wallpaper render throws', () => {
    backgroundHarness.throwOnId = 'phoenix';
    const { container, getByText, queryByTestId } = renderAppearance();
    const phoenix = getBackgroundChip(container, 'Phoenix');

    fireEvent.click(phoenix);

    expect(getState().backgroundId).toBe('phoenix');
    expect(phoenix).toHaveAttribute('aria-pressed', 'true');
    // Picker chrome stays; only the wallpaper subtree falls back.
    expect(getByText(/make it/i)).toBeInTheDocument();
    expect(getByText(/← back to app/i)).toBeInTheDocument();
    expect(queryByTestId('background-fallback')).toBeInTheDocument();
    expect(queryByTestId('background-preview')).not.toBeInTheDocument();
  });

  it('recovers the wallpaper subtree after selecting a different background', async () => {
    backgroundHarness.throwOnId = 'phoenix';
    const { container, queryByTestId } = renderAppearance();

    fireEvent.click(getBackgroundChip(container, 'Phoenix'));
    expect(queryByTestId('background-fallback')).toBeInTheDocument();

    fireEvent.click(getBackgroundChip(container, 'Gold Veins'));

    expect(getState().backgroundId).toBe('gold-veins');
    await Promise.resolve();
    expect(queryByTestId('background-fallback')).not.toBeInTheDocument();
    expect(queryByTestId('background-preview')).toHaveAttribute(
      'data-background-id',
      'gold-veins',
    );
  });
});

describe('Appearance pointer helpers', () => {
  it('classifies touch pointer events', () => {
    expect(isTouchPointerEvent({ pointerType: 'touch' })).toBe(true);
    expect(isTouchPointerEvent({ pointerType: 'mouse' })).toBe(false);
    expect(isTouchPointerEvent({})).toBe(false);
  });
});

function getBackgroundChip(container: HTMLElement, label: string): HTMLButtonElement {
  const chip = [...container.querySelectorAll<HTMLButtonElement>('.ap-chip:not(.ap-chip--theme)')]
    .find((button) => button.textContent?.startsWith(label));
  if (!chip) throw new Error(`Background chip not found: ${label}`);
  return chip;
}
