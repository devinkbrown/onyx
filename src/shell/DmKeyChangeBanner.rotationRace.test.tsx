// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Regression coverage for overlapping E2EE peer-key rotations. This crosses the
 * store/banner boundary deliberately: a stale async verification must neither
 * become the key shown to the user nor the key persisted by Accept.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keyPinningMocks = vi.hoisted(() => ({
  pinnedPeerKey: vi.fn(),
  pinPeerKey: vi.fn(),
}));

vi.mock('@/lib/e2ee/keyPinning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/e2ee/keyPinning')>();
  return {
    ...actual,
    pinnedPeerKey: keyPinningMocks.pinnedPeerKey,
    pinPeerKey: keyPinningMocks.pinPeerKey,
  };
});

import { store } from '@/lib/store';
import { DmKeyChangeBanner } from './DmKeyChangeBanner';

const initialState = store.getInitialState();
const PEER = 'Trev';
const KEY = PEER.toLowerCase();
const PINNED_A = 'pinned-a';
const STALE_B = 'stale-b';
const CURRENT_C = 'current-c';
const MEMORY_OWNER = { serverUrl: 'wss://key-rotation.example/ws', identity: 'alice' } as const;
const B_SAFETY = '11111 11111 11111 11111 11111 11111 11111 11111 11111 11111 11111 11111';
const C_SAFETY = '99999 99999 99999 99999 99999 99999 99999 99999 99999 99999 99999 99999';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  store.setState({
    ...initialState,
    ourNick: 'alice',
    server: {
      id: 'key-rotation',
      name: 'Key rotation test',
      network: 'key-rotation',
      url: MEMORY_OWNER.serverUrl,
      icon: 'K',
      nick: 'alice',
      account: MEMORY_OWNER.identity,
      connected: true,
    },
  }, true);
  keyPinningMocks.pinnedPeerKey.mockReset();
  keyPinningMocks.pinPeerKey.mockReset();
  keyPinningMocks.pinPeerKey.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe('DmKeyChangeBanner overlapping peer-key rotations', () => {
  it('never displays or pins stale B after the advertised key advances to C', async () => {
    const stalePinRead = deferred<string | null>();
    const currentSafetyLoad = deferred<string>();
    keyPinningMocks.pinnedPeerKey
      .mockImplementationOnce(() => stalePinRead.promise)
      .mockResolvedValueOnce(PINNED_A);
    keyPinningMocks.pinPeerKey.mockResolvedValue(true);

    // B starts verification, but its IndexedDB pin read is still in flight.
    store.setState({ peerDmKeys: new Map([[KEY, STALE_B]]) });
    const staleFlag = store.getState()._flagPeerKeyChange(PEER, STALE_B);

    // The directory advances to C before B resolves. A previously-computed B
    // fingerprint must be evicted as C becomes the authoritative pending key.
    store.setState({
      peerDmKeys: new Map([[KEY, CURRENT_C]]),
      pendingKeySafetyNumbers: new Map([[KEY, B_SAFETY]]),
    });
    await store.getState()._flagPeerKeyChange(PEER, CURRENT_C);

    store.setState({
      activeView: { kind: 'dm', nick: PEER },
      loadSafetyNumber: vi.fn(() => Promise.resolve(null)),
      loadPendingKeySafetyNumber: vi.fn(() => currentSafetyLoad.promise.then((safety) => {
        if (store.getState().peerKeyChanges.get(KEY)?.newKey !== CURRENT_C) return null;
        store.setState((state) => {
          const pendingKeySafetyNumbers = new Map(state.pendingKeySafetyNumbers);
          pendingKeySafetyNumbers.set(KEY, safety);
          return { pendingKeySafetyNumbers };
        });
        return safety;
      })),
    });

    render(() => <DmKeyChangeBanner />);
    expect(screen.queryAllByText('11111')).toHaveLength(0);

    currentSafetyLoad.resolve(C_SAFETY);
    const pending = await screen.findByLabelText(/New \(unverified\) safety number/i);
    expect(pending).toHaveTextContent('99999');

    // B finishes last. It must not replace C in state or on the verification UI.
    stalePinRead.resolve(PINNED_A);
    await staleFlag;
    expect(store.getState().peerKeyChanges.get(KEY)?.newKey).toBe(CURRENT_C);
    expect(pending).toHaveTextContent('99999');
    expect(pending).not.toHaveTextContent('11111');

    fireEvent.click(screen.getByRole('button', { name: /accept new key/i }));
    await waitFor(() => expect(keyPinningMocks.pinPeerKey).toHaveBeenCalledOnce());
    expect(keyPinningMocks.pinPeerKey).toHaveBeenCalledWith(PEER, CURRENT_C, MEMORY_OWNER);
    expect(keyPinningMocks.pinPeerKey).not.toHaveBeenCalledWith(PEER, STALE_B, MEMORY_OWNER);
  });

  it('refuses Accept when pending state no longer matches the advertised key', () => {
    store.setState({
      peerDmKeys: new Map([[KEY, CURRENT_C]]),
      peerKeyChanges: new Map([[KEY, { pinnedKey: PINNED_A, newKey: STALE_B }]]),
    });

    store.getState().acceptPeerKeyChange(PEER);

    expect(keyPinningMocks.pinPeerKey).not.toHaveBeenCalled();
    expect(store.getState().peerKeyChanges.get(KEY)?.newKey).toBe(STALE_B);
  });
});
