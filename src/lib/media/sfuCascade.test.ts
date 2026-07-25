// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  sfuCascadeFromLive,
  sfuCascadeLiveInput,
  sfuCascadeView,
} from './sfuCascade';

describe('sfuCascade (C8 UX)', () => {
  it('labels local vs cascade vs degraded', () => {
    expect(sfuCascadeView({ localSfu: true, remoteForwarders: 0 }).mode).toBe('local');
    expect(sfuCascadeView({ remoteForwarders: 2 }).label).toContain('3 hops');
    expect(sfuCascadeView({ remoteForwarders: 1, packetLoss: 0.2 }).mode).toBe('degraded');
    expect(sfuCascadeView({ known: false }).mode).toBe('unknown');
  });

  it('maps live metrics without inventing cascade hops', () => {
    expect(sfuCascadeLiveInput({ inCall: false }).known).toBe(false);

    expect(sfuCascadeLiveInput({
      inCall: true,
      engineReady: false,
      roomStatsSeen: false,
    }).known).toBe(false);

    // Engine sampling mid-call → honest local path until topology advertises cascade.
    expect(sfuCascadeLiveInput({
      inCall: true,
      engineReady: true,
      packetLoss: 0.02,
    })).toEqual({
      known: true,
      localSfu: true,
      remoteForwarders: 0,
      packetLoss: 0.02,
    });

    // Explicit remote forwarders from room STATS win.
    expect(sfuCascadeLiveInput({
      inCall: true,
      engineReady: true,
      packetLoss: 0.01,
      remoteForwarders: 2,
      roomStatsSeen: true,
    })).toEqual({
      known: true,
      localSfu: false,
      remoteForwarders: 2,
      packetLoss: 0.01,
    });

    // Explicit local_sfu advertisement without engine sample.
    expect(sfuCascadeLiveInput({
      inCall: true,
      localSfu: true,
      roomStatsSeen: true,
    }).localSfu).toBe(true);

    // Room STATS alone (no engine sample yet) still confirms local path.
    expect(sfuCascadeLiveInput({
      inCall: true,
      roomStatsSeen: true,
    })).toMatchObject({ known: true, localSfu: true, remoteForwarders: 0 });
  });

  it('clamps loss and floors forwarders from live metrics', () => {
    const input = sfuCascadeLiveInput({
      inCall: true,
      engineReady: true,
      packetLoss: 1.5,
      remoteForwarders: 2.9,
    });
    expect(input.packetLoss).toBe(1);
    expect(input.remoteForwarders).toBe(2);

    expect(sfuCascadeLiveInput({
      inCall: true,
      engineReady: true,
      packetLoss: -0.1,
      remoteForwarders: -3,
    })).toEqual({
      known: true,
      localSfu: true,
      remoteForwarders: 0,
      packetLoss: 0,
    });
  });

  it('sfuCascadeFromLive composes view + live inputs', () => {
    const cascade = sfuCascadeFromLive({
      inCall: true,
      engineReady: true,
      remoteForwarders: 1,
      packetLoss: 0.01,
    });
    expect(cascade.mode).toBe('cascade');
    expect(cascade.hops).toBe(2);

    const degraded = sfuCascadeFromLive({
      inCall: true,
      engineReady: true,
      remoteForwarders: 1,
      packetLoss: 0.2,
    });
    expect(degraded.mode).toBe('degraded');

    const unknown = sfuCascadeFromLive({ inCall: false });
    expect(unknown.mode).toBe('unknown');
  });
});
