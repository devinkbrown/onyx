// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CatchUpSummary tests — unread-ranked rendering, navigation dispatch, the
 * pre-connect gate, the empty state, and a reactivity-updates-after-store-change
 * guard (the component must re-render when the store's channel map is replaced,
 * not read a one-shot snapshot).
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import type { DMConversation } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';

import { CatchUpSummary } from './CatchUpSummary';

const initialState = store.getInitialState();

const channel = (over: Partial<Channel> & { name: string }): Channel => ({
  topic: '',
  topicSetBy: '',
  topicSetAt: null,
  modes: '',
  users: new Map(),
  unread: 0,
  highlights: 0,
  createdAt: null,
  messages: [],
  ...over,
});

const dmConversation = (over: Partial<DMConversation> & { nick: string }): DMConversation => ({
  account: null,
  unread: 0,
  highlights: 0,
  messages: [],
  ...over,
});

function seed(opts: {
  ourNick?: string;
  channels?: Channel[];
  dms?: DMConversation[];
  channelLastActivity?: Map<string, number>;
}): void {
  store.setState(
    {
      ...initialState,
      ourNick: opts.ourNick ?? 'kain',
      channels: new Map((opts.channels ?? []).map((c) => [c.name.toLowerCase(), c])),
      dms: new Map((opts.dms ?? []).map((d) => [d.nick.toLowerCase(), d])),
      channelLastActivity: opts.channelLastActivity ?? new Map(),
    },
    true,
  );
}

beforeEach(() => {
  store.setState({ ...initialState }, true);
});

afterEach(() => cleanup());

describe('<CatchUpSummary>', () => {
  it('renders nothing before connect (no nick yet)', () => {
    seed({ ourNick: '', channels: [channel({ name: '#root', unread: 3 })] });
    const { container } = render(() => <CatchUpSummary />);
    expect(container.querySelector('.catchup')).toBeNull();
  });

  it('shows the empty state when connected with no unread', () => {
    seed({ ourNick: 'kain', channels: [channel({ name: '#root', unread: 0 })] });
    render(() => <CatchUpSummary />);
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('lists unread rooms ranked by unread count, descending', () => {
    seed({
      channels: [
        channel({ name: '#low', unread: 1 }),
        channel({ name: '#high', unread: 40 }),
        channel({ name: '#mid', unread: 12 }),
        channel({ name: '#read', unread: 0 }),
      ],
      dms: [dmConversation({ nick: 'trev', unread: 7 })],
    });
    render(() => <CatchUpSummary />);

    const list = screen.getByRole('list', { name: /unread activity/i });
    const names = within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.catchup-name')?.textContent);
    expect(names).toEqual(['#high', '#mid', 'trev', '#low']);
    // read room is excluded
    expect(names).not.toContain('#read');
    expect(screen.getAllByTestId('catchup-channel-ledger')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Channel ledger for #high' })).toHaveAttribute(
      'href',
      '/stats/?room=%23high',
    );
    expect(screen.queryByRole('link', { name: 'Channel ledger for trev' })).toBeNull();
  });

  it('summarises unread + mention totals', () => {
    seed({
      channels: [channel({ name: '#root', unread: 4, highlights: 2 })],
      dms: [dmConversation({ nick: 'trev', unread: 3 })],
    });
    render(() => <CatchUpSummary />);
    expect(screen.getByText(/7 unread across 2 rooms/i)).toBeInTheDocument();
    expect(screen.getByText(/2 mentioning you/i)).toBeInTheDocument();
  });

  it('navigates to a channel on click via the store navigate action', () => {
    seed({ channels: [channel({ name: '#root', unread: 5 })] });
    render(() => <CatchUpSummary />);
    fireEvent.click(screen.getByRole('button', { name: /Open channel #root/i }));
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
  });

  it('navigates to a DM on click', () => {
    seed({ dms: [dmConversation({ nick: 'trev', unread: 2 })] });
    render(() => <CatchUpSummary />);
    fireEvent.click(screen.getByRole('button', { name: /Open direct messages from trev/i }));
    expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'trev' });
  });

  it('fires onNavigate after opening a row', () => {
    const opened: string[] = [];
    seed({ channels: [channel({ name: '#root', unread: 5 })] });
    render(() => <CatchUpSummary onNavigate={(row) => opened.push(row.target)} />);
    fireEvent.click(screen.getByRole('button', { name: /Open channel #root/i }));
    expect(opened).toEqual(['#root']);
  });

  it('caps the list at the provided limit', () => {
    seed({
      channels: [
        channel({ name: '#a', unread: 1 }),
        channel({ name: '#b', unread: 9 }),
        channel({ name: '#c', unread: 5 }),
      ],
    });
    render(() => <CatchUpSummary limit={2} />);
    const list = screen.getByRole('list', { name: /unread activity/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('updates reactively when the store channel map is replaced', () => {
    seed({ channels: [channel({ name: '#root', unread: 2 })] });
    render(() => <CatchUpSummary />);
    expect(screen.getByRole('button', { name: /Open channel #root, 2 unread/i })).toBeInTheDocument();

    // Simulate new traffic: replace the channels map (the store's immutable idiom).
    store.setState({
      channels: new Map([
        ['#root', channel({ name: '#root', unread: 9 })],
        ['#zig', channel({ name: '#zig', unread: 20 })],
      ]),
    });

    // The busier new room now ranks first and the count reflects the update.
    expect(screen.getByRole('button', { name: /Open channel #zig, 20 unread/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open channel #root, 9 unread/i })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /unread activity/i });
    const names = within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.catchup-name')?.textContent);
    expect(names).toEqual(['#zig', '#root']);
  });
});
