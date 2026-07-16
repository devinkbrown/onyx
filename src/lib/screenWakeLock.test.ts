// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  createScreenWakeLockController,
  type ScreenWakeLockManager,
  type ScreenWakeLockSentinel,
} from './screenWakeLock';

class FakeVisibilityDocument {
  visibilityState: DocumentVisibilityState = 'visible';
  private readonly listeners = new Set<() => void>();

  addEventListener(type: 'visibilitychange', listener: () => void): void {
    if (type === 'visibilitychange') this.listeners.add(listener);
  }

  removeEventListener(type: 'visibilitychange', listener: () => void): void {
    if (type === 'visibilitychange') this.listeners.delete(listener);
  }

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeSentinel implements ScreenWakeLockSentinel {
  released = false;
  private readonly listeners = new Set<() => void>();
  readonly release = vi.fn(async () => {
    this.released = true;
  });

  addEventListener(type: 'release', listener: () => void): void {
    if (type === 'release') this.listeners.add(listener);
  }

  removeEventListener(type: 'release', listener: () => void): void {
    if (type === 'release') this.listeners.delete(listener);
  }

  emitBrowserRelease(): void {
    this.released = true;
    for (const listener of [...this.listeners]) listener();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

describe('createScreenWakeLockController', () => {
  it('does not request on creation or while inactive, then acquires only when active', async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const sentinel = new FakeSentinel();
    const request = vi.fn(async () => sentinel);
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request },
    });

    expect(request).not.toHaveBeenCalled();
    controller.setActive(false);
    expect(request).not.toHaveBeenCalled();

    controller.setActive(true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('releases on call end and removes the visibility listener on disposal', async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const sentinel = new FakeSentinel();
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request: vi.fn(async () => sentinel) },
    });

    controller.setActive(true);
    await vi.waitFor(() => expect(visibilityDocument.listenerCount()).toBe(1));
    await Promise.resolve();
    controller.setActive(false);
    await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalledOnce());

    controller.dispose();
    controller.dispose();
    expect(visibilityDocument.listenerCount()).toBe(0);
    expect(sentinel.release).toHaveBeenCalledOnce();
  });

  it('releases while hidden and reacquires once when visibility returns', async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const first = new FakeSentinel();
    const second = new FakeSentinel();
    const request = vi.fn<ScreenWakeLockManager['request']>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request },
    });

    controller.setActive(true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    visibilityDocument.setVisibility('hidden');
    await vi.waitFor(() => expect(first.release).toHaveBeenCalledOnce());

    visibilityDocument.setVisibility('visible');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(second.release).not.toHaveBeenCalled();
  });

  it('does not loop after a browser release and retries at a later visibility return', async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const first = new FakeSentinel();
    const second = new FakeSentinel();
    const request = vi.fn<ScreenWakeLockManager['request']>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request },
    });

    controller.setActive(true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    first.emitBrowserRelease();
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();

    visibilityDocument.setVisibility('hidden');
    visibilityDocument.setVisibility('visible');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('treats denial as a silent fallback without retrying until a safe boundary', async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const recovered = new FakeSentinel();
    const request = vi.fn<ScreenWakeLockManager['request']>()
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(recovered);
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request },
    });

    controller.setActive(true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();

    visibilityDocument.setVisibility('hidden');
    visibilityDocument.setVisibility('visible');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(recovered.release).not.toHaveBeenCalled();
  });

  it('releases a request that resolves after call end and can acquire for a later call', async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const pending = deferred<ScreenWakeLockSentinel>();
    const stale = new FakeSentinel();
    const current = new FakeSentinel();
    const request = vi.fn<ScreenWakeLockManager['request']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(current);
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request },
    });

    controller.setActive(true);
    controller.setActive(false);
    pending.resolve(stale);
    await vi.waitFor(() => expect(stale.release).toHaveBeenCalledOnce());

    controller.setActive(true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(current.release).not.toHaveBeenCalled();
  });

  it('is a no-op when the API is unsupported and releases a late request after disposal', async () => {
    const unsupportedDocument = new FakeVisibilityDocument();
    const unsupported = createScreenWakeLockController({ document: unsupportedDocument });
    expect(() => unsupported.setActive(true)).not.toThrow();
    unsupported.dispose();

    const visibilityDocument = new FakeVisibilityDocument();
    const pending = deferred<ScreenWakeLockSentinel>();
    const stale = new FakeSentinel();
    const controller = createScreenWakeLockController({
      document: visibilityDocument,
      manager: { request: vi.fn(() => pending.promise) },
    });
    controller.setActive(true);
    controller.dispose();
    pending.resolve(stale);

    await vi.waitFor(() => expect(stale.release).toHaveBeenCalledOnce());
    expect(visibilityDocument.listenerCount()).toBe(0);
  });
});
