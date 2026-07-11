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

afterEach(() => {
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

  it('parses JSON upload responses with relative paths', async () => {
    // Arrange / Act / Assert
    await expect(parseUploadResponse(
      'https://media.example.test',
      JSON.stringify({ path: '/uploads/file.jpg' }),
      'application/json',
    )).resolves.toEqual({ url: 'https://media.example.test/uploads/file.jpg' });
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
