// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatBytes } from './byteSize';
import { countLabel } from './countLabel';
import { formatDuration } from './duration';

describe('format helper adversarial contracts', () => {
  describe('formatDuration', () => {
    it('floors fractional millisecond inputs before crossing unit boundaries', () => {
      expect(formatDuration(1_000.999, { maxUnits: 5 })).toBe('1s');
      expect(formatDuration(60_000 - 0.001, { maxUnits: 5 })).toBe('59s');
      expect(formatDuration(3_600_000 - 0.001, { maxUnits: 5 })).toBe('59m 59s');
      expect(formatDuration(86_400_000 - 0.001, { maxUnits: 5 })).toBe('23h 59m 59s');
      expect(formatDuration(604_800_000 - 0.001, { maxUnits: 5 })).toBe('6d 23h 59m 59s');
    });

    it('keeps zero and negative fractional inputs pinned to zero labels', () => {
      expect(formatDuration(0, { compact: false })).toBe('0 seconds');
      expect(formatDuration(-0.001)).toBe('0s');
      expect(formatDuration(-Number.MAX_SAFE_INTEGER, { compact: false })).toBe('0 seconds');
    });

    it('formats very large finite inputs without overflowing the supported unit chain', () => {
      expect(formatDuration(Number.MAX_SAFE_INTEGER, { maxUnits: 5 })).toBe('14892855w 6d 8h 59m');
    });
  });

  describe('formatBytes', () => {
    it('rounds fractional byte counts only while still in the byte unit', () => {
      expect(formatBytes(0.49)).toBe('0 B');
      expect(formatBytes(0.5)).toBe('1 B');
      expect(formatBytes(999.49)).toBe('999 B');
      expect(formatBytes(999.4)).toBe('999 B');
    });

    it('rejects negative fractional byte counts while accepting signed zero', () => {
      expect(formatBytes(-Number.MIN_VALUE)).toBe('—');
      expect(formatBytes(-0)).toBe('0 B');
    });

    it('carries rounded boundary values into the next decimal or binary unit', () => {
      expect(formatBytes(999_950, { precision: 1 })).toBe('1 MB');
      expect(formatBytes(1024 ** 2 - 1, { binary: true, precision: 0 })).toBe('1 MiB');
    });

    it('normalizes fractional and infinite precision values deterministically', () => {
      expect(formatBytes(1_234_567, { precision: 2.99 })).toBe('1.23 MB');
      expect(formatBytes(1_234_567, { precision: Number.NEGATIVE_INFINITY })).toBe('1.2 MB');
      expect(formatBytes(Number.MAX_SAFE_INTEGER, { precision: 3 })).toBe('9.007 PB');
    });
  });

  describe('countLabel', () => {
    it('pluralizes every numeric value except exactly positive one', () => {
      expect(countLabel(0, 'byte')).toBe('0 bytes');
      expect(countLabel(-1, 'byte')).toBe('-1 bytes');
      expect(countLabel(1 - Number.EPSILON, 'byte')).toBe('0.9999999999999998 bytes');
      expect(countLabel(1, 'byte')).toBe('1 byte');
      expect(countLabel(1 + Number.EPSILON, 'byte')).toBe('1.0000000000000002 bytes');
    });

    it('does not collapse huge or tiny counts before label assembly', () => {
      expect(countLabel(Number.MAX_SAFE_INTEGER, 'sample')).toBe('9007199254740991 samples');
      expect(countLabel(Number.MIN_VALUE, 'sample')).toBe('5e-324 samples');
    });
  });
});
