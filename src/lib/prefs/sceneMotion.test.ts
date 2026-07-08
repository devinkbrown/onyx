/**
 * sceneMotion.test.ts - verifies scene motion persistence and DOM reflection.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SCENE_MOTION,
  applySceneMotion,
  loadSceneMotion,
  sceneMotion,
  setSceneMotion,
} from '@/lib/prefs/sceneMotion';

const STORAGE_KEY = 'onyx:scene-motion';

describe('scene motion store', () => {
  beforeEach(() => localStorage.clear());

  it('returns the default when storage is empty', () => {
    expect(loadSceneMotion()).toBe(DEFAULT_SCENE_MOTION);
  });

  it('falls back to the default when storage has an invalid value', () => {
    localStorage.setItem(STORAGE_KEY, 'cinematic');

    expect(loadSceneMotion()).toBe(DEFAULT_SCENE_MOTION);
  });

  it('roundtrips through localStorage and updates the signal', () => {
    setSceneMotion('still');

    expect(localStorage.getItem(STORAGE_KEY)).toBe('still');
    expect(loadSceneMotion()).toBe('still');
    expect(sceneMotion()).toBe('still');
  });

  it('writes the scene motion dataset attribute', () => {
    applySceneMotion('off');

    expect(document.documentElement.dataset.sceneMotion).toBe('off');
  });
});
