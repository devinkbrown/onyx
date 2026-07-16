// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PasskeysSection component — designed disabled / empty / list states, and the
 * rename + remove affordances wired to store actions. jsdom has no real
 * WebAuthn, so we stub PublicKeyCredential/navigator.credentials to make
 * isPasskeySupported() true where a "browser supports it" path is under test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import {
  store,
  _resetPasskeyStateForTests,
  MAX_PASSKEY_LABEL_LENGTH,
  type PasskeyCredential,
} from '@/lib/store/store';
import { PasskeysSection } from './PasskeysSection';

const initialState = store.getInitialState();

function stubBrowserSupport(supported: boolean): void {
  vi.stubGlobal('isSecureContext', supported);
  vi.stubGlobal('PublicKeyCredential', supported ? (function () {} as unknown) : undefined);
  vi.stubGlobal(
    'navigator',
    supported
      ? ({ credentials: { create: vi.fn(), get: vi.fn() } } as unknown)
      : ({} as unknown),
  );
}

function makeClient() {
  return { sendRaw: vi.fn(), isupport: { CHANTYPES: '#&' }, negotiatedCaps: new Set<string>() };
}

function seedServer(account: string) {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'IRCXNet',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account,
    account,
    connected: true,
  };
}

function memoryOwner(identity = 'alice', serverUrl = 'wss://eshmaki.me'): DeviceMemoryOwner {
  return { serverUrl, identity };
}

const cred = (over: Partial<PasskeyCredential>): PasskeyCredential => ({
  id: 'credAAA',
  label: 'My laptop',
  signCount: 3,
  createdAt: null,
  ...over,
});

beforeEach(() => {
  store.setState(initialState, true);
  stubBrowserSupport(true);
});

afterEach(() => {
  cleanup();
  _resetPasskeyStateForTests();
  vi.unstubAllGlobals();
});

