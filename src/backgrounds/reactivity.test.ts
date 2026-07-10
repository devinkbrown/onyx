import { describe, expect, it } from 'vitest';
import {
  accentHueDelta,
  ambientRms,
  breathe,
  clamp,
  clamp01,
  hexToHsl,
  hslToHex,
  hueOf,
  lerp,
  normalizeHue,
  parseHex,
  reactiveAccentTint,
  rmsToBloom,
  rotateHue,
  smoothRms,
  TAU,
  timeOfDayWarmth,
  warmthShift,
} from './reactivity';

describe('scalar helpers', () => {
  it('clamps into range and treats NaN as the minimum', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 3, 10)).toBe(3);
  });

  it('clamp01 restricts to the unit interval', () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  it('lerp interpolates and clamps t', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, -1)).toBe(0);
    expect(lerp(0, 10, 5)).toBe(10);
  });
});

describe('breathe', () => {
  it('is deterministic for the same inputs', () => {
    const opts = { freq: 0.0001, phase: 1.2, base: 0.6, depth: 0.4 };
    expect(breathe(12345, opts)).toBe(breathe(12345, opts));
  });

  it('reproduces the open-coded base + sin(t·freq+phase)·depth exactly', () => {
    const time = 8000;
    const freq = 0.0001;
    const phase = 2.4;
    const base = 0.6;
    const depth = 0.4;
    const expected = base + Math.sin(time * freq + phase) * depth;
    expect(breathe(time, { freq, phase, base, depth })).toBeCloseTo(expected, 12);
  });

  it('stays within [base-depth, base+depth]', () => {
    for (let t = 0; t < 100000; t += 137) {
      const v = breathe(t, { freq: 0.0003, base: 0.6, depth: 0.4 });
      expect(v).toBeGreaterThanOrEqual(0.6 - 0.4 - 1e-9);
      expect(v).toBeLessThanOrEqual(0.6 + 0.4 + 1e-9);
    }
  });

  it('applies sensible defaults', () => {
    expect(breathe(0, { freq: 0.001 })).toBeCloseTo(0.6, 12); // sin(0)=0 → base
  });
});

