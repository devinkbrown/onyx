// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';

vi.mock('@/backgrounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backgrounds')>();
  return {
    ...actual,
    Background: (props: { id?: string; motionOverride?: string }) => (
      <div
        data-testid="background-preview"
        data-background-id={props.id}
        data-motion-override={props.motionOverride}
      />
    ),
  };
});

import { ThemeProvider } from '@/theme';
import { getState } from '@/lib/store';
import Appearance from './Appearance';
import { BACKGROUND_PREVIEW_DELAY_MS } from '@/backgrounds/picker/BackgroundPicker';
import { resetSceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';

const renderAppearance = () => render(() => <ThemeProvider><Appearance /></ThemeProvider>);
const card = (container: HTMLElement, label: string) => {
  const item = [...container.querySelectorAll<HTMLButtonElement>('[data-background-id]')].find((button) => button.textContent?.includes(label));
  if (!item) throw new Error(`Missing background ${label}`);
  return item;
};

function openAppearanceAdvanced(container: HTMLElement): void {
  const summary = container.querySelector<HTMLElement>('[data-testid="appearance-advanced"] > summary');
  if (!summary) throw new Error('Missing Advanced disclosure');
  fireEvent.click(summary);
}

describe('Appearance', () => {
  beforeEach(() => { vi.useFakeTimers(); getState().setBackground('obsidian'); });
  afterEach(() => { cleanup(); resetSceneMotion(); vi.useRealTimers(); });

  it('shows consumer looks instead of Theme Studio on the default path', () => {
    const { getByRole, getAllByRole, queryByRole, getByTestId } = renderAppearance();
    expect(getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(getAllByRole('radio', { name: 'Ocean · Dark look' })[0]).toBeInTheDocument();
    expect(getAllByRole('radio', { name: 'Pearl · Light look' })[0]).toBeInTheDocument();
    expect(getByTestId('appearance-advanced')).not.toHaveAttribute('open');
    expect(queryByRole('heading', { name: 'Theme Studio' })).toBeNull();
    expect(getByRole('note')).toHaveTextContent('Your account and messages are unchanged.');
    expect(getByTestId('appearance-advanced').querySelector('summary')).toHaveTextContent('Optional tools for people who want finer control.');
  });

  it('keeps all background choices staged until Apply', () => {
    const { container, getByRole } = renderAppearance();
    openAppearanceAdvanced(container);
    fireEvent.click(card(container, 'Gold Veins'));
    expect(getState().backgroundId).toBe('obsidian');
    expect(getByRole('button', { name: 'Apply background' })).not.toBeDisabled();
    fireEvent.click(getByRole('button', { name: 'Apply background' }));
    expect(getState().backgroundId).toBe('gold-veins');
  });

  it('cancels a staged background with Escape', () => {
    const { container } = renderAppearance();
    openAppearanceAdvanced(container);
    fireEvent.click(card(container, 'Starfield'));
    fireEvent.keyDown(container.querySelector('.ap')!, { key: 'Escape' });
    expect(card(container, 'Obsidian')).toHaveAttribute('aria-checked', 'true');
    expect(getState().backgroundId).toBe('obsidian');
  });

  it('previews hover only after the 160ms intent delay without persisting', () => {
    const { container, getByTestId } = renderAppearance();
    openAppearanceAdvanced(container);
    fireEvent.pointerEnter(card(container, 'Phoenix'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(BACKGROUND_PREVIEW_DELAY_MS - 1);
    expect(getByTestId('background-preview')).toHaveAttribute('data-background-id', 'obsidian');
    vi.advanceTimersByTime(1);
    expect(getByTestId('background-preview')).toHaveAttribute('data-background-id', 'phoenix');
    expect(getState().backgroundId).toBe('obsidian');
  });

  it('previews a still frame from Motion Off without changing it before Apply', () => {
    setSceneMotion('off');
    const { container, getByTestId, getByRole } = renderAppearance();
    openAppearanceAdvanced(container);
    expect(getByTestId('background-preview')).not.toHaveAttribute('data-motion-override');

    fireEvent.pointerEnter(card(container, 'Phoenix'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(BACKGROUND_PREVIEW_DELAY_MS);
    expect(getByTestId('background-preview')).toHaveAttribute('data-motion-override', 'still');

    fireEvent.pointerLeave(card(container, 'Phoenix'));
    expect(getByTestId('background-preview')).not.toHaveAttribute('data-motion-override');
    expect(getByRole('button', { name: 'Apply background' })).toBeDisabled();
  });

  it('keeps Motion Off after applying a staged wallpaper', () => {
    setSceneMotion('off');
    const { container, getByRole } = renderAppearance();
    openAppearanceAdvanced(container);
    fireEvent.click(card(container, 'Phoenix'));
    fireEvent.click(getByRole('button', { name: 'Apply background' }));
    expect(localStorage.getItem('onyx:scene-motion')).toBe('off');
    expect(getState().backgroundId).toBe('phoenix');
  });

  it('presents all five picker groups with radio semantics', () => {
    const { container, getByRole, getAllByRole } = renderAppearance();
    openAppearanceAdvanced(container);
    for (const label of ['Match my theme', 'Living ambient', 'Quiet stills', 'Featured scenes', 'More presets']) expect(getByRole('heading', { name: label })).toBeInTheDocument();
    expect(getAllByRole('radio').length).toBeGreaterThan(20);
  });

  it('uses arrow keys to select and focus the next background radio', () => {
    const { container } = renderAppearance();
    openAppearanceAdvanced(container);
    const obsidian = card(container, 'Obsidian');
    obsidian.focus();
    fireEvent.keyDown(obsidian, { key: 'ArrowRight' });

    const lapis = card(container, 'Lapis Gradient');
    expect(lapis).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(lapis);
    expect(getState().backgroundId).toBe('obsidian');
  });

  it('clears an aborted touch gesture before keyboard preview', () => {
    const { container, getByTestId } = renderAppearance();
    openAppearanceAdvanced(container);
    const phoenix = card(container, 'Phoenix');
    fireEvent.pointerDown(phoenix, { pointerType: 'touch' });
    fireEvent.pointerCancel(phoenix, { pointerType: 'touch' });
    fireEvent.focus(phoenix);
    vi.advanceTimersByTime(BACKGROUND_PREVIEW_DELAY_MS);
    expect(getByTestId('background-preview')).toHaveAttribute('data-background-id', 'phoenix');
  });
});
