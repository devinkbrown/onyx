/**
 * NotificationCenter — the mentions inbox.
 *
 * A bell in the presence ribbon with an unread badge; the popover lists
 * recent notifications (mentions, DMs, system, errors), newest first.
 * Clicking a mention/DM marks it read and jumps to the conversation.
 *
 * The store slice (notifications / readNotificationIds / mark* actions)
 * predates this UI — this is the first consumer.
 *
 * SOLID IDIOMS: never destructure props; createMemo chains; For/Show.
 */
import './notification-center.css';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import type { Notification } from '@/lib/store/store';
import { Popover } from '@/primitives/index';
import { relTime } from './HomeView';

const TYPE_GLYPH: Record<Notification['type'], string> = {
  mention: '@',
  dm: 'dm',
  system: '·',
  error: '!',
};

function targetOf(n: Notification): { kind: 'channel'; channel: string } | { kind: 'dm'; nick: string } | null {
  if (n.type === 'mention' && n.channel) return { kind: 'channel', channel: n.channel };
  if (n.type === 'dm' && n.from) return { kind: 'dm', nick: n.from };
  return null;
}

export function NotificationCenter(): JSX.Element {
  const notifications = useStore((s) => s.notifications);
  const readIds = useStore((s) => s.readNotificationIds);

  const ordered = createMemo(() => [...notifications()].reverse());
  const unreadCount = createMemo(
    () =>
      notifications().filter(
        (n) => (n.type === 'mention' || n.type === 'dm') && !readIds().has(n.id),
      ).length,
  );

  const open = (n: Notification) => {
    getState().markNotificationRead(n.id);
    const target = targetOf(n);
    if (target) getState().navigate(target);
  };

  return (
    <span class="shell-ribbon-inbox">
    <Popover
      placement="bottom"
      trigger={
        <span
          class="shell-ribbon-bell"
          role="button"
          aria-label={
            unreadCount() > 0
              ? `Inbox — ${unreadCount()} unread notification${unreadCount() === 1 ? '' : 's'}`
              : 'Inbox'
          }
          data-testid="ribbon-bell"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" class="shell-ribbon-bell-glyph">
            <path
              d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 10.5a.7.7 0 0 0 .58 1.1h9.64a.7.7 0 0 0 .58-1.1L12 8.1V5.5a4 4 0 0 0-4-4Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
            <path d="M6.5 13.4a1.6 1.6 0 0 0 3 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <Show when={unreadCount() > 0}>
            <span class="shell-ribbon-bell-badge" aria-hidden="true">
              {unreadCount() > 9 ? '9+' : unreadCount()}
            </span>
          </Show>
        </span>
      }
    >
      <div class="notif-center" data-testid="notification-center">
        <header class="notif-center__head">
          <h2>Inbox</h2>
          <Show when={notifications().length > 0}>
            <button type="button" class="notif-center__action" onClick={() => getState().markAllNotificationsRead()}>
              Mark all read
            </button>
          </Show>
        </header>

        <Show
          when={ordered().length > 0}
          fallback={
            <p class="notif-center__empty">
              Nothing yet — mentions and direct messages land here.
            </p>
          }
        >
          <ul class="notif-center__list" role="list">
            <For each={ordered()}>
              {(n) => {
                const jumpable = targetOf(n) !== null;
                return (
                  <li
                    class="notif-center__row"
                    data-type={n.type}
                    data-unread={readIds().has(n.id) ? 'false' : 'true'}
                  >
                    <button
                      type="button"
                      class="notif-center__body"
                      disabled={!jumpable}
                      onClick={() => open(n)}
                    >
                      <span class="notif-center__glyph" aria-hidden="true">{TYPE_GLYPH[n.type]}</span>
                      <span class="notif-center__text">
                        <span class="notif-center__meta">
                          <Show when={n.from}><strong>{n.from}</strong></Show>
                          <Show when={n.channel}><span class="notif-center__chan">{n.channel}</span></Show>
                          <span class="notif-center__when">{relTime(n.at.getTime() / 1000, Date.now())}</span>
                        </span>
                        <span class="notif-center__preview">{n.text}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      class="notif-center__dismiss"
                      aria-label="Dismiss notification"
                      onClick={() => getState().dismissNotification(n.id)}
                    >
                      ×
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    </Popover>
    </span>
  );
}
