// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SessionsDevicesSection — skeleton list: current device active, honest
 * Era 2 (B8) placeholder for remote sessions, passkeys cross-hint.
 */
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';

import { SessionsDevicesSection } from './SessionsDevicesSection';

afterEach(() => {
  cleanup();
});

describe('SessionsDevicesSection', () => {
  it('renders nothing for a guest (no account)', () => {
    render(() => <SessionsDevicesSection account={null} />);
    expect(screen.queryByTestId('sessions-devices-section')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /sessions & devices/i })).not.toBeInTheDocument();
  });

  it('renders nothing for an empty account string (fail-closed)', () => {
    render(() => <SessionsDevicesSection account="" />);
    expect(screen.queryByTestId('sessions-devices-section')).not.toBeInTheDocument();
  });

  it('lists this browser as the active current device', () => {
    render(() => <SessionsDevicesSection account="alice" />);

    const section = screen.getByTestId('sessions-devices-section');
    expect(section).toBeInTheDocument();
    expect(section.tagName).toBe('SECTION');
    expect(screen.getByRole('heading', { name: /sessions & devices/i })).toBeInTheDocument();

    const current = screen.getByTestId('sessions-current-device');
    expect(current).toHaveTextContent('This browser');
    expect(current).toHaveTextContent('Active');
    expect(current).toHaveTextContent(/current session on this device/i);
    expect(within(current).getByText('Active')).toHaveAttribute('data-active', 'true');

    const list = screen.getByLabelText(/active sessions on this device/i);
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('wires aria-labelledby / aria-describedby to the section head', () => {
    render(() => <SessionsDevicesSection account="alice" />);

    const section = screen.getByTestId('sessions-devices-section');
    expect(section).toHaveAttribute('aria-labelledby', 'acct-sessions-title');
    expect(section).toHaveAttribute('aria-describedby', 'acct-sessions-hint');
    expect(document.getElementById('acct-sessions-title')).toHaveTextContent(/sessions & devices/i);
    expect(document.getElementById('acct-sessions-hint')).toHaveTextContent(/passkeys/i);
  });

  it('shows an honest Era 2 placeholder — no fake revoke control', () => {
    render(() => <SessionsDevicesSection account="alice" />);

    const placeholder = screen.getByTestId('sessions-remote-placeholder');
    expect(placeholder).toHaveAttribute('role', 'note');
    expect(placeholder).toHaveTextContent(/other sessions/i);
    expect(placeholder).toHaveTextContent(/session list from the server arrives in era 2 \(b8\)/i);
    expect(placeholder).toHaveTextContent(/nothing is fabricated/i);
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    // No action controls at all in the skeleton — fail-closed by omission.
    expect(within(screen.getByTestId('sessions-devices-section')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('points at Passkeys for device credentials', () => {
    render(() => <SessionsDevicesSection account="alice" />);

    const hint = screen.getByTestId('sessions-passkeys-hint');
    expect(hint).toHaveTextContent(/passkeys/i);
    expect(hint).toHaveTextContent(/face id|fingerprint|security keys/i);
    expect(within(hint).getByText('Passkeys')).toBeInTheDocument();
  });

  it('names the signed-in account in the section hint', () => {
    render(() => <SessionsDevicesSection account="bob" />);
    expect(screen.getByText('bob', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByTestId('sessions-devices-section')).toHaveTextContent(
      /where bob is signed in/i,
    );
  });

  it('updates when the account prop changes (reactivity)', () => {
    const [account, setAccount] = createSignal<string | null>('alice');
    render(() => <SessionsDevicesSection account={account()} />);

    expect(screen.getByText('alice', { selector: 'strong' })).toBeInTheDocument();
    setAccount('carol');
    expect(screen.getByText('carol', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('alice', { selector: 'strong' })).not.toBeInTheDocument();

    setAccount(null);
    expect(screen.queryByTestId('sessions-devices-section')).not.toBeInTheDocument();
  });
});
