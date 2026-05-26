'use client';

import { useState, useRef, useCallback, KeyboardEvent, useEffect, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useTabComplete } from '@/hooks/useTabComplete';
import EmojiPicker from '@/components/ui/EmojiPicker';
import GifPicker from '@/components/ui/GifPicker';
import StickerPicker from '@/components/chat/StickerPicker';
import SlashCommandMenu, { filterCommands, type SlashCommand } from '@/components/chat/SlashCommandMenu';
import FormatToolbar from '@/components/chat/FormatToolbar';
import MentionDropdown from '@/components/chat/MentionDropdown';
import EmojiAutocomplete, { searchEmoji } from '@/components/chat/EmojiAutocomplete';
import { stickerToMessage } from '@/lib/stickers';
import FloodWarningBar from '@/components/chat/FloodWarningBar';
import AttachmentPreview, { PendingAttachment, getAttachmentType, formatBytes } from '@/components/chat/AttachmentPreview';
import { useFileUpload } from '@/hooks/useFileUpload';

const FLOOD_WINDOW_MS = 2000;
const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const FLOOD_THRESHOLD = 3;
const FLOOD_COOLDOWN_MS = 3000;

interface Props {
  target: string;
  placeholder?: string;
  droppedFile?: File | null;
  onDroppedFileConsumed?: () => void;
  /** When true, the send button is disabled (e.g. slow mode cooldown active) */
  slowModeActive?: boolean;
  /** Called after a message is sent, so parent can track lastSentAt */
  onMessageSent?: () => void;
  /** Called when the user starts typing (text transitions from empty to non-empty) */
  onTypingStart?: () => void;
  /** Called when the user stops typing (text cleared or 3 s of inactivity) */
  onTypingStop?: () => void;
}

// ── Slash command help text ────────────────────────────────────────────────────
const COMMANDS: Record<string, string> = {
  me:     'Perform an action: /me <text>',
  nick:   'Change your nickname: /nick <newnick>',
  join:   'Join a channel: /join <#channel>',
  part:   'Leave a channel: /part [#channel]',
  leave:  'Leave a channel: /leave [#channel]',
  topic:  'Set channel topic: /topic <text>',
  clear:  'Clear message history locally: /clear',
  msg:    'Send a direct message: /msg <nick> <text>',
  query:  'Open a DM conversation: /query <nick>',
  away:   'Set away status: /away [reason]',
  back:   'Return from away: /back',
  whois:  'Query user info: /whois <nick>',
  invite: 'Invite a user: /invite <nick> [#channel]',
  mode:   'Set channel/user modes: /mode [target] <flags>',
  raw:    'Send a raw IRC command: /raw <command>',
  help:   'Show available commands: /help [command]',
  ns:         'NickServ: /ns [command]',
  cs:         'ChanServ: /cs [command]',
  ignore:     'Ignore a user: /ignore <nick>',
  unignore:   'Unignore a user: /unignore <nick>',
  ignorelist: 'Open the ignore list: /ignorelist',
  poll:       'Create a poll: /poll "Question" "Option 1" "Option 2"',
};

// ── Emoji shortcode map ───────────────────────────────────────────────────────
const EMOJI_SHORTCUTS: Record<string, string> = {
  thumbsup: '👍', thumbsdown: '👎', heart: '❤️', laugh: '😂',
  smile: '😊', sad: '😢', angry: '😡', fire: '🔥', star: '⭐',
  check: '✅', x: '❌', wave: '👋', clap: '👏', eyes: '👀',
  thinking: '🤔', tada: '🎉', rocket: '🚀', sparkles: '✨',
  pray: '🙏', ok: '👌', point_right: '👉', point_left: '👈',
  joy: '😂', sob: '😭', wink: '😉', sunglasses: '😎',
  grimacing: '😬', facepalm: '🤦', shrug: '🤷', muscle: '💪',
  party: '🎊', confetti: '🎉', trophy: '🏆', medal: '🥇',
  skull: '💀', ghost: '👻', alien: '👽', robot: '🤖',
  cat: '🐱', dog: '🐶', fox: '🦊', penguin: '🐧', unicorn: '🦄',
  snowflake: '❄️', sun: '☀️', moon: '🌙', rain: '🌧️', thunder: '⚡',
  pizza: '🍕', burger: '🍔', taco: '🌮', coffee: '☕',
  beer: '🍺', wine: '🍷', cake: '🎂', gem: '💎',
  crown: '👑', lock: '🔒', key: '🔑', bell: '🔔',
  warning: '⚠️', info: '💡', question: '❓', exclamation: '❗',
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_left: '⬅️', arrow_right: '➡️',
  recycle: '♻️', earth: '🌍', globe: '🌐', satellite: '🛰️',
  computer: '💻', phone: '📱', camera: '📷', headphones: '🎧',
  music: '🎵', art: '🎨', game: '🎮', book: '📚',
  pencil: '✏️', hammer: '🔨', wrench: '🔧', scissors: '✂️',
  mail: '📧', link: '🔗', pin: '📌', calendar: '📅',
  clock: '🕐', hourglass: '⏳', zap: '⚡', atom: '⚛️',
  rainbow: '🌈', cloud: '☁️', wind: '💨', wave2: '🌊',
  tree: '🌲', flower: '🌸', seedling: '🌱', leaf: '🍃',
  handshake: '🤝', hug: '🤗', kiss: '😘', blush: '😊',
  nerd: '🤓', monocle: '🧐', exploding_head: '🤯',
};

// ── Character counter constants ───────────────────────────────────────────────
// IRC 512-byte limit. Subtract typical overhead: ":nick!user@host PRIVMSG #channel :\r\n"
// Conservative overhead of ~60 bytes leaves ~452 usable. We show a counter
// when within 200 chars of the limit, counting down remaining chars.
const IRC_LIMIT = 512;
const IRC_OVERHEAD = 60; // conservative: nick!user@host + command + target + separators
const CHAR_LIMIT_IRC = IRC_LIMIT - IRC_OVERHEAD; // ~452 usable bytes
const CHAR_WARNING_AT = CHAR_LIMIT_IRC - 200;    // show counter when < 200 remaining
const CHAR_LIMIT = CHAR_LIMIT_IRC;

// ── Preview renderer (same transforms as renderText in MessageItem) ───────────
function previewHtml(text: string): string {
  let out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  out = out.replace(/`([^`]+)`/g, '<code class="msg-code">$1</code>');
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>');
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');
  out = out.replace(/@([a-zA-Z0-9_[\]\\^`{|-]+)/g, '<span class="msg-mention">@$1</span>');
  out = out.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>',
  );
  out = out.replace(/\n/g, '<br>');
  return out;
}

// ── Autocomplete types ────────────────────────────────────────────────────────
type AutocompleteMode = 'none' | 'slash' | 'mention' | 'channel' | 'emoji';

interface AutocompleteState {
  mode: AutocompleteMode;
  query: string;
  triggerStart: number;
  items: string[];
  selectedIndex: number;
}

const EMPTY_AC: AutocompleteState = {
  mode: 'none', query: '', triggerStart: 0, items: [], selectedIndex: 0,
};

// ── Nick → hue for avatar color ──────────────────────────────────────────────
function nickHue(nick: string): number {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) & 0xffff;
  return h % 360;
}

