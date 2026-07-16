// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WATCH_PARTICIPANT_MAX_COUNT,
  WATCH_SECONDS_MAX,
  WATCH_TITLE_MAX_LENGTH,
} from '@/lib/media/watchTogether';
import { store } from '@/lib/store/store';
import { WatchTogetherActivity } from './WatchTogetherActivity';

const initialState = store.getInitialState();

/** Seed an active `ocean.watch` session and capture activity publications. */
function seedWatch(
  raw: string,
  nick = 'self',
  publishWatchTogether = vi.fn(),
) {
  store.setState(
    {
      ...initialState,
      ourNick: nick ?? '',
      activeView: { kind: 'channel', channel: '#watch' },
      channelProps: new Map([['#watch', { 'ocean.watch': raw }]]),
      client: { publishWatchTogether } as never,
    },
    true,
  );
  return publishWatchTogether;
}

/** Seed a signed-in channel with no valid watch activity. */
function seedEmptyWatch(
  nick: string | null = 'self',
  publishWatchTogether = vi.fn(),
) {
  store.setState(
    {
      ...initialState,
      ourNick: nick ?? '',
      activeView: { kind: 'channel', channel: '#watch' },
      channelProps: new Map(),
      client: { publishWatchTogether } as never,
    },
    true,
  );
  return publishWatchTogether;
}

/** Simulate state arriving after activation starts but before Solid's delegated handler runs. */
function clickWithDrift(element: HTMLElement, drift: () => void): void {
  element.addEventListener('click', drift, { once: true });
  fireEvent.click(element);
}

