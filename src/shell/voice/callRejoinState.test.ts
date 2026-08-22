// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRejoinChannel,
  noteLiveCall,
  noteTransportLost,
  noteUserLeftCall,
  peekRejoinChannel,
  resetCallRejoinState,
} from './callRejoinState';

describe('callRejoinState', () => {
  afterEach(() => {
    resetCallRejoinState();
  });

  it('offers the last live room after a transport drop', () => {
    noteLiveCall('#media');
    noteTransportLost();
    expect(peekRejoinChannel()).toBe('#media');
  });

  it('does not offer rejoin after the user leaves', () => {
    noteLiveCall('#media');
    noteUserLeftCall();
    noteTransportLost();
    expect(peekRejoinChannel()).toBeNull();
  });

  it('clears a consumed rejoin without inventing a channel', () => {
    noteLiveCall('#media');
    noteTransportLost();
    clearRejoinChannel();
    expect(peekRejoinChannel()).toBeNull();
  });
});
