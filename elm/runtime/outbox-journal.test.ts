import { describe, expect, it, vi } from 'vitest';
import type { OwnerSnapshot, RequestContext, SendAdmission } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { createOutboxJournal, type QueueIntent, type QueueProjectionIntent } from './outbox-journal';
import { createTransportOwner } from './transport-owner';
import { OWNED_OUTBOX, openVaultV5 } from './migrations';
import type { ScheduledPolicySnapshot } from './scheduled-custody';

const owner: OwnerSnapshot = {
  networkId: 'network' as OwnerSnapshot['networkId'],
  accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
  accountGeneration: 4 as OwnerSnapshot['accountGeneration'],
  connectionGeneration: 7 as OwnerSnapshot['connectionGeneration'],
  physicalRef: null,
  ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const request: RequestContext = {
  schemaVersion: 1,
  requestId: '0123456789abcdef0123456789abcdef' as RequestContext['requestId'],
  owner,
};
const ticket: LocalNamespaceTicket = {
  scope: {
    kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null,
    workspaceRef: 'workspace-a', installationDeviceId: 'device-a', localWorkspaceEpoch: 1,
  },
  ownerKey: 'local-account-a', workspaceEpoch: 1,
  conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
};

async function commitment(intent: QueueIntent): Promise<string> {
  const operation = intent.operation;
  const target = operation === 'privmsg' ? intent.conversationId : intent.recipientAccount;
  const kind = intent.messageKind ?? 'message';
  const reply = operation === 'privmsg' ? intent.replyTo ?? null : null;
  const audience = operation === 'privmsg' ? intent.audiencePrefix ?? null : null;
  const bytes = new TextEncoder().encode(JSON.stringify([2, operation, target.toLowerCase(), kind, reply, audience, intent.body]));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  bytes.fill(0);
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fixture(options: {
  readonly lines?: readonly string[];
  readonly admissions?: readonly SendAdmission[];
  readonly onSend?: (line: string) => void;
  readonly namespaceCurrent?: () => boolean;
  readonly validReceipt?: () => boolean;
  readonly observeAdmission?: (input: { readonly recordId: string; readonly claimNonce: string; readonly planHash: string; readonly kind: 'transport-admitted' | 'blocked' | 'unknown' }) => void;
  readonly scheduledPolicySnapshot?: () => ScheduledPolicySnapshot | null;
  readonly projectionPolicyRevision?: string;
  readonly onPrepare?: () => void;
  readonly onPolicySnapshot?: (intent: QueueProjectionIntent, target: string) => void;
  readonly ownerSnapshot?: () => OwnerSnapshot;
} = {}) {
  let id = 0;
  let sends = 0;
  const sendLine = vi.fn(({ line }: { readonly line: string }) => {
    if (options.namespaceCurrent && !options.namespaceCurrent()) return { kind: 'blocked', reason: 'owner-changed' } as const;
    options.onSend?.(line);
    const admission = options.admissions?.[sends] ?? { kind: 'transport-admitted' as const };
    sends += 1;
    return admission;
  });
  const sendLineGroup = vi.fn(({ lines }: { readonly lines: readonly string[] }) => {
    const results: SendAdmission[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) break;
      const admission = sendLine({ line });
      results.push(admission);
      if (admission.kind !== 'transport-admitted') {
        for (let rest = index + 1; rest < lines.length; rest += 1) results.push({ kind: 'blocked', reason: 'offline' });
        break;
      }
    }
    return results;
  });
  const prepareQueuedPayload = vi.fn(async (intent: QueueProjectionIntent) => {
    options.onPrepare?.();
    return {
      kind: 'ready' as const,
      payload: {
        kind: 'sealed-local-plaintext' as const,
        ciphertext: new Uint8Array(40).fill(7),
        payloadCommitment: await commitment(intent),
      },
      policyRevision: options.projectionPolicyRevision ?? 'policy-plain-a',
    };
  });
  const prepareDispatch = vi.fn(async () => ({
    kind: 'ready' as const,
    lines: options.lines ?? ['PRIVMSG #room :hello'],
    validationReceipt: 'opaque-private-receipt',
  }));
  const journal = createOutboxJournal({
    ownerSnapshot: () => options.ownerSnapshot?.() ?? owner,
    isCurrent: () => true,
    namespaceForRequest: () => ticket,
    isNamespaceCurrent: () => options.namespaceCurrent?.() ?? true,
    transport: { sendLineGroup },
    policySnapshot: (intent, _ticket, target) => {
      options.onPolicySnapshot?.(intent, target);
      return { ownerProven: true, policyGeneration: 1, channelMembership: 'joined', encryption: 'plain', canSend: true, networkReady: true, offlineMemoAllowed: true };
    },
    ...(options.scheduledPolicySnapshot ? { scheduledPolicySnapshot: () => options.scheduledPolicySnapshot?.() ?? null } : {}),
    canonicalConversationKey: (_owner, target) => target.toLowerCase(),
    prepareQueuedPayload,
    prepareDispatch,
    validatePreparedDispatch: () => options.validReceipt?.() ?? true,
    withDispatchGroup: async (_request, _ticket, run) => run(),
    memoCorrelationClear: () => true,
    verifyAcceptanceProof: () => false,
    ...(options.observeAdmission ? { observeAcceptanceAdmission: options.observeAdmission } : {}),
    randomId: () => `record-${++id}`,
  });
  const queue = (patch: Partial<{ body: string; replyTo: string | null; messageKind: 'message' | 'action'; audiencePrefix: string | null; clientIntentId: RequestContext['requestId'] }> = {}) => journal.queueMessage({
    ...request, clientIntentId: request.requestId, operation: 'privmsg', conversationId: '#room', body: 'hello', ...patch,
  } as QueueIntent);
  return { journal, queue, sendLine, sendLineGroup, prepareQueuedPayload, prepareDispatch };
}

const scheduledPolicy: ScheduledPolicySnapshot = {
  kind: 'known', semanticRevision: 'policy-plain-a', privacy: 'plain', peerAccountId: null, policyBinding: 'target-policy-binding-a',
};
function scheduledQueueIntent(capturedPolicy: ScheduledPolicySnapshot) {
  return { ...request, clientIntentId: request.requestId, operation: 'privmsg' as const, conversationId: '#room', body: 'scheduled body', capturedPolicy };
}

describe('outbox journal line-group admission', () => {
  it('passes account-targeted memo identity into metadata sampling without converting it to a conversation', async () => {
    const sampled: Array<{ operation: QueueProjectionIntent['operation']; target: string; ownerAccount: string | null }> = [];
    const f = fixture({ onPolicySnapshot: (intent, target) => sampled.push({
      operation: intent.operation, target, ownerAccount: intent.owner.accountId,
    }) });
    const recipientAccount = 'recipientacct' as NonNullable<OwnerSnapshot['accountId']>;
    const result = await f.journal.queueMemo({ ...request, clientIntentId: request.requestId,
      operation: 'memo-send', recipientAccount, body: 'private memo' });

    expect(result.status).toBe('queued');
    expect(sampled).toEqual([{ operation: 'memo-send', target: recipientAccount, ownerAccount: owner.accountId }]);
    f.journal.dispose();
  });

  it('admits a scheduled row only when its frozen captured policy matches the trusted live snapshot and projection', async () => {
    const f = fixture({ scheduledPolicySnapshot: () => scheduledPolicy });
    const result = await f.journal.queueScheduledMessage(scheduledQueueIntent(scheduledPolicy));

    expect(result.status).toBe('queued');
    expect(f.prepareQueuedPayload).toHaveBeenCalledWith(expect.objectContaining({ capturedPolicy: scheduledPolicy }), ticket);
    f.journal.dispose();
  });

  it('rejects scheduled policy changes during payload preparation without committing a row', async () => {
    let currentPolicy: ScheduledPolicySnapshot | null = scheduledPolicy;
    const changedPolicy: ScheduledPolicySnapshot = { ...scheduledPolicy, semanticRevision: 'policy-plain-b', policyBinding: 'target-policy-binding-b' };
    const f = fixture({
      scheduledPolicySnapshot: () => currentPolicy,
      onPrepare: () => { currentPolicy = changedPolicy; },
    });
    const result = await f.journal.queueScheduledMessage(scheduledQueueIntent(scheduledPolicy));

    expect(result.status).toBe('blocked');
    expect(f.prepareQueuedPayload).toHaveBeenCalledTimes(1);
    f.journal.dispose();
  });

  it('holds a known scheduled policy when the provider projection has a different revision', async () => {
    const f = fixture({ scheduledPolicySnapshot: () => scheduledPolicy, projectionPolicyRevision: 'another-policy-revision' });
    const result = await f.journal.queueScheduledMessage(scheduledQueueIntent(scheduledPolicy));

    expect(result.status).toBe('invalid');
    f.journal.dispose();
  });

  it('notifies private acceptance correlation only after durable admission state is committed', async () => {
    const observations: Array<{ kind: string; recordId: string }> = [];
    const f = fixture({ observeAdmission: ({ kind, recordId }) => observations.push({ kind, recordId }) });
    const queued = await f.queue();
    expect(queued.status).toBe('queued');
    expect(observations).toEqual([]);
    expect((await f.journal.retryQueued(request, queued.recordId!)).status).toBe('transport-admitted');
    expect(observations).toEqual([{ kind: 'transport-admitted', recordId: queued.recordId }]);
    f.journal.dispose();
  });

  it('admits a complete multiline group in order and only then marks it admitted', async () => {
    const lines = ['BATCH +b1 draft/multiline #room', '@batch=b1 PRIVMSG #room :first', 'BATCH -b1'];
    const f = fixture({ lines });
    const queued = await f.queue({ body: 'first\nsecond', replyTo: 'server-message-1', messageKind: 'action' });
    expect(queued.status).toBe('queued');

    const result = await f.journal.retryQueued(request, queued.recordId!);
    const listed = await f.journal.listEntries(request);

    expect(result.status).toBe('transport-admitted');
    expect(f.sendLine.mock.calls.map(([call]) => call.line)).toEqual(lines);
    expect(listed.entries[0]?.state).toBe('transport-admitted');
    f.journal.dispose();
  });

  it('keeps an encrypted multiline semantic payload as one already prepared wire line', async () => {
    const envelopeLine = 'PRIVMSG #room :+onyx-e2ee-ciphertext-envelope';
    const f = fixture({ lines: [envelopeLine] });
    const queued = await f.queue({ body: 'first\nsecond', messageKind: 'action' });

    const result = await f.journal.retryQueued(request, queued.recordId!);

    expect(result.status).toBe('transport-admitted');
    expect(f.sendLineGroup).toHaveBeenCalledWith({ lines: [envelopeLine], requestId: request.requestId, owner });
    f.journal.dispose();
  });

  it.each([1, 2])('keeps a partially admitted group unknown when the next line is blocked after %i admissions', async (admittedLines) => {
    const f = fixture({
      lines: ['BATCH +b1 draft/multiline #room', '@batch=b1 PRIVMSG #room :first', 'BATCH -b1'],
      admissions: [
        ...Array.from({ length: admittedLines }, () => ({ kind: 'transport-admitted' as const })),
        { kind: 'blocked', reason: 'backpressure' },
      ],
    });
    const queued = await f.queue({ body: 'first\nsecond' });

    const result = await f.journal.retryQueued(request, queued.recordId!);
    const retry = await f.journal.retryQueued(request, queued.recordId!);
    const listed = await f.journal.listEntries(request);

    expect(result.status).toBe('delivery-unknown');
    expect(retry.processed).toBe(0);
    expect(f.sendLine).toHaveBeenCalledTimes(admittedLines + 1);
    expect(listed.entries[0]?.state).toBe('delivery-unknown');
    f.journal.dispose();
  });

  it('retains queued state after definite zero-write backpressure', async () => {
    const f = fixture({ admissions: [{ kind: 'blocked', reason: 'backpressure' }] });
    const queued = await f.queue({ body: 'zero write' });

    const result = await f.journal.retryQueued(request, queued.recordId!);
    const listed = await f.journal.listEntries(request);

    expect(result.status).toBe('blocked');
    expect(listed.entries[0]?.state).toBe('queued-held');
    f.journal.dispose();
  });

  it('turns owner loss after one admitted line into an uncertainty record', async () => {
    let current = true;
    const f = fixture({
      lines: ['BATCH +b1 draft/multiline #room', '@batch=b1 PRIVMSG #room :first', 'BATCH -b1'],
      namespaceCurrent: () => current,
      onSend: () => { current = false; },
    });
    const queued = await f.queue({ body: 'first\nsecond' });

    const result = await f.journal.retryQueued(request, queued.recordId!);

    expect(result.status).toBe('delivery-unknown');
    expect(f.sendLine).toHaveBeenCalledTimes(2);
    f.journal.dispose();
  });

  it('rejects duplicate client intent IDs whose reply or action metadata changed', async () => {
    const f = fixture();
    const first = await f.queue({ body: 'same', replyTo: 'message-a', messageKind: 'message' });
    const conflict = await f.queue({ body: 'same', replyTo: 'message-b', messageKind: 'action' });

    expect(first.status).toBe('queued');
    expect(conflict.status).toBe('intent-conflict');
    expect(f.prepareQueuedPayload).toHaveBeenCalledTimes(2);
    f.journal.dispose();
  });

  it('accepts 4096 emoji by UTF-8 byte bound and rejects control bytes without truncation', async () => {
    const f = fixture();
    const large = await f.queue({ body: '😀'.repeat(4096) });
    const bad = await f.queue({ clientIntentId: '1123456789abcdef0123456789abcdef' as QueueIntent['clientIntentId'], body: `safe\u0001bad` });

    expect(large.status).toBe('queued');
    expect(bad.status).toBe('invalid');
    f.journal.dispose();
  });

  it('counts IRC tags and target prefix in actual UTF-8 wire-line bounds', async () => {
    // 16,384 emoji are exactly 65,536 UTF-8 body bytes; IRC tags and the
    // target prefix push the complete wire line over the 64 KiB limit.
    const taggedLine = `@+draft/reply=${'x'.repeat(96)} PRIVMSG @#room :${'😀'.repeat(16_384)}`;
    const f = fixture({ lines: [taggedLine] });
    const queued = await f.queue({ body: '😀'.repeat(16_384), replyTo: 'parent-id', audiencePrefix: '@' });

    const result = await f.journal.retryQueued(request, queued.recordId!);

    expect(result.status).toBe('blocked');
    expect(f.sendLineGroup).not.toHaveBeenCalled();
    f.journal.dispose();
  });

  it('does not write any part when the private dispatch receipt rejects the prepared group', async () => {
    const f = fixture({ lines: ['PRIVMSG #room :hello'], validReceipt: () => false });
    const queued = await f.queue();

    const result = await f.journal.retryQueued(request, queued.recordId!);

    expect(result.status).toBe('blocked');
    expect(f.sendLine).not.toHaveBeenCalled();
    f.journal.dispose();
  });

  it('retains legacy rows without an attempt field as uncertain and never requeues them', async () => {
    const f = fixture();
    const queued = await f.queue();
    const opened = await openVaultV5({ indexedDB: globalThis.indexedDB });
    expect(opened.kind).toBe('ready');
    if (opened.kind !== 'ready') { f.journal.dispose(); return; }
    const db = opened.database;
    const transaction = db.transaction(OWNED_OUTBOX, 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('idb-write-failed'));
    });
    const key = JSON.stringify([ticket.ownerKey, queued.recordId]);
    const get = transaction.objectStore(OWNED_OUTBOX).get(key);
    get.onsuccess = () => {
      const row = get.result as Record<string, unknown>;
      delete row.dispatchAttempt;
      row.state = 'delivery-unknown';
      transaction.objectStore(OWNED_OUTBOX).put(row);
    };
    await done;
    db.close();

    const listed = await f.journal.listEntries(request);
    const retried = await f.journal.flush(request);

    expect(listed.status).toBe('ready');
    expect(listed.entries[0]?.state).toBe('delivery-unknown');
    expect(retried.processed).toBe(0);
    expect(f.sendLineGroup).not.toHaveBeenCalled();
    f.journal.dispose();
  });
});

