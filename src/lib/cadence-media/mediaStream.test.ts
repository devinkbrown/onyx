// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MAX_MEDIA_STREAM_CHANNEL_LENGTH,
  MAX_MEDIA_STREAM_NICK_LENGTH,
  MAX_MEDIA_STREAM_PARTICIPANTS,
  MediaStreamRouter,
  mediaStreamId,
} from './mediaStream';

function serverBytewiseStreamId(channel: string, nick: string, kind: string): number {
  const bytes = new TextEncoder().encode(`${channel}\u0000${nick}\u0000${kind}`);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

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

  it('matches the server bytewise ASCII fold for UTF-8 names', () => {
    expect(mediaStreamId('%Äther', 'KÄIN', 'audio'))
      .toBe(serverBytewiseStreamId('%Äther', 'KÄIN', 'audio'));
    expect(mediaStreamId('%Äther', 'KÄIN', 'audio'))
      .not.toBe(mediaStreamId('%äther', 'käin', 'audio'));
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

  it('deduplicates participants case-insensitively', () => {
    const r = new MediaStreamRouter();
    r.setRoster('#call', ['Alice', 'alice']);
    r.addParticipant('ALICE');

    expect(r.resolve(mediaStreamId('#call', 'alice', 'audio'))).toEqual({
      nick: 'Alice',
      kind: 'audio',
    });
  });

  it('bounds an untrusted server roster to the live peer cap', () => {
    const r = new MediaStreamRouter();
    const nicks = Array.from(
      { length: MAX_MEDIA_STREAM_PARTICIPANTS + 8 },
      (_, index) => `peer-${index}`,
    );
    r.setRoster('#call', nicks);

    expect(r.resolve(mediaStreamId('#call', `peer-${MAX_MEDIA_STREAM_PARTICIPANTS - 1}`, 'video')))
      .toEqual({ nick: `peer-${MAX_MEDIA_STREAM_PARTICIPANTS - 1}`, kind: 'video' });
    expect(r.resolve(mediaStreamId('#call', `peer-${MAX_MEDIA_STREAM_PARTICIPANTS}`, 'audio')))
      .toBeNull();
    r.addParticipant('late-peer');
    expect(r.resolve(mediaStreamId('#call', 'late-peer', 'audio'))).toBeNull();
  });

  it('rejects malformed or oversized routing identities', () => {
    const invalidChannels = [
      '#bad room',
      `#${'c'.repeat(MAX_MEDIA_STREAM_CHANNEL_LENGTH)}`,
    ];
    for (const channel of invalidChannels) {
      const r = new MediaStreamRouter();
      r.setRoster(channel, ['alice']);
      expect(r.resolve(mediaStreamId(channel, 'alice', 'audio'))).toBeNull();
    }

    const r = new MediaStreamRouter();
    r.setRoster('#call', [
      'valid',
      'bad nick',
      `n${'x'.repeat(MAX_MEDIA_STREAM_NICK_LENGTH)}`,
    ]);
    expect(r.resolve(mediaStreamId('#call', 'valid', 'audio'))).not.toBeNull();
    expect(r.resolve(mediaStreamId('#call', 'bad nick', 'audio'))).toBeNull();
    expect(r.resolve(mediaStreamId('#call', `n${'x'.repeat(MAX_MEDIA_STREAM_NICK_LENGTH)}`, 'audio')))
      .toBeNull();
  });

  it('clear empties the map', () => {
    const r = new MediaStreamRouter();
    r.setRoster('#call', ['alice']);
    r.clear();
    expect(r.resolve(mediaStreamId('#call', 'alice', 'audio'))).toBeNull();
  });

  it('removes departed participants case-insensitively and releases their slot', () => {
    const r = new MediaStreamRouter();
    r.setRoster(
      '#call',
      Array.from({ length: MAX_MEDIA_STREAM_PARTICIPANTS }, (_, index) => `peer-${index}`),
    );

    r.removeParticipant('PEER-0');
    expect(r.resolve(mediaStreamId('#call', 'peer-0', 'audio'))).toBeNull();
    expect(r.resolve(mediaStreamId('#call', 'peer-0', 'video'))).toBeNull();

    r.addParticipant('replacement');
    expect(r.resolve(mediaStreamId('#call', 'replacement', 'audio'))).toEqual({
      nick: 'replacement',
      kind: 'audio',
    });
  });

  it('clear releases the participant cap for the next room', () => {
    const r = new MediaStreamRouter();
    r.setRoster(
      '#first',
      Array.from({ length: MAX_MEDIA_STREAM_PARTICIPANTS }, (_, index) => `old-${index}`),
    );
    r.clear();
    r.setRoster('#second', ['new-peer']);

    expect(r.resolve(mediaStreamId('#second', 'new-peer', 'video'))).toEqual({
      nick: 'new-peer',
      kind: 'video',
    });
  });
});
