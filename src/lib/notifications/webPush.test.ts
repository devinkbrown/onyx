// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import { store, type OnyxState, type Server } from '@/lib/store/store';
import {
  disableWebPush,
  enableWebPush,
  vapidKeyToBytes,
  WEB_PUSH_OWNER_STORAGE_KEY,
  webPushActive,
  webPushSupported,
} from './webPush';

const initialState = store.getInitialState();

/** Uncompressed P-256 point (0x04 ‖ 64 zero bytes) as unpadded base64url — valid shape only. */
const VALID_VAPID_KEY = btoa(String.fromCharCode(4, ...new Uint8Array(64)))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/u, '');

function server(account: string): Server {
  return {
    id: 'local',
    name: 'Local',
    network: 'Onyx',
    url: 'wss://example.invalid',
    icon: '#000',
    nick: 'me',
    account,
    connected: true,
  };
}

function client(
  sendRaw: ReturnType<typeof vi.fn> = vi.fn().mockReturnValue(true),
  vapid = VALID_VAPID_KEY,
): NonNullable<OnyxState['client']> {
  return {
    isupport: { VAPID: vapid },
    sendRaw,
  } as unknown as NonNullable<OnyxState['client']>;
}

function ownerKey(account: string): string {
  const key = deviceMemoryOwnerKey({ serverUrl: server(account).url, identity: account });
  if (!key) throw new Error('Expected a valid web push owner key');
  return key;
}

function markOwner(account: string): void {
  localStorage.setItem(WEB_PUSH_OWNER_STORAGE_KEY, ownerKey(account));
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
  localStorage.clear();
  store.setState(initialState, true);
});

