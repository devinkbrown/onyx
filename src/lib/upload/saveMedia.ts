// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Explicit Save for chat media. Never auto-save to a phone gallery.
 * Call only from a user gesture (lightbox Save).
 */

export type SaveMediaRequest = {
  href: string;
  name?: string | null;
};

export function mediaSaveName(href: string, name?: string | null): string {
  const cleaned = name?.trim().replace(/[/\\]/g, '');
  if (cleaned) return cleaned;
  try {
    const path = new URL(href, 'https://onyx.invalid').pathname;
    const leaf = path.split('/').filter(Boolean).pop();
    if (leaf) return leaf;
  } catch {
    // Fall through.
  }
  return 'image';
}

/**
 * User-activated download via a transient <a download>. Does not touch the
 * gallery, MediaStore, or any background write.
 */
export function saveMediaFromUserGesture(
  request: SaveMediaRequest,
  doc: Pick<Document, 'createElement' | 'body'> = document,
): void {
  const anchor = doc.createElement('a');
  anchor.href = request.href;
  anchor.download = mediaSaveName(request.href, request.name);
  anchor.rel = 'noopener noreferrer';
  anchor.target = '_blank';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
