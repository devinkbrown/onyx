// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('clamps zero, negative, and sub-second durations to zero seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-1)).toBe('0s');
    expect(formatDuration(-60_000)).toBe('0s');
    expect(formatDuration(999)).toBe('0s');
  });

  it('guards non-finite durations', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('formats second, minute, and hour boundaries', () => {
    expect(formatDuration(1_000)).toBe('1s');
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(3_599_000)).toBe('59m 59s');
    expect(formatDuration(3_600_000)).toBe('1h');
  });

  it('formats each supported unit', () => {
    expect(formatDuration(1_000)).toBe('1s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(86_400_000)).toBe('1d');
    expect(formatDuration(604_800_000)).toBe('1w');
  });

  it('uses the two largest non-zero units by default', () => {
    expect(formatDuration(63 * 60_000)).toBe('1h 3m');
    expect(formatDuration((2 * 86_400 + 4 * 3_600 + 19 * 60 + 8) * 1_000)).toBe('2d 4h');
    expect(formatDuration((3 * 604_800 + 2 * 86_400 + 5 * 3_600) * 1_000)).toBe('3w 2d');
  });

  it('supports a maxUnits cap', () => {
    const duration = (2 * 86_400 + 4 * 3_600 + 19 * 60 + 8) * 1_000;

    expect(formatDuration(duration, { maxUnits: 1 })).toBe('2d');
    expect(formatDuration(duration, { maxUnits: 2 })).toBe('2d 4h');
    expect(formatDuration(duration, { maxUnits: 3 })).toBe('2d 4h 19m');
    expect(formatDuration(duration, { maxUnits: 99 })).toBe('2d 4h 19m 8s');
  });

  it('normalizes unsafe maxUnits values', () => {
    const duration = (3_600 + 30 * 60) * 1_000;

    expect(formatDuration(duration, { maxUnits: 0 })).toBe('1h');
    expect(formatDuration(duration, { maxUnits: -2 })).toBe('1h');
    expect(formatDuration(duration, { maxUnits: Number.NaN })).toBe('1h 30m');
    expect(formatDuration(duration, { maxUnits: 1.9 })).toBe('1h');
  });

  it('normalizes infinite maxUnits to the default unit count', () => {
    // Arrange
    const duration = (2 * 604_800 + 3 * 86_400 + 4 * 3_600) * 1_000;

    // Act
    const label = formatDuration(duration, { maxUnits: Number.POSITIVE_INFINITY });

    // Assert
    expect(label).toBe('2w 3d');
  });

  it('formats compact and full labels', () => {
    expect(formatDuration(1_000, { compact: true })).toBe('1s');
    expect(formatDuration(1_000, { compact: false })).toBe('1 second');
    expect(formatDuration(2_000, { compact: false })).toBe('2 seconds');
    expect(formatDuration(62_000, { compact: false })).toBe('1 minute 2 seconds');
  });

  it('floors fractional seconds deterministically', () => {
    expect(formatDuration(1_499)).toBe('1s');
    expect(formatDuration(1_999)).toBe('1s');
    expect(formatDuration(60_999)).toBe('1m');
  });

  it('renders sub-second full labels as zero seconds', () => {
    // Arrange
    const duration = 999;

    // Act
    const label = formatDuration(duration, { compact: false });

    // Assert
    expect(label).toBe('0 seconds');
  });

  it('keeps huge durations deterministic at week scale', () => {
    expect(formatDuration((1_000 * 604_800 + 6 * 86_400 + 23 * 3_600 + 59 * 60 + 59) * 1_000)).toBe('1000w 6d');
    expect(formatDuration((1_000 * 604_800 + 6 * 86_400 + 23 * 3_600 + 59 * 60 + 59) * 1_000, {
      maxUnits: 5,
    })).toBe('1000w 6d 23h 59m 59s');
  });
});
