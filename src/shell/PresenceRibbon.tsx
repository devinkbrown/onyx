// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PresenceRibbon.tsx — top ribbon of the conversation column.
 *
 * Shows: channel name + topic, self identity (selfNick),
 * connection status dot, member count, and a member-list toggle.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo.
 */

import { createMemo, createSignal, onCleanup, Show, splitProps, type JSX } from 'solid-js';
import { useStore, getState, selectAccount, selectChannelEvent, selectChannelPins } from '@/lib/store';
import { openPreferences } from '@/lib/prefs/preferences';
import { eventCountdown, scheduledEventVisible, scheduledEventsEqual } from '@/lib/notifications/scheduledEvents';
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
  const speakers = input.participants.filter((nick) => input.speakingNicks.has(nick));
  const raised = input.participants.filter((nick) => input.raisedHands.has(nick));
  const mutedPeers = input.participants.filter((nick) => input.mutedNicks.has(nick));
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
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));

  // ── derived ──
  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel) ?? null;
  });

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

  // Facepile roster — reuses the same activeChannel() read as the member count,
  // adapting the channel's user map into the pure facepile inputs.
  const facepileMembers = createMemo(() => {
    const ch = activeChannel();
    return ch ? facepileInputsFromUsers(ch.users.values()) : [];
  });

  // Active channel name for the settings panel (display-cased, e.g. "#general").
  const settingsChannel = createMemo(() => activeChannel()?.name ?? null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  const connLabel = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return 'connected';
    if (s === 'reconnecting') return 'reconnecting';
    if (s === 'connecting') return 'connecting';
    return 'disconnected';
  });

  const voiceParticipants = createMemo(() => {
    const ch = activeChannel();
    if (!ch) return [];
    const roster = voiceChannelParticipants().get(ch.name.toLowerCase());
    if (!roster) return [];

    const seen = new Set<string>();
    const present: string[] = [];
    for (const nick of roster) {
      const lower = nick.toLowerCase();
      if (seen.has(lower)) continue;
      if (ch.users.size > 0 && !ch.users.has(lower)) continue;
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

  const ribbonEventLive = createMemo(() => {
    const event = ribbonEvent();
    return !!event && now() >= event.at * 1000;
  });

  const ribbonEventLabel = createMemo(() => {
    const event = ribbonEvent();
    if (!event) return '';
    return `${event.title} · ${eventCountdown(event, now())}`;
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

  return (
    <header class="shell-ribbon" role="banner" aria-label="Channel information">
      {/* Inner row shares the conversation reading measure so the title and
          controls stay aligned to the conversation column chrome. */}
      <div class="shell-ribbon-inner">
      {/* ── LEFT: conversation identity (what you're looking at) ── */}
      <div class="shell-ribbon-identity">
        <Show when={channelName()} fallback={
          <span class="shell-ribbon-channel" aria-label="No active channel">
            IRCXNet
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

      {/* ── RIGHT: actions, grouped by scope and split with hairlines ── */}
      <div class="shell-ribbon-right">
        {/* Channel-scoped cluster: members + settings (channels only). */}
        <Show when={activeView().kind === 'channel'}>
          <div class="shell-ribbon-group" role="group" aria-label="Channel">
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
                <span class="shell-ribbon-event-text">{ribbonEventLabel()}</span>
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
            <Show when={local.showJoinVoice && local.onJoinVoice}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-call"
                aria-label="Join voice"
                title="Join voice"
                onClick={() => local.onJoinVoice?.(false)}
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
                  <path d="M4 14h3v6H4a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z" />
                  <path d="M20 14h-3v6h3a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z" />
                </svg>
                <span class="shell-ribbon-action-label">Voice</span>
              </button>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-call"
                aria-label="Join video"
                title="Join video"
                onClick={() => local.onJoinVoice?.(true)}
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 10 20 7v10l-5-3" />
                  <rect x="3" y="6" width="12" height="12" rx="2" />
                </svg>
                <span class="shell-ribbon-action-label">Video</span>
              </button>
            </Show>
            <Show when={pinCount() > 0}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-pins"
                aria-label={`${pinCount()} pinned message${pinCount() === 1 ? '' : 's'}`}
                onClick={() => getState().openPinnedMessages()}
                data-testid="ribbon-pins"
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
                  <path d="M12 14v6" />
                </svg>
                <span class="shell-ribbon-count">{pinCount()}</span>
              </button>
            </Show>
            <Show when={memberCount() > 0}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-members"
                aria-label={`${memberCount()} members — toggle member list`}
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
            <Show when={settingsChannel()}>
              {(name) => <ChannelNotifyControl channel={name()} />}
            </Show>
            <Show when={settingsChannel()}>
              <button
                type="button"
                class="shell-ribbon-iconbtn shell-ribbon-settings"
                aria-label={`Channel settings for ${settingsChannel()}`}
                aria-haspopup="dialog"
                onClick={() => setSettingsOpen(true)}
                data-testid="ribbon-settings-gear"
              >
                <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
                </svg>
              </button>
            </Show>
          </div>
          <span class="shell-ribbon-divider" aria-hidden="true" />
        </Show>

        {/* Workspace cluster: appearance + identity. */}
        <div class="shell-ribbon-group" role="group" aria-label="Workspace">
          <button
            type="button"
            class="shell-ribbon-iconbtn shell-ribbon-appearance"
            aria-label="Appearance — theme and background"
            aria-haspopup="dialog"
            onClick={() => getState().openAppearance()}
            data-testid="ribbon-appearance"
          >
            <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.9-4-7.4-9-7.4Z" />
              <circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="11" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button
            type="button"
            class="shell-ribbon-iconbtn shell-ribbon-action shell-ribbon-preferences"
            aria-label="Open preferences"
            aria-haspopup="dialog"
            title="Preferences"
            onClick={() => openPreferences()}
            data-testid="ribbon-preferences"
          >
            <svg class="shell-ribbon-ico" viewBox="0 0 24 24" aria-hidden="true"
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
            <span class="shell-ribbon-action-label">Prefs</span>
          </button>

          <NotificationCenter />
          <button
            type="button"
            class="shell-ribbon-account"
            data-guest={account() ? 'false' : 'true'}
            aria-label={
              account()
                ? `Account: ${account()} — open account panel`
                : 'Guest — open account panel'
            }
            aria-haspopup="dialog"
            onClick={() => getState().openAccount()}
            data-testid="ribbon-account-chip"
          >
            <span class="shell-ribbon-account-text">
              <Show when={account()} fallback={<span class="shell-ribbon-account-name">Guest</span>}>
                {(acct) => <span class="shell-ribbon-account-name">{acct()}</span>}
              </Show>
            </span>
          </button>
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
