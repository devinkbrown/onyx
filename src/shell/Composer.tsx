// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Composer.tsx — message input for the active channel or DM.
 *
 * - Enter sends; Shift+Enter inserts newline; Enter during an IME composition
 *   confirms the candidate and never sends
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
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import { useStore, getState, selectDeviceMemoryOwner, selectOwnedScheduledMessageCount } from '@/lib/store';
import { searchEmojis } from '@/lib/emoji/emoji';
import {
  completeSlashCommand,
  expandSlashTextCommand,
  getSlashCommandSuggestions,
  type SlashCommand,
} from '@/lib/commands/registry';
import { UploadError, uploadFile } from '@/lib/upload/upload';
import { buildAttachmentMessage } from '@/lib/upload/attachmentMessage';
import {
  SCHEDULE_PRESETS,
  isSchedulable,
  parseDateTimeLocal,
  toDateTimeLocalValue,
} from '@/lib/schedule/scheduleTime';
import {
  activeReplyPreviewText,
  hasEncryptedMessageBoundary,
} from '@/lib/e2ee/replyPrivacy';
import {
  activeReplyForTarget,
  messageContextMatchesTarget,
} from '@/lib/composer/messageContext';
import { keyboardEventIsClaimed } from '@/primitives/focusTrap';
import {
  loadOutbox,
  subscribeOutbox,
  type OutboxEntry,
} from '@/lib/vault/historyVault';
import { outboxComposerChrome } from '@/lib/vault/outboxStatus';

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
  const outboxDeliveryFailed = useStore((s) => s.outboxDeliveryFailed);
  const activeChannelTopics = useStore((s) => s.activeChannelTopics);
  const replyingTo = useStore((s) => s.replyingTo);
  const editingMessage = useStore((s) => s.editingMessage);
  const scheduledCount = useStore(selectOwnedScheduledMessageCount);
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );

  // Device-local outbox journal — same substrate Home reads. Metadata only in
  // chrome (count + delivery state); message bodies stay in the conversation.
  const [outboxEntries, { refetch: refetchOutbox }] = createResource(
    () => memoryOwner()?.serverUrl ?? null,
    () => loadOutbox(),
    { initialValue: [] as OutboxEntry[] },
  );
  onCleanup(subscribeOutbox(() => {
    void refetchOutbox();
  }));

  const [text, setText] = createSignal('');
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [composerError, setComposerError] = createSignal<string | null>(null);
  const [dragActive, setDragActive] = createSignal(false);
  const [isSending, setIsSending] = createSignal(false);
  const [emojiOpen, setEmojiOpen] = createSignal(false);
  const [emojiQuery, setEmojiQuery] = createSignal('');
  const [slashDismissed, setSlashDismissed] = createSignal(false);
  const [slashIndex, setSlashIndex] = createSignal(0);
  const [scheduleOpen, setScheduleOpen] = createSignal(false);
  const [scheduleWhen, setScheduleWhen] = createSignal('');
  const [scheduleError, setScheduleError] = createSignal<string | null>(null);

  let textareaRef!: HTMLTextAreaElement;
  let fileInputRef!: HTMLInputElement;
  let emojiSearchRef: HTMLInputElement | undefined;
  let scheduleFirstRef: HTMLButtonElement | undefined;
  const previewUrls = new Set<string>();
  let attachmentScopeKey: string | undefined;
  let activeUpload: AbortController | null = null;

  function clearAttachments(): void {
    setAttachments((items) => {
      for (const item of items) {
        if (!item.previewUrl) continue;
        URL.revokeObjectURL(item.previewUrl);
        previewUrls.delete(item.previewUrl);
      }
      return [];
    });
  }

  onCleanup(() => {
    activeUpload?.abort();
    activeUpload = null;
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

  createEffect(() => {
    const owner = memoryOwner();
    const nextScopeKey = JSON.stringify([
      owner ? deviceMemoryOwnerKey(owner) : null,
      target()?.toLowerCase() ?? null,
    ]);
    if (attachmentScopeKey === undefined) {
      attachmentScopeKey = nextScopeKey;
      return;
    }
    if (nextScopeKey === attachmentScopeKey) return;
    attachmentScopeKey = nextScopeKey;
    activeUpload?.abort();
    activeUpload = null;
    clearAttachments();
    setComposerError(null);
    setDragActive(false);
  });

  const activeEditing = createMemo(() => {
    const edit = editingMessage();
    const t = target();
    if (!edit || !t || hasEncryptedMessageBoundary(edit)) return null;
    return messageContextMatchesTarget(edit, t) ? edit : null;
  });

  // Reply banner is target-scoped the same way edit is: a reply armed in one
  // room must not paint (or send as) a reply while the composer is elsewhere.
  const activeReply = createMemo(() => activeReplyForTarget(replyingTo(), target()));

  createEffect(() => {
    const edit = editingMessage();
    if (edit && hasEncryptedMessageBoundary(edit)) {
      getState().setComposerEditingMessage(null);
    }
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

  const ownedOutboxCount = createMemo(() => {
    const owner = memoryOwner();
    if (!owner) return 0;
    return (outboxEntries.latest ?? []).filter(
      (entry) => entry.owner?.serverUrl === owner.serverUrl
        && entry.owner.identity === owner.identity,
    ).length;
  });

  // Honest outbox chrome: offline queue, waiting flush, or failed delivery.
  // Never silent — empty offline still says messages queue on this device.
  const outboxChrome = createMemo(() => outboxComposerChrome({
    connected: connectionStatus() === 'connected',
    queuedCount: ownedOutboxCount(),
    deliveryFailed: outboxDeliveryFailed(),
  }));

  // Accessible name stays short and stable; the visible placeholder can carry
  // light slash-command discoverability without polluting aria-label.
  const accessibleName = createMemo(() => {
    const t = target();
    if (activeEditing()) return 'Edit message';
    if (isOffline()) return t ? `Offline — queues for ${t}` : 'Reconnecting…';
    if (!t) return 'Pick a room or a person to begin';
    return `Message ${t}`;
  });

  const placeholder = createMemo(() => {
    const t = target();
    if (activeEditing()) return 'Edit message';
    if (isOffline()) return t ? `Offline — queues for ${t}` : 'Reconnecting…';
    if (!t) return 'Pick a room or a person to begin';
    return `Message ${t}  ·  /search  /mute  /export  /help`;
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

  // When the emoji dialog opens, move keyboard focus into it (to the search
  // field) so a keyboard user is never stranded on the toggle button with an
  // open, unreachable popup. SC 2.4.3 Focus Order / 2.1.1 Keyboard.
  createEffect(() => {
    if (!emojiOpen()) return;
    queueMicrotask(() => emojiSearchRef?.focus());
  });

  // Close the emoji dialog and restore focus to the textarea (the trigger's
  // logical origin), so dismissing it never drops focus to <body>.
  function closeEmojiPicker(restoreFocus = true): void {
    setEmojiOpen(false);
    if (restoreFocus) focusTextarea();
  }

  // ── schedule ("send later") ──
  // Only plain, non-empty text to a real target can be scheduled: slash
  // commands aren't queued (replaying a stale command is surprising), and
  // attachments/edits need the network at send time. Scheduling works OFFLINE
  // — the queue persists and the store dispatches it once connected.
  const canSchedule = createMemo(() => {
    if (activeEditing() || attachments().length > 0) return false;
    const body = text().trim();
    return !!target() && body.length > 0 && !body.startsWith('/');
  });

  // Move focus into the schedule popover when it opens (SC 2.4.3 / 2.1.1).
  createEffect(() => {
    if (!scheduleOpen()) return;
    queueMicrotask(() => scheduleFirstRef?.focus());
  });

  function closeSchedule(restoreFocus = true): void {
    setScheduleOpen(false);
    setScheduleError(null);
    if (restoreFocus) focusTextarea();
  }

  /** Queue the current composer text for `epoch`, then reset like a send. */
  function scheduleAt(epoch: number): void {
    const t = target();
    const body = text().trim();
    if (!t || !body || body.startsWith('/')) return;
    if (!isSchedulable(epoch, Date.now())) {
      setScheduleError('Pick a time at least a minute from now.');
      return;
    }
    getState().scheduleMessage(t, body, epoch);
    getState().addToast({
      variant: 'success',
      title: 'Message scheduled',
      description: `Will send to ${t} at the time you picked.`,
    });
    setScheduleWhen('');
    closeSchedule(false);
    resetAfterSend(t);
  }

  /** Schedule from the custom datetime-local field. */
  function scheduleCustom(): void {
    const epoch = parseDateTimeLocal(scheduleWhen(), Date.now());
    if (epoch === null) {
      setScheduleError('Enter a valid time at least a minute from now.');
      return;
    }
    scheduleAt(epoch);
  }

  let loadedTarget: string | null = null;
  let loadedEditId: string | null = null;
  let focusedReplyId: string | null = null;
  createEffect(() => {
    const t = target();
    const edit = activeEditing();

    if (edit) {
      if (loadedEditId !== edit.id) {
        loadedEditId = edit.id;
        setComposerText(edit.text, false);
        // Land keyboard focus in the composer so edit is immediately typable.
        focusTextarea(edit.text.length);
      }
      return;
    }

    // Edit ended without the send path clearing loadedEditId first (Escape,
    // mutual exclusivity with reply, encrypted reject). Restore the draft so
    // the in-progress edit body does not silently become the room draft.
    if (loadedEditId !== null) {
      loadedEditId = null;
      setComposerText(t ? getState().getComposerDraft(t) : '', false);
      return;
    }

    if (t !== loadedTarget) {
      loadedTarget = t;
      setComposerText(t ? getState().getComposerDraft(t) : '', false);
    }
  });

  // Focus the textarea when a matching reply is armed so the user can type
  // immediately after clicking Reply (Discord/Slack comfort).
  createEffect(() => {
    const reply = activeReply();
    if (!reply || activeEditing()) {
      focusedReplyId = null;
      return;
    }
    if (focusedReplyId === reply.id) return;
    focusedReplyId = reply.id;
    focusTextarea();
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
    // While an IME composition is active every key belongs to the IME —
    // candidate navigation (arrows), confirmation (Enter) and cancel (Escape).
    // The Enter that CONFIRMS a candidate carries isComposing=true; letting it
    // reach the send/slash paths would fire a half-composed message and destroy
    // the in-progress composition. Yield the whole event to the browser/IME.
    if (keyboardEventIsClaimed(e)) return;

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

    if (e.key === 'Escape' && scheduleOpen()) {
      e.preventDefault();
      closeSchedule();
      return;
    }

    // Escape dismisses edit, then reply — after transient pickers — so a
    // keyboard user can back out of composer context without the mouse.
    if (e.key === 'Escape' && activeEditing()) {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === 'Escape' && activeReply()) {
      e.preventDefault();
      cancelReply();
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

  async function uploadPendingAttachments(signal: AbortSignal): Promise<string[] | null> {
    const uploaded: string[] = [];
    // Production default: same-origin '/upload' (nginx proxies it to the
    // nexus-upload service). Dev has no default — uploads surface a config
    // error unless VITE_MEDIA_URL is set, and previews stay local blob URLs.
    const mediaUrl =
      (import.meta.env.VITE_MEDIA_URL as string | undefined) ||
      (import.meta.env.PROD ? '/upload' : '');

    for (const item of attachments()) {
      if (signal.aborted) return null;
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
          signal,
          onProgress: (progress) => {
            if (signal.aborted) return;
            updateAttachment(item.id, {
              progress: progress.percent,
            });
          },
        });
        if (signal.aborted) return null;
        updateAttachment(item.id, {
          status: 'uploaded',
          progress: 100,
          uploadedUrl: result.url,
        });
        uploaded.push(result.url);
      } catch (error) {
        if (signal.aborted) return null;
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
    clearAttachments();
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
      // Mark edit as intentionally finished BEFORE clearing store state so the
      // load-effect does not restore the pre-edit draft over the empty send.
      loadedEditId = null;
      getState().editMessage(t, edit.id, content);
      getState().setComposerEditingMessage(null);
      setComposerText('', false);
      return;
    }

    setIsSending(true);
    const upload = new AbortController();
    activeUpload?.abort();
    activeUpload = upload;
    const sendScopeKey = attachmentScopeKey;
    try {
      const urls = await uploadPendingAttachments(upload.signal);
      if (!urls) return;
      if (
        upload.signal.aborted
        || sendScopeKey !== attachmentScopeKey
        || target()?.toLowerCase() !== t.toLowerCase()
      ) return;

      const baseContent = expandSlashTextCommand(text().trim());
      // Prefer safe attachment lines (caption + [file: name] url) over bare URLs.
      const attachmentLines: string[] = [];
      for (let i = 0; i < urls.length; i += 1) {
        const url = urls[i]!;
        const item = attachments().find((a) => a.uploadedUrl === url) ?? attachments()[i];
        const line = buildAttachmentMessage({
          url,
          name: item?.file.name,
          caption: i === 0 ? baseContent || undefined : undefined,
        });
        if (line) attachmentLines.push(line);
        else attachmentLines.push(url);
      }
      const content = (
        attachmentLines.length > 0
          ? attachmentLines.join('\n')
          : baseContent
      ).trim();
      if (!content) return;

      // Real IRC commands are intentionally never replayed from the offline
      // outbox: their authority and meaning can change before reconnect. Keep
      // that safety boundary visible at the composer, though. Previously the
      // store silently ignored an offline slash command while this component
      // still cleared the textarea and persisted draft, losing the user's
      // input. Text-only conveniences such as /shrug have already expanded to
      // ordinary text above and remain safe to queue.
      if (isOffline() && content.startsWith('/')) {
        setComposerError("Commands can't be queued. Reconnect to run this command.");
        focusTextarea();
        return;
      }

      getState().sendMessage(t, content);
      resetAfterSend(t);
    } finally {
      if (activeUpload === upload) activeUpload = null;
      setIsSending(false);
    }
  }

  function cancelReply(): void {
    getState().setReplyingTo(null);
    focusedReplyId = null;
    // Backing out of a reply is not "still composing" — clear the typing signal.
    const t = target();
    if (t) getState().sendTypingStop(t);
  }

  function cancelEdit(): void {
    // Clear the load marker so the effect does not double-restore the draft.
    loadedEditId = null;
    getState().setComposerEditingMessage(null);
    const t = target();
    setComposerText(t ? getState().getComposerDraft(t) : '', false);
    if (t) getState().sendTypingStop(t);
  }

  function clearTopic(): void {
    const view = activeView();
    if (view.kind !== 'channel') return;
    getState().openChannelConversation(view.channel, null);
    // The clear chip unmounts as soon as the whole-room view becomes active.
    // Move focus to the stable message input instead of leaving it on <body>.
    focusTextarea();
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
      <Show when={outboxChrome()}>
        {(chrome) => (
          <div
            class={`shell-composer-outbox shell-composer-outbox--${chrome().tone}`}
            data-kind={chrome().kind}
            role="status"
            aria-live="polite"
          >
            <span class="shell-composer-outbox-label">{chrome().label}</span>
            <span class="sr-only">{chrome().announcement}</span>
            <Show when={chrome().canRetry}>
              <button
                type="button"
                class="shell-composer-outbox-retry"
                onClick={() => getState().flushOutbox()}
              >
                Try sending now
              </button>
            </Show>
          </div>
        )}
      </Show>

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

      <Show when={activeReply()}>
        {(reply) => (
          <div class="shell-composer-context" role="status" aria-live="polite">
            <span class="shell-composer-context-label">replying to {reply().from}</span>
            <span class="shell-composer-context-text">
              {clippedText(activeReplyPreviewText(reply()))}
            </span>
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
                  id={`shell-command-option-${index()}`}
                  class={`shell-command-item${index() === slashIndex() ? ' shell-command-item--active' : ''}`}
                  role="option"
                  tabindex={-1}
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
          <div
            id="shell-emoji-picker"
            class="shell-emoji-picker"
            role="dialog"
            aria-modal="false"
            aria-label="Emoji picker"
            onKeyDown={(e) => {
              if (keyboardEventIsClaimed(e)) return;
              // Escape from anywhere inside the dialog (search field, an emoji
              // choice, or the grid) closes it and returns focus to the composer.
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeEmojiPicker();
              }
            }}
          >
            <label class="sr-only" for="shell-emoji-search">Search emoji</label>
            <input
              ref={emojiSearchRef}
              id="shell-emoji-search"
              class="shell-emoji-search"
              value={emojiQuery()}
              placeholder="Search emoji"
              aria-label="Search emoji"
              onInput={(e) => setEmojiQuery((e.currentTarget as HTMLInputElement).value)}
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

        <Show when={scheduleOpen()}>
          <div
            id="shell-schedule-picker"
            class="shell-schedule-picker"
            role="dialog"
            aria-modal="false"
            aria-label="Schedule message"
            onKeyDown={(e) => {
              if (keyboardEventIsClaimed(e)) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSchedule();
              }
            }}
          >
            <p class="shell-schedule-heading">Send later</p>
            <div class="shell-schedule-presets">
              <For each={SCHEDULE_PRESETS}>
                {(preset, i) => (
                  <button
                    ref={(el) => { if (i() === 0) scheduleFirstRef = el; }}
                    type="button"
                    class="shell-schedule-preset"
                    onClick={() => scheduleAt(preset.at(Date.now()))}
                  >
                    {preset.label}
                  </button>
                )}
              </For>
            </div>
            <label class="shell-schedule-custom-label" for="shell-schedule-when">
              Or pick a time
            </label>
            <div class="shell-schedule-custom">
              <input
                id="shell-schedule-when"
                class="shell-schedule-input"
                type="datetime-local"
                min={toDateTimeLocalValue(Date.now())}
                value={scheduleWhen()}
                aria-describedby={scheduleError() ? 'shell-schedule-error' : undefined}
                aria-invalid={scheduleError() ? 'true' : undefined}
                onInput={(e) => {
                  setScheduleWhen((e.currentTarget as HTMLInputElement).value);
                  setScheduleError(null);
                }}
              />
              <button
                type="button"
                class="shell-schedule-confirm"
                disabled={!scheduleWhen()}
                onClick={scheduleCustom}
              >
                Schedule
              </button>
            </div>
            <Show when={scheduleError()}>
              {(err) => (
                <p id="shell-schedule-error" class="shell-schedule-error" role="alert">
                  {err()}
                </p>
              )}
            </Show>
            <Show when={scheduledCount() > 0}>
              <button
                type="button"
                class="shell-schedule-view"
                onClick={() => { closeSchedule(false); getState().openScheduledMessages(); }}
              >
                View {scheduledCount()} scheduled
              </button>
            </Show>
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

        <button
          type="button"
          class="shell-composer-tool"
          disabled={!canSchedule()}
          aria-label="Schedule message to send later"
          aria-haspopup="dialog"
          aria-expanded={scheduleOpen()}
          aria-controls={scheduleOpen() ? 'shell-schedule-picker' : undefined}
          data-composer-schedule=""
          onClick={() => setScheduleOpen((open) => !open)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="8" cy="8.6" r="5.2" />
            <path d="M8 5.6v3l2 1.2" />
            <path d="M5.4 1.8 3.2 3.4M10.6 1.8l2.2 1.6" />
          </svg>
        </button>

        <button
          type="button"
          class="shell-composer-tool"
          disabled={!target()}
          aria-label="Jump to date in conversation history"
          aria-haspopup="dialog"
          title="Jump to date"
          data-testid="composer-jump-to-date"
          onClick={() => getState().openJumpToDate()}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2.2" y="3.4" width="11.6" height="10.4" rx="1.4" />
            <path d="M5 2.2v2.4M11 2.2v2.4M2.2 7h11.6" />
            <path d="M8 9.2v2M8 9.2l1.4.8" />
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
          data-composer-input=""
          class="shell-composer-textarea"
          placeholder={placeholder()}
          disabled={!isEnabled()}
          rows={1}
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          aria-label={accessibleName()}
          aria-disabled={!isEnabled()}
          aria-multiline="true"
          aria-controls={slashVisible() ? 'shell-command-menu' : undefined}
          aria-expanded={slashVisible()}
          aria-autocomplete={slashVisible() ? 'list' : undefined}
          aria-activedescendant={
            slashVisible() ? `shell-command-option-${slashIndex()}` : undefined
          }
        />
        <button
          type="button"
          class="shell-composer-send"
          disabled={!isEnabled() || !canSend()}
          aria-label={activeEditing() ? 'Save edit' : 'Send message'}
          aria-busy={isSending()}
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
