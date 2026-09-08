// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  For,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  untrack,
  type JSX,
} from 'solid-js';
import { prefersReducedMotionForInteraction } from '@/lib/a11y/reducedMotion';
import {
  closeMessageSearch,
  MESSAGE_SEARCH_QUERY_MAX,
  useMessageSearch,
  type VaultSearchMode,
} from './useMessageSearch';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';
import {
  deleteSearch,
  listSearches,
  saveSearch,
  subscribeSavedSearches,
  type SavedSearch,
} from '@/lib/vault/savedSearches';
import { openPreferences } from '@/lib/prefs/preferences';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { selectDeviceMemoryOwner, useStore } from '@/lib/store';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import './message-search.css';

export type SavedSearchPersistence = {
  listSearches: typeof listSearches;
  saveSearch: typeof saveSearch;
  deleteSearch: typeof deleteSearch;
  subscribeSavedSearches?: typeof subscribeSavedSearches;
};

export type MessageSearchProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** Deterministic persistence seam for lifecycle/race tests. */
  savedSearchPersistence?: SavedSearchPersistence;
};

const DEFAULT_SAVED_SEARCH_PERSISTENCE: SavedSearchPersistence = {
  listSearches,
  saveSearch,
  deleteSearch,
  subscribeSavedSearches,
};

const INPUT_ID = 'onyx-message-search-input';
const SEARCH_STATUS_ID = 'onyx-message-search-status';
const SEARCH_HELP_ID = 'onyx-message-search-help';
const SERVER_RESULTS_ID = 'onyx-message-search-server-results';
const VAULT_RESULTS_ID = 'onyx-message-search-vault-results';

/** Segmented device-recall matching modes, ordered richest-first. */
const VAULT_MODE_OPTIONS: ReadonlyArray<{ mode: VaultSearchMode; label: string; title: string }> = [
  {
    mode: 'hybrid',
    label: 'Text + related',
    title: 'Device recall: exact text first, then related token matches — all on this device',
  },
  {
    mode: 'exact',
    label: 'Exact',
    title: 'Device recall: literal text only — all on this device',
  },
  {
    mode: 'semantic',
    label: 'Related terms',
    title: 'Device recall: related terms ranked by token similarity — all on this device',
  },
];

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function scrollToMessage(messageId: string): number | undefined {
  const selector = `[data-message-search-id="${cssEscape(messageId)}"]`;
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) return undefined;

  node.scrollIntoView({
    block: 'center',
    behavior: prefersReducedMotionForInteraction() ? 'auto' : 'smooth',
  });

  node.classList.remove('shell-msg-search-pulse');
  void node.offsetWidth;
  node.classList.add('shell-msg-search-pulse');

  return window.setTimeout(() => {
    node.classList.remove('shell-msg-search-pulse');
  }, 950);
}

