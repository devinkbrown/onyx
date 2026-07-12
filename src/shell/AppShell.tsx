// SPDX-License-Identifier: AGPL-3.0-or-later
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

import { lazy, createEffect, createMemo, createSignal, getOwner, onCleanup, onMount, runWithOwner, Show, splitProps, type JSX } from 'solid-js';
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
import { GuestClaimPrompt } from './GuestClaimPrompt';
import { DmKeyChangeBanner } from './DmKeyChangeBanner';
import { TimeScrubber } from './TimeScrubber';
import { WatchTogetherActivity } from './WatchTogetherActivity';
import { MessageView } from './MessageView';
import { TypingIndicator } from './TypingIndicator';
import { Composer } from './Composer';
// Voice/video UI is lazy: it (plus its ~76kB SUIMYAKU media/worker/wasm graph)
// is only rendered once a call is signalled, so it stays out of the initial
// /app payload and loads on first voice activity. Gated below by voiceUiActive.
const VoiceStage = lazy(() => import('./voice/VoiceStage').then((m) => ({ default: m.VoiceStage })));
const VoiceBar = lazy(() => import('./voice/VoiceBar').then((m) => ({ default: m.VoiceBar })));
const VoicePip = lazy(() => import('./voice/VoicePip').then((m) => ({ default: m.VoicePip })));
const VoiceSettings = lazy(() =>
  import('./voice/settings/VoiceSettings').then((m) => ({ default: m.VoiceSettings })),
);
const IncomingCallOverlay = lazy(() =>
  import('./voice/overlays/IncomingCallOverlay').then((m) => ({ default: m.IncomingCallOverlay })),
);
const OutgoingCallOverlay = lazy(() =>
  import('./voice/overlays/OutgoingCallOverlay').then((m) => ({ default: m.OutgoingCallOverlay })),
);
const CaptionsOverlay = lazy(() =>
  import('./voice/overlays/CaptionsOverlay').then((m) => ({ default: m.CaptionsOverlay })),
);
const ReactionsOverlay = lazy(() =>
  import('./voice/overlays/ReactionsOverlay').then((m) => ({ default: m.ReactionsOverlay })),
);
import { MemberList } from './MemberList';
import { AccountPanel } from '@/app/Account';
import { AppearancePanel } from './AppearancePanel';
import { PreferencesPanel } from './PreferencesPanel';
import { PinnedMessages } from './PinnedMessages';
import { ScheduledMessagesSheet } from './ScheduledMessagesSheet';
import { applyPreferences, isPreferencesOpen, openPreferences, preferences } from '@/lib/prefs/preferences';
import { applySceneMotion } from '@/lib/prefs/sceneMotion';
import { applyCalmPreset } from '@/lib/notifications/calmMode';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { useKeyboardShortcuts } from '@/lib/keyboard/useKeyboardShortcuts';
import { MessageSearch } from './search/MessageSearch';
import { hasMessageSearchableConversation, openMessageSearch } from './search/useMessageSearch';
import { channelIdentityTarget, roomIdentityForTarget, type RoomIdentity } from './roomIdentity';
import {
  forcedColors,
  prefersMoreContrast,
  prefersReducedMotion,
  prefersReducedTransparency,
} from '@/lib/a11y/mediaPrefs';

// ── AppShell props ───────────────────────────────────────────────────────────

export type AppShellProps = {
  onDisconnect?: () => void;
  selfNick?: string;
};

