import '@testing-library/jest-dom';
import { cleanup } from '@solidjs/testing-library';
import { afterEach } from 'vitest';

// Unmount Solid trees between tests.
afterEach(() => cleanup());

// ── localStorage / sessionStorage polyfill for jsdom ─────────────────────────
function makeStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    key(i: number) { return Object.keys(store)[i] ?? null; },
    getItem(k: string) { return store[k] ?? null; },
    setItem(k: string, v: string) { store[k] = String(v); },
    removeItem(k: string) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  } as Storage;
}
Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: makeStorage(), writable: true });

// ── matchMedia (reduced-motion, theme queries) ───────────────────────────────
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// ── Observers not in jsdom ───────────────────────────────────────────────────
class MockObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
globalThis.ResizeObserver ??= MockObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= MockObserver as unknown as typeof IntersectionObserver;

// ── WebAudio + media (the suimyaku media engine touches these) ────────────────
Object.defineProperty(globalThis, 'AudioContext', {
  writable: true,
  value: class MockAudioContext {
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 0, getByteFrequencyData: () => {}, connect: () => {} }; }
    createMediaStreamSource() { return { connect: () => {} }; }
    createGain() { return { gain: { value: 1 }, connect: () => {} }; }
    close() { return Promise.resolve(); }
  },
});
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: () => Promise.reject(new Error('not available in test')),
    getDisplayMedia: () => Promise.reject(new Error('not available in test')),
    enumerateDevices: () => Promise.resolve([]),
  },
});

// ── rAF ──────────────────────────────────────────────────────────────────────
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

// ── scroll APIs jsdom lacks (message-view autoscroll, etc.) ──────────────────
if (typeof Element !== 'undefined') {
  Element.prototype.scrollTo = Element.prototype.scrollTo || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  Element.prototype.scrollBy = Element.prototype.scrollBy || (() => {});
}

// ── Canvas 2D context stub (jsdom has none) — lets the background engine + any
//    canvas component mount in tests. Every method is a no-op; gradients/text/
//    imageData return minimal shapes; property sets are accepted. ──────────────
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null;
    const noop = () => {};
    return new Proxy(
      { canvas: this } as Record<string, unknown>,
      {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          if (prop === 'measureText') return () => ({ width: 0 });
          if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern')
            return () => ({ addColorStop: noop });
          return noop;
        },
        set() {
          return true;
        },
      },
    );
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
