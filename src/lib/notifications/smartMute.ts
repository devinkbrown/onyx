// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * smartMute.ts — keyword + noise mute rules for the notify decision path.
 *
 * Pure helpers: the runtime ORs `matchesSmartMute` into the muted axis so a
 * noisy bot or keyword never rings the OS notification bell.
 */

export const MAX_MUTE_KEYWORDS = 64;
export const MAX_KEYWORD_LEN = 64;

export type SmartMuteRules = {
  /** Case-insensitive substring keywords (already sanitized). */
  keywords: string[];
  /** Drop join/part/quit-style system noise when true. */
  muteSystemNoise: boolean;
  /** Drop messages from these nicks (lowercased). */
  mutedNicks: string[];
};

export const EMPTY_SMART_MUTE: SmartMuteRules = {
  keywords: [],
  muteSystemNoise: false,
  mutedNicks: [],
};

const CONTROL = /[\u0000-\u001f\u007f]/u;

export function sanitizeKeyword(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_KEYWORD_LEN || CONTROL.test(trimmed)) return null;
  return trimmed;
}

export function parseSmartMute(value: unknown): SmartMuteRules {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...EMPTY_SMART_MUTE };
  }
  const obj = value as Record<string, unknown>;
  const keywords: string[] = [];
  if (Array.isArray(obj.keywords)) {
    for (const entry of obj.keywords.slice(0, MAX_MUTE_KEYWORDS)) {
      if (typeof entry !== 'string') continue;
      const safe = sanitizeKeyword(entry);
      if (safe && !keywords.includes(safe)) keywords.push(safe);
    }
  }
  const mutedNicks: string[] = [];
  if (Array.isArray(obj.mutedNicks)) {
    for (const entry of obj.mutedNicks.slice(0, MAX_MUTE_KEYWORDS)) {
      if (typeof entry !== 'string') continue;
      const nick = entry.trim().toLowerCase();
      if (!nick || nick.length > 64 || CONTROL.test(nick)) continue;
      if (!mutedNicks.includes(nick)) mutedNicks.push(nick);
    }
  }
  return {
    keywords,
    muteSystemNoise: obj.muteSystemNoise === true,
    mutedNicks,
  };
}

export type SmartMuteInput = {
  text: string;
  from: string;
  kind: 'mention' | 'dm' | 'follow' | 'call' | 'system' | 'error' | string;
};

/**
 * True when the notification should be treated as muted by smart rules.
 * Mentions of the user's own nick are still eligible for mute if a keyword
 * matches — intentional; keyword mute is a hard silence.
 */
export function matchesSmartMute(rules: SmartMuteRules, input: SmartMuteInput): boolean {
  if (rules.muteSystemNoise && (input.kind === 'system' || input.kind === 'error')) {
    return true;
  }
  const from = input.from.trim().toLowerCase();
  if (from && rules.mutedNicks.includes(from)) return true;
  if (rules.keywords.length === 0) return false;
  const text = input.text.toLowerCase();
  return rules.keywords.some((kw) => text.includes(kw));
}
