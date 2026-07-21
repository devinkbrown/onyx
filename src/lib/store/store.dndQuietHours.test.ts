// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';

const initialState = store.getInitialState();

describe('store quiet-hours DND schedule', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({
      ...initialState,
      dndEnabled: false,
      dndUntil: null,
      dndQuietStart: 22,
      dndQuietEnd: 8,
    }, true);
  });

  afterEach(() => {
    vi.useRealTimers();
    store.setState(initialState, true);
    localStorage.clear();
  });

  it('isDndActive is true inside the default overnight quiet window', () => {
    // Local wall clock 23:00 — inside 22:00→08:00.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 23, 0, 0));
    expect(store.getState().isDndActive()).toBe(true);
  });

  it('isDndActive is false outside the quiet window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0));
    expect(store.getState().isDndActive()).toBe(false);
  });

  it('isDndActive does not require dndEnabled (standing schedule)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 23, 30, 0));
    store.setState({ dndEnabled: false, dndUntil: null });
    expect(store.getState().isDndActive()).toBe(true);
  });

  it('equal start/end disables the quiet-hours schedule (empty window)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 23, 0, 0));
    store.getState().setDndQuietHours(22, 22);
    expect(store.getState()).toMatchObject({ dndQuietStart: 22, dndQuietEnd: 22 });
    expect(store.getState().isDndActive()).toBe(false);
  });

  it('setDndQuietHours persists valid hours and rejects out-of-range fields', () => {
    store.getState().setDndQuietHours(21, 7);
    expect(store.getState()).toMatchObject({ dndQuietStart: 21, dndQuietEnd: 7 });
    expect(localStorage.getItem('onyx:dnd-quiet-start')).toBe('21');
    expect(localStorage.getItem('onyx:dnd-quiet-end')).toBe('7');

    // Bad start keeps prior start; valid end still applies.
    store.getState().setDndQuietHours(99, 9);
    expect(store.getState()).toMatchObject({ dndQuietStart: 21, dndQuietEnd: 9 });

    // Non-integer end keeps prior end.
    store.getState().setDndQuietHours(20, 8.5);
    expect(store.getState()).toMatchObject({ dndQuietStart: 20, dndQuietEnd: 9 });
  });

  it('same-day quiet window is half-open on hour boundaries', () => {
    store.getState().setDndQuietHours(9, 17);
    vi.useFakeTimers();

    vi.setSystemTime(new Date(2026, 6, 8, 9, 0, 0));
    expect(store.getState().isDndActive()).toBe(true);

    vi.setSystemTime(new Date(2026, 6, 8, 16, 59, 0));
    expect(store.getState().isDndActive()).toBe(true);

    vi.setSystemTime(new Date(2026, 6, 8, 17, 0, 0));
    expect(store.getState().isDndActive()).toBe(false);
  });
});
