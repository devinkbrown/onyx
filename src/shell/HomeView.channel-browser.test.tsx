// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import { store } from '@/lib/store/store';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

describe('HomeView channel directory', () => {
  beforeEach(() => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens the directory with one LIST request and waits for LISTEND', () => {
    const sendRaw = vi.fn();
    store.setState({ client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never });
    render(() => <HomeView />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse all channels' }));

    expect(sendRaw).toHaveBeenCalledOnce();
    expect(sendRaw).toHaveBeenCalledWith('LIST');
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(store.getState().channelListLoading).toBe(true);

    store.getState()._handleMessage(parseIRCMessage(':server.test 323 me :End of LIST'));

    expect(store.getState().channelListLoading).toBe(false);
  });
});
