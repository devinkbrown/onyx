// SPDX-License-Identifier: AGPL-3.0-or-later

function restoreSelection(ranges: Range[]): void {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return;
  const selection = window.getSelection();
  if (!selection) return;
  try {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  } catch {
    // Copy success/failure remains authoritative if a stale range cannot return.
  }
}

/**
 * Synchronous legacy fallback for older webviews. The value exists only in an
 * attached, readonly textarea for the duration of execCommand('copy'); focus,
 * selection, DOM, and scroll position are restored before this function exits.
 */
function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const execCommand = (document as Document & { execCommand?: unknown }).execCommand;
  if (typeof execCommand !== 'function') return false;

  const active = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const selection = typeof window !== 'undefined' && typeof window.getSelection === 'function'
    ? window.getSelection()
    : null;
  const ranges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.opacity = '0';
  document.body.append(textarea);

  let copied: boolean;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = execCommand.call(document, 'copy') === true;
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    restoreSelection(ranges);
    if (active?.isConnected) {
      try {
        active.focus({ preventScroll: true });
      } catch {
        // Focus restoration is best-effort and never changes copy truthfulness.
      }
    }
  }
  return copied;
}

/**
 * Attempt a browser clipboard write and report the observable result.
 * There is deliberately no localStorage fallback: copied values may be secret,
 * and durable storage is neither a clipboard nor evidence that copying worked.
 * Call directly from an explicit user gesture so both modern and legacy browser
 * pathways retain the activation required by their permission models.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;

  let writeText: ((value: string) => Promise<void>) | null = null;
  if (typeof navigator !== 'undefined') {
    try {
      writeText = typeof navigator.clipboard?.writeText === 'function'
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;
    } catch {
      writeText = null;
    }
  }

  if (writeText) {
    try {
      const pending = writeText(text) as unknown;
      if (
        typeof pending === 'object'
        && pending !== null
        && 'then' in pending
        && typeof pending.then === 'function'
      ) {
        await pending;
        return true;
      }
    } catch {
      // A click still expressed copy intent; an ephemeral legacy attempt may recover.
    }
  }

  return legacyCopyText(text);
}
