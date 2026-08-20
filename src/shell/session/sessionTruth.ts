// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure presentation projection for the session-truth surface.
 *
 * Every fact reports one authority boundary. In particular, transport never
 * implies identity, remembered access never implies authentication, room
 * controls never imply group-message protection, and call establishment never
 * implies media protection.
 */

import type { CallSecurityInput, CallSecurityLevel } from '@/lib/cadence-media/callSecurity';
import { resolveCallSecurity } from '@/lib/cadence-media/callSecurity';
import type { CallState } from '@/lib/cadence-media/types';
import type { RememberedIdentityAccess } from '@/lib/credentials';
import {
  selectGroupControlLifecycle,
  selectGroupControlActivation,
  selectGroupControlRoom,
  selectGroupControlRoomStatus,
  type GroupControlProjection,
} from '@/lib/e2ee/groupControlSelectors';
import type { ConnectionStatus } from '@/lib/irc/types';

export type SessionTruthTransportState = ConnectionStatus | 'reconnecting';

export type SessionContinuityState =
  | 'none'
  | 'resuming'
  | 'resumed'
  | 'failed';

/** Explicit DM evidence supplied by the owning runtime; this module does not infer it. */
export type DmProtectionState =
  | 'not-applicable'
  | 'not-active'
  | 'active'
  | 'failed';

export type SessionTruthDimension =
  | 'transport'
  | 'identity'
  | 'session-continuity'
  | 'group-control'
  | 'group-message-protection'
  | 'dm-protection'
  | 'call-establishment'
  | 'call-media-protection';

export type SessionTruthGroup = 'access' | 'messages' | 'calls';
export type SessionTruthTone = 'neutral' | 'progress' | 'positive' | 'caution' | 'critical';

export type SessionTruthFact = {
  readonly id: SessionTruthDimension;
  readonly group: SessionTruthGroup;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: SessionTruthTone;
};

export type SessionTruthInput = {
  readonly transport: SessionTruthTransportState;
  /** The authenticated server account, or null when no account is authenticated. */
  readonly authenticatedAccount: string | null;
  /** Secret-free remembered-access classification. It is never authentication evidence. */
  readonly rememberedIdentityAccess?: RememberedIdentityAccess | null;
  readonly sessionContinuity: SessionContinuityState;
  readonly room?: string | null;
  readonly groupControl?: GroupControlProjection;
  readonly dmProtection: DmProtectionState;
  readonly callState: CallState;
  readonly callStartedAt: number | null;
  readonly callMedia?: Omit<CallSecurityInput, 'callState'>;
};

export type SessionTruthProjection = {
  readonly facts: readonly SessionTruthFact[];
};

function fact(
  id: SessionTruthDimension,
  group: SessionTruthGroup,
  label: string,
  value: string,
  detail: string,
  tone: SessionTruthTone,
): SessionTruthFact {
  return { id, group, label, value, detail, tone };
}

function authenticatedAccount(account: string | null): string | null {
  const normalized = account?.trim() ?? '';
  return normalized && normalized !== '*' ? normalized : null;
}

function projectTransport(status: SessionTruthTransportState): SessionTruthFact {
  switch (status) {
    case 'connected':
      return fact('transport', 'access', 'Transport', 'Connected',
        'A server connection is open. Authentication is reported separately.', 'positive');
    case 'connecting':
      return fact('transport', 'access', 'Transport', 'Connecting',
        'Opening a server connection.', 'progress');
    case 'reconnecting':
      return fact('transport', 'access', 'Transport', 'Reconnecting',
        'Restoring the server connection.', 'progress');
    case 'error':
      return fact('transport', 'access', 'Transport', 'Connection error',
        'The server connection failed.', 'critical');
    default:
      return fact('transport', 'access', 'Transport', 'Disconnected',
        'No server connection is open.', 'neutral');
  }
}

function projectIdentity(account: string | null): SessionTruthFact {
  const current = authenticatedAccount(account);
  return current
    ? fact('identity', 'access', 'Identity', `Authenticated as ${current}`,
      'The server has authenticated this account.', 'positive')
    : fact('identity', 'access', 'Identity', 'Not authenticated',
      'Connection and remembered access do not authenticate an account.', 'caution');
}