describe('ambientRms', () => {
  it('always stays within [0, 1]', () => {
    for (let t = 0; t < 200000; t += 311) {
      const v = ambientRms(t, t % 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(ambientRms(4242, 1.5)).toBe(ambientRms(4242, 1.5));
  });

  it('varies over time (not flat)', () => {
    const a = ambientRms(0);
    const b = ambientRms(5000);
    expect(a).not.toBeCloseTo(b, 6);
  });
});

describe('smoothRms', () => {
  it('rises fast on attack and relaxes slow on decay', () => {
    const rising = smoothRms(0, 1, 0.5, 0.08);
    const falling = smoothRms(1, 0, 0.5, 0.08);
    expect(rising).toBeCloseTo(0.5, 12); // 0 + (1-0)*0.5
    expect(falling).toBeCloseTo(0.92, 12); // 1 + (0-1)*0.08
  });

  it('is idempotent when the sample equals the previous value', () => {
    expect(smoothRms(0.3, 0.3)).toBeCloseTo(0.3, 12);
  });

  it('keeps output in [0, 1] even with out-of-range inputs', () => {
    expect(smoothRms(-5, 9)).toBeGreaterThanOrEqual(0);
    expect(smoothRms(-5, 9)).toBeLessThanOrEqual(1);
  });

  it('converges toward a held sample under repeated application', () => {
    let v = 0;
    for (let i = 0; i < 50; i += 1) v = smoothRms(v, 0.8, 0.5, 0.08);
    expect(v).toBeCloseTo(0.8, 3);
  });
});

describe('rmsToBloom — legibility cap', () => {
  it('returns base at silence', () => {
    expect(rmsToBloom({ rms: 0, base: 0.6, gain: 0.5 })).toBeCloseTo(0.6, 12);
  });

  it('lifts with rms', () => {
    expect(rmsToBloom({ rms: 0.5, base: 0.6, gain: 0.5 })).toBeCloseTo(0.85, 12);
  });

  it('NEVER exceeds the cap regardless of level', () => {
    for (let rms = 0; rms <= 2; rms += 0.05) {
      const v = rmsToBloom({ rms, base: 0.9, gain: 5, cap: 1 });
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('caps default to 1 so it never exceeds the original hand-tuned brightness', () => {
    expect(rmsToBloom({ rms: 1, base: 1, gain: 1 })).toBe(1);
  });

  it('never returns a negative multiplier', () => {
    expect(rmsToBloom({ rms: -3, base: -1, gain: 1 })).toBe(0);
  });
});

describe('hex parsing and HSL round-trip', () => {
  it('parses 6- and 3-digit hex', () => {
    expect(parseHex('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('rejects malformed input', () => {
    expect(parseHex('ff0000')).toBeNull();
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('#gggggg')).toBeNull();
  });

  it('round-trips primaries through HSL within 1 byte', () => {
    for (const hex of ['#2f5bf0', '#c9a24a', '#e0452f', '#ece4cf', '#18306e']) {
      const hsl = hexToHsl(hex)!;
      const back = parseHex(hslToHex(hsl))!;
      const orig = parseHex(hex)!;
      expect(Math.abs(back.r - orig.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - orig.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - orig.b)).toBeLessThanOrEqual(1);
    }
  });

  it('reports S=0 for greys', () => {
    expect(hexToHsl('#808080')!.s).toBe(0);
  });
});

describe('hue rotation', () => {
  it('normalizeHue wraps into [0, 360)', () => {
    expect(normalizeHue(370)).toBeCloseTo(10, 12);
    expect(normalizeHue(-30)).toBeCloseTo(330, 12);
    expect(normalizeHue(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('hueOf returns the underlying hue', () => {
    expect(hueOf('#ff0000')).toBeCloseTo(0, 6);
    expect(hueOf('#00ff00')).toBeCloseTo(120, 6);
    expect(hueOf('#0000ff')).toBeCloseTo(240, 6);
  });

  it('rotating a colour by 360° is a no-op (within rounding)', () => {
    const rotated = parseHex(rotateHue('#2f5bf0', 360))!;
    const orig = parseHex('#2f5bf0')!;
    expect(Math.abs(rotated.r - orig.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(rotated.g - orig.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(rotated.b - orig.b)).toBeLessThanOrEqual(1);
  });

  it('leaves achromatic colours untouched', () => {
    expect(rotateHue('#808080', 90)).toBe('#808080');
  });

  it('moves the hue by the requested amount', () => {
    const before = hueOf('#00ff00')!; // 120
    const after = hueOf(rotateHue('#00ff00', 40))!;
    expect(normalizeHue(after - before)).toBeCloseTo(40, 4);
  });
});

describe('accentHueDelta', () => {
  it('is signed and takes the shortest path', () => {
    expect(accentHueDelta('#ff0000', '#00ff00')).toBeCloseTo(120, 4); // 0 → 120
    expect(accentHueDelta('#00ff00', '#ff0000')).toBeCloseTo(-120, 4);
  });

  it('wraps around 360 the short way', () => {
    // 350° → 10° should be +20, not -340.
    const a = hslToHex({ h: 350, s: 1, l: 0.5 });
    const b = hslToHex({ h: 10, s: 1, l: 0.5 });
    expect(accentHueDelta(a, b)).toBeCloseTo(20, 2);
  });

  it('returns 0 when either colour is unparseable', () => {
    expect(accentHueDelta('nope', '#ff0000')).toBe(0);
  });
});

describe('reactiveAccentTint — bounded arc', () => {
  const base = '#2f5bf0'; // a lapis-ish blue

  it('never rotates further than maxDegrees toward the accent', () => {
    // A wildly different accent hue; tint must stay within the bounded arc.
    // QUANT: the measured hue can drift ~0.2° from the 8-bit hex round-trip.
    const accent = '#ff8800';
    const tinted = reactiveAccentTint(base, accent, 1, 12);
    const moved = Math.abs(accentHueDelta(base, tinted));
    expect(moved).toBeLessThanOrEqual(12 + 0.25);
  });

  it('scales the rotation by strength', () => {
    const accent = '#ff8800';
    const half = Math.abs(accentHueDelta(base, reactiveAccentTint(base, accent, 0.5, 12)));
    const full = Math.abs(accentHueDelta(base, reactiveAccentTint(base, accent, 1, 12)));
    expect(half).toBeLessThan(full);
    // ~2:1 within hex-quantization slack.
    expect(half).toBeCloseTo(full / 2, 0);
  });

  it('is a near no-op at zero strength', () => {
    const tinted = reactiveAccentTint(base, '#ff8800', 0, 12);
    expect(Math.abs(accentHueDelta(base, tinted))).toBeCloseTo(0, 4);
  });

  it('turns toward the accent, not away from it', () => {
    // accent at higher hue → positive delta → tinted hue should increase
    const accent = hslToHex({ h: hueOf(base)! + 40, s: 0.8, l: 0.5 });
    const tinted = reactiveAccentTint(base, accent, 1, 12);
    expect(accentHueDelta(base, tinted)).toBeGreaterThan(0);
  });
});

describe('timeOfDayWarmth', () => {
  it('peaks warm at ~14:00 and coolest at ~02:00', () => {
    const noon = new Date(2026, 6, 10, 14, 0, 0);
    const night = new Date(2026, 6, 10, 2, 0, 0);
    expect(timeOfDayWarmth(noon)).toBeCloseTo(1, 5);
    expect(timeOfDayWarmth(night)).toBeCloseTo(-1, 5);
  });

  it('stays within [-1, 1] across the whole day', () => {
    for (let h = 0; h < 24; h += 1) {
      const v = timeOfDayWarmth(new Date(2026, 6, 10, h, 30, 0));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is smooth across midnight (no discontinuity)', () => {
    const before = timeOfDayWarmth(new Date(2026, 6, 10, 23, 59, 0));
    const after = timeOfDayWarmth(new Date(2026, 6, 11, 0, 1, 0));
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  it('accepts a millisecond timestamp', () => {
    const ms = new Date(2026, 6, 10, 14, 0, 0).getTime();
    expect(timeOfDayWarmth(ms)).toBeCloseTo(1, 5);
  });
});

describe('warmthShift', () => {
  const accent = '#2f5bf0';

  it('leaves the hue unchanged at zero warmth', () => {
    expect(Math.abs(accentHueDelta(accent, warmthShift(accent, 0, 8)))).toBeCloseTo(0, 4);
  });

  it('warm and cool push opposite directions', () => {
    const warm = accentHueDelta(accent, warmthShift(accent, 1, 8));
    const cool = accentHueDelta(accent, warmthShift(accent, -1, 8));
    expect(Math.sign(warm)).toBe(-Math.sign(cool));
    // ~8° within hex-quantization slack (measured drift ≈ 0.1°).
    expect(Math.abs(warm)).toBeCloseTo(8, 0);
  });

  it('never drifts beyond maxDegrees (plus quantization slack)', () => {
    for (let w = -1; w <= 1; w += 0.1) {
      const moved = Math.abs(accentHueDelta(accent, warmthShift(accent, w, 8)));
      expect(moved).toBeLessThanOrEqual(8 + 0.25);
    }
  });
});

describe('TAU', () => {
  it('equals a full turn', () => {
    expect(TAU).toBeCloseTo(Math.PI * 2, 12);
  });
});
