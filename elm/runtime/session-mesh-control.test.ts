import { describe, expect, it } from 'vitest';
import type { EndpointId, OwnerSnapshot, PrivateIngressEvent, RequestContext } from './contracts';
import { createSessionMeshControl } from './session-mesh-control';
import { createSessionOperationOwner } from './session-operation-owner';

const owner = {
  networkId: 'network' as never, accountId: 'account' as never, accountGeneration: 1 as never,
  connectionGeneration: 2 as never, physicalRef: 'physical' as never, ownerRef: 'owner' as never,
} satisfies OwnerSnapshot;
const endpoint = 'endpoint' as EndpointId;
const context = (id: string): RequestContext => ({ schemaVersion: 1, requestId: id as never, owner });
const ref = (index: number) => `R${String(index).padStart(23, '0')}`;

function makeHarness(meshEnabled = false) {
  const lines: string[] = [];
  const events: Array<{ status: string; view: unknown }> = [];
  const operations = createSessionOperationOwner({ currentOwner: () => owner, isCurrent: value => value.ownerRef === owner.ownerRef });
  const service = createSessionMeshControl({
    currentOwner: () => owner,
    isCurrent: value => value.ownerRef === owner.ownerRef,
    currentNick: () => 'fixture',
    currentServerPrefix: () => 'fixture.test',
    currentEndpointId: () => endpoint,
    acquireSessionOperation: (request, kind, operationRef) => operations.acquire(request, kind, operationRef),
    sendLine: ({ line, lease }) => { if (!lease.isCurrent()) return { kind: 'blocked', reason: 'owner-changed' }; lines.push(line); return { kind: 'transport-admitted' }; },
    deploymentAllowed: () => meshEnabled,
    now: () => 1,
    randomRef: (() => { let next = 0; return () => ref(++next); })(),
    emit: result => events.push({ status: result.status, view: result.view }),
    timeoutMs: 60_000,
  });
  const ingress = (body: string): PrivateIngressEvent => ({
    line: `:fixture.test NOTICE fixture :${body}`, owner, sourceKind: 'server',
  });
  return { service, operations, lines, events, ingress };
}

describe('session mesh control', () => {
  it('publishes exact local attachment metadata and requires a fresh opaque row reference for DROP', () => {
    const h = makeHarness();
    h.service.localList(context('A'.repeat(24)));
    expect(h.lines).toEqual(['SESSION LIST *']);
    h.service.consumePrivateIngress(h.ingress('SESSION LIST * #1 signon=1700000000000 attached sid=0123456789abcdef0123456789abcdef scope=local-attachment'));
    h.service.consumePrivateIngress(h.ingress('SESSION LIST - #2 signon=1699999999000 detached sid=fedcba9876543210fedcba9876543210 scope=local-attachment'));
    h.service.consumePrivateIngress(h.ingress("SESSION: end of session list (this node's physical attachments only)"));
    const listed = h.events.at(-1)?.view as { status: string; localRows: Array<{ rowRef: string; current: boolean; index: number }> };
    expect(listed.status).toBe('ready');
    expect(listed.localRows.map(row => [row.index, row.current])).toEqual([[1, true], [2, false]]);
    expect(listed.localRows[0]?.rowRef).not.toContain('012345');

    h.service.localDrop({ context: context('B'.repeat(24)), rowRef: listed.localRows[1]!.rowRef, confirm: true });
    expect(h.lines.at(-1)).toBe('SESSION DROP sid=fedcba9876543210fedcba9876543210');
    h.service.consumePrivateIngress(h.ingress('SESSION DROP sid=fedcba9876543210fedcba9876543210 ok'));
    expect(h.lines.at(-1)).toBe('SESSION LIST *');
    h.service.consumePrivateIngress(h.ingress('SESSION LIST * #1 signon=1700000000000 attached sid=0123456789abcdef0123456789abcdef scope=local-attachment'));
    h.service.consumePrivateIngress(h.ingress("SESSION: end of session list (this node's physical attachments only)"));
    expect((h.events.at(-1)?.view as { status: string }).status).toBe('ready');
    h.service.dispose(); h.operations.dispose();
  });

  it('keeps mesh candidate disabled unless explicit deployment configuration enables it', () => {
    const h = makeHarness(false);
    const result = h.service.meshList(context('C'.repeat(24)));
    expect(result.status).toBe('blocked');
    expect((result.view as { status: string; reason: string | null }).status).toBe('unsupported');
    expect(h.lines).toEqual([]);
    h.service.dispose(); h.operations.dispose();
  });
  it('blocks a DROP that names a row from a superseded list epoch without writing', () => {
    const h = makeHarness();
    const list = (id: string) => {
      h.service.localList(context(id.repeat(24)));
      h.service.consumePrivateIngress(h.ingress('SESSION LIST * #1 signon=1700000000000 attached sid=0123456789abcdef0123456789abcdef scope=local-attachment'));
      h.service.consumePrivateIngress(h.ingress('SESSION LIST - #2 signon=1699999999000 detached sid=fedcba9876543210fedcba9876543210 scope=local-attachment'));
      h.service.consumePrivateIngress(h.ingress("SESSION: end of session list (this node's physical attachments only)"));
      return h.events.at(-1)?.view as { status: string; localRows: Array<{ rowRef: string; current: boolean }> };
    };
    const first = list('D');
    const staleRef = first.localRows[1]!.rowRef;
    const second = list('E');
    expect(second.status).toBe('ready');
    expect(second.localRows[1]!.rowRef).not.toBe(staleRef);
    const linesBefore = h.lines.length;
    const result = h.service.localDrop({ context: context('F'.repeat(24)), rowRef: staleRef, confirm: true });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('stale-list');
    expect(h.lines.slice(linesBefore)).toEqual([]);
    expect(h.lines.some(line => line.startsWith('SESSION DROP'))).toBe(false);
    // The fresh row reference from the current epoch is still accepted.
    h.service.localDrop({ context: context('G'.repeat(24)), rowRef: second.localRows[1]!.rowRef, confirm: true });
    expect(h.lines.at(-1)).toBe('SESSION DROP sid=fedcba9876543210fedcba9876543210');
    h.service.dispose(); h.operations.dispose();
  });

  it('refuses to DROP the current attachment locally, fail-closed, with no outbound line', () => {
    const h = makeHarness();
    h.service.localList(context('H'.repeat(24)));
    h.service.consumePrivateIngress(h.ingress('SESSION LIST * #1 signon=1700000000000 attached sid=0123456789abcdef0123456789abcdef scope=local-attachment'));
    h.service.consumePrivateIngress(h.ingress("SESSION: end of session list (this node's physical attachments only)"));
    const listed = h.events.at(-1)?.view as { localRows: Array<{ rowRef: string; current: boolean }> };
    expect(listed.localRows[0]?.current).toBe(true);
    const linesBefore = h.lines.length;
    const result = h.service.localDrop({ context: context('I'.repeat(24)), rowRef: listed.localRows[0]!.rowRef, confirm: true });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('invalid-request');
    expect(h.lines.slice(linesBefore)).toEqual([]);
    // No session operation lease was taken, so a fresh list still proceeds.
    h.service.localList(context('J'.repeat(24)));
    expect(h.lines.at(-1)).toBe('SESSION LIST *');
    h.service.dispose(); h.operations.dispose();
  });
});
