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
  createMemo,
  createSignal,
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

  const [text, setText] = createSignal('');
  let textareaRef!: HTMLTextAreaElement;

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

  const placeholder = createMemo(() => {
    const t = target();
    const cs = connectionStatus();
    if (cs !== 'connected') return '// not connected';
    if (!t) return '// pick a room or DM to start';
    return `message ${t}`;
  });

  // ── auto-resize ──
  function autoResize(): void {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleInput(e: InputEvent): void {
    setText((e.currentTarget as HTMLTextAreaElement).value);
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
    setText('');
    // Reset height after clearing
    queueMicrotask(() => {
      if (textareaRef) {
        textareaRef.style.height = 'auto';
      }
    });
  }

  return (
    <section
      class={`shell-composer${!isEnabled() ? ' shell-composer--disabled' : ''}`}
      aria-label="Message composer"
    >
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
