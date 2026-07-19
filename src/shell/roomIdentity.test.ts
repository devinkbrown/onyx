// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { channelIdentityTarget, normalizeRoomTarget, roomIdentityForTarget } from './roomIdentity';

describe('roomIdentity', () => {
  it('normalizes channel targets only into bounded identity targets', () => {
    expect(normalizeRoomTarget(' Root ')).toBe('#root');
    expect(normalizeRoomTarget('#Root')).toBe('#root');
    expect(normalizeRoomTarget('&Ops')).toBe('&ops');
    expect(normalizeRoomTarget('')).toBeNull();
    expect(channelIdentityTarget({ kind: 'channel', channel: '#General' })).toBe('#general');
    expect(channelIdentityTarget({ kind: 'channel', channel: '&Ops' })).toBe('&ops');
    expect(channelIdentityTarget({ kind: 'home' })).toBeNull();
    expect(channelIdentityTarget({ kind: 'dm', nick: 'kain' })).toBeNull();
  });

  it('does not rewrite a local & room into a #& hybrid', () => {
    const identity = roomIdentityForTarget('&ops');
    expect(identity?.target).toBe('&ops');
    expect(identity?.target.startsWith('#&')).toBe(false);
  });

  it('generates stable OKLCH tokens for a room', () => {
    const first = roomIdentityForTarget('#root');
    const second = roomIdentityForTarget('#root');

    expect(first).toEqual(second);
    expect(first?.target).toBe('#root');
    expect(first?.accent).toMatch(/^oklch\(0\.72 0\.16 \d+\)$/);
    expect(first?.accentStrong).toMatch(/^oklch\(0\.82 0\.18 \d+\)$/);
    expect(first?.accentSoft).toMatch(/^oklch\(0\.42 0\.08 \d+ \/ 0\.28\)$/);
    expect(first?.border).toMatch(/^oklch\(0\.70 0\.12 \d+ \/ 0\.40\)$/);
    expect(first?.wash).toMatch(/^oklch\(0\.34 0\.07 \d+ \/ 0\.20\)$/);
  });

  it('varies accents across different room names without accepting CSS input', () => {
    const root = roomIdentityForTarget('#root');
    const randomCss = roomIdentityForTarget('#root; background: red');

    expect(root?.hue).not.toBe(randomCss?.hue);
    expect(randomCss?.accent).not.toContain('background');
  });
});
