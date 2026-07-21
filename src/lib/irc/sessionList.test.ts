// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  isSessionListEnd,
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
