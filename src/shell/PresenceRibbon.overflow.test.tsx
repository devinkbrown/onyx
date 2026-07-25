// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PresenceRibbon.overflow.test.tsx — A8 place-strip compression + B3 pins bar.
 *
 * Secondary chrome lives behind a single More disclosure while primary place
 * signals (event, voice, jump-to-date, join, pins count) stay one click away.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { PresenceRibbon } from './PresenceRibbon';

vi.mock('@/lib/prefs/preferences', () => ({ openPreferences: vi.fn() }));
vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('./PresenceHeatline', () => ({ PresenceHeatline: () => null }));
vi.mock('./Facepile', () => ({ Facepile: () => null }));

const initialState = store.getInitialState();

function makeUser(nick: string): ChannelUser {
  return { nick, modes: new Set() };
}

function seedChannel(name = '#general'): void {
  const users = new Map<string, ChannelUser>([
    ['alice', makeUser('alice')],
    ['bob', makeUser('bob')],
  ]);
  const channel: Channel = {
    name,
    topic: 'place strip topic',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
  store.setState({
    ...initialState,
    connectionStatus: 'connected',
    activeView: { kind: 'channel', channel: name },
    channels: new Map([[name, channel]]),
  });
}

function moreTrigger(): HTMLElement {
  // Popover wraps the trigger content in its own button; the testid sits on the
  // inner surface, so climb to the real disclosure control.
  const surface = screen.getByTestId('ribbon-more');
  return (surface.closest('button') ?? surface) as HTMLElement;
}

function openMore(): void {
  fireEvent.click(moreTrigger());
}

describe('PresenceRibbon place-strip compression (A8)', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    vi.mocked(openPreferences).mockReset();
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    vi.restoreAllMocks();
  });

  it('exposes a More disclosure and keeps jump-to-date on the primary strip', () => {
    seedChannel();
    render(() => <PresenceRibbon />);

    expect(screen.getByTestId('ribbon-more')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    // Presence count stays on the strip; secondary chrome waits for More.
    expect(screen.getByTestId('ribbon-members')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-preferences')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-settings-gear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-account-chip')).not.toBeInTheDocument();
    // B3 always-on pins chip: present in a channel even with zero pins (no count badge).
    const pins = screen.getByTestId('ribbon-pins');
    expect(pins).toBeInTheDocument();
    expect(pins).toHaveAttribute('aria-label', 'Pinned messages');
  });

  it('keeps event and voice chips on the primary strip when present', () => {
    const eventAt = Math.floor(Date.now() / 1000) + 1800;
    seedChannel();
    store.setState({
      channelProps: new Map([['#general', { 'ocean.event': `${eventAt}|Office hours` }]]),
      voiceChannelParticipants: new Map([['#general', new Set(['alice'])]]),
    });
    render(() => <PresenceRibbon showJoinVoice onJoinVoice={() => {}} />);

    expect(screen.getByRole('button', { name: /Scheduled room event/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 person in voice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join call' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join voice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join video' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
  });

  it('surfaces pins on the primary strip and secondary actions only after More', () => {
    seedChannel();
    store.setState({
      channelProps: new Map([['#general', { PINS: 'msg-1,msg-2' }]]),
    });
    const openPins = vi.spyOn(store.getState(), 'openPinnedMessages');
    render(() => <PresenceRibbon />);

    // B3 pins bar: one-click chip on Place cluster, not buried in More.
    const pins = screen.getByTestId('ribbon-pins');
    expect(pins).toBeInTheDocument();
    expect(pins).toHaveAttribute('aria-label', '2 pinned messages');
    fireEvent.click(pins);
    expect(openPins).toHaveBeenCalledTimes(1);

    openMore();
    expect(screen.getByRole('dialog', { name: 'More channel and workspace actions' })).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-more-menu')).toBeInTheDocument();
    // Pins are not duplicated inside More.
    expect(screen.getAllByTestId('ribbon-pins')).toHaveLength(1);
    expect(screen.getByTestId('ribbon-preferences')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-settings-gear')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-account-chip')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-more-channel')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /Notifications for/ })).toBeInTheDocument();
    // Hierarchy kickers (visual only) — Channel tools then Workspace chrome.
    expect(screen.getByText('Channel')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('opens account from the More menu and preserves accessible names', () => {
    seedChannel();
    render(() => <PresenceRibbon />);

    openMore();
    const account = screen.getByTestId('ribbon-account-chip');
    expect(account).toHaveAttribute('aria-label', 'Guest — open account panel');
    fireEvent.click(account);
    expect(store.getState().showAccount).toBe(true);
  });

  it('closes More before handing off to a secondary panel', async () => {
    seedChannel();
    render(() => <PresenceRibbon />);
    const more = moreTrigger();

    openMore();
    expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByTestId('ribbon-preferences'));

    await waitFor(() => {
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('ribbon-more-menu')).not.toBeInTheDocument();
    });
    expect(openPreferences).toHaveBeenCalledTimes(1);
  });

  it('restores focus to More when Escape closes the overflow', async () => {
    seedChannel();
    render(() => <PresenceRibbon />);
    const more = moreTrigger();

    more.focus();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('ribbon-more-menu')).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    });
  });

  it('still wires jump-to-date to openJumpToDate on the primary strip', () => {
    seedChannel();
    const openSpy = vi.spyOn(store.getState(), 'openJumpToDate');
    render(() => <PresenceRibbon />);

    fireEvent.click(screen.getByTestId('ribbon-jump-to-date'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
  });

  it('shows jump-to-date and More for DMs without channel-only secondary items', () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView: { kind: 'dm', nick: 'alice' },
    });
    render(() => <PresenceRibbon />);

    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-more')).toBeInTheDocument();
    openMore();
    expect(screen.getByTestId('ribbon-preferences')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-settings-gear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-more-channel')).not.toBeInTheDocument();
    expect(screen.queryByText('Channel')).not.toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });
});
