// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DmKeyChangeBanner.test.tsx
 *
 * The E2EE key-change (TOFU anti-MITM) warning surface. The store is the single
 * source of truth: we seed the active DM view + a pending PeerKeyChange + the two
 * cached safety numbers, then assert the banner self-gates, renders both
 * fingerprints, and dispatches accept/dismiss for the active peer.
 *
 * loadSafetyNumber / loadPendingKeySafetyNumber are stubbed to no-op promises so
 * the on-mount effect never reaches the real Web Crypto / IndexedDB path; the
 * display reads the safety-number maps we seed directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@solidjs/testing-library';
import { DmKeyChangeBanner } from './DmKeyChangeBanner';
import { store, getState, type ActiveView, type PeerKeyChange } from '@/lib/store';

const initialState = store.getInitialState();

const PINNED_SN = '11111 22222 33333 44444 55555 66666 77777 88888 99999 00000 12121 34343';
const PENDING_SN = '99999 88888 77777 66666 55555 44444 33333 22222 11111 00000 43434 21212';

type SeedOpts = {
  view?: ActiveView;
  change?: PeerKeyChange | null;
  peer?: string;
  pinnedSn?: string | null;
  pendingSn?: string | null;
};

function seed(opts?: SeedOpts) {
  const peer = opts?.peer ?? 'Trev';
  const key = peer.toLowerCase();
  const peerKeyChanges = new Map<string, PeerKeyChange>();
  if (opts?.change !== null) {
    peerKeyChanges.set(key, opts?.change ?? { pinnedKey: 'old-key', newKey: 'new-key' });
  }
  const peerSafetyNumbers = new Map<string, string>();
  if (opts?.pinnedSn) peerSafetyNumbers.set(key, opts.pinnedSn);
  const pendingKeySafetyNumbers = new Map<string, string>();
  if (opts?.pendingSn) pendingKeySafetyNumbers.set(key, opts.pendingSn);

  store.setState({
    activeView: opts?.view ?? { kind: 'dm', nick: peer },
    peerKeyChanges,
    peerSafetyNumbers,
    pendingKeySafetyNumbers,
  });
  return render(() => <DmKeyChangeBanner />);
}

beforeEach(() => {
  store.setState(initialState, true);
  // Neutralise the async safety-number loads the on-mount effect fires.
  store.setState({
    loadSafetyNumber: vi.fn(() => Promise.resolve(null)),
    loadPendingKeySafetyNumber: vi.fn(() => Promise.resolve(null)),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DmKeyChangeBanner', () => {
  it('appears when the active DM peer has a pending key-change', () => {
    seed({ peer: 'Trev' });
    const region = screen.getByRole('region', { name: /key is different/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent(/Trev/);
    expect(region).toHaveTextContent(/Encryption key changed/i);
  });

  it('is absent when the active DM peer has no key-change', () => {
    seed({ change: null });
    expect(screen.queryByRole('region', { name: /key is different/i })).not.toBeInTheDocument();
  });

  it('is absent when the active view is a channel, even with a pending change elsewhere', () => {
    seed({ view: { kind: 'channel', channel: '#root' } });
    expect(screen.queryByRole('region', { name: /key is different/i })).not.toBeInTheDocument();
  });

  it('announces the change assertively on appear', () => {
    seed({ peer: 'Trev' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Trev's encryption key changed/i);
  });

  it('renders BOTH safety numbers as grouped fingerprints', () => {
    seed({ peer: 'Trev', pinnedSn: PINNED_SN, pendingSn: PENDING_SN });

    const pinned = screen.getByLabelText(/Current \(trusted\) safety number/i);
    const pending = screen.getByLabelText(/New \(unverified\) safety number/i);

    // Each fingerprint renders all 12 five-digit groups.
    expect(pinned.textContent?.replace(/\s+/g, '')).toHaveLength(60);
    expect(pending.textContent?.replace(/\s+/g, '')).toHaveLength(60);
    expect(pinned).toHaveTextContent('11111');
    expect(pending).toHaveTextContent('43434');
  });

  it('silences the async safety-number outputs so they do not re-announce', () => {
    seed({ peer: 'Trev', pinnedSn: PINNED_SN, pendingSn: PENDING_SN });
    // <output> is an implicit role=status / aria-live=polite live region; the
    // fingerprints fill in asynchronously, so without silencing they announce
    // ~60 digits (twice) over the one-shot alert and re-fire on peer switch.
    const pinned = screen.getByLabelText(/Current \(trusted\) safety number/i);
    const pending = screen.getByLabelText(/New \(unverified\) safety number/i);
    expect(pinned).toHaveAttribute('aria-live', 'off');
    expect(pending).toHaveAttribute('aria-live', 'off');
  });

  it('shows a computing state while a safety number is still loading', () => {
    seed({ peer: 'Trev', pinnedSn: PINNED_SN, pendingSn: null });
    // Pending SN absent → its column shows the in-flight note, not a blank.
    expect(screen.getByText(/Computing safety number/i)).toBeInTheDocument();
  });

  it('kicks off both safety-number loads for the active peer on appear', () => {
    seed({ peer: 'Trev' });
    expect(getState().loadSafetyNumber).toHaveBeenCalledWith('Trev');
    expect(getState().loadPendingKeySafetyNumber).toHaveBeenCalledWith('Trev');
  });

  it('Accept dispatches acceptPeerKeyChange for the active peer', () => {
    const accept = vi.fn();
    seed({ peer: 'Trev' });
    store.setState({ acceptPeerKeyChange: accept });

    fireEvent.click(screen.getByRole('button', { name: /accept new key/i }));
    expect(accept).toHaveBeenCalledWith('Trev');
  });

  it('Dismiss dispatches dismissPeerKeyChange for the active peer', () => {
    const dismiss = vi.fn();
    seed({ peer: 'Trev' });
    store.setState({ dismissPeerKeyChange: dismiss });

    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    expect(dismiss).toHaveBeenCalledWith('Trev');
  });
});
