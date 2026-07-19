// SPDX-License-Identifier: AGPL-3.0-or-later

export type VoiceVadSensitivity = 'low' | 'medium' | 'high';

export interface StoredVoiceSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  outputVolume: number;
  vadEnabled: boolean;
  vadSensitivity: VoiceVadSensitivity;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string | null;
  cameraDeviceId: string | null;
  /**
   * When true, channel/DM voice joins start with the local mic muted
   * (research R4 / Era 2 B2 exit criterion "join muted option").
   */
  muteOnJoin: boolean;
}

export const DEFAULT_VOICE_SETTINGS: Readonly<StoredVoiceSettings> = Object.freeze({
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
  muteOnJoin: false,
});

const MAX_DEVICE_ID_LENGTH = 512;
const MAX_KEY_CODE_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sensitivityOr(value: unknown): VoiceVadSensitivity {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : DEFAULT_VOICE_SETTINGS.vadSensitivity;
}

export function sanitizeStoredVoiceSettings(value: unknown): StoredVoiceSettings {
  if (!isRecord(value)) return { ...DEFAULT_VOICE_SETTINGS };

  const volume = typeof value.outputVolume === 'number' && Number.isFinite(value.outputVolume)
    ? Math.max(0, Math.min(100, value.outputVolume))
    : DEFAULT_VOICE_SETTINGS.outputVolume;

  return {
    inputDeviceId: nullableString(value.inputDeviceId, MAX_DEVICE_ID_LENGTH),
    outputDeviceId: nullableString(value.outputDeviceId, MAX_DEVICE_ID_LENGTH),
    outputVolume: volume,
    vadEnabled: booleanOr(value.vadEnabled, DEFAULT_VOICE_SETTINGS.vadEnabled),
    vadSensitivity: sensitivityOr(value.vadSensitivity),
    noiseSuppression: booleanOr(value.noiseSuppression, DEFAULT_VOICE_SETTINGS.noiseSuppression),
    echoCancellation: booleanOr(value.echoCancellation, DEFAULT_VOICE_SETTINGS.echoCancellation),
    pushToTalk: booleanOr(value.pushToTalk, DEFAULT_VOICE_SETTINGS.pushToTalk),
    pushToTalkKey: nullableString(value.pushToTalkKey, MAX_KEY_CODE_LENGTH),
    cameraDeviceId: nullableString(value.cameraDeviceId, MAX_DEVICE_ID_LENGTH),
    muteOnJoin: booleanOr(value.muteOnJoin, DEFAULT_VOICE_SETTINGS.muteOnJoin),
  };
}

export function parseStoredVoiceSettings(raw: string | null): StoredVoiceSettings {
  if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
  try {
    return sanitizeStoredVoiceSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}
