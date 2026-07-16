// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadBackgroundVariant = vi.hoisted(() => vi.fn());
const hasFocusDescriptor = Object.getOwnPropertyDescriptor(document, 'hasFocus');

vi.mock('./loader', () => ({ loadBackgroundVariant }));

import { Background } from './Background';
import { SceneShell } from './scenes/SceneShell';
import type { SceneProps } from './engine';
import { resetPreferences } from '@/lib/prefs/preferences';
import { resetSceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';

function TestScene(props: SceneProps) {
  return (
    <SceneShell reducedMotion={props.reducedMotion} base="#05070b">
      <div data-test-scene-layer="true" style={{ animation: 'test-drift 10s linear infinite' }} />
    </SceneShell>
  );
}

beforeEach(() => {
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
  loadBackgroundVariant.mockReset();
  loadBackgroundVariant.mockImplementation(async (id: string) => ({
    id,
    label: 'Test Scene',
    kind: 'scene',
    component: TestScene,
  }));
  resetPreferences();
  resetSceneMotion();
});

afterEach(() => {
  window.dispatchEvent(new Event('focus'));
  cleanup();
  resetPreferences();
  resetSceneMotion();
  if (hasFocusDescriptor) Object.defineProperty(document, 'hasFocus', hasFocusDescriptor);
  else Reflect.deleteProperty(document, 'hasFocus');
  Reflect.deleteProperty(navigator, 'connection');
});

describe('Background lazy resource gating', () => {
  it('does not request the selected render chunk when motion starts Off', async () => {
    setSceneMotion('off');

    const { container } = render(() => <Background id="starfield" />);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadBackgroundVariant).not.toHaveBeenCalled();
    expect(container.querySelector('[data-background-canvas]')).toBeNull();
  });

  it('loads and mounts normally when switching from Off to Animated', async () => {
    setSceneMotion('off');
    const { container } = render(() => <Background id="starfield" />);
    expect(loadBackgroundVariant).not.toHaveBeenCalled();

    setSceneMotion('animated');

    await waitFor(() => expect(loadBackgroundVariant).toHaveBeenCalledTimes(1));
    expect(loadBackgroundVariant).toHaveBeenCalledWith('starfield', expect.any(Object));
    const host = await waitFor(() => {
      const element = container.querySelector('[data-background-id="starfield"]');
      expect(element).not.toBeNull();
      return element;
    });
    const scene = host?.querySelector('.onyx-scene');
    expect(host?.getAttribute('data-background-kind')).toBe('scene');

    window.dispatchEvent(new Event('blur'));
    expect(scene?.getAttribute('data-scene-runtime-paused')).toBe('true');
    // Runtime lifecycle pausing is not a user-selected static mode.
    expect(host?.getAttribute('data-background-kind')).toBe('scene');

    window.dispatchEvent(new Event('focus'));
    expect(scene?.hasAttribute('data-scene-runtime-paused')).toBe(false);
  });

  it('keeps a static branded frame and skips the render chunk under Data Saver', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });

    const { container } = render(() => <Background id="starfield" />);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadBackgroundVariant).not.toHaveBeenCalled();
    const placeholder = container.querySelector('[data-background-placeholder="true"]');
    expect(placeholder).toHaveAttribute('data-background-kind', 'solid');
    expect(placeholder).toHaveAttribute('data-background-reduced-data', 'true');
  });

  it('replaces a loaded scene when Data Saver turns on', async () => {
    let onConnectionChange: (() => void) | undefined;
    const connection = {
      saveData: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        onConnectionChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
    const { container } = render(() => <Background id="starfield" />);
    await waitFor(() => expect(container.querySelector('[data-background-id="starfield"]')).not.toBeNull());

    connection.saveData = true;
    onConnectionChange?.();

    await waitFor(() => {
      expect(container.querySelector('[data-background-id="starfield"]')).toBeNull();
      expect(container.querySelector('[data-background-reduced-data="true"]')).not.toBeNull();
    });
  });
});
