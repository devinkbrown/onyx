// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
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
    expect(screen.getByRole('note', { name: 'A quick start tip' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss quick start tip' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders nothing when the parent has dismissed the tip', () => {
    render(() => <FirstHourCoach tip={null} onDismiss={() => undefined} />);
    expect(screen.queryByTestId('first-hour-coach')).not.toBeInTheDocument();
  });

  it('reacts when the parent changes or dismisses the tip', () => {
    const [tip, setTip] = createSignal<{ id: 'home-next' | 'room-say-hi'; text: string } | null>({ id: 'home-next', text: 'First tip.' });
    render(() => <FirstHourCoach tip={tip()} onDismiss={() => undefined} />);
    expect(screen.getByText('First tip.')).toBeInTheDocument();

    setTip({ id: 'room-say-hi', text: 'Second tip.' });
    expect(screen.queryByText('First tip.')).not.toBeInTheDocument();
    expect(screen.getByText('Second tip.')).toBeInTheDocument();

    setTip(null);
    expect(screen.queryByTestId('first-hour-coach')).not.toBeInTheDocument();
  });

  it.each([
    ['missing tip', undefined],
    ['empty tip', { id: 'home-next', text: '   ' }],
    ['unknown tip', { id: 'future-tip', text: 'A future hint.' }],
  ])('renders nothing for %s', (_label, tip) => {
    render(() => <FirstHourCoach tip={tip as never} onDismiss={() => undefined} />);
    expect(screen.queryByTestId('first-hour-coach')).not.toBeInTheDocument();
  });
});
