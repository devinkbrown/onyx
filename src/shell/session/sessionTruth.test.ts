// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type {
  GroupControlRoomStatus,
  GroupControlRuntimeLifecycle,
  GroupControlRuntimeState,
} from '@/lib/e2ee/groupControlRuntime';

import {
  findSessionTruthFact,
  projectSessionTruth,
  type DmProtectionState,
  type SessionContinuityState,
  type SessionTruthInput,
  type SessionTruthTransportState,
} from './sessionTruth';

const runtime = (
  lifecycle: GroupControlRuntimeLifecycle,
  roomStatus?: GroupControlRoomStatus,
): GroupControlRuntimeState => ({
  generation: 1,
  lifecycle,
  activation: 'hold',
  identity: { clientId: null, endpoint: null, account: null, deviceId: null },
  rooms: roomStatus ? [{ room: '#lobby', status: roomStatus, provisioned: false }] : [],
  counters: {
    accepted: 0,
    processed: 0,
    queued: 0,
    applied: 0,
    locked: 0,
    rejected: 0,
    ignored: 0,
    coalesced: 0,
    evicted: 0,
    expired: 0,
  },
  queueDepth: 0,
  sessionCount: 0,
});

const baseInput = (overrides: Partial<SessionTruthInput> = {}): SessionTruthInput => ({
  transport: 'disconnected',
  authenticatedAccount: null,
  rememberedIdentityAccess: null,
  sessionContinuity: 'none',
  room: '#lobby',
  groupControl: runtime('inactive'),
  dmProtection: 'not-applicable',
  callState: 'idle',
  callStartedAt: null,
  ...overrides,
});

