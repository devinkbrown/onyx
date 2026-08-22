// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FirstHourCoach } from './FirstHourCoach';

afterEach(() => {
  cleanup();
});

describe('FirstHourCoach', () => {
  it('renders one dismissible tip and is not a dialog', () => {
    const onDismiss = vi.fn();
    render(() => (
      <FirstHourCoach
        tip={{ id: 'home-next', text: 'Browse a room, start one, or invite a friend.' }}
        onDismiss={onDismiss}
      />
    ));

    expect(screen.getByTestId('first-hour-coach')).toHaveTextContent('Browse a room');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
