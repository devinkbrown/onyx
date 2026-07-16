// SPDX-License-Identifier: AGPL-3.0-or-later
export type WatchTogetherState = 'playing' | 'paused' | 'seeking' | 'handoff' | 'idle';

export type WatchTogetherActivity = {
  title: string;
  url: string | null;
  host: string | null;
  state: WatchTogetherState;
  positionSeconds: number | null;
  durationSeconds: number | null;
  participants: string[];
  handoffTo: string | null;
};

/** Hard client-side work/render bounds for server-published room metadata. */
export const WATCH_PROP_MAX_LENGTH = 4096;
export const WATCH_TITLE_MAX_LENGTH = 160;
export const WATCH_URL_MAX_LENGTH = 2048;
export const WATCH_NICK_MAX_LENGTH = 64;
export const WATCH_PARTICIPANT_MAX_COUNT = 128;
export const WATCH_SECONDS_MAX = 366 * 24 * 60 * 60;
const DEFAULT_WATCH_TITLE = 'Watch together';

function toWellFormed(value: string): string {
  const params = new URLSearchParams();
  params.set('value', value);
  return params.get('value') ?? '';
}

function sliceBounded(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength);
  const finalCodeUnit = sliced.charCodeAt(sliced.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

function clean(value: string | null | undefined, maxLength = WATCH_PROP_MAX_LENGTH): string | null {
  const trimmed = toWellFormed(value?.trim() ?? '');
  return trimmed.length > 0 ? sliceBounded(trimmed, maxLength) : null;
}

/** Validate a locally supplied IRC identity without truncating it into a
 * different nick. Commas would split into extra roster entries after decode. */
export function normalizeWatchNick(value: string | null | undefined): string | null {
  const trimmed = toWellFormed(value?.trim() ?? '');
  if (!trimmed || trimmed.length > WATCH_NICK_MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f\s,]/u.test(trimmed)) return null;
  return trimmed;
}

function normalizeWatchUrl(value: string | null | undefined): string | null {
  const trimmed = toWellFormed(value?.trim() ?? '');
  if (!trimmed || trimmed.length > WATCH_URL_MAX_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

export function normalizeWatchSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > WATCH_SECONDS_MAX) return null;
  return Math.floor(value);
}

function parseSeconds(value: string | null | undefined): number | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > WATCH_SECONDS_MAX) return null;
  return Math.floor(parsed);
}

function parseState(value: string | null | undefined): WatchTogetherState {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === 'playing' || normalized === 'paused' || normalized === 'seeking' || normalized === 'handoff') {
    return normalized;
  }
  return 'idle';
}

