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
 *   Right:     security chip (shield for hop crypto; padlock only if media E2EE)
 *              + connection-quality pip
 *
 * All controls use the shared inline-SVG icon set (./icons) so the bar reads as
 * one system; each button keeps its aria-label and Tooltip.
 *
 * Toggle buttons expose aria-pressed; every control has an aria-label and a
 * Tooltip. The duration timer is announced politely via aria-live. The whole
 * bar is a role="toolbar". Reduced-motion is handled in voice.css.
 */

import { For, createEffect, createMemo, createSignal, onCleanup, Show, untrack } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import { getMountedCadenceMediaEngine } from '@/lib/cadence-media/MediaEngine';
import {
  DEFAULT_SPATIAL_POSITION,
  padToPosition,
  positionToPadPoint,
  positionToStereoPan,
  type SpatialAudioPosition,
} from '@/lib/cadence-media/spatialAudio';
import {
  createVoiceActivityState,
  updateVoiceActivityFromSamples,
} from '@/lib/cadence-media/voiceActivity';
import {
  advanceActiveSpeaker,
  createActiveSpeakerState,
  energySamplesFromSpeaking,
  type ActiveSpeakerState,
} from '@/lib/cadence-media/activeSpeaker';
import { shortDuration } from '@/lib/time/relativeTime';
import { createScreenWakeLockController } from '@/lib/screenWakeLock';
import { createCallMediaSessionController } from '@/lib/callMediaSession';
import { Avatar, Popover, Sheet, Tooltip } from '@/primitives';
import {
  MicIcon, MicOffIcon, DeafenIcon, DeafenOffIcon, CameraIcon, CameraOffIcon,
  ScreenShareIcon, ScreenShareStopIcon, CaptionsIcon, HandIcon, ReactionIcon,
  GridIcon, SpotlightIcon, SpatialAudioIcon, SettingsIcon, HangupIcon,
  ShieldIcon, LockIcon, LockOpenIcon, WarningIcon, StageIcon,
} from './icons';
import type { CallState, NetworkQualityTier } from '@/lib/cadence-media/types';
import {
  resolveCallSecurity,
  type CallSecurityAffordance,
  type CallSecurityIcon,
} from '@/lib/cadence-media/callSecurity';
import { resolveCallPrivacy } from '@/lib/cadence-media/callPrivacy';
import {
  advanceConnectionQualityAction,
  connectionQualityActionCopy,
  consumeConnectionQualityAction,
  INITIAL_CONNECTION_QUALITY_ACTION_STATE,
  type ConnectionQualityActionState,
} from '@/lib/cadence-media/connectionQualityAction';
import {
  advanceBandwidthLadderFeedback,
  bandwidthLadderNoticeCopy,
  consumeBandwidthLadderNotice,
  INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE,
} from '@/lib/cadence-media/bandwidthLadderFeedback';
import { mergeVoiceParticipants } from './voiceParticipants';
import './voice.css';

// ── Connection quality ────────────────────────────────────────────────────────

const TIER_META: Record<NetworkQualityTier, { label: string; color: string; bars: number }> = {
  0: { label: 'Excellent', color: 'var(--ok)',          bars: 4 },
  1: { label: 'Good',      color: 'var(--ok)',          bars: 3 },
  2: { label: 'Fair',      color: 'var(--gold-bright)', bars: 2 },
  3: { label: 'Poor',      color: 'var(--shu)',         bars: 1 },
};

// ── Call security chip ────────────────────────────────────────────────────────
// Honest hop-vs-E2EE affordance (research R1 / Era 1 A5). Padlock only when
// resolveCallSecurity says usesPadlock — hop-only media never claims E2EE.

function SecurityIcon(props: { kind: CallSecurityIcon }) {
  switch (props.kind) {
    case 'shield':
      return <ShieldIcon />;
    case 'lock':
      return <LockIcon />;
    case 'lock_open':
      return <LockOpenIcon />;
    case 'warning':
      return <WarningIcon />;
    case 'stage':
      return <StageIcon />;
    case 'spinner':
      return <span class="voice-sec__spinner" aria-hidden="true" />;
  }
}

