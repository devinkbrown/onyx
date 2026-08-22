// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_COUNT_CAP_COPY,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_SIZE_LABEL,
  attachmentSizeCapCopy,
  formatAttachmentBytes,
  planAttachmentAccept,
} from './attachmentCaps';

describe('attachmentCaps', () => {
  it('publishes one 25 MB / 5-file cap', () => {
    expect(MAX_ATTACHMENT_FILES).toBe(5);
    expect(MAX_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_ATTACHMENT_SIZE_LABEL).toBe('25 MB');
    expect(ATTACHMENT_COUNT_CAP_COPY).toBe('You can attach up to 5 files.');
    expect(attachmentSizeCapCopy('huge.bin')).toBe('huge.bin is larger than 25 MB.');
    expect(ATTACHMENT_COUNT_CAP_COPY).toContain(String(MAX_ATTACHMENT_FILES));
    expect(attachmentSizeCapCopy('x')).toContain(MAX_ATTACHMENT_SIZE_LABEL);
  });

  it('rejects a sixth file with the published count copy', () => {
    const sixth = planAttachmentAccept(
      [{ name: 'six.pdf', size: 1024 }],
      MAX_ATTACHMENT_FILES,
    );
    expect(sixth.acceptIndexes).toEqual([]);
    expect(sixth.error).toBe(ATTACHMENT_COUNT_CAP_COPY);

    const batch = planAttachmentAccept(
      Array.from({ length: 6 }, (_, index) => ({ name: `f${index}.bin`, size: 10 })),
      0,
    );
    expect(batch.acceptIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(batch.error).toBe(ATTACHMENT_COUNT_CAP_COPY);
  });

  it('rejects a file over 25 MB with the published size copy', () => {
    const decision = planAttachmentAccept(
      [{ name: 'movie.mp4', size: MAX_ATTACHMENT_BYTES + 1 }],
      0,
    );
    expect(decision.acceptIndexes).toEqual([]);
    expect(decision.error).toBe('movie.mp4 is larger than 25 MB.');
  });

  it('labels Compact / Original options with KB or MB', () => {
    expect(formatAttachmentBytes(2048)).toBe('2.0 KB');
    expect(formatAttachmentBytes(25 * 1024 * 1024)).toBe('25.0 MB');
  });
});
