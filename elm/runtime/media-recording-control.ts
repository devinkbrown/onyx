// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseIRCMessage } from '../../src/lib/irc/parser';
import type { ConversationId, MediaCallRef, OwnerSnapshot, PrivateIngressEvent, RequestId, SendAdmission } from './contracts';
import type { MediaCallContext, MediaConsentIntent, MediaRecordingIntent, MediaRecordingSnapshot } from './media-control-types';

export interface MediaRecordingControlSendIntent {
  readonly kind: 'roster' | 'consent' | 'record';
  readonly owner: OwnerSnapshot;
  readonly conversationId: ConversationId;
  readonly requestId: RequestId;
  readonly consent?: 'on' | 'off';
  readonly action?: 'start' | 'stop';
}

export interface MediaRecordingControlResult {
  readonly owner: OwnerSnapshot;
  readonly conversationId: ConversationId;
  readonly callRef: MediaCallRef;
  /** Null for unsolicited state changes with no request to correlate. */
  readonly requestId: RequestId | null;
  readonly recording: MediaRecordingSnapshot;
}

export interface MediaRecordingControlDependencies {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly isCallCurrent: (context: MediaCallContext) => boolean;
  readonly currentNick: (owner: OwnerSnapshot) => string | null;
  readonly currentServerPrefix: () => string | null;
  readonly sendControl: (intent: MediaRecordingControlSendIntent) => SendAdmission;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly emit: (result: MediaRecordingControlResult) => void;
}

interface ParticipantConsent { readonly nick: string; readonly consent: 0 | 1 }
interface ScopeState {
  readonly owner: OwnerSnapshot;
  readonly conversationId: ConversationId;
  readonly callRef: MediaCallRef;
  context: MediaCallContext;
  recording: MediaRecordingSnapshot;
}
interface ActiveRequest {
  readonly context: MediaCallContext;
  readonly kind: 'roster' | 'consent' | 'record';
  readonly requestedConsent?: 'on' | 'off';
  readonly requestedAction?: 'start' | 'stop';
  readonly participants: Map<string, ParticipantConsent>;
  readonly buffered: PrivateIngressEvent[];
  admitting: boolean;
  sendStarted: boolean;
  sendOutcome: 'pending' | 'admitted' | 'unknown' | 'blocked';
  needsRosterDrain: boolean;
  drainDrained: boolean;
  readonly drainToken: number;
  rosterClosed: boolean;
  rosterGeneration: number;
  sawRosterRow: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  finish: (result: MediaRecordingControlResult) => void;
}

const MAX_ROSTER_PARTICIPANTS = 64;
const MAX_CALL_STATES = 32;
const MAX_ROSTER_LINE_BYTES = 8191;
const RESPONSE_TIMEOUT_MS = 12_000;
const MAX_ROSTER_DRAINS = 32;
const encoder = new TextEncoder();

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}

function ownerKey(owner: OwnerSnapshot): string {
  return JSON.stringify([owner.networkId, owner.accountId, owner.accountGeneration, owner.connectionGeneration, owner.physicalRef, owner.ownerRef]);
}

function physicalKey(owner: OwnerSnapshot): string {
  return JSON.stringify([owner.networkId, owner.connectionGeneration, owner.physicalRef]);
}

function rosterDrainKey(owner: OwnerSnapshot, conversationId: ConversationId): string {
  return JSON.stringify([physicalKey(owner), conversationId]);
}

function scopeKey(context: MediaCallContext): string {
  return JSON.stringify([ownerKey(context.owner), context.conversationId, context.callRef]);
}

function emptyRecording(): MediaRecordingSnapshot {
  return {
    ownConsent: 'unknown', consentRequest: 'idle', desiredAction: null, requestState: 'idle',
    actual: 'unknown', rosterState: 'unknown', allConsented: null, policyRevision: null, reason: null,
  };
}

function foldNick(nick: string): string {
  // RFC1459 folding is conservative if a deployment advertises ASCII: a
  // collision can only invalidate a roster, never authorize a recording.
  return nick.toLowerCase().replace(/[\[\\\]^]/gu, character => ({ '[': '{', ']': '}', '\\': '|', '^': '~' })[character] ?? character);
}

function validNick(nick: string): boolean {
  return nick.length >= 1 && nick.length <= 64 && /^[A-Za-z\[\]\\^_`{|}][A-Za-z0-9\[\]\\^_`{|}-]{0,63}$/u.test(nick);
}

