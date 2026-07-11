// SPDX-License-Identifier: AGPL-3.0-or-later
// Watch-together host-side state machine (roadmap v2.3 Kagura).
//
// This module is PURE and DOM-free: every transition is a total function that
// returns a new immutable session and never mutates its input. The heavy logic
// lives here (coverage-counting) so the SolidJS surface can stay thin.
//
// The wire representation is the SAME `ocean.watch` channel PROP that
// `parseWatchTogetherProp` reads — `serializeWatchTogetherProp` is its exact
// inverse, so `parseWatchTogetherProp(serializeWatchTogetherProp(x))` deep-equals
// any valid `WatchTogetherActivity`. `tick()` advances `positionSeconds` locally
// between PROP pushes so playback stays smooth without wire chatter.

import { parseWatchTogetherProp, type WatchTogetherActivity } from './watchTogether';

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
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function clampPosition(seconds: number, durationSeconds: number | null): number {
  const floored = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const atLeastZero = floored < 0 ? 0 : floored;
  if (durationSeconds !== null && atLeastZero > durationSeconds) return durationSeconds;
  return atLeastZero;
}

/** True when `selfNick` is the current host and therefore holds the controls. */
export function isWatchHost(session: WatchSession, selfNick: string | null | undefined): boolean {
  return sameNick(session.activity.host, selfNick);
}

function hasParticipant(participants: readonly string[], nick: string): boolean {
  return participants.some((p) => sameNick(p, nick));
}

/**
 * Serialize an activity into the `ocean.watch` PROP value. Exact inverse of
 * `parseWatchTogetherProp`. Uses `URLSearchParams` so values are form-encoded
 * (the parser normalizes `;`→`&` before decoding, so `&` separators are safe).
 */
export function serializeWatchTogetherProp(activity: WatchTogetherActivity): string {
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

/**
 * Wrap a parsed (possibly remote) activity into a tickable session, anchoring
 * playback at `nowMs`. Used by the UI to advance a peer's PROP locally between
 * pushes.
 */
export function sessionFromActivity(activity: WatchTogetherActivity, nowMs: number): WatchSession {
  return { activity, anchorMs: nowMs };
}

/** Start a fresh session as host, paused at 0, with the host as sole participant. */
export function createWatchSession(opts: CreateWatchSessionOptions): WatchSession {
  const host = opts.host.trim();
  const title = opts.title.trim() || DEFAULT_TITLE;
  const url = opts.url?.trim() || null;
  const activity: WatchTogetherActivity = {
    title,
    url,
    host: host || null,
    state: 'paused',
    positionSeconds: 0,
    durationSeconds: normalizeDuration(opts.durationSeconds),
    participants: host ? [host] : [],
    handoffTo: null,
  };
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
  const clean = nick.trim();
  if (!clean) return session;
  if (hasParticipant(session.activity.participants, clean)) return session;
  return {
    ...session,
    activity: {
      ...session.activity,
      participants: [...session.activity.participants, clean],
    },
  };
}

/**
 * Anyone: remove `nick` from the roster. When the host leaves, playback freezes
 * at the ticked position and the host slot is vacated (controls disabled until a
 * handoff is accepted).
 */
export function leave(session: WatchSession, nick: string, nowMs: number): WatchSession {
  const clean = nick.trim();
  if (!clean) return session;
  if (!hasParticipant(session.activity.participants, clean)) return session;

  const participants = session.activity.participants.filter((p) => !sameNick(p, clean));

  if (sameNick(session.activity.host, clean)) {
    const frozen = tick(session, nowMs);
    return {
      activity: {
        ...frozen.activity,
        participants,
        host: null,
        state: 'paused',
        handoffTo: null,
      },
      anchorMs: nowMs,
    };
  }

  const handoffTo = sameNick(session.activity.handoffTo, clean) ? null : session.activity.handoffTo;
  return {
    ...session,
    activity: { ...session.activity, participants, handoffTo },
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
  const target = targetNick.trim();
  if (!target || sameNick(target, session.activity.host)) return session;
  if (!hasParticipant(session.activity.participants, target)) return session;

  const frozen = tick(session, nowMs);
  return {
    activity: {
      ...frozen.activity,
      state: 'handoff',
      handoffTo: target,
    },
    anchorMs: nowMs,
  };
}

/**
 * Target-only: accept a pending handoff, becoming the new host. Requires the
 * session to be in the `handoff` state with `handoffTo` matching `selfNick`.
 * Lands paused at the frozen position.
 */
export function acceptHandoff(session: WatchSession, nowMs: number, selfNick: string): WatchSession {
  const self = selfNick.trim();
  if (session.activity.state !== 'handoff') return session;
  if (!sameNick(session.activity.handoffTo, self)) return session;

  const participants = hasParticipant(session.activity.participants, self)
    ? session.activity.participants
    : [...session.activity.participants, self];

  return {
    activity: {
      ...session.activity,
      host: self,
      handoffTo: null,
      state: 'paused',
      participants,
    },
    anchorMs: nowMs,
  };
}

/** Convenience: parse a wire PROP value back into an activity (re-exported). */
export { parseWatchTogetherProp };
