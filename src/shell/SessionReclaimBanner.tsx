// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SessionReclaimBanner — visible projection of IRCClient's `onSessionReclaim`.
 *
 * `sessionReclaim.ts` (`planSessionReclaim`) decides, on every `001`, which
 * resume bearer — if any — this reconnect should replay. The store wires that
 * decision (store.ts `onSessionReclaim`) into four phases:
 *
 *   'restoring'      — a mesh or local bearer was just replayed; awaiting the
 *                       server's answer. Auto-promotes to 'reclaimed' if
 *                       nothing rejects it within a short confirm window.
 *   'reclaimed'      — held: a brief success toast, then auto-dismisses.
 *   'reclaim-failed' — the server answered `FAIL SESSION INVALID_TOKEN` /
 *                       `NO_SESSION`; the attempted bearer is now spent.
 *   'sign-in-again'  — no bearer was even attempted because the only one held
 *                       (the mesh token) had already lapsed.
 *
 * `reclaim-failed` and `sign-in-again` are both fail-CLOSED states: rather
 * than silently continuing as a fresh guest under the old identity, they stay
 * on screen with a "Sign in again" action until the user acts or dismisses.
 * A guest / first connect ('none-held') never reaches this component — the
 * store leaves `sessionReclaim` `null` for it.
 *
 * Structural sibling of ReconnectStatusBanner, but — unlike that purely
 * informational banner — this one carries real actions, so the whole region
 * stays a normal (non `aria-hidden`) `role="status"` surface, matching
 * CallJoinBanner's pattern of a status region with a button inside it.
 */
import { createMemo, Show, type JSX } from 'solid-js';

import { useStore, getState } from '@/lib/store';
import './session-reclaim-banner.css';

const COPY: Record<string, { title: string; detail: string }> = {
  restoring: {
    title: 'Restoring your session…',
    detail: 'Reconnecting you to where you left off.',
  },
  reclaimed: {
    title: 'Session restored',
    detail: '',
  },
  'reclaim-failed': {
    title: "Couldn't restore your session",
    detail: 'Sign in again to keep going.',
  },
  'sign-in-again': {
    title: 'Your session has expired',
    detail: 'Sign in again to keep going.',
  },
};

export function SessionReclaimBanner(): JSX.Element {
  const sessionReclaim = useStore((s) => s.sessionReclaim);

  const phase = createMemo(() => sessionReclaim()?.phase ?? null);
  const actionable = createMemo(() => phase() === 'reclaim-failed' || phase() === 'sign-in-again');
  const copy = createMemo(() => COPY[phase() ?? ''] ?? { title: '', detail: '' });

  return (
    <Show when={phase()}>
      <div
        class="session-reclaim-banner"
        classList={{
          'session-reclaim-banner--success': phase() === 'reclaimed',
          'session-reclaim-banner--alert': actionable(),
        }}
        data-state={phase() ?? undefined}
        data-testid="session-reclaim-banner"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="session-reclaim-banner__glyph" aria-hidden="true">
          {phase() === 'reclaimed' ? '✓' : actionable() ? '⚠' : '⋯'}
        </span>
        <span class="session-reclaim-banner__text">
          <span class="session-reclaim-banner__title">{copy().title}</span>
          <Show when={copy().detail}>
            <span class="session-reclaim-banner__detail">{copy().detail}</span>
          </Show>
        </span>
        <Show when={actionable()}>
          <button
            type="button"
            class="session-reclaim-banner__signin"
            data-testid="session-reclaim-signin"
            onClick={() => getState().disconnect()}
          >
            Sign in again
          </button>
        </Show>
        <button
          type="button"
          class="session-reclaim-banner__dismiss"
          data-testid="session-reclaim-dismiss"
          aria-label="Dismiss"
          onClick={() => getState().dismissSessionReclaim()}
        >
          ×
        </button>
      </div>
    </Show>
  );
}
