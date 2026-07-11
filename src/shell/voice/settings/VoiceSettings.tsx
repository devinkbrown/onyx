// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, For, mergeProps, onCleanup, Show, splitProps } from 'solid-js';

import { Button, FormField, Sheet } from '@/primitives';
import { getState, useStore, type VoiceState } from '@/lib/store';

import './voice-settings.css';

type DeviceChoice = {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
};

type VoiceSettingsProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type DeviceSelectProps = {
  id: string;
  label: string;
  description: string;
  value: string | null;
  devices: DeviceChoice[];
  emptyLabel: string;
  onValue: (value: string | null) => void;
};

type ToggleRowProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChecked: (checked: boolean) => void;
};

function updateVoice(patch: Partial<VoiceState>) {
  getState().setVoiceCallState(patch);
}

function labelFor(device: MediaDeviceInfo, index: number) {
  if (device.label.trim()) return device.label;
  if (device.kind === 'audioinput') return `Microphone ${index + 1}`;
  if (device.kind === 'audiooutput') return `Speaker ${index + 1}`;
  return `Camera ${index + 1}`;
}

function normalizeDevices(devices: MediaDeviceInfo[]) {
  const counts: Record<MediaDeviceKind, number> = {
    audioinput: 0,
    audiooutput: 0,
    videoinput: 0,
  };

  return devices
    .filter((device) => device.kind === 'audioinput' || device.kind === 'audiooutput' || device.kind === 'videoinput')
    .map((device) => {
      const index = counts[device.kind];
      counts[device.kind] += 1;
      return {
        deviceId: device.deviceId,
        kind: device.kind,
        label: labelFor(device, index),
      };
    });
}

function DeviceSelect(props: DeviceSelectProps) {
  const [local] = splitProps(props, ['id', 'label', 'description', 'value', 'devices', 'emptyLabel', 'onValue']);
  const descriptionId = () => `${local.id}-description`;

  return (
    <div class="onyx-field">
      <label class="onyx-field__label" for={local.id}>{local.label}</label>
      <p class="onyx-field__description" id={descriptionId()}>{local.description}</p>
      <select
        id={local.id}
        class="voice-settings__select"
        value={local.value ?? ''}
        aria-describedby={descriptionId()}
        onChange={(event) => local.onValue(event.currentTarget.value || null)}
      >
        <option value="">{local.emptyLabel}</option>
        <For each={local.devices}>
          {(device) => <option value={device.deviceId}>{device.label}</option>}
        </For>
      </select>
    </div>
  );
}

function ToggleRow(props: ToggleRowProps) {
  const [local] = splitProps(props, ['id', 'label', 'description', 'checked', 'onChecked']);
  const descriptionId = () => `${local.id}-description`;

  return (
    <label class="voice-settings__toggle" for={local.id}>
      <input
        id={local.id}
        type="checkbox"
        checked={local.checked}
        aria-describedby={descriptionId()}
        onChange={(event) => local.onChecked(event.currentTarget.checked)}
      />
      <span class="voice-settings__toggle-text">
        <span class="voice-settings__toggle-label">{local.label}</span>
        <span class="voice-settings__toggle-description" id={descriptionId()}>{local.description}</span>
      </span>
    </label>
  );
}

