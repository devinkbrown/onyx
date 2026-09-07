// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * NotificationCenter — the mentions / messages inbox.
 *
 * A bell in the presence ribbon with an unread badge; the popover lists
 * recent notifications (mentions, direct messages, system, errors), newest first.
 * Clicking a mention or message marks it read and jumps to the conversation.
 *
 * The store slice (notifications / readNotificationIds / mark* actions)
 * predates this UI — this is the first consumer.
 *
 * SOLID IDIOMS: never destructure props; createMemo chains; For/Show.
 */
import './notification-center.css';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import type { Notification } from '@/lib/store/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { Popover } from '@/primitives/index';
import { relTime } from './HomeView';

const TYPE_GLYPH: Record<Notification['type'], string> = {
  mention: '@',
  dm: 'dm',
  follow: '•',
  system: '·',
  error: '!',
};

type InboxFilter = 'all' | 'attention' | 'other';

const INBOX_FILTERS: readonly { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs you' },
  { id: 'other', label: 'Other' },
];

function isAttentionNotification(notification: Notification): boolean {
  return notification.type === 'mention'
    || notification.type === 'dm'
    || notification.type === 'follow';
}

function clipped(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function targetOf(n: Notification): { kind: 'channel'; channel: string } | { kind: 'dm'; nick: string } | null {
  if ((n.type === 'mention' || n.type === 'follow') && n.channel) return { kind: 'channel', channel: n.channel };
  if (n.type === 'dm' && n.from) return { kind: 'dm', nick: n.from };
  return null;
}

function notificationContext(n: Notification): string {
  if (n.channel && n.from) return `${n.from} in ${n.channel}`;
  if (n.from) return n.from;
  if (n.channel) return n.channel;
  return n.type;
}

function openLabel(n: Notification): string {
  const target = targetOf(n);
  const prefix = target ? 'Open notification from' : 'Notification from';
  return `${prefix} ${notificationContext(n)}: ${clipped(n.text)}`;
}

function dismissLabel(n: Notification): string {
  return `Dismiss notification from ${notificationContext(n)}: ${clipped(n.text)}`;
}

export function NotificationCenter(): JSX.Element {
  const notifications = useStore((s) => s.notifications);
  const readIds = useStore((s) => s.readNotificationIds);
  const [inboxOpen, setInboxOpen] = createSignal(false);
  const [filter, setFilter] = createSignal<InboxFilter>('all');
  const [nowMs, setNowMs] = createSignal(Date.now());
  let centerRef: HTMLDivElement | undefined;
  let closeRef: HTMLButtonElement | undefined;
  let wrapperRef: HTMLSpanElement | undefined;

  const ordered = createMemo(() => [...notifications()].reverse());
  const unreadCount = createMemo(
    () =>
      notifications().filter((n) => isAttentionNotification(n) && !readIds().has(n.id)).length,
  );
  const filterCounts = createMemo(() => {
    const current = notifications();
    return {
      all: current.length,
      attention: current.filter(isAttentionNotification).length,
      other: current.filter((notification) => !isAttentionNotification(notification)).length,
    } satisfies Record<InboxFilter, number>;
  });
  const visibleNotifications = createMemo(() => {
    const selected = filter();
    return ordered().filter((notification) => (
      selected === 'all'
      || (selected === 'attention' && isAttentionNotification(notification))
      || (selected === 'other' && !isAttentionNotification(notification))
    ));
  });
  const emptyCopy = createMemo(() => {
    if (notifications().length === 0) return 'Nothing yet — mentions and messages land here.';
    if (filter() === 'attention') return 'No mentions, follows, or direct messages yet.';
    if (filter() === 'other') return 'No other notifications yet.';
    return 'Nothing yet — mentions and messages land here.';
  });

  createEffect(() => {
    if (!inboxOpen()) return;

    setNowMs(Date.now());
    const clock = window.setInterval(() => setNowMs(Date.now()), 30_000);
    onCleanup(() => window.clearInterval(clock));
  });

  const focusTrigger = (): void => {
    queueMicrotask(() => {
      wrapperRef?.querySelector<HTMLButtonElement>('.onyx-popover__trigger')?.focus();
    });
  };

  const closeInbox = (restoreFocus = false): void => {
    setInboxOpen(false);
    if (restoreFocus) focusTrigger();
  };

  const focusableControls = (): HTMLElement[] => {
    if (!centerRef) return [];
    // jsdom returns comma-selector matches grouped by selector (all buttons, then
    // all links) instead of document order — sort so Tab wrap uses tree order.
    return Array.from(
      centerRef.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
    ).sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  };

  createEffect(() => {
    if (!inboxOpen()) return;
    // Keep this effect subscribed to row membership as well as open state.
    // A synchronized dismissal can remove the focused control without going
    // through dismissNotification(), which otherwise leaves focus on <body>.
    const empty = visibleNotifications().length === 0;
    queueMicrotask(() => {
      if (!untrack(inboxOpen) || !centerRef || centerRef.contains(document.activeElement)) return;
      // Empty inbox: land on Close (not the always-present ledger link).
      if (empty) {
        closeRef?.focus();
        return;
      }
      focusableControls()[0]?.focus();
    });
  });

  const activateNotification = (notification: Notification) => {
    const state = getState();
    // A queued click can outlive the keyed row if another update removes it.
    // Navigate only from the current record, never a stale closure.
    const n = state.notifications.find((candidate) => candidate.id === notification.id);
    if (!n) return;
    state.markNotificationRead(n.id);
    const target = targetOf(n);
    if (target?.kind === 'channel') {
      state.openChannelConversation(
        target.channel,
        n.type === 'follow' ? n.topic?.trim() ?? null : null,
      );
    } else if (target) {
      state.navigate(target);
    }
    closeInbox();
  };

  const focusDismissControl = (id: string | undefined): boolean => {
    if (!id || !centerRef) return false;
    const dismissControls = centerRef.querySelectorAll<HTMLButtonElement>('.notif-center__dismiss');
    for (const control of dismissControls) {
      if (control.dataset.notificationId === id) {
        control.focus();
        return true;
      }
    }
    return false;
  };

  const dismissNotification = (id: string, control: HTMLButtonElement): void => {
    const state = getState();
    const currentOrder = [...state.notifications].reverse();
    const index = currentOrder.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    const nextIds = currentOrder.slice(index + 1).map((notification) => notification.id);
    const previousIds = currentOrder.slice(0, index).reverse().map((notification) => notification.id);
    const restoreFocus = document.activeElement === control;

    state.dismissNotification(id);
    if (!restoreFocus) return;
    queueMicrotask(() => {
      if (!untrack(inboxOpen)) return;
      for (const nextId of nextIds) {
        if (focusDismissControl(nextId)) return;
      }
      for (const previousId of previousIds) {
        if (focusDismissControl(previousId)) return;
      }
      closeRef?.focus();
    });
  };

  const handleDialogKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeInbox(true);
      return;
    }
    if (event.key !== 'Tab') return;

    const controls = focusableControls();
    if (controls.length === 0) return;
    // Prefer activeElement over event.target: jsdom/Solid keydown can retarget,
    // and a focused control may contain the event target (e.g. glyph text).
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeIndex = active
      ? controls.findIndex((control) => control === active || control.contains(active))
      : -1;
    const atStart = activeIndex <= 0;
    const atEnd = activeIndex === controls.length - 1;
    if (event.shiftKey ? atStart : atEnd || activeIndex < 0) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
    }
  };

  return (
    <span ref={wrapperRef} class="shell-ribbon-inbox">
      <Popover
        open={inboxOpen()}
        onOpenChange={setInboxOpen}
        placement="bottom"
        panelLabel="Notification inbox"
        trigger={
          <span class="shell-ribbon-bell" data-testid="ribbon-bell">
            <span class="sr-only">
              {unreadCount() > 0
                ? `Inbox — ${unreadCount()} unread notification${unreadCount() === 1 ? '' : 's'}`
                : 'Inbox'}
            </span>
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
        <div ref={centerRef} class="notif-center" data-testid="notification-center" onKeyDown={handleDialogKeyDown}>
          <header class="notif-center__head">
            <div class="notif-center__heading">
              <h2>Inbox</h2>
              <span class="notif-center__summary" aria-live="polite" aria-atomic="true">
                {unreadCount() > 0 ? `${unreadCount()} unread` : 'No unread conversations'}
              </span>
            </div>
            <Show when={unreadCount() > 0}>
              <button type="button" class="notif-center__action" onClick={() => getState().markAllNotificationsRead()}>
                Mark all read
              </button>
            </Show>
            <a class="notif-center__ledger" href="/stats/" aria-label="Open public room ledger">
              Room ledger
            </a>
            <button
              ref={closeRef}
              type="button"
              class="notif-center__close"
              aria-label="Close notification inbox"
              onClick={() => closeInbox(true)}
            >
              ×
            </button>
          </header>
          <p class="notif-center__explanation">
            This is your notification history. It does not change browser permission, room notification policy, or sound settings.
          </p>

          <div class="notif-center__filters" role="group" aria-label="Filter notification inbox">
            <For each={INBOX_FILTERS}>
              {(option) => (
                <button
                  type="button"
                  class="notif-center__filter"
                  classList={{ 'is-selected': filter() === option.id }}
                  aria-pressed={filter() === option.id ? 'true' : 'false'}
                  onClick={() => setFilter(option.id)}
                >
                  <span>{option.label}</span>
                  <span class="notif-center__filter-count" aria-hidden="true">{filterCounts()[option.id]}</span>
                </button>
              )}
            </For>
          </div>

          <Show
            when={visibleNotifications().length > 0}
            fallback={
              <p class="notif-center__empty">
                {emptyCopy()}
              </p>
            }
          >
            <ul class="notif-center__list" role="list" aria-label="Notification inbox items">
              <For each={visibleNotifications()}>
                {(n) => {
                  const jumpable = targetOf(n) !== null;
                  return (
                    <li
                      class="notif-center__row"
                      data-type={n.type}
                      data-unread={readIds().has(n.id) ? 'false' : 'true'}
                      aria-label={`${readIds().has(n.id) ? 'Read' : 'Unread'} notification`}
                    >
                      <button
                        type="button"
                        class="notif-center__body"
                        disabled={!jumpable}
                        aria-label={openLabel(n)}
                        onClick={() => activateNotification(n)}
                      >
                        <span class="notif-center__glyph" aria-hidden="true">{TYPE_GLYPH[n.type]}</span>
                        <span class="notif-center__text">
                          <span class="notif-center__meta">
                            <Show when={n.from}><strong>{n.from}</strong></Show>
                            <Show when={n.channel}><span class="notif-center__chan">{n.channel}</span></Show>
                            <span class="notif-center__when">{relTime(n.at.getTime() / 1000, nowMs())}</span>
                          </span>
                          <span class="notif-center__preview">{n.text}</span>
                        </span>
                      </button>
                      <Show when={n.channel && /^[#&]/.test(n.channel)}>
                        <a
                          class="notif-center__room-ledger"
                          href={statsRoomHref(n.channel!)}
                          aria-label={`Room ledger for ${n.channel}`}
                          onClick={() => closeInbox()}
                        >
                          Ledger
                        </a>
                      </Show>
                      <button
                        type="button"
                        class="notif-center__dismiss"
                        data-notification-id={n.id}
                        aria-label={dismissLabel(n)}
                        onClick={(event) => dismissNotification(n.id, event.currentTarget)}
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
