// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  HISTORY_POLICY_PROP,
  isHistoryPolicy,
  parseHistoryPolicy,
} from './historyPolicy';

describe('historyPolicy', () => {
  it('parses server values case-insensitively', () => {
    expect(parseHistoryPolicy('public')).toBe('public');
    expect(parseHistoryPolicy(' MEMBERS ')).toBe('members');
    expect(parseHistoryPolicy('Opers')).toBe('opers');
  });

  it('fails closed to public on unknown or empty', () => {
    expect(parseHistoryPolicy('')).toBe('public');
    expect(parseHistoryPolicy(null)).toBe('public');
    expect(parseHistoryPolicy('friends')).toBe('public');
    expect(parseHistoryPolicy('owner')).toBe('public');
  });

  it('exposes the wire prop key and type guard', () => {
    expect(HISTORY_POLICY_PROP).toBe('history-policy');
    expect(isHistoryPolicy('members')).toBe(true);
    expect(isHistoryPolicy('friends')).toBe(false);
  });
});
