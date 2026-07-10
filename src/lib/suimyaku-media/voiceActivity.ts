// Pure, DOM-free voice-activity / audio-level detection core.
//
// This is the testable heart of a "who is speaking" indicator: an
// exponential-smoothing RMS envelope follower with independent attack/decay
// time constants, a hysteresis band (separate rise/fall thresholds so the
// speaking flag does not chatter at the boundary), and a hangover/hold time so
// brief dips do not drop the "speaking" state.
//
// Everything here is a pure function over a small immutable state object:
// `next = updateVoiceActivity(prev, sample, dtMs, config)`. No AudioContext, no
// AnalyserNode, no globals, no timers — deterministic and unit-testable in
// isolation. A VoiceBar effect would own the AnalyserNode, pull samples, and
// feed them through this core imperatively.

/** Tunable parameters for the detector. All fields optional at the edge; use
 * `resolveVoiceActivityConfig` to fill in and sanitize defaults. */
export interface VoiceActivityConfig {
  /** Envelope level in [0,1] at/above which a non-speaking state turns on. */
  readonly riseThreshold: number;
  /** Envelope level in [0,1] below which a speaking state may turn off (after
   * hangover). Must be <= riseThreshold to form a hysteresis band. */
  readonly fallThreshold: number;
  /** Attack time constant (ms) used while the envelope is rising toward a
   * louder sample. Smaller = snappier onset. */
  readonly attackMs: number;
  /** Decay time constant (ms) used while the envelope is falling toward a
   * quieter sample. Larger = smoother release. */
  readonly decayMs: number;
  /** Hold time (ms) the speaking flag is kept alive after the level drops below
   * fallThreshold, so short gaps between words do not flicker the indicator. */
  readonly hangoverMs: number;
}

/** Immutable detector state. Treat as opaque; build with
 * `createVoiceActivityState` and advance with `updateVoiceActivity`. */
export interface VoiceActivityState {
  /** Smoothed envelope level in [0,1]. */
  readonly level: number;
  /** Whether the source is currently considered speaking. */
  readonly speaking: boolean;
  /** Remaining hangover budget in ms before speaking may drop. */
  readonly holdRemainingMs: number;
}

export const VOICE_LEVEL_MIN = 0;
export const VOICE_LEVEL_MAX = 1;

/** Conservative, chatter-resistant defaults tuned for mic RMS in [0,1]. */
export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = Object.freeze({
  riseThreshold: 0.06,
  fallThreshold: 0.03,
  attackMs: 20,
  decayMs: 150,
  hangoverMs: 250,
});

/** Initial "silent, not speaking" state. */
export const INITIAL_VOICE_ACTIVITY_STATE: VoiceActivityState = Object.freeze({
  level: 0,
  speaking: false,
  holdRemainingMs: 0,
});

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function nonNegative(value: number | undefined, fallback: number): number {
  const resolved = finiteOr(value, fallback);
  return resolved < 0 ? 0 : resolved;
}

/**
 * Fill in and sanitize a partial config. Thresholds are clamped to [0,1], time
 * constants forced non-negative, and fallThreshold is clamped to at most
 * riseThreshold so the hysteresis band is always well-formed (fall <= rise).
 */
export function resolveVoiceActivityConfig(
  partial: Partial<VoiceActivityConfig> = {},
): VoiceActivityConfig {
  const riseThreshold = clamp(
    finiteOr(partial.riseThreshold, DEFAULT_VOICE_ACTIVITY_CONFIG.riseThreshold),
    VOICE_LEVEL_MIN,
    VOICE_LEVEL_MAX,
  );
  const fallRaw = clamp(
    finiteOr(partial.fallThreshold, DEFAULT_VOICE_ACTIVITY_CONFIG.fallThreshold),
    VOICE_LEVEL_MIN,
    VOICE_LEVEL_MAX,
  );
  // Keep the band well-formed: the release threshold can never exceed the
  // trigger threshold, otherwise there is no hysteresis and it would chatter.
  const fallThreshold = Math.min(fallRaw, riseThreshold);

  return {
    riseThreshold,
    fallThreshold,
    attackMs: nonNegative(partial.attackMs, DEFAULT_VOICE_ACTIVITY_CONFIG.attackMs),
    decayMs: nonNegative(partial.decayMs, DEFAULT_VOICE_ACTIVITY_CONFIG.decayMs),
    hangoverMs: nonNegative(partial.hangoverMs, DEFAULT_VOICE_ACTIVITY_CONFIG.hangoverMs),
  };
}

