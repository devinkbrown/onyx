// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  installConnectPageLifecycle,
  type ConnectLifecycleState,
} from './connectPageLifecycle';

function transitionEvent(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

function makeState(overrides: Partial<ConnectLifecycleState> = {}) {
  const accountSnapshot = { account: 'alice' };
  const state: ConnectLifecycleState & { server: typeof accountSnapshot } = {
    connectionStatus: 'connected',
    autoReconnect: true,
    client: { dropConnection: vi.fn() },
    setConnectionStatus: vi.fn((status) => {
      state.connectionStatus = status;
    }),
    reconnectNow: vi.fn(),
    server: accountSnapshot,
    ...overrides,
  };
  return { state, accountSnapshot };
}

function install(
  state: ConnectLifecycleState,
  options: { freezeResume?: boolean; online?: boolean } = {},
) {
  const pageTarget = new EventTarget();
  const lifecycleTarget = new EventTarget();
  const cleanup = installConnectPageLifecycle(() => state, {
    pageTarget,
    lifecycleTarget,
    supportsFreezeResume: options.freezeResume ?? false,
    isOnline: () => options.online ?? true,
  });
  return { pageTarget, lifecycleTarget, cleanup };
}

describe('Connect page lifecycle', () => {
  it('reconnects once after a persisted BFCache restore without clearing account identity', () => {
    const { state, accountSnapshot } = makeState();
    const { pageTarget } = install(state);

    pageTarget.dispatchEvent(transitionEvent('pagehide', true));
    pageTarget.dispatchEvent(transitionEvent('pageshow', true));

    expect(state.reconnectNow).toHaveBeenCalledTimes(1);
    expect(state.server).toBe(accountSnapshot);
    expect(state.server.account).toBe('alice');
    expect(state.setConnectionStatus).not.toHaveBeenCalled();
  });

  it('deduplicates resume and pageshow when both restore the same frozen page', () => {
    const { state } = makeState();
    const { pageTarget, lifecycleTarget } = install(state, { freezeResume: true });

    pageTarget.dispatchEvent(transitionEvent('pagehide', true));
    lifecycleTarget.dispatchEvent(new Event('freeze'));
    lifecycleTarget.dispatchEvent(new Event('resume'));
    pageTarget.dispatchEvent(transitionEvent('pageshow', true));

    expect(state.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('marks a restored connected socket reconnecting while offline', () => {
    const { state, accountSnapshot } = makeState();
    const { pageTarget } = install(state, { online: false });

    pageTarget.dispatchEvent(transitionEvent('pagehide', true));
    pageTarget.dispatchEvent(transitionEvent('pageshow', true));

    expect(state.setConnectionStatus).toHaveBeenCalledWith('reconnecting');
    expect(state.client?.dropConnection).toHaveBeenCalledWith('page restored while offline');
    expect(state.reconnectNow).not.toHaveBeenCalled();
    expect(state.server).toBe(accountSnapshot);
  });

  it('ignores ordinary navigation, visibility events, and unsupported freeze events', () => {
    const { state } = makeState();
    const { pageTarget, lifecycleTarget } = install(state);

    pageTarget.dispatchEvent(transitionEvent('pagehide', false));
    lifecycleTarget.dispatchEvent(new Event('visibilitychange'));
    lifecycleTarget.dispatchEvent(new Event('freeze'));
    lifecycleTarget.dispatchEvent(new Event('resume'));
    pageTarget.dispatchEvent(transitionEvent('pageshow', false));

    expect(state.reconnectNow).not.toHaveBeenCalled();
    expect(state.setConnectionStatus).not.toHaveBeenCalled();
    expect(state.client?.dropConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['an explicitly disconnected session', { autoReconnect: false }],
    ['an in-flight connection', { connectionStatus: 'connecting' as const }],
  ])('does not replace %s', (_label, overrides) => {
    const { state } = makeState(overrides);
    const { pageTarget } = install(state);

    pageTarget.dispatchEvent(transitionEvent('pagehide', true));
    pageTarget.dispatchEvent(transitionEvent('pageshow', true));

    expect(state.reconnectNow).not.toHaveBeenCalled();
    expect(state.setConnectionStatus).not.toHaveBeenCalled();
  });

  it('removes every installed listener during cleanup', () => {
    const { state } = makeState();
    const { pageTarget, lifecycleTarget, cleanup } = install(state, { freezeResume: true });

    cleanup();
    pageTarget.dispatchEvent(transitionEvent('pagehide', true));
    lifecycleTarget.dispatchEvent(new Event('freeze'));
    lifecycleTarget.dispatchEvent(new Event('resume'));
    pageTarget.dispatchEvent(transitionEvent('pageshow', true));

    expect(state.reconnectNow).not.toHaveBeenCalled();
  });
});
