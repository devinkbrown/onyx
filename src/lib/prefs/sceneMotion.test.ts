// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sceneMotion.test.ts - verifies scene motion persistence and DOM reflection.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_SCENE_MOTION,
  SCENE_MOTIONS,
  applySceneMotion,
  loadSceneMotion,
  parseSceneMotion,
  resetSceneMotion,
  SCENE_MOTION_STORAGE_KEY,
  sceneMotion,
  setSceneMotion,
} from '@/lib/prefs/sceneMotion';

describe('scene motion store', () => {
  beforeEach(() => localStorage.clear());

  it('returns the default when storage is empty', () => {
    expect(loadSceneMotion()).toBe(DEFAULT_SCENE_MOTION);
  });

  it('falls back to the default when storage has an invalid value', () => {
    localStorage.setItem(SCENE_MOTION_STORAGE_KEY, 'cinematic');

    expect(loadSceneMotion()).toBe(DEFAULT_SCENE_MOTION);
  });

  it('falls back to the default for malformed serialized input', () => {
    for (const stored of ['', 'null', '"off"', 'OFF', JSON.stringify({ value: 'off' })]) {
      localStorage.setItem(SCENE_MOTION_STORAGE_KEY, stored);
      expect(loadSceneMotion()).toBe(DEFAULT_SCENE_MOTION);
    }
  });

  it('parses only known scene motion values', () => {
    expect(parseSceneMotion('adaptive')).toBe('adaptive');
    expect(parseSceneMotion('animated')).toBe('animated');
    expect(parseSceneMotion('still')).toBe('still');
    expect(parseSceneMotion('off')).toBe('off');
    expect(parseSceneMotion('')).toBeNull();
    expect(parseSceneMotion({ value: 'off' })).toBeNull();
  });

  it('defaults missing or invalid storage to Adaptive without replacing an explicit Animated choice', () => {
    expect(DEFAULT_SCENE_MOTION).toBe('adaptive');
    expect(loadSceneMotion()).toBe('adaptive');

    localStorage.setItem(SCENE_MOTION_STORAGE_KEY, 'animated');
    expect(loadSceneMotion()).toBe('animated');
  });

  it('roundtrips through localStorage and updates the signal', () => {
    setSceneMotion('still');

    expect(localStorage.getItem(SCENE_MOTION_STORAGE_KEY)).toBe('still');
    expect(loadSceneMotion()).toBe('still');
    expect(sceneMotion()).toBe('still');
  });

  it('serializes each scene motion as the raw storage value and loads it back', () => {
    for (const value of SCENE_MOTIONS) {
      setSceneMotion(value);

      expect(localStorage.getItem(SCENE_MOTION_STORAGE_KEY)).toBe(value);
      expect(loadSceneMotion()).toBe(value);
      expect(sceneMotion()).toBe(value);
    }
  });

  it('writes the scene motion dataset attribute', () => {
    applySceneMotion('off');

    expect(document.documentElement.dataset.sceneMotion).toBe('off');
  });

  it('synchronizes scene motion changes made in another tab', () => {
    localStorage.setItem(SCENE_MOTION_STORAGE_KEY, 'still');
    window.dispatchEvent(new StorageEvent('storage', {
      key: SCENE_MOTION_STORAGE_KEY,
      newValue: 'still',
    }));

    expect(sceneMotion()).toBe('still');
    expect(document.documentElement.dataset.sceneMotion).toBe('still');
  });

  it('lets the effective Background policy own Still and Off presentation', () => {
    const css = readFileSync('src/backgrounds/scene-motion.css', 'utf8');
    expect(css).toContain("[data-background-mode='still']");
    expect(css).not.toContain("data-scene-motion='off'");
  });

  it('resets scene motion to Adaptive in storage, signal, and DOM', () => {
    setSceneMotion('off');
    resetSceneMotion();

    expect(localStorage.getItem(SCENE_MOTION_STORAGE_KEY)).toBe(DEFAULT_SCENE_MOTION);
    expect(sceneMotion()).toBe(DEFAULT_SCENE_MOTION);
    expect(document.documentElement.dataset.sceneMotion).toBe(DEFAULT_SCENE_MOTION);
  });
});
