// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';

import {
  buildGroupControlLine,
  MAX_GROUP_CONTROL_PAYLOAD,
  parseGroupControlMessage,
} from './groupControl';

describe('groupControl', () => {
  it('round-trips a canonical commit without opening the payload', () => {
    const line = buildGroupControlLine({
      channel: '#root',
      kind: 'commit',
      fromDevice: 'laptop.1',
      payload: 'AQIDBA',
    });
    expect(line).toBe('E2EEGROUP #root commit laptop.1 :AQIDBA\r\n');
    expect(parseGroupControlMessage(parseIRCMessage(line!))).toEqual({
      channel: '#root',
      kind: 'commit',
      fromDevice: 'laptop.1',
      payload: 'AQIDBA',
    });
  });

  it('round-trips targeted welcome routing metadata', () => {
    const line = buildGroupControlLine({
      channel: '&staff',
      kind: 'welcome',
      fromDevice: 'desktop',
      toAccount: 'Kain',
      toDevice: 'phone-2',
      payload: 'b3BhcXVl',
    });
    expect(parseGroupControlMessage(parseIRCMessage(line!))).toMatchObject({
      kind: 'welcome',
      toAccount: 'Kain',
      toDevice: 'phone-2',
    });
  });

  it('rejects ambiguous routing, injection, and non-canonical payloads', () => {
    expect(buildGroupControlLine({
      channel: '#root\r\nJOIN #bad',
      kind: 'commit',
      fromDevice: 'phone',
      payload: 'AQ',
    })).toBeNull();
    expect(parseGroupControlMessage(
      parseIRCMessage('E2EEGROUP #root commit phone AQ smuggled'),
    )).toBeNull();
    expect(parseGroupControlMessage(
      parseIRCMessage('E2EEGROUP #root commit phone :A'),
    )).toBeNull();
    expect(buildGroupControlLine({
      channel: '#root',
      kind: 'commit',
      fromDevice: 'phone',
      payload: 'A'.repeat(MAX_GROUP_CONTROL_PAYLOAD + 1),
    })).toBeNull();
    expect(buildGroupControlLine({
      channel: `#${'界'.repeat(43)}`,
      kind: 'commit',
      fromDevice: 'phone',
      payload: 'AQ',
    })).toBeNull();
  });
});