function openStartEditor(): HTMLFormElement {
  fireEvent.click(screen.getByRole('button', { name: 'Start watch activity' }));
  return screen.getByRole('form', { name: 'Start watch activity' });
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

  it('offers the host role to a bounded non-self participant and publishes the exact activity', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo%20Night;url=https%3A%2F%2Fexample.test%2Fv;host=SELF;state=paused;position=30;duration=120;participants=SELF,bob,carol',
    );

    render(() => <WatchTogetherActivity />);

    const target = screen.getByRole('combobox', { name: 'New watch host' });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['bob', 'carol']);
    fireEvent.change(target, { target: { value: 'carol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Offer host' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
      title: 'Demo Night',
      url: 'https://example.test/v',
      host: 'SELF',
      state: 'handoff',
      positionSeconds: 30,
      durationSeconds: 120,
      participants: ['SELF', 'bob', 'carol'],
      handoffTo: 'carol',
    });
  });

  it('allows only the mixed-case named target to accept and publishes the new host state', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=alice;state=handoff;position=30;duration=120;participants=alice,BOB;handoff=bob',
      'BoB',
    );

    render(() => <WatchTogetherActivity />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept host' }));

    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
      title: 'Demo',
      url: null,
      host: 'BoB',
      state: 'paused',
      positionSeconds: 30,
      durationSeconds: 120,
      participants: ['alice', 'BOB'],
      handoffTo: null,
    });
  });

  it('does not expose target or host actions to the wrong participant during handoff', () => {
    seedWatch(
      'title=Demo;host=alice;state=handoff;position=30;duration=120;participants=alice,bob,carol;handoff=bob',
      'carol',
    );

    render(() => <WatchTogetherActivity />);

    expect(screen.queryByRole('button', { name: 'Accept host' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offer host' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Playback and host controls' })).not.toBeInTheDocument();
  });

  it('lets the old host cancel while hiding playback, seek, and re-offer controls', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=self;state=handoff;position=30;duration=120;participants=self,bob;handoff=bob',
    );

    render(() => <WatchTogetherActivity />);

    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Seek position' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offer host' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel handoff' }));
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
      title: 'Demo',
      url: null,
      host: 'self',
      state: 'paused',
      positionSeconds: 30,
      durationSeconds: 120,
      participants: ['self', 'bob'],
      handoffTo: null,
    });
  });

  it('omits handoff controls when the host has no other participants', () => {
    seedWatch('title=Solo;host=self;state=paused;position=0;duration=60');

    render(() => <WatchTogetherActivity />);

    expect(screen.queryByRole('combobox', { name: 'New watch host' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offer host' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('identifies the host and requires handoff before leaving', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=SELF;state=paused;participants=SELF,bob',
    );

    render(() => <WatchTogetherActivity />);

    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      `You are hosting. 2 of ${WATCH_PARTICIPANT_MAX_COUNT} participant spots used`,
    );
    const leaveButton = screen.getByRole('button', {
      name: 'Leave activity unavailable while hosting',
    });
    expect(leaveButton).toBeDisabled();
    expect(leaveButton).toHaveAttribute(
      'title',
      'Hand off host before leaving this activity',
    );
    fireEvent.click(leaveButton);
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it('lets a mixed-case participant leave without changing activity ownership', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=alice;state=playing;position=4;participants=alice,SELF',
      'self',
    );

    render(() => <WatchTogetherActivity />);

    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent('You joined');
    expect(screen.queryByTestId('watch-join-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave activity: Demo' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
      title: 'Demo',
      url: null,
      host: 'alice',
      state: 'playing',
      positionSeconds: 4,
      durationSeconds: null,
      participants: ['alice'],
      handoffTo: null,
    });
  });

  it('lets a bystander join through the bounded ocean.watch publisher', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=alice;state=paused;participants=alice,bob',
    );

    render(() => <WatchTogetherActivity />);

    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      `Not joined. 2 of ${WATCH_PARTICIPANT_MAX_COUNT} participant spots used`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Join activity: Demo' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
      title: 'Demo',
      url: null,
      host: 'alice',
      state: 'paused',
      positionSeconds: null,
      durationSeconds: null,
      participants: ['alice', 'bob', 'self'],
      handoffTo: null,
    });
  });

  it('disables joining at the exact participant capacity', () => {
    const participants = [
      'alice',
      ...Array.from(
        { length: WATCH_PARTICIPANT_MAX_COUNT - 1 },
        (_, index) => `p${index}`,
      ),
    ];
    const raw = new URLSearchParams({
      title: 'Full room',
      host: 'alice',
      state: 'paused',
      participants: participants.join(','),
    }).toString();
    const publishWatchTogether = seedWatch(raw);

    render(() => <WatchTogetherActivity />);

    const joinButton = screen.getByRole('button', {
      name: `Join activity unavailable: activity full (${WATCH_PARTICIPANT_MAX_COUNT} participants)`,
    });
    expect(joinButton).toBeDisabled();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      `${WATCH_PARTICIPANT_MAX_COUNT} of ${WATCH_PARTICIPANT_MAX_COUNT} participant spots used. Activity full`,
    );
    fireEvent.click(joinButton);
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it('reports activity updates as unavailable and preserves the bystander role', () => {
    seedWatch('title=Demo;host=alice;state=paused;participants=alice');
    store.setState({ client: null });

    render(() => <WatchTogetherActivity />);

    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Not joined. 1 of 128 participant spots used. Updates unavailable',
    );
    expect(screen.getByRole('button', {
      name: 'Join activity unavailable: updates unavailable',
    })).toBeDisabled();
  });

  it('keeps the current role and wire state when publication fails', () => {
    const publishWatchTogether = vi.fn(() => {
      throw new Error('offline');
    });
    const raw = 'title=Demo;host=alice;state=paused;participants=alice';
    seedWatch(raw, 'self', publishWatchTogether);

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Join activity: Demo' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Not joined. 1 of 128 participant spots used. Could not update the activity. Your role is unchanged',
    );
    expect(screen.getByRole('button', { name: 'Join activity: Demo' })).toBeInTheDocument();
    expect(store.getState().channelProps.get('#watch')?.['ocean.watch']).toBe(raw);
  });

  it('requires host confirmation, reports the request, and restores focus without hiding optimistically', async () => {
    const raw = 'title=Demo;host=self;state=paused;participants=self,bob';
    const publishWatchTogether = seedWatch(raw);

    render(() => <WatchTogetherActivity />);
    const trigger = screen.getByRole('button', { name: 'End activity: Demo' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(publishWatchTogether).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('group', { name: 'Confirm ending Demo' });
    expect(confirmation).toHaveTextContent('End “Demo”?');
    expect(confirmation).toHaveTextContent('remove the activity for 2 participants');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm end activity' })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end activity' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', null);
    expect(screen.getByLabelText(/Watch together: Demo/)).toBeInTheDocument();
    const status = screen.getByTestId('watch-participation-status');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent(
      'End requested for Demo. The activity remains visible until the server confirms removal',
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'End activity: Demo' })).toHaveFocus();
    });
  });

  it('cancels ending without publishing and restores focus to the trigger', async () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=self;state=paused;participants=self',
    );

    render(() => <WatchTogetherActivity />);
    const trigger = screen.getByRole('button', { name: 'End activity: Demo' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm end activity' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel ending activity' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'End activity: Demo' })).toHaveFocus();
    });
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it('does not expose end controls to a non-host', () => {
    seedWatch('title=Demo;host=alice;state=paused;participants=alice,self');

    render(() => <WatchTogetherActivity />);

    expect(screen.queryByTestId('watch-end-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('watch-end-confirmation')).not.toBeInTheDocument();
  });

  it('dismisses a staged end confirmation when host ownership changes', async () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=self;state=paused;participants=self,alice',
    );

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'End activity: Demo' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm end activity' })).toHaveFocus();
    });
    store.setState({
      channelProps: new Map([
        ['#watch', { 'ocean.watch': 'title=Demo;host=alice;state=paused;participants=self,alice' }],
      ]),
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.queryByTestId('watch-end-confirmation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('watch-end-button')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Watch together: Demo, Paused, host alice/)).toBeInTheDocument();
  });

  it('dismisses a staged end confirmation when the activity wire value changes', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=self;state=paused;position=2;participants=self',
    );

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'End activity: Demo' }));
    store.setState({
      channelProps: new Map([
        ['#watch', { 'ocean.watch': 'title=Demo;host=self;state=paused;position=3;participants=self' }],
      ]),
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.queryByTestId('watch-end-confirmation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End activity: Demo' })).toBeInTheDocument();
  });

  it('dismisses a staged end confirmation when the active channel changes', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=self;state=paused;participants=self',
    );

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'End activity: Demo' }));
    store.setState({
      activeView: { kind: 'channel', channel: '#other' },
      channelProps: new Map([
        ['#watch', { 'ocean.watch': 'title=Demo;host=self;state=paused;participants=self' }],
        ['#other', { 'ocean.watch': 'title=Other;host=self;state=paused;participants=self' }],
      ]),
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.queryByTestId('watch-end-confirmation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End activity: Other' })).toBeInTheDocument();
  });

  it('preserves the confirmation and activity when publishing becomes unavailable', () => {
    const raw = 'title=Demo;host=self;state=paused;participants=self';
    const publishWatchTogether = seedWatch(raw);

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'End activity: Demo' }));
    store.setState({ client: null });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end activity' }));

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-end-confirmation')).toBeInTheDocument();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Could not end the activity because activity updates are unavailable',
    );
    expect(store.getState().channelProps.get('#watch')?.['ocean.watch']).toBe(raw);
  });

  it('preserves the confirmation and activity when clearing throws', () => {
    const raw = 'title=Demo;host=self;state=paused;participants=self';
    const publishWatchTogether = vi.fn(() => {
      throw new Error('offline');
    });
    seedWatch(raw, 'self', publishWatchTogether);

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'End activity: Demo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end activity' }));

    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', null);
    expect(screen.getByTestId('watch-end-confirmation')).toBeInTheDocument();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Could not end the activity. It remains active',
    );
    expect(store.getState().channelProps.get('#watch')?.['ocean.watch']).toBe(raw);
  });

  it('allows the current host to end an activity during a pending handoff', () => {
    const publishWatchTogether = seedWatch(
      'title=Demo;host=self;state=handoff;participants=self,bob;handoff=bob',
    );

    render(() => <WatchTogetherActivity />);

    expect(screen.getByRole('button', { name: 'Cancel handoff' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End activity: Demo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end activity' }));
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', null);
  });

  it('keeps the empty state compact and restores focus after the editor closes', async () => {
    seedEmptyWatch();

    render(() => <WatchTogetherActivity />);

    const launcher = screen.getByRole('button', { name: 'Start watch activity' });
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    expect(launcher).toHaveAttribute('aria-controls', 'watch-start-editor');
    expect(screen.queryByRole('form', { name: 'Start watch activity' })).not.toBeInTheDocument();

    fireEvent.click(launcher);

    expect(launcher).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('form', { name: 'Start watch activity' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Activity title' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close activity editor' }));

    expect(screen.queryByRole('form', { name: 'Start watch activity' })).not.toBeInTheDocument();
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(launcher).toHaveFocus());
  });

  it('reviews and publishes a bounded room-wide activity, then restores focus', async () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    const form = openStartEditor();
    expect(form).toHaveTextContent('room-wide');
    expect(form).toHaveTextContent('never saved');
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Movie night' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Media URL (optional, http or https)' }), {
      target: { value: 'https://example.test/movie' },
    });
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Duration in seconds (optional)' }), {
      target: { value: '120' },
    });
    fireEvent.submit(form);

    const review = screen.getByTestId('watch-start-review');
    expect(review).toHaveTextContent('Review room-wide activity');
    expect(review).toHaveTextContent('Host self in #watch');
    expect(review).toHaveTextContent('https://example.test/movie');
    expect(review).toHaveTextContent('120 seconds');
    expect(publishWatchTogether).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm start activity' })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm start activity' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
      title: 'Movie night',
      url: 'https://example.test/movie',
      host: 'self',
      state: 'paused',
      positionSeconds: 0,
      durationSeconds: 120,
      participants: ['self'],
      handoffTo: null,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Start requested for Movie night. Waiting for the room to confirm it',
    );
    expect(screen.getByRole('textbox', { name: 'Activity title' })).toHaveValue('');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Review activity' })).toHaveFocus();
    });
  });

  it('rejects missing and oversized titles and out-of-range durations before review', () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    const form = openStartEditor();
    fireEvent.submit(form);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an activity title');

    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 't'.repeat(WATCH_TITLE_MAX_LENGTH + 1) },
    });
    fireEvent.submit(form);
    expect(screen.getByRole('alert')).toHaveTextContent(
      `Activity titles must be ${WATCH_TITLE_MAX_LENGTH} characters or fewer`,
    );

    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Bounded movie' },
    });
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Duration in seconds (optional)' }), {
      target: { value: String(WATCH_SECONDS_MAX + 1) },
    });
    fireEvent.submit(form);
    expect(screen.getByRole('alert')).toHaveTextContent(
      `Duration must be a whole number from 0 to ${WATCH_SECONDS_MAX} seconds`,
    );
    expect(screen.queryByTestId('watch-start-review')).not.toBeInTheDocument();
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it('rejects unsafe or malformed media URLs before review', () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    openStartEditor();
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Unsafe movie' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Media URL (optional, http or https)' }), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Start watch activity' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Activity URL must be a valid http:// or https:// address',
    );
    expect(screen.queryByTestId('watch-start-review')).not.toBeInTheDocument();
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it('dismisses a staged review when an authoritative activity arrives in the same channel', async () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    openStartEditor();
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'My movie' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Media URL (optional, http or https)' }), {
      target: { value: 'https://private.example/my-movie' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Start watch activity' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm start activity' })).toHaveFocus();
    });
    store.setState({
      channelProps: new Map([
        ['#watch', { 'ocean.watch': 'title=Existing;host=alice;state=paused;participants=alice' }],
      ]),
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.queryByTestId('watch-start-review')).not.toBeInTheDocument();
    expect(screen.queryByText('My movie')).not.toBeInTheDocument();
    expect(screen.queryByText('https://private.example/my-movie')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Watch together: Existing/)).toBeInTheDocument();
  });

  it('drops room-scoped review details and drafts when the active channel changes', () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    openStartEditor();
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Channel-specific movie' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Media URL (optional, http or https)' }), {
      target: { value: 'https://private.example/old-room' },
    });
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Duration in seconds (optional)' }), {
      target: { value: '120' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Start watch activity' }));
    expect(screen.getByTestId('watch-start-review')).toHaveTextContent('Channel-specific movie');

    store.setState({ activeView: { kind: 'channel', channel: '#other' } });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.queryByTestId('watch-start-review')).not.toBeInTheDocument();
    expect(screen.queryByText('Channel-specific movie')).not.toBeInTheDocument();
    expect(screen.queryByText('https://private.example/old-room')).not.toBeInTheDocument();

    openStartEditor();
    expect(screen.getByRole('textbox', { name: 'Activity title' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Media URL (optional, http or https)' })).toHaveValue('');
    expect(screen.getByRole('spinbutton', { name: 'Duration in seconds (optional)' })).toHaveValue(null);
  });

  it('preserves reviewed inputs when publishing becomes unavailable', () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    openStartEditor();
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Keep this movie' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Start watch activity' }));
    store.setState({ client: null });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm start activity' }));

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-start-review')).toHaveTextContent('Keep this movie');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start the activity because activity updates are unavailable',
    );
  });

  it('preserves reviewed inputs when publishing throws', () => {
    const publishWatchTogether = vi.fn(() => {
      throw new Error('offline');
    });
    seedEmptyWatch('self', publishWatchTogether);

    render(() => <WatchTogetherActivity />);
    openStartEditor();
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Retry this movie' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Start watch activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm start activity' }));

    expect(publishWatchTogether).toHaveBeenCalledOnce();
    expect(screen.getByTestId('watch-start-review')).toHaveTextContent('Retry this movie');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start the activity. Your reviewed details were preserved',
    );
  });

  it('cancels start review, preserves inputs, and restores focus', async () => {
    const publishWatchTogether = seedEmptyWatch();

    render(() => <WatchTogetherActivity />);
    openStartEditor();
    fireEvent.input(screen.getByRole('textbox', { name: 'Activity title' }), {
      target: { value: 'Maybe later' },
    });
    const reviewButton = screen.getByRole('button', { name: 'Review activity' });
    reviewButton.focus();
    fireEvent.click(reviewButton);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm start activity' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel starting activity' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Review activity' })).toHaveFocus();
    });
    expect(screen.getByRole('textbox', { name: 'Activity title' })).toHaveValue('Maybe later');
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it.each([
    ['a direct-message view', 'self', { kind: 'dm', nick: 'alice' } as const],
    ['a signed-out channel', null, { kind: 'channel', channel: '#watch' } as const],
  ])('does not show the start surface for %s', (_label, nick, activeView) => {
    const publishWatchTogether = seedEmptyWatch(nick);
    store.setState({ activeView });

    render(() => <WatchTogetherActivity />);

    expect(screen.queryByRole('form', { name: 'Start watch activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start watch activity' })).not.toBeInTheDocument();
    expect(publishWatchTogether).not.toHaveBeenCalled();
  });

  it('discloses the deduplicated roster with host and local-user roles', () => {
    seedWatch(
      'title=Roster;url=javascript%3Aalert%281%29;host=ALICE;state=paused;participants=Alice,BOB,SELF,alice,bob;secret=do-not-render',
      'self',
    );

    render(() => <WatchTogetherActivity />);
    const toggle = screen.getByRole('button', { name: 'Show participants (3)' });
    fireEvent.click(toggle);

    const region = screen.getByRole('region', { name: 'Watch participants (3)' });
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent('Alice — Host');
    expect(entries[1]).toHaveTextContent('BOB');
    expect(entries[2]).toHaveTextContent('SELF — You');
    expect(region).not.toHaveTextContent('javascript:alert');
    expect(region).not.toHaveTextContent('do-not-render');
  });

  it('combines mixed-case pending-host and local-user labels on one identity', () => {
    seedWatch(
      'title=Handoff;host=Alice;state=handoff;participants=alice,BOB,bob;handoff=bob',
      'BoB',
    );

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Show participants (2)' }));

    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('alice — Host');
    expect(entries[1]).toHaveTextContent('BOB — Pending host, You');
    expect(screen.getAllByText(/Pending host/)).toHaveLength(1);
  });

  it('reports an exact empty roster without inventing the host as a participant', () => {
    seedWatch('title=Empty;host=alice;state=paused');

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Show participants (0)' }));

    expect(screen.getByRole('region', { name: 'Watch participants (0)' })).toHaveTextContent(
      'No participants are listed for this activity.',
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders no more than the normalized maximum roster size', () => {
    const participants = Array.from(
      { length: WATCH_PARTICIPANT_MAX_COUNT + 20 },
      (_, index) => `p${index}`,
    );
    const raw = new URLSearchParams({
      title: 'Bounded roster',
      state: 'paused',
      participants: participants.join(','),
    }).toString();
    seedWatch(raw);

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', {
      name: `Show participants (${WATCH_PARTICIPANT_MAX_COUNT})`,
    }));

    expect(screen.getAllByRole('listitem')).toHaveLength(WATCH_PARTICIPANT_MAX_COUNT);
    expect(screen.queryByText(`p${WATCH_PARTICIPANT_MAX_COUNT}`)).not.toBeInTheDocument();
  });

  it('closes the roster on activity replacement and on a same-value channel switch', () => {
    const first = 'title=First;state=paused;participants=alice,bob';
    const replacement = 'title=Replacement;state=paused;participants=carol';
    seedWatch(first);

    render(() => <WatchTogetherActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Show participants (2)' }));
    expect(screen.getByRole('region', { name: 'Watch participants (2)' })).toBeInTheDocument();

    store.setState({
      channelProps: new Map([
        ['#watch', { 'ocean.watch': replacement }],
        ['#other', { 'ocean.watch': replacement }],
      ]),
    });
    expect(screen.getByRole('button', { name: 'Show participants (1)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('region', { name: /Watch participants/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show participants (1)' }));
    store.setState({ activeView: { kind: 'channel', channel: '#other' } });
    expect(screen.getByRole('button', { name: 'Show participants (1)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('region', { name: /Watch participants/ })).not.toBeInTheDocument();
  });

  it('provides a named keyboard-operable disclosure and roster list', () => {
    seedWatch('title=Keyboard;state=paused;participants=self');

    render(() => <WatchTogetherActivity />);
    const toggle = screen.getByRole('button', { name: 'Show participants (1)' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'watch-participant-roster');
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Enter' });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Hide participants (1)');
    expect(screen.getByRole('region', { name: 'Watch participants (1)' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Participant roster' })).toBeInTheDocument();

    fireEvent.keyDown(toggle, { key: ' ' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /Watch participants/ })).not.toBeInTheDocument();
  });

  it('ticks the exact authoritative wire snapshot before a normal roster mutation', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const publishWatchTogether = seedWatch(
        'title=Live;host=alice;state=playing;position=5;participants=alice',
      );
      render(() => <WatchTogetherActivity />);
      vi.advanceTimersByTime(3_000);

      fireEvent.click(screen.getByRole('button', { name: 'Join activity: Live' }));

      expect(publishWatchTogether).toHaveBeenCalledWith('#watch', {
        title: 'Live',
        url: null,
        host: 'alice',
        state: 'playing',
        positionSeconds: 8,
        durationSeconds: null,
        participants: ['alice', 'self'],
        handoffTo: null,
      });
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not publish pause from a control whose raw activity changed during activation', () => {
    const publishWatchTogether = seedWatch(
      'title=Race;host=self;state=playing;position=3;participants=self',
    );
    render(() => <WatchTogetherActivity />);
    const pauseButton = screen.getByRole('button', { name: 'Pause' });

    clickWithDrift(pauseButton, () => {
      store.setState({
        channelProps: new Map([
          ['#watch', { 'ocean.watch': 'title=Race;host=self;state=paused;position=9;participants=self' }],
        ]),
      });
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Could not pause playback because the watch activity changed',
    );
  });

  it('does not carry an old channel action into the newly active channel', () => {
    const publishWatchTogether = seedWatch(
      'title=Old room;host=alice;state=paused;participants=alice',
    );
    render(() => <WatchTogetherActivity />);
    const joinButton = screen.getByRole('button', { name: 'Join activity: Old room' });

    clickWithDrift(joinButton, () => {
      store.setState({ activeView: { kind: 'channel', channel: '#other' } });
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not join the activity because the active channel changed',
    );
  });

  it('does not accept a handoff after the signed-in identity changes during activation', () => {
    const publishWatchTogether = seedWatch(
      'title=Identity;host=alice;state=handoff;participants=alice,SELF;handoff=self',
    );
    render(() => <WatchTogetherActivity />);
    const acceptButton = screen.getByRole('button', { name: 'Accept host' });

    clickWithDrift(acceptButton, () => {
      store.setState({ ourNick: 'carol' });
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Could not accept host because your signed-in identity changed',
    );
  });

  it('does not use host controls after host authority changes during activation', () => {
    const publishWatchTogether = seedWatch(
      'title=Host race;host=self;state=paused;participants=self,bob',
    );
    render(() => <WatchTogetherActivity />);
    const playButton = screen.getByRole('button', { name: 'Play' });

    clickWithDrift(playButton, () => {
      store.setState({
        channelProps: new Map([
          ['#watch', { 'ocean.watch': 'title=Host%20race;host=bob;state=paused;participants=self,bob' }],
        ]),
      });
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Could not start playback because the watch activity changed',
    );
  });

  it('does not accept after the pending handoff target changes during activation', () => {
    const publishWatchTogether = seedWatch(
      'title=Target;host=alice;state=handoff;participants=alice,self,carol;handoff=self',
    );
    render(() => <WatchTogetherActivity />);
    const acceptButton = screen.getByRole('button', { name: 'Accept host' });

    clickWithDrift(acceptButton, () => {
      store.setState({
        channelProps: new Map([
          ['#watch', { 'ocean.watch': 'title=Target;host=alice;state=handoff;participants=alice,self,carol;handoff=carol' }],
        ]),
      });
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent(
      'Could not accept host because the watch activity changed',
    );
  });

  it('rechecks exact roster capacity when join activation races a full snapshot', () => {
    const initialParticipants = [
      'alice',
      ...Array.from(
        { length: WATCH_PARTICIPANT_MAX_COUNT - 2 },
        (_, index) => `p${index}`,
      ),
    ];
    const fullParticipants = [...initialParticipants, 'last'];
    const initialRaw = new URLSearchParams({
      title: 'Capacity',
      host: 'alice',
      state: 'paused',
      participants: initialParticipants.join(','),
    }).toString();
    const fullRaw = new URLSearchParams({
      title: 'Capacity',
      host: 'alice',
      state: 'paused',
      participants: fullParticipants.join(','),
    }).toString();
    const publishWatchTogether = seedWatch(initialRaw);
    render(() => <WatchTogetherActivity />);
    const joinButton = screen.getByRole('button', { name: 'Join activity: Capacity' });

    clickWithDrift(joinButton, () => {
      store.setState({
        channelProps: new Map([['#watch', { 'ocean.watch': fullRaw }]]),
      });
    });

    expect(publishWatchTogether).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-participation-status')).toHaveTextContent('Activity full');
    expect(screen.getByRole('button', {
      name: `Join activity unavailable: activity full (${WATCH_PARTICIPANT_MAX_COUNT} participants)`,
    })).toBeDisabled();
  });
});
