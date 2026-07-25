// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { store } from '@/lib/store';
import { OperEventConsole } from './OperEventConsole';

const initial = store.getInitialState();

beforeEach(() => {
  store.setState(initial, true);
});

afterEach(() => {
  cleanup();
  store.setState(initial, true);
});

describe('OperEventConsole', () => {
  it('hides for non-opers', () => {
    store.setState({ isOper: false });
    render(() => <OperEventConsole />);
    expect(screen.queryByTestId('oper-event-console')).not.toBeInTheDocument();
  });

  it('lists spine-tagged notices for opers', () => {
    store.setState({
      isOper: true,
      serviceNotices: [
        { source: 'Server', text: 'WEBPUSH: alice subscribed a push endpoint', time: new Date() },
        { source: 'Account', text: 'unrelated chatter', time: new Date() },
        { source: 'Oper', text: 'MESH peer up', time: new Date() },
      ],
    });
    render(() => <OperEventConsole />);
    expect(screen.getByTestId('oper-event-console')).toBeInTheDocument();
    expect(screen.getAllByTestId('oper-event-row').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/WEBPUSH/)).toBeInTheDocument();
  });

  it('offers EVENT REPLAY and sends when connected', () => {
    const sendRaw = vi.fn();
    store.setState({
      isOper: true,
      connectionStatus: 'connected',
      client: { sendRaw } as never,
      serviceNotices: [],
    });
    render(() => <OperEventConsole />);
    const btn = screen.getByTestId('oper-event-replay');
    expect(btn).not.toBeDisabled();
    btn.click();
    expect(sendRaw).toHaveBeenCalledWith('EVENT', 'REPLAY', '50');
    expect(screen.getByTestId('oper-event-replay-status')).toHaveTextContent(/EVENT REPLAY 50/);
  });
});
