// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GuestClaimPrompt.test.tsx
 *
 * Compact chip + Sheet claim funnel: REGISTER → (VERIFY?) → IDENTIFY → 900,
 * durable per-owner dismissal, password floor, read-only nick, Escape focus.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@solidjs/testing-library';
import {
  GuestClaimPrompt,
  GUEST_CLAIM_DISMISS_KEY,
  GUEST_CLAIM_MIN_PASSWORD,
} from './GuestClaimPrompt';
import { store, getState, type Server } from '@/lib/store';
import { parseIRCMessage } from '@/lib/irc/parser';
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import {
  isGuestClaimSheetOpen,
  openGuestClaimSheet,
  resetGuestClaimSheetState,
} from './guestClaimState';

const initialState = store.getInitialState();

function guestOwner(nick: string, serverUrl = 'wss://eshmaki.me'): DeviceMemoryOwner {
  return { serverUrl, identity: nick.toLowerCase() };
}

function seedServer(account: string | null): Server {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'Onyx',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account ?? 'Nova',
    account,
    connected: true,
  };
}

function seed(opts?: { account?: string | null; nick?: string }) {
  store.setState({
    server: seedServer(opts?.account ?? null),
    ourNick: opts?.nick ?? 'Nova',
    registerPending: false,
    registerError: null,
    verifyRequired: false,
    accountActionError: null,
  });
  return render(() => <GuestClaimPrompt />);
}

function openSheetFromChip(): void {
  fireEvent.click(screen.getByTestId('guest-claim-open'));
}

beforeEach(() => {
  store.setState(initialState, true);
  resetGuestClaimSheetState();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  resetGuestClaimSheetState();
});

describe('GuestClaimPrompt — chip', () => {
  it('renders a compact keep-nick chip for a guest with a live nick', () => {
    seed({ account: null, nick: 'Nova' });
    expect(screen.getByTestId('guest-claim')).toBeInTheDocument();
    expect(screen.getByTestId('guest-claim')).toHaveTextContent('Keep');
    expect(screen.getByTestId('guest-claim')).toHaveTextContent('Nova');
    expect(screen.queryByTestId('guest-claim-sheet')).not.toBeInTheDocument();
  });

  it('is absent when signed in', () => {
    seed({ account: 'Nova', nick: 'Nova' });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });

  it('is absent when there is no nick yet', () => {
    seed({ account: null, nick: '' });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });

  it('is absent after dismiss and persists the dismissal per guest identity', () => {
    seed({ account: null, nick: 'Nova' });
    fireEvent.click(screen.getByTestId('guest-claim-dismiss'));
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
    const key = deviceMemoryStorageKey(GUEST_CLAIM_DISMISS_KEY, guestOwner('Nova'))!;
    expect(localStorage.getItem(key)).toBe('1');
    expect(localStorage.getItem(GUEST_CLAIM_DISMISS_KEY)).toBeNull();
  });

  it('stays absent on mount when previously dismissed', () => {
    const key = deviceMemoryStorageKey(GUEST_CLAIM_DISMISS_KEY, guestOwner('Nova'))!;
    localStorage.setItem(key, '1');
    seed({ account: null, nick: 'Nova' });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });

  it('purges the ownerless dismissal instead of assigning it to the next guest', () => {
    localStorage.setItem(GUEST_CLAIM_DISMISS_KEY, '1');
    seed({ account: null, nick: 'Nova' });
    expect(screen.getByTestId('guest-claim')).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_CLAIM_DISMISS_KEY)).toBeNull();
  });

  it('isolates dismissals across guest identities on the same endpoint', () => {
    seed({ account: null, nick: 'Nova' });
    fireEvent.click(screen.getByTestId('guest-claim-dismiss'));

    store.setState({ server: { ...seedServer(null), nick: 'Echo' }, ourNick: 'Echo' });
    expect(screen.getByTestId('guest-claim')).toHaveTextContent('Echo');

    store.setState({ server: { ...seedServer(null), nick: 'Nova' }, ourNick: 'Nova' });
    expect(screen.queryByTestId('guest-claim')).toBeNull();
  });

  it('still opens from shared state after the chip was dismissed', () => {
    seed({ account: null, nick: 'Nova' });
    fireEvent.click(screen.getByTestId('guest-claim-dismiss'));
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();

    openGuestClaimSheet();
    expect(screen.getByTestId('guest-claim-sheet')).toBeInTheDocument();
    expect(isGuestClaimSheetOpen()).toBe(true);
  });
});

