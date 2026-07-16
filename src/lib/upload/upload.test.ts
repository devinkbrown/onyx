// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UploadError,
  UPLOAD_ERROR_MESSAGE_MAX_LENGTH,
  UPLOAD_RESPONSE_MAX_BYTES,
  UPLOAD_URL_MAX_LENGTH,
  buildUploadEndpoint,
  parseUploadResponse,
  resolveUploadUrl,
  uploadFile,
} from './upload';

function uploadedFormData(fetchMock: ReturnType<typeof vi.fn>): FormData {
  const call = fetchMock.mock.calls.at(0);
  if (!call) throw new Error('fetch was not called');
  const [, init] = call;
  const body = init?.body;
  if (!(body instanceof FormData)) throw new Error('fetch body was not FormData');
  return body;
}

function uploadedFetchInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const call = fetchMock.mock.calls.at(0);
  if (!call) throw new Error('fetch was not called');
  const [, init] = call;
  if (!init) throw new Error('fetch init was not provided');
  return init;
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  static autoLoad = true;
  static progressEvent: ProgressEvent | null = {
    lengthComputable: true,
    loaded: 25,
    total: 100,
  } as ProgressEvent;
  static responseStatus = 201;
  static responseText = JSON.stringify({ path: '/uploads/xhr-file.jpg' });
  static responseContentType: string | null = 'application/json';

  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  method: string | null = null;
  endpoint: string | null = null;
  body: FormData | null = null;
  status = FakeXMLHttpRequest.responseStatus;
  responseText = FakeXMLHttpRequest.responseText;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onload: (() => void) | null = null;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, endpoint: string): void {
    this.method = method;
    this.endpoint = endpoint;
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === 'content-type' ? FakeXMLHttpRequest.responseContentType : null;
  }

  abort(): void {
    this.onabort?.();
  }

  send(body: FormData): void {
    this.body = body;
    if (FakeXMLHttpRequest.progressEvent) this.upload.onprogress?.(FakeXMLHttpRequest.progressEvent);
    if (FakeXMLHttpRequest.autoLoad) this.onload?.();
  }
}

afterEach(() => {
  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.autoLoad = true;
  FakeXMLHttpRequest.progressEvent = {
    lengthComputable: true,
    loaded: 25,
    total: 100,
  } as ProgressEvent;
  FakeXMLHttpRequest.responseStatus = 201;
  FakeXMLHttpRequest.responseText = JSON.stringify({ path: '/uploads/xhr-file.jpg' });
  FakeXMLHttpRequest.responseContentType = 'application/json';
  vi.unstubAllGlobals();
});

