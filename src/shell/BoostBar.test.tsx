// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { BoostBar } from './BoostBar';

afterEach(() => {
  cleanup();
  resetPreferences();
});

const MANY_BOOSTS = [
  { emoji: '🔥', count: 12, reactors: ['A', 'B'], youBoosted: false },
  { emoji: '👍', count: 3, reactors: ['C'], youBoosted: true },
  { emoji: '✨', count: 1, reactors: ['D'], youBoosted: false },
  { emoji: '🎉', count: 2, reactors: ['E'], youBoosted: false },
  { emoji: '💙', count: 1, reactors: ['F'], youBoosted: false },
] as const;

describe('BoostBar', () => {
  it('names boost toggles with the action, emoji, and total', () => {
    const onBoost = vi.fn();
    render(() => (
      <BoostBar
        boosts={[
          { emoji: '👍', count: 3, reactors: ['A', 'B', 'C'], youBoosted: false },
          { emoji: '🚀', count: 1, reactors: ['You'], youBoosted: true },
        ]}
        onBoost={onBoost}
      />
    ));

    const add = screen.getByRole('button', { name: 'Add 👍 boost, 3 total' });
    const remove = screen.getByRole('button', { name: 'Remove 🚀 boost, 1 total' });

    expect(add.getAttribute('aria-pressed')).toBe('false');
    expect(remove.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(add);
    expect(onBoost).toHaveBeenCalledWith('👍');
  });

  it('defaults density from preferences().reactionDensity', () => {
    setPreference('reactionDensity', 'compact');
    render(() => <BoostBar boosts={[...MANY_BOOSTS]} />);

    const bar = screen.getByLabelText('Boosts');
    expect(bar.getAttribute('data-density')).toBe('compact');
    // Compact mode shows at most 4 emoji pills plus an overflow chip.
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByLabelText('1 more reaction types')).toHaveTextContent('+1');
  });

  it('renders a single total pill in counts-only mode', () => {
    setPreference('reactionDensity', 'counts-only');
    render(() => <BoostBar boosts={[...MANY_BOOSTS]} onAdd={() => undefined} />);

    const bar = screen.getByLabelText('Boosts');
    expect(bar.getAttribute('data-density')).toBe('counts-only');
    expect(screen.getByLabelText('19 total boosts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /boost/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a boost' })).not.toBeInTheDocument();
  });

  it('hides the bar entirely when reaction density is hidden', () => {
    setPreference('reactionDensity', 'hidden');
    render(() => <BoostBar boosts={[...MANY_BOOSTS]} onAdd={() => undefined} />);

    expect(screen.queryByLabelText('Boosts')).not.toBeInTheDocument();
  });

  it('honors an explicit density prop over the preference', () => {
    setPreference('reactionDensity', 'full');
    render(() => <BoostBar boosts={[...MANY_BOOSTS]} density="counts-only" />);

    expect(screen.getByLabelText('Boosts').getAttribute('data-density')).toBe('counts-only');
    expect(screen.getByLabelText('19 total boosts')).toBeInTheDocument();
  });
});