function rememberedContinuity(access: RememberedIdentityAccess | null | undefined): SessionTruthFact {
  switch (access) {
    case 'resume':
      return fact('session-continuity', 'access', 'Session continuity', 'Resume remembered',
        'A remembered resume can be attempted; it is not current authentication.', 'neutral');
    case 'sign-in':
      return fact('session-continuity', 'access', 'Session continuity', 'Sign-in remembered',
        'Sign-in material is remembered; it is not current authentication.', 'neutral');
    case 'identity-only':
      return fact('session-continuity', 'access', 'Session continuity', 'Identity remembered',
        'Only the identity is remembered; sign-in is still required.', 'neutral');
    default:
      return fact('session-continuity', 'access', 'Session continuity', 'Not available',
        'No remembered session continuity is available.', 'neutral');
  }
}

function projectSessionContinuity(input: SessionTruthInput): SessionTruthFact {
  switch (input.sessionContinuity) {
    case 'resuming':
      return fact('session-continuity', 'access', 'Session continuity', 'Resume in progress',
        'A previous session is being resumed. Authentication is reported separately.', 'progress');
    case 'resumed':
      return fact('session-continuity', 'access', 'Session continuity', 'Resumed',
        'Session continuity was restored. Authentication is reported separately.', 'positive');
    case 'failed':
      return fact('session-continuity', 'access', 'Session continuity', 'Resume failed',
        'The previous session could not be restored.', 'critical');
    default:
      return rememberedContinuity(input.rememberedIdentityAccess);
  }
}

