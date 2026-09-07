import { createSignal, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createDialogFocus } from '@/primitives/focusTrap';
import './new-message-sheet.css';
import { nicknameError, parseNickname } from '@/lib/identity/nickname';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export type NewMessageSheetProps = {
  connectionStatus: ConnectionStatus;
  onClose: () => void;
  onStart: (nick: string) => void;
};

// Conservative client-side guard: the server remains authoritative, but an
// empty or whitespace-containing target must never become a DM navigation.
export function NewMessageSheet(props: NewMessageSheetProps): JSX.Element {
  const [recipient, setRecipient] = createSignal('');
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;
  const unavailable = () => props.connectionStatus !== 'connected';
  const trimmed = () => recipient().trim();
  const valid = () => parseNickname(trimmed()) !== null;
  const error = () => recipient().trim() ? nicknameError(recipient()) : undefined;

  createDialogFocus({
    isOpen: () => true,
    getPanel: () => panel,
    onEscape: () => props.onClose(),
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!unavailable() && valid()) props.onStart(trimmed());
  }

  return (
    <Portal>
      <div class="new-message-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <section ref={panel} class="new-message-sheet" role="dialog" aria-modal="true" aria-labelledby="new-message-title" aria-describedby="new-message-description" tabindex="-1">
        <div class="new-message-header">
          <div class="new-message-mark" aria-hidden="true">✦</div>
          <div>
            <p class="new-message-eyebrow">Private message</p>
            <h2 id="new-message-title">New conversation</h2>
          </div>
          <button type="button" class="new-message-close" aria-label="Close new conversation" onClick={() => props.onClose()}><span aria-hidden="true">×</span></button>
        </div>
        <p id="new-message-description" class="new-message-help">Start a private conversation with someone on this server.</p>
        {unavailable() && <p class="new-message-state" role="status" aria-live="polite">
          {props.connectionStatus === 'connecting' || props.connectionStatus === 'reconnecting'
            ? 'Connecting to Onyx… You can start when you’re online.'
            : 'You’re offline. Reconnect to start a conversation.'}
        </p>}
        <form onSubmit={submit}>
          <label for="new-message-recipient">Who do you want to message?</label>
          <p id="new-message-recipient-hint" class="new-message-hint">Enter their nickname exactly as they use it, for example <span>River_7</span>.</p>
          <input ref={input} id="new-message-recipient" value={recipient()} onInput={(e) => setRecipient(e.currentTarget.value)}
            autocomplete="off" autocapitalize="none" spellcheck={false} disabled={unavailable()} maxlength="64"
            aria-describedby="new-message-recipient-hint new-message-recipient-error" aria-invalid={Boolean(error())} />
          {error() && <p id="new-message-recipient-error" class="new-message-error" role="alert">{error()}</p>}
          {!recipient() && <p class="new-message-empty" aria-live="polite">No person selected yet.</p>}
          <div class="new-message-actions">
            <button type="button" class="new-message-secondary" onClick={() => props.onClose()}>Cancel</button>
            <button type="submit" class="new-message-primary" disabled={unavailable() || !valid()}>{unavailable() ? 'Waiting for connection' : 'Start conversation'}</button>
          </div>
        </form>
      </section>
      </div>
    </Portal>
  );
}
