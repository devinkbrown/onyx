import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Background, selectBackgroundId } from './Background';
import { BackgroundEngine, type BackgroundFrameContext, type BackgroundVariant } from './engine';
import { backgroundRegistry, getBackground, type BackgroundId } from './registry';

afterEach(() => cleanup());

describe('background registry', () => {
  it('keeps every variant id unique', () => {
    // Arrange
    const ids = backgroundRegistry.map((variant) => variant.id);

    // Act
    const uniqueIds = new Set(ids);

    // Assert
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('exposes readable labels for every variant', () => {
    // Arrange
    const labels = backgroundRegistry.map((variant) => variant.label);

    // Act
    const blankLabels = labels.filter((label) => label.trim().length === 0);

    // Assert
    expect(blankLabels).toEqual([]);
  });

  it('classifies animated and solid variants correctly', () => {
    // Arrange
    const expectedKinds: Record<BackgroundId, BackgroundVariant['kind']> = {
      'kintsugi-veins': 'animated',
      aurora: 'animated',
      'pyrite-field': 'animated',
      'deep-current': 'animated',
      obsidian: 'solid',
      'lapis-gradient': 'solid',
      washi: 'solid',
    };

    // Act
    const actualKinds = Object.fromEntries(backgroundRegistry.map((variant) => [variant.id, variant.kind]));

    // Assert
    expect(actualKinds).toEqual(expectedKinds);
  });

  it('finds registered variants by id', () => {
    // Arrange
    const id = 'kintsugi-veins';

    // Act
    const variant = getBackground(id);

    // Assert
    expect(variant?.label).toBe('Kintsugi Veins');
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

describe('Background reduced-motion selection', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('selects a solid variant when the user prefers reduced motion', () => {
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
    const { container } = render(() => <Background id="kintsugi-veins" quality="high" />);
    const canvas = container.querySelector('canvas');

    // Assert
    expect(selectBackgroundId('kintsugi-veins', true)).toBe('lapis-gradient');
    expect(canvas?.getAttribute('data-background-id')).toBe('lapis-gradient');
    expect(canvas?.getAttribute('data-background-kind')).toBe('solid');
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
