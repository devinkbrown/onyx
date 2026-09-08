// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, For, mergeProps, onCleanup, Show, splitProps } from 'solid-js';

import { Button, FormField, Sheet } from '@/primitives';
import { getState, useStore, type VoiceState } from '@/lib/store';
import { keyboardEventIsClaimed } from '@/primitives/focusTrap';

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

type AudioOutputSelector = (
  options?: { deviceId?: string },
) => Promise<MediaDeviceInfo>;

type OutputSelectionState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

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

function browserAudioOutputSelector(): AudioOutputSelector | null {
  if (typeof navigator === 'undefined') return null;
  try {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: AudioOutputSelector;
    };
    if (typeof mediaDevices?.selectAudioOutput !== 'function') return null;
    return mediaDevices.selectAudioOutput.bind(mediaDevices);
  } catch {
    return null;
  }
}

function outputSelectionError(error: unknown): string | null {
  const name = error instanceof DOMException
    ? error.name
    : error instanceof Error
      ? error.name
      : '';
  if (name === 'AbortError') return null;
  if (name === 'NotAllowedError') return 'Speaker selection was not allowed.';
  if (name === 'NotFoundError') return 'No selectable speaker was found.';
  return 'Speaker selection failed. Try again.';
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
  const selectAudioOutput = browserAudioOutputSelector();
  const [devices, setDevices] = createSignal<DeviceChoice[]>([]);
  const [deviceError, setDeviceError] = createSignal<string | null>(null);
  const [devicesLoading, setDevicesLoading] = createSignal(true);
  const [outputSelection, setOutputSelection] = createSignal<OutputSelectionState>({ kind: 'idle' });
  const [capturingKey, setCapturingKey] = createSignal(false);
  let captureButton: HTMLButtonElement | undefined;
  let deviceLoadEpoch = 0;
  let outputSelectionEpoch = 0;
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    deviceLoadEpoch += 1;
    outputSelectionEpoch += 1;
  });

  const inputs = createMemo(() => devices().filter((device) => device.kind === 'audioinput'));
  const outputs = createMemo(() => devices().filter((device) => device.kind === 'audiooutput'));
  const cameras = createMemo(() => devices().filter((device) => device.kind === 'videoinput'));

  const loadDevices = async () => {
    const epoch = ++deviceLoadEpoch;
    setDevicesLoading(true);
    setDeviceError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      if (!disposed && epoch === deviceLoadEpoch) {
        setDeviceError('Device enumeration is unavailable in this browser.');
        setDevicesLoading(false);
      }
      return;
    }

    try {
      const nextDevices = await navigator.mediaDevices.enumerateDevices();
      if (disposed || epoch !== deviceLoadEpoch) return;
      const normalizedDevices = normalizeDevices(nextDevices);
      const availableInputs = new Set(normalizedDevices.filter((device) => device.kind === 'audioinput').map((device) => device.deviceId));
      const availableOutputs = new Set(normalizedDevices.filter((device) => device.kind === 'audiooutput').map((device) => device.deviceId));
      const availableCameras = new Set(normalizedDevices.filter((device) => device.kind === 'videoinput').map((device) => device.deviceId));
      const currentVoice = getState().voice;
      const selectionPatch: Partial<VoiceState> = {};

      if (currentVoice.inputDeviceId && !availableInputs.has(currentVoice.inputDeviceId)) {
        selectionPatch.inputDeviceId = null;
      }
      if (currentVoice.outputDeviceId && !availableOutputs.has(currentVoice.outputDeviceId)) {
        selectionPatch.outputDeviceId = null;
      }
      if (currentVoice.cameraDeviceId && !availableCameras.has(currentVoice.cameraDeviceId)) {
        selectionPatch.cameraDeviceId = null;
      }

      setDevices(normalizedDevices);
      if (Object.keys(selectionPatch).length > 0) updateVoice(selectionPatch);
      setDeviceError(null);
      setDevicesLoading(false);
    } catch {
      if (disposed || epoch !== deviceLoadEpoch) return;
      setDeviceError('Device enumeration failed. Check media permissions.');
      setDevicesLoading(false);
    }
  };

  const chooseAudioOutput = async () => {
    if (!selectAudioOutput || outputSelection().kind === 'pending') return;
    const epoch = ++outputSelectionEpoch;
    setOutputSelection({ kind: 'pending' });

    try {
      const currentDeviceId = getState().voice.outputDeviceId;
      const selected = currentDeviceId
        ? await selectAudioOutput({ deviceId: currentDeviceId })
        : await selectAudioOutput();
      if (disposed || epoch !== outputSelectionEpoch) return;
      if (selected.kind !== 'audiooutput' || !selected.deviceId.trim()) {
        setOutputSelection({ kind: 'error', message: 'The browser returned an invalid speaker.' });
        return;
      }

      // Invalidate enumeration that began before/during the chooser. Its
      // permission snapshot may not include the newly granted output yet.
      deviceLoadEpoch += 1;
      setDevices((current) => {
        const previous = current.find((device) => (
          device.kind === 'audiooutput' && device.deviceId === selected.deviceId
        ));
        const outputCount = current.filter((device) => device.kind === 'audiooutput').length;
        const choice: DeviceChoice = {
          deviceId: selected.deviceId,
          kind: 'audiooutput',
          label: selected.label.trim() || previous?.label || `Speaker ${outputCount + 1}`,
        };
        return [
          ...current.filter((device) => !(
            device.kind === 'audiooutput' && device.deviceId === selected.deviceId
          )),
          choice,
        ];
      });
      updateVoice({ outputDeviceId: selected.deviceId });
      setOutputSelection({ kind: 'success', message: 'Speaker access updated.' });
    } catch (error) {
      if (disposed || epoch !== outputSelectionEpoch) return;
      const message = outputSelectionError(error);
      setOutputSelection(message ? { kind: 'error', message } : { kind: 'idle' });
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
      // Candidate-window keys belong to the input method, not the push-to-talk
      // binding UI. Keep listening so the next real key still completes capture.
      if (keyboardEventIsClaimed(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setCapturingKey(false);
      queueMicrotask(() => captureButton?.focus());

      if (event.key === 'Escape') return;

      const key = event.key === ' ' ? 'Space' : event.key;
      updateVoice({ pushToTalkKey: key, pushToTalk: true });
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));
  });

  return (
    <div class="voice-settings" data-testid="voice-settings">
      <section class="voice-settings__section" aria-labelledby="voice-devices-title">
        <h3 class="voice-settings__section-title" id="voice-devices-title">Devices</h3>
        <p class="voice-settings__section-copy">Choose the capture, playback, and camera paths for this voice session.</p>
        <Show when={devicesLoading()}>
          <p class="onyx-field__description" role="status">Checking media devices…</p>
        </Show>
        <Show when={deviceError()}>
          {(error) => <p class="onyx-field__error" role="alert">{error()}</p>}
        </Show>
        <div class="voice-settings__grid">
          <DeviceSelect
            id="voice-input-device"
            label="Microphone"
            description="Microphone used for calls and rooms."
            value={voice().inputDeviceId}
            devices={inputs()}
            emptyLabel="System microphone"
            onValue={(value) => updateVoice({ inputDeviceId: value })}
          />
          <div class="voice-settings__output-choice">
            <DeviceSelect
              id="voice-output-device"
              label="Speakers"
              description="Speaker or headset for remote audio."
              value={voice().outputDeviceId}
              devices={outputs()}
              emptyLabel="System speaker"
              onValue={(value) => updateVoice({ outputDeviceId: value })}
            />
            <Show when={selectAudioOutput}>
              <Button
                variant="ghost"
                onClick={() => void chooseAudioOutput()}
                disabled={outputSelection().kind === 'pending'}
                aria-busy={outputSelection().kind === 'pending' ? 'true' : 'false'}
              >
                {outputSelection().kind === 'pending' ? 'Choosing speaker…' : 'Choose speaker…'}
              </Button>
              <Show when={outputSelection().kind === 'success'}>
                <p class="onyx-field__description" role="status">
                  {(outputSelection() as Extract<OutputSelectionState, { kind: 'success' }>).message}
                </p>
              </Show>
              <Show when={outputSelection().kind === 'error'}>
                <p class="onyx-field__error" role="alert">
                  {(outputSelection() as Extract<OutputSelectionState, { kind: 'error' }>).message}
                </p>
              </Show>
            </Show>
          </div>
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
            id="voice-mute-on-join"
            label="Join muted"
            description="Start with your microphone off. Unmute when you are ready to speak."
            checked={voice().muteOnJoin === true}
            onChecked={(checked) => updateVoice({ muteOnJoin: checked })}
          />
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
            ref={captureButton}
            variant="ghost"
            onClick={() => setCapturingKey((capturing) => !capturing)}
            aria-label={capturingKey() ? 'Cancel push-to-talk key capture' : 'Capture push-to-talk key'}
            aria-pressed={capturingKey() ? 'true' : 'false'}
          >
            {capturingKey() ? 'Cancel capture' : 'Capture key'}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setCapturingKey(false);
              updateVoice({ pushToTalkKey: null });
            }}
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
