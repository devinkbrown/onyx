/**
 * VoiceBar — persistent control bar shown whenever callState is active.
 *
 * Control cluster (grouped left → right):
 *   Identity:  self Avatar + channel name + live duration timer + participant count
 *   Media:     Mic · Deafen · Camera · Screenshare
 *   Engage:    Raise hand · Reactions · Captions
 *   View:      Grid ↔ Spotlight · Settings
 *   Exit:      Hang up
 *   Right:     connection-quality pip
 *
 * All controls use the shared inline-SVG icon set (./icons) so the bar reads as
 * one system; each button keeps its aria-label and Tooltip.
 *
 * Toggle buttons expose aria-pressed; every control has an aria-label and a
 * Tooltip. The duration timer is announced politely via aria-live. The whole
 * bar is a role="toolbar". Reduced-motion is handled in voice.css.
 */

import { For, createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import { getMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';
import { shortDuration } from '@/lib/time/relativeTime';
import { Avatar, Popover, Tooltip } from '@/primitives';
import { VoiceSettings } from './settings/VoiceSettings';
import {
  MicIcon, MicOffIcon, DeafenIcon, DeafenOffIcon, CameraIcon, CameraOffIcon,
  ScreenShareIcon, ScreenShareStopIcon, CaptionsIcon, HandIcon, ReactionIcon,
  GridIcon, SpotlightIcon, SettingsIcon, HangupIcon,
} from './icons';
import type { NetworkQualityTier } from '@/lib/suimyaku-media/types';
import './voice.css';

// ── Connection quality ────────────────────────────────────────────────────────

const TIER_META: Record<NetworkQualityTier, { label: string; color: string; bars: number }> = {
  0: { label: 'Excellent', color: 'var(--ok)',          bars: 4 },
  1: { label: 'Good',      color: 'var(--ok)',          bars: 3 },
  2: { label: 'Fair',      color: 'var(--gold-bright)', bars: 2 },
  3: { label: 'Poor',      color: 'var(--shu)',         bars: 1 },
};

/** Quick-reaction emoji set surfaced in the reactions popover. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥', '😮', '✋'] as const;

function formatBitrate(bps: number): string {
  if (bps <= 0) return '';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)}M`;
  return `${Math.round(bps / 1000)}k`;
}

interface NetSample {
  tier: NetworkQualityTier;
  suggestedBps: number;
  jitterMs: number;
  lossRate: number;
}

function ConnectionQualityPip() {
  const [sample, setSample] = createSignal<NetSample | null>(null);

  let intervalId: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    const poll = () => {
      const engine = getMountedSuimyakuMediaEngine();
      if (!engine) return;
      const s = engine.getNetworkStats();
      setSample({
        tier: s.tier,
        suggestedBps: s.suggestedBps,
        jitterMs: s.jitterMs,
        lossRate: s.lossRate,
      });
    };
    poll();
    intervalId = setInterval(poll, 1000);
    onCleanup(() => {
      clearInterval(intervalId);
    });
  });

  return (
    <Show when={sample()} keyed>
      {(s) => {
        const meta = TIER_META[s.tier];
        const lossPct = (s.lossRate * 100).toFixed(s.lossRate < 0.01 ? 1 : 0);
        const tooltip = [
          `${meta.label} connection`,
          s.suggestedBps > 0 ? formatBitrate(s.suggestedBps) : null,
          `${Math.round(s.jitterMs)}ms jitter`,
          `${lossPct}% loss`,
        ].filter(Boolean).join(' · ');

        return (
          <Tooltip content={tooltip} placement="top">
            <span
              class="voice-cq"
              role="img"
              aria-label={`Connection: ${meta.label}`}
              data-testid="connection-quality"
              style={{ '--cq-color': meta.color }}
            >
              <span class="voice-cq__bars" aria-hidden="true">
                <For each={[1, 2, 3, 4] as const}>
                  {(i) => (
                    <span
                      class={`voice-cq__bar ${i <= meta.bars ? 'voice-cq__bar--on' : 'voice-cq__bar--off'}`}
                    />
                  )}
                </For>
              </span>
              <Show when={s.suggestedBps > 0}>
                <span class="voice-cq__rate" aria-hidden="true">
                  {formatBitrate(s.suggestedBps)}
                </span>
              </Show>
            </span>
          </Tooltip>
        );
      }}
    </Show>
  );
}

// ── Call duration ─────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Live duration readout. Anchored to the store's callStartedAt epoch so it is
 * accurate even if the bar remounts mid-call (a local start signal would reset
 * to 0:00). Falls back to ticking from mount when no timestamp is recorded.
 */
function CallTimer(props: { active: boolean; startedAt: number | null }) {
  const [elapsed, setElapsed] = createSignal(0);

  createEffect(() => {
    if (!props.active) {
      setElapsed(0);
      return;
    }
    const start = props.startedAt ?? Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    onCleanup(() => clearInterval(id));
  });

  const formatted = createMemo(() => formatElapsed(elapsed()));
  const durationLabel = createMemo(() => shortDuration(elapsed() * 1000));

  return (
    <Show when={props.active}>
      <span
        class="voice-bar__timer"
        role="timer"
        aria-live="polite"
        aria-label={`Call duration: ${durationLabel()}`}
      >
        {formatted()}
      </span>
    </Show>
  );
}

// ── VoiceBar ──────────────────────────────────────────────────────────────────

export function VoiceBar() {
  const voice = useStore(s => s.voice);
  const ourNick = useStore(s => s.ourNick);
  const showSettings = useStore(s => s.showVoiceSettings);

  const [reactionsOpen, setReactionsOpen] = createSignal(false);

  const isActive = createMemo(() =>
    voice().callState === 'in_call' || voice().callState === 'ringing_out' || voice().callState === 'ringing_in'
  );

  const channelLabel = createMemo(() => voice().callChannel ?? voice().callWith ?? '');
  const selfNick = createMemo(() => ourNick() ?? '');
  const participantCount = createMemo(() => voice().peers.size + 1);
  const isSpotlight = createMemo(() => voice().callLayout === 'spotlight');

  const handleToggleMute = () => getState().toggleMute();
  const handleToggleDeafen = () => getState().toggleDeafen();
  const handleToggleCamera = () => void getState().toggleVideo();
  const handleToggleHand = () => getState().toggleRaiseHand();
  const handleToggleCaptions = () => getState().toggleCaptions();
  const handleToggleLayout = () => getState().setCallLayout(isSpotlight() ? 'grid' : 'spotlight');
  const handleOpenSettings = () => getState().openVoiceSettings();

  const handleToggleScreenshare = () => {
    if (voice().screenshareActive) {
      voice().stopScreenshare();
    } else {
      void voice().startScreenshare();
    }
  };

  const handleLeave = () => getState().leaveVoiceChannel();

  const sendReaction = (emoji: string) => {
    getState().sendCallReaction(emoji);
    setReactionsOpen(false);
  };

  return (
    <Show when={isActive()}>
      <div
        class="voice-bar"
        role="toolbar"
        aria-label="Voice call controls"
        data-testid="voice-bar"
      >
        {/* Left: identity + call info */}
        <div class="voice-bar__identity">
          <Avatar name={selfNick()} size="sm" />
          <div class="voice-bar__channel">
            <span class="voice-bar__channel-name" title={channelLabel()}>
              {channelLabel()}
            </span>
            <span class="voice-bar__meta">
              <CallTimer active={isActive()} startedAt={voice().callStartedAt} />
              <span class="voice-bar__dot" aria-hidden="true">·</span>
              <span
                class="voice-bar__count"
                data-testid="participant-count"
                aria-label={`${participantCount()} in call`}
              >
                <span aria-hidden="true">◇ {participantCount()}</span>
              </span>
            </span>
          </div>
        </div>

        <div class="voice-bar__sep" aria-hidden="true" />

        {/* Center: controls */}
        <div class="voice-bar__controls">
          {/* ── Media group ── */}
          <div class="voice-bar__group" role="group" aria-label="Media controls">
            <Tooltip content={voice().muted ? 'Unmute microphone' : 'Mute microphone'} placement="top">
              <button
                type="button"
                class={`onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md${voice().muted ? ' onyx-icon-button--muted' : ''}`}
                aria-label={voice().muted ? 'Unmute microphone' : 'Mute microphone'}
                aria-pressed={voice().muted}
                onClick={handleToggleMute}
                data-testid="mute-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true">
                  <Show when={voice().muted} fallback={<MicIcon />}><MicOffIcon /></Show>
                </span>
              </button>
            </Tooltip>

            <Tooltip content={voice().deafened ? 'Undeafen' : 'Deafen'} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={voice().deafened ? 'Undeafen' : 'Deafen'}
                aria-pressed={voice().deafened}
                onClick={handleToggleDeafen}
                data-testid="deafen-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true">
                  <Show when={voice().deafened} fallback={<DeafenIcon />}><DeafenOffIcon /></Show>
                </span>
              </button>
            </Tooltip>

            <Tooltip content={voice().cameraOn ? 'Turn off camera' : 'Turn on camera'} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={voice().cameraOn ? 'Turn off camera' : 'Turn on camera'}
                aria-pressed={voice().cameraOn}
                onClick={handleToggleCamera}
                data-testid="camera-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true">
                  <Show when={voice().cameraOn} fallback={<CameraOffIcon />}><CameraIcon /></Show>
                </span>
              </button>
            </Tooltip>

            <Tooltip content={voice().screenshareActive ? 'Stop sharing screen' : 'Share screen'} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={voice().screenshareActive ? 'Stop sharing screen' : 'Share screen'}
                aria-pressed={voice().screenshareActive}
                onClick={handleToggleScreenshare}
                data-testid="screenshare-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true">
                  <Show when={voice().screenshareActive} fallback={<ScreenShareIcon />}><ScreenShareStopIcon /></Show>
                </span>
              </button>
            </Tooltip>
          </div>

          <div class="voice-bar__sep" aria-hidden="true" />

          {/* ── Engagement group ── */}
          <div class="voice-bar__group" role="group" aria-label="Engagement controls">
            <Tooltip content={voice().handRaised ? 'Lower hand' : 'Raise hand'} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={voice().handRaised ? 'Lower hand' : 'Raise hand'}
                aria-pressed={voice().handRaised}
                onClick={handleToggleHand}
                data-testid="raise-hand-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true"><HandIcon /></span>
              </button>
            </Tooltip>

            <Popover
              placement="top"
              open={reactionsOpen()}
              onOpenChange={setReactionsOpen}
              trigger={
                <span
                  class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                  role="button"
                  tabindex="0"
                  aria-label="Send a reaction"
                  data-testid="reactions-button"
                  title="Send a reaction"
                >
                  <span class="onyx-icon-button__glyph" aria-hidden="true"><ReactionIcon /></span>
                </span>
              }
            >
              <div class="voice-bar__reactions" role="menu" aria-label="Send a reaction">
                <For each={QUICK_REACTIONS}>{(emoji) => (
                  <button
                    type="button"
                    class="voice-bar__reaction"
                    role="menuitem"
                    aria-label={`React with ${emoji}`}
                    data-testid={`reaction-${emoji}`}
                    onClick={() => sendReaction(emoji)}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                )}</For>
              </div>
            </Popover>

            <Tooltip content={voice().captionsEnabled ? 'Hide captions' : 'Show captions'} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={voice().captionsEnabled ? 'Hide live captions' : 'Show live captions'}
                aria-pressed={voice().captionsEnabled}
                onClick={handleToggleCaptions}
                data-testid="captions-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true"><CaptionsIcon /></span>
              </button>
            </Tooltip>
          </div>

          <div class="voice-bar__sep" aria-hidden="true" />

          {/* ── View group ── */}
          <div class="voice-bar__group" role="group" aria-label="View controls">
            <Tooltip content={isSpotlight() ? 'Switch to grid' : 'Switch to spotlight'} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={isSpotlight() ? 'Switch to grid layout' : 'Switch to spotlight layout'}
                aria-pressed={isSpotlight()}
                onClick={handleToggleLayout}
                data-testid="layout-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true">
                  <Show when={isSpotlight()} fallback={<GridIcon />}><SpotlightIcon /></Show>
                </span>
              </button>
            </Tooltip>

            <Tooltip content="Voice settings" placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label="Open voice settings"
                aria-pressed={showSettings()}
                onClick={handleOpenSettings}
                data-testid="settings-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true"><SettingsIcon /></span>
              </button>
            </Tooltip>
          </div>

          <div class="voice-bar__sep" aria-hidden="true" />

          {/* Leave */}
          <Tooltip content="Leave call" placement="top">
            <button
              type="button"
              class="onyx-icon-button voice-bar__leave"
              aria-label="Leave voice call"
              onClick={handleLeave}
              data-testid="leave-button"
            >
              <span class="onyx-icon-button__glyph" aria-hidden="true"><HangupIcon /></span>
            </button>
          </Tooltip>
        </div>

        {/* Right: connection quality */}
        <div class="voice-bar__right">
          <ConnectionQualityPip />
        </div>
      </div>

      {/* In-call settings sheet (portal modal) */}
      <VoiceSettings
        open={showSettings()}
        onOpenChange={(open) => (open ? getState().openVoiceSettings() : getState().closeVoiceSettings())}
      />
    </Show>
  );
}
