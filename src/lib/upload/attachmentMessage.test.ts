// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildAttachmentMessage,
  classifyAttachmentKind,
  extractAttachmentPresentation,
  formatFileSize,
  parseAttachmentLine,
  sanitizeAttachmentUrl,
} from './attachmentMessage';

describe('attachmentMessage (C4)', () => {
  it('builds a safe caption+url body', () => {
    expect(buildAttachmentMessage({
      url: 'https://cdn.example/a.png',
      name: 'shot.png',
      caption: 'see this',
    })).toBe('see this\n[file: shot.png] https://cdn.example/a.png');
  });

  it('rejects unsafe URLs', () => {
    expect(sanitizeAttachmentUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeAttachmentUrl('https://user:pass@evil/')).toBeNull();
    expect(buildAttachmentMessage({ url: 'ftp://x' })).toBeNull();
  });

  it('formats sizes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('includes a size token when the composer knows the byte length', () => {
    expect(buildAttachmentMessage({
      url: 'https://cdn.example/a.png',
      name: 'shot.png',
      sizeBytes: 2048,
    })).toBe('[file: shot.png] 2.0 KB https://cdn.example/a.png');
  });

  it('parses current and sized receipt lines fail-closed', () => {
    expect(parseAttachmentLine('[file: shot.png] https://cdn.example/a.png')).toEqual({
      url: 'https://cdn.example/a.png',
      name: 'shot.png',
      sizeLabel: null,
      kind: 'image',
    });
    expect(parseAttachmentLine('[file: notes.pdf] 12.0 KB https://cdn.example/notes.pdf')).toEqual({
      url: 'https://cdn.example/notes.pdf',
      name: 'notes.pdf',
      sizeLabel: '12.0 KB',
      kind: 'file',
    });
    expect(parseAttachmentLine('[file: shot.png] /uploads/a.png')).toEqual({
      url: '/uploads/a.png',
      name: 'shot.png',
      sizeLabel: null,
      kind: 'image',
    });
    expect(parseAttachmentLine('[file: shot.png] javascript:alert(1)')).toBeNull();
    expect(parseAttachmentLine('[file: shot.png] https://user:pass@cdn.example/a.png')).toBeNull();
    expect(parseAttachmentLine('just text https://cdn.example/a.png')).toBeNull();
  });

  it('strips receipt lines from the caption and classifies media from name when the URL has no extension', () => {
    const parsed = extractAttachmentPresentation([
      'harbour at dusk',
      '[file: harbour.png] /uploads/abc123',
      '[file: notes.pdf] 1.5 KB https://cdn.example/notes.pdf',
    ].join('\n'));
    expect(parsed.caption).toBe('harbour at dusk');
    expect(parsed.attachments).toEqual([
      { url: '/uploads/abc123', name: 'harbour.png', sizeLabel: null, kind: 'image' },
      { url: 'https://cdn.example/notes.pdf', name: 'notes.pdf', sizeLabel: '1.5 KB', kind: 'file' },
    ]);
    expect(classifyAttachmentKind('/uploads/abc123', 'clip.webm')).toBe('video');
  });
});
