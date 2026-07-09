import { For, createEffect,
  createMemo,
  onCleanup,
  Show,
  splitProps,
  type JSX, } from 'solid-js';
import {
  closeMessageSearch,
  useMessageSearch,
} from './useMessageSearch';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';
import './message-search.css';

export type MessageSearchProps = JSX.HTMLAttributes<HTMLDivElement>;

const INPUT_ID = 'onyx-message-search-input';

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollToMessage(messageId: string): number | undefined {
  const selector = `[data-message-search-id="${cssEscape(messageId)}"]`;
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) return undefined;

  node.scrollIntoView({
    block: 'center',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });

  node.classList.remove('shell-msg-search-pulse');
  void node.offsetWidth;
  node.classList.add('shell-msg-search-pulse');

  return window.setTimeout(() => {
    node.classList.remove('shell-msg-search-pulse');
  }, 950);
}

export function MessageSearch(props: MessageSearchProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  const search = useMessageSearch();
  let inputRef: HTMLInputElement | undefined;
  let pulseTimer: number | undefined;

  const countLabel = createMemo(() => (
    search.resultCount() > 0
      ? `${search.activePosition()} of ${search.resultCount()}`
      : '0 of 0'
  ));

  const statusLabel = createMemo(() => {
    if (!search.query().trim()) return `Search ${search.targetLabel()}`;
    if (search.resultCount() === 0) return `No matches in ${search.targetLabel()}`;
    return `${countLabel()} in ${search.targetLabel()}`;
  });

  createEffect(() => {
    if (!search.isOpen()) return;
    queueMicrotask(() => inputRef?.focus());
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
    if (pulseTimer !== undefined) window.clearTimeout(pulseTimer);
  });

  const timeLabel = (time: Date) =>
    time.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handleInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (event) => {
    search.setQuery((event.currentTarget as HTMLInputElement).value);
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      search.runServerSearch();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMessageSearch();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        search.previous();
      } else {
        search.next();
      }
    }
  };

  return (
    <Show when={search.isOpen()}>
      <div
        {...rest}
        class={['onyx-message-search', local.class].filter(Boolean).join(' ')}
        role="search"
        aria-label="Message search"
      >
        <div class="onyx-message-search__surface">
          <label class="sr-only" for={INPUT_ID}>Search messages</label>
          <svg
            class="onyx-message-search__sigil"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.25" />
            <line x1="10.4" y1="10.4" x2="13.5" y2="13.5" />
          </svg>
          <input
            ref={inputRef}
            id={INPUT_ID}
            class="onyx-message-search__input"
            type="search"
            value={search.query()}
            autocomplete="off"
            spellcheck={false}
            aria-label="Search messages"
            placeholder="Find in conversation"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
          />
          <output class="onyx-message-search__count" aria-live="polite">
            {countLabel()}
          </output>
          <ProvenanceBadge
            scope="device"
            subject="Visible message search"
            class="onyx-message-search__provenance"
          />
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
            <button
              type="button"
              class="onyx-message-search__button onyx-message-search__button--close"
              aria-label="Close search"
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
        </div>
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
        <Show when={search.canServerSearch() && search.query().trim().length > 0}>
          <div class="onyx-message-search__server" data-testid="server-search">
            <div class="onyx-message-search__server-bar">
              <ProvenanceBadge scope="server" subject="Archived message search" />
              <button
                type="button"
                class="onyx-message-search__deep"
                disabled={search.serverStatus() === 'pending'}
                onClick={() => search.runServerSearch()}
                title="Search the server's full history for this conversation (Ctrl+Enter)"
              >
                {search.serverStatus() === 'pending'
                  ? 'Searching history…'
                  : 'Search full history ↵'}
              </button>
              <Show when={search.serverStatus() === 'done'}>
                <span class="onyx-message-search__server-count">
                  {search.serverResults().length === 0
                    ? 'no archived matches'
                    : `${search.serverResults().length} archived match${search.serverResults().length === 1 ? '' : 'es'}`}
                </span>
              </Show>
              <Show when={search.serverStatus() === 'error'}>
                <span class="onyx-message-search__server-error">{search.serverError()}</span>
              </Show>
            </div>
            <Show when={search.serverStatus() === 'done' && search.serverResults().length > 0}>
              <ul
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
                        title="Jump to message (when loaded in the conversation)"
                        onClick={() => scrollToMessage(result.id)}
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
        <Show when={search.vaultResults().length > 0}>
          <div class="onyx-message-search__vault" data-testid="vault-search">
            <div class="onyx-message-search__vault-bar">
              <ProvenanceBadge scope="device" subject="Device-memory message search" />
              <span class="onyx-message-search__vault-label">Saved on this device</span>
              <span class="onyx-message-search__server-count">
                {search.vaultResults().length} remembered
              </span>
            </div>
            <ul
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
        <span class="sr-only" aria-live="polite">{statusLabel()}</span>
      </div>
    </Show>
  );
}

export default MessageSearch;
