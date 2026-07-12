// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { countLabel } from './countLabel';

describe('countLabel', () => {
  it('uses the singular noun for exactly one item', () => {
    const count = 1;

    const label = countLabel(count, 'message');

    expect(label).toBe('1 message');
    expect(countLabel(1.0, 'channel')).toBe('1 channel');
  });

  it('uses the plural noun for zero items', () => {
    const count = 0;

    const label = countLabel(count, 'reply');

    expect(label).toBe('0 replys');
    expect(countLabel(-0, 'reply')).toBe('0 replys');
  });

  it('uses the plural noun for counts other than one', () => {
    const counts = [2, -1, -1.5, 1.5];

    const labels = counts.map((count) => countLabel(count, 'event'));

    expect(labels).toEqual(['2 events', '-1 events', '-1.5 events', '1.5 events']);
  });

  it('keeps large numbers intact while pluralizing', () => {
    const count = 1_000_000;

    const label = countLabel(count, 'member');

    expect(label).toBe('1000000 members');
    expect(countLabel(Number.MAX_SAFE_INTEGER, 'member')).toBe('9007199254740991 members');
    expect(countLabel(Number.MIN_SAFE_INTEGER, 'member')).toBe('-9007199254740991 members');
  });

  it('stringifies non-finite counts and pluralizes them', () => {
    const counts = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    const labels = counts.map((count) => countLabel(count, 'notification'));

    expect(labels).toEqual(['NaN notifications', 'Infinity notifications', '-Infinity notifications']);
  });

  it('preserves an empty noun while still rendering the count', () => {
    const count = 0;

    const label = countLabel(count, '');

    expect(label).toBe('0 s');
  });

  it('appends a simple s even when the singular already has a suffix', () => {
    expect(countLabel(2, 'class')).toBe('2 classs');
    expect(countLabel(0, 'status')).toBe('0 statuss');
  });

  it('pluralizes signed zero and numeric wrappers as non-singular counts', () => {
    // Arrange
    const counts = [-0, Number('1'), Number('1.0001')];

    // Act
    const labels = counts.map((count) => countLabel(count, 'alert'));

    // Assert
    expect(labels).toEqual(['0 alerts', '1 alert', '1.0001 alerts']);
  });
});
