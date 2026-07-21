// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  advanceBandwidthLadderFeedback,
  BANDWIDTH_LADDER_HYSTERESIS_MS,
  bandwidthLadderNoticeCopy,
  consumeBandwidthLadderNotice,
  INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE,
} from './bandwidthLadderFeedback';

describe('advanceBandwidthLadderFeedback', () => {
  it('does not notice on a single poor sample (hysteresis)', () => {
    const next = advanceBandwidthLadderFeedback(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE, {
      nowMs: 1_000,
      tier: 3,
    });
    expect(next.pendingNotice).toBeNull();
    expect(next.stableTier).toBeNull();
    expect(next.candidateTier).toBe(3);
  });

  it('emits audio_priority after poor holds for hysteresis from a good baseline', () => {
    const t0 = 10_000;
    let state = advanceBandwidthLadderFeedback(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE, {
      nowMs: t0,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS,
      tier: 0,
    });
    expect(state.stableTier).toBe(0);
    expect(state.pendingNotice).toBeNull();

    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS + 100,
      tier: 3,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 2 + 100,
      tier: 3,
    });
    expect(state.stableTier).toBe(3);
    expect(state.pendingNotice).toBe('audio_priority');
    expect(state.announcedThroughTier).toBe(3);
  });

  it('emits lowering when stable tier steps to fair (2)', () => {
    const t0 = 20_000;
    let state = advanceBandwidthLadderFeedback(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE, {
      nowMs: t0,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS + 50,
      tier: 2,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 2 + 50,
      tier: 2,
    });
    expect(state.pendingNotice).toBe('lowering');
  });

  it('stays silent on mild 0→1 degradation', () => {
    const t0 = 30_000;
    let state = advanceBandwidthLadderFeedback(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE, {
      nowMs: t0,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS + 10,
      tier: 1,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 2 + 10,
      tier: 1,
    });
    expect(state.stableTier).toBe(1);
    expect(state.pendingNotice).toBeNull();
  });

  it('never flashes on brief spikes below hysteresis', () => {
    let state = INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE;
    state = advanceBandwidthLadderFeedback(state, { nowMs: 0, tier: 0 });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: BANDWIDTH_LADDER_HYSTERESIS_MS,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: BANDWIDTH_LADDER_HYSTERESIS_MS + 100,
      tier: 3,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: BANDWIDTH_LADDER_HYSTERESIS_MS + 500,
      tier: 0,
    });
    expect(state.pendingNotice).toBeNull();
    expect(state.stableTier).toBe(0);
  });

  it('does not re-announce until quality recovers then degrades again', () => {
    const t0 = 50_000;
    let state = advanceBandwidthLadderFeedback(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE, {
      nowMs: t0,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS + 100,
      tier: 2,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 2 + 100,
      tier: 2,
    });
    expect(state.pendingNotice).toBe('lowering');

    state = consumeBandwidthLadderNotice(state);
    expect(state.pendingNotice).toBeNull();

    // Still fair — stay quiet
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 2 + 1_000,
      tier: 2,
    });
    expect(state.pendingNotice).toBeNull();

    // Deeper degradation to poor — one more notice (audio_priority)
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 2 + 1_100,
      tier: 3,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 3 + 1_100,
      tier: 3,
    });
    expect(state.pendingNotice).toBe('audio_priority');
    state = consumeBandwidthLadderNotice(state);

    // Recover to good — re-arm
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 3 + 2_000,
      tier: 0,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 4 + 2_000,
      tier: 0,
    });
    expect(state.announcedThroughTier).toBeNull();
    expect(state.pendingNotice).toBeNull();

    // Degrade again
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 4 + 2_100,
      tier: 2,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS * 5 + 2_100,
      tier: 2,
    });
    expect(state.pendingNotice).toBe('lowering');
  });

  it('does not announce the first stable sample (no baseline to degrade from)', () => {
    const t0 = 70_000;
    let state = advanceBandwidthLadderFeedback(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE, {
      nowMs: t0,
      tier: 3,
    });
    state = advanceBandwidthLadderFeedback(state, {
      nowMs: t0 + BANDWIDTH_LADDER_HYSTERESIS_MS,
      tier: 3,
    });
    expect(state.stableTier).toBe(3);
    expect(state.pendingNotice).toBeNull();
  });
});

describe('bandwidthLadderNoticeCopy', () => {
  it('returns calm non-blaming copy for lowering and audio_priority', () => {
    const lower = bandwidthLadderNoticeCopy('lowering');
    expect(lower.description.toLowerCase()).toContain('keep audio clear');
    expect(lower.description.toLowerCase()).not.toContain('your connection is bad');

    const audio = bandwidthLadderNoticeCopy('audio_priority');
    expect(audio.description.toLowerCase()).toContain('audio');
    expect(audio.title.length).toBeGreaterThan(0);
  });
});

describe('consumeBandwidthLadderNotice', () => {
  it('is a no-op when nothing is pending', () => {
    expect(consumeBandwidthLadderNotice(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE))
      .toBe(INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE);
  });
});
