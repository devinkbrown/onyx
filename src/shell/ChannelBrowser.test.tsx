// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  afterEach(cleanup);

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
    expect(within(directory).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getAllByText('#general')).toHaveLength(1);
    expect(within(dialog).getByText('5 people')).toBeInTheDocument();
    expect(within(dialog).getByText('Launch room')).toBeInTheDocument();
    expect(within(dialog).getByText('#random')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Join #general' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Room ledger for #general' })).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
    expect(directory.querySelectorAll('[data-room-card]')).toHaveLength(2);

    fireEvent.input(within(dialog).getByRole('searchbox', { name: 'Search rooms' }), {
      target: { value: 'off-topic' },
    });

    expect(within(dialog).queryByText('#general')).not.toBeInTheDocument();
    expect(within(dialog).getByText('#random')).toBeInTheDocument();
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
    feed(':server.test 322 me #alpha 1 :');
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
      store.setState({ channelListLoading: true });
      feed(':server.test 322 me #general 2 :Launch room');
      feed(':server.test 322 me #random 1 :Off-topic');
      feed(':server.test 323 me :End of LIST');
      store.setState({ showChannelBrowser: true });

      render(() => <ChannelBrowser />);

      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();

      vi.advanceTimersByTime(400);
      expect(status).toHaveTextContent('2 rooms you can join');

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
      expect(screen.getByRole('status')).toHaveTextContent(/no rooms yet/i);
      expect(screen.getByText('No rooms yet. Start one.')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Start a room' }).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a room from the short form using JOIN and optional topic', () => {
    const join = vi.fn();
    const sendRaw = vi.fn();
    store.setState({
      client: { join, sendRaw, isupport: { CHANTYPES: '#&' } } as never,
      showChannelBrowser: true,
      channelBrowserMode: 'create',
      connectionStatus: 'connected',
      ourNick: 'me',
    });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Start a room' });
    expect(within(dialog).queryByText(/MODE|ACCESS|\/join/i)).not.toBeInTheDocument();
    fireEvent.input(within(dialog).getByLabelText('Room name'), { target: { value: 'book-club' } });
    fireEvent.input(within(dialog).getByLabelText('Topic (optional)'), {
      target: { value: 'Weekly reads' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start room' }));

    expect(join).toHaveBeenCalledWith('#book-club', undefined);
    expect(sendRaw).toHaveBeenCalledWith('TOPIC', '#book-club', 'Weekly reads');
    expect(store.getState().showChannelBrowser).toBe(false);
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
