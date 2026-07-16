// SPDX-License-Identifier: AGPL-3.0-or-later
export type UploadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type UploadResult = {
  url: string;
};

export type UploadOptions = {
  mediaUrl?: string;
  fieldName?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

export const UPLOAD_RESPONSE_MAX_BYTES = 64 * 1024;
export const UPLOAD_URL_MAX_LENGTH = 2048;
export const UPLOAD_ERROR_MESSAGE_MAX_LENGTH = 512;

type UploadResponseShape = {
  url?: unknown;
  href?: unknown;
  path?: unknown;
  file?: { url?: unknown; path?: unknown };
  filename?: unknown;
  name?: unknown;
};

export class UploadError extends Error {
  status: number | null;
  code: 'config' | 'network' | 'response';

  constructor(message: string, code: UploadError['code'], status: number | null = null) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function baseOrigin(mediaUrl: string): string | null {
  try {
    return new URL(mediaUrl).origin;
  } catch {
    return null;
  }
}

export function buildUploadEndpoint(mediaUrl: string | undefined): string {
  if (mediaUrl === undefined) return '/upload';

  const base = mediaUrl.trim();
  if (!base) {
    throw new UploadError('Media upload URL is not configured.', 'config');
  }

  const normalized = trimTrailingSlash(base);
  if (normalized.startsWith('//')) {
    throw new UploadError('Media upload URL must use HTTP(S) or a root-relative path.', 'config');
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(normalized)) {
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new UploadError('Media upload URL is invalid.', 'config');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UploadError('Media upload URL must use HTTP(S).', 'config');
    }
  } else if (!normalized.startsWith('/')) {
    throw new UploadError('Media upload URL must be absolute or root-relative.', 'config');
  }
  if (normalized.endsWith('/upload')) return normalized;
  return `${normalized}/upload`;
}

export function resolveUploadUrl(mediaUrl: string, returnedUrl: string): string {
  if (returnedUrl.length > UPLOAD_URL_MAX_LENGTH) {
    throw new UploadError('Upload response file URL is too long.', 'response');
  }
  const raw = returnedUrl.trim();
  if (!raw) throw new UploadError('Upload response did not include a file URL.', 'response');
  if (raw.startsWith('//')) {
    throw new UploadError('Upload response returned an unsafe file URL.', 'response');
  }

  try {
    const absolute = new URL(raw);
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
      throw new UploadError('Upload response returned an unsafe file URL.', 'response');
    }
    return absolute.toString();
  } catch {
    if (/^[a-z][a-z\d+.-]*:/iu.test(raw)) {
      throw new UploadError('Upload response returned an unsafe file URL.', 'response');
    }
    // Keep resolving safe relative paths below.
  }

  const origin = baseOrigin(mediaUrl);
  // The production default is the same-origin relative endpoint `/upload`.
  // A bare filename returned there must still become a root `/uploads/...`
  // URL; leaving it relative makes `/app` resolve it as `/app/<filename>`.
  if (!origin) {
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('uploads/')) return `/${raw}`;
    return `/uploads/${raw.replace(/^\/+/, '')}`;
  }
  if (raw.startsWith('/')) return new URL(raw, origin).toString();
  if (raw.startsWith('uploads/')) return new URL(`/${raw}`, origin).toString();
  return new URL(`/uploads/${raw.replace(/^\/+/, '')}`, origin).toString();
}

