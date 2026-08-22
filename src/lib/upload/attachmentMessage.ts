// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * attachmentMessage.ts — Era 3 C4 file attachment composer helpers.
 *
 * After upload.ts returns a URL, build a safe message body that never injects
 * CR/LF or spaces that would split IRC parameters.
 */

export const MAX_ATTACHMENT_CAPTION = 400;
export const MAX_ATTACHMENT_NAME = 120;

/** User-facing copy when an upload cannot be sent. Retry is the same Send path. */
export const ATTACHMENT_SEND_FAILED = "Couldn't send. Try again.";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO_EXTS = /\.(mp4|webm)$/i;
const AUDIO_EXTS = /\.(mp3|ogg|wav)$/i;

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export type AttachmentSpec = {
  url: string;
  name?: string;
  mime?: string;
  sizeBytes?: number;
  caption?: string;
};

export type ParsedAttachment = {
  url: string;
  name: string | null;
  sizeLabel: string | null;
  kind: AttachmentKind;
};

export type AttachmentPresentation = {
  /** Message text with `[file:]` receipt lines removed. */
  caption: string;
  attachments: ParsedAttachment[];
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
  const size = formatFileSize(spec.sizeBytes);
  const receipt = size ? `${header} ${size} ${url}` : `${header} ${url}`;
  if (caption) return `${caption}\n${receipt}`;
  return receipt;
}

function urlPathname(url: string): string {
  try {
    return new URL(url, 'https://onyx.invalid').pathname;
  } catch {
    return '';
  }
}

export function classifyAttachmentKind(url: string, name?: string | null): AttachmentKind {
  const candidates = [urlPathname(url), name ?? ''];
  for (const value of candidates) {
    if (!value) continue;
    if (IMAGE_EXTS.test(value)) return 'image';
    if (VIDEO_EXTS.test(value)) return 'video';
    if (AUDIO_EXTS.test(value)) return 'audio';
  }
  return 'file';
}

/**
 * Parse one transcript line of the form `[file]` / `[file: name]` + optional
 * size + URL. Fail closed (null) when the header or URL is unsafe.
 */
export function parseAttachmentLine(line: string): ParsedAttachment | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[file')) return null;
  const close = trimmed.indexOf(']');
  if (close < 5) return null;
  const header = trimmed.slice(1, close);
  if (header !== 'file' && !header.startsWith('file:')) return null;
  const rest = trimmed.slice(close + 1).trim();
  if (!rest) return null;

  let sizeLabel: string | null = null;
  let urlRaw = rest;
  const sized = rest.match(/^(\d+(?:\.\d+)?\s(?:B|KB|MB|GB))\s+(\S+)$/i);
  if (sized?.[1] && sized[2]) {
    sizeLabel = sized[1];
    urlRaw = sized[2];
  } else if (rest.includes(' ')) {
    return null;
  }

  const url = sanitizeAttachmentUrl(urlRaw);
  if (!url) return null;
  const name = header.startsWith('file:') ? sanitizeFileName(header.slice(5)) : null;
  return {
    url,
    name,
    sizeLabel,
    kind: classifyAttachmentKind(url, name),
  };
}

/**
 * Split a message body into a caption plus structured attachments so the
 * transcript can render photos/files instead of the `[file:]` receipt text.
 */
export function extractAttachmentPresentation(text: string): AttachmentPresentation {
  const attachments: ParsedAttachment[] = [];
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseAttachmentLine(line);
    if (parsed) attachments.push(parsed);
    else kept.push(line);
  }
  return {
    caption: kept.join('\n').trimEnd(),
    attachments,
  };
}

export function formatFileSize(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
