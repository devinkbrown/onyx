// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * roomStewardship.ts — Consumer room care for 3–30 person rooms.
 *
 * Locked product shape:
 *   exactly one owner, 0–2 co-admins, members can invite at this size,
 *   transfer is accept-to-take (not a random successor), owner-only close
 *   or delete, last member leaving dissolves.
 *
 * Ownership is the existing roster status: founder `Q` / owner `q`,
 * co-admins are `o`. No new server command. Founder `Q` is creation-only
 * and cannot be stripped by MODE — after accept we send `+q` / `-q`.
 */

export const CONSUMER_ROOM_MIN = 3;
export const CONSUMER_ROOM_MAX = 30;
export const MAX_CO_ADMINS = 2;

const NICK_INVALID = /[\s,\x00-\x1f\x7f]/u;

export type StewardMember = {
  nick: string;
  modes: readonly string[];
};

export type RoomTransferOffer = {
  channel: string;
  from: string;
  to: string;
  accepted: boolean;
};

export const STEWARDSHIP_COPY = {
  title: 'Room care',
  blurb: 'One owner. Up to two people who can help. Members can invite.',
  thirdCoAdmin: 'This room already has two people who can help.',
  transferWait: 'They have to accept before the room changes hands.',
  transferGrant: 'They accepted. Hand the room over now.',
  transferNoTake:
    'The server cannot let them take the room by themselves. After they accept, the current owner still sends the existing owner rank.',
  founderNote:
    'The first-person rank cannot be removed. After they accept, we send the existing owner rank.',
  closeTitle: (room: string) => `Close ${room}?`,
  closeBody: 'Locks the door. People already here can stay. This is not a delete.',
  closeConfirm: 'Close room',
  deleteTitle: (room: string) => `Delete ${room}?`,
  deleteBody: 'Type the room name to delete it. This cannot be undone here.',
  deleteConfirm: 'Delete room',
  lastMember: 'You are the last person. Leaving dissolves this room.',
  inviteHint: 'Anyone in a room this size can invite.',
} as const;

export function channelKey(name: string): string {
  return name.trim().toLowerCase();
}

export function nickKey(nick: string): string {
  return nick.trim().toLowerCase();
}

export function isUsableNick(nick: string): boolean {
  const trimmed = nick.trim();
  return trimmed.length > 0 && trimmed.length <= 64 && !NICK_INVALID.test(trimmed);
}

export function visibleNick(nick: string): string {
  return nick.trim();
}

export function memberCount(members: readonly StewardMember[]): number {
  return members.filter((member) => isUsableNick(member.nick)).length;
}

export function isConsumerStewardshipRoom(count: number): boolean {
  return count >= CONSUMER_ROOM_MIN && count <= CONSUMER_ROOM_MAX;
}

export function membersCanInvite(count: number): boolean {
  return isConsumerStewardshipRoom(count);
}

export function lastMemberLeaveDissolves(count: number): boolean {
  return count === 1;
}

export function isOwnerModes(modes: readonly string[]): boolean {
  return modes.includes('Q') || modes.includes('q');
}

export function isCoAdminModes(modes: readonly string[]): boolean {
  return modes.includes('o') && !isOwnerModes(modes);
}

export function listOwners(members: readonly StewardMember[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (!isUsableNick(member.nick) || !isOwnerModes(member.modes)) continue;
    const key = nickKey(member.nick);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(visibleNick(member.nick));
  }
  return names;
}

export function listCoAdmins(members: readonly StewardMember[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (!isUsableNick(member.nick) || !isCoAdminModes(member.modes)) continue;
    const key = nickKey(member.nick);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(visibleNick(member.nick));
  }
  return names;
}

export function findMember(
  members: readonly StewardMember[],
  nick: string,
): StewardMember | undefined {
  const key = nickKey(nick);
  return members.find((member) => nickKey(member.nick) === key);
}

export function actorIsOwner(members: readonly StewardMember[], nick: string): boolean {
  const member = findMember(members, nick);
  return !!member && isOwnerModes(member.modes);
}

export function canAddCoAdmin(coAdmins: readonly string[]): boolean {
  return coAdmins.length < MAX_CO_ADMINS;
}