function sameNick(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function normalizeParticipantRoster(
  values: readonly string[],
  host: string | null,
  pendingHandoff: string | null,
): string[] {
  const reservedKeys = new Set(
    [host, pendingHandoff].filter((nick): nick is string => nick !== null)
      .map((nick) => nick.toLowerCase()),
  );
  const participants: string[] = [];
  const participantKeys = new Set<string>();

  for (const rawParticipant of values) {
    const participant = normalizeWatchNick(rawParticipant);
    if (!participant) continue;
    const key = participant.toLowerCase();
    if (participantKeys.has(key)) continue;

    if (participants.length < WATCH_PARTICIPANT_MAX_COUNT) {
      participants.push(participant);
      participantKeys.add(key);
      continue;
    }

    // Host and pending handoff target are authorization-bearing. If either
    // appears beyond the display cap, evict the last non-authoritative entry.
    if (!reservedKeys.has(key)) continue;
    let replaceIndex = -1;
    for (let index = participants.length - 1; index >= 0; index -= 1) {
      const current = participants[index];
      if (current && !reservedKeys.has(current.toLowerCase())) {
        replaceIndex = index;
        break;
      }
    }
    if (replaceIndex < 0) continue;
    const replaced = participants[replaceIndex];
    if (replaced) participantKeys.delete(replaced.toLowerCase());
    participants[replaceIndex] = participant;
    participantKeys.add(key);
  }

  return participants;
}

function encodeWatchTogetherActivity(activity: WatchTogetherActivity): string {
  const params = new URLSearchParams();
  params.set('title', activity.title);
  if (activity.url) params.set('url', activity.url);
  if (activity.host) params.set('host', activity.host);
  params.set('state', activity.state);
  if (activity.positionSeconds !== null) params.set('position', String(activity.positionSeconds));
  if (activity.durationSeconds !== null) params.set('duration', String(activity.durationSeconds));
  if (activity.participants.length > 0) params.set('participants', activity.participants.join(','));
  if (activity.handoffTo) params.set('handoff', activity.handoffTo);
  return params.toString();
}

function trimActivityToWireBudget(activity: WatchTogetherActivity): WatchTogetherActivity {
  let next = activity;
  if (encodeWatchTogetherActivity(next).length <= WATCH_PROP_MAX_LENGTH) return next;

  const reservedKeys = new Set<string>();
  if (next.host && next.participants.some((nick) => sameNick(nick, next.host))) {
    reservedKeys.add(next.host.toLowerCase());
  }
  if (
    next.state === 'handoff'
    && next.handoffTo
    && next.participants.some((nick) => sameNick(nick, next.handoffTo))
  ) {
    reservedKeys.add(next.handoffTo.toLowerCase());
  }

  const participants = [...next.participants];
  while (encodeWatchTogetherActivity({ ...next, participants }).length > WATCH_PROP_MAX_LENGTH) {
    let removeIndex = -1;
    for (let index = participants.length - 1; index >= 0; index -= 1) {
      const participant = participants[index];
      if (participant && !reservedKeys.has(participant.toLowerCase())) {
        removeIndex = index;
        break;
      }
    }
    if (removeIndex < 0) break;
    participants.splice(removeIndex, 1);
  }
  next = { ...next, participants };
  if (encodeWatchTogetherActivity(next).length <= WATCH_PROP_MAX_LENGTH) return next;

  // Never truncate a URL into a different resource. If percent-encoding makes
  // the bounded URL exceed the remaining PROP budget, omit it instead.
  next = { ...next, url: null };
  if (encodeWatchTogetherActivity(next).length <= WATCH_PROP_MAX_LENGTH) return next;

  let title = next.title;
  while (title.length > 1 && encodeWatchTogetherActivity({ ...next, title }).length > WATCH_PROP_MAX_LENGTH) {
    title = sliceBounded(title, title.length - 1);
  }
  next = { ...next, title: title || DEFAULT_WATCH_TITLE };
  if (encodeWatchTogetherActivity(next).length <= WATCH_PROP_MAX_LENGTH) return next;

  // This is unreachable with the exported field limits, but leaves the public
  // serializer with a hard guarantee if those limits change independently.
  return {
    title: DEFAULT_WATCH_TITLE,
    url: null,
    host: null,
    state: 'paused',
    positionSeconds: null,
    durationSeconds: null,
    participants: [],
    handoffTo: null,
  };
}

/** Normalize a local or parsed snapshot before it can cross the PROP boundary. */
export function normalizeWatchTogetherActivity(
  activity: WatchTogetherActivity,
): WatchTogetherActivity {
  const url = normalizeWatchUrl(activity.url);
  const host = normalizeWatchNick(activity.host);
  let state = parseState(activity.state);
  let handoffTo = normalizeWatchNick(activity.handoffTo);
  const pendingHandoff = state === 'handoff' ? handoffTo : null;
  const participants = normalizeParticipantRoster(activity.participants, host, pendingHandoff);

  if (
    state === 'handoff'
    && (
      !host
      || !handoffTo
      || sameNick(host, handoffTo)
      || !participants.some((nick) => sameNick(nick, host))
      || !participants.some((nick) => sameNick(nick, handoffTo))
    )
  ) {
    state = 'paused';
    handoffTo = null;
  }

  const normalized: WatchTogetherActivity = {
    // A URL is a useful fallback label, but it still crosses the title/render
    // boundary. Re-apply the title cap instead of copying a valid 2 KiB URL
    // wholesale into a field whose public contract is 160 characters.
    title: clean(activity.title, WATCH_TITLE_MAX_LENGTH)
      ?? clean(url, WATCH_TITLE_MAX_LENGTH)
      ?? DEFAULT_WATCH_TITLE,
    url,
    host,
    state,
    positionSeconds: normalizeWatchSeconds(activity.positionSeconds),
    durationSeconds: normalizeWatchSeconds(activity.durationSeconds),
    participants,
    handoffTo,
  };
  return trimActivityToWireBudget(normalized);
}

/** Serialize only after applying the shared outbound normalizer. */
export function serializeWatchTogetherActivity(activity: WatchTogetherActivity): string {
  return encodeWatchTogetherActivity(normalizeWatchTogetherActivity(activity));
}

export function formatWatchClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function watchTogetherStateLabel(activity: WatchTogetherActivity): string {
  const at = activity.positionSeconds === null ? '' : ` ${formatWatchClock(activity.positionSeconds)}`;
  if (activity.state === 'playing') return `Playing${at}`;
  if (activity.state === 'paused') return `Paused${at}`;
  if (activity.state === 'seeking') return `Seeking${at}`;
  if (activity.state === 'handoff') {
    return activity.handoffTo ? `Handoff to ${activity.handoffTo}` : 'Handoff ready';
  }
  return activity.positionSeconds === null ? 'Ready' : `Ready ${formatWatchClock(activity.positionSeconds)}`;
}

export function parseWatchTogetherProp(raw: string | null | undefined): WatchTogetherActivity | null {
  // Reject rather than truncate an oversized query string: truncating at an
  // arbitrary separator could turn a malformed hostile value into a different
  // valid activity. The bound also caps URLSearchParams parsing work.
  if (typeof raw === 'string' && raw.length > WATCH_PROP_MAX_LENGTH) return null;
  const source = clean(raw, WATCH_PROP_MAX_LENGTH);
  if (!source) return null;

  const params = new URLSearchParams(source.replace(/;/g, '&'));
  const title = clean(params.get('title'), WATCH_TITLE_MAX_LENGTH);
  const url = clean(params.get('url'), WATCH_URL_MAX_LENGTH);
  if (!title && !url) return null;

  const participants: string[] = [];
  const participantKeys = new Set<string>();
  for (const rawParticipant of (params.get('participants') ?? '').split(',')) {
    if (participants.length >= WATCH_PARTICIPANT_MAX_COUNT) break;
    const participant = clean(rawParticipant, WATCH_NICK_MAX_LENGTH);
    if (!participant) continue;
    const key = participant.toLowerCase();
    if (participantKeys.has(key)) continue;
    participantKeys.add(key);
    participants.push(participant);
  }

  return normalizeWatchTogetherActivity({
    title: title ?? url ?? 'Watch together',
    url,
    host: clean(params.get('host'), WATCH_NICK_MAX_LENGTH),
    state: parseState(params.get('state')),
    positionSeconds: parseSeconds(params.get('position')),
    durationSeconds: parseSeconds(params.get('duration')),
    participants,
    handoffTo: clean(params.get('handoff'), WATCH_NICK_MAX_LENGTH),
  });
}
