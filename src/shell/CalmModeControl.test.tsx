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
});
