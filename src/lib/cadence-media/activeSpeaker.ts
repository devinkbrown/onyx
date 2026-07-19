// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure, DOM-free active-speaker / dominant-speaker tracker.
//
// This is the testable core of "auto-focus the person talking": given a stream
// of per-peer energy samples over time it maintains a smoothed energy per peer,
// a ranked speaker list, and a single *sticky* dominant speaker chosen with the
// same hysteresis real SFUs use (Jitsi's dominant-speaker identification, the
// classic "loudest active talker" heuristic):
//
//   1. The first talker to cross the floor becomes dominant immediately.
//   2. Focus is sticky — a challenger only takes over if it holds a clear
//      energy lead (>= switchMargin) over the current dominant for a sustained
//      window (switchHoldMs). Two equally-loud talkers never flip-flop the
//      spotlight; only a genuinely louder, sustained voice wins it.
//   3. When the dominant falls silent, focus coasts through brief gaps between
//      words and is only released after releaseMs of continuous silence, at
//      which point a still-talking peer inherits it.
//   4. A peer absent from a sample set is treated as having left the call and is
//      evicted; the tracked map is additionally hard-capped at maxPeers.
//
// Everything here is a pure function over an immutable state object:
// `next = advanceActiveSpeaker(prev, samples, dtMs, config)`. No AudioContext,
// no AnalyserNode, no globals, no timers — deterministic and unit-testable in
// isolation. A VoiceBar effect owns the sampling clock, reads who-is-speaking
// from the store, and feeds this core imperatively.

/** Tunable parameters for the tracker. All fields optional at the edge; use
 * `resolveActiveSpeakerConfig` to fill in and sanitize defaults. */
export interface ActiveSpeakerConfig {
  /** EMA time constant (ms) for per-peer energy smoothing. Larger = steadier. */
  readonly smoothingMs: number;
  /** Minimum smoothed energy in [0,1] for a peer to be a dominance candidate. */
  readonly speakingFloor: number;
  /** Energy lead (in [0,1]) a challenger must hold over the current dominant to
   * even begin contending for the spotlight. Prevents equal-volume flip-flop. */
  readonly switchMargin: number;
  /** Duration (ms) a challenger must sustain its lead before focus transfers. */
  readonly switchHoldMs: number;
  /** Duration (ms) the dominant may stay silent (below floor) before focus is
   * released — coasts the spotlight through brief gaps between words. */
  readonly releaseMs: number;
  /** Hard cap on the number of tracked peers, so a spurious flood of nicks can
   * never grow the map without bound. */
  readonly maxPeers: number;
}

/** Immutable tracker state. Treat as opaque; build with
 * `createActiveSpeakerState` and advance with `advanceActiveSpeaker`. */
export interface ActiveSpeakerState {
  /** Per-peer smoothed energy in [0,1], keyed by the nick the caller supplied. */
  readonly peers: ReadonlyMap<string, number>;
  /** The current sticky dominant speaker, or null when nobody is talking. */
  readonly dominant: string | null;
  /** The peer currently challenging for the spotlight, or null. */
  readonly challenger: string | null;
  /** How long (ms) the current challenger has sustained its lead. */
  readonly challengeMs: number;
  /** How long (ms) the current dominant has been continuously below the floor. */
  readonly silentMs: number;
}

export const ACTIVE_SPEAKER_ENERGY_MIN = 0;
export const ACTIVE_SPEAKER_ENERGY_MAX = 1;

/** Conservative, flicker-resistant defaults. Tuned to work both for boolean
 * speaking flags mapped to {0,1} and for real RMS energy in [0,1]. */
export const DEFAULT_ACTIVE_SPEAKER_CONFIG: ActiveSpeakerConfig = Object.freeze({
  smoothingMs: 200,
  speakingFloor: 0.15,
  switchMargin: 0.1,
  switchHoldMs: 400,
  releaseMs: 800,
  maxPeers: 64,
});

