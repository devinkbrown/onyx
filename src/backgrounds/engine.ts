export type BackgroundQuality = 'low' | 'med' | 'high';
export type BackgroundKind = 'animated' | 'solid';

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
  kind: BackgroundKind;
  init(ctx: BackgroundFrameContext): void;
  frame(ctx: BackgroundFrameContext, time: number): void;
  dispose(): void;
}

export interface BackgroundEngineOptions {
  canvas: HTMLCanvasElement;
  variant: BackgroundVariant;
  quality?: BackgroundQuality;
  targetFps?: number;
  fpsGuardFrames?: number;
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

export class BackgroundEngine {
  readonly canvas: HTMLCanvasElement;
  readonly variant: BackgroundVariant;
  readonly targetFps: number;
  readonly fpsGuardFrames: number;

  private context: CanvasRenderingContext2D | null = null;
  private frameContext: BackgroundFrameContext | null = null;
  private currentQuality: BackgroundQuality;
  private rafId: number | null = null;
  private running = false;
  private initialized = false;
  private lastFrameAt: number | null = null;
  private lowFpsFrames = 0;
  private resizeObserver: ResizeObserver | null = null;
  private listenersAttached = false;

  constructor(options: BackgroundEngineOptions) {
    this.canvas = options.canvas;
    this.variant = options.variant;
    this.currentQuality = options.quality ?? 'high';
    this.targetFps = options.targetFps ?? 50;
    this.fpsGuardFrames = options.fpsGuardFrames ?? 42;
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
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
    this.detachListeners();
    this.lastFrameAt = null;
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
    if (this.variant.kind !== 'animated') {
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
    if (!this.running || this.variant.kind === 'solid' || isDocumentHidden()) return;
    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame((time) => {
      this.rafId = null;
      this.renderFrame(time);
      this.scheduleNextFrame();
    });
  }

  private cancelFrame(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas);
      if (this.canvas.parentElement) this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;

    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private readonly handleResize = (): void => {
    this.resize();
  };

  private readonly handleVisibilityChange = (): void => {
    if (isDocumentHidden()) {
      this.cancelFrame();
      this.lastFrameAt = null;
      return;
    }

    this.scheduleNextFrame();
  };
}
