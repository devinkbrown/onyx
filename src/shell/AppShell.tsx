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
// Eager voice stage styles: the call tray can paint (provisional loading) before
// the lazy VoiceStage chunk arrives — without this, the panel looks unstyled/missing.
import './voice/voice.css';

import { lazy, createEffect, createMemo, createSignal, ErrorBoundary, getOwner, onCleanup, onMount, runWithOwner, Show, splitProps, Suspense, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { useThemeOptional } from '@/theme';
import { Background } from '@/backgrounds/index';
import { resolveBackgroundId } from './themeBackground';
import { NotificationRuntime } from '@/lib/notifications';
import { TopicReadRuntime } from '@/lib/topics/TopicReadRuntime';
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { HomeView } from './HomeView';
const ChannelBrowser = lazy(() => import('./ChannelBrowser'));
const WhoisSheet = lazy(() => import('./WhoisSheet').then((m) => ({ default: m.WhoisSheet })));
import { PresenceRibbon } from './PresenceRibbon';
import { RoomInviteShareHost } from './RoomInviteShare';
import { StagePanel } from './StagePanel';
import { GuestClaimPrompt } from './GuestClaimPrompt';
import { DmKeyChangeBanner } from './DmKeyChangeBanner';
import { DmSafetySheet } from './DmSafetySheet';
import { ReconnectStatusBanner } from './ReconnectStatusBanner';
import { OfflineMemoToast } from './OfflineMemoToast';
import { CapabilityMatrixSection } from './CapabilityMatrixSection';
import { TimeScrubber } from './TimeScrubber';
import { WatchTogetherActivity } from './WatchTogetherActivity';
import { MessageView } from './MessageView';
import { TypingIndicator } from './TypingIndicator';
import { Composer } from './Composer';
import { ContextRail } from './ContextRail';
import { ModerationCockpit } from './ModerationCockpit';
import { OperEventConsole } from './OperEventConsole';
import { RoomInsightsStrip } from './RoomInsightsStrip';
import { RoomSwitcherSheet } from './RoomSwitcherSheet';
type MediaModule = Pick<typeof import('@/media/useCadenceMedia'), 'mountMedia'>;
const defaultMediaModuleLoader = (): Promise<MediaModule> => import('@/media/useCadenceMedia');
let mediaModuleLoader = defaultMediaModuleLoader;
/** Deterministic cold-chunk seam; production callers never replace the loader. */
export function _setMediaModuleLoaderForTests(loader?: () => Promise<MediaModule>): void {
  mediaModuleLoader = loader ?? defaultMediaModuleLoader;
}
// Voice/video UI is lazy: it (plus its ~76kB CADENCE media/worker/wasm graph)
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
import { PrimaryNavigation, type PrimaryCurrentSection, type PrimarySection } from './PrimaryNavigation';
import { CallsHub } from './CallsHub';
// Panels are entered from explicit controls and should not inflate the initial
// connected-shell bundle. Each preserves its existing Suspense boundary below.
const AccountPanel = lazy(() => import('@/app/Account').then((m) => ({ default: m.AccountPanel })));
const AppearancePanel = lazy(() => import('./AppearancePanel').then((m) => ({ default: m.AppearancePanel })));
const PreferencesPanel = lazy(() => import('./PreferencesPanel').then((m) => ({ default: m.PreferencesPanel })));
const PinnedMessages = lazy(() => import('./PinnedMessages').then((m) => ({ default: m.PinnedMessages })));
const ScheduledMessagesSheet = lazy(() => import('./ScheduledMessagesSheet').then((m) => ({ default: m.ScheduledMessagesSheet })));
const JumpToDateSheet = lazy(() => import('./JumpToDateSheet').then((m) => ({ default: m.JumpToDateSheet })));
import { applyPreferences, closePreferences, isPreferencesOpen, openPreferences, preferences } from '@/lib/prefs/preferences';
import { applySceneMotion } from '@/lib/prefs/sceneMotion';
import { applyCalmPreset } from '@/lib/notifications/calmMode';
const ShortcutsOverlay = lazy(() => import('./ShortcutsOverlay').then((m) => ({ default: m.ShortcutsOverlay })));
import { useKeyboardShortcuts } from '@/lib/keyboard/useKeyboardShortcuts';
import { MessageSearch } from './search/MessageSearch';
import { closeMessageSearch, openMessageSearch } from './search/useMessageSearch';
import { channelIdentityTarget, roomIdentityForTarget, type RoomIdentity } from './roomIdentity';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import {
  forcedColors,
  prefersMoreContrast,
  prefersReducedMotion,
  prefersReducedTransparency,
} from '@/lib/a11y/mediaPrefs';
import { makeReducedDataSignal } from '@/lib/a11y/reducedData';
import { scheduleBackgroundTask, type CancelBackgroundTask } from '@/lib/backgroundTask';
import { createVirtualKeyboardOverlayController } from '@/lib/mobile/virtualKeyboardOverlay';
import { keyboardEventIsClaimed } from '@/primitives/focusTrap';

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

function LazySurface(props: {
  label: string;
  onClose: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <ErrorBoundary
      fallback={() => (
        <div class="shell-lazy-state" role="alert">
          <span>{`Could not load ${props.label}.`}</span>
          <button type="button" onClick={() => props.onClose()}>Close</button>
          <button type="button" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      )}
    >
      <Suspense
        fallback={(
          <div class="shell-lazy-state" role="status">
            {`Loading ${props.label}…`}
          </div>
        )}
      >
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}

// ── Disconnected banner ──────────────────────────────────────────────────────

function handleMessageSearchHotkey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

  const key = event.key.toLowerCase();
  const isFindCombo = key === 'f'
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && !event.altKey;
  if (!isFindCombo) return;

  event.preventDefault();
  // Do not move focus behind a modal Sheet/overlay. The active dialog owns the
  // keyboard until it closes; Search Center can be opened immediately after.
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
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

type ShellCurrent = {
  kind: 'home' | 'room' | 'message' | 'status' | 'calls';
  label: string;
  detail: string;
};

function unreadDetail(unread: number, highlights: number): string {
  if (highlights > 0) {
    return `${unread} unread · ${highlights} ${highlights === 1 ? 'mention' : 'mentions'}`;
  }
  return unread > 0 ? `${unread} unread` : 'caught up';
}

// ── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell(props: AppShellProps): JSX.Element {
  const [local] = splitProps(props, ['onDisconnect', 'selfNick']);
  const [whoisReturnFocus, setWhoisReturnFocus] = createSignal<HTMLElement | null>(null);
  const [whoisReturnFocusFallback, setWhoisReturnFocusFallback] = createSignal<HTMLElement | null>(null);

  // ── store reads ──
  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const showMemberList = useStore((s) => s.showMemberList);
  const mobileSidebarOpen = useStore((s) => s.mobileSidebarOpen);
  const ourNick = useStore((s) => s.ourNick);
  const showAccount = useStore((s) => s.showAccount);
  const showAppearance = useStore((s) => s.showAppearance);
  const showPinnedMessages = useStore((s) => s.showPinnedMessages);
  const showScheduledMessages = useStore((s) => s.showScheduledMessages);
  const showJumpToDate = useStore((s) => s.showJumpToDate);
  const showWhois = useStore((s) => s.showWhois);
  const showKeyboardShortcuts = useStore((s) => s.showKeyboardShortcuts);
  const isOper = useStore((s) => s.isOper);
  const reducedData = makeReducedDataSignal();
  const [primarySurface, setPrimarySurface] = createSignal<'conversation' | 'calls'>('conversation');
  const [contextRailOpen, setContextRailOpen] = createSignal(false);
  const [sidebarMode, setSidebarMode] = createSignal<'rooms' | 'messages'>(
    activeView().kind === 'dm' ? 'messages' : 'rooms',
  );

  // ── Global keyboard shortcuts (nav, member list, composer, help) ──
  // Spotlight is mounted once at the app root. This hook adds connected-app
  // shortcuts: Esc, Alt+↑/↓, Alt+M, Enter, reader mode, and help.
  useKeyboardShortcuts();

  createEffect(() => {
    applyA11yMediaAttributes();
  });

  onMount(() => {
    window.addEventListener('keydown', handleMessageSearchHotkey);
    onCleanup(() => {
      window.removeEventListener('keydown', handleMessageSearchHotkey);
      // Search is shell-scoped. Clear its module-level state when the connected
      // shell leaves so a later session cannot inherit a stale open overlay.
      closeMessageSearch();
    });
  });

  // Reflect saved display/behaviour preferences onto <html> on first paint.
  onMount(() => {
    applyPreferences();
    applySceneMotion();
    applyCalmPreset();
  });

  // ── voice/video ──
  // The CADENCE media engine (and its worker/wasm codec graph) is only needed
  // once a call is signalled — always many network round-trips away — so it is
  // dynamically imported OFF the first-paint critical path instead of during
  // app boot. It is mounted under AppShell's owner (so its effects/onCleanup
  // still bind to this component's lifecycle) either at idle, or eagerly the
  // moment the local user chooses to join, whichever comes first.
  const mediaOwner = getOwner();
  let mediaBootPromise: Promise<boolean> | null = null;
  let mediaDisposed = false;
  let voiceJoinAttempt = 0;
  let cancelMediaPreload: CancelBackgroundTask = () => {};
  onCleanup(() => {
    mediaDisposed = true;
    voiceJoinAttempt += 1;
    const pendingVoice = getState().voice;
    if (
      pendingVoice.callState === 'in_call'
      && pendingVoice.callStartedAt === null
    ) getState().leaveVoiceChannel();
    cancelMediaPreload();
  });
  function ensureMediaEngine(): Promise<boolean> {
    if (mediaDisposed) return Promise.resolve(false);
    // Idle preloading and a user click may race. Share the actual import/mount
    // promise so every caller waits for readiness instead of treating
    // "loading" as "booted" and attempting a no-op join.
    if (mediaBootPromise) return mediaBootPromise;
    mediaBootPromise = mediaModuleLoader()
      .then(({ mountMedia }) => {
        if (mediaDisposed) return false;
        runWithOwner(mediaOwner, () => mountMedia());
        return true;
      })
      .catch((error: unknown) => {
        // Allow a later user action to retry a transient chunk-load failure.
        mediaBootPromise = null;
        throw error;
      });
    return mediaBootPromise;
  }
  if (typeof window !== 'undefined') {
    const preloadMedia = () => {
      if (reducedData()) return;
      void ensureMediaEngine().catch(() => {
        // Best-effort idle preload. A direct user action retries and surfaces
        // the failure in context.
      });
    };
    cancelMediaPreload = scheduleBackgroundTask(preloadMedia, {
      idleTimeoutMs: 2_000,
      timerDelayMs: 200,
    });
  }

  const voice = useStore((s) => s.voice);
  const showVoiceSettings = useStore((s) => s.showVoiceSettings);
  const [callSurfaceChannel, setCallSurfaceChannel] = createSignal<string | null>(null);
  const inCall = createMemo(() => {
    const cs = voice().callState;
    return cs !== 'idle' && cs !== 'ringing_in' && cs !== 'ringing_out';
  });
  const viewingCall = createMemo(() => {
    const v = activeView();
    if (!inCall() || v.kind !== 'channel') return false;
    // Channel maps are case-insensitive; strict === made the stage vanish when
    // activeView used a different casing than callChannel (common after JOIN).
    const here = v.channel.toLowerCase();
    const call = (voice().callChannel ?? '').toLowerCase();
    const surface = (callSurfaceChannel() ?? '').toLowerCase();
    return here.length > 0 && (here === call || here === surface);
  });
  createEffect(() => {
    const current = voice();
    if (current.callState === 'idle') {
      setCallSurfaceChannel(null);
    } else if (current.callChannel) {
      setCallSurfaceChannel(current.callChannel);
    }
  });
  // Any voice surface (incoming/outgoing ring, active call, or the settings
  // sheet) is only ever shown when the call is non-idle or settings are open.
  // Gating the lazy voice cluster on this keeps its chunk off first paint.
  const voiceUiActive = createMemo(() => voice().callState !== 'idle' || showVoiceSettings());
  const canJoinVoice = createMemo(() => preferences().voiceEntry && activeView().kind === 'channel' && !inCall());
  const yieldForCallSurfacePaint = (): Promise<void> => new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
  async function joinVoice(withVideo: boolean): Promise<void> {
    const v = activeView();
    if (v.kind !== 'channel') return;
    const channel = v.channel;
    const state = getState();
    if (!state.client) return;

    const attempt = ++voiceJoinAttempt;
    setCallSurfaceChannel(channel);
    // Join the call directly. Do NOT open Voice settings here — that sheet is
    // for device/processing preferences (gear on the call bar), not the entry
    // path. Opening it on "Join video" made video look broken (audio settings).
    // Publish the in-flow call surface SYNCHRONOUSLY so the click always paints
    // feedback before any await (including getUserMedia).
    state.setVoiceCallState({
      callState: 'in_call',
      callChannel: channel,
      localStream: null,
      cameraOn: false,
      cameraStream: null,
      callStartedAt: null,
      pinnedParticipant: null,
      handRaised: false,
      raisedHands: new Set<string>(),
    });

    // Desktop Chromium drops transient user-activation across non-media awaits
    // (rAF, dynamic import). Capture devices as the FIRST await after the click
    // so permission still runs; later engine boot may not keep activation.
    let preacquired: MediaStream | null = null;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const gestureAttempts: MediaStreamConstraints[] = withVideo
        ? [
            { audio: true, video: true },
            { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
          ]
        : [{ audio: true }];
      let captureError: unknown;
      for (const constraints of gestureAttempts) {
        try {
          preacquired = await navigator.mediaDevices.getUserMedia(constraints);
          captureError = undefined;
          break;
        } catch (error) {
          captureError = error;
        }
      }
      if (!preacquired) {
        // User abandoned (leave / newer join) while the permission prompt was up.
        if (attempt !== voiceJoinAttempt) return;
        const current = getState().voice;
        const stillOurs = current.callState === 'in_call'
          && (current.callChannel ?? '').toLowerCase() === channel.toLowerCase()
          && current.callStartedAt === null;
        if (!stillOurs) return;

        const name = captureError instanceof Error ? captureError.name : '';
        const message = captureError instanceof Error ? captureError.message : '';
        // Vitest stubs getUserMedia to reject with "not available in test" —
        // continue without a preacquired stream so unit tests still exercise
        // the engine path. Real browsers always surface the failure.
        const isTestStub = /not available in test/i.test(message);
        if (!isTestStub) {
          setCallSurfaceChannel(null);
          getState().setVoiceCallState({
            callState: 'idle',
            callChannel: null,
            localStream: null,
            cameraOn: false,
            cameraStream: null,
            callStartedAt: null,
          });
          const detail = name === 'NotAllowedError'
            ? 'Camera/microphone permission was blocked. Allow access for this site and try again.'
            : name === 'NotFoundError'
              ? 'No camera or microphone was found on this device.'
              : message || 'Could not access media devices.';
          getState().addToast({
            variant: 'error',
            title: withVideo ? 'Camera unavailable' : 'Microphone unavailable',
            description: detail,
          });
          return;
        }
        // Test/stub path: keep the provisional panel and continue to the engine.
      } else if (attempt === voiceJoinAttempt) {
        const current = getState().voice;
        if (
          current.callState === 'in_call'
          && (current.callChannel ?? '').toLowerCase() === channel.toLowerCase()
          && current.callStartedAt === null
        ) {
          getState().setVoiceCallState({ localStream: preacquired });
        } else {
          preacquired.getTracks().forEach((t) => t.stop());
          preacquired = null;
          return;
        }
      } else {
        preacquired.getTracks().forEach((t) => t.stop());
        preacquired = null;
        return;
      }
    }

    const ownsProvisionalJoin = () => {
      const current = getState().voice;
      return attempt === voiceJoinAttempt
        && current.callState === 'in_call'
        && (current.callChannel ?? '').toLowerCase() === channel.toLowerCase()
        && current.callStartedAt === null;
    };
    const rollbackProvisionalJoin = () => {
      if (!ownsProvisionalJoin()) return;
      setCallSurfaceChannel(null);
      preacquired?.getTracks().forEach((t) => t.stop());
      preacquired = null;
      getState().setVoiceCallState({
        callState: 'idle',
        callChannel: null,
        localStream: null,
        cameraOn: false,
        cameraStream: null,
        callStartedAt: null,
      });
    };
    let storeJoinStarted = false;
    try {
      // Do not await paint before getUserMedia — that burned desktop activation.
      // Schedule a paint after we already hold (or skipped) the stream.
      void yieldForCallSurfacePaint();
      if (!ownsProvisionalJoin()) {
        preacquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      const mediaReady = await ensureMediaEngine();
      if (!ownsProvisionalJoin()) {
        preacquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!mediaReady) {
        rollbackProvisionalJoin();
        getState().addToast({
          variant: 'error',
          title: withVideo ? 'Video could not start' : 'Voice could not start',
          description: 'The media engine did not load. Try joining again.',
        });
        return;
      }
      if (!getState().client) {
        rollbackProvisionalJoin();
        return;
      }
      storeJoinStarted = true;
      const streamForJoin = preacquired;
      preacquired = null; // ownership transfers to the engine/store path
      await getState().joinVoiceChannel(channel, withVideo, streamForJoin);
    } catch {
      if (attempt !== voiceJoinAttempt) {
        preacquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      // Loader failures still own the provisional panel and must be stale-safe.
      // Once the store join starts, its own current-attempt failure rolls that
      // panel back before rethrowing, so ownership is intentionally already
      // false while this layer remains responsible for user-facing feedback.
      if (!storeJoinStarted && !ownsProvisionalJoin()) {
        preacquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!storeJoinStarted) {
        rollbackProvisionalJoin();
        getState().addToast({
          variant: 'error',
          title: withVideo ? 'Video could not start' : 'Voice could not start',
          description: 'The media engine did not load. Try joining again.',
        });
      } else {
        // Store already rolled back + toasted with a specific identity/codec message.
        preacquired?.getTracks().forEach((t) => t.stop());
      }
    }
  }

  // Atlas keeps a compact product dock available on desktop even on a single
  // network. Its destination controls replace the old sidebar quick-switch.
  const showRail = createMemo(() => true);

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

  // A direct-message conversation has no channel membership roster. Keeping
  // the member column/drawer available there opened a real but empty nicklist,
  // which looked like the channel roster had disappeared after switching to a
  // DM. Only channel views own the member surface.
  const hasMemberRoster = createMemo(() => activeView().kind === 'channel');

  // ── mobile viewport tracking ──
  // The member list is a column on desktop (driven by showMemberList) but a
  // right-hand drawer on mobile that must default CLOSED and open only on tap —
  // so on narrow viewports it gets its own open state.
  const [isMobile, setIsMobile] = createSignal(false);
  const [mobileMembersOpen, setMobileMembersOpen] = createSignal(false);
  const [mobileMoreOpen, setMobileMoreOpen] = createSignal(false);
  const [mobileMoreView, setMobileMoreView] = createSignal<'destinations' | 'room-controls'>('destinations');
  const [mobileMenuReturnSurface, setMobileMenuReturnSurface] = createSignal<'appearance' | 'preferences' | 'you' | null>(null);
  let mobileMembersTarget: string | null = null;
  let mobileRoomControlsTarget: string | null = null;
  let sidebarDrawerRef: HTMLDivElement | undefined;
  let mobileRoomsButtonRef: HTMLButtonElement | undefined;
  let mobileMenuButtonRef: HTMLButtonElement | undefined;
  let mobileMoreRef: HTMLDivElement | undefined;
  let mobileRoomControlsLauncherRef: HTMLButtonElement | undefined;
  let mobileRoomControlsBackRef: HTMLButtonElement | undefined;
  let contextTriggerRef: HTMLButtonElement | undefined;
  let mobileDrawerRestoreTarget: HTMLElement | null = null;

  function rememberMobileDrawerTrigger(): void {
    mobileDrawerRestoreTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  function restoreMobileDrawerFocus(): void {
    const target = mobileDrawerRestoreTarget;
    mobileDrawerRestoreTarget = null;
    queueMicrotask(() => {
      const targetLabel = target?.getAttribute('aria-label');
      const fallback = targetLabel
        ? Array.from(document.querySelectorAll<HTMLElement>('[data-primary-navigation-variant="mobile"] [aria-label]'))
          .find((candidate) => candidate.getAttribute('aria-label') === targetLabel)
        : null;
      const destination = target?.isConnected ? target : fallback;
      destination?.focus();
    });
  }

  function membersDrawerElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.shell-members:not(.shell-members--hidden)');
  }

  function activeMobileDrawerElement(): HTMLElement | null {
    if (!isMobile()) return null;
    if (mobileSidebarOpen()) return sidebarDrawerRef ?? null;
    if (mobileMembersOpen()) return membersDrawerElement();
    if (mobileMoreOpen()) return mobileMoreRef ?? null;
    return null;
  }

  // aria-modal communicates the drawer boundary, but it does not make the
  // rest of the document non-interactive on its own. Native inert keeps the
  // conversation, inactive navigation, and bottom tabs out of both keyboard
  // reach and the accessibility tree until the active mobile drawer closes.
  createEffect(() => {
    const drawer = activeMobileDrawerElement();
    if (!drawer) return;

    const backgroundRoots = [
      document.querySelector<HTMLElement>('.shell-rail'),
      document.querySelector<HTMLElement>('.shell-sidebar-slot'),
      document.querySelector<HTMLElement>('.shell-conversation'),
      document.querySelector<HTMLElement>('.shell-mobile-nav'),
    ].filter((root): root is HTMLElement => Boolean(
      root
      && root !== drawer
      && !root.contains(drawer)
      && !drawer.contains(root)
    ));

    for (const root of backgroundRoots) root.setAttribute('inert', '');
    onCleanup(() => {
      for (const root of backgroundRoots) root.removeAttribute('inert');
    });
  });

function focusFirstInMobileDrawer(root: HTMLElement | null | undefined): void {
  queueMicrotask(() => {
    const first = focusableIn(root)[0];
    (first ?? root)?.focus();
  });
}

function focusMobileMembersDrawer(root: HTMLElement | null | undefined): void {
  queueMicrotask(() => {
    const close = root?.querySelector<HTMLElement>('.shell-members-close');
    const first = focusableIn(root)[0];
    (close ?? first ?? root)?.focus();
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

  function hasPortaledModalAboveDrawer(drawer: HTMLElement): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .some((dialog) => dialog !== drawer && !drawer.contains(dialog));
  }

  function closeActiveMobileDrawer(restoreFocus = true): void {
    if (mobileSidebarOpen()) getState().closeMobileSidebar();
    if (mobileMembersOpen()) setMobileMembersOpen(false);
    if (mobileMoreOpen()) setMobileMoreOpen(false);
    if (restoreFocus) restoreMobileDrawerFocus();
  }

  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 900px)');
    const keyboardOverlay = createVirtualKeyboardOverlayController();
    setIsMobile(mq.matches);
    keyboardOverlay?.setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => {
      const roster = membersDrawerElement();
      const active = document.activeElement;
      const preserveMemberContext = e.matches && Boolean(roster && (
        (active instanceof Node && roster.contains(active))
        || (showWhois() && whoisReturnFocus()?.closest('.shell-members') === roster)
      ));
      // Open the drawer before changing layout modes. That prevents the
      // persistent roster from becoming inert for one reactive turn, which
      // would light-dismiss an open member card and strand focus on <body>.
      if (preserveMemberContext) {
        mobileDrawerRestoreTarget ||= document.querySelector<HTMLElement>('[data-testid="ribbon-members"]');
        setMobileMembersOpen(true);
      }
      // Context never owns the column-4 slot on mobile (it is a fixed edge
      // sheet there instead — see the >=901px CSS gate). Close it on the
      // transition so asideOccupant() cannot keep reporting 'context' after
      // the viewport can no longer render it as a column occupant.
      if (e.matches) setContextRailOpen(false);
      setIsMobile(e.matches);
      keyboardOverlay?.setMobile(e.matches);
      if (!e.matches) {
        closeActiveMobileDrawer(false);
      }
    };
    mq.addEventListener('change', onChange);
    onCleanup(() => {
      mq.removeEventListener('change', onChange);
      keyboardOverlay?.dispose();
    });
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const drawer = activeMobileDrawerElement();
      if (!drawer || keyboardEventIsClaimed(event)) return;
      // A portaled modal sits outside the drawer DOM but above it visually.
      // Its later focus-trap listener must own every key, especially Tab and
      // Escape; otherwise this older drawer listener can move focus behind it.
      if (hasPortaledModalAboveDrawer(drawer)) return;

      if (event.key === 'Escape') {
        if (drawer.querySelector('[role="dialog"]:not([hidden])')) return;
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
    setMobileMoreOpen(false);
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
      mobileDrawerRestoreTarget ||= document.querySelector<HTMLElement>('[data-testid="ribbon-members"]');
      getState().closeMobileSidebar();
      setMobileMoreOpen(false);
      setMobileMembersOpen(true);
      queueMicrotask(() => focusMobileMembersDrawer(membersDrawerElement()));
    } else {
      // People wins the column-4 slot over an open Context rail. Flip the
      // signal directly (never route through closeContextRail — that queues
      // focus onto the Context trigger and would yank focus off the People
      // button the user just pressed, violating WCAG SC 3.2.1 On Focus).
      if (contextRailOpen()) {
        setContextRailOpen(false);
        if (!showMemberList()) getState().toggleMemberList();
        return;
      }
      getState().toggleMemberList();
    }
  }

  function closeMobileMembers(): void {
    setMobileMembersOpen(false);
    restoreMobileDrawerFocus();
  }

  // A mobile drawer belongs to the channel it was opened for. Global
  // navigation (Spotlight, notifications, shortcuts, reconnect restore) can
  // replace activeView without going through the drawer's own Message/Home
  // handlers. Close on that boundary instead of retaining a true open signal
  // that silently reappears with a stale roster on the next channel view.
  createEffect(() => {
    const view = activeView();
    if (!mobileMembersOpen()) {
      mobileMembersTarget = null;
      return;
    }

    const nextTarget = view.kind === 'channel' ? view.channel.toLowerCase() : null;
    if (nextTarget === null) {
      closeMobileMembers();
      return;
    }
    if (mobileMembersTarget === null) {
      mobileMembersTarget = nextTarget;
      return;
    }
    if (nextTarget !== mobileMembersTarget) closeMobileMembers();
  });

  function openHome(): void {
    closeActiveMobileDrawer(false);
    setPrimarySurface('conversation');
    getState().navigate({ kind: 'home' });
  }

  function selectSidebarMode(mode: 'rooms' | 'messages'): void {
    setPrimarySurface('conversation');
    setSidebarMode(mode);
  }

  function openMobileCollection(mode: 'rooms' | 'messages'): void {
    selectSidebarMode(mode);
    if (mobileSidebarOpen()) {
      focusFirstInMobileDrawer(sidebarDrawerRef);
      return;
    }
    openMobileSidebar();
  }

  function openCalls(): void {
    closeActiveMobileDrawer(false);
    setPrimarySurface('calls');
  }

  function openYou(): void {
    closeActiveMobileDrawer(false);
    getState().openAccount();
  }

  function openMobileMore(): void {
    rememberMobileDrawerTrigger();
    getState().closeMobileSidebar();
    setMobileMembersOpen(false);
    setMobileMoreView('destinations');
    setMobileMoreOpen(true);
    queueMicrotask(() => focusFirstInMobileDrawer(mobileMoreRef));
  }

  function closeMobileMore(): void {
    setMobileMoreOpen(false);
    setMobileMoreView('destinations');
    mobileRoomControlsTarget = null;
    restoreMobileDrawerFocus();
  }

  function closeMobileMoreForSurface(): void {
    setMobileMoreOpen(false);
    setMobileMoreView('destinations');
    mobileRoomControlsTarget = null;
    // The destination Sheet now owns keyboard focus. Its close transition
    // restores focus to the persistent Menu trigger below.
    mobileDrawerRestoreTarget = null;
  }

  function openMobileRoomControls(): void {
    const view = activeView();
    if (view.kind !== 'channel') return;
    mobileRoomControlsTarget = view.channel.toLowerCase();
    setMobileMoreView('room-controls');
  }

  function returnToMobileMore(): void {
    setMobileMoreView('destinations');
    queueMicrotask(() => mobileRoomControlsLauncherRef?.focus({ preventScroll: true }));
  }

  function closeContextRail(): void {
    setContextRailOpen(false);
    queueMicrotask(() => {
      if (contextTriggerRef?.isConnected) contextTriggerRef.focus({ preventScroll: true });
    });
  }

  function selectMobileMore(destination: 'calls' | 'you'): void {
    if (destination === 'you') {
      closeMobileMoreForSurface();
      getState().openAccount();
      // Arm after open so the lifecycle effect does not treat the pre-open
      // state as an immediate close.
      setMobileMenuReturnSurface('you');
      return;
    }
    closeMobileMore();
    openCalls();
  }

  function mobileMoreDialogLabel(): string {
    const view = activeView();
    return mobileMoreView() === 'room-controls' && view.kind === 'channel'
      ? `Room controls for ${view.channel}`
      : 'Menu';
  }

  function restoreMobileMenuTriggerFocus(): void {
    const returnToMobile = isMobile();
    queueMicrotask(() => {
      const mobileFallback = document.querySelector<HTMLElement>(
        '[data-primary-navigation-variant="mobile"] [aria-label="Open Menu"]',
      );
      const desktopNav = document.querySelector<HTMLElement>(
        '[data-primary-navigation-variant="desktop"]',
      );
      const desktopFallback = desktopNav?.querySelector<HTMLElement>('[aria-current="page"]')
        ?? desktopNav?.querySelector<HTMLElement>('button');
      const mobileTarget = mobileMenuButtonRef?.isConnected
        ? mobileMenuButtonRef
        : mobileFallback?.isConnected ? mobileFallback : null;
      const target = returnToMobile ? mobileTarget : desktopFallback;
      target?.focus({ preventScroll: true });
    });
  }

  // You / Appearance / Preferences are portaled Sheets. Observe their shared
  // state rather than relying on one close button so Escape, backdrop clicks,
  // and You-hub handoffs all return focus through the same contract.
  createEffect(() => {
    const appearanceOpen = showAppearance();
    const preferencesOpen = isPreferencesOpen();
    const youOpen = showAccount();
    const returnSurface = mobileMenuReturnSurface();
    if (!returnSurface) return;

    if (returnSurface === 'you') {
      if (youOpen) return;
      // Account closes itself, then opens Appearance/Preferences in a sibling
      // microtask. Defer two ticks so that handoff can land before we treat
      // the Account close as a Menu-return (a single microtask races and clears
      // the armed surface while the nested sheet is still opening).
      const armed = returnSurface;
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (mobileMenuReturnSurface() !== armed) return;
          if (showAppearance()) {
            setMobileMenuReturnSurface('appearance');
            return;
          }
          if (isPreferencesOpen()) {
            setMobileMenuReturnSurface('preferences');
            return;
          }
          if (showAccount()) return;
          setMobileMenuReturnSurface(null);
          restoreMobileMenuTriggerFocus();
        });
      });
      return;
    }

    if ((returnSurface === 'appearance' && appearanceOpen)
      || (returnSurface === 'preferences' && preferencesOpen)) return;
    setMobileMenuReturnSurface(null);
    restoreMobileMenuTriggerFocus();
  });

  // The room-controls transition removes the focused launcher. Move focus only
  // after the replacement subtree (and its Back ref) exists, so browsers never
  // collapse focus to <body> between the two views.
  createEffect(() => {
    if (!mobileMoreOpen() || mobileMoreView() !== 'room-controls') return;
    queueMicrotask(() => mobileRoomControlsBackRef?.focus({ preventScroll: true }));
  });

  // The control desk is scoped to the room from which it was opened. Global
  // navigation can replace activeView without using the desk's own controls;
  // close instead of leaving an empty or stale modal over the new destination.
  createEffect(() => {
    const view = activeView();
    if (!mobileMoreOpen() || mobileMoreView() !== 'room-controls') return;
    const nextTarget = view.kind === 'channel' ? view.channel.toLowerCase() : null;
    if (nextTarget === null || nextTarget !== mobileRoomControlsTarget) closeMobileMore();
  });

  function openRoomsFromCalls(): void {
    if (isMobile()) {
      openMobileCollection('rooms');
      return;
    }
    selectSidebarMode('rooms');
  }

  function returnToCall(channel: string): void {
    setPrimarySurface('conversation');
    getState().navigate({ kind: 'channel', channel });
  }

  function openMemberDm(nick: string): void {
    // The member trigger becomes hidden/inert as soon as a DM replaces the
    // channel roster, so it cannot remain the focus owner. Close any mobile
    // drawer without restoring that stale trigger, then hand focus directly
    // to the conversation's persistent composer.
    closeActiveMobileDrawer(false);
    getState().navigate({ kind: 'dm', nick });
    queueMicrotask(() => {
      const composer = document.querySelector<HTMLTextAreaElement>('[data-composer-input]');
      if (composer?.isConnected && !composer.disabled) composer.focus({ preventScroll: true });
    });
  }

  function openMemberWhois(nick: string, returnFocus: HTMLElement): void {
    setWhoisReturnFocus(returnFocus);
    setWhoisReturnFocusFallback(returnFocus.closest<HTMLElement>('.shell-members'));
    getState().whois(nick);
  }

  function clearMemberWhoisReturnFocus(): void {
    setWhoisReturnFocus(null);
    setWhoisReturnFocusFallback(null);
  }

  // ── is the member surface visible (column on desktop, drawer on mobile)? ──
  const membersVisible = createMemo(() =>
    hasMemberRoster() && (isMobile() ? mobileMembersOpen() : showMemberList()),
  );

  // ── single-occupant column-4 slot ──
  // Column 4 can hold the member roster, the Context rail, or nothing — never
  // both the roster and the rail at once. This is what makes "both claim
  // grid-column:4" unrepresentable: exactly one branch below can be true, and
  // AppShell threads the result through a single tri-state DOM attribute
  // (`data-shell-aside`) that both MemberList and ContextRail read off of,
  // instead of two independently-computed booleans that could drift apart.
  // Context never takes the column on mobile — it stays a fixed edge sheet
  // there (see the >=901px CSS gate), so mobile always falls through to the
  // member drawer/column state.
  type ShellAside = 'members' | 'context' | 'none';
  const asideOccupant = createMemo<ShellAside>(() => {
    if (!isMobile() && contextRailOpen()) return 'context';
    if (membersVisible()) return 'members';
    return 'none';
  });

  // A11y: openMemberWhois above captures `.shell-members` as the WHOIS
  // return-focus fallback. If Context then claims column 4, that fallback
  // goes [inert] the instant asideOccupant() moves off 'members' —
  // focusTrap.ts's canRestoreDialogFocus rejects [inert]/[aria-hidden="true"]
  // targets, so closing WHOIS would strand focus on <body> (WCAG SC 2.4.3).
  // Re-point the fallback to a control that stays interactive for as long as
  // Context owns the slot.
  createEffect(() => {
    if (asideOccupant() === 'members' || !showWhois()) return;
    const ribbonMembers = document.querySelector<HTMLElement>('[data-testid="ribbon-members"]');
    setWhoisReturnFocusFallback(ribbonMembers ?? contextTriggerRef ?? null);
  });

  const activeSection = createMemo<PrimaryCurrentSection>(() => {
    if (primarySurface() === 'calls') return 'calls';
    const view = activeView();
    if (view.kind === 'home') return 'home';
    if (view.kind === 'dm') return 'messages';
    return 'rooms';
  });

  // This is orientation, not a new source of truth: it only projects the
  // selected store target and its existing unread counters. It deliberately
  // says nothing about transport, E2EE, or call protection.
  const roomCurrent = createMemo<ShellCurrent>(() => {
    if (primarySurface() === 'calls') {
      return { kind: 'calls', label: 'Calls', detail: voice().callChannel ?? 'Call directory' };
    }

    const view = activeView();
    if (view.kind === 'channel') {
      const channel = channels().get(view.channel.toLowerCase());
      return {
        kind: 'room',
        label: channel?.name ?? view.channel,
        detail: unreadDetail(channel?.unread ?? 0, channel?.highlights ?? 0),
      };
    }
    if (view.kind === 'dm') {
      const dm = dms().get(view.nick.toLowerCase());
      return {
        kind: 'message',
        label: `Message · ${dm?.nick ?? view.nick}`,
        detail: unreadDetail(dm?.unread ?? 0, dm?.highlights ?? 0),
      };
    }
    if (view.kind === 'status') {
      return { kind: 'status', label: 'Network status', detail: 'read-only ledger' };
    }

    const items = [...channels().values(), ...dms().values()];
    const unread = items.reduce((total, item) => total + item.unread, 0);
    const highlights = items.reduce((total, item) => total + item.highlights, 0);
    return { kind: 'home', label: 'Home', detail: unreadDetail(unread, highlights) };
  });

  function handlePrimaryNavigation(section: PrimarySection): void {
    switch (section) {
      case 'home':
        openHome();
        break;
      case 'rooms':
      case 'messages':
        openMobileCollection(section);
        break;
      case 'calls':
        openCalls();
        break;
      case 'you':
        openYou();
        break;
    }
  }

  function handleDisconnect(): void {
    local.onDisconnect?.();
  }

  // ── shell class ──
  // Column-4 occupancy is no longer a class concern — it lives entirely on
  // the data-shell-aside attribute (asideOccupant above), which CSS reads via
  // .shell[data-shell-aside=...] attribute selectors.
  const shellClass = createMemo(() => {
    const classes = ['shell'];
    if (!showRail()) classes.push('shell--no-rail');
    return classes.join(' ');
  });

  return (
    <>
      <NotificationRuntime />
      <OfflineMemoToast />
      <TopicReadRuntime />

      {/* Fixed background canvas behind everything */}
      <Background id={effectiveBgId()} quality="high" />

      <div
        class={shellClass()}
        data-testid="app-shell"
        data-room-identity={roomIdentity()?.target}
        data-shell-aside={asideOccupant()}
        style={roomIdentityVars()}
      >
        {/* ── Server Rail — hidden when < 3 servers ── */}
        <Show when={showRail()}>
          <ServerRail
            onDisconnect={handleDisconnect}
            currentSection={activeSection()}
            selectedCollection={sidebarMode()}
            youDialogOpen={showAccount()}
            onSelect={handlePrimaryNavigation}
          />
        </Show>

        {/* ── Channel Sidebar ── */}
        {/* Mobile backdrop */}
        <RoomSwitcherSheet
          open={mobileSidebarOpen()}
          mode={sidebarMode()}
          onDismiss={closeMobileSidebar}
          sheetRef={(element) => { sidebarDrawerRef = element; }}
        >
          <ChannelSidebar
            mode={sidebarMode()}
            onModeChange={selectSidebarMode}
            onConversationOpen={() => {
              setPrimarySurface('conversation');
            }}
            onMobileClose={closeMobileSidebar}
          />
        </RoomSwitcherSheet>

        {/* ── Conversation Column ── */}
        {/* Always grid-column 3 (CSS). The rail track stays in the grid at 0px
            when hidden, so the conversation keeps the 1fr track either way. */}
        <div class="shell-conversation">
          {/* Disconnected banner */}
          <ReconnectStatusBanner />

          {/* Presence ribbon */}
          <PresenceRibbon
            selfNick={displayNick()}
            contextActionsOnly={isMobile()}
            onToggleMembers={handleToggleMembers}
            membersOpen={asideOccupant() === 'members'}
            showJoinVoice={canJoinVoice()}
            onJoinVoice={joinVoice}
          />
          <div
            class="shell-room-current"
            data-shell-current-kind={roomCurrent().kind}
            role="note"
            aria-label={`Room current: ${roomCurrent().label}, ${roomCurrent().detail}`}
          >
            <span class="shell-room-current__kicker">Room current</span>
            <span class="shell-room-current__label">{roomCurrent().label}</span>
            <span class="shell-room-current__detail">{roomCurrent().detail}</span>
            <button
              ref={(element) => { contextTriggerRef = element; }}
              type="button"
              class="shell-room-current__context"
              aria-expanded={contextRailOpen()}
              aria-controls="shell-context-rail"
              onClick={() => setContextRailOpen((open) => !open)}
            >
              Context
            </button>
          </div>
          <Show
            when={primarySurface() === 'calls'}
            fallback={(
              <>
                {/* Discord Stages-class strip (B13) — self-gates per active channel. */}
                <StagePanel />
                {/* Keep the stage mounted for the whole in-call surface. Gating
                    on callStartedAt made provisional re-joins look broken. */}
                <Show when={viewingCall()}>
                  <Suspense
                    fallback={
                      <div
                        class="voice-stage voice-stage--audio voice-stage--size-compact"
                        aria-label="Voice call participants"
                        role="region"
                        data-testid="voice-stage-loading"
                      >
                        <p role="status">Starting call…</p>
                      </div>
                    }
                  >
                    <VoiceStage />
                  </Suspense>
                </Show>
                <DmSafetySheet />
                <GuestClaimPrompt />
                <DmKeyChangeBanner />
                <Show when={preferences().timeScrubber && !inCall()}>
                  <TimeScrubber />
                </Show>
                <Show when={preferences().watchTogether && !inCall()}>
                  <WatchTogetherActivity />
                </Show>

                {/* Content: read-only status buffer, conversation, or home */}
                <Show when={activeView().kind === 'status'} fallback={
                <Show
                  when={hasConversation()}
                  fallback={<HomeView />}
                >
                  <MessageView selfNick={displayNick()} />
                  <Show when={inCall()}>
                    <Suspense fallback={null}>
                      <VoiceBar />
                    </Suspense>
                  </Show>
                  <TypingIndicator />
                  <Composer />
                </Show>
                }>
                  <div class="shell-status-stack" data-testid="status-stack">
                    <Show when={preferences().experienceMode !== 'standard'}>
                      <CapabilityMatrixSection />
                    </Show>
                    <MessageView selfNick={displayNick()} />
                  </div>
                </Show>
                {/* Search Center is global on every conversation surface. */}
                <MessageSearch />
              </>
            )}
          >
            <CallsHub
              callState={voice().callState}
              callChannel={voice().callChannel}
              callWith={voice().callWith}
              callStartedAt={voice().callStartedAt}
              onOpenRooms={openRoomsFromCalls}
              onReturnToCall={returnToCall}
            />
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
        <MemberList
          hidden={asideOccupant() !== 'members'}
          modal={isMobile()}
          onClose={closeMobileMembers}
          onOpenDm={openMemberDm}
          onOpenWhois={openMemberWhois}
        />
        <ContextRail open={asideOccupant() === 'context'} onClose={closeContextRail} />
      </div>

      {/* Mobile bottom tab bar — the same product-frame navigation as the
          desktop sidebar. The account dialog is transient, so You exposes
          expanded state without becoming the current location. */}
      <PrimaryNavigation
        variant="mobile"
        currentSection={activeSection()}
        selectedCollection={sidebarMode()}
        expandedCollection={mobileSidebarOpen() ? sidebarMode() : null}
        youDialogOpen={showAccount()}
        moreOpen={mobileMoreOpen()}
        onOpenMore={openMobileMore}
        mobileRoomsButtonRef={(element) => { mobileRoomsButtonRef = element; }}
        mobileMenuButtonRef={(element) => { mobileMenuButtonRef = element; }}
        onSelect={handlePrimaryNavigation}
      />
      <Show when={mobileMoreOpen()}>
        <div class="shell-mobile-more-backdrop" aria-hidden="true" onClick={closeMobileMore} />
      </Show>
      <div
        ref={(element) => { mobileMoreRef = element; }}
        class={`shell-mobile-more-sheet${mobileMoreOpen() ? ' shell-mobile-more-sheet--open' : ''}${mobileMoreView() === 'room-controls' ? ' shell-mobile-more-sheet--room-controls' : ''}`}
        role={mobileMoreOpen() ? 'dialog' : undefined}
        aria-modal={mobileMoreOpen() ? 'true' : undefined}
        aria-label={mobileMoreOpen() ? mobileMoreDialogLabel() : undefined}
        tabindex={mobileMoreOpen() ? -1 : undefined}
      >
        <Show
          when={mobileMoreView() === 'destinations'}
          fallback={(
            <Show when={activeView().kind === 'channel'}>
              <section class="shell-mobile-more-sheet__room-tools" aria-label="Room control desk">
                <header class="shell-mobile-more-sheet__room-head">
                  <button
                    ref={(element) => { mobileRoomControlsBackRef = element; }}
                    type="button"
                    class="shell-mobile-more-sheet__back"
                    onClick={returnToMobileMore}
                  >Back</button>
                  <div>
                    <p class="shell-mobile-more-sheet__title">Room control desk</p>
                    <div class="shell-mobile-more-sheet__room-title">
                      <h2>{(activeView() as { channel: string }).channel}</h2>
                      <Show when={/^[#&]/.test((activeView() as { channel: string }).channel.trim())}>
                        <a
                          class="shell-mobile-more-sheet__ledger shell-ribbon-stats"
                          href={statsRoomHref((activeView() as { channel: string }).channel)}
                          aria-label={`Room ledger for ${(activeView() as { channel: string }).channel}`}
                          data-testid="mobile-room-ledger"
                        >
                          Ledger
                        </a>
                      </Show>
                    </div>
                  </div>
                  <button type="button" class="shell-mobile-more-sheet__close" onClick={closeMobileMore}>Close</button>
                </header>
                <RoomInsightsStrip />
                <ModerationCockpit channel={(activeView() as { channel: string }).channel} />
                <Show when={preferences().experienceMode === 'network-ops' && isOper()}>
                  <OperEventConsole />
                </Show>
                <Show when={preferences().experienceMode === 'network-ops' && !isOper()}>
                  <p class="shell-context-rail__empty" role="status">Operator tools appear here after this account is granted access.</p>
                </Show>
              </section>
            </Show>
          )}
        >
          <p class="shell-mobile-more-sheet__title">Menu</p>
          <Show when={activeView().kind === 'channel' && preferences().experienceMode !== 'standard'}>
            <button
              ref={(element) => { mobileRoomControlsLauncherRef = element; }}
              type="button"
              class="shell-mobile-more-sheet__room-launcher"
              onClick={openMobileRoomControls}
            >
              <span aria-hidden="true">#</span>
              <span>Room control desk</span>
              <small>{(activeView() as { channel: string }).channel}</small>
            </button>
          </Show>
          <p class="shell-mobile-more-sheet__group-label">Navigate</p>
          <button type="button" onClick={() => selectMobileMore('calls')}>Calls</button>
          <p class="shell-mobile-more-sheet__group-label">You</p>
          <button
            type="button"
            aria-label="You — account, appearance, and preferences"
            onClick={() => selectMobileMore('you')}
          >
            You
          </button>
          <button type="button" onClick={closeMobileMore}>Close</button>
        </Show>
      </div>

      {/* Account management panel — portal modal, gated on store.showAccount */}
      <Show when={showAccount()}>
        <LazySurface label="account settings" onClose={() => getState().closeAccount()}>
          <AccountPanel
            open
            onOpenChange={(open) => (open ? getState().openAccount() : getState().closeAccount())}
          />
        </LazySurface>
      </Show>

      {/* Appearance panel — theme + background, gated on store.showAppearance */}
      <Show when={showAppearance()}>
        <LazySurface label="appearance settings" onClose={() => getState().closeAppearance()}>
          <AppearancePanel />
        </LazySurface>
      </Show>
      <Show when={useStore((s) => s.showChannelBrowser)()}>
        <ChannelBrowser />
      </Show>
      <Show when={showWhois()}>
        <WhoisSheet
          returnFocus={whoisReturnFocus()}
          returnFocusFallback={whoisReturnFocusFallback()}
          onClose={clearMemberWhoisReturnFocus}
        />
      </Show>

      {/* Preferences panel — display & behaviour, gated on isPreferencesOpen() */}
      <Show when={isPreferencesOpen()}>
        <LazySurface label="preferences" onClose={closePreferences}>
          <PreferencesPanel />
        </LazySurface>
      </Show>

      {/* Pinned messages drawer — gated on store.showPinnedMessages */}
      <Show when={showPinnedMessages()}>
        <LazySurface label="pinned messages" onClose={() => getState().closePinnedMessages()}>
          <PinnedMessages />
        </LazySurface>
      </Show>

      {/* Scheduled "send later" queue — gated on store.showScheduledMessages */}
      <Show when={showScheduledMessages()}>
        <LazySurface label="scheduled messages" onClose={() => getState().closeScheduledMessages()}>
          <ScheduledMessagesSheet />
        </LazySurface>
      </Show>

      {/* Jump-to-date sheet — Era 1 A3 discoverable travelTo control */}
      <Show when={showJumpToDate()}>
        <LazySurface label="jump to date" onClose={() => getState().closeJumpToDate()}>
          <JumpToDateSheet />
        </LazySurface>
      </Show>

      {/* Voice/video overlays — the whole cluster is lazy and only mounts once
          a call is signalled or the settings sheet opens; each still self-gates
          finer on store.voice. Keep this lazy cluster inside its own boundary:
          otherwise its first Edge load suspends the outer connected shell and
          removes both the conversation and the provisional in-flow stage. */}
      <Show when={voiceUiActive()}>
        <Suspense fallback={null}>
          <VoiceSettings
            open={showVoiceSettings()}
            onOpenChange={(open) => (open ? getState().openVoiceSettings() : getState().closeVoiceSettings())}
          />
          <VoicePip />
          <IncomingCallOverlay />
          <OutgoingCallOverlay />
          <CaptionsOverlay />
          <ReactionsOverlay />
        </Suspense>
      </Show>

      <RoomInviteShareHost />

      {/* Keyboard shortcuts help overlay — opened with "?" or Home shortcuts action */}
      <Show when={showKeyboardShortcuts()}>
        <LazySurface label="keyboard shortcuts" onClose={() => getState().closeKeyboardShortcuts()}>
          <ShortcutsOverlay open onClose={() => getState().closeKeyboardShortcuts()} />
        </LazySurface>
      </Show>
    </>
  );
}