function responseUrlFromJson(json: UploadResponseShape): string | null {
  const candidates = [
    json.url,
    json.href,
    json.path,
    json.file?.url,
    json.file?.path,
    json.filename,
    json.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return null;
}

export async function parseUploadResponse(
  mediaUrl: string,
  body: string,
  contentType: string | null,
): Promise<UploadResult> {
  if (new TextEncoder().encode(body).byteLength > UPLOAD_RESPONSE_MAX_BYTES) {
    throw new UploadError('Upload service response was too large.', 'response');
  }
  const isJson = contentType?.toLowerCase().includes('application/json') ?? false;

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw new UploadError('Upload service returned invalid JSON.', 'response');
    }
    const url = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? responseUrlFromJson(parsed as UploadResponseShape)
      : null;
    if (!url) throw new UploadError('Upload response did not include a file URL.', 'response');
    return { url: resolveUploadUrl(mediaUrl, url) };
  }

  const text = body.trim();
  if (!text) throw new UploadError('Upload response did not include a file URL.', 'response');
  return { url: resolveUploadUrl(mediaUrl, text) };
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const rawLength = response.headers.get('content-length');
  if (rawLength !== null) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length > UPLOAD_RESPONSE_MAX_BYTES) {
      throw new UploadError('Upload service response was too large.', 'response', response.status);
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > UPLOAD_RESPONSE_MAX_BYTES) {
      throw new UploadError('Upload service response was too large.', 'response', response.status);
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > UPLOAD_RESPONSE_MAX_BYTES) {
      void reader.cancel().catch(() => {});
      throw new UploadError('Upload service response was too large.', 'response', response.status);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function progressFromEvent(event: ProgressEvent): UploadProgress {
  const total = event.lengthComputable ? event.total : null;
  return {
    loaded: event.loaded,
    total,
    percent: total && total > 0 ? Math.round((event.loaded / total) * 100) : null,
  };
}

function uploadWithXhr(file: File, endpoint: string, mediaUrl: string, options: UploadOptions): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append(options.fieldName ?? 'file', file);

    xhr.open('POST', endpoint);
    xhr.upload.onprogress = (event) => {
      options.onProgress?.(progressFromEvent(event));
    };
    let abortHandler: (() => void) | null = null;
    const cleanup = () => {
      if (abortHandler) {
        (options.signal as Partial<AbortSignal> | undefined)?.removeEventListener?.('abort', abortHandler);
        abortHandler = null;
      }
    };
    const fail = (error: UploadError) => {
      cleanup();
      reject(error);
    };
    const succeed = (result: UploadResult) => {
      cleanup();
      resolve(result);
    };
    xhr.onerror = () => fail(new UploadError('Upload failed before the server responded.', 'network'));
    xhr.onabort = () => fail(new UploadError('Upload was cancelled.', 'network'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new UploadError(`Upload failed with HTTP ${xhr.status}.`, 'response', xhr.status));
        return;
      }
      if (new TextEncoder().encode(xhr.responseText).byteLength > UPLOAD_RESPONSE_MAX_BYTES) {
        fail(new UploadError('Upload service response was too large.', 'response', xhr.status));
        return;
      }
      void parseUploadResponse(mediaUrl, xhr.responseText, xhr.getResponseHeader('content-type'))
        .then(succeed, (error: unknown) => fail(
          error instanceof UploadError
            ? error
            : new UploadError('Upload service returned an invalid response.', 'response', xhr.status),
        ));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort();
        return;
      }
      abortHandler = () => xhr.abort();
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    xhr.send(form);
  });
}

export async function uploadFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  const mediaUrl = options.mediaUrl?.trim();
  const endpoint = buildUploadEndpoint(options.mediaUrl);
  const responseBaseUrl = mediaUrl || endpoint;

  if (options.onProgress && typeof XMLHttpRequest !== 'undefined') {
    return uploadWithXhr(file, endpoint, responseBaseUrl, options);
  }

  const form = new FormData();
  form.append(options.fieldName ?? 'file', file);
  const fetcher = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      body: form,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('Upload failed before the server responded.', 'network');
  }

  let body: string;
  try {
    body = await readBoundedResponseText(response);
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('Upload failed while reading the server response.', 'network');
  }
  if (!response.ok) {
    const message = body.trim().slice(0, UPLOAD_ERROR_MESSAGE_MAX_LENGTH)
      || `Upload failed with HTTP ${response.status}.`;
    throw new UploadError(message, 'response', response.status);
  }

  return parseUploadResponse(responseBaseUrl, body, response.headers.get('content-type'));
}
