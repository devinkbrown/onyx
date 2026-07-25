// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PresenceRibbon.tsx — top ribbon of the conversation column.
 *
 * Place strip (A8) hierarchy:
 *   LEFT  — conversation identity (name · topic · heatline · facepile)
 *   RIGHT — place signals first (event · voice · hop-in · member count),
 *           then time (jump-to-date), reach (inbox), connection.
 * Secondary chrome (pins, notify, settings, appearance, prefs, account)
 * collapses into one "More" disclosure so the ribbon reads as
 * presence-as-place, not a control dump. Member count stays primary —
 * it is the roster trigger, not chrome.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; For/Show;
 * store reads via useStore; snapshots via getState() in handlers.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show, splitProps, type JSX } from 'solid-js';
import { useStore, getState, selectAccount, selectChannelEvent, selectChannelPins } from '@/lib/store';
import { openPreferences } from '@/lib/prefs/preferences';
import { eventCountdown, scheduledEventVisible, scheduledEventsEqual } from '@/lib/notifications/scheduledEvents';
import { Popover } from '@/primitives/index';
import { ChannelSettings } from './ChannelSettings';
import { ChannelNotifyControl } from './ChannelNotifyControl';
import { NotificationCenter } from './NotificationCenter';
import { PresenceHeatline } from './PresenceHeatline';
import { Facepile } from './Facepile';
import { facepileInputsFromUsers } from './facepile';
import { AiPolicyBadge } from './AiPolicyBadge';
import type { AiPolicy } from '@/lib/irc/aiPolicyProp';
import type { Channel } from '@/lib/irc/types';

