/**
 * Composer.tsx — message input for the active channel or DM.
 *
 * - Enter sends; Shift+Enter inserts newline
 * - Textarea grows with content (up to 200px)
 * - Disabled when no active target or not connected
 * - Attachments upload to the configured media endpoint before send
 * - Per-target drafts are persisted through the vanilla store
 *
 * SOLID IDIOMS: never destructure props; splitProps; createSignal/createMemo.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { searchEmojis } from '@/lib/emoji/emoji';
import {
  completeSlashCommand,
  expandSlashTextCommand,
  getSlashCommandSuggestions,
  type SlashCommand,
} from '@/lib/commands/registry';
import { UploadError, uploadFile } from '@/lib/upload/upload';

export type ComposerProps = {
  /** Optionally override the active target; defaults to deriving from activeView */
  target?: string;
};

type AttachmentState = 'ready' | 'uploading' | 'uploaded' | 'error';

type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: AttachmentState;
  progress: number | null;
  error: string | null;
  uploadedUrl: string | null;
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

let attachmentId = 0;

function nextAttachmentId(): string {
  attachmentId += 1;
  return `composer-attachment-${Date.now()}-${attachmentId}`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function clippedText(text: string, max = 96): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function Composer(props: ComposerProps): JSX.Element {
  const [local] = splitProps(props, ['target']);

  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const activeChannelTopics = useStore((s) => s.activeChannelTopics);
  const replyingTo = useStore((s) => s.replyingTo);
  const editingMessage = useStore((s) => s.editingMessage);

  const [text, setText] = createSignal('');
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [composerError, setComposerError] = createSignal<string | null>(null);
  const [dragActive, setDragActive] = createSignal(false);
  const [isSending, setIsSending] = createSignal(false);
  const [emojiOpen, setEmojiOpen] = createSignal(false);
  const [emojiQuery, setEmojiQuery] = createSignal('');
  const [slashDismissed, setSlashDismissed] = createSignal(false);
  const [slashIndex, setSlashIndex] = createSignal(0);

  let textareaRef!: HTMLTextAreaElement;
  let fileInputRef!: HTMLInputElement;
  const previewUrls = new Set<string>();

  onCleanup(() => {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls.clear();
  });

  // ── derived target ──
  const target = createMemo(() => {
    if (local.target) return local.target;
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    return null;
  });

  const activeEditing = createMemo(() => {
    const edit = editingMessage();
    const t = target();
    if (!edit || !t) return null;
    return edit.target.toLowerCase() === t.toLowerCase() ? edit : null;
  });

  // The composer stays USABLE while the connection is down — text written
  // offline queues to the outbox (store.sendMessage) and fires on reconnect.
  // Attachments are the exception: uploads need the network right now.
  const isOffline = createMemo(() => connectionStatus() !== 'connected');
  const isEnabled = createMemo(() => !!target());
  const activeTopic = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return activeChannelTopics().get(view.channel.toLowerCase()) ?? null;
  });

  const placeholder = createMemo(() => {
    const t = target();
    if (activeEditing()) return 'Edit message';
    if (isOffline()) return t ? `Offline — queues for ${t}` : 'Reconnecting…';
    if (!t) return 'Pick a room or a person to begin';
    return `Message ${t}`;
  });

  const emojiMatches = createMemo(() => searchEmojis(emojiQuery(), 36));
  const slashCommands = createMemo(() => getSlashCommandSuggestions(text(), 8));
  const slashVisible = createMemo(() => !slashDismissed() && slashCommands().length > 0);

  const canSend = createMemo(() => {
    if (isSending()) return false;
    if (activeEditing()) return text().trim().length > 0 && attachments().length === 0;
    return text().trim().length > 0 || attachments().length > 0;
  });

  createEffect(() => {
    slashCommands();
    setSlashIndex(0);
  });

  let loadedTarget: string | null = null;
  let loadedEditId: string | null = null;
  createEffect(() => {
    const t = target();
    const edit = activeEditing();

    if (edit) {
      if (loadedEditId !== edit.id) {
        loadedEditId = edit.id;
        setComposerText(edit.text, false);
      }
      return;
    }

    loadedEditId = null;
    if (t !== loadedTarget) {
      loadedTarget = t;
      setComposerText(t ? getState().getComposerDraft(t) : '', false);
    }
  });

  // ── auto-resize ──
  function autoResize(): void {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function persistDraft(nextText: string): void {
    const t = target();
    if (!t || activeEditing()) return;
    getState().setComposerDraft(t, nextText);
  }

  function setComposerText(nextText: string, persist = true): void {
    setText(nextText);
    if (persist) persistDraft(nextText);
    queueMicrotask(autoResize);
  }

  function focusTextarea(caret: number | null = null): void {
    queueMicrotask(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      if (caret !== null) textareaRef.setSelectionRange(caret, caret);
      autoResize();
    });
  }

  function insertTextAtCaret(insert: string): void {
    const current = text();
    const start = textareaRef?.selectionStart ?? current.length;
    const end = textareaRef?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${insert}${current.slice(end)}`;
    setComposerText(next);
    setEmojiOpen(false);
    getState().addRecentEmoji?.(insert);
    getState().incrementEmojiUsage?.(insert);
    focusTextarea(start + insert.length);
  }

  function completeCommand(command: SlashCommand): void {
    const next = completeSlashCommand(text(), command);
    setComposerText(next);
    setSlashDismissed(true);
    focusTextarea(next.length);
  }

  function handleInput(e: InputEvent): void {
    const next = (e.currentTarget as HTMLTextAreaElement).value;
    setComposerText(next);
    setComposerError(null);
    setSlashDismissed(false);
    // Broadcast typing presence (the store rate-limits 'active' to once / 4s, and
    // recipients auto-expire after a few seconds of silence). Empty input or a
    // slash command isn't "composing a message", so signal a stop instead.
    const t = target();
    if (t) {
      const trimmed = next.trim();
      if (trimmed && !trimmed.startsWith('/')) {
        getState().sendTypingStart(t);
      } else {
        getState().sendTypingStop(t);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (slashVisible()) {
      const commands = slashCommands();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % commands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + commands.length) % commands.length);
        return;
      }
      if ((e.key === 'Tab' || e.key === 'Enter') && commands.length > 0) {
        e.preventDefault();
        completeCommand(commands[slashIndex()] ?? commands[0]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Escape' && emojiOpen()) {
      e.preventDefault();
      setEmojiOpen(false);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function updateAttachment(id: string, patch: Partial<ComposerAttachment>): void {
    setAttachments((items) => items.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  }

  function addFiles(files: File[]): void {
    if (files.length === 0) return;
    if (activeEditing()) {
      setComposerError('Finish editing before attaching files.');
      return;
    }

    const current = attachments();
    const room = Math.max(0, MAX_ATTACHMENTS - current.length);
    if (room === 0) {
      setComposerError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    const accepted: ComposerAttachment[] = [];
    for (const file of files.slice(0, room)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setComposerError(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
        continue;
      }
      const previewUrl = isImageFile(file) ? URL.createObjectURL(file) : null;
      if (previewUrl) previewUrls.add(previewUrl);
      accepted.push({
        id: nextAttachmentId(),
        file,
        previewUrl,
        status: 'ready',
        progress: null,
        error: null,
        uploadedUrl: null,
      });
    }

    if (files.length > room) {
      setComposerError(`Only ${room} more file${room === 1 ? '' : 's'} can be attached.`);
    }
    if (accepted.length > 0) {
      setAttachments((items) => [...items, ...accepted]);
      setComposerError(null);
    }
  }

  function removeAttachment(id: string): void {
    const item = attachments().find((entry) => entry.id === id);
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      previewUrls.delete(item.previewUrl);
    }
    setAttachments((items) => items.filter((entry) => entry.id !== id));
  }

  function handleAttachClick(): void {
    if (!isEnabled() || activeEditing()) return;
    fileInputRef?.click();
  }

  function handleFileInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  function handlePaste(e: ClipboardEvent): void {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  function handleDragOver(e: DragEvent): void {
    if (!isEnabled() || activeEditing()) return;
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: DragEvent): void {
    const current = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !current.contains(related)) setDragActive(false);
  }

  function handleDrop(e: DragEvent): void {
    if (!isEnabled() || activeEditing()) return;
    e.preventDefault();
    setDragActive(false);
    addFiles(Array.from(e.dataTransfer?.files ?? []));
  }

  async function uploadPendingAttachments(): Promise<string[] | null> {
    const uploaded: string[] = [];
    // Production default: same-origin '/upload' (nginx proxies it to the
    // nexus-upload service). Dev has no default — uploads surface a config
    // error unless VITE_MEDIA_URL is set, and previews stay local blob URLs.
    const mediaUrl =
      (import.meta.env.VITE_MEDIA_URL as string | undefined) ||
      (import.meta.env.PROD ? '/upload' : '');

    for (const item of attachments()) {
      if (item.uploadedUrl) {
        uploaded.push(item.uploadedUrl);
        continue;
      }

      updateAttachment(item.id, {
        status: 'uploading',
        progress: 0,
        error: null,
      });

      try {
        const result = await uploadFile(item.file, {
          mediaUrl,
          onProgress: (progress) => {
            updateAttachment(item.id, {
              progress: progress.percent,
            });
          },
        });
        updateAttachment(item.id, {
          status: 'uploaded',
          progress: 100,
          uploadedUrl: result.url,
        });
        uploaded.push(result.url);
      } catch (error) {
        const message = error instanceof UploadError ? error.message : 'Upload failed.';
        updateAttachment(item.id, {
          status: 'error',
          error: message,
          progress: null,
        });
        setComposerError(message);
        return null;
      }
    }

    return uploaded;
  }

  function resetAfterSend(t: string): void {
    getState().sendTypingStop(t); // we just sent — stop the typing signal
    setComposerText('', false);
    getState().clearComposerDraft(t);
    setAttachments((items) => {
      for (const item of items) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
          previewUrls.delete(item.previewUrl);
        }
      }
      return [];
    });
    setEmojiOpen(false);
    setEmojiQuery('');
    queueMicrotask(() => {
      if (textareaRef) textareaRef.style.height = 'auto';
    });
  }

  async function sendMessage(): Promise<void> {
    const t = target();
    if (!t || !isEnabled() || !canSend()) return;
    setComposerError(null);

    if (isOffline()) {
      // Edits and uploads need the network NOW; plain text queues fine.
      if (activeEditing()) {
        setComposerError('Reconnect before editing messages.');
        return;
      }
      if (attachments().length > 0) {
        setComposerError('Attachments need a connection — remove them to queue the text.');
        return;
      }
    }

    const edit = activeEditing();
    if (edit) {
      if (attachments().length > 0) {
        setComposerError('Remove attachments before editing a message.');
        return;
      }
      const content = text().trim();
      if (!content) return;
      getState().editMessage(t, edit.id, content);
      getState().setComposerEditingMessage(null);
      setComposerText('', false);
      return;
    }

    setIsSending(true);
    try {
      const urls = await uploadPendingAttachments();
      if (!urls) return;

      const baseContent = expandSlashTextCommand(text().trim());
      const content = [baseContent, ...urls].filter(Boolean).join('\n').trim();
      if (!content) return;

      getState().sendMessage(t, content);
      resetAfterSend(t);
    } finally {
      setIsSending(false);
    }
  }

  function cancelReply(): void {
    getState().setReplyingTo(null);
  }

  function cancelEdit(): void {
    getState().setComposerEditingMessage(null);
    const t = target();
    setComposerText(t ? getState().getComposerDraft(t) : '', false);
  }

  function clearTopic(): void {
    const view = activeView();
    if (view.kind === 'channel') getState().setActiveChannelTopic(view.channel, null);
  }

  return (
    <section
      class={[
        'shell-composer',
        !isEnabled() ? ' shell-composer--disabled' : '',
        dragActive() ? ' shell-composer--drag' : '',
      ].join('')}
      aria-label="Message composer"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="shell-composer-measure">
      <Show when={activeTopic()}>
        {(topic) => (
          <div class="shell-composer-topic" role="status" aria-live="polite">
            <span class="shell-composer-topic-label">topic</span>
            <span class="shell-composer-topic-name">#{topic()}</span>
            <button type="button" class="shell-composer-topic-clear" aria-label={`Clear topic ${topic()}`} onClick={clearTopic}>
              ×
            </button>
          </div>
        )}
      </Show>

      <Show when={replyingTo()}>
        {(reply) => (
          <div class="shell-composer-context" role="status" aria-live="polite">
            <span class="shell-composer-context-label">replying to {reply().from}</span>
            <span class="shell-composer-context-text">{clippedText(reply().text)}</span>
            <button type="button" class="shell-composer-context-close" aria-label="Cancel reply" onClick={cancelReply}>
              ×
            </button>
          </div>
        )}
      </Show>

      <Show when={activeEditing()}>
        {(edit) => (
          <div class="shell-composer-context shell-composer-context--edit" role="status" aria-live="polite">
            <span class="shell-composer-context-label">editing</span>
            <span class="shell-composer-context-text">{clippedText(edit().text)}</span>
            <button type="button" class="shell-composer-context-close" aria-label="Cancel edit" onClick={cancelEdit}>
              ×
            </button>
          </div>
        )}
      </Show>

      <Show when={attachments().length > 0}>
        <div class="shell-composer-attachments" role="list" aria-label="Attached files">
          <For each={attachments()}>
            {(item) => (
              <div class={`shell-attachment shell-attachment--${item.status}`} role="listitem">
                <Show
                  when={item.previewUrl}
                  fallback={<span class="shell-attachment-file" aria-hidden="true">file</span>}
                >
                  {(url) => (
                    <img
                      class="shell-attachment-thumb"
                      src={url()}
                      alt=""
                      loading="lazy"
                    />
                  )}
                </Show>
                <div class="shell-attachment-meta">
                  <span class="shell-attachment-name">{item.file.name}</span>
                  <span class="shell-attachment-size">{formatBytes(item.file.size)}</span>
                  <Show when={item.status === 'uploading'}>
                    <progress
                      class="shell-attachment-progress"
                      max="100"
                      value={item.progress ?? 0}
                      aria-label={`Uploading ${item.file.name}`}
                    />
                  </Show>
                  <Show when={item.error}>
                    {(error) => <span class="shell-attachment-error">{error()}</span>}
                  </Show>
                </div>
                <button
                  type="button"
                  class="shell-attachment-remove"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeAttachment(item.id)}
                  disabled={item.status === 'uploading'}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="shell-composer-popovers">
        <Show when={slashVisible()}>
          <div
            id="shell-command-menu"
            class="shell-command-menu"
            role="listbox"
            aria-label="Slash command suggestions"
          >
            <For each={slashCommands()}>
              {(command, index) => (
                <button
                  type="button"
                  class={`shell-command-item${index() === slashIndex() ? ' shell-command-item--active' : ''}`}
                  role="option"
                  aria-selected={index() === slashIndex()}
                  onMouseEnter={() => setSlashIndex(index())}
                  onClick={() => completeCommand(command)}
                >
                  <span class="shell-command-usage">{command.usage}</span>
                  <span class="shell-command-desc">{command.description}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={emojiOpen()}>
          <div id="shell-emoji-picker" class="shell-emoji-picker" role="dialog" aria-label="Emoji picker">
            <label class="sr-only" for="shell-emoji-search">Search emoji</label>
            <input
              id="shell-emoji-search"
              class="shell-emoji-search"
              value={emojiQuery()}
              placeholder="Search emoji"
              onInput={(e) => setEmojiQuery((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEmojiOpen(false);
                  focusTextarea();
                }
              }}
            />
            <div class="shell-emoji-grid" role="listbox" aria-label="Emoji results">
              <For each={emojiMatches()}>
                {(entry) => (
                  <button
                    type="button"
                    class="shell-emoji-choice"
                    role="option"
                    aria-label={`Insert ${entry.shortcode}`}
                    onClick={() => insertTextAtCaret(entry.emoji)}
                  >
                    {entry.emoji}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      <div class="shell-composer-inner">
        <button
          type="button"
          class="shell-composer-tool"
          disabled={!isEnabled() || !!activeEditing() || isOffline()}
          aria-label="Attach files"
          onClick={handleAttachClick}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.2 7.3 8.3 12.2a3.4 3.4 0 0 1-4.8-4.8l5.4-5.4a2.3 2.3 0 0 1 3.2 3.2L6.7 10.6a1.15 1.15 0 0 1-1.6-1.6l4.6-4.6" />
          </svg>
        </button>
        <input
          ref={fileInputRef!}
          type="file"
          class="sr-only"
          multiple
          aria-label="Choose files to attach"
          onChange={handleFileInput}
        />

        <button
          type="button"
          class="shell-composer-tool"
          disabled={!isEnabled()}
          aria-label="Insert emoji"
          aria-haspopup="dialog"
          aria-expanded={emojiOpen()}
          aria-controls={emojiOpen() ? 'shell-emoji-picker' : undefined}
          onClick={() => setEmojiOpen((open) => !open)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M5.6 9.4a3.1 3.1 0 0 0 4.8 0" />
            <circle cx="6" cy="6.4" r="0.5" fill="currentColor" stroke="none" />
            <circle cx="10" cy="6.4" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        </button>

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
          onPaste={handlePaste}
          aria-label={placeholder()}
          aria-disabled={!isEnabled()}
          aria-multiline="true"
          aria-controls={slashVisible() ? 'shell-command-menu' : undefined}
          aria-autocomplete={slashVisible() ? 'list' : undefined}
        />
        <button
          type="button"
          class="shell-composer-send"
          disabled={!isEnabled() || !canSend()}
          aria-label={activeEditing() ? 'Save edit' : 'Send message'}
          onClick={() => void sendMessage()}
        >
          <Show
            when={activeEditing()}
            fallback={
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M1.7 7.3 13.9 1.6a.55.55 0 0 1 .75.68L10.6 14.1a.55.55 0 0 1-1.03.06L7.5 9.7a.55.55 0 0 0-.26-.26L2 7.3a.55.55 0 0 1-.3 0Z" transform="rotate(8 8 8)" />
              </svg>
            }
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m3 8.5 3.4 3.4L13 5.2" />
            </svg>
          </Show>
        </button>
      </div>
      <Show when={composerError()}>
        {(error) => (
          <p class="shell-composer-error" role="alert">
            {error()}
          </p>
        )}
      </Show>
      <p class="shell-composer-hint" aria-hidden="true">
        Enter to send · Shift+Enter for newline · Paste or drop files to attach
      </p>
      </div>
    </section>
  );
}
