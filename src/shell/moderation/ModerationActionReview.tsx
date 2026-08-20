// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Review-first confirmation for destructive room actions. Nothing is sent
 * until the labelled confirm control is used, and the confirm path invalidates
 * if the socket drops or room authority is lost.
 */
import { createMemo, createUniqueId, For, Show, splitProps, type JSX } from 'solid-js';
import { ModalShell } from '@/primitives';
import {
  validateModerationAction,
  type ModerationActionDraft,
  type NormalizedModerationAction,
} from '@/lib/moderation/actionModel';
import './moderation-desk.css';

export type ModerationActionReviewProps = {
  open: boolean;
  draft: ModerationActionDraft | null;
  actorNick: string;
  connected: boolean;
  canModerate: boolean;
  returnFocus?: HTMLElement | null;
  onConfirm: (action: NormalizedModerationAction) => void;
  onCancel: () => void;
};

export function ModerationActionReview(props: ModerationActionReviewProps): JSX.Element {
  const [local] = splitProps(props, [
    'open',
    'draft',
    'actorNick',
    'connected',
    'canModerate',
    'returnFocus',
    'onConfirm',
    'onCancel',
  ]);
  const instanceId = createUniqueId();
  const errorId = `moderation-review-errors-${instanceId}`;
  const statusId = `moderation-review-status-${instanceId}`;

  const validation = createMemo(() => {
    const draft = local.draft;
    if (!draft) return null;
    return validateModerationAction(draft, { actorNick: local.actorNick });
  });

  const review = createMemo(() => {
    const next = validation();
    return next?.ok ? next.review : null;
  });

  const errors = createMemo(() => {
    const next = validation();
    return next && !next.ok ? next.errors : ['Choose a valid action.'];
  });

  const blockedReason = createMemo(() => {
    if (!local.connected) return 'Reconnect to send this change. Your draft stays on this device.';
    if (!local.canModerate) return 'You no longer have moderator permission in this room.';
    return null;
  });

  const canSend = createMemo(() => !!review() && !blockedReason());

  function closeAndRestore(): void {
    local.onCancel();
  }

  function confirm(): void {
    const next = validation();
    if (!next?.ok || !canSend()) return;
    local.onConfirm(next.action);
  }

  return (
    <ModalShell
      open={local.open && !!local.draft}
      title={review()?.title ?? 'Review room action'}
      description="Nothing is sent until you confirm."
      closeLabel="Cancel room action"
      returnFocus={local.returnFocus}
      onOpenChange={(open) => {
        if (!open) closeAndRestore();
      }}
    >
      <div class="moderation-action-review__body" data-testid="moderation-action-review">
        <Show
          when={review()}
          fallback={
            <ul id={errorId} class="moderation-action-review__errors" role="alert">
              <For each={[...errors()]}>
                {(error) => <li>{error}</li>}
              </For>
            </ul>
          }
        >
          {(copy) => (
            <>
              <p class="moderation-action-review__summary">{copy().summary}</p>
              <p class="moderation-action-review__impact">{copy().impact}</p>
            </>
          )}
        </Show>
        <Show when={blockedReason()}>
          {(reason) => (
            <p id={statusId} class="moderation-action-review__status" role="status" data-testid="moderation-review-blocked">
              {reason()}
            </p>
          )}
        </Show>
        <div class="moderation-action-review__actions">
          <button type="button" onClick={closeAndRestore}>Cancel</button>
          <button
            type="button"
            class="moderation-cockpit__confirm-action"
            data-testid="moderation-review-confirm"
            disabled={!canSend()}
            aria-describedby={[blockedReason() ? statusId : '', review() ? '' : errorId]
              .filter(Boolean)
              .join(' ') || undefined}
            onClick={confirm}
          >
            {review()?.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
