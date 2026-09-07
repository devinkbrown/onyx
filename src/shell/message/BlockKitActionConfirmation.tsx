// SPDX-License-Identifier: AGPL-3.0-or-later
import { onMount, splitProps, type JSX } from 'solid-js';
import type { PreparedBlockKitAction } from '@/lib/integrations/blockKitLite';
import { ModalShell } from '@/primitives';
import './blockkit-commercial.css';

export const BLOCK_KIT_CONFIRM_TITLE = 'Send message from structured control?';
export const BLOCK_KIT_CONFIRM_DESCRIPTION =
  'Review the exact destination and plaintext. Nothing is sent until you confirm.';

type BlockKitActionConfirmationContentProps = {
  prepared: PreparedBlockKitAction;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Shared confirmation body used by inline controls and controls in detail modals. */
export function BlockKitActionConfirmationContent(
  props: BlockKitActionConfirmationContentProps,
): JSX.Element {
  const [local] = splitProps(props, ['prepared', 'onConfirm', 'onCancel']);
  let cancelRef: HTMLButtonElement | undefined;

  onMount(() => {
    // Inline confirmation also asks ModalShell to establish its focus trap. A
    // nested microtask runs after that setup; modal-detail confirmation uses the
    // same path even though its ModalShell was already open.
    queueMicrotask(() => queueMicrotask(() => cancelRef?.focus()));
  });

  return (
    <div class="shell-msg-blockkit-confirm" aria-label="Send review">
      <p class="shell-msg-blockkit-eyebrow">Action review</p>
      <p class="shell-msg-blockkit-confirm__intro">This is the exact request that will be sent. Check both destination and message before continuing.</p>
      <dl class="shell-msg-blockkit-confirm__preview">
        <div>
          <dt>Target</dt>
          <dd><code aria-label={`Destination ${local.prepared.target}`}>{local.prepared.target}</code></dd>
        </div>
        <div>
          <dt>Message</dt>
          <dd><pre>{local.prepared.text}</pre></dd>
        </div>
      </dl>
      <p class="shell-msg-blockkit-confirm__warning">
        This message will be sent as you.
      </p>
      <p class="shell-msg-blockkit-confirm__status" role="status" aria-live="polite">Waiting for your confirmation.</p>
      <div class="shell-msg-blockkit-confirm__actions">
        <button ref={cancelRef} type="button" onClick={() => local.onCancel()}>
          Cancel
        </button>
        <button type="button" class="shell-msg-blockkit-confirm__send" onClick={() => local.onConfirm()}>
          Send message
        </button>
      </div>
    </div>
  );
}

type BlockKitActionConfirmationDialogProps = BlockKitActionConfirmationContentProps & {
  open: boolean;
};

/** Accessible ModalShell wrapper for a confirmation staged from an inline block. */
export function BlockKitActionConfirmationDialog(
  props: BlockKitActionConfirmationDialogProps,
): JSX.Element {
  const [local] = splitProps(props, ['prepared', 'open', 'onConfirm', 'onCancel']);
  return (
    <ModalShell
      open={local.open}
      title={BLOCK_KIT_CONFIRM_TITLE}
      description={BLOCK_KIT_CONFIRM_DESCRIPTION}
      closeLabel="Cancel sending message"
      onOpenChange={(open) => {
        if (!open) local.onCancel();
      }}
    >
      <BlockKitActionConfirmationContent
        prepared={local.prepared}
        onConfirm={local.onConfirm}
        onCancel={local.onCancel}
      />
    </ModalShell>
  );
}
