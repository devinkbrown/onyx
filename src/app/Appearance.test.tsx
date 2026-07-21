// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';

const backgroundHarness = vi.hoisted(() => ({ mounts: 0, ids: [] as string[] }));

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
import Appearance, { POINTER_PREVIEW_DELAY_MS } from './Appearance';

const renderAppearance = () => render(() => (
  <ThemeProvider>
    <Appearance />
  </ThemeProvider>
));

beforeEach(() => {
  vi.useFakeTimers();
  backgroundHarness.mounts = 0;
  backgroundHarness.ids.length = 0;
  getState().setBackground('obsidian');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

    fireEvent.pointerEnter(getBackgroundChip(container, 'Deep Current'));
    fireEvent.pointerEnter(getBackgroundChip(container, 'Starfield'));
    fireEvent.pointerEnter(getBackgroundChip(container, 'Mineral Aurora'));
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

    fireEvent.pointerEnter(starfield);
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS - 1);
    fireEvent.pointerLeave(starfield);
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);

    expect(preview).toHaveAttribute('data-background-id', 'obsidian');
    expect(backgroundHarness.ids).toEqual(['obsidian']);
  });

  it('commits a click immediately and cancels its pending pointer preview', () => {
    const { container, getByTestId } = renderAppearance();
    const preview = getByTestId('background-preview');
    const goldVeins = getBackgroundChip(container, 'Gold Veins');

    fireEvent.pointerEnter(goldVeins);
    fireEvent.click(goldVeins);

    expect(preview).toHaveAttribute('data-background-id', 'gold-veins');
    expect(goldVeins).toHaveAttribute('aria-pressed', 'true');
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);
    expect(backgroundHarness.ids).toEqual(['obsidian', 'gold-veins']);
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

    fireEvent.pointerEnter(getBackgroundChip(container, 'Starfield'));
    expect(vi.getTimerCount()).toBe(beforeHoverTimers + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(beforeHoverTimers);
    vi.advanceTimersByTime(POINTER_PREVIEW_DELAY_MS);
    expect(backgroundHarness.ids).toEqual(['obsidian']);
  });
});

function getBackgroundChip(container: HTMLElement, label: string): HTMLButtonElement {
  const chip = [...container.querySelectorAll<HTMLButtonElement>('.ap-chip:not(.ap-chip--theme)')]
    .find((button) => button.textContent?.startsWith(label));
  if (!chip) throw new Error(`Background chip not found: ${label}`);
  return chip;
}
