// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildAttachmentMessage,
  formatFileSize,
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
});