export function rejectThirdCoAdmin(
  members: readonly StewardMember[],
  actor: string,
  candidate: string,
): { ok: true; nick: string } | { ok: false; reason: string } {
  if (!actorIsOwner(members, actor)) {
    return { ok: false, reason: 'Only the owner can add someone who can help.' };
  }
  if (!isUsableNick(candidate)) {
    return { ok: false, reason: 'That name is not a person in this room.' };
  }
  const member = findMember(members, candidate);
  if (!member) {
    return { ok: false, reason: 'That person is not in this room.' };
  }
  if (isOwnerModes(member.modes)) {
    return { ok: false, reason: 'The owner already looks after this room.' };
  }
  if (isCoAdminModes(member.modes)) {
    return { ok: false, reason: 'They already help with this room.' };
  }
  if (!canAddCoAdmin(listCoAdmins(members))) {
    return { ok: false, reason: STEWARDSHIP_COPY.thirdCoAdmin };
  }
  return { ok: true, nick: visibleNick(member.nick) };
}

export function canCompleteTransfer(offer: RoomTransferOffer | null | undefined): boolean {
  return !!offer && offer.accepted === true;
}

export function typedNameMatchesRoom(typed: string, room: string): boolean {
  const got = typed.trim();
  const want = room.trim();
  if (!got || !want) return false;
  if (channelKey(got) === channelKey(want)) return true;
  const wantBare = want.replace(/^[&#]/, '');
  const gotBare = got.replace(/^[&#]/, '');
  return gotBare.length > 0 && channelKey(gotBare) === channelKey(wantBare);
}

export function canDeleteRoom(input: {
  actorIsOwner: boolean;
  typedName: string;
  room: string;
}): boolean {
  return input.actorIsOwner && typedNameMatchesRoom(input.typedName, input.room);
}

export function offerTransfer(input: {
  current: RoomTransferOffer | null;
  channel: string;
  from: string;
  to: string;
  members: readonly StewardMember[];
}): RoomTransferOffer | null {
  if (!isUsableNick(input.from) || !isUsableNick(input.to)) return null;
  if (nickKey(input.from) === nickKey(input.to)) return null;
  if (!actorIsOwner(input.members, input.from)) return null;
  if (!findMember(input.members, input.to)) return null;
  if (input.current && channelKey(input.current.channel) === channelKey(input.channel) && !input.current.accepted) {
    if (nickKey(input.current.from) === nickKey(input.from) && nickKey(input.current.to) === nickKey(input.to)) {
      return input.current;
    }
  }
  return {
    channel: input.channel.trim(),
    from: visibleNick(input.from),
    to: visibleNick(input.to),
    accepted: false,
  };
}

export function acceptTransfer(input: {
  current: RoomTransferOffer | null;
  channel: string;
  acceptor: string;
}): RoomTransferOffer | null {
  const offer = input.current;
  if (!offer) return null;
  if (channelKey(offer.channel) !== channelKey(input.channel)) return null;
  if (nickKey(offer.to) !== nickKey(input.acceptor)) return null;
  if (offer.accepted) return offer;
  return { ...offer, accepted: true };
}

export function declineTransfer(input: {
  current: RoomTransferOffer | null;
  channel: string;
  actor: string;
}): RoomTransferOffer | null {
  const offer = input.current;
  if (!offer) return null;
  if (channelKey(offer.channel) !== channelKey(input.channel)) return offer;
  const actor = nickKey(input.actor);
  if (actor !== nickKey(offer.to) && actor !== nickKey(offer.from)) return offer;
  return null;
}

export type TransferModeCommand = { modes: string; nick: string };

export function transferModeCommands(
  offer: RoomTransferOffer | null,
  members: readonly StewardMember[],
): { commands: TransferModeCommand[]; founderRemains: boolean } | null {
  if (!canCompleteTransfer(offer) || !offer) return null;
  const from = findMember(members, offer.from);
  const to = findMember(members, offer.to);
  if (!to) return null;
  const commands: TransferModeCommand[] = [{ modes: '+q', nick: visibleNick(to.nick) }];
  const fromHasOwner = !!from && from.modes.includes('q');
  const founderRemains = !!from && from.modes.includes('Q');
  if (fromHasOwner) {
    commands.push({ modes: '-q', nick: visibleNick(from.nick) });
  }
  return { commands, founderRemains };
}
