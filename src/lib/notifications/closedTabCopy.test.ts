// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { MINIMAL_HOST_CAPABILITIES } from '@/lib/platform';

import {
  CLOSED_TAB_KIND_COPY,
  closedTabStatusCopy,
  hostCannotNotifyNatively,
  hostNotifyHonesty,
} from './closedTabCopy';

describe('closed-tab notification copy', () => {
  it('names mentions, DMs, and calls without E2EE or vendor claims', () => {
    const joined = `${CLOSED_TAB_KIND_COPY.mention.body} ${CLOSED_TAB_KIND_COPY.dm.body} ${CLOSED_TAB_KIND_COPY.call.body}`;
    expect(CLOSED_TAB_KIND_COPY.mention.title).toBe('Mentions');
    expect(CLOSED_TAB_KIND_COPY.dm.title).toBe('DMs');
    expect(CLOSED_TAB_KIND_COPY.call.title).toBe('Calls');
    expect(joined).not.toMatch(/e2ee|end-to-end|onesignal|fcm|firebase|pusher/i);
    expect(CLOSED_TAB_KIND_COPY.call.body).toMatch(/starts a call/i);
  });

  it('never claims native host notifications when the flag is false', () => {
    expect(hostCannotNotifyNatively('zig-desktop', MINIMAL_HOST_CAPABILITIES)).toBe(true);
    expect(hostNotifyHonesty({
      surface: 'zig-desktop',
      capabilities: { notifications: false },
    })).toEqual({
      canClaimNativeHost: false,
      notice: expect.stringMatching(/cannot show system notifications/i),
    });
    expect(hostNotifyHonesty({
      surface: 'zig-desktop',
      capabilities: { notifications: true },
    })).toEqual({ canClaimNativeHost: true, notice: null });
    expect(hostNotifyHonesty({
      surface: 'browser',
      capabilities: { notifications: false },
    })).toEqual({ canClaimNativeHost: false, notice: null });
  });

  it('explains closed-tab status without inventing a push vendor', () => {
    expect(closedTabStatusCopy({
      permission: 'default',
      webPushOn: false,
      signedIn: true,
      webPushSupported: true,
      hostNotice: null,
    })).toMatch(/mentions, DMs, and calls/i);

    expect(closedTabStatusCopy({
      permission: 'granted',
      webPushOn: true,
      signedIn: true,
      webPushSupported: true,
      hostNotice: null,
    })).toMatch(/when the tab is closed/i);

    expect(closedTabStatusCopy({
      permission: 'default',
      webPushOn: false,
      signedIn: false,
      webPushSupported: true,
      hostNotice: null,
    })).toMatch(/signed-in account/i);

    const host = 'This desktop app cannot show system notifications yet.';
    expect(closedTabStatusCopy({
      permission: 'default',
      webPushOn: false,
      signedIn: true,
      webPushSupported: true,
      hostNotice: host,
    })).toBe(host);
  });
});
