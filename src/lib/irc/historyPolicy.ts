// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * historyPolicy.ts — IRCX `history-policy` channel prop helpers (Era 2 B4).
 *
 * Server values (onyx-server channelBuiltinSet / channelHistoryPolicy):
 *   public  — anyone who can open CHATHISTORY may read (default)
 *   members — only channel members
 *   opers   — channel ops / network opers only
 *
 * Fail closed: unknown/empty → `public` (matches server default when unset).
 */

export const HISTORY_POLICY_PROP = 'history-policy';

export type HistoryPolicy = 'public' | 'members' | 'opers';

const POLICY_VALUES: readonly HistoryPolicy[] = ['public', 'members', 'opers'];

export function parseHistoryPolicy(raw: string | null | undefined): HistoryPolicy {
  const clean = (raw ?? '').trim().toLowerCase();
  return POLICY_VALUES.includes(clean as HistoryPolicy) ? (clean as HistoryPolicy) : 'public';
}

export function isHistoryPolicy(value: string): value is HistoryPolicy {
  return POLICY_VALUES.includes(value as HistoryPolicy);
}
