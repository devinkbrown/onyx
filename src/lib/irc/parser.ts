import type { IRCMessage, StandardReply } from './types';

/**
 * Parse a single IRC line into a structured IRCMessage.
 * Handles IRCv3 message tags (@tag=val;tag2=val2 prefix).
 *
 * Grammar:
 *   ['@' tags SP] [':' prefix SP] command [SP params] [SP ':' trailing]
 */
export function parseIRCMessage(raw: string): IRCMessage {
  let pos = 0;
  const tags: Record<string, string> = {};

  // Strip \r\n and null bytes
  const line = raw.replace(/\r?\n$/, '').replace(/\x00/g, '');

  // Parse tags: @tag=val;tag2;tag3=val3 <space>
  if (line[pos] === '@') {
    pos++;
    const tagEnd = line.indexOf(' ', pos);
    const tagStr = tagEnd === -1 ? line.slice(pos) : line.slice(pos, tagEnd);
    for (const tag of tagStr.split(';')) {
      if (!tag) continue;
      const eq = tag.indexOf('=');
      if (eq === -1) {
        tags[tag] = '';
      } else {
        tags[tag.slice(0, eq)] = unescapeTagValue(tag.slice(eq + 1));
      }
    }
    pos = tagEnd === -1 ? line.length : tagEnd + 1;
  }

  // Parse prefix: :nick!user@host or :server.name
  let prefix: string | null = null;
  let nick: string | null = null;
  let host: string | null = null;

  if (line[pos] === ':') {
    pos++;
    const prefixEnd = line.indexOf(' ', pos);
    prefix = prefixEnd === -1 ? line.slice(pos) : line.slice(pos, prefixEnd);
    pos = prefixEnd === -1 ? line.length : prefixEnd + 1;

    // Extract nick and host from prefix
    const bangIdx = prefix.indexOf('!');
    if (bangIdx !== -1) {
      nick = prefix.slice(0, bangIdx);
      const atIdx = prefix.indexOf('@', bangIdx);
      host = atIdx !== -1 ? prefix.slice(atIdx + 1) : null;
    } else {
      // Could be server name or just a nick
      const atIdx = prefix.indexOf('@');
      if (atIdx !== -1) {
        nick = prefix.slice(0, atIdx);
        host = prefix.slice(atIdx + 1);
      } else {
        // A prefix without user/host can be either a server name or a bare
        // nickname. Server names normally contain a dot; bare JOIN/NICK/etc.
        // prefixes do not. Treat nick-like prefixes as nicks so membership
        // events still populate channel state on minimal IRC daemons/proxies.
        if (prefix.includes('.')) {
          nick = null;
          host = prefix;
        } else {
          nick = prefix;
          host = null;
        }
      }
    }
  }

  // Parse command
  const commandEnd = line.indexOf(' ', pos);
  const command = commandEnd === -1
    ? line.slice(pos).toUpperCase()
    : line.slice(pos, commandEnd).toUpperCase();
  pos = commandEnd === -1 ? line.length : commandEnd + 1;

  // Parse params
  const params: string[] = [];
  while (pos < line.length) {
    if (line[pos] === ':') {
      // trailing param — everything to end
      params.push(line.slice(pos + 1));
      break;
    }
    const spaceIdx = line.indexOf(' ', pos);
    if (spaceIdx === -1) {
      params.push(line.slice(pos));
      break;
    }
    params.push(line.slice(pos, spaceIdx));
    pos = spaceIdx + 1;
  }

  return { tags, prefix, nick, host, command, params, raw: line };
}

/** Unescape IRCv3 tag value escape sequences */
function unescapeTagValue(val: string): string {
  return val
    .replace(/\\:/g, ';')
    .replace(/\\s/g, ' ')
    .replace(/\\\\/g, '\\')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n');
}

/**
 * Format a raw IRC line to send.
 * Appends \r\n.
 */
export function formatIRCLine(command: string, ...params: string[]): string {
  const parts = [command, ...params.slice(0, -1)];
  if (params.length > 0) {
    const last = params[params.length - 1]!;
    // Prefix trailing param with ':' if it contains a space or starts with ':'
    if (last === '' || last.includes(' ') || last.startsWith(':')) {
      parts.push(':' + last);
    } else {
      parts.push(last);
    }
  }
  return parts.join(' ') + '\r\n';
}

/**
 * Parse NAMES list prefix characters into a Set of mode letters.
 * Prefix map: { '~': 'q', '@': 'o', '+': 'v', '%': 'h', '&': 'a' }
 */
export function parseNamesPrefix(
  prefixStr: string,
  prefixMap: Record<string, string>
): { nick: string; modes: Set<string> } {
  const modes = new Set<string>();
  let i = 0;
  while (i < prefixStr.length && prefixMap[prefixStr[i]!]) {
    modes.add(prefixMap[prefixStr[i]!]!);
    i++;
  }
  const full = prefixStr.slice(i);
  // userhost-in-names sends nick!user@host — extract just the nick
  const nick = full.split('!')[0]!;
  return { nick, modes };
}

