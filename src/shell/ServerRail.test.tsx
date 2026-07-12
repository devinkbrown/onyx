// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ServerRail tests — the active server entry carries the AT-facing active
 * signal (role=img + aria-current + an accessible name that folds in the unread
 * / mention backlog). This is the jsdom-testable half of the forced-colors fix
 * in shell.css: the @media (forced-colors: active) selection styling itself is
 * not exercisable in jsdom, but aria-current is the semantic it backstops, so we
 * lock it here so a sighted High-Contrast user and AT stay in agreement.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import type { DMConversation } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';

import { ServerRail } from './ServerRail';

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

function seed(opts: { channels?: Channel[]; dms?: DMConversation[] }): void {
  store.setState(
    {
      ...initialState,
      ourNick: 'kain',
      channels: new Map((opts.channels ?? []).map((c) => [c.name.toLowerCase(), c])),
      dms: new Map((opts.dms ?? []).map((d) => [d.nick.toLowerCase(), d])),
    },
    true,
  );
}

beforeEach(() => {
  store.setState({ ...initialState }, true);
});

afterEach(() => cleanup());

describe('<ServerRail>', () => {
  it('marks the active server entry with aria-current on a labelled image role', () => {
    seed({ channels: [channel({ name: '#root' })] });
    render(() => <ServerRail />);

    const active = screen.getByRole('img', { name: /Onyx — active server/i });
    // aria-current is the signal the forced-colors Highlight styling backstops:
    // it must be present so the active selection reaches AT even when the visual
    // gradient/accent bar is flattened by Windows High Contrast.
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  it('folds the unread and mention backlog into the active entry accessible name', () => {
    seed({
      channels: [channel({ name: '#root', unread: 4, highlights: 2 })],
      dms: [dmConversation({ nick: 'trev', unread: 3, highlights: 1 })],
    });
    render(() => <ServerRail />);

    // 4 + 3 unread, 2 + 1 mentions across rooms and DMs.
    expect(
      screen.getByRole('img', { name: 'Onyx — active server, 7 unread, 3 mentions' }),
    ).toBeInTheDocument();
  });

  it('omits the backlog clauses when everything is caught up', () => {
    seed({ channels: [channel({ name: '#root', unread: 0, highlights: 0 })] });
    render(() => <ServerRail />);

    expect(screen.getByRole('img', { name: 'Onyx — active server' })).toBeInTheDocument();
  });
});
