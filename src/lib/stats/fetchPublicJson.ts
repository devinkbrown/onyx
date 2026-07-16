// SPDX-License-Identifier: AGPL-3.0-or-later
/** Maximum decoded response bytes accepted from one public status/stats feed. */
export const PUBLIC_FEED_MAX_BYTES = 256 * 1024;
export const PUBLIC_FEED_TIMEOUT_MS = 8_000;

export type PublicFeedFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchPublicJson(
  path: string,
  options: {
    fetchImpl?: PublicFeedFetch;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? (
    typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  );
  if (!fetchImpl) return null;
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? PUBLIC_FEED_MAX_BYTES));
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? PUBLIC_FEED_TIMEOUT_MS));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(path, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rawLength = response.headers.get('content-length');
    if (rawLength !== null) {
      const contentLength = Number(rawLength);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
    }

    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) return null;
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
