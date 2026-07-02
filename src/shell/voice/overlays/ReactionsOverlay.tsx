import { For, onCleanup, onMount, Show, createSignal } from 'solid-js';

import './voice-overlays.css';

type VoiceReactionDetail = {
  nick?: string;
  emoji?: string;
};

type FloatingReaction = {
  id: number;
  nick: string;
  emoji: string;
  startX: number;
  drift: number;
};

const reactionLifetimeMs = 2600;
const maxReactions = 24;

export function ReactionsOverlay() {
  const [items, setItems] = createSignal<FloatingReaction[]>([]);
  const timers = new Map<number, number>();
  let nextId = 1;

  onMount(() => {
    const onReaction = (event: Event) => {
      const detail = (event as CustomEvent<VoiceReactionDetail>).detail ?? {};
      const emoji = detail.emoji?.trim();
      if (!emoji) return;

      const id = nextId;
      nextId += 1;
      const next: FloatingReaction = {
        id,
        emoji,
        nick: detail.nick?.trim() || 'Voice',
        startX: Math.round((Math.random() * 2 - 1) * 22),
        drift: Math.round((Math.random() * 2 - 1) * 64),
      };

      setItems((previous) => [...previous, next].slice(-maxReactions));
      const timer = window.setTimeout(() => {
        timers.delete(id);
        setItems((previous) => previous.filter((item) => item.id !== id));
      }, reactionLifetimeMs);
      timers.set(id, timer);
    };

    window.addEventListener('ocean:voice-reaction', onReaction);
    onCleanup(() => {
      window.removeEventListener('ocean:voice-reaction', onReaction);
    });
  });

  onCleanup(() => {
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
  });

  return (
    <Show when={items().length > 0}>
      <div class="voice-reactions" aria-hidden="true" data-testid="voice-reactions-overlay">
        <For each={items()}>
          {(item) => (
            <span
              class="voice-reaction"
              style={{ '--voice-reaction-start': `${item.startX}px`, '--voice-reaction-drift': `${item.drift}px` }}
            >
              <span class="voice-reaction__emoji">{item.emoji}</span>
              <span class="voice-reaction__nick">{item.nick}</span>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

export default ReactionsOverlay;
