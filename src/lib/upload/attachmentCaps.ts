// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One published attachment cap for composer, validation, and edge copy.
 * Do not invent a second limit.
 */

export const MAX_ATTACHMENT_FILES = 5;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_SIZE_LABEL = '25 MB';

export const ATTACHMENT_COUNT_CAP_COPY = `You can attach up to ${MAX_ATTACHMENT_FILES} files.`;

export type AttachmentCapInput = {
  name: string;
  size: number;
};

export type AttachmentCapDecision = {
  acceptIndexes: number[];
  error: string | null;
};

export function attachmentSizeCapCopy(name: string): string {
  return `${name} is larger than ${MAX_ATTACHMENT_SIZE_LABEL}.`;
}

/** Format a byte length as KB/MB for honest Compact / Original labels. */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * Decide which incoming files fit the published 25 MB / 5-file cap given
 * how many attachments are already staged.
 */
export function planAttachmentAccept(
  files: readonly AttachmentCapInput[],
  currentCount: number,
): AttachmentCapDecision {
  const room = Math.max(0, MAX_ATTACHMENT_FILES - Math.max(0, currentCount));
  if (room === 0) {
    return { acceptIndexes: [], error: ATTACHMENT_COUNT_CAP_COPY };
  }

  const acceptIndexes: number[] = [];
  let error: string | null = null;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;
    if (acceptIndexes.length >= room) {
      error = ATTACHMENT_COUNT_CAP_COPY;
      break;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      error = attachmentSizeCapCopy(file.name);
      continue;
    }
    acceptIndexes.push(index);
  }
  return { acceptIndexes, error };
}
