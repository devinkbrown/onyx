// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  boundedReaction,
  decodeInlineBase64,
  parseChannelRoster,
  parseKickTarget,
  parseMediaRoster,
  parseNegotiatedAudioBitrate,
  parseRoomStats,
  parseSuggestedBitrate,
} from './mediaControlPayload';

describe('media control payload validation', () => {
  it('bounds and deduplicates typed media rosters without iterating strings', () => {
    expect(parseMediaRoster(JSON.stringify({
      voice: ['Alice', 'alice', 7, '', 'Bob'],
      video: 'not-an-array',
    }))).toEqual({ voice: ['Alice', 'Bob'], video: [] });
    expect(parseMediaRoster('[]')).toBeNull();
    expect(parseMediaRoster('{')).toBeNull();
    expect(parseMediaRoster(JSON.stringify({ voice: Array.from({ length: 200 }, (_, i) => `nick-${i}`) }))?.voice)
      .toHaveLength(64);
  });

  it('accepts only complete finite room statistics', () => {
    const valid = {
      active_senders: 3,
      total_viewers: 10,
      video_fps: 29.97,
      audio_kbps: 96,
    };
    expect(parseRoomStats(JSON.stringify(valid))).toEqual(valid);
    expect(parseRoomStats(JSON.stringify({ ...valid, total_viewers: '10' }))).toBeNull();
    expect(parseRoomStats(JSON.stringify({ ...valid, active_senders: -1 }))).toBeNull();
    expect(parseRoomStats('null')).toBeNull();
  });

  it('rejects fractional and unsafe bitrate controls', () => {
    expect(parseSuggestedBitrate('300000')).toBe(300_000);
    expect(parseSuggestedBitrate('{"suggested_bps":150000}')).toBe(150_000);
    expect(parseSuggestedBitrate('{"suggested_bps":1.5}')).toBeNull();
    expect(parseSuggestedBitrate('{"suggested_bps":100000001}')).toBeNull();
    expect(parseNegotiatedAudioBitrate('{"max_bitrate_kbps":128}')).toBe(128);
    expect(parseNegotiatedAudioBitrate('{"max_bitrate_kbps":5}')).toBeNull();
    expect(parseNegotiatedAudioBitrate('{"max_bitrate_kbps":999999}')).toBeNull();
  });

  it('decodes bounded base64 and contains malformed input', () => {
    expect(decodeInlineBase64(btoa('abc'))).toEqual(new Uint8Array([97, 98, 99]));
    expect(decodeInlineBase64('not base64 %%%')).toBeNull();
    expect(decodeInlineBase64(btoa('abcdef'), 4)).toBeNull();
    expect(decodeInlineBase64('')).toBeNull();
  });

  it('bounds reactions and validates structured targets and channel rosters', () => {
    expect(boundedReaction('  🎉  ')).toBe('🎉');
    expect(Array.from(boundedReaction('🔥'.repeat(100)) ?? '')).toHaveLength(64);
    expect(boundedReaction('   ')).toBeNull();
    expect(parseKickTarget('{"target":"Alice"}')).toBe('Alice');
    expect(parseKickTarget('{"target":7}')).toBeNull();
    expect(parseChannelRoster('[{"nick":"Alice"},{"nick":"alice"},{"nick":7},null]'))
      .toEqual(['Alice']);
    expect(parseChannelRoster('{}')).toBeNull();
  });
});
