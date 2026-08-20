// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sessionList.ts — pure parse helpers for Onyx Server SESSION LIST / DROP notices.
 *
 * Wire (server NOTICE, no nick prefix):
 *   SESSION LIST * #1 signon=1710000000 attached sid=0123...cdef
 *   SESSION LIST - #2 signon=1710000100 detached
 *   SESSION: end of session list
 *   SESSION DROP #2 ok
 */

export type AccountSessionRow = {
  /** 1-based index matching SESSION LIST / SESSION DROP. */
  index: number;
  /** True when this row is the connection that asked for the list. */
  current: boolean;
  /** Sign-on wall time in milliseconds (server epoch). */
  signonMs: number;
  state: 'attached' | 'detached';
  /** Exact physical-row selector offered by current servers; absent on legacy rows. */
  sid?: string;
};

const LIST_RE =
  /^SESSION LIST\s+([*-])\s+#(\d+)\s+signon=(\d+)\s+(attached|detached)(?:\s+sid=([0-9a-f]{32}))?\s*$/i;
const END_RE = /^SESSION:\s*end of session list\s*$/i;
const DROP_OK_RE = /^SESSION DROP\s+#(\d+)\s+ok\s*$/i;

export function parseSessionListLine(text: string): AccountSessionRow | null {
  const match = LIST_RE.exec(text.trim());
  if (!match) return null;
  const index = Number.parseInt(match[2]!, 10);
  const signonMs = Number.parseInt(match[3]!, 10);
  if (!Number.isFinite(index) || index <= 0 || !Number.isFinite(signonMs)) return null;
  const sid = match[5]?.toLowerCase();
  return {
    index,
    current: match[1] === '*',
    signonMs,
    state: match[4]!.toLowerCase() === 'attached' ? 'attached' : 'detached',
    ...(sid ? { sid } : {}),
  };
}

export function isSessionListEnd(text: string): boolean {
  return END_RE.test(text.trim());
}

export function parseSessionDropOk(text: string): number | null {
  const match = DROP_OK_RE.exec(text.trim());
  if (!match) return null;
  const index = Number.parseInt(match[1]!, 10);
  return Number.isFinite(index) && index > 0 ? index : null;
}

/** SID and owner-reactor replies have no ordinal; both confirm a completed DROP. */
export function isSessionDropSuccess(text: string): boolean {
  return /^(?:SESSION DROP\s+sid=[0-9a-f]{32}\s+ok|SESSION DROP\s+ok\s+client=\d+\s+signon=-?\d+)\s*$/i.test(text.trim());
}

export function formatSessionSignon(signonMs: number, _nowMs = Date.now()): string {
  if (!Number.isFinite(signonMs) || signonMs <= 0) return 'unknown start';
  const date = new Date(signonMs);
  if (Number.isNaN(date.getTime())) return 'unknown start';
  try {
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return date.toISOString();
  }
}

/** Relative age for multi-device session lists (B1 polish). */
export function formatSessionAge(signonMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(signonMs) || signonMs <= 0) return 'unknown age';
  const delta = Math.max(0, nowMs - signonMs);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m active`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h active`;
  const days = Math.floor(hours / 24);
  return `${days}d active`;
}

export function sessionRowLabel(row: AccountSessionRow): string {
  if (row.current) return 'This connection';
  return row.state === 'attached' ? `Session #${row.index}` : `Detached session #${row.index}`;
}

/** Non-current attached sessions — bulk revoke targets (B1 multi-device). */
export function otherAttachedSessions(rows: readonly AccountSessionRow[]): AccountSessionRow[] {
  return rows.filter((row) => !row.current && row.state === 'attached');
}
