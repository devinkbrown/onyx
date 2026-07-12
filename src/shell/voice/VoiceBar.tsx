// SPDX-License-Identifier: AGPL-3.0-or-later
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
import {
  DEFAULT_SPATIAL_POSITION,
  padToPosition,
  positionToPadPoint,
  positionToStereoPan,
  type SpatialAudioPosition,
} from '@/lib/suimyaku-media/spatialAudio';
import {
  createVoiceActivityState,
  updateVoiceActivityFromSamples,
} from '@/lib/suimyaku-media/voiceActivity';
import {
  advanceActiveSpeaker,
  createActiveSpeakerState,
  energySamplesFromSpeaking,
  type ActiveSpeakerState,
} from '@/lib/suimyaku-media/activeSpeaker';
import { shortDuration } from '@/lib/time/relativeTime';
import { Avatar, Popover, Tooltip } from '@/primitives';
import {
  MicIcon, MicOffIcon, DeafenIcon, DeafenOffIcon, CameraIcon, CameraOffIcon,
  ScreenShareIcon, ScreenShareStopIcon, CaptionsIcon, HandIcon, ReactionIcon,
  GridIcon, SpotlightIcon, SpatialAudioIcon, SettingsIcon, HangupIcon,
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
const SPATIAL_PAD_SIZE_PX = 132;
const SPATIAL_PAD_KEY_STEP = 0.125;
const SPATIAL_PAD_HELP_ID = 'voice-spatial-pad-help';

/** Cadence (ms) at which the dominant-speaker tracker is advanced. The store's
 *  who-is-speaking set is boolean, so ~12 Hz is ample resolution for the
 *  hold/release hysteresis and far lighter than a 60 fps rAF loop. */
const ACTIVE_SPEAKER_TICK_MS = 80;

/** Strip IRC status-prefix sigils for a human-readable nick. */
function displayNick(nick: string): string {
  return nick.replace(/^[~@+.%]+/, '');
}

/** Human-readable readout of a spatial position, for the pad's live announcement.
 *  Screen readers driving the pad with the arrow keys get no visual dot feedback,
 *  so the position must be exposed as text (WCAG 4.1.2 Name, Role, Value). */
function spatialPadDescription(pos: SpatialAudioPosition): string {
  const pad = positionToPadPoint(pos);
  const horizontal = pad.x < -0.05 ? 'left' : pad.x > 0.05 ? 'right' : null;
  const depth = pad.y < -0.05 ? 'front' : pad.y > 0.05 ? 'behind' : null;
  if (!horizontal && !depth) return 'Centered';
  const parts: string[] = [];
  if (horizontal) parts.push(`${horizontal} ${Math.round(Math.abs(pad.x) * 100)}%`);
  if (depth) parts.push(`${depth} ${Math.round(Math.abs(pad.y) * 100)}%`);
  return parts.join(', ');
}

type SpatialRegistryBridge = {
  readonly registry?: {
    setPositionForNick: (nick: string, pos: SpatialAudioPosition) => void;
  };
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
  const mediaAvailable = useStore(s => s.mediaAvailable);
  const spatialPositions = useStore(s => s.spatialPositions);

  const [reactionsOpen, setReactionsOpen] = createSignal(false);
  const [spatialOpen, setSpatialOpen] = createSignal(false);
  const [spatialDragging, setSpatialDragging] = createSignal(false);
  const [selectedSpatialNick, setSelectedSpatialNick] = createSignal<string | null>(null);
  const [localSpatialPosition, setLocalSpatialPosition] = createSignal<SpatialAudioPosition | null>(null);
  // Sticky dominant speaker (proper-case nick) driven by the pure active-speaker
  // tracker below. null = nobody is holding the spotlight.
  const [activeSpeaker, setActiveSpeaker] = createSignal<string | null>(null);
  // Tracks the OS "reduce motion" preference so the active-speaker chip only
  // animates its focus pulse when motion is welcome.
  const [reducedMotion, setReducedMotion] = createSignal(false);

  let spatialPadRef: HTMLDivElement | undefined;

  const isActive = createMemo(() =>
    voice().callState === 'in_call' || voice().callState === 'ringing_out' || voice().callState === 'ringing_in'
  );

  const channelLabel = createMemo(() => voice().callChannel ?? voice().callWith ?? '');
  const selfNick = createMemo(() => ourNick() ?? '');
  const participantCount = createMemo(() => voice().peers.size + 1);
  const isSpotlight = createMemo(() => voice().callLayout === 'spotlight');
  const spatialPositionCount = createMemo(() => {
    const channel = channelLabel();
    if (!channel) return 0;
    return spatialPositions().get(channel.toLowerCase())?.size ?? 0;
  });
  const spatialPeers = createMemo(() => Array.from(voice().peers.values()).filter(peer => peer.nick !== selfNick()));
  const currentSpatialNick = createMemo(() => selectedSpatialNick() ?? spatialPeers()[0]?.nick ?? '');
  const storedSpatialPosition = createMemo<SpatialAudioPosition | null>(() => {
    const channel = channelLabel();
    const nick = currentSpatialNick();
    if (!channel || !nick) return null;
    return spatialPositions().get(channel.toLowerCase())?.get(nick.toLowerCase()) ?? null;
  });
  const activeSpatialPosition = createMemo(() =>
    localSpatialPosition() ?? storedSpatialPosition() ?? DEFAULT_SPATIAL_POSITION
  );
  const spatialDotStyle = createMemo(() => {
    const pad = positionToPadPoint(activeSpatialPosition());
    return {
      left: `${((pad.x + 1) / 2) * 100}%`,
      top: `${((pad.y + 1) / 2) * 100}%`,
      transform: 'translate(-50%, -50%)',
    };
  });
  const spatialStateLabel = createMemo(() => {
    const count = spatialPositionCount();
    if (count === 1) return '1 positioned';
    if (count > 1) return `${count} positioned`;
    return 'Balanced stereo';
  });
  const spatialPositionLabel = createMemo(() => spatialPadDescription(activeSpatialPosition()));

  const handleToggleMute = () => getState().toggleMute();
  const handleToggleDeafen = () => getState().toggleDeafen();
  const handleToggleCamera = () => void getState().toggleVideo();
  const handleToggleHand = () => getState().toggleRaiseHand();
  const handleToggleCaptions = () => getState().toggleCaptions();
  const handleToggleLayout = () => getState().setCallLayout(isSpotlight() ? 'grid' : 'spotlight');
  const handleOpenSettings = () => getState().openVoiceSettings();

  createEffect(() => {
    const peers = spatialPeers();
    const selected = selectedSpatialNick();
    if (selected && peers.some(peer => peer.nick === selected)) return;
    setSelectedSpatialNick(peers[0]?.nick ?? null);
    setLocalSpatialPosition(null);
  });

  createEffect(() => {
    const channel = channelLabel();
    if (!channel) return;
    const positions = spatialPositions().get(channel.toLowerCase());
    if (!positions) return;
    for (const [nick, pos] of positions.entries()) setPositionForSpatialNick(nick, pos);
  });

  onCleanup(() => {
    setSpatialDragging(false);
  });

  // Reference-stable handle on the local capture stream: voice() is replaced on
  // every setVoiceCallState (captions toggle, peer join, …), so a createMemo is
  // used to dedupe by identity and keep the VAD effect below from rebuilding its
  // AudioContext on unrelated voice-state churn.
  const localAudioStream = createMemo(() => (isActive() ? voice().localStream : null));

  // ── Local voice-activity indicator ──────────────────────────────────────────
  // While in-call with a live local audio track, tap the mic through a dedicated
  // AnalyserNode and drive the pure voice-activity detector (RMS envelope +
  // hysteresis + hangover) once per animation frame, reflecting the local user's
  // speaking flag into the shared speakingNicks state via the same action the
  // remote/server-signaled path uses. Remote peers are untouched — this only
  // adds the LOCAL user as a speaking source. Everything the effect allocates
  // (AudioContext, AnalyserNode, source node, rAF) is released in onCleanup, so
  // a remount, a mic swap (camera toggle), or leaving the call leaks nothing.
  createEffect(() => {
    const stream = localAudioStream();
    const nick = selfNick();
    if (!stream || !nick) return;
    if (typeof AudioContext === 'undefined') return;
    if (stream.getAudioTracks().length === 0) return;

    let ctx: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    try {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      // WebAudio unavailable — the remote/server speaking path still works.
      return;
    }

    const samples = new Float32Array(analyser.fftSize);
    let vad = createVoiceActivityState();
    let reported = false;
    let lastTs = 0;
    let rafId = 0;
    let stopped = false;

    const report = (speaking: boolean) => {
      if (speaking === reported) return;
      reported = speaking;
      getState().setSpeakingNick(nick, speaking);
    };

    const tick = (ts: number) => {
      if (stopped) return;
      const dtMs = lastTs === 0 ? 0 : ts - lastTs;
      lastTs = ts;
      // A muted mic is silent by contract (track.enabled = false); short-circuit
      // to rest so the indicator drops immediately rather than coasting through
      // the detector's hangover window.
      if (getState().voice.muted) {
        vad = createVoiceActivityState();
        report(false);
      } else {
        analyser.getFloatTimeDomainData(samples);
        vad = updateVoiceActivityFromSamples(vad, samples, dtMs);
        report(vad.speaking);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    onCleanup(() => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      try { source.disconnect(); } catch { /* node already detached */ }
      try { analyser.disconnect(); } catch { /* node already detached */ }
      void ctx.close().catch(() => {});
      if (reported) getState().setSpeakingNick(nick, false);
    });
  });

  // ── Reduced-motion preference ──────────────────────────────────────────────
  // Mirror prefers-reduced-motion into a signal so the focus pulse below can be
  // suppressed. matchMedia is stubbed in jsdom (matches:false), so tests treat
  // motion as allowed unless a fixture overrides it.
  createEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener?.('change', onChange);
    onCleanup(() => mql.removeEventListener?.('change', onChange));
  });

  // ── Active-speaker (auto-focus) tracker ─────────────────────────────────────
  // While in-call, advance the pure dominant-speaker tracker on a light timer,
  // feeding it the current who-is-speaking set (self + media peers). The tracker
  // supplies the sticky, flicker-free "who has the floor" decision that a naive
  // "first speaking peer" pick cannot. Everything (timer + tracker state) is
  // local to the effect and torn down on cleanup, so nothing leaks across calls.
  createEffect(() => {
    if (!isActive()) {
      setActiveSpeaker(null);
      return;
    }
    let tracker: ActiveSpeakerState = createActiveSpeakerState();
    let last = 0;

    const tick = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = last === 0 ? ACTIVE_SPEAKER_TICK_MS : now - last;
      last = now;

      const state = getState();
      const v = state.voice;
      const speaking = state.speakingNicks;
      // Present participants in proper case: self + the local media peers. The
      // store's speaking set is lowercased, so energySamplesFromSpeaking matches
      // case-insensitively while keeping display case for the readout.
      const present: string[] = [];
      const self = state.ourNick;
      if (self) present.push(self);
      for (const peer of v.peers.values()) present.push(peer.nick);

      tracker = advanceActiveSpeaker(tracker, energySamplesFromSpeaking(present, speaking), dt);
      setActiveSpeaker(tracker.dominant);
    };

    const timer = setInterval(tick, ACTIVE_SPEAKER_TICK_MS);
    tick();
    onCleanup(() => {
      clearInterval(timer);
      setActiveSpeaker(null);
    });
  });

  // Label for the active-speaker chip: distinguishes the local user ("You") from
  // remote participants. null when nobody holds the floor.
  const activeSpeakerLabel = createMemo(() => {
    const nick = activeSpeaker();
    if (!nick) return null;
    const self = selfNick();
    if (self && nick.toLowerCase() === self.toLowerCase()) return 'You';
    return displayNick(nick);
  });

  const handleToggleScreenshare = () => {
    if (voice().screenshareActive) {
      voice().stopScreenshare();
    } else {
      void voice().startScreenshare();
    }
  };

  const handleLeave = () => getState().leaveVoiceChannel();

  function setPositionForSpatialNick(nick: string, pos: SpatialAudioPosition): void {
    const engine = getMountedSuimyakuMediaEngine();
    if (!engine) return;
    const bridge = engine as unknown as SpatialRegistryBridge;
    const setter = bridge.registry?.setPositionForNick;
    if (setter) {
      setter(nick, pos);
      return;
    }
    engine.setPeerPan(nick, positionToStereoPan(pos));
  }

  const sendReaction = (emoji: string) => {
    getState().sendCallReaction(emoji);
    setReactionsOpen(false);
  };

  const spatialPointFromEvent = (event: PointerEvent) => {
    if (!spatialPadRef) return null;
    const rect = spatialPadRef.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    return {
      x: ((event.clientX - rect.left) / width) * 2 - 1,
      y: ((event.clientY - rect.top) / height) * 2 - 1,
    };
  };

  const applySpatialPadPoint = (point: { x: number; y: number }) => {
    const nick = currentSpatialNick();
    if (!nick) return;
    const pos = padToPosition(point);
    setLocalSpatialPosition(pos);
    setPositionForSpatialNick(nick, pos);
  };

  const handleSpatialPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const point = spatialPointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    setSpatialDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    applySpatialPadPoint(point);
  };

  const handleSpatialPointerMove = (event: PointerEvent) => {
    if (!spatialDragging()) return;
    const point = spatialPointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    applySpatialPadPoint(point);
  };

  const handleSpatialPointerUp = (event: PointerEvent) => {
    if (!spatialDragging()) return;
    setSpatialDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {}
  };

  const handleSpatialKeyDown = (event: KeyboardEvent) => {
    const pad = positionToPadPoint(activeSpatialPosition());
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applySpatialPadPoint({ x: pad.x - SPATIAL_PAD_KEY_STEP, y: pad.y });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      applySpatialPadPoint({ x: pad.x + SPATIAL_PAD_KEY_STEP, y: pad.y });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      applySpatialPadPoint({ x: pad.x, y: pad.y - SPATIAL_PAD_KEY_STEP });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      applySpatialPadPoint({ x: pad.x, y: pad.y + SPATIAL_PAD_KEY_STEP });
    } else if (event.key === 'Home') {
      event.preventDefault();
      applySpatialPadPoint({ x: 0, y: 0 });
    }
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
              {/* Active-speaker (auto-focus) chip. Visual-only promotion of the
                  participant currently holding the floor; the roster announcer
                  covers screen-reader presence, so this is aria-hidden to avoid
                  flooding SR users with per-utterance chatter. Motion is limited
                  to transform/opacity and suppressed under reduced-motion. */}
              <Show when={activeSpeakerLabel()} keyed>
                {(label) => (
                  <span
                    class="voice-bar__active-speaker"
                    data-testid="active-speaker"
                    data-nick={activeSpeaker() ?? undefined}
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex',
                      'align-items': 'center',
                      gap: '0.3em',
                      'margin-left': '0.5em',
                      padding: '0.05em 0.5em',
                      'border-radius': '999px',
                      'font-size': '0.82em',
                      'font-weight': '600',
                      color: 'var(--ok, #4ade80)',
                      background: 'color-mix(in oklab, var(--ok, #4ade80) 16%, transparent)',
                      'box-shadow': '0 0 0 1px color-mix(in oklab, var(--ok, #4ade80) 40%, transparent)',
                      transform: reducedMotion() ? 'none' : 'translateZ(0)',
                      transition: reducedMotion() ? 'none' : 'opacity 160ms ease, transform 160ms ease',
                      opacity: '1',
                    }}
                  >
                    <span aria-hidden="true">🎙</span>
                    <span class="voice-bar__active-speaker-name">{label}</span>
                  </span>
                )}
              </Show>
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
            <Show
              when={mediaAvailable()}
              fallback={
                <Tooltip content="Spatial audio unavailable" placement="top">
                  <button
                    type="button"
                    class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                    aria-label="Spatial audio unavailable"
                    disabled
                    data-testid="spatial-audio-unavailable-button"
                  >
                    <span class="onyx-icon-button__glyph" aria-hidden="true"><SpatialAudioIcon /></span>
                  </button>
                </Tooltip>
              }
            >
              <Popover
                placement="top"
                open={spatialOpen()}
                onOpenChange={setSpatialOpen}
                panelLabel="Spatial audio controls"
                trigger={
                  <span
                    class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                    aria-label={`Spatial audio controls, ${spatialStateLabel()}`}
                    data-testid="spatial-audio-button"
                    title={`Spatial audio: ${spatialStateLabel()}`}
                  >
                    <span class="onyx-icon-button__glyph" aria-hidden="true"><SpatialAudioIcon /></span>
                  </span>
                }
              >
                <div class="voice-bar__spatial">
                  <span class="voice-bar__spatial-title">Spatial audio</span>
                  <span class="voice-bar__spatial-state">{spatialStateLabel()}</span>
                  <Show when={currentSpatialNick()}>
                    {(nick) => (
                      <>
                        <div
                          ref={spatialPadRef}
                          role="application"
                          tabindex="0"
                          aria-roledescription="spatial audio position pad"
                          aria-label={`Spatial position for ${nick()}: ${spatialPositionLabel()}`}
                          aria-describedby={SPATIAL_PAD_HELP_ID}
                          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
                          data-testid="spatial-audio-pad"
                          style={{
                            width: `${SPATIAL_PAD_SIZE_PX}px`,
                            height: `${SPATIAL_PAD_SIZE_PX}px`,
                            position: 'relative',
                            'touch-action': 'none',
                            cursor: spatialDragging() ? 'grabbing' : 'crosshair',
                            border: '1px solid color-mix(in oklab, var(--lapis-bright) 42%, transparent)',
                            'border-radius': '8px',
                            background: 'color-mix(in oklab, var(--ink) 72%, var(--lapis) 10%)',
                          }}
                          onPointerDown={handleSpatialPointerDown}
                          onPointerMove={handleSpatialPointerMove}
                          onPointerUp={handleSpatialPointerUp}
                          onPointerCancel={handleSpatialPointerUp}
                          onKeyDown={handleSpatialKeyDown}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              left: '50%',
                              top: '0',
                              bottom: '0',
                              width: '1px',
                              background: 'color-mix(in oklab, var(--washi) 16%, transparent)',
                            }}
                          />
                          <span
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              left: '0',
                              right: '0',
                              top: '50%',
                              height: '1px',
                              background: 'color-mix(in oklab, var(--washi) 16%, transparent)',
                            }}
                          />
                          <span
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              width: '12px',
                              height: '12px',
                              'border-radius': '999px',
                              background: 'var(--lapis-bright)',
                              'box-shadow': '0 0 0 3px color-mix(in oklab, var(--lapis-bright) 28%, transparent)',
                              ...spatialDotStyle(),
                            }}
                          />
                        </div>
                        <span id={SPATIAL_PAD_HELP_ID} class="sr-only">
                          Use the arrow keys to move {nick()} around you; Home recenters.
                        </span>
                        <span
                          class="sr-only"
                          aria-live="polite"
                          data-testid="spatial-audio-position"
                        >
                          {spatialPositionLabel()}
                        </span>
                        <div
                          role="group"
                          aria-label="Spatial audio participants"
                          style={{ display: 'flex', gap: '4px', 'flex-wrap': 'wrap' }}
                        >
                          <For each={spatialPeers()}>{(peer) => (
                            <button
                              type="button"
                              aria-pressed={peer.nick === nick()}
                              onClick={() => {
                                setSelectedSpatialNick(peer.nick);
                                setLocalSpatialPosition(null);
                              }}
                              style={{
                                padding: '3px 6px',
                                'border-radius': '6px',
                                border: peer.nick === nick()
                                  ? '1px solid var(--lapis-bright)'
                                  : '1px solid color-mix(in oklab, var(--washi) 18%, transparent)',
                                color: peer.nick === nick() ? 'var(--washi)' : 'var(--washi-mute)',
                                background: 'transparent',
                                'font-size': '10px',
                                'font-weight': '800',
                              }}
                            >
                              {peer.nick}
                            </button>
                          )}</For>
                        </div>
                      </>
                    )}
                  </Show>
                  <Show when={voice().screenshareActive}>
                    <span class="voice-bar__spatial-note">Screen share stage</span>
                  </Show>
                </div>
              </Popover>
            </Show>

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

    </Show>
  );
}
