// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * nodes.test.ts — mesh node ranking + auto-selection.
 *
 * Selection is pure at the public boundary here: every network probe is replaced
 * by a fetch/performance seam, so these tests never open real sockets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NODE, type IrcNode, NODES, initialNode, pingNode, selectBestNode } from './nodes';

const NODE_SET = new Set(NODES.map((n) => n.wss));

const CUSTOM_NODES = [
  { id: 'slow', host: 'slow.example.test', wss: 'wss://slow.example.test:8080' },
  { id: 'fast', host: 'fast.example.test', wss: 'wss://fast.example.test:8080' },
] as const satisfies readonly IrcNode[];

const MANY_NODES: readonly IrcNode[] = Array.from({ length: 6 }, (_, index) => ({
  id: `node-${index}`,
  host: `node-${index}.example.test`,
  wss: `wss://node-${index}.example.test:8080`,
}));

function stubSuccessfulProbes(...nowValues: number[]): ReturnType<typeof vi.fn> {
  const now = vi.fn(() => nowValues.shift() ?? 0);
  vi.stubGlobal('performance', { now });
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('selectBestNode', () => {
  it('selects the reachable node with the lowest probe latency', async () => {
    // Arrange
    vi.stubEnv('VITE_IRC_WS', '');
    const fetchMock = stubSuccessfulProbes(
      100, // slow node probe starts
      100, // fast node probe starts
      180, // slow node resolves after 80ms
      125, // fast node resolves after 25ms
    );

    // Act
    const chosen = await selectBestNode(CUSTOM_NODES);

    // Assert
    expect(chosen).toEqual(CUSTOM_NODES[1]);
    expect(fetchMock).toHaveBeenCalledTimes(CUSTOM_NODES.length);
  });

  it('keeps input order as the tie-break when probe latencies match', async () => {
    // Arrange
    vi.stubEnv('VITE_IRC_WS', '');
    stubSuccessfulProbes(
      200, // first node probe starts
      200, // second node probe starts
      240, // first node resolves after 40ms
      240, // second node resolves after 40ms
    );

    // Act
    const chosen = await selectBestNode(CUSTOM_NODES);

    // Assert
    expect(chosen).toEqual(CUSTOM_NODES[0]);
  });

  it('falls back to a known registry node when the candidate list is empty', async () => {
    // Arrange
    vi.stubEnv('VITE_IRC_WS', '');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // Act
    const chosen = await selectBestNode([]);

    // Assert
    expect(chosen).toEqual(NODES[0]);
  });

  it('falls back to a known node when every probe fails', async () => {
    // Arrange
    vi.stubEnv('VITE_IRC_WS', '');
    const fetchMock = vi.fn(async () => {
      throw new Error('down');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // Act
    const chosen = await selectBestNode();

    // Assert
    expect(chosen).toEqual(NODES[0]);
    expect(fetchMock).toHaveBeenCalledTimes(NODES.length);
  });

  it('returns a pinned custom endpoint without probing candidates', async () => {
    // Arrange
    const pinned = 'wss://local.example.test:9443';
    vi.stubEnv('VITE_IRC_WS', pinned);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Act
    const chosen = await selectBestNode(CUSTOM_NODES);

    // Assert
    expect(chosen).toEqual({ id: 'env', host: 'custom', wss: pinned });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds concurrent probes for a caller-supplied registry', async () => {
    vi.stubEnv('VITE_IRC_WS', '');
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      releases.push(() => {
        active -= 1;
        resolve(new Response(null, { status: 204 }));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const selection = selectBestNode(MANY_NODES, { maxConcurrency: 2 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    for (let expected = 3; expected <= MANY_NODES.length; expected += 1) {
      releases.shift()?.();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expected));
    }
    while (releases.length > 0) releases.shift()?.();

    await expect(selection).resolves.toBe(MANY_NODES[0]);
    expect(peak).toBe(2);
  });

  it('cancels active probes and does not start queued probes after selection cancellation', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_IRC_WS', '');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchSignals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) fetchSignals.push(init.signal);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const selection = selectBestNode(MANY_NODES, {
      signal: controller.signal,
      timeoutMs: 10_000,
      maxConcurrency: 2,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(selection).resolves.toBe(MANY_NODES[0]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchSignals).toHaveLength(2);
    expect(fetchSignals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pingNode', () => {
  it('times out a hung fetch, aborts it, and clears the deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('performance', { now: vi.fn(() => 100) });
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal;
      return new Promise<Response>(() => {});
    }));

    const latency = pingNode(CUSTOM_NODES[0], 25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(latency).resolves.toBe(Number.POSITIVE_INFINITY);
    expect(fetchSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles immediately and aborts fetch when its caller cancels', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('performance', { now: vi.fn(() => 100) });
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal;
      return new Promise<Response>(() => {});
    }));
    const controller = new AbortController();

    const latency = pingNode(CUSTOM_NODES[0], 10_000, controller.signal);
    controller.abort();

    await expect(latency).resolves.toBe(Number.POSITIVE_INFINITY);
    expect(fetchSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start fetch for a caller that is already cancelled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(pingNode(CUSTOM_NODES[0], 100, controller.signal))
      .resolves.toBe(Number.POSITIVE_INFINITY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a synchronous fetch failure to the documented unreachable result', async () => {
    vi.stubGlobal('performance', { now: vi.fn(() => 100) });
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new TypeError('invalid fetch options');
    }));

    await expect(pingNode(CUSTOM_NODES[0]))
      .resolves.toBe(Number.POSITIVE_INFINITY);
  });
});

describe('initialNode / DEFAULT_NODE', () => {
  it('initialNode returns a known registry node (no env pin under test)', () => {
    // Arrange
    vi.stubEnv('VITE_IRC_WS', '');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // Act
    const n = initialNode();

    // Assert
    expect(n).toEqual(NODES[0]);
  });

  it('DEFAULT_NODE is a defined registry node', () => {
    // Arrange / Act / Assert
    expect(DEFAULT_NODE).toBeDefined();
    expect(NODE_SET.has(DEFAULT_NODE.wss)).toBe(true);
  });
});
