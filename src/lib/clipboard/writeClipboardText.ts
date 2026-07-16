// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Attempt a browser clipboard write and report the observable result.
 * There is deliberately no localStorage fallback: copied values may be secret,
 * and durable storage is neither a clipboard nor evidence that copying worked.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
