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

/** Random node — the inconclusive-probe fallback so there is always a target. */
function randomNode(nodes: readonly IrcNode[] = NODES): IrcNode {
  return nodes[Math.floor(Math.random() * nodes.length)]!;
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
 * to Infinity on error/timeout (or in a non-browser env without fetch).
 */
export function pingNode(node: IrcNode, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve) => {
    if (typeof fetch === 'undefined' || typeof performance === 'undefined') {
      resolve(Number.POSITIVE_INFINITY);
      return;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let settled = false;
    const finish = (ms: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ms);
    };

    const timer = setTimeout(() => {
      controller?.abort();
      finish(Number.POSITIVE_INFINITY);
    }, timeoutMs);

    const start = performance.now();
    // no-cors: we only need the round-trip, not the body (opaque response is fine).
    // A cache-buster avoids timing a cached 0ms response.
    // NOTE: no-cors REQUIRES redirect:'follow' — 'manual' makes the fetch
    // reject outright ("redirect mode is not follow"), which read as the node
    // being permanently unreachable and broke nearest-node selection.
    fetch(`https://${node.host}/?_lat=${start}`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller?.signal,
    })
      .then(() => finish(performance.now() - start))
      .catch(() => finish(Number.POSITIVE_INFINITY));
  });
}

/**
 * Pick the node to attach to: an env pin always wins; otherwise probe every node
 * in parallel and choose the lowest-latency (nearest) reachable one. If none
 * answer, fall back to a random node so a connection is still attempted.
 */
export async function selectBestNode(nodes: readonly IrcNode[] = NODES): Promise<IrcNode> {
  const pinned = envNode();
  if (pinned) return pinned;

  const probed = await Promise.all(nodes.map(async (node) => ({ node, ms: await pingNode(node) })));
  const reachable = probed.filter((r) => Number.isFinite(r.ms)).sort((a, b) => a.ms - b.ms);

  return reachable[0]?.node ?? randomNode(nodes);
}
