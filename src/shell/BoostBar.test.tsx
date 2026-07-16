// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoostBar } from './BoostBar';

afterEach(cleanup);

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
});