function projectGroupControl(input: SessionTruthInput): SessionTruthFact {
  if (!authenticatedAccount(input.authenticatedAccount)) {
    return fact('group-control', 'messages', 'Group control', 'Signed out',
      'Sign in to inspect room controls.', 'neutral');
  }

  const lifecycle = selectGroupControlLifecycle(input.groupControl);
  switch (lifecycle) {
    case 'inactive':
      return fact('group-control', 'messages', 'Group control', 'Not available',
        'The group-control runtime is inactive.', 'neutral');
    case 'identity-pending':
      return fact('group-control', 'messages', 'Group control', 'Identity check pending',
        'Account identity is being checked.', 'progress');
    case 'recovery-required':
      return fact('group-control', 'messages', 'Group control', 'Recovery required',
        'Group controls need recovery.', 'critical');
    default:
      break;
  }

  const room = input.room?.trim() ?? '';
  if (!/^[#&]/u.test(room)) {
    return fact('group-control', 'messages', 'Group control', 'Ready; no room selected',
      'Choose a group room to inspect its controls.', 'neutral');
  }

  const status = selectGroupControlRoomStatus(input.groupControl, room);
  switch (status) {
    case 'locked':
      return fact('group-control', 'messages', 'Group control', 'Locked',
        'Room controls are locked.', 'caution');
    case 'directory-pending':
    case 'pair-pending':
      return fact('group-control', 'messages', 'Group control', 'Pending',
        'Room controls are pending.', 'progress');
    case 'control-applied':
      return fact('group-control', 'messages', 'Group control', 'Applied',
        'Room controls are applied. Message protection remains separate.', 'positive');
    case 'recovery-required':
    case 'rejected':
      return fact('group-control', 'messages', 'Group control', 'Recovery required',
        'Room controls need recovery.', 'critical');
    default:
      return fact('group-control', 'messages', 'Group control', 'Unavailable for room',
        'No control state is available for this room.', 'neutral');
  }
}

function projectGroupMessageProtection(input: SessionTruthInput): SessionTruthFact {
  const room = input.room?.trim() ?? '';
  const roomState = /^[#&]/u.test(room)
    ? selectGroupControlRoom(input.groupControl, room)
    : null;
  if (
    selectGroupControlActivation(input.groupControl) === 'active'
    && roomState?.status === 'control-applied'
    && roomState.provisioned
  ) {
    return fact('group-message-protection', 'messages', 'Group message protection', 'Protection ready',
      'This device can seal and open supported encrypted room messages. Room policy enforcement is reported separately.', 'positive');
  }
  return fact('group-message-protection', 'messages', 'Group message protection', 'Not active',
    'This room does not currently have an active message-protection session on this device.', 'caution');
}

function projectDmProtection(state: DmProtectionState): SessionTruthFact {
  switch (state) {
    case 'active':
      return fact('dm-protection', 'messages', 'DM protection', 'End-to-end active',
        'Direct-message content protection is active.', 'positive');
    case 'not-active':
      return fact('dm-protection', 'messages', 'DM protection', 'Not active',
        'Direct-message content protection is not active.', 'caution');
    case 'failed':
      return fact('dm-protection', 'messages', 'DM protection', 'Protection failed',
        'Direct-message content protection failed.', 'critical');
    default:
      return fact('dm-protection', 'messages', 'DM protection', 'Not applicable',
        'Open a direct message to inspect its protection.', 'neutral');
  }
}

function projectCallEstablishment(
  callState: CallState,
  callStartedAt: number | null,
): SessionTruthFact {
  if (callState === 'ringing_in') {
    return fact('call-establishment', 'calls', 'Call establishment', 'Incoming',
      'An incoming call is ringing; it is not established.', 'progress');
  }
  if (callState === 'ringing_out') {
    return fact('call-establishment', 'calls', 'Call establishment', 'Calling',
      'An outgoing call is ringing; it is not established.', 'progress');
  }
  if (callState === 'in_call' && callStartedAt != null) {
    return fact('call-establishment', 'calls', 'Call establishment', 'Established',
      'The call is established. Media protection is reported separately.', 'positive');
  }
  if (callState === 'in_call') {
    return fact('call-establishment', 'calls', 'Call establishment', 'Establishing',
      'The call exists but its media path is not established.', 'progress');
  }
  return fact('call-establishment', 'calls', 'Call establishment', 'No call',
    'No call is active.', 'neutral');
}

function mediaProtectionCopy(level: CallSecurityLevel): Pick<SessionTruthFact, 'value' | 'detail' | 'tone'> {
  switch (level) {
    case 'e2ee':
      return { value: 'End-to-end active', detail: 'Only call participants can access the media.', tone: 'positive' };
    case 'e2ee_degraded':
      return { value: 'Not end-to-end', detail: 'Some call participants cannot use end-to-end media protection.', tone: 'caution' };
    case 'hop_protected':
      return { value: 'Server-link only', detail: 'Media is encrypted to this server; server operators can access it.', tone: 'caution' };
    case 'insecure':
      return { value: 'Protection failed', detail: 'Call transport protection failed.', tone: 'critical' };
    case 'stage':
      return { value: 'Broadcast mode', detail: 'The server may process media in this broadcast.', tone: 'caution' };
    default:
      return { value: 'Not active', detail: 'Call media protection is not active while the call connects.', tone: 'progress' };
  }
}

function projectCallMediaProtection(input: SessionTruthInput): SessionTruthFact {
  const protection = resolveCallSecurity({ callState: input.callState, ...input.callMedia });
  if (!protection) {
    return fact('call-media-protection', 'calls', 'Call media protection', 'Not applicable',
      'No call media is active.', 'neutral');
  }
  const copy = mediaProtectionCopy(protection.level);
  return fact('call-media-protection', 'calls', 'Call media protection',
    copy.value, copy.detail, copy.tone);
}

export function projectSessionTruth(input: SessionTruthInput): SessionTruthProjection {
  return {
    facts: [
      projectTransport(input.transport),
      projectIdentity(input.authenticatedAccount),
      projectSessionContinuity(input),
      projectGroupControl(input),
      projectGroupMessageProtection(input),
      projectDmProtection(input.dmProtection),
      projectCallEstablishment(input.callState, input.callStartedAt),
      projectCallMediaProtection(input),
    ],
  };
}

export function findSessionTruthFact(
  projection: SessionTruthProjection,
  id: SessionTruthDimension,
): SessionTruthFact {
  const match = projection.facts.find((entry) => entry.id === id);
  if (!match) throw new Error(`Missing session-truth fact: ${id}`);
  return match;
}
