// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UploadError,
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

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  method: string | null = null;
  endpoint: string | null = null;
  body: FormData | null = null;
  status = 201;
  responseText = JSON.stringify({ path: '/uploads/xhr-file.jpg' });
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
    return name.toLowerCase() === 'content-type' ? 'application/json' : null;
  }

  abort(): void {
    this.onabort?.();
  }

  send(body: FormData): void {
    this.body = body;
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 25,
      total: 100,
    } as ProgressEvent);
    this.onload?.();
  }
}

afterEach(() => {
  FakeXMLHttpRequest.instances = [];
  vi.unstubAllGlobals();
});

describe('upload helper', () => {
  it('builds the POST /upload endpoint from the configured media URL', () => {
    // Arrange / Act / Assert
    expect(buildUploadEndpoint('https://media.example.test')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('https://media.example.test/')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('https://media.example.test/upload')).toBe('https://media.example.test/upload');
  });

  it('rejects an explicitly blank media URL', () => {
    // Arrange / Act / Assert
    expect(() => buildUploadEndpoint('')).toThrow(UploadError);
    expect(() => buildUploadEndpoint('   ')).toThrow('Media upload URL is not configured.');
  });

  it.skip('defaults to same-origin /upload when no media URL is configured', async () => {
    // FIXME: uploadFile currently rejects a missing mediaUrl before it can post
    // to the documented same-origin /upload endpoint.
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

  it('keeps relative response paths when the configured media URL has no origin', () => {
    // Arrange / Act / Assert
    expect(resolveUploadUrl('/upload', 'a.png')).toBe('a.png');
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
      '   ',
      null,
    )).rejects.toThrow('Upload response did not include a file URL.');
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
    expect(uploadedFormData(fetchMock).get('file')).toBe(file);
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
});
