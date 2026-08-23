// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDLE_HOLD_AFTER_MS } from '../engine';
import { SCENE_IDLE_HOLD_MS, startSceneRuntime } from './sceneRuntime';

const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const hasFocusDescriptor = Object.getOwnPropertyDescriptor(document, 'hasFocus');

beforeEach(() => {
  vi.useFakeTimers();
  setDocumentHidden(false);
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
});

afterEach(() => {
  window.dispatchEvent(new Event('focus'));
  vi.useRealTimers();
  restoreDocumentHidden();
  restoreDocumentHasFocus();
});

describe('scene runtime lifecycle', () => {
  it('uses the same prolonged-idle hold threshold as canvas backgrounds', () => {
    expect(SCENE_IDLE_HOLD_MS).toBe(IDLE_HOLD_AFTER_MS);
  });

  it('holds after sustained inactivity, resumes on activity, and throttles bursts', () => {
    const changes: boolean[] = [];
    let now = 0;
    const dispose = startSceneRuntime((paused) => changes.push(paused), {
      idleHoldMs: 1000,
      now: () => now,
    });

    vi.advanceTimersByTime(999);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);

    now = 1000;
    window.dispatchEvent(new Event('pointerdown'));
    expect(changes).toEqual([true, false]);

    vi.advanceTimersByTime(100);
    now = 1100;
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(900);
    // The second event was inside the throttle window, so it did not move the
    // first accepted activity's deadline from t=2000 to t=2100.
    expect(changes).toEqual([true, false, true]);

    dispose();
  });

  it('pauses immediately while hidden or blurred and resumes on visibility/focus', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const changes: boolean[] = [];
    const dispose = startSceneRuntime((paused) => changes.push(paused), { idleHoldMs: 1000 });

    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(changes.at(-1)).toBe(true);

    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(changes.at(-1)).toBe(false);

    window.dispatchEvent(new Event('blur'));
    expect(changes.at(-1)).toBe(true);
    window.dispatchEvent(new Event('wheel'));
    expect(changes.at(-1)).toBe(true);

    window.dispatchEvent(new Event('focus'));
    expect(changes.at(-1)).toBe(false);

    dispose();
  });

  it('does not freeze a visible phone tab when hasFocus is false', () => {
    const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
    const changes: boolean[] = [];
    const dispose = startSceneRuntime((paused) => changes.push(paused), { idleHoldMs: 1000 });

    expect(changes).toEqual([]);
    window.dispatchEvent(new Event('blur'));
    expect(changes).toEqual([]);

    dispose();
    if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
    else Reflect.deleteProperty(window, 'innerWidth');
  });

  it('removes every listener symmetrically and cancels the idle hold', () => {
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const changes: boolean[] = [];
    const dispose = startSceneRuntime((paused) => changes.push(paused), { idleHoldMs: 1000 });

    dispose();
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event('blur'));
    expect(changes).toEqual([]);

    for (const event of ['blur', 'focus', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
      expectSymmetricListener(windowAdd.mock.calls, windowRemove.mock.calls, event);
    }
    for (const event of ['visibilitychange', 'scroll']) {
      expectSymmetricListener(documentAdd.mock.calls, documentRemove.mock.calls, event);
    }

    windowAdd.mockRestore();
    windowRemove.mockRestore();
    documentAdd.mockRestore();
    documentRemove.mockRestore();
  });
});

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

function restoreDocumentHidden(): void {
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
  else Reflect.deleteProperty(document, 'hidden');
}

function restoreDocumentHasFocus(): void {
  if (hasFocusDescriptor) Object.defineProperty(document, 'hasFocus', hasFocusDescriptor);
  else Reflect.deleteProperty(document, 'hasFocus');
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
