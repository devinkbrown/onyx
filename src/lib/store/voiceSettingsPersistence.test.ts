// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VOICE_SETTINGS,
  parseStoredVoiceSettings,
  sanitizeStoredVoiceSettings,
} from './voiceSettingsPersistence';

describe('voice settings persistence boundary', () => {
  it('returns fresh defaults for missing, malformed, and wrong-shape data', () => {
    const missing = parseStoredVoiceSettings(null);
    expect(missing).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(missing).not.toBe(DEFAULT_VOICE_SETTINGS);
    expect(parseStoredVoiceSettings('{')).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseStoredVoiceSettings('[]')).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseStoredVoiceSettings('"voice"')).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('accepts supported values while clamping volume to its UI contract', () => {
    expect(sanitizeStoredVoiceSettings({
      inputDeviceId: 'mic-1',
      outputDeviceId: 'speaker-1',
      outputVolume: 250,
      vadEnabled: false,
      vadSensitivity: 'high',
      noiseSuppression: false,
      echoCancellation: false,
      pushToTalk: true,
      pushToTalkKey: 'KeyV',
      cameraDeviceId: 'camera-1',
      muteOnJoin: true,
    })).toEqual({
      inputDeviceId: 'mic-1',
      outputDeviceId: 'speaker-1',
      outputVolume: 100,
      vadEnabled: false,
      vadSensitivity: 'high',
      noiseSuppression: false,
      echoCancellation: false,
      pushToTalk: true,
      pushToTalkKey: 'KeyV',
      cameraDeviceId: 'camera-1',
      muteOnJoin: true,
    });
  });

  it('defaults muteOnJoin to false when absent (legacy onyx:voice-settings)', () => {
    expect(sanitizeStoredVoiceSettings({
      inputDeviceId: null,
      outputDeviceId: null,
      outputVolume: 80,
      vadEnabled: true,
      vadSensitivity: 'medium',
      noiseSuppression: true,
      echoCancellation: true,
      pushToTalk: false,
      pushToTalkKey: null,
      cameraDeviceId: null,
    }).muteOnJoin).toBe(false);
  });

  it('rejects invalid field types, non-finite numbers, and oversized identifiers', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"outputVolume":null}') as unknown;
    expect(sanitizeStoredVoiceSettings({
      ...(polluted as object),
      inputDeviceId: 'x'.repeat(513),
      outputDeviceId: 42,
      outputVolume: Number.NaN,
      vadEnabled: 'yes',
      vadSensitivity: 'maximum',
      noiseSuppression: null,
      echoCancellation: 1,
      pushToTalk: {},
      pushToTalkKey: '',
      cameraDeviceId: [],
    })).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
