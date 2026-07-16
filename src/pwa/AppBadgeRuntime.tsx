// SPDX-License-Identifier: AGPL-3.0-or-later
/** Progressive installed-app badge synchronization for unread attention. */
import { createEffect, onCleanup, type JSX } from 'solid-js';

import { useStore } from '@/lib/store';

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function badgeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

async function applyBadge(count: number): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const badgeNavigator = navigator as BadgeNavigator;
  try {
    if (count > 0 && typeof badgeNavigator.setAppBadge === 'function') {
      await badgeNavigator.setAppBadge(count);
    } else if (count === 0 && typeof badgeNavigator.clearAppBadge === 'function') {
      await badgeNavigator.clearAppBadge();
    } else if (count === 0 && typeof badgeNavigator.setAppBadge === 'function') {
      // The standard defines setAppBadge(0) as clearing the badge. This keeps
      // partial implementations from retaining a stale count.
      await badgeNavigator.setAppBadge(0);
    }
  } catch {
    // Badging is ambient progressive enhancement. Permission, active-document,
    // and platform failures must never disturb chat or surface an unhelpful UI.
  }
}

/**
 * Keeps the installed PWA icon aligned with mention/DM attention. Updates are
 * coalesced and serialized so an older slow platform call cannot overwrite a
 * newer count. Ordinary unread chatter intentionally does not badge: Calm Mode
 * treats only direct attention as interrupt-worthy.
 */
export function AppBadgeRuntime(): JSX.Element {
  const unreadAttention = useStore((state) => state.totalUnreadMentions);
  let requested = 0;
  let applied = -1;
  let syncing = false;
  let disposed = false;
  let syncTask: Promise<void> | undefined;

  const flush = (): void => {
    if (syncing || disposed) return;
    syncing = true;
    syncTask = (async () => {
      while (!disposed && applied !== requested) {
        const next = requested;
        await applyBadge(next);
        applied = next;
      }
      syncing = false;
      if (!disposed && applied !== requested) flush();
    })();
  };

  createEffect(() => {
    requested = badgeCount(unreadAttention());
    flush();
  });

  onCleanup(() => {
    disposed = true;
    // Leaving the app route must not strand a stale operating-system badge.
    // Queue the terminal clear behind any platform write already in flight so
    // a slow setAppBadge cannot become the final operation after unmount.
    void (syncTask ?? Promise.resolve()).then(() => applyBadge(0));
  });

  return null;
}
