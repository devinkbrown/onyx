// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Adapter for server-delivered `E2EE.KEYPACKAGE`, `E2EE.COMMIT`, and
 * `E2EE.WELCOME` records.  The account-bearing delivery field is parsed into
 * routing, but the server prefix is never treated as authentication; the
 * resolver still checks it against the caller's authenticated owner.
 */

import type { IRCMessage } from '@/lib/irc/types';

import { fromB64url, toB64url } from './dmCipher';
import {
  normalizeGroupControlRouting,
  parseGroupControlPayload,
  GROUP_CONTROL_PAYLOAD_VERSION,
  type GroupControlPayloadParts,
  type GroupControlPayloadKind,
  type GroupControlRouting,
} from './groupControlPayload';

export type GroupControlDelivery = GroupControlRouting & {
  command: 'E2EE.KEYPACKAGE' | 'E2EE.COMMIT' | 'E2EE.WELCOME';
  payload: string;
  sourcePrefix: string | null;
  /** Structural OGC1 v1/unknown payloads remain visible only as locked. */
  locked: boolean;
  payloadParts: GroupControlPayloadParts | null;
  lockReason?: 'missing-account' | 'legacy-ogc1' | 'bad-payload';
};

type RawDelivery = {
  command: string;
  params: string[];
  prefix: string | null;
};

const COMMANDS = new Map<string, { kind: GroupControlPayloadKind; command: GroupControlDelivery['command'] }>([
  ['E2EE.KEYPACKAGE', { kind: 'key-package', command: 'E2EE.KEYPACKAGE' }],
  ['E2EE.COMMIT', { kind: 'commit', command: 'E2EE.COMMIT' }],
  ['E2EE.WELCOME', { kind: 'welcome', command: 'E2EE.WELCOME' }],
]);

function parseRawDeliveryLine(line: string): RawDelivery | null {
  const raw = line.replace(/\r?\n$/u, '');
  if (raw.length === 0 || /[\x00]/u.test(raw)) return null;
  let rest = raw;
  let prefix: string | null = null;
  if (rest.startsWith('@')) {
    const tagEnd = rest.indexOf(' ');
    if (tagEnd < 0) return null;
    rest = rest.slice(tagEnd + 1);
  }
  if (rest.startsWith(':')) {
    const prefixEnd = rest.indexOf(' ');
    if (prefixEnd < 0) return null;
    prefix = rest.slice(1, prefixEnd);
    if (!prefix || /[\s,\x00-\x1f\x7f]/u.test(prefix)) return null;
    rest = rest.slice(prefixEnd + 1);
  }
  const commandEnd = rest.indexOf(' ');
  const command = (commandEnd < 0 ? rest : rest.slice(0, commandEnd)).toUpperCase();
  if (!COMMANDS.has(command)) return null;
  rest = commandEnd < 0 ? '' : rest.slice(commandEnd + 1);
  const params: string[] = [];
  while (rest.length > 0) {
    while (rest.startsWith(' ')) rest = rest.slice(1);
    if (!rest) break;
    if (rest.startsWith(':')) {
      params.push(rest.slice(1));
      break;
    }
    const end = rest.indexOf(' ');
    if (end < 0) {
      params.push(rest);
      rest = '';
    } else {
      params.push(rest.slice(0, end));
      rest = rest.slice(end + 1);
    }
  }
  return { command, params, prefix };
}

function rawFromMessage(message: IRCMessage): RawDelivery | null {
  const command = message.command.toUpperCase();
  if (COMMANDS.has(command)) {
    return { command, params: message.params.slice(), prefix: message.prefix };
  }
  // parseIRCMessage intentionally accepts only RFC alphanumeric commands, so
  // dotted vendor verbs arrive with command="". Re-parse the original bytes.
  return parseRawDeliveryLine(message.raw);
}

function validPayload(payload: string): boolean {
  if (payload.length === 0) return false;
  const raw = fromB64url(payload);
  return raw !== null && toB64url(raw) === payload;
}

/**
 * Parse an inbound delivery. Current records carry the sender account on the
 * wire; the optional account is retained only for legacy account-less records.
 * The account is normalized to lowercase and is never read from `prefix`.
 */
export function parseGroupControlDelivery(
  message: IRCMessage | string,
  explicitFromAccount?: string,
): GroupControlDelivery | null {
  const raw = typeof message === 'string' ? parseRawDeliveryLine(message) : rawFromMessage(message);
  if (!raw) return null;
  const descriptor = COMMANDS.get(raw.command);
  if (!descriptor || !validPayload(raw.params[raw.params.length - 1] ?? '')) return null;
  const payload = raw.params[raw.params.length - 1]!;
  const currentExpected = descriptor.kind === 'welcome' ? 6 : 4;
  const legacyExpected = descriptor.kind === 'welcome' ? 5 : 3;
  const hasWireAccount = raw.params.length === currentExpected;
  const hasLegacyShape = raw.params.length === legacyExpected;
  if (!hasWireAccount && !hasLegacyShape) return null;
  const fromAccount = hasWireAccount ? raw.params[1] : explicitFromAccount;
  if (!fromAccount) return null;
  const fromDeviceIndex = hasWireAccount ? 2 : 1;

  const routing: GroupControlRouting = descriptor.kind === 'welcome'
    ? {
      channel: raw.params[0] ?? '',
      kind: 'welcome',
      fromAccount,
      fromDevice: raw.params[fromDeviceIndex] ?? '',
      toAccount: raw.params[hasWireAccount ? 3 : 2],
      toDevice: raw.params[hasWireAccount ? 4 : 3],
    }
    : {
      channel: raw.params[0] ?? '',
      kind: descriptor.kind,
      fromAccount,
      fromDevice: raw.params[fromDeviceIndex] ?? '',
    };
  const normalized = normalizeGroupControlRouting(routing);
  if (!normalized) return null;
  const payloadParts = parseGroupControlPayload(payload);
  const locked = !hasWireAccount
    || payloadParts === null
    || payloadParts.version !== GROUP_CONTROL_PAYLOAD_VERSION
    || payloadParts.diagnosticOnly === true;
  return {
    ...normalized,
    command: descriptor.command,
    payload,
    sourcePrefix: raw.prefix,
    locked,
    payloadParts,
    lockReason: !hasWireAccount
      ? 'missing-account'
      : payloadParts === null
        ? 'bad-payload'
        : payloadParts.version !== GROUP_CONTROL_PAYLOAD_VERSION || payloadParts.diagnosticOnly === true
          ? 'legacy-ogc1'
          : undefined,
  };
}

/** Explicit line-oriented alias for socket adapters. */
export function parseGroupControlDeliveryLine(
  line: string,
  fromAccount?: string,
): GroupControlDelivery | null {
  return parseGroupControlDelivery(line, fromAccount);
}