afterEach(() => {
  localStorage.clear();
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

  it('returns true only when the current owner marked the subscription', async () => {
    // Arrange
    const unsubscribe = vi.fn().mockResolvedValue(true);
    store.setState({ server: server('alice') });
    markOwner('alice');
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(pushSubscription(unsubscribe)),
          },
        }),
      },
    });

    // Act
    const active = await webPushActive();

    // Assert
    expect(active).toBe(true);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('retires a subscription marked for another account', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    store.setState({ server: server('alice') });
    markOwner('bob');
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          getNotifications: vi.fn().mockResolvedValue([{ close }]),
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(pushSubscription(unsubscribe)),
          },
        }),
      },
    });

    await expect(webPushActive()).resolves.toBe(false);

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();
  });

  it('does not retire foreign push resources after the app owner changes during notification lookup', async () => {
    const notifications = deferred<Array<{ close: () => void }>>();
    const getNotifications = vi.fn(() => notifications.promise);
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    store.setState({ server: server('alice') });
    markOwner('bob');
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          getNotifications,
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(pushSubscription(unsubscribe)),
          },
        }),
      },
    });

    const active = webPushActive();
    await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledOnce());
    store.setState({ server: server('carol') });
    markOwner('carol');
    notifications.resolve([{ close }]);

    await expect(active).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('carol'));
  });

  it('closes prior-owner notifications when the subscription is already gone', async () => {
    const close = vi.fn();
    store.setState({ server: server('alice') });
    markOwner('bob');
    vi.stubGlobal('window', { PushManager: class PushManager {}, Notification: class Notification {} });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          getNotifications: vi.fn().mockResolvedValue([{ close }]),
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
          },
        }),
      },
    });

    await expect(webPushActive()).resolves.toBe(false);

    expect(close).toHaveBeenCalledOnce();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();
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
    markOwner('alice');

    // Act / Assert
    await expect(webPushActive()).resolves.toBe(false);
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();

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
  it('uses the VAPID key advertised by the current connection through ISUPPORT', async () => {
    const sendRaw = vi.fn().mockReturnValue(true);
    const currentClient = client(sendRaw);
    const subscribe = vi.fn().mockResolvedValue(pushSubscription());
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
      client: currentClient,
      // A prior connection's generic registry must not replace the current
      // IRCClient's directly parsed 005 value.
      serverFeatures: new Map([['VAPID', 'stale-key']]),
    }, true);

    await expect(enableWebPush()).resolves.toEqual({ ok: true });

    const applicationServerKey = subscribe.mock.calls[0]?.[0]?.applicationServerKey as ArrayBuffer;
    expect(Array.from(new Uint8Array(applicationServerKey))).toEqual([4, ...new Uint8Array(64)]);
    expect(sendRaw).toHaveBeenCalledWith(
      'WEBPUSH',
      'SUBSCRIBE',
      'https://push.example/sub',
      'p256dh-key',
      'auth-key',
    );
  });

  it('fails closed on a non-P-256 VAPID ISUPPORT value before prompting', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    const subscribe = vi.fn();
    stubPushBrowser(
      requestPermission,
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn(),
          subscribe,
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      // Decodes, but is not an uncompressed P-256 point.
      client: client(vi.fn().mockReturnValue(true), 'AQID'),
      serverFeatures: new Map([['VAPID', VALID_VAPID_KEY]]),
    }, true);

    await expect(enableWebPush()).resolves.toEqual({
      ok: false,
      reason: 'Push is misconfigured on this server.',
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('does not prompt or touch the service worker while disconnected', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    const getSubscription = vi.fn();
    const subscribe = vi.fn();
    stubPushBrowser(
      requestPermission,
      Promise.resolve({ pushManager: { getSubscription, subscribe } }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'disconnected',
      client: client(),
    }, true);

    await expect(enableWebPush()).resolves.toEqual({ ok: false, reason: 'Reconnect first.' });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();
  });

  it('registers a complete subscription on the same account and client session', async () => {
    const sendRaw = vi.fn().mockReturnValue(true);
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
    markOwner('alice');

    await expect(enableWebPush()).resolves.toEqual({ ok: true });
    expect(sendRaw).toHaveBeenCalledWith(
      'WEBPUSH',
      'SUBSCRIBE',
      'https://push.example/sub',
      'p256dh-key',
      'auth-key',
    );
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('alice'));
  });

  it('retires a foreign endpoint before subscribing the current account', async () => {
    const oldUnsubscribe = vi.fn().mockResolvedValue(true);
    const oldSub = pushSubscription(oldUnsubscribe);
    const newSub = pushSubscription();
    const subscribe = vi.fn().mockResolvedValue(newSub);
    const sendRaw = vi.fn().mockReturnValue(true);
    const close = vi.fn();
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        getNotifications: vi.fn().mockResolvedValue([{ close }]),
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(oldSub),
          subscribe,
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: client(sendRaw),
    }, true);
    markOwner('bob');

    await expect(enableWebPush()).resolves.toEqual({ ok: true });

    expect(oldUnsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(sendRaw).toHaveBeenCalledWith(
      'WEBPUSH',
      'SUBSCRIBE',
      'https://push.example/sub',
      'p256dh-key',
      'auth-key',
    );
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('alice'));
  });

  it('does not retire foreign push resources after the enabling owner changes during notification lookup', async () => {
    const notifications = deferred<Array<{ close: () => void }>>();
    const getNotifications = vi.fn(() => notifications.promise);
    const oldUnsubscribe = vi.fn().mockResolvedValue(true);
    const oldSub = pushSubscription(oldUnsubscribe);
    const subscribe = vi.fn();
    const oldSendRaw = vi.fn();
    const newSendRaw = vi.fn();
    const close = vi.fn();
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        getNotifications,
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(oldSub),
          subscribe,
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: client(oldSendRaw),
    }, true);
    markOwner('bob');

    const result = enableWebPush();
    await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledOnce());
    store.setState({ server: server('carol'), client: client(newSendRaw) });
    markOwner('carol');
    notifications.resolve([{ close }]);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'Your account or connection changed. Try again.',
    });
    expect(close).not.toHaveBeenCalled();
    expect(oldUnsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(oldSendRaw).not.toHaveBeenCalled();
    expect(newSendRaw).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('carol'));
  });

  it('refuses an incomplete subscription and retires it locally', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const sendRaw = vi.fn().mockReturnValue(true);
    const incomplete = {
      endpoint: 'https://push.example/sub',
      toJSON: () => ({ endpoint: 'https://push.example/sub', keys: {} }),
      unsubscribe,
    } as unknown as PushSubscription;
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(incomplete),
          subscribe: vi.fn(),
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: client(sendRaw),
    }, true);
    markOwner('alice');

    await expect(enableWebPush()).resolves.toEqual({
      ok: false,
      reason: 'The browser returned an incomplete subscription.',
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(sendRaw).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();
  });

  it('does not claim success when WEBPUSH SUBSCRIBE cannot be sent', async () => {
    const sendRaw = vi.fn().mockReturnValue(false);
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscribe = vi.fn().mockResolvedValue(pushSubscription(unsubscribe));
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
      client: client(sendRaw),
    }, true);

    await expect(enableWebPush()).resolves.toEqual({
      ok: false,
      reason: 'The connection closed before push could be registered. Reconnect and try again.',
    });
    expect(sendRaw).toHaveBeenCalledWith(
      'WEBPUSH',
      'SUBSCRIBE',
      'https://push.example/sub',
      'p256dh-key',
      'auth-key',
    );
    // Newly-created local sub is discarded; owner mark is not left dangling.
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();
  });

  it('refuses a malformed ISUPPORT VAPID key before requesting a subscription', async () => {
    const sendRaw = vi.fn().mockReturnValue(true);
    const requestPermission = vi.fn().mockResolvedValue('granted');
    const subscribe = vi.fn();
    stubPushBrowser(
      requestPermission,
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn(),
          subscribe,
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: client(sendRaw, 'not valid ***'),
    }, true);

    await expect(enableWebPush()).resolves.toEqual({
      ok: false,
      reason: 'Push is misconfigured on this server.',
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('subscribes with the raw ISUPPORT VAPID bytes (no key round-trip)', async () => {
    const sendRaw = vi.fn().mockReturnValue(true);
    const subscribe = vi.fn().mockResolvedValue(pushSubscription());
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
      client: client(sendRaw, VALID_VAPID_KEY),
    }, true);

    await expect(enableWebPush()).resolves.toEqual({ ok: true });
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(ArrayBuffer),
    });
    const keyArg = subscribe.mock.calls[0]?.[0]?.applicationServerKey as ArrayBuffer;
    expect(Array.from(new Uint8Array(keyArg))).toEqual([4, ...new Uint8Array(64)]);
    expect(sendRaw).toHaveBeenCalledWith(
      'WEBPUSH',
      'SUBSCRIBE',
      'https://push.example/sub',
      'p256dh-key',
      'auth-key',
    );
  });

  it('refuses to cross-register an endpoint when foreign retirement fails', async () => {
    const oldUnsubscribe = vi.fn().mockResolvedValue(false);
    const subscribe = vi.fn();
    const sendRaw = vi.fn().mockReturnValue(true);
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(pushSubscription(oldUnsubscribe)),
          subscribe,
        },
      }),
    );
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: client(sendRaw),
    }, true);
    markOwner('bob');

    await expect(enableWebPush()).resolves.toEqual({
      ok: false,
      reason: 'This browser could not retire another account\'s push subscription.',
    });
    expect(subscribe).not.toHaveBeenCalled();
    expect(sendRaw).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('bob'));
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

  it('unregisters only the current owner endpoint after local retirement', async () => {
    const sendRaw = vi.fn();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const currentClient = client(sendRaw);
    const close = vi.fn();
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        getNotifications: vi.fn().mockResolvedValue([{ close }]),
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
    markOwner('alice');

    await expect(disableWebPush()).resolves.toEqual({ ok: true });

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(sendRaw).toHaveBeenCalledWith('WEBPUSH', 'UNSUBSCRIBE', 'https://push.example/sub');
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBeNull();
  });

  it('does not retire a replacement account subscription after service-worker readiness settles', async () => {
    const ready = deferred<{
      getNotifications: () => Promise<Array<{ close: () => void }>>;
      pushManager: Pick<PushManager, 'getSubscription' | 'subscribe'>;
    }>();
    const oldSendRaw = vi.fn();
    const newSendRaw = vi.fn();
    const oldClient = client(oldSendRaw);
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    stubPushBrowser(vi.fn().mockResolvedValue('granted'), ready.promise);
    store.setState({
      ...initialState,
      server: server('alice'),
      connectionStatus: 'connected',
      client: oldClient,
    }, true);
    markOwner('alice');

    const result = disableWebPush();
    store.setState({ server: server('bob'), client: client(newSendRaw) });
    markOwner('bob');
    ready.resolve({
      getNotifications: vi.fn().mockResolvedValue([{ close }]),
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(pushSubscription(unsubscribe)),
        subscribe: vi.fn(),
      },
    });

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'Your account or connection changed. Try again.',
    });
    expect(close).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(oldSendRaw).not.toHaveBeenCalled();
    expect(newSendRaw).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('bob'));
  });

  it('does not close or unsubscribe replacement resources after the owner changes during notification lookup', async () => {
    const notifications = deferred<Array<{ close: () => void }>>();
    const getNotifications = vi.fn(() => notifications.promise);
    const oldSendRaw = vi.fn();
    const newSendRaw = vi.fn();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    stubPushBrowser(
      vi.fn().mockResolvedValue('granted'),
      Promise.resolve({
        getNotifications,
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
      client: client(oldSendRaw),
    }, true);
    markOwner('alice');

    const result = disableWebPush();
    await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledOnce());
    store.setState({ server: server('bob'), client: client(newSendRaw) });
    markOwner('bob');
    notifications.resolve([{ close }]);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'Your account or connection changed. Try again.',
    });
    expect(close).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(oldSendRaw).not.toHaveBeenCalled();
    expect(newSendRaw).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY)).toBe(ownerKey('bob'));
  });
});