function canonicalCount(raw: string | undefined): number | null {
  if (!raw || !/^(?:0|[1-9]\d{0,2})$/u.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_ROSTER_PARTICIPANTS ? value : null;
}

interface RecordUpdate { readonly actor: string | null; readonly status: 'started' | 'stopped' | 'active=0' | 'active=1' }

function parseRecordUpdate(fields: readonly string[]): RecordUpdate | null {
  if (fields[0] !== 'MEDIA' || fields[1] !== 'RECORD') return null;
  const direct = fields[3];
  if (fields.length === 4 && (direct === 'started' || direct === 'stopped' || direct === 'active=0' || direct === 'active=1')) {
    return { actor: null, status: direct };
  }
  if (fields.length === 5 && direct === 'active=1' && /^by=[A-Za-z0-9\[\]\\^_`{|}-]{1,64}$/u.test(fields[4] ?? '')) {
    return { actor: null, status: 'active=1' };
  }
  const actor = fields[3];
  const status = fields[4];
  if (fields.length === 5 && actor && validNick(actor)
      && (status === 'started' || status === 'stopped' || status === 'active=0' || status === 'active=1')) {
    return { actor, status };
  }
  return null;
}

async function policyDigest(participants: readonly ParticipantConsent[]): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const canonical = JSON.stringify(participants
    .slice()
    .sort((a, b) => {
      const left = foldNick(a.nick); const right = foldNick(b.nick);
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(participant => [participant.nick, participant.consent]));
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(canonical));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Owns recording consent and server-recording state for exact active calls.
 * The service never infers participants from channel accounts or chat users:
 * only a complete Event Spine MEDIA ROSTER snapshot can establish policy.
 */
export function createMediaRecordingControl(deps: MediaRecordingControlDependencies): {
  inspect(context: MediaCallContext): MediaRecordingSnapshot;
  refresh(context: MediaCallContext): Promise<MediaRecordingControlResult>;
  setConsent(intent: MediaConsentIntent): Promise<MediaRecordingControlResult>;
  requestRecording(intent: MediaRecordingIntent): Promise<MediaRecordingControlResult>;
  consumePrivateIngress(event: PrivateIngressEvent): boolean;
  retireOwner(previous: OwnerSnapshot, next: OwnerSnapshot): void;
  retireCall(context: MediaCallContext): void;
  dispose(): void;
} {
  const states = new Map<string, ScopeState>();
  const rosterDrains = new Map<string, { readonly physicalKey: string; readonly token: number; readonly request: ActiveRequest }>();
  let observedPhysicalKey: string | null = null;
  let rosterDrainOverflowPhysical: string | null = null;
  let nextRosterDrainToken = 0;
  let active: ActiveRequest | null = null;
  let disposed = false;
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer));

  function isCurrent(context: MediaCallContext): boolean {
    return !disposed && sameOwner(context.owner, deps.ownerSnapshot()) && deps.isCurrent(context.owner) && deps.isCallCurrent(context);
  }

  function syncPhysicalFence(owner: OwnerSnapshot): string {
    const current = physicalKey(owner);
    if (observedPhysicalKey !== current) {
      rosterDrains.clear();
      rosterDrainOverflowPhysical = null;
      observedPhysicalKey = current;
    }
    return current;
  }

  function markRosterDrain(request: ActiveRequest): void {
    if (request.kind !== 'roster' || request.drainDrained || request.sendOutcome === 'blocked') return;
    const currentOwner = deps.ownerSnapshot();
    if (physicalKey(request.context.owner) !== physicalKey(currentOwner)) return;
    const physical = syncPhysicalFence(currentOwner);
    const key = rosterDrainKey(request.context.owner, request.context.conversationId);
    if (rosterDrains.has(key)) return;
    if (rosterDrains.size >= MAX_ROSTER_DRAINS) {
      rosterDrainOverflowPhysical = physical;
      return;
    }
    rosterDrains.set(key, { physicalKey: physical, token: request.drainToken, request });
  }

  function drainLateRoster(event: PrivateIngressEvent): boolean {
    const parsed = trustedEvent(event);
    if (!parsed) return false;
    const { fields } = parsed;
    if (fields[1] !== 'ROSTER' && fields[1] !== 'ROSTER-END') return false;
    const room = fields[2];
    if (!room) return false;
    const physical = syncPhysicalFence(event.owner);
    const key = rosterDrainKey(event.owner, room as ConversationId);
    if (rosterDrainOverflowPhysical === physical) return true;
    const drain = rosterDrains.get(key);
    if (!drain) return false;
    if (fields[1] === 'ROSTER-END') {
      rosterDrains.delete(key);
      drain.request.drainDrained = true;
    }
    return true;
  }

  function stateFor(context: MediaCallContext): ScopeState {
    const key = scopeKey(context);
    let state = states.get(key);
    if (!state) {
      for (const [oldKey, oldState] of states) if (!isCurrent(oldState.context)) states.delete(oldKey);
      while (states.size >= MAX_CALL_STATES) {
        const activeKey = active ? scopeKey(active.context) : null;
        const oldest = [...states.keys()].find(candidate => candidate !== activeKey);
        if (oldest === undefined) break;
        states.delete(oldest);
      }
      state = { owner: context.owner, conversationId: context.conversationId, callRef: context.callRef, context, recording: emptyRecording() };
      states.set(key, state);
    } else state.context = context;
    return state;
  }

  function publish(state: ScopeState, requestId: RequestId | null = null): MediaRecordingControlResult {
    const result = { owner: state.owner, conversationId: state.conversationId, callRef: state.callRef, requestId, recording: state.recording };
    try { deps.emit(result); } catch { /* observer failures cannot alter controller authority */ }
    return result;
  }

  function direct(context: MediaCallContext, recording: MediaRecordingSnapshot): MediaRecordingControlResult {
    return { owner: context.owner, conversationId: context.conversationId, callRef: context.callRef, requestId: context.requestId, recording };
  }

  function reject(context: MediaCallContext, reason: string, key: 'consentRequest' | 'requestState'): MediaRecordingControlResult {
    if (!isCurrent(context)) return direct(context, { ...emptyRecording(), [key]: 'rejected', reason: 'stale-owner-or-call' });
    if (active) return direct(context, { ...(states.get(scopeKey(context))?.recording ?? emptyRecording()), reason });
    const state = stateFor(context);
    state.recording = { ...state.recording, [key]: 'rejected', reason };
    return publish(state, context.requestId);
  }

  function finish(request: ActiveRequest, update: (state: ScopeState) => MediaRecordingSnapshot, requestId: RequestId | null = request.context.requestId): void {
    if (request.settled) return;
    request.settled = true;
    if (request.timer !== null) clearTimer(request.timer);
    request.timer = null;
    if (active === request) active = null;
    const state = states.get(scopeKey(request.context));
    if (!state) {
      request.finish(direct(request.context, { ...emptyRecording(), requestState: 'unknown', reason: 'state-retired' }));
      return;
    }
    state.recording = !isCurrent(request.context)
      ? { ...state.recording, ...(request.kind === 'consent' ? { consentRequest: 'unknown' as const } : { requestState: 'unknown' as const }), ...(request.kind === 'roster' ? { rosterState: 'stale' as const, allConsented: null, policyRevision: null } : {}), reason: 'stale-owner-or-call' }
      : update(state);
    const result = publish(state, requestId);
    request.finish(result);
  }

  function finishUnknown(request: ActiveRequest, reason: string): void {
    if (request.kind === 'roster' && !request.rosterClosed) {
      if (request.sendOutcome === 'pending') {
        if (request.sendStarted) {
          request.needsRosterDrain = true;
          markRosterDrain(request);
        }
      } else if (request.sendOutcome !== 'blocked') {
        markRosterDrain(request);
      }
    }
    finish(request, state => ({
      ...state.recording,
      ...(request.kind === 'consent' ? { consentRequest: 'unknown' as const } : { requestState: 'unknown' as const }),
      ...(request.kind === 'roster' ? { rosterState: 'stale' as const, allConsented: null, policyRevision: null } : {}),
      reason,
    }));
  }

  function begin(
    context: MediaCallContext,
    kind: ActiveRequest['kind'],
    intent: Omit<MediaRecordingControlSendIntent, 'owner' | 'conversationId' | 'requestId'>,
  ): Promise<MediaRecordingControlResult> {
    if (!isCurrent(context)) return Promise.resolve(direct(context, { ...emptyRecording(), ...(kind === 'consent' ? { consentRequest: 'rejected' as const } : { requestState: 'rejected' as const }), reason: 'stale-owner-or-call' }));
    const physical = syncPhysicalFence(context.owner);
    if (active) {
      const sameCall = scopeKey(active.context) === scopeKey(context);
      const safetyAction = intent.kind === 'consent' && intent.consent === 'off'
        || intent.kind === 'record' && intent.action === 'stop';
      if (sameCall && safetyAction) finishUnknown(active, 'superseded-by-safety-action');
      else return Promise.resolve(direct(context, { ...stateFor(context).recording, reason: 'busy' }));
      if (active !== null) return Promise.resolve(direct(context, { ...states.get(scopeKey(context))?.recording ?? emptyRecording(), reason: 'busy' }));
      if (!isCurrent(context)) return Promise.resolve(direct(context, { ...emptyRecording(), requestState: 'rejected', reason: 'stale-owner-or-call' }));
    }
    const drainKey = rosterDrainKey(context.owner, context.conversationId);
    if (kind === 'roster' && (rosterDrains.has(drainKey) || rosterDrainOverflowPhysical === physical)) {
      const state = stateFor(context);
      state.recording = { ...state.recording, requestState: 'unknown', rosterState: 'stale', allConsented: null, policyRevision: null, reason: 'roster-drain-pending' };
      return Promise.resolve(publish(state, context.requestId));
    }
    const state = stateFor(context);
    const requestPromise = new Promise<MediaRecordingControlResult>(resolve => {
      const request: ActiveRequest = {
        context, kind,
        ...(intent.kind === 'consent' && intent.consent ? { requestedConsent: intent.consent } : {}),
        ...(intent.kind === 'record' && intent.action ? { requestedAction: intent.action } : {}),
        participants: new Map(), buffered: [], admitting: true, sendStarted: false, sendOutcome: 'pending', needsRosterDrain: false,
        drainDrained: false, drainToken: ++nextRosterDrainToken,
        rosterClosed: false, rosterGeneration: 0, sawRosterRow: false, timer: null, settled: false, finish: resolve,
      };
      active = request;
      state.recording = {
        ...state.recording,
        ...(kind === 'consent' ? { consentRequest: 'pending' as const } : { requestState: 'pending' as const }),
        ...(kind === 'roster' ? { rosterState: 'pending' as const, allConsented: null, policyRevision: null } : {}),
        ...(kind === 'record' ? { desiredAction: intent.action ?? null } : {}),
        reason: null,
      };
      publish(state, context.requestId);
      if (active !== request || request.settled || !isCurrent(context)) {
        if (!request.settled) finishUnknown(request, 'stale-owner-or-call');
        return;
      }
      let admission: SendAdmission;
      request.sendStarted = true;
      try {
        admission = deps.sendControl({ ...intent, owner: context.owner, conversationId: context.conversationId, requestId: context.requestId });
      } catch {
        admission = { kind: 'unknown', reason: 'transport-error' };
      }
      request.admitting = false;
      if (admission.kind === 'blocked') {
        request.sendOutcome = 'blocked';
        request.needsRosterDrain = false;
        if (kind === 'roster') {
          const key = rosterDrainKey(context.owner, context.conversationId);
          if (rosterDrains.get(key)?.token === request.drainToken) rosterDrains.delete(key);
          if (rosterDrainOverflowPhysical === physical && rosterDrains.size < MAX_ROSTER_DRAINS) rosterDrainOverflowPhysical = null;
        }
        finish(request, current => ({ ...current.recording,
          ...(kind === 'consent' ? { consentRequest: 'rejected' as const } : { requestState: 'rejected' as const }),
          ...(kind === 'roster' ? { rosterState: 'stale' as const } : {}),
          reason: admission.reason,
        }));
        return;
      }
      if (admission.kind === 'unknown') {
        request.sendOutcome = 'unknown';
        if (request.needsRosterDrain) markRosterDrain(request);
        finishUnknown(request, admission.reason);
        return;
      }
      request.sendOutcome = 'admitted';
      if (request.needsRosterDrain) markRosterDrain(request);
      if (active !== request || request.settled) return;
      if (!isCurrent(context)) { finishUnknown(request, 'stale-owner-or-call'); return; }
      request.timer = setTimer(() => {
        if (active === request) finishUnknown(request, 'response-timeout');
      }, RESPONSE_TIMEOUT_MS);
      const buffered = request.buffered.splice(0);
      for (const item of buffered) {
        if (active !== request) break;
        processIngress(request, item);
      }
    });
    return requestPromise;
  }

  function requestFailReason(message: ReturnType<typeof parseIRCMessage>, request: ActiveRequest): string | null {
    if (message.command !== 'FAIL' || message.params[0]?.toUpperCase() !== 'MEDIA') return null;
    const code = message.params[1]?.toUpperCase();
    const allowed: Record<ActiveRequest['kind'], readonly string[]> = {
      roster: ['NOTONCHANNEL', 'NOT_IN_CALL', 'TEMPORARILY_UNAVAILABLE'],
      consent: ['NOT_IN_CALL', 'BAD_CONSENT', 'TEMPORARILY_UNAVAILABLE'],
      record: ['NOT_IN_CALL', 'BAD_CONSENT', 'CONSENT_REQUIRED', 'RECORDING_DISABLED', 'RECORDING_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE'],
    };
    return code && allowed[request.kind].includes(code) ? code.toLowerCase().replaceAll('_', '-') : null;
  }

  function noticeFailReason(message: ReturnType<typeof parseIRCMessage>, request: ActiveRequest): string | null {
    if (message.command !== 'NOTICE' || message.params[0] !== deps.currentNick(request.context.owner)) return null;
    const match = /^FAIL MEDIA ([A-Z0-9_]+):(?:\s|$)/u.exec(message.params[1] ?? '');
    if (!match?.[1]) return null;
    return requestFailReason({ ...message, command: 'FAIL', params: ['MEDIA', match[1]] } as ReturnType<typeof parseIRCMessage>, request);
  }

  function isExpectedResponse(message: ReturnType<typeof parseIRCMessage>, event: PrivateIngressEvent, request: ActiveRequest): boolean {
    if (ingressFailureReason(message, event, request) !== null) return true;
    if (event.sourceKind !== 'server' || message.prefix !== deps.currentServerPrefix()) return false;
    if (message.command === '442') return message.params[0] === deps.currentNick(request.context.owner) && message.params[1] === request.context.conversationId;
    if (message.command !== 'EVENT' || message.params[0] !== deps.currentNick(request.context.owner)) return false;
    const fields = message.params.slice(1);
    if (fields[0] !== 'MEDIA' || fields[2] !== request.context.conversationId) return false;
    if (request.kind === 'roster') return fields[1] === 'ROSTER' || fields[1] === 'ROSTER-END';
    if (request.kind === 'consent') {
      return fields[1] === 'CONSENT' && foldNick(fields[3] ?? '') === foldNick(deps.currentNick(request.context.owner) ?? '')
        && fields[4] === request.requestedConsent;
    }
    if (fields[1] !== 'RECORD') return false;
    const privateStatus = fields[3];
    const broadcastStatus = fields[4];
    const isStart = request.requestedAction === 'start'
      && (privateStatus === 'started' || /^active=1$/u.test(privateStatus ?? '') && /^by=[A-Za-z0-9\[\]\\^_`{|}-]{1,64}$/u.test(fields[4] ?? '')
        || foldNick(fields[3] ?? '') === foldNick(deps.currentNick(request.context.owner) ?? '') && (broadcastStatus === 'started' || /^active=1(?:$|\s)/u.test(broadcastStatus ?? '')));
    const isStop = request.requestedAction === 'stop'
      && (privateStatus === 'stopped' || privateStatus === 'active=0'
        || foldNick(fields[3] ?? '') === foldNick(deps.currentNick(request.context.owner) ?? '') && (broadcastStatus === 'stopped' || broadcastStatus === 'active=0'));
    return isStart || isStop;
  }

  function ingressFailureReason(message: ReturnType<typeof parseIRCMessage>, event: PrivateIngressEvent, request: ActiveRequest): string | null {
    if (event.sourceKind === 'prefixless-protocol' && message.prefix === null) return requestFailReason(message, request);
    if (event.sourceKind === 'server' && message.prefix === deps.currentServerPrefix()) {
      return requestFailReason(message, request) ?? noticeFailReason(message, request);
    }
    return null;
  }

  function trustedEvent(event: PrivateIngressEvent): { readonly message: ReturnType<typeof parseIRCMessage>; readonly fields: string[] } | null {
    if (event.sourceKind !== 'server' || !sameOwner(event.owner, deps.ownerSnapshot()) || !deps.isCurrent(event.owner)) return null;
    if (encoder.encode(event.line).byteLength > MAX_ROSTER_LINE_BYTES) return null;
    const prefix = deps.currentServerPrefix();
    if (prefix === null) return null;
    let message: ReturnType<typeof parseIRCMessage>;
    try { message = parseIRCMessage(event.line); } catch { return null; }
    if (message.prefix !== prefix || message.command !== 'EVENT' || message.params[0] !== deps.currentNick(event.owner)) return null;
    if (message.params.length > 16) return null;
    const fields = message.params.slice(1).join(' ').split(' ');
    return fields[0] === 'MEDIA' ? { message, fields } : null;
  }

  function observeUnsolicited(event: PrivateIngressEvent): boolean {
    const parsed = trustedEvent(event);
    if (!parsed) return false;
    const { fields } = parsed;
    const room = fields[2];
    if (!room) return false;
    const state = [...states.values()].find(candidate => sameOwner(candidate.owner, event.owner)
      && candidate.conversationId === room && isCurrent(candidate.context));
    if (!state) return false;
    if (fields[1] === 'JOIN' || fields[1] === 'LEAVE') {
      state.recording = { ...state.recording, rosterState: 'stale', allConsented: null, policyRevision: null, reason: 'membership-changed' };
      publish(state, null);
      return false; // Preserve the Event Spine line for the normal media fold.
    }
    if (fields[1] === 'CONSENT' && fields.length === 5) {
      const actor = fields[3];
      const value = fields[4];
      if (!actor || (value !== 'on' && value !== 'off')) return false;
      const ownConsent = foldNick(actor) === foldNick(deps.currentNick(event.owner) ?? '')
        ? value === 'on' ? 'granted' : 'denied'
        : state.recording.ownConsent;
      state.recording = { ...state.recording, ownConsent, rosterState: 'stale', allConsented: null, policyRevision: null, reason: 'consent-changed' };
      publish(state, null);
      return false;
    }
    const recordUpdate = parseRecordUpdate(fields);
    if (recordUpdate && fields[2] === room) {
      state.recording = { ...state.recording, actual: recordUpdate.status === 'started' || recordUpdate.status === 'active=1' ? 'active' : 'inactive' };
      publish(state, null);
      return false;
    }
    return false;
  }

  function processIngress(request: ActiveRequest, event: PrivateIngressEvent): boolean {
    if (!isCurrent(request.context) || !sameOwner(request.context.owner, event.owner)) {
      finishUnknown(request, 'stale-owner-or-call');
      return true;
    }
    let message: ReturnType<typeof parseIRCMessage>;
    try { message = parseIRCMessage(event.line); } catch { return false; }
    const serverPrefix = deps.currentServerPrefix();
    const isServerLine = event.sourceKind === 'server' && serverPrefix !== null && message.prefix === serverPrefix;
    const isPrefixlessFail = event.sourceKind === 'prefixless-protocol' && message.prefix === null && message.command === 'FAIL';
    if (!isServerLine && !isPrefixlessFail) return false;
    const failReason = ingressFailureReason(message, event, request);
    if (failReason) {
      finish(request, state => ({
        ...state.recording,
        ...(request.kind === 'consent' ? { consentRequest: 'rejected' as const } : { requestState: 'rejected' as const }),
        reason: failReason,
      }));
      return true;
    }
    if (message.command === '442' && message.params[0] === deps.currentNick(request.context.owner)
        && message.params[1] === request.context.conversationId) {
      finish(request, state => ({
        ...state.recording,
        ...(request.kind === 'consent' ? { consentRequest: 'rejected' as const } : { requestState: 'rejected' as const }),
        ...(request.kind === 'roster' ? { rosterState: 'stale' as const, allConsented: null, policyRevision: null } : {}),
        reason: 'not-on-channel',
      }));
      return true;
    }
    if (message.command !== 'EVENT' || message.params[0] !== deps.currentNick(request.context.owner)) return false;
    if (encoder.encode(event.line).byteLength > MAX_ROSTER_LINE_BYTES) return false;
    const body = message.params.slice(1).join(' ');
    const fields = body.split(' ');
    if (fields[0] !== 'MEDIA') return false;

    const state = states.get(scopeKey(request.context));
    if ((fields[1] === 'JOIN' || fields[1] === 'LEAVE') && fields[2] === request.context.conversationId) {
      if (state) {
        state.recording = { ...state.recording, rosterState: 'stale', allConsented: null, policyRevision: null, reason: 'membership-changed' };
        publish(state, null);
      }
      if (request.kind === 'roster') finishUnknown(request, 'membership-changed-during-roster');
      if (request.kind === 'record' && request.requestedAction === 'start') finishUnknown(request, 'membership-changed-during-record-start');
      return false;
    }

    if (fields[1] === 'ROSTER' || fields[1] === 'ROSTER-END') {
      if (request.rosterClosed) {
        request.rosterGeneration++;
        request.rosterClosed = false;
        finishUnknown(request, 'roster-data-after-end');
        return true;
      }
      if (fields[2] !== request.context.conversationId) {
        finishUnknown(request, 'interleaved-roster');
        return true;
      }
      if (request.kind !== 'roster') return false;
      if (fields[1] === 'ROSTER') {
        const parsed = parseRosterRow(fields);
        if (!parsed || request.participants.size >= MAX_ROSTER_PARTICIPANTS) {
          finishUnknown(request, 'invalid-roster');
          return true;
        }
        const folded = foldNick(parsed.nick);
        if (request.participants.has(folded)) {
          finishUnknown(request, 'duplicate-roster-member');
          return true;
        }
        request.participants.set(folded, parsed);
        request.sawRosterRow = true;
        return true;
      }
      if (fields[1] === 'ROSTER-END') request.rosterClosed = true;
      const count = fields.length === 4 && fields[3]?.startsWith('count=') ? canonicalCount(fields[3].slice(6)) : null;
      if (count === null || count !== request.participants.size || count === 0 || !request.sawRosterRow) {
        finishUnknown(request, 'incomplete-roster');
        return true;
      }
      const nick = deps.currentNick(request.context.owner);
      const self = nick ? request.participants.get(foldNick(nick)) : undefined;
      if (!self) {
        finishUnknown(request, 'self-missing-from-roster');
        return true;
      }
      const rows = [...request.participants.values()];
      const digestGeneration = ++request.rosterGeneration;
      void policyDigest(rows).then(revision => {
        if (active !== request || request.settled || request.rosterGeneration !== digestGeneration || !isCurrent(request.context)) return;
        if (!revision) { finishUnknown(request, 'policy-digest-unavailable'); return; }
        const allConsented = rows.every(row => row.consent === 1);
        finish(request, state => ({
          ...state.recording,
          ownConsent: self.consent === 1 ? 'granted' : 'denied',
          rosterState: 'complete', allConsented, policyRevision: revision,
          requestState: 'idle', desiredAction: null, reason: null,
        }));
      }).catch(() => finishUnknown(request, 'policy-digest-unavailable'));
      return true;
    }

    if (fields[1] === 'CONSENT' && fields[2] === request.context.conversationId && fields.length === 5) {
      const actor = fields[3];
      const value = fields[4];
      if (!actor || !['on', 'off'].includes(value ?? '')) return false;
      if (request.kind === 'roster') finishUnknown(request, 'consent-changed-during-roster');
      if (request.kind === 'record' && request.requestedAction === 'start') finishUnknown(request, 'consent-changed-during-record-start');
      if (state && foldNick(actor) === foldNick(deps.currentNick(request.context.owner) ?? '')) {
        const ownConsent = value === 'on' ? 'granted' : 'denied';
        state.recording = { ...state.recording, ownConsent, rosterState: 'stale', allConsented: null, policyRevision: null };
        if (request.kind === 'consent' && request.requestedConsent === value) {
          finish(request, current => ({ ...current.recording, ownConsent, consentRequest: 'idle', rosterState: 'stale', allConsented: null, policyRevision: null, reason: null }));
        } else publish(state, null);
      } else if (state) {
        state.recording = { ...state.recording, rosterState: 'stale', allConsented: null, policyRevision: null, reason: 'consent-changed' };
        publish(state, null);
        if (request.kind === 'roster') finishUnknown(request, 'consent-changed-during-roster');
      }
      return request.kind === 'consent' && foldNick(actor) === foldNick(deps.currentNick(request.context.owner) ?? '') && request.requestedConsent === value
        ? true : false;
    }

    if (fields[1] === 'RECORD' && fields[2] === request.context.conversationId) {
      const update = parseRecordUpdate(fields);
      if (update) {
        const actual: MediaRecordingSnapshot['actual'] = update.status === 'started' || update.status === 'active=1' ? 'active' : 'inactive';
        if (state) state.recording = { ...state.recording, actual };
        const ownEvent = update.actor === null || foldNick(update.actor) === foldNick(deps.currentNick(request.context.owner) ?? '');
        const expected = request.kind === 'record' && ownEvent && (
          request.requestedAction === 'start' && (update.status === 'started' || update.status === 'active=1')
          || request.requestedAction === 'stop' && (update.status === 'stopped' || update.status === 'active=0')
        );
        if (expected) {
          finish(request, current => ({ ...current.recording, actual, requestState: 'idle', desiredAction: null, reason: null }));
        } else if (state) publish(state, null);
        return expected;
      }
    }
    return false;
  }

  function parseRosterRow(fields: string[]): ParticipantConsent | null {
    if (fields.length !== 10 && fields.length !== 12) return null;
    const nick = fields[3];
    const consentField = fields.at(-1);
    if (!nick || !validNick(nick) || !consentField || !/^consent=[01]$/u.test(consentField)) return null;
    if (!fields[4] || !fields[5] || !/^-?\d{1,6}$/u.test(fields[6] ?? '') || !/^-?\d{1,6}$/u.test(fields[7] ?? '') || !fields[8]) return null;
    if (fields.length === 12 && (!/^codecs=[A-Za-z0-9,._-]{1,128}$/u.test(fields[9] ?? '') || !/^fec=[A-Za-z0-9_-]{1,64}$/u.test(fields[10] ?? ''))) return null;
    return { nick, consent: consentField.endsWith('1') ? 1 : 0 };
  }

  return {
    inspect(context) {
      if (!isCurrent(context)) return { ...emptyRecording(), reason: 'stale-owner-or-call' };
      const state = states.get(scopeKey(context));
      return state?.recording ?? emptyRecording();
    },
    refresh(context) {
      return begin(context, 'roster', { kind: 'roster' });
    },
    setConsent(intent) {
      const context: MediaCallContext = intent;
      if (!isCurrent(context)) return Promise.resolve(direct(context, { ...emptyRecording(), consentRequest: 'rejected', reason: 'stale-owner-or-call' }));
      const state = stateFor(context);
      if (intent.consent === 'granted') {
        if (state.recording.rosterState !== 'complete' || !intent.policyRevision || intent.policyRevision !== state.recording.policyRevision) {
          return Promise.resolve(reject(context, 'stale-policy', 'consentRequest'));
        }
      }
      return begin(context, 'consent', { kind: 'consent', consent: intent.consent === 'granted' ? 'on' : 'off' });
    },
    requestRecording(intent) {
      const context: MediaCallContext = intent;
      if (!isCurrent(context)) return Promise.resolve(direct(context, { ...emptyRecording(), requestState: 'rejected', reason: 'stale-owner-or-call' }));
      const state = stateFor(context);
      if (intent.action === 'start' && (state.recording.rosterState !== 'complete' || state.recording.allConsented !== true
          || !intent.consentRevision || intent.consentRevision !== state.recording.policyRevision)) {
        return Promise.resolve(reject(context, 'consent-required-or-stale-policy', 'requestState'));
      }
      return begin(context, 'record', { kind: 'record', action: intent.action });
    },
    consumePrivateIngress(event) {
      if (disposed) return false;
      if (encoder.encode(event.line).byteLength > MAX_ROSTER_LINE_BYTES) {
        if (active && sameOwner(active.context.owner, event.owner)) finishUnknown(active, 'oversized-response');
        return false;
      }
      if (drainLateRoster(event)) return true;
      if (!active) return observeUnsolicited(event);
      if (!sameOwner(active.context.owner, event.owner)) return false;
      let message: ReturnType<typeof parseIRCMessage>;
      try { message = parseIRCMessage(event.line); } catch { return false; }
      const serverPrefix = deps.currentServerPrefix();
      const isServerLine = event.sourceKind === 'server' && serverPrefix !== null && message.prefix === serverPrefix;
      const isPrefixlessFail = event.sourceKind === 'prefixless-protocol' && message.prefix === null && message.command === 'FAIL';
      if (!isServerLine && !isPrefixlessFail) return false;
      if (active.admitting) {
        // Only a source-shaped response that could settle this exact request is
        // held across the admission boundary. Ordinary call-state events keep
        // their normal Event Spine fan-out path.
        if (!isExpectedResponse(message, event, active)) {
          const parsed = trustedEvent(event);
          const fields = parsed?.fields;
          if (fields && fields[2] === active.context.conversationId
              && (fields[1] === 'JOIN' || fields[1] === 'LEAVE'
                || fields[1] === 'CONSENT' && fields.length === 5)) {
            if (active.kind === 'roster' || active.kind === 'record' && active.requestedAction === 'start') {
              finishUnknown(active, fields[1] === 'CONSENT' ? 'consent-changed-during-request' : 'membership-changed-during-request');
            }
            observeUnsolicited(event);
            return false;
          }
          observeUnsolicited(event);
          return false;
        }
        active.buffered.push(event);
        return true;
      }
      return processIngress(active, event);
    },
    retireOwner(previous, next) {
      for (const [key, state] of states) if (sameOwner(state.owner, previous)) {
        if (active && scopeKey(active.context) === key) finishUnknown(active, 'stale-owner');
        states.delete(key);
      }
      if (!sameOwner(previous, next) && active && sameOwner(active.context.owner, previous)) finishUnknown(active, 'stale-owner');
    },
    retireCall(context) {
      const key = scopeKey(context);
      if (active && scopeKey(active.context) === key) finishUnknown(active, 'call-ended');
      states.delete(key);
    },
    dispose() {
      disposed = true;
      if (active) finishUnknown(active, 'disposed');
      active = null;
      states.clear();
      rosterDrains.clear();
      rosterDrainOverflowPhysical = null;
    },
  };
}
