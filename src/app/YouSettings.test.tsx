// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPanel } from './Account';
import { store, getState, type Server } from '@/lib/store';
import { preferences, resetPreferences } from '@/lib/prefs/preferences';
import { sceneMotion } from '@/lib/prefs/sceneMotion';
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
    expect(settings).toHaveTextContent('Account');
    expect(settings).toHaveTextContent('Notifications');
    expect(settings).toHaveTextContent('Privacy');
    expect(settings).toHaveTextContent('Blocked users');
    expect(settings).toHaveTextContent('Appearance');
    expect(screen.getByRole('button', { name: 'Open appearance settings' })).toHaveTextContent('Appearance');
    expect(settings).toHaveTextContent('Reading comfort');
    expect(settings).toHaveTextContent('Motion and data');
    expect(settings).toHaveTextContent('Voice devices');
    expect(settings).toHaveTextContent('Language');
    expect(settings).toHaveTextContent('Download what we store');
    expect(settings).toHaveTextContent("Save this device's history");
    expect(settings).toHaveTextContent('Delete account');
    expect(settings).toHaveTextContent('Help and status');
    expect(screen.getByRole('link', { name: 'About Onyx' })).toHaveAttribute('href', '/about/');
    expect(screen.getByRole('link', { name: 'Network status' })).toHaveAttribute('href', '/status/');
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
      screen.getByTestId('you-settings').querySelector('[data-testid="you-settings-open-preferences"]'),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Protection' })).toBeInTheDocument();
  });

  it('adds and removes notification keywords from You settings', () => {
    renderYou();
    fireEvent.click(screen.getByTestId('you-notifications').querySelector('summary')!);

    expect(screen.getByTestId('you-keywords')).toHaveTextContent('They do not replace All, @, or Mute');
    fireEvent.input(screen.getByLabelText('Word'), { target: { value: '  Release ' } });
    fireEvent.click(screen.getByTestId('you-keyword-add'));

    expect(store.getState().highlightWords).toEqual(['release']);
    expect(screen.getByTestId('you-keywords-list')).toHaveTextContent('release');

    fireEvent.click(screen.getByRole('button', { name: 'Remove release' }));
    expect(store.getState().highlightWords).toEqual([]);
    expect(screen.getByTestId('you-keywords-empty')).toBeInTheDocument();
  });

  it('writes text size through the existing preferences store', () => {
    renderYou();
    fireEvent.click(screen.getByTestId('you-text-size').querySelector('summary')!);
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));

    expect(preferences().fontScale).toBe('lg');
    expect(JSON.parse(localStorage.getItem('onyx:preferences') ?? '{}').fontScale).toBe('lg');
  });

  it('labels the background-only motion switch without implying a data-saver mode', () => {
    renderYou();
    fireEvent.click(screen.getByTestId('you-motion').querySelector('summary')!);

    expect(screen.getByText('Reduce background motion')).toBeInTheDocument();
    expect(screen.getByText(/Message and network data are unchanged/)).toBeInTheDocument();
    expect(screen.queryByText('Use less data')).toBeNull();

    const switchButton = screen.getByText('Reduce background motion').closest('button');
    if (!switchButton) throw new Error('Background motion switch was not rendered');
    fireEvent.click(switchButton);
    expect(sceneMotion()).toBe('off');
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

  it('groups You into task categories with readable rows', () => {
    renderYou();

    expect(screen.getByRole('heading', { name: 'This device' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByTestId('you-account').querySelector('summary')).toHaveTextContent(
      'Identity, protection, and account data',
    );
    expect(screen.getByTestId('you-notifications').querySelector('summary')).toHaveTextContent(
      'Mentions and extra ping words',
    );
    expect(screen.getByRole('button', { name: 'Open appearance settings' })).toHaveAccessibleName(
      'Open appearance settings',
    );
  });

  it('keeps guest claim as the account task and hides signed-in sections', () => {
    renderYou(null);

    expect(screen.getByTestId('you-settings')).toHaveTextContent(
      'Keep this name if you want to protect it without disconnecting.',
    );
    expect(screen.getByTestId('account-guest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep this name/i })).toBeInTheDocument();
    expect(screen.queryByTestId('account-section-nav')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
  });
});
