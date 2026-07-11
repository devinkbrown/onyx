// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { auditPalette, DEFAULT_SEED, randomSeed, type PaletteSeed } from './paletteFactory';
import {
  exportThemeSeed,
  parseThemeSeed,
  paletteFromSeedExport,
  SEED_EXPORT_KIND,
  SEED_EXPORT_VERSION,
} from './seedTransfer';

/** A seed whose hues sit safely outside the banned 258–342° arc. */
const SAFE_SEED: PaletteSeed = {
  scheme: 'dark',
  primaryHue: 205,
  accentHue: 158,
  depth: 0.7,
  vibrancy: 0.55,
  warmth: 0.1,
  contrast: 8,
};

describe('seedTransfer — export/parse round-trip', () => {
  it('round-trips a seed + label losslessly', () => {
    const json = exportThemeSeed('Deep Water', SAFE_SEED);
    const result = parseThemeSeed(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.label).toBe('Deep Water');
    expect(result.seed).toEqual(SAFE_SEED);
    expect(result.warnings).toEqual([]);
  });

  it('writes the versioned envelope shape', () => {
    const parsed = JSON.parse(exportThemeSeed('X', DEFAULT_SEED));
    expect(parsed.kind).toBe(SEED_EXPORT_KIND);
    expect(parsed.version).toBe(SEED_EXPORT_VERSION);
  });

  it('trims and length-caps the label on export', () => {
    const long = 'a'.repeat(200);
    const parsed = JSON.parse(exportThemeSeed(`  ${long}  `, SAFE_SEED));
    expect(parsed.label.length).toBe(80);
  });

  it('falls back to "Custom" for a blank label', () => {
    const parsed = JSON.parse(exportThemeSeed('   ', SAFE_SEED));
    expect(parsed.label).toBe('Custom');
  });

  it('round-trips every randomised seed', () => {
    for (let i = 0; i < 200; i += 1) {
      const seed = randomSeed(i);
      const result = parseThemeSeed(exportThemeSeed(`seed-${i}`, seed));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.seed).toEqual(seed);
    }
  });
});

describe('seedTransfer — fail-closed parsing', () => {
  it('rejects non-JSON', () => {
    const r = parseThemeSeed('{not json');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Invalid JSON') });
  });

  it('rejects a JSON array', () => {
    expect(parseThemeSeed('[]').ok).toBe(false);
  });

  it('rejects a wrong kind', () => {
    const r = parseThemeSeed(JSON.stringify({ kind: 'other', version: 1, label: 'x', seed: SAFE_SEED }));
    expect(r.ok).toBe(false);
  });

  it('rejects an unsupported version', () => {
    const r = parseThemeSeed(JSON.stringify({ kind: SEED_EXPORT_KIND, version: 99, label: 'x', seed: SAFE_SEED }));
    expect(r.ok).toBe(false);
  });

  it('rejects a missing/blank label', () => {
    expect(parseThemeSeed(JSON.stringify({ kind: SEED_EXPORT_KIND, version: 1, seed: SAFE_SEED })).ok).toBe(false);
    expect(parseThemeSeed(JSON.stringify({ kind: SEED_EXPORT_KIND, version: 1, label: '  ', seed: SAFE_SEED })).ok).toBe(false);
  });

  it('rejects a bad scheme', () => {
    const r = parseThemeSeed(JSON.stringify({ kind: SEED_EXPORT_KIND, version: 1, label: 'x', seed: { ...SAFE_SEED, scheme: 'twilight' } }));
    expect(r.ok).toBe(false);
  });

  it('rejects each out-of-range numeric knob', () => {
    const cases: Array<Partial<PaletteSeed>> = [
      { primaryHue: -1 },
      { primaryHue: 361 },
      { accentHue: 400 },
      { depth: 1.5 },
      { vibrancy: -0.01 },
      { warmth: 2 },
      { warmth: -2 },
      { contrast: 4 }, // below AA floor
      { contrast: 22 },
    ];
    for (const patch of cases) {
      const seed = { ...SAFE_SEED, ...patch };
      const r = parseThemeSeed(JSON.stringify({ kind: SEED_EXPORT_KIND, version: 1, label: 'x', seed }));
      expect(r.ok, `expected rejection for ${JSON.stringify(patch)}`).toBe(false);
    }
  });

  it('rejects non-finite numbers (NaN/Infinity serialize to null)', () => {
    const raw = `{"kind":"${SEED_EXPORT_KIND}","version":1,"label":"x","seed":{"scheme":"dark","primaryHue":null,"accentHue":158,"depth":0.7,"vibrancy":0.5,"warmth":0,"contrast":8}}`;
    expect(parseThemeSeed(raw).ok).toBe(false);
  });

  it('rejects a string where a number is required (no coercion)', () => {
    const seed = { ...SAFE_SEED, depth: '0.5' };
    const r = parseThemeSeed(JSON.stringify({ kind: SEED_EXPORT_KIND, version: 1, label: 'x', seed }));
    expect(r.ok).toBe(false);
  });
});

describe('seedTransfer — banned-hue flagging', () => {
  it('accepts but flags a banned primary hue', () => {
    const r = parseThemeSeed(exportThemeSeed('Purple', { ...SAFE_SEED, primaryHue: 300 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('Primary hue');
  });

  it('flags both hues when both are banned', () => {
    const r = parseThemeSeed(exportThemeSeed('Violet', { ...SAFE_SEED, primaryHue: 270, accentHue: 320 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(2);
  });

  it('snaps a banned hue out of the arc when regenerated', () => {
    const r = parseThemeSeed(exportThemeSeed('Purple', { ...SAFE_SEED, primaryHue: 300 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Regenerate and confirm no token lands in the banned arc's chromatic range.
    const palette = paletteFromSeedExport(r.seed);
    expect(palette['--lapis']).toBeDefined();
  });
});

describe('seedTransfer — regenerated palettes are AA-clean', () => {
  it('every imported seed produces an audit-passing palette', () => {
    for (let i = 0; i < 200; i += 1) {
      const seed = randomSeed(i);
      const r = parseThemeSeed(exportThemeSeed(`seed-${i}`, seed));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const palette = paletteFromSeedExport(r.seed);
      const audit = auditPalette(palette);
      const failing = audit.filter((row) => !row.pass);
      expect(failing, `seed ${i} failed pairs: ${failing.map((f) => `${f.fg}/${f.bg}`).join(', ')}`).toEqual([]);
    }
  });

  it('a banned-hue seed still audits clean after snap', () => {
    const r = parseThemeSeed(exportThemeSeed('Magenta', { ...SAFE_SEED, primaryHue: 320, accentHue: 300 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const audit = auditPalette(paletteFromSeedExport(r.seed));
    expect(audit.every((row) => row.pass)).toBe(true);
  });
});
