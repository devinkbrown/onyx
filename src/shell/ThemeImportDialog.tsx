// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ThemeImportDialog.tsx — local Sheet for sharing and importing theme codes.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { parseThemeParam, themeShareUrl } from '@/lib/theme/themeShare';
import type { CustomTheme } from '@/theme';
import './ThemeImportDialog.css';

const COPY_FEEDBACK_MS = 1600;
const URL_PARSE_BASE = 'https://onyx.local';

function extractCode(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';

  const urlCode = extractThemeSearchParam(trimmed);
  return urlCode ?? trimmed;
}

function extractThemeSearchParam(input: string): string | null {
  if (!input.includes('theme=')) return null;

  try {
    return new URL(input, URL_PARSE_BASE).searchParams.get('theme');
  } catch {
    return null;
  }
}

function locationOrigin(): string {
  return typeof location === 'undefined' ? '' : location.origin;
}

export function ThemeImportDialog(props: {
  open: boolean;
  onClose: () => void;
  onImport: (theme: CustomTheme) => void;
  shareTheme?: CustomTheme;
}): JSX.Element {
  const [importInput, setImportInput] = createSignal('');
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  let copyTimer: number | undefined;
  let copyEpoch = 0;
  let disposed = false;

  const importedTheme = createMemo(() => parseThemeParam(extractCode(importInput())));
  const hasImportInput = createMemo(() => importInput().trim().length > 0);
  const importInvalid = createMemo(() => hasImportInput() && importedTheme() === null);
  const importDescription = createMemo(() => (
    importInvalid() ? 'theme-import-help theme-import-error' : 'theme-import-help'
  ));
  const shareUrl = createMemo(() => {
    const theme = props.shareTheme;
    return theme ? themeShareUrl(theme, locationOrigin()) : '';
  });
  const shareThemeName = createMemo(() => props.shareTheme?.name ?? 'current theme');
  const canCopyShareUrl = createMemo(() => shareUrl().length > 0);

  const clearCopyTimer = (): void => {
    if (copyTimer === undefined || typeof window === 'undefined') return;
    window.clearTimeout(copyTimer);
    copyTimer = undefined;
  };

  const queueCopyReset = (epoch: number): void => {
    clearCopyTimer();
    if (typeof window === 'undefined') return;
    copyTimer = window.setTimeout(() => {
      if (disposed || epoch !== copyEpoch) return;
      setCopyStatus('idle');
      copyTimer = undefined;
    }, COPY_FEEDBACK_MS);
  };

  const importTheme = (theme: CustomTheme): void => {
    props.onImport(theme);
    props.onClose();
  };

  const copyShareLink = async (): Promise<void> => {
    if (!canCopyShareUrl()) return;

    const epoch = ++copyEpoch;
    const url = shareUrl();
    clearCopyTimer();
    setCopyStatus('idle');
    const copied = await writeClipboardText(url);
    if (disposed || epoch !== copyEpoch || !props.open || shareUrl() !== url) return;
    if (copied) {
      setCopyStatus('copied');
      queueCopyReset(epoch);
      return;
    }

    setCopyStatus('failed');
  };

  // The dialog can stay open while the selected custom theme changes. Retire
  // feedback from the previous URL before it can describe the replacement.
  createEffect(() => {
    void shareUrl();
    copyEpoch += 1;
    clearCopyTimer();
    setCopyStatus('idle');
  });

  createEffect(() => {
    if (props.open) return;
    copyEpoch += 1;
    clearCopyTimer();
    setCopyStatus('idle');
  });

  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
    clearCopyTimer();
  });

  return (
    <Sheet
      open={props.open}
      title="Share & import a theme"
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      closeLabel="Close"
    >
      <div class="theme-import-dialog" data-testid="theme-import-dialog">
        <section class="theme-import-dialog__section" aria-labelledby="theme-import-heading">
          <div class="theme-import-dialog__section-head">
            <h3 class="theme-import-dialog__heading" id="theme-import-heading">Import</h3>
          </div>
          <label class="theme-import-dialog__label" for="theme-import-code">
            Theme code or link
          </label>
          <p class="theme-import-dialog__hint" id="theme-import-help">
            Paste a shared Onyx theme code or link. It is checked locally before import; no code is run.
          </p>
          <textarea
            id="theme-import-code"
            class="theme-import-dialog__textarea"
            value={importInput()}
            onInput={(event) => setImportInput(event.currentTarget.value)}
            rows={5}
            spellcheck={false}
            aria-invalid={importInvalid() ? 'true' : undefined}
            aria-describedby={importDescription()}
          />
          <Show when={importedTheme()} keyed>
            {(theme) => (
              <div class="theme-import-dialog__valid-preview" role="status">
                <span class="theme-import-dialog__valid-label">Ready</span>
                <strong class="theme-import-dialog__theme-name">{theme.name}</strong>
                <button
                  class="theme-import-dialog__button theme-import-dialog__button--primary"
                  type="button"
                  aria-label={`Import theme ${theme.name}`}
                  onClick={() => importTheme(theme)}
                >
                  Import theme
                </button>
              </div>
            )}
          </Show>
          <Show when={importInvalid()}>
            <p class="theme-import-dialog__error" id="theme-import-error">
              That doesn't look like a valid theme code.
            </p>
          </Show>
        </section>

        <Show when={props.shareTheme}>
          <section class="theme-import-dialog__section" aria-labelledby="theme-share-heading">
            <div class="theme-import-dialog__section-head">
              <h3 class="theme-import-dialog__heading" id="theme-share-heading">Share</h3>
            </div>
            <label class="theme-import-dialog__label" for="theme-share-link">
              Share link
            </label>
            <div class="theme-import-dialog__share-row">
              <input
                id="theme-share-link"
                class="theme-import-dialog__input"
                value={shareUrl()}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                class="theme-import-dialog__button theme-import-dialog__button--secondary"
                type="button"
                disabled={!canCopyShareUrl()}
                aria-label={`Copy share link for ${shareThemeName()}`}
                onClick={() => void copyShareLink()}
              >
                {copyStatus() === 'copied'
                  ? 'Copied'
                  : copyStatus() === 'failed'
                    ? 'Copy failed'
                    : 'Copy link'}
              </button>
            </div>
            <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {copyStatus() === 'copied'
                ? `Share link copied for ${shareThemeName()}.`
                : copyStatus() === 'failed'
                  ? `Could not copy the share link for ${shareThemeName()}. Select and copy it from the field.`
                  : ''}
            </span>
          </section>
        </Show>
      </div>
    </Sheet>
  );
}
