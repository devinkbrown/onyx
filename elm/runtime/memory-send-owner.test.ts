import { describe, expect, it } from 'vitest';
import { createMemorySendOwner, type MemoryChatIntent, type MemorySendPolicy } from './memory-send-owner';
import type { OwnerSnapshot, RequestContext } from './contracts';

const owner: OwnerSnapshot = {
  networkId: 'network' as OwnerSnapshot['networkId'], accountId: null,
  accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 2 as OwnerSnapshot['connectionGeneration'],
  physicalRef: '0123456789abcdef0123456789abcdef' as OwnerSnapshot['physicalRef'],
  ownerRef: '0123456789abcdef0123456789abcdef' as OwnerSnapshot['ownerRef'],
};
const context: RequestContext = { schemaVersion: 1, requestId: '0123456789abcdef0123456789abcdef' as RequestContext['requestId'], owner };
const intent = (overrides: Partial<MemoryChatIntent> = {}): MemoryChatIntent => ({
  operation: 'privmsg', clientIntentId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as MemoryChatIntent['clientIntentId'],
  conversationId: '#room' as MemoryChatIntent['conversationId'], targetKey: '#room', messageKind: 'message',
  replyTo: null, audiencePrefix: null, body: new TextEncoder().encode('hello'), ...overrides,
});
const policy: MemorySendPolicy = { owner, targetKind: 'channel', networkReady: true, encryption: 'plain',
  policyRevision: 'plain-v1', mappingRevision: 'irc-casemapping-v1:rfc1459', policyGeneration: 1,
  channelMembership: 'joined', canSend: true };
const plan = { lines: ['PRIVMSG #room :hello'], validationReceipt: Symbol('source-plan'), planHash: 'a'.repeat(64) };

function fixture(overrides: Partial<Parameters<typeof createMemorySendOwner>[0]> = {}) {
  let calls = 0;
  const currentPolicy = { ...policy };
  const service = createMemorySendOwner({ ownerSnapshot: () => owner, isCurrent: () => true, isRegistered: () => true,
    policySnapshot: () => currentPolicy,
    prepareLivePlan: async () => plan,
    validatePreparedPlan: () => true,
    sendLineGroup: () => { calls++; return [{ kind: 'transport-admitted' }]; },
    verifyAcceptanceProof: () => true, onObservation: () => undefined, now: () => 10,
    ...overrides,
  });
  return { service, calls: () => calls, currentPolicy };
}

describe('volatile plaintext send owner', () => {
  it('deduplicates full intents and never resubmits an admitted guest message', async () => {
    const f = fixture(); const first = await f.service.submit({ context, intent: intent() });
    const duplicate = await f.service.submit({ context, intent: intent() });
    expect(first.status).toBe('transport-admitted');
    expect(duplicate.status).toBe('transport-admitted');
    expect(f.calls()).toBe(1);
    expect(await f.service.reconcileAccepted({ context, recordId: first.recordId, proofRef: Symbol('proof') })).toMatchObject({ status: 'server-accepted' });
    expect(f.service.inspect(context)).toHaveLength(1);
  });

  it('treats a changed reply or audience as an intent conflict', async () => {
    const f = fixture(); await f.service.submit({ context, intent: intent() });
    const conflict = await f.service.submit({ context, intent: intent({ audiencePrefix: '@' }) });
    expect(conflict.status).toBe('intent-conflict');
    expect(f.calls()).toBe(1);
  });

  it('accepts only the server-advertised STATUSMSG prefix alphabet', async () => {
    for (const [index, prefix] of ['!', '.', '@', '+'].entries()) {
      const f = fixture();
      const result = await f.service.submit({ context, intent: intent({
        clientIntentId: `prefixintent000000000${index}` as MemoryChatIntent['clientIntentId'], audiencePrefix: prefix,
      }) });
      expect(result.status).toBe('transport-admitted');
      f.service.dispose();
    }
    const f = fixture({ prepareLivePlan: async ({ intent: submitted }) => submitted.audiencePrefix === '~' ? null : plan });
    const notAdvertised = await f.service.submit({ context, intent: intent({ audiencePrefix: '~',
      clientIntentId: 'prefixintent0000000009' as MemoryChatIntent['clientIntentId'] }) });
    expect(notAdvertised).toMatchObject({ status: 'blocked', reason: 'policy' });
    f.service.dispose();
  });

  it('keeps partial admission unknown and never automatically resends it', async () => {
    let calls = 0;
    const f = fixture({ prepareLivePlan: async () => ({ ...plan, lines: ['PRIVMSG #room :one', 'PRIVMSG #room :two'] }),
      sendLineGroup: () => { calls++; return [{ kind: 'transport-admitted' }, { kind: 'blocked', reason: 'backpressure' }]; } });
    const first = await f.service.submit({ context, intent: intent() });
    const retry = await f.service.submit({ context, intent: intent() });
    expect(first.status).toBe('delivery-unknown');
    expect(retry.status).toBe('delivery-unknown');
    expect(calls).toBe(1);
  });

  it('rechecks plaintext policy after asynchronous plan preparation', async () => {
    let release!: () => void; let signalStarted!: () => void; let calls = 0;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const f = fixture({ prepareLivePlan: () => new Promise((resolve) => { release = () => resolve(plan); signalStarted(); }),
      sendLineGroup: () => { calls++; return [{ kind: 'transport-admitted' }]; } });
    const pending = f.service.submit({ context, intent: intent() });
    await started;
    f.currentPolicy.encryption = 'room-required';
    release();
    expect((await pending).status).toBe('blocked');
    expect(calls).toBe(0);
  });

  it('blocks volatile sends while offline without invoking the wire planner', async () => {
    let plans = 0;
    const f = fixture({ policySnapshot: () => ({ ...policy, networkReady: false }),
      prepareLivePlan: async () => { plans++; return plan; } });
    const result = await f.service.submit({ context, intent: intent() });
    expect(result).toMatchObject({ status: 'blocked', reason: 'offline', durability: 'volatile' });
    expect(plans).toBe(0);
  });

  it('does not let a retired owner continuation admit or publish a plan', async () => {
    let release!: () => void; let signalStarted!: () => void; let calls = 0; let observations = 0;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const f = fixture({ prepareLivePlan: () => new Promise((resolve) => { release = () => resolve(plan); signalStarted(); }),
      sendLineGroup: () => { calls++; return [{ kind: 'transport-admitted' }]; }, onObservation: () => { observations++; } });
    const pending = f.service.submit({ context, intent: intent() });
    await started;
    f.service.retireOwner(owner);
    release();
    expect((await pending).status).toBe('stale-owner');
    expect(calls).toBe(0);
    expect(observations).toBe(0);
    expect(f.service.inspect(context)).toEqual([]);
  });

  it('accepts an authentic synchronous proof while the fenced sender is returning', async () => {
    let service: ReturnType<typeof createMemorySendOwner>;
    service = createMemorySendOwner({ ownerSnapshot: () => owner, isCurrent: () => true, isRegistered: () => true,
      policySnapshot: () => policy, prepareLivePlan: async () => plan, validatePreparedPlan: () => true,
      sendLineGroup: ({ context: attempt, recordId }) => {
        void service.reconcileAccepted({ context: attempt, recordId, proofRef: Symbol('real-registered-proof') });
        return [{ kind: 'transport-admitted' }];
      }, verifyAcceptanceProof: () => true, onObservation: () => undefined, now: () => 10 });
    const result = await service.submit({ context, intent: intent() });
    expect(result.status).toBe('server-accepted');
  });
});
