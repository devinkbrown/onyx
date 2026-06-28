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

import { createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';

/** Re-tick interval so expired typers fall off without a new store update. */
const TICK_MS = 2000;

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
  const timer = setInterval(() => setNow(Date.now()), TICK_MS);
  onCleanup(() => clearInterval(timer));

  const key = createMemo<string | null>(() => {
    const v = activeView();
    if (v.kind === 'channel') return v.channel.toLowerCase();
    if (v.kind === 'dm') return v.nick.toLowerCase();
    return null;
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