const MOBILE_DRAWER_FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(root: HTMLElement | null | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(MOBILE_DRAWER_FOCUSABLE))
    .filter((node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true');
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

function handleMessageSearchHotkey(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;

  const key = event.key.toLowerCase();
  const isFindCombo = key === 'f' && (event.metaKey || event.ctrlKey) && !event.altKey;
  if (!isFindCombo || !hasMessageSearchableConversation()) return;

  event.preventDefault();
  openMessageSearch();
}

function applyA11yMediaAttributes(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.prefersReducedMotion = String(prefersReducedMotion());
  root.dataset.prefersMoreContrast = String(prefersMoreContrast());
  root.dataset.prefersReducedTransparency = String(prefersReducedTransparency());
  root.dataset.forcedColors = String(forcedColors());
}

function roomIdentityStyle(identity: RoomIdentity | null): JSX.CSSProperties {
  if (!identity) return {};
  return {
    '--room-accent': identity.accent,
    '--room-accent-strong': identity.accentStrong,
    '--room-accent-soft': identity.accentSoft,
    '--room-accent-border': identity.border,
    '--room-accent-wash': identity.wash,
  } as JSX.CSSProperties;
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
  const showKeyboardShortcuts = useStore((s) => s.showKeyboardShortcuts);

  // ── Global keyboard shortcuts (nav, member list, composer, help) ──
  // Spotlight is mounted once at the app root. This hook adds connected-app
  // shortcuts: Esc, Alt+↑/↓, Alt+M, Enter, reader mode, and help.
  useKeyboardShortcuts();

  createEffect(() => {
    applyA11yMediaAttributes();
  });

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
  // The SUIMYAKU media engine (and its worker/wasm codec graph) is only needed
  // once a call is signalled — always many network round-trips away — so it is
  // dynamically imported OFF the first-paint critical path instead of during
  // app boot. It is mounted under AppShell's owner (so its effects/onCleanup
  // still bind to this component's lifecycle) either at idle, or eagerly the
  // moment the local user chooses to join, whichever comes first.
  const mediaOwner = getOwner();
  let mediaBooted = false;
  let mediaDisposed = false;
  onCleanup(() => {
    mediaDisposed = true;
  });
  async function ensureMediaEngine(): Promise<void> {
    if (mediaBooted || mediaDisposed) return;
    mediaBooted = true;
    const { mountMedia } = await import('@/media/useSuimyakuMedia');
    if (mediaDisposed) return;
    runWithOwner(mediaOwner, () => mountMedia());
  }
  if (typeof window !== 'undefined') {
    const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
      .requestIdleCallback;
    if (typeof ric === 'function') ric(() => void ensureMediaEngine(), { timeout: 2000 });
    else setTimeout(() => void ensureMediaEngine(), 200);
  }

  const voice = useStore((s) => s.voice);
  const showVoiceSettings = useStore((s) => s.showVoiceSettings);
  const inCall = createMemo(() => {
    const cs = voice().callState;
    return cs !== 'idle' && cs !== 'ringing_in' && cs !== 'ringing_out';
  });
  const viewingCall = createMemo(() => {
    const v = activeView();
    return inCall() && v.kind === 'channel' && v.channel === voice().callChannel;
  });
  // Any voice surface (incoming/outgoing ring, active call, or the settings
  // sheet) is only ever shown when the call is non-idle or settings are open.
  // Gating the lazy voice cluster on this keeps its chunk off first paint.
  const voiceUiActive = createMemo(() => voice().callState !== 'idle' || showVoiceSettings());
  const canJoinVoice = createMemo(() => preferences().voiceEntry && activeView().kind === 'channel' && !inCall());
  async function joinVoice(withVideo: boolean): Promise<void> {
    const v = activeView();
    if (v.kind !== 'channel') return;
    await ensureMediaEngine();
    const state = getState();
    state.openVoiceSettings();
    void state.joinVoiceChannel(v.channel, withVideo);
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
  const roomIdentity = createMemo(() => roomIdentityForTarget(channelIdentityTarget(activeView())));
  const roomIdentityVars = createMemo(() => roomIdentityStyle(roomIdentity()));

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
  let sidebarDrawerRef: HTMLDivElement | undefined;
  let mobileRoomsButtonRef: HTMLButtonElement | undefined;
  let mobileMembersButtonRef: HTMLButtonElement | undefined;
  let mobileDrawerRestoreTarget: HTMLElement | null = null;

  function rememberMobileDrawerTrigger(): void {
    mobileDrawerRestoreTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  function restoreMobileDrawerFocus(): void {
    const target = mobileDrawerRestoreTarget;
    mobileDrawerRestoreTarget = null;
    if (target?.isConnected) {
      queueMicrotask(() => target.focus());
    }
  }

  function membersDrawerElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.shell-members:not(.shell-members--hidden)');
  }

  function activeMobileDrawerElement(): HTMLElement | null {
    if (!isMobile()) return null;
    if (mobileSidebarOpen()) return sidebarDrawerRef ?? null;
    if (mobileMembersOpen()) return membersDrawerElement();
    return null;
  }

  function focusFirstInMobileDrawer(root: HTMLElement | null | undefined): void {
    queueMicrotask(() => {
      const first = focusableIn(root)[0];
      first?.focus();
    });
  }

  function trapMobileDrawerTab(event: KeyboardEvent, root: HTMLElement): void {
    const focusables = focusableIn(root);
    if (focusables.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }

    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;

    if (!root.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeActiveMobileDrawer(restoreFocus = true): void {
    if (mobileSidebarOpen()) getState().closeMobileSidebar();
    if (mobileMembersOpen()) setMobileMembersOpen(false);
    if (restoreFocus) restoreMobileDrawerFocus();
  }

  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 900px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => {
      setIsMobile(e.matches);
      if (!e.matches) closeActiveMobileDrawer(false);
    };
    mq.addEventListener('change', onChange);
    onCleanup(() => mq.removeEventListener('change', onChange));
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const drawer = activeMobileDrawerElement();
      if (!drawer) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeActiveMobileDrawer();
        return;
      }

      if (event.key === 'Tab') trapMobileDrawerTab(event, drawer);
    };

    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  // ── mobile sidebar handlers ──
  function openMobileSidebar(): void {
    rememberMobileDrawerTrigger();
    mobileDrawerRestoreTarget ||= mobileRoomsButtonRef ?? null;
    setMobileMembersOpen(false); // never both drawers at once
    getState().openMobileSidebar();
    focusFirstInMobileDrawer(sidebarDrawerRef);
  }

  function closeMobileSidebar(): void {
    getState().closeMobileSidebar();
    restoreMobileDrawerFocus();
  }

  function handleToggleMembers(): void {
    if (isMobile()) {
      if (mobileMembersOpen()) {
        setMobileMembersOpen(false);
        restoreMobileDrawerFocus();
        return;
      }

      rememberMobileDrawerTrigger();
      mobileDrawerRestoreTarget ||= mobileMembersButtonRef ?? null;
      getState().closeMobileSidebar();
      setMobileMembersOpen(true);
      queueMicrotask(() => focusFirstInMobileDrawer(membersDrawerElement()));
    } else {
      getState().toggleMemberList();
    }
  }

  function closeMobileMembers(): void {
    setMobileMembersOpen(false);
    restoreMobileDrawerFocus();
  }

  function openHome(): void {
    closeActiveMobileDrawer(false);
    getState().navigate({ kind: 'home' });
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

      <div
        class={shellClass()}
        data-testid="app-shell"
        data-room-identity={roomIdentity()?.target}
        style={roomIdentityVars()}
      >
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
        <div
          ref={sidebarDrawerRef}
          class={`shell-sidebar-slot${mobileSidebarOpen() ? ' shell-sidebar--mobile-open' : ''}`}
          role={isMobile() && mobileSidebarOpen() ? 'dialog' : undefined}
          aria-modal={isMobile() && mobileSidebarOpen() ? 'true' : undefined}
          aria-label={isMobile() && mobileSidebarOpen() ? 'Channel drawer' : undefined}
          tabindex={isMobile() && mobileSidebarOpen() ? -1 : undefined}
        >
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
            showJoinVoice={canJoinVoice()}
            onJoinVoice={joinVoice}
          />
          {/* Guest → claim-your-nick affordance (self-gates on guest state) */}
          <GuestClaimPrompt />
          {/* E2EE key-change warning (self-gates on the active DM having a pending change) */}
          <DmKeyChangeBanner />
          <Show when={preferences().timeScrubber}>
            <TimeScrubber />
          </Show>
          <Show when={preferences().watchTogether}>
            <WatchTogetherActivity />
          </Show>

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
          class={`shell-mobile-nav-btn${activeView().kind === 'home' ? ' shell-mobile-nav-btn--active' : ''}`}
          aria-label="Open Home"
          aria-current={activeView().kind === 'home' ? 'page' : undefined}
          onClick={openHome}
        >
          <b aria-hidden="true">⌂</b>home
        </button>
        <button
          ref={mobileRoomsButtonRef}
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
            ref={mobileMembersButtonRef}
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
          class={`shell-mobile-nav-btn${isPreferencesOpen() ? ' shell-mobile-nav-btn--active' : ''}`}
          aria-label="Open preferences"
          aria-haspopup="dialog"
          onClick={() => openPreferences()}
        >
          <b aria-hidden="true">⚙</b>prefs
        </button>
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

      {/* Scheduled "send later" queue — gated on store.showScheduledMessages */}
      <ScheduledMessagesSheet />

      {/* Voice/video overlays — the whole cluster is lazy and only mounts once
          a call is signalled or the settings sheet opens; each still self-gates
          finer on store.voice. */}
      <Show when={voiceUiActive()}>
        <VoiceSettings
          open={showVoiceSettings()}
          onOpenChange={(open) => (open ? getState().openVoiceSettings() : getState().closeVoiceSettings())}
        />
        <VoicePip />
        <IncomingCallOverlay />
        <OutgoingCallOverlay />
        <CaptionsOverlay />
        <ReactionsOverlay />
      </Show>

      {/* Keyboard shortcuts help overlay — opened with "?" or Home shortcuts action */}
      <ShortcutsOverlay open={showKeyboardShortcuts()} onClose={() => getState().closeKeyboardShortcuts()} />
    </>
  );
}
