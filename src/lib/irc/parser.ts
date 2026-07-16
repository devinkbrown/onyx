// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IRCMessage, StandardReply } from './types';

export const MAX_IRCV3_MESSAGE_TAGS = 256;
export const MAX_IRCV3_TAG_KEY_LENGTH = 256;
export const MAX_IRCV3_TAG_VALUE_LENGTH = 64 * 1024;
const MAX_IRCV3_TAG_BLOCK_LENGTH = 128 * 1024;

/**
 * Split a received WebSocket text frame into complete IRC lines.
 *
 * Orochi follows the IRCv3 WebSocket sub-protocol: every frame carries one or
 * more COMPLETE IRC messages, and the trailing CRLF is OPTIONAL — Orochi omits
 * it entirely (e.g. ":eshmaki.me CAP * LS :..." with no newline). Lines are
 * separated by CR, LF, or CRLF; empty segments — including the one left by a
 * trailing terminator or a doubled separator — are dropped.
 *
 * This function is deliberately PURE: it holds no state and retains NO
 * remainder across calls. The classic registration hang came from a stateful
 * `split('\n')` + `buffer = lines.pop()` that stashed the CRLF-less final line
 * (the whole `CAP LS 302` response) forever, so CAP was never handled and the
 * client appeared unable to connect. Keeping the split remainder-free here —
 * instead of inline in the socket handler over a mutable buffer — makes that
 * regression impossible to reintroduce without failing this unit's tests.
 */
