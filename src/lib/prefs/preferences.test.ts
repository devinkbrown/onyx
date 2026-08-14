// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  applyPreferencesSnapshot,
  closePreferences,
  formatBlockedHosts,
  isPreferencesOpen,
  loadPreferences,
  MAX_BLOCKED_HOSTS,
  MAX_PREFERENCES_STORAGE_CHARS,
  openPreferences,
  parseBlockedHosts,
  parsePreferencesSnapshot,
  preferenceOpenRequest,
  preferences,
  resetPreferences,
  sanitizeBlockedHost,
  setPreference,
  type Preferences,
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
        JSON.stringify({
          density: 'compact',
          fontScale: 'lg',
          hideEvents: true,
          width: 'full',
          reduceMotion: true,
          reduceTransparency: true,
        }),
      );
      expect(loadPreferences()).toEqual({
        density: 'compact',
        fontScale: 'lg',
        hideEvents: true,
        width: 'full',
        readerMode: false,
        reduceMotion: true,
        reduceTransparency: true,
        highContrast: false,
        linkPreviews: true,
        httpsOnly: true,
        blockedHosts: [],
        clock: '24h',
        localHistory: true,
        e2eeDms: true,
        timeScrubber: true,
        voiceEntry: true,
        topicTools: true,
        watchTogether: true,
        reactionDensity: 'full',
        experienceMode: 'standard',
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
        readerMode: DEFAULT_PREFERENCES.readerMode,
        reduceMotion: false,
        reduceTransparency: DEFAULT_PREFERENCES.reduceTransparency,
        highContrast: DEFAULT_PREFERENCES.highContrast,
        linkPreviews: true,
        httpsOnly: true,
        blockedHosts: [],
        clock: '24h',
        localHistory: true,
        e2eeDms: true,
        timeScrubber: true,
        voiceEntry: true,
        topicTools: true,
        watchTogether: true,
        reactionDensity: DEFAULT_PREFERENCES.reactionDensity,
        experienceMode: DEFAULT_PREFERENCES.experienceMode,
      });
    });

    it('falls back per-field across every persisted preference without discarding valid neighbors', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          density: 'cinematic',
          fontScale: 'lg',
          hideEvents: 'true',
          width: 'full',
          readerMode: 1,
          reduceMotion: true,
          reduceTransparency: 'false',
          highContrast: false,
          linkPreviews: 'false',
          clock: '12h',
          localHistory: 'no',
          e2eeDms: false,
          timeScrubber: null,
          voiceEntry: true,
          topicTools: 'yes',
          watchTogether: false,
          reactionDensity: 'not-a-mode',
          experienceMode: 'not-a-mode',
        }),
      );

      expect(loadPreferences()).toEqual({
        ...DEFAULT_PREFERENCES,
        fontScale: 'lg',
        width: 'full',
        reduceMotion: true,
        highContrast: false,
        clock: '12h',
        e2eeDms: false,
        voiceEntry: true,
        watchTogether: false,
        reactionDensity: DEFAULT_PREFERENCES.reactionDensity,
      });
    });

    it('uses the legacy high-contrast fallback when the stored highContrast field is malformed', () => {
      localStorage.setItem('onyx:high-contrast', '1');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ density: 'compact', highContrast: 'yes' }));

      expect(loadPreferences()).toEqual({
        ...DEFAULT_PREFERENCES,
        density: 'compact',
        highContrast: true,
      });
    });

    it('returns defaults for malformed non-record JSON payloads', () => {
      for (const serialized of ['null', '[]', '42', '"compact"', 'true']) {
        localStorage.setItem(STORAGE_KEY, serialized);
        expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
      }
    });

    it('returns defaults for corrupt JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    });

    it('rejects oversized stored preferences before parsing', () => {
      localStorage.setItem(STORAGE_KEY, `{${'x'.repeat(MAX_PREFERENCES_STORAGE_CHARS)}}`);
      const parse = vi.spyOn(JSON, 'parse');

      expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
      expect(parse).not.toHaveBeenCalled();
      parse.mockRestore();
    });

    it('migrates the old high-contrast storage key when preferences are absent', () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem('onyx:high-contrast', '1');
      expect(loadPreferences().highContrast).toBe(true);
    });

    it('reads only the current onyx preferences key', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ density: 'roomy' }));
      expect(loadPreferences().density).toBe('roomy');
    });

    it('validates every persisted preference field independently', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          density: 'compact',
          fontScale: 'sm',
          hideEvents: true,
          width: 'full',
          readerMode: true,
          reduceMotion: true,
          reduceTransparency: true,
          highContrast: true,
          linkPreviews: false,
          httpsOnly: false,
          blockedHosts: ['Intranet.Local', '  ads.example  ', 'https://evil', 'ads.example'],
          clock: '12h',
          localHistory: false,
          e2eeDms: false,
          timeScrubber: false,
          voiceEntry: false,
          topicTools: true,
          watchTogether: false,
          reactionDensity: 'counts-only',
          experienceMode: 'advanced',
        }),
      );

      expect(loadPreferences()).toEqual({
        density: 'compact',
        fontScale: 'sm',
        hideEvents: true,
        width: 'full',
        readerMode: true,
        reduceMotion: true,
        reduceTransparency: true,
        highContrast: true,
        linkPreviews: false,
        httpsOnly: false,
        blockedHosts: ['intranet.local', 'ads.example'],
        clock: '12h',
        localHistory: false,
        e2eeDms: false,
        timeScrubber: false,
        voiceEntry: false,
        topicTools: true,
        watchTogether: false,
        reactionDensity: 'counts-only',
        experienceMode: 'advanced',
      });
    });

    it('restores a valid reactionDensity value', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ reactionDensity: 'hidden' }));
      expect(loadPreferences().reactionDensity).toBe('hidden');
    });

    it('keeps Standard as the safe fallback for an invalid experience mode', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ experienceMode: 'raw-everything' }));
      expect(loadPreferences().experienceMode).toBe('standard');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ experienceMode: 'irc-ops' }));
      expect(loadPreferences().experienceMode).toBe('irc-ops');
    });
  });

  describe('blocked host helpers', () => {
    it('sanitizes hostname suffixes and rejects schemes/paths', () => {
      expect(sanitizeBlockedHost('  .Corp.Local.  ')).toBe('corp.local');
      expect(sanitizeBlockedHost('https://evil.example')).toBeNull();
      expect(sanitizeBlockedHost('evil.example/path')).toBeNull();
      expect(sanitizeBlockedHost('user@host')).toBeNull();
      expect(sanitizeBlockedHost('')).toBeNull();
    });

    it('parses comma-separated free text and caps list length', () => {
      expect(parseBlockedHosts('a.example, b.example, a.example')).toEqual(['a.example', 'b.example']);
      expect(formatBlockedHosts(['a.example', 'b.example'])).toBe('a.example, b.example');
      const many = Array.from({ length: MAX_BLOCKED_HOSTS + 5 }, (_, i) => `h${i}.example`);
      expect(parseBlockedHosts(many)).toHaveLength(MAX_BLOCKED_HOSTS);
    });

    it('persists httpsOnly and blockedHosts via setPreference', () => {
      setPreference('httpsOnly', false);
      setPreference('blockedHosts', ['tracker.example']);
      expect(preferences().httpsOnly).toBe(false);
      expect(preferences().blockedHosts).toEqual(['tracker.example']);
      expect(readStored().httpsOnly).toBe(false);
      expect(readStored().blockedHosts).toEqual(['tracker.example']);
    });
  });

  describe('parsePreferencesSnapshot', () => {
    it('returns null for non-object snapshots', () => {
      expect(parsePreferencesSnapshot(null)).toBeNull();
      expect(parsePreferencesSnapshot('compact')).toBeNull();
      expect(parsePreferencesSnapshot(['compact'])).toBeNull();
    });

    it('merges valid fields and falls back for adversarial values', () => {
      expect(parsePreferencesSnapshot({
        density: 'roomy',
        fontScale: '__proto__',
        hideEvents: 1,
        width: 'full',
        clock: '12h',
        localHistory: false,
      })).toEqual({
        ...DEFAULT_PREFERENCES,
        density: 'roomy',
        width: 'full',
        clock: '12h',
        localHistory: false,
      });
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

    it('updates reactionDensity immutably and persists it', () => {
      const before = preferences();
      setPreference('reactionDensity', 'counts-only');
      expect(preferences().reactionDensity).toBe('counts-only');
      expect(before.reactionDensity).toBe(DEFAULT_PREFERENCES.reactionDensity);
      expect(before).not.toBe(preferences());
      expect(readStored().reactionDensity).toBe('counts-only');
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
        readerMode: true,
        reduceMotion: true,
        reduceTransparency: true,
        highContrast: true,
        linkPreviews: false,
        httpsOnly: true,
        blockedHosts: [],
        clock: '12h',
        localHistory: false,
        e2eeDms: false,
        timeScrubber: true,
        voiceEntry: false,
        topicTools: true,
        watchTogether: false,
        reactionDensity: 'compact',
        experienceMode: 'advanced',
      });
      const ds = document.documentElement.dataset;
      expect(ds.density).toBe('compact');
      expect(ds.reader).toBe('true');
      expect(ds.fontScale).toBe('sm');
      expect(ds.hideEvents).toBe('true');
      expect(ds.width).toBe('full');
      expect(ds.reduceMotion).toBe('true');
      expect(ds.reduceTransparency).toBe('true');
      expect(ds.highContrast).toBe('true');
      expect(ds.experienceMode).toBe('advanced');
    });

    it('applies the live store value when called without an argument', () => {
      setPreference('density', 'roomy');
      document.documentElement.dataset.density = 'stale';
      applyPreferences();
      expect(document.documentElement.dataset.density).toBe('roomy');
    });
  });

  describe('applyPreferencesSnapshot', () => {
    it('clones, persists, and applies a supplied snapshot', () => {
      const snapshot: Preferences = {
        ...DEFAULT_PREFERENCES,
        density: 'compact',
        highContrast: true,
        linkPreviews: false,
      };

      applyPreferencesSnapshot(snapshot);
      snapshot.density = 'roomy';

      expect(preferences().density).toBe('compact');
      expect(readStored().density).toBe('compact');
      expect(document.documentElement.dataset.density).toBe('compact');
      expect(document.documentElement.dataset.highContrast).toBe('true');
    });
  });

  describe('resetPreferences', () => {
    it('restores defaults in the signal, storage and DOM', () => {
      setPreference('density', 'compact');
      setPreference('reduceMotion', true);
      setPreference('reduceTransparency', true);
      setPreference('highContrast', true);
      resetPreferences();
      expect(preferences()).toEqual(DEFAULT_PREFERENCES);
      expect(readStored()).toEqual(DEFAULT_PREFERENCES);
      expect(document.documentElement.dataset.reduceMotion).toBe('false');
      expect(document.documentElement.dataset.reduceTransparency).toBe('false');
      expect(document.documentElement.dataset.highContrast).toBe('false');
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

    it('exposes category-specific opens without making the request sticky', () => {
      const initialSequence = preferenceOpenRequest().sequence;
      openPreferences('history');
      expect(isPreferencesOpen()).toBe(true);
      expect(preferenceOpenRequest()).toEqual({
        category: 'history',
        sequence: initialSequence + 1,
      });

      closePreferences();
      openPreferences();
      expect(preferenceOpenRequest()).toEqual({
        category: null,
        sequence: initialSequence + 2,
      });
    });
  });
});
