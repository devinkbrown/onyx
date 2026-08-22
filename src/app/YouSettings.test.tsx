// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPanel } from './Account';
import { store, getState, type Server } from '@/lib/store';
import { preferences, resetPreferences } from '@/lib/prefs/preferences';
import { resetGuestClaimSheetState } from '@/shell/guestClaimState';

const initialState = store.getInitialState();

function makeClient() {
  return { sendRaw: vi.fn() };
}

function seedServer(account: string | null): Server {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'Onyx',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account ?? 'guest',
    account,
    connected: true,
  };
}

function renderYou(account: string | null = 'alice') {
  store.setState({
    client: makeClient() as never,
    server: seedServer(account),
  });
  return render(() => <AccountPanel open={true} onOpenChange={() => {}} />);
}

beforeEach(() => {
  store.setState(initialState, true);
  resetGuestClaimSheetState();
  resetPreferences();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetGuestClaimSheetState();
  resetPreferences();
});

describe('You settings list', () => {
  it('shows the consumer settings list instead of Theme Studio', () => {
    renderYou();

    const settings = screen.getByTestId('you-settings');
    expect(settings).toHaveTextContent('Account and devices');
    expect(settings).toHaveTextContent('Notifications');
    expect(settings).toHaveTextContent('Privacy');
    expect(settings).toHaveTextContent('Blocked users');
    expect(settings).toHaveTextContent('Appearance');
    expect(settings).toHaveTextContent('Text size');
    expect(settings).toHaveTextContent('Reduced motion');
    expect(settings).toHaveTextContent('Voice devices');
    expect(settings).toHaveTextContent('Language');
    expect(settings).toHaveTextContent('Download what we store');
    expect(settings).toHaveTextContent("Save this device's history");
    expect(settings).toHaveTextContent('Delete account');
    expect(settings).toHaveTextContent('Support');
    expect(settings).not.toHaveTextContent('Data export');
    expect(settings).not.toHaveTextContent('Your data');
    expect(settings).toHaveTextContent('Advanced');

    expect(screen.queryByTestId('theme-studio')).toBeNull();
    expect(screen.queryByText('THRESHOLD')).toBeNull();
    expect(screen.queryByRole('radio', { name: /Vermillion/i })).toBeNull();
    expect(screen.getByTestId('you-advanced')).not.toHaveAttribute('open');
  });

  it('keeps Theme Studio one Advanced tap away and reuses preference actions', () => {
    renderYou();
    fireEvent.click(screen.getByTestId('you-advanced').querySelector('summary')!);

    expect(screen.getByTestId('you-open-theme-studio')).toHaveAttribute('href', '/appearance/');
    expect(
      screen.getByTestId('you-settings').querySelector('[data-testid="you-open-preferences"]'),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Protection' })).toBeInTheDocument();
  });

  it('writes text size through the existing preferences store', () => {
    renderYou();
    fireEvent.click(screen.getByTestId('you-text-size').querySelector('summary')!);
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));

    expect(preferences().fontScale).toBe('lg');
    expect(JSON.parse(localStorage.getItem('onyx:preferences') ?? '{}').fontScale).toBe('lg');
  });

  it('opens voice devices through the existing store action', async () => {
    const openVoice = vi.spyOn(getState(), 'openVoiceSettings');
    const closeSpy = vi.fn();
    store.setState({
      client: makeClient() as never,
      server: seedServer('alice'),
    });
    render(() => <AccountPanel open={true} onOpenChange={closeSpy} />);

    fireEvent.click(screen.getByTestId('you-open-voice'));
    expect(closeSpy).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(openVoice).toHaveBeenCalled();
    });
  });
});
