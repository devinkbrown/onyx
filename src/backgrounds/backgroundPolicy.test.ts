// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  applyBackgroundPolicyDataset,
  applyBackgroundRuntime,
  backgroundPolicyAllowsRenderer,
  backgroundPolicyIsStatic,
  deriveBackgroundPolicy,
  DESKTOP_DPR_CAP,
  DESKTOP_FRAME_CAP_FPS,
  isNarrowSurface,
  minQuality,
  minSceneDetail,
  MOBILE_DPR_CAP,
  MOBILE_FRAME_CAP_FPS,
  NARROW_VIEWPORT_MAX_PX,
  PREVIEW_DPR_CAP,
  PREVIEW_FRAME_CAP_FPS,
  PRESSURE_FRAME_CAP_FPS,
  stepDownQuality,
  stepDownSceneDetail,
  type BackgroundPolicyInput,
} from './backgroundPolicy';

function input(overrides: Partial<BackgroundPolicyInput> = {}): BackgroundPolicyInput {
  return {
    sceneMotion: 'animated',
    reducedMotion: false,
    reducedData: false,
    viewportWidth: 1440,
    coarsePointer: false,
    devicePixelRatio: 1,
    ...overrides,
  };
}

describe('narrow surface detection', () => {
  it('treats 320 and 390 phones as narrow even with a fine pointer', () => {
    expect(isNarrowSurface(320, false)).toBe(true);
    expect(isNarrowSurface(390, false)).toBe(true);
    expect(isNarrowSurface(NARROW_VIEWPORT_MAX_PX, false)).toBe(true);
    expect(isNarrowSurface(NARROW_VIEWPORT_MAX_PX + 1, false)).toBe(false);
  });

  it('treats a coarse pointer as a narrow surface even on a wide viewport', () => {
    expect(isNarrowSurface(1024, true)).toBe(true);
    expect(isNarrowSurface(1440, false)).toBe(false);
  });
});

describe('quality and detail ladders', () => {
  it('never raises quality or detail when taking the minimum', () => {
    expect(minQuality('high', 'med')).toBe('med');
    expect(minQuality('low', 'high')).toBe('low');
    expect(minSceneDetail('full', 'balanced')).toBe('balanced');
    expect(minSceneDetail('sparse', 'full')).toBe('sparse');
  });

  it('steps down one rung and floors at the cheapest tier', () => {
    expect(stepDownQuality('high')).toBe('med');
    expect(stepDownQuality('med')).toBe('low');
    expect(stepDownQuality('low')).toBe('low');
    expect(stepDownSceneDetail('full')).toBe('balanced');
    expect(stepDownSceneDetail('balanced')).toBe('sparse');
    expect(stepDownSceneDetail('sparse')).toBe('sparse');
  });
});

describe('deriveBackgroundPolicy — mode precedence', () => {
  it('turns Off for reduced data even when the user asked for animated', () => {
    const policy = deriveBackgroundPolicy(input({ reducedData: true, sceneMotion: 'animated' }));
    expect(policy.mode).toBe('off');
    expect(policy.reason).toBe('reduced-data');
    expect(backgroundPolicyAllowsRenderer(policy)).toBe(false);
  });

  it('turns Off for explicit Off, including on a 390px DPR3 phone', () => {
    const policy = deriveBackgroundPolicy(input({
      sceneMotion: 'off',
      viewportWidth: 390,
      devicePixelRatio: 3,
    }));
    expect(policy.mode).toBe('off');
    expect(policy.reason).toBe('user');
  });

  it('preserves explicit Off over reduced-data so no placeholder is painted', () => {
    const policy = deriveBackgroundPolicy(input({ sceneMotion: 'off', reducedData: true }));
    expect(policy.mode).toBe('off');
    expect(policy.reason).toBe('user');
  });

  it('freezes for OS or in-app reduced motion instead of swapping the scene off', () => {
    const os = deriveBackgroundPolicy(input({ reducedMotion: true }));
    expect(os.mode).toBe('still');
    expect(os.reason).toBe('reduced-motion');
    expect(backgroundPolicyIsStatic(os)).toBe(true);
    expect(backgroundPolicyAllowsRenderer(os)).toBe(true);
  });

  it('honours explicit Still when the OS is not asking to reduce motion', () => {
    const policy = deriveBackgroundPolicy(input({ sceneMotion: 'still' }));
    expect(policy.mode).toBe('still');
    expect(policy.reason).toBe('user');
  });

  it('keeps reduced-motion as the reason when Still and reduced motion overlap', () => {
    const policy = deriveBackgroundPolicy(input({ sceneMotion: 'still', reducedMotion: true }));
    expect(policy.mode).toBe('still');
    expect(policy.reason).toBe('reduced-motion');
  });
});

