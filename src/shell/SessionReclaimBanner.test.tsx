// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SessionReclaimBanner.test.tsx
 *
 * Pure rendering test: the store's `sessionReclaim` field (wired in
 * store.sessionReclaim.test.ts) is the single source of truth here too — we
 * seed it directly and assert the banner's four phases render the right
 * copy/affordances, that a guest ('none-held', `sessionReclaim: null`) stays
 * absent, and that the actionable phases dispatch disconnect()/dismiss().
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { SessionReclaimBanner } from './SessionReclaimBanner';
import type { SessionReclaimNotice } from '@/lib/store/store';

const initialState = store.getInitialState();

function seed(sessionReclaim: SessionReclaimNotice | null): void {
  store.setState({ ...initialState, sessionReclaim }, true);
}

describe('SessionReclaimBanner', () => {
  beforeEach(() => {
    seed(null);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
  });

  it('is absent for an ordinary guest / first connect (sessionReclaim: null)', () => {
    seed(null);
    render(() => <SessionReclaimBanner />);

    expect(screen.queryByTestId('session-reclaim-banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a neutral restoring status with no action while a resume is in flight', () => {
    seed({ phase: 'restoring', kind: 'local' });
    render(() => <SessionReclaimBanner />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent(/Restoring your session/);
    expect(status).toHaveTextContent(/Reconnecting you to where you left off/);
    expect(screen.getByTestId('session-reclaim-banner')).toHaveAttribute('data-state', 'restoring');
    expect(screen.queryByTestId('session-reclaim-signin')).not.toBeInTheDocument();
  });

  it('shows a success toast with no action once the resume is confirmed held', () => {
    seed({ phase: 'reclaimed', kind: 'mesh' });
    render(() => <SessionReclaimBanner />);

    const banner = screen.getByTestId('session-reclaim-banner');
    expect(banner).toHaveAttribute('data-state', 'reclaimed');
    expect(banner).toHaveTextContent('Session restored');
    expect(screen.queryByTestId('session-reclaim-signin')).not.toBeInTheDocument();
  });

  it('fails closed to an actionable prompt when the resume is rejected', () => {
    seed({ phase: 'reclaim-failed' });
    render(() => <SessionReclaimBanner />);

    const banner = screen.getByTestId('session-reclaim-banner');
    expect(banner).toHaveAttribute('data-state', 'reclaim-failed');
    expect(banner).toHaveTextContent(/Couldn't restore your session/);
    expect(banner).toHaveTextContent(/Sign in again to keep going/);
    expect(screen.getByTestId('session-reclaim-signin')).toHaveTextContent('Sign in again');
  });

  it('fails closed to an actionable prompt when the only held bearer has lapsed', () => {
    seed({ phase: 'sign-in-again' });
    render(() => <SessionReclaimBanner />);

    const banner = screen.getByTestId('session-reclaim-banner');
    expect(banner).toHaveAttribute('data-state', 'sign-in-again');
    expect(banner).toHaveTextContent(/Your session has expired/);
    expect(screen.getByTestId('session-reclaim-signin')).toBeInTheDocument();
  });

  it('never renders a silent guest continuation for an actionable phase — Sign in again calls disconnect()', () => {
    const disconnect = vi.fn();
    seed({ phase: 'reclaim-failed' });
    store.setState({ disconnect });
    render(() => <SessionReclaimBanner />);

    fireEvent.click(screen.getByTestId('session-reclaim-signin'));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('Dismiss clears the banner via dismissSessionReclaim()', () => {
    const dismissSessionReclaim = vi.fn();
    seed({ phase: 'reclaimed', kind: 'local' });
    store.setState({ dismissSessionReclaim });
    render(() => <SessionReclaimBanner />);

    fireEvent.click(screen.getByTestId('session-reclaim-dismiss'));
    expect(dismissSessionReclaim).toHaveBeenCalledTimes(1);
  });

  it('reacts to store updates without remounting — restoring flips to reclaim-failed in place', () => {
    seed({ phase: 'restoring', kind: 'local' });
    render(() => <SessionReclaimBanner />);
    expect(screen.getByTestId('session-reclaim-banner')).toHaveAttribute('data-state', 'restoring');
    expect(screen.queryByTestId('session-reclaim-signin')).not.toBeInTheDocument();

    store.setState({ sessionReclaim: { phase: 'reclaim-failed' } });

    expect(screen.getByTestId('session-reclaim-banner')).toHaveAttribute('data-state', 'reclaim-failed');
    expect(screen.getByTestId('session-reclaim-signin')).toBeInTheDocument();
  });
});
