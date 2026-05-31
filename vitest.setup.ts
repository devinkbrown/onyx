import '@testing-library/jest-dom';
import React from 'react';

// ── localStorage polyfill for jsdom ──────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock: Storage = {
  get length() { return Object.keys(store).length; },
  key(index: number) { return Object.keys(store)[index] ?? null; },
  getItem(k: string) { return store[k] ?? null; },
  setItem(k: string, v: string) { store[k] = v; },
  removeItem(k: string) { delete store[k]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
// ─────────────────────────────────────────────────────────────────────────────

// Stub next/navigation for components that import it
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

// Stub next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => {
    return React.createElement('a', { href, ...rest }, children);
  },
}));

// Stub AudioContext / WebAudio APIs not available in jsdom
Object.defineProperty(globalThis, 'AudioContext', {
  writable: true,
  value: class MockAudioContext {
    createAnalyser() {
      return { fftSize: 0, frequencyBinCount: 0, getByteFrequencyData: () => {}, connect: () => {} };
    }
    createMediaStreamSource() { return { connect: () => {} }; }
    close() { return Promise.resolve(); }
  },
});

// Stub MediaDevices
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockRejectedValue(new Error('not available in test')),
    getDisplayMedia: vi.fn().mockRejectedValue(new Error('not available in test')),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  },
});

// Stub requestAnimationFrame
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
