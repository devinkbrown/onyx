// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { fetchPublicJson, PUBLIC_FEED_MAX_BYTES } from './fetchPublicJson';

describe('fetchPublicJson', () => {
  it('parses a bounded successful JSON response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(fetchPublicJson('/feed.json', { fetchImpl })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('/feed.json', expect.objectContaining({
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }));
  });

  it('rejects declared and streamed responses beyond the byte ceiling', async () => {
    const declared = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(PUBLIC_FEED_MAX_BYTES + 1) },
    }));
    const streamed = vi.fn(async () => new Response('x'.repeat(65), { status: 200 }));

    await expect(fetchPublicJson('/declared.json', { fetchImpl: declared })).resolves.toBeNull();
    await expect(fetchPublicJson('/streamed.json', { fetchImpl: streamed, maxBytes: 64 })).resolves.toBeNull();
  });

  it('aborts a hanging request and fails closed', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    ));

    await expect(fetchPublicJson('/hanging.json', { fetchImpl, timeoutMs: 5 })).resolves.toBeNull();
  });

  it('bounds a stalled response body even when AbortController is unavailable', async () => {
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}));
    const cancel = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: { getReader: () => ({ read, cancel }) },
    }) as unknown as Response);
    const originalAbortController = globalThis.AbortController;
    vi.stubGlobal('AbortController', undefined);

    try {
      await expect(fetchPublicJson('/stalled-body.json', { fetchImpl, timeoutMs: 5 }))
        .resolves.toBeNull();
      expect(read).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledWith('/stalled-body.json', {
        headers: { Accept: 'application/json' },
      });
    } finally {
      vi.stubGlobal('AbortController', originalAbortController);
    }
  });

  it('rejects malformed JSON without throwing into a route', async () => {
    const fetchImpl = vi.fn(async () => new Response('{broken', { status: 200 }));

    await expect(fetchPublicJson('/broken.json', { fetchImpl })).resolves.toBeNull();
  });
});
