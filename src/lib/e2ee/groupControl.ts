// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Bounded wire codec for opaque room-E2EE control records.
 *
 * The payload is treated as an uninterpreted canonical base64url value here.
 * Cryptographic validation belongs to the group-state implementation; this
 * layer only enforces the client/server routing contract.
 */

import type { IRCMessage } from '@/lib/irc/types';

import { fromB64url, toB64url } from './dmCipher';

export const GROUP_CONTROL_COMMAND = 'E2EEGROUP';
export const MAX_GROUP_CONTROL_PAYLOAD = 4096;
export const MAX_GROUP_CONTROL_ACCOUNT = 64;
export const MAX_GROUP_CONTROL_DEVICE = 32;

export type GroupControlKind = 'key-package' | 'welcome' | 'commit';

export type GroupControlRecord = {
  channel: string;
  kind: GroupControlKind;
  fromDevice: string;
  toAccount?: string;
  toDevice?: string;
  payload: string;
};

const DEVICE_RE = /^[A-Za-z0-9_.-]+$/;
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]+$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function validChannel(value: string): boolean {
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (value.length < 2 || byteLength > 128) return false;
  if (value[0] !== '#' && value[0] !== '&') return false;
  return !/[\x00-\x20,:\x7f]/.test(value.slice(1));
}

function validDevice(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_GROUP_CONTROL_DEVICE
    && DEVICE_RE.test(value);
}

function validAccount(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_GROUP_CONTROL_ACCOUNT
    && ACCOUNT_RE.test(value);
}

function validPayload(value: string): boolean {
  if (
    value.length === 0
    || value.length > MAX_GROUP_CONTROL_PAYLOAD
    || !B64URL_RE.test(value)
  ) {
    return false;
  }
  const decoded = fromB64url(value);
  return decoded !== null && toB64url(decoded) === value;
}

function validRecord(record: GroupControlRecord): boolean {
  if (
    !validChannel(record.channel)
    || !validDevice(record.fromDevice)
    || !validPayload(record.payload)
  ) {
    return false;
  }
  if (record.kind === 'welcome') {
    return validAccount(record.toAccount ?? '')
      && validDevice(record.toDevice ?? '');
  }
  return record.toAccount === undefined && record.toDevice === undefined;
}

/** Build exactly one canonical IRC command line, including its trailing CRLF. */
export function buildGroupControlLine(record: GroupControlRecord): string | null {
  if (!validRecord(record)) return null;
  const route = record.kind === 'welcome'
    ? ` ${record.toAccount!} ${record.toDevice!}`
    : '';
  return `${GROUP_CONTROL_COMMAND} ${record.channel} ${record.kind} ${record.fromDevice}${route} :${record.payload}\r\n`;
}

/** Parse an inbound E2EEGROUP record without decoding or opening its payload. */
export function parseGroupControlMessage(message: IRCMessage): GroupControlRecord | null {
  if (message.command.toUpperCase() !== GROUP_CONTROL_COMMAND) return null;
  const kind = message.params[1]?.toLowerCase();
  if (kind !== 'key-package' && kind !== 'welcome' && kind !== 'commit') return null;

  const expectedParams = kind === 'welcome' ? 6 : 4;
  if (message.params.length !== expectedParams) return null;
  const record: GroupControlRecord = {
    channel: message.params[0] ?? '',
    kind,
    fromDevice: message.params[2] ?? '',
    payload: message.params[expectedParams - 1] ?? '',
  };
  if (kind === 'welcome') {
    record.toAccount = message.params[3];
    record.toDevice = message.params[4];
  }
  return validRecord(record) ? record : null;
}
