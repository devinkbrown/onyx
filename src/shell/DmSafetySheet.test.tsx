// SPDX-License-Identifier: AGPL-3.0-or-later
/** DmSafetySheet trust-state, async ownership, and focus regression coverage. */

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store';
import { DmSafetySheet } from './DmSafetySheet';

const initialState = store.getInitialState();
const SAFETY_NUMBER = '11111 22222 33333 44444 55555 66666 77777 88888 99999 00000 12121 34343';

function seedDm(
  peer = 'Trev',
  options?: {
    peerKey?: boolean;
    safetyNumber?: string | null;
    /** Multi-device directory (ocean.dm-keys). When set, count drives readiness UI. */
    deviceKeys?: string[];
  },
): void {
  const key = peer.toLowerCase();
  const deviceKeys = options?.deviceKeys;
  const hasKey = options?.peerKey !== false;
  store.setState({
    activeView: { kind: 'dm', nick: peer },
    peerDmKeys: hasKey || (deviceKeys && deviceKeys.length > 0)
      ? new Map([[key, deviceKeys?.[0] ?? 'redacted-public-key-material']])
      : new Map(),
    peerDmDeviceKeys: deviceKeys && deviceKeys.length > 0
      ? new Map([[key, deviceKeys]])
      : new Map(),
    peerSafetyNumbers: options?.safetyNumber
      ? new Map([[key, options.safetyNumber]])
      : new Map(),
  });
}