describe('PasskeysSection disabled states', () => {
  it('shows a browser-unsupported notice when WebAuthn is missing', () => {
    stubBrowserSupport(false);
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    expect(screen.getByTestId('passkeys-browser-unsupported')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a passkey')).not.toBeInTheDocument();
  });

  it('shows a server-unsupported notice when the probe resolved false', () => {
    store.setState({ passkeySupported: false });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    expect(screen.getByTestId('passkeys-server-unsupported')).toBeInTheDocument();
  });

  it('renders nothing actionable for a guest (no account)', () => {
    render(() => <PasskeysSection account={null} owner={null} active={true} />);
    expect(screen.queryByLabelText('Add a passkey')).not.toBeInTheDocument();
    expect(screen.queryByTestId('passkeys-server-unsupported')).not.toBeInTheDocument();
  });

  it('renders no manager while the device owner does not match the signed-in account', () => {
    store.setState({
      passkeySupported: true,
      passkeyCreds: [cred({ id: 'alice-credential', label: 'Alice laptop' })],
    });
    render(() => (
      <PasskeysSection account="bob" owner={memoryOwner('alice')} active={true} />
    ));

    expect(screen.queryByLabelText('Add a passkey')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Alice laptop' })).not.toBeInTheDocument();
  });
});

describe('PasskeysSection manager', () => {
  it('probes the list when opened for a signed-in user', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'LIST');
  });

  it('bounds and sanitizes a passkey label before retaining or dispatching it', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    client.sendRaw.mockClear();
    const input = screen.getByLabelText('Passkey name (optional)');
    const oversized = `${'x'.repeat(MAX_PASSKEY_LABEL_LENGTH)}\u0000\n${'y'.repeat(200)}`;

    fireEvent.input(input, { target: { value: oversized } });
    expect(input).toHaveAttribute('maxlength', String(MAX_PASSKEY_LABEL_LENGTH));
    expect(input).toHaveValue('x'.repeat(MAX_PASSKEY_LABEL_LENGTH));
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));

    expect(client.sendRaw).toHaveBeenCalledWith(
      'WEBAUTHN',
      'REGISTER',
      'x'.repeat(MAX_PASSKEY_LABEL_LENGTH),
    );
  });

  it('refreshes the list when the open panel changes from Alice to Bob', async () => {
    const client = makeClient();
    const [account, setAccount] = createSignal('alice');
    const [owner, setOwner] = createSignal(memoryOwner());
    store.setState({ client: client as never, server: seedServer('alice') });
    render(() => <PasskeysSection account={account()} owner={owner()} active={true} />);
    expect(client.sendRaw).toHaveBeenCalledTimes(1);

    store.setState({ server: seedServer('bob') });
    setAccount('bob');
    setOwner(memoryOwner('bob'));

    await waitFor(() => expect(client.sendRaw).toHaveBeenCalledTimes(2));
    expect(client.sendRaw).toHaveBeenLastCalledWith('WEBAUTHN', 'LIST');
  });

  it('retires typed and armed actions when the same account moves to another server', async () => {
    const client = makeClient();
    const [owner, setOwner] = createSignal(memoryOwner());
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      passkeySupported: true,
      passkeyCreds: [
        cred({ id: 'cred-laptop', label: 'laptop' }),
        cred({ id: 'cred-phone', label: 'phone' }),
      ],
    });
    render(() => <PasskeysSection account="alice" owner={owner()} active={true} />);

    fireEvent.input(screen.getByLabelText('Passkey name (optional)'), {
      target: { value: 'Alice security key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename laptop' }));
    fireEvent.input(screen.getByLabelText('New name'), {
      target: { value: 'Alice work laptop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove phone' }));
    expect(screen.getByRole('group', { name: 'Confirm removal' })).toBeInTheDocument();

    client.sendRaw.mockClear();
    store.setState({ server: { ...seedServer('alice'), url: 'wss://other.example/ws' } });
    setOwner(memoryOwner('alice', 'wss://other.example/ws'));

    await waitFor(() => {
      expect(screen.getByLabelText('Passkey name (optional)')).toHaveValue('');
      expect(screen.queryByLabelText('New name')).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Confirm removal' })).not.toBeInTheDocument();
    });
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'LIST');
  });

  it('retires local passkey actions when the account panel closes', async () => {
    const [active, setActive] = createSignal(true);
    store.setState({
      client: makeClient() as never,
      passkeySupported: true,
      passkeyCreds: [cred({ id: 'credAAA', label: 'laptop' })],
    });
    render(() => (
      <PasskeysSection account="alice" owner={memoryOwner()} active={active()} />
    ));

    fireEvent.input(screen.getByLabelText('Passkey name (optional)'), {
      target: { value: 'temporary label' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove laptop' }));
    expect(screen.getByRole('group', { name: 'Confirm removal' })).toBeInTheDocument();

    setActive(false);
    setActive(true);

    await waitFor(() => {
      expect(screen.getByLabelText('Passkey name (optional)')).toHaveValue('');
      expect(screen.queryByRole('group', { name: 'Confirm removal' })).not.toBeInTheDocument();
    });
  });

  it('shows the empty state once the list resolves with no creds', () => {
    // active=false: no probe, so the pre-resolved (supported, not pending, empty)
    // state renders the empty placeholder rather than the loading spinner.
    store.setState({ client: makeClient() as never, passkeySupported: true, passkeyCreds: [] });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={false} />);
    expect(screen.getByTestId('passkeys-empty')).toBeInTheDocument();
  });

  it('lists creds with label, sign count, and created date', () => {
    store.setState({
      client: makeClient() as never,
      passkeySupported: true,
      passkeyCreds: [cred({ label: 'My laptop', signCount: 5, createdAt: 1700000000 })],
    });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    expect(screen.getByText('My laptop')).toBeInTheDocument();
    expect(screen.getByText('Used 5×')).toBeInTheDocument();
    expect(screen.getByText(/Added /)).toBeInTheDocument();
  });

  it('renders a placeholder name for an unlabelled passkey', () => {
    store.setState({
      client: makeClient() as never,
      passkeySupported: true,
      passkeyCreds: [cred({ label: '' })],
    });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    expect(screen.getByText('Unnamed passkey')).toBeInTheDocument();
  });

  it('removes a passkey behind an inline confirm', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      passkeySupported: true,
      passkeyCreds: [cred({ id: 'credAAA', label: 'laptop' })],
    });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove laptop' }));
    // Confirm appears; the raw command only fires after confirming.
    expect(client.sendRaw).not.toHaveBeenCalledWith('WEBAUTHN', 'REMOVE', 'credAAA');
    fireEvent.click(screen.getByRole('button', { name: 'Remove?' }));
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'REMOVE', 'credAAA');
  });

  it('renames a passkey via the inline form', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      passkeySupported: true,
      passkeyCreds: [cred({ id: 'credAAA', label: 'laptop' })],
    });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename laptop' }));
    const input = screen.getByLabelText('New name') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'work laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'RENAME', 'credAAA', 'work laptop');
  });

  it('bounds a renamed passkey label before dispatch', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      passkeySupported: true,
      passkeyCreds: [cred({ id: 'credAAA', label: 'laptop' })],
    });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    client.sendRaw.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Rename laptop' }));
    const input = screen.getByLabelText('New name');
    fireEvent.input(input, { target: { value: 'z'.repeat(MAX_PASSKEY_LABEL_LENGTH + 100) } });
    expect(input).toHaveAttribute('maxlength', String(MAX_PASSKEY_LABEL_LENGTH));
    expect(input).toHaveValue('z'.repeat(MAX_PASSKEY_LABEL_LENGTH));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.sendRaw).toHaveBeenCalledWith(
      'WEBAUTHN',
      'RENAME',
      'credAAA',
      'z'.repeat(MAX_PASSKEY_LABEL_LENGTH),
    );
  });

  it('hides the rename control when the server lacks RENAME', () => {
    store.setState({
      client: makeClient() as never,
      passkeySupported: true,
      passkeyRenameUnsupported: true,
      passkeyCreds: [cred({ id: 'credAAA', label: 'laptop' })],
    });
    render(() => <PasskeysSection account="alice" owner={memoryOwner()} active={true} />);
    expect(screen.queryByRole('button', { name: 'Rename laptop' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove laptop' })).toBeInTheDocument();
  });
});
