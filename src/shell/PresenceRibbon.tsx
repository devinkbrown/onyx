// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PresenceRibbon.tsx — commercial room header (conversation column).
 *
 * Four-zone place header (docs/COMMERCIAL_UI_SYSTEM.md):
 *   Z1 Identity — name · topic · secondary heatline/facepile (facepile desktop-only)
 *   Z2 Place    — event · voice occupancy · Call lifecycle control
 *   Z3 People   — roster toggle + count (always on channel, incl. 0)
 *   Z4 Edge     — Search · Inbox · More · connection (conn never display:none)
 *
 * More is grouped (Alerts · This room|Conversation · You), not a junk drawer.
 * Jump-to-date lives in More (This room / Conversation). Call presentation reuses
 * pure classifyCallsHubPresentation — no auto-join, no accept/decline in the ribbon.
 * People aria-pressed uses membersOpen (AppShell membersVisible). Persistence deferred.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; For/Show;
 * store reads via useStore; snapshots via getState() in handlers.
 */

import { createEffect, createMemo, createSignal, lazy, onCleanup, Show, splitProps, Suspense, type JSX } from 'solid-js';
import { useStore, getState, selectAccount, selectChannelEvent, selectChannelPins } from '@/lib/store';
import { openPreferences, preferences } from '@/lib/prefs/preferences';
import { channelNotifyMode } from '@/lib/notifications/channelNotifyMode';
import { eventCountdown, scheduledEventVisible, scheduledEventsEqual } from '@/lib/notifications/scheduledEvents';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { isConsumerStewardshipRoom } from '@/lib/rooms/roomStewardship';
import { Popover } from '@/primitives/index';
const ChannelSettings = lazy(() => import('./ChannelSettings').then((m) => ({ default: m.ChannelSettings })));
import { RoomMediaIndex } from './RoomMediaIndex';
import { openRoomInviteShare } from './roomInviteShareState';
import { openRoomStewardship } from './roomStewardshipState';
import { openCloseConversationConfirm, openLeaveRoomConfirm } from './roomVerbConfirm';
import { ROOM_VERB_COPY } from '@/lib/roomListVerbs';
import { ChannelNotifyControl } from './ChannelNotifyControl';
import { NotificationCenter } from './NotificationCenter';
import { PresenceHeatline } from './PresenceHeatline';
import { Facepile } from './Facepile';
import { facepileInputsFromUsers } from './facepile';
import { AiPolicyBadge } from './AiPolicyBadge';
import { GroupControlRoomIndicator } from './GroupControlRoomIndicator';
import { selectGroupControlRoom } from '@/lib/e2ee/groupControlSelectors';
import { isMessageSearchOpen, openMessageSearch } from './search/useMessageSearch';
import {
  DM_PRIVATE_CHIP,
  DM_PRIVATE_CHIP_LABEL,
  DM_VERIFY_ACTION,
  showDmPrivateChip,
} from '@/lib/e2ee/dmPrivacyChrome';
import type { AiPolicy } from '@/lib/irc/aiPolicyProp';
import type { Channel } from '@/lib/irc/types';
import { openDmSafetySheet } from './dmSafetySheetOpen';
import './PresenceRibbon.css';

type CallsHubPresentation = 'idle' | 'ringing_in' | 'ringing_out' | 'provisional' | 'established';

function classifyCallsHubPresentation(callState: string, callStartedAt: number | null): CallsHubPresentation {
  if (callState === 'ringing_in') return 'ringing_in';
  if (callState === 'ringing_out') return 'ringing_out';
  if (callState !== 'in_call') return 'idle';
  return callStartedAt == null ? 'provisional' : 'established';
}

export type PresenceRibbonProps = {
  selfNick?: string;
  onToggleMembers?: () => void;
  /**
   * True when the member surface is actually open for this room — desktop
   * column or mobile drawer. AppShell should pass `membersVisible()`.
   * Must be false with zero roster (no member surface can open).
   */
  membersOpen?: boolean;
  showJoinVoice?: boolean;
  onJoinVoice?: (withVideo: boolean) => void;
  /** Mobile overflow is room-contextual; You / Calls live on the bottom nav. */
  contextActionsOnly?: boolean;
  /** Advanced / network-ops room desk — never a default-path tab. */
  onOpenRoomDesk?: () => void;
  onOpenDm?: (nick: string) => void;
  onOpenWhois?: (nick: string, returnFocus: HTMLElement) => void;
};

export type VoiceRoomStatusInput = {
  participants: readonly string[];
  speakingNicks: ReadonlySet<string>;
  mutedNicks: ReadonlySet<string>;
  raisedHands: ReadonlySet<string>;
  currentCall: boolean;
  localMuted: boolean;
  localDeafened: boolean;
  localCameraOn: boolean;
  localScreenshareActive: boolean;
  localCaptionsEnabled: boolean;
};

export type VoiceRoomStatus = {
  label: string;
  ariaStatus: string;
};

type ChannelWithAiPolicy = Channel & { aiPolicy?: AiPolicy };

