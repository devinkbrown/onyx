// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Composer.tsx — message input for the active channel or DM.
 *
 * - Enter sends; Shift+Enter inserts newline; Enter during an IME composition
 *   confirms the candidate and never sends
 * - Textarea grows with content (one line → ~5 lines, then internal scroll)
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
import { useStore, getState, setState, selectDeviceMemoryOwner, selectOwnedScheduledMessageCount } from '@/lib/store';
import { searchEmojis } from '@/lib/emoji/emoji';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import {
  completeSlashCommand,
  expandSlashTextCommand,
  getSlashCommandSuggestions,
  type SlashCommand,
} from '@/lib/commands/registry';
import {
  applyNickCompletion,
  cycleNickCompletion,
  nickTokenAt,
  rankNickCompletions,
} from '@/lib/composer/nickComplete';
import { mergeComposerInsert } from '@/lib/composer/composerInject';
import { composerDraftKey } from '@/lib/composer/drafts';
import { uploadFile } from '@/lib/upload/upload';
import { ATTACHMENT_SEND_FAILED, buildAttachmentMessage } from '@/lib/upload/attachmentMessage';
import {
  formatAttachmentBytes,
  planAttachmentAccept,
} from '@/lib/upload/attachmentCaps';
import {
  compactPhoto,
  isPhotoFile,
  keepOriginalFile,
  photoQualityOptions,
  stripPhotoExif,
  type PhotoQuality,
} from '@/lib/upload/photoPolicy';
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
import {
  firstHourComposerHint,
  firstHourHandoffEpoch,
  isFirstHourSeen,
  markComposerFocused,
  markFirstHourSeen,
  shouldFocusComposer,
} from '@/lib/firstHour/firstHour';
import { FirstHourCoach } from './FirstHourCoach';

export type ComposerProps = {
  /** Optionally override the active target; defaults to deriving from activeView */
  target?: string;
};

type AttachmentState = 'ready' | 'uploading' | 'uploaded' | 'error';

type ComposerAttachment = {
  id: string;
  file: File;
  originalFile: File;
  photoFile: File | null;
  compactFile: File | null;
  previewUrl: string | null;
  status: AttachmentState;
  progress: number | null;
  error: string | null;
  uploadedUrl: string | null;
  treatAs: 'photo' | 'file';
  quality: PhotoQuality;
  sendOriginal: boolean;
  originalBytes: number;
  compactBytes: number | null;
};

let attachmentId = 0;

function nextAttachmentId(): string {
  attachmentId += 1;
  return `composer-attachment-${Date.now()}-${attachmentId}`;
}

function formatBytes(bytes: number): string {
  return formatAttachmentBytes(bytes);
}

