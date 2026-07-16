// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SuimyakuRoomStats } from './types';

const MAX_CONTROL_JSON_BYTES = 64 * 1024;
// Match PeerRegistry's hard cap so parsing cannot retain entries the live
// engine will immediately discard.
const MAX_ROSTER_PARTICIPANTS = 64;
const MAX_NICK_LENGTH = 128;
const MAX_INLINE_MEDIA_BYTES = 1024 * 1024;
const MAX_SUGGESTED_BPS = 100_000_000;
const MIN_AUDIO_BITRATE_KBPS = 6;
const MAX_AUDIO_BITRATE_KBPS = 512;
const MAX_REACTION_CODE_POINTS = 64;

function parseJson(payload: string): unknown {
  if (!payload || payload.length > MAX_CONTROL_JSON_BYTES) return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rosterNicks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (result.length >= MAX_ROSTER_PARTICIPANTS) break;
    if (typeof item !== 'string' || item.length === 0 || item.length > MAX_NICK_LENGTH) continue;
    const key = item.toLocaleLowerCase('en');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export interface MediaRoster {
  voice: string[];
  video: string[];
}

export function parseMediaRoster(payload: string): MediaRoster | null {
  const parsed = record(parseJson(payload));
  if (!parsed) return null;
  return {
    voice: rosterNicks(parsed.voice),
    video: rosterNicks(parsed.video),
  };
}

function boundedNumber(value: unknown, max: number, integer = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

export function parseRoomStats(payload: string): SuimyakuRoomStats | null {
  const parsed = record(parseJson(payload));
  if (!parsed) return null;
  const activeSenders = boundedNumber(parsed.active_senders, 100_000, true);
  const totalViewers = boundedNumber(parsed.total_viewers, 100_000, true);
  const videoFps = boundedNumber(parsed.video_fps, 1_000);
  const audioKbps = boundedNumber(parsed.audio_kbps, 100_000);
  if (activeSenders === null || totalViewers === null || videoFps === null || audioKbps === null) {
    return null;
  }
  return {
    active_senders: activeSenders,
    total_viewers: totalViewers,
    video_fps: videoFps,
    audio_kbps: audioKbps,
  };
}

export function parseSuggestedBitrate(payload: string): number | null {
  const parsed = parseJson(payload);
  const candidate = typeof parsed === 'number' ? parsed : record(parsed)?.suggested_bps;
  const bps = boundedNumber(candidate, MAX_SUGGESTED_BPS, true);
  return bps !== null && bps > 0 ? bps : null;
}

export function parseNegotiatedAudioBitrate(payload: string): number | null {
  const parsed = record(parseJson(payload));
  if (!parsed) return null;
  const bitrate = boundedNumber(parsed.max_bitrate_kbps, MAX_AUDIO_BITRATE_KBPS, true);
  return bitrate !== null && bitrate >= MIN_AUDIO_BITRATE_KBPS ? bitrate : null;
}

export function parseChannelRoster(payload: string): string[] | null {
  const parsed = parseJson(payload);
  if (!Array.isArray(parsed)) return null;
  return rosterNicks(parsed.map((item) => record(item)?.nick));
}

/** Decode a small inline media payload without letting atob errors escape. */
export function decodeInlineBase64(
  payload: string,
  maxBytes = MAX_INLINE_MEDIA_BYTES,
): Uint8Array | null {
  if (!payload || maxBytes <= 0) return null;
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;
  if (payload.length > maxEncodedLength) return null;
  try {
    const decoded = atob(payload);
    if (decoded.length > maxBytes) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function boundedReaction(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, MAX_REACTION_CODE_POINTS).join('');
}

export function parseKickTarget(payload: string): string | null {
  const parsed = record(parseJson(payload));
  const target = parsed?.target;
  return typeof target === 'string' && target.length > 0 && target.length <= MAX_NICK_LENGTH
    ? target
    : null;
}
