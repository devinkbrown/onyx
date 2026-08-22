// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * KeywordListControl — You-settings add/remove list for extra ping words.
 *
 * Slack polarity: keywords add pings. They do not replace All / @ / Mute.
 * Quiet harbor copy — not a Discord Highlights costume.
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';

import { MAX_KEYWORD_LENGTH, normalizeKeyword } from '@/lib/notifications/keywordList';
import { getState, useStore } from '@/lib/store';

export function KeywordListControl(): JSX.Element {
  const words = useStore((s) => s.highlightWords);
  const [draft, setDraft] = createSignal('');
  const [status, setStatus] = createSignal<string | null>(null);

  const list = createMemo(() => [...words()].sort((a, b) => a.localeCompare(b, 'en')));

  function addWord(): void {
    const normalized = normalizeKeyword(draft());
    if (!normalized) {
      setStatus('Enter a short word.');
      return;
    }
    if (getState().highlightWords.includes(normalized)) {
      setDraft('');
      setStatus(null);
      return;
    }
    getState().addHighlightWord(normalized);
    if (!getState().highlightWords.includes(normalized)) {
      setStatus('Could not save that word on this device.');
      return;
    }
    setDraft('');
    setStatus(null);
  }

  function removeWord(word: string): void {
    getState().removeHighlightWord(word);
    setStatus(null);
  }

  return (
    <section
      class="you-keywords"
      aria-labelledby="you-keywords-title"
      aria-describedby="you-keywords-hint"
      data-testid="you-keywords"
    >
      <h3 id="you-keywords-title" class="you-keywords-title">Keywords</h3>
      <p class="you-settings-hint" id="you-keywords-hint">
        Also ping when these words appear. They do not replace All, @, or Mute.
        Muted rooms stay silent.
      </p>
      <div class="you-keywords-add" role="group" aria-label="Add a keyword">
        <label class="you-settings-hint" for="you-keyword-input">Word</label>
        <input
          id="you-keyword-input"
          class="you-settings-select"
          type="text"
          data-testid="you-keyword-input"
          spellcheck={false}
          autocomplete="off"
          maxlength={MAX_KEYWORD_LENGTH}
          placeholder="word"
          value={draft()}
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            if (status()) setStatus(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addWord();
            }
          }}
        />
        <button
          type="button"
          class="you-keywords-add-btn"
          data-testid="you-keyword-add"
          onClick={addWord}
        >
          Add
        </button>
      </div>
      <Show when={status()}>
        {(msg) => (
          <p class="you-settings-hint" role="status" data-testid="you-keywords-status">
            {msg()}
          </p>
        )}
      </Show>
      <Show
        when={list().length > 0}
        fallback={
          <p class="you-settings-hint" data-testid="you-keywords-empty">
            No extra ping words on this device.
          </p>
        }
      >
        <ul class="you-keywords-list" data-testid="you-keywords-list">
          <For each={list()}>
            {(word) => (
              <li class="you-keywords-row">
                <span class="you-keywords-word">{word}</span>
                <button
                  type="button"
                  class="you-keywords-remove"
                  data-testid={`you-keyword-remove-${word}`}
                  aria-label={`Remove ${word}`}
                  onClick={() => removeWord(word)}
                >
                  Remove
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
