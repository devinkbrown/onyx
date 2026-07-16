// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelSidebar.tsx — channel list + DM list + join form.
 *
 * Reads store: channels, dms, activeView, connectionStatus.
 * Actions: joinChannel (store), navigate (store).
 *
 * SOLID IDIOMS: never destructure props; splitProps; createSignal/createMemo;
 * For/Show; a11y landmarks.
 */

import {
  createMemo,
  createSignal,
  onCleanup,
  For,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import type { Channel } from '@/lib/irc/types';
import type { ActiveView, DMConversation } from '@/lib/store/store';
import { NotificationControls } from './NotificationControls';

export type ChannelSidebarProps = {
  /** Called when mobile close is triggered */
  onMobileClose?: () => void;
};

type NavigationViewTransition = {
  finished: Promise<unknown>;
  skipTransition(): void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => NavigationViewTransition;
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// ── helpers ──────────────────────────────────────────────────────────────────

function isChannelActive(activeView: ActiveView, channel: Channel): boolean {
  return activeView.kind === 'channel' &&
    activeView.channel.toLowerCase() === channel.name.toLowerCase();
}

function isDmActive(activeView: ActiveView, dm: DMConversation): boolean {
  return activeView.kind === 'dm' &&
    activeView.nick.toLowerCase() === dm.nick.toLowerCase();
}

function unreadLabel(unread: number, highlights: number): string {
  const parts: string[] = [];
  if (unread > 0) parts.push(`${unread} unread`);
  if (highlights > 0) parts.push(`${highlights} mention${highlights === 1 ? '' : 's'}`);
  return parts.length > 0 ? `, ${parts.join(', ')}` : '';
}

/**
 * Roving keyboard navigation across the combined channel + DM lists.
 *
 * Up/Down move focus between sibling rows, Home/End jump to the first/last
 * row, and Enter/Space activate (delegated to the button's native click).
 * All rows carry `data-sidebar-item`; one tab stop is kept by giving the
 * active (or first) row `tabindex=0` and the rest `tabindex=-1`.
 */
function moveSidebarFocus(
  container: HTMLElement,
  current: HTMLElement,
  delta: number | 'home' | 'end',
): void {
  const items = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-sidebar-item]'),
  );
  if (items.length === 0) return;

  let nextIndex: number;
  if (delta === 'home') {
    nextIndex = 0;
  } else if (delta === 'end') {
    nextIndex = items.length - 1;
  } else {
    const index = items.indexOf(current as HTMLButtonElement);
    const base = index === -1 ? 0 : index;
    nextIndex = Math.min(items.length - 1, Math.max(0, base + delta));
  }

  const next = items[nextIndex];
  if (next) next.focus();
}

