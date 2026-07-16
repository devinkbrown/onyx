// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCustomThemeTokenMap } from './customThemes';
import { THEMES, type ThemeId, type TokenMap } from './themes';

export type ThemeExportBlob = {
  __onyx_theme_export__: true;
  base: ThemeId;
  overrides: TokenMap;
  exported: string;
};

export type ThemeExportParseResult =
  | { ok: true; value: ThemeExportBlob }
  | { ok: false; error: string };

const MAX_THEME_EXPORT_BYTES = 64 * 1024;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a pasted Theme Studio export without seating untrusted values. */
export function parseThemeExport(raw: string): ThemeExportParseResult {
  if (typeof raw !== 'string' || raw.length > MAX_THEME_EXPORT_BYTES) {
    return { ok: false, error: 'Theme export is too large.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: 'Invalid JSON — could not parse.' };
  }
  if (!isRecord(parsed) || parsed.__onyx_theme_export__ !== true) {
    return { ok: false, error: 'Not a valid Onyx theme export.' };
  }
  if (typeof parsed.base !== 'string' || !Object.hasOwn(THEMES, parsed.base)) {
    return {
      ok: false,
      error: typeof parsed.base === 'string'
        ? `Unknown base theme "${parsed.base.slice(0, 80)}".`
        : 'Not a valid Onyx theme export.',
    };
  }
  const overrides = parseCustomThemeTokenMap(parsed.overrides);
  if (!overrides) return { ok: false, error: 'Not a valid Onyx theme export.' };
  if (
    typeof parsed.exported !== 'string'
    || !ISO_TIMESTAMP_RE.test(parsed.exported)
    || !Number.isFinite(Date.parse(parsed.exported))
  ) return { ok: false, error: 'Not a valid Onyx theme export.' };
  return {
    ok: true,
    value: {
      __onyx_theme_export__: true,
      base: parsed.base as ThemeId,
      overrides,
      exported: parsed.exported,
    },
  };
}
