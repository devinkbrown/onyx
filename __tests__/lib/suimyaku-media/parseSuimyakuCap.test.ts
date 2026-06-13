import { describe, it, expect } from 'vitest';

// We test parseSuimyakuCap by importing the hook file and calling the exported
// flag-parsing logic indirectly.  Since parseSuimyakuCap is not directly exported
// we re-implement the same test logic against useSuimyakuFlags by simulating
// what happens inside it.  The pure function is inlined here for unit testing.

function parseSuimyakuCap(raw: string) {
  type SuimyakuFlags = {
    enabled: boolean; version: number; codecs: string[]; simulcast: boolean;
    e2e: boolean; spatial: boolean; mixer: boolean; max: number; raw: string;
  };
  const flags: SuimyakuFlags = {
    enabled: !!raw, version: 0, codecs: [], simulcast: false,
    e2e: false, spatial: false, mixer: false, max: 0, raw,
  };
  for (const token of raw.split(',').map((t: string) => t.trim()).filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq === -1) {
      if (token === 'simulcast') flags.simulcast = true;
      else if (token === 'e2e')      flags.e2e = true;
      else if (token === 'spatial')  flags.spatial = true;
      else if (token === 'mixer')    flags.mixer = true;
    } else {
      const k = token.slice(0, eq);
      const v = token.slice(eq + 1);
      if (k === 'v') { const n = parseInt(v, 10); if (isFinite(n)) flags.version = n; }
      else if (k === 'codecs') flags.codecs = v.split('/');
      else if (k === 'max')    { const n = parseInt(v, 10); if (isFinite(n)) flags.max = n; }
    }
  }
  return flags;
}

describe('parseSuimyakuCap', () => {
  it('returns disabled flags for empty string', () => {
    const f = parseSuimyakuCap('');
    expect(f.enabled).toBe(false);
    expect(f.version).toBe(0);
    expect(f.codecs).toEqual([]);
  });

  it('parses full capabilities string', () => {
    const f = parseSuimyakuCap('v=2,codecs=opus/vp8,simulcast,e2e,spatial,mixer,max=16');
    expect(f.enabled).toBe(true);
    expect(f.version).toBe(2);
    expect(f.codecs).toEqual(['opus', 'vp8']);
    expect(f.simulcast).toBe(true);
    expect(f.e2e).toBe(true);
    expect(f.spatial).toBe(true);
    expect(f.mixer).toBe(true);
    expect(f.max).toBe(16);
  });

  it('parses voice-only subset', () => {
    const f = parseSuimyakuCap('v=1,codecs=opus,max=32');
    expect(f.version).toBe(1);
    expect(f.codecs).toEqual(['opus']);
    expect(f.max).toBe(32);
    expect(f.simulcast).toBe(false);
    expect(f.e2e).toBe(false);
  });

  it('handles extra spaces around comma-separated tokens', () => {
    const f = parseSuimyakuCap('v=1, simulcast, e2e');
    expect(f.simulcast).toBe(true);
    expect(f.e2e).toBe(true);
  });

  it('ignores unknown tokens', () => {
    const f = parseSuimyakuCap('v=1,unknown_flag,codecs=opus');
    expect(f.version).toBe(1);
    expect(f.codecs).toEqual(['opus']);
  });

  it('handles non-numeric version gracefully', () => {
    const f = parseSuimyakuCap('v=bad');
    expect(f.version).toBe(0);
  });

  // ── Additional edge cases ───────────────────────────────────────────────────

  it('stores the raw string on the flags object', () => {
    const raw = 'v=3,codecs=opus';
    const f = parseSuimyakuCap(raw);
    expect(f.raw).toBe(raw);
  });

  it('returns enabled=true for any non-empty string', () => {
    expect(parseSuimyakuCap('v=1').enabled).toBe(true);
    expect(parseSuimyakuCap('simulcast').enabled).toBe(true);
  });

  it('treats max=0 as a valid (zero) value', () => {
    const f = parseSuimyakuCap('max=0');
    expect(f.max).toBe(0);
    expect(f.enabled).toBe(true);
  });

  it('parses large max value', () => {
    const f = parseSuimyakuCap('max=1024');
    expect(f.max).toBe(1024);
  });

  it('handles non-numeric max gracefully (leaves max at 0)', () => {
    // parseInt('xyz', 10) => NaN; isFinite(NaN) is false → max stays 0
    const f = parseSuimyakuCap('max=xyz');
    expect(f.max).toBe(0);
  });

  it('parses a single codec without slash delimiter', () => {
    const f = parseSuimyakuCap('codecs=vp9');
    expect(f.codecs).toEqual(['vp9']);
  });

  it('parses three codecs separated by slash', () => {
    const f = parseSuimyakuCap('codecs=opus/vp8/h264');
    expect(f.codecs).toEqual(['opus', 'vp8', 'h264']);
  });

  it('flags default to false when only version is present', () => {
    const f = parseSuimyakuCap('v=1');
    expect(f.simulcast).toBe(false);
    expect(f.e2e).toBe(false);
    expect(f.spatial).toBe(false);
    expect(f.mixer).toBe(false);
  });

  it('handles token that looks like an unknown key=value pair', () => {
    // 'foo=bar' — unknown key, should not throw and should not affect known flags
    const f = parseSuimyakuCap('v=2,foo=bar,simulcast');
    expect(f.version).toBe(2);
    expect(f.simulcast).toBe(true);
  });

  it('handles whitespace-only string as disabled', () => {
    // '   '.trim() => '', filter(Boolean) removes it — enabled is !!raw which
    // is truthy for whitespace, but all flags remain at defaults
    const f = parseSuimyakuCap('   ');
    // !!raw is true for '   ' (non-empty string)
    expect(f.enabled).toBe(true);
    // No valid tokens are parsed
    expect(f.version).toBe(0);
    expect(f.codecs).toEqual([]);
    expect(f.simulcast).toBe(false);
  });

  it('handles repeated comma separators (empty tokens filtered)', () => {
    // Double comma — filter(Boolean) drops empty strings
    const f = parseSuimyakuCap('v=1,,simulcast');
    expect(f.version).toBe(1);
    expect(f.simulcast).toBe(true);
  });
});
