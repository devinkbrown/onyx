import { cleanup, renderHook } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from './store';
import { useStore } from './useStore';

const initialState = store.getInitialState();

describe('useStore', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns a Solid accessor seeded from the selected store state', () => {
    const { result } = renderHook(() => useStore((state) => state.connectionStatus));

    expect(result()).toBe('disconnected');
  });

  it('updates the accessor reactively when the selected store state changes', () => {
    const { result } = renderHook(() => useStore((state) => state.reconnectIn));

    expect(result()).toBe(0);

    store.getState().setReconnectIn(30);

    expect(result()).toBe(30);
  });

  it('honors the optional equality function for selected values', () => {
    const { result } = renderHook(() =>
      useStore(
        (state) => ({
          status: state.connectionStatus,
          reconnectIn: state.reconnectIn,
        }),
        (a, b) => a.status === b.status,
      ),
    );

    expect(result()).toEqual({ status: 'disconnected', reconnectIn: 0 });

    store.getState().setReconnectIn(45);

    expect(result()).toEqual({ status: 'disconnected', reconnectIn: 0 });

    store.getState().setConnectionStatus('connecting');

    expect(result()).toEqual({ status: 'connecting', reconnectIn: 45 });
  });
});
