// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import type { CadencePeerState } from '@/lib/cadence-media/types';
import { CaptionsOverlay } from './CaptionsOverlay';
import { IncomingCallOverlay } from './IncomingCallOverlay';
import { OutgoingCallOverlay } from './OutgoingCallOverlay';
import {
  LEGACY_VOICE_PIP_POSITION_STORAGE_KEY,
  VOICE_PIP_POSITION_STORAGE_KEY,
  VoicePip,
} from '../VoicePip';
import * as clipboard from '@/lib/clipboard/writeClipboardText';

const initialState = store.getInitialState();

function peer(nick: string, speaking = false): CadencePeerState {
  return {
    nick,
    channel: '#voice',
    kind: 'voice',
    speaking,
    muted: false,
    hasVideo: false,
    canvas: null,
  };
}

function localStorageValues(): string[] {
  const values: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key === null) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) values.push(value);
  }
  return values;
}

describe('voice overlays', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    store.setState(initialState, true);
    window.localStorage.clear();
  });

  it('shows an incoming call and accepts through the store action', () => {
    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Lapis' });
    const acceptSpy = vi.spyOn(store.getState(), 'acceptDmCall');

    render(() => <IncomingCallOverlay />);

    expect(screen.getByRole('dialog', { name: 'Incoming call' })).toBeTruthy();
    expect(screen.getByText('Lapis')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /accept call from lapis/i }));

    expect(acceptSpy).toHaveBeenCalledTimes(1);
  });

  it('submits an incoming accept only once while the call is still ringing', () => {
    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Lapis' });
    const acceptSpy = vi.spyOn(store.getState(), 'acceptDmCall');

    render(() => <IncomingCallOverlay />);
    const accept = screen.getByRole('button', { name: /accept call from lapis/i });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(acceptSpy).toHaveBeenCalledTimes(1);
    expect(accept).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Accepting call from Lapis');
    expect(screen.getByTestId('incoming-call-overlay').querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('reports a failed accept and allows a retry', () => {
    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Lapis' });
    const acceptSpy = vi.spyOn(store.getState(), 'acceptDmCall')
      .mockImplementationOnce(() => {
        throw new Error('media engine unavailable');
      });

    render(() => <IncomingCallOverlay />);
    const accept = screen.getByRole('button', { name: /accept call from lapis/i });
    fireEvent.click(accept);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not accept the call from Lapis');
    expect(accept).not.toBeDisabled();
    fireEvent.click(accept);
    expect(acceptSpy).toHaveBeenCalledTimes(2);
  });

  it('resets pending acceptance for a replacement caller and ignores the stale rejection', async () => {
    let rejectFirst: (reason?: unknown) => void = () => {};
    const firstAccept = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    const acceptIncomingCall = vi.fn()
      .mockReturnValueOnce(firstAccept)
      .mockReturnValueOnce(undefined);
    store.setState({ acceptIncomingCall } as never);
    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Lapis' });

    render(() => <IncomingCallOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /accept call from lapis/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Accepting call from Lapis');

    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Mina' });
    const replacementAccept = await screen.findByRole('button', { name: /accept call from mina/i });
    expect(replacementAccept).not.toBeDisabled();
    expect(screen.queryByRole('status')).toBeNull();

    rejectFirst(new Error('stale failure'));
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(replacementAccept);
    expect(acceptIncomingCall).toHaveBeenCalledTimes(2);
  });

  it('absorbs a pending accept rejection after unmount', async () => {
    let rejectAccept: (reason?: unknown) => void = () => {};
    const pendingAccept = new Promise<void>((_, reject) => {
      rejectAccept = reject;
    });
    store.setState({ acceptIncomingCall: vi.fn(() => pendingAccept) } as never);
    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Lapis' });

    const view = render(() => <IncomingCallOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /accept call from lapis/i }));
    view.unmount();

    rejectAccept(new Error('late failure'));
    await pendingAccept.catch(() => undefined);
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an outgoing call and cancels through the store action', () => {
    store.getState().setVoiceCallState({ callState: 'ringing_out', callWith: 'Mina' });
    const endSpy = vi.spyOn(store.getState(), 'endDmCall');

    render(() => <OutgoingCallOverlay />);

    expect(screen.getByRole('dialog', { name: 'Calling' })).toBeTruthy();
    expect(screen.getByText('Mina')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /cancel call to mina/i }));

    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('renders seeded live captions for the current voice channel', () => {
    const mediaTranscripts = new Map([
      [
        '#voice',
        [
          { nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') },
          { nick: 'Mina', text: 'Moving to the relay room.', time: new Date('2026-06-19T12:00:02Z') },
        ],
      ],
    ]);
    store.setState({ mediaTranscripts });
    // Captions are now opt-in (VoiceBar toggle) — enable them for this render.
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    expect(screen.getByRole('log', { name: 'Live captions' })).toBeTruthy();
    expect(screen.getByLabelText(/Live captions provenance: This server/i)).toBeTruthy();
    expect(screen.getByText('Aki')).toBeTruthy();
    expect(screen.getByText('Signal is clean.')).toBeTruthy();
    expect(screen.getByText('Moving to the relay room.')).toBeTruthy();
  });

  it('scopes the live-caption log to caption text, keeping toolbar controls out of the announced region', () => {
    const mediaTranscripts = new Map([
      ['#voice', [{ nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') }]],
    ]);
    store.setState({ mediaTranscripts });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    const log = screen.getByRole('log', { name: 'Live captions' });
    // Caption text is inside the announced region.
    expect(within(log).getByText('Signal is clean.')).toBeTruthy();
    // The Copy-transcript control must live OUTSIDE the live region, so activating
    // it (or its appearance) is never announced as new caption activity.
    expect(within(log).queryByRole('button', { name: 'Copy live caption transcript' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy live caption transcript' })).toBeTruthy();
  });

  it('copies the current live caption transcript', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    });
    const mediaTranscripts = new Map([
      [
        '#voice',
        [
          { nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') },
          { nick: 'Mina', text: 'Moving to the relay room.', time: new Date('2026-06-19T12:00:02Z') },
          { nick: 'Noa', text: 'I have the bridge notes.', time: new Date('2026-06-19T12:00:04Z') },
          { nick: 'Ren', text: 'Copy the whole transcript.', time: new Date('2026-06-19T12:00:06Z') },
        ],
      ],
    ]);
    store.setState({ mediaTranscripts });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy live caption transcript' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain('Aki: Signal is clean.');
    expect(copied).toContain('Ren: Copy the whole transcript.');
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('reports caption copy failure without claiming success', async () => {
    vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(false);
    store.setState({
      mediaTranscripts: new Map([
        ['#voice', [{ nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') }]],
      ]),
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });
    render(() => <CaptionsOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy live caption transcript' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard unavailable');
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('guards rapid caption copies and ignores completion after unmount', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const writeClipboardText = vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    store.setState({
      mediaTranscripts: new Map([
        ['#voice', [{ nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') }]],
      ]),
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });
    const view = render(() => <CaptionsOverlay />);

    const copy = screen.getByRole('button', { name: 'Copy live caption transcript' });
    fireEvent.click(copy);
    fireEvent.click(copy);
    expect(writeClipboardText).toHaveBeenCalledOnce();
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute('aria-busy', 'true');
    view.unmount();

    resolveCopy(true);
    await pending;
    await Promise.resolve();
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('exposes an accessible unavailable state without offering an external fallback', () => {
    vi.stubGlobal('Translator', undefined);
    store.setState({
      mediaTranscripts: new Map([
        ['#voice', [{ nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') }]],
      ]),
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('On-device caption translation is unavailable in this browser.');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(screen.queryByRole('button', { name: /translate aki's caption/i })).toBeNull();
    expect(screen.queryByText(/external endpoint/i)).toBeNull();
  });

  it('prevents overlapping translations for one caption and labels transient output as device-local', async () => {
    let resolveTranslation: ((value: string) => void) | undefined;
    const pendingTranslation = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });
    const translate = vi.fn(() => pendingTranslation);
    const create = vi.fn(() => ({ translate }));
    vi.stubGlobal('Translator', { create });
    store.setState({
      mediaTranscripts: new Map([
        ['#voice', [{ nick: 'Aki', text: 'Señal limpia.', time: new Date('2026-06-19T12:00:00Z') }]],
      ]),
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);
    const button = screen.getByRole('button', { name: /translate aki's caption/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Translating on this device…');

    resolveTranslation?.('Signal is clean.');

    expect(await screen.findByText('Signal is clean.')).toBeTruthy();
    expect(screen.getByLabelText(/Caption translation provenance: This device/i)).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
    expect(localStorageValues()).not.toContain('Señal limpia.');
    expect(localStorageValues()).not.toContain('Signal is clean.');
  });

  it('ignores translation completion after the overlay unmounts', async () => {
    let resolveTranslation: ((value: string) => void) | undefined;
    const pendingTranslation = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });
    const translate = vi.fn(() => pendingTranslation);
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    store.setState({
      mediaTranscripts: new Map([
        ['#voice', [{ nick: 'Aki', text: 'Señal limpia.', time: new Date('2026-06-19T12:00:00Z') }]],
      ]),
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    const view = render(() => <CaptionsOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /translate aki's caption/i }));
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));

    view.unmount();
    resolveTranslation?.('Stale translation');
    await Promise.resolve();

    expect(screen.queryByText('Stale translation')).toBeNull();
    expect(localStorageValues()).not.toContain('Stale translation');
  });

  it('discards a stale completion after the caption is replaced', async () => {
    let resolveTranslation: ((value: string) => void) | undefined;
    const pendingTranslation = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });
    vi.stubGlobal('Translator', { create: () => ({ translate: () => pendingTranslation }) });
    const original = { nick: 'Aki', text: 'Viejo.', time: new Date('2026-06-19T12:00:00Z') };
    const replacement = { nick: 'Mina', text: 'Nuevo.', time: new Date('2026-06-19T12:00:01Z') };
    store.setState({ mediaTranscripts: new Map([['#voice', [original]]]) });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /translate aki's caption/i }));
    await screen.findByText('Translating on this device…');

    store.setState({ mediaTranscripts: new Map([['#voice', [replacement]]]) });
    await screen.findByText('Nuevo.');
    resolveTranslation?.('Stale translation');
    await Promise.resolve();
    store.setState({ mediaTranscripts: new Map([['#voice', [original]]]) });

    await screen.findByText('Viejo.');
    expect(screen.queryByText('Stale translation')).toBeNull();
    expect(screen.getByRole('button', { name: /translate aki's caption/i })).toHaveTextContent('Translate');
  });

  it('announces an on-device failure and exposes an accessible retry', async () => {
    const translate = vi.fn()
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockResolvedValueOnce('Signal is clean.');
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    store.setState({
      mediaTranscripts: new Map([
        ['#voice', [{ nick: 'Aki', text: 'Señal limpia.', time: new Date('2026-06-19T12:00:00Z') }]],
      ]),
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /translate aki's caption/i }));

    const error = await screen.findByText('On-device translation failed. Use Retry to try again.');
    expect(error).toHaveAttribute('role', 'status');
    const retry = screen.getByRole('button', { name: /retry translating aki's caption/i });
    expect(retry).toHaveTextContent('Retry');
    fireEvent.click(retry);

    expect(await screen.findByText('Signal is clean.')).toBeTruthy();
    expect(screen.getByLabelText(/Caption translation provenance: This device/i)).toBeTruthy();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('shows the PIP only while in voice and off the active channel', () => {
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'onyx',
      speakingNicks: new Set(['Mina']),
      voiceChannelParticipants: new Map([['#voice', new Set(['onyx', 'Mina'])]]),
    });
    store.getState().setVoiceCallState({
      callState: 'in_call',
      callChannel: '#voice',
      peers: new Map([['Mina', peer('Mina', true)]]),
    });

    render(() => <VoicePip />);

    expect(screen.getByTestId('voice-pip')).toBeTruthy();
    expect(screen.getByText('#voice')).toBeTruthy();

    store.setState({ activeView: { kind: 'channel', channel: '#voice' } });

    expect(screen.queryByTestId('voice-pip')).toBeNull();
  });

  it('migrates a valid legacy PIP position into the onyx namespace', () => {
    window.localStorage.setItem(
      LEGACY_VOICE_PIP_POSITION_STORAGE_KEY,
      JSON.stringify({ x: 48, y: 64 }),
    );
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'onyx',
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice' });

    render(() => <VoicePip />);

    expect(window.localStorage.getItem(LEGACY_VOICE_PIP_POSITION_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(VOICE_PIP_POSITION_STORAGE_KEY) ?? 'null'))
      .toEqual({ x: 48, y: 64 });
    expect(screen.getByTestId('voice-pip')).toHaveStyle({
      '--voice-pip-x': '48px',
      '--voice-pip-y': '64px',
    });
  });

  it('rejects oversized and malformed persisted PIP positions', () => {
    window.localStorage.setItem(
      VOICE_PIP_POSITION_STORAGE_KEY,
      JSON.stringify({ x: 1e100, y: 40 }),
    );
    window.localStorage.setItem(LEGACY_VOICE_PIP_POSITION_STORAGE_KEY, '{broken');
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'onyx',
    });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice' });

    render(() => <VoicePip />);

    const pip = screen.getByTestId('voice-pip');
    expect(pip.getAttribute('style')).not.toContain('e+100');
    expect(window.localStorage.getItem(LEGACY_VOICE_PIP_POSITION_STORAGE_KEY)).toBeNull();
    const persisted = JSON.parse(
      window.localStorage.getItem(VOICE_PIP_POSITION_STORAGE_KEY) ?? 'null',
    ) as { x: number; y: number };
    expect(Number.isFinite(persisted.x)).toBe(true);
    expect(Number.isFinite(persisted.y)).toBe(true);
    expect(Math.abs(persisted.x)).toBeLessThanOrEqual(window.innerWidth);
    expect(Math.abs(persisted.y)).toBeLessThanOrEqual(window.innerHeight);
  });

  it('keeps PIP avatars bounded while reporting the full deduplicated room and speaker totals', () => {
    const roster = new Set([
      'onyx',
      ...Array.from({ length: 12 }, (_, index) => `participant-${index + 1}`),
    ]);
    const speakingNicks = new Set(
      Array.from({ length: 9 }, (_, index) => `PARTICIPANT-${index + 1}`),
    );
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'onyx',
      speakingNicks,
      voiceChannelParticipants: new Map([['#voice', roster]]),
    });
    store.getState().setVoiceCallState({
      callState: 'in_call',
      callChannel: '#voice',
      peers: new Map(),
    });

    const { container } = render(() => <VoicePip />);

    const participants = screen.getByLabelText('13 voice participants');
    expect(participants.querySelectorAll('.voice-pip__participant')).toHaveLength(5);
    expect(within(participants).getByText('+8')).toBeInTheDocument();
    expect(screen.getByLabelText('9 speaking')).toHaveTextContent('9 live');
    expect(container.querySelectorAll('.voice-pip__participant')).toHaveLength(5);
  });

  it('releases pointer capture and resets drag state when the PIP hides mid-drag', async () => {
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'onyx',
      voiceChannelParticipants: new Map([['#voice', new Set(['onyx', 'Mina'])]]),
    });
    store.getState().setVoiceCallState({
      callState: 'in_call',
      callChannel: '#voice',
      peers: new Map([['Mina', peer('Mina')]]),
    });

    render(() => <VoicePip />);
    const pip = screen.getByTestId('voice-pip');
    const handle = pip.querySelector<HTMLElement>('.voice-pip__handle')!;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    handle.setPointerCapture = setPointerCapture;
    handle.releasePointerCapture = releasePointerCapture;

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 7,
      clientX: 40,
      clientY: 40,
    });
    expect(pip).toHaveAttribute('data-dragging', 'true');
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    store.setState({ activeView: { kind: 'channel', channel: '#voice' } });
    await waitFor(() => expect(screen.queryByTestId('voice-pip')).toBeNull());
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    store.setState({ activeView: { kind: 'channel', channel: '#general' } });
    const remounted = await screen.findByTestId('voice-pip');
    expect(remounted).toHaveAttribute('data-dragging', 'false');
    const position = remounted.getAttribute('style');
    fireEvent.pointerMove(remounted.querySelector<HTMLElement>('.voice-pip__handle')!, {
      pointerId: 7,
      clientX: 400,
      clientY: 400,
    });
    expect(remounted).toHaveAttribute('style', position ?? '');
  });
});