describe('GuestClaimPrompt — sheet form', () => {
  it('opens a Sheet with a read-only nick matching the live nick', () => {
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    const nick = screen.getByTestId('guest-claim-nick') as HTMLInputElement;
    expect(nick).toHaveAttribute('readonly');
    expect(nick).toHaveValue('Nova');
    // Live nick updates stay reflected; the field is not user-editable.
    store.setState({ ourNick: 'Echo', server: { ...seedServer(null), nick: 'Echo' } });
    expect((screen.getByTestId('guest-claim-nick') as HTMLInputElement)).toHaveValue('Echo');
  });

  it('does not dispatch without a password', () => {
    const spy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {});
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('rejects passwords shorter than the minimum length', () => {
    const spy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {});
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'short' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      new RegExp(`at least ${GUEST_CLAIM_MIN_PASSWORD}`, 'i'),
    );
  });

  it('dispatches registerAccount with the current nick and optional email', () => {
    const spy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {});
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: '  me@example.com  ' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Nova', 'me@example.com', 'hunter2hunter2');
  });

  it('surfaces a register error from the store', () => {
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    store.setState({ registerError: 'nick already registered' });
    expect(screen.getByRole('alert')).toHaveTextContent(/already registered/i);
  });
});

describe('GuestClaimPrompt — REGISTER → IDENTIFY → 900', () => {
  it('IDENTIFYs after REGISTER SUCCESS and closes on 900', async () => {
    const registerSpy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    expect(registerSpy).toHaveBeenCalledWith('Nova', undefined, 'hunter2hunter2');

    // REGISTER SUCCESS settle (pending → false, no verify).
    store.setState({ registerPending: false, registerError: null, verifyRequired: false });

    await vi.waitFor(() => {
      expect(identifySpy).toHaveBeenCalledTimes(1);
      expect(identifySpy).toHaveBeenCalledWith('Nova', 'hunter2hunter2');
    });
    expect(disconnectSpy).not.toHaveBeenCalled();

    // 900 → account set.
    store.setState({ server: seedServer('Nova') });
    await vi.waitFor(() => {
      expect(screen.queryByTestId('guest-claim-sheet')).not.toBeInTheDocument();
      expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
    });
  });

  it('does not IDENTIFY while registerPending is still true', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));

    await Promise.resolve();
    await Promise.resolve();
    expect(identifySpy).not.toHaveBeenCalled();

    store.setState({ registerPending: false });
    await vi.waitFor(() => expect(identifySpy).toHaveBeenCalledTimes(1));
  });

  it('does not double-IDENTIFY for a single REGISTER success', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true });
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    store.setState({ registerPending: false, verifyRequired: false, registerError: null });

    await vi.waitFor(() => expect(identifySpy).toHaveBeenCalledTimes(1));

    // Spurious pending flap must not re-issue IDENTIFY.
    store.setState({ registerPending: true });
    store.setState({ registerPending: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(identifySpy).toHaveBeenCalledTimes(1);
  });

  it('does not IDENTIFY when REGISTER fails', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true });
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    store.setState({
      registerPending: false,
      registerError: 'Account already exists',
      verifyRequired: false,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(identifySpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i);
  });

  it('surfaces IDENTIFY failure without disconnect', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true });
    });
    vi.spyOn(getState(), 'identify').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    store.setState({ registerPending: false, registerError: null, verifyRequired: false });

    await vi.waitFor(() => expect(getState().identify).toHaveBeenCalled());

    store.setState({
      accountActionError: {
        command: 'IDENTIFY',
        code: 'INVALID_CREDENTIALS',
        description: 'bad password',
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/bad password/i);
    });
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('guest-claim-sheet')).toBeInTheDocument();
  });

  it('surfaces a real store 464 after IDENTIFY without disconnect', async () => {
    const client = {
      sendRaw: vi.fn(),
      isupport: { CHANTYPES: '#&' },
      negotiatedCaps: new Set<string>(),
    };
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true });
    });
    // Real identify() — captures _identifyReplyContext for the 464 fold-back.
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    store.setState({ client: client as never });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    store.setState({ registerPending: false, registerError: null, verifyRequired: false });

    await vi.waitFor(() => {
      expect(client.sendRaw).toHaveBeenCalledWith('IDENTIFY', 'Nova', 'hunter2hunter2');
    });

    getState()._handleMessage(parseIRCMessage(':eshmaki.me 464 Nova :Password incorrect'));

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Password incorrect/i);
    });
    expect(getState().accountActionError).toMatchObject({
      command: 'IDENTIFY',
      code: '464',
      description: 'Password incorrect',
    });
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('guest-claim-sheet')).toBeInTheDocument();
  });

  it('REGISTER client-gone no-op: no IDENTIFY, reconnect error, sheet retained', async () => {
    // Store no-ops when client is missing — registerPending never arms.
    const registerSpy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      /* no-op: leave registerPending false */
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(getState().registerPending).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
    expect(identifySpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/reconnect required/i);
    expect(screen.getByTestId('guest-claim-sheet')).toBeInTheDocument();
    expect(isGuestClaimSheetOpen()).toBe(true);
  });
});

