// SPDX-License-Identifier: AGPL-3.0-or-later
// Watch-together host-side state machine (roadmap v2.3 Cadence media era).
//
// This module is PURE and DOM-free: every transition is a total function that
// returns a new immutable session and never mutates its input. The heavy logic
// lives here (coverage-counting) so the SolidJS surface can stay thin.
//
// The wire representation is the SAME `ocean.watch` channel PROP that
// `parseWatchTogetherProp` reads. Serialization first normalizes adversarial
// local input, so every state-machine-produced activity round-trips exactly and
// arbitrary input round-trips to its bounded normalized form. `tick()` advances
// `positionSeconds` locally between PROP pushes so playback stays smooth without
// wire chatter.

import {
  normalizeWatchNick,
  normalizeWatchSeconds,
  normalizeWatchTogetherActivity,
  parseWatchTogetherProp,
  serializeWatchTogetherActivity,
  WATCH_PARTICIPANT_MAX_COUNT,
  WATCH_SECONDS_MAX,
  type WatchTogetherActivity,
} from './watchTogether';

/**
 * A live watch-together session: the round-trippable activity snapshot plus a
 * wall-clock anchor (`anchorMs`) recording when `activity.positionSeconds` was
 * last set. Only `activity` is serialized to the wire; `anchorMs` is local.
 */
export interface WatchSession {
  readonly activity: WatchTogetherActivity;
  /** Wall-clock ms when `activity.positionSeconds` was last anchored. */
  readonly anchorMs: number;
}

export interface CreateWatchSessionOptions {
  host: string;
  title: string;
  url?: string | null;
  durationSeconds?: number | null;
  nowMs: number;
}

const DEFAULT_TITLE = 'Watch together';

