/**
 * Composer.tsx — message input for the active channel or DM.
 *
 * - Enter sends; Shift+Enter inserts newline
 * - Textarea grows with content (up to 200px)
 * - Disabled when no active target or not connected
 * - sendMessage called via getState().sendMessage(target, text)
 *
 * SOLID IDIOMS: never destructure props; splitProps; createSignal/createMemo.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';

export type ComposerProps = {
  /** Optionally override the active target; defaults to deriving from activeView */
  target?: string;
};

export function Composer(props: ComposerProps): JSX.Element {
  const [local] = splitProps(props, ['target']);

  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const typingUsers = useStore((s) => s.typingUsers);
  const ourNick = useStore((s) => s.ourNick);

  const [text, setText] = createSignal('');
  const [nowMs, setNowMs] = createSignal(Date.now());
  let textareaRef!: HTMLTextAreaElement;
  let typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTypingTarget: string | null = null;
  const tick = typeof window !== 'undefined'
    ? window.setInterval(() => setNowMs(Date.now()), 1000)
    : null;

  // ── derived target ──
  const target = createMemo(() => {
    if (local.target) return local.target;
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    return null;
  });

  const isEnabled = createMemo(() => {
    return !!target() && connectionStatus() === 'connected';
  });

  const activeTypingNicks = createMemo(() => {
    const t = target();
    if (!t) return [];
    const key = t.toLowerCase();
    const self = ourNick().toLowerCase();
    const users = typingUsers().get(key);
    if (!users) return [];
    const now = nowMs();
    return [...users.entries()]
      .filter(([nick, expiresAt]) => expiresAt > now && nick.toLowerCase() !== self)
      .map(([nick]) => nick)
      .sort((a, b) => a.localeCompare(b));
  });

  const typingText = createMemo(() => {
    const nicks = activeTypingNicks();
    if (nicks.length === 0) return '';
    if (nicks.length === 1) return `${nicks[0]} is typing...`;
    if (nicks.length === 2) return `${nicks[0]} and ${nicks[1]} are typing...`;
    return `${nicks[0]}, ${nicks[1]}, and ${nicks.length - 2} more are typing...`;
  });

  const placeholder = createMemo(() => {
    const t = target();
    const cs = connectionStatus();
    if (cs !== 'connected') return 'Reconnecting to the current…';
    if (!t) return 'Pick a room or a person to begin';
    return `Message ${t}`;
  });

  // ── auto-resize ──
  function autoResize(): void {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function clearTypingTimer(): void {
    if (typingStopTimer) {
      clearTimeout(typingStopTimer);
      typingStopTimer = null;
    }
  }

  function sendTypingStopNow(t = target()): void {
    clearTypingTimer();
    if (t) getState().sendTypingStop(t);
  }

  function noteTypingActivity(hasText: boolean): void {
    const t = target();
    if (!t || !isEnabled()) return;
    if (!hasText) {
      sendTypingStopNow(t);
      return;
    }
    getState().sendTypingStart(t);
    clearTypingTimer();
    typingStopTimer = setTimeout(() => getState().sendTypingStop(t), 5000);
  }

  function handleInput(e: InputEvent): void {
    const next = (e.currentTarget as HTMLTextAreaElement).value;
    setText(next);
    noteTypingActivity(next.trim().length > 0);
    autoResize();
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function sendMessage(): void {
    const t = target();
    const content = text().trim();
    if (!t || !content || !isEnabled()) return;
    getState().sendMessage(t, content);
    sendTypingStopNow(t);
    setText('');
    // Reset height after clearing
    queueMicrotask(() => {
      if (textareaRef) {
        textareaRef.style.height = 'auto';
      }
    });
  }

  createEffect(() => {
    const nextTarget = target();
    if (lastTypingTarget && lastTypingTarget !== nextTarget) {
      getState().sendTypingStop(lastTypingTarget);
    }
    lastTypingTarget = nextTarget;
  });

  onCleanup(() => {
    if (tick !== null) window.clearInterval(tick);
    sendTypingStopNow(lastTypingTarget);
  });

  return (
    <section
      class={`shell-composer${!isEnabled() ? ' shell-composer--disabled' : ''}`}
      aria-label="Message composer"
    >
      <Show when={typingText()}>
        {(line) => (
          <p class="shell-typing-indicator" aria-live="polite">
            {line()}
          </p>
        )}
      </Show>
      <div class="shell-composer-inner">
        <label for="shell-composer-input" class="sr-only">
          <Show when={target()} fallback="Message input (no active channel)">
            {(t) => `Message ${t()}`}
          </Show>
        </label>
        <textarea
          ref={textareaRef!}
          id="shell-composer-input"
          class="shell-composer-textarea"
          placeholder={placeholder()}
          disabled={!isEnabled()}
          rows={1}
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={() => sendTypingStopNow()}
          aria-label={placeholder()}
          aria-disabled={!isEnabled()}
          aria-multiline="true"
        />
        <button
          type="button"
          class="shell-composer-send"
          disabled={!isEnabled() || !text().trim()}
          aria-label="Send message"
          onClick={sendMessage}
        >
          {/* Terminal-style send arrow */}
          <span aria-hidden="true" style={{ 'font-family': 'var(--font-mono)', 'font-size': '1.1rem', 'line-height': '1' }}>
            ↵
          </span>
        </button>
      </div>
      <p class="shell-composer-hint" aria-hidden="true">
        Enter to send · Shift+Enter for newline
      </p>
    </section>
  );
}
