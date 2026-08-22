// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PresenceRibbon.overflow.test.tsx — commercial room-header slice.
 *
 * 4-zone place header: Call · People · Search · More; pins + Jump to date in More;
 * People visible at 0 with truthful aria-expanded; conn always present;
 * call lifecycle truth table; More section headings + valid menus.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toB64url } from '@/lib/e2ee/dmCipher';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import type { CallState } from '@/lib/cadence-media/types';
import { PresenceRibbon } from './PresenceRibbon';

function validPeerKey(): string {
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.fill(7, 1);
  return toB64url(raw);
}

vi.mock('@/lib/prefs/preferences', () => ({
  openPreferences: vi.fn(),
  preferences: () => ({ experienceMode: 'standard' }),
}));
vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('./PresenceHeatline', () => ({ PresenceHeatline: () => null }));
// Stub preserves Facepile's real root class so hide-CSS coupling is testable.
vi.mock('./Facepile', () => ({
  Facepile: () => <div class="shell-facepile" data-testid="facepile-stub" />,
}));

const initialState = store.getInitialState();

function makeUser(nick: string): ChannelUser {
  return { nick, modes: new Set() };
}

function seedChannel(name = '#general', users?: Map<string, ChannelUser>): void {
  const roster = users ?? new Map<string, ChannelUser>([
    ['alice', makeUser('alice')],
    ['bob', makeUser('bob')],
  ]);
  const channel: Channel = {
    name,
    topic: 'place strip topic',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users: roster,
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

function setRoomVoice(
  channel: string,
  callState: CallState,
  callStartedAt: number | null,
): void {
  store.setState({
    voice: {
      ...store.getState().voice,
      callState,
      callChannel: channel,
      callStartedAt,
    },
  });
}

describe('PresenceRibbon commercial room header', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    vi.restoreAllMocks();
  });

  it('exposes Search, More and People on the primary strip; demotes pins and Jump to date into More', () => {
    seedChannel();
    render(() => <PresenceRibbon />);

    expect(screen.getByTestId('ribbon-more')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-members')).toBeInTheDocument();
    const search = screen.getByRole('button', { name: 'Search messages' });
    expect(search).toBeInTheDocument();
    expect(search).toHaveAttribute('data-testid', 'ribbon-search');
    expect(search).toHaveAttribute('aria-pressed', 'false');
    // Jump to date is not a primary header control.
    expect(screen.queryByTestId('ribbon-jump-to-date')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-preferences')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-settings-gear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-account-chip')).not.toBeInTheDocument();
    // Pins leave the primary strip in the commercial header.
    expect(screen.queryByTestId('ribbon-pins')).not.toBeInTheDocument();

    openMore();
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Search messages' })).not.toBeInTheDocument();
  });

  it('keeps Search off the Home ribbon so the welcome Search messages CTA stays the single Home door', () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
    });
    render(() => <PresenceRibbon />);

    expect(screen.queryByTestId('ribbon-search')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search messages' })).toBeNull();
  });

  it('uses a room-specific mobile overflow while the persistent Menu owns workspace settings', () => {
    seedChannel();
    render(() => <PresenceRibbon contextActionsOnly />);

    expect(screen.getByRole('button', { name: 'Room actions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Room actions' }));
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-appearance')).toBeNull();
    expect(screen.queryByTestId('ribbon-preferences')).toBeNull();
    expect(screen.queryByTestId('ribbon-account-chip')).toBeNull();
  });

  it.each([
    { label: 'Home', activeView: { kind: 'home' as const } },
    { label: 'Activity', activeView: { kind: 'status' as const } },
    { label: 'a stale resumed channel', activeView: { kind: 'channel' as const, channel: '#missing' } },
  ])('hides context-only actions on $label when no live conversation context exists', ({ activeView }) => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView,
      channels: new Map(),
      dms: new Map(),
    });
    render(() => <PresenceRibbon contextActionsOnly />);

    expect(screen.queryByTestId('ribbon-more')).toBeNull();
    expect(screen.queryByRole('button', { name: /Room actions|Conversation actions/ })).toBeNull();
    if (activeView.kind === 'home') {
      expect(screen.queryByTestId('ribbon-search')).toBeNull();
    }
  });

  it('keeps a healthy mobile DM context operable and correctly labelled', () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView: { kind: 'dm', nick: 'alice' },
      dms: new Map([['alice', {
        nick: 'alice',
        account: null,
        unread: 0,
        highlights: 0,
        messages: [],
      }]]),
    });
    render(() => <PresenceRibbon contextActionsOnly />);

    const trigger = screen.getByRole('button', { name: 'Conversation actions' });
    fireEvent.click(trigger);
    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).toBeNull();
  });

  it('shows People at zero members with accessible count and no aria-pressed', () => {
    seedChannel('#empty', new Map());
    // Drive the surface explicitly (rather than relying on the store's default
    // showMemberList fallback) so the closed-state assertion is deterministic.
    render(() => <PresenceRibbon membersOpen={false} />);

    const people = screen.getByTestId('ribbon-members');
    expect(people).toBeInTheDocument();
    expect(people).toHaveAttribute('aria-label', '0 members — toggle member list');
    // The trigger is a disclosure, not a toggle button — aria-expanded is the
    // correct state property; aria-pressed must not be present at all.
    expect(people).toHaveAttribute('aria-expanded', 'false');
    expect(people).not.toHaveAttribute('aria-pressed');
    expect(people.querySelector('.shell-ribbon-count')).toHaveTextContent('0');
  });

  it('uses membersOpen for People aria-expanded (AppShell membersVisible wiring)', () => {
    seedChannel();
    const { unmount } = render(() => <PresenceRibbon membersOpen={false} />);
    expect(screen.getByTestId('ribbon-members')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('ribbon-members')).not.toHaveAttribute('aria-pressed');
    unmount();

    render(() => <PresenceRibbon membersOpen={true} />);
    expect(screen.getByTestId('ribbon-members')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('ribbon-members')).not.toHaveAttribute('aria-pressed');
  });

  it('mirrors the real open surface even with an empty roster (membersOpen=true)', () => {
    // The 353 NAMES burst has not landed yet, but the member drawer is a real
    // role="dialog" surface — the trigger must not lie about it being closed.
    seedChannel('#empty', new Map());
    render(() => <PresenceRibbon membersOpen={true} />);

    const people = screen.getByTestId('ribbon-members');
    expect(people).toHaveAttribute('aria-label', '0 members — toggle member list');
    expect(people).toHaveAttribute('aria-expanded', 'true');
    expect(people).not.toHaveAttribute('aria-pressed');
  });

  it('keeps connection status present with a11y text (narrow-safe structure)', () => {
    seedChannel();
    render(() => <PresenceRibbon />);

    const conn = screen.getByTestId('ribbon-conn');
    expect(conn).toBeInTheDocument();
    expect(conn).toHaveAttribute('aria-live', 'polite');
    expect(conn).toHaveAttribute('data-state', 'connected');
    expect(conn.querySelector('.shell-ribbon-conn-dot')).toBeTruthy();
    expect(conn.textContent).toMatch(/Connection:\s*connected/i);
    // Must not carry a display-none utility class; compact is CSS-only.
    expect(conn).not.toHaveClass('hidden');
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
    // Jump to date is in More, not primary.
    expect(screen.queryByTestId('ribbon-jump-to-date')).not.toBeInTheDocument();
  });

  it('presents ringing / provisional / established call lifecycle without join accept', () => {
    seedChannel();

    // ringing_in — sparse Incoming; no Join call
    setRoomVoice('#general', 'ringing_in', null);
    const view = render(() => <PresenceRibbon showJoinVoice onJoinVoice={() => {}} />);
    let status = screen.getByTestId('ribbon-call-status');
    expect(status).toHaveAttribute('data-presentation', 'ringing_in');
    expect(status).toHaveTextContent('Incoming');
    expect(screen.queryByRole('button', { name: 'Join call' })).not.toBeInTheDocument();
    expect(status.className).not.toMatch(/--active/);

    // ringing_out
    setRoomVoice('#general', 'ringing_out', null);
    status = screen.getByTestId('ribbon-call-status');
    expect(status).toHaveAttribute('data-presentation', 'ringing_out');
    expect(status).toHaveTextContent('Calling');
    expect(screen.queryByRole('button', { name: 'Join call' })).not.toBeInTheDocument();

    // provisional in_call — Connecting…, not established paint
    setRoomVoice('#general', 'in_call', null);
    status = screen.getByTestId('ribbon-call-status');
    expect(status).toHaveAttribute('data-presentation', 'provisional');
    expect(status).toHaveTextContent('Connecting…');
    expect(status.className).not.toMatch(/voice-chip--active/);
    expect(screen.queryByRole('button', { name: 'Join call' })).not.toBeInTheDocument();

    // established — In call with active mark when no occupancy chip
    setRoomVoice('#general', 'in_call', 1_700_000_000_000);
    status = screen.getByTestId('ribbon-call-status');
    expect(status).toHaveAttribute('data-presentation', 'established');
    expect(status).toHaveTextContent('In call');
    expect(status.className).toMatch(/voice-chip--active/);
    expect(screen.queryByRole('button', { name: 'Join call' })).not.toBeInTheDocument();

    // idle restore — Join call returns
    setRoomVoice('#general', 'idle', null);
    store.setState({
      voice: {
        ...store.getState().voice,
        callState: 'idle',
        callChannel: null,
        callStartedAt: null,
      },
    });
    expect(screen.getByRole('button', { name: 'Join call' })).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-call-status')).not.toBeInTheDocument();

    view.unmount();
  });

  it('puts Join call in More when the ribbon Call control is hidden', () => {
    seedChannel();
    const onJoinVoice = vi.fn();
    render(() => <PresenceRibbon onJoinVoice={onJoinVoice} />);

    expect(screen.queryByTestId('ribbon-join-call')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ribbon-more'));
    fireEvent.click(screen.getByTestId('ribbon-more-join-call'));
    expect(onJoinVoice).toHaveBeenCalledWith(false);
  });

  it('surfaces pins + Jump to date inside grouped More (This room) with valid menus', () => {
    seedChannel();
    store.setState({
      channelProps: new Map([['#general', { PINS: 'msg-1,msg-2' }]]),
    });
    const openPins = vi.spyOn(store.getState(), 'openPinnedMessages');
    render(() => <PresenceRibbon />);

    expect(screen.queryByTestId('ribbon-pins')).not.toBeInTheDocument();

    openMore();
    expect(screen.getByRole('dialog', { name: 'More room and workspace actions' })).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-more-menu')).toBeInTheDocument();

    // Visible section headings (not aria-hidden) name real semantic groups
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('This room')).toBeInTheDocument();
    expect(screen.queryByText('Channel')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(screen.getByText('Alerts')).not.toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('This room')).not.toHaveAttribute('aria-hidden', 'true');

    // Labelled section wrappers are role=group (labels name the groups)
    const alertsGroup = screen.getByRole('group', { name: 'Alerts' });
    const roomGroup = screen.getByRole('group', { name: 'This room' });
    const youGroup = screen.getByRole('group', { name: 'You' });
    expect(alertsGroup).toHaveClass('shell-ribbon-more-section');
    expect(roomGroup).toHaveClass('shell-ribbon-more-section');
    expect(youGroup).toHaveClass('shell-ribbon-more-section');
    expect(youGroup.querySelector('.shell-ribbon-more-label')).not.toHaveAttribute('aria-hidden', 'true');

    // Menus only contain menuitem children (headings/groups live outside role=menu)
    const menus = screen.getAllByRole('menu');
    expect(menus.length).toBeGreaterThanOrEqual(2);
    for (const menu of menus) {
      const kids = Array.from(menu.children);
      for (const kid of kids) {
        expect(kid.getAttribute('role')).toBe('menuitem');
      }
    }

    expect(screen.queryByTestId('ribbon-preferences')).not.toBeInTheDocument();
    expect(screen.getByTestId('ribbon-settings-gear')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-account-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-appearance')).not.toBeInTheDocument();
    expect(screen.getByTestId('ribbon-more-channel')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /Notifications for/ })).toBeInTheDocument();

    // Menu order: This room items before You items (single roving set under panel)
    const panel = screen.getByTestId('ribbon-more-menu');
    const items = Array.from(panel.querySelectorAll('[role="menuitem"]'));
    const labels = items.map((el) => el.textContent ?? '');
    const inviteIdx = labels.findIndex((t) => t.includes('Invite friends'));
    const settingsIdx = labels.findIndex((t) => t.includes('Room settings'));
    const ledgerIdx = labels.findIndex((t) => t.includes('Room ledger'));
    const pinsIdx = labels.findIndex((t) => t.includes('Pinned messages'));
    const jumpIdx = labels.findIndex((t) => t.includes('Jump to date'));
    const youIdx = labels.findIndex((t) => t.includes('You') || t.includes('Guest'));
    expect(inviteIdx).toBeGreaterThanOrEqual(0);
    expect(settingsIdx).toBeGreaterThan(inviteIdx);
    expect(ledgerIdx).toBeGreaterThan(settingsIdx);
    expect(pinsIdx).toBeGreaterThan(ledgerIdx);
    expect(jumpIdx).toBeGreaterThan(pinsIdx);
    expect(youIdx).toBeGreaterThan(jumpIdx);
    expect(screen.getByTestId('ribbon-channel-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );

    const pins = screen.getByTestId('ribbon-pins');
    expect(pins).toBeInTheDocument();
    expect(pins).toHaveAttribute('aria-label', '2 pinned messages');
    fireEvent.click(pins);
    expect(openPins).toHaveBeenCalledTimes(1);
  });

  it('opens account from the More menu and preserves accessible names', () => {
    seedChannel();
    render(() => <PresenceRibbon />);

    openMore();
    const account = screen.getByTestId('ribbon-account-chip');
    expect(account).toHaveAttribute(
      'aria-label',
      'You — guest — open account, appearance, and preferences',
    );
    fireEvent.click(account);
    expect(store.getState().showAccount).toBe(true);
  });

  it('closes More before handing off to a secondary panel', async () => {
    seedChannel();
    render(() => <PresenceRibbon />);
    const more = moreTrigger();

    openMore();
    expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByTestId('ribbon-account-chip'));

    await waitFor(() => {
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('ribbon-more-menu')).not.toBeInTheDocument();
    });
    expect(store.getState().showAccount).toBe(true);
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

  it('wires Jump to date from More (This room) with one-click openJumpToDate', async () => {
    seedChannel();
    const openSpy = vi.spyOn(store.getState(), 'openJumpToDate');
    render(() => <PresenceRibbon />);

    expect(screen.queryByTestId('ribbon-jump-to-date')).not.toBeInTheDocument();
    openMore();
    const jump = screen.getByTestId('ribbon-jump-to-date');
    expect(jump).toHaveAttribute('role', 'menuitem');
    fireEvent.click(jump);
    expect(openSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByTestId('ribbon-more-menu')).not.toBeInTheDocument();
    });
    openSpy.mockRestore();
  });

  it('shows Jump to date under Conversation for DMs without channel-only items', () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView: { kind: 'dm', nick: 'alice' },
    });
    render(() => <PresenceRibbon />);

    expect(screen.queryByTestId('ribbon-jump-to-date')).not.toBeInTheDocument();
    expect(screen.getByTestId('ribbon-more')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search messages' })).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-members')).not.toBeInTheDocument();
    openMore();
    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-jump-to-date')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-preferences')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-settings-gear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-more-channel')).not.toBeInTheDocument();
    expect(screen.queryByText('This room')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'You' })).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-account-chip')).toBeInTheDocument();
  });

  it('renders Facepile root class that responsive CSS actually hides', () => {
    seedChannel();
    const { container } = render(() => <PresenceRibbon />);

    // Structural: Facepile root is `.shell-facepile` (not a phantom ribbon class alone).
    const face = container.querySelector('.shell-facepile');
    expect(face).toBeTruthy();
    expect(face).toHaveClass('shell-facepile');
    // Host wrapper may exist for layout, but hide CSS must target the real root class.
    expect(container.querySelector('.shell-ribbon-facepile')).toBeTruthy();

    // Stylesheet assertion: would have failed when hide only targeted `.shell-ribbon-facepile`.
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'shell.css');
    const css = readFileSync(cssPath, 'utf8');
    const hideForFacepile = [
      ...css.matchAll(/\.shell-facepile\s*\{[^}]*display:\s*none[^}]*\}/g),
    ];
    expect(hideForFacepile.length).toBeGreaterThanOrEqual(2);
    // Ensure no hide-only phantom: every responsive hide of facepile must name the real class.
    expect(css).not.toMatch(
      /\/\*[^*]*facepile[^*]*\*\/\s*\.shell-ribbon-facepile\s*\{\s*display:\s*none/i,
    );
  });

  it('shows a Private chip only when the DM peer key is present and seal-ready', () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView: { kind: 'dm', nick: 'alice' },
      dms: new Map([['alice', {
        nick: 'alice',
        account: null,
        unread: 0,
        highlights: 0,
        messages: [],
      }]]),
    });
    render(() => <PresenceRibbon />);

    expect(screen.queryByTestId('ribbon-dm-private')).toBeNull();
    expect(screen.getByTestId('ribbon-dm-verify')).toHaveTextContent('Verify');
    expect(screen.getByTestId('ribbon-dm-verify')).not.toHaveTextContent(/🔒|lock/i);

    store.setState({
      peerDmKeys: new Map([['alice', validPeerKey()]]),
    });
    expect(screen.getByTestId('ribbon-dm-private')).toHaveTextContent('Private');
    expect(screen.getByTestId('ribbon-dm-private').getAttribute('aria-label') ?? '').toMatch(
      /only the two of you can read these messages/i,
    );

    store.setState({
      peerKeyChanges: new Map([['alice', { pinnedKey: 'old', newKey: 'new' }]]),
    });
    expect(screen.queryByTestId('ribbon-dm-private')).toBeNull();
  });

  it('keeps Private and Verify off rooms so group E2EE is not implied', () => {
    seedChannel();
    render(() => <PresenceRibbon />);
    expect(screen.queryByTestId('ribbon-dm-private')).toBeNull();
    expect(screen.queryByTestId('ribbon-dm-verify')).toBeNull();
    expect(screen.queryByText(/^Private$/)).toBeNull();
  });
});
