// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setCalmPreset } from '@/lib/notifications/calmMode';
import { CalmModeControl } from './CalmModeControl';

describe('CalmModeControl accessibility', () => {
  beforeEach(() => {
    localStorage.clear();
    setCalmPreset('regular');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setCalmPreset('regular');
  });

  it('exposes a labelled preset radiogroup with described options', () => {
    render(() => <CalmModeControl />);

    expect(screen.getByRole('radiogroup', { name: 'Notification mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Calm', description: 'Only mentions & DMs reach you' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Regular', description: 'Follows & mentions notify; the rest waits' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Power', description: 'Notify me about everything' })).toHaveAttribute('aria-checked', 'false');
  });

  it('updates the selected preset from the keyboard-focusable radio buttons', () => {
    render(() => <CalmModeControl />);

    fireEvent.click(screen.getByRole('radio', { name: 'Power' }));

    expect(screen.getByRole('radio', { name: 'Power' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('onyx:calm')).toBe('power');
  });

  it('exposes exactly one tab stop via roving tabindex on the selected radio', () => {
    render(() => <CalmModeControl />);

    // Only the currently-selected ("Regular") radio is a tab stop; the rest are -1.
    expect(screen.getByRole('radio', { name: 'Calm' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'Regular' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Power' })).toHaveAttribute('tabindex', '-1');

    const tabStops = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('tabindex') === '0');
    expect(tabStops).toHaveLength(1);
  });

  it('moves selection to the next radio with ArrowDown/ArrowRight, wrapping at the end', () => {
    render(() => <CalmModeControl />);
    const group = screen.getByRole('radiogroup', { name: 'Notification mode' });

    // Regular -> Power (ArrowDown)
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'Power' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Power' })).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Power' }));

    // Power -> Calm (ArrowRight wraps past the end)
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Calm' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Calm' }));
  });

  it('moves selection to the previous radio with ArrowUp/ArrowLeft, wrapping at the start', () => {
    render(() => <CalmModeControl />);
    const group = screen.getByRole('radiogroup', { name: 'Notification mode' });

    // Regular -> Calm (ArrowUp)
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(screen.getByRole('radio', { name: 'Calm' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Calm' }));

    // Calm -> Power (ArrowLeft wraps past the start)
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Power' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Power' }));
  });
});
