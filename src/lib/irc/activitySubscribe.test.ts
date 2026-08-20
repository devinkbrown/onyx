// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  activitySubscribeArgs,
  parseActivityStream,
} from './activitySubscribe';

describe('activitySubscribeArgs', () => {
  it('builds SUBSCRIBE and UNSUBSCRIBE for # and & rooms', () => {
    expect(activitySubscribeArgs('#ops')).toEqual(['ACTIVITY', 'SUBSCRIBE', '#ops']);
    expect(activitySubscribeArgs('&ops', 'UNSUBSCRIBE')).toEqual(['ACTIVITY', 'UNSUBSCRIBE', '&ops']);
  });

  it('rejects hostile or non-channel targets', () => {
    expect(activitySubscribeArgs('ops')).toBeNull();
    expect(activitySubscribeArgs('#ops,#evil')).toBeNull();
    expect(activitySubscribeArgs('#ops\nPRIVMSG')).toBeNull();
    expect(activitySubscribeArgs(':#ops')).toBeNull();
    expect(activitySubscribeArgs('')).toBeNull();
  });
});

describe('parseActivityStream', () => {
  it('parses typing active/paused/done', () => {
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'alice',
      params: ['#room', 'typing', 'active'],
    })).toEqual({ kind: 'typing', channel: '#room', nick: 'alice', active: true });
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'alice',
      params: ['#room', 'typing', 'paused'],
    })).toEqual({ kind: 'typing', channel: '#room', nick: 'alice', active: true });
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'alice',
      params: ['#room', 'typing', 'done'],
    })).toEqual({ kind: 'typing', channel: '#room', nick: 'alice', active: false });
  });

  it('parses react and unreact with msgid + token', () => {
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'bob',
      params: ['&ops', 'react', 'mid.1', '👍'],
    })).toEqual({
      kind: 'react',
      channel: '&ops',
      nick: 'bob',
      msgid: 'mid.1',
      reaction: '👍',
      op: 'add',
    });
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'bob',
      params: ['&ops', 'unreact', 'mid.1', '👍'],
    })).toMatchObject({ op: 'remove', msgid: 'mid.1' });
  });

  it('fails closed on unknown verbs, missing fields, and injection', () => {
    expect(parseActivityStream({
      command: 'PRIVMSG',
      nick: 'alice',
      params: ['#room', 'typing', 'active'],
    })).toBeNull();
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'alice',
      params: ['#room', 'presence', 'available'],
    })).toBeNull();
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'alice',
      params: ['#room', 'typing', 'maybe'],
    })).toBeNull();
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: 'alice',
      params: ['#room', 'react', 'mid\n1', '👍'],
    })).toBeNull();
    expect(parseActivityStream({
      command: 'ACTIVITY',
      nick: '',
      params: ['#room', 'typing', 'active'],
    })).toBeNull();
  });
});
