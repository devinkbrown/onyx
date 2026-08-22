// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * rowGesture.test.ts — swipe arms reply; long-press opens actions;
 * mouse/hover path stays inert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRowGesture,
  ROW_GESTURE,
  shouldIgnoreRowGestureClick,
} from './rowGesture';

function pointer(
  type: string,
  el: HTMLElement,
  init: PointerEventInit & { target?: EventTarget } = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: 0,
    clientY: 0,
    ...init,
  });
  Object.defineProperty(event, 'currentTarget', { value: el });
  if (init.target) {
    Object.defineProperty(event, 'target', { value: init.target });
  } else {
    Object.defineProperty(event, 'target', { value: el });
  }
  return event;
}

describe('createRowGesture', () => {
  let row: HTMLElement;
  let onSwipeReply: ReturnType<typeof vi.fn>;
  let onLongPressMenu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    row = document.createElement('article');
    document.body.append(row);
    onSwipeReply = vi.fn();
    onLongPressMenu = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
    } as Selection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('dir');
  });

  function makeGesture(overrides: Parameters<typeof createRowGesture>[1] = {}) {
    return createRowGesture({ onSwipeReply, onLongPressMenu }, overrides);
  }

  it('arms reply after a right swipe past the commit threshold', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 40 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 20 + ROW_GESTURE.swipeArmPx, clientY: 42 }));
    expect(gesture.getPhase()).toBe('armed');
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 20 + ROW_GESTURE.swipeArmPx, clientY: 42 }));
    expect(onSwipeReply).toHaveBeenCalledOnce();
    expect(onLongPressMenu).not.toHaveBeenCalled();
    expect(gesture.getPhase()).toBe('idle');
  });

  it('does not arm reply when the swipe falls short', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 40 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 20 + ROW_GESTURE.swipeArmPx - 8, clientY: 40 }));
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 50, clientY: 40 }));
    expect(onSwipeReply).not.toHaveBeenCalled();
    expect(gesture.getPhase()).toBe('idle');
  });

  it('ignores a left swipe in LTR', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 80, clientY: 40 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 10, clientY: 40 }));
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 10, clientY: 40 }));
    expect(onSwipeReply).not.toHaveBeenCalled();
  });

  it('uses the platform-natural swipe in RTL (swipe toward start)', () => {
    document.documentElement.dir = 'rtl';
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 100, clientY: 40 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 100 - ROW_GESTURE.swipeArmPx, clientY: 40 }));
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 28, clientY: 40 }));
    expect(onSwipeReply).toHaveBeenCalledOnce();
  });

  it('lets a vertical-dominant move stay a scroll (no reply, no menu)', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 20 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 28, clientY: 80 }));
    expect(gesture.getPhase()).toBe('idle');
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 28, clientY: 80 }));
    expect(onSwipeReply).not.toHaveBeenCalled();
    expect(onLongPressMenu).not.toHaveBeenCalled();
  });

  it('opens actions after a still long-press', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 24, clientY: 24 }));
    expect(gesture.getPhase()).toBe('long-pressing');
    vi.advanceTimersByTime(ROW_GESTURE.longPressMs);
    expect(onLongPressMenu).toHaveBeenCalledOnce();
    expect(onSwipeReply).not.toHaveBeenCalled();
    expect(gesture.getPhase()).toBe('done');
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 24, clientY: 24 }));
    expect(gesture.getPhase()).toBe('idle');
  });

  it('cancels long-press when the finger moves', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 24, clientY: 24 }));
    gesture.onPointerMove(pointer('pointermove', row, {
      clientX: 24 + ROW_GESTURE.longPressMotionCancelPx + 1,
      clientY: 24,
    }));
    vi.advanceTimersByTime(ROW_GESTURE.longPressMs + 50);
    expect(onLongPressMenu).not.toHaveBeenCalled();
  });

  it('does not fire for a non-primary pointer', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { isPrimary: false, clientX: 20, clientY: 20 }));
    vi.advanceTimersByTime(ROW_GESTURE.longPressMs);
    expect(onLongPressMenu).not.toHaveBeenCalled();
    expect(gesture.getPhase()).toBe('idle');
  });

  it('does not steal mouse drags — desktop hover/right-click stay the path', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, {
      pointerType: 'mouse',
      clientX: 20,
      clientY: 40,
    }));
    gesture.onPointerMove(pointer('pointermove', row, {
      pointerType: 'mouse',
      clientX: 20 + ROW_GESTURE.swipeArmPx,
      clientY: 40,
    }));
    gesture.onPointerUp(pointer('pointerup', row, {
      pointerType: 'mouse',
      clientX: 20 + ROW_GESTURE.swipeArmPx,
      clientY: 40,
    }));
    vi.advanceTimersByTime(ROW_GESTURE.longPressMs);
    expect(onSwipeReply).not.toHaveBeenCalled();
    expect(onLongPressMenu).not.toHaveBeenCalled();
  });

  it('ignores pointerdown on an interactive child', () => {
    const button = document.createElement('button');
    row.append(button);
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 20, target: button }));
    vi.advanceTimersByTime(ROW_GESTURE.longPressMs);
    expect(onLongPressMenu).not.toHaveBeenCalled();
  });

  it('ignores pointerdown when text is already selected', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as Selection);
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 20 }));
    vi.advanceTimersByTime(ROW_GESTURE.longPressMs);
    expect(onLongPressMenu).not.toHaveBeenCalled();
  });

  it('still arms reply under reduced motion (no visual, same action)', () => {
    const gesture = makeGesture({ prefersReducedMotion: () => true });
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 16, clientY: 16 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 16 + ROW_GESTURE.swipeArmPx, clientY: 16 }));
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 16 + ROW_GESTURE.swipeArmPx, clientY: 16 }));
    expect(onSwipeReply).toHaveBeenCalledOnce();
    expect(row.style.getPropertyValue('--row-swipe-x')).toBe('');
  });

  it('cancels an in-progress swipe on pointercancel', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 40 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 20 + ROW_GESTURE.swipeArmPx, clientY: 40 }));
    gesture.onPointerCancel(pointer('pointercancel', row, { clientX: 20 + ROW_GESTURE.swipeArmPx, clientY: 40 }));
    expect(onSwipeReply).not.toHaveBeenCalled();
    expect(gesture.getPhase()).toBe('idle');
  });

  it('suppresses the ghost click after a committed swipe', () => {
    const gesture = makeGesture();
    gesture.onPointerDown(pointer('pointerdown', row, { clientX: 20, clientY: 40 }));
    gesture.onPointerMove(pointer('pointermove', row, { clientX: 20 + ROW_GESTURE.swipeArmPx, clientY: 40 }));
    gesture.onPointerUp(pointer('pointerup', row, { clientX: 20 + ROW_GESTURE.swipeArmPx, clientY: 40 }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'currentTarget', { value: row });
    expect(shouldIgnoreRowGestureClick(click)).toBe(true);
    row.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});
