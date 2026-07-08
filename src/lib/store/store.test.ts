import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';

const initialState = store.getInitialState();

describe('vanilla store', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('exposes the expected initial state', () => {
    const state = store.getState();

    expect(state.status).toBe('disconnected');
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.channels).toBeInstanceOf(Map);
    expect(state.channels.size).toBe(0);
    expect(state.dms).toBeInstanceOf(Map);
    expect(state.dms.size).toBe(0);
    expect(state.activeView).toEqual({ kind: 'home' });
    expect(state.showMemberList).toBe(true);
    expect(state.toasts).toEqual([]);
  });

  it('runs representative mutating actions', () => {
    store.getState().setConnectionStatus('connecting');
    store.getState().setReconnectIn(12);
    store.getState().toggleMemberList();
    store.getState().openSettings('notifications');
    store.getState().addToast({
      variant: 'success',
      title: 'Connected',
      description: 'IRC session established',
    });

    const afterMutations = store.getState();
    expect(afterMutations.connectionStatus).toBe('connecting');
    expect(afterMutations.reconnectIn).toBe(12);
    expect(afterMutations.showMemberList).toBe(false);
    expect(afterMutations.showSettings).toBe(true);
    expect(afterMutations.settingsTab).toBe('notifications');
    expect(afterMutations.toasts).toHaveLength(1);
    expect(afterMutations.toasts[0]).toMatchObject({
      variant: 'success',
      title: 'Connected',
      description: 'IRC session established',
    });
    expect(afterMutations.toasts[0]?.id).toMatch(/^onyx-/);

    const toastId = afterMutations.toasts[0]?.id;
    expect(toastId).toBeDefined();
    store.getState().dismissToast(toastId!);
    store.getState().closeSettings();

    const finalState = store.getState();
    expect(finalState.toasts).toEqual([]);
    expect(finalState.showSettings).toBe(false);
  });

  it('persists theme changes through the current ThemeProvider storage key', () => {
    store.getState().setTheme('sumi');

    expect(store.getState().activeTheme).toBe('sumi');
    expect(store.getState().theme).toBe('sumi');
    expect(localStorage.getItem('onyx:theme')).toBe('sumi');
    expect(localStorage.getItem('onyx:active-theme')).toBeNull();

    store.getState().setDisplayTheme('pearl');

    expect(store.getState().activeTheme).toBe('pearl');
    expect(store.getState().theme).toBe('pearl');
    expect(localStorage.getItem('onyx:theme')).toBe('pearl');
    expect(localStorage.getItem('onyx:display-theme')).toBeNull();
  });

  it('notifies selector subscribers when selected state changes', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(
      (state) => state.connectionStatus,
      (next, previous) => {
        listener(next, previous);
      },
    );

    store.getState().setConnectionStatus('connecting');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('connecting', 'disconnected');

    unsubscribe();
    store.getState().setConnectionStatus('connected');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
