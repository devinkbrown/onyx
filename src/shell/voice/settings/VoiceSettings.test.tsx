import { fireEvent, render, screen } from '@solidjs/testing-library';
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

    expect(await screen.findByRole('option', { name: 'Studio Mic' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Headset Out' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Desk Camera' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Input'), { target: { value: 'mic-1' } });

    expect(store.getState().voice.inputDeviceId).toBe('mic-1');

    const noiseToggle = screen.getByRole('checkbox', { name: /noise suppression/i });
    expect((noiseToggle as HTMLInputElement).checked).toBe(true);

    fireEvent.click(noiseToggle);

    expect(store.getState().voice.noiseSuppression).toBe(false);
  });
});