function sameNick(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function normalizeDuration(value: number | null | undefined): number | null {
  return normalizeWatchSeconds(value);
}

function clampPosition(seconds: number, durationSeconds: number | null): number {
  const floored = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const atLeastZero = floored < 0 ? 0 : floored;
  const bounded = Math.min(atLeastZero, WATCH_SECONDS_MAX);
  if (durationSeconds !== null && bounded > durationSeconds) return durationSeconds;
  return bounded;
}

/** True when `selfNick` is the current host and therefore holds the controls. */
export function isWatchHost(session: WatchSession, selfNick: string | null | undefined): boolean {
  return sameNick(session.activity.host, selfNick);
}

function hasParticipant(participants: readonly string[], nick: string): boolean {
  return participants.some((p) => sameNick(p, nick));
}

/**
 * Serialize an activity into the `ocean.watch` PROP value. Arbitrary local
 * input is normalized first; the resulting bounded activity is the exact
 * inverse of `parseWatchTogetherProp`. Values are form-encoded, so separators
 * embedded in display text cannot become new fields.
 */
export function serializeWatchTogetherProp(activity: WatchTogetherActivity): string {
  return serializeWatchTogetherActivity(activity);
}

/**
 * Wrap a parsed (possibly remote) activity into a tickable session, anchoring
 * playback at `nowMs`. Used by the UI to advance a peer's PROP locally between
 * pushes.
 */
export function sessionFromActivity(activity: WatchTogetherActivity, nowMs: number): WatchSession {
  return { activity: normalizeWatchTogetherActivity(activity), anchorMs: nowMs };
}

/** Start a fresh session as host, paused at 0, with the host as sole participant. */
export function createWatchSession(opts: CreateWatchSessionOptions): WatchSession {
  const host = normalizeWatchNick(opts.host);
  const activity = normalizeWatchTogetherActivity({
    title: opts.title.trim() || DEFAULT_TITLE,
    url: opts.url ?? null,
    host,
    state: 'paused',
    positionSeconds: 0,
    durationSeconds: normalizeDuration(opts.durationSeconds),
    participants: host ? [host] : [],
    handoffTo: null,
  });
  return { activity, anchorMs: opts.nowMs };
}

/**
 * Advance `positionSeconds` by the whole seconds elapsed since `anchorMs` while
 * playing. Sub-second remainder is carried in the new `anchorMs` so there is no
 * drift. Returns the same reference when nothing changed (paused, or <1s elapsed)
 * so callers can cheaply skip re-renders. Reaching `durationSeconds` pauses.
 */
export function tick(session: WatchSession, nowMs: number): WatchSession {
  const { activity, anchorMs } = session;
  if (activity.state !== 'playing') return session;

  const elapsedMs = nowMs - anchorMs;
  if (elapsedMs < 1000) return session;

  const wholeSeconds = Math.floor(elapsedMs / 1000);
  const target = (activity.positionSeconds ?? 0) + wholeSeconds;
  const duration = activity.durationSeconds;
  const nextAnchor = anchorMs + wholeSeconds * 1000;

  if (target >= WATCH_SECONDS_MAX) {
    return {
      activity: normalizeWatchTogetherActivity({
        ...activity,
        positionSeconds: WATCH_SECONDS_MAX,
        state: 'paused',
      }),
      anchorMs: nextAnchor,
    };
  }

  if (duration !== null && target >= duration) {
    return {
      activity: { ...activity, positionSeconds: duration, state: 'paused' },
      anchorMs: nextAnchor,
    };
  }
  return {
    activity: { ...activity, positionSeconds: target },
    anchorMs: nextAnchor,
  };
}

/** Host-only: begin/resume playback from the current position. */
export function play(session: WatchSession, nowMs: number, selfNick: string): WatchSession {
  if (!isWatchHost(session, selfNick)) return session;
  if (session.activity.state === 'playing') return session;
  return {
    activity: { ...session.activity, state: 'playing', handoffTo: null },
    anchorMs: nowMs,
  };
}

/** Host-only: freeze playback at the currently-ticked position. */
export function pause(session: WatchSession, nowMs: number, selfNick: string): WatchSession {
  if (!isWatchHost(session, selfNick)) return session;
  const advanced = tick(session, nowMs);
  if (advanced.activity.state === 'paused') {
    // Already paused (or tick auto-paused at the end) — nothing to change.
    return advanced === session ? session : advanced;
  }
  return {
    activity: { ...advanced.activity, state: 'paused' },
    anchorMs: nowMs,
  };
}

/** Host-only: jump to `positionSeconds`, preserving play/pause state. */
export function seek(
  session: WatchSession,
  positionSeconds: number,
  nowMs: number,
  selfNick: string,
): WatchSession {
  if (!isWatchHost(session, selfNick)) return session;
  const next = clampPosition(positionSeconds, session.activity.durationSeconds);
  if (next === session.activity.positionSeconds) return session;
  return {
    activity: { ...session.activity, positionSeconds: next },
    anchorMs: nowMs,
  };
}

/**
 * Anyone: add `nick` to the participant roster. No-op (same reference) when
 * already present. Does not disturb playback timing.
 */
export function join(session: WatchSession, nick: string, _nowMs: number): WatchSession {
  const clean = normalizeWatchNick(nick);
  if (!clean) return session;
  if (hasParticipant(session.activity.participants, clean)) return session;
  if (session.activity.participants.length >= WATCH_PARTICIPANT_MAX_COUNT) return session;
  const activity = normalizeWatchTogetherActivity({
    ...session.activity,
    participants: [...session.activity.participants, clean],
  });
  if (!hasParticipant(activity.participants, clean)) return session;
  return {
    ...session,
    activity,
  };
}

/**
 * Participants may remove themselves from the roster. The active host cannot
 * leave directly because that would silently orphan authorization; ownership
 * must be handed off first. If the pending target leaves, cancel the offer into
 * a paused state.
 */
export function leave(session: WatchSession, nick: string, _nowMs: number): WatchSession {
  const clean = normalizeWatchNick(nick);
  if (!clean) return session;
  if (!hasParticipant(session.activity.participants, clean)) return session;
  if (sameNick(session.activity.host, clean)) return session;

  const participants = session.activity.participants.filter((p) => !sameNick(p, clean));
  const leavingPendingTarget = sameNick(session.activity.handoffTo, clean);
  return {
    ...session,
    activity: normalizeWatchTogetherActivity({
      ...session.activity,
      participants,
      state: leavingPendingTarget ? 'paused' : session.activity.state,
      handoffTo: leavingPendingTarget ? null : session.activity.handoffTo,
    }),
  };
}

/**
 * Host-only: offer the host role to `targetNick` (must be a participant other
 * than the host). Freezes playback and enters the `handoff` state until the
 * target accepts.
 */
export function handoff(
  session: WatchSession,
  targetNick: string,
  nowMs: number,
  selfNick: string,
): WatchSession {
  if (!isWatchHost(session, selfNick)) return session;
  const target = normalizeWatchNick(targetNick);
  if (!target || sameNick(target, session.activity.host)) return session;
  if (!hasParticipant(session.activity.participants, target)) return session;

  const frozen = tick(session, nowMs);
  const activity = normalizeWatchTogetherActivity({
    ...frozen.activity,
    state: 'handoff',
    handoffTo: target,
  });
  return {
    activity,
    anchorMs: nowMs,
  };
}

/** Host-only: withdraw a pending handoff and remain paused at its frozen position. */
export function cancelHandoff(
  session: WatchSession,
  nowMs: number,
  selfNick: string,
): WatchSession {
  if (!isWatchHost(session, selfNick)) return session;
  if (session.activity.state !== 'handoff') return session;
  return {
    activity: normalizeWatchTogetherActivity({
      ...session.activity,
      state: 'paused',
      handoffTo: null,
    }),
    anchorMs: nowMs,
  };
}

/**
 * Target-only: accept a pending handoff, becoming the new host. Requires the
 * session to be in the `handoff` state with `handoffTo` matching `selfNick`.
 * Lands paused at the frozen position.
 */
export function acceptHandoff(session: WatchSession, nowMs: number, selfNick: string): WatchSession {
  const self = normalizeWatchNick(selfNick);
  if (!self) return session;
  if (session.activity.state !== 'handoff') return session;
  if (!sameNick(session.activity.handoffTo, self)) return session;

  const participants = hasParticipant(session.activity.participants, self)
    ? session.activity.participants
    : [...session.activity.participants, self];

  return {
    activity: normalizeWatchTogetherActivity({
      ...session.activity,
      host: self,
      handoffTo: null,
      state: 'paused',
      participants,
    }),
    anchorMs: nowMs,
  };
}

/** Convenience: parse a wire PROP value back into an activity (re-exported). */
export { parseWatchTogetherProp };