/** Initial "nobody talking" state. */
export const INITIAL_ACTIVE_SPEAKER_STATE: ActiveSpeakerState = Object.freeze({
  peers: Object.freeze(new Map<string, number>()),
  dominant: null,
  challenger: null,
  challengeMs: 0,
  silentMs: 0,
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
 * Fill in and sanitize a partial config. Floor/margin are clamped to [0,1],
 * time constants forced non-negative, and maxPeers coerced to a positive
 * integer so the tracked map can never grow unbounded.
 */
export function resolveActiveSpeakerConfig(
  partial: Partial<ActiveSpeakerConfig> = {},
): ActiveSpeakerConfig {
  const maxPeersRaw = Math.floor(finiteOr(partial.maxPeers, DEFAULT_ACTIVE_SPEAKER_CONFIG.maxPeers));
  return {
    smoothingMs: nonNegative(partial.smoothingMs, DEFAULT_ACTIVE_SPEAKER_CONFIG.smoothingMs),
    speakingFloor: clamp(
      finiteOr(partial.speakingFloor, DEFAULT_ACTIVE_SPEAKER_CONFIG.speakingFloor),
      ACTIVE_SPEAKER_ENERGY_MIN,
      ACTIVE_SPEAKER_ENERGY_MAX,
    ),
    switchMargin: clamp(
      finiteOr(partial.switchMargin, DEFAULT_ACTIVE_SPEAKER_CONFIG.switchMargin),
      ACTIVE_SPEAKER_ENERGY_MIN,
      ACTIVE_SPEAKER_ENERGY_MAX,
    ),
    switchHoldMs: nonNegative(partial.switchHoldMs, DEFAULT_ACTIVE_SPEAKER_CONFIG.switchHoldMs),
    releaseMs: nonNegative(partial.releaseMs, DEFAULT_ACTIVE_SPEAKER_CONFIG.releaseMs),
    maxPeers: maxPeersRaw < 1 ? 1 : maxPeersRaw,
  };
}

/** Build a fresh empty tracker state. */
export function createActiveSpeakerState(): ActiveSpeakerState {
  return INITIAL_ACTIVE_SPEAKER_STATE;
}

/**
 * Smoothing factor for one EMA step given a time constant tau (ms) and elapsed
 * dtMs. alpha = 1 - exp(-dt/tau), clamped to [0,1]. tau <= 0 means
 * "instantaneous" (alpha = 1); dt <= 0 means "no time passed" (alpha = 0).
 */
function smoothingAlpha(tauMs: number, dtMs: number): number {
  if (dtMs <= 0) return 0;
  if (tauMs <= 0) return 1;
  return clamp(1 - Math.exp(-dtMs / tauMs), 0, 1);
}

/**
 * Highest-energy peer at/above `floor`, tie-broken by nick ascending so the
 * result is deterministic. `exclude` skips one nick (used to find the best
 * challenger that is not the current dominant). Returns null if none qualify.
 */
function topPeer(
  peers: ReadonlyMap<string, number>,
  floor: number,
  exclude: string | null,
): { nick: string; energy: number } | null {
  let bestNick: string | null = null;
  let bestEnergy = -1;
  for (const [nick, energy] of peers) {
    if (nick === exclude) continue;
    if (energy < floor) continue;
    if (energy > bestEnergy || (energy === bestEnergy && bestNick !== null && nick < bestNick)) {
      bestNick = nick;
      bestEnergy = energy;
    }
  }
  return bestNick === null ? null : { nick: bestNick, energy: bestEnergy };
}

/**
 * Advance the tracker by one sample set. `samples` is an iterable of
 * `[nick, energy]` for every participant present this tick (energy in [0,1];
 * a boolean speaking flag maps to 1/0). Any previously-tracked nick absent from
 * `samples` is treated as having left and is evicted. `dtMs` is elapsed time
 * since the previous call. Returns a new immutable state — `prev` is untouched.
 */
export function advanceActiveSpeaker(
  prev: ActiveSpeakerState,
  samples: Iterable<readonly [string, number]>,
  dtMs: number,
  config: ActiveSpeakerConfig = DEFAULT_ACTIVE_SPEAKER_CONFIG,
): ActiveSpeakerState {
  const step = Math.max(0, finiteOr(dtMs, 0));
  const alpha = smoothingAlpha(config.smoothingMs, step);

  // Smooth each present peer's energy; dedupe (first wins) and cap at maxPeers.
  const peers = new Map<string, number>();
  for (const [nick, rawEnergy] of samples) {
    if (peers.size >= config.maxPeers) break;
    if (peers.has(nick)) continue;
    const target = clamp(finiteOr(rawEnergy, 0), ACTIVE_SPEAKER_ENERGY_MIN, ACTIVE_SPEAKER_ENERGY_MAX);
    const prevEnergy = prev.peers.get(nick) ?? 0;
    const energy = clamp(prevEnergy + alpha * (target - prevEnergy), ACTIVE_SPEAKER_ENERGY_MIN, ACTIVE_SPEAKER_ENERGY_MAX);
    peers.set(nick, energy);
  }

  let dominant = prev.dominant;
  let challenger = prev.challenger;
  let challengeMs = prev.challengeMs;
  let silentMs = prev.silentMs;

  // A dominant/challenger who left the call is gone: no coasting for absentees.
  if (dominant !== null && !peers.has(dominant)) {
    dominant = null;
    silentMs = 0;
  }
  if (challenger !== null && !peers.has(challenger)) {
    challenger = null;
    challengeMs = 0;
  }

  const top = topPeer(peers, config.speakingFloor, null);

  if (dominant === null) {
    // Open spotlight: the loudest active talker claims it at once.
    dominant = top ? top.nick : null;
    challenger = null;
    challengeMs = 0;
    silentMs = 0;
  } else {
    const dominantEnergy = peers.get(dominant) ?? 0;
    if (dominantEnergy < config.speakingFloor) {
      // Dominant has gone quiet: coast through brief gaps, release after silence.
      silentMs += step;
      if (silentMs >= config.releaseMs) {
        dominant = top ? top.nick : null;
        challenger = null;
        challengeMs = 0;
        silentMs = 0;
      }
    } else {
      silentMs = 0;
      const contender = topPeer(peers, config.speakingFloor, dominant);
      if (contender && contender.energy >= dominantEnergy + config.switchMargin) {
        // A clearly-louder challenger: it must sustain the lead to take over.
        if (contender.nick === challenger) {
          challengeMs += step;
        } else {
          challenger = contender.nick;
          challengeMs = step;
        }
        if (challengeMs >= config.switchHoldMs) {
          dominant = challenger;
          challenger = null;
          challengeMs = 0;
        }
      } else {
        challenger = null;
        challengeMs = 0;
      }
    }
  }

  return { peers, dominant, challenger, challengeMs, silentMs };
}

/**
 * Snapshot the tracked peers as a nick list ordered by smoothed energy
 * descending, tie-broken by nick ascending for determinism. `minEnergy`
 * filters out peers quieter than a threshold (default 0 = list everyone).
 */
export function rankedSpeakers(state: ActiveSpeakerState, minEnergy = 0): readonly string[] {
  const entries: Array<[string, number]> = [];
  for (const [nick, energy] of state.peers) {
    if (energy >= minEnergy) entries.push([nick, energy]);
  }
  entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([nick]) => nick);
}

/**
 * Build an energy-sample list from a present participant set and a
 * who-is-speaking set: each present nick yields energy 1 when it appears in
 * `speaking` (case-insensitive) and 0 otherwise. This is the boolean-flag
 * bridge used by the voice UI, whose speaking set is stored lowercased while
 * the roster preserves display case.
 */
export function energySamplesFromSpeaking(
  present: Iterable<string>,
  speaking: ReadonlySet<string>,
): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const nick of present) {
    out.push([nick, speaking.has(nick.toLowerCase()) ? 1 : 0]);
  }
  return out;
}
