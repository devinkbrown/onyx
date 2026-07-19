// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  advanceConnectionQualityAction,
  connectionQualityActionCopy,
  consumeConnectionQualityAction,
  CQ_ACTION_HYSTERESIS_MS,
  INITIAL_CONNECTION_QUALITY_ACTION_STATE,
} from './connectionQualityAction';

describe('advanceConnectionQualityAction', () => {
  it('does not show a prompt on a single poor sample (hysteresis)', () => {
    const next = advanceConnectionQualityAction(INITIAL_CONNECTION_QUALITY_ACTION_STATE, {
      nowMs: 1_000,
      tier: 3,
      cameraOn: true,
    });
    expect(next.showTurnOffCamera).toBe(false);
    expect(next.stableTier).toBeNull();
    expect(next.candidateTier).toBe(3);
  });

  it('shows turn-off-camera after poor holds for hysteresis with camera on', () => {
    const t0 = 10_000;
    const mid = advanceConnectionQualityAction(INITIAL_CONNECTION_QUALITY_ACTION_STATE, {
      nowMs: t0,
      tier: 3,
      cameraOn: true,
    });
    const held = advanceConnectionQualityAction(mid, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS,
      tier: 3,
      cameraOn: true,
    });
    expect(held.stableTier).toBe(3);
    expect(held.showTurnOffCamera).toBe(true);
  });

  it('does not prompt when camera is already off after hysteresis', () => {
    const t0 = 20_000;
    const mid = advanceConnectionQualityAction(INITIAL_CONNECTION_QUALITY_ACTION_STATE, {
      nowMs: t0,
      tier: 3,
      cameraOn: false,
    });
    const held = advanceConnectionQualityAction(mid, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS,
      tier: 3,
      cameraOn: false,
    });
    expect(held.stableTier).toBe(3);
    expect(held.showTurnOffCamera).toBe(false);
  });

  it('never flashes on brief spikes below hysteresis', () => {
    let state = INITIAL_CONNECTION_QUALITY_ACTION_STATE;
    state = advanceConnectionQualityAction(state, { nowMs: 0, tier: 0, cameraOn: true });
    state = advanceConnectionQualityAction(state, {
      nowMs: CQ_ACTION_HYSTERESIS_MS,
      tier: 0,
      cameraOn: true,
    });
    // Brief poor spike shorter than hysteresis
    state = advanceConnectionQualityAction(state, {
      nowMs: CQ_ACTION_HYSTERESIS_MS + 100,
      tier: 3,
      cameraOn: true,
    });
    state = advanceConnectionQualityAction(state, {
      nowMs: CQ_ACTION_HYSTERESIS_MS + 500,
      tier: 0,
      cameraOn: true,
    });
    expect(state.showTurnOffCamera).toBe(false);
    expect(state.stableTier).toBe(0);
  });

  it('does not re-show after dismiss until quality recovers then degrades', () => {
    const t0 = 50_000;
    let state = advanceConnectionQualityAction(INITIAL_CONNECTION_QUALITY_ACTION_STATE, {
      nowMs: t0,
      tier: 3,
      cameraOn: true,
    });
    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS,
      tier: 3,
      cameraOn: true,
    });
    expect(state.showTurnOffCamera).toBe(true);

    state = consumeConnectionQualityAction(state);
    expect(state.showTurnOffCamera).toBe(false);
    expect(state.promptConsumed).toBe(true);

    // Still poor — stay quiet
    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS + 1_000,
      tier: 3,
      cameraOn: true,
    });
    expect(state.showTurnOffCamera).toBe(false);

    // Recover
    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS + 1_100,
      tier: 1,
      cameraOn: true,
    });
    expect(state.promptConsumed).toBe(false);

    // Degrade again and hold
    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS + 2_000,
      tier: 3,
      cameraOn: true,
    });
    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS * 2 + 2_000,
      tier: 3,
      cameraOn: true,
    });
    expect(state.showTurnOffCamera).toBe(true);
  });

  it('hides the prompt immediately when camera turns off without consume', () => {
    const t0 = 80_000;
    let state = advanceConnectionQualityAction(INITIAL_CONNECTION_QUALITY_ACTION_STATE, {
      nowMs: t0,
      tier: 3,
      cameraOn: true,
    });
    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS,
      tier: 3,
      cameraOn: true,
    });
    expect(state.showTurnOffCamera).toBe(true);

    state = advanceConnectionQualityAction(state, {
      nowMs: t0 + CQ_ACTION_HYSTERESIS_MS + 50,
      tier: 3,
      cameraOn: false,
    });
    expect(state.showTurnOffCamera).toBe(false);
  });
});

describe('connectionQualityActionCopy', () => {
  it('returns calm soft-prompt copy for turn_off_camera', () => {
    const copy = connectionQualityActionCopy('turn_off_camera');
    expect(copy.message.toLowerCase()).toContain('poor connection');
    expect(copy.actionLabel.toLowerCase()).toContain('camera');
    expect(copy.dismissLabel.length).toBeGreaterThan(0);
  });
});

describe('consumeConnectionQualityAction', () => {
  it('is a no-op when already consumed and hidden', () => {
    const prev = {
      ...INITIAL_CONNECTION_QUALITY_ACTION_STATE,
      promptConsumed: true,
      showTurnOffCamera: false,
    };
    expect(consumeConnectionQualityAction(prev)).toBe(prev);
  });
});
