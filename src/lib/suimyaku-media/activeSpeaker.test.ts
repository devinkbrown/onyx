// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ACTIVE_SPEAKER_CONFIG,
  INITIAL_ACTIVE_SPEAKER_STATE,
  advanceActiveSpeaker,
  createActiveSpeakerState,
  energySamplesFromSpeaking,
  rankedSpeakers,
  resolveActiveSpeakerConfig,
  type ActiveSpeakerConfig,
  type ActiveSpeakerState,
} from './activeSpeaker';

// Deterministic tunables. Fast smoothing keeps the energy tracking close to the
// input so the dominance/hysteresis logic — not the EMA lag — is what the
// assertions exercise. Small hold/release windows keep the step counts low.
const CONFIG: ActiveSpeakerConfig = resolveActiveSpeakerConfig({
  smoothingMs: 10,
  speakingFloor: 0.2,
  switchMargin: 0.15,
  switchHoldMs: 100,
  releaseMs: 200,
  maxPeers: 8,
});

const DT = 50;

/** Feed the same energy map for `n` steps. */
function hold(
  start: ActiveSpeakerState,
  samples: Iterable<readonly [string, number]>,
  n: number,
  dtMs = DT,
  config: ActiveSpeakerConfig = CONFIG,
): ActiveSpeakerState {
  let state = start;
  for (let i = 0; i < n; i += 1) {
    state = advanceActiveSpeaker(state, samples, dtMs, config);
  }
  return state;
}

describe('resolveActiveSpeakerConfig', () => {
  it('fills defaults for a bare config', () => {
    expect(resolveActiveSpeakerConfig()).toEqual(DEFAULT_ACTIVE_SPEAKER_CONFIG);
  });

  it('clamps the floor and margin into [0,1]', () => {
    const cfg = resolveActiveSpeakerConfig({ speakingFloor: 5, switchMargin: -3 });
    expect(cfg.speakingFloor).toBe(1);
    expect(cfg.switchMargin).toBe(0);
  });

  it('forces time constants non-negative and maxPeers a positive integer', () => {
    const cfg = resolveActiveSpeakerConfig({
      smoothingMs: -1,
      switchHoldMs: -10,
      releaseMs: -10,
      maxPeers: 0.4,
    });
    expect(cfg.smoothingMs).toBe(0);
    expect(cfg.switchHoldMs).toBe(0);
    expect(cfg.releaseMs).toBe(0);
    expect(cfg.maxPeers).toBe(1);
  });
});

describe('createActiveSpeakerState', () => {
  it('is empty with no dominant speaker', () => {
    const s = createActiveSpeakerState();
    expect(s).toEqual(INITIAL_ACTIVE_SPEAKER_STATE);
    expect(s.dominant).toBeNull();
    expect(s.peers.size).toBe(0);
    expect(rankedSpeakers(s)).toEqual([]);
  });
});

describe('advanceActiveSpeaker — dominance', () => {
  it('promotes the first speaker to dominant immediately', () => {
    const s = advanceActiveSpeaker(createActiveSpeakerState(), [['alice', 1]], DT, CONFIG);
    expect(s.dominant).toBe('alice');
  });

  it('stays quiet with no dominant when everyone is below the floor', () => {
    const s = hold(createActiveSpeakerState(), [['alice', 0.05], ['bob', 0.05]], 6);
    expect(s.dominant).toBeNull();
  });

  it('is sticky: an equally-loud second speaker does not steal focus', () => {
    // Alice locks in as dominant...
    let s = hold(createActiveSpeakerState(), [['alice', 1]], 4);
    expect(s.dominant).toBe('alice');
    // ...then Bob joins at the same energy for a long time. No lead margin
    // exists, so focus must not flip-flop.
    s = hold(s, [['alice', 1], ['bob', 1]], 20);
    expect(s.dominant).toBe('alice');
  });

  it('transfers focus when a challenger sustains a louder lead past switchHoldMs', () => {
    let s = hold(createActiveSpeakerState(), [['alice', 0.5]], 4);
    expect(s.dominant).toBe('alice');
    // Bob is clearly louder (lead >> margin); after switchHoldMs he takes over.
    s = hold(s, [['alice', 0.5], ['bob', 1]], 6);
    expect(s.dominant).toBe('bob');
  });

  it('does not transfer focus for a brief louder blip under switchHoldMs', () => {
    let s = hold(createActiveSpeakerState(), [['alice', 0.5]], 4);
    // One single louder step from Bob (50ms < 100ms hold): not enough.
    s = advanceActiveSpeaker(s, [['alice', 0.5], ['bob', 1]], DT, CONFIG);
    expect(s.dominant).toBe('alice');
    // Bob immediately drops back to quiet: the challenge resets, Alice keeps it.
    s = hold(s, [['alice', 0.5], ['bob', 0]], 4);
    expect(s.dominant).toBe('alice');
  });

  it('holds focus through a brief dip then releases after releaseMs of silence', () => {
    let s = hold(createActiveSpeakerState(), [['alice', 1]], 4);
    expect(s.dominant).toBe('alice');
    // A short silence (below releaseMs) coasts: Alice stays dominant.
    s = advanceActiveSpeaker(s, [['alice', 0]], DT, CONFIG);
    expect(s.dominant).toBe('alice');
    // Sustained silence beyond releaseMs (200ms => >4 steps of 50ms) clears it.
    s = hold(s, [['alice', 0]], 8);
    expect(s.dominant).toBeNull();
  });

  it('after a dominant goes silent, a still-talking peer inherits focus', () => {
    let s = hold(createActiveSpeakerState(), [['alice', 1]], 4);
    // Alice stops, Bob keeps talking. Past releaseMs, Bob inherits.
    s = hold(s, [['alice', 0], ['bob', 1]], 10);
    expect(s.dominant).toBe('bob');
  });

  it('clears dominant immediately when the dominant leaves the call', () => {
    let s = hold(createActiveSpeakerState(), [['alice', 1]], 4);
    expect(s.dominant).toBe('alice');
    // Alice absent from the sample set = left the call. Bob (present, talking)
    // takes over; Alice is evicted from the tracked map.
    s = advanceActiveSpeaker(s, [['bob', 1]], DT, CONFIG);
    expect(s.peers.has('alice')).toBe(false);
    s = hold(s, [['bob', 1]], 4);
    expect(s.dominant).toBe('bob');
  });
});

