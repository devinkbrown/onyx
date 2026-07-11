// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { createEpochMemo } from './theme-epoch';
import { computeBackgroundTheme } from './variants/utils';

describe('createEpochMemo', () => {
  it('computes once and reuses the cache while the epoch is unchanged', () => {
    // Arrange
    const compute = vi.fn(() => ({ token: 1 }));
    const epoch = 0; // never advances — the steady-state per-frame case
    const read = createEpochMemo(compute, () => epoch);

    // Act — three reads without advancing the epoch (the per-frame case).
    const first = read();
    const second = read();
    const third = read();

    // Assert — one computation, and the same object handed back every time.
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('recomputes exactly once after the epoch advances (a theme switch)', () => {
    // Arrange
    const compute = vi.fn(() => ({}));
    let epoch = 0;
    const read = createEpochMemo(compute, () => epoch);

    // Act
    read();
    read();
    epoch += 1; // engine bumps the epoch on a theme mutation
    const afterBump = read();
    read();

    // Assert — one recompute for the new epoch, then cached again.
    expect(compute).toHaveBeenCalledTimes(2);
    expect(read()).toBe(afterBump);
  });

  it('caches falsy and undefined values without re-running compute', () => {
    // Arrange — a naive `cached ?? recompute` cache would recompute forever here.
    const compute = vi.fn(() => undefined);
    const read = createEpochMemo(compute, () => 7);

    // Act
    read();
    read();

    // Assert
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe('computeBackgroundTheme', () => {
  it('maps resolved tokens through the reader and keeps defaults for empty ones', () => {
    // Arrange — only override ink; everything else the reader returns empty.
    const read = (name: string) => (name === '--ink' ? ' #101820 ' : '');

    // Act
    const theme = computeBackgroundTheme(read);

    // Assert — overridden token wins (and is trimmed); a blank token keeps the fallback.
    expect(theme.ink).toBe('#101820');
    expect(theme.lapis).toBe('#2f5bf0');
  });

  it('does not read from the DOM (pure token projection)', () => {
    // Arrange
    const seen: string[] = [];
    const read = (name: string) => {
      seen.push(name);
      return '';
    };

    // Act
    computeBackgroundTheme(read);

    // Assert — every token name flowed through the injected reader, nothing else.
    expect(seen).toContain('--ink');
    expect(seen).toContain('--washi-mute');
    expect(seen.length).toBeGreaterThan(0);
  });
});
