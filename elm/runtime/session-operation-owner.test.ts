import { describe, expect, it } from 'vitest';
import { createSessionOperationOwner } from './session-operation-owner';
import type { OwnerSnapshot, RequestContext, RequestId } from './contracts';

const owner: OwnerSnapshot = { networkId: 'network-a' as OwnerSnapshot['networkId'], accountId: 'alice' as OwnerSnapshot['accountId'],
  accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-a' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'] };
const context: RequestContext = { schemaVersion: 1, requestId: 'request_0123456789abcdefghijkl' as RequestId, owner };

describe('SESSION operation ownership', () => {
  it('serializes commands, retains an unknown barrier, and runs one guarded follow-up after release', () => {
    const service = createSessionOperationOwner({ currentOwner: () => owner, isCurrent: value => value === owner });
    const lease = service.acquire(context, 'resume');
    expect(lease?.isCurrent()).toBe(true);
    lease?.markUnknown();
    expect(service.isUnknown()).toBe(true);
    expect(service.acquire({ ...context, requestId: 'request_abcdefghij0123456789' as RequestId }, 'local-list')).toBeNull();
    expect(service.acquire({ ...context, requestId: 'request_abcdefghij0123456789' as RequestId }, 'resume', lease!.operationRef)).toBe(lease);
    let issued = 0;
    expect(service.afterRelease(owner, context.requestId, () => { issued += 1; })).toBe(true);
    lease?.release();
    expect(issued).toBe(1);
    expect(service.currentKind()).toBeNull();
    service.dispose();
  });

  it('drops a queued follow-up when the owning physical context retires', () => {
    let current = owner;
    const service = createSessionOperationOwner({ currentOwner: () => current, isCurrent: value => value === current });
    const lease = service.acquire(context, 'resume');
    let issued = 0;
    expect(service.afterRelease(owner, context.requestId, () => { issued += 1; })).toBe(true);
    service.retire(owner);
    current = { ...owner, physicalRef: 'physical-b' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-b' as OwnerSnapshot['ownerRef'], connectionGeneration: 2 as OwnerSnapshot['connectionGeneration'] };
    lease?.release();
    expect(issued).toBe(0);
    expect(lease?.isCurrent()).toBe(false);
    expect(service.acquire({ ...context, owner: current, requestId: 'request_abcdefghij0123456789' as RequestId }, 'local-list')).not.toBeNull();
    service.dispose();
  });
});
