import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dynamic } from 'solid-js/web';
import { Background, selectBackgroundId } from './Background';
import {
  BackgroundEngine,
  isThemeMutation,
  rendersSingleFrame,
  type BackgroundFrameContext,
  type BackgroundKind,
  type BackgroundVariant,
  type CanvasBackgroundKind,
} from './engine';
import { allBackgroundVariants, backgroundRegistry, getBackground, sceneRegistry, type BackgroundId } from './registry';
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
      'kintsugi-veins': 'animated',
      ember: 'animated',
      forest: 'animated',
      resin: 'animated',
      'sumi-e': 'animated',
      mist: 'animated',
      frost: 'animated',
      obsidian: 'solid',
      'lapis-gradient': 'solid',
      washi: 'solid',
      'retro-arcade': 'scene',
      starfield: 'scene',
      lightning: 'scene',
      phoenix: 'scene',
      'aurora-borealis': 'scene',
      volcanic: 'scene',
      'tokyo-night': 'scene',
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

  it('keeps the theme scene but renders it static under reduced motion', () => {
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

    // Act
    const { container } = render(() => <Background id="deep-current" quality="high" />);
    const canvas = container.querySelector('canvas');

    // Assert: the requested (animated) variant is kept — NOT swapped for a
    // generic solid — but reported/rendered as a still frame.
    expect(selectBackgroundId('deep-current', true)).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-id')).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('renders animated canvas backgrounds static when the user forces reduced motion', () => {
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
    const canvas = container.querySelector('canvas');

    // Assert
    expect(canvas?.getAttribute('data-background-id')).toBe('deep-current');
    expect(canvas?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('renders DOM scenes static when the user forces reduced motion', () => {
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
    const host = container.querySelector('[data-background-canvas]');

    // Assert
    expect(host?.getAttribute('data-background-id')).toBe('starfield');
    expect(host?.getAttribute('data-background-kind')).toBe('solid');
  });

  it('renders animated canvas backgrounds static when scene motion is still', () => {
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
    const canvas = container.querySelector('canvas');

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

describe('background variants', () => {
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
    { id: 'sumi-e', label: 'Sumi-e' },
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
  });
});

describe('Background scene rendering', () => {
  it('renders a scene variant in a fixed DOM container instead of a canvas', () => {
    // Act
    const { container } = render(() => <Background id="starfield" />);
    const host = container.querySelector('[data-background-canvas]');

    // Assert
    expect(container.querySelector('canvas')).toBeNull();
    expect(host?.getAttribute('data-background-id')).toBe('starfield');
    expect(host?.getAttribute('data-background-kind')).toBe('scene');
    expect(host?.querySelector('.onyx-scene')).not.toBeNull();
  });

  it('keeps the canvas engine path for canvas variants', () => {
    // Arrange
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => create2dContext(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
      // Act
      const { container } = render(() => <Background id="deep-current" />);

      // Assert
      expect(container.querySelector('canvas')).not.toBeNull();
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
  canvas.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    width: 640,
    height: 360,
    top: 0,
    right: 640,
    bottom: 360,
    left: 0,
    toJSON: () => '',
  }));
  canvas.getContext = vi.fn(() => create2dContext()) as unknown as typeof canvas.getContext;
  return canvas;
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
