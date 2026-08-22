// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * YouHubNav — Account · Notifications · Appearance · Preferences rail.
 *
 * Each destination is an existing sheet. Leaving the current page closes it,
 * then the target opens on a microtask so two modal traps never stack.
 */
import { For, type JSX } from 'solid-js';

import { getState } from '@/lib/store';
import { openNotifications } from '@/lib/notifications/youNotificationsState';
import { openPreferences } from '@/lib/prefs/preferences';

import './you-hub.css';

export type YouHubPage = 'account' | 'notifications' | 'appearance' | 'preferences';

const HUB_LINKS: readonly {
  id: YouHubPage;
  label: string;
  testId?: string;
  open: () => void;
}[] = [
  { id: 'account', label: 'Account', open: () => getState().openAccount() },
  {
    id: 'notifications',
    label: 'Notifications',
    testId: 'you-open-notifications',
    open: openNotifications,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    testId: 'you-open-appearance',
    open: () => getState().openAppearance(),
  },
  {
    id: 'preferences',
    label: 'Preferences',
    testId: 'you-open-preferences',
    open: () => openPreferences(),
  },
];

export interface YouHubNavProps {
  current: YouHubPage;
  onLeave: () => void;
}

export function YouHubNav(props: YouHubNavProps): JSX.Element {
  function go(page: YouHubPage, open: () => void): void {
    if (page === props.current) return;
    props.onLeave();
    queueMicrotask(open);
  }

  return (
    <nav class="acct-hub" aria-label="You workspace">
      <For each={HUB_LINKS}>
        {(link) => {
          const current = (): boolean => props.current === link.id;
          return (
            <button
              type="button"
              class={current() ? 'acct-hub-link acct-hub-link--current' : 'acct-hub-link'}
              aria-current={current() ? 'page' : undefined}
              data-testid={link.testId}
              onClick={() => go(link.id, link.open)}
            >
              {link.label}
            </button>
          );
        }}
      </For>
    </nav>
  );
}