beforeEach(() => {
  store.setState(initialState, true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DmSafetySheet', () => {
  it('self-gates to DMs and disappears when navigation moves to a channel', () => {
    store.setState({ activeView: { kind: 'channel', channel: '#root' } });
    const view = render(() => <DmSafetySheet />);
    expect(screen.queryByRole('button', { name: /verify encryption/i })).toBeNull();

    seedDm('Trev');
    expect(screen.getByRole('button', { name: /verify encryption/i })).toBeInTheDocument();

    store.setState({ activeView: { kind: 'channel', channel: '#ops' } });
    expect(screen.queryByRole('button', { name: /verify encryption/i })).toBeNull();
    view.unmount();
  });

  it('loads and renders the stable store safety number without exposing device keys', async () => {
    const loadSafetyNumber = vi.fn(async () => {
      store.setState({ peerSafetyNumbers: new Map([['trev', SAFETY_NUMBER]]) });
      return SAFETY_NUMBER;
    });
    seedDm('Trev');
    store.setState({ loadSafetyNumber });
    render(() => <DmSafetySheet />);

    const trigger = screen.getByRole('button', { name: /verify encryption/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('region', { name: /verify encryption with Trev/i })).toBeInTheDocument();
    await waitFor(() => expect(loadSafetyNumber).toHaveBeenCalledTimes(1));
    expect(loadSafetyNumber).toHaveBeenCalledWith('Trev');

    const output = await screen.findByLabelText(`Safety number for Trev: ${SAFETY_NUMBER}`);
    const visibleGroups = Array.from(output.querySelectorAll('.dm-safety__number-group'))
      .map((group) => group.childNodes[group.childNodes.length - 1]?.textContent);
    expect(visibleGroups).toEqual(SAFETY_NUMBER.split(' '));
    expect(output).toHaveAttribute('aria-live', 'off');
    expect(screen.getByText('Ready to compare')).toBeInTheDocument();
    expect(screen.getByText('1 device received')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('redacted-public-key-material');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows multi-device count and labels the safety number across all devices', async () => {
    const loadSafetyNumber = vi.fn(async () => {
      store.setState({ peerSafetyNumbers: new Map([['trev', SAFETY_NUMBER]]) });
      return SAFETY_NUMBER;
    });
    seedDm('Trev', {
      safetyNumber: SAFETY_NUMBER,
      deviceKeys: ['redacted-device-a', 'redacted-device-b', 'redacted-device-c'],
    });
    store.setState({ loadSafetyNumber });
    render(() => <DmSafetySheet />);

    fireEvent.click(screen.getByRole('button', { name: /verify encryption/i }));
    expect(await screen.findByText('3 devices received')).toBeInTheDocument();
    expect(screen.getByText(/Current safety number · 3 devices/i)).toBeInTheDocument();
    expect(
      await screen.findByLabelText(`Safety number for Trev across 3 devices: ${SAFETY_NUMBER}`),
    ).toBeInTheDocument();
    expect(screen.getByText(/all 3 of their remembered device keys/i)).toBeInTheDocument();
    expect(screen.getByText(/or a new device appears/i)).toBeInTheDocument();
    // Seal badge reflects advertised device count, never raw keys.
    expect(document.body).not.toHaveTextContent('redacted-device-a');
    const seal = document.querySelector('.dm-safety__seal');
    expect(seal?.textContent).toMatch(/03/);
  });

  it('shows loading and a clear no-key state without claiming encryption is verified', async () => {
    let resolveSafety!: (value: string | null) => void;
    const loadSafetyNumber = vi.fn(() => new Promise<string | null>((resolve) => {
      resolveSafety = resolve;
    }));
    seedDm('Mika', { peerKey: false });
    store.setState({ loadSafetyNumber });
    render(() => <DmSafetySheet />);

    fireEvent.click(screen.getByRole('button', { name: /verify encryption/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Loading this device’s safety number/i);
    expect(screen.getByText('Not received')).toBeInTheDocument();
    expect(screen.getByText('Not ready to compare')).toBeInTheDocument();

    resolveSafety(null);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Mika’s device key has not arrived yet/i);
    });
    expect(screen.getByText(/trust on first use/i)).toHaveTextContent(/identity as unverified/i);
    expect(screen.queryByText(/verified$/i)).toBeNull();
  });

  it('closes on its labelled button and restores focus to the opener', async () => {
    seedDm('Trev', { safetyNumber: SAFETY_NUMBER });
    store.setState({ loadSafetyNumber: vi.fn(() => Promise.resolve(SAFETY_NUMBER)) });
    render(() => <DmSafetySheet />);

    const trigger = screen.getByRole('button', { name: /verify encryption/i });
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: /close encryption verification/i });
    close.focus();
    fireEvent.click(close);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /verify encryption with Trev/i })).toBeNull();
  });

  it('closes with Escape, restores focus, and never traps the non-modal panel', async () => {
    seedDm('Trev', { safetyNumber: SAFETY_NUMBER });
    store.setState({ loadSafetyNumber: vi.fn(() => Promise.resolve(SAFETY_NUMBER)) });
    render(() => <DmSafetySheet />);

    const trigger = screen.getByRole('button', { name: /verify encryption/i });
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: /close encryption verification/i });
    close.focus();
    fireEvent.keyDown(close, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: /verify encryption with Trev/i })).toBeNull();
  });

  it('does not paint a slow peer result after the active DM changes', async () => {
    let resolveTrev!: (value: string | null) => void;
    const loadSafetyNumber = vi.fn((peer: string) => {
      if (peer === 'Trev') {
        return new Promise<string | null>((resolve) => { resolveTrev = resolve; });
      }
      return Promise.resolve(null);
    });
    seedDm('Trev');
    store.setState({ loadSafetyNumber });
    render(() => <DmSafetySheet />);

    fireEvent.click(screen.getByRole('button', { name: /verify encryption/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Loading/i);

    seedDm('Mika', { peerKey: false });
    expect(screen.getByRole('button', { name: /verify encryption/i })).toHaveAttribute('aria-expanded', 'false');
    resolveTrev(SAFETY_NUMBER);
    await Promise.resolve();

    expect(screen.queryByLabelText(/Safety number for Mika/i)).toBeNull();
    expect(document.body).not.toHaveTextContent('11111');
  });
});
