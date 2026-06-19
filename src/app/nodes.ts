/**
 * IRCXNet node registry.
 *
 * Orochi runs a Suimyaku CRDT mesh — either door reaches the whole network.
 * Connecting to ircx.us and eshmaki.me are functionally equivalent; pick the
 * node with the lower round-trip time or personal meaning.
 *
 * The mesh means cross-node routing, NAMES, PMs, and operator events all fan
 * out network-wide regardless of which node you connect to.
 */

export interface IrcNode {
  id: string;
  host: string;
  wss: string;
  label: string;
}

export const NODES: readonly IrcNode[] = [
  {
    id: 'ircx',
    host: 'ircx.us',
    wss: 'wss://ircx.us:8080',
    label: 'ircx.us — the far door',
  },
  {
    id: 'eshmaki',
    host: 'eshmaki.me',
    wss: 'wss://eshmaki.me:8080',
    // Aēšma (𐬀𐬉𐬱𐬨𐬀): Avestan daeva of wrath — the devil's gate.
    label: "eshmaki.me — the devil's gate (Aēšma, wrath)",
  },
] as const;

function defaultNode(): IrcNode {
  const envWss = import.meta.env.VITE_IRC_WS as string | undefined;
  if (envWss) {
    const match = NODES.find((n) => n.wss === envWss);
    if (match) return match;
    // Unrecognised env override — synthesise a node entry.
    return { id: 'env', host: envWss, wss: envWss, label: envWss };
  }
  // Default: ircx.us (the far door).
  return NODES[0]!;
}

export const DEFAULT_NODE: IrcNode = defaultNode();
