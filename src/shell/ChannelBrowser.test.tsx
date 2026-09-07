// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as clipboard from '@/lib/clipboard/writeClipboardText';
import { parseIRCMessage } from '@/lib/irc/parser';
import { store } from '@/lib/store/store';
import ChannelBrowser from './ChannelBrowser';

const here = dirname(fileURLToPath(import.meta.url));
const channelBrowserCss = readFileSync(join(here, 'channel-browser.css'), 'utf8');

function cssBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx, `missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  expect(open).toBeGreaterThan(idx);
  expect(close).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

const initialState = store.getInitialState();

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('ChannelBrowser', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows each listed room only once after duplicate LIST rows', () => {
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #general 2 :Launch room');
    feed(':server.test 322 me #General 5 :');
    feed(':server.test 322 me #random 1 :Off-topic');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Browse rooms' });
    expect(within(dialog).getByRole('search', { name: 'Room directory search' })).toBeInTheDocument();
    const directory = within(dialog).getByRole('list', { name: 'Public room directory' });
    expect(within(directory).getAllByRole('listitem')).toHaveLength(1);
    expect(within(dialog).getAllByText('#general')).toHaveLength(1);
    expect(within(dialog).getByText('5 users')).toBeInTheDocument();
    expect(within(dialog).getByText('Launch room')).toBeInTheDocument();
    expect(within(dialog).queryByText('#random')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Join #general' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Room ledger for #general' })).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
    expect(directory.querySelectorAll('[data-room-card]')).toHaveLength(1);

    fireEvent.input(within(dialog).getByRole('searchbox', { name: 'Search rooms' }), {
      target: { value: 'off-topic' },
    });

    expect(within(dialog).queryByText('#general')).not.toBeInTheDocument();
    expect(within(dialog).getByText('#random')).toBeInTheDocument();
    expect(within(dialog).getByText('Just started')).toBeInTheDocument();
    expect(within(dialog).queryByText('1 user')).not.toBeInTheDocument();
  });

  it('orders equal-count rooms deterministically by name, not LIST arrival order', () => {
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #zebra 5 :');
    feed(':server.test 322 me #alpha 5 :');
    feed(':server.test 322 me #mango 5 :');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Browse rooms' });
    const directory = within(dialog).getByRole('list', { name: 'Public room directory' });
    const names = Array.from(directory.querySelectorAll('.chb-name')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['#alpha', '#mango', '#zebra']);
  });

  it('can sort A–Z explicitly via the sort group', () => {
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #zebra 9 :');
    feed(':server.test 322 me #alpha 3 :');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Browse rooms' });
    const directory = within(dialog).getByRole('list', { name: 'Public room directory' });
    expect(Array.from(directory.querySelectorAll('.chb-name')).map((el) => el.textContent)).toEqual([
      '#zebra',
      '#alpha',
    ]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'A–Z' }));
    expect(Array.from(directory.querySelectorAll('.chb-name')).map((el) => el.textContent)).toEqual([
      '#alpha',
      '#zebra',
    ]);
  });

  it('announces the debounced result count through a polite status region', () => {
    vi.useFakeTimers();
    try {
      store.setState({ channelListLoading: true, connectionStatus: 'connected' });
      feed(':server.test 322 me #general 2 :Launch room');
      feed(':server.test 322 me #random 1 :Off-topic');
      feed(':server.test 323 me :End of LIST');
      store.setState({ showChannelBrowser: true });

      render(() => <ChannelBrowser />);

      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();

      vi.advanceTimersByTime(400);
      expect(status).toHaveTextContent('1 room you can join');

      fireEvent.input(screen.getByRole('searchbox', { name: 'Search rooms' }), {
        target: { value: 'off-topic' },
      });
      vi.advanceTimersByTime(400);
      expect(status).toHaveTextContent(/1 room matches/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the empty directory to assistive tech', () => {
    vi.useFakeTimers();
    try {
      store.setState({ channelListLoading: true });
      feed(':server.test 323 me :End of LIST');
      store.setState({ showChannelBrowser: true });

      render(() => <ChannelBrowser />);

      vi.advanceTimersByTime(400);
      expect(screen.getByText(/You’re offline/i)).toBeInTheDocument();
      expect(screen.getByText(/Room discovery is paused/i)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Start a room' }).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches from an empty directory to Start a room', () => {
    store.setState({ channelListLoading: true });
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true, channelBrowserMode: 'browse' });

    render(() => <ChannelBrowser />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Start a room' })[0]!);
    expect(store.getState().channelBrowserMode).toBe('create');
    expect(screen.getByRole('dialog', { name: 'Start a room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
  });

  it('paints Join as a quiet-lapis squared control, not a gold pill', () => {
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #general 2 :Launch room');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true });

    render(() => <ChannelBrowser />);

    const join = screen.getByRole('button', { name: 'Join #general' });
    expect(join).toHaveClass('chb-join');
    expect(join).not.toHaveClass('chb-join--pill');
  });

  it('keeps cached rooms browse-only while disconnected and does not close the sheet', () => {
    vi.useFakeTimers();
    try {
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #general 2 :Cached room');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true, connectionStatus: 'reconnecting' });

    render(() => <ChannelBrowser />);

    vi.advanceTimersByTime(400);
    expect(screen.getByText(/saved directory/i)).toBeInTheDocument();
    expect(screen.getByText('1 saved room offline. Reconnect to join.')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Browse rooms' });
    const join = within(dialog).getByRole('button', { name: 'Join #general' });
    expect(join).toBeDisabled();
    expect(join).toHaveAttribute('title', 'Reconnect to join this room');
    fireEvent.click(join);
    expect(store.getState().showChannelBrowser).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens an existing room locally without JOIN and closes the sheet', () => {
    const join = vi.fn();
    store.setState({
      client: { join, sendRaw: vi.fn(), negotiatedCaps: new Set<string>() } as never,
      channels: new Map([
        ['#general', {
          name: '#general', topic: 'Launch room', topicSetBy: '', topicSetAt: null,
          modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [],
        }],
      ]),
      activeView: { kind: 'channel', channel: '#other' },
      channelList: [{ name: '#general', count: 4, topic: 'Launch room' }],
      showChannelBrowser: true,
      connectionStatus: 'reconnecting',
    });
    render(() => <ChannelBrowser />);

    fireEvent.click(screen.getByRole('button', { name: 'Open #general' }));

    expect(join).not.toHaveBeenCalled();
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    expect(store.getState().showChannelBrowser).toBe(false);
  });

  it('keeps the sheet open until live JOIN admission, then closes', () => {
    const join = vi.fn();
    store.setState({
      client: { join, sendRaw: vi.fn(), isupport: { CHANTYPES: '#&' }, negotiatedCaps: new Set<string>() } as never,
      channelList: [{ name: '#general', count: 2, topic: 'Live room' }],
      showChannelBrowser: true,
      connectionStatus: 'connected',
      ourNick: 'me',
    });
    render(() => <ChannelBrowser />);

    fireEvent.click(screen.getByRole('button', { name: 'Join #general' }));
    expect(join).toHaveBeenCalledWith('#general', undefined);
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(screen.getByText(/Waiting for server admission/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Joining #general' })).toHaveTextContent('Joining…');

    feed(':me JOIN #general');
    expect(store.getState().showChannelBrowser).toBe(false);
  });

  it('keeps the sheet open and offers retry after explicit server rejection', () => {
    const join = vi.fn();
    store.setState({
      client: { join, isupport: { CHANTYPES: '#&' } } as never,
      channelList: [{ name: '#invite', count: 2, topic: '' }],
      showChannelBrowser: true,
      connectionStatus: 'connected',
      ourNick: 'me',
    });
    render(() => <ChannelBrowser />);

    fireEvent.click(screen.getByRole('button', { name: 'Join #invite' }));
    feed(':server.test 473 me #invite :Invite only');
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry #invite' })).toHaveTextContent('Retry');
  });

  it('settles a rejection that arrives after the uncertainty timeout', () => {
    vi.useFakeTimers();
    try {
      store.setState({
        client: { join: vi.fn(), isupport: { CHANTYPES: '#&' } } as never,
        channelList: [{ name: '#full', count: 2, topic: '' }],
        showChannelBrowser: true,
        connectionStatus: 'connected',
        ourNick: 'me',
      });
      render(() => <ChannelBrowser />);

      fireEvent.click(screen.getByRole('button', { name: 'Join #full' }));
      vi.advanceTimersByTime(8000);
      feed(':server.test 471 me #full :Channel is full');

      expect(screen.getByText(/This room is full/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry #full' })).toHaveTextContent('Retry');
      expect(store.getState().showChannelBrowser).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an uncertain join retryable without falsely closing', () => {
    vi.useFakeTimers();
    try {
      const join = vi.fn();
      store.setState({
        client: { join } as never,
        channelList: [{ name: '#maybe', count: 2, topic: '' }],
        showChannelBrowser: true,
        connectionStatus: 'connected',
      });
      render(() => <ChannelBrowser />);

      fireEvent.click(screen.getByRole('button', { name: 'Join #maybe' }));
      vi.advanceTimersByTime(8000);
      expect(store.getState().showChannelBrowser).toBe(true);
      expect(screen.getByText(/did not confirm/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry #maybe' })).toHaveTextContent('Retry');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes after late admission for the timed-out attempted room', () => {
    vi.useFakeTimers();
    try {
      store.setState({
        client: { join: vi.fn(), sendRaw: vi.fn(), isupport: { CHANTYPES: '#&' }, negotiatedCaps: new Set<string>() } as never,
        channelList: [{ name: '#late', count: 2, topic: '' }],
        showChannelBrowser: true,
        connectionStatus: 'connected',
        ourNick: 'me',
      });
      render(() => <ChannelBrowser />);

      fireEvent.click(screen.getByRole('button', { name: 'Join #late' }));
      vi.advanceTimersByTime(8000);
      expect(screen.getByText(/did not confirm/i)).toBeInTheDocument();

      feed(':me JOIN #late');

      expect(store.getState().showChannelBrowser).toBe(false);
      expect(screen.queryByText(/did not confirm/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scopes retry to the rejected or uncertain room', () => {
    vi.useFakeTimers();
    try {
      store.setState({
        client: { join: vi.fn() } as never,
        channelList: [
          { name: '#alpha', count: 2, topic: '' },
          { name: '#beta', count: 2, topic: '' },
        ],
        showChannelBrowser: true,
        connectionStatus: 'connected',
      });
      render(() => <ChannelBrowser />);

      fireEvent.click(screen.getByRole('button', { name: 'Join #alpha' }));
      vi.advanceTimersByTime(8000);

      expect(screen.getByRole('button', { name: 'Retry #alpha' })).toHaveTextContent('Retry');
      expect(screen.getByRole('button', { name: 'Join #beta' })).toHaveTextContent('Join');
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a room only after the founder copies the invite, then lands inside', async () => {
    const join = vi.fn().mockReturnValue(true);
    const sendRaw = vi.fn().mockReturnValue(true);
    const write = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    store.setState({
      client: {
        join,
        sendRaw,
        isupport: { CHANTYPES: '#&' },
        negotiatedCaps: new Set<string>(),
      } as never,
      showChannelBrowser: true,
      channelBrowserMode: 'create',
      connectionStatus: 'connected',
      ourNick: 'me',
      networkName: 'Onyx',
    });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Start a room' });
    expect(within(dialog).queryByText(/MODE|ACCESS|you're all set|all set/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create and enter room' })).toBeDisabled();

    fireEvent.input(within(dialog).getByLabelText('Room name'), { target: { value: 'book-club' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Club' }));
    fireEvent.input(within(dialog).getByLabelText('Add someone by name'), { target: { value: 'ada' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText(/1 of 3 people added/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy invite' }));
    expect(await screen.findByText(/Invite link copied/i)).toBeInTheDocument();
    expect(write).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and enter room' }));
    expect(join).toHaveBeenCalledWith('#book-club', undefined);
    expect(store.getState().showChannelBrowser).toBe(true);

    feed(':me JOIN #book-club');

    expect(sendRaw).toHaveBeenCalledWith('TOPIC', '#book-club', expect.stringContaining('Club hang'));
    expect(store.getState().showChannelBrowser).toBe(false);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#book-club' });
    expect(store.getState().getComposerDraft('#book-club')).toMatch(/Saturday|hey|welcome|first meeting/i);
  });

  it('keeps the current copy attempt owner after an older attempt resolves', async () => {
    let resolveA!: (copied: boolean) => void;
    let resolveB!: (copied: boolean) => void;
    const write = vi.spyOn(clipboard, 'writeClipboardText')
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveB = resolve; }));
    store.setState({
      showChannelBrowser: true,
      channelBrowserMode: 'create',
      connectionStatus: 'connected',
      ourNick: 'me',
      networkName: 'Onyx',
    });

    render(() => <ChannelBrowser />);
    const dialog = screen.getByRole('dialog', { name: 'Start a room' });
    const copy = within(dialog).getByRole('button', { name: 'Copy invite' });
    fireEvent.input(within(dialog).getByLabelText('Room name'), { target: { value: 'room-a' } });
    fireEvent.click(copy);
    expect(within(dialog).getByRole('button', { name: 'Copying invite link…' })).toBeDisabled();

    fireEvent.input(within(dialog).getByLabelText('Room name'), { target: { value: 'room-b' } });
    await Promise.resolve();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy invite' }));
    expect(within(dialog).getByRole('button', { name: 'Copying invite link…' })).toBeDisabled();

    resolveA(true);
    await Promise.resolve();
    expect(within(dialog).getByRole('button', { name: 'Copying invite link…' })).toBeDisabled();
    expect(within(dialog).getByTestId('create-room-share-status')).toHaveTextContent(
      'Room name changed. Share or copy the new invite before entering.',
    );
    expect(within(dialog).queryByText(/Invite link copied/)).not.toBeInTheDocument();

    resolveB(true);
    await Promise.resolve();
    expect(await within(dialog).findByText(/Invite link copied/)).toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe('ChannelBrowser join control CSS (S8)', () => {
  it('uses the quiet-lapis action recipe with a token radius and 44px target', () => {
    const join = cssBlock(channelBrowserCss, '.chb-join {');
    expect(join).toMatch(/border-radius:\s*var\(--r-md\)/);
    expect(join).toMatch(/min-height:\s*var\(--target-min,\s*44px\)/);
    expect(join).toMatch(/min-width:\s*var\(--target-min,\s*44px\)/);
    expect(join).toMatch(/var\(--lapis-bright\)/);
    expect(join).not.toMatch(/999px|9999px|var\(--r-pill\)|var\(--gold/);
  });

  it('keeps hover on lapis, not gold', () => {
    const hover = cssBlock(channelBrowserCss, '.chb-join:hover {');
    expect(hover).toMatch(/var\(--lapis/);
    expect(hover).not.toMatch(/var\(--gold/);
  });
});