describe('deriveBackgroundPolicy — mobile stays animated', () => {
  it.each([
    { label: '320 CSS px at DPR 3', viewportWidth: 320, devicePixelRatio: 3 },
    { label: '390 CSS px at DPR 3', viewportWidth: 390, devicePixelRatio: 3 },
  ])('keeps $label animated at med/balanced with an 18–24 fps cap', ({ viewportWidth, devicePixelRatio }) => {
    const policy = deriveBackgroundPolicy(input({ viewportWidth, devicePixelRatio }));
    expect(policy.mode).toBe('animated');
    expect(policy.reason).toBe('user');
    expect(policy.quality).toBe('med');
    expect(policy.sceneDetail).toBe('balanced');
    expect(policy.frameCapFps).toBeGreaterThanOrEqual(18);
    expect(policy.frameCapFps).toBeLessThanOrEqual(24);
    expect(policy.frameCapFps).toBe(MOBILE_FRAME_CAP_FPS);
    expect(policy.dprCap).toBe(MOBILE_DPR_CAP);
    expect(backgroundPolicyAllowsRenderer(policy)).toBe(true);
  });

  it('never chooses Off solely because the pointer is coarse', () => {
    const policy = deriveBackgroundPolicy(input({
      viewportWidth: 1024,
      coarsePointer: true,
      devicePixelRatio: 2,
    }));
    expect(policy.mode).toBe('animated');
    expect(policy.quality).toBe('med');
    expect(policy.dprCap).toBe(MOBILE_DPR_CAP);
    expect(policy.reason).not.toBe('reduced-data');
  });
});

describe('deriveBackgroundPolicy — desktop and high DPR', () => {
  it('uses high/full/30fps and caps DPR at 2 on a desktop DPR2+ display', () => {
    const policy = deriveBackgroundPolicy(input({
      viewportWidth: 1440,
      devicePixelRatio: 2.75,
    }));
    expect(policy.mode).toBe('animated');
    expect(policy.quality).toBe('high');
    expect(policy.sceneDetail).toBe('full');
    expect(policy.frameCapFps).toBe(DESKTOP_FRAME_CAP_FPS);
    expect(policy.dprCap).toBe(DESKTOP_DPR_CAP);
    expect(policy.dprCap).toBe(2);
  });

  it('does not raise a host quality ceiling', () => {
    const policy = deriveBackgroundPolicy(input({
      viewportWidth: 1440,
      qualityCeiling: 'low',
    }));
    expect(policy.quality).toBe('low');
    expect(policy.sceneDetail).toBe('sparse');
  });

  it('lets AppShell request high without overriding a mobile med contract', () => {
    const policy = deriveBackgroundPolicy(input({
      viewportWidth: 390,
      devicePixelRatio: 3,
      qualityCeiling: 'high',
    }));
    expect(policy.quality).toBe('med');
    expect(policy.sceneDetail).toBe('balanced');
  });
});

describe('deriveBackgroundPolicy — preview', () => {
  it('caps a live desktop preview at low/sparse', () => {
    const policy = deriveBackgroundPolicy(input({ preview: true, viewportWidth: 1440, devicePixelRatio: 2 }));
    expect(policy.mode).toBe('animated');
    expect(policy.quality).toBe('low');
    expect(policy.sceneDetail).toBe('sparse');
    expect(policy.frameCapFps).toBe(PREVIEW_FRAME_CAP_FPS);
    expect(policy.dprCap).toBe(PREVIEW_DPR_CAP);
    expect(policy.reason).toBe('user');
  });

  it('still freezes a preview under reduced motion', () => {
    const policy = deriveBackgroundPolicy(input({ preview: true, reducedMotion: true }));
    expect(policy.mode).toBe('still');
    expect(policy.quality).toBe('low');
    expect(policy.sceneDetail).toBe('sparse');
    expect(policy.reason).toBe('reduced-motion');
  });

  it('still turns a preview Off under reduced data', () => {
    const policy = deriveBackgroundPolicy(input({ preview: true, reducedData: true }));
    expect(policy.mode).toBe('off');
    expect(policy.reason).toBe('reduced-data');
  });
});

