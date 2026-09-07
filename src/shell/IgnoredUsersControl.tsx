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

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;

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
    if (CONTROL_CHARACTERS.test(nick)) {
      setError('That name contains unsupported characters. Try typing it again.');
      return;
    }
    const self = getState().ourNick?.toLowerCase();
    if (self && nick.toLowerCase() === self) {
      setError('You cannot block yourself.');
      return;
    }
    if (ignored().has(nick.toLowerCase())) {
      setError(`${nick} is already muted on this device.`);
      return;
    }
    try {
      getState().ignoreUser(nick);
    } catch {
      setError('The device-only list could not be updated. Try again.');
      return;
    }
    setDraft('');
    setError(null);
    getState().addToast({
      variant: 'undo',
      title: `Blocked ${nick}`,
      description: 'You will not see them on this device. They are not told.',
      undoAction: () => getState().unignoreUser(nick),
    });
  }

  function removeNick(nick: string): void {
    try {
      getState().unignoreUser(nick);
    } catch {
      setError('The device-only list could not be updated. Try again.');
      return;
    }
    getState().addToast({
      variant: 'undo',
      title: `Unblocked ${nick}`,
      description: 'Messages and notifications from this name resume on this device.',
      undoAction: () => getState().ignoreUser(nick),
    });
  }

  return (
    <section
      class="pref-group ignored-users-control"
      aria-labelledby="pref-ignored-users-title"
      data-testid="pref-ignored-users"
    >
      <div class="pref-group-head">
        <div class="ignored-users-heading">
          <h3 id="pref-ignored-users-title" class="pref-label">Personal mute &amp; block</h3>
          <span class="ignored-users-local-badge">This device only</span>
        </div>
        <span class="pref-count" aria-label={`${list().length} muted names`} data-testid="pref-ignored-users-count">
          {list().length === 0 ? 'None' : `${list().length}`}
        </span>
      </div>
      <p class="pref-desc">
        Muting hides messages and notifications from these names on this device.
        Nothing is removed from rooms, and the server is not notified. People-card Block and /ignore share this list.
      </p>

      <div class="ignored-users-add" role="group" aria-label="Add name to personal mute and block list">
        <label class="ignored-users-input-label" for="pref-ignore-nick-input">Name to mute</label>
        <input
          id="pref-ignore-nick-input"
          class="pref-text-input"
          type="text"
          data-testid="pref-ignore-nick-input"
          spellcheck={false}
          autocomplete="off"
          maxlength={MAX_IGNORED_NICK_LENGTH}
          placeholder="Name to mute or block"
          aria-describedby="pref-ignore-help"
          aria-invalid={Boolean(error())}
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
          Mute name
        </button>
      </div>
      <p id="pref-ignore-help" class="ignored-users-help">Only you see this setting. Press Enter to add.</p>
      <Show when={error()}>
        {(msg) => (
          <p class="pref-status pref-status--warn" role="alert" aria-live="assertive" data-testid="pref-ignore-error">
            {msg()}
          </p>
        )}
      </Show>

      <Show
        when={list().length > 0}
        fallback={
          <p class="ignored-users-empty" role="status" data-testid="pref-ignored-users-empty">
            <strong>Your list is clear.</strong>
            Names you mute or block here will appear in this device-only list.
          </p>
        }
      >
        <ul class="ignored-users-list" aria-label="Muted names on this device" data-testid="pref-ignored-users-list">
          <For each={list()}>
            {(nick) => (
              <li class="ignored-users-row">
                <span class="ignored-users-nick" title={nick}>{nick}</span>
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
