// SPDX-License-Identifier: AGPL-3.0-or-later

export const VIRTUAL_KEYBOARD_INSET_PROPERTY = '--shell-virtual-keyboard-inset';
export const MAX_VIRTUAL_KEYBOARD_INSET_PX = 640;

type KeyboardRect = {
  bottom?: number;
  height?: number;
  top?: number;
};

type VirtualKeyboardLike = {
  addEventListener: (type: 'geometrychange', listener: EventListener) => void;
  boundingRect: KeyboardRect;
  overlaysContent: boolean;
  removeEventListener: (type: 'geometrychange', listener: EventListener) => void;
};

export type VirtualKeyboardOverlayController = {
  /** Activate only while the connected shell is using its mobile layout. */
  setMobile: (mobile: boolean) => void;
  /** Restore the API flag, listeners, and any inline inset owned by this controller. */
  dispose: () => void;
};

function virtualKeyboardApi(): VirtualKeyboardLike | null {
  if (typeof navigator === 'undefined') return null;
  try {
    const keyboard = (navigator as Navigator & { virtualKeyboard?: unknown }).virtualKeyboard;
    if (typeof keyboard !== 'object' || keyboard === null) return null;
    const candidate = keyboard as Partial<VirtualKeyboardLike>;
    if (typeof candidate.addEventListener !== 'function') return null;
    if (typeof candidate.removeEventListener !== 'function') return null;
    if (!('overlaysContent' in candidate)) return null;
    return candidate as VirtualKeyboardLike;
  } catch {
    return null;
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Turn bottom-anchored keyboard geometry into a conservative layout inset.
 * Floating/non-bottom rectangles do not move the whole shell, and hostile or
 * stale values can never consume more than 75% of the viewport or 640px.
 */
export function boundedVirtualKeyboardInset(
  rect: KeyboardRect,
  viewportHeight: number,
): number {
  const height = finite(rect.height);
  if (height === null || height <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;

  const top = finite(rect.top) ?? viewportHeight - height;
  const bottom = finite(rect.bottom) ?? top + height;
  if (top >= viewportHeight || bottom < viewportHeight - 2) return 0;

  const overlap = Math.min(height, viewportHeight - Math.max(0, top));
  const cap = Math.min(MAX_VIRTUAL_KEYBOARD_INSET_PX, viewportHeight * 0.75);
  return Math.round(Math.max(0, Math.min(overlap, cap)));
}

function currentViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  return Number.isFinite(window.innerHeight) && window.innerHeight > 0
    ? window.innerHeight
    : 0;
}

function restoreInlineProperty(
  root: HTMLElement,
  property: string,
  previous: { value: string; priority: string } | null,
): void {
  if (!previous) return;
  if (previous.value) {
    root.style.setProperty(property, previous.value, previous.priority);
  } else {
    root.style.removeProperty(property);
  }
}

export function createVirtualKeyboardOverlayController(
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): VirtualKeyboardOverlayController | null {
  const keyboard = virtualKeyboardApi();
  if (!keyboard || !root) return null;

  let enabled = false;
  let disposed = false;
  let generation = 0;
  let geometryListener: EventListener | null = null;
  let previousOverlay: boolean | null = null;
  let previousInset: { value: string; priority: string } | null = null;

  const restore = (): void => {
    generation += 1;
    if (geometryListener) {
      try {
        keyboard.removeEventListener('geometrychange', geometryListener);
      } catch {
        // State restoration below remains useful even if listener removal fails.
      }
      geometryListener = null;
    }
    enabled = false;
    restoreInlineProperty(root, VIRTUAL_KEYBOARD_INSET_PROPERTY, previousInset);
    previousInset = null;
    if (previousOverlay !== null) {
      try {
        keyboard.overlaysContent = previousOverlay;
      } catch {
        // The API can disappear during navigation; cleanup stays best-effort.
      }
      previousOverlay = null;
    }
  };

  const enable = (): void => {
    if (disposed || enabled) return;
    const cycle = ++generation;
    let priorOverlay: boolean;
    try {
      priorOverlay = keyboard.overlaysContent;
    } catch {
      return;
    }
    try {
      keyboard.overlaysContent = true;
    } catch {
      try {
        keyboard.overlaysContent = priorOverlay;
      } catch {
        // A failing optional API must not block the existing viewport behavior.
      }
      return;
    }
    try {
      if (keyboard.overlaysContent !== true) {
        keyboard.overlaysContent = priorOverlay;
        return;
      }
    } catch {
      try {
        keyboard.overlaysContent = priorOverlay;
      } catch {
        // Best-effort rollback after a getter/setter race.
      }
      return;
    }

    previousOverlay = priorOverlay;
    previousInset = {
      value: root.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY),
      priority: root.style.getPropertyPriority(VIRTUAL_KEYBOARD_INSET_PROPERTY),
    };

    const applyGeometry = (): void => {
      if (!enabled || disposed || cycle !== generation) return;
      let inset = 0;
      try {
        inset = boundedVirtualKeyboardInset(keyboard.boundingRect, currentViewportHeight());
      } catch {
        // A transient geometry getter failure is treated as a closed keyboard.
      }
      root.style.setProperty(VIRTUAL_KEYBOARD_INSET_PROPERTY, `${inset}px`);
    };
    geometryListener = applyGeometry;

    try {
      keyboard.addEventListener('geometrychange', geometryListener);
    } catch {
      geometryListener = null;
      restore();
      return;
    }
    enabled = true;
    applyGeometry();
  };

  return {
    setMobile(mobile: boolean): void {
      if (disposed) return;
      if (mobile) enable();
      else if (enabled || previousOverlay !== null || previousInset !== null) restore();
    },
    dispose(): void {
      if (disposed) return;
      restore();
      disposed = true;
    },
  };
}
