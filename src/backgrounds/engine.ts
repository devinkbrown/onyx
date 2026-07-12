// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';
import { bumpThemeEpoch } from './theme-epoch';

export type BackgroundQuality = 'low' | 'med' | 'high';

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
  init(ctx: BackgroundFrameContext): void;
  frame(ctx: BackgroundFrameContext, time: number): void;
  dispose(): void;
}

export interface SceneProps {
  /** True when the user prefers reduced motion — scenes freeze their CSS animations. */
  reducedMotion: boolean;
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
}

/** Default animation render-cadence ceiling — a calm 30fps, not 60. */
export const DEFAULT_FRAME_CAP_FPS = 30;
/** Idle window before the cadence begins to decelerate. */
export const IDLE_DECEL_AFTER_MS = 8000;
/** How long the deceleration ramp takes to reach `IDLE_MIN_FPS`. */
export const IDLE_DECEL_RAMP_MS = 12000;
/** The floor the idle cadence decelerates to — still alive, barely moving. */
export const IDLE_MIN_FPS = 12;
/** FPS-guard starvation threshold as a fraction of the cap (so a healthy capped
 * loop never trips it, but genuine starvation below the cap still does). */
const GUARD_FPS_RATIO = 0.8;
/** Render when at least this fraction of the target interval has elapsed — a
 * little slack so rAF jitter around the boundary doesn't halve the real fps. */
const FRAME_CAP_TOLERANCE = 0.9;

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

const QUALITY_PROFILES: Record<BackgroundQuality, { maxDpr: number; scale: number }> = {
  low: { maxDpr: 1, scale: 0.52 },
  med: { maxDpr: 1.5, scale: 0.76 },
  high: { maxDpr: 2, scale: 1 },
};

function nextLowerQuality(quality: BackgroundQuality): BackgroundQuality {
  const index = QUALITY_ORDER.indexOf(quality);
  return QUALITY_ORDER[Math.max(0, index - 1)] ?? 'low';
}

function getDevicePixelRatio(quality: BackgroundQuality): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.max(1, Math.min(dpr, QUALITY_PROFILES[quality].maxDpr));
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
  readonly targetFps: number;
  readonly fpsGuardFrames: number;
  readonly frameCapFps: number;
  readonly staticMode: boolean;

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
   * deceleration. Reset on start, visibility-return, resize, and theme change. */
  private activeSince: number | null = null;
  /** True while the cadence is idle-decelerated below its cap; the FPS guard
   * ignores these frames so intentional throttling never drops quality. */
  private throttled = false;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private pendingStaticRefresh = false;
  private listenersAttached = false;

  constructor(options: BackgroundEngineOptions) {
    this.canvas = options.canvas;
    this.variant = options.variant;
    this.currentQuality = options.quality ?? 'high';
    this.frameCapFps = options.frameCapFps ?? DEFAULT_FRAME_CAP_FPS;
    // Guard threshold sits below the cap so a healthy capped loop never trips
    // it, while genuine starvation (rendering well under the cap) still does.
    this.targetFps = options.targetFps ?? Math.round(this.frameCapFps * GUARD_FPS_RATIO);
    this.fpsGuardFrames = options.fpsGuardFrames ?? 42;
    this.staticMode = options.staticMode ?? false;
  }

  get quality(): BackgroundQuality {
    return this.currentQuality;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.attachListeners();

    if (!this.ensureInitialized()) {
      this.stop();
      return;
    }

    const now = typeof performance === 'undefined' ? 0 : performance.now();
    this.renderFrame(now);
    // Seed the cadence clocks off the first painted frame so the cap and idle
    // deceleration are measured from an active start.
    this.lastRenderAt = now;
    this.activeSince = now;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
    this.detachListeners();
    this.lastFrameAt = null;
    this.lastRenderAt = null;
    this.activeSince = null;
    this.throttled = false;
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
    this.resize();
  }

  resize(): void {
    if (!this.context) return;

    const bounds = this.canvas.getBoundingClientRect();
    const fallbackWidth = typeof window === 'undefined' ? this.canvas.width : window.innerWidth;
    const fallbackHeight = typeof window === 'undefined' ? this.canvas.height : window.innerHeight;
    const width = Math.max(1, Math.floor(bounds.width || this.canvas.clientWidth || fallbackWidth || 1));
    const height = Math.max(1, Math.floor(bounds.height || this.canvas.clientHeight || fallbackHeight || 1));
    const dpr = getDevicePixelRatio(this.currentQuality);
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));

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
      qualityScale: QUALITY_PROFILES[this.currentQuality].scale,
    };
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
    this.lowFpsFrames = 0;
    this.resize();
  }

  private scheduleNextFrame(): void {
    if (!this.running || this.staticMode || this.variant.kind === 'solid' || isDocumentHidden()) return;
    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame((time) => {
      this.rafId = null;
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

  /** Whether enough of the current cadence interval has elapsed to paint. */
  private shouldRenderNow(time: number): boolean {
    const cap = this.effectiveFrameCap(time);
    this.throttled = cap < this.frameCapFps;
    if (this.lastRenderAt === null) return true;
    return time - this.lastRenderAt >= frameInterval(cap) * FRAME_CAP_TOLERANCE;
  }

  private cancelFrame(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    // The theme may have switched while no engine was observing (between a stop
    // and this start), so force the first frame to re-read the live tokens
    // instead of trusting a possibly-stale cached theme.
    bumpThemeEpoch();

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas);
      if (this.canvas.parentElement) this.resizeObserver.observe(this.canvas.parentElement);
    }

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

    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.pendingStaticRefresh = false;
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
    const now = typeof performance === 'undefined' ? 0 : performance.now();
    this.renderFrame(now);
  }

  private readonly handleResize = (): void => {
    // A resize is user activity — restore full cadence and paint promptly.
    this.activeSince = typeof performance === 'undefined' ? 0 : performance.now();
    this.lastRenderAt = null;
    this.throttled = false;
    this.resize();
  };

  private readonly handleThemeMutation = (records: MutationRecord[]): void => {
    if (!records.some((record) => isThemeMutation(record.attributeName))) return;
    // Invalidate the shared cached theme so every variant re-reads the new
    // tokens; animated loops pick them up on their next frame.
    bumpThemeEpoch();
    // A frozen single frame won't repaint itself, so drive it explicitly.
    if (rendersSingleFrame(this.staticMode, this.variant.kind)) this.refreshStaticFrame();
  };

  private readonly handleVisibilityChange = (): void => {
    if (isDocumentHidden()) {
      this.cancelFrame();
      this.lastFrameAt = null;
      this.lastRenderAt = null;
      return;
    }

    // Returning to the tab is activity — reset the idle window to full cadence.
    this.activeSince = typeof performance === 'undefined' ? 0 : performance.now();
    this.throttled = false;

    if (this.pendingStaticRefresh) {
      this.pendingStaticRefresh = false;
      this.refreshStaticFrame();
    }

    this.scheduleNextFrame();
  };
}
