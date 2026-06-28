import { describe, expect, it, vi } from 'vitest';

import {
  UploadError,
  buildUploadEndpoint,
  parseUploadResponse,
  resolveUploadUrl,
  uploadFile,
} from './upload';

describe('upload helper', () => {
  it('builds the POST /upload endpoint from the configured media URL', () => {
    expect(buildUploadEndpoint('https://media.example.test')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('https://media.example.test/')).toBe('https://media.example.test/upload');
    expect(buildUploadEndpoint('https://media.example.test/upload')).toBe('https://media.example.test/upload');
  });

  it('requires a configured media URL', () => {
    expect(() => buildUploadEndpoint('')).toThrow(UploadError);
    expect(() => buildUploadEndpoint(undefined)).toThrow('Media upload URL is not configured.');
  });

  it('resolves served /uploads paths against the media origin', () => {
    expect(resolveUploadUrl('https://media.example.test/api', '/uploads/a.png'))
      .toBe('https://media.example.test/uploads/a.png');
    expect(resolveUploadUrl('https://media.example.test', 'uploads/a.png'))
      .toBe('https://media.example.test/uploads/a.png');
    expect(resolveUploadUrl('https://media.example.test', 'a.png'))
      .toBe('https://media.example.test/uploads/a.png');
  });

  it('parses JSON upload responses with relative paths', async () => {
    await expect(parseUploadResponse(
      'https://media.example.test',
      JSON.stringify({ path: '/uploads/file.jpg' }),
      'application/json',
    )).resolves.toEqual({ url: 'https://media.example.test/uploads/file.jpg' });
  });

  it('throws a typed error when fetch returns an error response', async () => {
    const fetchImpl = vi.fn(async () => new Response('too large', { status: 413 }));
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });

    await expect(uploadFile(file, {
      mediaUrl: 'https://media.example.test',
      fetchImpl,
    })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'response',
      status: 413,
      message: 'too large',
    });
  });
});
