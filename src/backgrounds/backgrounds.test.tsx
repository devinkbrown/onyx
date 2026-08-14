// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dynamic } from 'solid-js/web';
import { Background, selectBackgroundId } from './Background';
import {
  BackgroundEngine,
  DEFAULT_FRAME_CAP_FPS,
  deceleratedFrameCap,
  frameInterval,
  IDLE_DECEL_AFTER_MS,
  IDLE_HOLD_AFTER_MS,
  IDLE_MIN_FPS,
  isThemeMutation,
  rendersSingleFrame,
  type BackgroundFrameContext,
  type BackgroundKind,
  type BackgroundVariant,
  type CanvasBackgroundKind,
} from './engine';
import { allBackgroundVariants, backgroundRegistry, getBackground, sceneRegistry, type BackgroundId } from './registry';
import {
  SIGNATURE_FAMILIES,
  backgroundOptions,
  backgroundsInFamily,
  getSignatureFamily,
} from './catalogue';
import { loadBackgroundVariant } from './loader';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { resetSceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';

afterEach(() => {
  cleanup();
  resetPreferences();
  resetSceneMotion();
});

describe('background registry', () => {
  it('keeps every variant id unique across canvas and scene variants', () => {
    // Arrange
    const ids = allBackgroundVariants.map((variant) => variant.id);

    // Act
    const uniqueIds = new Set(ids);

    // Assert
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('exposes readable labels for every variant', () => {
    // Arrange
    const labels = allBackgroundVariants.map((variant) => variant.label);

    // Act
    const blankLabels = labels.filter((label) => label.trim().length === 0);

    // Assert
    expect(blankLabels).toEqual([]);
  });

  it('classifies animated, solid, and scene variants correctly', () => {
    // Arrange
    const expectedKinds: Record<BackgroundId, BackgroundKind> = {
      'deep-current': 'animated',
      bioluminescence: 'animated',
      caustics: 'animated',
      aurora: 'animated',
      'pyrite-field': 'animated',
      'gold-veins': 'animated',
      ember: 'animated',
      forest: 'animated',
      resin: 'animated',
      'ink-wash': 'animated',
      mist: 'animated',
      frost: 'animated',
      'aurora-ribbons': 'animated',
      'tide-bands': 'animated',
      obsidian: 'solid',
      'lapis-gradient': 'solid',
      'paper-grain': 'solid',
      'retro-arcade': 'scene',
      starfield: 'scene',
      lightning: 'scene',
      phoenix: 'scene',
      'aurora-borealis': 'scene',
      volcanic: 'scene',
      'neon-night': 'scene',
    };

    // Act
    const actualKinds = Object.fromEntries(allBackgroundVariants.map((variant) => [variant.id, variant.kind]));

    // Assert
    expect(actualKinds).toEqual(expectedKinds);
  });

  it('uses deep current as the registry default', () => {
    // Act
    const defaultVariant = backgroundRegistry[0];

    // Assert
    expect(defaultVariant?.id).toBe('deep-current');
    expect(defaultVariant?.label).toBe('Deep Current');
  });

  it('finds registered variants by id', () => {
    // Arrange
    const id = 'deep-current';

    // Act
    const variant = getBackground(id);

    // Assert
    expect(variant?.label).toBe('Deep Current');
  });

  it('keeps the metadata catalogue in exact sync with the eager registry', () => {
    // The picker reads the lightweight catalogue (no render code); the eager
    // registry is the source of truth for id/label/kind/order. They must match
    // one-for-one or the lazy loader could point at a stale/missing id.
    // Family is catalogue-only grouping metadata (not on the render object).
    const fromRegistry = allBackgroundVariants.map(({ id, label, kind }) => ({ id, label, kind }));
    expect(backgroundOptions.map(({ id, label, kind }) => ({ id, label, kind }))).toEqual(fromRegistry);
  });

  it('assigns every catalogue id to a known signature family', () => {
    // Consolidation groups many selectable ids under ~5 signature families +
    // scenes — IDs stay for theme signatureBg / prefs; family is the grouping.
    const known = new Set(SIGNATURE_FAMILIES.map((f) => f.id));
    for (const meta of backgroundOptions) {
      const family = getSignatureFamily(meta.id);
      expect(family, `missing family for ${meta.id}`).toBeDefined();
      expect(known.has(family!)).toBe(true);
      expect(meta.family).toBe(family);
    }
    // Every non-scene family has at least one canvas preset; scenes have theirs.
    for (const family of SIGNATURE_FAMILIES) {
      expect(backgroundsInFamily(family.id).length).toBeGreaterThan(0);
    }
  });

  it('resolves legacy ids to their canonical catalogue entries', async () => {
    // Japanese legacy background ids are rejected (English catalogue only).
    const { resolveBackgroundId, getBackgroundMeta } = await import('./catalogue');
    expect(resolveBackgroundId('kintsugi-veins')).toBeUndefined();
    expect(resolveBackgroundId('sumi-e')).toBeUndefined();
    expect(resolveBackgroundId('washi')).toBeUndefined();
    expect(resolveBackgroundId('tokyo-night')).toBeUndefined();
    expect(getBackgroundMeta('kintsugi-veins')).toBeUndefined();
    expect(resolveBackgroundId('gold-veins')).toBe('gold-veins');
    const loaded = await loadBackgroundVariant('gold-veins');
    expect(loaded?.id).toBe('gold-veins');
  });

  it('lazily loads the concrete variant for every catalogued id', async () => {
    // Every catalogue id must resolve to its eager counterpart via the loader,
    // so no background can be selected but fail to render.
    for (const meta of backgroundOptions) {
      const loaded = await loadBackgroundVariant(meta.id);
      expect(loaded, `loader missing for ${meta.id}`).toBeDefined();
      expect(loaded?.id).toBe(meta.id);
      expect(loaded?.kind).toBe(meta.kind);
    }
    // An unknown id resolves to undefined rather than throwing.
    expect(await loadBackgroundVariant('does-not-exist')).toBeUndefined();
  });
});

describe('BackgroundEngine FPS guard', () => {
  it('drops quality after sustained low FPS', () => {
    // Arrange
    const canvas = createCanvas();
    const variant = createVariant();
    const engine = new BackgroundEngine({
      canvas,
      variant,
      quality: 'high',
      targetFps: 60,
      fpsGuardFrames: 3,
    });

    // Act
    engine.renderFrame(0);
    engine.renderFrame(120);
    engine.renderFrame(240);
    engine.renderFrame(360);

    // Assert
    expect(engine.quality).toBe('med');
    expect(variant.frame).toHaveBeenCalledTimes(4);

    engine.dispose();
  });
});

describe('frame cadence cap', () => {
  it('frameInterval is the millisecond gap for a target fps', () => {
    expect(frameInterval(30)).toBeCloseTo(1000 / 30, 6);
    expect(frameInterval(60)).toBeCloseTo(1000 / 60, 6);
    // Guards against a divide-by-~zero blowup.
    expect(frameInterval(0)).toBe(1000);
  });

  it('holds the base cadence until the idle window, then ramps to the floor', () => {
    const base = DEFAULT_FRAME_CAP_FPS;
    // Full cadence while active and through the idle threshold.
    expect(deceleratedFrameCap(base, 0)).toBe(base);
    expect(deceleratedFrameCap(base, IDLE_DECEL_AFTER_MS)).toBe(base);
    // Decelerating: strictly between floor and base partway through the ramp.
    const midway = deceleratedFrameCap(base, IDLE_DECEL_AFTER_MS + 6000);
    expect(midway).toBeLessThan(base);
    expect(midway).toBeGreaterThan(IDLE_MIN_FPS);
    // Fully idle: floored, and never below the floor.
    expect(deceleratedFrameCap(base, IDLE_DECEL_AFTER_MS + 1_000_000)).toBe(IDLE_MIN_FPS);
  });

  it('decelerates monotonically as idle time grows', () => {
    const base = DEFAULT_FRAME_CAP_FPS;
    let previous = base + 1;
    for (const idle of [0, 8000, 11000, 14000, 17000, 20000, 40000]) {
      const cap = deceleratedFrameCap(base, idle);
      expect(cap).toBeLessThanOrEqual(previous);
      previous = cap;
    }
  });

  it('defaults the frame cap to 30fps and derives a guard target below it', () => {
    // The FPS guard must sit under the cap, or a healthy capped loop would look
    // like starvation and needlessly drop quality.
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant: createVariant() });
    expect(engine.frameCapFps).toBe(DEFAULT_FRAME_CAP_FPS);
    expect(engine.targetFps).toBeLessThan(engine.frameCapFps);
    engine.dispose();
  });

  it('caps actual paints, restores full cadence on activity, and throttles input bursts', () => {
    const raf = installControlledAnimationFrame();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const variant = createVariant();
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant });

    try {
      engine.start();
      expect(variant.frame).toHaveBeenCalledTimes(1);

      raf.runNext(20);
      expect(variant.frame).toHaveBeenCalledTimes(1);
      raf.runNext(34);
      expect(variant.frame).toHaveBeenCalledTimes(2);

      // The long-idle loop still paints, but at the decelerated cadence.
      raf.runNext(20_000);
      expect(variant.frame).toHaveBeenCalledTimes(3);

      now.mockReturnValue(20_001);
      window.dispatchEvent(new Event('pointerdown'));
      raf.runNext(20_002);
      expect(variant.frame).toHaveBeenCalledTimes(4);

      // A burst inside the throttle window must not repeatedly clear the cap.
      now.mockReturnValue(20_010);
      window.dispatchEvent(new Event('pointerdown'));
      raf.runNext(20_011);
      expect(variant.frame).toHaveBeenCalledTimes(4);
    } finally {
      engine.dispose();
      now.mockRestore();
      raf.restore();
    }
  });

  it('holds the canvas loop after prolonged inactivity and wakes on activity', () => {
    const raf = installControlledAnimationFrame();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const variant = createVariant();
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant });

    try {
      engine.start();
      expect(variant.frame).toHaveBeenCalledTimes(1);
      expect(raf.pendingCount()).toBe(1);

      raf.runNext(IDLE_HOLD_AFTER_MS);
      expect(variant.frame).toHaveBeenCalledTimes(2);
      expect(raf.pendingCount()).toBe(0);

      now.mockReturnValue(IDLE_HOLD_AFTER_MS + 1);
      window.dispatchEvent(new Event('pointerdown'));
      expect(raf.pendingCount()).toBe(1);
      raf.runNext(IDLE_HOLD_AFTER_MS + 2);
      expect(variant.frame).toHaveBeenCalledTimes(3);
    } finally {
      engine.dispose();
      now.mockRestore();
      raf.restore();
    }
  });
});

