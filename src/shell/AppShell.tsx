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

import { lazy, createMemo, createSignal, onCleanup, onMount, Show, splitProps, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { useThemeOptional } from '@/theme';
import { Background } from '@/backgrounds/index';
import { resolveBackgroundId } from './themeBackground';
import { NotificationRuntime } from '@/lib/notifications';
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { HomeView } from './HomeView';
const ChannelBrowser = lazy(() => import('./ChannelBrowser'));
import { PresenceRibbon } from './PresenceRibbon';
import { TimeScrubber } from './TimeScrubber';
import { MessageView } from './MessageView';
import { TypingIndicator } from './TypingIndicator';
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
import { AccountPanel } from '@/app/Account';
import { AppearancePanel } from './AppearancePanel';
import { PreferencesPanel } from './PreferencesPanel';
import { PinnedMessages } from './PinnedMessages';
import { applyPreferences } from '@/lib/prefs/preferences';
import { applySceneMotion } from '@/lib/prefs/sceneMotion';
import { applyCalmPreset } from '@/lib/notifications/calmMode';
import { Spotlight } from '@/chat/spotlight';
import { useSpotlightHotkeys } from '@/chat/spotlight/useSpotlight';
import { KeyboardHelpOverlay } from './KeyboardHelpOverlay';
import { useKeyboardShortcuts } from '@/lib/keyboard/useKeyboardShortcuts';
import { MessageSearch } from './search/MessageSearch';
import { hasMessageSearchableConversation, openMessageSearch } from './search/useMessageSearch';

// ── AppShell props ───────────────────────────────────────────────────────────

export type AppShellProps = {
  onDisconnect?: () => void;
  selfNick?: string;
};

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

function handleMessageSearchHotkey(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;

  const key = event.key.toLowerCase();
  const isFindCombo = key === 'f' && (event.metaKey || event.ctrlKey) && !event.altKey;
  if (!isFindCombo || !hasMessageSearchableConversation()) return;

  event.preventDefault();
  openMessageSearch();
}

// ── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell(props: AppShellProps): JSX.Element {
  const [local] = splitProps(props, ['onDisconnect', 'selfNick']);

  // ── store reads ──
  const activeView = useStore((s) => s.activeView);
  const showMemberList = useStore((s) => s.showMemberList);
  const mobileSidebarOpen = useStore((s) => s.mobileSidebarOpen);
  const ourNick = useStore((s) => s.ourNick);
  const showAccount = useStore((s) => s.showAccount);

  // ── Global keyboard shortcuts (palette, nav, member list, composer, help) ──
  // useSpotlightHotkeys wires Cmd/Ctrl+K and "/" → open spotlight.
  // useKeyboardShortcuts adds: Esc (close overlays), Alt+↑/↓ (channel nav),
  // Alt+M (member list), Alt+Enter (focus composer), ? (keyboard help).
  // Both register/clean-up their window listeners via onMount/onCleanup.
  useSpotlightHotkeys();
  useKeyboardShortcuts();

  onMount(() => {
    window.addEventListener('keydown', handleMessageSearchHotkey);
    onCleanup(() => window.removeEventListener('keydown', handleMessageSearchHotkey));
  });

  // Reflect saved display/behaviour preferences onto <html> on first paint.
  onMount(() => {
    applyPreferences();
    applySceneMotion();
    applyCalmPreset();
  });

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

  // ── active background (reactive: live-updates when changed in the panel) ──
  // 'auto' follows the active theme's signature background (see themeBackground).
  const bgId = useStore((s) => s.backgroundId);
  const theme = useThemeOptional();
  const effectiveBgId = createMemo(() => resolveBackgroundId(bgId(), theme.themeId()));

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
      <NotificationRuntime />

      {/* Fixed background canvas behind everything */}
      <Background id={effectiveBgId()} quality="high" />

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
        <div class={`shell-sidebar-slot${mobileSidebarOpen() ? ' shell-sidebar--mobile-open' : ''}`}>
          <ChannelSidebar onMobileClose={closeMobileSidebar} />
        </div>

        {/* ── Conversation Column ── */}
        {/* Always grid-column 3 (CSS). The rail track stays in the grid at 0px
            when hidden, so the conversation keeps the 1fr track either way. */}
        <div class="shell-conversation">
          {/* Disconnected banner */}
          <DisconnectedBanner />

          {/* Presence ribbon */}
          <PresenceRibbon
            selfNick={displayNick()}
            onToggleMembers={handleToggleMembers}
          />
          <TimeScrubber />

          {/* Content: read-only status buffer, conversation, or home */}
          <Show when={activeView().kind === 'status'} fallback={
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
                  <svg class="shell-voice-join-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 9.5V8a5 5 0 0 1 10 0v1.5" />
                    <rect x="2" y="9.5" width="2.6" height="4" rx="1.1" />
                    <rect x="11.4" y="9.5" width="2.6" height="4" rx="1.1" />
                  </svg>
                  Join voice
                </button>
                <button type="button" class="shell-voice-join-btn" onClick={() => joinVoice(true)}>
                  <svg class="shell-voice-join-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="1.5" y="4" width="9" height="8" rx="1.6" />
                    <path d="m10.5 7 3.4-2.1a.4.4 0 0 1 .6.34v5.5a.4.4 0 0 1-.6.35L10.5 9" />
                  </svg>
                  Join video
                </button>
              </div>
            </Show>
            <MessageView selfNick={displayNick()} />
            <MessageSearch />
            {/* Persistent call controls while in a call */}
            <Show when={inCall()}>
              <VoiceBar />
            </Show>
            <TypingIndicator />
            <Composer />
          </Show>
          }>
            {/* Read-only server/status buffer — no composer, no voice */}
            <MessageView selfNick={displayNick()} />
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

      {/* Account management panel — portal modal, gated on store.showAccount */}
      <AccountPanel
        open={showAccount()}
        onOpenChange={(open) => (open ? getState().openAccount() : getState().closeAccount())}
      />

      {/* Appearance panel — theme + background, gated on store.showAppearance */}
      <AppearancePanel />
      <Show when={useStore((s) => s.showChannelBrowser)()}>
        <ChannelBrowser />
      </Show>

      {/* Preferences panel — display & behaviour, gated on isPreferencesOpen() */}
      <PreferencesPanel />

      {/* Pinned messages drawer — gated on store.showPinnedMessages */}
      <PinnedMessages />

      {/* Voice/video overlays — each self-gates on store.voice */}
      <VoicePip />
      <IncomingCallOverlay />
      <OutgoingCallOverlay />
      <CaptionsOverlay />
      <ReactionsOverlay />

      {/* Command palette — self-gates on spotlight.isOpen() */}
      <Spotlight />

      {/* Keyboard shortcuts help overlay — self-gates on store.showKeyboardShortcuts */}
      <KeyboardHelpOverlay />
    </>
  );
}
