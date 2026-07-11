// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * nodes.test.ts — mesh node registry + auto-selection.
 *
 * These are pure logic tests: the latency probe is the network boundary, so we
 * stub `globalThis.fetch` (never touching the real mesh) and drive the three
 * outcomes a probe can have — fast reply, hard failure, and hang-until-timeout.
 *
 * The load-bearing case is the *empty node list*: `selectBestNode` is exported
 * with a `nodes` parameter, so a caller can legitimately hand it a runtime-empty
 * array (e.g. a future region filter that matches nothing). The contract says it
 * returns an `IrcNode` and the doc promises "a connection is still attempted" —
 * it must never resolve `undefined`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NODES, pingNode, selectBestNode, initialNode, DEFAULT_NODE } from './nodes';

const NODE_SET = new Set(NODES.map((n) => n.wss));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('pingNode', () => {
  it('returns a finite latency when the probe resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
    const ms = await pingNode(NODES[0]!);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });

  it('resolves Infinity when the probe rejects (node unreachable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    await expect(pingNode(NODES[0]!)).resolves.toBe(Number.POSITIVE_INFINITY);
    vi.unstubAllGlobals();
  });

  it('resolves Infinity (never hangs) when the probe never settles', async () => {
    vi.useFakeTimers();
    // A fetch that never resolves — the timeout/AbortController must still settle.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const p = pingNode(NODES[0]!, 100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBe(Number.POSITIVE_INFINITY);
    vi.unstubAllGlobals();
  });
});

describe('selectBestNode', () => {
  it('picks the lowest-latency reachable node', async () => {
    // eshmaki.me answers fast, ircx.us answers slow → eshmaki.me wins.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('eshmaki.me')
          ? Promise.resolve(new Response(null, { status: 200 }))
          : new Promise<Response>((res) =>
              setTimeout(() => res(new Response(null, { status: 200 })), 50),
            ),
      ),
    );
    const chosen = await selectBestNode();
    expect(chosen.host).toBe('eshmaki.me');
    vi.unstubAllGlobals();
  });

  it('falls back to a known node when every probe fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );
    const chosen = await selectBestNode();
    expect(NODE_SET.has(chosen.wss)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns a valid registry node for an empty list — never undefined', async () => {
    // No probes are issued for an empty list, so no fetch stub is needed.
    const chosen = await selectBestNode([]);
    expect(chosen).toBeDefined();
    expect(NODE_SET.has(chosen.wss)).toBe(true);
  });
});

describe('initialNode / DEFAULT_NODE', () => {
  it('initialNode returns a known registry node (no env pin under test)', () => {
    const n = initialNode();
    expect(NODE_SET.has(n.wss)).toBe(true);
  });

  it('DEFAULT_NODE is a defined registry node', () => {
    expect(DEFAULT_NODE).toBeDefined();
    expect(NODE_SET.has(DEFAULT_NODE.wss)).toBe(true);
  });
});
