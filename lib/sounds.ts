/**
 * Ocean notification sounds — premium Web Audio API synthesis.
 * No external assets required. All synthesis is pure Web Audio.
 */

export type SoundId =
  | 'message'
  | 'mention'
  | 'dm'
  | 'join'
  | 'leave'
  | 'send'
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'pop'
  | 'ding'
  | 'voice_join'
  | 'voice_leave'
  | 'notification';

// ── Shared audio context ───────────────────────────────────────────────────

let _ctx: AudioContext | null = null;
let _masterGain: GainNode | null = null;

function getCtx(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!_ctx || _ctx.state === 'closed') {
      _ctx = new AudioContext();
      _masterGain = _ctx.createGain();
      _masterGain.gain.value = 1;
      _masterGain.connect(_ctx.destination);
    }
    return { ctx: _ctx, master: _masterGain! };
  } catch {
    return null;
  }
}

/** Set master volume (0–1). Applied to all subsequent and currently-playing sounds. */
export function setSoundsVolume(vol: number): void {
  const pair = getCtx();
  if (!pair) return;
  pair.master.gain.setTargetAtTime(
    Math.max(0, Math.min(1, vol)),
    pair.ctx.currentTime,
    0.02,
  );
}

// ── Reverb utility ─────────────────────────────────────────────────────────

function addReverb(
  ctx: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  duration = 0.3,
): void {
  const convolver = ctx.createConvolver();
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
  }
  convolver.buffer = impulse;
  source.connect(convolver);
  convolver.connect(destination);
}

// ── Low-level helpers ──────────────────────────────────────────────────────

interface ToneOptions {
  freq: number;
  duration: number;
  volume?: number;
  type?: OscillatorType;
  startDelay?: number;
  attackTime?: number;
  reverb?: boolean;
  reverbDuration?: number;
}

function playTone(opts: ToneOptions): void {
  const pair = getCtx();
  if (!pair) return;
  const { ctx, master } = pair;

  const {
    freq,
    duration,
    volume = 0.1,
    type = 'sine',
    startDelay = 0,
    attackTime = 0.008,
    reverb = false,
    reverbDuration = 0.25,
  } = opts;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    const now = ctx.currentTime + startDelay;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attackTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    if (reverb) {
      addReverb(ctx, gain, master, reverbDuration);
    }

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  } catch {
    // AudioContext blocked or unavailable — degrade silently
  }
}

function playNoise(
  duration: number,
  volume: number,
  startDelay = 0,
  highpass = 800,
): void {
  const pair = getCtx();
  if (!pair) return;
  const { ctx, master } = pair;

  try {
    const bufLen = Math.ceil(ctx.sampleRate * (duration + 0.01));
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) ch[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    const now = ctx.currentTime + startDelay;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now);
    src.stop(now + duration + 0.01);
  } catch {
    // degrade silently
  }
}

// ── Sound definitions ──────────────────────────────────────────────────────

function soundMessage(): void {
  // Subtle soft click — G5 sine, very short
  playTone({ freq: 783, duration: 0.08, volume: 0.03, type: 'sine', attackTime: 0.004 });
}

function soundMention(): void {
  // Ascending two-note chime — C6 → E6, triangle, reverby
  playTone({ freq: 1047, duration: 0.12, volume: 0.12, type: 'triangle', attackTime: 0.006, reverb: true, reverbDuration: 0.2 });
  playTone({ freq: 1319, duration: 0.18, volume: 0.12, type: 'triangle', startDelay: 0.08, attackTime: 0.006, reverb: true, reverbDuration: 0.28 });
}

function soundDm(): void {
  // Warm sweep 440 → 660 Hz — uses two tones to approximate sweep
  const pair = getCtx();
  if (!pair) return;
  const { ctx, master } = pair;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.2);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch {
    // degrade silently
  }
}

function soundJoin(): void {
  // Soft ascending C-E-G arpeggio
  const freqs = [523, 659, 784];
  freqs.forEach((freq, i) => {
    playTone({ freq, duration: 0.15, volume: 0.07, type: 'sine', startDelay: i * 0.06, attackTime: 0.01 });
  });
}

