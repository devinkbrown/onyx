// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * formationLoop.ts — 3-in-48h Home nag for a room that just started.
 *
 * Slack's dead-workspace problem is founders who create and never invite.
 * Home names people who have actually shown up. It does not invent members,
 * DAU, or a product tour.
 */

export const FORMATION_TARGET = 3;
export const FORMATION_WINDOW_MS = 48 * 60 * 60 * 1000;

export type FormationRole = 'founder' | 'joiner';

export type FormationMember = {
  nick: string;
  modes: readonly string[];
  hasChat: boolean;
};

export type FormationChannel = {
  name: string;
  createdAtMs: number | null;
  members: readonly FormationMember[];
};

export type FormationRoomMemory = {
  firstSeenAt: number;
  role: FormationRole;
  firstJoiner: string | null;
  expectedNicks: readonly string[];
};

export type FormationMemorySnapshot = {
  rooms: Readonly<Record<string, FormationRoomMemory>>;
  inviteChannel: string | null;
};

export type FormationStripKind = 'waiting' | 'first-join' | 'joiner';

export type FormationStrip = {
  kind: FormationStripKind;
  channel: string;
  present: number;
  missing: number;
  knownNames: readonly string[];
  headline: string;
  detail: string | null;
  canReshare: boolean;
};

export type FormationLoopInput = {
  nowMs: number;
  connected: boolean;
  ourNick: string;
  channels: readonly FormationChannel[];
  pendingJoin: string | null;
  memory: FormationMemorySnapshot;
};

const NICK_INVALID = /[\s,\x00-\x1f\x7f]/u;

export function emptyFormationMemory(): FormationMemorySnapshot {
  return { rooms: {}, inviteChannel: null };
}

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

export function listKnownNames(names: readonly string[]): string {
  const visible = names.map(visibleNick).filter(Boolean);
  if (visible.length === 0) return '';
  if (visible.length === 1) return visible[0]!;
  if (visible.length === 2) return `${visible[0]} and ${visible[1]}`;
  return `${visible.slice(0, -1).join(', ')}, and ${visible[visible.length - 1]}`;
}

export function missingHeadline(missing: number): string {
  if (missing === 1) return "1 of 3 hasn't opened this";
  return `${missing} of 3 haven't opened this`;
}

export function isFounderMember(member: FormationMember | undefined, present: number): boolean {
  if (!member) return false;
  if (member.modes.includes('Q')) return true;
  return present === 1;
}

function memberFor(channel: FormationChannel, nick: string): FormationMember | undefined {
  const key = nickKey(nick);
  return channel.members.find((member) => nickKey(member.nick) === key);
}

function others(channel: FormationChannel, ourNick: string): FormationMember[] {
  const self = nickKey(ourNick);
  return channel.members.filter((member) => nickKey(member.nick) !== self && isUsableNick(member.nick));
}

function expectedMissing(memory: FormationRoomMemory | undefined, presentKeys: ReadonlySet<string>): string[] {
  if (!memory) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const nick of memory.expectedNicks) {
    if (!isUsableNick(nick)) continue;
    const key = nickKey(nick);
    if (presentKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    names.push(visibleNick(nick));
  }
  return names;
}

function ageMs(
  channel: FormationChannel,
  memory: FormationRoomMemory | undefined,
  nowMs: number,
): number | null {
  if (channel.createdAtMs != null && Number.isFinite(channel.createdAtMs)) {
    return Math.max(0, nowMs - channel.createdAtMs);
  }
  if (memory && Number.isFinite(memory.firstSeenAt)) {
    return Math.max(0, nowMs - memory.firstSeenAt);
  }
  return null;
}

function inWindow(age: number | null): boolean {
  return age !== null && age <= FORMATION_WINDOW_MS;
}

function waitingDetail(input: {
  channel: string;
  present: number;
  othersHere: readonly string[];
  missingNames: readonly string[];
}): string {
  if (input.missingNames.length > 0) {
    const names = listKnownNames(input.missingNames);
    return input.missingNames.length === 1
      ? `${names} hasn't opened this.`
      : `${names} haven't opened this.`;
  }
  if (input.present <= 1) {
    return `Just you in ${input.channel} so far.`;
  }
  if (input.othersHere.length === 1) {
    return `${input.othersHere[0]} is here.`;
  }
  if (input.othersHere.length > 1) {
    return `${listKnownNames(input.othersHere)} are here.`;
  }
  return `Just ${input.present} ${input.present === 1 ? 'person' : 'people'} in ${input.channel} so far.`;
}

function waitingStrip(channel: string, present: number, othersHere: readonly string[], missingNames: readonly string[]): FormationStrip {
  const missing = Math.max(0, FORMATION_TARGET - present);
  return {
    kind: 'waiting',
    channel,
    present,
    missing,
    knownNames: othersHere,
    headline: missingHeadline(missing),
    detail: waitingDetail({ channel, present, othersHere, missingNames }),
    canReshare: true,
  };
}

