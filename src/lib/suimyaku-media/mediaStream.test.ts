import { describe, expect, it } from 'vitest';

import { MediaStreamRouter, mediaStreamId } from './mediaStream';

describe('mediaStreamId', () => {
  it('is deterministic and a 32-bit unsigned int', () => {
    const a = mediaStreamId('#call', 'alice', 'audio');
    const b = mediaStreamId('#call', 'alice', 'audio');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('is case-insensitive on channel and nick', () => {
    expect(mediaStreamId('#Call', 'Alice', 'audio')).toBe(mediaStreamId('#call', 'alice', 'audio'));
  });

  it('separates audio vs video, different nicks, and different channels', () => {
    expect(mediaStreamId('#call', 'alice', 'audio')).not.toBe(mediaStreamId('#call', 'alice', 'video'));
    expect(mediaStreamId('#call', 'alice', 'audio')).not.toBe(mediaStreamId('#call', 'bob', 'audio'));
    expect(mediaStreamId('#call', 'alice', 'audio')).not.toBe(mediaStreamId('#other', 'alice', 'audio'));
  });
});

describe('MediaStreamRouter', () => {
  it('resolves a sender stream id back to (nick, kind)', () => {
    const r = new MediaStreamRouter();
    r.setRoster('#call', ['alice', 'bob']);

    expect(r.resolve(mediaStreamId('#call', 'alice', 'audio'))).toEqual({ nick: 'alice', kind: 'audio' });
    expect(r.resolve(mediaStreamId('#call', 'bob', 'video'))).toEqual({ nick: 'bob', kind: 'video' });
    expect(r.resolve(0xdeadbeef)).toBeNull();
  });

  it('addParticipant extends the map without a rebuild', () => {
    const r = new MediaStreamRouter();
    r.setRoster('#call', ['alice']);
    expect(r.resolve(mediaStreamId('#call', 'carol', 'audio'))).toBeNull();
    r.addParticipant('carol');
    expect(r.resolve(mediaStreamId('#call', 'carol', 'audio'))).toEqual({ nick: 'carol', kind: 'audio' });
  });

  it('clear empties the map', () => {
    const r = new MediaStreamRouter();
    r.setRoster('#call', ['alice']);
    r.clear();
    expect(r.resolve(mediaStreamId('#call', 'alice', 'audio'))).toBeNull();
  });
});
