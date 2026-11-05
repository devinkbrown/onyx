import { describe, expect, it, vi } from 'vitest';
import { createTabIntentOwner } from './tab-intent-owner';
import type { NetworkId } from './contracts';

const networkId = 'custom:wss://intent.test/ws' as NetworkId;

describe('per-document tab intent leases', () => {
  it('serializes same-profile holders and requires explicit restore after an ambiguous operation', async () => {
    const lifecycle = new EventTarget();
    const first = createTabIntentOwner({ networkId, locks: null, lifecycle });
    const created = await first.createFreshIntent(true);
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') return;
    expect((await first.acquire(created.intentRef)).kind).toBe('acquired');
    expect(await first.markOperationStarted(created.intentRef)).toBe(true);

    const second = createTabIntentOwner({ networkId, locks: null });
    expect((await second.acquire(created.intentRef)).kind).toBe('busy');
    lifecycle.dispatchEvent(new Event('pagehide'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await second.acquire(created.intentRef)).kind).toBe('blocked');
    expect((await second.requestExplicitRestore(created.intentRef)).kind).toBe('restorable');
    expect((await second.acquire(created.intentRef)).kind).toBe('acquired');
    first.dispose(); second.dispose();
  });

  it('clears ambiguity only on definitive unadmitted evidence and revokes authority at pagehide', async () => {
    const lifecycle = new EventTarget();
    const lost: string[] = [];
    const service = createTabIntentOwner({ networkId, locks: null, lifecycle, onAuthorityLost: event => lost.push(event.reason) });
    const created = await service.createFreshIntent(true);
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') return;
    expect((await service.acquire(created.intentRef)).kind).toBe('acquired');
    expect(await service.markOperationStarted(created.intentRef)).toBe(true);
    expect(await service.settleOperation(created.intentRef, 'unknown')).toBe(true);
    lifecycle.dispatchEvent(new Event('pagehide'));
    expect(service.assertCurrentLease(created.intentRef)).toBe(false);
    expect(lost).toEqual(['pagehide']);
    expect((await service.acquire(created.intentRef)).kind).toBe('unavailable');
    service.dispose();
  });
  it('admits only one same-profile holder through a shared Web Locks manager', async () => {
    const held = new Set<string>();
    const locks = {
      async request<T>(name: string, _options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => Promise<T>): Promise<T> {
        if (held.has(name)) return callback(null);
        held.add(name);
        try { return await callback({ name }); } finally { held.delete(name); }
      },
    };
    const lifecycle = new EventTarget();
    const first = createTabIntentOwner({ networkId, locks, lifecycle });
    const second = createTabIntentOwner({ networkId, locks, lifecycle: new EventTarget() });
    const created = await first.createFreshIntent(true);
    if (created.kind !== 'created') throw new Error('intent was not created');
    const [a, b] = await Promise.all([first.acquire(created.intentRef), second.acquire(created.intentRef)]);
    expect([a.kind, b.kind].sort()).toEqual(['acquired', 'busy']);
    const [winner, loser] = a.kind === 'acquired' ? [first, second] : [second, first];
    expect(winner.assertCurrentLease(created.intentRef)).toBe(true);
    expect(loser.assertCurrentLease(created.intentRef)).toBe(false);
    expect(held.size).toBe(1);
    expect((await loser.acquire(created.intentRef)).kind).toBe('busy');
    winner.dispose();
    await vi.waitFor(() => expect(held.size).toBe(0));
    await vi.waitFor(async () => expect((await loser.acquire(created.intentRef)).kind).toBe('acquired'));
    expect(loser.assertCurrentLease(created.intentRef)).toBe(true);
    loser.dispose(); first.dispose();
  });

  it('does not silently regain an ambiguous lease on pageshow/resume, and revokes on freeze', async () => {
    const lifecycle = new EventTarget();
    const lost: string[] = [];
    const service = createTabIntentOwner({ networkId, locks: null, lifecycle, onAuthorityLost: event => lost.push(event.reason) });
    const created = await service.createFreshIntent(true);
    if (created.kind !== 'created') throw new Error('intent was not created');
    expect((await service.acquire(created.intentRef)).kind).toBe('acquired');
    expect(await service.markOperationStarted(created.intentRef)).toBe(true);
    lifecycle.dispatchEvent(new Event('pagehide'));
    expect(service.assertCurrentLease(created.intentRef)).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 10));
    lifecycle.dispatchEvent(new Event('pageshow'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(service.assertCurrentLease(created.intentRef)).toBe(false);
    expect(await service.acquire(created.intentRef)).toMatchObject({ kind: 'blocked', reason: 'explicit-restore-required' });
    expect((await service.requestExplicitRestore(created.intentRef)).kind).toBe('restorable');
    expect((await service.acquire(created.intentRef)).kind).toBe('acquired');
    expect(service.assertCurrentLease(created.intentRef)).toBe(true);

    lifecycle.dispatchEvent(new Event('freeze'));
    expect(service.assertCurrentLease(created.intentRef)).toBe(false);
    expect(lost).toEqual(['pagehide', 'freeze']);
    expect(await service.markOperationStarted(created.intentRef)).toBe(false);
    lifecycle.dispatchEvent(new Event('resume'));
    await new Promise(resolve => setTimeout(resolve, 20));
    // Explicit restore acknowledges, but does not clear, the ambiguous
    // operation: a lifecycle resume again requires a fresh explicit restore.
    expect(service.assertCurrentLease(created.intentRef)).toBe(false);
    expect(await service.acquire(created.intentRef)).toMatchObject({ kind: 'blocked', reason: 'explicit-restore-required' });
    service.dispose();
  });
});