export function splitWireFrame(frame: string): string[] {
  return frame.split(/\r?\n/).filter((line) => line.length > 0);
}

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

  // Parse tags: @tag=val;tag2;tag3=val3 <space>. Message tags are remote input,
  // so cap the block before splitting and define keys as own data properties:
  // ordinary assignment to `__proto__` would invoke Object.prototype's setter
  // instead of recording the wire tag.
  if (line[pos] === '@') {
    pos++;
    const tagEnd = line.indexOf(' ', pos);
    const tagStr = tagEnd === -1 ? line.slice(pos) : line.slice(pos, tagEnd);
    if (tagStr.length <= MAX_IRCV3_TAG_BLOCK_LENGTH) {
      for (const tag of tagStr.split(';', MAX_IRCV3_MESSAGE_TAGS)) {
        if (!tag) continue;
        const eq = tag.indexOf('=');
        const key = eq === -1 ? tag : tag.slice(0, eq);
        const rawValue = eq === -1 ? '' : tag.slice(eq + 1);
        if (
          key.length > MAX_IRCV3_TAG_KEY_LENGTH
          || rawValue.length > MAX_IRCV3_TAG_VALUE_LENGTH
          || /[\s\u0000-\u001f\u007f]/u.test(key)
        ) continue;
        Object.defineProperty(tags, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: unescapeTagValue(rawValue),
        });
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

/**
 * Unescape IRCv3 tag value escape sequences in a SINGLE left-to-right pass.
 *
 * Sequential global replaces are wrong: collapsing `\\`->`\` first lets a later
 * pass reinterpret the freed backslash + following char as a fresh escape, so a
 * wire value like `\\s` (escaped backslash + literal `s`) mis-decodes to
 * "backslash space" instead of "backslash s". A single consuming pass with a
 * lookup table is the only correct decode. Per spec, a lone trailing backslash
 * is dropped and an unknown escape yields the escaped character verbatim.
 */
function unescapeTagValue(val: string): string {
  return val.replace(/\\([\s\S]?)/g, (_m, c: string) => {
    switch (c) {
      case ':': return ';';
      case 's': return ' ';
      case '\\': return '\\';
      case 'r': return '\r';
      case 'n': return '\n';
      case '': return ''; // trailing lone backslash — dropped
      default: return c; // unknown escape — literal escaped char
    }
  });
}

/** Escape a tag value per IRCv3 spec. */
export function escapeTagValue(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\:')
    .replace(/ /g, '\\s')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Strip the bytes that terminate/segment an IRC line — CR, LF, NUL — from a
 * single field. CR/LF/NUL are illegal inside a message per RFC 1459/2812, so
 * removing them makes injection impossible BY CONSTRUCTION: a value carrying an
 * embedded `\r\n` can never smuggle a second command onto the wire.
 */
function stripWireControl(field: string): string {
  return field.replace(/[\r\n\x00]/g, '');
}

/**
 * Format a raw IRC line to send. Appends \r\n.
 *
 * Every command and param is stripped of CR/LF/NUL first, so a single call
 * always emits EXACTLY ONE wire line. Without this, a param sourced from
 * untrusted input — a composer paste, a rename-dialog nick, a topic/part
 * reason, or a server-supplied session token routed through
 * `buildSessionResumeLine` — could embed `\r\n` and inject a second IRC
 * command (e.g. `PRIVMSG #c :hi\r\nJOIN #evil`). The `send()` echo-strip only
 * trims a *trailing* CRLF, so this builder is the correct choke point.
 */
export function formatIRCLine(command: string, ...params: string[]): string {
  const cmd = stripWireControl(command);
  const clean = params.map(stripWireControl);
  const parts = [cmd, ...clean.slice(0, -1)];
  if (clean.length > 0) {
    const last = clean[clean.length - 1]!;
    // Prefix trailing param with ':' if it is empty, contains a space, or starts with ':'
    if (last === '' || last.includes(' ') || last.startsWith(':')) {
      parts.push(':' + last);
    } else {
      parts.push(last);
    }
  }
  return parts.join(' ') + '\r\n';
}

/**
 * Format a client-tagged IRC line: `@k1=v1;k2 <command> <params...>\r\n`.
 *
 * The command and params flow through {@link formatIRCLine}, so CR/LF/NUL are
 * stripped from every field by construction (the outbound choke point). Tag
 * VALUES are IRCv3-escaped (a `\r`/`\n` becomes `\r`/`\n`, never a raw control
 * byte) and tag KEYS are stripped of wire-control bytes, so neither half of a
 * tag can ever smuggle a second wire command. An empty `tags` yields exactly
 * `formatIRCLine(...)`. Insertion order of `tags` is preserved.
 *
 * This is the safe replacement for hand-built template strings such as
 * `` `${prefix}PRIVMSG ${target} :${body}\r\n` ``, where a lone `\r` (the
 * composer splits only on `\n`) could otherwise survive into the raw send.
 */
export function formatTaggedLine(
  tags: Record<string, string>,
  command: string,
  ...params: string[]
): string {
  const line = formatIRCLine(command, ...params);
  const tagStr = Object.entries(tags)
    .map(([key, value]) =>
      value ? `${stripWireControl(key)}=${escapeTagValue(value)}` : stripWireControl(key),
    )
    .join(';');
  return tagStr ? `@${tagStr} ${line}` : line;
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
  // Status modes are single ASCII letters and their visible NAMES prefixes are
  // punctuation. A mismatched or duplicated map is not partially useful: a
  // missing prefix creates an `undefined` property, while an alphanumeric
  // prefix can strip the first letter from ordinary nicks. Reject the whole
  // capability update so callers can retain their last known-good map.
  if (
    modes.length !== prefixes.length
    || modes.length > 32
    || !/^[A-Za-z]+$/u.test(modes)
    || !/^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]+$/u.test(prefixes)
    || new Set(modes).size !== modes.length
    || new Set(prefixes).size !== prefixes.length
  ) return { modeToPrefix, prefixToMode };
  for (let i = 0; i < modes.length; i++) {
    modeToPrefix[modes[i]!] = prefixes[i]!;
    prefixToMode[prefixes[i]!] = modes[i]!;
  }
  return { modeToPrefix, prefixToMode };
}

export function parseCHANLIMIT(value: string): Record<string, number> {
  // CHANLIMIT is a server-controlled ISUPPORT value. Bound it before split so
  // a single malformed 005 line cannot create an arbitrary number of groups or
  // channel-type assignments. Reject the whole value on ambiguity; callers
  // can then retain their last known-good limits instead of applying a partial
  // capability update.
  const MAX_CHANLIMIT_VALUE_LENGTH = 1024;
  const MAX_CHANLIMIT_GROUPS = 32;
  const MAX_CHANLIMIT_TYPES_PER_GROUP = 16;
  const MAX_CHANLIMIT = 1_000_000;
  const out: Record<string, number> = {};
  if (!value || value.length > MAX_CHANLIMIT_VALUE_LENGTH) return out;

  const parts = value.split(',');
  if (parts.length > MAX_CHANLIMIT_GROUPS) return out;
  const seenTypes = new Set<string>();
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx <= 0 || idx !== part.lastIndexOf(':')) return {};
    const types = part.slice(0, idx);
    const rawLimit = part.slice(idx + 1);
    if (
      types.length > MAX_CHANLIMIT_TYPES_PER_GROUP
      || !/^[\x21-\x2b\x2d-\x39\x3b-\x7e]+$/u.test(types)
      || !/^(?:0|[1-9]\d*)$/u.test(rawLimit)
    ) return {};
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit > MAX_CHANLIMIT) return {};
    for (const ch of types) {
      if (seenTypes.has(ch)) return {};
      seenTypes.add(ch);
      out[ch] = limit;
    }
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

export const MAX_STANDARD_REPLY_PARAMS = 32;
export const MAX_STANDARD_REPLY_TOKEN_LENGTH = 4 * 1024;
const MAX_STANDARD_REPLY_TEGAMI_LENGTH = 128 * 1024;

export function parseStandardReply(msg: IRCMessage): StandardReply | null {
  if (msg.command !== 'NOTE' && msg.command !== 'FAIL' && msg.command !== 'WARN') return null;
  if (msg.params.length === 0 || msg.params.length > MAX_STANDARD_REPLY_PARAMS) return null;
  const command = msg.params[0]!;
  const code = msg.params[1] ?? '';
  // Orochi's offline TEGAMI delivery predates standard-reply framing and puts
  // `from <nick> :<text>` in the apparent code slot. Preserve the vault's
  // bounded 64 KiB message path without granting the larger ceiling to error
  // codes, notifications, or other standard replies.
  const codeLimit = msg.command === 'NOTE'
    && command.toUpperCase() === 'TEGAMI'
    && msg.params.length === 2
    ? MAX_STANDARD_REPLY_TEGAMI_LENGTH
    : MAX_STANDARD_REPLY_TOKEN_LENGTH;
  if (
    !command
    || command.length > MAX_STANDARD_REPLY_TOKEN_LENGTH
    || code.length > codeLimit
  ) return null;

  const description = msg.params.length > 2 ? msg.params[msg.params.length - 1]! : '';
  if (description.length > MAX_STANDARD_REPLY_TOKEN_LENGTH) return null;
  const context: string[] = [];
  for (let index = 2; index < msg.params.length - 1; index += 1) {
    const value = msg.params[index]!;
    if (value.length > MAX_STANDARD_REPLY_TOKEN_LENGTH) return null;
    context.push(value);
  }
  return {
    kind: msg.command,
    command: command.toUpperCase(),
    code: code.toUpperCase(),
    context,
    description,
  };
}

/**
 * Parsed key=value fields from an `ACCOUNTINFO` reply.
 *
 * Orochi answers `ACCOUNTINFO` with a server NOTICE in the shape
 * `account=<name> flags=<n>` (server.zig handleAccountInfo); some deployments
 * append `email=`, `secure=on|off`, `enforce=on|off`, and `registered=`.
 * We extract only the keys the server actually sent — absent keys stay
 * undefined so the UI never displays invented values.
 */
export interface AccountInfoFields {
  account?: string;
  flags?: number;
  email?: string;
  secure?: boolean;
  enforce?: boolean;
  registered?: string;
}

export const MAX_ACCOUNT_INFO_TEXT_LENGTH = 4 * 1024;
const MAX_ACCOUNT_INFO_PAIRS = 64;
const MAX_ACCOUNT_INFO_ACCOUNT_LENGTH = 128;
const MAX_ACCOUNT_INFO_EMAIL_LENGTH = 320;
const MAX_ACCOUNT_INFO_REGISTERED_LENGTH = 64;
const MAX_ACCOUNT_INFO_FLAGS = 0xffff_ffff;

function validAccountInfoToken(value: string, maxLength: number): boolean {
  return value.length > 0
    && value.length <= maxLength
    && !/[\s,\u0000-\u001f\u007f]/u.test(value);
}

function parseBoolToken(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'on' || v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'off' || v === 'false' || v === 'no' || v === '0') return false;
  return undefined;
}