function firstJoinStrip(channel: string, joiner: string, present: number): FormationStrip {
  const missing = Math.max(0, FORMATION_TARGET - present);
  return {
    kind: 'first-join',
    channel,
    present,
    missing,
    knownNames: [joiner],
    headline: `${joiner} is here — say the thing you invited them for.`,
    detail: missing > 0 ? missingHeadline(missing) : null,
    canReshare: true,
  };
}

function joinerStrip(channel: string, inviter: string | null): FormationStrip {
  return {
    kind: 'joiner',
    channel,
    present: 0,
    missing: 0,
    knownNames: inviter ? [inviter] : [],
    headline: inviter
      ? `Say hi to ${inviter}`
      : 'Say hi to the person who invited you',
    detail: `They invited you to ${channel}.`,
    canReshare: false,
  };
}

function inviteTarget(input: FormationLoopInput): string | null {
  const pending = input.pendingJoin?.trim() || null;
  const remembered = input.memory.inviteChannel?.trim() || null;
  const raw = pending ?? remembered;
  if (!raw) return null;
  return raw.startsWith('#') || raw.startsWith('&') ? raw : null;
}

function founderInviter(channel: FormationChannel, ourNick: string): string | null {
  const self = nickKey(ourNick);
  for (const member of channel.members) {
    if (!member.modes.includes('Q')) continue;
    if (nickKey(member.nick) === self) continue;
    if (!isUsableNick(member.nick)) continue;
    return visibleNick(member.nick);
  }
  return null;
}

/**
 * Pick at most one Home strip. Founder nags beat joiner greetings.
 * Never invents a person who is not on the roster or in remembered invite names.
 */
export function selectFormationStrip(input: FormationLoopInput): FormationStrip | null {
  if (!input.connected) return null;
  const ourNick = input.ourNick.trim();
  if (!isUsableNick(ourNick)) return null;

  const founderStrips: FormationStrip[] = [];
  for (const channel of input.channels) {
    const name = channel.name.trim();
    if (!(name.startsWith('#') || name.startsWith('&'))) continue;
    const key = channelKey(name);
    const memory = input.memory.rooms[key];
    const self = memberFor(channel, ourNick);
    const present = channel.members.filter((member) => isUsableNick(member.nick)).length;
    const founderNow = isFounderMember(self, present) || memory?.role === 'founder';
    if (!founderNow) continue;
    const age = ageMs(channel, memory, input.nowMs);
    if (!inWindow(age) || present >= FORMATION_TARGET) continue;

    const here = others(channel, ourNick);
    const othersHere = here.map((member) => visibleNick(member.nick));
    const presentKeys = new Set(channel.members.map((member) => nickKey(member.nick)));
    const missingNames = expectedMissing(memory, presentKeys);
    const firstJoiner = memory?.firstJoiner && isUsableNick(memory.firstJoiner)
      ? visibleNick(memory.firstJoiner)
      : (here.length === 1 ? othersHere[0] ?? null : null);
    const firstJoinerMember = firstJoiner
      ? here.find((member) => nickKey(member.nick) === nickKey(firstJoiner))
      : undefined;
    const showFirstJoin = Boolean(firstJoiner && firstJoinerMember && !firstJoinerMember.hasChat);

    founderStrips.push(
      showFirstJoin && firstJoiner
        ? firstJoinStrip(name, firstJoiner, present)
        : waitingStrip(name, present, othersHere, missingNames),
    );
  }

  founderStrips.sort((a, b) => {
    if (a.kind === 'first-join' && b.kind !== 'first-join') return -1;
    if (a.kind !== 'first-join' && b.kind === 'first-join') return 1;
    if (a.present !== b.present) return a.present - b.present;
    return a.channel.localeCompare(b.channel);
  });
  const founder = founderStrips[0];
  if (founder) return founder;

  const invited = inviteTarget(input);
  if (!invited) return null;
  const invitedKey = channelKey(invited);
  const joined = input.channels.find((channel) => channelKey(channel.name) === invitedKey);
  if (!joined) return null;
  const self = memberFor(joined, ourNick);
  if (!self) return null;
  const present = joined.members.filter((member) => isUsableNick(member.nick)).length;
  const memory = input.memory.rooms[invitedKey];
  if (isFounderMember(self, present) || memory?.role === 'founder') return null;
  const age = ageMs(joined, memory, input.nowMs);
  if (age !== null && !inWindow(age)) return null;
  if (self.hasChat) return null;
  return joinerStrip(joined.name.trim(), founderInviter(joined, ourNick));
}
