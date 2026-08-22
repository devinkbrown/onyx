// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildRoomCallInviteUrl, roomCallInviteOrigin } from './roomCallInvite';

describe('roomCallInvite', () => {
  it('reuses the room invite link — no call-only protocol param', () => {
    const url = buildRoomCallInviteUrl({
      channel: '#general',
      origin: 'https://eshmaki.me',
      network: 'Onyx',
    });
    expect(url).toContain('/invite/');
    expect(url).toContain('join=%23general');
    expect(url).not.toMatch(/call=|media=|cadence/i);
  });

  it('builds the same invite origin ChannelSettings uses', () => {
    expect(roomCallInviteOrigin('https://eshmaki.me/')).toBe('https://eshmaki.me/invite/');
  });
});