describe('deriveBackgroundPolicy — runtime pressure', () => {
  it('drops a desktop animated surface one quality step without turning it off', () => {
    const policy = deriveBackgroundPolicy(input({ runtimePressure: true }));
    expect(policy.mode).toBe('animated');
    expect(policy.reason).toBe('runtime-pressure');
    expect(policy.quality).toBe('med');
    expect(policy.sceneDetail).toBe('balanced');
    expect(policy.frameCapFps).toBe(MOBILE_FRAME_CAP_FPS);
    expect(backgroundPolicyAllowsRenderer(policy)).toBe(true);
  });

  it('drops a 390px phone to low/sparse and keeps it animated', () => {
    const policy = deriveBackgroundPolicy(input({
      runtimePressure: true,
      viewportWidth: 390,
      devicePixelRatio: 3,
    }));
    expect(policy.mode).toBe('animated');
    expect(policy.quality).toBe('low');
    expect(policy.sceneDetail).toBe('sparse');
    expect(policy.frameCapFps).toBe(PRESSURE_FRAME_CAP_FPS);
    expect(policy.reason).toBe('runtime-pressure');
  });

  it('does not override a reduced-motion reason when pressure is also present', () => {
    const policy = deriveBackgroundPolicy(input({ runtimePressure: true, reducedMotion: true }));
    expect(policy.mode).toBe('still');
    expect(policy.reason).toBe('reduced-motion');
    expect(policy.quality).toBe('med');
  });

  it('honours the renderer quality tier instead of collapsing pressure to a boolean', () => {
    const med = deriveBackgroundPolicy(input({ runtimeQuality: 'med' }));
    const low = deriveBackgroundPolicy(input({ runtimeQuality: 'low' }));
    const high = deriveBackgroundPolicy(input({ runtimeQuality: 'high' }));

    expect(med.quality).toBe('med');
    expect(med.sceneDetail).toBe('balanced');
    expect(low.quality).toBe('low');
    expect(low.sceneDetail).toBe('sparse');
    expect(low.reason).toBe('runtime-pressure');
    expect(high.quality).toBe('high');
    expect(high.sceneDetail).toBe('full');
    expect(high.reason).toBe('user');
  });
});

describe('applyBackgroundRuntime — hidden and focus', () => {
  it('pauses an animated surface when hidden or unfocused without changing mode', () => {
    const live = deriveBackgroundPolicy(input());
    const hidden = applyBackgroundRuntime(live, { hidden: true });
    const blurred = applyBackgroundRuntime(live, { unfocused: true });
    expect(hidden.mode).toBe('animated');
    expect(hidden.paused).toBe(true);
    expect(blurred.paused).toBe(true);
    expect(applyBackgroundRuntime(live, { hidden: false, unfocused: false }).paused).toBe(false);
  });

  it('reports paused for Still and Off even while the tab is focused', () => {
    const still = deriveBackgroundPolicy(input({ sceneMotion: 'still' }));
    const off = deriveBackgroundPolicy(input({ sceneMotion: 'off' }));
    expect(applyBackgroundRuntime(still).paused).toBe(true);
    expect(applyBackgroundRuntime(off).paused).toBe(true);
  });
});

describe('applyBackgroundPolicyDataset', () => {
  it('writes the contract onto a host element and clears optional flags', () => {
    const host = document.createElement('div');
    const policy = deriveBackgroundPolicy(input({ preview: true }));
    applyBackgroundPolicyDataset(host, policy, { preview: true, paused: true });
    expect(host.dataset.backgroundMode).toBe('animated');
    expect(host.dataset.backgroundQuality).toBe('low');
    expect(host.dataset.backgroundDetail).toBe('sparse');
    expect(host.dataset.backgroundReason).toBe('user');
    expect(host.dataset.backgroundFps).toBe(String(PREVIEW_FRAME_CAP_FPS));
    expect(host.dataset.backgroundDprCap).toBe(String(PREVIEW_DPR_CAP));
    expect(host.dataset.backgroundPreview).toBe('true');
    expect(host.dataset.backgroundPaused).toBe('true');

    applyBackgroundPolicyDataset(host, policy);
    expect(host.dataset.backgroundPreview).toBeUndefined();
    expect(host.dataset.backgroundPaused).toBeUndefined();
  });
});
