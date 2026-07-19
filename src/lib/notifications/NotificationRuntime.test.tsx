// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { setCalmPreset } from './calmMode';
import { showDesktopNotification } from './browser';
import { NotificationRuntime } from './NotificationRuntime';

const previewMocks = vi.hoisted(() => ({ clear: vi.fn() }));

vi.mock('./browser', () => ({
  getDesktopNotificationPermission: vi.fn(() => 'granted'),
  playNotificationBeep: vi.fn(),
  showDesktopNotification: vi.fn(),
}));

vi.mock('@/lib/preview/linkPreview', () => ({
  clearLinkPreviewCache: previewMocks.clear,
}));

const initialState = store.getInitialState();
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

function server(account: string) {
  return {
    id: `notification-${account}`,
    name: 'Onyx',
    network: 'Onyx',
    url: 'wss://notifications.example/ws',
    icon: '',
    nick: account,
    account,
    connected: true,
  };
}

function addMention(id: number): string {
  store.getState().addNotification({
    type: 'mention',
    text: `message ${id}`,
    from: 'alice',
    channel: '#room',
  });
  const note = store.getState().notifications.at(-1);
  if (!note) throw new Error('Expected mention notification to be stored');
  return note.id;
}

function addFollow(topic?: string | null): void {
  store.getState().addNotification({
    type: 'follow',
    text: 'followed activity',
    from: 'alice',
    channel: '#room',
    topic,
  });
}

function addDirectMessage(text: string): void {
  store.getState().addNotification({
    type: 'dm',
    text,
    from: 'alice',
  });
}

function setEncryptedDirectMessage(plaintext: string): void {
  store.setState({
    dms: new Map([['alice', {
      nick: 'alice',
      account: 'alice',
      unread: 1,
      highlights: 1,
      messages: [{
        id: 'encrypted-dm',
        time: new Date(),
        from: 'alice',
        text: 'TSUMUGI1 ciphertext stays private',
        type: 'msg',
        target: 'me',
        encrypted: true,
        plaintext,
      }],
    }]]),
  });
}

function clickDesktopNotification(): void {
  const payload = vi.mocked(showDesktopNotification).mock.calls[0]?.[0];
  expect(payload).toBeDefined();
  payload?.onClick();
}

