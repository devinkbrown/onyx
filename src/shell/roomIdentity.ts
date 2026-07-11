// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ActiveView } from '@/lib/store';

export type RoomIdentity = {
  target: string;
  hue: number;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  border: string;
  wash: string;
};

const ROOM_HUES = [
  18, 42, 88, 132, 166, 196, 226, 272, 316, 348,
] as const;

function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function channelIdentityTarget(view: ActiveView): string | null {
  return view.kind === 'channel' ? normalizeRoomTarget(view.channel) : null;
}

export function normalizeRoomTarget(target: string | null | undefined): string | null {
  const normalized = target?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

export function roomIdentityForTarget(target: string | null | undefined): RoomIdentity | null {
  const normalized = normalizeRoomTarget(target);
  if (!normalized) return null;

  const hue = ROOM_HUES[stableHash(normalized) % ROOM_HUES.length] ?? ROOM_HUES[0];
  return {
    target: normalized,
    hue,
    accent: `oklch(0.72 0.16 ${hue})`,
    accentStrong: `oklch(0.82 0.18 ${hue})`,
    accentSoft: `oklch(0.42 0.08 ${hue} / 0.28)`,
    border: `oklch(0.70 0.12 ${hue} / 0.40)`,
    wash: `oklch(0.34 0.07 ${hue} / 0.20)`,
  };
}