export function ChannelSidebar(props: ChannelSidebarProps): JSX.Element {
  const [local] = splitProps(props, ['onMobileClose']);
  let navigationEpoch = 0;
  let activeNavigationTransition: NavigationViewTransition | null = null;

  const stopActiveNavigationTransition = (): void => {
    if (!activeNavigationTransition) return;
    try {
      activeNavigationTransition.skipTransition();
    } catch {
      // A transition may already be finished/skipped. Navigation must remain
      // usable even when the optional visual layer rejects cancellation.
    }
    activeNavigationTransition = null;
  };

  const runConversationNavigation = (update: () => void, target: ActiveView): void => {
    const epoch = ++navigationEpoch;
    stopActiveNavigationTransition();

    const current = getState().activeView;
    const sameTarget = current.kind === target.kind && (
      current.kind === 'channel' && target.kind === 'channel'
        ? current.channel.toLowerCase() === target.channel.toLowerCase()
        : current.kind === 'dm' && target.kind === 'dm'
          ? current.nick.toLowerCase() === target.nick.toLowerCase()
          : current.kind === 'status' || current.kind === 'home'
    );
    const transitionDocument = typeof document === 'undefined'
      ? null
      : document as ViewTransitionDocument;
    const startViewTransition = transitionDocument?.startViewTransition;
    const reduceMotion = (() => {
      try {
        return typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia(REDUCED_MOTION_QUERY).matches;
      } catch {
        return true;
      }
    })();

    if (sameTarget || !transitionDocument || typeof startViewTransition !== 'function' || reduceMotion) {
      update();
      return;
    }

    let updated = false;
    const guardedUpdate = (): void => {
      if (updated) return;
      updated = true;
      if (epoch === navigationEpoch) update();
    };

    let transition: NavigationViewTransition;
    try {
      transition = startViewTransition.call(transitionDocument, guardedUpdate);
    } catch {
      // Hidden documents and partially implemented browsers may throw before
      // or after invoking the callback. The once-guard preserves navigation.
      guardedUpdate();
      return;
    }

    activeNavigationTransition = transition;
    void transition.finished.catch(() => undefined).finally(() => {
      if (epoch === navigationEpoch && activeNavigationTransition === transition) {
        activeNavigationTransition = null;
      }
    });
  };

  // ── store selectors ──
  const channels = useStore((s) => s.channels);
  const channelLastActivity = useStore((s) => s.channelLastActivity);

  // One shared minute-tick drives every activity stamp in the list.
  const [nowMs, setNowMs] = createSignal(Date.now());
  const activityClock = setInterval(() => setNowMs(Date.now()), 60_000);
  onCleanup(() => {
    clearInterval(activityClock);
    navigationEpoch += 1;
    stopActiveNavigationTransition();
  });

  /** Compact relative activity stamp: 4m · 2h · 3d (empty when unknown/fresh). */
  const activityStamp = (name: string): string => {
    const at = channelLastActivity().get(name.toLowerCase());
    if (!at) return '';
    const sec = Math.max(0, Math.floor((nowMs() - at) / 1000));
    if (sec < 60) return 'now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
  };
  const dms = useStore((s) => s.dms);
  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const networkName = useStore((s) => s.networkName);

  // ── join input ──
  const [joinInput, setJoinInput] = createSignal('');
  const joinTarget = createMemo(() => {
    const raw = joinInput().trim();
    if (!raw) return '';
    return raw.startsWith('#') ? raw : `#${raw}`;
  });

  // ── sorted channel list ──
  const sortedChannels = createMemo(() => {
    const entries: Channel[] = [];
    channels().forEach((ch) => entries.push(ch));
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  });

  // ── sorted DM list ──
  const sortedDms = createMemo(() => {
    const entries: DMConversation[] = [];
    dms().forEach((dm) => entries.push(dm));
    return entries.sort((a, b) => a.nick.localeCompare(b.nick));
  });

  // ── roving tab stop ──
  // One item in the combined list owns the single tab stop (tabindex=0): the
  // active conversation if present, otherwise the first channel (or first DM
  // when there are no channels). Everything else is tabindex=-1 and reachable
  // only via the arrow keys, keeping the list a single Tab landing point.
  const rovingKey = createMemo((): string | null => {
    const view = activeView();
    if (view.kind === 'status') return 'status';
    if (view.kind === 'channel') {
      const match = sortedChannels().find(
        (ch) => ch.name.toLowerCase() === view.channel.toLowerCase(),
      );
      if (match) return `ch:${match.name.toLowerCase()}`;
    }
    if (view.kind === 'dm') {
      const match = sortedDms().find(
        (dm) => dm.nick.toLowerCase() === view.nick.toLowerCase(),
      );
      if (match) return `dm:${match.nick.toLowerCase()}`;
    }
    const firstChannel = sortedChannels()[0];
    if (firstChannel) return `ch:${firstChannel.name.toLowerCase()}`;
    const firstDm = sortedDms()[0];
    if (firstDm) return `dm:${firstDm.nick.toLowerCase()}`;
    // The Status entry always exists, so it owns the single tab stop when there
    // are no channels or DMs yet (keeps the list keyboard-reachable).
    return 'status';
  });

  function channelKey(ch: Channel): string {
    return `ch:${ch.name.toLowerCase()}`;
  }

  function dmKey(dm: DMConversation): string {
    return `dm:${dm.nick.toLowerCase()}`;
  }

  function handleListKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target || !target.matches('[data-sidebar-item]')) return;
    const container = e.currentTarget as HTMLElement;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveSidebarFocus(container, target, 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSidebarFocus(container, target, -1);
        break;
      case 'Home':
        e.preventDefault();
        moveSidebarFocus(container, target, 'home');
        break;
      case 'End':
        e.preventDefault();
        moveSidebarFocus(container, target, 'end');
        break;
      default:
        break;
    }
  }

  // ── status dot modifier ──
  const statusMod = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return '--connected';
    if (s === 'connecting' || s === 'reconnecting') return '--connecting';
    if (s === 'disconnected') return '--disconnected';
    return '--disconnected';
  });

  const statusLabel = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return 'connected';
    if (s === 'reconnecting') return 'reconnecting';
    if (s === 'connecting') return 'connecting';
    return 'disconnected';
  });

  function handleJoin(e: SubmitEvent): void {
    e.preventDefault();
    const target = joinTarget();
    if (!target) return;
    getState().joinChannel(target);
    setJoinInput('');
    // Navigate to the new channel
    const view: ActiveView = { kind: 'channel', channel: target.toLowerCase() };
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handleChannelClick(ch: Channel): void {
    const view: ActiveView = { kind: 'channel', channel: ch.name.toLowerCase() };
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handleDmClick(dm: DMConversation): void {
    const view: ActiveView = { kind: 'dm', nick: dm.nick };
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handleStatusClick(): void {
    const view: ActiveView = { kind: 'status' };
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  return (
    <aside class="shell-sidebar" aria-label="Channel navigation">
      {/* Header */}
      <div class="shell-sidebar-head" aria-hidden="false">
        <span class="shell-sidebar-network">
          <span
            class={`shell-sidebar-dot shell-sidebar-dot${statusMod()}`}
            aria-hidden="true"
          />
          {networkName() || 'Onyx'}
          <span class="sr-only" aria-live="polite" aria-atomic="true">
            {`Connection ${statusLabel()}`}
          </span>
        </span>
        <NotificationControls />
      </div>

      {/* Scrollable list */}
      <div
        class="shell-sidebar-scroll"
        role="region"
        aria-label="Channels and direct messages"
        onKeyDown={handleListKeyDown}
      >
        {/* Server / status entry — always present, read-only server buffer */}
        <div class="shell-sidebar-section">
          <ul class="shell-channel-list" role="list">
            <li>
              <button
                type="button"
                data-sidebar-item
                tabindex={rovingKey() === 'status' ? 0 : -1}
                class={`shell-channel-item${activeView().kind === 'status' ? ' shell-channel-item--active' : ''}`}
                aria-current={activeView().kind === 'status' ? 'page' : undefined}
                aria-label="Server status"
                onClick={handleStatusClick}
              >
                <span class="shell-channel-sigil" aria-hidden="true">✦</span>
                <span class="shell-channel-name">Status</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Channels section */}
        <div class="shell-sidebar-section">
          <p class="shell-sidebar-section-label" id="sidebar-channels-label">
            channels
          </p>
          <ul
            class="shell-channel-list"
            role="list"
            aria-labelledby="sidebar-channels-label"
          >
            <Show
              when={sortedChannels().length > 0}
              fallback={
                <li style={{ padding: '4px 10px', color: 'var(--washi-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.72rem' }}>
                  No rooms yet
                </li>
              }
            >
              <For each={sortedChannels()}>
                {(ch) => {
                  const active = createMemo(() => isChannelActive(activeView(), ch));
                  const hasUnread = createMemo(() => ch.unread > 0);
                  const hasHighlight = createMemo(() => ch.highlights > 0);

                  return (
                    <li>
                      <button
                        type="button"
                        data-sidebar-item
                        tabindex={rovingKey() === channelKey(ch) ? 0 : -1}
                        class={[
                          'shell-channel-item',
                          active() ? 'shell-channel-item--active' : '',
                          hasUnread() && !active() ? 'shell-channel-item--unread' : '',
                          hasHighlight() ? 'shell-channel-item--highlight' : '',
                        ].filter(Boolean).join(' ')}
                        aria-current={active() ? 'page' : undefined}
                        aria-label={`${ch.name}${unreadLabel(ch.unread, ch.highlights)}`}
                        onClick={() => handleChannelClick(ch)}
                      >
                        <span class="shell-channel-sigil" aria-hidden="true">#</span>
                        <span class="shell-channel-name">{ch.name.replace(/^#/, '')}</span>
                        <Show when={activityStamp(ch.name) && ch.unread === 0 && ch.highlights === 0}>
                          <span class="shell-channel-time" aria-hidden="true">
                            {activityStamp(ch.name)}
                          </span>
                        </Show>
                        <Show when={ch.highlights > 0}>
                          <span class="shell-channel-badge" aria-hidden="true">
                            {ch.highlights}
                          </span>
                        </Show>
                        <Show when={ch.unread > 0 && ch.highlights === 0}>
                          <span class="shell-channel-badge" aria-hidden="true">
                            {ch.unread > 99 ? '99+' : ch.unread}
                          </span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
            </Show>
          </ul>
        </div>

        {/* DMs section */}
        <Show when={sortedDms().length > 0}>
          <div class="shell-sidebar-section">
            <p class="shell-sidebar-section-label" id="sidebar-dms-label">
              direct messages
            </p>
            <ul
              class="shell-dm-list"
              role="list"
              aria-labelledby="sidebar-dms-label"
            >
              <For each={sortedDms()}>
                {(dm) => {
                  const active = createMemo(() => isDmActive(activeView(), dm));
                  const hasUnread = createMemo(() => dm.unread > 0);
                  const hasHighlight = createMemo(() => dm.highlights > 0);

                  return (
                    <li>
                      <button
                        type="button"
                        data-sidebar-item
                        tabindex={rovingKey() === dmKey(dm) ? 0 : -1}
                        class={[
                          'shell-channel-item',
                          active() ? 'shell-channel-item--active' : '',
                          hasUnread() && !active() ? 'shell-channel-item--unread' : '',
                          hasHighlight() ? 'shell-channel-item--highlight' : '',
                        ].filter(Boolean).join(' ')}
                        aria-current={active() ? 'page' : undefined}
                        aria-label={`DM with ${dm.nick}${unreadLabel(dm.unread, dm.highlights)}`}
                        onClick={() => handleDmClick(dm)}
                      >
                        <span class="shell-channel-sigil" aria-hidden="true">@</span>
                        <span class="shell-channel-name">{dm.nick}</span>
                        <Show when={dm.highlights > 0}>
                          <span class="shell-channel-badge" aria-hidden="true">
                            {dm.highlights}
                          </span>
                        </Show>
                        <Show when={dm.unread > 0 && dm.highlights === 0}>
                          <span class="shell-channel-badge" aria-hidden="true">
                            {dm.unread > 99 ? '99+' : dm.unread}
                          </span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </div>
        </Show>
      </div>

      {/* Join channel form */}
      <form
        class="shell-join-form"
        onSubmit={handleJoin}
        aria-label="Join a channel"
      >
        <label for="shell-join-input" class="sr-only">
          Channel name
        </label>
        <input
          id="shell-join-input"
          class="shell-join-input"
          type="text"
          placeholder="join #channel"
          autocomplete="off"
          spellcheck={false}
          value={joinInput()}
          onInput={(e) => setJoinInput(e.currentTarget.value)}
          aria-label="Channel name to join"
        />
        <button
          type="submit"
          class="shell-join-btn"
          disabled={!joinInput().trim()}
          aria-label={joinTarget() ? `Join ${joinTarget()}` : 'Join channel'}
        >
          <span aria-hidden="true">+</span>
        </button>
      </form>
    </aside>
  );
}