describe('projectSessionTruth', () => {
  it('always emits each authority boundary exactly once and in stable order', () => {
    expect(projectSessionTruth(baseInput()).facts.map((entry) => entry.id)).toEqual([
      'transport',
      'identity',
      'session-continuity',
      'group-control',
      'group-message-protection',
      'dm-protection',
      'call-establishment',
      'call-media-protection',
    ]);
  });

  it('never promotes transport or remembered access into authentication', () => {
    const transports: SessionTruthTransportState[] = [
      'disconnected', 'connecting', 'reconnecting', 'connected', 'error',
    ];
    const remembered = [null, 'resume', 'sign-in', 'identity-only'] as const;
    const continuity: SessionContinuityState[] = ['none', 'resuming', 'resumed', 'failed'];

    for (const transport of transports) {
      for (const rememberedIdentityAccess of remembered) {
        for (const sessionContinuity of continuity) {
          const projection = projectSessionTruth(baseInput({
            transport,
            rememberedIdentityAccess,
            sessionContinuity,
          }));
          expect(findSessionTruthFact(projection, 'identity').value).toBe('Not authenticated');
        }
      }
    }
  });

  it('maps every transport state without making an identity claim', () => {
    const expected: Record<SessionTruthTransportState, string> = {
      disconnected: 'Disconnected',
      connecting: 'Connecting',
      reconnecting: 'Reconnecting',
      connected: 'Connected',
      error: 'Connection error',
    };

    for (const [transport, value] of Object.entries(expected) as Array<[
      SessionTruthTransportState,
      string,
    ]>) {
      const projection = projectSessionTruth(baseInput({ transport }));
      expect(findSessionTruthFact(projection, 'transport').value).toBe(value);
      expect(findSessionTruthFact(projection, 'identity').value).toBe('Not authenticated');
    }
  });

  it('maps every continuity state while leaving identity independent', () => {
    const cases = [
      { sessionContinuity: 'none', rememberedIdentityAccess: null, value: 'Not available' },
      { sessionContinuity: 'none', rememberedIdentityAccess: 'resume', value: 'Resume remembered' },
      { sessionContinuity: 'none', rememberedIdentityAccess: 'sign-in', value: 'Sign-in remembered' },
      { sessionContinuity: 'none', rememberedIdentityAccess: 'identity-only', value: 'Identity remembered' },
      { sessionContinuity: 'resuming', rememberedIdentityAccess: null, value: 'Resume in progress' },
      { sessionContinuity: 'resumed', rememberedIdentityAccess: null, value: 'Resumed' },
      { sessionContinuity: 'failed', rememberedIdentityAccess: null, value: 'Resume failed' },
    ] as const;

    for (const item of cases) {
      const projection = projectSessionTruth(baseInput({
        sessionContinuity: item.sessionContinuity,
        rememberedIdentityAccess: item.rememberedIdentityAccess,
      }));
      expect(findSessionTruthFact(projection, 'session-continuity').value).toBe(item.value);
      expect(findSessionTruthFact(projection, 'identity').value).toBe('Not authenticated');
    }
  });

  it('uses only the current authenticated-account fact for identity', () => {
    for (const account of [null, '', '  ', '*']) {
      const identity = findSessionTruthFact(
        projectSessionTruth(baseInput({ authenticatedAccount: account })),
        'identity',
      );
      expect(identity.value).toBe('Not authenticated');
    }

    const identity = findSessionTruthFact(
      projectSessionTruth(baseInput({ authenticatedAccount: ' alice ' })),
      'identity',
    );
    expect(identity.value).toBe('Authenticated as alice');
  });

  it('keeps group-message protection inactive for every activation-held control permutation', () => {
    const lifecycles: GroupControlRuntimeLifecycle[] = [
      'inactive', 'identity-pending', 'ready', 'recovery-required',
    ];
    const statuses: Array<GroupControlRoomStatus | undefined> = [
      undefined,
      'locked',
      'directory-pending',
      'pair-pending',
      'control-applied',
      'recovery-required',
      'rejected',
    ];

    for (const lifecycle of lifecycles) {
      for (const status of statuses) {
        for (const authenticatedAccount of [null, 'alice']) {
          for (const room of [null, '#lobby']) {
            const projection = projectSessionTruth(baseInput({
              authenticatedAccount,
              room,
              groupControl: runtime(lifecycle, status),
            }));
            const protection = findSessionTruthFact(projection, 'group-message-protection');
            expect(protection.value).toBe('Not active');
            expect(protection.detail).toBe('This room does not currently have an active message-protection session on this device.');
          }
        }
      }
    }
  });

  it('reports active group-message protection only for an active provisioned room', () => {
    const activeRuntime = runtime('ready', 'control-applied');
    activeRuntime.activation = 'active';
    activeRuntime.rooms = [{ room: '#lobby', status: 'control-applied', provisioned: true, epoch: 1 }];
    const protection = findSessionTruthFact(projectSessionTruth(baseInput({
      authenticatedAccount: 'alice',
      room: '#lobby',
      groupControl: activeRuntime,
    })), 'group-message-protection');
    expect(protection).toMatchObject({
      value: 'Protection ready',
      detail: 'This device can seal and open supported encrypted room messages. Room policy enforcement is reported separately.',
      tone: 'positive',
    });
  });

  it('reports applied group controls without promoting group-message protection', () => {
    const projection = projectSessionTruth(baseInput({
      authenticatedAccount: 'alice',
      groupControl: runtime('ready', 'control-applied'),
    }));
    expect(findSessionTruthFact(projection, 'group-control')).toMatchObject({
      value: 'Applied',
      detail: 'Room controls are applied. Message protection remains separate.',
    });
    expect(findSessionTruthFact(projection, 'group-message-protection').value).toBe('Not active');
  });

  it('maps every group-control lifecycle and room status independently', () => {
    const lifecycleCases = [
      ['inactive', 'Not available'],
      ['identity-pending', 'Identity check pending'],
      ['recovery-required', 'Recovery required'],
    ] as const;
    for (const [lifecycle, value] of lifecycleCases) {
      const projection = projectSessionTruth(baseInput({
        authenticatedAccount: 'alice',
        groupControl: runtime(lifecycle),
      }));
      expect(findSessionTruthFact(projection, 'group-control').value).toBe(value);
    }

    const roomCases = [
      [undefined, 'Unavailable for room'],
      ['locked', 'Locked'],
      ['directory-pending', 'Pending'],
      ['pair-pending', 'Pending'],
      ['control-applied', 'Applied'],
      ['recovery-required', 'Recovery required'],
      ['rejected', 'Recovery required'],
    ] as const;
    for (const [status, value] of roomCases) {
      const projection = projectSessionTruth(baseInput({
        authenticatedAccount: 'alice',
        groupControl: runtime('ready', status),
      }));
      expect(findSessionTruthFact(projection, 'group-control').value).toBe(value);
      expect(findSessionTruthFact(projection, 'group-message-protection').value).toBe('Not active');
    }

    const noRoom = projectSessionTruth(baseInput({
      authenticatedAccount: 'alice',
      room: null,
      groupControl: runtime('ready'),
    }));
    expect(findSessionTruthFact(noRoom, 'group-control').value).toBe('Ready; no room selected');

    const localRoom = projectSessionTruth(baseInput({
      authenticatedAccount: 'alice',
      room: '&ops',
      groupControl: {
        ...runtime('ready'),
        rooms: [{ room: '&ops', status: 'control-applied', provisioned: true }],
      },
    }));
    expect(findSessionTruthFact(localRoom, 'group-control').value).toBe('Applied');
    expect(findSessionTruthFact(localRoom, 'group-message-protection').value).toBe('Not active');
  });

  it('projects every explicit DM protection state without inference', () => {
    const expected: Record<DmProtectionState, string> = {
      'not-applicable': 'Not applicable',
      'not-active': 'Not active',
      active: 'End-to-end active',
      failed: 'Protection failed',
    };
    for (const [state, value] of Object.entries(expected) as Array<[DmProtectionState, string]>) {
      const projection = projectSessionTruth(baseInput({ dmProtection: state }));
      expect(findSessionTruthFact(projection, 'dm-protection').value).toBe(value);
    }
  });

  it('keeps call establishment independent from every media-protection outcome', () => {
    const media = [
      {},
      { mediaE2eeActive: true },
      { mediaE2eeDegraded: true },
      { stageMode: true },
      { transportInsecure: true },
    ] as const;

    for (const callMedia of media) {
      const projection = projectSessionTruth(baseInput({
        callState: 'in_call',
        callStartedAt: 1_700_000_000_000,
        callMedia,
      }));
      expect(findSessionTruthFact(projection, 'call-establishment').value).toBe('Established');
    }

    const hopOnly = projectSessionTruth(baseInput({
      callState: 'in_call',
      callStartedAt: 1_700_000_000_000,
    }));
    expect(findSessionTruthFact(hopOnly, 'call-media-protection')).toMatchObject({
      value: 'Server-link only',
      tone: 'caution',
    });
  });

  it('does not let stale start timestamps establish idle or ringing calls', () => {
    for (const callState of ['idle', 'ringing_in', 'ringing_out'] as const) {
      const projection = projectSessionTruth(baseInput({
        callState,
        callStartedAt: 1_700_000_000_000,
      }));
      expect(findSessionTruthFact(projection, 'call-establishment').value).not.toBe('Established');
    }
  });

  it('exhaustively classifies call establishment from lifecycle and start evidence', () => {
    const cases = [
      ['idle', null, 'No call'],
      ['idle', 1, 'No call'],
      ['ringing_in', null, 'Incoming'],
      ['ringing_in', 1, 'Incoming'],
      ['ringing_out', null, 'Calling'],
      ['ringing_out', 1, 'Calling'],
      ['in_call', null, 'Establishing'],
      ['in_call', 1, 'Established'],
    ] as const;
    for (const [callState, callStartedAt, value] of cases) {
      const projection = projectSessionTruth(baseInput({ callState, callStartedAt }));
      expect(findSessionTruthFact(projection, 'call-establishment').value).toBe(value);
    }
  });

  it('maps every call-media security level without changing establishment', () => {
    const cases = [
      [{}, 'Server-link only'],
      [{ mediaE2eeActive: true }, 'End-to-end active'],
      [{ mediaE2eeDegraded: true }, 'Not end-to-end'],
      [{ transportInsecure: true }, 'Protection failed'],
      [{ stageMode: true }, 'Broadcast mode'],
    ] as const;
    for (const [callMedia, value] of cases) {
      const projection = projectSessionTruth(baseInput({
        callState: 'in_call',
        callStartedAt: 1,
        callMedia,
      }));
      expect(findSessionTruthFact(projection, 'call-media-protection').value).toBe(value);
      expect(findSessionTruthFact(projection, 'call-establishment').value).toBe('Established');
    }

    const connecting = projectSessionTruth(baseInput({ callState: 'ringing_out' }));
    expect(findSessionTruthFact(connecting, 'call-media-protection').value).toBe('Not active');
    const idle = projectSessionTruth(baseInput({ callState: 'idle' }));
    expect(findSessionTruthFact(idle, 'call-media-protection').value).toBe('Not applicable');
  });

  it('allows an end-to-end media claim only from the existing call-security resolver', () => {
    const active = projectSessionTruth(baseInput({
      callState: 'in_call',
      callStartedAt: 1_700_000_000_000,
      callMedia: { mediaE2eeActive: true },
    }));
    expect(findSessionTruthFact(active, 'call-media-protection').value).toBe('End-to-end active');

    const conflicting = projectSessionTruth(baseInput({
      callState: 'in_call',
      callStartedAt: 1_700_000_000_000,
      callMedia: { mediaE2eeActive: true, mediaE2eeDegraded: true },
    }));
    expect(findSessionTruthFact(conflicting, 'call-media-protection').value).toBe('Not end-to-end');
  });
});
