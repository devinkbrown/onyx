import { afterEach, describe, expect, it, vi } from 'vitest';

import { vapidKeyToBytes, webPushActive, webPushSupported } from './webPush';

afterEach(() => {
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