function VoiceSettingsContent() {
  const voice = useStore((state) => state.voice);
  const [devices, setDevices] = createSignal<DeviceChoice[]>([]);
  const [deviceError, setDeviceError] = createSignal<string | null>(null);
  const [capturingKey, setCapturingKey] = createSignal(false);

  const inputs = createMemo(() => devices().filter((device) => device.kind === 'audioinput'));
  const outputs = createMemo(() => devices().filter((device) => device.kind === 'audiooutput'));
  const cameras = createMemo(() => devices().filter((device) => device.kind === 'videoinput'));

  const loadDevices = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setDeviceError('Device enumeration is unavailable in this browser.');
      return;
    }

    try {
      const nextDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(normalizeDevices(nextDevices));
      setDeviceError(null);
    } catch {
      setDeviceError('Device enumeration failed. Check media permissions.');
    }
  };

  createEffect(() => {
    void loadDevices();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    onCleanup(() => navigator.mediaDevices.removeEventListener('devicechange', loadDevices));
  });

  createEffect(() => {
    if (!capturingKey()) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      const key = event.key === ' ' ? 'Space' : event.key;
      updateVoice({ pushToTalkKey: key, pushToTalk: true });
      setCapturingKey(false);
    };

    window.addEventListener('keydown', onKeyDown, { once: true });
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <div class="voice-settings" data-testid="voice-settings">
      <section class="voice-settings__section" aria-labelledby="voice-devices-title">
        <h3 class="voice-settings__section-title" id="voice-devices-title">Devices</h3>
        <p class="voice-settings__section-copy">Choose the capture, playback, and camera paths for this voice session.</p>
        <Show when={deviceError()}>
          {(error) => <p class="onyx-field__error" role="alert">{error()}</p>}
        </Show>
        <div class="voice-settings__grid">
          <DeviceSelect
            id="voice-input-device"
            label="Input"
            description="Microphone used for calls and rooms."
            value={voice().inputDeviceId}
            devices={inputs()}
            emptyLabel="System microphone"
            onValue={(value) => updateVoice({ inputDeviceId: value })}
          />
          <DeviceSelect
            id="voice-output-device"
            label="Output"
            description="Speaker or headset for remote audio."
            value={voice().outputDeviceId}
            devices={outputs()}
            emptyLabel="System speaker"
            onValue={(value) => updateVoice({ outputDeviceId: value })}
          />
          <DeviceSelect
            id="voice-camera-device"
            label="Camera"
            description="Camera used when video is enabled."
            value={voice().cameraDeviceId}
            devices={cameras()}
            emptyLabel="System camera"
            onValue={(value) => updateVoice({ cameraDeviceId: value })}
          />
          <FormField
            id="voice-output-volume"
            label="Output volume"
            description={`${voice().outputVolume}%`}
            type="range"
            min="0"
            max="100"
            step="1"
            value={String(voice().outputVolume)}
            onInput={(event) => updateVoice({ outputVolume: Number(event.currentTarget.value) })}
          />
        </div>
      </section>

      <section class="voice-settings__section" aria-labelledby="voice-processing-title">
        <h3 class="voice-settings__section-title" id="voice-processing-title">Processing</h3>
        <p class="voice-settings__section-copy">Keep the signal readable without hiding the controls from power users.</p>
        <div class="voice-settings__grid">
          <ToggleRow
            id="voice-vad-enabled"
            label="Voice activity"
            description="Transmit when speech is detected."
            checked={voice().vadEnabled}
            onChecked={(checked) => updateVoice({ vadEnabled: checked })}
          />
          <div class="onyx-field">
            <label class="onyx-field__label" for="voice-vad-sensitivity">Sensitivity</label>
            <p class="onyx-field__description" id="voice-vad-sensitivity-description">Threshold for opening the voice gate.</p>
            <select
              id="voice-vad-sensitivity"
              class="voice-settings__select"
              value={voice().vadSensitivity}
              aria-describedby="voice-vad-sensitivity-description"
              disabled={!voice().vadEnabled}
              onChange={(event) => {
                const value = event.currentTarget.value as VoiceState['vadSensitivity'];
                updateVoice({ vadSensitivity: value });
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <ToggleRow
            id="voice-noise-suppression"
            label="Noise suppression"
            description="Reduce constant background noise before sending."
            checked={voice().noiseSuppression}
            onChecked={(checked) => updateVoice({ noiseSuppression: checked })}
          />
          <ToggleRow
            id="voice-echo-cancellation"
            label="Echo cancellation"
            description="Prevent speaker output from returning into the microphone."
            checked={voice().echoCancellation}
            onChecked={(checked) => updateVoice({ echoCancellation: checked })}
          />
        </div>
      </section>

      <section class="voice-settings__section" aria-labelledby="voice-ptt-title">
        <h3 class="voice-settings__section-title" id="voice-ptt-title">Push to talk</h3>
        <p class="voice-settings__section-copy">Use a held key instead of automatic voice activation.</p>
        <ToggleRow
          id="voice-push-to-talk"
          label="Push to talk"
          description="Require a key press before transmitting."
          checked={voice().pushToTalk}
          onChecked={(checked) => updateVoice({ pushToTalk: checked })}
        />
        <div class="voice-settings__key-row">
          <div class="onyx-field voice-settings__key-display">
            <span class="onyx-field__label" id="voice-ptt-key-label">Talk key</span>
            <span
              class="voice-settings__key-value"
              aria-labelledby="voice-ptt-key-label"
              aria-live="polite"
            >
              <Show when={capturingKey()} fallback={voice().pushToTalkKey ?? 'Not set'}>
                <span class="voice-settings__capture">Press a key</span>
              </Show>
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={() => setCapturingKey(true)}
            aria-label="Capture push-to-talk key"
            aria-pressed={capturingKey() ? 'true' : 'false'}
          >
            Capture key
          </Button>
          <Button
            variant="danger"
            onClick={() => updateVoice({ pushToTalkKey: null })}
            disabled={!voice().pushToTalkKey}
            aria-label="Clear push-to-talk key"
          >
            Clear
          </Button>
        </div>
      </section>
    </div>
  );
}

export function VoiceSettings(props: VoiceSettingsProps) {
  const merged = mergeProps({ open: undefined as boolean | undefined, onOpenChange: undefined as ((open: boolean) => void) | undefined }, props);
  const content = () => <VoiceSettingsContent />;

  return (
    <Show
      when={merged.open !== undefined}
      fallback={content()}
    >
      <Sheet
        open={merged.open ?? false}
        title="Voice settings"
        description="Devices, activation, and signal processing."
        onOpenChange={merged.onOpenChange ?? (() => {})}
        closeLabel="Close voice settings"
      >
        {content()}
      </Sheet>
    </Show>
  );
}

export default VoiceSettings;
