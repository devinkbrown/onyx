import { describe, expect, it } from 'vitest';
import type { ConversationId, MediaCallRef, OwnerSnapshot, PrivateIngressEvent, RequestId } from './contracts';
import { createMediaRecordingControl, type MediaRecordingControlResult } from './media-recording-control';
import type { MediaCallContext } from './media-control-types';

const owner: OwnerSnapshot = {
  networkId: 'custom:wss://127.0.0.1:7443/ws' as OwnerSnapshot['networkId'],
  accountId: null,
  accountGeneration: 0 as OwnerSnapshot['accountGeneration'],
  connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-4' as OwnerSnapshot['physicalRef'],
  ownerRef: 'owner-lab' as OwnerSnapshot['ownerRef'],
};
const context: MediaCallContext = {
  schemaVersion: 1,
  requestId: 'request-abcdefghijklmnop' as RequestId,
  owner,
  conversationId: '#media' as ConversationId,
  callRef: 'call-abcdefghijklmnop' as MediaCallRef,
};

function fixture(options: {
  readonly onSend?: (kind: string) => void;
  readonly admission?: () => { readonly kind: 'transport-admitted' } | { readonly kind: 'blocked'; readonly reason: 'owner-changed' | 'offline' | 'backpressure' | 'policy' | 'invalid-intent' };
  readonly onEmit?: (result: MediaRecordingControlResult) => void;
} = {}) {
  const emitted: MediaRecordingControlResult[] = [];
  const sent: Array<{ kind: string; consent?: string; action?: string }> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let currentCallRef: MediaCallRef = context.callRef;
  let service!: ReturnType<typeof createMediaRecordingControl>;
  service = createMediaRecordingControl({
    ownerSnapshot: () => owner,
    isCurrent: candidate => candidate === owner,
    isCallCurrent: candidate => candidate.callRef === currentCallRef && candidate.conversationId === context.conversationId,
    currentNick: () => 'Alice',
    currentServerPrefix: () => 'irc.example',
    sendControl: intent => { sent.push({ kind: intent.kind, ...(intent.consent ? { consent: intent.consent } : {}), ...(intent.action ? { action: intent.action } : {}) }); options.onSend?.(intent.kind); return options.admission?.() ?? { kind: 'transport-admitted' }; },
    now: () => 1_800_000_000_000,
    setTimer: callback => { const id = ++nextTimer; timers.set(id, callback); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: timer => { timers.delete(timer as unknown as number); },
    emit: result => { emitted.push(result); options.onEmit?.(result); },
  });
  const ingress = (line: string, sourceKind: PrivateIngressEvent['sourceKind'] = 'server', eventOwner = owner): boolean =>
    service.consumePrivateIngress({ line, owner: eventOwner, sourceKind });
  const roster = (nick: string, consent: 0 | 1): string =>
    `:irc.example EVENT Alice MEDIA ROSTER #media ${nick} voice main 0 0 - consent=${consent}`;
  const end = (count: number): string => `:irc.example EVENT Alice MEDIA ROSTER-END #media count=${count}`;
  const event = (body: string): string => `:irc.example EVENT Alice MEDIA ${body}`;
  return { service, emitted, sent, timers, ingress, roster, end, event, setCurrentCallRef: (value: MediaCallRef) => { currentCallRef = value; } };
}

describe('server-authoritative recording consent control', () => {
  it('commits only a complete, unique roster including self and exposes a snapshot digest', async () => {
    const f = fixture();
    const pending = f.service.refresh(context);
    expect(f.sent).toEqual([{ kind: 'roster' }]);
    expect(f.ingress(f.roster('Alice', 1))).toBe(true);
    expect(f.ingress(f.roster('Bob', 1))).toBe(true);
    expect(f.ingress(f.end(2))).toBe(true);
    const result = await pending;
    expect(result.recording.rosterState).toBe('complete');
    expect(result.recording.ownConsent).toBe('granted');
    expect(result.recording.allConsented).toBe(true);
    expect(result.recording.policyRevision).toMatch(/^[0-9a-f]{64}$/u);
    f.service.dispose();
  });

  it('fails closed on duplicate or incomplete roster data', async () => {
    const f = fixture();
    const pending = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.roster('alice', 0));
    const result = await pending;
    expect(result.recording.rosterState).toBe('stale');
    expect(result.recording.policyRevision).toBeNull();
    expect(result.recording.reason).toBe('duplicate-roster-member');
    expect(f.service.inspect(context).allConsented).toBeNull();
    f.service.dispose();
  });

  it('invalidates policy when a later exact Event Spine consent change arrives', async () => {
    const f = fixture();
    const pending = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.roster('Bob', 1));
    f.ingress(f.end(2));
    await pending;
    expect(f.service.inspect(context).allConsented).toBe(true);
    expect(f.ingress(f.event('CONSENT #media Bob off'))).toBe(false);
    expect(f.service.inspect(context).rosterState).toBe('stale');
    expect(f.service.inspect(context).allConsented).toBeNull();
    expect(f.service.inspect(context).policyRevision).toBeNull();
    f.service.dispose();
  });

  it('requires the exact current roster revision before granting consent or starting a recording', async () => {
    const f = fixture();
    const roster = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.roster('Bob', 1));
    f.ingress(f.end(2));
    const current = await roster;
    const revision = current.recording.policyRevision;
    expect(revision).not.toBeNull();

    const staleStart = await f.service.requestRecording({ ...context, action: 'start', consentRevision: 'stale' });
    expect(staleStart.recording.requestState).toBe('rejected');
    expect(f.sent).toHaveLength(1);

    const consent = f.service.setConsent({ ...context, consent: 'granted', policyRevision: revision });
    expect(f.sent.at(-1)).toEqual({ kind: 'consent', consent: 'on' });
    expect(f.ingress(f.event('CONSENT #media Alice on'))).toBe(true);
    const consented = await consent;
    expect(consented.recording.consentRequest).toBe('idle');
    expect(consented.recording.rosterState).toBe('stale');
    expect(consented.recording.policyRevision).toBeNull();
    f.service.dispose();
  });

  it('accepts only a source-matched private recording response and never replays on unknown', async () => {
    const f = fixture();
    const roster = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    const snapshot = await roster;
    const start = f.service.requestRecording({ ...context, action: 'start', consentRevision: snapshot.recording.policyRevision });
    expect(f.sent.at(-1)).toEqual({ kind: 'record', action: 'start' });
    expect(f.ingress(f.event('RECORD #media started'), 'user')).toBe(false);
    expect(f.ingress(':irc.example EVENT Other MEDIA RECORD #media started')).toBe(false);
    expect(f.ingress(f.event('RECORD #media started'))).toBe(true);
    const result = await start;
    expect(result.recording.actual).toBe('active');
    expect(result.recording.requestState).toBe('idle');
    expect(f.sent.filter(item => item.kind === 'record')).toHaveLength(1);
    f.service.dispose();
  });

  it('folds only the exact single-flight prefixless MEDIA failure as a rejection', async () => {
    const f = fixture();
    const roster = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    const snapshot = await roster;
    const start = f.service.requestRecording({ ...context, action: 'start', consentRevision: snapshot.recording.policyRevision });
    expect(f.ingress('FAIL MEDIA CONSENT_REQUIRED :Every current member must consent', 'prefixless-protocol')).toBe(true);
    const result = await start;
    expect(result.recording.requestState).toBe('rejected');
    expect(result.recording.reason).toBe('consent-required');
    f.service.dispose();
  });

  it('does not let a synchronous response override blocked transport admission', async () => {
    let ingress: ((line: string) => boolean) | null = null;
    const f = fixture({
      onSend: kind => { if (kind === 'consent') ingress?.(':irc.example EVENT Alice MEDIA CONSENT #media Alice off'); },
      admission: () => ({ kind: 'blocked', reason: 'backpressure' }),
    });
    ingress = line => f.ingress(line);
    const result = await f.service.setConsent({ ...context, consent: 'denied', policyRevision: null });
    expect(result.recording.consentRequest).toBe('rejected');
    expect(result.recording.ownConsent).toBe('unknown');
    expect(result.recording.reason).toBe('backpressure');
    f.service.dispose();
  });

  it('invalidates an in-flight roster when membership changes during admission', async () => {
    let ingress: ((line: string) => boolean) | null = null;
    const f = fixture({
      onSend: kind => {
        if (kind === 'roster') ingress?.(':irc.example EVENT Alice MEDIA JOIN #media Bob voice');
      },
    });
    ingress = line => f.ingress(line);
    const result = await f.service.refresh(context);
    expect(result.recording.rosterState).toBe('stale');
    expect(result.recording.policyRevision).toBeNull();
    const retry = await f.service.refresh({ ...context, requestId: 'request-bcdefghijklmnopq' as RequestId });
    expect(retry.recording.reason).toBe('roster-drain-pending');
    expect(f.sent).toHaveLength(1);
    expect(f.ingress(f.roster('Alice', 1))).toBe(true);
    expect(f.service.inspect(context)).toMatchObject({ rosterState: 'stale', allConsented: null, policyRevision: null, requestState: 'unknown' });
    expect(f.ingress(f.end(1))).toBe(true);
    expect(f.service.inspect(context)).toMatchObject({ rosterState: 'stale', allConsented: null, policyRevision: null, requestState: 'unknown' });
    f.service.dispose();
  });

  it('allows an explicit stop to supersede a pending roster request', async () => {
    const f = fixture();
    const roster = f.service.refresh(context);
    const stop = f.service.requestRecording({ ...context, action: 'stop', consentRevision: null });
    expect(f.sent).toEqual([{ kind: 'roster' }, { kind: 'record', action: 'stop' }]);
    expect(f.ingress(f.event('RECORD #media stopped'))).toBe(true);
    expect((await stop).recording.actual).toBe('inactive');
    expect((await roster).recording.requestState).toBe('unknown');
    f.service.dispose();
  });

  it('allows explicit consent denial to supersede a pending recording start', async () => {
    const f = fixture();
    const roster = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    const snapshot = await roster;
    const start = f.service.requestRecording({ ...context, action: 'start', consentRevision: snapshot.recording.policyRevision });
    const deny = f.service.setConsent({ ...context, consent: 'denied', policyRevision: null });
    expect(f.sent).toEqual([{ kind: 'roster' }, { kind: 'record', action: 'start' }, { kind: 'consent', consent: 'off' }]);
    expect(f.ingress(f.event('CONSENT #media Alice off'))).toBe(true);
    expect((await start).recording.requestState).toBe('unknown');
    expect((await deny).recording.ownConsent).toBe('denied');
    expect(f.sent.filter(item => item.kind === 'record' && item.action === 'start')).toHaveLength(1);
    f.service.dispose();
  });

  it('observes the source-shaped active recording detail after a request is unknown', async () => {
    const f = fixture();
    const roster = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    await roster;
    const request = f.service.requestRecording({ ...context, action: 'stop', consentRevision: null });
    const id = [...f.timers.keys()][0];
    expect(id).toBeDefined();
    f.timers.get(id!)?.();
    expect((await request).recording.requestState).toBe('unknown');
    expect(f.ingress(f.event('RECORD #media active=1 by=Alice'))).toBe(false);
    expect(f.service.inspect(context).actual).toBe('active');
    f.service.dispose();
  });

  it('does not send after a pending observer retires the exact call', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ onEmit: result => { if (result.recording.rosterState === 'pending') f.service.retireCall(context); } });
    const result = await f.service.refresh(context);
    expect(result.recording.requestState).toBe('unknown');
    expect(result.recording.reason).toBe('call-ended');
    expect(f.sent).toEqual([]);
    f.service.dispose();
  });

  it('does not restore a drained roster barrier after a synchronous JOIN and ROSTER-END', async () => {
    let f: ReturnType<typeof fixture>;
    let rosterSends = 0;
    f = fixture({ onSend: kind => {
      if (kind !== 'roster' || rosterSends++ > 0) return;
      f.ingress(':irc.example EVENT Alice MEDIA JOIN #media Bob voice');
      f.ingress(f.end(0));
    } });
    const first = await f.service.refresh(context);
    expect(first.recording.rosterState).toBe('stale');
    expect(first.recording.reason).toBe('membership-changed-during-request');
    const nextContext = { ...context, requestId: 'request-bcdefghijklmnopq' as RequestId };
    const next = f.service.refresh(nextContext);
    expect(f.sent).toHaveLength(2);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    expect((await next).recording.rosterState).toBe('complete');
    f.service.dispose();
  });

  it('invalidates a roster if another row arrives after its end while the digest is pending', async () => {
    const f = fixture();
    const pending = f.service.refresh(context);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    expect(f.ingress(f.roster('Bob', 1))).toBe(true);
    const result = await pending;
    expect(result.recording.rosterState).toBe('stale');
    expect(result.recording.allConsented).toBeNull();
    expect(result.recording.policyRevision).toBeNull();
    expect(result.recording.reason).toBe('roster-data-after-end');
    const blocked = await f.service.refresh({ ...context, requestId: 'request-bcdefghijklmnopq' as RequestId });
    expect(blocked.recording.reason).toBe('roster-drain-pending');
    expect(f.sent).toHaveLength(1);
    expect(f.ingress(f.end(2))).toBe(true);
    const clean = f.service.refresh({ ...context, requestId: 'request-cdefghijklmnopqr' as RequestId });
    expect(f.sent).toHaveLength(2);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    expect((await clean).recording.rosterState).toBe('complete');
    f.service.dispose();
  });

  it('drains an unresolved roster boundary before a new call ref can refresh the same physical room', async () => {
    const f = fixture();
    const oldPending = f.service.refresh(context);
    const oldTimer = [...f.timers.values()][0];
    oldTimer?.();
    expect((await oldPending).recording.requestState).toBe('unknown');

    const nextCall = 'call-qrstuvwxyzabcdef' as MediaCallRef;
    f.setCurrentCallRef(nextCall);
    const nextContext = { ...context, callRef: nextCall, requestId: 'request-bcdefghijklmnopq' as RequestId };
    const blocked = await f.service.refresh(nextContext);
    expect(blocked.recording.rosterState).toBe('stale');
    expect(blocked.recording.reason).toBe('roster-drain-pending');
    expect(f.sent).toHaveLength(1);

    expect(f.ingress(f.roster('Alice', 1))).toBe(true);
    expect(f.ingress(f.end(1))).toBe(true);
    const refreshed = f.service.refresh({ ...nextContext, requestId: 'request-cdefghijklmnopqr' as RequestId });
    expect(f.sent).toHaveLength(2);
    f.ingress(f.roster('Alice', 1));
    f.ingress(f.end(1));
    expect((await refreshed).recording.rosterState).toBe('complete');
    f.service.dispose();
  });
});
