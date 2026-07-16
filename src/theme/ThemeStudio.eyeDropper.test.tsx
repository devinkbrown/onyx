// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as eyeDropper from './eyeDropper';
import { hexToOklch } from './paletteFactory';
import { ThemeProvider } from './ThemeProvider';
import { ThemeStudio } from './ThemeStudio';

function mountStudio() {
  return render(() => (
    <ThemeProvider>
      <ThemeStudio />
    </ThemeProvider>
  ));
}

function accentSeedReadout(): HTMLElement {
  const input = screen.getByTestId('ts-seed-accent');
  const readout = input.parentElement?.querySelector('code');
  if (!(readout instanceof HTMLElement)) throw new Error('Accent seed readout is missing');
  return readout;
}

function rootVar(property: string): string {
  return document.documentElement.style.getPropertyValue(property).trim();
}

describe('Theme Studio accent EyeDropper', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('samples a valid sRGB colour only after the labelled action is clicked', async () => {
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    const pickScreenColor = vi.spyOn(eyeDropper, 'pickScreenColor')
      .mockResolvedValue({ state: 'selected', sRGBHex: '#00FF00' });
    mountStudio();

    expect(pickScreenColor).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Sample accent seed colour from the screen' });
    expect(button).toHaveTextContent('sample screen');
    fireEvent.click(button);

    expect(await screen.findByText('Accent seed sampled from #00ff00.')).toHaveAttribute('role', 'status');
    const expectedHue = Math.round(hexToOklch('#00ff00')!.h);
    expect(accentSeedReadout()).toHaveTextContent(`${expectedHue}°`);
    expect(pickScreenColor).toHaveBeenCalledOnce();
  });

  it('announces user cancellation neutrally and preserves the accent seed', async () => {
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    vi.spyOn(eyeDropper, 'pickScreenColor').mockResolvedValue({
      state: 'cancelled',
      detail: 'Screen colour sampling cancelled. The accent seed was not changed.',
    });
    mountStudio();
    const before = accentSeedReadout().textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }));

    expect(await screen.findByText('Screen colour sampling cancelled. The accent seed was not changed.'))
      .toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(accentSeedReadout().textContent).toBe(before);
  });

  it('rejects a non-six-digit API result at the existing colour boundary', async () => {
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    vi.spyOn(eyeDropper, 'pickScreenColor').mockResolvedValue({
      state: 'selected',
      sRGBHex: '#12ab34ff',
    });
    mountStudio();
    const before = accentSeedReadout().textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('sampled screen colour was invalid');
    expect(accentSeedReadout().textContent).toBe(before);
  });

  it('announces a rejected EyeDropper operation as failure without changing the seed', async () => {
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    vi.spyOn(eyeDropper, 'pickScreenColor').mockResolvedValue({
      state: 'failed',
      detail: 'Screen colour sampling failed. Use the accent colour control instead.',
    });
    mountStudio();
    const before = accentSeedReadout().textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Screen colour sampling failed');
    expect(accentSeedReadout().textContent).toBe(before);
  });

  it('leaves the existing accent colour control unchanged when unsupported', () => {
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(false);
    const pickScreenColor = vi.spyOn(eyeDropper, 'pickScreenColor');
    mountStudio();

    const input = screen.getByTestId('ts-seed-accent') as HTMLInputElement;
    expect(input.type).toBe('color');
    expect(screen.queryByRole('button', { name: 'Sample accent seed colour from the screen' }))
      .not.toBeInTheDocument();

    fireEvent.input(input, { target: { value: '#00ff00' } });
    expect(accentSeedReadout()).toHaveTextContent(`${Math.round(hexToOklch('#00ff00')!.h)}°`);
    expect(pickScreenColor).not.toHaveBeenCalled();
  });

  it('guards rapid repeats while one picker is open and becomes retryable after completion', async () => {
    let resolvePick: (result: eyeDropper.EyeDropperSelectionResult) => void = () => {};
    const pending = new Promise<eyeDropper.EyeDropperSelectionResult>((resolve) => {
      resolvePick = resolve;
    });
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    const pickScreenColor = vi.spyOn(eyeDropper, 'pickScreenColor').mockReturnValue(pending);
    mountStudio();

    const button = screen.getByRole('button', { name: 'Sample accent seed colour from the screen' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(pickScreenColor).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    resolvePick({
      state: 'cancelled',
      detail: 'Screen colour sampling cancelled. The accent seed was not changed.',
    });
    expect(await screen.findByText('Screen colour sampling cancelled. The accent seed was not changed.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }))
      .not.toBeDisabled();
  });

  it('ignores a stale picker completion after the active theme changes', async () => {
    let resolvePick: (result: eyeDropper.EyeDropperSelectionResult) => void = () => {};
    const pending = new Promise<eyeDropper.EyeDropperSelectionResult>((resolve) => {
      resolvePick = resolve;
    });
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    vi.spyOn(eyeDropper, 'pickScreenColor').mockReturnValue(pending);
    mountStudio();
    const before = accentSeedReadout().textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }));
    fireEvent.click(screen.getByTestId('ts-theme-chip-pearl'));
    expect(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }))
      .not.toBeDisabled();

    resolvePick({ state: 'selected', sRGBHex: '#00ff00' });
    await pending;
    await Promise.resolve();
    expect(accentSeedReadout().textContent).toBe(before);
    expect(screen.queryByText('Accent seed sampled from #00ff00.')).not.toBeInTheDocument();
  });

  it('does not regenerate the palette from a completion delivered after unmount', async () => {
    vi.useFakeTimers();
    let resolvePick: (result: eyeDropper.EyeDropperSelectionResult) => void = () => {};
    const pending = new Promise<eyeDropper.EyeDropperSelectionResult>((resolve) => {
      resolvePick = resolve;
    });
    vi.spyOn(eyeDropper, 'supportsEyeDropper').mockReturnValue(true);
    vi.spyOn(eyeDropper, 'pickScreenColor').mockReturnValue(pending);
    const view = mountStudio();

    fireEvent.click(screen.getByTestId('ts-generate'));
    fireEvent.click(screen.getByRole('button', { name: 'Sample accent seed colour from the screen' }));
    expect(rootVar('--gold')).not.toBe('');
    view.unmount();
    expect(rootVar('--gold')).toBe('');

    resolvePick({ state: 'selected', sRGBHex: '#00ff00' });
    await pending;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(rootVar('--gold')).toBe('');
  });
});