describe('GuestClaimPrompt — REGISTER → VERIFY → IDENTIFY → 900', () => {
  it('runs VERIFY then IDENTIFY after VERIFICATION_REQUIRED', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const verifySpy = vi.spyOn(getState(), 'verifyAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null });
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));

    store.setState({ registerPending: false, registerError: null, verifyRequired: true });

    await vi.waitFor(() => {
      expect(screen.getByTestId('guest-claim-verify-form')).toBeInTheDocument();
    });
    expect(identifySpy).not.toHaveBeenCalled();

    fireEvent.input(screen.getByLabelText(/verification code/i), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-verify-form'));
    expect(verifySpy).toHaveBeenCalledWith('Nova', '123456');

    store.setState({ registerPending: false, registerError: null, verifyRequired: false });

    await vi.waitFor(() => {
      expect(identifySpy).toHaveBeenCalledTimes(1);
      expect(identifySpy).toHaveBeenCalledWith('Nova', 'hunter2hunter2');
    });

    store.setState({ server: seedServer('Nova') });
    await vi.waitFor(() => {
      expect(screen.queryByTestId('guest-claim-sheet')).not.toBeInTheDocument();
    });
  });

  it('VERIFY client-gone no-op: no IDENTIFY, reconnect error, sheet retained', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const verifySpy = vi.spyOn(getState(), 'verifyAccount').mockImplementation(() => {
      /* no-op: leave registerPending false */
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));
    store.setState({ registerPending: false, registerError: null, verifyRequired: true });

    await vi.waitFor(() => {
      expect(screen.getByTestId('guest-claim-verify-form')).toBeInTheDocument();
    });

    fireEvent.input(screen.getByLabelText(/verification code/i), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-verify-form'));
    expect(verifySpy).toHaveBeenCalledWith('Nova', '123456');
    expect(getState().registerPending).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
    expect(identifySpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/reconnect required/i);
    expect(screen.getByTestId('guest-claim-sheet')).toBeInTheDocument();
    expect(isGuestClaimSheetOpen()).toBe(true);
  });
});

describe('GuestClaimPrompt — focus / Escape', () => {
  it('restores focus to the chip Keep control when the sheet closes via Escape', async () => {
    seed({ account: null, nick: 'Nova' });
    const openBtn = screen.getByTestId('guest-claim-open');
    openBtn.focus();
    fireEvent.click(openBtn);

    await vi.waitFor(() => {
      expect(screen.getByRole('dialog', { name: /keep this nick/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /keep this nick/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('guest-claim-open')).toHaveFocus();
    });
  });

  it('moves focus into the sheet body when opened', async () => {
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    await vi.waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /keep this nick/i });
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('refuses Escape / close / Not now while a claim request is in flight', async () => {
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const identifySpy = vi.spyOn(getState(), 'identify').mockImplementation(() => {});

    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    fireEvent.input(screen.getByLabelText(/^Password$/i), {
      target: { value: 'hunter2hunter2' },
    });
    fireEvent.submit(screen.getByTestId('guest-claim-form'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('guest-claim-not-now')).toBeDisabled();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: /keep this nick/i })).toBeInTheDocument();
    expect(isGuestClaimSheetOpen()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /close claim panel/i }));
    expect(isGuestClaimSheetOpen()).toBe(true);
    expect(screen.getByTestId('guest-claim-sheet')).toBeInTheDocument();

    // Backdrop is aria-hidden; click it must also no-op while busy.
    const backdrop = document.querySelector('.onyx-sheet__backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(isGuestClaimSheetOpen()).toBe(true);

    expect(identifySpy).not.toHaveBeenCalled();
  });

  it('allows idle Escape to close and restore chip focus', async () => {
    seed({ account: null, nick: 'Nova' });
    const openBtn = screen.getByTestId('guest-claim-open');
    openBtn.focus();
    fireEvent.click(openBtn);

    await vi.waitFor(() => {
      expect(screen.getByRole('dialog', { name: /keep this nick/i })).toBeInTheDocument();
    });
    expect(screen.getByTestId('guest-claim-not-now')).not.toBeDisabled();

    fireEvent.keyDown(document, { key: 'Escape' });

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /keep this nick/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('guest-claim-open')).toHaveFocus();
    });
  });
});

describe('GuestClaimPrompt — honest copy', () => {
  it('avoids urgency, mesh settings, and automatic multi-device E2EE claims', () => {
    seed({ account: null, nick: 'Nova' });
    openSheetFromChip();
    const sheet = screen.getByTestId('guest-claim-sheet');
    const text = sheet.textContent ?? '';
    const chip = screen.getByTestId('guest-claim').textContent ?? '';
    const combined = `${chip} ${text}`.toLowerCase();
    expect(combined).not.toMatch(/before someone else/);
    expect(combined).not.toMatch(/settings across the mesh/);
    expect(combined).not.toMatch(/multi-device sessions/);
    expect(combined).not.toMatch(/no reconnect needed/);
    // Dialog description is outside data-testid sheet body — check dialog too.
    const dialog = screen.getByRole('dialog', { name: /keep this nick/i });
    expect(dialog.textContent?.toLowerCase()).toMatch(/stay connected|passkeys/);
    expect(dialog.textContent?.toLowerCase()).not.toMatch(/settings across/);
    // Sheet surface present for within-query sanity.
    expect(within(sheet).getByTestId('guest-claim-form')).toBeInTheDocument();
  });
});
