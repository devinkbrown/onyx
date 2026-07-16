// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { parseThemeExport } from './themeImport';

function blob(overrides: unknown = { '--lapis': '#00ace9' }): string {
  return JSON.stringify({
    __onyx_theme_export__: true,
    base: 'ocean',
    overrides,
    exported: '2026-07-16T18:00:00.000Z',
  });
}

describe('parseThemeExport', () => {
  it('reconstructs a bounded valid export', () => {
    expect(parseThemeExport(blob())).toEqual({
      ok: true,
      value: {
        __onyx_theme_export__: true,
        base: 'ocean',
        overrides: { '--lapis': '#00ace9' },
        exported: '2026-07-16T18:00:00.000Z',
      },
    });
  });

  it('rejects oversized input before parsing', () => {
    expect(parseThemeExport(' '.repeat((64 * 1024) + 1))).toEqual({
      ok: false,
      error: 'Theme export is too large.',
    });
  });

  it('rejects marker-only and null override payloads', () => {
    expect(parseThemeExport(JSON.stringify({ __onyx_theme_export__: true }))).toMatchObject({ ok: false });
    expect(parseThemeExport(blob(null))).toMatchObject({ ok: false });
  });

  it('rejects prototype base names and unsafe token maps', () => {
    const prototype = JSON.stringify({
      __onyx_theme_export__: true,
      base: 'toString',
      overrides: {},
      exported: '2026-07-16T18:00:00.000Z',
    });
    expect(parseThemeExport(prototype)).toEqual({
      ok: false,
      error: 'Unknown base theme "toString".',
    });
    expect(parseThemeExport(blob({ color: 'red' }))).toMatchObject({ ok: false });
    expect(parseThemeExport(blob({ '--lapis': 'red\nblue' }))).toMatchObject({ ok: false });
  });

  it('rejects invalid export timestamps', () => {
    const parsed = JSON.parse(blob()) as Record<string, unknown>;
    parsed.exported = 'eventually';
    expect(parseThemeExport(JSON.stringify(parsed))).toMatchObject({ ok: false });
  });
});
