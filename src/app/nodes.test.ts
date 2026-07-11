// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * nodes.test.ts — mesh node ranking + auto-selection.
 *
 * Selection is pure at the public boundary here: every network probe is replaced
 * by a fetch/performance seam, so these tests never open real sockets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NODE, type IrcNode, NODES, initialNode, selectBestNode } from './nodes';

const NODE_SET = new Set(NODES.map((n) => n.wss));

const CUSTOM_NODES = [
  { id: 'slow', host: 'slow.example.test', wss: 'wss://slow.example.test:8080' },
  { id: 'fast', host: 'fast.example.test', wss: 'wss://fast.example.test:8080' },
] as const satisfies readonly IrcNode[];

function stubSuccessfulProbes(...nowValues: number[]): ReturnType<typeof vi.fn> {
  const now = vi.fn(() => nowValues.shift() ?? 0);
  vi.stubGlobal('performance', { now });
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
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