describe('BackgroundEngine lifecycle', () => {
  it('owns exactly one startup paint for a real catalogue canvas variant', () => {
    // Catalogue variants used to call frame() from init(), so engine.start()
    // painted the full viewport twice before yielding. Keep init setup-only and
    // let the engine guarantee the one visible first frame, including static mode.
    const variant = backgroundRegistry[0];
    const init = vi.spyOn(variant, 'init');
    const frame = vi.spyOn(variant, 'frame');
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant, staticMode: true });

    try {
      engine.start();

      expect(init).toHaveBeenCalledTimes(1);
      expect(frame).toHaveBeenCalledTimes(1);
    } finally {
      engine.dispose();
      init.mockRestore();
      frame.mockRestore();
    }
  });

  it('holds canvas animation while the window is blurred and resumes at full cadence on focus', () => {
    const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    const raf = installControlledAnimationFrame();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const variant = createVariant();
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant });

    try {
      setDocumentHidden(false);
      engine.start();
      expect(variant.frame).toHaveBeenCalledTimes(1);
      expect(raf.pendingCount()).toBe(1);

      window.dispatchEvent(new Event('blur'));
      expect(raf.pendingCount()).toBe(0);

      // Activity in an unfocused window must not accidentally restart painting.
      now.mockReturnValue(10_000);
      window.dispatchEvent(new Event('pointerdown'));
      expect(raf.pendingCount()).toBe(0);
      expect(variant.frame).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('focus'));
      expect(raf.pendingCount()).toBe(1);
      raf.runNext(10_001);
      expect(variant.frame).toHaveBeenCalledTimes(2);
      expect(engine.quality).toBe('high');
    } finally {
      engine.dispose();
      now.mockRestore();
      raf.restore();
      restoreDocumentHidden(hidden);
    }
  });

  it.each([
    { label: 'solid variant', kind: 'solid' as const, staticMode: false },
    { label: 'static animated variant', kind: 'animated' as const, staticMode: true },
  ])('does not repaint a $label for a no-op resize notification', async ({ kind, staticMode }) => {
    const variant = { ...createVariant(), kind };
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant, staticMode });

    engine.start();
    const framesAtStart = (variant.frame as ReturnType<typeof vi.fn>).mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    await flushCoalescedResize();

    expect(variant.frame).toHaveBeenCalledTimes(framesAtStart);
    engine.dispose();
  });

  it.each([
    { label: 'solid variant', kind: 'solid' as const, staticMode: false },
    { label: 'static animated variant', kind: 'animated' as const, staticMode: true },
  ])('repaints a $label for real layout and quality changes', async ({ kind, staticMode }) => {
    const canvas = createCanvas();
    const variant = { ...createVariant(), kind };
    const engine = new BackgroundEngine({ canvas, variant, staticMode });

    engine.start();
    const framesAtStart = (variant.frame as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.mocked(canvas.getBoundingClientRect).mockReturnValue(canvasBounds(800, 450));
    window.dispatchEvent(new Event('resize'));
    await flushCoalescedResize();

    expect(variant.frame).toHaveBeenCalledTimes(framesAtStart + 1);
    engine.setQuality('med');
    expect(variant.frame).toHaveBeenCalledTimes(framesAtStart + 2);
    engine.dispose();
  });

  it('coalesces a resize storm into a single backing-store update', async () => {
    const canvas = createCanvas();
    const variant = { ...createVariant(), kind: 'solid' as const };
    const engine = new BackgroundEngine({ canvas, variant });
    const resize = vi.spyOn(engine, 'resize');

    engine.start();
    resize.mockClear();
    vi.mocked(canvas.getBoundingClientRect).mockReturnValue(canvasBounds(800, 450));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(resize).not.toHaveBeenCalled();
    await flushCoalescedResize();
    expect(resize).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it('applies policy presentation in place without recreating the variant', () => {
    const canvas = createCanvas();
    const variant = createVariant();
    const engine = new BackgroundEngine({
      canvas,
      variant,
      quality: 'high',
      frameCapFps: 30,
      dprCap: 2,
    });

    engine.start();
    expect(variant.init).toHaveBeenCalledTimes(1);
    engine.applyPresentation({ quality: 'med', frameCapFps: 21, dprCap: 1.5, staticMode: true });
    expect(engine.quality).toBe('med');
    expect(engine.frameCapFps).toBe(21);
    expect(engine.dprCap).toBe(1.5);
    expect(engine.staticMode).toBe(true);
    expect(variant.init).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it('caps backing-store DPR from the policy ceiling on a 3x display', () => {
    const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const canvas = createCanvas();
    const variant = { ...createVariant(), kind: 'solid' as const };
    const engine = new BackgroundEngine({ canvas, variant, quality: 'med', dprCap: 1.5 });

    try {
      engine.start();
      expect(canvas.width).toBe(960);
      expect(canvas.height).toBe(540);
    } finally {
      engine.dispose();
      if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    }
  });

  it('suppresses an older live canvas engine when a second live surface starts', () => {
    const raf = installControlledAnimationFrame();
    const first = new BackgroundEngine({ canvas: createCanvas(), variant: createVariant(), live: true });
    const second = new BackgroundEngine({ canvas: createCanvas(), variant: createVariant(), live: true });

    try {
      first.start();
      expect(raf.pendingCount()).toBe(1);
      second.start();
      expect(raf.pendingCount()).toBe(1);
      raf.runNext(16);
      expect(first.canvas.dataset.backgroundPaused).toBe('true');
    } finally {
      second.dispose();
      first.dispose();
      raf.restore();
    }
  });

  it('restores the displaced live engine when the replacement unmounts', () => {
    const raf = installControlledAnimationFrame();
    const first = new BackgroundEngine({ canvas: createCanvas(), variant: createVariant(), live: true });
    const second = new BackgroundEngine({ canvas: createCanvas(), variant: createVariant(), live: true });

    try {
      first.start();
      second.start();
      expect(first.canvas.dataset.backgroundPaused).toBe('true');

      second.dispose();

      expect(first.canvas.dataset.backgroundPaused).toBeUndefined();
      expect(raf.pendingCount()).toBe(1);
    } finally {
      second.dispose();
      first.dispose();
      raf.restore();
    }
  });

  it('does not displace a runnable engine when a replacement has no 2D context', () => {
    const first = new BackgroundEngine({ canvas: createCanvas(), variant: createVariant(), live: true });
    const failedCanvas = createCanvas();
    failedCanvas.getContext = vi.fn(() => null) as unknown as typeof failedCanvas.getContext;
    const failed = new BackgroundEngine({ canvas: failedCanvas, variant: createVariant(), live: true });

    try {
      first.start();
      failed.start();
      expect(first.canvas.dataset.backgroundPaused).toBeUndefined();
      expect(failed.canvas.dataset.backgroundPaused).toBeUndefined();
    } finally {
      failed.dispose();
      first.dispose();
    }
  });

  it('resizes and repaints a frozen canvas when DPR changes without a layout resize', () => {
    const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    const mediaQueries: Array<{
      media: string;
      listener: ((event: MediaQueryListEvent) => void) | null;
      removeEventListener: ReturnType<typeof vi.fn>;
    }> = [];
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((media) => {
      const record = {
        media,
        listener: null as ((event: MediaQueryListEvent) => void) | null,
        removeEventListener: vi.fn(),
      };
      mediaQueries.push(record);
      return {
        matches: true,
        media,
        onchange: null,
        addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
          record.listener = listener as (event: MediaQueryListEvent) => void;
        }),
        removeEventListener: record.removeEventListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    const canvas = createCanvas();
    const variant = { ...createVariant(), kind: 'solid' as const };
    const engine = new BackgroundEngine({ canvas, variant, quality: 'high' });

    try {
      engine.start();
      const context = vi.mocked(canvas.getContext).mock.results[0]?.value as CanvasRenderingContext2D;
      expect(canvas.width).toBe(640);
      expect(canvas.height).toBe(360);
      expect(mediaQueries[0]?.media).toBe('(resolution: 1dppx)');

      // The canvas keeps the same 640x360 CSS bounds; only display density
      // changes, which ResizeObserver alone cannot report.
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
      mediaQueries[0]?.listener?.(new Event('change') as MediaQueryListEvent);

      expect(canvas.width).toBe(1280);
      expect(canvas.height).toBe(720);
      expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
      expect(variant.frame).toHaveBeenCalledTimes(2);
      expect(mediaQueries[0]?.removeEventListener).toHaveBeenCalledWith(
        'change',
        mediaQueries[0]?.listener,
      );
      expect(mediaQueries[1]?.media).toBe('(resolution: 2dppx)');

      engine.dispose();
      expect(mediaQueries[1]?.removeEventListener).toHaveBeenCalledWith(
        'change',
        mediaQueries[1]?.listener,
      );
    } finally {
      engine.dispose();
      matchMedia.mockRestore();
      if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    }
  });

  it('keeps rendering when a partial matchMedia implementation rejects DPR listeners', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: vi.fn(() => {
        throw new TypeError('change listeners are unavailable');
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList));
    const variant = createVariant();
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant, staticMode: true });

    try {
      expect(() => engine.start()).not.toThrow();
      expect(variant.init).toHaveBeenCalledTimes(1);
      expect(variant.frame).toHaveBeenCalledTimes(1);
    } finally {
      engine.dispose();
      matchMedia.mockRestore();
    }
  });

  it('defers a frozen resize repaint while hidden and flushes it on visibility return', async () => {
    const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    const variant = { ...createVariant(), kind: 'solid' as const };
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant });

    try {
      setDocumentHidden(false);
      engine.start();
      const framesAtStart = (variant.frame as ReturnType<typeof vi.fn>).mock.calls.length;

      setDocumentHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      vi.mocked(engine.canvas.getBoundingClientRect).mockReturnValue(canvasBounds(800, 450));
      window.dispatchEvent(new Event('resize'));
      await flushCoalescedResize();
      expect(variant.frame).toHaveBeenCalledTimes(framesAtStart);
      expect(engine.canvas.dataset.backgroundPaused).toBe('true');

      setDocumentHidden(false);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(variant.frame).toHaveBeenCalledTimes(framesAtStart + 1);
    } finally {
      engine.dispose();
      restoreDocumentHidden(hidden);
    }
  });

  it.each(['activity', 'resize', 'visibility'] as const)(
    'resets accumulated FPS-guard evidence on %s',
    (resetKind) => {
      const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
      const raf = installControlledAnimationFrame();
      const now = vi.spyOn(performance, 'now').mockReturnValue(0);
      const variant = createVariant();
      const engine = new BackgroundEngine({
        canvas: createCanvas(),
        variant,
        targetFps: 60,
        fpsGuardFrames: 2,
      });

      try {
        setDocumentHidden(false);
        engine.start();
        engine.renderFrame(100); // one low-FPS strike
        now.mockReturnValue(101);

        if (resetKind === 'activity') {
          window.dispatchEvent(new Event('keydown'));
        } else if (resetKind === 'resize') {
          window.dispatchEvent(new Event('resize'));
        } else {
          setDocumentHidden(true);
          document.dispatchEvent(new Event('visibilitychange'));
          setDocumentHidden(false);
          document.dispatchEvent(new Event('visibilitychange'));
        }

        engine.renderFrame(200); // fresh baseline, not a second strike
        engine.renderFrame(300); // one strike in the new evidence window
        expect(engine.quality).toBe('high');
      } finally {
        engine.dispose();
        now.mockRestore();
        raf.restore();
        restoreDocumentHidden(hidden);
      }
    },
  );

  it('removes every activity and lifecycle listener with the same callback and options', () => {
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const variant = { ...createVariant(), kind: 'solid' as const };
    const engine = new BackgroundEngine({ canvas: createCanvas(), variant });

    try {
      engine.start();
      engine.dispose();

      for (const event of ['resize', 'blur', 'focus', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
        expectSymmetricListener(windowAdd.mock.calls, windowRemove.mock.calls, event);
      }
      for (const event of ['visibilitychange', 'scroll']) {
        expectSymmetricListener(documentAdd.mock.calls, documentRemove.mock.calls, event);
      }
    } finally {
      engine.dispose();
      windowAdd.mockRestore();
      windowRemove.mockRestore();
      documentAdd.mockRestore();
      documentRemove.mockRestore();
    }
  });
});

