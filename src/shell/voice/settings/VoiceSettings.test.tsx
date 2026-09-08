// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { VoiceSettings } from './VoiceSettings';

const initialState = store.getInitialState();

function mediaDevice(deviceId: string, kind: MediaDeviceKind, label: string): MediaDeviceInfo {
  return {
    deviceId,
    kind,
    label,
    groupId: `${deviceId}-group`,
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

describe('VoiceSettings', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          mediaDevice('mic-1', 'audioinput', 'Studio Mic'),
          mediaDevice('speaker-1', 'audiooutput', 'Headset Out'),
          mediaDevice('camera-1', 'videoinput', 'Desk Camera'),
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.setState(initialState, true);
    window.localStorage.clear();
  });

  it('lists media devices and writes setting changes to the voice store', async () => {
    render(() => <VoiceSettings />);

    // Prefer testids / labels over many role-tree walks — a11y queries on this
    // surface are expensive under jsdom and the suite is already long.
    expect(screen.getByTestId('voice-settings')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Devices', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Processing', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Push to talk', level: 3 })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Studio Mic' }, { timeout: 8_000 })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Headset Out' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Desk Camera' })).toBeTruthy();

    expect(screen.getByLabelText('Microphone')).toBeInTheDocument();
    expect(screen.getByLabelText('Speakers')).toBeInTheDocument();
    expect(screen.getByLabelText('Camera')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Microphone'), { target: { value: 'mic-1' } });

    expect(store.getState().voice.inputDeviceId).toBe('mic-1');

    const noiseToggle = screen.getByRole('checkbox', { name: /noise suppression/i });
    expect((noiseToggle as HTMLInputElement).checked).toBe(true);

    fireEvent.click(noiseToggle);

    expect(store.getState().voice.noiseSuppression).toBe(false);
    expect(screen.getByRole('button', { name: 'Capture push-to-talk key' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear push-to-talk key' })).toBeTruthy();
  }, 15_000);

  it('persists the Join muted preference through the voice store', () => {
    render(() => <VoiceSettings />);

    const joinMuted = screen.getByRole('checkbox', { name: /join muted/i });
    expect((joinMuted as HTMLInputElement).checked).toBe(false);

    fireEvent.click(joinMuted);

    expect(store.getState().voice.muteOnJoin).toBe(true);
    expect((screen.getByRole('checkbox', { name: /join muted/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('requests a non-default speaker only from the explicit action and applies the granted device', async () => {
    const selected = mediaDevice('speaker-granted', 'audiooutput', 'USB DAC');
    const selectAudioOutput = vi.fn().mockResolvedValue(selected);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          mediaDevice('speaker-default', 'audiooutput', 'System output'),
        ]),
        selectAudioOutput,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    expect(selectAudioOutput).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose speaker…' }));

    await waitFor(() => expect(store.getState().voice.outputDeviceId).toBe('speaker-granted'));
    expect(selectAudioOutput).toHaveBeenCalledOnce();
    expect(selectAudioOutput).toHaveBeenCalledWith();
    expect(screen.getByRole('option', { name: 'USB DAC' })).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent('Speaker access updated');
  });

  it('treats speaker chooser cancellation neutrally', async () => {
    const selectAudioOutput = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        selectAudioOutput,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose speaker…' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose speaker…' })).not.toBeDisabled();
    });
    expect(store.getState().voice.outputDeviceId).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports speaker permission denial without changing the current output', async () => {
    store.getState().setVoiceCallState({ outputDeviceId: 'speaker-current' });
    const selectAudioOutput = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          mediaDevice('speaker-current', 'audiooutput', 'Current speaker'),
        ]),
        selectAudioOutput,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose speaker…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Speaker selection was not allowed');
    expect(selectAudioOutput).toHaveBeenCalledWith({ deviceId: 'speaker-current' });
    expect(store.getState().voice.outputDeviceId).toBe('speaker-current');
  });

  it('keeps enumerateDevices output selection when selectAudioOutput is unsupported', async () => {
    render(() => <VoiceSettings />);

    expect(await screen.findByRole('option', { name: 'Headset Out' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose speaker…' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Speakers'), { target: { value: 'speaker-1' } });
    expect(store.getState().voice.outputDeviceId).toBe('speaker-1');
  });

  it('rejects an invalid device returned by the speaker chooser', async () => {
    const selectAudioOutput = vi.fn().mockResolvedValue(
      mediaDevice('camera-not-speaker', 'videoinput', 'Wrong device'),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        selectAudioOutput,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose speaker…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('browser returned an invalid speaker');
    expect(store.getState().voice.outputDeviceId).toBeNull();
    expect(screen.queryByRole('option', { name: 'Wrong device' })).toBeNull();
  });

  it('ignores speaker selection completion after settings unmount', async () => {
    let resolveSelection: (device: MediaDeviceInfo) => void = () => {};
    const pendingSelection = new Promise<MediaDeviceInfo>((resolve) => {
      resolveSelection = resolve;
    });
    const selectAudioOutput = vi.fn(() => pendingSelection);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        selectAudioOutput,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const view = render(() => <VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose speaker…' }));
    view.unmount();
    resolveSelection(mediaDevice('speaker-late', 'audiooutput', 'Late speaker'));
    await pendingSelection;
    await Promise.resolve();

    expect(store.getState().voice.outputDeviceId).toBeNull();
    expect(screen.queryByRole('option', { name: 'Late speaker' })).toBeNull();
  });

  it('allows only one rapid speaker prompt while selection is pending', async () => {
    let resolveSelection: (device: MediaDeviceInfo) => void = () => {};
    const pendingSelection = new Promise<MediaDeviceInfo>((resolve) => {
      resolveSelection = resolve;
    });
    const selectAudioOutput = vi.fn(() => pendingSelection);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        selectAudioOutput,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    const choose = screen.getByRole('button', { name: 'Choose speaker…' });
    fireEvent.click(choose);
    fireEvent.click(choose);

    expect(selectAudioOutput).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Choosing speaker…' })).toBeDisabled();
    resolveSelection(mediaDevice('speaker-once', 'audiooutput', 'Only speaker'));
    await waitFor(() => expect(store.getState().voice.outputDeviceId).toBe('speaker-once'));
  });

  it('ignores an older device enumeration that resolves after a devicechange refresh', async () => {
    let resolveInitial: (devices: MediaDeviceInfo[]) => void = () => {};
    let resolveRefresh: (devices: MediaDeviceInfo[]) => void = () => {};
    const initial = new Promise<MediaDeviceInfo[]>((resolve) => {
      resolveInitial = resolve;
    });
    const refresh = new Promise<MediaDeviceInfo[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const enumerateDevices = vi.fn(async (): Promise<MediaDeviceInfo[]> => []);
    enumerateDevices.mockReturnValueOnce(initial).mockReturnValueOnce(refresh);
    let deviceChangeListener: EventListener | undefined;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices,
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          if (type === 'devicechange') deviceChangeListener = listener;
        }),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    expect(enumerateDevices).toHaveBeenCalledOnce();

    deviceChangeListener?.(new Event('devicechange'));
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    resolveRefresh([mediaDevice('mic-new', 'audioinput', 'New microphone')]);
    expect(await screen.findByRole('option', { name: 'New microphone' })).toBeTruthy();

    resolveInitial([mediaDevice('mic-old', 'audioinput', 'Stale microphone')]);
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Stale microphone' })).toBeNull();
      expect(screen.getByRole('option', { name: 'New microphone' })).toBeTruthy();
    });
  });

  it('removes the devicechange listener and ignores enumeration completion after unmount', async () => {
    let resolveDevices: (devices: MediaDeviceInfo[]) => void = () => {};
    const pendingDevices = new Promise<MediaDeviceInfo[]>((resolve) => {
      resolveDevices = resolve;
    });
    let deviceChangeListener: EventListener | undefined;
    const removeEventListener = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices: vi.fn(() => pendingDevices),
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          if (type === 'devicechange') deviceChangeListener = listener;
        }),
        removeEventListener,
      },
    });

    const view = render(() => <VoiceSettings />);
    view.unmount();

    expect(removeEventListener).toHaveBeenCalledWith('devicechange', deviceChangeListener);
    resolveDevices([mediaDevice('late-mic', 'audioinput', 'Late microphone')]);
    await pendingDevices;
    await Promise.resolve();
    expect(screen.queryByRole('option', { name: 'Late microphone' })).toBeNull();
  });

  it('reports refresh progress and clears only selections for devices that disconnected', async () => {
    store.getState().setVoiceCallState({
      inputDeviceId: 'mic-old',
      outputDeviceId: 'speaker-stays',
      cameraDeviceId: 'camera-old',
    });
    let resolveRefresh: (devices: MediaDeviceInfo[]) => void = () => {};
    const refresh = new Promise<MediaDeviceInfo[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const enumerateDevices = vi.fn()
      .mockResolvedValueOnce([
        mediaDevice('mic-old', 'audioinput', 'Old microphone'),
        mediaDevice('speaker-stays', 'audiooutput', 'Stable speaker'),
        mediaDevice('camera-old', 'videoinput', 'Old camera'),
      ])
      .mockReturnValueOnce(refresh);
    let deviceChangeListener: EventListener | undefined;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices,
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          if (type === 'devicechange') deviceChangeListener = listener;
        }),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    expect(await screen.findByRole('option', { name: 'Old microphone' })).toBeTruthy();

    deviceChangeListener?.(new Event('devicechange'));
    expect(screen.getByRole('status').textContent).toContain('Checking media devices');
    resolveRefresh([
      mediaDevice('mic-new', 'audioinput', 'New microphone'),
      mediaDevice('speaker-stays', 'audiooutput', 'Stable speaker'),
    ]);

    expect(await screen.findByRole('option', { name: 'New microphone' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(store.getState().voice.inputDeviceId).toBeNull();
    expect(store.getState().voice.cameraDeviceId).toBeNull();
    expect(store.getState().voice.outputDeviceId).toBe('speaker-stays');
  });

  it('replaces a stale device error with retry progress without clearing selections on rejection', async () => {
    store.getState().setVoiceCallState({ inputDeviceId: 'mic-1' });
    let resolveRetry: (devices: MediaDeviceInfo[]) => void = () => {};
    const retry = new Promise<MediaDeviceInfo[]>((resolve) => {
      resolveRetry = resolve;
    });
    const enumerateDevices = vi.fn()
      .mockRejectedValueOnce(new Error('permission race'))
      .mockReturnValueOnce(retry);
    let deviceChangeListener: EventListener | undefined;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        enumerateDevices,
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          if (type === 'devicechange') deviceChangeListener = listener;
        }),
        removeEventListener: vi.fn(),
      },
    });

    render(() => <VoiceSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Device enumeration failed');
    expect(store.getState().voice.inputDeviceId).toBe('mic-1');

    deviceChangeListener?.(new Event('devicechange'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Checking media devices');
    resolveRetry([mediaDevice('mic-1', 'audioinput', 'Recovered microphone')]);

    expect(await screen.findByRole('option', { name: 'Recovered microphone' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(store.getState().voice.inputDeviceId).toBe('mic-1');
  });

  it('owns a captured key before application shortcuts can handle it', async () => {
    const applicationShortcut = vi.fn();
    document.addEventListener('keydown', applicationShortcut);

    render(() => <VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Capture push-to-talk key' }));

    expect(screen.getByRole('button', { name: 'Cancel push-to-talk key capture' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(document.body, { key: 'v' });

    expect(applicationShortcut).not.toHaveBeenCalled();
    expect(store.getState().voice.pushToTalkKey).toBe('v');
    expect(store.getState().voice.pushToTalk).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Capture push-to-talk key' })).toBe(document.activeElement);
    });

    document.removeEventListener('keydown', applicationShortcut);
  });

  it('keeps key capture armed while an input method owns the keyboard', async () => {
    render(() => <VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Capture push-to-talk key' }));

    fireEvent.keyDown(document.body, { key: 'Process', keyCode: 229, isComposing: true });

    expect(screen.getByRole('button', { name: 'Cancel push-to-talk key capture' })).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().voice.pushToTalkKey).toBeNull();

    fireEvent.keyDown(document.body, { key: 'v' });

    expect(store.getState().voice.pushToTalkKey).toBe('v');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Capture push-to-talk key' })).toBe(document.activeElement);
    });
  });

  it('cancels capture on Escape without closing the sheet or changing the configured key', async () => {
    store.getState().setVoiceCallState({ pushToTalk: false, pushToTalkKey: 'V' });

    function Harness() {
      const [open, setOpen] = createSignal(true);
      return <VoiceSettings open={open()} onOpenChange={setOpen} />;
    }

    render(() => <Harness />);
    const capture = await screen.findByRole('button', { name: 'Capture push-to-talk key' });
    fireEvent.click(capture);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(store.getState().voice.pushToTalkKey).toBe('V');
    expect(store.getState().voice.pushToTalk).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Voice settings' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Capture push-to-talk key' })).toBe(document.activeElement);
    });
  });

  it('releases the capture listener when capture is cancelled or the settings unmount', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const view = render(() => <VoiceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Capture push-to-talk key' }));
    const captureRegistration = addEventListener.mock.calls.find(
      ([type, , options]) => String(type) === 'keydown' && typeof options === 'object' && options.capture === true,
    );
    expect(captureRegistration).toBeTruthy();
    const captureListener = captureRegistration?.[1];

    fireEvent.click(screen.getByRole('button', { name: 'Cancel push-to-talk key capture' }));
    expect(removeEventListener).toHaveBeenCalledWith('keydown', captureListener, true);

    fireEvent.click(screen.getByRole('button', { name: 'Capture push-to-talk key' }));
    const restartedRegistration = addEventListener.mock.calls.filter(
      ([type, , options]) => String(type) === 'keydown' && typeof options === 'object' && options.capture === true,
    ).at(-1);
    expect(restartedRegistration).toBeTruthy();
    const restartedListener = restartedRegistration?.[1];

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('keydown', restartedListener, true);
  });
});