async function storedRows(): Promise<Array<Record<string, unknown>>> {
  const opened = await openVaultV5({ indexedDB: globalThis.indexedDB });
  if (opened.kind !== 'ready') throw new Error('vault unavailable');
  const transaction = opened.database.transaction(OWNED_OUTBOX, 'readonly');
  const all = transaction.objectStore(OWNED_OUTBOX).getAll();
  const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    all.onsuccess = () => resolve(all.result as Array<Record<string, unknown>>);
    all.onerror = () => reject(all.error ?? new Error('idb-read-failed'));
  });
  opened.database.close();
  return rows;
}

describe('outbox journal uncertainty across reconnects', () => {
  it('never resends an admitted row whose echo was lost when the connection generation changes', async () => {
    let live = owner;
    const f = fixture({ ownerSnapshot: () => live });
    const queued = await f.queue({ body: 'echo lost' });
    const first = await f.journal.flush(request);
    expect(first).toMatchObject({ status: 'transport-admitted', processed: 1 });
    expect(f.sendLine).toHaveBeenCalledTimes(1);

    live = { ...owner, connectionGeneration: 8 as OwnerSnapshot['connectionGeneration'] };
    const staleRequest = await f.journal.flush(request);
    expect(staleRequest.processed).toBe(0);
    const nextRequest: RequestContext = { ...request, requestId: 'fedcba9876543210fedcba9876543210' as RequestContext['requestId'], owner: live };
    const afterReconnect = await f.journal.flush(nextRequest);
    expect(afterReconnect).toMatchObject({ status: 'idle', processed: 0 });
    expect(await f.journal.retryQueued(nextRequest, queued.recordId!)).toMatchObject({ processed: 0 });
    expect(f.sendLine).toHaveBeenCalledTimes(1);
    const listed = await f.journal.listEntries(nextRequest);
    // Admitted-but-unconfirmed: never requeued, never promoted without proof.
    expect(listed.entries.map(entry => entry.state)).toEqual(['transport-admitted']);
    f.journal.dispose();
  });

  it('replaces a delivery-unknown row only through a new, duplicate-risk-confirmed intent', async () => {
    let namespace = true;
    const f = fixture({
      lines: ['BATCH +b1 draft/multiline #room', '@batch=b1 PRIVMSG #room :first', 'BATCH -b1'],
      namespaceCurrent: () => namespace,
      onSend: () => { namespace = false; },
    });
    const queued = await f.queue({ body: 'first\nsecond' });
    expect((await f.journal.retryQueued(request, queued.recordId!)).status).toBe('delivery-unknown');
    namespace = true;
    const sendsBefore = f.sendLine.mock.calls.length;
    const oldRecordId = queued.recordId!;
    const retryRequestId = 'aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb' as RequestContext['requestId'];
    const newIntent = (clientIntentId: RequestContext['requestId'], body = 'first\nsecond'): QueueIntent => ({
      ...request, requestId: retryRequestId, clientIntentId, operation: 'privmsg', conversationId: '#room', body,
    } as QueueIntent);
    const retryContext = { ...request, requestId: retryRequestId, oldRecordId };

    expect(await f.journal.retryUnknown({ ...retryContext, newIntent: newIntent(request.requestId), duplicateRiskConfirmed: true }))
      .toMatchObject({ status: 'invalid', recordId: null });
    const unconfirmed = { ...retryContext, newIntent: newIntent(retryRequestId) } as unknown as Parameters<typeof f.journal.retryUnknown>[0];
    expect(await f.journal.retryUnknown(unconfirmed)).toMatchObject({ status: 'stale-owner', recordId: null });
    expect(await f.journal.retryUnknown({ ...retryContext, newIntent: newIntent(retryRequestId, 'different body'), duplicateRiskConfirmed: true }))
      .toMatchObject({ status: 'intent-conflict', recordId: null });
    expect((await f.journal.listEntries(request)).entries).toHaveLength(1);

    const replaced = await f.journal.retryUnknown({ ...retryContext, newIntent: newIntent(retryRequestId), duplicateRiskConfirmed: true });
    expect(replaced.status).toBe('queued');
    expect(replaced.recordId).not.toBe(oldRecordId);
    const rows = await storedRows();
    const fresh = rows.find(row => row.id === JSON.stringify([ticket.ownerKey, replaced.recordId]));
    const old = rows.find(row => row.id === JSON.stringify([ticket.ownerKey, oldRecordId]));
    expect(fresh).toMatchObject({ state: 'queued', retryOfRecordId: oldRecordId, clientIntentId: retryRequestId });
    expect(old).toMatchObject({ state: 'delivery-unknown' });
    // Queueing the replacement writes nothing to the wire by itself.
    expect(f.sendLine.mock.calls.length).toBe(sendsBefore);
    f.journal.dispose();
  });
});

