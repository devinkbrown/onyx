import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  INITIAL_VOICE_ACTIVITY_STATE,
  computeRms,
  createVoiceActivityState,
  resolveVoiceActivityConfig,
  updateVoiceActivity,
  updateVoiceActivityFromSamples,
  type VoiceActivityConfig,
  type VoiceActivityState,
} from './voiceActivity';

// Deterministic tunables used across the behavioural tests. A fast decay keeps
// the envelope tracking the input closely so the threshold/hysteresis/hangover
// logic — not the smoothing lag — is what the assertions exercise.
const CONFIG: VoiceActivityConfig = resolveVoiceActivityConfig({
  riseThreshold: 0.2,
  fallThreshold: 0.1,
  attackMs: 10,
  decayMs: 5,
  hangoverMs: 100,
});

const DT = 20;

function run(
  start: VoiceActivityState,
  samples: readonly number[],
  dtMs = DT,
  config: VoiceActivityConfig = CONFIG,
): VoiceActivityState {
  return samples.reduce((state, sample) => updateVoiceActivity(state, sample, dtMs, config), start);
}

describe('computeRms', () => {
  it('returns 0 for empty or all-invalid input', () => {
    expect(computeRms([])).toBe(0);
    expect(computeRms([Number.NaN, Number.POSITIVE_INFINITY])).toBe(0);
  });

  it('computes root-mean-square of a block', () => {
    expect(computeRms([1, -1, 1, -1])).toBeCloseTo(1, 12);
    expect(computeRms([0.5, -0.5])).toBeCloseTo(0.5, 12);
  });

  it('clamps to [0,1] and ignores non-finite samples', () => {
    expect(computeRms([2, -2])).toBe(1);
    expect(computeRms([0.6, Number.NaN, -0.6])).toBeCloseTo(0.6, 12);
  });
});

describe('resolveVoiceActivityConfig', () => {
  it('fills defaults for a bare config', () => {
    expect(resolveVoiceActivityConfig()).toEqual(DEFAULT_VOICE_ACTIVITY_CONFIG);
  });

  it('clamps thresholds into [0,1] and keeps fall <= rise', () => {
    const cfg = resolveVoiceActivityConfig({ riseThreshold: 0.3, fallThreshold: 0.9 });
    expect(cfg.fallThreshold).toBeLessThanOrEqual(cfg.riseThreshold);
    expect(cfg.riseThreshold).toBe(0.3);
    expect(cfg.fallThreshold).toBe(0.3);
  });

  it('forces time constants non-negative', () => {
    const cfg = resolveVoiceActivityConfig({ attackMs: -5, decayMs: -1, hangoverMs: -100 });
    expect(cfg.attackMs).toBe(0);
    expect(cfg.decayMs).toBe(0);
    expect(cfg.hangoverMs).toBe(0);
  });
});

