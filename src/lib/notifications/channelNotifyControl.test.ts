// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * channelNotifyControl.test.ts — pins the pure segment table + keyboard model
 * for the per-channel notification-level control. Pure, DOM-free (AAA).
 */

import { describe, expect, it } from 'vitest';
import type { NotifyMode } from './channelNotifyMode';
import {
  CHANNEL_NOTIFY_OPTIONS,
  channelNotifyIndex,
  nextChannelNotifyIndex,
} from './channelNotifyControl';

describe('CHANNEL_NOTIFY_OPTIONS', () => {
  it('lists all three modes in All → Mentions → Mute order', () => {
    expect(CHANNEL_NOTIFY_OPTIONS.map((o) => o.mode)).toEqual([
      'all',
      'mentions',
      'mute',
    ]);
  });

  it('gives every segment a non-empty compact label and accessible title', () => {
    for (const option of CHANNEL_NOTIFY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.title.length).toBeGreaterThan(0);
    }
  });

  it('labels Mute as hard silence and Mentions only as the middle @ level', () => {
    const mentions = CHANNEL_NOTIFY_OPTIONS.find((option) => option.mode === 'mentions');
    const mute = CHANNEL_NOTIFY_OPTIONS.find((option) => option.mode === 'mute');
    expect(mentions?.title).toMatch(/still badges @/i);
    expect(mute?.title).toMatch(/will not be tapped/i);
  });
});

describe('channelNotifyIndex', () => {
  it('maps each mode to its table position', () => {
    expect(channelNotifyIndex('all')).toBe(0);
    expect(channelNotifyIndex('mentions')).toBe(1);
    expect(channelNotifyIndex('mute')).toBe(2);
  });

  it('defaults an unknown mode to the first (All) segment', () => {
    expect(channelNotifyIndex('bogus' as NotifyMode)).toBe(0);
  });
});

describe('nextChannelNotifyIndex', () => {
  it('advances on ArrowRight and ArrowDown', () => {
    expect(nextChannelNotifyIndex(0, 'ArrowRight')).toBe(1);
    expect(nextChannelNotifyIndex(1, 'ArrowDown')).toBe(2);
  });

  it('retreats on ArrowLeft and ArrowUp', () => {
    expect(nextChannelNotifyIndex(2, 'ArrowLeft')).toBe(1);
    expect(nextChannelNotifyIndex(1, 'ArrowUp')).toBe(0);
  });

  it('wraps forward past the last segment and back before the first', () => {
    expect(nextChannelNotifyIndex(2, 'ArrowRight')).toBe(0);
    expect(nextChannelNotifyIndex(0, 'ArrowLeft')).toBe(2);
  });

  it('jumps to first on Home and last on End', () => {
    expect(nextChannelNotifyIndex(1, 'Home')).toBe(0);
    expect(nextChannelNotifyIndex(1, 'End')).toBe(2);
  });

  it('treats an out-of-range current index as the first segment', () => {
    expect(nextChannelNotifyIndex(-1, 'ArrowRight')).toBe(1);
    expect(nextChannelNotifyIndex(99, 'ArrowLeft')).toBe(2);
  });

  it('returns null for keys that are not navigation keys', () => {
    expect(nextChannelNotifyIndex(0, 'Enter')).toBeNull();
    expect(nextChannelNotifyIndex(0, ' ')).toBeNull();
    expect(nextChannelNotifyIndex(0, 'Tab')).toBeNull();
    expect(nextChannelNotifyIndex(0, 'a')).toBeNull();
  });
});
