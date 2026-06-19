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