describe('updateVoiceActivity', () => {
  it('keeps silence quiet and never marks speaking', () => {
    const end = run(INITIAL_VOICE_ACTIVITY_STATE, Array(50).fill(0));
    expect(end.speaking).toBe(false);
    expect(end.level).toBe(0);
    expect(end.holdRemainingMs).toBe(0);
  });

  it('stays quiet for low-level noise below the fall threshold', () => {
    const end = run(INITIAL_VOICE_ACTIVITY_STATE, Array(50).fill(0.05));
    expect(end.speaking).toBe(false);
    expect(end.level).toBeLessThan(CONFIG.fallThreshold);
  });

  it('turns on once a loud burst crosses the rise threshold', () => {
    const end = run(INITIAL_VOICE_ACTIVITY_STATE, Array(10).fill(0.8));
    expect(end.speaking).toBe(true);
    expect(end.level).toBeGreaterThan(CONFIG.riseThreshold);
    expect(end.holdRemainingMs).toBe(CONFIG.hangoverMs);
  });

  it('does not turn on for a sample sitting inside the hysteresis band', () => {
    // 0.15 is between fall (0.1) and rise (0.2): must not trigger from idle.
    const end = run(INITIAL_VOICE_ACTIVITY_STATE, Array(50).fill(0.15));
    expect(end.level).toBeGreaterThan(CONFIG.fallThreshold);
    expect(end.level).toBeLessThan(CONFIG.riseThreshold);
    expect(end.speaking).toBe(false);
  });

  it('hysteresis prevents flip-flop when the level hovers at the boundary', () => {
    // Get firmly into speaking, then oscillate within the [fall, rise) band.
    const loud = run(INITIAL_VOICE_ACTIVITY_STATE, Array(10).fill(0.8));
    expect(loud.speaking).toBe(true);

    let state = loud;
    // Hold a steady 0.15 (inside the band, above fall): speaking must persist
    // on every single step — no chatter.
    for (let i = 0; i < 40; i += 1) {
      state = updateVoiceActivity(state, 0.15, DT, CONFIG);
      expect(state.speaking).toBe(true);
    }
    expect(state.level).toBeGreaterThan(CONFIG.fallThreshold);
    expect(state.level).toBeLessThan(CONFIG.riseThreshold);
  });

  it('hangover holds speaking through a short dip to silence', () => {
    const loud = run(INITIAL_VOICE_ACTIVITY_STATE, Array(10).fill(0.8));
    expect(loud.speaking).toBe(true);

    // A dip shorter than hangoverMs (100ms). Two 20ms silent steps = 40ms; the
    // envelope decays below fall quickly but the hold budget keeps speaking.
    let state = loud;
    for (let i = 0; i < 2; i += 1) {
      state = updateVoiceActivity(state, 0, DT, CONFIG);
    }
    expect(state.level).toBeLessThan(CONFIG.fallThreshold);
    expect(state.speaking).toBe(true);
    expect(state.holdRemainingMs).toBeGreaterThan(0);
  });

  it('drops speaking once the dip outlasts the hangover budget', () => {
    const loud = run(INITIAL_VOICE_ACTIVITY_STATE, Array(10).fill(0.8));
    // hangoverMs = 100; feed 120ms (6 * 20ms) of silence to exhaust it.
    const end = run(loud, Array(6).fill(0), DT);
    expect(end.speaking).toBe(false);
    expect(end.holdRemainingMs).toBe(0);
  });

  it('refreshes the hangover budget while the level stays above fall', () => {
    const loud = run(INITIAL_VOICE_ACTIVITY_STATE, Array(10).fill(0.8));
    // A brief dip partially spends the budget...
    const dipped = updateVoiceActivity(loud, 0, DT, CONFIG);
    expect(dipped.holdRemainingMs).toBe(CONFIG.hangoverMs - DT);
    // ...then a loud sample refreshes it back to full.
    const refreshed = updateVoiceActivity(dipped, 0.8, DT, CONFIG);
    expect(refreshed.holdRemainingMs).toBe(CONFIG.hangoverMs);
    expect(refreshed.speaking).toBe(true);
  });

  it('applies attack when rising and decay when falling', () => {
    // Fast attack (5ms), slow release (40ms): a rise reaches closer to target
    // in one step than a fall of the same span.
    const cfg = resolveVoiceActivityConfig({ attackMs: 5, decayMs: 40 });
    const attacked = updateVoiceActivity(createVoiceActivityState(0), 1, DT, cfg);
    const decayed = updateVoiceActivity(createVoiceActivityState(1), 0, DT, cfg);
    // Distance covered toward the target: attack should cover more than decay.
    expect(attacked.level).toBeGreaterThan(1 - decayed.level);
  });

  it('does not mutate the previous state', () => {
    const prev = createVoiceActivityState(0.3);
    const snapshot = { ...prev };
    updateVoiceActivity(prev, 0.9, DT, CONFIG);
    expect(prev).toEqual(snapshot);
  });

  it('treats non-positive dt as no elapsed time (level unchanged)', () => {
    const prev = createVoiceActivityState(0.4);
    expect(updateVoiceActivity(prev, 0.9, 0, CONFIG).level).toBe(0.4);
    expect(updateVoiceActivity(prev, 0.9, -50, CONFIG).level).toBe(0.4);
  });

  it('is deterministic: identical input sequences produce identical output', () => {
    const seq = [0, 0.1, 0.8, 0.9, 0.15, 0, 0, 0.5, 0.05, 0];
    const a = run(INITIAL_VOICE_ACTIVITY_STATE, seq);
    const b = run(INITIAL_VOICE_ACTIVITY_STATE, seq);
    expect(a).toEqual(b);
  });
});

describe('updateVoiceActivityFromSamples', () => {
  it('routes block RMS through the detector', () => {
    const block = new Float32Array([0.8, -0.8, 0.8, -0.8]);
    const viaBlock = updateVoiceActivityFromSamples(INITIAL_VOICE_ACTIVITY_STATE, block, DT, CONFIG);
    const viaLevel = updateVoiceActivity(INITIAL_VOICE_ACTIVITY_STATE, computeRms(block), DT, CONFIG);
    expect(viaBlock).toEqual(viaLevel);
  });
});
