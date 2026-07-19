// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MAX_LABEL_BYTES,
  MAX_PENDING_LABELED_SENDS,
  _resetLabelCounterForTests,
  isValidLabel,
  nextClientLabel,
} from './labels';

describe('nextClientLabel', () => {
  it('mints unique opaque labels within the IRCv3 64-byte bound', () => {
    _resetLabelCounterForTests();
    const a = nextClientLabel();
    const b = nextClientLabel();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(MAX_LABEL_BYTES);
    expect(b.length).toBeLessThanOrEqual(MAX_LABEL_BYTES);
    expect(isValidLabel(a)).toBe(true);
    expect(isValidLabel(b)).toBe(true);
  });

  it('stays unique and valid across a burst larger than the pending-send bound', () => {
    _resetLabelCounterForTests();
    const seen = new Set<string>();
    for (let i = 0; i < MAX_PENDING_LABELED_SENDS + 8; i++) {
      const label = nextClientLabel();
      expect(isValidLabel(label)).toBe(true);
      expect(seen.has(label)).toBe(false);
      seen.add(label);
    }
  });
});

describe('isValidLabel', () => {
  it('accepts ordinary opaque ids and rejects empty, oversized, or control-bearing values', () => {
    expect(isValidLabel('pQraCjj82e')).toBe(true);
    expect(isValidLabel('o' + 'a'.repeat(MAX_LABEL_BYTES - 1))).toBe(true);
    expect(isValidLabel('')).toBe(false);
    expect(isValidLabel('a'.repeat(MAX_LABEL_BYTES + 1))).toBe(false);
    expect(isValidLabel('bad label')).toBe(false);
    expect(isValidLabel('bad\nlabel')).toBe(false);
    expect(isValidLabel('bad\tlabel')).toBe(false);
    expect(isValidLabel('has\0null')).toBe(false);
  });
});
