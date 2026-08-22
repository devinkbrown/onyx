// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * IgnoredUsersControl — device-local ignore list manager for Preferences.
 *
 * Complements people-card Block and /ignore|/unignore. Device-only: does not
 * talk to the network; identity-scoped via store ignoreUser/unignoreUser.
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';

import { useStore, getState } from '@/lib/store';
import { MAX_IGNORED_NICK_LENGTH } from '@/lib/ignoredUsers';

import './IgnoredUsersControl.css';

function sortedIgnored(nicks: ReadonlySet<string>): string[] {
  return [...nicks].sort((a, b) => a.localeCompare(b, 'en'));
}

export function IgnoredUsersControl(): JSX.Element {
  const ignored = useStore((s) => s.ignoredUsers);
  const [draft, setDraft] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  const list = createMemo(() => sortedIgnored(ignored()));

  function addNick(): void {
    const nick = draft().trim();
    if (!nick) {
      setError('Enter a name to block on this device.');
      return;
    }
    if (nick.length > MAX_IGNORED_NICK_LENGTH) {
      setError(`Name is too long (max ${MAX_IGNORED_NICK_LENGTH} characters).`);
      return;
    }
    const self = getState().ourNick?.toLowerCase();
    if (self && nick.toLowerCase() === self) {
      setError('You cannot block yourself.');
      return;
    }
    getState().ignoreUser(nick);
    setDraft('');
    setError(null);
    getState().addToast({
      variant: 'info',
      title: `Blocked ${nick}`,
      description: 'You will not see them on this device. They are not told.',
    });
  }

  function removeNick(nick: string): void {
    getState().unignoreUser(nick);
    getState().addToast({
      variant: 'info',
      title: `Unblocked ${nick}`,
      description: 'Messages and notifications from this name resume on this device.',
    });
  }

  return (
    <section
      class="pref-group ignored-users-control"
      aria-labelledby="pref-ignored-users-title"
      data-testid="pref-ignored-users"
    >
      <div class="pref-group-head">
        <h3 id="pref-ignored-users-title" class="pref-label">Blocked names</h3>
        <span class="pref-count" data-testid="pref-ignored-users-count">
          {list().length === 0 ? 'None' : `${list().length}`}
        </span>
      </div>
      <p class="pref-desc">
        You will not see them on this device. They are not told. People-card Block
        and /ignore share this list.
      </p>

      <div class="ignored-users-add" role="group" aria-label="Add name to blocked list">
        <label class="sr-only" for="pref-ignore-nick-input">Name to block</label>
        <input
          id="pref-ignore-nick-input"
          class="pref-text-input"
          type="text"
          data-testid="pref-ignore-nick-input"
          spellcheck={false}
          autocomplete="off"
          maxlength={MAX_IGNORED_NICK_LENGTH}
          placeholder="name"
          value={draft()}
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            if (error()) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addNick();
            }
          }}
        />
        <button
          type="button"
          class="ignored-users-add-btn"
          data-testid="pref-ignore-add"
          onClick={addNick}
        >
          Block
        </button>
      </div>
      <Show when={error()}>
        {(msg) => (
          <p class="pref-status pref-status--warn" role="alert" data-testid="pref-ignore-error">
            {msg()}
          </p>
        )}
      </Show>

      <Show
        when={list().length > 0}
        fallback={
          <p class="ignored-users-empty" data-testid="pref-ignored-users-empty">
            Nobody blocked on this device.
          </p>
        }
      >
        <ul class="ignored-users-list" data-testid="pref-ignored-users-list">
          <For each={list()}>
            {(nick) => (
              <li class="ignored-users-row">
                <span class="ignored-users-nick">{nick}</span>
                <button
                  type="button"
                  class="ignored-users-unignore"
                  data-testid={`pref-unignore-${nick}`}
                  aria-label={`Unblock ${nick}`}
                  onClick={() => removeNick(nick)}
                >
                  Unblock
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

export { sortedIgnored as sortedIgnoredUsersForTest };
