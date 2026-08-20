// SPDX-License-Identifier: AGPL-3.0-or-later
/** Shared environment-aware appearance policy for every background surface. */
import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { makeMediaSignal } from '@/lib/a11y/mediaPrefs';
import { makeReducedDataSignal } from '@/lib/a11y/reducedData';
import { preferences } from '@/lib/prefs/preferences';
import { sceneMotion, type SceneMotion } from '@/lib/prefs/sceneMotion';
import type { BackgroundQuality } from './engine';
import {
  deriveBackgroundPolicy,
  readCoarsePointer,
  readDevicePixelRatio,
  readViewportWidth,
  type BackgroundPolicy,
} from './backgroundPolicy';

export interface AppearanceEnvironment {
  reducedMotion: Accessor<boolean>;
  reducedData: Accessor<boolean>;
  viewportWidth: Accessor<number>;
  coarsePointer: Accessor<boolean>;
  devicePixelRatio: Accessor<number>;
}

export interface AppearanceRuntimeOptions {
  motion?: Accessor<SceneMotion>;
  preview?: Accessor<boolean>;
  runtimeQuality?: Accessor<BackgroundQuality | undefined>;
  qualityCeiling?: Accessor<BackgroundQuality | undefined>;
  environment?: AppearanceEnvironment;
  inAppReducedMotion?: Accessor<boolean>;
}

export interface AppearanceRuntime {
  environment: AppearanceEnvironment;
  policy: Accessor<BackgroundPolicy>;
}

export function createAppearanceEnvironment(): AppearanceEnvironment {
  return {
    reducedMotion: makeMediaSignal('(prefers-reduced-motion: reduce)'),
    reducedData: makeReducedDataSignal(),
    viewportWidth: makeViewportWidthSignal(),
    coarsePointer: makeCoarsePointerSignal(),
    devicePixelRatio: makeDevicePixelRatioSignal(),
  };
}

export function createAppearanceRuntime(options: AppearanceRuntimeOptions = {}): AppearanceRuntime {
  const environment = options.environment ?? createAppearanceEnvironment();
  const motion = options.motion ?? sceneMotion;
  const inAppReducedMotion = options.inAppReducedMotion ?? (() => preferences().reduceMotion);
  const policy = createMemo(() => deriveBackgroundPolicy({
    sceneMotion: motion(),
    reducedMotion: environment.reducedMotion() || inAppReducedMotion(),
    reducedData: environment.reducedData(),
    viewportWidth: environment.viewportWidth(),
    coarsePointer: environment.coarsePointer(),
    devicePixelRatio: environment.devicePixelRatio(),
    preview: options.preview?.() === true,
    runtimeQuality: options.runtimeQuality?.(),
    qualityCeiling: options.qualityCeiling?.(),
  }));
  return { environment, policy };
}

function makeViewportWidthSignal(): Accessor<number> {
  const [width, setWidth] = createSignal(readViewportWidth());
  if (typeof window === 'undefined') return width;
  const sync = (): void => {
    setWidth(readViewportWidth());
  };
  window.addEventListener('resize', sync);
  onCleanup(() => window.removeEventListener('resize', sync));
  return width;
}

function makeCoarsePointerSignal(): Accessor<boolean> {
  const [coarse, setCoarse] = createSignal(readCoarsePointer());
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return coarse;
  let query: MediaQueryList;
  try {
    query = window.matchMedia('(pointer: coarse)');
  } catch {
    return coarse;
  }
  const sync = (): void => {
    setCoarse(query.matches);
  };
  try {
    query.addEventListener('change', sync);
    onCleanup(() => query.removeEventListener('change', sync));
  } catch {
    /* advisory environment hint */
  }
  return coarse;
}

function makeDevicePixelRatioSignal(): Accessor<number> {
  const [dpr, setDpr] = createSignal(readDevicePixelRatio());
  if (typeof window === 'undefined') return dpr;
  const sync = (): void => {
    setDpr(readDevicePixelRatio());
  };
  window.addEventListener('resize', sync);
  onCleanup(() => window.removeEventListener('resize', sync));
  return dpr;
}
