// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelSidebar.tsx — channel list + DM list + join form.
 *
 * Reads store: channels, dms, offlineMemo, activeView, connectionStatus.
 * Actions: joinChannel (store), navigate (store). Offline-memo aggregates
 * surface as a calm "N offline" stamp on DM rows; navigate → clearOfflineMemo
 * drops the map entry and the stamp clears reactively.
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
import { useStore, getState, selectDeviceMemoryOwner } from '@/lib/store';
import type { Channel } from '@/lib/irc/types';
import type { ActiveView, ChannelFolder, DMConversation } from '@/lib/store/store';
import {
  filterSidebarNames,
  matchesSidebarQuery,
} from '@/lib/channel/sidebarFilter';
import { NotificationControls } from './NotificationControls';
import { PrimaryNavigation, type PrimaryCurrentSection, type PrimarySection } from './PrimaryNavigation';

export type ChannelSidebarProps = {
  /** Called when mobile close is triggered */
  onMobileClose?: () => void;
  /** Which conversation collection is visible below the primary navigation. */
  mode?: 'rooms' | 'messages';
  /** Primary product navigation callbacks are owned by AppShell. */
  onModeChange?: (mode: 'rooms' | 'messages') => void;
  onOpenHome?: () => void;
  onOpenCalls?: () => void;
  onOpenYou?: () => void;
  onConversationOpen?: () => void;
  activeSection?: PrimaryCurrentSection | null;
  youDialogOpen?: boolean;
};

