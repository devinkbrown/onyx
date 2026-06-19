/**
 * VoiceBar — persistent control bar shown whenever callState is active.
 *
 * Controls:
 *   [M] Mic toggle     — muted:    vermilion when active, aria-pressed
 *   [D] Deafen toggle  — deafened: gold tint when active, aria-pressed
 *   [C] Camera toggle  — cameraOn: gold tint when active, aria-pressed
 *   [S] Screenshare    — screenshareActive: gold tint, aria-pressed
 *   [LEAVE]            — vermilion, calls leaveVoiceChannel()
 *
 * Identity zone (left): self Avatar + channel name + call timer
 * Connection quality pip (right): 4-bar indicator from getNetworkStats()
 *
 * All buttons have aria-label, aria-pressed, and keyboard focus styles.
 * Tooltip wraps each control via the Tooltip primitive.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { getMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';
import { Avatar, Tooltip } from '@/primitives';
import type { NetworkQualityTier } from '@/lib/suimyaku-media/types';
import './voice.css';

// ── Connection quality ────────────────────────────────────────────────────────

const TIER_META: Record<NetworkQualityTier, { label: string; color: string; bars: number }> = {
  0: { label: 'Excellent', color: 'var(--ok)',          bars: 4 },
  1: { label: 'Good',      color: 'var(--ok)',          bars: 3 },
  2: { label: 'Fair',      color: 'var(--gold-bright)', bars: 2 },
  3: { label: 'Poor',      color: 'var(--shu)',         bars: 1 },
};

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
                {([1, 2, 3, 4] as const).map((i) => (
                  <span
                    class={`voice-cq__bar ${i <= meta.bars ? 'voice-cq__bar--on' : 'voice-cq__bar--off'}`}
                  />
                ))}
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

function CallTimer(props: { active: boolean }) {
  const [elapsed, setElapsed] = createSignal(0);

  createEffect(() => {
    if (!props.active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    onCleanup(() => clearInterval(id));
  });

  const formatted = createMemo(() => {
    const t = elapsed();
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  });

  return (
    <Show when={props.active}>
      <span class="voice-bar__timer" aria-live="off" aria-label={`Call duration: ${formatted()}`}>
        {formatted()}
      </span>
    </Show>
  );
}

// ── VoiceBar ──────────────────────────────────────────────────────────────────

export function VoiceBar() {
  const voice = useStore(s => s.voice);
  const ourNick = useStore(s => s.ourNick);

  const isActive = createMemo(() =>
    voice().callState === 'in_call' || voice().callState === 'ringing_out' || voice().callState === 'ringing_in'
  );

  const channelLabel = createMemo(() => voice().callChannel ?? voice().callWith ?? '');
  const selfNick = createMemo(() => ourNick() ?? '');

  const handleToggleMute = () => {
    getState().toggleMute();
  };

  const handleToggleDeafen = () => {
    getState().toggleDeafen();
  };

  const handleToggleCamera = () => {
    void getState().toggleCamera();
  };

  const handleToggleScreenshare = () => {
    if (voice().screenshareActive) {
      voice().stopScreenshare();
    } else {
      void voice().startScreenshare();
    }
  };

  const handleLeave = () => {
    getState().leaveVoiceChannel();
  };

  return (
    <Show when={isActive()}>
      <div
        class="voice-bar"
        role="toolbar"
        aria-label="Voice call controls"
        data-testid="voice-bar"
      >
        {/* Left: identity */}
        <div class="voice-bar__identity">
          <Avatar name={selfNick()} size="sm" />
          <div class="voice-bar__channel">
            <span class="voice-bar__channel-name" title={channelLabel()}>
              {channelLabel()}
            </span>
            <CallTimer active={isActive()} />
          </div>
        </div>

        <div class="voice-bar__sep" aria-hidden="true" />

        {/* Center: controls */}
        <div class="voice-bar__controls">
          {/* Mic */}
          <Tooltip content={voice().muted ? 'Unmute microphone' : 'Mute microphone'} placement="top">
            <button
              type="button"
              class={`ruri-icon-button ruri-icon-button--ghost ruri-icon-button--md${voice().muted ? ' ruri-icon-button--muted' : ''}`}
              aria-label={voice().muted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={voice().muted}
              onClick={handleToggleMute}
              data-testid="mute-button"
            >
              <span class="ruri-icon-button__glyph" aria-hidden="true">
                {voice().muted ? '[M✗]' : '[M]'}
              </span>
            </button>
          </Tooltip>

          {/* Deafen */}
          <Tooltip content={voice().deafened ? 'Undeafen' : 'Deafen'} placement="top">
            <button
              type="button"
              class="ruri-icon-button ruri-icon-button--ghost ruri-icon-button--md"
              aria-label={voice().deafened ? 'Undeafen' : 'Deafen'}
              aria-pressed={voice().deafened}
              onClick={handleToggleDeafen}
              data-testid="deafen-button"
            >
              <span class="ruri-icon-button__glyph" aria-hidden="true">
                {voice().deafened ? '[D✗]' : '[D]'}
              </span>
            </button>
          </Tooltip>

          {/* Camera */}
          <Tooltip content={voice().cameraOn ? 'Turn off camera' : 'Turn on camera'} placement="top">
            <button
              type="button"
              class="ruri-icon-button ruri-icon-button--ghost ruri-icon-button--md"
              aria-label={voice().cameraOn ? 'Turn off camera' : 'Turn on camera'}
              aria-pressed={voice().cameraOn}
              onClick={handleToggleCamera}
              data-testid="camera-button"
            >
              <span class="ruri-icon-button__glyph" aria-hidden="true">
                {voice().cameraOn ? '[CAM]' : '[cam]'}
              </span>
            </button>
          </Tooltip>

          {/* Screenshare */}
          <Tooltip content={voice().screenshareActive ? 'Stop sharing screen' : 'Share screen'} placement="top">
            <button
              type="button"
              class="ruri-icon-button ruri-icon-button--ghost ruri-icon-button--md"
              aria-label={voice().screenshareActive ? 'Stop sharing screen' : 'Share screen'}
              aria-pressed={voice().screenshareActive}
              onClick={handleToggleScreenshare}
              data-testid="screenshare-button"
            >
              <span class="ruri-icon-button__glyph" aria-hidden="true">
                {voice().screenshareActive ? '[SCR✗]' : '[SCR]'}
              </span>
            </button>
          </Tooltip>

          <div class="voice-bar__sep" aria-hidden="true" />

          {/* Leave */}
          <Tooltip content="Leave call" placement="top">
            <button
              type="button"
              class="ruri-icon-button voice-bar__leave"
              aria-label="Leave voice call"
              onClick={handleLeave}
              data-testid="leave-button"
            >
              <span class="ruri-icon-button__glyph" aria-hidden="true">[LEAVE]</span>
            </button>
          </Tooltip>
        </div>

        {/* Right: connection quality */}
        <div class="voice-bar__right">
          <ConnectionQualityPip />
        </div>
      </div>
    </Show>
  );
}
