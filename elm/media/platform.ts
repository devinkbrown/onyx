// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * platform.ts — browser capability probes and the WebKit/iOS audio rules the
 * call path has to honour. Pure feature detection (no UA sniffing where a
 * capability check exists); the one UA test is the documented iPadOS-as-Mac
 * case, used only to refuse screen share where WebKit has no picker.
 */

export interface PlatformInfo {
  /** iPhone / iPad / iPod WebKit (including iPadOS reporting as a Mac). */
  ios: boolean;
  /** Installed to the home screen (standalone display mode). */
  standalone: boolean;
  /** getDisplayMedia exists AND this is not iOS (WebKit on iOS has no screen picker). */
  canShareScreen: boolean;
  /** Camera/mic capture is available at all. */
  canCapture: boolean;
}

type NavLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  mediaDevices?: { getUserMedia?: unknown; getDisplayMedia?: unknown };
  standalone?: boolean;
};

export function detectPlatform(nav: NavLike | undefined, win?: { matchMedia?: (q: string) => { matches: boolean } }): PlatformInfo {
  const ua = nav?.userAgent ?? '';
  const iDevice = /\b(iPhone|iPad|iPod)\b/.test(ua);
  // iPadOS 13+ reports a Mac UA; a Mac has no touch points.
  const iPadAsMac = /\bMacintosh\b/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1;
  const ios = iDevice || iPadAsMac;
  let standalone = nav?.standalone === true;
  try {
    standalone = standalone || !!win?.matchMedia?.('(display-mode: standalone)').matches;
  } catch { /* matchMedia unavailable */ }
  const md = nav?.mediaDevices;
  return {
    ios,
    standalone,
    canShareScreen: !ios && typeof md?.getDisplayMedia === 'function',
    canCapture: typeof md?.getUserMedia === 'function',
  };
}

type AudioCtxLike = {
  state: string;
  close?(): Promise<void>;
  resume(): Promise<void>;
  createBuffer?(channels: number, length: number, rate: number): unknown;
  createBufferSource?(): { buffer: unknown; connect(dest: unknown): void; start(when?: number): void };
  destination?: unknown;
};

/**
 * WebKit (iOS) only lets Web Audio run once it was created or resumed inside a
 * user gesture, and parks contexts in `suspended`/`interrupted` after
 * backgrounding, calls, or route changes. The engine creates its own contexts
 * (capture, meter, one per remote peer) deep inside async work, so this
 * controller tracks every AudioContext the page constructs and resumes the
 * stragglers on the next gesture, on return to the foreground, and on device
 * (route) changes. It also plays one silent sample inside the first gesture —
 * the classic WebKit unlock.
 */
export interface AudioUnlock {
  /** Call synchronously inside a user gesture (join / accept / any tap). */
  unlock(): void;
  /** Best-effort resume of every live context (gesture or not). */
  resumeAll(): void;
  /** Contexts not yet running (diagnostics). */
  stalled(): number;
  /** iOS audio session category for a live call (Safari 16.4+ Audio Session API). */
  setCallSession(active: boolean): void;
}

export function installAudioUnlock(win: (Window & typeof globalThis) | undefined): AudioUnlock {
  const live = new Set<AudioCtxLike>();
  let unlocked = false;
  const noop: AudioUnlock = { unlock() {}, resumeAll() {}, stalled: () => 0, setCallSession() {} };
  if (!win) return noop;
  const w = win as unknown as Record<string, unknown>;
  const Native = (w.AudioContext ?? w.webkitAudioContext) as (new (opts?: AudioContextOptions) => AudioCtxLike) | undefined;
  if (typeof Native !== 'function') return noop;

  function track(ctx: AudioCtxLike): void {
    live.add(ctx);
    const kick = () => {
      if (ctx.state === 'closed') { live.delete(ctx); return; }
      if (ctx.state !== 'running') ctx.resume().catch(() => { /* needs a gesture; retried on the next one */ });
    };
    try { (ctx as unknown as EventTarget).addEventListener('statechange', kick); } catch { /* old WebKit */ }
    kick();
  }

  // Wrap the constructor so contexts the engine makes are tracked too. The
  // subclass is a real AudioContext (instanceof, nodes, setSinkId unchanged).
  try {
    const Tracked = class extends (Native as unknown as new (opts?: AudioContextOptions) => object) {
      constructor(opts?: AudioContextOptions) {
        super(opts);
        track(this as unknown as AudioCtxLike);
      }
    };
    if (w.AudioContext) w.AudioContext = Tracked;
    if (w.webkitAudioContext) w.webkitAudioContext = Tracked;
  } catch { /* frozen globals: gesture resume still covers contexts made before */ }

  function resumeAll(): void {
    for (const ctx of live) {
      if (ctx.state === 'closed') { live.delete(ctx); continue; }
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
    }
  }

  function unlock(): void {
    resumeAll();
    if (unlocked) return;
    unlocked = true;
    try {
      const ctx = new (w.AudioContext as new () => AudioCtxLike)();
      const buffer = ctx.createBuffer?.(1, 1, 22050);
      const src = ctx.createBufferSource?.();
      if (src && buffer && ctx.destination) {
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
      }
      // iOS caps live AudioContexts; this one only had to sound once.
      const closer = ctx as unknown as { close?: () => Promise<void> };
      setTimeout(() => { closer.close?.().catch(() => {}); }, 1000);
    } catch { /* no Web Audio: nothing to unlock */ }
  }

  function setCallSession(active: boolean): void {
    const session = (win!.navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (!session) return;
    try { session.type = active ? 'play-and-record' : 'auto'; } catch { /* read-only on this build */ }
  }

  // Every gesture is a chance to (re)start parked contexts.
  const onGesture = () => unlock();
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    try { win.addEventListener(type, onGesture, { capture: true, passive: true }); } catch { /* */ }
  }
  return { unlock, resumeAll, stalled: () => [...live].filter((c) => c.state !== 'running' && c.state !== 'closed').length, setCallSession };
}