type NavigationViewTransition = {
  finished: Promise<unknown>;
  skipTransition(): void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => NavigationViewTransition;
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function publicNetworkName(networkName: string): string {
  const trimmed = networkName.trim();
  // IRCXNet remains a legitimate legacy/wire token, but it is not the public
  // product name. Preserve custom self-hosted network labels while projecting
  // the retired first-party token to the Onyx brand at the UI boundary.
  return !trimmed || trimmed.toLocaleLowerCase() === 'ircxnet' ? 'Onyx' : trimmed;
}

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

/** Accessible suffix for pending offline-memo aggregates on a DM. */
function offlineMemoLabel(count: number): string {
  if (count <= 0) return '';
  return `, ${count} offline`;
}

/** Calm secondary stamp for the DM row (decorative; name carries the count). */
function offlineMemoStamp(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 offline' : `${count} offline`;
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
  const [local] = splitProps(props, [
    'onMobileClose',
    'mode',
    'onModeChange',
    'onOpenHome',
    'onOpenCalls',
    'onOpenYou',
    'onConversationOpen',
    'activeSection',
    'youDialogOpen',
  ]);
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
  const starredChannels = useStore((s) => s.starredChannels);
  const channelFolders = useStore((s) => s.channelFolders);
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );

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
  // Immutable Map replace on write — Object.is equality is enough; badge
  // rows re-read via .get(nick) when the map identity changes.
  const offlineMemo = useStore((s) => s.offlineMemo);
  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const networkName = useStore((s) => s.networkName);
  const displayNetworkName = createMemo(() => publicNetworkName(networkName()));
  const sidebarMode = createMemo(() => local.mode ?? 'rooms');
  const showRooms = createMemo(() => local.mode === undefined || sidebarMode() === 'rooms');
  const showMessages = createMemo(() => local.mode === undefined || sidebarMode() === 'messages');

  // ── join input ──
  const [joinInput, setJoinInput] = createSignal('');
  const joinTarget = createMemo(() => {
    const raw = joinInput().trim();
    if (!raw) return '';
    return raw.startsWith('#') ? raw : `#${raw}`;
  });

  // ── sidebar filter (channels + DMs) ──
  const [listFilter, setListFilter] = createSignal('');
  const [unreadOnly, setUnreadOnly] = createSignal(false);
  const filterActive = createMemo(() => listFilter().trim().length > 0 || unreadOnly());

  // ── sorted channel list (alpha base; stars + folders layer on top) ──
  const sortedChannels = createMemo(() => {
    const entries: Channel[] = [];
    channels().forEach((ch) => entries.push(ch));
    const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
    return filterSidebarNames(sorted, listFilter(), (ch) => ch.name, {
      unreadOnly: unreadOnly(),
    });
  });

  const channelByName = createMemo(() => {
    const map = new Map<string, Channel>();
    for (const ch of sortedChannels()) map.set(ch.name.toLowerCase(), ch);
    return map;
  });

  /**
   * Favorites (starredChannels) then non-default folders, then the default
   * "TEXT CHANNELS" / uncategorized remainder — using store channelFolders.
   */
  const organized = createMemo(() => {
    const byName = channelByName();
    const stars = starredChannels();
    const favorites: Channel[] = [];
    for (const key of stars) {
      const ch = byName.get(key.toLowerCase());
      if (ch) favorites.push(ch);
    }
    favorites.sort((a, b) => a.name.localeCompare(b.name));

    const claimed = new Set(favorites.map((ch) => ch.name.toLowerCase()));
    const folders = channelFolders();
    const folderGroups: { folder: ChannelFolder | null; channels: Channel[] }[] = [];

    for (const folder of folders) {
      // Skip the empty default bucket in the folder loop — it becomes the
      // catch-all "channels" section below.
      const isDefault = folder.id === 'default';
      const list: Channel[] = [];
      for (const name of folder.channels) {
        const key = name.toLowerCase();
        if (claimed.has(key)) continue;
        const ch = byName.get(key);
        if (!ch) continue;
        claimed.add(key);
        list.push(ch);
      }
      if (isDefault) continue;
      folderGroups.push({ folder, channels: list });
    }

    const uncategorized: Channel[] = [];
    for (const ch of sortedChannels()) {
      if (!claimed.has(ch.name.toLowerCase())) uncategorized.push(ch);
    }
    folderGroups.push({ folder: null, channels: uncategorized });

    return { favorites, folderGroups };
  });

  function handleToggleStar(ch: Channel, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!memoryOwner()) return;
    const key = ch.name.toLowerCase();
    if (starredChannels().has(key) || starredChannels().has(ch.name)) {
      getState().unstarChannel(ch.name);
    } else {
      getState().starChannel(ch.name);
    }
  }

  function handleToggleFolder(id: string, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    getState().toggleFolderCollapsed(id);
  }

  // ── sorted DM list ──
  const sortedDms = createMemo(() => {
    const entries: DMConversation[] = [];
    dms().forEach((dm) => entries.push(dm));
    const sorted = entries.sort((a, b) => a.nick.localeCompare(b.nick));
    return filterSidebarNames(sorted, listFilter(), (dm) => dm.nick, {
      unreadOnly: unreadOnly(),
    });
  });

  const filterEmpty = createMemo(() => {
    if (!filterActive()) return false;
    const hasRooms = showRooms() && sortedChannels().length > 0;
    const hasMessages = showMessages() && sortedDms().length > 0;
    return !hasRooms && !hasMessages;
  });

  const collectionHeading = createMemo(() => {
    const count = dms().size;
    if (sidebarMode() === 'messages') {
      return `Messages · ${count} ${count === 1 ? 'conversation' : 'conversations'}`;
    }
    return `Rooms · ${channels().size} joined`;
  });

  // ── roving tab stop ──
  // One item in the combined list owns the single tab stop (tabindex=0): the
  // active conversation if present, otherwise the first channel (or first DM
  // when there are no channels). Everything else is tabindex=-1 and reachable
  // only via the arrow keys, keeping the list a single Tab landing point.
  const rovingKey = createMemo((): string | null => {
    const view = activeView();
    if (showRooms() && view.kind === 'status') return 'status';
    if (showRooms() && view.kind === 'channel') {
      const match = sortedChannels().find(
        (ch) => ch.name.toLowerCase() === view.channel.toLowerCase(),
      );
      if (match) return `ch:${match.name.toLowerCase()}`;
    }
    if (showMessages() && view.kind === 'dm') {
      const match = sortedDms().find(
        (dm) => dm.nick.toLowerCase() === view.nick.toLowerCase(),
      );
      if (match) return `dm:${match.nick.toLowerCase()}`;
    }
    const firstChannel = showRooms() ? sortedChannels()[0] : undefined;
    if (firstChannel) return `ch:${firstChannel.name.toLowerCase()}`;
    const firstDm = showMessages() ? sortedDms()[0] : undefined;
    if (firstDm) return `dm:${firstDm.nick.toLowerCase()}`;
    // Status is the room-list fallback. Message mode can legitimately have no
    // conversations yet, in which case the filter remains the next tab stop.
    return showRooms() ? 'status' : null;
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
    local.onConversationOpen?.();
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handleChannelClick(ch: Channel): void {
    const view: ActiveView = { kind: 'channel', channel: ch.name.toLowerCase() };
    local.onConversationOpen?.();
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handleDmClick(dm: DMConversation): void {
    const view: ActiveView = { kind: 'dm', nick: dm.nick };
    local.onConversationOpen?.();
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handleStatusClick(): void {
    const view: ActiveView = { kind: 'status' };
    local.onConversationOpen?.();
    runConversationNavigation(() => getState().navigate(view), view);
    local.onMobileClose?.();
  }

  function handlePrimarySelect(section: PrimarySection): void {
    switch (section) {
      case 'home':
        local.onOpenHome?.();
        break;
      case 'rooms':
      case 'messages':
        local.onModeChange?.(section);
        break;
      case 'calls':
        local.onOpenCalls?.();
        break;
      case 'you':
        local.onOpenYou?.();
        break;
    }
  }

  function renderChannelRow(ch: Channel): JSX.Element {
    const active = createMemo(() => isChannelActive(activeView(), ch));
    const hasUnread = createMemo(() => ch.unread > 0);
    const hasHighlight = createMemo(() => ch.highlights > 0);
    const starred = createMemo(() => {
      const stars = starredChannels();
      return stars.has(ch.name.toLowerCase()) || stars.has(ch.name);
    });

    return (
      <li>
        <div class="shell-channel-row">
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
            aria-current={active() ? 'location' : undefined}
            aria-label={`${ch.name}${unreadLabel(ch.unread, ch.highlights)}${starred() ? ', favorite' : ''}`}
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
          <Show when={!!memoryOwner()}>
            <button
              type="button"
              class={`shell-channel-star${starred() ? ' shell-channel-star--on' : ''}`}
              data-testid="sidebar-channel-star"
              aria-label={starred() ? `Remove ${ch.name} from favorites` : `Add ${ch.name} to favorites`}
              aria-pressed={starred()}
              tabindex={-1}
              onClick={(e) => handleToggleStar(ch, e)}
            >
              {starred() ? '★' : '☆'}
            </button>
          </Show>
        </div>
      </li>
    );
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
          {displayNetworkName()}
          <span class="sr-only" aria-live="polite" aria-atomic="true">
            {`Connection ${statusLabel()}`}
          </span>
        </span>
        <NotificationControls />
      </div>

      <PrimaryNavigation
        variant="desktop"
        currentSection={local.activeSection}
        selectedCollection={sidebarMode()}
        youDialogOpen={local.youDialogOpen}
        onSelect={handlePrimarySelect}
      />

      <div class="shell-sidebar-filter" role="search">
        <label class="sr-only" for="sidebar-filter-input">
          {sidebarMode() === 'messages' ? 'Filter direct messages' : 'Filter rooms'}
        </label>
        <input
          id="sidebar-filter-input"
          class="shell-sidebar-filter-input"
          type="search"
          data-testid="sidebar-filter"
          placeholder={sidebarMode() === 'messages' ? 'Filter messages' : 'Filter rooms'}
          autocomplete="off"
          spellcheck={false}
          value={listFilter()}
          onInput={(e) => setListFilter(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (listFilter() || unreadOnly())) {
              e.preventDefault();
              e.stopPropagation();
              setListFilter('');
              setUnreadOnly(false);
            }
          }}
        />
        <button
          type="button"
          class={`shell-sidebar-filter-unread${unreadOnly() ? ' shell-sidebar-filter-unread--on' : ''}`}
          data-testid="sidebar-unread-only"
          aria-pressed={unreadOnly()}
          title={unreadOnly() ? 'Showing unread only — click to show all' : 'Show unread only'}
          onClick={() => setUnreadOnly((v) => !v)}
        >
          Unread
        </button>
        <Show when={listFilter().trim().length > 0 || unreadOnly()}>
          <button
            type="button"
            class="shell-sidebar-filter-clear"
            data-testid="sidebar-filter-clear"
            aria-label="Clear filter"
            onClick={() => {
              setListFilter('');
              setUnreadOnly(false);
            }}
          >
            Clear
          </button>
        </Show>
      </div>

      {/* Scrollable list */}
      <div
        class="shell-sidebar-scroll"
        role="region"
        aria-labelledby="sidebar-collection-heading"
        onKeyDown={handleListKeyDown}
      >
        <div class="shell-conversation-spine" data-testid="conversation-spine">
          <div class="shell-conversation-spine-head">
            <p class="shell-conversation-spine-label">Conversations</p>
            <p class="shell-sidebar-collection-heading" id="sidebar-collection-heading" role="heading" aria-level="2">
              {collectionHeading()}
            </p>
          </div>
          <div class="shell-conversation-spine-content">
        <Show when={showRooms()}>
        {/* Server / status entry — always present unless filter hides non-matches */}
        <Show when={!filterActive() || matchesSidebarQuery('status', listFilter())}>
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
        </Show>

        <Show when={filterEmpty()}>
          <p class="shell-sidebar-filter-empty" data-testid="sidebar-filter-empty" role="status">
            {unreadOnly() && !listFilter().trim()
              ? 'Nothing unread right now.'
              : `No channels or DMs match “${listFilter().trim() || 'unread'}”.`}
          </p>
        </Show>

        {/* Favorites — store starredChannels */}
        <Show when={organized().favorites.length > 0}>
          <div class="shell-sidebar-section" data-testid="sidebar-favorites">
            <p class="shell-sidebar-section-label" id="sidebar-favorites-label">
              favorites
            </p>
            <ul
              class="shell-channel-list"
              role="list"
              aria-labelledby="sidebar-favorites-label"
            >
              <For each={organized().favorites}>
                {(ch) => renderChannelRow(ch)}
              </For>
            </ul>
          </div>
        </Show>

        {/* Channel folders + uncategorized (store channelFolders) */}
        <For each={organized().folderGroups}>
          {(group) => {
            const isUncategorized = () => group.folder === null;
            const collapsed = () => group.folder?.collapsed === true;
            if (!isUncategorized() && group.channels.length === 0) return null;
            if (!isUncategorized() && collapsed()) {
              return (
                <div class="shell-sidebar-section" data-testid="sidebar-folder">
                  <button
                    type="button"
                    class="shell-sidebar-section-label shell-sidebar-folder-toggle"
                    aria-expanded={false}
                    data-testid="sidebar-folder-toggle"
                    onClick={(e) => handleToggleFolder(group.folder!.id, e)}
                  >
                    {group.folder!.name} · collapsed
                  </button>
                </div>
              );
            }
            return (
              <div class="shell-sidebar-section" data-testid={isUncategorized() ? 'sidebar-channels' : 'sidebar-folder'}>
                <Show
                  when={isUncategorized()}
                  fallback={
                    <button
                      type="button"
                      class="shell-sidebar-section-label shell-sidebar-folder-toggle"
                      aria-expanded={true}
                      data-testid="sidebar-folder-toggle"
                      onClick={(e) => handleToggleFolder(group.folder!.id, e)}
                    >
                      {group.folder!.name}
                    </button>
                  }
                >
                  <p class="shell-sidebar-section-label" id="sidebar-channels-label">
                    channels
                  </p>
                </Show>
                <ul
                  class="shell-channel-list"
                  role="list"
                  aria-labelledby={isUncategorized() ? 'sidebar-channels-label' : undefined}
                  aria-label={isUncategorized() ? undefined : group.folder!.name}
                >
                  <Show
                    when={group.channels.length > 0}
                    fallback={
                      <Show when={isUncategorized() && sortedChannels().length === 0}>
                        <li style={{ padding: '4px 10px', color: 'var(--paper-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.72rem' }}>
                          No rooms yet
                        </li>
                      </Show>
                    }
                  >
                    <For each={group.channels}>
                      {(ch) => renderChannelRow(ch)}
                    </For>
                  </Show>
                </ul>
              </div>
            );
          }}
        </For>
        </Show>

        {/* DMs section */}
        <Show when={showMessages()}>
          <div class="shell-sidebar-section">
            <p class="shell-sidebar-section-label" id="sidebar-dms-label">
              direct messages
            </p>
            <Show
              when={sortedDms().length > 0}
              fallback={<p class="shell-sidebar-empty">No direct messages yet.</p>}
            >
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
                  // Offline-memo aggregate (wire MEMO). Cleared by navigate →
                  // clearOfflineMemo when the DM is opened.
                  const offlineCount = createMemo(
                    () => offlineMemo().get(dm.nick.toLowerCase())?.count ?? 0,
                  );

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
                        aria-current={active() ? 'location' : undefined}
                        aria-label={`DM with ${dm.nick}${unreadLabel(dm.unread, dm.highlights)}${offlineMemoLabel(offlineCount())}`}
                        onClick={() => handleDmClick(dm)}
                      >
                        <span class="shell-channel-sigil" aria-hidden="true">@</span>
                        <span class="shell-channel-name">{dm.nick}</span>
                        <Show when={offlineCount() > 0}>
                          <span class="shell-channel-offline" aria-hidden="true">
                            {offlineMemoStamp(offlineCount())}
                          </span>
                        </Show>
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
            </Show>
          </div>
        </Show>
          </div>
        </div>
      </div>

      {/* Join channel form */}
      <Show when={showRooms()}>
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
      </Show>
    </aside>
  );
}
