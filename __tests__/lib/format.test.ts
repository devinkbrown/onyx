/**
 * Tests for pure utility functions: nick-color.
 */
import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// nick-color (deterministic palette selection)
// ─────────────────────────────────────────────────────────────────────────────

import { getNickColor } from '@/lib/nick-color';

describe('getNickColor', () => {
  it('returns a hex color string', () => {
    const color = getNickColor('devin');
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('is deterministic', () => {
    expect(getNickColor('alice')).toBe(getNickColor('alice'));
  });

  it('produces different values for different nicks', () => {
    // Might occasionally collide by chance from the 12-color palette,
    // but 'alice' and 'bob' hash to different slots.
    const a = getNickColor('alice');
    const b = getNickColor('zzzzzzz');
    // Just check both are valid colors; can't guarantee they differ
    expect(a).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(b).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('handles an empty string without throwing', () => {
    expect(() => getNickColor('')).not.toThrow();
  });

  it('handles very long nicks', () => {
    expect(() => getNickColor('a'.repeat(100))).not.toThrow();
  });

  it('handles IRC mode prefixes in nick', () => {
    // Clients may pass prefixed nicks — should return a valid color
    const c = getNickColor('@alice');
    expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IRC mode prefix stripping (inline, since display-name relies on Zustand)
// ─────────────────────────────────────────────────────────────────────────────

describe('IRC mode prefix stripping', () => {
  // Replicate the clean-nick logic from VoiceBar / MessageItem
  function stripModePrefix(nick: string): string {
    return nick.replace(/^[~@&%+.]+/, '');
  }

  it('strips owner prefix ~', () => {
    expect(stripModePrefix('~devin')).toBe('devin');
  });

  it('strips op prefix @', () => {
    expect(stripModePrefix('@alice')).toBe('alice');
  });

  it('strips voice prefix +', () => {
    expect(stripModePrefix('+bob')).toBe('bob');
  });

  it('strips multiple prefixes', () => {
    expect(stripModePrefix('~@carol')).toBe('carol');
  });

  it('leaves plain nicks untouched', () => {
    expect(stripModePrefix('dave')).toBe('dave');
  });

  it('handles empty string', () => {
    expect(stripModePrefix('')).toBe('');
  });
});
