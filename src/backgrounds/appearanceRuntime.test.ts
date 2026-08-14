// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createAppearanceRuntime, type AppearanceEnvironment } from './appearanceRuntime';

function environment(overrides: Partial<Record<keyof AppearanceEnvironment, boolean | number>> = {}): AppearanceEnvironment {
  const values = {
    reducedMotion: false,
    reducedData: false,
    viewportWidth: 390,
    coarsePointer: false,
    devicePixelRatio: 3,
    ...overrides,
  };
  return {
    reducedMotion: () => Boolean(values.reducedMotion),
    reducedData: () => Boolean(values.reducedData),
    viewportWidth: () => Number(values.viewportWidth),
    coarsePointer: () => Boolean(values.coarsePointer),
    devicePixelRatio: () => Number(values.devicePixelRatio),
  };
}

describe('createAppearanceRuntime', () => {
  it('reacts to the real surface instead of a panel-only desktop fixture', () => {
    createRoot((dispose) => {
      const [motion, setMotion] = createSignal<'adaptive' | 'animated'>('adaptive');
      const [width, setWidth] = createSignal(390);
      const base = environment();
      const runtime = createAppearanceRuntime({
        motion,
        environment: { ...base, viewportWidth: width },
        inAppReducedMotion: () => false,
      });

      expect(runtime.policy()).toMatchObject({ mode: 'still', reason: 'adaptive' });
      setWidth(1440);
      expect(runtime.policy()).toMatchObject({ mode: 'animated', reason: 'adaptive' });
      setWidth(390);
      setMotion('animated');
      expect(runtime.policy()).toMatchObject({ mode: 'animated', reason: 'user' });
      dispose();
    });
  });

  it('preserves reduced-data and reduced-motion precedence', () => {
    createRoot((dispose) => {
      const dataSaver = createAppearanceRuntime({
        motion: () => 'adaptive',
        environment: environment({ reducedData: true }),
        inAppReducedMotion: () => false,
      });
      const reducedMotion = createAppearanceRuntime({
        motion: () => 'animated',
        environment: environment({ reducedMotion: true }),
        inAppReducedMotion: () => false,
      });
      expect(dataSaver.policy()).toMatchObject({ mode: 'off', reason: 'reduced-data' });
      expect(reducedMotion.policy()).toMatchObject({ mode: 'still', reason: 'reduced-motion' });
      dispose();
    });
  });
});
