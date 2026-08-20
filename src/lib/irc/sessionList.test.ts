// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  formatSessionAge,
  isSessionListEnd,
  isSessionDropSuccess,
  otherAttachedSessions,
  parseSessionDropOk,
  parseSessionListLine,
  sessionRowLabel,
} from './sessionList';

describe('sessionList parse helpers', () => {
  it('parses attached current and detached sibling rows', () => {
    expect(parseSessionListLine('SESSION LIST * #1 signon=1710000000 attached')).toEqual({
      index: 1,
      current: true,
      signonMs: 1710000000,
      state: 'attached',
    });
    expect(parseSessionListLine('SESSION LIST - #2 signon=1710000100 detached')).toEqual({
      index: 2,
      current: false,
      signonMs: 1710000100,
      state: 'detached',
    });
  });

  it('accepts a validated current-server physical SID without weakening legacy rows', () => {
    expect(parseSessionListLine('SESSION LIST - #2 signon=1710000100 attached sid=0123456789ABCDEFfedcba9876543210'))
      .toMatchObject({ index: 2, sid: '0123456789abcdeffedcba9876543210' });
    expect(parseSessionListLine('SESSION LIST - #2 signon=1 attached sid=bad')).toBeNull();
  });

  it('rejects hostile or malformed list lines', () => {
    expect(parseSessionListLine('SESSION LIST * #0 signon=1 attached')).toBeNull();
    expect(parseSessionListLine('SESSION LIST * #1 signon=x attached')).toBeNull();
    expect(parseSessionListLine('SESSION LIST * #1 signon=1 evil')).toBeNull();
    expect(parseSessionListLine('hi SESSION LIST * #1 signon=1 attached')).toBeNull();
  });

  it('detects list end and DROP ok', () => {
    expect(isSessionListEnd('SESSION: end of session list')).toBe(true);
    expect(isSessionListEnd('SESSION: end of session list ')).toBe(true);
    expect(isSessionListEnd('SESSION LIST * #1 signon=1 attached')).toBe(false);
    expect(parseSessionDropOk('SESSION DROP #3 ok')).toBe(3);
    expect(parseSessionDropOk('SESSION DROP ok')).toBeNull();
    expect(isSessionDropSuccess('SESSION DROP sid=0123456789abcdefFEDCBA9876543210 ok')).toBe(true);
    expect(isSessionDropSuccess('SESSION DROP sid=bad ok')).toBe(false);
    expect(isSessionDropSuccess('SESSION DROP ok client=42 signon=100')).toBe(true);
    expect(isSessionDropSuccess('SESSION DROP ok')).toBe(false);
  });

  it('formats session age and lists other attached devices', () => {
    const now = 1_700_000_000_000;
    expect(formatSessionAge(now - 30_000, now)).toBe('just now');
    expect(formatSessionAge(now - 10 * 60_000, now)).toBe('10m active');
    expect(formatSessionAge(now - 5 * 3_600_000, now)).toBe('5h active');
    const rows = [
      { index: 1, current: true, signonMs: now, state: 'attached' as const },
      { index: 2, current: false, signonMs: now, state: 'attached' as const },
      { index: 3, current: false, signonMs: now, state: 'detached' as const },
    ];
    expect(otherAttachedSessions(rows).map((r) => r.index)).toEqual([2]);
    expect(sessionRowLabel(rows[0]!)).toBe('This connection');
  });

  it('labels rows for UI without inventing device names', () => {
    expect(sessionRowLabel({
      index: 1, current: true, signonMs: 1, state: 'attached',
    })).toBe('This connection');
    expect(sessionRowLabel({
      index: 2, current: false, signonMs: 1, state: 'detached',
    })).toBe('Detached session #2');
  });
});
