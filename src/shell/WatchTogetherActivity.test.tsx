// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import { WatchTogetherActivity } from './WatchTogetherActivity';

const initialState = store.getInitialState();

/** Seed an active `ocean.watch` session hosted by us on the active channel. */
function seedWatch(raw: string): void {
  store.setState(
    {
      ...initialState,
      ourNick: 'self',
      activeView: { kind: 'channel', channel: '#watch' },
      channelProps: new Map([['#watch', { 'ocean.watch': raw }]]),
    },
    true,
  );
}

describe('WatchTogetherActivity accessibility', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
  });

  it('gives the seek slider an accessible name and a spoken value (aria-valuetext)', () => {
    seedWatch('title=Big Buck Bunny;url=https://example.com/v;host=self;state=playing;position=30;duration=120;participants=self');

    render(() => <WatchTogetherActivity />);

    const slider = screen.getByRole('slider', { name: 'Seek position' });
    expect(slider.getAttribute('aria-valuetext')).toContain('of 2:00');
    expect(slider).toHaveAttribute('max', '120');
  });

  it('names the Open link with the title and destination context', () => {
    seedWatch('title=Big Buck Bunny;url=https://example.com/v;host=self;state=paused;position=0;duration=120;participants=self');

    render(() => <WatchTogetherActivity />);

    expect(
      screen.getByRole('link', { name: 'Open Big Buck Bunny in a new tab' }),
    ).toBeInTheDocument();
  });
});
