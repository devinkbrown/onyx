// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  boundedVirtualKeyboardInset,
  createVirtualKeyboardOverlayController,
  VIRTUAL_KEYBOARD_INSET_PROPERTY,
} from './virtualKeyboardOverlay';

class VirtualKeyboardMock {
  overlaysContent = false;
  boundingRect = { top: 800, bottom: 800, height: 0 };
  readonly listeners = new Set<EventListener>();
  readonly removed: EventListener[] = [];

  addEventListener(type: 'geometrychange', listener: EventListener): void {
    if (type === 'geometrychange') this.listeners.add(listener);
  }

  removeEventListener(type: 'geometrychange', listener: EventListener): void {
    if (type !== 'geometrychange') return;
    this.listeners.delete(listener);
    this.removed.push(listener);
  }

  emitGeometry(): void {
    for (const listener of this.listeners) listener(new Event('geometrychange'));
  }
}

function stubKeyboard(keyboard: unknown): void {
  const nextNavigator = Object.create(navigator) as Navigator & { virtualKeyboard?: unknown };
  nextNavigator.virtualKeyboard = keyboard;
  vi.stubGlobal('navigator', nextNavigator);
}

describe('VirtualKeyboard overlay controller', () => {
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when the optional API is unavailable', () => {
    stubKeyboard(undefined);
    const root = document.createElement('div');

    expect(createVirtualKeyboardOverlayController(root)).toBeNull();
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('');
  });

  it('enables only in mobile mode, tracks geometry, and restores prior state', () => {
    const keyboard = new VirtualKeyboardMock();
    keyboard.boundingRect = { top: 500, bottom: 800, height: 300 };
    stubKeyboard(keyboard);
    const root = document.createElement('div');
    root.style.setProperty(VIRTUAL_KEYBOARD_INSET_PROPERTY, '7px', 'important');
    const controller = createVirtualKeyboardOverlayController(root)!;

    controller.setMobile(false);
    expect(keyboard.overlaysContent).toBe(false);
    expect(keyboard.listeners.size).toBe(0);
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('7px');

    controller.setMobile(true);
    expect(keyboard.overlaysContent).toBe(true);
    expect(keyboard.listeners.size).toBe(1);
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('300px');

    keyboard.boundingRect = { top: 620, bottom: 800, height: 180 };
    keyboard.emitGeometry();
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('180px');

    controller.setMobile(false);
    expect(keyboard.overlaysContent).toBe(false);
    expect(keyboard.listeners.size).toBe(0);
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('7px');
    expect(root.style.getPropertyPriority(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('important');
  });

  it('restores an already-enabled overlay flag on dispose', () => {
    const keyboard = new VirtualKeyboardMock();
    keyboard.overlaysContent = true;
    keyboard.boundingRect = { top: 540, bottom: 800, height: 260 };
    stubKeyboard(keyboard);
    const root = document.createElement('div');
    const controller = createVirtualKeyboardOverlayController(root)!;

    controller.setMobile(true);
    controller.dispose();

    expect(keyboard.overlaysContent).toBe(true);
    expect(keyboard.listeners.size).toBe(0);
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('');
  });

  it('bounds hostile geometry and ignores floating keyboards away from the bottom edge', () => {
    expect(boundedVirtualKeyboardInset(
      { top: -9_200, bottom: 800, height: 10_000 },
      800,
    )).toBe(600);
    expect(boundedVirtualKeyboardInset(
      { top: 400, bottom: 600, height: 200 },
      800,
    )).toBe(0);
    expect(boundedVirtualKeyboardInset(
      { top: Number.NaN, bottom: Number.NaN, height: Number.NaN },
      800,
    )).toBe(0);
    expect(boundedVirtualKeyboardInset(
      { top: 700, bottom: 800, height: -10 },
      800,
    )).toBe(0);
  });

  it('ignores a queued geometry callback from an older mobile activation', () => {
    const keyboard = new VirtualKeyboardMock();
    keyboard.boundingRect = { top: 500, bottom: 800, height: 300 };
    stubKeyboard(keyboard);
    const root = document.createElement('div');
    const controller = createVirtualKeyboardOverlayController(root)!;

    controller.setMobile(true);
    const staleListener = [...keyboard.listeners][0]!;
    controller.setMobile(false);
    keyboard.boundingRect = { top: 650, bottom: 800, height: 150 };
    controller.setMobile(true);
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('150px');

    keyboard.boundingRect = { top: 720, bottom: 800, height: 80 };
    staleListener(new Event('geometrychange'));
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('150px');
  });

  it('never scrolls the page while geometry changes', () => {
    const keyboard = new VirtualKeyboardMock();
    keyboard.boundingRect = { top: 500, bottom: 800, height: 300 };
    stubKeyboard(keyboard);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const root = document.createElement('div');
    const controller = createVirtualKeyboardOverlayController(root)!;

    controller.setMobile(true);
    keyboard.boundingRect = { top: 600, bottom: 800, height: 200 };
    keyboard.emitGeometry();

    expect(scrollTo).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('rolls back when enabling overlay mode throws after changing the flag', () => {
    let overlay = false;
    const keyboard = {
      boundingRect: { top: 500, bottom: 800, height: 300 },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      get overlaysContent(): boolean {
        return overlay;
      },
      set overlaysContent(value: boolean) {
        overlay = value;
        if (value) throw new Error('optional API failed');
      },
    };
    stubKeyboard(keyboard);
    const root = document.createElement('div');
    const controller = createVirtualKeyboardOverlayController(root)!;

    controller.setMobile(true);

    expect(overlay).toBe(false);
    expect(keyboard.addEventListener).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('');
  });
});
