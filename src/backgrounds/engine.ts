// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';
import type { SceneDetail } from './backgroundPolicy';
import { bumpThemeEpoch } from './theme-epoch';

export type BackgroundQuality = 'low' | 'med' | 'high';
export type { SceneDetail };

/** Kinds rendered by the canvas engine (init/frame/dispose loop). */
export type CanvasBackgroundKind = 'animated' | 'solid';

/** All background kinds, including DOM/SVG scene backgrounds. */
export type BackgroundKind = CanvasBackgroundKind | 'scene';

export interface BackgroundFrameContext {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  quality: BackgroundQuality;
  qualityScale: number;
}

export interface BackgroundVariant {
  id: string;
  label: string;
  kind: CanvasBackgroundKind;
  /** Prepare renderer-owned state only. BackgroundEngine owns the first paint. */
  init(ctx: BackgroundFrameContext): void;
  frame(ctx: BackgroundFrameContext, time: number): void;
  dispose(): void;
}

export interface SceneProps {
  /** True when the user prefers reduced motion — scenes freeze their CSS animations. */
  reducedMotion: boolean;
  /** Policy detail ladder — omit expensive layers when `sparse`. */
  sceneDetail?: SceneDetail;
  /** Combined still + runtime pause hook. SceneShell also owns visibility/focus. */
  paused?: boolean;
  /** SceneShell reports hidden/blurred/idle holds to the host telemetry. */
  onRuntimePaused?: (paused: boolean) => void;
}

/**
 * A DOM/SVG scene background: a self-contained Solid component (fixed
 * colorway, CSS keyframe animation) rendered instead of the canvas engine.
 * Scene variants never go through init/frame/dispose.
 */
export interface SceneVariant {
  id: string;
  label: string;
  kind: 'scene';
  component: (props: SceneProps) => JSX.Element;
}

export type AnyBackgroundVariant = BackgroundVariant | SceneVariant;

export function isSceneVariant(variant: AnyBackgroundVariant): variant is SceneVariant {
  return variant.kind === 'scene';
}

export interface BackgroundEngineOptions {
  canvas: HTMLCanvasElement;
  variant: BackgroundVariant;
  quality?: BackgroundQuality;
  targetFps?: number;
  fpsGuardFrames?: number;
  /**
   * Ceiling on the animation render cadence, in fps. The rAF loop paints at
   * most this often (default 30) instead of every vsync — half the frames, half
   * the battery, no visible change for a slow ambient background. Idle
   * deceleration steps this down further (see `deceleratedFrameCap`).
   */
  frameCapFps?: number;
  /**
   * Render a single still frame and never loop, regardless of the variant's
   * kind. Used to honour `prefers-reduced-motion` while still showing the
   * theme's own scene (frozen), instead of swapping to a generic solid.
   */
  staticMode?: boolean;
  /**
   * Backing-store device-pixel ceiling. Policy owns the number (mobile 1.5,
   * desktop 2, preview 1); quality profiles are only the fallback.
   */
  dprCap?: number;
  /**
   * Live wallpaper surfaces (not picker previews) claim a process-wide lease
   * so two canvas engines never animate at once.
   */
  live?: boolean;
  /** Fired when the FPS guard steps quality down. */
  onQualityChange?: (quality: BackgroundQuality) => void;
}

export interface BackgroundPresentation {
  quality: BackgroundQuality;
  frameCapFps: number;
  dprCap: number;
  staticMode: boolean;
}

/** Default animation render-cadence ceiling — a calm 30fps, not 60. */
export const DEFAULT_FRAME_CAP_FPS = 30;
/** Idle window before the cadence begins to decelerate. */
export const IDLE_DECEL_AFTER_MS = 8000;
/** How long the deceleration ramp takes to reach `IDLE_MIN_FPS`. */
export const IDLE_DECEL_RAMP_MS = 12000;
/** The floor the idle cadence decelerates to — still alive, barely moving. */
export const IDLE_MIN_FPS = 12;
/** Prolonged inactivity freezes the final ambient frame until fresh input. */
export const IDLE_HOLD_AFTER_MS = 60_000;
/** Coalesce high-frequency input bursts before resetting the idle window. */
export const ACTIVITY_THROTTLE_MS = 500;
/** FPS-guard starvation threshold as a fraction of the cap (so a healthy capped
 * loop never trips it, but genuine starvation below the cap still does). */
