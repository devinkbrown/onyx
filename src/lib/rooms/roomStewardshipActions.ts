// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Thin dispatch over existing owner / op / PART / CHANNEL DROP commands.
 * Accept-to-take is a client gate: MODE +q is not sent until accept, and
 * the current owner still has to grant — Onyx Server has no take-ownership
 * handshake in this client.
 */
import { getState } from '@/lib/store';
import { transferFor, writeRoomTransfer } from './roomTransferMemory';
import {
  STEWARDSHIP_COPY,
  acceptTransfer,
  actorIsOwner,
  canDeleteRoom,
  declineTransfer,
  listCoAdmins,
  offerTransfer,
  rejectThirdCoAdmin,
  transferModeCommands,
  type StewardMember,
} from './roomStewardship';

export type StewardshipResult = { ok: true } | { ok: false; reason: string };

function membersOf(channel: string): StewardMember[] {
  const ch = getState().channels.get(channel.trim().toLowerCase());
  if (!ch) return [];
  return [...ch.users.values()].map((user) => ({
    nick: user.nick,
    modes: [...user.modes],
  }));
}

function connected(): boolean {
  const state = getState();
  return !!state.client && state.connectionStatus === 'connected';
}

function ownerMembers(channel: string): StewardMember[] | StewardshipResult {
  if (!connected()) return { ok: false, reason: 'Reconnect to change this room.' };
  const members = membersOf(channel);
  if (!actorIsOwner(members, getState().ourNick)) {
    return { ok: false, reason: 'Only the owner can do that.' };
  }
  return members;
}

export function snapshotStewardMembers(channel: string): StewardMember[] {
  return membersOf(channel);
}

export function addRoomCoAdmin(channel: string, nick: string): StewardshipResult {
  const gated = ownerMembers(channel);
  if (!Array.isArray(gated)) return gated;
  const decision = rejectThirdCoAdmin(gated, getState().ourNick, nick);
  if (!decision.ok) return decision;
  getState().opMember(channel, decision.nick, true);
  return { ok: true };
}

export function removeRoomCoAdmin(channel: string, nick: string): StewardshipResult {
  const gated = ownerMembers(channel);
  if (!Array.isArray(gated)) return gated;
  if (!listCoAdmins(gated).some((name) => name.toLowerCase() === nick.trim().toLowerCase())) {
    return { ok: false, reason: 'They do not help with this room.' };
  }
  getState().opMember(channel, nick.trim(), false);
  return { ok: true };
}

export function offerRoomOwnership(channel: string, nick: string): StewardshipResult {
  const gated = ownerMembers(channel);
  if (!Array.isArray(gated)) return gated;
  const next = offerTransfer({
    current: transferFor(channel),
    channel,
    from: getState().ourNick,
    to: nick,
    members: gated,
  });
  if (!next) return { ok: false, reason: 'Pick someone in this room.' };
  writeRoomTransfer(next, channel);
  return { ok: true };
}

export function acceptRoomOwnership(channel: string): StewardshipResult {
  const next = acceptTransfer({
    current: transferFor(channel),
    channel,
    acceptor: getState().ourNick,
  });
  if (!next) return { ok: false, reason: 'There is nothing to accept.' };
  writeRoomTransfer(next, channel);
  return { ok: true };
}

export function declineRoomOwnership(channel: string): StewardshipResult {
  const next = declineTransfer({
    current: transferFor(channel),
    channel,
    actor: getState().ourNick,
  });
  writeRoomTransfer(next, channel);
  return { ok: true };
}

export function grantRoomOwnership(channel: string): StewardshipResult {
  const gated = ownerMembers(channel);
  if (!Array.isArray(gated)) return gated;
  const plan = transferModeCommands(transferFor(channel), gated);
  if (!plan) {
    return { ok: false, reason: STEWARDSHIP_COPY.transferWait };
  }
  for (const command of plan.commands) {
    getState().setChannelMode(channel, command.modes, command.nick);
  }
  writeRoomTransfer(null, channel);
  return { ok: true };
}

/** Tombstone: lock with existing +s +i. No dedicated close command on the wire. */
export function closeConsumerRoom(channel: string): StewardshipResult {
  const gated = ownerMembers(channel);
  if (!Array.isArray(gated)) return gated;
  getState().setChannelMode(channel, '+si');
  return { ok: true };
}

export function deleteConsumerRoom(channel: string, typedName: string): StewardshipResult {
  const gated = ownerMembers(channel);
  if (!Array.isArray(gated)) return gated;
  if (!canDeleteRoom({
    actorIsOwner: true,
    typedName,
    room: channel,
  })) {
    return { ok: false, reason: 'Type the room name to delete it.' };
  }
  getState().client?.sendRaw('CHANNEL', 'DROP', channel);
  getState().partChannel(channel);
  writeRoomTransfer(null, channel);
  return { ok: true };
}
