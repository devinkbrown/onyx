/**
 * AppShell.tsx — the layout spine for Onyx's connected state.
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

import { createMemo, createSignal, onCleanup, onMount, Show, splitProps, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { Background } from '@/backgrounds/index';
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { PresenceRibbon } from './PresenceRibbon';
import { MessageView } from './MessageView';
import { Composer } from './Composer';
import {
  VoiceStage,
  VoiceBar,
  VoicePip,
  IncomingCallOverlay,
  OutgoingCallOverlay,
  CaptionsOverlay,
  ReactionsOverlay,
} from './voice';
import { mountMedia } from '@/media/useSuimyakuMedia';
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
        <h2 class="shell-home-title">You're in the current</h2>
        <p class="shell-home-sub">
          Pick a channel from the rail to dive in, or join a new room below.
          Press <b>/</b> to jump to any room, person, or command.
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

  // ── voice/video ──
  // Boot the SUIMYAKU media engine once and wire its callbacks into the store.
  mountMedia();
  const voice = useStore((s) => s.voice);
  const inCall = createMemo(() => {
    const cs = voice().callState;
    return cs !== 'idle' && cs !== 'ringing_in' && cs !== 'ringing_out';
  });
  const viewingCall = createMemo(() => {
    const v = activeView();
    return inCall() && v.kind === 'channel' && v.channel === voice().callChannel;
  });
  const canJoinVoice = createMemo(() => activeView().kind === 'channel' && !inCall());
  function joinVoice(withVideo: boolean): void {
    const v = activeView();
    if (v.kind === 'channel') void getState().joinVoiceChannel(v.channel, withVideo);
  }

  // ── The rail is hidden when fewer than 3 servers are present.
  //    We only have one IRCXNet network for now, so the rail collapses.
  //    Per blueprint #16: "collapse the server rail when <3 servers".
  const CONNECTED_SERVERS = 1;
  const showRail = createMemo(() => CONNECTED_SERVERS >= 3);

  // ── active background from localStorage ──
  const bgId = createMemo(() => {
    try {
      return localStorage.getItem('ruri:bg') ?? 'deep-current';
    } catch {
      return 'deep-current';
    }
  });

  // ── derived nick ──
  const displayNick = createMemo(() => local.selfNick ?? ourNick() ?? '');

  // ── is conversation active? ──
  const hasConversation = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' || view.kind === 'dm';
  });

  // ── mobile viewport tracking ──
  // The member list is a column on desktop (driven by showMemberList) but a
  // right-hand drawer on mobile that must default CLOSED and open only on tap —
  // so on narrow viewports it gets its own open state.
  const [isMobile, setIsMobile] = createSignal(false);
  const [mobileMembersOpen, setMobileMembersOpen] = createSignal(false);

  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 900px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => {
      setIsMobile(e.matches);
      if (!e.matches) setMobileMembersOpen(false);
    };
    mq.addEventListener('change', onChange);
    onCleanup(() => mq.removeEventListener('change', onChange));
  });

  // ── mobile sidebar handlers ──
  function openMobileSidebar(): void {
    setMobileMembersOpen(false); // never both drawers at once
    getState().openMobileSidebar();
  }

  function closeMobileSidebar(): void {
    getState().closeMobileSidebar();
  }

  function handleToggleMembers(): void {
    if (isMobile()) {
      setMobileMembersOpen((v) => !v);
    } else {
      getState().toggleMemberList();
    }
  }

  function closeMobileMembers(): void {
    setMobileMembersOpen(false);
  }

  // ── is the member surface visible (column on desktop, drawer on mobile)? ──
  const membersVisible = createMemo(() =>
    hasConversation() && (isMobile() ? mobileMembersOpen() : showMemberList()),
  );

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
            {/* In-call stage when viewing the voice channel you're in */}
            <Show when={viewingCall()}>
              <VoiceStage />
            </Show>
            {/* Join-voice affordance for a text channel you're not yet in a call on */}
            <Show when={canJoinVoice()}>
              <div class="shell-voice-join">
                <button type="button" class="shell-voice-join-btn" onClick={() => joinVoice(false)}>
                  <span class="shell-voice-join-icon" aria-hidden="true">◍</span>
                  Join voice
                </button>
                <button type="button" class="shell-voice-join-btn" onClick={() => joinVoice(true)}>
                  <span class="shell-voice-join-icon" aria-hidden="true">▤</span>
                  Join video
                </button>
              </div>
            </Show>
            <MessageView selfNick={displayNick()} />
            {/* Persistent call controls while in a call */}
            <Show when={inCall()}>
              <VoiceBar />
            </Show>
            <Composer />
          </Show>
        </div>

        {/* ── Member List (right drawer on mobile) ── */}
        <Show when={isMobile() && membersVisible()}>
          <div
            class="shell-members-backdrop"
            aria-hidden="true"
            onClick={closeMobileMembers}
          />
        </Show>
        <MemberList hidden={!membersVisible()} />
      </div>

      {/* Mobile bottom tab bar */}
      <nav class="shell-mobile-nav" aria-label="Mobile navigation">
        <button
          type="button"
          class={`shell-mobile-nav-btn${mobileSidebarOpen() ? ' shell-mobile-nav-btn--active' : ''}`}
          aria-label="Toggle channel list"
          aria-expanded={mobileSidebarOpen()}
          onClick={() => (mobileSidebarOpen() ? closeMobileSidebar() : openMobileSidebar())}
        >
          <b aria-hidden="true">≡</b>rooms
        </button>
        <Show when={hasConversation()}>
          <button
            type="button"
            class={`shell-mobile-nav-btn${mobileMembersOpen() ? ' shell-mobile-nav-btn--active' : ''}`}
            aria-label="Toggle member list"
            aria-expanded={mobileMembersOpen()}
            onClick={handleToggleMembers}
          >
            <b aria-hidden="true">◇</b>members
          </button>
        </Show>
        <button
          type="button"
          class="shell-mobile-nav-btn"
          aria-label="Disconnect from network"
          onClick={handleDisconnect}
          style={{ color: 'var(--shu)' }}
        >
          <b aria-hidden="true">✕</b>leave
        </button>
      </nav>

      {/* Voice/video overlays — each self-gates on store.voice */}
      <VoicePip />
      <IncomingCallOverlay />
      <OutgoingCallOverlay />
      <CaptionsOverlay />
      <ReactionsOverlay />
    </>
  );
}
