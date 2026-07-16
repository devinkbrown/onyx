// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, For, onCleanup, Show, splitProps, type JSX } from 'solid-js';
import { ModalShell } from '@/primitives';
import type {
  BlockKitLiteAction,
  BlockKitLiteButton,
  BlockKitLiteModalBlock,
  BlockKitLiteSelect,
  PreparedBlockKitAction,
} from '@/lib/integrations/blockKitLite';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  BLOCK_KIT_CONFIRM_DESCRIPTION,
  BLOCK_KIT_CONFIRM_TITLE,
  BlockKitActionConfirmationContent,
} from './BlockKitActionConfirmation';

export type BlockKitModalProps = {
  block: BlockKitLiteModalBlock;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction?: (
    action: BlockKitLiteAction,
    selectedValue: string | undefined,
    source: HTMLButtonElement | HTMLSelectElement,
  ) => void;
  confirmation?: PreparedBlockKitAction | null;
  onConfirm?: () => void;
  onCancel?: () => void;
};

function ModalButton(props: {
  button: BlockKitLiteButton;
  onAction: BlockKitModalProps['onAction'];
}): JSX.Element {
  const [local] = splitProps(props, ['button', 'onAction']);
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  let copyEpoch = 0;
  let disposed = false;

  const clearCopyResetTimer = (): void => {
    if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
    copyResetTimer = undefined;
  };

  createEffect(() => {
    void local.button.label;
    void local.button.value;
    copyEpoch += 1;
    clearCopyResetTimer();
    setCopyStatus('idle');
  });

  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
    clearCopyResetTimer();
  });

  async function copyValue(): Promise<void> {
    const value = local.button.value;
    const label = local.button.label;
    if (!value) return;
    const epoch = ++copyEpoch;
    const copied = await writeClipboardText(value);
    if (
      disposed
      || epoch !== copyEpoch
      || local.button.value !== value
      || local.button.label !== label
    ) return;
    setCopyStatus(copied ? 'copied' : 'failed');
    clearCopyResetTimer();
    copyResetTimer = setTimeout(() => {
      if (disposed || epoch !== copyEpoch) return;
      copyResetTimer = undefined;
      setCopyStatus('idle');
    }, 1400);
  }

  return (
    <Show
      when={local.button.url}
      fallback={(
        <Show
          when={local.button.action}
          fallback={(
            <>
              <button
                type="button"
                disabled={!local.button.value}
                title={local.button.value ? `Copy ${local.button.value}` : undefined}
                aria-label={local.button.value ? `Copy value for ${local.button.label}` : local.button.label}
                data-copy-state={copyStatus()}
                onClick={() => void copyValue()}
              >
                {copyStatus() === 'copied'
                  ? 'Copied'
                  : copyStatus() === 'failed'
                    ? 'Copy failed'
                    : local.button.label}
              </button>
              <span class="sr-only" role="status" aria-live="polite">
                {copyStatus() === 'copied'
                  ? `${local.button.label} value copied.`
                  : copyStatus() === 'failed'
                    ? `${local.button.label} value could not be copied.`
                    : ''}
              </span>
            </>
          )}
        >
          {(action) => (
            <button
              type="button"
              onClick={(event) => local.onAction?.(action(), undefined, event.currentTarget)}
            >
              {local.button.label}
            </button>
          )}
        </Show>
      )}
    >
      {(url) => (
        <a href={url()} target="_blank" rel="noopener noreferrer">
          {local.button.label}
        </a>
      )}
    </Show>
  );
}

function ModalSelect(props: {
  select: BlockKitLiteSelect;
  onAction: BlockKitModalProps['onAction'];
}): JSX.Element {
  const [local] = splitProps(props, ['select', 'onAction']);

  function handleChange(event: Event): void {
    const source = event.currentTarget as HTMLSelectElement;
    const selectedValue = source.value;
    if (!selectedValue || !local.select.action) return;
    // Returning to the placeholder immediately lets cancel/retry choose the same
    // option again (native change does not fire for an unchanged value).
    source.value = '';
    local.onAction?.(local.select.action, selectedValue, source);
  }

  return (
    <label>
      <span>{local.select.label}</span>
      <select aria-label={local.select.label} onChange={handleChange}>
        <Show when={local.select.action}>
          <option value="">Choose...</option>
        </Show>
        <For each={local.select.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </label>
  );
}

export function BlockKitModal(props: BlockKitModalProps): JSX.Element {
  const [local] = splitProps(props, [
    'block',
    'open',
    'onOpenChange',
    'onAction',
    'confirmation',
    'onConfirm',
    'onCancel',
  ]);
  const confirming = () => local.confirmation !== null && local.confirmation !== undefined;

  return (
    <ModalShell
      open={local.open}
      title={confirming() ? BLOCK_KIT_CONFIRM_TITLE : local.block.title}
      description={confirming() ? BLOCK_KIT_CONFIRM_DESCRIPTION : (local.block.text ?? undefined)}
      onOpenChange={local.onOpenChange}
      closeLabel={confirming() ? 'Cancel sending message' : 'Close block details'}
    >
      <div hidden={confirming()}>
        <Show when={local.block.fields.length > 0}>
          <dl class="shell-msg-blockkit-fields">
            <For each={local.block.fields}>
              {(field) => (
                <div>
                  <dt>{field.label}</dt>
                  <dd>{field.value || 'Not set'}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
        <Show when={local.block.selects.length > 0}>
          <div class="shell-msg-blockkit-selects">
            <For each={local.block.selects}>
              {(select) => <ModalSelect select={select} onAction={local.onAction} />}
            </For>
          </div>
        </Show>
        <Show when={local.block.buttons.length > 0}>
          <div class="shell-msg-blockkit-actions">
            <For each={local.block.buttons}>
              {(button) => <ModalButton button={button} onAction={local.onAction} />}
            </For>
          </div>
        </Show>
      </div>
      <Show when={local.confirmation}>
        {(prepared) => (
          <BlockKitActionConfirmationContent
            prepared={prepared()}
            onConfirm={() => local.onConfirm?.()}
            onCancel={() => local.onCancel?.()}
          />
        )}
      </Show>
    </ModalShell>
  );
}
