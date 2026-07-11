// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * themeShare.ts — compact custom-theme share-code encoding and import guards.
 */

import { THEMES } from '@/theme/themes';
import type { CustomTheme, ThemeId } from '@/theme';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
const CUSTOM_PREFIX = 'custom:';

export function encodeTheme(theme: CustomTheme): string {
  return encodeBase64urlUtf8(JSON.stringify(theme));
}

export function decodeTheme(code: string): CustomTheme | null {
  if (typeof code !== 'string') return null;

  const json = decodeBase64urlUtf8(code);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  return parseCustomTheme(parsed);
}

export function themeShareUrl(theme: CustomTheme, origin: string): string {
  return `${origin}?theme=${encodeTheme(theme)}`;
}

export function parseThemeParam(raw: string | null | undefined): CustomTheme | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return decodeTheme(raw);
}

function encodeBase64urlUtf8(value: string): string {
  return encodeBase64urlBytes(new TextEncoder().encode(value));
}

function decodeBase64urlUtf8(value: string): string | null {
  const bytes = decodeBase64urlBytes(value);
  if (bytes === null) return null;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function encodeBase64urlBytes(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i]!;
    const second = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const third = i + 2 < bytes.length ? bytes[i + 2]! : 0;

    output += BASE64URL_ALPHABET.charAt(first >> 2);
    output += BASE64URL_ALPHABET.charAt(((first & 0x03) << 4) | (second >> 4));
    if (i + 1 < bytes.length) output += BASE64URL_ALPHABET.charAt(((second & 0x0f) << 2) | (third >> 6));
    if (i + 2 < bytes.length) output += BASE64URL_ALPHABET.charAt(third & 0x3f);
  }
  return output;
}

function decodeBase64urlBytes(value: string): Uint8Array | null {
  if (!BASE64URL_RE.test(value) || value.length % 4 === 1) return null;

  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;

  for (const char of value) {
    const sextet = BASE64URL_ALPHABET.indexOf(char);
    if (sextet < 0) return null;

    accumulator = (accumulator << 6) | sextet;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }

  if (bits > 0 && accumulator !== 0) return null;
  return new Uint8Array(bytes);
}

function parseCustomTheme(value: unknown): CustomTheme | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const name = value.name;
  const base = value.base;
  const overrides = parseTokenMap(value.overrides);

  if (typeof id !== 'string' || !id.startsWith(CUSTOM_PREFIX)) return null;
  if (typeof name !== 'string') return null;
  if (typeof base !== 'string' || !isThemeId(base)) return null;
  if (overrides === null) return null;

  return { id, name, base, overrides };
}

function parseTokenMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value) || Array.isArray(value)) return null;

  const entries = Object.entries(value);
  if (entries.some(([, tokenValue]) => typeof tokenValue !== 'string')) return null;

  return Object.fromEntries(entries) as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isThemeId(value: string): value is ThemeId {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}