function CallSecurityChip(props: {
  affordance: CallSecurityAffordance;
  onOpenPrivacy: () => void;
}) {
  const a = () => props.affordance;
  const tone = () => {
    switch (a().level) {
      case 'hop_protected':
      case 'e2ee':
        return 'ok';
      case 'e2ee_degraded':
      case 'connecting':
      case 'stage':
        return 'warn';
      case 'insecure':
        return 'danger';
    }
  };

  // Discoverable Privacy sheet (research R2): chip is a button, not a status
  // ornament — keyboard and pointer both open the honest call-details panel.
  return (
    <Tooltip content={`${a().detail} Open call privacy details.`} placement="top">
      <button
        type="button"
        class={`voice-sec voice-sec--${tone()} voice-sec--button`}
        aria-label={`${a().detail} Open call privacy details.`}
        aria-haspopup="dialog"
        data-testid="call-security-chip"
        data-security-level={a().level}
        data-uses-padlock={a().usesPadlock ? 'true' : 'false'}
        onClick={() => props.onOpenPrivacy()}
      >
        <span class="voice-sec__icon" aria-hidden="true" data-testid="call-security-icon">
          <SecurityIcon kind={a().icon} />
        </span>
        <span class="voice-sec__label">{a().label}</span>
      </button>
    </Tooltip>
  );
}

function CallPrivacySheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callState: CallState;
  mediaE2eeActive: boolean;
  mediaE2eeDegraded: boolean;
}) {
  // Same inputs as the security chip — sheet + chip cannot disagree.
  const details = createMemo(() => resolveCallPrivacy({
    callState: props.callState,
    mediaE2eeActive: props.mediaE2eeActive,
    mediaE2eeDegraded: props.mediaE2eeDegraded,
  }));

  return (
    <Sheet
      open={props.open}
      title={details()?.title ?? 'Call privacy'}
      description="How this call is protected."
      onOpenChange={props.onOpenChange}
      closeLabel="Close call privacy"
    >
      <Show when={details()} keyed>
        {(d) => (
          <div class="voice-privacy" data-testid="call-privacy-sheet" data-privacy-level={d.level}>
            <p class="voice-privacy__summary">{d.summary}</p>
            <dl class="voice-privacy__facts">
              <div class="voice-privacy__fact">
                <dt>Media path</dt>
                <dd data-testid="call-privacy-server-access">
                  {d.serverCanAccessMedia
                    ? 'Encrypted to this server — operators can access call media.'
                    : 'End-to-end — only people in this call can hear or see.'}
                </dd>
              </div>
              <div class="voice-privacy__fact">
                <dt>Privacy code</dt>
                <dd data-testid="call-privacy-epoch">
                  <Show
                    when={d.epochCode}
                    fallback="Available when end-to-end media encryption is active."
                  >
                    {(code) => <span class="voice-privacy__code">{code()}</span>}
                  </Show>
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Show>
    </Sheet>
  );
}

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

/** Browser display-capture support, guarded for non-browser test/tooling
 * environments. Read when VoiceBar mounts because browser capabilities are
 * stable for the lifetime of the page. */
function supportsDisplayCapture(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

interface NetSample {
  tier: NetworkQualityTier;
  suggestedBps: number;
  jitterMs: number;
  lossRate: number;
}

function ConnectionQualityPip() {
  const cameraOn = useStore(s => s.voice.cameraOn);
  const [sample, setSample] = createSignal<NetSample | null>(null);
  const [cqAction, setCqAction] = createSignal<ConnectionQualityActionState>(
    INITIAL_CONNECTION_QUALITY_ACTION_STATE,
  );
  // Ladder feedback is poll-driven only — no DOM binding, so a plain local
  // (not a signal) is enough to carry hysteresis across 1 Hz samples.
  let ladderState = INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE;

  let intervalId: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    const poll = () => {
      const engine = getMountedCadenceMediaEngine();
      // Optional on the mount surface — unit tests and half-mounted engines
      // may only stub join/leave. Never throw from the quality tick.
      const stats = engine && typeof engine.getNetworkStats === 'function'
        ? engine.getNetworkStats()
        : null;
      if (!stats) return;
      setSample({
        tier: stats.tier,
        suggestedBps: stats.suggestedBps,
        jitterMs: stats.jitterMs,
        lossRate: stats.lossRate,
      });
      // Research R6 — soft prompt only after pure hysteresis says so.
      setCqAction(prev => advanceConnectionQualityAction(prev, {
        nowMs: Date.now(),
        tier: stats.tier,
        cameraOn: cameraOn(),
      }));
      // Research R3 — calm one-shot toast when the bandwidth ladder steps down.
      const ladderNext = advanceBandwidthLadderFeedback(ladderState, {
        nowMs: Date.now(),
        tier: stats.tier,
      });
      if (ladderNext.pendingNotice) {
        const copy = bandwidthLadderNoticeCopy(ladderNext.pendingNotice);
        getState().addToast({
          variant: 'info',
          title: copy.title,
          description: copy.description,
          duration: 4500,
          groupKey: `bw-ladder-${ladderNext.pendingNotice}`,
        });
        ladderState = consumeBandwidthLadderNotice(ladderNext);
      } else {
        ladderState = ladderNext;
      }
    };
    poll();
    intervalId = setInterval(poll, 1000);
    onCleanup(() => {
      clearInterval(intervalId);
    });
  });

  // Camera off mid-poor-stretch must hide the prompt without waiting for poll.
  createEffect(() => {
    const on = cameraOn();
    setCqAction(prev => advanceConnectionQualityAction(prev, {
      nowMs: Date.now(),
      tier: sample()?.tier ?? prev.stableTier ?? 0,
      cameraOn: on,
    }));
  });

  const promptCopy = connectionQualityActionCopy('turn_off_camera');

  const turnOffCamera = () => {
    setCqAction(prev => consumeConnectionQualityAction(prev));
    void getState().toggleVideo();
  };

  const dismissPrompt = () => {
    setCqAction(prev => consumeConnectionQualityAction(prev));
  };

  return (
    <div class="voice-cq-wrap">
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
                data-cq-tier={String(s.tier)}
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

      <Show when={cqAction().showTurnOffCamera}>
        <div
          class="voice-cq-prompt"
          role="status"
          data-testid="connection-quality-prompt"
        >
          <span class="voice-cq-prompt__msg">{promptCopy.message}</span>
          <button
            type="button"
            class="voice-cq-prompt__action"
            data-testid="connection-quality-turn-off-camera"
            onClick={turnOffCamera}
          >
            {promptCopy.actionLabel}
          </button>
          <button
            type="button"
            class="voice-cq-prompt__dismiss"
            aria-label={promptCopy.dismissLabel}
            data-testid="connection-quality-dismiss"
            onClick={dismissPrompt}
          >
            ×
          </button>
        </div>
      </Show>
    </div>
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
  const voiceChannelParticipants = useStore(s => s.voiceChannelParticipants);
  const screenWakeLock = createScreenWakeLockController();
  const callMediaSession = createCallMediaSessionController({
    onToggleMicrophone: () => getState().toggleMute(),
    onToggleCamera: () => void getState().toggleVideo(),
    onHangup: () => getState().leaveVoiceChannel(),
  });

  const [reactionsOpen, setReactionsOpen] = createSignal(false);
  const [reactionIndex, setReactionIndex] = createSignal(0);
  const [privacyOpen, setPrivacyOpen] = createSignal(false);
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
  const [displayCaptureAvailable, setDisplayCaptureAvailable] = createSignal(
    supportsDisplayCapture(),
  );
  const [screensharePending, setScreensharePending] = createSignal(false);
  const [screenshareStatus, setScreenshareStatus] = createSignal('');

  let spatialPadRef: HTMLDivElement | undefined;
  const reactionButtons: (HTMLButtonElement | undefined)[] = [];
  let screenshareOperationEpoch = 0;
  let disposed = false;

  const isActive = createMemo(() =>
    voice().callState === 'in_call' || voice().callState === 'ringing_out' || voice().callState === 'ringing_in'
  );

  const channelLabel = createMemo(() => voice().callChannel ?? voice().callWith ?? '');
  const selfNick = createMemo(() => ourNick() ?? '');
  const participantCount = createMemo(() => {
    const channel = voice().callChannel;
    const roster = channel ? voiceChannelParticipants().get(channel.toLowerCase()) : undefined;
    return mergeVoiceParticipants(selfNick() || 'you', voice().peers, roster).length;
  });
  const securityAffordance = createMemo(() =>
    resolveCallSecurity({
      callState: voice().callState,
      mediaE2eeActive: voice().mediaE2eeActive,
      mediaE2eeDegraded: voice().mediaE2eeDegraded,
    }),
  );
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

  // Ringing surfaces can remain mounted for a long time, but only an accepted
  // call is real active media and warrants keeping the display awake.
  createEffect(() => {
    screenWakeLock.setActive(voice().callState === 'in_call');
  });

  createEffect(() => {
    callMediaSession.update({
      active: voice().callState === 'in_call',
      muted: voice().muted,
      cameraOn: voice().cameraOn,
    });
  });

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
    disposed = true;
    screenshareOperationEpoch += 1;
    setSpatialDragging(false);
    screenWakeLock.dispose();
    callMediaSession.dispose();
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

  const screenshareUnavailable = createMemo(() =>
    !voice().screenshareActive && (!mediaAvailable() || !displayCaptureAvailable())
  );
  const screenshareLabel = createMemo(() => {
    if (voice().screenshareActive) return 'Stop sharing screen';
    if (screensharePending()) return 'Starting screen sharing';
    return screenshareUnavailable() ? 'Screen sharing unavailable' : 'Share screen';
  });

  const handleToggleScreenshare = async (): Promise<void> => {
    if (voice().screenshareActive) {
      screenshareOperationEpoch += 1;
      setScreensharePending(false);
      voice().stopScreenshare();
      setScreenshareStatus('Screen sharing stopped');
      return;
    }
    if (screensharePending()) return;
    if (!mediaAvailable() || !supportsDisplayCapture()) {
      setDisplayCaptureAvailable(false);
      return;
    }
    const epoch = ++screenshareOperationEpoch;
    const startScreenshare = voice().startScreenshare;
    setScreensharePending(true);
    setScreenshareStatus('Requesting screen sharing permission');
    try {
      await startScreenshare();
      if (disposed || epoch !== screenshareOperationEpoch) return;
      setScreenshareStatus(
        getState().voice.screenshareActive
          ? 'Screen sharing started'
          : 'Screen sharing did not start. Check browser permission and try again',
      );
    } catch {
      if (disposed || epoch !== screenshareOperationEpoch) return;
      setScreenshareStatus('Screen sharing could not start. Check browser permission and try again');
    } finally {
      if (!disposed && epoch === screenshareOperationEpoch) setScreensharePending(false);
    }
  };

  const handleLeave = () => getState().leaveVoiceChannel();

  function setPositionForSpatialNick(nick: string, pos: SpatialAudioPosition): void {
    const engine = getMountedCadenceMediaEngine();
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

  const setReactionPickerOpen = (open: boolean): void => {
    if (open) setReactionIndex(0);
    setReactionsOpen(open);
  };

  createEffect(() => {
    if (!reactionsOpen()) return;
    queueMicrotask(() => {
      const first = reactionButtons[0];
      if (untrack(reactionsOpen) && first?.isConnected) first.focus({ preventScroll: true });
    });
  });

  function focusReaction(index: number): void {
    const count = QUICK_REACTIONS.length;
    const next = ((index % count) + count) % count;
    setReactionIndex(next);
    reactionButtons[next]?.focus({ preventScroll: true });
  }

  function handleReactionKeyDown(event: KeyboardEvent, index: number): void {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = QUICK_REACTIONS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusReaction(next);
  }

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
              <Show when={voice().callState === 'in_call'}>
                <CallTimer active startedAt={voice().callStartedAt} />
                <span class="voice-bar__dot" aria-hidden="true">·</span>
              </Show>
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

            <Tooltip content={screenshareLabel()} placement="top">
              <button
                type="button"
                class="onyx-icon-button onyx-icon-button--ghost onyx-icon-button--md"
                aria-label={screenshareLabel()}
                aria-pressed={voice().screenshareActive}
                aria-busy={screensharePending() && !voice().screenshareActive}
                title={screenshareLabel()}
                disabled={screenshareUnavailable() || (screensharePending() && !voice().screenshareActive)}
                onClick={() => void handleToggleScreenshare()}
                data-testid="screenshare-button"
              >
                <span class="onyx-icon-button__glyph" aria-hidden="true">
                  <Show when={voice().screenshareActive} fallback={<ScreenShareIcon />}><ScreenShareStopIcon /></Show>
                </span>
              </button>
            </Tooltip>
            <span
              class="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="screenshare-status"
            >
              {screenshareStatus()}
            </span>
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
              onOpenChange={setReactionPickerOpen}
              panelLabel="Send a reaction"
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
                <For each={QUICK_REACTIONS}>{(emoji, index) => (
                  <button
                    ref={(element) => (reactionButtons[index()] = element)}
                    type="button"
                    class="voice-bar__reaction"
                    role="menuitem"
                    tabindex={reactionIndex() === index() ? 0 : -1}
                    aria-label={`React with ${emoji}`}
                    data-testid={`reaction-${emoji}`}
                    onFocus={() => setReactionIndex(index())}
                    onKeyDown={(event) => handleReactionKeyDown(event, index())}
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
                              class="voice-bar__spatial-participant"
                              aria-pressed={peer.nick === nick()}
                              onClick={() => {
                                setSelectedSpatialNick(peer.nick);
                                setLocalSpatialPosition(null);
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

        {/* Right: security honesty chip + connection quality */}
        <div class="voice-bar__right">
          <Show when={securityAffordance()} keyed>
            {(affordance) => (
              <CallSecurityChip
                affordance={affordance}
                onOpenPrivacy={() => setPrivacyOpen(true)}
              />
            )}
          </Show>
          <ConnectionQualityPip />
        </div>
      </div>

      <CallPrivacySheet
        open={privacyOpen()}
        onOpenChange={setPrivacyOpen}
        callState={voice().callState}
        mediaE2eeActive={voice().mediaE2eeActive}
        mediaE2eeDegraded={voice().mediaE2eeDegraded}
      />
    </Show>
  );
}
