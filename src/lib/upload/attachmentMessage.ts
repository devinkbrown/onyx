// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * attachmentMessage.ts — Era 3 C4 file attachment composer helpers.
 *
 * After upload.ts returns a URL, build a safe message body that never injects
 * CR/LF or spaces that would split IRC parameters.
 */

export const MAX_ATTACHMENT_CAPTION = 400;
export const MAX_ATTACHMENT_NAME = 120;

const CONTROL = /[\u0000-\u001f\u007f]/u;

export type AttachmentSpec = {
  url: string;
  name?: string;
  mime?: string;
  sizeBytes?: number;
  caption?: string;
};

export function sanitizeAttachmentUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048 || CONTROL.test(trimmed)) return null;
  if (trimmed.startsWith('//')) return null;
  try {
    const parsed = new URL(trimmed, 'https://onyx.invalid');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Reject credentials in URL.
    if (parsed.username || parsed.password) return null;
    return trimmed.includes('://') ? parsed.toString() : trimmed;
  } catch {
    return null;
  }
}

export function sanitizeFileName(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.trim().replace(/[/\\]/g, '').slice(0, MAX_ATTACHMENT_NAME);
  if (!base || CONTROL.test(base)) return null;
  return base;
}

/**
 * Build a plain-text message body: optional caption + URL on its own line.
 * Fail closed (null) if the URL is unsafe.
 */
export function buildAttachmentMessage(spec: AttachmentSpec): string | null {
  const url = sanitizeAttachmentUrl(spec.url);
  if (!url) return null;
  const name = sanitizeFileName(spec.name);
  const caption = spec.caption?.trim().replace(CONTROL, '').slice(0, MAX_ATTACHMENT_CAPTION);
  const header = name ? `[file: ${name}]` : '[file]';
  if (caption) return `${caption}\n${header} ${url}`;
  return `${header} ${url}`;
}

export function formatFileSize(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