function fileToUpload(item: ComposerAttachment): File {
  if (item.treatAs === 'file' || item.sendOriginal) return keepOriginalFile(item.originalFile);
  if (item.quality === 'compact' && item.compactFile) return item.compactFile;
  return item.photoFile ?? item.file;
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
  const [nickDismissed, setNickDismissed] = createSignal(false);
  const [nickIndex, setNickIndex] = createSignal(0);
  const [caretPos, setCaretPos] = createSignal(0);
  const [scheduleOpen, setScheduleOpen] = createSignal(false);
  const [scheduleWhen, setScheduleWhen] = createSignal('');
  const [scheduleError, setScheduleError] = createSignal<string | null>(null);
  /** Standard primary "More tools" disclosure (schedule / jump / command tip). */
  const [toolsOpen, setToolsOpen] = createSignal(false);

  let textareaRef!: HTMLTextAreaElement;
  let fileInputRef!: HTMLInputElement;
  let emojiSearchRef: HTMLInputElement | undefined;
  let scheduleFirstRef: HTMLButtonElement | undefined;
  let moreToolsTriggerRef: HTMLButtonElement | undefined;
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

  // Accessible name carries the destination context. Keep the visible
  // placeholder deliberately short: mobile WebKit includes wrapped placeholder
  // lines in textarea.scrollHeight, so command advertising here turns an empty
  // one-line composer into a tall, visually misaligned field.
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
    if (t.startsWith('#') || t.startsWith('&')) return `Message ${t}`;
    return `Message @${t}`;
  });

  // Keep the destination and the current composition state visible above the
  // field. This uses the same target-scoped signals as send, so a reply or edit
  // from another room cannot leak into the current compose context.
  const composerBrief = createMemo(() => {
    const t = target();
    if (!t) return { destination: 'No conversation selected', state: 'Choose a room or person to begin.' };
    if (activeEditing()) return { destination: `Editing in ${t}`, state: 'Save or cancel this edit before changing context.' };
    const reply = activeReply();
    if (reply) return { destination: `Replying in ${t}`, state: `Reply to ${reply.from}` };
    if (isOffline()) return { destination: `To ${t}`, state: 'Offline — plain messages queue on this device.' };
    const topic = activeTopic();
    if (topic) return { destination: `To ${t}`, state: 'Writing in the current topic' };
    return { destination: `To ${t}`, state: 'Ready to send' };
  });

  const emojiMatches = createMemo(() => searchEmojis(emojiQuery(), 36));
  const slashCommands = createMemo(() => getSlashCommandSuggestions(text(), 8));
  const slashVisible = createMemo(() => !slashDismissed() && slashCommands().length > 0);

  // Nick Tab-complete candidates for the active room (channel roster or DM peer).
  const nickCandidates = createMemo((): string[] => {
    const t = target();
    if (!t) return [];
    const state = getState();
    const view = state.activeView;
    if (view.kind === 'dm') {
      const peer = view.nick;
      const self = state.ourNick;
      return [peer, self].filter((n): n is string => typeof n === 'string' && n.length > 0);
    }
    const ch = state.channels.get(t.toLowerCase());
    if (!ch) return [];
    // Prefer display nick casing from ChannelUser; fall back to map key.
    return Array.from(ch.users.values()).map((u) => u.nick || '').filter(Boolean);
  });
  let nickCycleIndex = -1;
  let nickCycleQuery = '';

  const activeNickToken = createMemo(() => nickTokenAt(text(), caretPos()));
  const nickMatches = createMemo(() => {
    const token = activeNickToken();
    if (!token) return [] as string[];
    // Require @ or at least one typed char so idle composer stays quiet.
    if (!token.at && token.query.length < 1) return [] as string[];
    return rankNickCompletions(token.query, nickCandidates());
  });
  const nickVisible = createMemo(
    () => !nickDismissed() && !slashVisible() && nickMatches().length > 0,
  );

  const canSend = createMemo(() => {
    if (isSending()) return false;
    if (activeEditing()) return text().trim().length > 0 && attachments().length === 0;
    return text().trim().length > 0 || attachments().length > 0;
  });

  createEffect(() => {
    slashCommands();
    setSlashIndex(0);
  });

  createEffect(() => {
    nickMatches();
    setNickIndex(0);
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

  // ── More tools (Schedule / Jump to date / slash tip) ──
  // Power controls leave the Standard primary row so attach · message · emoji ·
  // send stays calm for the general public. Capability is preserved behind a
  // labelled, non-modal disclosure — never deleted.
  function closeTools(restore: 'trigger' | 'textarea' | false = 'trigger'): void {
    setToolsOpen(false);
    if (restore === 'trigger') {
      queueMicrotask(() => moreToolsTriggerRef?.focus());
    } else if (restore === 'textarea') {
      focusTextarea();
    }
  }

  function toggleTools(): void {
    if (toolsOpen()) {
      closeTools('trigger');
      return;
    }
    // Opening tools should not stack competing transient chrome.
    setEmojiOpen(false);
    setScheduleOpen(false);
    setToolsOpen(true);
  }

  /** Open schedule via More tools: collapse the tray first, then existing focus handoff. */
  function openScheduleFromTools(): void {
    if (!canSchedule()) return;
    setToolsOpen(false);
    setScheduleOpen(true);
  }

  /** Jump-to-date from More tools — close tray then existing sheet open. */
  function openJumpFromTools(): void {
    if (!target()) return;
    setToolsOpen(false);
    getState().openJumpToDate();
  }

  /**
   * Command help: only focuses the textarea and inserts a leading slash so the
   * existing slash autocomplete can teach. Never executes a command.
   */
  function startSlashCommandHelp(): void {
    setToolsOpen(false);
    const current = text();
    const start = textareaRef?.selectionStart ?? current.length;
    const end = textareaRef?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}/${current.slice(end)}`;
    setComposerText(next);
    setSlashDismissed(false);
    setSlashIndex(0);
    focusTextarea(start + 1);
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

  const scheduleDisabledReason = createMemo(() => {
    if (canSchedule()) return null;
    if (activeEditing()) return 'Finish editing before scheduling.';
    if (attachments().length > 0) return 'Remove attachments to schedule plain text.';
    const body = text().trim();
    if (!target()) return 'Choose a room or message to schedule.';
    if (!body) return 'Type a message before scheduling.';
    if (body.startsWith('/')) return 'Slash commands cannot be scheduled.';
    return 'Scheduling unavailable.';
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
    if (!getState().scheduleMessage(t, body, epoch)) {
      setScheduleError('Protected room messages cannot be stored for later. Send while connected.');
      return;
    }
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
  let appliedInjectSeq = 0;
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

  // One-shot Quote / Mention inject from message menu or member card.
  // Store already merged+persisted the draft; here we sync the live textarea.
  const composerInject = useStore((s) => s.composerInject);
  createEffect(() => {
    const inj = composerInject();
    if (!inj || inj.seq <= appliedInjectSeq) return;
    const t = target();
    if (!t || activeEditing()) return;
    const key = composerDraftKey(t);
    if (!key || key !== inj.target) return;
    appliedInjectSeq = inj.seq;
    const merged = mergeComposerInsert('', inj.text, 'replace');
    setComposerText(merged.text, false); // already persisted by injectComposerText
    focusTextarea(merged.caret);
    if (getState().composerInject?.seq === inj.seq) {
      setState({ composerInject: null });
    }
  });

  const pendingComposerFocusTarget = useStore((s) => s.pendingComposerFocusTarget);
  createEffect(() => {
    const want = pendingComposerFocusTarget();
    const t = target();
    if (!want || !t) return;
    if (want.toLowerCase() !== t.toLowerCase()) return;
    focusTextarea();
    getState().clearPendingComposerFocus();
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

  const sayHiHint = createMemo(() => {
    firstHourHandoffEpoch();
    isFirstHourSeen();
    return firstHourComposerHint();
  });

  createEffect(() => {
    firstHourHandoffEpoch();
    const view = activeView();
    const channel = view.kind === 'channel' ? view.channel : null;
    if (!shouldFocusComposer(channel)) return;
    markComposerFocused();
    focusTextarea();
  });

  // ── auto-resize ──
  // Grow to the CSS max (~5 lines). Reading computed max-height keeps JS in
  // lockstep with the desktop / phone / landscape caps in shell.css.
  function autoResize(): void {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    const parsed = Number.parseFloat(getComputedStyle(el).maxHeight);
    const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : 160;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
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

  function completeNick(nick: string): void {
    const token = activeNickToken();
    if (!token) return;
    const applied = applyNickCompletion(text(), token, nick);
    setComposerText(applied.text);
    setNickDismissed(true);
    nickCycleIndex = -1;
    nickCycleQuery = '';
    setCaretPos(applied.caret);
    focusTextarea(applied.caret);
  }

  function syncCaretFromEvent(e: { currentTarget: EventTarget | null }): void {
    const el = e.currentTarget as HTMLTextAreaElement | null;
    if (!el) return;
    setCaretPos(el.selectionStart ?? el.value.length);
  }

  function handleInput(e: InputEvent): void {
    const el = e.currentTarget as HTMLTextAreaElement;
    const next = el.value;
    setComposerText(next);
    setCaretPos(el.selectionStart ?? next.length);
    setComposerError(null);
    setSlashDismissed(false);
    setNickDismissed(false);
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

    // Nick suggestion list (same keys as slash) when @ or a nick prefix is active.
    if (nickVisible()) {
      const matches = nickMatches();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setNickIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setNickIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if ((e.key === 'Tab' || e.key === 'Enter') && matches.length > 0) {
        e.preventDefault();
        completeNick(matches[nickIndex()] ?? matches[0]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setNickDismissed(true);
        return;
      }
    }

    // Tab completes a nick prefix (or @mention) when slash suggestions are idle
    // and the popup is dismissed or not yet visible.
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const el = e.currentTarget as HTMLTextAreaElement;
      const caret = el.selectionStart ?? text().length;
      setCaretPos(caret);
      const current = text();
      // Reset cycle when the incomplete query changes.
      const token = nickTokenAt(current, caret);
      const q = token?.query ?? '';
      if (q !== nickCycleQuery) {
        nickCycleQuery = q;
        nickCycleIndex = -1;
      }
      const result = cycleNickCompletion(current, caret, nickCandidates(), nickCycleIndex);
      if (result) {
        e.preventDefault();
        nickCycleIndex = result.index;
        setNickIndex(result.index);
        setComposerText(result.text);
        setCaretPos(result.caret);
        focusTextarea(result.caret);
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

    if (e.key === 'Escape' && toolsOpen()) {
      e.preventDefault();
      closeTools('trigger');
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
    const decision = planAttachmentAccept(files, current.length);
    const accepted: ComposerAttachment[] = [];
    for (const index of decision.acceptIndexes) {
      const file = files[index];
      if (!file) continue;
      const photo = isPhotoFile(file);
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      if (previewUrl) previewUrls.add(previewUrl);
      accepted.push({
        id: nextAttachmentId(),
        file,
        originalFile: file,
        photoFile: null,
        compactFile: null,
        previewUrl,
        status: 'ready',
        progress: null,
        error: null,
        uploadedUrl: null,
        treatAs: photo ? 'photo' : 'file',
        quality: 'original',
        sendOriginal: false,
        originalBytes: file.size,
        compactBytes: null,
      });
    }

    if (accepted.length > 0) {
      setAttachments((items) => [...items, ...accepted]);
    }
    if (decision.error) setComposerError(decision.error);
    else if (accepted.length > 0) setComposerError(null);

    for (const item of accepted) {
      if (item.treatAs === 'photo') void preparePhotoAttachment(item.id, item.originalFile);
    }
  }

  async function preparePhotoAttachment(id: string, original: File): Promise<void> {
    try {
      const photoFile = await stripPhotoExif(original);
      const compact = await compactPhoto(photoFile);
      updateAttachment(id, {
        photoFile,
        file: photoFile,
        compactFile: compact?.file ?? null,
        compactBytes: compact?.compactBytes ?? null,
      });
    } catch {
      // Keep the staged original; Send original still works.
    }
  }

  function choosePhotoQuality(id: string, quality: PhotoQuality): void {
    const item = attachments().find((entry) => entry.id === id);
    if (!item) return;
    const nextFile = quality === 'compact'
      ? (item.compactFile ?? item.photoFile ?? item.file)
      : (item.photoFile ?? item.file);
    updateAttachment(id, {
      quality,
      sendOriginal: false,
      treatAs: 'photo',
      file: nextFile,
    });
  }

  function chooseSendOriginal(id: string): void {
    const item = attachments().find((entry) => entry.id === id);
    if (!item) return;
    updateAttachment(id, {
      sendOriginal: true,
      file: keepOriginalFile(item.originalFile),
    });
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

  function filesFromClipboard(data: DataTransfer | null): File[] {
    if (!data) return [];
    const listed = Array.from(data.files ?? []);
    if (listed.length > 0) return listed;
    const fromItems: File[] = [];
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) fromItems.push(file);
    }
    return fromItems;
  }

  function handlePaste(e: ClipboardEvent): void {
    const files = filesFromClipboard(e.clipboardData);
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
        const result = await uploadFile(fileToUpload(item), {
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
        updateAttachment(item.id, {
          status: 'error',
          error: ATTACHMENT_SEND_FAILED,
          progress: null,
        });
        setComposerError(ATTACHMENT_SEND_FAILED);
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
    setToolsOpen(false);
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

    markFirstHourSeen();
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
        const outgoing = item ? fileToUpload(item) : null;
        const line = buildAttachmentMessage({
          url,
          name: outgoing?.name ?? item?.file.name,
          sizeBytes: outgoing?.size ?? item?.file.size,
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

      const admission = getState().sendMessage(t, content);
      const admitted = admission instanceof Promise ? await admission : admission;
      // Required encrypted rooms can reject before socket admission when the
      // session is locked or changes during WebCrypto. Keep the exact draft so
      // the user can retry instead of turning a safe refusal into data loss.
      if (admitted === false) {
        setComposerError('Message was not sent. Your draft is still here.');
        focusTextarea();
        return;
      }
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
        <div class="shell-composer-brief" role="note" aria-label="Current compose context">
          <span class="shell-composer-brief-destination">{composerBrief().destination}</span>
          <span class="shell-composer-brief-state">{composerBrief().state}</span>
        </div>
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
          <div
            class="shell-composer-topic"
            role="status"
            aria-live="polite"
            aria-label={`Writing in topic ${topic()}`}
          >
            <span class="shell-composer-topic-label">topic mode</span>
            <span class="shell-composer-topic-name">Writing in the current topic</span>
            <button type="button" class="shell-composer-topic-clear" aria-label={`Clear topic ${topic()}`} onClick={clearTopic}>
              ×
            </button>
          </div>
        )}
      </Show>

      <Show when={activeReply()}>
        {(reply) => (
          <div class="shell-composer-context" role="status" aria-live="polite">
            <span class="shell-composer-context-label">Replying to {reply().from}</span>
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
            <span class="shell-composer-context-label">Editing</span>
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
                  <span class="shell-attachment-size">{formatBytes(fileToUpload(item).size)}</span>
                  <Show when={item.treatAs === 'photo'}>
                    <div class="shell-attachment-quality" role="radiogroup" aria-label={`Photo quality for ${item.originalFile.name}`}>
                      <For each={photoQualityOptions(item.originalBytes, item.compactBytes)}>
                        {(option) => (
                          <button
                            type="button"
                            class="shell-attachment-quality-opt"
                            role="radio"
                            aria-checked={!item.sendOriginal && item.quality === option.quality}
                            disabled={item.status === 'uploading'}
                            onClick={() => choosePhotoQuality(item.id, option.quality)}
                          >
                            {option.label}
                          </button>
                        )}
                      </For>
                      <button
                        type="button"
                        class="shell-attachment-quality-opt"
                        aria-pressed={item.sendOriginal}
                        disabled={item.status === 'uploading'}
                        onClick={() => chooseSendOriginal(item.id)}
                      >
                        Send original
                      </button>
                    </div>
                  </Show>
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

        <Show when={nickVisible()}>
          <div
            id="shell-nick-menu"
            class="shell-command-menu shell-nick-menu"
            role="listbox"
            aria-label="Name completions"
            data-testid="composer-nick-menu"
          >
            <For each={nickMatches()}>
              {(nick, index) => (
                <button
                  type="button"
                  id={`shell-nick-option-${index()}`}
                  class={`shell-command-item${index() === nickIndex() ? ' shell-command-item--active' : ''}`}
                  role="option"
                  tabindex={-1}
                  aria-selected={index() === nickIndex()}
                  data-testid={`composer-nick-option-${nick}`}
                  onMouseEnter={() => setNickIndex(index())}
                  onClick={() => completeNick(nick)}
                >
                  <span class="shell-command-usage">{nick}</span>
                  <span class="shell-command-desc">Complete nick</span>
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

      {/*
        Standard primary row (commercial slice 4):
        Attach · message · Emoji · More tools · Send
        Schedule + Jump live only inside More tools — no primary duplicates.
      */}
      <div class="shell-composer-inner" data-composer-primary-row="">
        <button
          type="button"
          class="shell-composer-tool shell-composer-tool--attach"
          data-composer-primary="attach"
          disabled={!isEnabled() || !!activeEditing() || isOffline()}
          aria-label="Attach files"
          title="Attach files"
          onClick={handleAttachClick}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M8 3.2v9.6M3.2 8h9.6" />
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

        <label for="shell-composer-input" class="sr-only">
          <Show when={target()} fallback="Message input (no active room)">
            {(t) => `Message ${t()}`}
          </Show>
        </label>
        <textarea
          ref={textareaRef!}
          id="shell-composer-input"
          data-composer-input=""
          data-composer-primary="message"
          class="shell-composer-textarea"
          placeholder={placeholder()}
          disabled={!isEnabled()}
          rows={1}
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={syncCaretFromEvent}
          onSelect={syncCaretFromEvent}
          onKeyUp={syncCaretFromEvent}
          onPaste={handlePaste}
          aria-label={accessibleName()}
          aria-disabled={!isEnabled()}
          aria-multiline="true"
          aria-controls={
            slashVisible()
              ? 'shell-command-menu'
              : nickVisible()
                ? 'shell-nick-menu'
                : undefined
          }
          aria-expanded={slashVisible() || nickVisible()}
          aria-autocomplete={slashVisible() || nickVisible() ? 'list' : undefined}
          aria-activedescendant={
            slashVisible()
              ? `shell-command-option-${slashIndex()}`
              : nickVisible()
                ? `shell-nick-option-${nickIndex()}`
                : undefined
          }
        />

        <button
          type="button"
          class="shell-composer-tool shell-composer-tool--emoji"
          data-composer-primary="emoji"
          disabled={!isEnabled()}
          aria-label="Insert emoji"
          aria-haspopup="dialog"
          aria-expanded={emojiOpen()}
          aria-controls={emojiOpen() ? 'shell-emoji-picker' : undefined}
          title="Insert emoji"
          onClick={() => {
            setToolsOpen(false);
            setEmojiOpen((open) => !open);
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M5.6 9.4a3.1 3.1 0 0 0 4.8 0" />
            <circle cx="6" cy="6.4" r="0.5" fill="currentColor" stroke="none" />
            <circle cx="10" cy="6.4" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <div class="shell-composer-more-wrap">
          <button
            ref={(el) => { moreToolsTriggerRef = el; }}
            type="button"
            class="shell-composer-tool shell-composer-tool--more"
            data-composer-primary="more"
            data-testid="composer-more-tools"
            disabled={!target()}
            aria-label="More tools"
            aria-haspopup="dialog"
            aria-expanded={toolsOpen()}
            aria-controls={toolsOpen() ? 'shell-composer-tools' : undefined}
            title="More tools"
            onClick={() => toggleTools()}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.15" />
              <circle cx="8" cy="8" r="1.15" />
              <circle cx="12.5" cy="8" r="1.15" />
            </svg>
          </button>

          {/*
            Always-mounted keyboard bridge for composer.schedule (Ctrl/Cmd+Shift+L).
            Visible Schedule lives only inside More tools; the registry handler
            clickComposerControl('[data-composer-schedule]') needs a stable target
            even when the tray is closed. Non-accessible (hidden + aria-hidden),
            not a primary-row duplicate, truthful disabled, same open path.
          */}
          <button
            type="button"
            hidden
            tabIndex={-1}
            aria-hidden="true"
            data-composer-schedule=""
            disabled={!canSchedule()}
            onClick={() => openScheduleFromTools()}
          />

          <Show when={toolsOpen()}>
            <div
              id="shell-composer-tools"
              class="shell-composer-tools"
              role="dialog"
              aria-modal="false"
              aria-label="More composer tools"
              data-testid="composer-tools-tray"
              onKeyDown={(e) => {
                if (keyboardEventIsClaimed(e)) return;
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeTools('trigger');
                }
              }}
            >
              <button
                type="button"
                class="shell-composer-tools-item"
                disabled={!canSchedule()}
                aria-label="Schedule message to send later"
                aria-haspopup="dialog"
                aria-expanded={scheduleOpen()}
                aria-controls={scheduleOpen() ? 'shell-schedule-picker' : undefined}
                aria-describedby="shell-composer-tools-schedule-desc"
                title={scheduleDisabledReason() ?? 'Schedule this message'}
                data-testid="composer-schedule"
                onClick={() => openScheduleFromTools()}
              >
                <span class="shell-composer-tools-item-title">Send later</span>
                <span id="shell-composer-tools-schedule-desc" class="shell-composer-tools-item-desc">
                  {scheduleDisabledReason() ?? 'Schedule this message for a time you pick.'}
                </span>
              </button>

              <button
                type="button"
                class="shell-composer-tools-item"
                disabled={!target()}
                aria-label="Jump to date in conversation history"
                aria-describedby="shell-composer-tools-jump-desc"
                title="Jump to date"
                data-testid="composer-jump-to-date"
                onClick={() => openJumpFromTools()}
              >
                <span class="shell-composer-tools-item-title">Jump to date</span>
                <span id="shell-composer-tools-jump-desc" class="shell-composer-tools-item-desc">
                  Open the conversation at a day you choose.
                </span>
              </button>

              <Show when={activeView().kind === 'channel' && target()}>
                {(channel) => (
                  <a
                    class="shell-composer-tools-item shell-composer-tools-ledger"
                    href={statsRoomHref(channel())}
                    aria-label={`Room ledger for ${channel()}`}
                    data-testid="composer-channel-ledger"
                    onClick={() => setToolsOpen(false)}
                  >
                    <span class="shell-composer-tools-item-title">Room ledger</span>
                    <span class="shell-composer-tools-item-desc">
                      Public room pulse for {channel()}.
                    </span>
                  </a>
                )}
              </Show>

              <div class="shell-composer-tools-tip" role="note">
                <p class="shell-composer-tools-item-title">Slash commands</p>
                <p class="shell-composer-tools-item-desc">
                  Type <kbd class="shell-composer-tools-kbd">/</kbd> for commands. Nothing runs until you send.
                </p>
                <button
                  type="button"
                  class="shell-composer-tools-action"
                  data-testid="composer-command-help"
                  disabled={!isEnabled()}
                  onClick={() => startSlashCommandHelp()}
                >
                  Insert /
                </button>
              </div>
            </div>
          </Show>
        </div>

        <button
          type="button"
          class="shell-composer-send"
          data-composer-primary="send"
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
      <Show
        when={sayHiHint()}
        fallback={
          <p class="shell-composer-hint" aria-hidden="true">
            Enter to send · @ or Tab for nicks · Shift+Enter for newline · Paste or drop files to attach
          </p>
        }
      >
        {(hint) => (
          <FirstHourCoach
            tip={{ id: 'room-say-hi', text: hint() }}
            placement="composer"
            onDismiss={() => markFirstHourSeen()}
          />
        )}
      </Show>
      </div>
    </section>
  );
}
