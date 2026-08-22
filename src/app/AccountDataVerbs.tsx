// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AccountDataVerbs — Download what we store / Save this device's history /
 * Delete account. Three buttons, three jobs. Not a "Your data" bundle.
 */
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';

import { getState, selectDeviceMemoryOwner, useStore } from '@/lib/store';
import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import {
  ACCOUNT_DATA_VERB_COPY,
  buildAccountStoreRecord,
  collectDeviceHistoryCopy,
  downloadAccountStoreRecord,
  downloadDeviceHistoryCopy,
} from '@/lib/export/accountDataVerbs';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Sheet } from '@/primitives/index';

export type AccountDataVerbsProps = {
  account: string;
  active: boolean;
  onDeleted?: () => void;
};

export function AccountDataVerbs(props: AccountDataVerbsProps): JSX.Element {
  const owner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );
  const [busy, setBusy] = createSignal<'store' | 'history' | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);
  const [dropConfirm, setDropConfirm] = createSignal('');
  const [dropPassword, setDropPassword] = createSignal('');
  const [dropArmed, setDropArmed] = createSignal(false);
  let epoch = 0;
  let disposed = false;

  const clearDrop = (): void => {
    setDropConfirm('');
    setDropPassword('');
    setDropArmed(false);
  };

  createEffect(() => {
    const open = props.active;
    const account = props.account;
    const current = owner();
    const ownerKey = current ? deviceMemoryOwnerKey(current) : account;
    epoch += 1;
    clearDrop();
    setBusy(null);
    setStatus(null);
    if (!open) return;
    void ownerKey;
  });

  onCleanup(() => {
    disposed = true;
    epoch += 1;
  });

  const dropReady = createMemo(() =>
    dropArmed()
    && dropConfirm().trim() === props.account
    && !!dropPassword(),
  );

  function downloadStore(): void {
    if (busy()) return;
    const epochNow = ++epoch;
    setBusy('store');
    setStatus(null);
    try {
      const state = getState();
      const record = buildAccountStoreRecord({
        nick: state.ourNick || state.server?.nick,
        account: state.server?.account ?? props.account,
        email: state.accountInfo?.email,
        registeredAt: state.accountInfo?.registered,
        rooms: state.channels.values(),
      });
      const ok = downloadAccountStoreRecord(record);
      if (disposed || epochNow !== epoch) return;
      setStatus(ok
        ? 'Downloaded the account record.'
        : 'Could not download the account record.');
    } finally {
      if (!disposed && epochNow === epoch) setBusy(null);
    }
  }

  async function saveHistory(): Promise<void> {
    if (busy()) return;
    const epochNow = ++epoch;
    setBusy('history');
    setStatus(null);
    try {
      const copy = await collectDeviceHistoryCopy(owner() ?? undefined);
      if (disposed || epochNow !== epoch) return;
      const ok = downloadDeviceHistoryCopy(copy);
      if (disposed || epochNow !== epoch) return;
      setStatus(ok
        ? "Saved this device's history."
        : "Could not save this device's history.");
    } catch {
      if (!disposed && epochNow === epoch) {
        setStatus("Could not save this device's history.");
      }
    } finally {
      if (!disposed && epochNow === epoch) setBusy(null);
    }
  }

  function submitDrop(event: SubmitEvent): void {
    event.preventDefault();
    if (!dropReady()) return;
    getState().dropAccount(props.account, dropPassword());
    clearDrop();
    props.onDeleted?.();
  }

  return (
    <div class="acct-data-verbs" data-testid="account-data-verbs">
      <section
        class="acct-section"
        aria-labelledby="acct-download-store-title"
        aria-describedby="acct-download-store-hint"
      >
        <div class="acct-section-head">
          <h3 class="acct-section-title" id="acct-download-store-title">
            {ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.title}
          </h3>
          <p class="acct-section-hint" id="acct-download-store-hint">
            {ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.hint}
            {' '}
            {ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.historyNote}
          </p>
        </div>
        <div class="acct-section-body">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy() !== null}
            aria-busy={busy() === 'store'}
            data-testid="account-download-store"
            onClick={downloadStore}
          >
            {busy() === 'store'
              ? 'Preparing…'
              : ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.action}
          </Button>
        </div>
      </section>

      <section
        class="acct-section"
        aria-labelledby="acct-save-device-history-title"
        aria-describedby="acct-save-device-history-hint"
      >
        <div class="acct-section-head">
          <h3 class="acct-section-title" id="acct-save-device-history-title">
            {ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.title}
          </h3>
          <p class="acct-section-hint" id="acct-save-device-history-hint">
            {ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.hint}
          </p>
        </div>
        <div class="acct-section-body">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy() !== null}
            aria-busy={busy() === 'history'}
            data-testid="account-save-device-history"
            onClick={() => void saveHistory()}
          >
            {busy() === 'history'
              ? 'Preparing…'
              : ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.action}
          </Button>
        </div>
      </section>

      <section
        class="acct-section acct-danger"
        aria-labelledby="acct-delete-account-title"
        aria-describedby="acct-delete-account-hint"
      >
        <div class="acct-section-head">
          <h3 class="acct-section-title acct-danger-title" id="acct-delete-account-title">
            {ACCOUNT_DATA_VERB_COPY.deleteAccount.title}
          </h3>
          <p class="acct-section-hint" id="acct-delete-account-hint">
            {ACCOUNT_DATA_VERB_COPY.deleteAccount.hint}
          </p>
        </div>
        <div class="acct-section-body">
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setDropArmed(true)}
            data-testid="account-drop-arm"
          >
            {ACCOUNT_DATA_VERB_COPY.deleteAccount.action}…
          </Button>
        </div>
      </section>

      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="account-data-verbs-status"
      >
        {status() ?? ''}
      </span>

      <Sheet
        data-testid="account-delete-sheet"
        data-acct-sheet="delete"
        open={dropArmed()}
        title={ACCOUNT_DATA_VERB_COPY.deleteAccount.title}
        description={ACCOUNT_DATA_VERB_COPY.deleteAccount.hint}
        closeLabel="Cancel account deletion"
        onOpenChange={(open) => {
          if (!open) clearDrop();
        }}
      >
        <form class="acct-delete-sheet__form" onSubmit={submitDrop} noValidate aria-label="Confirm account deletion">
          <FormField
            id="acct-drop-confirm"
            label={`Type "${props.account}" to confirm`}
            type="text"
            autocomplete="off"
            placeholder={props.account}
            value={dropConfirm()}
            onInput={(e) => setDropConfirm(e.currentTarget.value)}
          />
          <div class="onyx-field acct-password">
            <label class="onyx-field__label" for="acct-drop-password">Account password</label>
            <input
              id="acct-drop-password"
              class="onyx-field__input"
              type="password"
              autocomplete="current-password"
              placeholder="account password"
              value={dropPassword()}
              data-testid="account-drop-password"
              onInput={(e) => setDropPassword(e.currentTarget.value)}
            />
          </div>
          <div class="acct-danger-actions">
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={!dropReady()}
              data-testid="account-drop-confirm"
            >
              {ACCOUNT_DATA_VERB_COPY.deleteAccount.confirmAction}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearDrop}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
