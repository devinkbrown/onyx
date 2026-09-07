// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadPersonReportReceipts } from '@/lib/people/personReportReceipt';
import { store, type Server } from '@/lib/store/store';
import { PersonSafetyHost } from './PersonSafetySheet';
import {
  closePersonSafety,
  openPersonBlockConfirm,
  openPersonReport,
} from './personSafetyState';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://people-safety.test/ws', identity: 'alice' } as const;
const server: Server = {
  id: 'people-safety',
  name: 'Harbor',
  network: 'Harbor',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

describe('PersonSafetyHost', () => {
  const sendRaw = vi.fn(() => true);
  const join = vi.fn(() => true);

  beforeEach(() => {
    closePersonSafety();
    localStorage.clear();
    sendRaw.mockClear();
    join.mockClear();
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      client: { sendRaw, join, isupport: { CHANTYPES: '#&' }, negotiatedCaps: new Set() } as never,
      server,
      ourNick: owner.identity,
      ignoredUsers: new Set(),
      addToast: vi.fn(),
    }, true);
  });

  afterEach(() => {
    cleanup();
    closePersonSafety();
    store.setState(initialState, true);
  });

  it('confirms block with Fraunces-once copy and reuses ignore', () => {
    openPersonBlockConfirm('bob');
    render(() => <PersonSafetyHost />);

    expect(screen.getByRole('heading', { name: 'Block bob?' })).toBeInTheDocument();
    expect(screen.getByText('You will not see bob on this device. They are not told.')).toBeInTheDocument();
    expect(store.getState().ignoredUsers.has('bob')).toBe(false);

    fireEvent.click(screen.getByTestId('person-block-confirm'));
    expect(store.getState().ignoredUsers.has('bob')).toBe(true);
    expect(screen.queryByTestId('person-safety')).toBeNull();
  });

  it('drafts a report to the shared #root room without claiming a private inbox', () => {
    const sendMessage = vi.spyOn(store.getState(), 'sendMessage');
    openPersonReport('eve', true);
    render(() => <PersonSafetyHost />);

    expect(screen.getByRole('heading', { name: 'Report eve' })).toBeInTheDocument();
    expect(screen.getByText(/shared #root report room/)).toBeInTheDocument();
    expect(screen.getByText(/visible to people in that room or operators/)).toBeInTheDocument();
    expect(screen.getByText(/not a private inbox or police report/)).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/24 hours|Trust & Safety|we will review/i);

    fireEvent.click(screen.getByLabelText('Spam'));
    fireEvent.input(screen.getByTestId('person-report-note'), {
      target: { value: 'posted links in #lounge' },
    });
    fireEvent.click(screen.getByTestId('person-report-submit'));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(join).toHaveBeenCalledWith('#root', undefined);
    expect(store.getState().getComposerDraft('#root')).toContain('About: eve');
    expect(store.getState().getComposerDraft('#root')).toContain('What: spam');
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
    expect(loadPersonReportReceipts(owner)[0]?.nick).toBe('eve');
    sendMessage.mockRestore();
  });

  it('preserves an existing report-room draft when adding the new draft', () => {
    const existing = 'unfinished report\nplease keep this exactly';
    store.setState({ composerDrafts: { '#root': existing } });
    openPersonReport('eve');
    render(() => <PersonSafetyHost />);

    fireEvent.click(screen.getByTestId('person-report-submit'));

    const merged = store.getState().getComposerDraft('#root');
    expect(merged.startsWith(existing)).toBe(true);
    expect(merged).toContain('Report\nAbout: eve\nWhat: harassment');
    expect(merged.slice(0, existing.length)).toBe(existing);
  });

  it('uses only the report draft when the report room composer is empty', () => {
    openPersonReport('eve');
    render(() => <PersonSafetyHost />);

    fireEvent.click(screen.getByTestId('person-report-submit'));

    expect(store.getState().getComposerDraft('#root')).toBe(
      'Report\nAbout: eve\nWhat: harassment\nFrom: alice',
    );
  });

  it('cancels without mutating an existing report-room draft', () => {
    const existing = 'keep this draft';
    store.setState({ composerDrafts: { '#root': existing } });
    openPersonReport('eve');
    render(() => <PersonSafetyHost />);

    fireEvent.click(screen.getByTestId('person-safety-cancel'));

    expect(store.getState().getComposerDraft('#root')).toBe(existing);
    expect(store.getState().activeView).not.toEqual({ kind: 'channel', channel: '#root' });
  });

  it('Never mind dismisses block without ignoring', () => {
    openPersonBlockConfirm('bob');
    render(() => <PersonSafetyHost />);
    fireEvent.click(screen.getByTestId('person-safety-cancel'));
    expect(store.getState().ignoredUsers.has('bob')).toBe(false);
    expect(screen.queryByTestId('person-safety')).toBeNull();
  });
});