describe('NotificationRuntime coalesced policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    vi.mocked(showDesktopNotification).mockReset();
    previewMocks.clear.mockReset();
    setCalmPreset('regular');
    store.setState({
      ...initialState,
      notifications: [],
      ourNick: 'me',
      server: server('me'),
      pushNotificationsEnabled: true,
      soundEnabled: false,
      dndEnabled: false,
      dndUntil: null,
      isDndActive: () => false,
    }, true);
    setVisibility('hidden');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    setCalmPreset('regular');
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    else Reflect.deleteProperty(document, 'visibilityState');
  });

  it('drops a throttled alert when DND is enabled before its timer fires', () => {
    render(() => <NotificationRuntime />);
    addMention(1);
    addMention(2);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    store.setState({ dndEnabled: true });
    vi.advanceTimersByTime(6000);

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  });

  it('drops a throttled alert when the app regains focus before its timer fires', () => {
    render(() => <NotificationRuntime />);
    addMention(1);
    addMention(2);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    vi.mocked(document.hasFocus).mockReturnValue(true);
    vi.advanceTimersByTime(6000);

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  });

  it('drops a throttled alert that is dismissed before its timer fires', () => {
    render(() => <NotificationRuntime />);
    addMention(1);
    const pendingId = addMention(2);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    store.getState().dismissNotification(pendingId);
    vi.advanceTimersByTime(6000);

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  });

  it('drops a throttled alert when the inbox is marked read before its timer fires', () => {
    render(() => <NotificationRuntime />);
    addMention(1);
    addMention(2);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    store.getState().markAllNotificationsRead();
    vi.advanceTimersByTime(6000);

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  });

  it('cancels old-owner alerts and clears target throttles on an account switch', () => {
    render(() => <NotificationRuntime />);
    addMention(1);
    addMention(2);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    store.setState({ ourNick: 'other', server: server('other') });
    expect(previewMocks.clear).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(6000);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    // The same room under the new owner is not throttled by the old account.
    addMention(3);
    expect(showDesktopNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(showDesktopNotification).mock.calls[1]?.[0].body).toBe('message 3');
  });

  it('closes an active old-owner alert and rejects its stale click target', () => {
    const close = vi.fn();
    const openChannelConversation = vi.fn();
    vi.mocked(showDesktopNotification).mockReturnValue({ close });
    store.setState({ openChannelConversation });
    render(() => <NotificationRuntime />);

    addMention(1);
    const stalePayload = vi.mocked(showDesktopNotification).mock.calls[0]?.[0];
    expect(stalePayload).toBeDefined();

    store.setState({ ourNick: 'other', server: server('other') });

    expect(close).toHaveBeenCalledOnce();
    stalePayload?.onClick();
    expect(openChannelConversation).not.toHaveBeenCalled();
  });

  it('closes active desktop alerts when the runtime unmounts', () => {
    const close = vi.fn();
    vi.mocked(showDesktopNotification).mockReturnValue({ close });
    const view = render(() => <NotificationRuntime />);

    addMention(1);
    view.unmount();

    expect(close).toHaveBeenCalledOnce();
  });

  it('derives a coalesced alert count and body from the remaining unread rows', () => {
    render(() => <NotificationRuntime />);
    addMention(1);
    addMention(2);
    const dismissedId = addMention(3);
    addMention(4);
    store.getState().dismissNotification(dismissedId);

    vi.advanceTimersByTime(6000);

    expect(showDesktopNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(showDesktopNotification).mock.calls[1]?.[0]).toMatchObject({
      title: '2 new alerts in #room',
      body: 'message 4',
    });
  });

  it('restores a valid followed-topic context before opening its channel', () => {
    const openChannelConversation = vi.fn();
    store.setState({ openChannelConversation });
    render(() => <NotificationRuntime />);

    addFollow('release train');
    clickDesktopNotification();

    expect(openChannelConversation).toHaveBeenCalledWith('#room', 'release train');
  });

  it.each([null, 'bad,topic', ' \n '])(
    'does not change topic context for a room-level or invalid followed topic (%s)',
    (topic) => {
      const openChannelConversation = vi.fn();
      store.setState({ openChannelConversation });
      render(() => <NotificationRuntime />);

      addFollow(topic);
      clickDesktopNotification();

      expect(openChannelConversation).toHaveBeenCalledWith('#room', topic?.trim() || null);
    },
  );

  it('does not apply topic context when activating a mention notification', () => {
    const openChannelConversation = vi.fn();
    store.setState({ openChannelConversation });
    render(() => <NotificationRuntime />);

    store.getState().addNotification({
      type: 'mention',
      text: 'mentioned activity',
      from: 'alice',
      channel: '#room',
      topic: 'release train',
    });
    clickDesktopNotification();

    expect(openChannelConversation).toHaveBeenCalledWith('#room', null);
  });

  it('fail-closes an E2EE envelope in a DM alert body (never surfaces ciphertext)', () => {
    render(() => <NotificationRuntime />);

    store.getState().addNotification({
      type: 'dm',
      text: 'TSUMUGI1 opaque-ciphertext-blob-must-not-leak',
      from: 'alice',
    });

    expect(showDesktopNotification).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(showDesktopNotification).mock.calls[0]?.[0];
    expect(payload?.title).toBe('Direct message from alice');
    expect(payload?.body).toBe('New encrypted message');
    expect(payload?.body).not.toContain('TSUMUGI1');
    expect(payload?.body).not.toContain('ciphertext');
  });

  it('never exposes a decrypted E2EE DM in the desktop notification body', () => {
    const secret = 'private launch coordinates';
    setEncryptedDirectMessage(secret);
    render(() => <NotificationRuntime />);

    addDirectMessage(secret);

    const payload = vi.mocked(showDesktopNotification).mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      title: 'Direct message from alice',
      body: 'New encrypted message',
    });
    expect(JSON.stringify(payload)).not.toContain(secret);
  });

  it('keeps an E2EE body private after a coalesced alert loses its message row', () => {
    render(() => <NotificationRuntime />);
    addDirectMessage('ordinary first message');
    const secret = 'private delayed coordinates';
    setEncryptedDirectMessage(secret);
    addDirectMessage(secret);
    expect(showDesktopNotification).toHaveBeenCalledTimes(1);

    store.setState({ dms: new Map() });
    vi.advanceTimersByTime(6000);

    expect(showDesktopNotification).toHaveBeenCalledTimes(2);
    const payload = vi.mocked(showDesktopNotification).mock.calls[1]?.[0];
    expect(payload?.body).toBe('New encrypted message');
    expect(JSON.stringify(payload)).not.toContain(secret);
  });

  it('keeps plaintext DM bodies visible when no encrypted message boundary exists', () => {
    render(() => <NotificationRuntime />);

    addDirectMessage('ordinary direct message');

    expect(vi.mocked(showDesktopNotification).mock.calls[0]?.[0].body).toBe(
      'ordinary direct message',
    );
  });
});