function soundLeave(): void {
  // Descending G-E-C arpeggio, slightly quieter
  const freqs = [784, 659, 523];
  freqs.forEach((freq, i) => {
    playTone({ freq, duration: 0.13, volume: 0.05, type: 'sine', startDelay: i * 0.05, attackTime: 0.008 });
  });
}

function soundSend(): void {
  // Crisp white-noise whoosh with highpass — very short
  playNoise(0.03, 0.04, 0, 1200);
}

function soundConnect(): void {
  // Warm triumphant C-E-G ascending with gentle attack
  const freqs = [523, 659, 784];
  freqs.forEach((freq, i) => {
    playTone({ freq, duration: 0.22, volume: 0.1, type: 'sine', startDelay: i * 0.1, attackTime: 0.02 });
  });
}

function soundDisconnect(): void {
  // Descending E4 → C4, slight reverb — minor feel
  playTone({ freq: 330, duration: 0.25, volume: 0.08, type: 'sine', attackTime: 0.015, reverb: true, reverbDuration: 0.35 });
  playTone({ freq: 262, duration: 0.3, volume: 0.08, type: 'sine', startDelay: 0.18, attackTime: 0.015, reverb: true, reverbDuration: 0.35 });
}

function soundError(): void {
  // Dissonant minor second — 320 Hz + 337 Hz simultaneously
  playTone({ freq: 320, duration: 0.2, volume: 0.08, type: 'sawtooth', attackTime: 0.006 });
  playTone({ freq: 337, duration: 0.2, volume: 0.08, type: 'sawtooth', attackTime: 0.006 });
}

function soundPop(): void {
  // Minimal click — exponential frequency sweep 800 → 200 Hz
  const pair = getCtx();
  if (!pair) return;
  const { ctx, master } = pair;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.05);
  } catch {
    // degrade silently
  }
}

function soundDing(): void {
  // Gentle ding — high triangle with natural decay
  playTone({ freq: 1760, duration: 0.35, volume: 0.08, type: 'triangle', attackTime: 0.005, reverb: true, reverbDuration: 0.3 });
}

function soundVoiceJoin(): void {
  // C5 + G5 perfect fifth chord swell — 300 ms fade in
  const pair = getCtx();
  if (!pair) return;
  const { ctx, master } = pair;

  const chordFreqs = [523, 784];
  chordFreqs.forEach(freq => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.07, now + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch {
      // degrade silently
    }
  });
}

function soundVoiceLeave(): void {
  // Same fifth chord but fades out
  const pair = getCtx();
  if (!pair) return;
  const { ctx, master } = pair;

  const chordFreqs = [523, 784];
  chordFreqs.forEach(freq => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.45);
    } catch {
      // degrade silently
    }
  });
}

function soundNotification(): void {
  // OS-style ding — two-note ascending (A4 → C5), clean sine
  playTone({ freq: 440, duration: 0.12, volume: 0.1, type: 'sine', attackTime: 0.008 });
  playTone({ freq: 523, duration: 0.18, volume: 0.1, type: 'sine', startDelay: 0.1, attackTime: 0.008, reverb: true, reverbDuration: 0.22 });
}

// ── Public SOUNDS map ──────────────────────────────────────────────────────

export const SOUNDS: Record<SoundId, () => void> = {
  message:      soundMessage,
  mention:      soundMention,
  dm:           soundDm,
  join:         soundJoin,
  leave:        soundLeave,
  send:         soundSend,
  connect:      soundConnect,
  disconnect:   soundDisconnect,
  error:        soundError,
  pop:          soundPop,
  ding:         soundDing,
  voice_join:   soundVoiceJoin,
  voice_leave:  soundVoiceLeave,
  notification: soundNotification,
};

/** Play a sound by ID. No-ops if sound is unknown. */
export function playSound(id: SoundId): void {
  SOUNDS[id]?.();
}

/** Legacy compat — plays the 'notification' sound. */
export function playNotificationSound(): void {
  soundNotification();
}
