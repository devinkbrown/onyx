// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import { OperDesk, formatOperWirePreview } from './OperDesk';

const initial = store.getInitialState();

function seed(overrides: Partial<ReturnType<typeof store.getState>> = {}) {
  const client = { sendRaw: vi.fn(() => true) };
  store.setState({
    ...initial,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: 'root',
    networkName: 'IRCXNet',
    isOper: true,
    ...overrides,
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initial, true);
});
afterEach(cleanup);

describe('formatOperWirePreview', () => {
  it('colonizes only a trailing parameter that needs it', () => {
    expect(formatOperWirePreview({
      command: 'EVENT', params: ['BROADCAST', 'server restart at 03:00'],
      summary: '', destructive: true,
    })).toBe('EVENT BROADCAST :server restart at 03:00');
    expect(formatOperWirePreview({
      command: 'EVENT', params: ['ADD', 'FLOOD'], summary: '', destructive: false,
    })).toBe('EVENT ADD FLOOD');
    expect(formatOperWirePreview({
      command: 'REHASH', params: [], summary: '', destructive: true,
    })).toBe('REHASH');
  });
});

describe('OperDesk', () => {
  it('renders nothing until the session holds operator status', () => {
    seed({ isOper: false });
    render(() => <OperDesk />);
    expect(screen.queryByTestId('oper-desk')).toBeNull();
  });

  it('appears the moment oper status is granted mid-session', () => {
    seed({ isOper: false });
    render(() => <OperDesk />);
    expect(screen.queryByTestId('oper-desk')).toBeNull();

    // 381 / MODE +o arrives after mount: the desk must materialise without a
    // remount, which is the whole point of reading isOper through useStore.
    store.setState({ isOper: true });
    expect(screen.getByTestId('oper-desk')).toBeInTheDocument();
    expect(screen.getByTestId('oper-desk-role')).toHaveTextContent('IRC operator');

    store.setState({ isNetworkAdmin: true });
    expect(screen.getByTestId('oper-desk-role')).toHaveTextContent('Network administrator');
  });

  it('reviews a network broadcast before it reaches the wire', () => {
    const client = seed();
    render(() => <OperDesk />);

    fireEvent.input(screen.getByTestId('oper-desk-broadcast-input'), {
      target: { value: 'Maintenance at 03:00 UTC' },
    });
    fireEvent.submit(screen.getByTestId('oper-desk-broadcast-form'));

    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(screen.getByTestId('oper-desk-review-wire')).toHaveTextContent(
      'EVENT BROADCAST :Maintenance at 03:00 UTC',
    );

    fireEvent.click(screen.getByTestId('oper-desk-review-confirm'));
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'BROADCAST', 'Maintenance at 03:00 UTC');
    expect(screen.getByTestId('oper-desk-last-sent')).toBeInTheDocument();
    // Confirming clears the draft so a second click cannot re-announce.
    expect(screen.getByTestId('oper-desk-broadcast-input')).toHaveValue('');
  });

  it('abandons a staged action on cancel', () => {
    const client = seed();
    render(() => <OperDesk />);
    fireEvent.click(screen.getByTestId('oper-desk-rehash'));
    expect(screen.getByTestId('oper-desk-review')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('oper-desk-review-cancel'));
    expect(screen.queryByTestId('oper-desk-review')).toBeNull();
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('sends a non-destructive read straight away', () => {
    const client = seed();
    render(() => <OperDesk />);

    fireEvent.click(screen.getByTestId('oper-desk-privs'));
    expect(client.sendRaw).toHaveBeenCalledWith('PRIVS');
    expect(screen.queryByTestId('oper-desk-review')).toBeNull();

    fireEvent.click(screen.getByTestId('oper-desk-event-list'));
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'LIST');
  });

  it('subscribes and unsubscribes the selected Event Spine category', () => {
    const client = seed();
    render(() => <OperDesk />);

    fireEvent.change(screen.getByTestId('oper-desk-category'), { target: { value: 'FLOOD' } });
    fireEvent.submit(screen.getByTestId('oper-desk-events-form'));
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'ADD', 'FLOOD');

    fireEvent.click(screen.getByTestId('oper-desk-category-unsubscribe'));
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'DEL', 'FLOOD');
  });

  it('refuses a smuggled control character instead of truncating it onto the wire', () => {
    const client = seed();
    render(() => <OperDesk />);

    // A single-line <input> is sanitized by the platform, which drops CR/LF —
    // so the reachable smuggling attempt is a non-newline control byte. The
    // CRLF refusal itself is pinned on the pure model (operDesk.test.ts).
    fireEvent.input(screen.getByTestId('oper-desk-broadcast-input'), {
      target: { value: 'ok\u0007bye' },
    });
    fireEvent.submit(screen.getByTestId('oper-desk-broadcast-form'));

    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(screen.queryByTestId('oper-desk-review')).toBeNull();
    expect(screen.getByTestId('oper-desk-errors')).toHaveTextContent(/line breaks or control/i);
  });

  it('never stages a second command line from a pasted newline', () => {
    seed();
    render(() => <OperDesk />);

    fireEvent.input(screen.getByTestId('oper-desk-broadcast-input'), {
      target: { value: 'notice\r\nKILL root :bye' },
    });
    fireEvent.submit(screen.getByTestId('oper-desk-broadcast-form'));

    // Value sanitization collapsed the paste to one line before it ever
    // reached the validator; whatever survives must still be a single line.
    const wire = screen.getByTestId('oper-desk-review-wire').textContent ?? '';
    expect(wire).not.toMatch(/[\r\n]/u);
    expect(wire.startsWith('EVENT BROADCAST :')).toBe(true);
  });

  it('requires a recorded reason before staging a disconnect', () => {
    const client = seed();
    render(() => <OperDesk />);

    fireEvent.input(screen.getByTestId('oper-desk-kill-nick'), { target: { value: 'flooder' } });
    fireEvent.submit(screen.getByTestId('oper-desk-kill-form'));
    expect(screen.queryByTestId('oper-desk-review')).toBeNull();
    expect(screen.getByTestId('oper-desk-errors')).toHaveTextContent(/reason is required/i);

    fireEvent.input(screen.getByTestId('oper-desk-kill-reason'), {
      target: { value: 'Repeat flooding' },
    });
    fireEvent.submit(screen.getByTestId('oper-desk-kill-form'));
    expect(client.sendRaw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('oper-desk-review-confirm'));
    expect(client.sendRaw).toHaveBeenCalledWith('KILL', 'flooder', 'Repeat flooding');
  });

  it('rejects an all-wildcard observe mask that would flood the session', () => {
    const client = seed();
    render(() => <OperDesk />);
    fireEvent.input(screen.getByTestId('oper-desk-mask'), { target: { value: '*!*@*' } });
    fireEvent.submit(screen.getByTestId('oper-desk-observe-form'));
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(screen.getByTestId('oper-desk-errors')).toBeInTheDocument();

    fireEvent.input(screen.getByTestId('oper-desk-mask'), { target: { value: 'ada!*@*.example' } });
    fireEvent.submit(screen.getByTestId('oper-desk-observe-form'));
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'OBSERVE', 'ada!*@*.example');
  });

  it('blocks every send while the socket is down', () => {
    const client = seed({ connectionStatus: 'reconnecting' });
    render(() => <OperDesk />);

    expect(screen.getByTestId('oper-desk-offline')).toBeInTheDocument();
    expect(screen.getByTestId('oper-desk-privs')).toBeDisabled();
    fireEvent.click(screen.getByTestId('oper-desk-privs'));
    fireEvent.submit(screen.getByTestId('oper-desk-events-form'));
    expect(client.sendRaw).not.toHaveBeenCalled();

    // Reconnecting re-enables the controls without a remount.
    store.setState({ connectionStatus: 'connected' });
    expect(screen.queryByTestId('oper-desk-offline')).toBeNull();
    fireEvent.click(screen.getByTestId('oper-desk-privs'));
    expect(client.sendRaw).toHaveBeenCalledWith('PRIVS');
  });

  it('keeps control/label relationships unique across concurrent desks', () => {
    seed();
    render(() => (
      <>
        <OperDesk />
        <OperDesk />
      </>
    ));

    const ids = screen.getAllByLabelText('Announce to operators').map((input) => input.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
