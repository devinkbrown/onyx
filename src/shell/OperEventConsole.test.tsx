// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { store } from '@/lib/store';
import { emptyEventReplayFeed } from '@/lib/irc/eventReplayJson';
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

  it('offers EVENT REPLAY JSON and sends when connected', () => {
    const sendRaw = vi.fn();
    store.setState({
      isOper: true,
      connectionStatus: 'connected',
      client: { sendRaw } as never,
      serviceNotices: [],
      operEventReplay: emptyEventReplayFeed(),
    });
    render(() => <OperEventConsole />);
    const btn = screen.getByTestId('oper-event-replay');
    expect(btn).toHaveTextContent('Refresh events');
    expect(btn).not.toBeDisabled();
    btn.click();
    expect(sendRaw).toHaveBeenCalledWith('EVENT', 'REPLAY', 'JSON', 'ALL', '50');
    expect(screen.getByTestId('oper-event-replay-status')).toHaveTextContent(/EVENT REPLAY JSON ALL 50/);
    expect(screen.getByTestId('oper-event-replay-wire')).toHaveTextContent('EVENT REPLAY JSON ALL 50');
  });

  it('renders structured JSON feed rows from store', () => {
    store.setState({
      isOper: true,
      serviceNotices: [],
      operEventReplay: {
        pending: false,
        severityFloor: 'debug',
        expectedCount: 1,
        complete: true,
        receivedAt: Date.now(),
        events: [
          {
            ts: 1_720_000_000_000,
            category: 'kill',
            categoryCode: 'KILL',
            severity: 'warn',
            origin: 'node-a',
            message: 'killed badactor',
          },
        ],
      },
    });
    render(() => <OperEventConsole />);
    expect(screen.getByTestId('oper-event-json-list')).toBeInTheDocument();
    expect(screen.getByTestId('oper-event-json-cat')).toHaveTextContent('KILL');
    expect(screen.getByTestId('oper-event-json-sev')).toHaveTextContent('warn');
    expect(screen.getByTestId('oper-event-json-text')).toHaveTextContent(/killed badactor/);
  });

  it('filters the structured feed locally without sending another command', () => {
    const sendRaw = vi.fn();
    store.setState({
      isOper: true,
      connectionStatus: 'connected',
      client: { sendRaw } as never,
      serviceNotices: [],
      operEventReplay: {
        pending: false,
        severityFloor: 'debug',
        expectedCount: 2,
        complete: true,
        receivedAt: Date.now(),
        events: [
          {
            ts: 1_720_000_000_000,
            category: 'kill',
            categoryCode: 'KILL',
            severity: 'warn',
            origin: 'node-a',
            message: 'killed badactor',
          },
          {
            ts: 1_720_000_000_100,
            category: 'mesh',
            categoryCode: 'MESH',
            severity: 'info',
            origin: 'node-b',
            message: 'peer up',
          },
        ],
      },
    });
    render(() => <OperEventConsole />);
    sendRaw.mockClear();
    fireEvent.change(screen.getByTestId('oper-event-filter-category'), { target: { value: 'MESH' } });
    expect(screen.getAllByTestId('oper-event-json-row')).toHaveLength(1);
    expect(screen.getByTestId('oper-event-json-cat')).toHaveTextContent('MESH');
    fireEvent.input(screen.getByTestId('oper-event-filter-text'), { target: { value: 'missing-text' } });
    expect(screen.getByTestId('oper-event-filter-empty')).toBeInTheDocument();
    expect(sendRaw).not.toHaveBeenCalled();
  });
});
