// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageView.dayDivider.test.tsx — day-boundary divider placement.
 *
 * `dayBoundaryFlags` (MessageView.tsx) replaced a per-row `prevMsg`/
 * `dayBoundary` createMemo pair with a single O(window) pass computed once
 * per window/list change, returned as a POSITIONAL (window-relative index)
 * array — not keyed by message id, so a duplicate id within one window
 * cannot collapse two rows onto the same flag. This file proves the refactor
 * is behavior-preserving: divider placement must be byte-identical to the
 * old per-row derivation across a same-day run, a day rollover mid-window, a
 * row 0 that sits at a window boundary with an out-of-window predecessor
 * (both same-day and cross-day), a history "show earlier" prepend that
 * shifts `messageWindow().start`, a duplicate-id collision within one
 * window, and a post-mount list mutation (an out-of-order insert between two
 * already-rendered rows).
 */

import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { MessageView } from './MessageView';

const initialState = store.getInitialState();

function makeMessage(id: string, from: string, text: string, time: Date): ChatMessage {
  return { id, from, text, time, type: 'msg', target: '#general' };
}

function makeChannel(msgs: ChatMessage[]): Channel {
  const users = new Map<string, ChannelUser>([
    ['alice', { nick: 'alice', modes: new Set<string>() }],
    ['bob', { nick: 'bob', modes: new Set<string>() }],
  ]);
  return {
    name: '#general',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: msgs,
  };
}

function seed(msgs: ChatMessage[]): void {
  const channel = makeChannel(msgs);
  store.setState(
    {
      ...initialState,
      channels: new Map([['#general', channel]]),
      activeView: { kind: 'channel', channel: '#general' },
      connectionStatus: 'connected',
      ourNick: 'testuser',
    },
    true,
  );
}

/** Row for a message id: previousElementSibling holds its day-divider (if any). */
function dividerPrecedes(id: string): boolean {
  const row = document.querySelector(`[data-message-search-id="${id}"]`);
  return row?.previousElementSibling?.classList.contains('shell-day-divider') ?? false;
}

/**
 * Message rows in DOM order. Used instead of `dividerPrecedes` (an id
 * selector) when a test needs to distinguish two rows sharing the SAME
 * `msg.id` — `querySelector` would only ever find the first one.
 */
function allMessageRows(): Element[] {
  return Array.from(document.querySelectorAll('[data-message-search-id]'));
}

/** Divider immediately preceding the row at DOM position `pos`. */
function dividerAtPosition(pos: number): boolean {
  const row = allMessageRows()[pos];
  return row?.previousElementSibling?.classList.contains('shell-day-divider') ?? false;
}

