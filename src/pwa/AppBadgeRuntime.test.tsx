// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { AppBadgeRuntime } from './AppBadgeRuntime';

const initialState = store.getInitialState();

function installBadgeApi(setAppBadge: ReturnType<typeof vi.fn>, clearAppBadge: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true });
  Object.defineProperty(navigator, 'clearAppBadge', { value: clearAppBadge, configurable: true });
}

describe('AppBadgeRuntime', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'setAppBadge');
    Reflect.deleteProperty(navigator, 'clearAppBadge');
    vi.restoreAllMocks();
  });

  it('sets and clears the installed-app badge from direct attention', async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    installBadgeApi(setAppBadge, clearAppBadge);
    store.setState({ totalUnreadMentions: 3 });

    render(() => <AppBadgeRuntime />);
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(3));

    store.setState({ totalUnreadMentions: 0 });
    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
  });

  it('coalesces changes behind a slow platform call so the newest count wins', async () => {
    let releaseFirst: (() => void) | undefined;
    const setAppBadge = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    installBadgeApi(setAppBadge, clearAppBadge);
    store.setState({ totalUnreadMentions: 1 });
    render(() => <AppBadgeRuntime />);

    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(1));
    store.setState({ totalUnreadMentions: 2 });
    store.setState({ totalUnreadMentions: 7 });
    expect(setAppBadge).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await waitFor(() => expect(setAppBadge).toHaveBeenLastCalledWith(7));
    expect(setAppBadge).toHaveBeenCalledTimes(2);
  });

  it('falls back to setAppBadge(0), ignores failures, and no-ops when unsupported', async () => {
    const setAppBadge = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true });
    render(() => <AppBadgeRuntime />);
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(0));
    cleanup();

    Reflect.deleteProperty(navigator, 'setAppBadge');
    expect(() => render(() => <AppBadgeRuntime />)).not.toThrow();
  });
});

