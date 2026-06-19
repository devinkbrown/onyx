/**
 * AppShell.tsx — the layout spine for Ruri's connected state.
 *
 * CSS Grid: [ ServerRail | ChannelSidebar | ConversationColumn | MemberList ]
 * PresenceRibbon spans the top of the conversation column.
 * <Background> is mounted fixed behind everything (z-index: -1).
 *
 * Reads from store:
 *   - activeView — discriminated union {kind:'home'|'channel'|'dm'|...}
 *   - channels, dms — Map collections
 *   - connectionStatus — 'connected'|'connecting'|'disconnected'|'reconnecting'
 *   - showMemberList — boolean toggle (store action: toggleMemberList)
 *   - ourNick — our current nick
 *   - mobileSidebarOpen — mobile sidebar toggle
 *
 * Per redesign blueprint (#16):
 *   - ServerRail collapses/hides when fewer than 3 servers
 *   - Thread sidebar is a Sheet panel (not a modal)
 *   - Presence ribbon across the top of the conversation column
 *   - Member list collapsible
 *   - Responsive: collapse MemberList + ServerRail on narrow widths
 *
 * SOLID IDIOMS: components run once; NEVER destructure props; splitProps/
 * mergeProps; createSignal/createMemo/createEffect/onCleanup; For/Show/Switch.
 */

import './shell.css';

import { createMemo, Show, splitProps, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { Background } from '@/backgrounds/index';
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { PresenceRibbon } from './PresenceRibbon';
import { MessageView } from './MessageView';
import { Composer } from './Composer';
import { MemberList } from './MemberList';

// ── AppShell props ───────────────────────────────────────────────────────────

export type AppShellProps = {
  onDisconnect?: () => void;
  selfNick?: string;
};

// ── Home view placeholder ────────────────────────────────────────────────────

function HomeView(): JSX.Element {
  return (
    <div class="shell-home" role="main" aria-label="Welcome screen">
      <div>
        <h2 class="shell-home-title">IRCXNet</h2>
        <p class="shell-home-sub">
          Select a channel from the sidebar to begin, or join one below.
        </p>
      </div>
    </div>
  );
}

// ── Disconnected banner ──────────────────────────────────────────────────────

function DisconnectedBanner(): JSX.Element {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const reconnectIn = useStore((s) => s.reconnectIn);

  const isDown = createMemo(() => {
    const s = connectionStatus();
    return s === 'disconnected' || s === 'reconnecting';
  });

  return (
    <Show when={isDown()}>
      <div
        class="shell-disconnected-banner"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <span aria-hidden="true">⚠</span>
        <Show
          when={connectionStatus() === 'reconnecting'}
          fallback={<span>Disconnected from network.</span>}
        >
          <span>
            Reconnecting
            <Show when={reconnectIn() > 0}>
              {' '}in {reconnectIn()}s
            </Show>
            …
          </span>
        </Show>
      </div>
    </Show>
  );
}

// ── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell(props: AppShellProps): JSX.Element {
  const [local] = splitProps(props, ['onDisconnect', 'selfNick']);

  // ── store reads ──
  const activeView = useStore((s) => s.activeView);
  const showMemberList = useStore((s) => s.showMemberList);
  const mobileSidebarOpen = useStore((s) => s.mobileSidebarOpen);
  const ourNick = useStore((s) => s.ourNick);

  // ── The rail is hidden when fewer than 3 servers are present.
  //    We only have one IRCXNet network for now, so the rail collapses.
  //    Per blueprint #16: "collapse the server rail when <3 servers".
  const CONNECTED_SERVERS = 1;
  const showRail = createMemo(() => CONNECTED_SERVERS >= 3);

  // ── active background from localStorage ──
  const bgId = createMemo(() => {
    try {
      return localStorage.getItem('ruri:bg') ?? 'kintsugi-veins';
    } catch {
      return 'kintsugi-veins';
    }
  });

  // ── derived nick ──
  const displayNick = createMemo(() => local.selfNick ?? ourNick() ?? '');

  // ── is conversation active? ──
  const hasConversation = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' || view.kind === 'dm';
  });

  // ── mobile sidebar handlers ──
  function openMobileSidebar(): void {
    getState().openMobileSidebar();
  }

  function closeMobileSidebar(): void {
    getState().closeMobileSidebar();
  }

  function handleToggleMembers(): void {
    getState().toggleMemberList();
  }

  function handleDisconnect(): void {
    local.onDisconnect?.();
  }

  // ── shell class ──
  const shellClass = createMemo(() => {
    const classes = ['shell'];
    if (!showRail()) classes.push('shell--no-rail');
    if (!showMemberList() || !hasConversation()) classes.push('shell--members-hidden');
    return classes.join(' ');
  });

  return (
    <>
      {/* Fixed background canvas behind everything */}
      <Background id={bgId()} quality="high" />

      <div class={shellClass()} data-testid="app-shell">
        {/* ── Server Rail — hidden when < 3 servers ── */}
        <Show when={showRail()}>
          <ServerRail onDisconnect={handleDisconnect} />
        </Show>

        {/* ── Channel Sidebar ── */}
        {/* Mobile backdrop */}
        <Show when={mobileSidebarOpen()}>
          <div
            class="shell-sidebar-backdrop"
            aria-hidden="true"
            onClick={closeMobileSidebar}
          />
        </Show>
        <div class={mobileSidebarOpen() ? 'shell-sidebar--mobile-open' : ''}>
          <ChannelSidebar onMobileClose={closeMobileSidebar} />
        </div>

        {/* ── Conversation Column ── */}
        <div class="shell-conversation" style={{ 'grid-column': showRail() ? '3' : '2 / span 1' }}>
          {/* Disconnected banner */}
          <DisconnectedBanner />

          {/* Presence ribbon */}
          <PresenceRibbon
            selfNick={displayNick()}
            onToggleMembers={handleToggleMembers}
          />

          {/* Content: home or message view + composer */}
          <Show
            when={hasConversation()}
            fallback={<HomeView />}
          >
            <MessageView selfNick={displayNick()} />
            <Composer />
          </Show>
        </div>

        {/* ── Member List ── */}
        <MemberList hidden={!showMemberList() || !hasConversation()} />
      </div>

      {/* Mobile bottom nav */}
      <nav class="shell-mobile-nav" aria-label="Mobile navigation">
        <button
          type="button"
          class={`shell-mobile-nav-btn${mobileSidebarOpen() ? ' shell-mobile-nav-btn--active' : ''}`}
          aria-label="Toggle channel list"
          aria-expanded={mobileSidebarOpen()}
          onClick={() => mobileSidebarOpen() ? closeMobileSidebar() : openMobileSidebar()}
        >
          ≡ channels
        </button>
        <button
          type="button"
          class="shell-mobile-nav-btn"
          aria-label="Disconnect from network"
          onClick={handleDisconnect}
          style={{ color: 'var(--shu)' }}
        >
          ✕ disconnect
        </button>
      </nav>
    </>
  );
}
