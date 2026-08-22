// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRoomSharePayload, canNativeShare, inviteLandingOrigin } from './shareRoomInvite';

describe('buildRoomSharePayload', () => {
  it('builds a room link in the existing /invite/?join= format', () => {
    const payload = buildRoomSharePayload({
      channel: '#lounge',
      network: 'Onyx',
      origin: 'https://eshmaki.me/invite/',
    });

    expect(payload.link.hasChannel).toBe(true);
    expect(payload.shareUrl).toBe('https://eshmaki.me/invite/?join=%23lounge');
    expect(payload.link.appHref).toBe('/app/?join=%23lounge');
    expect(payload.shareData.title).toBe('Join #lounge on Onyx');
    expect(payload.shareData.text).toBe('A friend invited you to #lounge on Onyx.');
    expect(payload.shareData.url).toBe(payload.shareUrl);
  });

  it('degrades to a network invite when the room is missing', () => {
    const payload = buildRoomSharePayload({
      channel: '',
      network: 'Onyx',
      origin: 'https://eshmaki.me/invite/',
    });

    expect(payload.link.hasChannel).toBe(false);
    expect(payload.shareUrl).toBe('https://eshmaki.me/invite/');
    expect(payload.shareData.title).toBe('Join Onyx');
    expect(payload.shareData.text).toBe('A friend invited you to Onyx.');
  });
});

describe('inviteLandingOrigin', () => {
  it('uses the current origin when window is available', () => {
    expect(inviteLandingOrigin()).toBe(`${window.location.origin}/invite/`);
  });
});

describe('canNativeShare', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false when the browser has no share sheet', () => {
    vi.stubGlobal('navigator', { ...navigator, share: undefined, canShare: undefined });
    expect(canNativeShare({ title: 'Join Onyx', url: 'https://eshmaki.me/invite/' })).toBe(false);
  });

  it('is true when the browser accepts the invite payload', () => {
    const canShare = vi.fn(() => true);
    vi.stubGlobal('navigator', {
      ...navigator,
      share: vi.fn(),
      canShare,
    });
    const data = { title: 'Join #lounge on Onyx', url: 'https://eshmaki.me/invite/?join=%23lounge' };
    expect(canNativeShare(data)).toBe(true);
    expect(canShare).toHaveBeenCalledWith(data);
  });
});
