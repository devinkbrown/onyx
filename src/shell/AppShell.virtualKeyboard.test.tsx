// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, render } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VIRTUAL_KEYBOARD_INSET_PROPERTY } from '@/lib/mobile/virtualKeyboardOverlay';
import { store } from '@/lib/store/store';
import { AppShell } from './AppShell';

class VirtualKeyboardMock {
  overlaysContent = false;
  boundingRect = { top: 520, bottom: 800, height: 280 };
  readonly listeners = new Set<EventListener>();

  addEventListener(type: 'geometrychange', listener: EventListener): void {
    if (type === 'geometrychange') this.listeners.add(listener);
  }

  removeEventListener(type: 'geometrychange', listener: EventListener): void {
    if (type === 'geometrychange') this.listeners.delete(listener);
  }
}

const initialState = store.getInitialState();

function stubNavigatorKeyboard(keyboard: VirtualKeyboardMock): void {
  const nextNavigator = Object.create(navigator) as Navigator & { virtualKeyboard: VirtualKeyboardMock };
  nextNavigator.virtualKeyboard = keyboard;
  vi.stubGlobal('navigator', nextNavigator);
}

function stubShellViewport(initialMobile: boolean): {
  changeMobile: (matches: boolean) => void;
} {
  let mobileListener: ((event: MediaQueryListEvent) => void) | null = null;
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(max-width: 900px)' ? initialMobile : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (query === '(max-width: 900px)' && type === 'change') mobileListener = listener;
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (query === '(max-width: 900px)' && type === 'change' && mobileListener === listener) {
        mobileListener = null;
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as MediaQueryList));
  return {
    changeMobile(matches: boolean): void {
      mobileListener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe('AppShell VirtualKeyboard lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.indexedDB = new IDBFactory();
    document.documentElement.style.removeProperty(VIRTUAL_KEYBOARD_INSET_PROPERTY);
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
    }, true);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty(VIRTUAL_KEYBOARD_INSET_PROPERTY);
    store.setState(initialState, true);
    localStorage.clear();
  });

  it('enables overlay geometry only while the connected shell uses mobile layout', () => {
    const keyboard = new VirtualKeyboardMock();
    stubNavigatorKeyboard(keyboard);
    const viewport = stubShellViewport(true);
    const view = render(() => <AppShell />);

    expect(keyboard.overlaysContent).toBe(true);
    expect(keyboard.listeners.size).toBe(1);
    expect(document.documentElement.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('280px');

    viewport.changeMobile(false);
    expect(keyboard.overlaysContent).toBe(false);
    expect(keyboard.listeners.size).toBe(0);
    expect(document.documentElement.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('');

    viewport.changeMobile(true);
    expect(keyboard.overlaysContent).toBe(true);
    view.unmount();
    expect(keyboard.overlaysContent).toBe(false);
    expect(keyboard.listeners.size).toBe(0);
    expect(document.documentElement.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('');
  });

  it('does not opt desktop AppShell into overlay mode', () => {
    const keyboard = new VirtualKeyboardMock();
    stubNavigatorKeyboard(keyboard);
    stubShellViewport(false);
    render(() => <AppShell />);

    expect(keyboard.overlaysContent).toBe(false);
    expect(keyboard.listeners.size).toBe(0);
    expect(document.documentElement.style.getPropertyValue(VIRTUAL_KEYBOARD_INSET_PROPERTY)).toBe('');
  });
});