/**
 * Parse 005 ISUPPORT PREFIX value: (qaohv)~&@%+
 * Returns a map of prefix char → mode letter and mode letter → prefix char.
 */
export function parsePREFIX(value: string): {
  modeToPrefix: Record<string, string>;
  prefixToMode: Record<string, string>;
} {
  const modeToPrefix: Record<string, string> = {};
  const prefixToMode: Record<string, string> = {};

  const match = value.match(/^\(([^)]+)\)(.+)$/);
  if (!match) return { modeToPrefix, prefixToMode };

  const modes = match[1]!;
  const prefixes = match[2]!;
  for (let i = 0; i < modes.length; i++) {
    modeToPrefix[modes[i]!] = prefixes[i] ?? '';
    prefixToMode[prefixes[i]!] = modes[i]!;
  }
  return { modeToPrefix, prefixToMode };
}

export function parseCHANLIMIT(value: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of value.split(',').filter(Boolean)) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const types = part.slice(0, idx);
    const limit = Number.parseInt(part.slice(idx + 1), 10);
    if (!Number.isFinite(limit)) continue;
    for (const ch of types) out[ch] = limit;
  }
  return out;
}

export function normalizeCase(value: string, casemapping: string): string {
  if (casemapping.toLowerCase() === 'ascii') return value.toLowerCase();
  return value.toLowerCase()
    .replace(/\[/g, '{')
    .replace(/\]/g, '}')
    .replace(/\\/g, '|')
    .replace(/\^/g, '~');
}

export type SaslMechanism = 'SCRAM-SHA-256' | 'PLAIN' | 'EXTERNAL';

export function selectSaslMechanism(
  offered: string[],
  opts: { hasPassword: boolean; hasClientCert?: boolean },
): SaslMechanism | null {
  const mechs = new Set(offered.map(m => m.toUpperCase()));
  if (mechs.has('SCRAM-SHA-256') && opts.hasPassword) return 'SCRAM-SHA-256';
  if (mechs.has('PLAIN') && opts.hasPassword) return 'PLAIN';
  if (mechs.has('EXTERNAL') && opts.hasClientCert) return 'EXTERNAL';
  return null;
}

export function parseStandardReply(msg: IRCMessage): StandardReply | null {
  if (msg.command !== 'NOTE' && msg.command !== 'FAIL' && msg.command !== 'WARN') return null;
  const [command, code, ...rest] = msg.params;
  if (!command) return null;
  const description = rest.length > 0 ? rest[rest.length - 1]! : '';
  const context = rest.length > 1 ? rest.slice(0, -1) : [];
  return {
    kind: msg.command,
    command: command.toUpperCase(),
    code: (code ?? '').toUpperCase(),
    context,
    description,
  };
}

export function parseSessionTokenNote(msg: IRCMessage): string | null {
  const reply = parseStandardReply(msg);
  if (!reply || reply.kind !== 'NOTE' || reply.command !== 'SESSION' || reply.code !== 'TOKEN') return null;
  return reply.description || null;
}

/**
 * Parse `:server NOTE SESSION MTOKEN :<token>` — Orochi's mesh-sealed reclaim
 * token, emitted alongside the local TOKEN on mesh deployments. Usable to
 * reclaim/redirect the session from any node via `SESSION RESUME <mtoken>`.
 */
export function parseSessionMeshTokenNote(msg: IRCMessage): string | null {
  const reply = parseStandardReply(msg);
  if (!reply || reply.kind !== 'NOTE' || reply.command !== 'SESSION' || reply.code !== 'MTOKEN') return null;
  return reply.description || null;
}

export function buildSessionResumeLine(token: string): string {
  return formatIRCLine('SESSION', 'RESUME', token);
}

export function parseMonitorNumeric(msg: IRCMessage): {
  kind: 'online' | 'offline' | 'full';
  targets: string[];
  limit?: number;
  description?: string;
} | null {
  if (msg.command === '730' || msg.command === '731') {
    const targets = (msg.params[1] ?? msg.params[0] ?? '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    return { kind: msg.command === '730' ? 'online' : 'offline', targets };
  }
  if (msg.command === '734') {
    const limit = Number.parseInt(msg.params[1] ?? '', 10);
    const targetParam = msg.params.length >= 4 ? msg.params[2]! : '';
    return {
      kind: 'full',
      targets: targetParam.split(',').map(t => t.trim()).filter(Boolean),
      limit: Number.isFinite(limit) ? limit : undefined,
      description: msg.params[msg.params.length - 1] ?? '',
    };
  }
  return null;
}