describe('MessageView day-boundary divider placement', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    resetPreferences();
  });

  it('places exactly one divider at the start of a same-day run', () => {
    const day = (minute: number) => new Date(2026, 6, 10, 9, minute);
    seed([
      makeMessage('m1', 'alice', 'one', day(0)),
      makeMessage('m2', 'bob', 'two', day(1)),
      makeMessage('m3', 'alice', 'three', day(2)),
    ]);
    render(() => <MessageView />);

    expect(dividerPrecedes('m1')).toBe(true);
    expect(dividerPrecedes('m2')).toBe(false);
    expect(dividerPrecedes('m3')).toBe(false);
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(1);
  });

  it('places a second divider exactly at a day rollover mid-window', () => {
    seed([
      makeMessage('m1', 'alice', 'one', new Date(2026, 6, 10, 9, 0)),
      makeMessage('m2', 'bob', 'two', new Date(2026, 6, 10, 9, 1)),
      makeMessage('m3', 'alice', 'three', new Date(2026, 6, 11, 0, 5)),
      makeMessage('m4', 'bob', 'four', new Date(2026, 6, 11, 0, 6)),
    ]);
    render(() => <MessageView />);

    expect(dividerPrecedes('m1')).toBe(true);
    expect(dividerPrecedes('m2')).toBe(false);
    expect(dividerPrecedes('m3')).toBe(true);
    expect(dividerPrecedes('m4')).toBe(false);
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(2);
  });

  it('omits the row-0 divider when its out-of-window predecessor shares its day', () => {
    // 130 messages, all same day. Trailing window (capacity 120) starts at
    // index 10 — m-10 is row 0, with an out-of-window predecessor (m-9) on
    // the same day, so no divider should precede it.
    const msgs = Array.from({ length: 130 }, (_, i) =>
      makeMessage(`m-${i}`, 'alice', `line ${i}`, new Date(2026, 6, 10, 1, i)),
    );
    seed(msgs);
    render(() => <MessageView />);

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('line 10')).toBeInTheDocument();
    expect(dividerPrecedes('m-10')).toBe(false);
  });

  it('shows the row-0 divider when its out-of-window predecessor is on a different day', () => {
    // Same window shape as the previous test (which pins that the hidden
    // predecessor is consulted AT ALL — deleting the predecessor lookup
    // entirely still passes it, since prevDay starts null there too). THIS
    // test pins the DAY COMPARISON against that predecessor specifically: an
    // off-by-one that reads `all[win.start]` instead of `all[win.start - 1]`
    // passes the previous test but fails here, because the wrong index
    // lands on m-10 itself (same day as m-10 ⇒ no divider) instead of m-9
    // (an earlier day ⇒ divider).
    const msgs = Array.from({ length: 130 }, (_, i) => {
      const time = i < 10 ? new Date(2026, 6, 9, 23, 50 + i) : new Date(2026, 6, 10, 0, i - 10);
      return makeMessage(`m-${i}`, 'alice', `line ${i}`, time);
    });
    seed(msgs);
    render(() => <MessageView />);

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('line 10')).toBeInTheDocument();
    expect(dividerPrecedes('m-10')).toBe(true);
    // The rest of the visible window stays on the later day — no further dividers.
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(1);
  });

  it('keeps correct divider placement across a history prepend that shifts window.start', () => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    });
    // 200 messages: indices 0-49 on an earlier day, 50-199 on the later day.
    // The default trailing window (capacity 120) starts at index 80, so all
    // initially-visible rows are on the later day and m-80's out-of-window
    // predecessor (m-79) shares its day — no divider at initial row 0.
    const msgs = Array.from({ length: 200 }, (_, i) => {
      const time = i < 50 ? new Date(2026, 6, 9, 12, i) : new Date(2026, 6, 10, 0, i - 50);
      return makeMessage(`m-${i}`, 'alice', `line ${i}`, time);
    });
    seed(msgs);
    render(() => <MessageView />);

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(dividerPrecedes('m-80')).toBe(false);

    // Act — "Show earlier" grows the window (200 < 120 + WINDOW_STEP_ROWS),
    // revealing the whole transcript in one step and moving window.start to 0.
    fireEvent.click(screen.getByRole('button', { name: /Show earlier messages/ }));

    expect(screen.getByText('line 0')).toBeInTheDocument();
    // The very first message in the transcript always dividers (no predecessor).
    expect(dividerPrecedes('m-0')).toBe(true);
    // The day rollover at the newly-revealed boundary still dividers correctly.
    expect(dividerPrecedes('m-50')).toBe(true);
    // A previously-existing, now-interior boundary must NOT gain a spurious divider.
    expect(dividerPrecedes('m-80')).toBe(false);
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(2);
  });

  it('does not collapse a divider when two rows share a duplicate message id', () => {
    // Regression for an id-keyed Map defect: an earlier version of
    // dayBoundaryFlags keyed its result by `msg.id`, which is last-write-wins
    // — two rows sharing an id both read the LAST write, so the transcript's
    // FIRST occurrence could silently lose its day divider. `msg.id`
    // uniqueness is not guaranteed within one window (a CHATHISTORY/AROUND
    // merge, or a content-derived replayEventId collision, can both produce
    // it), so the fix returns a window-relative POSITIONAL array instead.
    //
    // Verified failing input (window [0,3)):
    //   [{id:'X', Jul 10 09:00}, {id:'Y', Jul 11 09:00}, {id:'X', Jul 11 09:01}]
    // Correct / old index-based semantics: [true, true, false]
    // Id-keyed Map regression:             [false, true, false] — X's
    //   day-true write at position 0 is overwritten by X's day-false write
    //   at position 2.
    seed([
      makeMessage('X', 'alice', 'first', new Date(2026, 6, 10, 9, 0)),
      makeMessage('Y', 'bob', 'second', new Date(2026, 6, 11, 9, 0)),
      makeMessage('X', 'alice', 'third', new Date(2026, 6, 11, 9, 1)),
    ]);
    render(() => <MessageView />);

    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.getByText('third')).toBeInTheDocument();
    expect(dividerAtPosition(0)).toBe(true);
    expect(dividerAtPosition(1)).toBe(true);
    expect(dividerAtPosition(2)).toBe(false);
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(2);
  });

  it('recomputes an already-mounted row divider after a post-mount list mutation', async () => {
    // None of the tests above ever mutate messages() after mount — they only
    // change the WINDOW. The scenario where the hoisted memo's reactivity is
    // load-bearing is a post-mount list mutation (a REDACT that removes a
    // row, or an out-of-order AROUND merge that inserts a new row between
    // two already-rendered ones) that must flip an already-mounted row's
    // flag. This proves dayBoundaryFlags is a live reactive memo tracking
    // messages(), not a one-shot snapshot frozen at mount.
    seed([
      makeMessage('m1', 'alice', 'day one', new Date(2026, 6, 10, 9, 0)),
      makeMessage('m2', 'bob', 'day two', new Date(2026, 6, 11, 9, 0)),
    ]);
    render(() => <MessageView />);

    await waitFor(() => expect(screen.getByText('day two')).toBeInTheDocument());
    expect(dividerAtPosition(0)).toBe(true); // m1: transcript start
    expect(dividerAtPosition(1)).toBe(true); // m2: day rollover from m1

    // Act — an out-of-order merge inserts a same-day-as-m2 row BETWEEN the
    // two already-rendered messages, chronologically sorted.
    const channel = store.getState().channels.get('#general')!;
    store.setState({
      channels: new Map([['#general', {
        ...channel,
        messages: [
          channel.messages[0]!,
          makeMessage('m-mid', 'carol', 'inserted', new Date(2026, 6, 11, 8, 0)),
          channel.messages[1]!,
        ],
      }]]),
    });

    await waitFor(() => expect(screen.getByText('inserted')).toBeInTheDocument());
    expect(dividerAtPosition(0)).toBe(true);  // m1: still the transcript start
    expect(dividerAtPosition(1)).toBe(true);  // m-mid: the rollover now lands here
    // m2's flag FLIPS false — it is now preceded by the same-day m-mid, not m1.
    expect(dividerAtPosition(2)).toBe(false);
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(2);
  });
});
