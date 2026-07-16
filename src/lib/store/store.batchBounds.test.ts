// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import {
  HISTORY_BATCH_MESSAGE_MAX,
  MULTILINE_BATCH_PART_MAX,
  MULTILINE_BATCH_TEXT_MAX,
  OPEN_BATCH_COLLECTOR_MAX,
  _resetBatchCollectorsForTests,
  store,
} from './store';

const initialState = store.getInitialState();

function channel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function historyMessage(batch: string, id: string, text: string): string {
  return `@batch=${batch};time=2026-07-01T10:00:00.000Z;msgid=${id} :alice!u@host PRIVMSG #root :${text}`;
}

beforeEach(() => {
  _resetBatchCollectorsForTests();
  store.setState({
    ...initialState,
    ourNick: 'me',
    channels: new Map([['#root', channel('#root')]]),
  }, true);
});

describe('untrusted BATCH transport bounds', () => {
  it('keeps a bounded, field-limited CHATHISTORY window', () => {
    feed('BATCH +history chathistory #root');
    feed(historyMessage('history', 'large', 'x'.repeat(MULTILINE_BATCH_TEXT_MAX + 2_000)));
    for (let index = 1; index < HISTORY_BATCH_MESSAGE_MAX + 30; index += 1) {
      feed(historyMessage('history', `id-${index}`, `message ${index}`));
    }
    feed('BATCH -history');

    const messages = store.getState().channels.get('#root')?.messages ?? [];
    expect(messages).toHaveLength(HISTORY_BATCH_MESSAGE_MAX);
    expect(messages[0]?.text).toHaveLength(MULTILINE_BATCH_TEXT_MAX);
    expect(messages.at(-1)?.text).toBe(`message ${HISTORY_BATCH_MESSAGE_MAX - 1}`);
  });

  it('drops content tagged for an unknown or rejected batch', () => {
    feed(historyMessage('missing', 'unknown', 'must not become live'));
    const oversizedRef = 'r'.repeat(129);
    feed(`BATCH +${oversizedRef} chathistory #root`);
    feed(historyMessage(oversizedRef, 'oversized', 'must also be dropped'));
    feed(`BATCH -${oversizedRef}`);

    expect(store.getState().channels.get('#root')?.messages).toEqual([]);
  });

  it('rejects a multiline batch once its part ceiling is exceeded', () => {
    feed('BATCH +multi draft/multiline #root');
    for (let index = 0; index <= MULTILINE_BATCH_PART_MAX; index += 1) {
      feed(`@batch=multi :alice!u@host PRIVMSG #root :part ${index}`);
    }
    feed('BATCH -multi');

    expect(store.getState().channels.get('#root')?.messages).toEqual([]);
  });

  it('rejects a multiline batch once its assembled text ceiling is exceeded', () => {
    feed('BATCH +multi-text draft/multiline #root');
    feed(`@batch=multi-text :alice!u@host PRIVMSG #root :${'x'.repeat(MULTILINE_BATCH_TEXT_MAX + 1)}`);
    feed('BATCH -multi-text');

    expect(store.getState().channels.get('#root')?.messages).toEqual([]);
  });

  it('still assembles a safe multiline message', () => {
    feed('BATCH +multi-safe draft/multiline #root');
    feed('@batch=multi-safe :alice!u@host PRIVMSG #root :one');
    feed('@batch=multi-safe :alice!u@host PRIVMSG #root :two');
    feed('BATCH -multi-safe');

    expect(store.getState().channels.get('#root')?.messages.map(message => message.text)).toEqual(['one\ntwo']);
  });

  it('admits only a bounded number of simultaneous collectors', () => {
    for (let index = 0; index < OPEN_BATCH_COLLECTOR_MAX; index += 1) {
      feed(`BATCH +open-${index} chathistory #target-${index}`);
    }
    feed('BATCH +overflow chathistory #root');
    feed(historyMessage('overflow', 'overflow-id', 'must be dropped'));
    feed('BATCH -overflow');

    expect(store.getState().channels.get('#root')?.messages).toEqual([]);
    for (let index = 0; index < OPEN_BATCH_COLLECTOR_MAX; index += 1) {
      feed(`BATCH -open-${index}`);
    }
  });
});