describe('advanceActiveSpeaker — bounds & hygiene', () => {
  it('evicts peers that drop out of the sample set', () => {
    let s = hold(createActiveSpeakerState(), [['alice', 1], ['bob', 1]], 4);
    expect(s.peers.has('bob')).toBe(true);
    s = advanceActiveSpeaker(s, [['alice', 1]], DT, CONFIG);
    expect(s.peers.has('bob')).toBe(false);
  });

  it('caps the tracked peer map at maxPeers', () => {
    const many: Array<[string, number]> = [];
    for (let i = 0; i < 50; i += 1) many.push([`peer${i}`, 1]);
    const s = advanceActiveSpeaker(createActiveSpeakerState(), many, DT, CONFIG);
    expect(s.peers.size).toBe(CONFIG.maxPeers);
  });

  it('clamps energy to [0,1] and ignores non-finite samples as zero', () => {
    const s = advanceActiveSpeaker(
      createActiveSpeakerState(),
      [['a', 5], ['b', Number.NaN], ['c', -2]],
      DT,
      resolveActiveSpeakerConfig({ smoothingMs: 0 }), // instantaneous
    );
    expect(s.peers.get('a')).toBe(1);
    expect(s.peers.get('b')).toBe(0);
    expect(s.peers.get('c')).toBe(0);
  });

  it('deduplicates repeated nicks in one sample set (first wins)', () => {
    const s = advanceActiveSpeaker(
      createActiveSpeakerState(),
      [['a', 1], ['a', 0]],
      DT,
      resolveActiveSpeakerConfig({ smoothingMs: 0 }),
    );
    expect(s.peers.size).toBe(1);
    expect(s.peers.get('a')).toBe(1);
  });

  it('treats non-positive dt as no elapsed time (energy unchanged)', () => {
    const seeded = advanceActiveSpeaker(createActiveSpeakerState(), [['a', 1]], DT, CONFIG);
    const frozen = advanceActiveSpeaker(seeded, [['a', 0]], 0, CONFIG);
    expect(frozen.peers.get('a')).toBe(seeded.peers.get('a'));
  });

  it('does not mutate the previous state', () => {
    const prev = hold(createActiveSpeakerState(), [['alice', 1], ['bob', 0.5]], 3);
    const snapshotDominant = prev.dominant;
    const snapshotPeers = new Map(prev.peers);
    advanceActiveSpeaker(prev, [['alice', 0], ['bob', 1]], DT, CONFIG);
    expect(prev.dominant).toBe(snapshotDominant);
    expect(new Map(prev.peers)).toEqual(snapshotPeers);
  });

  it('is deterministic: identical input sequences produce identical output', () => {
    const seq: Array<Array<[string, number]>> = [
      [['a', 1]],
      [['a', 1], ['b', 1]],
      [['a', 0], ['b', 1]],
      [['b', 1], ['c', 0.4]],
      [['b', 0], ['c', 1]],
    ];
    const runOnce = () =>
      seq.reduce((st, samples) => advanceActiveSpeaker(st, samples, DT, CONFIG), createActiveSpeakerState());
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('rankedSpeakers', () => {
  it('orders tracked peers by smoothed energy descending', () => {
    const cfg = resolveActiveSpeakerConfig({ smoothingMs: 0 });
    const s = advanceActiveSpeaker(
      createActiveSpeakerState(),
      [['low', 0.3], ['high', 0.9], ['mid', 0.6]],
      DT,
      cfg,
    );
    expect(rankedSpeakers(s)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks ties deterministically by nick', () => {
    const cfg = resolveActiveSpeakerConfig({ smoothingMs: 0 });
    const s = advanceActiveSpeaker(createActiveSpeakerState(), [['bravo', 1], ['alpha', 1]], DT, cfg);
    expect(rankedSpeakers(s)).toEqual(['alpha', 'bravo']);
  });

  it('filters out peers below a supplied minimum energy', () => {
    const cfg = resolveActiveSpeakerConfig({ smoothingMs: 0 });
    const s = advanceActiveSpeaker(createActiveSpeakerState(), [['loud', 0.9], ['quiet', 0.05]], DT, cfg);
    expect(rankedSpeakers(s, 0.2)).toEqual(['loud']);
  });
});

describe('energySamplesFromSpeaking', () => {
  it('maps a present set to unit energy for speakers and zero otherwise', () => {
    const samples = new Map(energySamplesFromSpeaking(['alice', 'bob', 'carol'], new Set(['bob'])));
    expect(samples.get('alice')).toBe(0);
    expect(samples.get('bob')).toBe(1);
    expect(samples.get('carol')).toBe(0);
  });

  it('is case-insensitive when matching the speaking set', () => {
    const samples = new Map(energySamplesFromSpeaking(['Alice'], new Set(['alice'])));
    expect(samples.get('Alice')).toBe(1);
  });
});
