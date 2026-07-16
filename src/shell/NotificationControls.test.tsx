// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCalmPreset } from '@/lib/notifications/calmMode';
import type { DesktopNotificationPermission } from '@/lib/notifications/decision';
import type { WebPushResult } from '@/lib/notifications/webPush';
import { store, type Server } from '@/lib/store/store';
import { NotificationControls } from './NotificationControls';

const browserMocks = vi.hoisted(() => ({
  getPermission: vi.fn<() => DesktopNotificationPermission>(() => 'unsupported'),
  requestPermission: vi.fn<() => Promise<DesktopNotificationPermission>>(async () => 'unsupported'),
}));

const webPushMocks = vi.hoisted(() => ({
  active: vi.fn(async () => false),
  disable: vi.fn<() => Promise<WebPushResult>>(async () => ({ ok: true })),
  enable: vi.fn<() => Promise<WebPushResult>>(async () => ({ ok: true })),
  supported: vi.fn(() => false),
}));

vi.mock('@/lib/notifications', () => ({
  getDesktopNotificationPermission: browserMocks.getPermission,
  requestDesktopNotificationPermission: browserMocks.requestPermission,
}));

vi.mock('@/lib/notifications/webPush', () => ({
  disableWebPush: webPushMocks.disable,
  enableWebPush: webPushMocks.enable,
  webPushActive: webPushMocks.active,
  webPushSupported: webPushMocks.supported,
}));

const initialState = store.getInitialState();
const permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'permissions');

function restorePermissions(): void {
  if (permissionsDescriptor) {
    Object.defineProperty(navigator, 'permissions', permissionsDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'permissions');
  }
}

