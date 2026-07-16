// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal, For, onCleanup, Show, splitProps, type JSX } from 'solid-js';
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

  onCleanup(() => {
    if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
  });

  async function copyValue(): Promise<void> {
    if (!local.button.value) return;
    const copied = await writeClipboardText(local.button.value);
    setCopyStatus(copied ? 'copied' : 'failed');
    if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
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
