import { describe, expect, it } from 'vitest';
import { countLabel } from './countLabel';

describe('countLabel', () => {
  it('uses the singular noun for exactly one item', () => {
    const count = 1;

    const label = countLabel(count, 'message');

    expect(label).toBe('1 message');
  });

  it('uses the plural noun for zero items', () => {
    const count = 0;

    const label = countLabel(count, 'reply');

    expect(label).toBe('0 replys');
  });

  it('uses the plural noun for counts other than one', () => {
    const counts = [2, -1, 1.5];

    const labels = counts.map((count) => countLabel(count, 'event'));

    expect(labels).toEqual(['2 events', '-1 events', '1.5 events']);
  });

  it('keeps large numbers intact while pluralizing', () => {
    const count = 1_000_000;

    const label = countLabel(count, 'member');

    expect(label).toBe('1000000 members');
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
});