export default function MessageInput({ target, placeholder, droppedFile, onDroppedFileConsumed, slowModeActive, onMessageSent, onTypingStart, onTypingStop }: Props) {
  const sendMessage        = useOnyxStore(s => s.sendMessage);
  const channels           = useOnyxStore(s => s.channels);
  const activeView         = useOnyxStore(s => s.activeView);
  const client             = useOnyxStore(s => s.client);
  const sendTypingStart    = useOnyxStore(s => s.sendTypingStart);
  const sendTypingStop     = useOnyxStore(s => s.sendTypingStop);
  const replyingTo         = useOnyxStore(s => s.replyingTo);
  const setReplyingTo    = useOnyxStore(s => s.setReplyingTo);
  const joinChannel      = useOnyxStore(s => s.joinChannel);
  const partChannel      = useOnyxStore(s => s.partChannel);
  const clearMessages    = useOnyxStore(s => s.clearMessages);
  const navigate         = useOnyxStore(s => s.navigate);
  const addNotification      = useOnyxStore(s => s.addNotification);
  const toggleRawLog         = useOnyxStore(s => s.toggleRawLog);
  const setRawLogEnabled     = useOnyxStore(s => s.setRawLogEnabled);
  const openWhois              = useOnyxStore(s => s.openWhois);
  const openServices           = useOnyxStore(s => s.openServices);
  const setChannelJoinPrompt   = useOnyxStore(s => s.setChannelJoinPrompt);
  const openScheduledMessages  = useOnyxStore(s => s.openScheduledMessages);
  const openOperPanel          = useOnyxStore(s => s.openOperPanel);
  const ignoreUser             = useOnyxStore(s => s.ignoreUser);
  const unignoreUser           = useOnyxStore(s => s.unignoreUser);
  const openIgnoreList         = useOnyxStore(s => s.openIgnoreList);
  const openHighlightModal     = useOnyxStore(s => s.openHighlightModal);
  const openExportModal        = useOnyxStore(s => s.openExportModal);
  const openServerRulesModal   = useOnyxStore(s => s.openServerRulesModal);
  const openPollCreate         = useOnyxStore(s => s.openPollCreate);

  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [draft,   setDraft]   = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const [showEmojiPicker,   setShowEmojiPicker]   = useState(false);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [showGifPicker,     setShowGifPicker]     = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // Feature: draft preview toggle
  const [showPreview, setShowPreview] = useState(false);
  // Feature: emoji autocomplete from EmojiAutocomplete component
  const [emojiAcQuery, setEmojiAcQuery] = useState<string | null>(null);
  const emojiAcTriggerStart = useRef<number>(0);
  // Feature: flood detection
  const [floodWarning, setFloodWarning] = useState(false);
  const [floodCooldownStart, setFloodCooldownStart] = useState(0);
  const recentSendTimestamps = useRef<number[]>([]);
  const floodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Feature: pending attachments
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const { upload, uploading, progress: uploadProgress } = useFileUpload();
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textareaRef          = useRef<HTMLTextAreaElement>(null);
  const typingTimer          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctcpTypingActive     = useRef(false);
  const ctcpTypingStopTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiPickerRef       = useRef<HTMLDivElement>(null);
  const gifPickerRef         = useRef<HTMLDivElement>(null);
  const stickerPickerRef     = useRef<HTMLDivElement>(null);

  // (legacy tab-completion state removed — useTabComplete handles cycling now)

  // ── Nick list for tab-complete ──────────────────────────────────────────────
  const nicks = useMemo(() => {
    if (activeView.kind !== 'channel') return [];
    const ch = channels.get(activeView.channel);
    if (!ch) return [];
    return Array.from(ch.users.values()).map(u => u.nick);
  }, [activeView, channels]);

  const getText = useCallback(() => textareaRef.current?.value ?? '', []);
  const setTextWithCursor = useCallback((newText: string, cursorPos?: number) => {
    setText(newText);
    if (cursorPos !== undefined && textareaRef.current) {
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = cursorPos;
          textareaRef.current.selectionEnd   = cursorPos;
        }
      });
    }
  }, []);

  const { handleTab: tabComplete, resetCycle } = useTabComplete({
    nicks,
    getText,
    setText: setTextWithCursor,
  });

  // ── Slash command discovery menu ──
  const [slashMenuOpen,  setSlashMenuOpen]  = useState(false);
  const [slashQuery,     setSlashQuery]     = useState('');
  const [slashMenuIdx,   setSlashMenuIdx]   = useState(0);
  const slashMenuRef = useRef<{ open: boolean; query: string; idx: number }>({ open: false, query: '', idx: 0 });
  slashMenuRef.current = { open: slashMenuOpen, query: slashQuery, idx: slashMenuIdx };

  // ── Attachment helpers ───────────────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files);
    let rejected = 0;

    const valid = fileArr.filter(f => {
      if (f.size > MAX_FILE_BYTES) {
        rejected++;
        return false;
      }
      return true;
    });

    if (rejected > 0) {
      addNotification({ type: 'system', text: `${rejected} file(s) skipped — max size is 25 MB` });
    }

    setAttachments(prev => {
      const combined = [...prev, ...valid.map(f => ({
        id: crypto.randomUUID(),
        file: f,
        objectUrl: URL.createObjectURL(f),
        type: getAttachmentType(f),
      } satisfies PendingAttachment))];

      if (combined.length > MAX_ATTACHMENTS) {
        addNotification({ type: 'system', text: `Max ${MAX_ATTACHMENTS} attachments per message` });
        return combined.slice(0, MAX_ATTACHMENTS);
      }
      return combined;
    });
  }, [addNotification]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const att = prev.find(a => a.id === id);
      if (att) URL.revokeObjectURL(att.objectUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback((list: PendingAttachment[]) => {
    for (const att of list) URL.revokeObjectURL(att.objectUrl);
    setAttachments([]);
  }, []);

  // ── Handle dropped file (legacy prop) ────────────────────────────────────────
  useEffect(() => {
    if (droppedFile) {
      addFiles([droppedFile]);
      onDroppedFileConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFile]);

  // ── Draft persistence: load on mount / target change ─────────────────────
  useEffect(() => {
    try {
      const drafts = JSON.parse(localStorage.getItem('ocean-drafts') || '{}') as Record<string, string>;
      if (drafts[target]) {
        setText(drafts[target]);
        setIsDraft(true);
      } else {
        setText('');
        setIsDraft(false);
      }
    } catch {
      // ignore
    }
  }, [target]);

  // ── Draft persistence: save on text change (debounced 500 ms) ────────────
  useEffect(() => {
    const tid = setTimeout(() => {
      try {
        const drafts = JSON.parse(localStorage.getItem('ocean-drafts') || '{}') as Record<string, string>;
        if (text.trim()) {
          drafts[target] = text;
        } else {
          delete drafts[target];
        }
        localStorage.setItem('ocean-drafts', JSON.stringify(drafts));
      } catch {
        // ignore
      }
    }, 500);
    return () => clearTimeout(tid);
  }, [text, target]);

  // ── Inline autocomplete (mention / channel / emoji) ──────────────────────
  const [ac, setAc] = useState<AutocompleteState>(EMPTY_AC);
  // ref so keydown handlers always read fresh state without stale closure
  const acRef = useRef<AutocompleteState>(EMPTY_AC);
  acRef.current = ac;

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  // Close GIF picker on outside click
  useEffect(() => {
    if (!showGifPicker) return;
    const handler = (e: MouseEvent) => {
      if (gifPickerRef.current && !gifPickerRef.current.contains(e.target as Node)) {
        setShowGifPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showGifPicker]);

  // Close sticker picker on outside click
  useEffect(() => {
    if (!showStickerPicker) return;
    const handler = (e: MouseEvent) => {
      if (stickerPickerRef.current && !stickerPickerRef.current.contains(e.target as Node)) {
        setShowStickerPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStickerPicker]);

  // Listen for prefill events from empty state buttons (e.g. "Say hello!")
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (typeof text === 'string') {
        setText(text);
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      }
    };
    document.addEventListener('ocean:prefill-input', handler);
    return () => document.removeEventListener('ocean:prefill-input', handler);
  }, []);

  // Listen for @mention insert events dispatched by UserPopover
  // Read live value from textarea.value so the handler never goes stale,
  // and the effect only registers/unregisters once (no text dependency).
  useEffect(() => {
    const handler = (e: Event) => {
      const nick = (e as CustomEvent<{ nick: string }>).detail?.nick;
      if (!nick) return;
      const textarea = textareaRef.current;
      if (!textarea) {
        setText(prev => prev + `@${nick} `);
        return;
      }
      const currentValue = textarea.value;
      const start = textarea.selectionStart ?? currentValue.length;
      const end   = textarea.selectionEnd   ?? currentValue.length;
      const before   = currentValue.slice(0, start);
      const after    = currentValue.slice(end);
      const inserted = `@${nick} `;
      setText(before + inserted + after);
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = start + inserted.length;
        textarea.setSelectionRange(pos, pos);
      });
    };
    window.addEventListener('ocean:insert-mention', handler);
    return () => window.removeEventListener('ocean:insert-mention', handler);
  // textareaRef is a stable ref; no other deps needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autocomplete detection ────────────────────────────────────────────────
  const detectAutocomplete = useCallback((textVal: string, cursorPos: number): AutocompleteState => {
    const before = textVal.slice(0, cursorPos);

    // @mention
    const mentionMatch = before.match(/@([^\s@#]*)$/);
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase();
      const ch = channels.get(target.toLowerCase());
      const members: string[] = ch ? Array.from(ch.users.values()).map(u => u.nick) : [];
      const items = members
        .filter(n => n.toLowerCase().startsWith(query))
        .slice(0, 8);
      return {
        mode: 'mention',
        query: mentionMatch[1],
        triggerStart: cursorPos - mentionMatch[0].length,
        items,
        selectedIndex: 0,
      };
    }

    // #channel (require at least 1 char typed after #)
    const channelMatch = before.match(/#([^\s#@]*)$/);
    if (channelMatch && channelMatch[1].length >= 1) {
      const query = channelMatch[1].toLowerCase();
      const items = Array.from(channels.keys())
        .filter(name => {
          const bare = name.startsWith('#') ? name.slice(1) : name;
          return bare.toLowerCase().startsWith(query);
        })
        .map(name => name.startsWith('#') ? name.slice(1) : name)
        .slice(0, 8);
      return {
        mode: 'channel',
        query: channelMatch[1],
        triggerStart: cursorPos - channelMatch[0].length,
        items,
        selectedIndex: 0,
      };
    }

    // :emoji shortcode (at least 2 alpha/underscore/digit chars)
    const emojiMatch = before.match(/:([a-z_0-9]{2,})$/);
    if (emojiMatch) {
      const query = emojiMatch[1];
      const items = Object.keys(EMOJI_SHORTCUTS)
        .filter(k => k.startsWith(query))
        .slice(0, 8);
      return {
        mode: 'emoji',
        query,
        triggerStart: cursorPos - emojiMatch[0].length,
        items,
        selectedIndex: 0,
      };
    }

    return EMPTY_AC;
  }, [channels, target]);

  // ── Apply autocomplete selection ──────────────────────────────────────────
  const applyAcItem = useCallback((state: AutocompleteState, item: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;

    let insertion: string;
    if (state.mode === 'mention') {
      insertion = `@${item} `;
    } else if (state.mode === 'channel') {
      insertion = `#${item} `;
    } else {
      insertion = EMOJI_SHORTCUTS[item] ?? item;
    }

    const newText = text.slice(0, state.triggerStart) + insertion + text.slice(cursorPos);
    const newCursor = state.triggerStart + insertion.length;
    setText(newText);
    setAc(EMPTY_AC);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  }, [text]);

  // ── Emoji autocomplete selection ──────────────────────────────────────────
  const applyEmojiAc = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;
    const triggerStart = emojiAcTriggerStart.current;
    // Replace from ':' trigger up to current cursor
    const newText = text.slice(0, triggerStart) + emoji + text.slice(cursorPos);
    const newCursor = triggerStart + emoji.length;
    setText(newText);
    setEmojiAcQuery(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  }, [text]);

  // ── Formatting helper ──────────────────────────────────────────────────────
  const wrapSelection = useCallback((open: string, close: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const selected = text.slice(start, end);

    let newText: string;
    let newStart: number;
    let newEnd: number;

    if (selected.length === 0) {
      newText  = text.slice(0, start) + open + close + text.slice(end);
      newStart = start + open.length;
      newEnd   = newStart;
    } else {
      newText  = text.slice(0, start) + open + selected + close + text.slice(end);
      newStart = start + open.length;
      newEnd   = newStart + selected.length;
    }

    setText(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newStart, newEnd);
    });
  }, [text]);

  // ── Blockquote helper ─────────────────────────────────────────────────────
  const wrapBlockquote = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;

    if (start === end) {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const newText = text.slice(0, lineStart) + '> ' + text.slice(lineStart);
      setText(newText);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + 2, start + 2);
      });
      return;
    }

    const before   = text.slice(0, start);
    const selected = text.slice(start, end);
    const after    = text.slice(end);
    const quoted   = selected.split('\n').map(l => '> ' + l).join('\n');
    const newText  = before + quoted + after;
    setText(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start, start + quoted.length);
    });
  }, [text]);

  // ── Code wrap ─────────────────────────────────────────────────────────────
  const wrapCode = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const selected = text.slice(start, end);
    const multiline = selected.includes('\n');
    const open  = multiline ? '```\n' : '`';
    const close = multiline ? '\n```' : '`';
    wrapSelection(open, close);
  }, [text, wrapSelection]);

  // ── Format handler (used by FormatToolbar) ────────────────────────────────
  const handleFormat = useCallback((before: string, after: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start    = el.selectionStart;
    const end      = el.selectionEnd;
    const selected = text.slice(start, end);
    const newText  = text.slice(0, start) + before + selected + after + text.slice(end);
    setText(newText);
    requestAnimationFrame(() => {
      el.setSelectionRange(start + before.length, end + before.length);
      el.focus();
    });
  }, [text]);

  // ── Slash command executor ─────────────────────────────────────────────────
  const executeSlashCommand = useCallback((line: string): boolean => {
    const parts = line.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const rest = args.join(' ');

    switch (cmd) {
      case 'me':
        if (!rest) { addNotification({ type: 'system', text: 'Usage: /me <action>' }); break; }
        sendMessage(target, `\x01ACTION ${rest}\x01`);
        break;

      case 'nick':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /nick <newnick>' }); break; }
        client?.sendRaw('NICK', args[0]);
        break;

      case 'join': {
        if (!args[0]) {
          // No channel specified — show the join dialog
          setChannelJoinPrompt('', '');
          break;
        }
        const joinTarget = args[0].startsWith('#') || args[0].startsWith('&') ? args[0] : `#${args[0]}`;
        const providedKey = args[1];
        // If no key provided and the channel is known to be +k, prompt first
        if (!providedKey) {
          const chData = channels.get(joinTarget.toLowerCase());
          if (chData?.modes?.includes('k')) {
            setChannelJoinPrompt(joinTarget, '');
            break;
          }
        }
        joinChannel(joinTarget, providedKey);
        break;
      }

      case 'part':
      case 'leave': {
        const ch = args[0]?.startsWith('#') || args[0]?.startsWith('&') ? args[0] : target;
        const reason = args[0]?.startsWith('#') ? args.slice(1).join(' ') : rest;
        client?.sendRaw('PART', ch, reason || 'Goodbye');
        break;
      }

      case 'topic':
        if (!rest) { addNotification({ type: 'system', text: 'Usage: /topic <text>' }); break; }
        client?.sendRaw('TOPIC', target, rest);
        break;

      case 'clear':
        clearMessages(target);
        break;

      case 'msg':
      case 'query':
        if (!args[0]) { addNotification({ type: 'system', text: `Usage: /${cmd} <nick> [text]` }); break; }
        if (args.length > 1) {
          sendMessage(args[0], args.slice(1).join(' '));
        }
        navigate({ kind: 'dm', nick: args[0] });
        break;

      case 'away':
        client?.sendRaw('AWAY', rest || 'AFK');
        break;

      case 'back':
        client?.sendRaw('AWAY');
        break;

      case 'whois':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /whois <nick>' }); break; }
        openWhois(args[0]);
        break;

      case 'invite':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /invite <nick> [#channel]' }); break; }
        client?.sendRaw('INVITE', args[0], args[1] ?? target);
        break;

      case 'ban':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /ban <nick>' }); break; }
        client?.sendRaw('MODE', target, '+b', `${args[0]}!*@*`);
        break;

      case 'unban':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /unban <hostmask>' }); break; }
        client?.sendRaw('MODE', target, '-b', args[0]);
        break;

      case 'voice':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /voice <nick>' }); break; }
        client?.sendRaw('MODE', target, '+v', args[0]);
        break;

      case 'devoice':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /devoice <nick>' }); break; }
        client?.sendRaw('MODE', target, '-v', args[0]);
        break;

      case 'op':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /op <nick>' }); break; }
        client?.sendRaw('MODE', target, '+o', args[0]);
        break;

      case 'deop':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /deop <nick>' }); break; }
        client?.sendRaw('MODE', target, '-o', args[0]);
        break;

      case 'mode':
        client?.sendRaw('MODE', args[0] ?? target, ...args.slice(1));
        break;

      case 'raw': {
        const sub = args[0]?.toLowerCase();
        if (!sub || sub === 'show') {
          toggleRawLog();
        } else if (sub === 'on') {
          setRawLogEnabled(true);
          addNotification({ type: 'system', text: 'Raw log capture enabled' });
        } else if (sub === 'off') {
          setRawLogEnabled(false);
          addNotification({ type: 'system', text: 'Raw log capture disabled' });
        } else if (sub === 'send') {
          const rawLine = args.slice(1).join(' ');
          if (!rawLine) { addNotification({ type: 'system', text: 'Usage: /raw send <line>' }); break; }
          const rawParts = rawLine.split(' ');
          client?.sendRaw(rawParts[0].toUpperCase(), ...rawParts.slice(1));
        } else {
          // Legacy: /raw COMMAND args… → send raw IRC line
          client?.sendRaw(args[0].toUpperCase(), ...args.slice(1));
        }
        break;
      }

      case 'help': {
        const helpCmd = args[0]?.toLowerCase();
        if (helpCmd && COMMANDS[helpCmd]) {
          addNotification({ type: 'system', text: COMMANDS[helpCmd] });
        } else {
          const list = Object.keys(COMMANDS).map(c => `/${c}`).join('  ');
          addNotification({ type: 'system', text: `Commands: ${list}` });
        }
        break;
      }

      case 'ns':
      case 'account': {
        // Open account services panel (no bot — direct IRC commands)
        openServices('account');
        break;
      }

      case 'cs':
      case 'chanserv': {
        // Open channel services panel (no bot — direct IRC commands)
        openServices('channel');
        break;
      }

      case 'memo': {
        openServices('memos');
        break;
      }

      case 'vhost': {
        if (rest) {
          const parts = rest.trim().split(/\s+/);
          client?.sendRaw('VHOST', ...parts);
        } else {
          openServices('vhost');
        }
        break;
      }

      case 'schedule':
        openScheduledMessages();
        break;

      case 'oper': {
        openOperPanel();
        break;
      }

      case 'ignore': {
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /ignore <nick>' }); break; }
        ignoreUser(args[0]);
        addNotification({ type: 'system', text: `Ignoring ${args[0]}` });
        break;
      }

      case 'unignore': {
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /unignore <nick>' }); break; }
        unignoreUser(args[0]);
        addNotification({ type: 'system', text: `Unignored ${args[0]}` });
        break;
      }

      case 'ignorelist': {
        openIgnoreList();
        break;
      }

      case 'highlight': {
        openHighlightModal();
        break;
      }

      case 'export': {
        openExportModal();
        break;
      }

      case 'rules': {
        openServerRulesModal();
        break;
      }

      case 'poll': {
        // /poll "Question" "Option 1" "Option 2" — open the modal pre-filled if args provided
        // We just open the modal; pre-fill is handled by parsing quoted args in the modal itself
        openPollCreate();
        break;
      }

      case 'notice':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /notice <nick> <text>' }); break; }
        if (args.length < 2) { addNotification({ type: 'system', text: 'Usage: /notice <nick> <text>' }); break; }
        client?.sendRaw('NOTICE', args[0], args.slice(1).join(' '));
        break;

      case 'kick':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /kick <nick> [reason]' }); break; }
        client?.sendRaw('KICK', target, args[0], args.slice(1).join(' ') || 'Kicked');
        break;

      case 'quiet':
        if (!args[0]) { addNotification({ type: 'system', text: 'Usage: /quiet <nick>' }); break; }
        client?.sendRaw('MODE', target, '+q', `${args[0]}!*@*`);
        break;

      case 'shrug':
        setText('¯\\_(ツ)_/¯');
        return false;

      case 'tableflip':
        setText('(╯°□°）╯︵ ┻━┻');
        return false;

      case 'unflip':
        setText('┬─┬ ノ( ゜-゜ノ)');
        return false;

      case 'spoiler': {
        if (!rest) { addNotification({ type: 'system', text: 'Usage: /spoiler <text>' }); break; }
        setText(`||${rest}||`);
        return false;
      }

      case 'ctcp': {
        const [ctcpNick, ctcpType, ...ctcpRest] = args;
        if (!ctcpNick || !ctcpType) {
          addNotification({ type: 'system', text: 'Usage: /ctcp <nick> <type> [data]' });
          break;
        }
        const ctcpData = ctcpRest.join(' ');
        client?.sendRaw('PRIVMSG', ctcpNick, `\x01${ctcpType.toUpperCase()}${ctcpData ? ' ' + ctcpData : ''}\x01`);
        break;
      }

      default:
        client?.sendRaw(cmd.toUpperCase(), ...args);
        break;
    }
    return true;
  }, [addNotification, channels, client, clearMessages, ignoreUser, joinChannel, navigate, openExportModal, openHighlightModal, openIgnoreList, openOperPanel, openPollCreate, openScheduledMessages, openServerRulesModal, openServices, openWhois, partChannel, sendMessage, setChannelJoinPrompt, setRawLogEnabled, target, toggleRawLog, unignoreUser]);

  // ── Computed: can send? ────────────────────────────────────────────────────
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !slowModeActive && text.length <= CHAR_LIMIT && !uploading;

  const submit = async () => {
    if (!canSend) return;
    if (text.length > CHAR_LIMIT) return;

    const line = text.trim();

    // Flood detection: track last N sends; if > threshold in window, warn
    const now = Date.now();
    const timestamps = recentSendTimestamps.current;
    const windowStart = now - FLOOD_WINDOW_MS;
    const recent = timestamps.filter(t => t >= windowStart);
    recent.push(now);
    recentSendTimestamps.current = recent;

    if (recent.length > FLOOD_THRESHOLD) {
      setFloodWarning(true);
      setFloodCooldownStart(now);
      if (floodTimerRef.current) clearTimeout(floodTimerRef.current);
      floodTimerRef.current = setTimeout(() => {
        setFloodWarning(false);
      }, FLOOD_COOLDOWN_MS);
    }

    // Upload attachments if media server configured, else fall back to text annotation
    let attSuffix = '';
    if (attachments.length > 0) {
      const results = await upload(attachments.map(a => a.file));
      attSuffix = results.map(r => {
        const isImage = r.file.type.startsWith('image/');
        const isVideo = r.file.type.startsWith('video/');
        if (r.url) {
          if (isImage) return ` ![${r.file.name}](${r.url})`;
          if (isVideo) return ` [${r.file.name}](${r.url})`;
          return ` [${r.file.name} (${formatBytes(r.file.size)})](${r.url})`;
        }
        // Fallback: text annotation
        return ` [Attachment: ${r.file.name} (${formatBytes(r.file.size)})]`;
      }).join('');
    }

    if (line.startsWith('/') && !line.startsWith('//') && attSuffix === '') {
      const consumed = executeSlashCommand(line);
      if (!consumed) return;
    } else {
      const base = line.startsWith('//') ? line.slice(1) : line;
      const msg = (base + attSuffix).trim();
      if (msg) {
        sendMessage(target, msg);
        onMessageSent?.();
        // Trigger sent flash on the input bar
        setSentFlash(true);
        setTimeout(() => setSentFlash(false), 500);
      }
    }

    // Clear attachments after send
    clearAttachments(attachments);

    const histLine = line || attSuffix.trim();
    if (histLine) setHistory(h => [histLine, ...h.slice(0, 99)]);
    setHistIdx(-1);
    setDraft('');
    setText('');
    setIsDraft(false);
    setShowPreview(false);
    setEmojiAcQuery(null);
    try {
      const drafts = JSON.parse(localStorage.getItem('ocean-drafts') || '{}') as Record<string, string>;
      delete drafts[target];
      localStorage.setItem('ocean-drafts', JSON.stringify(drafts));
    } catch {
      // ignore
    }
    resetCycle();
    setAc(EMPTY_AC);
    setSlashMenuOpen(false);
    setSlashQuery('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
    sendTypingStop(target);
    // Clear CTCP typing stop timer on send
    if (ctcpTypingStopTimer.current) clearTimeout(ctcpTypingStopTimer.current);
    ctcpTypingStopTimer.current = null;
    if (ctcpTypingActive.current) {
      ctcpTypingActive.current = false;
      onTypingStop?.();
    }
  };

  const sendTyping = useCallback(() => {
    sendTypingStart(target);
    // If no further input arrives within 5 s, auto-stop (IRCv3 draft/typing)
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      sendTypingStop(target);
    }, 5000);
  }, [target, sendTypingStart, sendTypingStop]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const curAc  = acRef.current;
    const curSlash = slashMenuRef.current;

    // ── Slash command menu navigation ──
    if (curSlash.open) {
      const filtered = filterCommands(curSlash.query);
      const total = filtered.length;
      if (total > 0) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashMenuIdx(prev => (prev - 1 + total) % total);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashMenuIdx(prev => (prev + 1) % total);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const cmd = filtered[curSlash.idx];
          if (cmd) {
            setText(`/${cmd.name} `);
            setSlashMenuOpen(false);
            setSlashQuery('');
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        setSlashQuery('');
        return;
      }
    }

    // ── Inline autocomplete navigation ──
    if (curAc.mode !== 'none' && curAc.items.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAc(prev => ({ ...prev, selectedIndex: (prev.selectedIndex - 1 + prev.items.length) % prev.items.length }));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAc(prev => ({ ...prev, selectedIndex: (prev.selectedIndex + 1) % prev.items.length }));
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applyAcItem(curAc, curAc.items[curAc.selectedIndex]);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        applyAcItem(curAc, curAc.items[curAc.selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAc(EMPTY_AC);
        return;
      }
    }

    // ── Formatting shortcuts ──
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      wrapSelection('**', '**');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      wrapSelection('*', '*');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault();
      wrapCode();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if ((e.key === 'ArrowUp' && text === '') || (e.key === 'ArrowUp' && histIdx >= 0)) {
      e.preventDefault();
      if (histIdx === -1) setDraft(text);
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setText(history[next] ?? '');
      return;
    }
    if (e.key === 'ArrowDown' && histIdx >= 0) {
      e.preventDefault();
      const next = histIdx - 1;
      setHistIdx(next);
      setText(next === -1 ? draft : (history[next] ?? ''));
      return;
    }
    if (e.key === 'Tab') {
      const handled = tabComplete(e, textareaRef.current?.selectionStart ?? 0);
      if (handled) return;
    }
    if (e.key === 'Escape') {
      resetCycle();
      setSlashMenuOpen(false);
      setSlashQuery('');
      if (replyingTo) setReplyingTo(null);
    }
  };


  const onInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };

  // ── Paste handler: capture image files from clipboard ──────────────────────
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    }
  }, [addFiles]);

  // ── Drag and drop (full-page overlay) ──────────────────────────────────────
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCounterRef.current++;
      setIsDragOver(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        addFiles(files);
      }
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);

    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  // Drive slash command discovery menu + legacy suggestions + inline autocomplete
  useEffect(() => {
    if (text.startsWith('/') && !text.startsWith('//') && !text.includes(' ')) {
      const partial = text.slice(1).toLowerCase();
      setSlashMenuOpen(true);
      setSlashQuery(partial);
      setSlashMenuIdx(0);
      setAc(EMPTY_AC);
      return;
    }
    setSlashMenuOpen(false);
    setSlashQuery('');

    const ta = textareaRef.current;
    const cursorPos = ta ? ta.selectionStart : text.length;
    const next = detectAutocomplete(text, cursorPos);
    setAc(prev => {
      // preserve selectedIndex when only items change
      if (next.mode === prev.mode && next.query === prev.query) {
        return { ...prev, items: next.items };
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, detectAutocomplete]);

  // ── Render autocomplete popup ─────────────────────────────────────────────
  const renderAcPopup = () => {
    if (ac.mode === 'none' || ac.items.length === 0) return null;

    // @mention — rendered by MentionDropdown (fixed, positioned above textarea)
    if (ac.mode === 'mention') {
      return (
        <MentionDropdown
          query={ac.query}
          channel={target}
          onSelect={nick => applyAcItem(ac, nick)}
          onClose={() => setAc(EMPTY_AC)}
          anchorRef={textareaRef as React.RefObject<HTMLElement | null>}
          selectedIndex={ac.selectedIndex}
        />
      );
    }

    return (
      <div className="ac-popup" role="listbox" aria-label="Autocomplete suggestions">
        {ac.items.map((item, i) => {
          const isSelected = i === ac.selectedIndex;

          if (ac.mode === 'channel') {
            const chKey = '#' + item.toLowerCase();
            const ch = channels.get(chKey) ?? channels.get(item.toLowerCase());
            const memberCount = ch ? ch.users.size : 0;
            return (
              <button
                key={item}
                className={`ac-item ac-item--channel${isSelected ? ' ac-item--selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onMouseDown={e => {
                  e.preventDefault();
                  applyAcItem(ac, item);
                }}
              >
                <span className="ac-channel-hash" aria-hidden="true">#</span>
                <span className="ac-label">{item}</span>
                {memberCount > 0 && (
                  <span className="ac-channel-count">{memberCount} members</span>
                )}
              </button>
            );
          }

          // emoji
          const emoji = EMOJI_SHORTCUTS[item];
          return (
            <button
              key={item}
              className={`ac-item ac-item--emoji${isSelected ? ' ac-item--selected' : ''}`}
              role="option"
              aria-selected={isSelected}
              onMouseDown={e => {
                e.preventDefault();
                applyAcItem(ac, item);
              }}
            >
              <span className="ac-emoji-char" aria-hidden="true">{emoji}</span>
              <span className="ac-label">:{item}:</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="msg-input-wrap">
      {/* Drag-over overlay (covers full viewport) */}
      {isDragOver && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__inner">
            <DropIcon />
            <span className="drop-overlay__label">Drop files to share</span>
          </div>
        </div>
      )}

      {/* Hidden file input for attach button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="*/*"
        aria-hidden="true"
        style={{ display: 'none' }}
        onChange={e => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Reply context bar */}
      {replyingTo && (
        <div className="reply-preview animate-fade-in">
          <div className="reply-preview__content">
            <span className="reply-preview__label">Replying to</span>
            <span className="reply-preview__nick">{replyingTo.from}</span>
            <span
              className="reply-preview__text"
              role="button"
              tabIndex={0}
              title="Jump to message"
              onClick={() => {
                const el = document.querySelector(`[data-msg-id="${replyingTo.id}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.classList.add('msg--focused');
                  setTimeout(() => el.classList.remove('msg--focused'), 1500);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  const el = document.querySelector(`[data-msg-id="${replyingTo.id}"]`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('msg--focused');
                    setTimeout(() => el.classList.remove('msg--focused'), 1500);
                  }
                }
              }}
            >
              {replyingTo.deleted
                ? '(deleted message)'
                : /^https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|avif|svg)(\?[^\s]*)?$/i.test(replyingTo.text.trim())
                ? '📷 Image'
                : replyingTo.text.trimStart().startsWith('```')
                ? '`code`'
                : replyingTo.text.slice(0, 80) + (replyingTo.text.length > 80 ? '…' : '')}
            </span>
          </div>
          <button
            className="reply-preview__cancel"
            onClick={() => setReplyingTo(null)}
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
      )}

      {/* Attachment preview strip */}
      {attachments.length > 0 && (
        <AttachmentPreview
          attachments={attachments}
          onRemove={removeAttachment}
          uploadProgressMap={uploading ? new Map(
            attachments.map((a, i) => [a.id, uploadProgress[i]?.progress ?? 0])
          ) : undefined}
        />
      )}

      {/* Slash command discovery menu */}
      {slashMenuOpen && (
        <SlashCommandMenu
          query={slashQuery}
          selectedIndex={slashMenuIdx}
          onSelect={(cmd: SlashCommand) => {
            setText(`/${cmd.name} `);
            setSlashMenuOpen(false);
            setSlashQuery('');
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onClose={() => {
            setSlashMenuOpen(false);
            setSlashQuery('');
          }}
          onNavigate={(delta: -1 | 1) => {
            const filtered = filterCommands(slashQuery);
            const total = filtered.length;
            if (total > 0) {
              setSlashMenuIdx(prev => (prev + delta + total) % total);
            }
          }}
        />
      )}

      {/* Inline autocomplete popup (mention / channel / emoji) */}
      {renderAcPopup()}

      {/* Emoji autocomplete from EmojiAutocomplete component */}
      {emojiAcQuery !== null && (
        <EmojiAutocomplete
          query={emojiAcQuery}
          onSelect={applyEmojiAc}
          onClose={() => setEmojiAcQuery(null)}
          anchorRef={textareaRef as React.RefObject<HTMLElement | null>}
        />
      )}

      <FormatToolbar
        textareaRef={textareaRef}
        onFormat={handleFormat}
        visible={isFocused}
      />

      <FloodWarningBar visible={floodWarning} cooldownMs={FLOOD_COOLDOWN_MS} />

      <div className={`msg-input-bar${sentFlash ? ' msg-input-bar--sent' : ''}${attachments.length > 0 ? ' msg-input-bar--has-attachments' : ''}`}>
        {/* ── Mobile expander button (shown only on mobile) ── */}
        <button
          className={`input-action mobile-expand-btn${mobileToolbarOpen ? ' mobile-expand-btn--open' : ''}`}
          aria-label={mobileToolbarOpen ? 'Collapse tools' : 'Expand tools'}
          aria-expanded={mobileToolbarOpen}
          onClick={() => setMobileToolbarOpen(p => !p)}
        >
          <span className="mobile-expand-icon">+</span>
        </button>

        {/* ── Mobile bottom sheet (shown when expander is open on mobile) ── */}
        {mobileToolbarOpen && (
          <div className="mobile-tool-sheet" role="toolbar" aria-label="Message tools">
            <button
              className="mobile-tool-btn"
              aria-label="Bold"
              onMouseDown={e => { e.preventDefault(); wrapSelection('**', '**'); setMobileToolbarOpen(false); }}
            >B</button>
            <button
              className="mobile-tool-btn"
              aria-label="Italic"
              onMouseDown={e => { e.preventDefault(); wrapSelection('*', '*'); setMobileToolbarOpen(false); }}
            ><em>I</em></button>
            <button
              className="mobile-tool-btn"
              aria-label="Code"
              onMouseDown={e => { e.preventDefault(); wrapCode(); setMobileToolbarOpen(false); }}
            >{'`'}</button>
            <button
              className="mobile-tool-btn"
              aria-label="Emoji"
              onClick={() => { setShowEmojiPicker(true); setMobileToolbarOpen(false); }}
            >😊</button>
            <button
              className="mobile-tool-btn"
              aria-label="Stickers"
              onClick={() => { setShowStickerPicker(true); setMobileToolbarOpen(false); }}
            >🗒️</button>
            <button
              className="mobile-tool-btn"
              aria-label="GIF"
              onClick={() => { setShowGifPicker(true); setMobileToolbarOpen(false); }}
            >GIF</button>
          </div>
        )}

        {/* Attach — opens file picker */}
        <button
          className="input-action"
          aria-label="Attach file"
          onClick={() => fileInputRef.current?.click()}
        >
          <AttachIcon />
        </button>

        {/* ── Formatting toolbar (compact inline row) ── */}
        <div className="fmt-bar" aria-label="Text formatting">
          <button
            className="fmt-btn"
            title="Bold (Ctrl+B)"
            aria-label="Bold"
            onMouseDown={e => { e.preventDefault(); wrapSelection('**', '**'); }}
          >
            <BoldIcon />
          </button>
          <button
            className="fmt-btn"
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            onMouseDown={e => { e.preventDefault(); wrapSelection('*', '*'); }}
          >
            <ItalicIcon />
          </button>
          <button
            className="fmt-btn"
            title="Strikethrough"
            aria-label="Strikethrough"
            onMouseDown={e => { e.preventDefault(); wrapSelection('~~', '~~'); }}
          >
            <StrikeIcon />
          </button>
          <button
            className="fmt-btn"
            title="Code (Ctrl+`)"
            aria-label="Code"
            onMouseDown={e => { e.preventDefault(); wrapCode(); }}
          >
            <CodeIcon />
          </button>
          <button
            className="fmt-btn"
            title="Blockquote"
            aria-label="Blockquote"
            onMouseDown={e => { e.preventDefault(); wrapBlockquote(); }}
          >
            <QuoteIcon />
          </button>
          <button
            className="fmt-btn"
            title="Spoiler"
            aria-label="Spoiler"
            onMouseDown={e => { e.preventDefault(); wrapSelection('||', '||'); }}
          >
            <SpoilerIcon />
          </button>
          <div className="fmt-divider" />
        </div>

        {isDraft && <span className="msg-draft-badge">• draft</span>}
        {showPreview ? (
          <div
            className="msg-preview"
            aria-label="Message preview"
            dangerouslySetInnerHTML={{ __html: previewHtml(text) }}
          />
        ) : (
        <textarea
          ref={textareaRef}
          className="msg-textarea"
          placeholder={
            placeholder ??
            (target.startsWith('#') || target.startsWith('&')
              ? `Message ${target}`
              : `Message @${target}`)
          }
          value={text}
          onChange={e => {
            const prev = text;
            const next = e.target.value;
            setText(next);
            setIsDraft(false);
            resetCycle();
            sendTyping();
            // Emoji autocomplete detection: `:word` at or before cursor (2+ chars)
            const cursorPos = e.target.selectionStart ?? next.length;
            const beforeCursor = next.slice(0, cursorPos);
            const emojiMatch = beforeCursor.match(/(?:^|\s):([a-z0-9_]{2,})$/i);
            if (emojiMatch) {
              const q = emojiMatch[1].toLowerCase();
              const hits = searchEmoji(q);
              if (hits.length > 0) {
                emojiAcTriggerStart.current = cursorPos - emojiMatch[1].length - 1; // position of ':'
                setEmojiAcQuery(q);
              } else {
                setEmojiAcQuery(null);
              }
            } else {
              setEmojiAcQuery(null);
            }
            // CTCP TYPING callbacks
            if (next.length > 0 && prev.length === 0) {
              ctcpTypingActive.current = true;
              onTypingStart?.();
            }
            if (next.length > 0) {
              if (ctcpTypingStopTimer.current) clearTimeout(ctcpTypingStopTimer.current);
              ctcpTypingStopTimer.current = setTimeout(() => {
                if (ctcpTypingActive.current) {
                  ctcpTypingActive.current = false;
                  onTypingStop?.();
                }
              }, 3000);
            } else if (prev.length > 0) {
              if (ctcpTypingStopTimer.current) clearTimeout(ctcpTypingStopTimer.current);
              ctcpTypingStopTimer.current = null;
              if (ctcpTypingActive.current) {
                ctcpTypingActive.current = false;
                onTypingStop?.();
              }
            }
          }}
          onKeyDown={onKeyDown}
          onInput={onInput}
          onPaste={onPaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            // Delay so that mousedown on menu items / toolbar buttons fires before blur closes things
            setTimeout(() => {
              setSlashMenuOpen(false);
              setSlashQuery('');
              setIsFocused(false);
            }, 150);
          }}
          rows={1}
          aria-label="Message input"
          autoComplete="off"
          spellCheck
        />
        )}

        {/* GIF picker */}
        <div ref={gifPickerRef} className="gif-button-container">
          {showGifPicker && (
            <GifPicker
              onPick={(url) => {
                setText(v => v ? v + ' ' + url : url);
                setShowGifPicker(false);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              onClose={() => setShowGifPicker(false)}
            />
          )}
          <button
            className="input-action gif-btn"
            aria-label="GIF picker"
            onClick={() => {
              setShowGifPicker(p => !p);
              setShowEmojiPicker(false);
              setShowStickerPicker(false);
            }}
          >
            GIF
          </button>
        </div>

        {/* Sticker picker */}
        <div ref={stickerPickerRef} className="sticker-button-container">
          {showStickerPicker && (
            <StickerPicker
              onSelect={(sticker) => {
                sendMessage(target, stickerToMessage(sticker));
                setShowStickerPicker(false);
              }}
              onClose={() => setShowStickerPicker(false)}
            />
          )}
          <button
            className="input-action"
            aria-label="Stickers"
            onClick={() => {
              setShowStickerPicker(p => !p);
              setShowEmojiPicker(false);
              setShowGifPicker(false);
            }}
          >
            🗒️
          </button>
        </div>

        {/* Emoji picker */}
        <div ref={emojiPickerRef} className="emoji-button-container">
          {showEmojiPicker && (
            <EmojiPicker
              onPick={(emoji) => {
                setText(t => t + emoji);
                setShowEmojiPicker(false);
              }}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}
          <button
            className="input-action"
            aria-label="Emoji"
            onClick={() => {
              setShowEmojiPicker(p => !p);
              setShowGifPicker(false);
              setShowStickerPicker(false);
            }}
          >
            <EmojiIcon />
          </button>
        </div>

        {/* Draft preview toggle */}
        <button
          className={`input-action preview-toggle${showPreview ? ' preview-toggle--active' : ''}`}
          aria-label={showPreview ? 'Back to editing' : 'Preview message'}
          aria-pressed={showPreview}
          title={showPreview ? 'Back to editing' : 'Preview message'}
          onMouseDown={e => {
            e.preventDefault();
            setShowPreview(p => !p);
            if (showPreview) {
              requestAnimationFrame(() => textareaRef.current?.focus());
            }
          }}
        >
          <EyeIcon />
        </button>

        {/* Character counter — shows remaining chars when within 200 of IRC limit */}
        {text.length >= CHAR_WARNING_AT && (
          <span
            className={`msg-char-counter${
              CHAR_LIMIT - text.length < 50 ? ' danger' :
              CHAR_LIMIT - text.length < 100 ? ' warn' : ''
            }`}
            aria-live="polite"
            aria-label={`${CHAR_LIMIT - text.length} characters remaining`}
          >
            {CHAR_LIMIT - text.length}
          </span>
        )}

        {uploading && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Uploading…</span>
        )}

        <button
          className={`send-btn${canSend ? ' send-btn--active' : ''}`}
          onClick={submit}
          disabled={!canSend}
          aria-label={
            text.length > CHAR_LIMIT ? 'Message too long' :
            slowModeActive ? 'Slow mode active — wait for cooldown' :
            'Send message'
          }
        >
          <SendIcon />
        </button>
      </div>

      <style>{`
        .msg-input-wrap {
          padding: 0 16px 16px;
          flex-shrink: 0;
          position: relative;
        }
        @media (max-width: 768px) {
          .msg-input-wrap {
            padding: 0 8px;
            padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
          }
        }

        /* ── Drop overlay ── */
        .drop-overlay {
          position: fixed;
          inset: 0;
          background: rgba(124, 90, 245, 0.15);
          border: 2px dashed var(--accent);
          border-radius: 8px;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .drop-overlay__inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .drop-overlay__label {
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--accent);
          text-shadow: 0 2px 12px rgba(0,0,0,0.6);
        }
        .drop-overlay__icon {
          width: 48px;
          height: 48px;
          color: var(--accent);
          opacity: 0.85;
        }

        /* Reply preview strip */
        .reply-preview {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: var(--bg-elevated);
          border-top: 1px solid var(--border-subtle);
          border-left: 3px solid var(--accent);
          border-radius: var(--r-md) var(--r-md) 0 0;
          min-height: 36px;
          animation: fadeIn 120ms ease both;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .reply-preview__content {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 6px;
          overflow: hidden;
        }
        .reply-preview__label {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .reply-preview__nick {
          font-size: 12px;
          font-weight: 700;
          color: var(--accent);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .reply-preview__text {
          font-size: 12px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          cursor: pointer;
          border-radius: var(--r-xs);
          padding: 0 2px;
          transition: color var(--t-fast), background var(--t-fast);
        }
        .reply-preview__text:hover {
          color: var(--text-primary);
          background: var(--bg-float);
        }
        .reply-preview__cancel {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          padding: 0 2px;
          border-radius: var(--r-xs);
          flex-shrink: 0;
          transition: color var(--t-fast), background var(--t-fast);
        }
        .reply-preview__cancel:hover { color: var(--text-primary); background: var(--bg-float); }

        .msg-input-bar {
          display: flex; align-items: flex-end; gap: 2px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          padding: 5px 8px 5px 6px;
          position: relative;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
        }
        .msg-input-bar--has-attachments {
          border-radius: 0 0 var(--r-lg) var(--r-lg);
        }
        .msg-input-bar:focus-within {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 3px var(--accent-subtle), 0 0 12px rgba(14,165,233,0.1) inset;
        }

        /* ── Toolbar group separators ── */
        /* [attach] | [formatting] */
        .msg-input-bar > .fmt-bar {
          margin-left: 3px;
        }
        /* [pickers: gif / sticker / emoji] — subtle left gap */
        .msg-input-bar > .gif-button-container {
          margin-left: 6px;
          position: relative;
        }
        .msg-input-bar > .gif-button-container::before {
          content: '';
          position: absolute;
          left: -5px;
          top: 50%;
          transform: translateY(-50%);
          width: 1px;
          height: 16px;
          background: var(--border-normal);
          pointer-events: none;
        }
        /* [preview / send] — separate from pickers */
        .msg-input-bar > .preview-toggle {
          margin-left: 6px;
          position: relative;
        }
        .msg-input-bar > .preview-toggle::before {
          content: '';
          position: absolute;
          left: -5px;
          top: 50%;
          transform: translateY(-50%);
          width: 1px;
          height: 16px;
          background: var(--border-normal);
          pointer-events: none;
        }

        /* ── Formatting bar ── */
        .fmt-bar {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
          align-self: flex-end;
          padding-bottom: 1px;
        }
        .fmt-btn {
          width: 28px; height: 28px; border-radius: var(--r-xs);
          border: none; background: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); flex-shrink: 0; padding: 6px;
          transition: color var(--t-fast), background var(--t-fast);
        }
        .fmt-btn:hover { color: var(--text-secondary); background: var(--bg-float); }
        .fmt-divider {
          width: 1px; height: 14px; background: var(--border-normal);
          margin: 0 4px; flex-shrink: 0; opacity: 0.7;
        }
        /* Hide on narrow screens */
        @media (max-width: 480px) {
          .fmt-bar { display: none; }
        }

        .msg-textarea {
          flex: 1; background: none; border: none; outline: none; resize: none;
          color: var(--text-primary); font-size: 15px; font-family: inherit;
          line-height: 1.5; min-height: 24px; max-height: 200px;
          padding: 2px 0; overflow-y: auto;
        }
        .msg-textarea::placeholder { color: var(--text-muted); }

        /* Draft indicator badge */
        .msg-draft-badge {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: var(--gold, #e8b84b);
          opacity: 0.8;
          align-self: flex-end;
          padding-bottom: 5px;
          flex-shrink: 0;
          pointer-events: none;
          user-select: none;
        }

        .input-action {
          width: 28px; height: 28px; border-radius: var(--r-xs);
          border: none; background: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); flex-shrink: 0; padding: 6px;
          transition: color var(--t-fast), background var(--t-fast), transform 120ms cubic-bezier(0.34,1.56,0.64,1);
        }
        .input-action:hover {
          color: var(--text-secondary);
          background: var(--bg-float);
          transform: scale(1.1);
        }
        .input-action:active { transform: scale(0.92); }

        /* GIF text button variant */
        .gif-btn {
          font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
          width: auto; padding: 0 7px; height: 28px;
        }

        .emoji-button-container   { position: relative; }
        .gif-button-container     { position: relative; }
        .sticker-button-container { position: relative; }

        /* ── Mobile expander button (hidden on desktop) ── */
        .mobile-expand-btn { display: none; }
        .mobile-expand-icon {
          font-size: 20px;
          line-height: 1;
          font-weight: 300;
          transition: transform 180ms var(--ease-out, cubic-bezier(0.16,1,0.3,1));
        }
        .mobile-expand-btn--open .mobile-expand-icon {
          transform: rotate(45deg);
        }

        /* ── Mobile tool bottom sheet ── */
        .mobile-tool-sheet {
          display: none;
        }

        @media (max-width: 768px) {
          .mobile-expand-btn {
            display: flex;
            width: 36px;
            height: 36px;
            min-height: unset;
            min-width: unset;
          }
          .input-action {
            width: 36px;
            height: 36px;
            min-height: unset;
            min-width: unset;
          }
          .fmt-bar { display: none; }

          .mobile-tool-sheet {
            display: flex;
            gap: 6px;
            position: absolute;
            bottom: calc(100% + 4px);
            left: 0;
            right: 0;
            background: var(--bg-elevated, #132131);
            border: 1px solid var(--border-normal, rgba(14,165,233,0.15));
            border-radius: var(--r-lg, 12px);
            padding: 10px 12px;
            z-index: 50;
            box-shadow: 0 -4px 16px rgba(0,0,0,0.4);
            animation: tool-sheet-in 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
          }
          @keyframes tool-sheet-in {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .mobile-tool-btn {
            flex: 1;
            height: 40px;
            border: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
            border-radius: var(--r-md, 8px);
            background: var(--bg-base, #0c1828);
            color: var(--text-secondary, #7aa8c4);
            font-size: 15px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
            min-width: 0;
          }
          .mobile-tool-btn:active {
            background: var(--accent-subtle, rgba(14,165,233,0.1));
            color: var(--accent, #0ea5e9);
          }
        }

        @keyframes input-sent-flash {
          0%   { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,90,245,0.28); }
          100% { border-color: var(--accent-border); box-shadow: 0 0 0 3px var(--accent-subtle); }
        }

        .msg-input-bar--sent {
          animation: input-sent-flash 450ms ease forwards;
        }

        @media (prefers-reduced-motion: reduce) {
          .msg-input-bar--sent { animation: none !important; }
        }

        .send-btn {
          width: 28px; height: 28px; border-radius: var(--r-xs);
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; background: none; color: var(--text-muted); padding: 6px;
          transition: transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), background var(--t-fast), color var(--t-fast);
          /* Override global mobile min-height — the input bar has enough visual size */
          min-height: unset; min-width: unset;
        }
        .send-btn:active {
          transform: scale(0.88);
          transition: transform 80ms ease;
        }
        .send-btn--active {
          background: var(--accent); color: #fff;
          box-shadow: 0 2px 8px var(--accent-glow);
        }
        .send-btn--active:hover { background: var(--accent-hover); box-shadow: 0 2px 12px var(--accent-glow); }
        .send-btn:disabled:not(.send-btn--active) { cursor: not-allowed; opacity: 0.4; }

        @media (max-width: 768px) {
          .send-btn {
            width: 44px;
            height: 44px;
            border-radius: var(--r-sm);
            padding: 10px;
          }
          .send-btn--active {
            border-radius: var(--r-md);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .send-btn { transition: background var(--t-fast), color var(--t-fast); }
          .send-btn:active { transform: none; }
        }

        /* Slash command suggestions */
        .cmd-suggest {
          position: absolute; bottom: calc(100% + 4px); left: 16px; right: 16px;
          background: var(--bg-float); border: 1px solid var(--border-normal);
          border-radius: var(--r-md); overflow: hidden; box-shadow: var(--shadow-md);
          display: flex; flex-direction: column;
        }
        .cmd-suggest-item {
          display: flex; align-items: baseline; gap: 10px;
          padding: 8px 12px;
          background: none; border: none; cursor: pointer; text-align: left;
          transition: background var(--t-fast);
        }
        .cmd-suggest-item:hover { background: var(--ch-hover-bg); }
        .cmd-suggest-name {
          font-size: 13px; font-weight: 600; color: var(--accent);
          font-family: var(--font-mono, monospace); flex-shrink: 0;
        }
        .cmd-suggest-desc { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .comp-list {
          position: absolute; bottom: calc(100% + 4px); left: 16px; right: 16px;
          background: var(--bg-float); border: 1px solid var(--border-normal);
          border-radius: var(--r-md); padding: 4px;
          display: flex; flex-wrap: wrap; gap: 4px; box-shadow: var(--shadow-md);
        }
        .comp-item { padding: 3px 8px; border-radius: var(--r-sm); font-size: 13px; color: var(--text-secondary); }
        .comp-item--active { background: var(--accent-subtle); color: var(--accent); }

        /* ── Inline autocomplete popup ── */
        .ac-popup {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 16px; right: 16px;
          max-height: 240px; overflow-y: auto;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: var(--shadow-md);
          display: flex; flex-direction: column;
          z-index: 50;
        }

        .ac-item {
          display: flex; align-items: center; gap: 8px;
          height: 36px; padding: 0 12px;
          background: none; border: none; cursor: pointer; text-align: left;
          transition: background var(--t-fast);
          flex-shrink: 0;
        }
        .ac-item:hover { background: var(--ch-hover-bg); }
        .ac-item--selected { background: var(--accent-subtle); }
        .ac-item--selected:hover { background: var(--accent-subtle); }

        /* Mention avatar */
        .ac-avatar {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #fff;
          flex-shrink: 0; letter-spacing: 0;
        }

        .ac-label {
          font-size: 13px; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          flex: 1;
        }
        .ac-item--selected .ac-label { color: var(--accent); }

        /* Channel hash */
        .ac-channel-hash {
          font-size: 14px; font-weight: 700;
          color: var(--text-muted); flex-shrink: 0;
        }
        .ac-item--selected .ac-channel-hash { color: var(--accent); }

        .ac-channel-count {
          font-size: 11px; color: var(--text-muted);
          flex-shrink: 0; margin-left: auto;
        }

        /* Emoji */
        .ac-emoji-char {
          font-size: 18px; line-height: 1;
          flex-shrink: 0; width: 24px; text-align: center;
        }

        /* ── Character counter ── */
        .msg-char-counter {
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          padding: 0 8px;
          align-self: center;
          transition: color 0.2s;
          color: var(--text-muted);
          flex-shrink: 0;
          white-space: nowrap;
        }
        .msg-char-counter.warn { color: #fbbf24; }
        .msg-char-counter.danger { color: #ef4444; }

        /* ── Preview toggle button ── */
        .preview-toggle { opacity: 0.7; }
        .preview-toggle:hover { opacity: 1; }
        .preview-toggle--active {
          color: var(--accent) !important;
          background: var(--accent-subtle) !important;
          opacity: 1;
        }

        /* ── Preview div ── */
        .msg-preview {
          flex: 1;
          min-height: 24px;
          max-height: 200px;
          overflow-y: auto;
          font-size: 15px;
          font-family: inherit;
          line-height: 1.5;
          color: var(--text-primary);
          padding: 2px 0;
          word-break: break-word;
        }
        .msg-preview:empty::before {
          content: 'Nothing to preview';
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const AttachIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/>
  </svg>
);

const DropIcon = () => (
  <svg className="drop-overlay__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M24 4v28M14 22l10 10 10-10"/>
    <path d="M8 36v4a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2v-4"/>
  </svg>
);

const EmojiIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
    <path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683z"/>
    <path d="M7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm4 0c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S9.448 5 10 5s1 .672 1 1.5z"/>
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11z"/>
  </svg>
);

// ── Formatting icon SVGs ───────────────────────────────────────────────────────

const BoldIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8.21 13c2.106 0 3.412-1.087 3.412-2.823 0-1.306-.984-2.283-2.324-2.386v-.055a2.176 2.176 0 0 0 1.852-2.14c0-1.51-1.162-2.46-3.014-2.46H3.843v9.864H8.21zM5.908 4.674h1.696c.963 0 1.517.451 1.517 1.244 0 .834-.629 1.32-1.73 1.32H5.908V4.673zm0 6.788V8.598h1.73c1.217 0 1.88.492 1.88 1.415 0 .943-.643 1.449-1.832 1.449H5.907z"/>
  </svg>
);

const ItalicIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M7.991 11.674 9.53 4.455c.123-.595.246-.71 1.347-.807l.11-.52H7.211l-.11.52c1.06.096 1.128.212 1.005.807L6.57 11.674c-.123.595-.246.71-1.346.806l-.11.52h3.774l.11-.52c-1.06-.095-1.129-.211-1.006-.806z"/>
  </svg>
);

const StrikeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6.333 5.686c0 .31.083.581.27.814H5.166a2.776 2.776 0 0 1-.099-.76c0-1.627 1.436-2.768 3.48-2.768 1.969 0 3.39 1.175 3.39 2.803 0 1.127-.609 1.740-1.765 2.147l-.7.22H8.66c1.696 0 2.52.706 2.52 2.067 0 1.544-1.34 2.493-3.456 2.493-1.995 0-3.36-1.034-3.48-2.658h1.195c.092.97.876 1.577 2.288 1.577 1.3 0 2.095-.597 2.095-1.42 0-.68-.437-1.155-1.466-1.155H8.04l.17-.623h.612c1.072 0 1.584-.475 1.584-1.327 0-.833-.574-1.338-1.636-1.338-.98 0-1.637.423-1.637 1.163z"/>
    <path d="M1.5 8.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1-.5-.5z"/>
  </svg>
);

const CodeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8l-3.147-3.146z"/>
  </svg>
);

const QuoteIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2.5 3a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11zm2 2a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm-2 2a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11zm2 2a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm-2 2a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11z"/>
  </svg>
);

const SpoilerIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/>
    <path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>
    <path d="M3.5 1.5 12.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <path d="M7.5 11C4.80285 11 2.52952 9.62184 1.09622 7.50001C2.52952 5.37816 4.80285 4 7.5 4C10.1971 4 12.4705 5.37816 13.9038 7.50001C12.4705 9.62184 10.1971 11 7.5 11ZM7.5 3C4.30786 3 1.65639 4.70638 0.0760002 7.23501C-0.0253338 7.39715 -0.0253338 7.60288 0.0760002 7.76501C1.65639 10.2936 4.30786 12 7.5 12C10.6921 12 13.3436 10.2936 14.924 7.76501C15.0253 7.60288 15.0253 7.39715 14.924 7.23501C13.3436 4.70638 10.6921 3 7.5 3ZM7.5 9.5C8.60457 9.5 9.5 8.60457 9.5 7.5C9.5 6.39543 8.60457 5.5 7.5 5.5C6.39543 5.5 5.5 6.39543 5.5 7.5C5.5 8.60457 6.39543 9.5 7.5 9.5Z"/>
  </svg>
);
