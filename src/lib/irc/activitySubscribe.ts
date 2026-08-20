// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ACTIVITY SUBSCRIBE stream (#33) — subscribe/unsubscribe builders and a
 * fail-closed inbound parser for `:nick ACTIVITY <#chan> typing|react|unreact …`.
 *
 * Distinct from `src/lib/activity.ts`, which parses human STATUS/ACTIVITY
 * custom-status strings for the ribbon.
 */
import type { IRCMessage } from './types';

export const ACTIVITY_COMMAND = 'ACTIVITY';
export const MAX_ACTIVITY_CHANNEL_LENGTH = 512;
export const MAX_ACTIVITY_MSGID_LENGTH = 128;
export const MAX_ACTIVITY_REACTION_LENGTH = 64;

export type ActivitySubscribeOp = 'SUBSCRIBE' | 'UNSUBSCRIBE';

export type ParsedActivityStream =
  | { kind: 'typing'; channel: string; nick: string; active: boolean }
  | {
    kind: 'react';
    channel: string;
    nick: string;
    msgid: string;
    reaction: string;
    op: 'add' | 'remove';
  };

function isChannelTarget(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_ACTIVITY_CHANNEL_LENGTH
    && /^[#&+!]/.test(value)
    && !value.startsWith(':')
    && !value.includes(',')
    && !/[\r\n\0]/.test(value);
}

function isToken(value: string, max: number): boolean {
  return value.length > 0
    && value.length <= max
    && !value.startsWith(':')
    && !value.includes(',')
    && !/[\r\n\0]/.test(value);
}

export function activitySubscribeArgs(
  channel: string,
  op: ActivitySubscribeOp = 'SUBSCRIBE',
): readonly [string, string, string] | null {
  if (!isChannelTarget(channel)) return null;
  return [ACTIVITY_COMMAND, op, channel];
}

export function parseActivityStream(msg: Pick<IRCMessage, 'command' | 'nick' | 'params'>): ParsedActivityStream | null {
  if (msg.command.toUpperCase() !== ACTIVITY_COMMAND) return null;
  const nick = msg.nick?.trim() ?? '';
  const channel = msg.params[0] ?? '';
  const verb = (msg.params[1] ?? '').toLowerCase();
  if (!isToken(nick, 64) || !isChannelTarget(channel)) return null;

  if (verb === 'typing') {
    const state = (msg.params[2] ?? '').toLowerCase();
    if (state === 'active' || state === 'paused') {
      return { kind: 'typing', channel, nick, active: true };
    }
    if (state === 'done') {
      return { kind: 'typing', channel, nick, active: false };
    }
    return null;
  }

  if (verb === 'react' || verb === 'unreact') {
    const msgid = msg.params[2] ?? '';
    const reaction = msg.params[3] ?? '';
    if (!isToken(msgid, MAX_ACTIVITY_MSGID_LENGTH)) return null;
    if (!isToken(reaction, MAX_ACTIVITY_REACTION_LENGTH)) return null;
    return {
      kind: 'react',
      channel,
      nick,
      msgid,
      reaction,
      op: verb === 'unreact' ? 'remove' : 'add',
    };
  }

  return null;
}
