// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { DesktopNotificationPermission } from './decision';
import { monitorDesktopNotificationPermission } from './permissionMonitor';

class FakePermissionStatus {
  readonly addEventListener = vi.fn((type: 'change', listener: () => void) => {
    if (type === 'change') this.listener = listener;
  });
  readonly removeEventListener = vi.fn((type: 'change', listener: () => void) => {
    if (type === 'change' && this.listener === listener) this.listener = null;
  });
  private listener: (() => void) | null = null;

  change(): void {
    this.listener?.();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

describe('monitorDesktopNotificationPermission', () => {
  it.each<DesktopNotificationPermission>(['granted', 'default', 'denied'])(
    'publishes the initial %s Notification.permission without requesting permission',
    (initial) => {
      const onPermission = vi.fn();
      const query = vi.fn(() => new Promise<FakePermissionStatus>(() => {}));

      monitorDesktopNotificationPermission(onPermission, {
        readPermission: () => initial,
        permissions: { query },
      });

      expect(onPermission).toHaveBeenCalledWith(initial);
      expect(query).toHaveBeenCalledWith({ name: 'notifications' });
    },
  );

  it('rereads actual Notification.permission on a live permission change', async () => {
    let actual: DesktopNotificationPermission = 'default';
    const status = new FakePermissionStatus();
    const onPermission = vi.fn();
    monitorDesktopNotificationPermission(onPermission, {
      readPermission: () => actual,
      permissions: { query: vi.fn(async () => status) },
    });
    await vi.waitFor(() => expect(status.addEventListener).toHaveBeenCalledOnce());

    actual = 'granted';
    status.change();
    actual = 'denied';
    status.change();

    expect(onPermission.mock.calls.map(([permission]) => permission)).toEqual([
      'default',
      'default',
      'granted',
      'denied',
    ]);
  });

  it('preserves the initial fallback when Permissions API is unsupported or rejects', async () => {
    const unsupportedPermission = vi.fn();
    monitorDesktopNotificationPermission(unsupportedPermission, {
      readPermission: () => 'default',
      permissions: null,
    });
    expect(unsupportedPermission).toHaveBeenCalledOnce();

    const rejectedPermission = vi.fn();
    const query = vi.fn(() => Promise.reject(new DOMException('Unsupported', 'NotSupportedError')));
    monitorDesktopNotificationPermission(rejectedPermission, {
      readPermission: () => 'denied',
      permissions: { query },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(rejectedPermission).toHaveBeenCalledOnce();
    expect(rejectedPermission).toHaveBeenCalledWith('denied');
  });

  it('fences a query that resolves after unmount', async () => {
    const pending = deferred<FakePermissionStatus>();
    const status = new FakePermissionStatus();
    const onPermission = vi.fn();
    const dispose = monitorDesktopNotificationPermission(onPermission, {
      readPermission: () => 'default',
      permissions: { query: vi.fn(() => pending.promise) },
    });

    dispose();
    pending.resolve(status);
    await pending.promise;
    await Promise.resolve();

    expect(onPermission).toHaveBeenCalledOnce();
    expect(status.addEventListener).not.toHaveBeenCalled();
  });

  it('removes the exact change listener during cleanup and ignores later signals', async () => {
    let actual: DesktopNotificationPermission = 'default';
    const status = new FakePermissionStatus();
    const onPermission = vi.fn();
    const dispose = monitorDesktopNotificationPermission(onPermission, {
      readPermission: () => actual,
      permissions: { query: vi.fn(async () => status) },
    });
    await vi.waitFor(() => expect(status.addEventListener).toHaveBeenCalledOnce());
    const listener = status.addEventListener.mock.calls[0]?.[1];

    dispose();
    actual = 'granted';
    status.change();

    expect(status.removeEventListener).toHaveBeenCalledWith('change', listener);
    expect(onPermission.mock.calls.at(-1)?.[0]).toBe('default');
  });
});