function server(account: string): Server {
  return {
    id: 'local',
    name: 'Local',
    network: 'Orochi',
    url: 'wss://example.invalid',
    icon: '#000',
    nick: 'me',
    account,
    connected: true,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('NotificationControls accessibility', () => {
  beforeEach(() => {
    browserMocks.getPermission.mockReset().mockReturnValue('unsupported');
    browserMocks.requestPermission.mockReset().mockResolvedValue('unsupported');
    webPushMocks.active.mockReset().mockResolvedValue(false);
    webPushMocks.disable.mockReset().mockResolvedValue({ ok: true });
    webPushMocks.enable.mockReset().mockResolvedValue({ ok: true });
    webPushMocks.supported.mockReset().mockReturnValue(false);
    localStorage.clear();
    setCalmPreset('regular');
    store.setState({
      ...initialState,
      soundEnabled: true,
      dndEnabled: false,
      dndUntil: null,
      pushNotificationsEnabled: false,
    }, true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    restorePermissions();
    store.setState(initialState, true);
    setCalmPreset('regular');
    localStorage.clear();
  });

  it('exposes the compact controls as a labelled stateful group', () => {
    render(() => <NotificationControls />);

    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /Desktop notifications unsupported; notification mode Regular; notification sound on; do not disturb off/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desktop notifications are not supported/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Notification mode Regular/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Mute notification sound/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Turn on do not disturb/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tracks browser permission changes without prompting or automatically enabling notifications', async () => {
    let actual: DesktopNotificationPermission = 'default';
    let changeListener: (() => void) | undefined;
    const permissionStatus = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'change') changeListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const query = vi.fn(async () => permissionStatus);
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query },
    });
    browserMocks.getPermission.mockImplementation(() => actual);

    render(() => <NotificationControls />);
    await waitFor(() => expect(permissionStatus.addEventListener).toHaveBeenCalledOnce());
    expect(browserMocks.requestPermission).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enable desktop notifications' })).toHaveAttribute('aria-pressed', 'false');

    actual = 'granted';
    changeListener?.();
    expect(store.getState().pushNotificationsEnabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Enable desktop notifications' })).toHaveAttribute('aria-pressed', 'false');

    actual = 'denied';
    changeListener?.();
    expect(screen.getByRole('button', { name: 'Desktop notifications are blocked by the browser' })).toBeDisabled();

    cleanup();
    expect(permissionStatus.removeEventListener).toHaveBeenCalledWith('change', changeListener);
  });

  it('keeps calm, sound and do-not-disturb state reflected in accessible labels', () => {
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Regular/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mute notification sound/i }));
    fireEvent.click(screen.getByRole('button', { name: /Turn on do not disturb/i }));

    expect(screen.getByRole('button', { name: /Notification mode Power/i })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('onyx:calm')).toBe('power');
    expect(screen.getByRole('button', { name: /Enable notification sound/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Turn off do not disturb/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /notification mode Power; notification sound off; do not disturb on/i,
    })).toBeInTheDocument();
  });

  it('expires a timed do-not-disturb state in its accessible controls at the deadline', () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-16T08:00:00.000Z');
    vi.setSystemTime(now);
    store.setState({ dndEnabled: false, dndUntil: now.getTime() + 60_000 });

    render(() => <NotificationControls />);

    expect(screen.getByRole('button', { name: 'Turn off do not disturb' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /do not disturb on/i,
    })).toBeInTheDocument();

    vi.advanceTimersByTime(60_001);

    expect(screen.getByRole('button', { name: 'Turn on do not disturb' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /do not disturb off/i,
    })).toBeInTheDocument();
    expect(store.getState()).toMatchObject({ dndEnabled: false, dndUntil: null });
  });

  it('clears an expired timed override instead of enabling persistent DND on a raced click', () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-16T08:00:00.000Z');
    vi.setSystemTime(now);
    store.setState({ dndEnabled: false, dndUntil: now.getTime() + 60_000 });

    render(() => <NotificationControls />);

    const staleTurnOff = screen.getByRole('button', { name: 'Turn off do not disturb' });
    // Move wall time past the deadline without running the queued callback:
    // this is the click-vs-timeout race the handler must settle safely.
    vi.setSystemTime(now.getTime() + 60_001);
    fireEvent.click(staleTurnOff);

    expect(store.getState()).toMatchObject({ dndEnabled: false, dndUntil: null });
    expect(screen.getByRole('button', { name: 'Turn on do not disturb' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('replaces a changed DND deadline and cancels the remaining timer on unmount', () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-16T08:00:00.000Z');
    vi.setSystemTime(now);
    store.setState({ dndEnabled: false, dndUntil: now.getTime() + 60_000 });

    const view = render(() => <NotificationControls />);
    expect(vi.getTimerCount()).toBe(1);

    store.setState({ dndUntil: now.getTime() + 120_000 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_001);
    expect(screen.getByRole('button', { name: 'Turn off do not disturb' })).toHaveAttribute('aria-pressed', 'true');

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cycles compact calm presets through the same persisted mode as preferences', () => {
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Regular/i }));
    expect(screen.getByRole('button', { name: /Notification mode Power/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Power/i }));
    expect(screen.getByRole('button', { name: /Notification mode Calm/i })).toBeInTheDocument();
    expect(localStorage.getItem('onyx:calm')).toBe('calm');

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Calm/i }));
    expect(screen.getByRole('button', { name: /Notification mode Regular/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not let a stale initial push check overwrite a completed enable action', async () => {
    const readiness = deferred<boolean>();
    webPushMocks.supported.mockReturnValue(true);
    webPushMocks.active.mockReturnValue(readiness.promise);
    store.setState({ server: server('alice') });
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable web push' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable web push' })).toBeEnabled());

    readiness.resolve(false);
    await readiness.promise;
    await Promise.resolve();

    expect(screen.getByRole('button', { name: 'Disable web push' })).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().toasts.at(-1)).toMatchObject({ title: 'Push on', variant: 'success' });
  });

  it('keeps push on and reports a truthful failure when unsubscribe fails', async () => {
    webPushMocks.supported.mockReturnValue(true);
    webPushMocks.active.mockResolvedValue(true);
    webPushMocks.disable.mockResolvedValue({ ok: false, reason: 'The browser could not remove its push subscription.' });
    store.setState({ server: server('alice') });
    render(() => <NotificationControls />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable web push' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Disable web push' }));

    await waitFor(() => expect(store.getState().toasts.at(-1)).toMatchObject({
      title: 'Push unavailable',
      description: 'The browser could not remove its push subscription.',
    }));
    expect(screen.getByRole('button', { name: 'Disable web push' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets only the newest overlapping desktop permission request update state', async () => {
    const older = deferred<NotificationPermission>();
    const newer = deferred<NotificationPermission>();
    browserMocks.getPermission.mockReturnValue('default');
    browserMocks.requestPermission
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(() => <NotificationControls />);
    const desktop = screen.getByRole('button', { name: 'Enable desktop notifications' });

    fireEvent.click(desktop);
    fireEvent.click(desktop);
    expect(browserMocks.requestPermission).toHaveBeenCalledTimes(2);

    newer.resolve('granted');
    await waitFor(() => expect(store.getState().pushNotificationsEnabled).toBe(true));
    older.resolve('denied');
    await older.promise;
    await Promise.resolve();

    expect(store.getState().pushNotificationsEnabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Disable desktop notifications' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not apply a desktop permission completion after unmount', async () => {
    const pending = deferred<NotificationPermission>();
    browserMocks.getPermission.mockReturnValue('default');
    browserMocks.requestPermission.mockReturnValue(pending.promise);
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop notifications' }));
    cleanup();
    pending.resolve('granted');
    await pending.promise;
    await Promise.resolve();

    expect(store.getState().pushNotificationsEnabled).toBe(false);
  });

  it('does not claim push success after the signed-in account changes', async () => {
    const result = deferred<{ ok: true }>();
    webPushMocks.supported.mockReturnValue(true);
    webPushMocks.enable.mockReturnValue(result.promise);
    store.setState({ server: server('alice') });
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable web push' }));
    store.setState({ server: server('bob') });
    result.resolve({ ok: true });

    await waitFor(() => expect(store.getState().toasts.at(-1)).toMatchObject({
      title: 'Push setup changed',
      variant: 'warning',
    }));
    expect(screen.getByRole('button', { name: 'Enable web push' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not publish a push completion after unmount', async () => {
    const result = deferred<{ ok: true }>();
    webPushMocks.supported.mockReturnValue(true);
    webPushMocks.enable.mockReturnValue(result.promise);
    store.setState({ server: server('alice') });
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable web push' }));
    cleanup();
    result.resolve({ ok: true });
    await result.promise;
    await Promise.resolve();

    expect(store.getState().toasts).toEqual([]);
  });
});
