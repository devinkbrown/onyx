// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _loadSoundVolume, store } from './store';

// The notification-beep volume is a persisted preference read from the untrusted
// `onyx:sound-volume` localStorage key. A corrupt / older-build / cross-tab value
// must never seat `NaN` or an out-of-range number, because the consumer's
// `Math.max(0, Math.min(1, v))` clamp lets `NaN` through and then
// `exponentialRampToValueAtTime(NaN, …)` throws, killing every beep.
describe('_loadSoundVolume boundary sanitize', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to 0.5 when unset', () => {
    expect(_loadSoundVolume()).toBe(0.5);
  });

  it('returns a valid in-range value unchanged', () => {
    localStorage.setItem('onyx:sound-volume', '0.3');
    expect(_loadSoundVolume()).toBeCloseTo(0.3);
  });

  it('defaults to 0.5 for a non-numeric (corrupt) value instead of leaking NaN', () => {
    localStorage.setItem('onyx:sound-volume', 'abc');
    const v = _loadSoundVolume();
    expect(Number.isNaN(v)).toBe(false);
    expect(v).toBe(0.5);
  });

  it('defaults to 0.5 for an empty string instead of leaking NaN', () => {
    localStorage.setItem('onyx:sound-volume', '');
    expect(_loadSoundVolume()).toBe(0.5);
  });

  it('clamps an above-range value down to 1', () => {
    localStorage.setItem('onyx:sound-volume', '2');
    expect(_loadSoundVolume()).toBe(1);
  });

  it('clamps a below-range value up to 0', () => {
    localStorage.setItem('onyx:sound-volume', '-1');
    expect(_loadSoundVolume()).toBe(0);
  });
});

describe('setSoundVolume write boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(store.getInitialState(), true);
  });
  afterEach(() => localStorage.clear());

  it('clamps a NaN slider value to the 0.5 default rather than persisting NaN', () => {
    store.getState().setSoundVolume(Number.NaN);
    expect(store.getState().soundVolume).toBe(0.5);
    expect(localStorage.getItem('onyx:sound-volume')).toBe('0.5');
  });

  it('clamps an above-range slider value to 1', () => {
    store.getState().setSoundVolume(5);
    expect(store.getState().soundVolume).toBe(1);
    expect(localStorage.getItem('onyx:sound-volume')).toBe('1');
  });
});