/** Build a fresh silent state (optionally seeding a starting level). */
export function createVoiceActivityState(initialLevel = 0): VoiceActivityState {
  const level = clamp(finiteOr(initialLevel, 0), VOICE_LEVEL_MIN, VOICE_LEVEL_MAX);
  if (level === 0) return INITIAL_VOICE_ACTIVITY_STATE;
  return { level, speaking: false, holdRemainingMs: 0 };
}

/**
 * RMS of a block of PCM-ish samples in [-1,1], returned in [0,1]. Pure helper
 * so a caller can turn an AnalyserNode time-domain frame into a single level
 * before feeding `updateVoiceActivity`. Empty/invalid input yields 0.
 */
export function computeRms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n <= 0) return 0;
  let sumSquares = 0;
  let counted = 0;
  for (let i = 0; i < n; i += 1) {
    const s = samples[i];
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    sumSquares += s * s;
    counted += 1;
  }
  if (counted === 0) return 0;
  const rms = Math.sqrt(sumSquares / counted);
  return clamp(rms, VOICE_LEVEL_MIN, VOICE_LEVEL_MAX);
}

/**
 * Smoothing factor for one step of an exponential moving average given a time
 * constant tau (ms) and elapsed dtMs. alpha = 1 - exp(-dt/tau), clamped to
 * [0,1]. tau <= 0 means "instantaneous" (alpha = 1); dt <= 0 means "no time
 * passed" (alpha = 0).
 */
function smoothingAlpha(tauMs: number, dtMs: number): number {
  if (dtMs <= 0) return 0;
  if (tauMs <= 0) return 1;
  return clamp(1 - Math.exp(-dtMs / tauMs), 0, 1);
}

/**
 * Advance the detector by one sample. `sample` is an instantaneous level in
 * [0,1] (e.g. block RMS); `dtMs` is elapsed time since the previous update.
 * Returns a new immutable state — `prev` is never mutated.
 *
 * Envelope: attack time constant is used when the sample is louder than the
 * current envelope, decay when quieter. Speaking: hysteresis picks the active
 * threshold from the current speaking flag (rise to turn on, fall to stay on),
 * and a hangover budget holds the flag through brief sub-threshold dips.
 */
export function updateVoiceActivity(
  prev: VoiceActivityState,
  sample: number,
  dtMs: number,
  config: VoiceActivityConfig = DEFAULT_VOICE_ACTIVITY_CONFIG,
): VoiceActivityState {
  const target = clamp(finiteOr(sample, 0), VOICE_LEVEL_MIN, VOICE_LEVEL_MAX);
  const step = Math.max(0, finiteOr(dtMs, 0));

  const tau = target > prev.level ? config.attackMs : config.decayMs;
  const alpha = smoothingAlpha(tau, step);
  const level = clamp(prev.level + alpha * (target - prev.level), VOICE_LEVEL_MIN, VOICE_LEVEL_MAX);

  // Hysteresis: when idle we require the (higher) rise threshold to trigger;
  // once speaking we only require the (lower) fall threshold to stay active.
  const threshold = prev.speaking ? config.fallThreshold : config.riseThreshold;
  const active = level >= threshold;

  let speaking: boolean;
  let holdRemainingMs: number;
  if (active) {
    speaking = true;
    holdRemainingMs = config.hangoverMs;
  } else {
    holdRemainingMs = Math.max(0, prev.holdRemainingMs - step);
    // Only a currently-speaking source can coast on hangover; a silent source
    // stays silent.
    speaking = prev.speaking && holdRemainingMs > 0;
  }

  return { level, speaking, holdRemainingMs };
}

/**
 * Convenience: compute RMS of a sample block and advance the detector. Keeps
 * the AnalyserNode -> level -> state pipeline in one deterministic call for
 * callers that already hold a time-domain frame.
 */
export function updateVoiceActivityFromSamples(
  prev: VoiceActivityState,
  samples: ArrayLike<number>,
  dtMs: number,
  config: VoiceActivityConfig = DEFAULT_VOICE_ACTIVITY_CONFIG,
): VoiceActivityState {
  return updateVoiceActivity(prev, computeRms(samples), dtMs, config);
}