export function buildVoiceRoomStatus(input: VoiceRoomStatusInput): VoiceRoomStatus {
  // MEDIA roster entries retain display casing, while event-plane state can use
  // a different casing (and speakingNicks is intentionally stored lowercase).
  // Compare in one normalized keyspace but return the roster's display names.
  const speakingKeys = new Set([...input.speakingNicks].map((nick) => nick.toLowerCase()));
  const raisedKeys = new Set([...input.raisedHands].map((nick) => nick.toLowerCase()));
  const mutedKeys = new Set([...input.mutedNicks].map((nick) => nick.toLowerCase()));
  const speakers = input.participants.filter((nick) => speakingKeys.has(nick.toLowerCase()));
  const raised = input.participants.filter((nick) => raisedKeys.has(nick.toLowerCase()));
  const mutedPeers = input.participants.filter((nick) => mutedKeys.has(nick.toLowerCase()));
  const labelParts: string[] = [];
  const ariaParts: string[] = [];

  if (speakers.length === 1) {
    labelParts.push(`${speakers[0]} speaking`);
    ariaParts.push(`${speakers[0]} is speaking`);
  } else if (speakers.length > 1) {
    labelParts.push(`${speakers.length} speaking`);
    ariaParts.push(`${speakers.length} people are speaking`);
  } else if (raised.length === 1) {
    labelParts.push(`${raised[0]} raised`);
    ariaParts.push(`${raised[0]} has a hand raised`);
  } else if (raised.length > 1) {
    labelParts.push(`${raised.length} raised`);
    ariaParts.push(`${raised.length} people have hands raised`);
  } else if (input.currentCall) {
    labelParts.push('listening');
    ariaParts.push('you are listening');
  }

  const localHealth: Array<{ label: string; aria: string }> = [];
  if (input.localMuted) localHealth.push({ label: 'muted', aria: 'your microphone is muted' });
  if (input.localDeafened) localHealth.push({ label: 'deafened', aria: 'you are deafened' });
  if (input.localScreenshareActive) localHealth.push({ label: 'sharing', aria: 'you are sharing your screen' });
  if (input.localCameraOn) localHealth.push({ label: 'video', aria: 'your camera is on' });
  if (input.localCaptionsEnabled) localHealth.push({ label: 'captions', aria: 'captions are on' });

  if (input.currentCall && localHealth.length > 0) {
    const visibleHealth = localHealth.slice(0, 2);
    const hidden = localHealth.length - visibleHealth.length;
    labelParts.push(
      hidden > 0
        ? `${visibleHealth.map((part) => part.label).join(', ')} +${hidden}`
        : visibleHealth.map((part) => part.label).join(', '),
    );
    ariaParts.push(...localHealth.map((part) => part.aria));
  } else if (!input.currentCall && mutedPeers.length > 0 && speakers.length === 0 && raised.length === 0) {
    labelParts.push(`${mutedPeers.length} muted`);
    ariaParts.push(`${mutedPeers.length} ${mutedPeers.length === 1 ? 'person is' : 'people are'} muted`);
  }

  return {
    label: labelParts.join(' · '),
    ariaStatus: ariaParts.join(', '),
  };
}

