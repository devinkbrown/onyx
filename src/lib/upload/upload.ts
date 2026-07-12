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
  if (normalized.endsWith('/upload')) return normalized;
  return `${normalized}/upload`;
}

export function resolveUploadUrl(mediaUrl: string, returnedUrl: string): string {
  const raw = returnedUrl.trim();
  if (!raw) throw new UploadError('Upload response did not include a file URL.', 'response');

  try {
    return new URL(raw).toString();
  } catch {
    // Keep resolving below.
  }

  const origin = baseOrigin(mediaUrl);
  if (!origin) return raw;
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
  const isJson = contentType?.toLowerCase().includes('application/json') ?? false;

  if (isJson) {
    let parsed: UploadResponseShape;
    try {
      parsed = JSON.parse(body) as UploadResponseShape;
    } catch {
      throw new UploadError('Upload service returned invalid JSON.', 'response');
    }
    const url = responseUrlFromJson(parsed);
    if (!url) throw new UploadError('Upload response did not include a file URL.', 'response');
    return { url: resolveUploadUrl(mediaUrl, url) };
  }

  const text = body.trim();
  if (!text) throw new UploadError('Upload response did not include a file URL.', 'response');
  return { url: resolveUploadUrl(mediaUrl, text) };
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
    xhr.onerror = () => reject(new UploadError('Upload failed before the server responded.', 'network'));
    xhr.onabort = () => reject(new UploadError('Upload was cancelled.', 'network'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new UploadError(`Upload failed with HTTP ${xhr.status}.`, 'response', xhr.status));
        return;
      }
      void parseUploadResponse(mediaUrl, xhr.responseText, xhr.getResponseHeader('content-type'))
        .then(resolve, reject);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort();
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
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

  const body = await response.text();
  if (!response.ok) {
    const message = body.trim() || `Upload failed with HTTP ${response.status}.`;
    throw new UploadError(message, 'response', response.status);
  }

  return parseUploadResponse(responseBaseUrl, body, response.headers.get('content-type'));
}
