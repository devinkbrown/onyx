import { afterEach, describe, expect, it, vi } from 'vitest';

import { pwaReadiness } from './readiness';

describe('PWA readiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('reports installed service-worker controlled app readiness', () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: {} },
    });
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));

    expect(pwaReadiness()).toEqual([
      expect.objectContaining({ key: 'window', state: 'ready' }),
      expect.objectContaining({ key: 'worker', state: 'ready' }),
      expect.objectContaining({ key: 'notifications', state: 'ready' }),
      expect.objectContaining({ key: 'storage', state: 'ready' }),
    ]);
  });

  it('reports browser-tab and blocked-permission attention states', () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: null },
    });
    vi.stubGlobal('Notification', { permission: 'denied' });
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));

    const readiness = pwaReadiness();

    expect(readiness).toContainEqual(expect.objectContaining({ key: 'window', state: 'attention' }));
    expect(readiness).toContainEqual(expect.objectContaining({ key: 'worker', state: 'attention' }));
    expect(readiness).toContainEqual(expect.objectContaining({ key: 'notifications', state: 'unavailable' }));
    expect(readiness).toContainEqual(expect.objectContaining({ key: 'storage', state: 'ready' }));
  });
});
