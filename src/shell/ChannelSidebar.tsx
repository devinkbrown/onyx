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

export function ChannelSidebar(props: ChannelSidebarProps): JSX.Element {
  const [local] = splitProps(props, ['onMobileClose']);

  // ── store selectors ──
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const networkName = useStore((s) => s.networkName);

  // ── join input ──
  const [joinInput, setJoinInput] = createSignal('');

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

  // ── status dot modifier ──
  const statusMod = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return '--connected';
    if (s === 'connecting' || s === 'reconnecting') return '--connecting';
    if (s === 'disconnected') return '--disconnected';
    return '--disconnected';
  });

  function handleJoin(e: SubmitEvent): void {
    e.preventDefault();
    const raw = joinInput().trim();
    if (!raw) return;
    const target = raw.startsWith('#') ? raw : `#${raw}`;
    getState().joinChannel(target);
    setJoinInput('');
    // Navigate to the new channel
    getState().navigate({ kind: 'channel', channel: target.toLowerCase() });
    local.onMobileClose?.();
  }

  function handleChannelClick(ch: Channel): void {
    getState().navigate({ kind: 'channel', channel: ch.name.toLowerCase() });
    local.onMobileClose?.();
  }

  function handleDmClick(dm: DMConversation): void {
    getState().navigate({ kind: 'dm', nick: dm.nick });
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
          {networkName() || 'IRCXNet'}
        </span>
        <NotificationControls />
      </div>

      {/* Scrollable list */}
      <div class="shell-sidebar-scroll" role="region" aria-label="Channels and direct messages">
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
          aria-label="Join channel"
        >
          <span aria-hidden="true">+</span>
        </button>
      </form>
    </aside>
  );
}
