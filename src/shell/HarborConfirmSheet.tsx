// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Quiet harbor confirm for Leave room and Close conversation.
 * Fraunces once. One sentence. No MODE dump, no kicker, no glass.
 */
import './harbor-confirm-sheet.css';
import { Show, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { getState } from '@/lib/store';
import { ROOM_VERB_COPY } from '@/lib/roomListVerbs';
import { Button } from '@/primitives/index';
import { createDialogFocus } from '@/primitives/focusTrap';
import {
  closeRoomVerbConfirm,
  roomVerbConfirm,
} from './roomVerbConfirm';

export function HarborConfirmHost() {
  const pending = createMemo(() => roomVerbConfirm());
  let panelRef: HTMLElement | undefined;

  createDialogFocus({
    isOpen: () => pending() !== null,
    getPanel: () => panelRef,
    onEscape: () => closeRoomVerbConfirm(),
  });

  const title = createMemo(() => {
    const current = pending();
    if (!current) return '';
    return current.kind === 'leave'
      ? ROOM_VERB_COPY.leave.title(current.channel)
      : ROOM_VERB_COPY.closeConversation.title;
  });

  const body = createMemo(() => {
    const current = pending();
    if (!current) return '';
    return current.kind === 'leave'
      ? ROOM_VERB_COPY.leave.body(current.channel)
      : ROOM_VERB_COPY.closeConversation.body;
  });

  const confirmLabel = createMemo(() => {
    const current = pending();
    return current?.kind === 'leave'
      ? ROOM_VERB_COPY.leave.confirm
      : ROOM_VERB_COPY.closeConversation.confirm;
  });

  const cancelLabel = createMemo(() => {
    const current = pending();
    return current?.kind === 'leave'
      ? ROOM_VERB_COPY.leave.cancel
      : ROOM_VERB_COPY.closeConversation.cancel;
  });

  function confirm(): void {
    const current = pending();
    if (!current) return;
    if (current.kind === 'leave') {
      getState().partChannel(current.channel);
      getState().addToast({
        variant: 'info',
        title: `Left ${current.channel}`,
        description: 'History stays on this device.',
      });
    } else {
      getState().closeConversation(current.nick);
      getState().addToast({
        variant: 'info',
        title: ROOM_VERB_COPY.closeConversation.label,
        description: ROOM_VERB_COPY.closeConversation.body,
      });
    }
    closeRoomVerbConfirm();
  }

  return (
    <Show when={pending()}>
      {(current) => (
        <Portal>
          <div class="harbor-confirm" role="presentation" data-testid="harbor-confirm">
            <div
              class="harbor-confirm__backdrop"
              aria-hidden="true"
              onClick={() => closeRoomVerbConfirm()}
            />
            <section
              ref={panelRef}
              class="harbor-confirm__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="harbor-confirm-title"
              aria-describedby="harbor-confirm-body"
              tabindex="-1"
              data-kind={current().kind}
            >
              <h2 id="harbor-confirm-title" class="harbor-confirm__title">
                {title()}
              </h2>
              <p id="harbor-confirm-body" class="harbor-confirm__body">
                {body()}
              </p>
              <div class="harbor-confirm__actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  data-testid="harbor-confirm-cancel"
                  onClick={() => closeRoomVerbConfirm()}
                >
                  {cancelLabel()}
                </Button>
                <Button
                  type="button"
                  variant={current().kind === 'leave' ? 'danger' : 'primary'}
                  size="md"
                  data-testid={
                    current().kind === 'leave'
                      ? 'harbor-leave-confirm'
                      : 'harbor-close-confirm'
                  }
                  onClick={confirm}
                >
                  {confirmLabel()}
                </Button>
              </div>
            </section>
          </div>
        </Portal>
      )}
    </Show>
  );
}
