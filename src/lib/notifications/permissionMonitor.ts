// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getDesktopNotificationPermission,
} from './browser';
import type { DesktopNotificationPermission } from './decision';

interface NotificationPermissionStatus {
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

interface NotificationPermissions {
  query(descriptor: { name: 'notifications' }): Promise<NotificationPermissionStatus>;
}

interface NotificationPermissionMonitorOptions {
  permissions?: NotificationPermissions | null;
  readPermission?: () => DesktopNotificationPermission;
}

function browserPermissions(): NotificationPermissions | null {
  if (typeof navigator === 'undefined') return null;
  try {
    const candidate = navigator.permissions as Permissions & {
      query(descriptor: { name: 'notifications' }): Promise<PermissionStatus>;
    };
    if (!candidate || typeof candidate.query !== 'function') return null;
    return {
      query: (descriptor) => candidate.query(descriptor) as Promise<NotificationPermissionStatus>,
    };
  } catch {
    return null;
  }
}

/**
 * Keep a notification-permission view synchronized with browser site settings.
 *
 * PermissionStatus.state is intentionally never mapped into application state:
 * browser implementations differ, while Notification.permission is the
 * existing source of truth. The Permissions API is only an invalidation signal.
 * This function never calls Notification.requestPermission().
 */
export function monitorDesktopNotificationPermission(
  onPermission: (permission: DesktopNotificationPermission) => void,
  options: NotificationPermissionMonitorOptions = {},
): () => void {
  const readPermission = options.readPermission ?? getDesktopNotificationPermission;
  const permissions = options.permissions === undefined ? browserPermissions() : options.permissions;
  let disposed = false;
  let queryEpoch = 0;
  let status: NotificationPermissionStatus | null = null;

  const publishActualPermission = () => {
    if (disposed) return;
    onPermission(readPermission());
  };

  const initial = readPermission();
  onPermission(initial);
  if (initial === 'unsupported' || !permissions) {
    return () => {
      disposed = true;
      queryEpoch += 1;
    };
  }

  const handleChange = () => publishActualPermission();
  const epoch = ++queryEpoch;
  let queried: Promise<NotificationPermissionStatus>;
  try {
    queried = permissions.query({ name: 'notifications' });
  } catch {
    queried = Promise.reject(new Error('notification permission query failed'));
  }

  void Promise.resolve(queried).then((nextStatus) => {
    if (disposed || epoch !== queryEpoch) return;
    status = nextStatus;
    try {
      status.addEventListener('change', handleChange);
    } catch {
      status = null;
      return;
    }
    // Close the query-settlement race by rereading the actual permission after
    // the listener is attached.
    publishActualPermission();
  }).catch(() => {
    // Unsupported/rejected Permissions API leaves the initial fallback intact.
  });

  return () => {
    if (disposed) return;
    disposed = true;
    queryEpoch += 1;
    if (status) {
      try {
        status.removeEventListener('change', handleChange);
      } catch {
        // Advisory listener cleanup is best-effort in partial implementations.
      }
      status = null;
    }
  };
}