const GUARD_FPS_RATIO = 0.8;
/** Render when at least this fraction of the target interval has elapsed — a
 * little slack so rAF jitter around the boundary doesn't halve the real fps. */
const FRAME_CAP_TOLERANCE = 0.9;
const PASSIVE_ACTIVITY_OPTIONS: AddEventListenerOptions = { passive: true };
const PASSIVE_CAPTURE_ACTIVITY_OPTIONS: AddEventListenerOptions = { passive: true, capture: true };

function animationNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** Pure: milliseconds between frames at `fps` (guarded against div-by-~0). */
export function frameInterval(fps: number): number {
  return 1000 / Math.max(1, fps);
}

export interface DecelOptions {
  afterMs?: number;
  rampMs?: number;
  minFps?: number;
}

/**
 * Pure: the effective cadence cap after `idleMs` of no interaction. Full
 * `baseFps` until `afterMs`, then a linear ramp down to `minFps` over `rampMs`,
 * floored there. Gentle, monotone, and exhaustively testable without a clock.
 */
export function deceleratedFrameCap(baseFps: number, idleMs: number, options: DecelOptions = {}): number {
  const afterMs = options.afterMs ?? IDLE_DECEL_AFTER_MS;
  const rampMs = options.rampMs ?? IDLE_DECEL_RAMP_MS;
  const minFps = options.minFps ?? IDLE_MIN_FPS;
  if (!(idleMs > afterMs)) return baseFps;
  const progress = Math.min(1, (idleMs - afterMs) / Math.max(1, rampMs));
  const decelerated = baseFps + (minFps - baseFps) * progress;
  return Math.max(minFps, Math.round(decelerated));
}

const QUALITY_ORDER: BackgroundQuality[] = ['low', 'med', 'high'];

export const QUALITY_PROFILES: Record<BackgroundQuality, { maxDpr: number; scale: number }> = {
  low: { maxDpr: 1, scale: 0.52 },
  med: { maxDpr: 1.5, scale: 0.76 },
  high: { maxDpr: 2, scale: 1 },
};

export function qualityScaleFor(quality: BackgroundQuality): number {
  return QUALITY_PROFILES[quality].scale;
}

/** At most one live (non-preview) canvas engine may hold the animation lease. */
let liveCanvasEngine: BackgroundEngine | null = null;
/**
 * Keep the displaced engines in order so replacing a wallpaper can resume the
 * previous runnable surface when the replacement unmounts. A single pointer
 * loses A when the sequence is A → B → C and B is removed before C.
 */
const liveCanvasLeaseStack: BackgroundEngine[] = [];

function claimLiveCanvasEngine(engine: BackgroundEngine): void {
  const existingIndex = liveCanvasLeaseStack.indexOf(engine);
  if (existingIndex >= 0) liveCanvasLeaseStack.splice(existingIndex, 1);
  if (liveCanvasEngine && liveCanvasEngine !== engine) {
    liveCanvasEngine.setSuppressed(true);
  }
  liveCanvasLeaseStack.push(engine);
  liveCanvasEngine = engine;
  engine.setSuppressed(false);
}

function releaseLiveCanvasEngine(engine: BackgroundEngine): void {
  const index = liveCanvasLeaseStack.indexOf(engine);
  if (index < 0) return;
  liveCanvasLeaseStack.splice(index, 1);
  if (liveCanvasEngine !== engine) return;

  let previous: BackgroundEngine | undefined;
  for (let i = liveCanvasLeaseStack.length - 1; i >= 0; i -= 1) {
    const candidate = liveCanvasLeaseStack[i];
    if (candidate?.canResumeLiveLease()) {
      previous = candidate;
      break;
    }
  }
  liveCanvasEngine = previous ?? null;
  previous?.setSuppressed(false);
}

function nextLowerQuality(quality: BackgroundQuality): BackgroundQuality {
  const index = QUALITY_ORDER.indexOf(quality);
  return QUALITY_ORDER[Math.max(0, index - 1)] ?? 'low';
}

function readRawDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function capDevicePixelRatio(dprCap: number): number {
  return Math.max(1, Math.min(readRawDevicePixelRatio(), dprCap));
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * Attributes on `document.documentElement` that a theme switch mutates.
 * `ThemeProvider` writes token overrides via `style.setProperty` and flips
 * `data-theme` (+ `class`), so any of these changing means the live tokens a
 * canvas variant reads have moved.
 */
const THEME_MUTATION_ATTRIBUTES = ['style', 'class', 'data-theme'] as const;

/** Pure: does a mutated attribute name signal a theme change worth repainting? */
export function isThemeMutation(attributeName: string | null): boolean {
  return attributeName !== null && (THEME_MUTATION_ATTRIBUTES as readonly string[]).includes(attributeName);
}

/**
 * Pure: does this engine paint a single frozen frame (and therefore need an
 * explicit repaint when the theme changes) rather than a live loop that already
 * re-reads tokens every frame? True for `staticMode` (reduced motion / low
 * power) and for `solid` variants.
 */
export function rendersSingleFrame(staticMode: boolean, kind: CanvasBackgroundKind): boolean {
  return staticMode || kind === 'solid';
}

export class BackgroundEngine {
  readonly canvas: HTMLCanvasElement;
  readonly variant: BackgroundVariant;
  targetFps: number;
  readonly fpsGuardFrames: number;
  frameCapFps: number;
  staticMode: boolean;
  dprCap: number;
  readonly live: boolean;
  private readonly onQualityChange?: (quality: BackgroundQuality) => void;

  private context: CanvasRenderingContext2D | null = null;
  private frameContext: BackgroundFrameContext | null = null;
  private currentQuality: BackgroundQuality;
  private rafId: number | null = null;
  private running = false;
  private initialized = false;
  private lastFrameAt: number | null = null;
  private lowFpsFrames = 0;
  /** Timestamp of the last painted animation frame — drives the cadence cap. */
  private lastRenderAt: number | null = null;
  /** When the current active (visible, interacted) window began — drives idle
   * deceleration. Reset on start, accepted input, resize, and visibility return. */
  private activeSince: number | null = null;
  /** Last accepted user-activity signal, used to coalesce input bursts. */
  private lastActivityAt: number | null = null;
  /** True while the cadence is idle-decelerated below its cap; the FPS guard
   * ignores these frames so intentional throttling never drops quality. */
  private throttled = false;
  /** True after prolonged inactivity has stopped the rAF loop entirely. */
  private idleHeld = false;
  /** External lease / host asked this engine not to animate. */
  private suppressed = false;
  private resizeObserver: ResizeObserver | null = null;
  private resizeScheduled = false;
  private resizeRafId: number | null = null;
  /** Resolution media queries are the only reliable notification when page
   * zoom or a cross-display move changes DPR without changing CSS bounds. */
  private dprMediaQuery: MediaQueryList | null = null;
  private themeObserver: MutationObserver | null = null;
  private pendingStaticRefresh = false;
  private listenersAttached = false;
  /** A visible tab can still be unfocused (another window owns input). Canvas
   * animation pauses in that state just like DOM/SVG scenes do. */
  private windowBlurred = false;

  constructor(options: BackgroundEngineOptions) {
    this.canvas = options.canvas;
    this.variant = options.variant;
    this.currentQuality = options.quality ?? 'high';
    this.frameCapFps = options.frameCapFps ?? DEFAULT_FRAME_CAP_FPS;
    this.dprCap = options.dprCap ?? QUALITY_PROFILES[this.currentQuality].maxDpr;
    // Guard threshold sits below the cap so a healthy capped loop never trips
    // it, while genuine starvation (rendering well under the cap) still does.
    this.targetFps = options.targetFps ?? Math.round(this.frameCapFps * GUARD_FPS_RATIO);
    this.fpsGuardFrames = options.fpsGuardFrames ?? 42;
    this.staticMode = options.staticMode ?? false;
    this.live = options.live ?? false;
    this.onQualityChange = options.onQualityChange;
  }

  get quality(): BackgroundQuality {
    return this.currentQuality;
  }

  /** Internal lease guard: only a live, context-ready engine can be restored. */
  canResumeLiveLease(): boolean {
    return this.running && this.initialized;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.attachListeners();

    if (!this.ensureInitialized()) {
      this.stop();
      return;
    }

    // Do not displace an already-running wallpaper until this canvas has a
    // usable 2D context and its first frame can be painted. A failed context
    // init therefore leaves the prior live engine untouched.
    this.claimLiveLease();

    const now = animationNow();
    this.restoreActiveCadence(now);
    this.renderFrame(now);
    // Seed the cadence clocks off the first painted frame so the cap and idle
    // deceleration are measured from an active start.
    this.lastRenderAt = now;
    this.syncPausedAttribute();
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
    this.cancelScheduledResize();
    this.detachListeners();
    this.releaseLiveLease();
    this.lastFrameAt = null;
    this.lastRenderAt = null;
    this.activeSince = null;
    this.lastActivityAt = null;
    this.throttled = false;
    this.idleHeld = false;
    this.lowFpsFrames = 0;
  }

  dispose(): void {
    this.stop();

    if (this.initialized) {
      this.variant.dispose();
    }

    this.context = null;
    this.frameContext = null;
    this.initialized = false;
  }

  setQuality(quality: BackgroundQuality): void {
    if (quality === this.currentQuality) return;

    this.currentQuality = quality;
    this.dprCap = Math.min(this.dprCap, QUALITY_PROFILES[quality].maxDpr);
    this.resize();
  }

  setFrameCapFps(frameCapFps: number): void {
    const next = Math.max(1, frameCapFps);
    if (next === this.frameCapFps) return;
    this.frameCapFps = next;
    this.targetFps = Math.round(this.frameCapFps * GUARD_FPS_RATIO);
  }

  setDprCap(dprCap: number): void {
    const next = Math.max(1, dprCap);
    if (next === this.dprCap) return;
    this.dprCap = next;
    this.resize();
  }

  setStaticMode(staticMode: boolean): void {
    if (this.staticMode === staticMode) return;
    this.staticMode = staticMode;
    this.syncPausedAttribute();
    if (staticMode) {
      this.cancelFrame();
      this.refreshStaticFrame();
      return;
    }
    this.restoreActiveCadence(animationNow());
    this.scheduleNextFrame();
  }

  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.syncPausedAttribute();
    if (suppressed) {
      this.cancelFrame();
      this.lastFrameAt = null;
      this.lastRenderAt = null;
      this.lowFpsFrames = 0;
      this.throttled = false;
      return;
    }
    if (!this.running || isDocumentHidden() || this.windowBlurred) return;
    this.restoreActiveCadence(animationNow());
    this.scheduleNextFrame();
  }

  applyPresentation(next: BackgroundPresentation): void {
    const qualityChanged = next.quality !== this.currentQuality;
    const dprChanged = next.dprCap !== this.dprCap;
    this.setFrameCapFps(next.frameCapFps);
    if (qualityChanged) this.currentQuality = next.quality;
    if (dprChanged) this.dprCap = Math.max(1, next.dprCap);
    if (qualityChanged || dprChanged) this.resize();
    this.setStaticMode(next.staticMode);
    this.syncPolicyDataset();
    // A policy update can run while the document is hidden/blurred. Re-sync
    // after the presentation write so host telemetry cannot clear a truthful
    // pause flag from the lifecycle listeners.
    this.syncPausedAttribute();
  }

  resize(): void {
    if (!this.context) return;

    const bounds = this.canvas.getBoundingClientRect();
    const fallbackWidth = typeof window === 'undefined' ? this.canvas.width : window.innerWidth;
    const fallbackHeight = typeof window === 'undefined' ? this.canvas.height : window.innerHeight;
    const width = Math.max(1, Math.floor(bounds.width || this.canvas.clientWidth || fallbackWidth || 1));
    const height = Math.max(1, Math.floor(bounds.height || this.canvas.clientHeight || fallbackHeight || 1));
    const dpr = capDevicePixelRatio(this.dprCap);
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));
    const previous = this.frameContext;
    const frameChanged =
      previous === null ||
      previous.width !== width ||
      previous.height !== height ||
      previous.dpr !== dpr ||
      previous.quality !== this.currentQuality;

    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;

    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.frameContext = {
      canvas: this.canvas,
      context: this.context,
      width,
      height,
      dpr,
      quality: this.currentQuality,
      qualityScale: qualityScaleFor(this.currentQuality),
    };

    // ResizeObserver delivers an initial callback after mount even when the
    // canvas already has the exact backing/layout metrics established above.
    // Repaint frozen renderers only when their frame inputs actually changed;
    // real viewport, DPR, and quality changes still redraw immediately.
    if (
      frameChanged &&
      this.running &&
      this.initialized &&
      rendersSingleFrame(this.staticMode, this.variant.kind)
    ) {
      this.refreshStaticFrame();
    }
  }

  renderFrame(time: number): void {
    if (!this.ensureInitialized() || !this.frameContext) return;

    this.applyFpsGuard(time);
    this.variant.frame(this.frameContext, time);
  }

  private ensureInitialized(): boolean {
    if (this.initialized) return true;

    this.context = this.canvas.getContext('2d', { alpha: true });
    if (!this.context) {
      this.running = false;
      return false;
    }

    this.canvas.style.display = this.canvas.style.display || 'block';
    this.resize();

    if (!this.frameContext) {
      this.running = false;
      return false;
    }

    this.variant.init(this.frameContext);
    this.initialized = true;
    return true;
  }

  private applyFpsGuard(time: number): void {
    // A throttled (idle-decelerated) loop paints intentionally-sparse frames, so
    // its low fps is by design, not starvation — never judge quality on those.
    if (this.staticMode || this.variant.kind !== 'animated' || this.throttled) {
      this.lastFrameAt = time;
      return;
    }

    if (this.lastFrameAt === null) {
      this.lastFrameAt = time;
      return;
    }

    const delta = time - this.lastFrameAt;
    this.lastFrameAt = time;

    if (delta <= 0) return;

    const fps = 1000 / delta;
    if (fps < this.targetFps) {
      this.lowFpsFrames += 1;
    } else {
      this.lowFpsFrames = Math.max(0, this.lowFpsFrames - 2);
    }

    if (this.lowFpsFrames < this.fpsGuardFrames || this.currentQuality === 'low') return;

    this.currentQuality = nextLowerQuality(this.currentQuality);
    this.dprCap = Math.min(this.dprCap, QUALITY_PROFILES[this.currentQuality].maxDpr);
    this.lowFpsFrames = 0;
    this.canvas.dataset.backgroundQuality = this.currentQuality;
    this.canvas.dataset.backgroundReason = 'runtime-pressure';
    this.onQualityChange?.(this.currentQuality);
    this.resize();
  }

  private scheduleNextFrame(): void {
    if (
      !this.running ||
      this.staticMode ||
      this.variant.kind === 'solid' ||
      isDocumentHidden() ||
      this.windowBlurred ||
      this.suppressed
    ) return;
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') return;

    this.rafId = requestAnimationFrame((time) => {
      this.rafId = null;
      // After a minute without interaction, paint one final frame and stop the
      // loop entirely. Any accepted activity restores cadence and schedules a
      // fresh frame, so an all-day idle client consumes no background rAF work.
      if (this.shouldEnterIdleHold(time)) {
        this.throttled = true;
        this.lastRenderAt = time;
        this.renderFrame(time);
        this.idleHeld = true;
        this.syncPausedAttribute();
        return;
      }
      // rAF fires at vsync (~60fps); only actually paint when the cadence cap's
      // interval has elapsed. Cheaply skipped frames just reschedule.
      if (this.shouldRenderNow(time)) {
        this.lastRenderAt = time;
        this.renderFrame(time);
      }
      this.scheduleNextFrame();
    });
  }

  /** Effective cadence cap right now, after any idle deceleration. */
  private effectiveFrameCap(time: number): number {
    const idleMs = this.activeSince === null ? 0 : Math.max(0, time - this.activeSince);
    return deceleratedFrameCap(this.frameCapFps, idleMs);
  }

  private shouldEnterIdleHold(time: number): boolean {
    if (this.activeSince === null) return false;
    return time - this.activeSince >= IDLE_HOLD_AFTER_MS;
  }

  /** Whether enough of the current cadence interval has elapsed to paint. */
  private shouldRenderNow(time: number): boolean {
    const cap = this.effectiveFrameCap(time);
    this.throttled = cap < this.frameCapFps;
    if (this.lastRenderAt === null) return true;
    return time - this.lastRenderAt >= frameInterval(cap) * FRAME_CAP_TOLERANCE;
  }

  private cancelFrame(): void {
    if (this.rafId === null) return;
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    // The theme may have switched while no engine was observing (between a stop
    // and this start), so force the first frame to re-read the live tokens
    // instead of trusting a possibly-stale cached theme.
    bumpThemeEpoch();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize);
      window.addEventListener('blur', this.handleWindowBlur);
      window.addEventListener('focus', this.handleWindowFocus);
      window.addEventListener('pointerdown', this.handleUserActivity, PASSIVE_ACTIVITY_OPTIONS);
      window.addEventListener('keydown', this.handleUserActivity);
      window.addEventListener('wheel', this.handleUserActivity, PASSIVE_ACTIVITY_OPTIONS);
      window.addEventListener('touchstart', this.handleUserActivity, PASSIVE_ACTIVITY_OPTIONS);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      // Capture descendant scroll events: unlike wheel, `scroll` does not bubble.
      document.addEventListener('scroll', this.handleUserActivity, PASSIVE_CAPTURE_ACTIVITY_OPTIONS);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas);
      if (this.canvas.parentElement) this.resizeObserver.observe(this.canvas.parentElement);
    }
    this.attachDprWatcher();

    // Watch documentElement for theme switches. Every kind needs this: animated
    // loops read a theme cached against the shared epoch (so they no longer pay
    // getComputedStyle every frame) and must invalidate that cache on a switch,
    // while a frozen static/solid frame additionally has to be repainted since
    // it never loops on its own.
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      this.themeObserver = new MutationObserver(this.handleThemeMutation);
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [...THEME_MUTATION_ATTRIBUTES],
      });
    }
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
      window.removeEventListener('blur', this.handleWindowBlur);
      window.removeEventListener('focus', this.handleWindowFocus);
      window.removeEventListener('pointerdown', this.handleUserActivity, PASSIVE_ACTIVITY_OPTIONS);
      window.removeEventListener('keydown', this.handleUserActivity);
      window.removeEventListener('wheel', this.handleUserActivity, PASSIVE_ACTIVITY_OPTIONS);
      window.removeEventListener('touchstart', this.handleUserActivity, PASSIVE_ACTIVITY_OPTIONS);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      document.removeEventListener('scroll', this.handleUserActivity, PASSIVE_CAPTURE_ACTIVITY_OPTIONS);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.detachDprWatcher();
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.pendingStaticRefresh = false;
    this.windowBlurred = false;
    this.idleHeld = false;
    this.cancelScheduledResize();
  }

  /**
   * Repaint the single static/solid frame after a theme change. Deferred while
   * the document is hidden — `handleVisibilityChange` flushes it on return so a
   * frozen background never resumes with the previous theme's colours.
   */
  private refreshStaticFrame(): void {
    if (!this.running || !this.initialized) return;
    if (isDocumentHidden()) {
      this.pendingStaticRefresh = true;
      return;
    }
    const now = animationNow();
    this.renderFrame(now);
  }

  /** Restore full cadence and discard FPS-guard evidence from the old window. */
  private restoreActiveCadence(time: number): void {
    this.activeSince = time;
    this.lastRenderAt = null;
    this.lastFrameAt = null;
    this.lowFpsFrames = 0;
    this.throttled = false;
    this.idleHeld = false;
  }

  private readonly handleUserActivity = (): void => {
    const now = animationNow();
    if (this.lastActivityAt !== null && now - this.lastActivityAt < ACTIVITY_THROTTLE_MS) return;
    this.lastActivityAt = now;
    this.restoreActiveCadence(now);
    this.syncPausedAttribute();
    this.scheduleNextFrame();
  };

  private readonly handleResize = (): void => {
    // Cadence reset stays synchronous so FPS-guard evidence is discarded even
    // when backing-store work is coalesced to the next animation frame.
    this.restoreActiveCadence(animationNow());
    this.scheduleCoalescedResize();
    this.scheduleNextFrame();
  };

  private scheduleCoalescedResize(): void {
    if (this.resizeScheduled) return;
    this.resizeScheduled = true;
    if (typeof requestAnimationFrame === 'undefined') {
      this.resizeScheduled = false;
      this.resize();
      return;
    }
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.resizeScheduled = false;
      this.resize();
    });
  }

  private cancelScheduledResize(): void {
    if (this.resizeRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.resizeRafId);
    }
    this.resizeRafId = null;
    this.resizeScheduled = false;
  }

  private claimLiveLease(): void {
    if (!this.live) return;
    claimLiveCanvasEngine(this);
  }

  private releaseLiveLease(): void {
    releaseLiveCanvasEngine(this);
  }

  private isVisuallyPaused(): boolean {
    return this.staticMode
      || this.suppressed
      || this.windowBlurred
      || this.idleHeld
      || isDocumentHidden();
  }

  private syncPausedAttribute(): void {
    if (this.isVisuallyPaused()) this.canvas.dataset.backgroundPaused = 'true';
    else delete this.canvas.dataset.backgroundPaused;
  }

  private syncPolicyDataset(): void {
    this.canvas.dataset.backgroundQuality = this.currentQuality;
    this.canvas.dataset.backgroundFps = String(this.frameCapFps);
    this.canvas.dataset.backgroundDprCap = String(this.dprCap);
    if (this.staticMode) this.canvas.dataset.backgroundKind = 'solid';
  }

  /**
   * A fixed-resolution media query changes when the browser's DPR moves away
   * from the value it was created for. Re-arm after each change so subsequent
   * zoom/display transitions remain observable. This complements rather than
   * replaces ResizeObserver: CSS bounds can stay identical while the backing
   * store needs to grow or shrink.
   */
  private attachDprWatcher(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.detachDprWatcher();
    const rawDpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
    try {
      const query = window.matchMedia(`(resolution: ${rawDpr}dppx)`);
      query.addEventListener('change', this.handleDprChange);
      this.dprMediaQuery = query;
    } catch {
      // Resolution observation is an optimization. A partial matchMedia
      // implementation must not prevent the selected background from mounting.
      this.dprMediaQuery = null;
    }
  }

  private detachDprWatcher(): void {
    const query = this.dprMediaQuery;
    this.dprMediaQuery = null;
    try {
      query?.removeEventListener('change', this.handleDprChange);
    } catch {
      // Listener cleanup is best-effort for partial/legacy matchMedia shims.
    }
  }

  private readonly handleDprChange = (): void => {
    this.detachDprWatcher();
    this.restoreActiveCadence(animationNow());
    this.resize();
    this.scheduleNextFrame();
    if (this.listenersAttached) this.attachDprWatcher();
  };

  private readonly handleThemeMutation = (records: MutationRecord[]): void => {
    if (!records.some((record) => isThemeMutation(record.attributeName))) return;
    // Invalidate the shared cached theme so every variant re-reads the new
    // tokens; animated loops pick them up on their next frame.
    bumpThemeEpoch();
    // A frozen single frame won't repaint itself, so drive it explicitly.
    if (rendersSingleFrame(this.staticMode, this.variant.kind) || this.idleHeld) this.refreshStaticFrame();
  };

  /** Stop the live canvas loop while another window owns focus. Unlike the
   * idle policy this is a full hold: there is no value in painting an obscured
   * or background window at even the minimum cadence. */
  private readonly handleWindowBlur = (): void => {
    this.windowBlurred = true;
    this.cancelFrame();
    this.lastFrameAt = null;
    this.lastRenderAt = null;
    this.lowFpsFrames = 0;
    this.throttled = false;
    this.syncPausedAttribute();
  };

  /** Focus is fresh activity: discard stale FPS evidence, restore the 30fps
   * active cap, and schedule one new frame unless the document is still hidden. */
  private readonly handleWindowFocus = (): void => {
    this.windowBlurred = false;
    this.syncPausedAttribute();
    if (isDocumentHidden() || this.suppressed) return;
    this.restoreActiveCadence(animationNow());
    this.scheduleNextFrame();
  };

  private readonly handleVisibilityChange = (): void => {
    if (isDocumentHidden()) {
      this.cancelFrame();
      this.lastFrameAt = null;
      this.lastRenderAt = null;
      this.lowFpsFrames = 0;
      this.throttled = false;
      this.syncPausedAttribute();
      return;
    }

    // Returning to the tab is activity — reset the idle window to full cadence.
    this.restoreActiveCadence(animationNow());
    this.syncPausedAttribute();

    if (this.pendingStaticRefresh) {
      this.pendingStaticRefresh = false;
      this.refreshStaticFrame();
    }

    if (!this.suppressed) this.scheduleNextFrame();
  };
}
