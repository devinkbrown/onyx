// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  classifyCodecFailure,
  codecFailureToastCopy,
  decodeFailureKey,
  isCodecFailureMessage,
  shouldAnnounceDecodeError,
} from './codecFailure';

describe('classifyCodecFailure', () => {
  it('classifies encoder init / ladder exhaust strings', () => {
    expect(classifyCodecFailure('Encoder init failed: Error: cadencevis encoder init failed'))
      .toBe('encoder_init');
    expect(classifyCodecFailure('cadencevis encoder init failed')).toBe('encoder_init');
  });

  it('classifies wasm load failures', () => {
    expect(classifyCodecFailure('WASM load failed in worker: TypeError')).toBe('wasm_load');
    expect(classifyCodecFailure('Codec unavailable — audio capture disabled')).toBe('wasm_load');
  });

  it('classifies mismatch and decode strings', () => {
    expect(classifyCodecFailure('unsupported codec tag')).toBe('mismatch');
    expect(classifyCodecFailure('codec mismatch on peer stream')).toBe('mismatch');
    expect(classifyCodecFailure('decode frame failed')).toBe('decode');
  });

  it('returns unknown for unrelated media errors', () => {
    expect(classifyCodecFailure('Media request timed out')).toBe('unknown');
    expect(classifyCodecFailure('Permission denied')).toBe('unknown');
  });
});

describe('isCodecFailureMessage', () => {
  it('is true for codec-ish strings even when kind is unknown', () => {
    expect(isCodecFailureMessage('weird codec glitch')).toBe(true);
    expect(isCodecFailureMessage('Permission denied')).toBe(false);
  });
});

describe('codecFailureToastCopy', () => {
  it('returns fail-closed encoder copy that mentions peers cannot see you', () => {
    const copy = codecFailureToastCopy('encoder_init');
    expect(copy.title.toLowerCase()).toContain('camera');
    expect(copy.description.toLowerCase()).toContain('cannot see you');
  });

  it('names the peer on decode/mismatch', () => {
    const decode = codecFailureToastCopy('decode', { peer: 'mika', mediaKind: 'video' });
    expect(decode.description).toContain('mika');
    const mismatch = codecFailureToastCopy('mismatch', { peer: 'bob', mediaKind: 'screen' });
    expect(mismatch.description.toLowerCase()).toContain('screenshare');
    expect(mismatch.description).toContain('bob');
  });

  it('bounds unknown raw messages', () => {
    const short = codecFailureToastCopy('unknown', { rawMessage: 'boom' });
    expect(short.description).toBe('boom');
    const long = codecFailureToastCopy('unknown', { rawMessage: 'x'.repeat(300) });
    expect(long.description.toLowerCase()).toContain('codec error');
  });
});

describe('shouldAnnounceDecodeError', () => {
  it('announces once per key then stays quiet', () => {
    const announced = new Set<string>();
    const key = decodeFailureKey('Mika', 'video');
    expect(shouldAnnounceDecodeError(announced, key)).toBe(true);
    announced.add(key);
    expect(shouldAnnounceDecodeError(announced, key)).toBe(false);
    expect(shouldAnnounceDecodeError(announced, decodeFailureKey('other', 'video'))).toBe(true);
  });

  it('rejects empty keys', () => {
    expect(shouldAnnounceDecodeError(new Set(), '')).toBe(false);
  });
});
