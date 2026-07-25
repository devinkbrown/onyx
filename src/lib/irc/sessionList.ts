// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sessionList.ts — pure parse helpers for Onyx Server SESSION LIST / DROP notices.
 *
 * Wire (server NOTICE, no nick prefix):
 *   SESSION LIST * #1 signon=1710000000 attached
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
};

const LIST_RE =
  /^SESSION LIST\s+([*-])\s+#(\d+)\s+signon=(\d+)\s+(attached|detached)\s*$/i;
const END_RE = /^SESSION:\s*end of session list\s*$/i;
const DROP_OK_RE = /^SESSION DROP\s+#(\d+)\s+ok\s*$/i;

export function parseSessionListLine(text: string): AccountSessionRow | null {
  const match = LIST_RE.exec(text.trim());
  if (!match) return null;
  const index = Number.parseInt(match[2]!, 10);
  const signonMs = Number.parseInt(match[3]!, 10);
  if (!Number.isFinite(index) || index <= 0 || !Number.isFinite(signonMs)) return null;
  return {
    index,
    current: match[1] === '*',
    signonMs,
    state: match[4]!.toLowerCase() === 'attached' ? 'attached' : 'detached',
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

export function sessionRowLabel(row: AccountSessionRow): string {
  if (row.current) return 'This connection';
  return row.state === 'attached' ? `Session #${row.index}` : `Detached session #${row.index}`;
}
