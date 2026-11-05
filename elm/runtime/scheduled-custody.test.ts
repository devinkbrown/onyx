import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationId, LocalPhysicalEpoch, OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { SCHEDULED, openVaultV5 } from './migrations';
import { createScheduledCustody } from './scheduled-custody';

const owner: OwnerSnapshot = {
  networkId: 'network' as OwnerSnapshot['networkId'], accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
  accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
  physicalRef: null, ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const request: RequestContext = { schemaVersion: 1,
  requestId: '0123456789abcdef0123456789abcdef' as RequestContext['requestId'], owner };
const ticket: LocalNamespaceTicket = { scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!,
  physicalRef: null, workspaceRef: 'workspace', installationDeviceId: 'device', localWorkspaceEpoch: 1 }, ownerKey: 'workspace-owner',
  workspaceEpoch: 1, conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket') };

function setup(outcomes: Array<'accepted' | 'not-accepted' | 'unknown'> = ['accepted'], ticketOverride = ticket,
  policyCheck: () => 'compatible' | 'hold' | 'unavailable' = () => 'compatible',
  capturedPolicy: import('./scheduled-custody').ScheduledPolicySnapshot = { kind: 'unknown' },
  readPrivateInput: (_ref: string, _context: RequestContext, _kind: 'create' | 'edit') => Promise<Uint8Array | null> = async () => new TextEncoder().encode('first line\nsecond\tline'),
  sealPayload: (input: { readonly plaintext: Uint8Array }) => Promise<Uint8Array | null> = async ({ plaintext }) => Uint8Array.from(plaintext, (byte) => byte ^ 0xa5),
  indexedDB: IDBFactory = new IDBFactory()) {
  const journal = vi.fn(async () => outcomes.shift() ?? 'unknown');
  const status = vi.fn(async () => 'unknown' as 'accepted' | 'not-found' | 'unknown');
  const volatileQueue = vi.fn(async () => 'unknown' as 'server-accepted' | 'not-accepted' | 'unknown');
  const volatileReconcile = vi.fn(async () => 'not-found' as 'server-accepted' | 'not-found' | 'unknown');
  const openPayload = vi.fn(async ({ ciphertext }: { ciphertext: Uint8Array }) => Uint8Array.from(ciphertext, (byte) => byte ^ 0xa5));
  const delivered: Uint8Array[] = [];
  let clock = 100;
  const service = createScheduledCustody({ indexedDB, namespaceForRequest: () => ticketOverride, isNamespaceCurrent: () => true,
    canonicalConversationKey: (_owner, target) => target.toLowerCase(),
    readPrivateInput: async (ref, context, kind) => { const bytes = await readPrivateInput(ref, context, kind); if (bytes) delivered.push(bytes); return bytes; },
    seal: sealPayload,
    open: openPayload,
    enqueueJournal: journal, journalStatus: status, now: () => clock,
    enqueueVolatile: volatileQueue, volatileStatus: volatileReconcile,
    capturePolicy: () => capturedPolicy, checkDispatchPolicy: policyCheck,
  });
  return { indexedDB, service, journal, status, volatileQueue, volatileReconcile, openPayload, delivered, setNow: (value: number) => { clock = value; } };
}

async function createScheduled(service: ReturnType<typeof createScheduledCustody>, input: ReturnType<typeof createInput>) {
  const admission = await service.captureCreateAdmission(input, input.operationId);
  if (!admission || !service.bindCreateAdmission(input.inputRef, admission, input)) throw new Error('scheduled admission unavailable');
  return service.create(input);
}

async function storedRows(indexedDB: IDBFactory): Promise<Record<string, unknown>[]> {
  const opened = await openVaultV5({ indexedDB });
  if (opened.kind !== 'ready') throw new Error('vault unavailable');
  const db = opened.database;
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEDULED, 'readonly'); const req = tx.objectStore(SCHEDULED).getAll();
    req.onsuccess = () => resolve(req.result as Record<string, unknown>[]);
    req.onerror = () => reject(req.error);
  });
}
async function rewriteRow(indexedDB: IDBFactory, id: string, update: (row: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const opened = await openVaultV5({ indexedDB });
  if (opened.kind !== 'ready') throw new Error('vault unavailable');
  await new Promise<void>((resolve, reject) => {
    const tx = opened.database.transaction(SCHEDULED, 'readwrite'); const store = tx.objectStore(SCHEDULED);
    const get = store.get(id); get.onsuccess = () => { store.put(update(get.result as Record<string, unknown>)); };
    get.onerror = () => reject(get.error); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
async function injectRawRows(indexedDB: IDBFactory, rows: readonly Record<string, unknown>[]): Promise<void> {
  const opened = await openVaultV5({ indexedDB });
  if (opened.kind !== 'ready') throw new Error('vault unavailable');
  await new Promise<void>((resolve, reject) => {
    const tx = opened.database.transaction(SCHEDULED, 'readwrite'); const store = tx.objectStore(SCHEDULED);
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

const createInput = (context = request) => ({ ...context, inputRef: 'a'.repeat(22), operationId: 'operation-1',
  clientIntentId: 'intent_0123456789abcdef0123' as RequestContext['requestId'], conversationId: '#room' as ConversationId,
  dueAtMs: 200, messageKind: 'message' as const, replyTo: null, audiencePrefix: null });

describe('scheduled custody', () => {
  it('stores ciphertext only and exposes bounded metadata, never message text', async () => {
    const { indexedDB, service, delivered } = setup();
    const saved = await createScheduled(service, createInput());
    expect(saved.status).toBe('saved');
    const rows = await storedRows(indexedDB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('body');
    expect(new TextDecoder().decode(rows[0]?.ciphertext as Uint8Array)).not.toContain('first line');
    expect(delivered.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    const listed = await service.list(request);
    expect(listed.status).toBe('ready');
    expect(JSON.stringify(listed)).not.toContain('first line');
    service.dispose();
  });

  it('keeps empty, malformed, unavailable, and quota outcomes explicit without plaintext fallback', async () => {
    const empty = setup();
    expect((await empty.service.list(request)).rows).toHaveLength(0);
    empty.service.dispose();

    const malformedBytes = setup(['accepted'], ticket, () => 'compatible', { kind: 'unknown' },
      async () => new TextEncoder().encode('bad\u0000body'));
    const malformedInput = createInput({ ...request, requestId: 'malformed-request-000000001' as RequestContext['requestId'] });
    const malformed = await malformedBytes.service.captureCreateAdmission(malformedInput, malformedInput.operationId);
    expect(malformed).not.toBeNull();
    expect(malformedBytes.service.bindCreateAdmission(malformedInput.inputRef, malformed!, malformedInput)).toBe(true);
    expect((await malformedBytes.service.create(malformedInput)).status).toBe('invalid');
    expect(await storedRows(malformedBytes.indexedDB)).toHaveLength(0);
    malformedBytes.service.dispose();

    const unavailableDatabase = new IDBFactory();
    vi.spyOn(unavailableDatabase, 'open').mockImplementation(() => { throw new Error('unavailable'); });
    const unavailable = setup(['accepted'], ticket, () => 'compatible', { kind: 'unknown' }, undefined,
      async ({ plaintext }) => Uint8Array.from(plaintext), unavailableDatabase);
    expect(await unavailable.service.captureCreateAdmission(request, 'operation-unavailable')).toBeNull();
    expect((await unavailable.service.list(request)).status).toBe('unavailable');
    expect(unavailable.delivered).toHaveLength(0);
    unavailable.service.dispose();

    const quota = setup();
    let lastStatus = '';
    for (let index = 0; index < 257; index += 1) {
      const requestId = `${String(index).padStart(32, '0')}` as RequestContext['requestId'];
      const input = { ...createInput({ ...request, requestId }), operationId: `operation-${index}`,
        clientIntentId: `intent_${String(index).padStart(20, '0')}` as RequestContext['requestId'] };
      lastStatus = (await createScheduled(quota.service, input)).status;
    }
    expect(lastStatus).toBe('quota');
    const rows = await storedRows(quota.indexedDB);
    expect(rows).toHaveLength(256);
    expect(rows.every((row) => !Object.hasOwn(row, 'body') && row.ciphertext instanceof Uint8Array)).toBe(true);
    quota.service.dispose();
  });

  it('persists claim before journal enqueue and deletes only after acceptance', async () => {
    const stateAtEnqueue: string[] = [];
    const env = setup();
    const opened = await openVaultV5({ indexedDB: env.indexedDB });
    if (opened.kind !== 'ready') throw new Error('vault unavailable');
    const original = env.journal.getMockImplementation();
    env.journal.mockImplementation(async () => {
      const rows = await storedRows(env.indexedDB);
      stateAtEnqueue.push(String(rows[0]?.state));
      return original ? original() : 'accepted';
    });
    await createScheduled(env.service, createInput());
    env.setNow(300);
    const result = await env.service.dispatch({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(stateAtEnqueue).toEqual(['dispatching']);
    expect(result.status).toBe('journal-accepted');
    expect(await storedRows(env.indexedDB)).toHaveLength(0);
    env.service.dispose();
  });

  it('preserves a schedule after a definitive pre-admission journal rejection', async () => {
    const env = setup(['not-accepted', 'accepted']);
    await createScheduled(env.service, createInput());
    env.setNow(300);
    const first = await env.service.dispatch({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(first.status).toBe('blocked');
    expect(await storedRows(env.indexedDB)).toHaveLength(1);
    const row = (await storedRows(env.indexedDB))[0];
    expect(row?.state).toBe('scheduled');
    expect(row).not.toHaveProperty('body');
    const second = await env.service.dispatch({ ...request, requestId: 'dispatch-retry-0000000000001' as RequestContext['requestId'],
      scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(second.status).toBe('journal-accepted');
    expect(env.journal).toHaveBeenCalledTimes(2);
    env.service.dispose();
  });

  it('allows only one concurrent dispatch claim across service instances', async () => {
    const sharedDatabase = new IDBFactory();
    const first = setup(['accepted'], ticket, () => 'compatible', { kind: 'unknown' }, undefined, undefined, sharedDatabase);
    const second = setup(['accepted'], ticket, () => 'compatible', { kind: 'unknown' }, undefined, undefined, sharedDatabase);
    await createScheduled(first.service, createInput());
    first.setNow(300); second.setNow(300);
    const [left, right] = await Promise.all([
      first.service.dispatch({ ...request, requestId: 'dispatch-left-0000000000001' as RequestContext['requestId'], scheduleRef: 'operation-1', expectedRevision: 1 }),
      second.service.dispatch({ ...request, requestId: 'dispatch-right-000000000001' as RequestContext['requestId'], scheduleRef: 'operation-1', expectedRevision: 1 }),
    ]);
    expect([left.status, right.status].filter((status) => status === 'journal-accepted')).toHaveLength(1);
    expect(first.journal.mock.calls.length + second.journal.mock.calls.length).toBe(1);
    first.service.dispose(); second.service.dispose();
  });

  it('does not resurrect a cross-instance create admitted before another instance cancels', async () => {
    const sharedDatabase = new IDBFactory();
    let releaseReader!: () => void;
    let signalReader!: () => void;
    const readerStarted = new Promise<void>((resolve) => { signalReader = resolve; });
    const readerGate = new Promise<void>((resolve) => { releaseReader = resolve; });
    const slowReader = async () => { signalReader(); await readerGate; return new TextEncoder().encode('stale scheduled body'); };
    const first = setup(['accepted'], ticket, () => 'compatible', { kind: 'unknown' }, slowReader, undefined, sharedDatabase);
    const second = setup(['accepted'], ticket, () => 'compatible', { kind: 'unknown' }, undefined, undefined, sharedDatabase);
    const requestA = { ...request, requestId: 'create-request-0000000000001' as RequestContext['requestId'] };
    const staleInput = { ...createInput(requestA), operationId: 'operation-stale', clientIntentId: 'intent_stale_000000000001' as RequestContext['requestId'] };
    const staleAdmission = await first.service.captureCreateAdmission(requestA, staleInput.operationId);
    expect(staleAdmission).not.toBeNull();
    expect(first.service.bindCreateAdmission(staleInput.inputRef, staleAdmission!, requestA)).toBe(true);
    const staleCreate = first.service.create(staleInput);
    await readerStarted;

    const requestB = { ...request, requestId: 'create-request-0000000000002' as RequestContext['requestId'] };
    const cancellingInput = { ...createInput(requestB), operationId: 'operation-cancelled', clientIntentId: 'intent_cancelled_000001' as RequestContext['requestId'] };
    expect((await createScheduled(second.service, cancellingInput)).status).toBe('saved');
    expect((await second.service.cancel({ ...requestB, scheduleRef: cancellingInput.operationId, expectedRevision: 1 })).status).toBe('cancelled');

    releaseReader();
    expect((await staleCreate).status).toBe('conflict');
    expect((await first.service.create(staleInput)).status).toBe('conflict');
    expect((await first.service.list(requestA)).rows).toHaveLength(0);

    const freshInput = { ...createInput({ ...request, requestId: 'create-request-0000000000003' as RequestContext['requestId'] }),
      operationId: 'operation-fresh', clientIntentId: 'intent_fresh_000000001' as RequestContext['requestId'] };
    expect((await createScheduled(second.service, freshInput)).status).toBe('saved');
    expect((await second.service.list({ ...request, requestId: freshInput.requestId })).rows.map((row) => row.operationId)).toEqual(['operation-fresh']);
    first.service.dispose(); second.service.dispose();
  });

  it('keeps uncertain journal outcomes and reconciles the same immutable intent without resending early', async () => {
    const env = setup(['unknown']);
    await createScheduled(env.service, createInput());
    env.setNow(300);
    const first = await env.service.dispatch({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(first.status).toBe('delivery-unknown');
    expect(env.journal).toHaveBeenCalledTimes(1);
    env.status.mockResolvedValueOnce('unknown');
    const pending = await env.service.reconcile({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(pending.status).toBe('delivery-unknown');
    expect(env.journal).toHaveBeenCalledTimes(1);
    env.status.mockResolvedValueOnce('not-found');
    const absentAfterCrash = await env.service.reconcile({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(absentAfterCrash.status).toBe('delivery-unknown');
    expect(env.journal).toHaveBeenCalledTimes(1);
    env.status.mockResolvedValueOnce('accepted');
    const accepted = await env.service.reconcile({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(accepted.status).toBe('journal-accepted');
    expect(env.journal).toHaveBeenCalledTimes(1);
    env.service.dispose();
  });

  it('status-only reconcile never dispatches a due but unclaimed schedule', async () => {
    const env = setup();
    await createScheduled(env.service, createInput());
    env.setNow(300);
    const checked = await env.service.reconcile({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(checked.status).toBe('not-dispatched');
    expect(env.journal).not.toHaveBeenCalled();
    expect(env.status).not.toHaveBeenCalled();
    expect(env.openPayload).not.toHaveBeenCalled();
    expect((await storedRows(env.indexedDB))).toHaveLength(1);
    env.service.dispose();
  });

  it('uses revision compare-and-swap for edits and rejects guest/read-only durable writes', async () => {
    const env = setup();
    await createScheduled(env.service, createInput());
    const edited = await env.service.edit({ ...request, inputRef: 'b'.repeat(22), scheduleRef: 'operation-1',
      expectedRevision: 1, dueAtMs: 300, messageKind: 'action', replyTo: null, audiencePrefix: '!' });
    expect(edited.status).toBe('edited');
    const stale = await env.service.cancel({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(stale.status).toBe('conflict');
    const fresh = await env.service.cancel({ ...request, scheduleRef: 'operation-1', expectedRevision: 2 });
    expect(fresh.status).toBe('cancelled');
    env.service.dispose();

    const guestTicket: LocalNamespaceTicket = { ...ticket, scope: { kind: 'guest', networkId: owner.networkId,
      accountId: null, physicalRef: 'physical-epoch' as NonNullable<OwnerSnapshot['physicalRef']>, workspaceRef: 'guest',
      installationDeviceId: 'device', localWorkspaceEpoch: 1 } };
    const guestEnv = setup(['accepted'], guestTicket);
    const guestResult = await guestEnv.service.create(createInput());
    expect(guestResult.status).toBe('stale-owner');
    expect(await storedRows(guestEnv.indexedDB)).toHaveLength(0);
    guestEnv.service.dispose();
    const readOnlyEnv = setup(['accepted'], { ...ticket, access: 'read-only' });
    expect((await readOnlyEnv.service.create(createInput())).status).toBe('stale-owner');
    readOnlyEnv.service.dispose();
  });

  it('keeps guest schedules only in the current physical RAM scope and never retries ambiguous dispatch', async () => {
    const guestOwner: OwnerSnapshot = { ...owner, accountId: null,
      physicalRef: '0123456789abcdef0123456789abcdef' as LocalPhysicalEpoch,
      ownerRef: 'guest-owner-0123456789abcd' as OwnerSnapshot['ownerRef'] };
    const guestTicket: LocalNamespaceTicket = { ...ticket, ownerKey: 'guest-physical-epoch', access: 'read-write',
      scope: { kind: 'guest', networkId: owner.networkId, accountId: null, physicalRef: guestOwner.physicalRef!,
        workspaceRef: 'guest', installationDeviceId: 'device', localWorkspaceEpoch: 2 } };
    const guestRequest: RequestContext = { ...request, requestId: 'guest-request-0123456789abc' as RequestContext['requestId'], owner: guestOwner };
    const env = setup(['accepted'], guestTicket);
    const made = await createScheduled(env.service, createInput(guestRequest));
    expect(made.status).toBe('saved'); expect(made.mode).toBe('volatile');
    const listing = await env.service.list(guestRequest);
    expect(listing.mode).toBe('volatile'); expect(listing.rows[0]?.mode).toBe('volatile');
    expect(await storedRows(env.indexedDB)).toHaveLength(0);
    env.setNow(300);
    const unknown = await env.service.dispatch({ ...guestRequest, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(unknown.status).toBe('delivery-unknown');
    expect(env.volatileQueue).toHaveBeenCalledTimes(1);
    const again = await env.service.dispatch({ ...guestRequest, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(again.status).toBe('delivery-unknown');
    expect(env.volatileQueue).toHaveBeenCalledTimes(1);
    env.service.retireOwner(guestOwner);
    expect((await env.service.list(guestRequest)).rows).toHaveLength(0);
    env.service.dispose();
  });

  it('binds ciphertext to the exact edit revision and refuses rollback substitution', async () => {
    const env = setup();
    await createScheduled(env.service, createInput());
    const original = await storedRows(env.indexedDB);
    const oldCiphertext = (original[0]?.ciphertext as Uint8Array).slice();
    const edited = await env.service.edit({ ...request, inputRef: 'b'.repeat(22), scheduleRef: 'operation-1',
      expectedRevision: 1, dueAtMs: 300, messageKind: 'message', replyTo: null, audiencePrefix: null });
    expect(edited.status).toBe('edited');
    await rewriteRow(env.indexedDB, String(original[0]?.id), (row) => ({ ...row, ciphertext: oldCiphertext }));
    env.setNow(400);
    const result = await env.service.dispatch({ ...request, scheduleRef: 'operation-1', expectedRevision: 2 });
    expect(result.status).toBe('unavailable');
    expect(env.journal).not.toHaveBeenCalled();
    oldCiphertext.fill(0); env.service.dispose();
  });

  it('holds a known policy snapshot when current privacy or peer binding no longer matches', async () => {
    let compatible: 'compatible' | 'hold' = 'compatible';
    const env = setup(['accepted'], ticket, () => compatible, { kind: 'known', semanticRevision: 'policy-v1', privacy: 'plain',
      peerAccountId: null, policyBinding: 'network-target-policy-peer-v1' });
    await createScheduled(env.service, createInput());
    compatible = 'hold'; env.setNow(300);
    const result = await env.service.dispatch({ ...request, scheduleRef: 'operation-1', expectedRevision: 1 });
    expect(result.status).toBe('policy-review');
    expect(env.journal).not.toHaveBeenCalled();
    const listing = await env.service.list(request);
    expect(listing.rows[0]?.state).toBe('policy-review');
    env.service.dispose();
  });

  it('reports only aggregate held legacy state without exposing unpartitioned identifiers or bodies', async () => {
    const env = setup();
    await injectRawRows(env.indexedDB, [
      { id: 'owned-legacy', ownerKey: ticket.ownerKey, text: 'private old body' },
      { id: 'unowned-legacy', text: 'another private old body' },
    ]);
    const listed = await env.service.list(request);
    expect(listed.legacyHeldCount).toBe(1);
    expect(listed.legacyReviewUnavailable).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('private old body');
    expect(JSON.stringify(listed)).not.toContain('owned-legacy');
    expect(JSON.stringify(listed)).not.toContain('unowned-legacy');
    env.service.dispose();
  });
});