describe('static-frame theme refresh', () => {
  it('rendersSingleFrame is true only for static or solid renderers', () => {
    // Arrange / Act / Assert — the two cases that never loop and so must be
    // explicitly repainted when the theme changes.
    expect(rendersSingleFrame(true, 'animated')).toBe(true);
    expect(rendersSingleFrame(false, 'solid')).toBe(true);
    expect(rendersSingleFrame(true, 'solid')).toBe(true);
    // A live animated loop re-reads tokens every frame, so it needs no observer.
    expect(rendersSingleFrame(false, 'animated')).toBe(false);
  });

  it('isThemeMutation matches only the documentElement attributes a theme switch touches', () => {
    // Arrange
    const kinds: CanvasBackgroundKind[] = ['animated', 'solid'];

    // Act / Assert
    expect(isThemeMutation('style')).toBe(true);
    expect(isThemeMutation('class')).toBe(true);
    expect(isThemeMutation('data-theme')).toBe(true);
    expect(isThemeMutation('id')).toBe(false);
    expect(isThemeMutation('aria-hidden')).toBe(false);
    expect(isThemeMutation(null)).toBe(false);
    // Every solid variant must be caught by rendersSingleFrame.
    expect(kinds.filter((k) => rendersSingleFrame(false, k))).toEqual(['solid']);
  });

  it('repaints a solid background when the theme attribute changes', async () => {
    // Arrange — a solid variant renders one frame and never loops.
    const canvas = createCanvas();
    const variant: BackgroundVariant = {
      id: 'test-solid',
      label: 'Test Solid',
      kind: 'solid',
      init: vi.fn(),
      frame: vi.fn(),
      dispose: vi.fn(),
    };
    const engine = new BackgroundEngine({ canvas, variant });
    engine.start();
    const framesAfterStart = (variant.frame as ReturnType<typeof vi.fn>).mock.calls.length;

    // Act — simulate ThemeProvider flipping the active theme.
    document.documentElement.setAttribute('data-theme', 'pearl');
    await Promise.resolve(); // MutationObserver callbacks flush on the microtask queue.

    // Assert — the frozen frame was repainted so it picks up the new tokens.
    expect((variant.frame as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(framesAfterStart);

    engine.dispose();
    document.documentElement.removeAttribute('data-theme');
  });
});

describe('Background reduced-motion selection', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('keeps the theme scene but renders it static under reduced motion', async () => {
    // Arrange
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => create2dContext(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // Act — the variant render module is fetched on demand, so wait for the
    // canvas to replace the static placeholder.
    const { container } = render(() => <Background id="deep-current" quality="high" />);
    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas');
      expect(el).not.toBeNull();
      return el;
    });

    // Assert: the requested (animated) variant is kept — NOT swapped for a
    // generic solid — but reported/rendered as a still frame.
    expect(selectBackgroundId('deep-current', true)).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-id')).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('renders animated canvas backgrounds static when the user forces reduced motion', async () => {
    // Arrange
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => create2dContext(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    setPreference('reduceMotion', true);

    // Act
    const { container } = render(() => <Background id="deep-current" quality="high" />);
    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas');
      expect(el).not.toBeNull();
      return el;
    });

    // Assert
    expect(canvas?.getAttribute('data-background-id')).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('renders DOM scenes static when the user forces reduced motion', async () => {
    // Arrange
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    setPreference('reduceMotion', true);

    // Act
    const { container } = render(() => <Background id="starfield" quality="high" />);
    const host = await waitFor(() => {
      const el = container.querySelector('[data-background-id="starfield"]');
      expect(el).not.toBeNull();
      return el;
    });

    // Assert
    expect(host?.getAttribute('data-background-id')).toBe('starfield');
    expect(host?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('renders animated canvas backgrounds static when scene motion is still', async () => {
    // Arrange
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => create2dContext(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    setSceneMotion('still');

    // Act
    const { container } = render(() => <Background id="deep-current" quality="high" />);
    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas');
      expect(el).not.toBeNull();
      return el;
    });

    // Assert
    expect(canvas?.getAttribute('data-background-id')).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('does not mount a background renderer when scene motion is off', () => {
    // Arrange
    setSceneMotion('off');

    // Act
    const { container } = render(() => <Background id="deep-current" quality="high" />);

    // Assert
    expect(container.querySelector('[data-background-canvas]')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('Background policy application', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    if (innerWidthDescriptor) Object.defineProperty(window, 'innerWidth', innerWidthDescriptor);
    else Reflect.deleteProperty(window, 'innerWidth');
    if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
    else Reflect.deleteProperty(window, 'devicePixelRatio');
  });

  function stubDesktopMedia() {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => create2dContext(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  }

  function setViewport(width: number, dpr: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
  }

  it.each([
    { width: 320, dpr: 3 },
    { width: 390, dpr: 3 },
  ])('keeps a $width CSS-px DPR$dpr phone animated at med/balanced', async ({ width, dpr }) => {
    stubDesktopMedia();
    setViewport(width, dpr);

    const { container } = render(() => <Background id="deep-current" quality="high" />);
    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas');
      expect(el).not.toBeNull();
      return el as HTMLCanvasElement;
    });

    expect(canvas.getAttribute('data-background-mode')).toBe('animated');
    expect(canvas.getAttribute('data-background-quality')).toBe('med');
    expect(canvas.getAttribute('data-background-detail')).toBe('balanced');
    expect(canvas.getAttribute('data-background-kind')).toBe('animated');
    const fps = Number(canvas.getAttribute('data-background-fps'));
    expect(fps).toBeGreaterThanOrEqual(18);
    expect(fps).toBeLessThanOrEqual(24);
    expect(canvas.getAttribute('data-background-dpr-cap')).toBe('1.5');
  });

  it('caps a desktop DPR2+ wallpaper at high/full and dpr 2', async () => {
    stubDesktopMedia();
    setViewport(1440, 2.75);

    const { container } = render(() => <Background id="deep-current" />);
    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas');
      expect(el).not.toBeNull();
      return el as HTMLCanvasElement;
    });

    expect(canvas.getAttribute('data-background-mode')).toBe('animated');
    expect(canvas.getAttribute('data-background-quality')).toBe('high');
    expect(canvas.getAttribute('data-background-detail')).toBe('full');
    expect(canvas.getAttribute('data-background-fps')).toBe('30');
    expect(canvas.getAttribute('data-background-dpr-cap')).toBe('2');
  });

  it('caps a preview surface at low/sparse regardless of desktop size', async () => {
    stubDesktopMedia();
    setViewport(1440, 2);

    const { container } = render(() => <Background id="deep-current" preview />);
    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas');
      expect(el).not.toBeNull();
      return el as HTMLCanvasElement;
    });

    expect(canvas.getAttribute('data-background-quality')).toBe('low');
    expect(canvas.getAttribute('data-background-detail')).toBe('sparse');
    expect(canvas.getAttribute('data-background-preview')).toBe('true');
    expect(canvas.getAttribute('data-background-dpr-cap')).toBe('1');
  });
});

describe('background variants', () => {
  it.each(backgroundRegistry)('$id keeps init setup-only', (variant) => {
    const frame = vi.spyOn(variant, 'frame');

    try {
      variant.init(createFrameContext());
      expect(frame).not.toHaveBeenCalled();
    } finally {
      frame.mockRestore();
    }
  });

  it.each(backgroundRegistry)('runs init, frame, and dispose for $id without throwing', (variant) => {
    // Arrange
    const ctx = createFrameContext();

    // Act
    const runVariant = () => {
      variant.init(ctx);
      variant.frame(ctx, 1234);
      variant.dispose();
    };

    // Assert
    expect(runVariant).not.toThrow();
  });
});

describe('themed background variants', () => {
  const themedVariants: Array<{ id: BackgroundId; label: string }> = [
    { id: 'ember', label: 'Ember' },
    { id: 'forest', label: 'Grove' },
    { id: 'resin', label: 'Resin' },
    { id: 'ink-wash', label: 'Ink wash' },
    { id: 'mist', label: 'Mist' },
    { id: 'frost', label: 'Frost' },
  ];

  it.each(themedVariants)('registers $id with the label $label', ({ id, label }) => {
    // Act
    const variant = getBackground(id);

    // Assert
    expect(variant?.label).toBe(label);
    expect(variant?.kind).toBe('animated');
  });

  it.each(themedVariants)('renders $id across a long animation timeline without throwing', ({ id }) => {
    // Arrange
    const variant = backgroundRegistry.find((entry) => entry.id === id);
    const ctx = createFrameContext();
    const timeline = [0, 16, 1000, 60_000, 3_600_000];

    // Act
    const runTimeline = () => {
      variant?.init(ctx);
      for (const time of timeline) variant?.frame(ctx, time);
      variant?.dispose();
    };

    // Assert
    expect(variant).toBeDefined();
    expect(runTimeline).not.toThrow();
  });

  it.each(themedVariants)('renders $id at reduced quality scales without throwing', ({ id }) => {
    // Arrange
    const variant = backgroundRegistry.find((entry) => entry.id === id);
    const ctx = { ...createFrameContext(), quality: 'low' as const, qualityScale: 0.52 };

    // Act
    const runVariant = () => {
      variant?.init(ctx);
      variant?.frame(ctx, 5678);
      variant?.dispose();
    };

    // Assert
    expect(runVariant).not.toThrow();
  });
});

describe('scene variants', () => {
  // Scenes are DOM/SVG components — they must NOT run through the canvas
  // init/frame/dispose iterator above. Render-smoke them instead.
  it.each(sceneRegistry)('mounts the $id scene without throwing', (scene) => {
    // Act
    const { container } = render(() => <Dynamic component={scene.component} reducedMotion={false} />);
    const root = container.querySelector('.onyx-scene');

    // Assert
    expect(root).not.toBeNull();
    expect(root?.hasAttribute('data-scene-static')).toBe(false);
    // More than just the injected <style> — the scene actually drew layers.
    expect(root?.children.length ?? 0).toBeGreaterThan(1);
  });

  it.each(sceneRegistry)('freezes the $id scene under reduced motion', (scene) => {
    // Act
    const { container } = render(() => <Dynamic component={scene.component} reducedMotion={true} />);
    const root = container.querySelector('.onyx-scene');

    // Assert
    expect(root?.getAttribute('data-scene-static')).toBe('true');
    expect(root?.getAttribute('data-scene-paused')).toBe('true');
  });

  it('omits expensive Starfield layers under the sparse policy hook', async () => {
    const { ScenePolicyProvider } = await import('./scenes/scenePolicy');
    const scene = sceneRegistry.find((entry) => entry.id === 'starfield');
    expect(scene).toBeDefined();
    const { container } = render(() => (
      <ScenePolicyProvider value={() => ({ sceneDetail: 'sparse', reducedMotion: false, paused: false })}>
        <Dynamic component={scene!.component} reducedMotion={false} sceneDetail="sparse" />
      </ScenePolicyProvider>
    ));
    const root = container.querySelector('.onyx-scene');
    expect(root?.getAttribute('data-scene-detail')).toBe('sparse');
    expect(root?.querySelector('[data-scene-layer="stars"]')).not.toBeNull();
    expect(root?.querySelector('[data-scene-layer="shooters"]')).toBeNull();
    expect(root?.querySelector('[data-scene-layer="milky-way"]')).toBeNull();
    expect(root?.querySelector('[data-scene-layer="grain"]')).toBeNull();
  });

  it.each([
    { id: 'aurora-borealis', omitted: 'crackles' },
    { id: 'lightning', omitted: 'sheet-flashes' },
    { id: 'neon-night', omitted: 'lightning' },
    { id: 'phoenix', omitted: 'feathers' },
    { id: 'retro-arcade', omitted: 'explosions' },
    { id: 'volcanic', omitted: 'debris' },
  ] as const)('enforces sparse detail for $id by omitting $omitted', ({ id, omitted }) => {
    const scene = sceneRegistry.find((entry) => entry.id === id);
    expect(scene).toBeDefined();
    const { container, unmount } = render(() => (
      <Dynamic component={scene!.component} reducedMotion={false} sceneDetail="sparse" />
    ));

    try {
      const root = container.querySelector('.onyx-scene');
      expect(root?.getAttribute('data-scene-detail')).toBe('sparse');
      expect(root?.querySelector(`[data-scene-layer="${omitted}"]`)).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe('Background scene rendering', () => {
  it('renders a scene variant in a fixed DOM container instead of a canvas', async () => {
    // Act — scene render module loads on demand.
    const { container } = render(() => <Background id="starfield" />);
    const host = await waitFor(() => {
      const el = container.querySelector('[data-background-id="starfield"]');
      expect(el).not.toBeNull();
      return el;
    });

    // Assert
    expect(container.querySelector('canvas')).toBeNull();
    expect(host?.getAttribute('data-background-id')).toBe('starfield');
    expect(host?.getAttribute('data-background-kind')).toBe('scene');
    expect(host?.querySelector('.onyx-scene')).not.toBeNull();
  });

  it('keeps the canvas engine path for canvas variants', async () => {
    // Arrange
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => create2dContext(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
      // Act
      const { container } = render(() => <Background id="deep-current" />);

      // Assert
      await waitFor(() => {
        expect(container.querySelector('canvas')).not.toBeNull();
      });
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });
});

function createVariant(): BackgroundVariant {
  return {
    id: 'test-low-fps',
    label: 'Test Low FPS',
    kind: 'animated',
    init: vi.fn(),
    frame: vi.fn(),
    dispose: vi.fn(),
  };
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 640, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: 360, configurable: true });
  canvas.getBoundingClientRect = vi.fn(() => canvasBounds(640, 360));
  canvas.getContext = vi.fn(() => create2dContext()) as unknown as typeof canvas.getContext;
  return canvas;
}

function flushCoalescedResize(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else queueMicrotask(() => resolve());
  });
}

function canvasBounds(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => '',
  } as DOMRect;
}

function createFrameContext(): BackgroundFrameContext {
  return {
    canvas: createCanvas(),
    context: create2dContext(),
    width: 640,
    height: 360,
    dpr: 1,
    quality: 'high',
    qualityScale: 1,
  };
}

function create2dContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  return {
    canvas: document.createElement('canvas'),
    fillStyle: '#000000',
    strokeStyle: '#ffffff',
    shadowColor: 'transparent',
    shadowBlur: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDashOffset: 0,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    measureText: vi.fn(() => ({ width: 0 }) as TextMetrics),
  } as unknown as CanvasRenderingContext2D;
}

function installControlledAnimationFrame(): {
  runNext(time: number): void;
  pendingCount(): number;
  restore(): void;
} {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    callbacks.delete(id);
  }) as typeof cancelAnimationFrame;

  return {
    runNext(time) {
      const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error('No animation frame is scheduled');
      callbacks.delete(next[0]);
      next[1](time);
    },
    pendingCount() {
      return callbacks.size;
    },
    restore() {
      callbacks.clear();
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

function restoreDocumentHidden(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(document, 'hidden', descriptor);
  else Reflect.deleteProperty(document, 'hidden');
}

function expectSymmetricListener(
  addedCalls: readonly (readonly unknown[])[],
  removedCalls: readonly (readonly unknown[])[],
  event: string,
): void {
  const added = addedCalls.find((call) => call[0] === event);
  const removed = removedCalls.find((call) => call[0] === event);
  expect(added, `${event} listener was not attached`).toBeDefined();
  expect(removed, `${event} listener was not removed`).toBeDefined();
  expect(removed?.[1]).toBe(added?.[1]);
  expect(removed?.[2]).toBe(added?.[2]);
}
