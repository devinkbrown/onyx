// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Quiet harbor confirm for Block, plus an honest Report draft to #root.
 * Fraunces once. No kicker, no glass, no invented review inbox.
 */
import './person-safety-sheet.css';

import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';

import { savePersonReportReceipt } from '@/lib/people/personReportReceipt';
import {
  MAX_PERSON_REPORT_NOTE,
  PERSON_REPORT_REASONS,
  PERSON_REPORT_ROOM,
  formatPersonReportDraft,
  isPersonReportReason,
  personBlockBody,
  personBlockTitle,
  personReportDraftToast,
  personReportHonesty,
  personReportTitle,
  type PersonReportReasonId,
} from '@/lib/people/personSafety';
import { getState, selectDeviceMemoryOwner } from '@/lib/store';
import { Button } from '@/primitives/index';
import { createDialogFocus } from '@/primitives/focusTrap';

import {
  closePersonSafety,
  personSafetyPending,
} from './personSafetyState';

export function PersonSafetyHost() {
  const pending = createMemo(() => personSafetyPending());
  const [reason, setReason] = createSignal<PersonReportReasonId>('harassment');
  const [note, setNote] = createSignal('');
  let panelRef: HTMLElement | undefined;

  createDialogFocus({
    isOpen: () => pending() !== null,
    getPanel: () => panelRef,
    onEscape: () => closePersonSafety(),
  });

  createEffect(() => {
    const current = pending();
    if (current?.kind !== 'report') return;
    setReason('harassment');
    setNote('');
  });

  const title = createMemo(() => {
    const current = pending();
    if (!current) return '';
    return current.kind === 'block'
      ? personBlockTitle(current.nick)
      : personReportTitle(current.nick);
  });

  const body = createMemo(() => {
    const current = pending();
    if (!current) return '';
    return current.kind === 'block'
      ? personBlockBody(current.nick)
      : personReportHonesty();
  });

  function confirmBlock(): void {
    const current = pending();
    if (!current || current.kind !== 'block') return;
    getState().ignoreUser(current.nick);
    getState().addToast({
      variant: 'info',
      title: `Blocked ${current.nick}`,
      description: personBlockBody(current.nick),
    });
    closePersonSafety();
  }

  function submitReport(): void {
    const current = pending();
    if (!current || current.kind !== 'report') return;
    const chosen = reason();
    if (!isPersonReportReason(chosen)) return;
    const snapshot = getState();
    const draft = formatPersonReportDraft({
      nick: current.nick,
      reason: chosen,
      note: note(),
      from: snapshot.ourNick,
      guest: current.guest,
    });
    savePersonReportReceipt({
      nick: current.nick,
      reason: chosen,
      draft,
    }, selectDeviceMemoryOwner(snapshot) ?? undefined);
    if (snapshot.connectionStatus !== 'connected' || !snapshot.client) {
      snapshot.addToast({
        variant: 'warning',
        title: 'Could not open #root',
        description: 'You are offline. Your existing local draft was preserved; reconnect and draft this report in shared #root.',
      });
      setNote('');
      setReason('harassment');
      closePersonSafety();
      return;
    }
    snapshot.joinChannel(PERSON_REPORT_ROOM);
    // Keep anything already written in the shared report room. This is a
    // local draft handoff only; the user reviews and sends it themselves.
    snapshot.injectComposerText(PERSON_REPORT_ROOM, draft, 'append');
    snapshot.navigate({ kind: 'channel', channel: PERSON_REPORT_ROOM });
    snapshot.addToast({
      variant: 'info',
      ...personReportDraftToast(),
    });
    setNote('');
    setReason('harassment');
    closePersonSafety();
  }

  return (
    <Show when={pending()}>
      {(current) => (
        <Portal>
          <div class="person-safety" role="presentation" data-testid="person-safety">
            <div
              class="person-safety__backdrop"
              aria-hidden="true"
              onClick={() => closePersonSafety()}
            />
            <section
              ref={panelRef}
              class="person-safety__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="person-safety-title"
              aria-describedby="person-safety-body"
              tabindex="-1"
              data-kind={current().kind}
            >
              <h2 id="person-safety-title" class="person-safety__title">
                {title()}
              </h2>
              <p id="person-safety-body" class="person-safety__body">
                {body()}
              </p>
              <Show when={current().guest}>
                <p class="person-safety__guest">Guest</p>
              </Show>

              <Show when={current().kind === 'report'}>
                <div
                  class="person-safety__reasons"
                  role="radiogroup"
                  aria-label="What happened"
                >
                  <For each={[...PERSON_REPORT_REASONS]}>
                    {(entry) => (
                      <label class="person-safety__reason">
                        <input
                          type="radio"
                          name="person-report-reason"
                          value={entry.id}
                          checked={reason() === entry.id}
                          onChange={() => setReason(entry.id)}
                        />
                        {entry.label}
                      </label>
                    )}
                  </For>
                </div>
                <label class="person-safety__note-label" for="person-report-note">
                  Optional note
                </label>
                <textarea
                  id="person-report-note"
                  class="person-safety__note"
                  data-testid="person-report-note"
                  maxlength={MAX_PERSON_REPORT_NOTE}
                  value={note()}
                  onInput={(event) => setNote(event.currentTarget.value)}
                />
              </Show>

              <div class="person-safety__actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  data-testid="person-safety-cancel"
                  onClick={() => closePersonSafety()}
                >
                  Never mind
                </Button>
                <Show
                  when={current().kind === 'block'}
                  fallback={
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      data-testid="person-report-submit"
                      onClick={submitReport}
                    >
                      Draft the note
                    </Button>
                  }
                >
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    data-testid="person-block-confirm"
                    onClick={confirmBlock}
                  >
                    Block
                  </Button>
                </Show>
              </div>
            </section>
          </div>
        </Portal>
      )}
    </Show>
  );
}
