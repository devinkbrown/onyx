import { describe, expect, it } from 'vitest';

import { TeardownGuard } from './teardownGuard';

describe('TeardownGuard — async write-back lifetime fencing', () => {
  it('treats a captured token as current until a teardown bump', () => {
    const g = new TeardownGuard();
    const token = g.capture();
    expect(g.isCurrent(token)).toBe(true);
  });

  it('invalidates every token captured before a bump', () => {
    const g = new TeardownGuard();
    const before = g.capture();
    g.bump();
    // A stale async continuation (e.g. a TSUMUGI group-key import that resolves
    // after hangup) must not be allowed to write back into the engine.
    expect(g.isCurrent(before)).toBe(false);
  });

  it('re-validates tokens captured after the bump (a new call generation)', () => {
    const g = new TeardownGuard();
    g.capture();
    g.bump();
    const afterRejoin = g.capture();
    expect(g.isCurrent(afterRejoin)).toBe(true);
  });

  it('does not let a token from generation N validate against generation N+2', () => {
    const g = new TeardownGuard();
    const callA = g.capture();
    g.bump(); // leave call A
    g.capture();
    g.bump(); // leave the intervening generation
    // callA's late promise must never clobber a later call's state.
    expect(g.isCurrent(callA)).toBe(false);
  });

  it('is monotonic — repeated bumps keep invalidating older tokens', () => {
    const g = new TeardownGuard();
    const t0 = g.capture();
    for (let i = 0; i < 5; i++) g.bump();
    expect(g.isCurrent(t0)).toBe(false);
    const t1 = g.capture();
    expect(g.isCurrent(t1)).toBe(true);
  });
});
