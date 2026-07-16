// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';

const initialState = store.getInitialState();

function pageHide(persisted: boolean): PageTransitionEvent {
  const event = new Event('pagehide') as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

afterEach(() => {
  store.setState(initialState, true);
});

describe('store page lifecycle', () => {
  it('does not send QUIT when the browser preserves the page in BFCache', () => {
    const quit = vi.fn();
    store.setState({ connectionStatus: 'connected', client: { quit } as never });

    window.dispatchEvent(pageHide(true));

    expect(quit).not.toHaveBeenCalled();
    expect(store.getState().connectionStatus).toBe('connected');
  });

  it('still sends a best-effort QUIT for a real page close or refresh', () => {
    const quit = vi.fn();
    store.setState({ connectionStatus: 'connected', client: { quit } as never });

    window.dispatchEvent(pageHide(false));

    expect(quit).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledWith('client closed');
  });
});

