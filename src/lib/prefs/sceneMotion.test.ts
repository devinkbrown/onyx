// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sceneMotion.test.ts - verifies scene motion persistence and DOM reflection.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SCENE_MOTION,
  applySceneMotion,
  loadSceneMotion,
  parseSceneMotion,
  resetSceneMotion,
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

  it('parses only known scene motion values', () => {
    expect(parseSceneMotion('animated')).toBe('animated');
    expect(parseSceneMotion('still')).toBe('still');
    expect(parseSceneMotion('off')).toBe('off');
    expect(parseSceneMotion('')).toBeNull();
    expect(parseSceneMotion({ value: 'off' })).toBeNull();
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

  it('resets scene motion to animated in storage, signal, and DOM', () => {
    setSceneMotion('off');
    resetSceneMotion();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(DEFAULT_SCENE_MOTION);
    expect(sceneMotion()).toBe(DEFAULT_SCENE_MOTION);
    expect(document.documentElement.dataset.sceneMotion).toBe(DEFAULT_SCENE_MOTION);
  });
});