/**
 * Parse the body of an ACCOUNTINFO reply (the NOTICE/NOTE trailing text) into
 * structured fields. Returns null when no recognised `key=value` pair is found,
 * so callers can distinguish "this was an ACCOUNTINFO reply" from unrelated
 * account-channel notices. Tolerant of ordering and extra whitespace.
 */
export function parseAccountInfo(text: string): AccountInfoFields | null {
  if (!text || text.length > MAX_ACCOUNT_INFO_TEXT_LENGTH) return null;
  const fields: AccountInfoFields = {};
  let matched = false;
  let pairCount = 0;
  const seen = new Set<string>();
  // Match key=value where value runs to the next whitespace (values here are
  // tokens: a name, a number, on/off). Email is also a single token.
  const re = /(\w+)=([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    pairCount += 1;
    if (pairCount > MAX_ACCOUNT_INFO_PAIRS) return null;
    const key = m[1]!.toLowerCase();
    const value = m[2]!;
    if (
      (key === 'account'
        || key === 'flags'
        || key === 'email'
        || key === 'secure'
        || key === 'enforce'
        || key === 'registered')
      && seen.has(key)
    ) return null;
    switch (key) {
      case 'account': {
        if (!validAccountInfoToken(value, MAX_ACCOUNT_INFO_ACCOUNT_LENGTH)) return null;
        seen.add(key);
        fields.account = value;
        matched = true;
        break;
      }
      case 'flags': {
        if (!/^(?:0|[1-9]\d*)$/u.test(value)) return null;
        const n = Number(value);
        if (!Number.isSafeInteger(n) || n > MAX_ACCOUNT_INFO_FLAGS) return null;
        seen.add(key);
        fields.flags = n;
        matched = true;
        break;
      }
      case 'email': {
        if (!validAccountInfoToken(value, MAX_ACCOUNT_INFO_EMAIL_LENGTH)) return null;
        seen.add(key);
        fields.email = value;
        matched = true;
        break;
      }
      case 'secure': {
        const b = parseBoolToken(value);
        if (b === undefined) return null;
        seen.add(key);
        fields.secure = b;
        matched = true;
        break;
      }
      case 'enforce': {
        const b = parseBoolToken(value);
        if (b === undefined) return null;
        seen.add(key);
        fields.enforce = b;
        matched = true;
        break;
      }
      case 'registered': {
        if (!validAccountInfoToken(value, MAX_ACCOUNT_INFO_REGISTERED_LENGTH)) return null;
        seen.add(key);
        fields.registered = value;
        matched = true;
        break;
      }
      default:
        break;
    }
  }
  return matched ? fields : null;
}

export const MAX_SESSION_CREDENTIAL_LENGTH = 4 * 1024;
const MAX_SESSION_CREDENTIAL_NOTICE_LENGTH = MAX_SESSION_CREDENTIAL_LENGTH + 512;

function validSessionCredential(token: string | null | undefined): token is string {
  return Boolean(
    token
    && token.length <= MAX_SESSION_CREDENTIAL_LENGTH
    && !/[\s\u0000-\u001f\u007f]/u.test(token),
  );
}

function parseSessionCredential(msg: IRCMessage, kind: 'TOKEN' | 'MTOKEN'): string | null {
  const reply = parseStandardReply(msg);
  if (reply?.kind === 'NOTE' && reply.command === 'SESSION' && reply.code === kind) {
    return validSessionCredential(reply.description) ? reply.description : null;
  }

  // Current Orochi emits session credentials as a traditional server NOTICE:
  //   :server NOTICE <nick> :SESSION TOKEN <token>
  // while older deployments used NOTE SESSION TOKEN. Accept both envelopes;
  // the store applies the NOTICE result only inside its server-source trust gate.
  if (msg.command !== 'NOTICE') return null;
  const body = msg.params[msg.params.length - 1]?.trim() ?? '';
  if (body.length > MAX_SESSION_CREDENTIAL_NOTICE_LENGTH) return null;
  const match = /^SESSION\s+(TOKEN|MTOKEN)\s+(\S+)(?:\s+.*)?$/i.exec(body);
  if (match?.[1]?.toUpperCase() !== kind) return null;
  return validSessionCredential(match[2]) ? match[2] : null;
}

export function parseSessionTokenNote(msg: IRCMessage): string | null {
  return parseSessionCredential(msg, 'TOKEN');
}

/**
 * Parse `:server NOTE SESSION MTOKEN :<token>` — Orochi's mesh-sealed reclaim
 * token, emitted alongside the local TOKEN on mesh deployments. Usable to
 * reclaim/redirect the session from any node via `SESSION RESUME <mtoken>`.
 */
export function parseSessionMeshTokenNote(msg: IRCMessage): string | null {
  return parseSessionCredential(msg, 'MTOKEN');
}

export function buildSessionResumeLine(token: string): string {
  return formatIRCLine('SESSION', 'RESUME', token);
}

export const MAX_MONITOR_NUMERIC_TARGETS = 256;
export const MAX_MONITOR_NUMERIC_TARGET_LENGTH = 512;
const MAX_MONITOR_NUMERIC_LIST_LENGTH = MAX_MONITOR_NUMERIC_TARGETS
  * (MAX_MONITOR_NUMERIC_TARGET_LENGTH + 1);
const MAX_MONITOR_NUMERIC_LIMIT = 1_000_000;
const MAX_MONITOR_NUMERIC_DESCRIPTION_LENGTH = 1024;

/** Parse one bounded server-owned MONITOR target list without partial results. */
function parseMonitorTargets(value: string): string[] {
  if (!value) return [];
  if (value.length > MAX_MONITOR_NUMERIC_LIST_LENGTH) return [];
  const rawTargets = value.split(',');
  if (rawTargets.length > MAX_MONITOR_NUMERIC_TARGETS) return [];

  const targets: string[] = [];
  const seen = new Set<string>();
  for (const rawTarget of rawTargets) {
    const target = rawTarget.trim();
    if (
      !target
      || target.length > MAX_MONITOR_NUMERIC_TARGET_LENGTH
      || /[\s,\u0000-\u001f\u007f]/u.test(target)
    ) return [];
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

export function parseMonitorNumeric(msg: IRCMessage): {
  kind: 'online' | 'offline' | 'full';
  targets: string[];
  limit?: number;
  description?: string;
} | null {
  if (msg.command === '730' || msg.command === '731') {
    const targets = parseMonitorTargets(msg.params[1] ?? msg.params[0] ?? '');
    return { kind: msg.command === '730' ? 'online' : 'offline', targets };
  }
  if (msg.command === '734') {
    const rawLimit = msg.params[1] ?? '';
    const parsedLimit = /^(?:0|[1-9]\d*)$/u.test(rawLimit) ? Number(rawLimit) : NaN;
    const limit = Number.isSafeInteger(parsedLimit) && parsedLimit <= MAX_MONITOR_NUMERIC_LIMIT
      ? parsedLimit
      : undefined;
    const targetParam = msg.params.length >= 4 ? msg.params[2]! : '';
    return {
      kind: 'full',
      targets: parseMonitorTargets(targetParam),
      limit,
      description: (msg.params[msg.params.length - 1] ?? '')
        .slice(0, MAX_MONITOR_NUMERIC_DESCRIPTION_LENGTH),
    };
  }
  return null;
}