export function PresenceRibbon(props: PresenceRibbonProps): JSX.Element {
  const [local] = splitProps(props, [
    'selfNick',
    'onToggleMembers',
    'membersOpen',
    'showJoinVoice',
    'onJoinVoice',
    'contextActionsOnly',
    'onOpenRoomDesk',
    'onOpenDm',
    'onOpenWhois',
  ]);

  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const peerDmKeys = useStore((s) => s.peerDmKeys);
  const peerDmDeviceKeys = useStore((s) => s.peerDmDeviceKeys);
  const peerKeyChanges = useStore((s) => s.peerKeyChanges);
  // Fallback only when AppShell does not pass membersOpen (unit hosts).
  const showMemberList = useStore((s) => s.showMemberList);
  // selectChannelEvent parses the prop into a fresh object each call; without a
  // value-equality fn this signal (and its four countdown memos) would re-fire on
  // every unrelated store mutation whenever the active channel has an event set.
  const scheduledEvent = useStore((s) => {
    const view = s.activeView;
    return view.kind === 'channel' ? selectChannelEvent(view.channel)(s) : null;
  }, scheduledEventsEqual);
  const account = useStore(selectAccount);
  // This is a public, metadata-only snapshot. The mutable runtime, controls,
  // identity tuple, and cryptographic material remain outside the UI store.
  const groupControlRuntime = useStore((s) => s.groupControlRuntime);
  const voice = useStore((s) => s.voice);
  const contextActionsLabel = createMemo(() => (
    activeView().kind === 'channel' ? 'Room actions' : 'Conversation actions'
  ));
  const voiceChannelParticipants = useStore((s) => s.voiceChannelParticipants);
  const speakingNicks = useStore((s) => s.speakingNicks);
  const mutedNicks = useStore((s) => s.mutedNicks);
  const channelNotify = useStore((s) => s.channelNotify);
  const hiddenRooms = useStore((s) => s.hiddenRooms);
  const mutedDMs = useStore((s) => s.mutedDMs);
  const [now, setNow] = createSignal(Date.now());
  // Alerts are silenced by manual DND, a timed snooze, or the quiet-hours window.
  const dndEnabled = useStore((s) => s.dndEnabled);
  const dndUntil = useStore((s) => s.dndUntil);
  const dndQuietStart = useStore((s) => s.dndQuietStart);
  const dndQuietEnd = useStore((s) => s.dndQuietEnd);
  const dndActive = createMemo(() => {
    void dndQuietStart();
    void dndQuietEnd();
    void now();
    if (dndEnabled()) return true;
    const until = dndUntil();
    if (until != null && until > now()) return true;
    return getState().isDndActive();
  });

  // ── derived ──
  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel) ?? null;
  });
  const hasContextActions = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return activeChannel() !== null;
    if (view.kind === 'dm') return dms().has(view.nick.toLowerCase());
    return false;
  });

  const channelHasUnread = createMemo(
    () => (activeChannel()?.unread ?? 0) > 0 || (activeChannel()?.highlights ?? 0) > 0,
  );

  // The channel object gets a fresh identity on every message (the store spreads
  // {...c, messages:[...]} on append), but its `users` map identity is preserved
  // across message-only updates. Roster-shaped derivations key on these two memos
  // so they only recompute on real membership/name changes — not per chat line.
  const activeUsers = createMemo(() => activeChannel()?.users ?? null);
  const activeChannelName = createMemo(() => activeChannel()?.name ?? null);

  const channelName = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    if (view.kind === 'status') return 'Activity';
    return null;
  });

  const dmPrivateChip = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'dm') return false;
    return showDmPrivateChip({
      peerDmKeys: peerDmKeys(),
      peerDmDeviceKeys: peerDmDeviceKeys(),
      peerKeyChanges: peerKeyChanges(),
    }, view.nick);
  });

  const pinCount = useStore((s) => {
    const view = s.activeView;
    return view.kind === 'channel' ? selectChannelPins(view.channel)(s).length : 0;
  });

  const topic = createMemo(() => {
    const ch = activeChannel();
    if (ch) return ch.topic || null;
    return null;
  });

  const aiPolicy = createMemo(() => {
    const ch = activeChannel() as ChannelWithAiPolicy | null;
    return ch?.aiPolicy ?? 'open';
  });

  const memberCount = createMemo(() => {
    const ch = activeChannel();
    return ch ? ch.users.size : 0;
  });

  /**
   * People `aria-expanded` tracks the *actual* open surface (desktop column or
   * mobile drawer). AppShell passes `membersVisible()` via membersOpen. This
   * must mirror the real surface state regardless of roster size — a channel
   * whose roster hasn't landed yet (JOIN before the 353 NAMES burst) can still
   * open the member drawer, and the trigger must not lie about that.
   */
  const membersExpanded = createMemo(() => {
    if (local.membersOpen !== undefined) return !!local.membersOpen;
    return !!showMemberList();
  });

  // Facepile roster — adapts the channel's user map into the pure facepile inputs.
  // Keyed on the stable users identity so it survives message-only appends.
  const facepileMembers = createMemo(() => {
    const users = activeUsers();
    return users ? facepileInputsFromUsers(users.values()) : [];
  });

  // Active channel name for the settings panel (display-cased, e.g. "#general").
  const settingsChannel = createMemo(() => activeChannel()?.name ?? null);
  // Keep the compact status room-local. A missing projection is intentionally
  // silent rather than an invented encryption or recovery state.
  const groupControlRoom = createMemo(() => {
    const room = settingsChannel();
    const runtime = groupControlRuntime();
    if (!room || !runtime || !account()) return null;
    return selectGroupControlRoom(runtime, room) ? room : null;
  });
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [mediaIndexOpen, setMediaIndexOpen] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);
  let moreMenuRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (local.contextActionsOnly && !hasContextActions()) setMoreOpen(false);
  });

  const connLabel = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return 'Connected';
    if (s === 'reconnecting') return 'Reconnecting…';
    if (s === 'connecting') return 'Connecting…';
    return 'Disconnected';
  });

  const voiceParticipants = createMemo(() => {
    const name = activeChannelName();
    const users = activeUsers();
    if (!name || !users) return [];
    const roster = voiceChannelParticipants().get(name.toLowerCase());
    if (!roster) return [];

    const seen = new Set<string>();
    const present: string[] = [];
    for (const nick of roster) {
      const lower = nick.toLowerCase();
      if (seen.has(lower)) continue;
      if (users.size > 0 && !users.has(lower)) continue;
      seen.add(lower);
      present.push(nick);
    }
    return present.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  });

  const voiceCount = createMemo(() => voiceParticipants().length);

  /**
   * True while this room's media session is `in_call` (provisional or established).
   * Drives local device health on the occupancy chip and "current call" aria —
   * not the established paint mark (see establishedRoomCall).
   */
  const currentVoiceCall = createMemo(() => {
    const channel = settingsChannel();
    const v = voice();
    return !!channel
      && v.callChannel?.toLowerCase() === channel.toLowerCase()
      && v.callState === 'in_call';
  });

  /** Established only (callStartedAt set) — occupancy chip active mark / In call seal. */
  const establishedRoomCall = createMemo(() => {
    const channel = settingsChannel();
    const v = voice();
    return !!channel
      && v.callChannel?.toLowerCase() === channel.toLowerCase()
      && classifyCallsHubPresentation(v.callState, v.callStartedAt) === 'established';
  });

  /**
   * Call lifecycle for this room only. Ringing/provisional/established elsewhere
   * must not paint fake local established state on the ribbon.
   */
  const roomCallPresentation = createMemo((): CallsHubPresentation => {
    const channel = settingsChannel();
    const v = voice();
    const presentation = classifyCallsHubPresentation(v.callState, v.callStartedAt);
    if (presentation === 'idle') return 'idle';
    if (!channel) return 'idle';
    if (v.callChannel?.toLowerCase() === channel.toLowerCase()) return presentation;
    return 'idle';
  });

  const showCallJoin = createMemo(
    () => !!local.showJoinVoice && !!local.onJoinVoice && roomCallPresentation() === 'idle',
  );
  /** Pref-hidden Call still has to be one click away — More, not Advanced. */
  const showCallJoinInMore = createMemo(
    () => !!local.onJoinVoice
      && !showCallJoin()
      && roomCallPresentation() === 'idle'
      && activeView().kind === 'channel',
  );

  const voiceRoomStatus = createMemo(() => buildVoiceRoomStatus({
    participants: voiceParticipants(),
    speakingNicks: speakingNicks(),
    mutedNicks: mutedNicks(),
    raisedHands: voice().raisedHands,
    currentCall: currentVoiceCall(),
    localMuted: voice().muted,
    localDeafened: voice().deafened,
    localCameraOn: voice().cameraOn,
    localScreenshareActive: voice().screenshareActive,
    localCaptionsEnabled: voice().captionsEnabled,
  }));

  const ribbonEvent = createMemo(() => {
    const event = scheduledEvent();
    if (!event || !scheduledEventVisible(event, now())) return null;
    return event;
  });

  // The ribbon is mounted for Home, status, DMs, and ordinary channels, but its
  // clock serves only an active room event. Refresh immediately on a view/event
  // revision so a timer-free idle period cannot leave the first countdown stale,
  // then retain one clock only until that event's grace window closes.
  createEffect(() => {
    const view = activeView();
    const event = scheduledEvent();
    if (view.kind !== 'channel' || !event) return;

    const refresh = (): boolean => {
      const currentNow = Date.now();
      setNow(currentNow);
      return scheduledEventVisible(event, currentNow);
    };
    if (!refresh()) return;

    const timer = setInterval(() => {
      if (!refresh()) clearInterval(timer);
    }, 30_000);
    onCleanup(() => clearInterval(timer));
  });

  const ribbonEventLive = createMemo(() => {
    const event = ribbonEvent();
    return !!event && now() >= event.at * 1000;
  });

  const ribbonEventCountdown = createMemo(() => {
    const event = ribbonEvent();
    return event ? eventCountdown(event, now()) : '';
  });

  const ribbonEventLabel = createMemo(() => {
    const event = ribbonEvent();
    if (!event) return '';
    return `Event: ${event.title} · ${ribbonEventCountdown()}`;
  });

  const ribbonEventAria = createMemo(() => {
    const channel = settingsChannel();
    const event = ribbonEvent();
    if (!channel || !event) return 'Scheduled room event';
    return `Scheduled room event in ${channel}: ${event.title}, ${eventCountdown(event, now())}; open event moment`;
  });

  const voiceChipLabel = createMemo(() => {
    const count = voiceCount();
    const status = voiceRoomStatus().label;
    return status ? `${count} in voice · ${status}` : `${count} in voice`;
  });

  const voiceChipAria = createMemo(() => {
    const channel = settingsChannel();
    const count = voiceCount();
    const noun = count === 1 ? 'person' : 'people';
    const status = voiceRoomStatus().ariaStatus;
    const statusText = status ? `, ${status}` : '';
    if (currentVoiceCall()) return `${count} ${noun} in voice in ${channel}, current call${statusText}`;
    return `${count} ${noun} in voice in ${channel}${statusText}; join voice`;
  });

  function handleMembersClick(): void {
    if (local.onToggleMembers) {
      local.onToggleMembers();
    } else {
      getState().toggleMemberList();
    }
  }

  function handleVoiceChipClick(): void {
    const channel = settingsChannel();
    if (!channel || voiceCount() === 0) return;
    const state = getState();
    if (state.voice.callState === 'in_call' && state.voice.callChannel?.toLowerCase() === channel.toLowerCase()) {
      return;
    }
    void state.joinVoiceChannel(channel, false);
  }

  function handleEventChipClick(): void {
    const channel = settingsChannel();
    const event = ribbonEvent();
    if (!channel || !event) return;
    void getState().travelTo(channel, new Date(event.at * 1000));
  }

  function closeMoreThen(action: () => void): void {
    setMoreOpen(false);
    action();
  }

  function moreMenuItems(): HTMLElement[] {
    if (!moreMenuRef) return [];
    // Multiple section menus share one roving set across the More panel.
    return Array.from(moreMenuRef.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  function focusMoreMenuItem(index: number): void {
    const items = moreMenuItems();
    if (items.length === 0) return;
    const clamped = ((index % items.length) + items.length) % items.length;
    items[clamped]?.focus();
  }

  function onMoreMenuKeyDown(event: KeyboardEvent): void {
    const items = moreMenuItems();
    if (items.length === 0) return;
    const current = items.indexOf(event.currentTarget as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusMoreMenuItem(current < 0 ? 0 : current + 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      focusMoreMenuItem(current < 0 ? items.length - 1 : current - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusMoreMenuItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusMoreMenuItem(items.length - 1);
    }
  }

  /** Jump to date lives in More (This room / Conversation), one click → sheet. */
  const jumpDateMenuItem = (ariaLabel: string): JSX.Element => (
    <button
      type="button"
      class="shell-ribbon-more-item"
      role="menuitem"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      title="Jump to date"
      data-testid="ribbon-jump-to-date"
      onClick={() => closeMoreThen(() => getState().openJumpToDate())}
      onKeyDown={onMoreMenuKeyDown}
    >
      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 11h18" />
        <path d="M12 15v2.5M12 15l2 1.2" />
      </svg>
      <span>Jump to date</span>
    </button>
  );

  return (
    <header class="shell-ribbon" role="banner" aria-label="Room information">
      {/* Inner row shares the conversation reading measure so the title and
          place strip stay aligned to the conversation column chrome. */}
      <div class="shell-ribbon-inner presence-ribbon-surface">
      {/* ── LEFT: conversation identity (what you're looking at) ── */}
      <div class="shell-ribbon-identity">
        <Show when={channelName()} fallback={
          <span class="sr-only">Home</span>
        }>
          {(name) => (
            <button
              type="button"
              class="shell-ribbon-channel shell-ribbon-channel-btn"
              data-testid="ribbon-copy-name"
              title="Click to copy name"
              aria-label={
                activeView().kind === 'channel'
                  ? `Room ${name()}. Click to copy name.`
                  : activeView().kind === 'dm'
                    ? `Direct message ${name()}. Click to copy name.`
                    : `${name()}. Click to copy.`
              }
              onClick={() => {
                const label = name();
                void writeClipboardText(label).then((ok) => {
                  getState().addToast({
                    variant: ok ? 'success' : 'warning',
                    title: ok ? 'Copied' : 'Could not copy',
                    description: ok
                      ? `${label} is on the clipboard.`
                      : 'Clipboard access was denied in this browser.',
                  });
                });
              }}
            >
              <Show when={activeView().kind === 'channel'}>
                <span class="shell-ribbon-sigil" aria-hidden="true">#</span>
              </Show>
              <Show when={activeView().kind === 'dm'}>
                <span class="shell-ribbon-sigil shell-ribbon-sigil--dm" aria-hidden="true">@</span>
              </Show>
              <Show when={activeView().kind === 'status'}>
                <span class="shell-ribbon-sigil shell-ribbon-sigil--status" aria-hidden="true">✦</span>
              </Show>
              {activeView().kind === 'channel'
                ? name().replace(/^#/, '')
                : name()}
            </button>
          )}
        </Show>

        <Show when={activeView().kind === 'dm' && dmPrivateChip()}>
          <span
            class="shell-ribbon-private-chip"
            data-testid="ribbon-dm-private"
            aria-label={DM_PRIVATE_CHIP_LABEL}
          >
            {DM_PRIVATE_CHIP}
          </span>
        </Show>

        {/* Topic flows after the name on the same baseline, taking the slack. */}
        <Show when={topic()}>
          {(t) => (
            <>
              <span class="shell-ribbon-sep" aria-hidden="true" />
              <p class="shell-ribbon-topic" title={t()}>
                {t()}
              </p>
            </>
          )}
        </Show>

        {/* Live 24h activity rhythm — power-user chrome, not first-run. */}
        <Show when={activeView().kind === 'channel' && preferences().experienceMode !== 'standard'}>
          <PresenceHeatline channel={() => (activeView().kind === 'channel' ? channelName() : null)} />
        </Show>

        {/* Presence-as-place secondary: desktop facepile only (CSS hides on narrow). */}
        <Show when={activeView().kind === 'channel'}>
          <div class="shell-ribbon-facepile">
            <Facepile
              members={facepileMembers}
              onOpenDm={local.onOpenDm}
              onOpenWhois={local.onOpenWhois}
            />
          </div>
        </Show>
      </div>

      {/* ── RIGHT: Z2 Place · Z3 People · Z4 Edge (commercial sparse chrome) ── */}
      <div class="shell-ribbon-right">
        <Show when={activeView().kind === 'dm'}>
          <div class="shell-ribbon-group" role="group" aria-label="Conversation privacy">
            <button
              type="button"
              class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-verify"
              data-testid="ribbon-dm-verify"
              aria-label={`Verify safety number with ${channelName()}`}
              onClick={() => openDmSafetySheet()}
            >
              <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3 19 6v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3Z" />
                <path d="m9.3 12 1.8 1.8 3.8-4" />
              </svg>
              <span class="shell-ribbon-action-label">{DM_VERIFY_ACTION}</span>
            </button>
          </div>
          <span class="shell-ribbon-divider" aria-hidden="true" />
        </Show>
        {/* Z2 Place — event · voice occupancy · Call lifecycle (channels only). */}
        <Show when={activeView().kind === 'channel'}>
          <div class="shell-ribbon-group" role="group" aria-label="Place">
            <Show when={ribbonEvent()}>
              <button
                type="button"
                class="shell-ribbon-event-chip"
                classList={{ 'shell-ribbon-event-chip--live': ribbonEventLive() }}
                aria-label={ribbonEventAria()}
                title={ribbonEventLabel()}
                onClick={handleEventChipClick}
              >
                <span class="shell-ribbon-event-mark" aria-hidden="true" />
                <span class="shell-ribbon-event-text shell-ribbon-event-text--full" aria-hidden="true">
                  <span class="shell-ribbon-event-title">Event: {ribbonEvent()?.title}</span>
                  <span class="shell-ribbon-event-countdown"> · {ribbonEventCountdown()}</span>
                </span>
                <span class="shell-ribbon-event-text shell-ribbon-event-text--compact" aria-hidden="true">
                  <span class="shell-ribbon-event-title">Event</span>
                  <span class="shell-ribbon-event-countdown"> · {ribbonEventCountdown()}</span>
                </span>
              </button>
            </Show>
            <Show when={voiceCount() > 0}>
              <button
                type="button"
                class="shell-ribbon-voice-chip"
                classList={{ 'shell-ribbon-voice-chip--active': establishedRoomCall() }}
                aria-label={voiceChipAria()}
                title={[voiceParticipants().join(', '), voiceRoomStatus().label].filter(Boolean).join(' · ')}
                onClick={handleVoiceChipClick}
              >
                <span class="shell-ribbon-voice-mark" aria-hidden="true" />
                <span class="shell-ribbon-voice-text">{voiceChipLabel()}</span>
              </button>
            </Show>
            {/* Ringing / provisional — sparse status only; overlays own accept. */}
            <Show when={roomCallPresentation() === 'ringing_in'}>
              <span
                class="shell-ribbon-call-status"
                data-testid="ribbon-call-status"
                data-presentation="ringing_in"
                aria-live="polite"
              >
                Incoming
              </span>
            </Show>
            <Show when={roomCallPresentation() === 'ringing_out'}>
              <span
                class="shell-ribbon-call-status"
                data-testid="ribbon-call-status"
                data-presentation="ringing_out"
                aria-live="polite"
              >
                Calling
              </span>
            </Show>
            <Show when={roomCallPresentation() === 'provisional'}>
              <span
                class="shell-ribbon-call-status shell-ribbon-call-status--provisional"
                data-testid="ribbon-call-status"
                data-presentation="provisional"
                aria-live="polite"
              >
                Connecting…
              </span>
            </Show>
            <Show when={roomCallPresentation() === 'established' && voiceCount() === 0}>
              <span
                class="shell-ribbon-voice-chip shell-ribbon-voice-chip--active shell-ribbon-call-status"
                data-testid="ribbon-call-status"
                data-presentation="established"
                aria-live="polite"
              >
                <span class="shell-ribbon-voice-mark" aria-hidden="true" />
                <span class="shell-ribbon-voice-text">In call</span>
              </span>
            </Show>
            {/* Idle join — one Call control; camera lives on the in-call bar. */}
            <Show when={showCallJoin()}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-call"
                aria-label="Join call"
                title="Join call"
                data-testid="ribbon-join-call"
                onClick={() => local.onJoinVoice?.(false)}
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
                  <path d="M4 14h3v6H4a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z" />
                  <path d="M20 14h-3v6h3a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z" />
                  <path d="M15 9.5 19 7v6l-4-2.5" />
                </svg>
                <span class="shell-ribbon-action-label">{voiceCount() > 0 ? 'Join call' : 'Call'}</span>
              </button>
            </Show>
            <Show when={groupControlRoom()}>
              {(room) => (
                <GroupControlRoomIndicator
                  room={room()}
                  authenticated={Boolean(account())}
                  projection={groupControlRuntime()}
                />
              )}
            </Show>
          </div>

          {/* Z3 People — always on channel, including zero members. */}
          <div class="shell-ribbon-group" role="group" aria-label="People">
            <button
              type="button"
              class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-members"
              aria-label={`${memberCount()} members — toggle member list`}
              aria-expanded={membersExpanded()}
              data-testid="ribbon-members"
              onClick={handleMembersClick}
            >
              <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
                <circle cx="10" cy="8" r="3" />
                <path d="M20 19v-1.4a3.4 3.4 0 0 0-2.6-3.3M15.5 5.2a3 3 0 0 1 0 5.6" />
              </svg>
              <span class="shell-ribbon-count">{memberCount()}</span>
              <span class="shell-ribbon-action-label">People</span>
            </button>
          </div>
          <span class="shell-ribbon-divider" aria-hidden="true" />
        </Show>

        {/* Z4 Edge — Search · Inbox · More · connection (Date lives in More). */}
        <div class="shell-ribbon-group" role="group" aria-label="Search">
          <button
            type="button"
            class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-search"
            aria-label="Search messages"
            aria-pressed={isMessageSearchOpen()}
            title="Search messages"
            data-testid="ribbon-search"
            onClick={() => openMessageSearch()}
          >
            <svg
              class="shell-ribbon-ico"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16.2 16.2 4.3 4.3" />
            </svg>
            <span class="shell-ribbon-action-label">Search</span>
          </button>
        </div>
        <div class="shell-ribbon-group" role="group" aria-label="Inbox">
          <NotificationCenter />
        </div>
        <Show when={!local.contextActionsOnly || hasContextActions()}>
          <span class="shell-ribbon-divider" aria-hidden="true" />
          <div
            class="shell-ribbon-group"
            role="group"
            aria-label={local.contextActionsOnly ? contextActionsLabel() : 'More'}
          >
            <Popover
            open={moreOpen()}
            onOpenChange={setMoreOpen}
            placement="bottom"
            panelLabel={local.contextActionsOnly ? contextActionsLabel() : 'More room and workspace actions'}
            trigger={
              <span
                class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-more-trigger"
                data-testid="ribbon-more"
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="currentColor">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
                <span class="sr-only">{local.contextActionsOnly ? contextActionsLabel() : 'More actions'}</span>
                <span class="shell-ribbon-action-label" aria-hidden="true">
                  {local.contextActionsOnly ? 'Actions' : 'More'}
                </span>
              </span>
            }
          >
            {/*
              Section headings are normal text outside role=menu, associated via
              aria-labelledby. Each menu only contains menuitem children (valid ARIA).
              Roving focus walks every menuitem under the panel root.
            */}
            <div
              class="shell-ribbon-more"
              data-testid="ribbon-more-menu"
              ref={(element) => {
                moreMenuRef = element;
                queueMicrotask(() => focusMoreMenuItem(0));
              }}
            >
              {/* Notify is a radiogroup — keep it outside role=menu. */}
              <Show when={activeView().kind === 'channel' && settingsChannel()}>
                {(name) => (
                  <div
                    class="shell-ribbon-more-section"
                    role="group"
                    data-testid="ribbon-more-channel"
                    aria-labelledby="ribbon-more-alerts-label"
                  >
                    <p id="ribbon-more-alerts-label" class="shell-ribbon-more-label">
                      Alerts
                    </p>
                    <ChannelNotifyControl channel={name()} class="shell-ribbon-more-notify" />
                    <Show when={aiPolicy() !== 'open'}>
                      <div class="shell-ribbon-more-ai" data-testid="ribbon-more-ai-policy">
                        <AiPolicyBadge policy={aiPolicy()} channel={name()} />
                      </div>
                    </Show>
                  </div>
                )}
              </Show>

              {/* This room — channel tools + Jump to date */}
              <Show when={activeView().kind === 'channel' && settingsChannel()}>
                <div
                  class="shell-ribbon-more-section"
                  role="group"
                  aria-labelledby="ribbon-more-room-label"
                >
                  <p id="ribbon-more-room-label" class="shell-ribbon-more-label">
                    This room
                  </p>
                  <div
                    class="shell-ribbon-more-list"
                    role="menu"
                    aria-labelledby="ribbon-more-room-label"
                  >
                    <Show when={showCallJoinInMore()}>
                      <button
                        type="button"
                        class="shell-ribbon-more-item"
                        role="menuitem"
                        aria-label="Join call"
                        data-testid="ribbon-more-join-call"
                        onClick={() => {
                          const join = local.onJoinVoice;
                          closeMoreThen(() => join?.(false));
                        }}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
                          <path d="M4 14h3v6H4a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z" />
                          <path d="M20 14h-3v6h3a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z" />
                          <path d="M15 9.5 19 7v6l-4-2.5" />
                        </svg>
                        <span>Join call</span>
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      aria-label={`Invite friends to ${settingsChannel()}`}
                      aria-haspopup="dialog"
                      data-testid="ribbon-invite-friends"
                      onClick={() => {
                        const channel = settingsChannel() ?? '';
                        closeMoreThen(() => openRoomInviteShare(channel));
                      }}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="8" r="3" />
                        <path d="M3 19a6 6 0 0 1 12 0" />
                        <path d="M17 8h4" />
                        <path d="M19 6v4" />
                      </svg>
                      <span>Invite friends</span>
                    </button>
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      aria-label={`Room settings for ${settingsChannel()}`}
                      aria-haspopup="dialog"
                      data-testid="ribbon-settings-gear"
                      onClick={() => closeMoreThen(() => setSettingsOpen(true))}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
                      </svg>
                      <span>Room settings</span>
                    </button>
                    <Show when={local.onOpenRoomDesk && preferences().experienceMode !== 'standard'}>
                      <button
                        type="button"
                        class="shell-ribbon-more-item"
                        role="menuitem"
                        aria-label={`Room control desk for ${settingsChannel()}`}
                        aria-haspopup="dialog"
                        data-testid="ribbon-room-desk"
                        onClick={() => {
                          const openRoomDesk = local.onOpenRoomDesk;
                          closeMoreThen(() => openRoomDesk?.());
                        }}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="4" y="5" width="16" height="14" rx="2" />
                          <path d="M8 9h8" />
                          <path d="M8 13h5" />
                        </svg>
                        <span>Room control desk</span>
                      </button>
                    </Show>
                    <Show when={isConsumerStewardshipRoom(activeUsers()?.size ?? 0)}>
                      <button
                        type="button"
                        class="shell-ribbon-more-item"
                        role="menuitem"
                        aria-label={`Room care for ${settingsChannel()}`}
                        aria-haspopup="dialog"
                        data-testid="ribbon-room-care"
                        onClick={() => {
                          const channel = settingsChannel() ?? '';
                          closeMoreThen(() => openRoomStewardship(channel));
                        }}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 4v4" />
                          <path d="M8 8h8" />
                          <path d="M7 20c0-3 2.2-5 5-5s5 2 5 5" />
                          <circle cx="12" cy="10" r="2.2" />
                        </svg>
                        <span>Room care</span>
                      </button>
                    </Show>
                    <a
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      href={statsRoomHref(settingsChannel()!)}
                      aria-label={`Room ledger for ${settingsChannel()}`}
                      data-testid="ribbon-channel-ledger"
                      onClick={() => setMoreOpen(false)}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 19V5" />
                        <path d="M4 19h16" />
                        <path d="M8 15v-4" />
                        <path d="M12 15V7" />
                        <path d="M16 15v-6" />
                      </svg>
                      <span>Room ledger</span>
                    </a>
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      data-testid="ribbon-mute-channel"
                      aria-label={
                        channelNotifyMode(channelNotify(), settingsChannel() ?? '') === 'mute'
                          ? `Unmute ${settingsChannel()}`
                          : `Mute ${settingsChannel()}`
                      }
                      onClick={() => {
                        const ch = settingsChannel();
                        closeMoreThen(() => {
                          if (!ch) return;
                          if (channelNotifyMode(getState().channelNotify, ch) === 'mute') {
                            getState().unmuteChannel(ch);
                          } else {
                            getState().muteChannel(ch);
                          }
                        });
                      }}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                        <path d="m22 9-6 6" />
                        <path d="m16 9 6 6" />
                      </svg>
                      <span>
                        {channelNotifyMode(channelNotify(), settingsChannel() ?? '') === 'mute'
                          ? ROOM_VERB_COPY.mute.unmuteLabel
                          : ROOM_VERB_COPY.mute.roomLabel}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="shell-ribbon-more-item shell-ribbon-more-item--verb"
                      role="menuitem"
                      data-testid="ribbon-hide-room"
                      aria-label={
                        hiddenRooms().has((settingsChannel() ?? '').toLowerCase())
                          ? `Show ${settingsChannel()}`
                          : `Hide ${settingsChannel()}`
                      }
                      onClick={() => {
                        const ch = settingsChannel();
                        closeMoreThen(() => {
                          if (!ch) return;
                          if (getState().isRoomHidden(ch)) {
                            getState().unhideRoom(ch);
                            getState().addToast({
                              variant: 'info',
                              title: ROOM_VERB_COPY.hide.showLabel,
                              description: 'This room is back on your list.',
                            });
                            return;
                          }
                          getState().hideRoom(ch);
                          getState().addToast({
                            variant: 'info',
                            title: ROOM_VERB_COPY.hide.label,
                            description: ROOM_VERB_COPY.hide.hint,
                          });
                        });
                      }}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
                        <circle cx="12" cy="12" r="2.5" />
                        <path d="M4 20 20 4" />
                      </svg>
                      <span>
                        {hiddenRooms().has((settingsChannel() ?? '').toLowerCase())
                          ? ROOM_VERB_COPY.hide.showLabel
                          : ROOM_VERB_COPY.hide.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="shell-ribbon-more-item shell-ribbon-more-item--verb shell-ribbon-more-item--leave"
                      role="menuitem"
                      data-testid="ribbon-leave-room"
                      aria-label={`Leave ${settingsChannel()}`}
                      onClick={() => {
                        const ch = settingsChannel();
                        closeMoreThen(() => {
                          if (!ch) return;
                          openLeaveRoomConfirm(ch);
                        });
                      }}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 6H5v12h4" />
                        <path d="M14 12H8" />
                        <path d="m16 8 4 4-4 4" />
                      </svg>
                      <span>{ROOM_VERB_COPY.leave.label}</span>
                    </button>
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      data-testid="ribbon-export-transcript"
                      aria-label={`Export local transcript for ${settingsChannel()}`}
                      onClick={() => {
                        const ch = settingsChannel();
                        closeMoreThen(() => {
                          if (!ch) return;
                          void import('@/lib/export/conversationExport').then(({
                            buildConversationExport,
                            downloadConversationExport,
                          }) => {
                            const state = getState();
                            const key = ch.toLowerCase();
                            const msgs = state.channels.get(key)?.messages ?? [];
                            const doc = buildConversationExport({
                              target: ch,
                              messages: msgs,
                              network: state.networkName,
                              ourNick: state.ourNick,
                            });
                            downloadConversationExport(doc, 'txt');
                            state.addToast({
                              variant: 'success',
                              title: 'Export started',
                              description: `${doc.messageCount} local message${doc.messageCount === 1 ? '' : 's'} (this device only).`,
                            });
                          }).catch(() => {
                            getState().addToast({
                              variant: 'error',
                              title: 'Export failed',
                              description: 'The transcript exporter could not be loaded. Please try again.',
                            });
                          });
                        });
                      }}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M5 19h14" />
                      </svg>
                      <span>Export transcript</span>
                    </button>
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      data-testid="ribbon-room-media"
                      aria-label={`Pictures, files, and links for ${settingsChannel()}`}
                      onClick={() => closeMoreThen(() => setMediaIndexOpen(true))}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="4" y="5" width="16" height="14" rx="3" />
                        <circle cx="9" cy="10" r="1.6" />
                        <path d="m7 16 3.2-3.2L13 15l2-2 3 3" />
                      </svg>
                      <span>Pictures, files, and links</span>
                    </button>
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      aria-label={
                        pinCount() > 0
                          ? `${pinCount()} pinned message${pinCount() === 1 ? '' : 's'}`
                          : 'Pinned messages'
                      }
                      data-testid="ribbon-pins"
                      onClick={() => closeMoreThen(() => getState().openPinnedMessages())}
                      onKeyDown={onMoreMenuKeyDown}
                    >
                      <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
                        <path d="M12 14v6" />
                      </svg>
                      <span>Pinned messages</span>
                      <Show when={pinCount() > 0}>
                        <span class="shell-ribbon-more-meta">{pinCount()}</span>
                      </Show>
                    </button>
                    {jumpDateMenuItem(`Jump to date in ${settingsChannel()}`)}
                    <Show when={channelHasUnread()}>
                      <button
                        type="button"
                        class="shell-ribbon-more-item"
                        role="menuitem"
                        data-testid="ribbon-mark-read"
                        aria-label={`Mark ${activeChannel()?.name ?? 'room'} as read`}
                        onClick={() => {
                          const ch = activeChannel();
                          closeMoreThen(() => {
                            if (!ch) return;
                            getState().markRead(ch.name);
                          });
                        }}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        <span>Mark as read</span>
                      </button>
                    </Show>
                    <Show when={dndActive()}>
                      <button
                        type="button"
                        class="shell-ribbon-more-item"
                        role="menuitem"
                        data-testid="ribbon-dnd-active"
                        aria-label="Do not disturb is on — open preferences to change"
                        onClick={() => closeMoreThen(() => openPreferences())}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                        </svg>
                        <span>Do not disturb is on</span>
                      </button>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* Conversation — DM Jump to date */}
              <Show when={activeView().kind === 'dm' && channelName()}>
                {(nick) => (
                  <div
                    class="shell-ribbon-more-section"
                    role="group"
                    aria-labelledby="ribbon-more-conv-label"
                  >
                    <p id="ribbon-more-conv-label" class="shell-ribbon-more-label">
                      Conversation
                    </p>
                    <div
                      class="shell-ribbon-more-list"
                      role="menu"
                      aria-labelledby="ribbon-more-conv-label"
                    >
                      <button
                        type="button"
                        class="shell-ribbon-more-item"
                        role="menuitem"
                        data-testid="ribbon-room-media"
                        aria-label={`Pictures, files, and links for ${nick()}`}
                        onClick={() => closeMoreThen(() => setMediaIndexOpen(true))}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="4" y="5" width="16" height="14" rx="3" />
                          <circle cx="9" cy="10" r="1.6" />
                          <path d="m7 16 3.2-3.2L13 15l2-2 3 3" />
                        </svg>
                        <span>Pictures, files, and links</span>
                      </button>
                      {jumpDateMenuItem(`Jump to date in DM with ${nick()}`)}
                      <button
                        type="button"
                        class="shell-ribbon-more-item shell-ribbon-more-item--verb"
                        role="menuitem"
                        data-testid="ribbon-mute-dm"
                        aria-label={
                          mutedDMs().has(nick().toLowerCase())
                            ? `Unmute ${nick()}`
                            : `Mute ${nick()}`
                        }
                        onClick={() => {
                          const peer = nick();
                          closeMoreThen(() => {
                            if (getState().isDMMuted(peer)) {
                              getState().unmuteDM(peer);
                              getState().addToast({
                                variant: 'info',
                                title: ROOM_VERB_COPY.mute.dmUnmuteLabel,
                                description: 'Conversation notifications resume on this device.',
                              });
                              return;
                            }
                            getState().muteDM(peer);
                            getState().addToast({
                              variant: 'info',
                              title: ROOM_VERB_COPY.mute.dmLabel,
                              description: ROOM_VERB_COPY.mute.hint,
                            });
                          });
                        }}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                          <path d="m22 9-6 6" />
                          <path d="m16 9 6 6" />
                        </svg>
                        <span>
                          {mutedDMs().has(nick().toLowerCase())
                            ? ROOM_VERB_COPY.mute.dmUnmuteLabel
                            : ROOM_VERB_COPY.mute.dmLabel}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="shell-ribbon-more-item shell-ribbon-more-item--verb"
                        role="menuitem"
                        data-testid="ribbon-close-conversation"
                        aria-label={`Close conversation with ${nick()}`}
                        onClick={() => {
                          const peer = nick();
                          closeMoreThen(() => openCloseConversationConfirm(peer));
                        }}
                        onKeyDown={onMoreMenuKeyDown}
                      >
                        <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M6 6h12v12H6z" />
                          <path d="m9 9 6 6" />
                          <path d="m15 9-6 6" />
                        </svg>
                        <span>{ROOM_VERB_COPY.closeConversation.label}</span>
                      </button>
                    </div>
                  </div>
                )}
              </Show>

              {/* You — identity & settings hub (Appearance/Preferences live inside You) */}
              <Show when={!local.contextActionsOnly}>
                <div
                  class="shell-ribbon-more-section"
                  role="group"
                  aria-labelledby="ribbon-more-you-label"
                >
                <p id="ribbon-more-you-label" class="shell-ribbon-more-label">
                  You
                </p>
                <div
                  class="shell-ribbon-more-list"
                  role="menu"
                  aria-labelledby="ribbon-more-you-label"
                >
                  <button
                    type="button"
                    class="shell-ribbon-more-item shell-ribbon-more-item--account"
                    role="menuitem"
                    data-guest={account() ? 'false' : 'true'}
                    aria-label={
                      account()
                        ? `You — ${account()} — open account, appearance, and preferences`
                        : 'You — guest — open account, appearance, and preferences'
                    }
                    aria-haspopup="dialog"
                    data-testid="ribbon-account-chip"
                    onClick={() => closeMoreThen(() => getState().openAccount())}
                    onKeyDown={onMoreMenuKeyDown}
                  >
                    <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5 19.5c1.6-3 4-4.5 7-4.5s5.4 1.5 7 4.5" />
                    </svg>
                    <span class="shell-ribbon-account-text">
                      <span class="shell-ribbon-account-kicker">You</span>
                      <Show when={account()} fallback={<span class="shell-ribbon-account-name">Guest</span>}>
                        {(acct) => <span class="shell-ribbon-account-name">{acct()}</span>}
                      </Show>
                    </span>
                  </button>
                </div>
                </div>
              </Show>
            </div>
            </Popover>
          </div>
        </Show>

        <span class="shell-ribbon-divider" aria-hidden="true" />

        {/* Connection — may compact at narrow widths; never display:none. */}
        <span
          class="shell-ribbon-conn"
          data-testid="ribbon-conn"
          data-state={connectionStatus()}
          title={connLabel()}
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="shell-ribbon-conn-dot" aria-hidden="true" />
          <Show when={!local.contextActionsOnly}>
            <span class="shell-ribbon-conn-label" aria-hidden="true">{connLabel()}</span>
          </Show>
          <span class="sr-only">{connLabel()}</span>
        </span>
      </div>
      </div>

      {/* Channel settings panel (topic + modes) — portaled Sheet. */}
      <Show when={settingsChannel()}>
        {(name) => (
          <Suspense fallback={null}>
            <ChannelSettings
              channel={name()}
              open={settingsOpen()}
              onOpenChange={setSettingsOpen}
            />
          </Suspense>
        )}
      </Show>
      <Show when={(activeView().kind === 'channel' || activeView().kind === 'dm') ? channelName() : null}>
        {(target) => (
          <RoomMediaIndex
            target={target()}
            open={mediaIndexOpen()}
            onOpenChange={setMediaIndexOpen}
          />
        )}
      </Show>
    </header>
  );
}
