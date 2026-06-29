import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  closePreferences,
  isPreferencesOpen,
  loadPreferences,
  openPreferences,
  preferences,
  resetPreferences,
  setPreference,
} from './preferences';

const STORAGE_KEY = 'onyx:preferences';

function readStored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
}

describe('preferences store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
    closePreferences();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('loadPreferences', () => {
    it('returns defaults when nothing is stored', () => {
      expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    });

    it('restores a fully-valid stored payload', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ density: 'compact', fontScale: 'lg', hideEvents: true, width: 'full', reduceMotion: true }),
      );
      expect(loadPreferences()).toEqual({
        density: 'compact',
        fontScale: 'lg',
        hideEvents: true,
        width: 'full',
        reduceMotion: true,
      });
    });

    it('falls back per-field when a value is invalid', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ density: 'nope', fontScale: 'md', hideEvents: 'yes', width: 1, reduceMotion: false }),
      );
      expect(loadPreferences()).toEqual({
        density: DEFAULT_PREFERENCES.density,
        fontScale: 'md',
        hideEvents: DEFAULT_PREFERENCES.hideEvents,
        width: DEFAULT_PREFERENCES.width,
        reduceMotion: false,
      });
    });

    it('returns defaults for corrupt JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    });
  });

  describe('setPreference', () => {
    it('updates the signal immutably', () => {
      const before = preferences();
      setPreference('density', 'roomy');
      expect(preferences().density).toBe('roomy');
      expect(before).not.toBe(preferences());
      expect(before.density).toBe(DEFAULT_PREFERENCES.density);
    });

    it('persists each change to localStorage', () => {
      setPreference('fontScale', 'lg');
      setPreference('hideEvents', true);
      const stored = readStored();
      expect(stored.fontScale).toBe('lg');
      expect(stored.hideEvents).toBe(true);
    });

    it('reflects the change onto document.documentElement', () => {
      setPreference('width', 'full');
      expect(document.documentElement.dataset.width).toBe('full');
      setPreference('hideEvents', true);
      expect(document.documentElement.dataset.hideEvents).toBe('true');
    });
  });

  describe('applyPreferences', () => {
    it('writes every data-* attribute', () => {
      applyPreferences({
        density: 'compact',
        fontScale: 'sm',
        hideEvents: true,
        width: 'full',
        reduceMotion: true,
      });
      const ds = document.documentElement.dataset;
      expect(ds.density).toBe('compact');
      expect(ds.fontScale).toBe('sm');
      expect(ds.hideEvents).toBe('true');
      expect(ds.width).toBe('full');
      expect(ds.reduceMotion).toBe('true');
    });

    it('applies the live store value when called without an argument', () => {
      setPreference('density', 'roomy');
      document.documentElement.dataset.density = 'stale';
      applyPreferences();
      expect(document.documentElement.dataset.density).toBe('roomy');
    });
  });

  describe('resetPreferences', () => {
    it('restores defaults in the signal, storage and DOM', () => {
      setPreference('density', 'compact');
      setPreference('reduceMotion', true);
      resetPreferences();
      expect(preferences()).toEqual(DEFAULT_PREFERENCES);
      expect(readStored()).toEqual(DEFAULT_PREFERENCES);
      expect(document.documentElement.dataset.reduceMotion).toBe('false');
    });
  });

  describe('open state', () => {
    it('toggles the panel gate', () => {
      expect(isPreferencesOpen()).toBe(false);
      openPreferences();
      expect(isPreferencesOpen()).toBe(true);
      closePreferences();
      expect(isPreferencesOpen()).toBe(false);
    });
  });
});
