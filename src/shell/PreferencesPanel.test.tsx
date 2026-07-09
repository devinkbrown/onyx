import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closePreferences, openPreferences, resetPreferences } from '@/lib/prefs/preferences';
import { PreferencesPanel } from './PreferencesPanel';

describe('PreferencesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
    closePreferences();
  });

  afterEach(() => {
    cleanup();
    closePreferences();
    localStorage.clear();
  });

  it('surfaces the client accessibility audit ledger', () => {
    openPreferences();
    render(() => <PreferencesPanel />);

    expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Client access audit' })).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.getByText('Channel settings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Public ledger' })).toHaveAttribute(
      'href',
      '/accessibility/',
    );
  });
});