describe('upload helper', () => {
  it('builds the POST /upload endpoint from the configured media URL', () => {
    // Arrange / Act / Assert
    expect(buildUploadEndpoint(undefined)).toBe('/upload');
    expect(buildUploadEndpoint('https://media.example.test')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('https://media.example.test/')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('https://media.example.test/upload')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('  https://media.example.test/api///  ')).toBe('https://media.example.test/api/upload');
  });

  it('rejects an explicitly blank media URL', () => {
    // Arrange / Act / Assert
    expect(() => buildUploadEndpoint('')).toThrow(UploadError);
    expect(() => buildUploadEndpoint('   ')).toThrow('Media upload URL is not configured.');
    expect(() => buildUploadEndpoint('javascript:alert(1)')).toThrow('must use HTTP(S)');
    expect(() => buildUploadEndpoint('//evil.example/upload')).toThrow('HTTP(S) or a root-relative path');
    expect(() => buildUploadEndpoint('media.example/upload')).toThrow('absolute or root-relative');
  });

  it('defaults to same-origin /upload when no media URL is configured', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('/uploads/a.png', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    // Act
    const result = await uploadFile(file);

    // Assert
    expect(result).toEqual({ url: '/uploads/a.png' });
    expect(fetchMock).toHaveBeenCalledWith('/upload', expect.objectContaining({ method: 'POST' }));
  });

  it('resolves served /uploads paths against the media origin', () => {
    // Arrange / Act / Assert
    expect(resolveUploadUrl('https://media.example.test/api', '/uploads/a.png'))
      .toBe('https://media.example.test/uploads/a.png');
    expect(resolveUploadUrl('https://media.example.test', 'uploads/a.png'))
      .toBe('https://media.example.test/uploads/a.png');
    expect(resolveUploadUrl('https://media.example.test', 'a.png'))
      .toBe('https://media.example.test/uploads/a.png');
  });

  it('leaves absolute upload response URLs untouched', () => {
    // Arrange / Act / Assert
    expect(resolveUploadUrl('https://media.example.test', 'https://cdn.example.test/a.png'))
      .toBe('https://cdn.example.test/a.png');
  });

  it('rejects unsafe or oversized upload response URLs', () => {
    expect(() => resolveUploadUrl('/upload', 'javascript:alert(1)')).toThrow('unsafe file URL');
    expect(() => resolveUploadUrl('/upload', 'data:text/html,hello')).toThrow('unsafe file URL');
    expect(() => resolveUploadUrl('/upload', '//evil.example/file')).toThrow('unsafe file URL');
    expect(() => resolveUploadUrl('/upload', `/${'x'.repeat(UPLOAD_URL_MAX_LENGTH)}`)).toThrow('too long');
  });

  it('roots relative response paths for the default same-origin upload endpoint', () => {
    // Arrange / Act / Assert
    expect(resolveUploadUrl('/upload', 'a.png')).toBe('/uploads/a.png');
    expect(resolveUploadUrl('/upload', 'uploads/a.png')).toBe('/uploads/a.png');
  });

  it('parses JSON upload responses with relative paths', async () => {
    // Arrange / Act / Assert
    await expect(parseUploadResponse(
      'https://media.example.test',
      JSON.stringify({ path: '/uploads/file.jpg' }),
      'application/json',
    )).resolves.toEqual({ url: 'https://media.example.test/uploads/file.jpg' });
  });

  it('parses nested JSON file paths after ignoring unusable candidates', async () => {
    // Arrange / Act / Assert
    await expect(parseUploadResponse(
      'https://media.example.test',
      JSON.stringify({ url: ' ', href: 404, file: { path: 'nested.jpg' }, filename: 'fallback.jpg' }),
      'Application/JSON; charset=utf-8',
    )).resolves.toEqual({ url: 'https://media.example.test/uploads/nested.jpg' });
  });

  it('parses plain-text upload responses', async () => {
    // Arrange / Act / Assert
    await expect(parseUploadResponse(
      'https://media.example.test',
      '  /uploads/plain.txt  ',
      'text/plain',
    )).resolves.toEqual({ url: 'https://media.example.test/uploads/plain.txt' });
  });

  it('rejects invalid or empty upload responses', async () => {
    // Arrange / Act / Assert
    await expect(parseUploadResponse(
      'https://media.example.test',
      '{',
      'application/json',
    )).rejects.toMatchObject({
      name: 'UploadError',
      code: 'response',
      message: 'Upload service returned invalid JSON.',
    });
    await expect(parseUploadResponse(
      'https://media.example.test',
      JSON.stringify({ url: ' ', file: { path: '' } }),
      'application/json',
    )).rejects.toThrow('Upload response did not include a file URL.');
    await expect(parseUploadResponse(
      'https://media.example.test',
      'null',
      'application/json',
    )).rejects.toMatchObject({
      name: 'UploadError',
      code: 'response',
      message: 'Upload response did not include a file URL.',
    });
    await expect(parseUploadResponse(
      'https://media.example.test',
      '   ',
      null,
    )).rejects.toThrow('Upload response did not include a file URL.');
    await expect(parseUploadResponse(
      '/upload',
      'x'.repeat(UPLOAD_RESPONSE_MAX_BYTES + 1),
      'text/plain',
    )).rejects.toThrow('Upload service response was too large.');
  });

  it('rejects an oversized fetch response before parsing it', async () => {
    const fetchMock = vi.fn(async () => new Response(
      'x'.repeat(UPLOAD_RESPONSE_MAX_BYTES + 1),
      { status: 201 },
    ));
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    await expect(uploadFile(file, { fetchImpl: fetchMock })).rejects.toMatchObject({
      code: 'response',
      message: 'Upload service response was too large.',
    });
  });

  it('bounds server-authored HTTP error text before exposing it', async () => {
    const fetchMock = vi.fn(async () => new Response('e'.repeat(2_000), { status: 422 }));

    await expect(uploadFile(new File(['x'], 'x.txt'), { fetchImpl: fetchMock })).rejects.toMatchObject({
      code: 'response',
      status: 422,
      message: 'e'.repeat(UPLOAD_ERROR_MESSAGE_MAX_LENGTH),
    });
  });

  it('posts multipart form data with the file field and returns the public URL', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ path: '/uploads/file.jpg' }),
      { headers: { 'content-type': 'application/json' }, status: 201 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['image-bytes'], 'file.jpg', { type: 'image/jpeg' });

    // Act
    const result = await uploadFile(file, { mediaUrl: 'https://media.example.test' });

    // Assert
    expect(result).toEqual({ url: 'https://media.example.test/uploads/file.jpg' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://media.example.test/upload',
      expect.objectContaining({ method: 'POST' }),
    );
    const uploaded = uploadedFormData(fetchMock).get('file');
    expect(uploaded).toBe(file);
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe('file.jpg');
    expect((uploaded as File).size).toBe('image-bytes'.length);
    expect((uploaded as File).type).toBe('image/jpeg');
    expect(uploadedFetchInit(fetchMock).headers).toBeUndefined();
  });

  it('keeps the default multipart field name as file for misleading file names', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('/uploads/attachment', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['payload'], 'attachment', { type: 'text/plain' });

    // Act
    const result = await uploadFile(file, { mediaUrl: 'https://media.example.test' });

    // Assert
    const form = uploadedFormData(fetchMock);
    expect(result).toEqual({ url: 'https://media.example.test/uploads/attachment' });
    expect(form.get('file')).toBe(file);
    expect(form.get('attachment')).toBeNull();
  });

  it('posts zero-byte files without inventing size or content type metadata', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('/uploads/empty.bin', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([], 'empty.bin');

    // Act
    await uploadFile(file, { mediaUrl: 'https://media.example.test' });

    // Assert
    const uploaded = uploadedFormData(fetchMock).get('file');
    expect(uploaded).toBe(file);
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe('empty.bin');
    expect((uploaded as File).size).toBe(0);
    expect((uploaded as File).type).toBe('');
  });

  it('posts large binary payloads to fetch without client-side size filtering', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('/uploads/archive.bin', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const bytes = new Uint8Array(1024 * 1024 + 1);
    const file = new File([bytes], 'archive.bin', { type: 'application/octet-stream' });

    // Act
    await uploadFile(file, { mediaUrl: 'https://media.example.test' });

    // Assert
    const uploaded = uploadedFormData(fetchMock).get('file');
    expect(uploaded).toBe(file);
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).size).toBe(bytes.byteLength);
    expect((uploaded as File).type).toBe('application/octet-stream');
  });

  it('uses injected fetch, custom field names, and abort signals for multipart posts', async () => {
    // Arrange
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response('custom-name.txt', { status: 201 }));
    const file = new File(['payload'], 'custom-name.txt', { type: 'text/plain' });

    // Act
    const result = await uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      fieldName: 'attachment',
      fetchImpl: fetchMock,
      signal,
    });

    // Assert
    expect(result).toEqual({ url: 'https://media.example.test/uploads/custom-name.txt' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://media.example.test/upload',
      expect.objectContaining({ method: 'POST', signal }),
    );
    expect(uploadedFormData(fetchMock).get('attachment')).toBe(file);
    expect(uploadedFormData(fetchMock).get('file')).toBeNull();
  });

  it('uses XMLHttpRequest for progress callbacks and reports percentage', async () => {
    // Arrange
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const onProgress = vi.fn();
    const file = new File(['image-bytes'], 'xhr-file.jpg', { type: 'image/jpeg' });

    // Act
    const result = await uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      fieldName: 'asset',
      onProgress,
    });

    // Assert
    const xhr = FakeXMLHttpRequest.instances[0];
    expect(xhr).toBeDefined();
    expect(xhr?.method).toBe('POST');
    expect(xhr?.endpoint).toBe('https://media.example.test/upload');
    expect(xhr?.body?.get('asset')).toBe(file);
    expect(onProgress).toHaveBeenCalledWith({ loaded: 25, total: 100, percent: 25 });
    expect(result).toEqual({ url: 'https://media.example.test/uploads/xhr-file.jpg' });
  });

  it('removes the upload abort listener after an XHR succeeds', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const removeEventListener = vi.fn();
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as AbortSignal;

    await uploadFile(new File(['x'], 'done.bin'), {
      signal,
      onProgress: vi.fn(),
    });

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects an oversized successful XHR response', async () => {
    FakeXMLHttpRequest.responseText = 'x'.repeat(UPLOAD_RESPONSE_MAX_BYTES + 1);
    FakeXMLHttpRequest.responseContentType = 'text/plain';
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    await expect(uploadFile(new File(['x'], 'large.bin'), {
      onProgress: vi.fn(),
    })).rejects.toMatchObject({
      code: 'response',
      message: 'Upload service response was too large.',
    });
  });

  it('reports XHR progress without total or percent when the browser cannot compute length', async () => {
    // Arrange
    FakeXMLHttpRequest.progressEvent = {
      lengthComputable: false,
      loaded: 512,
      total: 0,
    } as ProgressEvent;
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const onProgress = vi.fn();
    const file = new File(['x'], 'unknown.bin', { type: 'application/octet-stream' });

    // Act
    await uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      onProgress,
    });

    // Assert
    expect(onProgress).toHaveBeenCalledWith({ loaded: 512, total: null, percent: null });
  });

  it('registers abort on the XHR path as a once listener and cancels the request', async () => {
    // Arrange
    FakeXMLHttpRequest.autoLoad = false;
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const abortListeners: EventListener[] = [];
    const addEventListener = vi.fn((
      type: string,
      listener: EventListenerOrEventListenerObject,
      _options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'abort' && typeof listener === 'function') abortListeners.push(listener);
    });
    const signal = {
      aborted: false,
      addEventListener,
    } as unknown as AbortSignal;
    const file = new File(['x'], 'abort.bin', { type: 'application/octet-stream' });

    // Act
    const upload = uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      signal,
      onProgress: vi.fn(),
    });
    const xhr = FakeXMLHttpRequest.instances[0]!;
    abortListeners[0]!(new Event('abort'));

    // Assert
    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(xhr.body?.get('file')).toBe(file);
    await expect(upload).rejects.toMatchObject({
      name: 'UploadError',
      code: 'network',
      message: 'Upload was cancelled.',
    });
  });

  it('aborts an already-cancelled XHR upload before sending form data', async () => {
    // Arrange
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const addEventListener = vi.fn();
    const signal = {
      aborted: true,
      addEventListener,
    } as unknown as AbortSignal;
    const file = new File(['x'], 'pre-abort.bin', { type: 'application/octet-stream' });

    // Act / Assert
    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      signal,
      onProgress: vi.fn(),
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'network',
      message: 'Upload was cancelled.',
    });
    expect(addEventListener).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.instances[0]?.body).toBeNull();
  });

  it('surfaces XHR HTTP failures with typed response status', async () => {
    // Arrange
    FakeXMLHttpRequest.responseStatus = 422;
    FakeXMLHttpRequest.responseText = 'invalid upload';
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const file = new File(['x'], 'bad.bin', { type: 'application/octet-stream' });

    // Act / Assert
    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      onProgress: vi.fn(),
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'response',
      status: 422,
      message: 'Upload failed with HTTP 422.',
    });
  });

  it('throws a typed error when fetch returns an error response', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('too large', { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    // Act / Assert
    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test',
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'response',
      status: 413,
      message: 'too large',
    });
  });

  it('uses the HTTP status message when a non-2xx response has no body', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    // Act / Assert
    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test/',
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'response',
      status: 503,
      message: 'Upload failed with HTTP 503.',
    });
  });

  it('wraps network failures in the upload error shape', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => {
      throw new TypeError('socket closed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    // Act / Assert
    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test',
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'network',
      status: null,
      message: 'Upload failed before the server responded.',
    });
  });

  it('wraps response-body stream failures in the upload error shape', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers(),
      text: vi.fn(async () => { throw new TypeError('stream reset'); }),
    }) as unknown as Response);
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      fetchImpl: fetchMock,
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'network',
      status: null,
      message: 'Upload failed while reading the server response.',
    });
  });
});
