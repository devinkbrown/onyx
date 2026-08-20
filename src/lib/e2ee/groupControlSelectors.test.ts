// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  selectGroupControlActivation,
  selectGroupControlActivationHeld,
  selectGroupControlLifecycle,
  selectGroupControlQueueDepth,
  selectGroupControlRoom,
  selectGroupControlRoomStatus,
  selectGroupControlRuntime,
  selectGroupControlSessionCount,
} from './groupControlSelectors';
import type { GroupControlRuntimeState } from './groupControlRuntime';

const projection: GroupControlRuntimeState = {
  generation: 4,
  lifecycle: 'ready',
  activation: 'hold',
  identity: {
    clientId: 'client',
    endpoint: 'wss://node.example/irc',
    account: 'alice',
    deviceId: 'phone',
  },
  rooms: [
    { room: '#lobby', status: 'directory-pending', provisioned: false },
  ],
  counters: {
    accepted: 1,
    processed: 0,
    queued: 1,
    applied: 0,
    locked: 0,
    rejected: 0,
    ignored: 0,
    coalesced: 0,
    evicted: 0,
    expired: 0,
  },
  queueDepth: 1,
  sessionCount: 0,
};

describe('group-control safe selectors', () => {
  it('projects only lifecycle, room status, counters, and activation hold', () => {
    expect(selectGroupControlRuntime(projection)).toBe(projection);
    expect(selectGroupControlLifecycle(projection)).toBe('ready');
    expect(selectGroupControlRoom(projection, '#LOBBY')).toMatchObject({
      room: '#lobby',
      status: 'directory-pending',
    });
    expect(selectGroupControlRoomStatus(projection, '#lobby')).toBe('directory-pending');
    expect(selectGroupControlActivation(projection)).toBe('hold');
    expect(selectGroupControlActivationHeld(projection)).toBe(true);
    expect(selectGroupControlQueueDepth(projection)).toBe(1);
    expect(selectGroupControlSessionCount(projection)).toBe(0);
  });

  it('fails closed for absent runtime state', () => {
    expect(selectGroupControlRuntime(null)).toBeNull();
    expect(selectGroupControlLifecycle(null)).toBe('inactive');
    expect(selectGroupControlRoom(null, '#lobby')).toBeNull();
    expect(selectGroupControlRoomStatus(null, '#lobby')).toBeNull();
    expect(selectGroupControlActivation(null)).toBe('hold');
    expect(selectGroupControlActivationHeld(null)).toBe(true);
    expect(selectGroupControlQueueDepth(undefined)).toBe(0);
    expect(selectGroupControlSessionCount(undefined)).toBe(0);
  });

  it('projects an explicitly active runtime without inferring from counters', () => {
    const active = { ...projection, activation: 'active' as const };
    expect(selectGroupControlActivation(active)).toBe('active');
    expect(selectGroupControlActivationHeld(active)).toBe(false);
  });
});
