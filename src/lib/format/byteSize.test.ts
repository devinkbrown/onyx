// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatBytes } from './byteSize';

describe('formatBytes', () => {
  it('formats zero and byte values without fractional digits', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1023, { binary: true })).toBe('1023 B');
  });

  it('guards negative and non-finite byte counts', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatBytes(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('uses decimal units by default at 1000-byte boundaries', () => {
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1_500)).toBe('1.5 KB');
    expect(formatBytes(1_000_000)).toBe('1 MB');
  });

  it('uses binary units at 1024-byte boundaries when requested', () => {
    expect(formatBytes(1000, { binary: true })).toBe('1000 B');
    expect(formatBytes(1024, { binary: true })).toBe('1 KiB');
    expect(formatBytes(1536, { binary: true })).toBe('1.5 KiB');
    expect(formatBytes(1_048_576, { binary: true })).toBe('1 MiB');
  });

  it('formats every decimal unit step through exabytes', () => {
    expect([
      formatBytes(1_000),
      formatBytes(1_000_000),
      formatBytes(1_000_000_000),
      formatBytes(1_000_000_000_000),
      formatBytes(1_000_000_000_000_000),
      formatBytes(1_000_000_000_000_000_000),
    ]).toEqual(['1 KB', '1 MB', '1 GB', '1 TB', '1 PB', '1 EB']);
  });

  it('formats every binary unit step through exbibytes', () => {
    expect([
      formatBytes(1024, { binary: true }),
      formatBytes(1024 ** 2, { binary: true }),
      formatBytes(1024 ** 3, { binary: true }),
      formatBytes(1024 ** 4, { binary: true }),
      formatBytes(1024 ** 5, { binary: true }),
      formatBytes(1024 ** 6, { binary: true }),
    ]).toEqual(['1 KiB', '1 MiB', '1 GiB', '1 TiB', '1 PiB', '1 EiB']);
  });

  it('rounds to the requested precision and trims trailing zeroes', () => {
    expect(formatBytes(1_234_567, { precision: 2 })).toBe('1.23 MB');
    expect(formatBytes(1_250_000, { precision: 1 })).toBe('1.3 MB');
    expect(formatBytes(1_200_000, { precision: 3 })).toBe('1.2 MB');
    expect(formatBytes(1_500, { precision: 0 })).toBe('2 KB');
  });

  it('normalizes unsafe precision values instead of throwing', () => {
    expect(formatBytes(1_500, { precision: -2 })).toBe('2 KB');
    expect(formatBytes(1_500, { precision: Number.NaN })).toBe('1.5 KB');
    expect(formatBytes(1_500, { precision: 2.9 })).toBe('1.5 KB');
  });

  it('caps excessive precision and treats negative zero as zero bytes', () => {
    // Arrange
    const bytes = 1_234;

    // Act
    const excessivePrecision = formatBytes(bytes, { precision: 99 });
    const negativeZero = formatBytes(-0);

    // Assert
    expect(excessivePrecision).toBe('1.234 KB');
    expect(negativeZero).toBe('0 B');
  });

  it('keeps huge values deterministic at the largest supported unit', () => {
    expect(formatBytes(1_000_000_000_000_000_000_000)).toBe('1000 EB');
    expect(formatBytes(1024 ** 7, { binary: true })).toBe('1024 EiB');
  });
});
