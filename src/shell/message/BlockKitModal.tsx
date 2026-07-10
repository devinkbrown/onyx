import { createSignal, For, Show, splitProps, type JSX } from 'solid-js';
import { ModalShell } from '@/primitives';
import type {
  BlockKitLiteAction,
  BlockKitLiteButton,
  BlockKitLiteModalBlock,
  BlockKitLiteSelect,
} from '@/lib/integrations/blockKitLite';

export type BlockKitModalProps = {
  block: BlockKitLiteModalBlock;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction?: (action: BlockKitLiteAction, selectedValue?: string) => void;
};

function ModalButton(props: {
  button: BlockKitLiteButton;
  onAction: ((action: BlockKitLiteAction) => void) | undefined;
}): JSX.Element {
  const [local] = splitProps(props, ['button', 'onAction']);
  const [copied, setCopied] = createSignal(false);

  async function copyValue(): Promise<void> {
    if (!local.button.value) return;
    try {
      await navigator.clipboard?.writeText(local.button.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Show
      when={local.button.url}
      fallback={(
        <Show
          when={local.button.action}
          fallback={(
            <button
              type="button"
              disabled={!local.button.value}
              title={local.button.value ? `Copy ${local.button.value}` : undefined}
              aria-label={local.button.value ? `Copy value for ${local.button.label}` : local.button.label}
              data-copied={copied() ? 'true' : undefined}
              onClick={() => void copyValue()}
            >
              {copied() ? 'Copied' : local.button.label}
            </button>
          )}
        >
          {(action) => (
            <button type="button" onClick={() => local.onAction?.(action())}>
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
  onAction: ((action: BlockKitLiteAction, selectedValue: string) => void) | undefined;
}): JSX.Element {
  const [local] = splitProps(props, ['select', 'onAction']);

  function handleChange(event: Event): void {
    const selectedValue = (event.currentTarget as HTMLSelectElement).value;
    if (!selectedValue || !local.select.action) return;
    local.onAction?.(local.select.action, selectedValue);
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
  const [local] = splitProps(props, ['block', 'open', 'onOpenChange', 'onAction']);

  return (
    <ModalShell
      open={local.open}
      title={local.block.title}
      description={local.block.text ?? undefined}
      onOpenChange={local.onOpenChange}
      closeLabel="Close block details"
    >
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
    </ModalShell>
  );
}
