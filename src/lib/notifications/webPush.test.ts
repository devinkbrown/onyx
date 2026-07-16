// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store, type OnyxState, type Server } from '@/lib/store/store';
import { disableWebPush, enableWebPush, vapidKeyToBytes, webPushActive, webPushSupported } from './webPush';

const initialState = store.getInitialState();

function server(account: string): Server {
  return {
    id: 'local',
    name: 'Local',
    network: 'Orochi',
    url: 'wss://example.invalid',
    icon: '#000',
    nick: 'me',
    account,
    connected: true,
  };
}

function client(sendRaw = vi.fn()): NonNullable<OnyxState['client']> {
  return {
    isupport: { VAPID: 'AQID' },
    sendRaw,
  } as unknown as NonNullable<OnyxState['client']>;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pushSubscription(unsubscribe = vi.fn().mockResolvedValue(true)): PushSubscription {
  return {
    endpoint: 'https://push.example/sub',
    toJSON: () => ({
      endpoint: 'https://push.example/sub',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }),
    unsubscribe,
  } as unknown as PushSubscription;
}

function stubPushBrowser(
  requestPermission: () => Promise<NotificationPermission>,
  ready: Promise<{ pushManager: Pick<PushManager, 'getSubscription' | 'subscribe'> }>,
): void {
  vi.stubGlobal('PushManager', class PushManager {});
  vi.stubGlobal('Notification', { requestPermission });
  vi.stubGlobal('navigator', { serviceWorker: { ready } });
}

beforeEach(() => {
  store.setState(initialState, true);
});

afterEach(() => {
  store.setState(initialState, true);
  vi.unstubAllGlobals();
});

describe('vapidKeyToBytes', () => {
  it('decodes unpadded base64url VAPID keys into raw bytes', () => {
    // Arrange / Act
    const bytes = vapidKeyToBytes('AQID-_8');

    // Assert
    expect(Array.from(bytes)).toEqual([1, 2, 3, 251, 255]);
  });

  it('decodes padded standard-base64-compatible input', () => {
    // Arrange / Act
    const bytes = vapidKeyToBytes('SGVsbG8=');

    // Assert
    expect(new TextDecoder().decode(bytes)).toBe('Hello');
  });

  it('returns an empty byte array for an empty key', () => {
    // Arrange / Act
    const bytes = vapidKeyToBytes('');

    // Assert
    expect(bytes).toHaveLength(0);
  });

  it('throws for malformed base64url input instead of fabricating a key', () => {
    // Arrange / Act / Assert
    expect(() => vapidKeyToBytes('not valid ***')).toThrow();
  });
});

describe('webPushSupported', () => {
  it('returns false when no browser window exists', () => {
    // Arrange
    vi.stubGlobal('window', undefined);

    // Act / Assert
    expect(webPushSupported()).toBe(false);
  });

  it('requires service workers, PushManager, and Notification support', () => {
    // Arrange
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });

    // Act / Assert
    expect(webPushSupported()).toBe(false);

    // Arrange
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('window', { Notification: class Notification {} });

    // Act / Assert
    expect(webPushSupported()).toBe(false);

    // Arrange
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('window', { PushManager: class PushManager {} });

    // Act / Assert
    expect(webPushSupported()).toBe(false);
  });

  it('returns true only when every browser push capability is present', () => {
    // Arrange
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });

    // Act / Assert
    expect(webPushSupported()).toBe(true);
  });
});

describe('webPushActive', () => {
  it('returns false without touching service workers when push is unsupported', async () => {
    // Arrange
    const ready = Promise.resolve({
      pushManager: {
        getSubscription: vi.fn(),
      },
    });
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('navigator', { serviceWorker: { ready } });

    // Act
    const active = await webPushActive();

    // Assert
    expect(active).toBe(false);
  });

  it('returns true when a current subscription exists', async () => {
    // Arrange
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/sub' }),
          },
        }),
      },
    });

    // Act
    const active = await webPushActive();

    // Assert
    expect(active).toBe(true);
  });

  it('returns false for missing subscriptions and service-worker failures', async () => {
    // Arrange
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
          },
        }),
      },
    });

    // Act / Assert
    await expect(webPushActive()).resolves.toBe(false);

    // Arrange
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.reject(new Error('service worker unavailable')),
      },
    });

    // Act / Assert
    await expect(webPushActive()).resolves.toBe(false);
  });
});

describe('web push operations', () => {
  it('registers a complete subscription on the same account and client session', async () => {
    const sendRaw = vi.fn();
    const currentClient = client(sendRaw);
    const sub = pushSubscription();
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(sub),
          subscribe: vi.fn(),
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: currentClient,
    }, true);

    await expect(enableWebPush()).resolves.toEqual({ ok: true });
    expect(sendRaw).toHaveBeenCalledWith(
      'WEBPUSH',
      'SUBSCRIBE',
      'https://push.example/sub',
      'p256dh-key',
      'auth-key',
    );
  });

  it('rejects an enable completion after the account client changes', async () => {
    const permission = deferred<NotificationPermission>();
    const oldSendRaw = vi.fn();
    const newSendRaw = vi.fn();
    const oldClient = client(oldSendRaw);
    const newClient = client(newSendRaw);
    stubPushBrowser(
      () => permission.promise,
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn(),
          subscribe: vi.fn(),
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: oldClient,
    }, true);

    const result = enableWebPush();
    store.setState({ client: newClient });
    permission.resolve('granted');

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'Your account or connection changed. Try again.',
    });
    expect(oldSendRaw).not.toHaveBeenCalled();
    expect(newSendRaw).not.toHaveBeenCalled();
  });

  it('removes a newly-created local subscription when the session drifts', async () => {
    const subscribeResult = deferred<PushSubscription>();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscribe = vi.fn(() => subscribeResult.promise);
    const oldSendRaw = vi.fn();
    const oldClient = client(oldSendRaw);
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(null),
          subscribe,
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: oldClient,
    }, true);

    const result = enableWebPush();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    store.setState({ client: client() });
    subscribeResult.resolve(pushSubscription(unsubscribe));

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'Your account or connection changed. Try again.',
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(oldSendRaw).not.toHaveBeenCalled();
  });

  it('reports failure when the browser refuses to remove its subscription', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(false);
    const currentClient = client();
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(pushSubscription(unsubscribe)),
          subscribe: vi.fn(),
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: currentClient,
    }, true);

    await expect(disableWebPush()).resolves.toEqual({
      ok: false,
      reason: 'The browser could not remove its push subscription.',
    });
  });

  it('does not send unsubscribe through a replacement account session', async () => {
    const ready = deferred<{ pushManager: Pick<PushManager, 'getSubscription' | 'subscribe'> }>();
    const oldSendRaw = vi.fn();
    const newSendRaw = vi.fn();
    const oldClient = client(oldSendRaw);
    const unsubscribe = vi.fn().mockResolvedValue(true);
    stubPushBrowser(vi.fn().mockResolvedValue('granted'), ready.promise);
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: oldClient,
    }, true);

    const result = disableWebPush();
    store.setState({ server: server('bob'), client: client(newSendRaw) });
    ready.resolve({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(pushSubscription(unsubscribe)),
        subscribe: vi.fn(),
      },
    });

    await expect(result).resolves.toEqual({ ok: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(oldSendRaw).not.toHaveBeenCalled();
    expect(newSendRaw).not.toHaveBeenCalled();
  });
});
