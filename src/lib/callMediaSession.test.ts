// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCallMediaSessionController,
  type CallMediaSession,
  type CallMediaSessionAction,
} from './callMediaSession';

function fakeSession(options: { unsupported?: CallMediaSessionAction } = {}) {
  const handlers = new Map<CallMediaSessionAction, (() => void) | null>();
  const setActionHandler = vi.fn((action: CallMediaSessionAction, handler: (() => void) | null) => {
    if (action === options.unsupported) throw new DOMException('Unsupported', 'NotSupportedError');
    handlers.set(action, handler);
  });
  const setMicrophoneActive = vi.fn(async () => {});
  const setCameraActive = vi.fn(async () => {});
  const originalMetadata = { title: 'Original media' } as MediaMetadata;
  const session: CallMediaSession = {
    metadata: originalMetadata,
    setActionHandler,
    setMicrophoneActive,
    setCameraActive,
  };
  return {
    handlers,
    originalMetadata,
    session,
    setActionHandler,
    setMicrophoneActive,
    setCameraActive,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCallMediaSessionController', () => {
  it('does nothing until an accepted call becomes active', () => {
    const browser = fakeSession();
    const controller = createCallMediaSessionController({
      session: browser.session,
      onToggleMicrophone: vi.fn(),
      onToggleCamera: vi.fn(),
      onHangup: vi.fn(),
    });

    controller.update({ active: false, muted: false, cameraOn: false });

    expect(browser.setActionHandler).not.toHaveBeenCalled();
    expect(browser.setMicrophoneActive).not.toHaveBeenCalled();
    expect(browser.session.metadata).toBe(browser.originalMetadata);
  });

  it('publishes generic metadata, call actions, and current capture state', async () => {
    class FakeMetadata {
      constructor(readonly init: MediaMetadataInit) {}
    }
    vi.stubGlobal('MediaMetadata', FakeMetadata);
    const browser = fakeSession();
    const toggleMicrophone = vi.fn();
    const toggleCamera = vi.fn();
    const hangup = vi.fn();
    const controller = createCallMediaSessionController({
      session: browser.session,
      onToggleMicrophone: toggleMicrophone,
      onToggleCamera: toggleCamera,
      onHangup: hangup,
    });

    controller.update({ active: true, muted: false, cameraOn: true });
    browser.handlers.get('togglemicrophone')?.();
    browser.handlers.get('togglecamera')?.();
    browser.handlers.get('hangup')?.();
    await Promise.resolve();

    expect(browser.setActionHandler).toHaveBeenCalledTimes(3);
    expect(toggleMicrophone).toHaveBeenCalledOnce();
    expect(toggleCamera).toHaveBeenCalledOnce();
    expect(hangup).toHaveBeenCalledOnce();
    expect(browser.setMicrophoneActive).toHaveBeenCalledWith(true);
    expect(browser.setCameraActive).toHaveBeenCalledWith(true);
    expect(browser.session.metadata).toMatchObject({
      init: { title: 'Onyx voice call', artist: 'Onyx' },
    });
  });

  it('updates capture hints without reinstalling handlers', () => {
    const browser = fakeSession();
    const controller = createCallMediaSessionController({
      session: browser.session,
      onToggleMicrophone: vi.fn(),
      onToggleCamera: vi.fn(),
      onHangup: vi.fn(),
    });

    controller.update({ active: true, muted: false, cameraOn: false });
    controller.update({ active: true, muted: true, cameraOn: true });
    controller.update({ active: true, muted: true, cameraOn: true });

    expect(browser.setActionHandler).toHaveBeenCalledTimes(3);
    expect(browser.setMicrophoneActive).toHaveBeenCalledTimes(2);
    expect(browser.setMicrophoneActive).toHaveBeenLastCalledWith(false);
    expect(browser.setCameraActive).toHaveBeenCalledTimes(2);
    expect(browser.setCameraActive).toHaveBeenLastCalledWith(true);
  });

  it('skips unsupported actions independently and tears down installed actions', () => {
    const browser = fakeSession({ unsupported: 'togglecamera' });
    const controller = createCallMediaSessionController({
      session: browser.session,
      onToggleMicrophone: vi.fn(),
      onToggleCamera: vi.fn(),
      onHangup: vi.fn(),
    });

    controller.update({ active: true, muted: false, cameraOn: false });
    controller.update({ active: false, muted: false, cameraOn: false });

    expect(browser.handlers.has('togglemicrophone')).toBe(true);
    expect(browser.handlers.get('togglemicrophone')).toBeNull();
    expect(browser.handlers.has('togglecamera')).toBe(false);
    expect(browser.handlers.get('hangup')).toBeNull();
    expect(browser.session.metadata).toBe(browser.originalMetadata);
    expect(browser.setMicrophoneActive).toHaveBeenLastCalledWith(false);
  });

  it('clears actions once on disposal and tolerates rejected state hints', async () => {
    const browser = fakeSession();
    browser.setMicrophoneActive.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const controller = createCallMediaSessionController({
      session: browser.session,
      onToggleMicrophone: vi.fn(),
      onToggleCamera: vi.fn(),
      onHangup: vi.fn(),
    });

    controller.update({ active: true, muted: false, cameraOn: false });
    controller.dispose();
    controller.dispose();
    await Promise.resolve();

    expect(browser.setActionHandler).toHaveBeenCalledTimes(6);
    expect(browser.session.metadata).toBe(browser.originalMetadata);
  });

  it('is a no-op when Media Session is unavailable', () => {
    const controller = createCallMediaSessionController({
      onToggleMicrophone: vi.fn(),
      onToggleCamera: vi.fn(),
      onHangup: vi.fn(),
    });

    expect(() => {
      controller.update({ active: true, muted: false, cameraOn: false });
      controller.dispose();
    }).not.toThrow();
  });
});
