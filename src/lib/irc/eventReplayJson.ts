// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * eventReplayJson.ts — pure parse helpers for Onyx Server EVENT REPLAY JSON.
 *
 * Wire (server NOTICE, no nick prefix) — oper-only:
 *   {"type":"event-replay","count":N,"severity_floor":"debug"}
 *   {"type":"event","ts":…,"category":"kill","category_code":"KILL",
 *    "severity":"warn","origin":"node","message":"…"}
 *   {"type":"event-replay-end","count":N}
 *
 * Fail closed: malformed JSON, unknown types, oversize strings, and non-finite
 * timestamps are rejected so hostile server notices never become structured rows.
 */

/** Bounded NOTICE body: history message ≤400 + JSON envelope + origin ≤64. */
const MAX_NOTICE = 1024;
const MAX_TOKEN = 64;
const MAX_MESSAGE = 400;
const MAX_EVENTS = 200;
const CONTROL = /[\u0000-\u001f\u007f]/gu;

export type EventReplayEvent = {
  ts: number;
  category: string;
  categoryCode: string;
  severity: string;
  origin: string;
  message: string;
};

export type EventReplayNotice =
  | { kind: 'start'; count: number; severityFloor: string }
  | { kind: 'event'; event: EventReplayEvent }
  | { kind: 'end'; count: number };

export type EventReplayFeed = {
  pending: boolean;
  severityFloor: string | null;
  expectedCount: number | null;
  events: EventReplayEvent[];
  complete: boolean;
  receivedAt: number | null;
};

export function emptyEventReplayFeed(): EventReplayFeed {
  return {
    pending: false,
    severityFloor: null,
    expectedCount: null,
    events: [],
    complete: false,
    receivedAt: null,
  };
}

function cleanToken(raw: unknown, max = MAX_TOKEN): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL, '').trim().slice(0, max);
  if (!cleaned) return null;
  return cleaned;
}

function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
  // Empty message is allowed only as a bounded blank (server may emit short bodies).
  if (cleaned.length === 0 && raw.length > 0) return null;
  return cleaned;
}

function finiteCount(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  if (n < 0 || n > MAX_EVENTS) return null;
  return n;
}

function finiteTs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  // Reject nonsense epochs (pre-2000 or > ~year 10000 in ms).
  if (n < 946_684_800_000 || n > 253_402_300_799_000) return null;
  return n;
}

/**
 * Parse one server NOTICE trailing parameter as an EVENT REPLAY JSON object.
 * Returns null when the body is not a structured replay payload (fail closed).
 */
export function parseEventReplayNotice(text: string): EventReplayNotice | null {
  const raw = text.trim();
  if (!raw.startsWith('{') || raw.length > MAX_NOTICE) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string') return null;

  if (type === 'event-replay') {
    const count = finiteCount(obj.count);
    const severityFloor = cleanToken(obj.severity_floor, 24);
    if (count === null || !severityFloor) return null;
    return { kind: 'start', count, severityFloor };
  }

  if (type === 'event-replay-end') {
    const count = finiteCount(obj.count);
    if (count === null) return null;
    return { kind: 'end', count };
  }

  if (type === 'event') {
    const ts = finiteTs(obj.ts);
    const category = cleanToken(obj.category, 32);
    const categoryCode = cleanToken(obj.category_code, 32) ?? (category ? category.toUpperCase() : null);
    const severity = cleanToken(obj.severity, 24);
    const origin = cleanToken(obj.origin, MAX_TOKEN);
    const message = cleanMessage(obj.message);
    if (
      ts === null
      || !category
      || !categoryCode
      || !severity
      || !origin
      || message === null
    ) {
      return null;
    }
    return {
      kind: 'event',
      event: { ts, category, categoryCode, severity, origin, message },
    };
  }

  return null;
}

/**
 * Apply a parsed notice to an immutable feed. Unrelated notices return the
 * same reference so callers can detect no-op with `===`.
 */
export function applyEventReplayNotice(
  feed: EventReplayFeed,
  text: string,
  nowMs = Date.now(),
): EventReplayFeed {
  const notice = parseEventReplayNotice(text);
  if (!notice) return feed;

  if (notice.kind === 'start') {
    return {
      pending: true,
      severityFloor: notice.severityFloor,
      expectedCount: notice.count,
      events: [],
      complete: false,
      receivedAt: nowMs,
    };
  }

  if (notice.kind === 'event') {
    // Only accept event rows while a stream is open. A completed feed stays
    // sealed until the next `event-replay` header (or a fresh UI request).
    if (!feed.pending) {
      if (feed.complete) return feed;
      // Orphan event before any header — open a soft stream for resilience.
      return {
        pending: true,
        severityFloor: feed.severityFloor,
        expectedCount: feed.expectedCount,
        events: [notice.event],
        complete: false,
        receivedAt: feed.receivedAt ?? nowMs,
      };
    }
    if (feed.events.length >= MAX_EVENTS) return feed;
    return {
      ...feed,
      events: [...feed.events, notice.event],
    };
  }

  // end
  return {
    ...feed,
    pending: false,
    complete: true,
    expectedCount: notice.count,
    receivedAt: feed.receivedAt ?? nowMs,
  };
}

/** Params after `EVENT` for a bounded JSON replay (ALL categories). */
export function eventReplayJsonParams(limit: number): readonly string[] {
  const n = Number.isFinite(limit) ? Math.trunc(limit) : 30;
  const clamped = Math.min(200, Math.max(1, n));
  return ['REPLAY', 'JSON', 'ALL', String(clamped)] as const;
}

/** Compact one-line label for a structured event row. */
export function formatEventReplayEvent(ev: EventReplayEvent, nowMs = Date.now()): string {
  const age = relativeAgeLabel(ev.ts, nowMs);
  const msg = ev.message || '(empty)';
  return `[${age}] ${ev.categoryCode}/${ev.severity} <${ev.origin}> ${msg}`;
}

function relativeAgeLabel(ts: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - ts);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