export type PresenceRibbonProps = {
  selfNick?: string;
  onToggleMembers?: () => void;
  showJoinVoice?: boolean;
  onJoinVoice?: (withVideo: boolean) => void;
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
  const [local] = splitProps(props, ['selfNick', 'onToggleMembers', 'showJoinVoice', 'onJoinVoice']);

  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const channels = useStore((s) => s.channels);
  // selectChannelEvent parses the prop into a fresh object each call; without a
  // value-equality fn this signal (and its four countdown memos) would re-fire on
  // every unrelated store mutation whenever the active channel has an event set.
  const scheduledEvent = useStore((s) => {
    const view = s.activeView;
    return view.kind === 'channel' ? selectChannelEvent(view.channel)(s) : null;
  }, scheduledEventsEqual);
  const account = useStore(selectAccount);
  const voice = useStore((s) => s.voice);
  const voiceChannelParticipants = useStore((s) => s.voiceChannelParticipants);
  const speakingNicks = useStore((s) => s.speakingNicks);
  const mutedNicks = useStore((s) => s.mutedNicks);
  const [now, setNow] = createSignal(Date.now());

  // ── derived ──
  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel) ?? null;
  });

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
    if (view.kind === 'status') return 'Status';
    return null;
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

  // Facepile roster — adapts the channel's user map into the pure facepile inputs.
  // Keyed on the stable users identity so it survives message-only appends.
  const facepileMembers = createMemo(() => {
    const users = activeUsers();
    return users ? facepileInputsFromUsers(users.values()) : [];
  });

  // Active channel name for the settings panel (display-cased, e.g. "#general").
  const settingsChannel = createMemo(() => activeChannel()?.name ?? null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);
  let moreMenuRef: HTMLDivElement | undefined;

  const connLabel = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return 'connected';
    if (s === 'reconnecting') return 'reconnecting';
    if (s === 'connecting') return 'connecting';
    return 'disconnected';
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

  const currentVoiceCall = createMemo(() => {
    const channel = settingsChannel();
    return !!channel
      && voice().callChannel?.toLowerCase() === channel.toLowerCase()
      && voice().callState === 'in_call';
  });

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

  function moreMenuItems(): HTMLButtonElement[] {
    if (!moreMenuRef) return [];
    return Array.from(moreMenuRef.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
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
    const current = items.indexOf(event.currentTarget as HTMLButtonElement);
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

  const jumpDateButton = (ariaLabel: string): JSX.Element => (
    <button
      type="button"
      class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-jump-date"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      title="Jump to date"
      onClick={() => getState().openJumpToDate()}
      data-testid="ribbon-jump-to-date"
    >
      <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 11h18" />
        <path d="M12 15v2.5M12 15l2 1.2" />
      </svg>
      <span class="shell-ribbon-action-label">Date</span>
    </button>
  );

  return (
    <header class="shell-ribbon" role="banner" aria-label="Channel information">
      {/* Inner row shares the conversation reading measure so the title and
          place strip stay aligned to the conversation column chrome. */}
      <div class="shell-ribbon-inner">
      {/* ── LEFT: conversation identity (what you're looking at) ── */}
      <div class="shell-ribbon-identity">
        <Show when={channelName()} fallback={
          <span class="shell-ribbon-channel" aria-label="No active channel">
            Onyx
          </span>
        }>
          {(name) => (
            <span
              class="shell-ribbon-channel"
              aria-label={
                activeView().kind === 'channel' ? `Channel: ${name()}`
                : activeView().kind === 'dm' ? `Direct message: ${name()}`
                : name()
              }
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
            </span>
          )}
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

        {/* Live 24h activity rhythm (channels only) — hides when there's none. */}
        <Show when={activeView().kind === 'channel'}>
          <PresenceHeatline channel={() => (activeView().kind === 'channel' ? channelName() : null)} />
        </Show>

        {/* Presence-as-place: who's in the room right now (channels only). */}
        <Show when={activeView().kind === 'channel'}>
          <Facepile members={facepileMembers} />
        </Show>
      </div>

      {/* ── RIGHT: place signals first; secondary chrome in More ── */}
      <div class="shell-ribbon-right">
        {/* Place cluster: event horizon + soft voice corner (channels only). */}
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
            <AiPolicyBadge policy={aiPolicy()} channel={settingsChannel() ?? channelName() ?? 'channel'} />
            <Show when={voiceCount() > 0}>
              <button
                type="button"
                class="shell-ribbon-voice-chip"
                classList={{ 'shell-ribbon-voice-chip--active': currentVoiceCall() }}
                aria-label={voiceChipAria()}
                title={[voiceParticipants().join(', '), voiceRoomStatus().label].filter(Boolean).join(' · ')}
                onClick={handleVoiceChipClick}
              >
                <span class="shell-ribbon-voice-mark" aria-hidden="true" />
                <span class="shell-ribbon-voice-text">{voiceChipLabel()}</span>
              </button>
            </Show>
            {/* One entry for the shared call stage — voice + camera are toggles
                on the in-call bar, not separate ribbon actions. */}
            <Show when={local.showJoinVoice && local.onJoinVoice}>
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
                <span class="shell-ribbon-action-label">Call</span>
              </button>
            </Show>
            {/* Pins chip — always one click away in a channel (B3 polish). Count
                badges only when pins exist so empty rooms stay quiet. */}
            <Show when={activeView().kind === 'channel'}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-pins"
                aria-label={
                  pinCount() > 0
                    ? `${pinCount()} pinned message${pinCount() === 1 ? '' : 's'}`
                    : 'Pinned messages'
                }
                title={pinCount() > 0 ? `${pinCount()} pinned` : 'Pinned messages'}
                data-testid="ribbon-pins"
                onClick={() => getState().openPinnedMessages()}
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
                  <path d="M12 14v6" />
                </svg>
                <Show when={pinCount() > 0}>
                  <span class="shell-ribbon-count">{pinCount()}</span>
                </Show>
              </button>
            </Show>
            {/* Member count is presence-as-place (stable roster trigger), not chrome. */}
            <Show when={memberCount() > 0}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-members"
                aria-label={`${memberCount()} members — toggle member list`}
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
              </button>
            </Show>
          </div>
          <span class="shell-ribbon-divider" aria-hidden="true" />
        </Show>

        {/* Time instrument — jump-to-date stays one click away (channel + DM). */}
        <Show when={activeView().kind === 'channel'}>
          <div class="shell-ribbon-group" role="group" aria-label="Time">
            {jumpDateButton(`Jump to date in ${settingsChannel()}`)}
          </div>
          <span class="shell-ribbon-divider" aria-hidden="true" />
        </Show>
        <Show when={activeView().kind === 'dm'}>
          <div class="shell-ribbon-group" role="group" aria-label="Conversation">
            {jumpDateButton(`Jump to date in DM with ${channelName()}`)}
          </div>
          <span class="shell-ribbon-divider" aria-hidden="true" />
        </Show>

        {/* Secondary chrome — one disclosure instead of a control dump. */}
        <div class="shell-ribbon-group" role="group" aria-label="More">
          <Popover
            open={moreOpen()}
            onOpenChange={setMoreOpen}
            placement="bottom"
            panelLabel="More channel and workspace actions"
            trigger={
              <span
                class="shell-ribbon-iconbtn shell-ribbon-more-trigger"
                data-testid="ribbon-more"
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="currentColor">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
                <span class="sr-only">More actions</span>
              </span>
            }
          >
            <div class="shell-ribbon-more">
              {/* Notify is a radiogroup — keep it outside role=menu (ARIA menu may only host menuitems). */}
              <Show when={activeView().kind === 'channel' && settingsChannel()}>
                {(name) => (
                  <div class="shell-ribbon-more-section" data-testid="ribbon-more-channel">
                    <p class="shell-ribbon-more-label">Alerts</p>
                    <ChannelNotifyControl channel={name()} class="shell-ribbon-more-notify" />
                  </div>
                )}
              </Show>

              {/* Single menu: Channel tools first, then Workspace chrome — one roving focus set. */}
              <div
                ref={(element) => {
                  moreMenuRef = element;
                  queueMicrotask(() => focusMoreMenuItem(0));
                }}
                class="shell-ribbon-more-list"
                role="menu"
                aria-label="More actions"
                data-testid="ribbon-more-menu"
              >
                <Show when={activeView().kind === 'channel' && settingsChannel()}>
                  <>
                    <p class="shell-ribbon-more-label shell-ribbon-more-label--in-menu" aria-hidden="true">
                      Channel
                    </p>
                    {/* Pins live on the Place cluster (one-click ribbon chip) when
                        the channel has any — no second entry in More. */}
                    <button
                      type="button"
                      class="shell-ribbon-more-item"
                      role="menuitem"
                      aria-label={`Channel settings for ${settingsChannel()}`}
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
                      <span>Channel settings</span>
                    </button>
                  </>
                </Show>

                <p class="shell-ribbon-more-label shell-ribbon-more-label--in-menu" aria-hidden="true">
                  Workspace
                </p>
                <button
                  type="button"
                  class="shell-ribbon-more-item"
                  role="menuitem"
                  aria-label="Appearance — theme and background"
                  aria-haspopup="dialog"
                  data-testid="ribbon-appearance"
                  onClick={() => closeMoreThen(() => getState().openAppearance())}
                  onKeyDown={onMoreMenuKeyDown}
                >
                  <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.9-4-7.4-9-7.4Z" />
                    <circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
                    <circle cx="11" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
                    <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
                  </svg>
                  <span>Appearance</span>
                </button>

                <button
                  type="button"
                  class="shell-ribbon-more-item"
                  role="menuitem"
                  aria-label="Open preferences"
                  aria-haspopup="dialog"
                  data-testid="ribbon-preferences"
                  onClick={() => closeMoreThen(() => openPreferences())}
                  onKeyDown={onMoreMenuKeyDown}
                >
                  <svg class="shell-ribbon-more-ico" viewBox="0 0 24 24" aria-hidden="true"
                    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 21v-7" />
                    <path d="M4 10V3" />
                    <path d="M12 21v-9" />
                    <path d="M12 8V3" />
                    <path d="M20 21v-5" />
                    <path d="M20 12V3" />
                    <path d="M2 14h4" />
                    <path d="M10 8h4" />
                    <path d="M18 16h4" />
                  </svg>
                  <span>Preferences</span>
                </button>

                <button
                  type="button"
                  class="shell-ribbon-more-item shell-ribbon-more-item--account"
                  role="menuitem"
                  data-guest={account() ? 'false' : 'true'}
                  aria-label={
                    account()
                      ? `Account: ${account()} — open account panel`
                      : 'Guest — open account panel'
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
                    <Show when={account()} fallback={<span class="shell-ribbon-account-name">Guest</span>}>
                      {(acct) => <span class="shell-ribbon-account-name">{acct()}</span>}
                    </Show>
                  </span>
                </button>
              </div>
            </div>
          </Popover>
        </div>

        <span class="shell-ribbon-divider" aria-hidden="true" />

        {/* Reach instrument stays one click away — not buried in More. */}
        <div class="shell-ribbon-group" role="group" aria-label="Inbox">
          <NotificationCenter />
        </div>

        <span class="shell-ribbon-divider" aria-hidden="true" />

        {/* Connection status: a labelled chip, not a stray dot. */}
        <span
          class="shell-ribbon-conn"
          data-state={connectionStatus()}
          title={`Connection: ${connLabel()}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="shell-ribbon-conn-label" aria-hidden="true">{connLabel()}</span>
          <span class="sr-only">Connection: {connLabel()}</span>
        </span>
      </div>
      </div>

      {/* Channel settings panel (topic + modes) — portaled Sheet. */}
      <Show when={settingsChannel()}>
        {(name) => (
          <ChannelSettings
            channel={name()}
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
          />
        )}
      </Show>
    </header>
  );
}