export function MessageSearch(props: MessageSearchProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class', 'savedSearchPersistence']);
  const search = useMessageSearch();
  const savedStore = createMemo<SavedSearchPersistence>(() => (
    local.savedSearchPersistence ?? DEFAULT_SAVED_SEARCH_PERSISTENCE
  ));
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );
  let inputRef: HTMLInputElement | undefined;
  let closeRef: HTMLButtonElement | undefined;
  let pulseTimer: number | undefined;
  let disposed = false;
  let savedOpenEpoch = 0;
  let savedOperationSeq = 0;
  let savedRefreshSeq = 0;
  const [savedSearches, setSavedSearches] = createSignal<SavedSearch[]>([]);
  const [savedLabel, setSavedLabel] = createSignal('');
  const [savedStatus, setSavedStatus] = createSignal<
    'idle' | 'refreshing' | 'saving' | 'deleting' | 'success' | 'error'
  >('idle');
  const [savedStatusMessage, setSavedStatusMessage] = createSignal('');
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const savedBusy = createMemo(() => (
    savedStatus() === 'saving'
    || savedStatus() === 'deleting'
  ));

  const countLabel = createMemo(() => {
    if (!search.hasConversation()) {
      if (!search.localHistoryEnabled()) return 'History off';
      const remembered = search.vaultResults().length;
      return `${remembered} remembered`;
    }
    return search.resultCount() > 0
      ? `${search.activePosition()} of ${search.resultCount()}`
      : '0 of 0';
  });

  const announcedQuery = createMemo(() => {
    const query = search.query().trim();
    if (!query) return '';
    const codePoints = Array.from(query);
    const bounded = codePoints.length > 80 ? `${codePoints.slice(0, 79).join('')}…` : query;
    return `“${bounded}”`;
  });

  const statusLabel = createMemo(() => {
    if (!search.query().trim()) return `Search ${search.targetLabel()}`;
    if (!search.hasConversation()) return '';
    if (search.resultCount() === 0) {
      return `No visible matches for ${announcedQuery()} in ${search.targetLabel()}`;
    }
    return `${countLabel()} for ${announcedQuery()} in ${search.targetLabel()}`;
  });

  const serverLifecycleLabel = createMemo(() => {
    const status = search.serverStatus();
    if (status === 'idle') return '';
    if (status === 'pending') {
      return `Searching full server history for ${announcedQuery()} in ${search.targetLabel()}`;
    }
    if (status === 'error') {
      return `Full-history search failed. ${search.serverError() ?? 'Search failed.'}`;
    }
    const count = search.serverResults().length;
    const completion = count === 0
      ? 'Full-history search complete with no archived matches.'
      : `Full-history search complete with ${count} archived match${count === 1 ? '' : 'es'}.`;
    return [completion, search.serverNotice()].filter(Boolean).join(' ');
  });

  const vaultLifecycleLabel = createMemo(() => {
    if (!search.query().trim() || search.query().trim().length < 2) return '';
    const status = search.vaultStatus();
    if (status === 'idle') return '';
    if (status === 'pending') return `Searching device memory for ${announcedQuery()}.`;
    if (status === 'error') return 'Device-memory search could not be completed.';
    const count = search.vaultResults().length;
    return count === 0
      ? 'Device-memory search complete with no remembered matches.'
      : `Device-memory search complete with ${count} remembered match${count === 1 ? '' : 'es'}.`;
  });

  const controlledResults = createMemo(() => {
    const ids: string[] = [];
    if (search.serverResults().length > 0) ids.push(SERVER_RESULTS_ID);
    if (search.vaultResults().length > 0) ids.push(VAULT_RESULTS_ID);
    return ids.length > 0 ? ids.join(' ') : undefined;
  });

  function savedOperationCurrent(
    epoch: number,
    operation: number,
    owner: DeviceMemoryOwner,
  ): boolean {
    const currentOwner = memoryOwner();
    return !disposed
      && search.isOpen()
      && epoch === savedOpenEpoch
      && operation === savedOperationSeq
      && currentOwner?.serverUrl === owner.serverUrl
      && currentOwner.identity === owner.identity;
  }

  async function refreshSavedSearches(
    epoch: number,
    operation: number,
    owner: DeviceMemoryOwner,
  ): Promise<'applied' | 'failed' | 'stale'> {
    const refresh = ++savedRefreshSeq;
    let rows: SavedSearch[];
    try {
      rows = await savedStore().listSearches(owner);
    } catch {
      if (
        disposed
        || !search.isOpen()
        || epoch !== savedOpenEpoch
        || operation !== savedOperationSeq
        || refresh !== savedRefreshSeq
        || !savedOperationCurrent(epoch, operation, owner)
      ) return 'stale';
      return 'failed';
    }
    if (
      disposed
      || !search.isOpen()
      || epoch !== savedOpenEpoch
      || operation !== savedOperationSeq
      || refresh !== savedRefreshSeq
      || !savedOperationCurrent(epoch, operation, owner)
    ) return 'stale';
    setSavedSearches(rows);
    return 'applied';
  }

  createEffect(() => {
    const subscribe = savedStore().subscribeSavedSearches;
    if (!subscribe) return;
    onCleanup(subscribe(() => {
      untrack(() => {
        if (disposed || !search.isOpen() || savedBusy()) return;
        const owner = memoryOwner();
        if (!owner) {
          setSavedSearches([]);
          return;
        }
        const epoch = savedOpenEpoch;
        const operation = savedOperationSeq;
        setSavedStatus('refreshing');
        setSavedStatusMessage('Refreshing saved searches after an on-device change…');
        void (async () => {
          const result = await refreshSavedSearches(epoch, operation, owner);
          if (!savedOperationCurrent(epoch, operation, owner) || result === 'stale') return;
          if (result === 'failed') {
            setSavedStatus('error');
            setSavedStatusMessage('Saved searches changed, but this browser could not refresh the list.');
            return;
          }
          setSavedStatus('success');
          setSavedStatusMessage('Saved searches updated on this device.');
        })();
      });
    }));
  });

  createEffect(() => {
    const open = search.isOpen();
    const owner = memoryOwner();
    const epoch = ++savedOpenEpoch;
    const operation = ++savedOperationSeq;
    savedRefreshSeq += 1;
    if (!open || !owner) {
      // The label is a draft for the current query, not a persisted preference.
      // Dropping it with the query prevents a private/irrelevant name from
      // resurfacing when the always-mounted search overlay opens later.
      setSavedLabel('');
      setSavedStatus('idle');
      setSavedStatusMessage('');
      setSavedSearches([]);
      setAdvancedOpen(false);
      return;
    }

    setSavedStatus('refreshing');
    setSavedStatusMessage('Refreshing saved searches…');
    void (async () => {
      const result = await refreshSavedSearches(epoch, operation, owner);
      if (!savedOperationCurrent(epoch, operation, owner) || result === 'stale') return;
      if (result === 'failed') {
        setSavedStatus('error');
        setSavedStatusMessage('This browser could not refresh saved searches.');
        return;
      }
      setSavedStatus('success');
      setSavedStatusMessage('Saved searches refreshed.');
    })();
  });

  async function saveCurrentSearch(): Promise<void> {
    const label = savedLabel().trim();
    const query = search.query().trim();
    const mode = search.vaultMode();
    const target = search.targetLabel();
    if (!label || query.length < 2 || savedBusy()) return;
    const owner = memoryOwner();
    if (!owner) {
      setSavedStatus('error');
      setSavedStatusMessage('An active account or guest identity is required to save this search.');
      return;
    }
    const epoch = savedOpenEpoch;
    const operation = ++savedOperationSeq;
    savedRefreshSeq += 1;
    setSavedStatus('saving');
    setSavedStatusMessage(`Saving ${label}…`);
    let saved: SavedSearch | null;
    try {
      saved = await savedStore().saveSearch({ label, query, mode }, owner);
    } catch {
      saved = null;
    }
    if (!savedOperationCurrent(epoch, operation, owner)) return;
    if (!saved) {
      setSavedStatus('error');
      setSavedStatusMessage('This browser could not save the search.');
      return;
    }
    const refreshed = await refreshSavedSearches(epoch, operation, owner);
    if (!savedOperationCurrent(epoch, operation, owner) || refreshed === 'stale') return;
    if (refreshed === 'failed') {
      setSavedStatus('error');
      setSavedStatusMessage('The search was saved, but this browser could not refresh the list.');
      return;
    }

    const contextUnchanged = search.query().trim() === query
      && search.vaultMode() === mode
      && search.targetLabel() === target;
    if (!contextUnchanged) {
      setSavedStatus('idle');
      setSavedStatusMessage('');
      return;
    }
    if (savedLabel().trim() === label) setSavedLabel('');
    setSavedStatus('success');
    setSavedStatusMessage(`Saved search ${label}.`);
  }

  function handleSave(event: SubmitEvent): void {
    event.preventDefault();
    void saveCurrentSearch();
  }

  function runSavedSearch(saved: SavedSearch): void {
    search.setVaultMode(saved.mode);
    search.setQuery(saved.query);
  }

  async function removeSavedSearch(saved: SavedSearch): Promise<void> {
    if (savedBusy()) return;
    const owner = memoryOwner();
    if (!owner) {
      setSavedStatus('error');
      setSavedStatusMessage('An active account or guest identity is required to delete this saved search.');
      return;
    }
    const epoch = savedOpenEpoch;
    const operation = ++savedOperationSeq;
    savedRefreshSeq += 1;
    setSavedStatus('deleting');
    setSavedStatusMessage(`Deleting ${saved.label}…`);
    let deleted: boolean;
    try {
      deleted = await savedStore().deleteSearch(saved.id, owner);
    } catch {
      deleted = false;
    }
    if (!savedOperationCurrent(epoch, operation, owner)) return;
    // A false result means the storage layer could not verify deletion by
    // readback. Keep the currently rendered row instead of replacing it with
    // an ambiguous empty/error fallback.
    if (!deleted) {
      setSavedStatus('error');
      setSavedStatusMessage('This browser could not delete the saved search.');
      return;
    }
    const refreshed = await refreshSavedSearches(epoch, operation, owner);
    if (!savedOperationCurrent(epoch, operation, owner) || refreshed === 'stale') return;
    if (refreshed === 'failed') {
      setSavedStatus('error');
      setSavedStatusMessage('The search was deleted, but this browser could not refresh the list.');
      return;
    }
    setSavedStatus('success');
    setSavedStatusMessage(`Deleted saved search ${saved.label}.`);
  }

  createEffect(() => {
    const open = search.isOpen();
    const request = search.focusRequest();
    if (!open) return;
    queueMicrotask(() => {
      if (!search.isOpen() || request !== search.focusRequest()) return;
      if (inputRef && !inputRef.disabled) {
        inputRef.focus({ preventScroll: true });
        inputRef.select();
        return;
      }
      closeRef?.focus({ preventScroll: true });
    });
  });

  createEffect(() => {
    const result = search.activeResult();
    if (!search.isOpen() || !result) return;

    queueMicrotask(() => {
      if (pulseTimer !== undefined) window.clearTimeout(pulseTimer);
      pulseTimer = scrollToMessage(result.id);
    });
  });

  onCleanup(() => {
    disposed = true;
    if (pulseTimer !== undefined) window.clearTimeout(pulseTimer);
    savedOpenEpoch += 1;
    savedOperationSeq += 1;
    savedRefreshSeq += 1;
  });

  const timeLabel = (time: Date) =>
    time.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const commitInputQuery = (value: string): void => {
    search.setQuery(value);
  };

  const handleInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (event) => {
    if (event.isComposing) return;
    commitInputQuery(event.currentTarget.value);
  };

  const handleCompositionEnd: JSX.EventHandlerUnion<HTMLInputElement, CompositionEvent> = (event) => {
    commitInputQuery(event.currentTarget.value);
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

    if (
      event.key === 'Enter'
      && (event.ctrlKey || event.metaKey)
      && !event.shiftKey
      && !event.altKey
    ) {
      event.preventDefault();
      search.runServerSearch();
      return;
    }
    if (
      event.key === 'Enter'
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
    ) {
      event.preventDefault();
      if (event.shiftKey) {
        search.previous();
      } else {
        search.next();
      }
    }
  };

  const handleSearchKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeMessageSearch();
  };

  return (
    <Show when={search.isOpen()}>
      <div
        {...rest}
        class={['onyx-message-search', local.class].filter(Boolean).join(' ')}
        role="search"
        aria-label="Message search"
        onKeyDown={handleSearchKeyDown}
      >
        <div class="onyx-message-search__surface">
          <div class="onyx-message-search__query-field">
            <label class="sr-only" for={INPUT_ID}>Search messages</label>
            <input
              ref={inputRef}
              id={INPUT_ID}
              class="onyx-message-search__input"
              type="search"
              value={search.query()}
              maxlength={MESSAGE_SEARCH_QUERY_MAX}
              autocomplete="off"
              spellcheck={false}
              aria-label="Search messages"
              aria-describedby={`${SEARCH_STATUS_ID} ${SEARCH_HELP_ID}`}
              aria-controls={controlledResults()}
              aria-keyshortcuts="Enter Shift+Enter Control+Enter Meta+Enter Escape"
              placeholder={search.hasConversation()
                ? `Find messages in ${search.targetLabel()}`
                : search.localHistoryEnabled()
                  ? 'Search messages saved on this device'
                  : 'Device history is turned off'}
              disabled={!search.hasConversation() && !search.localHistoryEnabled()}
              onInput={handleInput}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleKeyDown}
            />
            <span class="onyx-message-search__count" aria-hidden="true">
              {countLabel()}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            class="onyx-message-search__button onyx-message-search__button--close"
            aria-label="Close search"
            aria-keyshortcuts="Escape"
            title="Close search"
            onClick={() => closeMessageSearch()}
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
        <div class="onyx-message-search__body">
          <div class="onyx-message-search__target" data-testid="message-search-target">
            <span class="onyx-message-search__target-kicker">Searching in</span>
            {' '}
            <strong>{search.targetLabel()}</strong>
            <ProvenanceBadge
              scope="device"
              subject="Visible message search"
              class="onyx-message-search__provenance"
            />
          </div>
          <div class="onyx-message-search__controls" role="group" aria-label="Search result navigation">
            <button
              type="button"
              class="onyx-message-search__button"
              aria-label="Previous match"
              title="Previous match"
              disabled={search.resultCount() === 0}
              onClick={() => search.previous()}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M8 13V3" />
                <path d="M4.5 6.5 8 3l3.5 3.5" />
              </svg>
            </button>
            <button
              type="button"
              class="onyx-message-search__button"
              aria-label="Next match"
              title="Next match"
              disabled={search.resultCount() === 0}
              onClick={() => search.next()}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M8 3v10" />
                <path d="M4.5 9.5 8 13l3.5-3.5" />
              </svg>
            </button>
          </div>
          <Show when={/^[#&]/.test(search.targetLabel())}>
            <a
              class="onyx-message-search__ledger"
              href={statsRoomHref(search.targetLabel())}
              aria-label={`Room ledger for ${search.targetLabel()}`}
            >
              Room ledger
            </a>
          </Show>
          <Show when={!search.hasConversation() && !search.localHistoryEnabled()}>
            <div class="onyx-message-search__history-off" role="status">
              <span>Device history is off, so there are no remembered conversations to search.</span>
              <button
                type="button"
                class="onyx-message-search__deep"
                onClick={() => {
                  closeMessageSearch();
                  openPreferences('history');
                }}
              >
                Open history preferences
              </button>
            </div>
          </Show>
          <Show when={savedSearches().length > 0 || search.query().trim().length >= 2}>
            <section class="onyx-message-search__saved" aria-label="Saved searches">
              <div class="onyx-message-search__saved-bar">
                <strong class="onyx-message-search__section-title">Saved searches</strong>
                <ProvenanceBadge scope="device" subject="Saved searches" />
                <span class="onyx-message-search__vault-label">Saved on this device</span>
                <span class="onyx-message-search__server-count">
                  {savedSearches().length} saved
                </span>
              </div>
              <Show when={search.query().trim().length >= 2}>
                <form class="onyx-message-search__save-form" onSubmit={handleSave}>
                  <label class="sr-only" for="onyx-message-search-save-label">Saved search name</label>
                  <input
                    id="onyx-message-search-save-label"
                    class="onyx-message-search__save-input"
                    value={savedLabel()}
                    maxlength="120"
                    placeholder="Name this device search"
                    onInput={(event) => setSavedLabel(event.currentTarget.value)}
                  />
                  <button
                    type="submit"
                    class="onyx-message-search__deep"
                    disabled={!savedLabel().trim() || savedBusy()}
                  >
                    {savedStatus() === 'saving' ? 'Saving…' : 'Save search'}
                  </button>
                </form>
              </Show>
              <Show when={savedSearches().length > 0}>
                <ul class="onyx-message-search__saved-list" aria-label="Saved search list">
                  <For each={savedSearches()}>
                    {(saved) => (
                      <li class="onyx-message-search__saved-row">
                        <button
                          type="button"
                          class="onyx-message-search__saved-run"
                          onClick={() => runSavedSearch(saved)}
                          aria-label={`Run saved search ${saved.label}`}
                        >
                          <strong>{saved.label}</strong>
                          <span>{saved.query}</span>
                          <small>
                            {saved.mode === 'exact'
                              ? 'Exact text'
                              : saved.mode === 'hybrid'
                                ? 'Text + related terms'
                                : 'Related terms'}
                          </small>
                        </button>
                        <button
                          type="button"
                          class="onyx-message-search__saved-delete"
                          onClick={() => void removeSavedSearch(saved)}
                          aria-label={`Delete saved search ${saved.label}`}
                          disabled={savedBusy()}
                        >
                          {savedStatus() === 'deleting' ? 'Deleting…' : 'Delete'}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </Show>
          <p
            class={savedStatus() === 'error' ? 'onyx-message-search__server-error' : 'sr-only'}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {savedStatusMessage()}
          </p>
          <Show when={search.recallSuggestions().length > 0}>
            <div class="onyx-message-search__recall" role="group" aria-label="Device recall terms">
              <ProvenanceBadge scope="device" subject="Search recall terms" />
              <For each={search.recallSuggestions()}>
                {(term) => (
                  <button
                    type="button"
                    class="onyx-message-search__recall-chip"
                    onClick={() => search.applyRecallSuggestion(term)}
                  >
                    {term}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={
            search.query().trim().length > 0
            && !search.serverSearchBlockedByE2ee()
            && (search.canServerSearch() || search.serverStatus() !== 'idle')
          }>
            <div
              class="onyx-message-search__server"
              data-testid="server-search"
              aria-busy={search.serverStatus() === 'pending'}
            >
              <div class="onyx-message-search__server-bar">
                <strong class="onyx-message-search__section-title">Archived history</strong>
                <ProvenanceBadge scope="server" subject="Archived message search" />
                <button
                  type="button"
                  class="onyx-message-search__deep"
                  disabled={!search.canServerSearch() || search.serverStatus() === 'pending'}
                  onClick={() => search.runServerSearch()}
                  title="Search the server's full history for this conversation (Ctrl+Enter)"
                >
                  {search.serverStatus() === 'pending'
                    ? 'Searching archived history…'
                    : 'Search full server history'}
                </button>
                <Show when={search.serverStatus() === 'done'}>
                  <span class="onyx-message-search__server-count">
                    {search.serverResults().length === 0
                      ? 'no archived matches'
                      : `${search.serverResults().length} archived match${search.serverResults().length === 1 ? '' : 'es'}`}
                  </span>
                </Show>
                <Show when={search.serverStatus() === 'error'}>
                  <span class="onyx-message-search__server-error">
                    {search.serverError()}
                  </span>
                </Show>
                <Show when={search.serverStatus() === 'done' && search.serverNotice()}>
                  <span class="onyx-message-search__server-notice">
                    {search.serverNotice()}
                  </span>
                </Show>
              </div>
              <Show when={search.serverStatus() === 'done' && search.serverResults().length > 0}>
                <ul
                  id={SERVER_RESULTS_ID}
                  class="onyx-message-search__server-list"
                  role="list"
                  aria-label="Archived message results"
                >
                  <For each={search.serverResults()}>
                    {(result) => (
                      <li>
                        <button
                          type="button"
                          class="onyx-message-search__server-row"
                          title="Open archived context and jump to this message"
                          onClick={() => search.openServerResult(result)}
                        >
                          <span class="onyx-message-search__server-when">{timeLabel(result.time)}</span>
                          <strong>{result.from}</strong>
                          <span class="onyx-message-search__server-text">{result.text}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>
          <Show when={search.serverSearchBlockedByE2ee() && search.query().trim().length > 0}>
            <div class="onyx-message-search__history-off" role="status">
              Encrypted DM search stays on this device. Loaded decrypted lines are searched here;
              query text and ciphertext history are not sent to server search.
            </div>
          </Show>
          <Show when={search.query().trim().length >= 2 && search.serverStatus() !== 'pending' && search.vaultStatus() !== 'pending' && search.resultCount() === 0 && search.serverResults().length === 0 && search.vaultResults().length === 0}>
            <div class="onyx-message-search__empty" role="status">
              <strong>No matches yet</strong>
              <span>Try a shorter phrase, or search full server history if it’s available.</span>
            </div>
          </Show>
          <Show when={search.query().trim().length >= 2}>
            <div class="onyx-message-search__advanced">
              <button
                type="button"
                class="onyx-message-search__advanced-toggle"
                aria-expanded={advancedOpen()}
                aria-controls="onyx-message-search-advanced"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                Advanced
              </button>
              <Show when={advancedOpen()}>
                <div
                  id="onyx-message-search-advanced"
                  class="onyx-message-search__recall onyx-message-search__recall--modes"
                >
                  <ProvenanceBadge scope="device" subject="Device recall matching mode" />
                  <span class="onyx-message-search__vault-label">Device recall</span>
                  <div
                    class="onyx-message-search__segmented"
                    role="group"
                    aria-label="Device recall matching mode"
                  >
                    <For each={VAULT_MODE_OPTIONS}>
                      {(option) => (
                        <button
                          type="button"
                          class="onyx-message-search__segment"
                          aria-pressed={search.vaultMode() === option.mode}
                          data-mode={option.mode}
                          data-active={search.vaultMode() === option.mode}
                          title={option.title}
                          onClick={() => search.setVaultMode(option.mode)}
                        >
                          {option.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={search.vaultResults().length > 0}>
            <div class="onyx-message-search__vault" data-testid="vault-search">
              <div class="onyx-message-search__vault-bar">
                <strong class="onyx-message-search__section-title">Remembered elsewhere</strong>
                <ProvenanceBadge scope="device" subject="Device-memory message search" />
                <span class="onyx-message-search__vault-label">
                  {search.vaultMode() === 'semantic'
                    ? 'Related terms on this device'
                    : search.vaultMode() === 'hybrid'
                      ? 'Recalled on this device'
                      : 'Saved on this device'}
                </span>
                <span class="onyx-message-search__server-count">
                  {search.vaultResults().length} remembered
                </span>
              </div>
              <ul
                id={VAULT_RESULTS_ID}
                class="onyx-message-search__server-list"
                role="list"
                aria-label="Device-memory message results"
              >
                <For each={search.vaultResults()}>
                  {(result) => (
                    <li>
                      <button
                        type="button"
                        class="onyx-message-search__server-row"
                        title={`Open ${result.target} at this message`}
                        onClick={() => search.openVaultResult(result)}
                      >
                        <span class="onyx-message-search__vault-target">{result.target}</span>
                        <span class="onyx-message-search__server-when">{timeLabel(result.time)}</span>
                        <strong>{result.from}</strong>
                        <span class="onyx-message-search__server-text">{result.text}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </div>
        <span id={SEARCH_HELP_ID} class="sr-only">
          Enter moves to the next visible match. Shift Enter moves to the previous match.
          Control or Command Enter searches full server history when available. Escape closes search.
        </span>
        <span
          id={SEARCH_STATUS_ID}
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusLabel()}
        </span>
        <span
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="server-search-status"
        >
          {serverLifecycleLabel()}
        </span>
        <span
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="device-search-status"
        >
          {vaultLifecycleLabel()}
        </span>
      </div>
    </Show>
  );
}

export default MessageSearch;
