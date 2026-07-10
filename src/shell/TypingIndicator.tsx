/**
 * TypingIndicator.tsx — "X is typing…" line for the active channel or DM.
 *
 * Reads the store's `typingUsers` map (populated from incoming `draft/typing`
 * TAGMSG). Entries carry an expiry timestamp; a slow tick re-evaluates so a
 * typer drops off after they go quiet even without a fresh TAGMSG. Self is
 * filtered out. For DMs, incoming typing is keyed under the sender's nick (which
 * is exactly the DM's `nick`), so the same lookup works for both surfaces.
 *
 * SOLID IDIOMS: components run once; createMemo/createSignal/onCleanup; Show.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';

/** Re-tick interval so expired typers fall off without a new store update. */
const TICK_MS = 2000;

/**
 * Furthest-future expiry timestamp among a channel's typing entries, or 0 when
 * the map is empty. Pure so the "should we keep ticking?" decision is
 * unit-testable without the store/DOM. Entries are pruned from the store only on
 * the next TAGMSG, so a caller must compare this against the current time rather
 * than trusting map size.
 */
export function latestTypingExpiry(map: Map<string, number>): number {
  let max = 0;
  for (const expiresAt of map.values()) {
    if (expiresAt > max) max = expiresAt;
  }
  return max;
}

/**
 * Format the "X is typing" line from a list of nicks. Pure so the pluralization
 * rules are unit-testable without the store/DOM.
 */
export function formatTypingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing`;
  return 'Several people are typing';
}

export function TypingIndicator(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const typingUsers = useStore((s) => s.typingUsers);
  const ourNick = useStore((s) => s.ourNick);

  const [now, setNow] = createSignal(Date.now());

  const key = createMemo<string | null>(() => {
    const v = activeView();
    if (v.kind === 'channel') return v.channel.toLowerCase();
    if (v.kind === 'dm') return v.nick.toLowerCase();
    return null;
  });

  // Re-tick clock — but ONLY while a typer for the active surface is still live.
  // The old code ran a 2s `setInterval` for the whole session, writing `now` and
  // recomputing the `typers`/`label` memos every 2s even when nobody was typing
  // (the overwhelmingly common case). Gating the clock on a real future expiry
  // keeps the component fully quiescent when idle: no timer, no signal write, no
  // wasted memo recompute. A fresh TAGMSG changes `typingUsers` (new Map ref),
  // which re-runs this effect and restarts the clock; once the last entry's
  // expiry passes, the self-rescheduling timeout stops on its own.
  createEffect(() => {
    const k = key();
    const map = k ? typingUsers().get(k) : undefined;
    if (!map || map.size === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      if (latestTypingExpiry(map) <= Date.now()) return; // all expired → stop
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, TICK_MS);
    };
    schedule();
    onCleanup(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  });

  const typers = createMemo<string[]>(() => {
    const k = key();
    if (!k) return [];
    const map = typingUsers().get(k);
    if (!map) return [];
    const t = now();
    const me = ourNick().toLowerCase();
    return [...map.entries()]
      .filter(([nick, expiresAt]) => expiresAt > t && nick.toLowerCase() !== me)
      .map(([nick]) => nick)
      .sort((a, b) => a.localeCompare(b));
  });

  const label = createMemo(() => formatTypingLabel(typers()));

  return (
    <Show when={label()}>
      <div class="shell-typing-indicator" role="status" aria-live="polite">
        <span class="shell-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{label()}…</span>
      </div>
    </Show>
  );
}
