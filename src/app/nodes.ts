// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * IRCXNet node registry + automatic node selection.
 *
 * The network is a single mesh — every node reaches the whole network, so which
 * node a client attaches to is purely a routing/latency concern, never a feature
 * difference. The UI does NOT expose node choice: we measure connect latency to
 * each reachable node and attach to the fastest (nearest) one automatically,
 * falling back to a random node when probing is inconclusive.
 *
 * Override with VITE_IRC_WS to pin a specific endpoint (dev / self-host).
 */

export interface IrcNode {
  id: string;
  host: string;
  wss: string;
}

export interface NodeSelectionOptions {
  /** Cancels this caller's probes without affecting another selection. */
  signal?: AbortSignal;
  /** Per-node deadline. Invalid values retain the bounded default. */
  timeoutMs?: number;
  /** Maximum simultaneous HTTPS probes for caller-supplied node registries. */
  maxConcurrency?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 4000;
const DEFAULT_MAX_CONCURRENT_PROBES = 4;

export const NODES: readonly IrcNode[] = [
  { id: 'a', host: 'ircx.us', wss: 'wss://ircx.us:8080' },
  { id: 'b', host: 'eshmaki.me', wss: 'wss://eshmaki.me:8080' },
] as const;

/** Endpoint pinned via env, if any (a recognised node or a synthesised entry). */
function envNode(): IrcNode | null {
  const envWss = import.meta.env.VITE_IRC_WS as string | undefined;
  if (!envWss) return null;
  return NODES.find((n) => n.wss === envWss) ?? { id: 'env', host: 'custom', wss: envWss };
}

/**
 * Random node — the inconclusive-probe fallback so there is always a target.
 *
 * An empty `nodes` list (e.g. a caller-supplied filter that matched nothing) must
 * not yield `undefined`: indexing `[]` and asserting non-null would lie about the
 * return type and crash the connect flow downstream. Fall back to the registry so
 * the contract ("there is always a target") holds; NODES is a non-empty const.
 */
function randomNode(nodes: readonly IrcNode[] = NODES): IrcNode {
  const pool = nodes.length > 0 ? nodes : NODES;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * Synchronous best-guess used before latency probing resolves: an env pin if set,
 * otherwise a random node (which also spreads initial load across the mesh).
 */
export function initialNode(): IrcNode {
  return envNode() ?? randomNode();
}

/** Back-compat default (env pin or a random node). Selection is dynamic now. */
export const DEFAULT_NODE: IrcNode = initialNode();

/**
 * Estimate latency to a node by timing a lightweight HTTPS request to its web
 * tier (`https://<host>/`, i.e. nginx on :443) — NOT the IRC WebSocket.
 *
 * This is deliberate: IRC servers throttle/temp-ban rapid connect-disconnect, so
 * opening throwaway probe sockets on the IRC port trips flood protection and
 * breaks the *real* connection that follows. The :443 round-trip is a clean proxy
 * for geographic latency and never touches the IRC connection limiter. Resolves
 * to Infinity on error, timeout, caller cancellation, or without browser fetch.
 */
export function pingNode(
  node: IrcNode,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve) => {
    if (typeof fetch === 'undefined' || typeof performance === 'undefined' || signal?.aborted) {
      resolve(Number.POSITIVE_INFINITY);
      return;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let settled = false;
    const handleCallerAbort = (): void => {
      controller?.abort();
      finish(Number.POSITIVE_INFINITY);
    };
    const finish = (ms: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleCallerAbort);
      resolve(ms);
    };

    const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      controller?.abort();
      finish(Number.POSITIVE_INFINITY);
    }, boundedTimeout);
    signal?.addEventListener('abort', handleCallerAbort, { once: true });

    const start = performance.now();
    // no-cors: we only need the round-trip, not the body (opaque response is fine).
    // A cache-buster avoids timing a cached 0ms response.
    // NOTE: no-cors REQUIRES redirect:'follow' — 'manual' makes the fetch
    // reject outright ("redirect mode is not follow"), which read as the node
    // being permanently unreachable and broke nearest-node selection.
    try {
      void fetch(`https://${node.host}/?_lat=${start}`, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller?.signal ?? signal,
      })
        .then(() => finish(performance.now() - start))
        .catch(() => finish(Number.POSITIVE_INFINITY));
    } catch {
      // Some fetch implementations throw synchronously for invalid options.
      finish(Number.POSITIVE_INFINITY);
    }
  });
}

function probeConcurrency(requested: number | undefined, nodeCount: number): number {
  const finite = requested !== undefined && Number.isFinite(requested)
    ? Math.floor(requested)
    : DEFAULT_MAX_CONCURRENT_PROBES;
  return Math.min(nodeCount, Math.max(1, finite));
}

async function probeNodes(
  nodes: readonly IrcNode[],
  options: NodeSelectionOptions,
): Promise<Array<{ node: IrcNode; ms: number }>> {
  const results: Array<{ node: IrcNode; ms: number } | undefined> = new Array(nodes.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!options.signal?.aborted) {
      const index = nextIndex++;
      const node = nodes[index];
      if (!node) return;
      results[index] = {
        node,
        ms: await pingNode(node, options.timeoutMs, options.signal),
      };
    }
  };

  const workers = Array.from(
    { length: probeConcurrency(options.maxConcurrency, nodes.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results.filter((result): result is { node: IrcNode; ms: number } => result !== undefined);
}

/**
 * Pick the node to attach to: an env pin always wins; otherwise probe every node
 * with bounded concurrency and choose the lowest-latency (nearest) reachable
 * one. If none answer, fall back to a random node so connection is attempted.
 */
export async function selectBestNode(
  nodes: readonly IrcNode[] = NODES,
  options: NodeSelectionOptions = {},
): Promise<IrcNode> {
  const pinned = envNode();
  if (pinned) return pinned;

  const probed = await probeNodes(nodes, options);
  let fastest: { node: IrcNode; ms: number } | undefined;
  for (const result of probed) {
    if (Number.isFinite(result.ms) && (!fastest || result.ms < fastest.ms)) {
      fastest = result;
    }
  }

  return fastest?.node ?? randomNode(nodes);
}