describe('E12 buffered disconnect through the real transport owner', () => {
  it('keeps a mid-group socket close delivery-unknown and never resends it after the namespace returns on a new socket', async () => {
    const lines = ['BATCH +b1 draft/multiline #room', '@batch=b1 PRIVMSG #room :first', 'BATCH -b1'];
    type Fake = { readyState: number; protocol: string; bufferedAmount: number; binaryType: string; sent: string[]; listeners: Map<string, Array<() => void>> };
    const sockets: Fake[] = [];
    const transport = createTransportOwner({
      currentOwner: () => owner, isCurrentOwner: () => true, authenticatedPrefix: () => 'irc.transport.test',
      endpoint: () => 'endpoint' as never,
      socketFactory: () => {
        const socket: Fake = { readyState: 0, protocol: 'text.ircv3.net', bufferedAmount: 0, binaryType: 'blob', sent: [], listeners: new Map() };
        sockets.push(socket);
        return Object.assign(socket, {
          addEventListener(name: string, listener: () => void) { socket.listeners.set(name, [...(socket.listeners.get(name) ?? []), listener]); },
          close() { socket.readyState = 3; },
          send(value: string) {
            socket.sent.push(value);
            // The peer drops the connection right after the second line is buffered.
            if (sockets.length === 1 && socket.sent.length === 2) socket.readyState = 3;
          },
        }) as unknown as WebSocket;
      },
      consumePrivateLine: () => false, onPublicLine() {}, onBinary() {}, onState() {},
    });
    const open = (socket: Fake) => { socket.readyState = 1; for (const listener of socket.listeners.get('open') ?? []) listener(); };
    transport.connect('wss://a.transport.test/irc');
    open(sockets[0]!);

    let namespaceCurrent = true;
    const groupResults: SendAdmission[][] = [];
    const sendLineGroup = vi.fn((intent: Parameters<typeof transport.sendLineGroup>[0]) => {
      const results = transport.sendLineGroup(intent);
      groupResults.push([...results]);
      return results;
    });
    let id = 0;
    const journal = createOutboxJournal({
      ownerSnapshot: () => owner,
      isCurrent: () => true,
      namespaceForRequest: () => ticket,
      isNamespaceCurrent: () => namespaceCurrent,
      transport: { sendLineGroup },
      policySnapshot: () => ({ ownerProven: true, policyGeneration: 1, channelMembership: 'joined', encryption: 'plain', canSend: true, networkReady: true, offlineMemoAllowed: true }),
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      prepareQueuedPayload: async (intent) => ({
        kind: 'ready' as const,
        payload: { kind: 'sealed-local-plaintext' as const, ciphertext: new Uint8Array(40).fill(7), payloadCommitment: await commitment(intent as QueueIntent) },
        policyRevision: 'policy-plain-a',
      }),
      prepareDispatch: async () => ({ kind: 'ready' as const, lines, validationReceipt: 'opaque-private-receipt' }),
      validatePreparedDispatch: () => true,
      withDispatchGroup: async (_request, _ticket, run) => run(),
      memoCorrelationClear: () => true,
      verifyAcceptanceProof: () => false,
      randomId: () => `record-${++id}`,
    });

    const queued = await journal.queueMessage({ ...request, clientIntentId: request.requestId, operation: 'privmsg', conversationId: '#room', body: 'first\nsecond' } as QueueIntent);
    const first = await journal.retryQueued(request, queued.recordId!);
    for (const listener of sockets[0]!.listeners.get('close') ?? []) listener();

    namespaceCurrent = false;
    const whileStale = await journal.flush(request);
    namespaceCurrent = true;
    transport.connect('wss://b.transport.test/irc');
    open(sockets[1]!);
    const afterReturn = await journal.flush(request);
    const retried = await journal.retryQueued(request, queued.recordId!);
    const listed = await journal.listEntries(request);

    expect(first.status).toBe('delivery-unknown');
    expect(groupResults).toEqual([[{ kind: 'transport-admitted' }, { kind: 'transport-admitted' }, { kind: 'blocked', reason: 'offline' }]]);
    expect(sockets[0]!.sent).toEqual(lines.slice(0, 2));
    expect(whileStale.processed).toBe(0);
    expect(afterReturn.processed).toBe(0);
    expect(retried.processed).toBe(0);
    expect(sendLineGroup).toHaveBeenCalledTimes(1);
    expect(sockets[1]!.sent).toEqual([]);
    expect(listed.entries.map(entry => entry.state)).toEqual(['delivery-unknown']);
    journal.dispose();
    transport.dispose();
  });
});
