'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '@/lib/irc/types';
import { useOnyxStore } from '@/lib/store';
import { formatMessageTime } from '@/lib/format-time';
import UserPopover from '@/components/ui/UserPopover';
import MiniUserCard from '@/components/ui/MiniUserCard';
import LinkPreview from '@/components/chat/LinkPreview';
import EmojiPicker from '@/components/ui/EmojiPicker';
import ReactionBar from '@/components/chat/ReactionBar';
import MessageContextMenu from '@/components/chat/MessageContextMenu';
import IrcText from '@/components/chat/IrcText';
import { hasIrcFormatting, stripIrcFormatting } from '@/lib/ircColors';
import PollMessage, { POLL_PATTERN } from '@/components/chat/PollMessage';
import { getNickColor } from '@/lib/nick-color';
import { STICKER_PATTERN, STICKER_PACKS } from '@/lib/stickers';
import AvatarStack from '@/components/ui/AvatarStack';
import { getDisplayName } from '@/lib/display-name';

interface Props {
  message: ChatMessage;
  isMe: boolean;
  compact?: boolean;
  /** True when this message continues a group (same sender, within 5 min, same day) */
  isGrouped?: boolean;
  /** When true, the message animates in (newly arrived after initial load) */
  isNew?: boolean;
  /** Callback to register/unregister the DOM element for jump-to-message */
  onMsgRef?: (id: string, el: HTMLElement | null) => void;
  /** Callback to jump to a specific message by ID */
  onJumpToMessage?: (msgId: string) => void;
}

// ── Segment types ──────────────────────────────────────────────────────────────

type Segment =
  | { type: 'text';    content: string }
  | { type: 'code';    content: string; lang: string }
  | { type: 'image';   url: string }
  | { type: 'spoiler'; content: string };

// ── Image URL extraction ───────────────────────────────────────────────────────

const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?[^\s]*)?$/i;

function isImageUrl(url: string): boolean {
  return IMAGE_EXTS.test(url) || url.startsWith('data:image/');
}

export function extractImageUrls(text: string): string[] {
  const urls = text.match(/(https?:\/\/[^\s<>"']+)/g) ?? [];
  return urls.filter(u => isImageUrl(u));
}

function extractLinkUrls(text: string): string[] {
  const urls: string[] = [];
  const markdownImageUrls = new Set<string>();
  const trimUrl = (url: string) => {
    let out = url.replace(/[.,;!?]+$/g, '');
    while (out.endsWith(')')) {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes <= opens) break;
      out = out.slice(0, -1);
    }
    return out.replace(/[.,;!?]+$/g, '');
  };

  text.replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, (_, url: string) => {
    markdownImageUrls.add(trimUrl(url));
    return '';
  });
  text.replace(/(?<!!)\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g, (_, url: string) => {
    urls.push(trimUrl(url));
    return '';
  });
  for (const url of text.match(/(https?:\/\/[^\s<>"']+)/g) ?? []) {
    urls.push(trimUrl(url));
  }

  // Deduplicate: same URL appearing multiple times should only preview once.
  const seen = new Set<string>();
  return urls.filter(u => {
    if (markdownImageUrls.has(u)) return false;
    if (isImageUrl(u)) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

// ── Message content parser ─────────────────────────────────────────────────────

/**
 * Parses message text into an ordered list of segments.
 * Order of extraction:
 *   1. Multi-line fenced code blocks  ```lang\ncode\n```
 *   2. Spoiler tags  ||text||
 *   3. Image URLs  (inline in text, broken out so they render below)
 * Remaining text becomes 'text' segments processed by renderText().
 */
export function parseMessageContent(raw: string): Segment[] {
  const segments: Segment[] = [];

  // Working string; we consume it left-to-right
  let remaining = raw;

  // Regex patterns — applied in priority order each iteration
  const CODE_BLOCK = /```([^\n`]*)\n([\s\S]*?)```/;
  const SPOILER     = /\|\|([\s\S]+?)\|\|/;

  while (remaining.length > 0) {
    const codeMatch    = CODE_BLOCK.exec(remaining);
    const spoilerMatch = SPOILER.exec(remaining);

    // Find the earliest match
    const candidates: Array<{ idx: number; match: RegExpExecArray; kind: 'code' | 'spoiler' }> = [];
    if (codeMatch)    candidates.push({ idx: codeMatch.index,    match: codeMatch,    kind: 'code' });
    if (spoilerMatch) candidates.push({ idx: spoilerMatch.index, match: spoilerMatch, kind: 'spoiler' });

    if (candidates.length === 0) {
      // No more structured content — flush the rest as text
      if (remaining.trim()) segments.push({ type: 'text', content: remaining });
      break;
    }

    // Sort by position
    candidates.sort((a, b) => a.idx - b.idx);
    const first = candidates[0];

    // Emit any text before this match
    if (first.idx > 0) {
      const before = remaining.slice(0, first.idx);
      if (before.trim()) segments.push({ type: 'text', content: before });
    }

    if (first.kind === 'code') {
      const lang = first.match[1].trim();
      const code = first.match[2];
      segments.push({ type: 'code', content: code, lang });
      remaining = remaining.slice(first.idx + first.match[0].length);
    } else {
      segments.push({ type: 'spoiler', content: first.match[1] });
      remaining = remaining.slice(first.idx + first.match[0].length);
    }
  }

  // Post-process no-extension markdown image syntax separately. Extension URLs
  // are left on the existing raw-URL path to preserve current behavior.
  const markdownExpanded: Segment[] = [];
  for (const seg of segments) {
    if (seg.type !== 'text') {
      markdownExpanded.push(seg);
      continue;
    }

    const mdImgRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
    let last = 0;
    let matched = false;
    let m: RegExpExecArray | null;
    mdImgRe.lastIndex = 0;
    while ((m = mdImgRe.exec(seg.content)) !== null) {
      const url = m[1];
      if (isImageUrl(url)) continue;
      matched = true;
      if (m.index > last) {
        const before = seg.content.slice(last, m.index);
        if (before.trim()) markdownExpanded.push({ type: 'text', content: before });
      }
      markdownExpanded.push({ type: 'image', url });
      last = m.index + m[0].length;
    }
    if (!matched) {
      markdownExpanded.push(seg);
    } else if (last < seg.content.length) {
      const after = seg.content.slice(last);
      if (after.trim()) markdownExpanded.push({ type: 'text', content: after });
    }
  }

  // Post-process: break image URLs (including data URIs) out of text segments
  const expanded: Segment[] = [];
  for (const seg of markdownExpanded) {
    if (seg.type !== 'text') {
      expanded.push(seg);
      continue;
    }

    // Check if the entire segment content is a data:image URI
    const trimmed = seg.content.trim();
    if (trimmed.startsWith('data:image/')) {
      expanded.push({ type: 'image', url: trimmed });
      continue;
    }

    // Split text around https image URLs
    const imgRe = /(https?:\/\/[^\s<>"']+\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?[^\s]*)?)/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    imgRe.lastIndex = 0;
    while ((m = imgRe.exec(seg.content)) !== null) {
      if (m.index > last) {
        const before = seg.content.slice(last, m.index);
        if (before.trim()) expanded.push({ type: 'text', content: before });
      }
      expanded.push({ type: 'image', url: m[0] });
      last = m.index + m[0].length;
    }
    if (last < seg.content.length) {
      const after = seg.content.slice(last);
      if (after.trim()) expanded.push({ type: 'text', content: after });
    }
    // If nothing was pushed for this segment (content was only whitespace), skip it
  }

  return expanded;
}

// ── ReplyQuote styles ─────────────────────────────────────────────────────────

const replyQuoteStyles = `
  .rq-wrap {
    display: flex; align-items: stretch; gap: 9px;
    padding: 5px 10px 5px 0;
    margin: 2px 0 5px;
    cursor: pointer;
    border-radius: var(--r-sm);
    max-width: 100%;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg-elevated) 34%, transparent);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }
  .rq-wrap:hover { background: var(--accent-subtle); }
  .rq-wrap:focus-visible { outline: 2px solid var(--accent, #0ea5e9); outline-offset: 2px; border-radius: var(--r-xs, 4px); }
  .rq-bar {
    width: 3px; flex-shrink: 0; align-self: stretch;
    background: var(--accent); border-radius: 3px;
    min-height: 16px;
    opacity: 0.9;
  }
  .rq-content {
    display: flex; align-items: baseline; gap: 6px;
    overflow: hidden; min-width: 0;
  }
  .rq-nick {
    font-size: 12px; font-weight: 750; color: var(--accent);
    white-space: nowrap; flex-shrink: 0;
  }
  .rq-text {
    font-size: 12px; color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
`;

// ── ReplyQuote ────────────────────────────────────────────────────────────────

interface ReplyQuoteProps {
  replyTo: { id: string; from: string; text: string };
  onClick: () => void;
}

function ReplyQuote({ replyTo, onClick }: ReplyQuoteProps) {
  const isImage =
    /^https?:\/\/.*\.(jpg|jpeg|png|gif|webp|avif)/i.test(replyTo.text) ||
    replyTo.text.startsWith('data:image/');

  const quotedText = replyTo.text || '[original message]';
  const displayText = isImage
    ? '📷 Image'
    : quotedText.slice(0, 100) + (quotedText.length > 100 ? '…' : '');

  return (
    <div
      className="rq-wrap"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="rq-bar" />
      <div className="rq-content">
        <span className="rq-nick">{replyTo.from}</span>
        <span className="rq-text">{displayText}</span>
      </div>
      <style>{replyQuoteStyles}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// ── Syntax tokenizer ──────────────────────────────────────────────────────────

interface Token { type: string; text: string }

const KEYWORDS: Record<string, string[]> = {
  js:  ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','class','import','export','default','from','async','await','new','this','typeof','instanceof','null','undefined','true','false','throw','try','catch','finally','delete','in','of','void'],
  ts:  ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','class','import','export','default','from','async','await','new','this','typeof','instanceof','null','undefined','true','false','throw','try','catch','finally','delete','in','of','void','interface','type','enum','extends','implements','readonly','public','private','protected','abstract','declare','namespace','keyof','infer','never','any','unknown','as','satisfies'],
  py:  ['def','class','if','else','elif','for','while','import','from','return','pass','None','True','False','and','or','not','in','is','as','with','yield','async','await','lambda','try','except','finally','raise','del','global','nonlocal','assert','break','continue'],
  rs:  ['fn','let','mut','pub','use','struct','enum','impl','trait','mod','if','else','for','while','loop','return','match','self','super','crate','true','false','None','Some','Ok','Err','move','ref','type','where','async','await','dyn','unsafe','extern','const','static','box'],
  go:  ['func','var','const','type','struct','interface','map','chan','go','defer','return','if','else','for','range','switch','case','break','continue','fallthrough','import','package','select','nil','true','false','new','make','len','cap','append','copy','delete','panic','recover','close'],
  java:['public','private','protected','class','interface','extends','implements','new','return','if','else','for','while','do','switch','case','break','continue','import','package','void','null','true','false','static','final','abstract','this','super','try','catch','finally','throw','throws','instanceof','synchronized','volatile'],
  css: ['@import','@media','@keyframes','@font-face','@supports','@layer','inherit','initial','unset','auto','none','var'],
  sh:  ['if','then','else','elif','fi','for','do','done','while','until','case','esac','function','return','exit','echo','read','export','local','source'],
};

function tokenizeCode(code: string, lang: string): Token[] {
  const tokens: Token[] = [];
  const kw = KEYWORDS[lang] ?? KEYWORDS['js'];

  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-zA-Z_]\w*\b|[=><!+\-*/%&|^~?:;,.()\[\]{}@]+|\s+|.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const t = m[0];
    if (!t) continue;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*')) {
      tokens.push({ type: 'comment', text: t });
    } else if (t[0] === '"' || t[0] === "'" || t[0] === '`') {
      tokens.push({ type: 'string', text: t });
    } else if (/^\d/.test(t)) {
      tokens.push({ type: 'number', text: t });
    } else if (kw.includes(t)) {
      tokens.push({ type: 'keyword', text: t });
    } else if (/^[A-Z][A-Za-z0-9_]*$/.test(t)) {
      tokens.push({ type: 'type', text: t });
    } else if (/^[=><!+\-*/%&|^~?:;@]+$/.test(t)) {
      tokens.push({ type: 'op', text: t });
    } else {
      tokens.push({ type: 'plain', text: t });
    }
  }
  return tokens;
}

const TOK_CLASS: Record<string, string> = {
  keyword: 'tok-kw',
  string:  'tok-str',
  comment: 'tok-cmt',
  number:  'tok-num',
  type:    'tok-typ',
  op:      'tok-op',
};

function HighlightedLine({ tokens }: { tokens: Token[] }) {
  if (tokens.length === 0) return <>{'​'}</>;
  return (
    <>
      {tokens.map((tok, i) => {
        const cls = TOK_CLASS[tok.type];
        return cls
          ? <span key={i} className={cls}>{tok.text}</span>
          : <span key={i}>{tok.text}</span>;
      })}
    </>
  );
}

// ── CodeBlock ──────────────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string;
  lang: string;
}

function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API not available — silently degrade
    }
  }, [code]);

  // Tokenize the full code then split into per-line token arrays
  const normalised = code.replace(/\n$/, '');
  const allTokens  = useMemo(() => tokenizeCode(normalised, lang || 'js'), [normalised, lang]);

  // Group tokens by line so each <tr> gets its own token slice
  const lineTokens = useMemo((): Token[][] => {
    const lines: Token[][] = [[]];
    for (const tok of allTokens) {
      const parts = tok.text.split('\n');
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) lines.push([]);
        const text = parts[p];
        if (text) lines[lines.length - 1].push({ type: tok.type, text });
      }
    }
    return lines;
  }, [allTokens]);

  return (
    <div className="msg-code-block">
      <div className="msg-code-header">
        {lang && <span className="msg-code-lang">{lang}</span>}
        <button className="msg-code-copy" onClick={handleCopy} aria-label="Copy code">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="msg-code-pre" aria-label={lang ? `${lang} code block` : 'code block'}>
        <code>
          <table className="msg-code-table" aria-hidden>
            <tbody>
              {lineTokens.map((toks, i) => (
                <tr key={i} className="msg-code-row">
                  <td className="msg-code-lineno">{i + 1}</td>
                  <td className="msg-code-line"><HighlightedLine tokens={toks} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </code>
      </pre>
      <style>{codeBlockStyles}</style>
    </div>
  );
}

interface InlineImageProps {
  url: string;
  fullWidth?: boolean;
}

function InlineImage({ url, fullWidth = false }: InlineImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ocean:lightbox', { detail: { src: url, alt: '' } }));
  }, [url]);

  if (errored) return null;

  return (
    <span
      className={`msg-img-anchor ${fullWidth ? 'msg-img-anchor--full' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`View image: ${url.split('/').pop()}`}
      onClick={handleClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
      style={{ cursor: 'pointer' }}
    >
      {!loaded && <div className="msg-img-placeholder" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className={`msg-embed-img ${fullWidth ? 'msg-embed-img--full' : ''} ${loaded ? 'msg-embed-img--loaded' : ''}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        style={{ cursor: 'pointer' }}
      />
      <style>{imageStyles}</style>
    </span>
  );
}

interface SpoilerProps {
  content: string;
}

function Spoiler({ content }: SpoilerProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span
      className={`msg-spoiler ${revealed ? 'msg-spoiler--revealed' : ''}`}
      onClick={() => setRevealed(r => !r)}
      title={revealed ? 'Click to hide' : 'Click to reveal spoiler'}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRevealed(r => !r); } }}
      aria-expanded={revealed}
    >
      {revealed ? content : <span className="msg-spoiler-label">Spoiler</span>}
      <style>{spoilerStyles}</style>
    </span>
  );
}

// ── Custom emoji parser ────────────────────────────────────────────────────────

const CUSTOM_EMOJI_RE = /:([a-zA-Z0-9_-]+):/g;

type CustomEmojiEntry = { name: string; url: string; addedBy?: string };

/**
 * Splits a text string into an array of plain strings and <img> elements
 * wherever a custom emoji shortcode matches.
 */
function parseCustomEmoji(
  text: string,
  customEmoji: CustomEmojiEntry[],
): Array<string | React.ReactElement> {
  if (customEmoji.length === 0) return [text];
  const parts: Array<string | React.ReactElement> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(CUSTOM_EMOJI_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const ce = customEmoji.find(e => e.name === m![1]);
    if (!ce) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    /* eslint-disable @next/next/no-img-element */
    parts.push(
      <img
        key={`ce-${m.index}`}
        src={ce.url}
        alt={`:${ce.name}:`}
        title={`:${ce.name}:`}
        style={{ height: '20px', verticalAlign: 'middle', borderRadius: '2px', display: 'inline' }}
      />
    );
    /* eslint-enable @next/next/no-img-element */
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── CollapsibleMessage ─────────────────────────────────────────────────────────

const COLLAPSE_CHAR_LIMIT = 800;
const COLLAPSE_LINE_LIMIT = 20;

interface CollapsibleMessageProps {
  text: string;
  children: React.ReactNode;
}

function CollapsibleMessage({ text, children }: CollapsibleMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split('\n').length;
  const shouldCollapse = text.length > COLLAPSE_CHAR_LIMIT || lineCount > COLLAPSE_LINE_LIMIT;

  if (!shouldCollapse) return <>{children}</>;

  return (
    <div className="collapsible-wrap">
      <div
        className={`collapsible-body ${expanded ? 'collapsible-body--expanded' : 'collapsible-body--collapsed'}`}
      >
        {children}
      </div>
      <button
        className="collapsible-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <svg className="collapsible-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {expanded
            ? <path d="M2 6.5l3-3 3 3" />
            : <path d="M2 3.5l3 3 3-3" />
          }
        </svg>
        {expanded ? 'Show less' : `Show more · ${lineCount} lines`}
      </button>
      <style>{collapsibleStyles}</style>
    </div>
  );
}

// ── Highlight word renderer ────────────────────────────────────────────────────

/**
 * Injects highlight marks into rendered text nodes while leaving HTML tags and
 * entities from renderText() intact.
 */
function highlightHtml(html: string, words: string[]): string {
  const escaped = words
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return html;
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  return html
    .split(/(<[^>]+>|&[a-zA-Z0-9#]+;)/g)
    .map(part => (part.startsWith('<') || part.startsWith('&')) ? part : part.replace(re, '<mark class="highlight-word">$1</mark>'))
    .join('');
}

function renderTextWithHighlights(text: string, words: string[]): string {
  return highlightHtml(renderText(text), words);
}

// ── Message body renderer ──────────────────────────────────────────────────────

const EDIT_MAX = 2000;

interface MessageBodyProps {
  text: string;
  deleted: boolean;
  redacted: boolean;
  isEditing: boolean;
  editDraft: string;
  editInputRef: React.RefObject<HTMLTextAreaElement | null>;
  onEditChange: (v: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
  onCommit: () => void;
  customEmoji: CustomEmojiEntry[];
  hlWords: string[];
  messageId: string;
  suppressedEmbeds: Set<string>;
}

function MessageBody({
  text, deleted, redacted, isEditing, editDraft, editInputRef,
  onEditChange, onEditKeyDown, onCancel, onCommit, customEmoji, hlWords,
  messageId, suppressedEmbeds,
}: MessageBodyProps) {
  const segments = useMemo(() => parseMessageContent(text), [text]);
  const linkUrls = useMemo(() => (deleted || redacted ? [] : extractLinkUrls(text)), [text, deleted, redacted]);

  // Determine if the message is ONLY a single image URL (no other text)
  const isSoleImage =
    segments.length === 1 && segments[0].type === 'image';

  if (redacted) {
    return (
      <>
        <span className="msg-redacted">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <path d="M7 1a6 6 0 1 1 0 12A6 6 0 0 1 7 1zm0 1a5 5 0 1 0 0 10A5 5 0 0 0 7 2zm-.5 3h1v4h-1V5zm0 5h1v1h-1v-1z"/>
          </svg>
          Message deleted
        </span>
        <style>{`.msg-redacted{display:inline-flex;align-items:center;gap:6px;color:var(--text-muted);font-style:italic;font-size:13px;border:1px solid var(--border-subtle);border-radius:4px;padding:2px 8px;background:var(--bg-overlay);}`}</style>
      </>
    );
  }

  if (deleted) {
    return <p className="msg-deleted">(message deleted)</p>;
  }

  // ── Sticker rendering ──────────────────────────────────────────────────────
  const stickerMatch = STICKER_PATTERN.exec(text.trim());
  if (!isEditing && stickerMatch) {
    const [, packName, , emoji] = stickerMatch;
    const pack = STICKER_PACKS.find(p => p.name === packName);
    const tooltip = pack ? `${packName} sticker` : 'Sticker';
    return (
      <div className="msg-sticker" title={tooltip} aria-label={`${tooltip}: ${emoji}`}>
        <span className="msg-sticker-emoji" aria-hidden>{emoji}</span>
        <span className="msg-sticker-pack">{packName}</span>
        <style>{`
          .msg-sticker {
            display: inline-flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            padding: 4px 0;
          }
          .msg-sticker-emoji {
            font-size: 3.5rem;
            line-height: 1;
            display: block;
          }
          .msg-sticker-pack {
            font-size: 10px;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        `}</style>
      </div>
    );
  }

  if (isEditing) {
    const charCount   = editDraft.length;
    const overLimit   = charCount > EDIT_MAX;
    const lineCount   = editDraft.split('\n').length;
    const autoRows    = Math.min(8, Math.max(2, lineCount + 1));

    return (
      <div className="msg-edit-wrap">
        <textarea
          ref={editInputRef}
          className={`msg-edit-input ${overLimit ? 'msg-edit-input--over' : ''}`}
          value={editDraft}
          onChange={e => onEditChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          rows={autoRows}
          maxLength={EDIT_MAX + 50}
          aria-label="Edit message"
        />
        <div className="msg-edit-actions">
          <span className="msg-edit-hint">
            <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel
          </span>
          <span className={`msg-edit-count ${overLimit ? 'msg-edit-count--over' : ''}`}>
            {charCount}/{EDIT_MAX}
          </span>
          <button className="msg-edit-btn msg-edit-btn--cancel" onClick={onCancel}>Cancel</button>
          <button
            className="msg-edit-btn msg-edit-btn--save"
            onClick={onCommit}
            disabled={overLimit || charCount === 0}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <CollapsibleMessage text={text}>
      {/* Text segments and mixed images render in-flow; sole images render below. */}
      <div
        className="msg-text"
        onClick={(e) => {
          const spoiler = (e.target as HTMLElement).closest('.msg-spoiler');
          if (spoiler) spoiler.classList.toggle('revealed');
        }}
      >
        {segments.map((seg, i) => {
          if (seg.type === 'text') {
            // IRC formatting codes take precedence over markdown rendering.
            // If the segment contains IRC codes, render with IrcText (React spans).
            // Otherwise fall through to the HTML-based markdown renderer.
            if (hasIrcFormatting(seg.content)) {
              const ircParts = parseCustomEmoji(seg.content, customEmoji);
              return (
                <span key={i}>
                  {ircParts.map((p, j) =>
                    typeof p === 'string'
                      ? <IrcText key={j} text={p} />
                      : p
                  )}
                </span>
              );
            }
            // Check if the segment contains any custom emoji before rendering
            const hasCE = customEmoji.length > 0 && /:([a-zA-Z0-9_-]+):/.test(seg.content);
            if (hasCE) {
              const parts = parseCustomEmoji(seg.content, customEmoji);
              return (
                <span key={i}>
                  {parts.map((p, j) =>
                    typeof p === 'string'
                      ? <span key={j} dangerouslySetInnerHTML={{ __html: renderTextWithHighlights(p, hlWords) }} />
                      : p
                  )}
                </span>
              );
            }
            return (
              <span
                key={i}
                dangerouslySetInnerHTML={{ __html: renderTextWithHighlights(seg.content, hlWords) }}
              />
            );
          }
          if (seg.type === 'code') {
            return <CodeBlock key={i} code={seg.content} lang={seg.lang} />;
          }
          if (seg.type === 'spoiler') {
            return <Spoiler key={i} content={seg.content} />;
          }
          if (seg.type === 'image') {
            // Inline images render here only when there's also text content
            // (so they appear in-flow); sole images use full-width below
            if (!isSoleImage) {
              return (
                <span key={i} className="msg-img-inline-wrap">
                  <InlineImage url={seg.url} />
                </span>
              );
            }
            return null;
          }
          return null;
        })}
      </div>

      {/* Sole image — full-width treatment */}
      {isSoleImage && (
        <div className="msg-embeds msg-embeds--sole">
          <InlineImage url={(segments[0] as { type: 'image'; url: string }).url} fullWidth />
        </div>
      )}

      {/* Link preview for the first non-image URL — hidden when suppressed */}
      {linkUrls.length > 0 && !suppressedEmbeds.has(messageId) && (
        <LinkPreview url={linkUrls[0]} />
      )}
    </CollapsibleMessage>
  );
}

// ── ThreadPreviewPopover ───────────────────────────────────────────────────────

interface ThreadPreviewPopoverProps {
  replies: ChatMessage[];
}

function ThreadPreviewPopover({ replies }: ThreadPreviewPopoverProps) {
  if (replies.length === 0) return null;
  return (
    <div className="thread-popover" role="tooltip">
      {replies.map(msg => (
        <div key={msg.id} className="thread-popover-row">
          <span
            className="thread-popover-nick"
            style={{ color: getNickColor(msg.from) }}
          >
            {msg.from}
          </span>
          <span className="thread-popover-text">
            {msg.deleted ? '(deleted)' : msg.text.slice(0, 80) + (msg.text.length > 80 ? '…' : '')}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MessageItem({ message, isMe, compact, isGrouped = false, isNew = false, onMsgRef, onJumpToMessage }: Props) {
  // isGrouped takes precedence; compact is kept for backwards compat
  const grouped = isGrouped || (compact ?? false);
  const { from, text, type, time, highlight, reactions, replyTo, edited, deleted, redacted } = message;
  const ourNick               = useOnyxStore(s => s.ourNick);
  const setReplyingTo         = useOnyxStore(s => s.setReplyingTo);
  const addLocalReaction      = useOnyxStore(s => s.addLocalReaction);
  const addReaction           = useOnyxStore(s => s.addReaction);
  const editMessage           = useOnyxStore(s => s.editMessage);
  const deleteMessage         = useOnyxStore(s => s.deleteMessage);
  const pinMessage            = useOnyxStore(s => s.pinMessage);
  const unpinMessage          = useOnyxStore(s => s.unpinMessage);
  const pinnedMessages        = useOnyxStore(s => s.pinnedMessages);
  const openThread            = useOnyxStore(s => s.openThread);
  const isSelectMode          = useOnyxStore(s => s.isSelectMode);
  const selectedMessages      = useOnyxStore(s => s.selectedMessages);
  const toggleMessageSelection = useOnyxStore(s => s.toggleMessageSelection);
  const enterSelectMode       = useOnyxStore(s => s.enterSelectMode);
  const setForwardingMessage = useOnyxStore(s => s.setForwardingMessage);
  const addBookmark      = useOnyxStore(s => s.addBookmark);
  const removeBookmark   = useOnyxStore(s => s.removeBookmark);
  const bookmarks        = useOnyxStore(s => s.bookmarks);
  const channels         = useOnyxStore(s => s.channels);
  const dms              = useOnyxStore(s => s.dms);
  const activeView           = useOnyxStore(s => s.activeView);
  const openUserProfile      = useOnyxStore(s => s.openUserProfile);
  const openUserProfileCard  = useOnyxStore(s => s.openUserProfileCard);
  const customEmoji          = useOnyxStore(s => s.customEmoji);
  const highlightWords       = useOnyxStore(s => s.highlightWords);
  const nickColorOverrides   = useOnyxStore(s => s.nickColorOverrides);
  const timeFormat           = useOnyxStore(s => s.timeFormat);
  const collapsedNicks       = useOnyxStore(s => s.collapsedNicks);
  const expandNickMessages   = useOnyxStore(s => s.expandNickMessages);
  const threadLastSeen       = useOnyxStore(s => s.threadLastSeen);
  const suppressedEmbeds     = useOnyxStore(s => s.suppressedEmbeds);
  const toggleSuppressEmbed  = useOnyxStore(s => s.toggleSuppressEmbed);
  const archivedThreads      = useOnyxStore(s => s.archivedThreads);
  const activeThreads        = useOnyxStore(s => s.activeThreads);
  const softIgnoreList       = useOnyxStore(s => s.softIgnoreList);
  const revealedMessages     = useOnyxStore(s => s.revealedMessages);
  const revealMessage        = useOnyxStore(s => s.revealMessage);

  const [showPicker,   setShowPicker]   = useState(false);
  const [isEditing,    setIsEditing]    = useState(false);
  const [editDraft,    setEditDraft]    = useState('');
  const [contextMenu,  setContextMenu]  = useState<{ x: number; y: number } | null>(null);
  const [miniCard,     setMiniCard]     = useState<{ nick: string; el: HTMLElement } | null>(null);
  const [animNew,      setAnimNew]      = useState(isNew);
  const pickerRef    = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const timeStr = formatMessageTime(time, timeFormat);

  // Ref callback for jump-to-message
  const setRef = useCallback((el: HTMLElement | null) => {
    onMsgRef?.(message.id, el);
  }, [message.id, onMsgRef]);

  // Count messages in the active target that reply to this message
  const allMessages = useMemo(() => {
    if (activeView.kind === 'channel') {
      return channels.get(activeView.channel.toLowerCase())?.messages ?? [];
    }
    if (activeView.kind === 'dm') {
      return dms.get(activeView.nick.toLowerCase())?.messages ?? [];
    }
    return [];
  }, [activeView, channels, dms]);

  const threadReplies = useMemo(
    () => allMessages.filter(m => m.replyTo?.id === message.id),
    [allMessages, message.id],
  );

  const replyCount = threadReplies.length;

  const threadParticipants = useMemo(
    () => [...new Set(threadReplies.map(m => m.from))].slice(0, 5),
    [threadReplies],
  );

  const lastThreadReplyTime = useMemo(
    () => threadReplies.reduce<Date | null>((acc, m) => (!acc || m.time > acc ? m.time : acc), null),
    [threadReplies],
  );

  const hasUnreadThreadReplies = useMemo(() => {
    const seen = threadLastSeen[message.id];
    if (!seen || !lastThreadReplyTime) return false;
    return lastThreadReplyTime > seen;
  }, [threadLastSeen, message.id, lastThreadReplyTime]);

  const [isHoveringBadge, setIsHoveringBadge] = useState(false);

  const isBookmarked = useMemo(
    () => bookmarks.some(b => b.id === message.id),
    [bookmarks, message.id],
  );

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  // Remove new-message animation class after it completes
  useEffect(() => {
    if (!animNew) return;
    const tid = setTimeout(() => setAnimNew(false), 400);
    return () => clearTimeout(tid);
  }, [animNew]);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isEditing]);

  // Listen for ocean:edit-message custom event (fired from context menu)
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail?.messageId === message.id) {
        setEditDraft(message.text);
        setIsEditing(true);
      }
    };
    window.addEventListener('ocean:edit-message', handler as EventListener);
    return () => window.removeEventListener('ocean:edit-message', handler as EventListener);
  }, [message.id, message.text]);

  const startEdit = useCallback(() => {
    setEditDraft(text);
    setIsEditing(true);
  }, [text]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditDraft('');
  }, []);

  const commitEdit = useCallback(() => {
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed.length > EDIT_MAX) return;
    if (trimmed !== text) {
      editMessage(message.target, message.id, trimmed);
    }
    setIsEditing(false);
    setEditDraft('');
  }, [editDraft, text, editMessage, message.target, message.id]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }, [commitEdit, cancelEdit]);

  const handleDelete = useCallback(() => {
    deleteMessage(message.target, message.id);
  }, [deleteMessage, message.target, message.id]);

  const isPinned = (pinnedMessages.get(message.target.toLowerCase()) ?? [])
    .some(m => m.id === message.id);

  const handlePin = useCallback(() => {
    if (isPinned) {
      unpinMessage(message.target, message.id);
    } else {
      pinMessage(message.target, message);
    }
  }, [isPinned, pinMessage, unpinMessage, message]);

  const handleBookmark = useCallback(() => {
    if (isBookmarked) {
      removeBookmark(message.id);
    } else {
      addBookmark(message);
    }
  }, [isBookmarked, addBookmark, removeBookmark, message]);

  const handleForward = useCallback(() => {
    setForwardingMessage(message);
  }, [setForwardingMessage, message]);

  const handleOpenThread = useCallback(() => {
    openThread(message.id);
  }, [openThread, message.id]);

  // Determine if sender is a bot (+B mode) in the active channel
  const isBot = useMemo(() => {
    if (!from) return false;
    if (activeView.kind === 'channel') {
      const ch = channels.get(activeView.channel.toLowerCase());
      return ch?.users.get(from.toLowerCase())?.modes.has('B') ?? false;
    }
    return false;
  }, [from, activeView, channels]);


  const isSystem  = type === 'system' || type === 'error' || !from;
  const isAction  = type === 'action';
  const isNotice  = type === 'notice';
  const isJoin    = type === 'join';
  const isPart    = type === 'part' || type === 'quit' || type === 'kick';
  const isMode    = type === 'mode';
  const isNick    = type === 'nick';
  const isWhisper = type === 'whisper';

  // Pre-compute rendered for action/notice/whisper (inline only — no code blocks)
  const rendered = useMemo(() => renderText(text), [text]);

  // Link URLs in this message — used for embed suppression button visibility
  const msgLinkUrls = useMemo(() => extractLinkUrls(text), [text]);

  const scrollToParent = useCallback(() => {
    if (!replyTo) return;
    if (onJumpToMessage) {
      onJumpToMessage(replyTo.id);
      return;
    }
    const el = document.querySelector(`[data-msg-id="${replyTo.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('msg--focused');
      setTimeout(() => el.classList.remove('msg--focused'), 1500);
    }
  }, [replyTo, onJumpToMessage]);

  const isSelected = selectedMessages.has(message.id);

  const handleMsgClick = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      enterSelectMode();
      toggleMessageSelection(message.id);
      return;
    }
    if (isSelectMode) {
      e.preventDefault();
      toggleMessageSelection(message.id);
    }
  }, [isSelectMode, enterSelectMode, toggleMessageSelection, message.id]);

  // ── Event messages ─────────────────────────────────────────────────────

  // Nick change — rendered with special old→new styling
  const nickChangeMatch = (isSystem || isNick) ? text.match(/^(.+?) → (.+)$/) : null;
  if (nickChangeMatch) {
    const oldNick = nickChangeMatch[1];
    const newNick = nickChangeMatch[2];
    return (
      <div className="msg-nick-change" role="status" aria-label={`${oldNick} is now known as ${newNick}`}>
        <span className="msg-nick-change-icon" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M8.5 2.5l1 1-5.5 5.5-1.5.5.5-1.5 5.5-5.5zm.7-.7a1 1 0 0 1 1.4 1.4l-6 6-2.5.8.8-2.5 6-5.7z"/>
          </svg>
        </span>
        <span className="msg-nick-change-old">{oldNick}</span>
        <span className="msg-nick-change-arrow"> → </span>
        <span className="msg-nick-change-new">{newNick}</span>
        {timeStr && <time className="msg-nick-change-time">{timeStr}</time>}
        <style>{nickChangeStyles}</style>
      </div>
    );
  }

  if (isSystem || isJoin || isPart || isMode || isNick) {
    const parsed = parseEventText(text, type);
    return (
      <div className={`msg-event msg-event--${parsed.kind}`} role="status" aria-label={text}>
        <span className="msg-event-dot" aria-hidden>
          {parsed.icon}
        </span>
        <span className="msg-event-body">
          {parsed.nick && <strong className="msg-event-nick">{parsed.nick}</strong>}
          {parsed.action && <span className="msg-event-action"> {parsed.action}</span>}
          {parsed.reason && <span className="msg-event-reason"> · {parsed.reason}</span>}
          {!parsed.nick && !parsed.action && <span className="msg-event-action">{text}</span>}
        </span>
        {timeStr && <time className="msg-event-time">{timeStr}</time>}
        <style>{eventStyles}</style>
      </div>
    );
  }

  // ── Action (/me) ───────────────────────────────────────────────────────
  if (isAction) {
    return (
      <div className={`msg-item ${grouped ? 'msg-grouped' : ''} ${highlight ? 'msg-item--highlight' : ''}`} style={{ paddingTop: grouped ? 2 : 9, paddingBottom: grouped ? 2 : 5 }}>
        {!grouped && (
          <div className="msg-avatar-col" style={{ width: 40, flexShrink: 0 }} />
        )}
        {grouped && (
          <div className="msg-avatar-col" style={{ width: 40, flexShrink: 0, position: 'relative' }}>
            {timeStr && (
              <time className="msg-grouped-time msg-ts-spacer" aria-hidden>
                {timeStr}
              </time>
            )}
          </div>
        )}
        <div className="msg-body">
          {!grouped && <div className="msg-meta msg-nick-row"><span className="msg-nick">{getDisplayName(from)}</span>{timeStr && <time className="msg-time">{timeStr}</time>}</div>}
          <div className="msg-action">
            <span className="msg-action-nick">* {getDisplayName(from)}</span>
            {' '}<span dangerouslySetInnerHTML={{ __html: rendered }} />
          </div>
        </div>
        <style>{msgStyles}</style>
      </div>
    );
  }

  // ── Notice ─────────────────────────────────────────────────────────────
  if (isNotice) {
    return (
      <div className="msg-notice">
        <span className="msg-notice-prefix">[{from}]</span>
        <span dangerouslySetInnerHTML={{ __html: rendered }} />
        {timeStr && <time className="msg-event-time">{timeStr}</time>}
        <style>{noticeStyles}</style>
      </div>
    );
  }

  // ── Whisper (in-channel private) ───────────────────────────────────────
  if (isWhisper) {
    return (
      <div className="msg-whisper animate-fade-in">
        <span className="msg-whisper-icon">💬</span>
        <div className="msg-whisper-body">
          <span className="msg-whisper-label">
            <UserPopover nick={from}>
              <strong>{from}</strong>
            </UserPopover>
            {' '}whispered to you
          </span>
          <span className="msg-whisper-text" dangerouslySetInnerHTML={{ __html: rendered }} />
        </div>
        {timeStr && <time className="msg-event-time">{timeStr}</time>}
        <style>{whisperStyles}</style>
      </div>
    );
  }

  // ── Collapsed nick placeholder ─────────────────────────────────────────
  const isCollapsed = from && collapsedNicks.has(from.toLowerCase());
  if (isCollapsed) {
    return (
      <>
        <div className="msg-collapsed" data-msg-id={message.id}>
          <span className="msg-collapsed-nick">{from}</span>
          <span className="msg-collapsed-text">messages hidden</span>
          <button className="msg-collapsed-show" onClick={() => expandNickMessages(from)}>
            Show
          </button>
        </div>
        <style>{collapsedStyles}</style>
      </>
    );
  }

  // ── Soft ignore placeholder ────────────────────────────────────────────
  const isHidden = from && softIgnoreList.has(from) && !revealedMessages.has(message.id);
  if (isHidden) {
    return (
      <div className="msg-hidden-wrap" data-msg-id={message.id}>
        <span className="msg-hidden-icon">👁</span>
        <span className="msg-hidden-text">
          Message from <strong>{from}</strong> — hidden
        </span>
        <button className="msg-hidden-reveal" onClick={() => revealMessage(message.id)}>
          Show message
        </button>
        <style>{hiddenMsgStyles}</style>
      </div>
    );
  }

  // ── Normal message ─────────────────────────────────────────────────────
  return (
    <div
      data-msg-id={message.id}
      ref={setRef}
      role="article"
      aria-label={`Message from ${from} at ${timeStr}`}
      data-selected={isSelectMode ? isSelected : undefined}
      className={`msg-item ${grouped ? 'msg-grouped' : ''} ${highlight ? 'msg-item--highlight' : ''} ${isMe ? 'msg-item--self' : ''} ${isSelected ? 'msg-item--selected' : ''} ${animNew ? 'msg-new' : ''}`}
      style={{ paddingTop: grouped ? 2 : 9, paddingBottom: grouped ? 2 : 5 }}
      onClick={handleMsgClick}
      onContextMenu={e => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Avatar column */}
      {!grouped && (
        <div className="msg-avatar-col" style={{ width: 40, flexShrink: 0 }} />
      )}
      {grouped && (
        <div className="msg-avatar-col" style={{ width: 40, flexShrink: 0, position: 'relative' }}>
          {timeStr && (
            <time className="msg-grouped-time msg-ts-spacer" aria-hidden>
              {timeStr}
            </time>
          )}
        </div>
      )}

      <div className="msg-body">
        {/* Header row */}
        {!grouped && (
          <div className="msg-meta msg-nick-row">
            <span
              className="msg-nick"
              style={{ color: nickColorOverrides.get(from.toLowerCase()) ?? getNickColor(from), display: 'inline-flex', alignItems: 'baseline', gap: 4 }}
              onClick={e => {
                e.stopPropagation();
                openUserProfileCard(from, { x: e.clientX, y: e.clientY });
              }}
            >
              {getDisplayName(from)}
            </span>
            {isBot && <span className="bot-badge">BOT</span>}
            {timeStr && (
              <time
                className="msg-time"
                dateTime={time.toISOString()}
                title={time.toLocaleString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              >
                {timeStr}
              </time>
            )}
            {edited && !deleted && !redacted && <span className="msg-edited">(edited)</span>}
          </div>
        )}

        {/* Reply quote */}
        {replyTo && !deleted && !redacted && (
          <ReplyQuote replyTo={replyTo} onClick={scrollToParent} />
        )}

        {/* Message body — poll, segments, images, link preview */}
        {!deleted && !redacted && POLL_PATTERN.test(text) ? (
          <PollMessage
            msg={message}
            onVote={(_optionIndex) => {
              // Optimistic local update via reaction emoji (1️⃣–4️⃣)
              const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
              const emoji = emojis[_optionIndex];
              if (emoji) addLocalReaction(message.target, message.id, emoji);
              // Broadcast vote to channel via CTCP POLL_VOTE so others see it in real-time
              const { client, activeView } = useOnyxStore.getState();
              const voteTarget = message.target || (activeView.kind === 'channel' ? activeView.channel : null);
              if (client && voteTarget) {
                client.sendRaw('PRIVMSG', voteTarget, `\x01POLL_VOTE ${message.id} ${_optionIndex}\x01`);
              }
            }}
          />
        ) : (
          <div
            onDoubleClick={isMe && !isEditing && !deleted ? startEdit : undefined}
            style={isMe && !isEditing && !deleted ? { cursor: 'text' } : undefined}
          >
            <MessageBody
              text={text}
              deleted={!!deleted}
              redacted={!!redacted}
              isEditing={isEditing}
              editDraft={editDraft}
              editInputRef={editInputRef}
              onEditChange={setEditDraft}
              onEditKeyDown={handleEditKeyDown}
              onCancel={cancelEdit}
              onCommit={commitEdit}
              customEmoji={customEmoji}
              hlWords={highlightWords}
              messageId={message.id}
              suppressedEmbeds={suppressedEmbeds}
            />
          </div>
        )}
        {/* Grouped-mode edited indicator (shown after text instead of in header) */}
        {grouped && edited && !deleted && !redacted && !isEditing && (
          <span className="msg-edited">(edited)</span>
        )}

        {/* Reactions — only when not deleted or redacted */}
        {!deleted && !redacted && reactions && reactions.length > 0 && (
          <ReactionBar
            reactions={reactions}
            ourNick={ourNick}
            messageId={message.id}
            target={message.target}
            onToggle={emoji => addReaction(message.target, message.id, emoji)}
          />
        )}

        {/* Thread reply count badge — always visible when there are replies */}
        {!deleted && !redacted && replyCount > 0 && (
          <div
            className="thread-preview-badge"
            onClick={handleOpenThread}
            onMouseEnter={() => setIsHoveringBadge(true)}
            onMouseLeave={() => setIsHoveringBadge(false)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenThread(); } }}
            aria-label={`View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} in thread`}
            title={lastThreadReplyTime ? `Last reply ${lastThreadReplyTime.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : undefined}
          >
            {archivedThreads.has(message.id) && (
              <span className="thread-badge-archived" aria-label="Archived thread">🔒</span>
            )}
            <AvatarStack nicks={threadParticipants} />
            <span>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
            {activeThreads.has(message.id) && (
              <span className="thread-badge-active-dot" aria-label="Active thread" />
            )}
            {hasUnreadThreadReplies && <span className="thread-unread-dot" aria-label="Unread replies">•</span>}
            <span className="thread-arrow">→</span>

            {/* Preview popover */}
            {isHoveringBadge && threadReplies.length > 0 && (
              <ThreadPreviewPopover replies={threadReplies.slice(-3)} />
            )}
          </div>
        )}
      </div>

      {/* Grouped time — rendered inside msg-avatar-col above; this is kept for legacy compact usage */}
      {(compact && !isGrouped) && timeStr && <time className="msg-time-compact" aria-hidden>{timeStr}</time>}

      {/* Hover actions — hidden while editing, deleted or redacted */}
      {!isEditing && !deleted && !redacted && (
        <div className="msg-actions msg-actions-bar">
          <div ref={pickerRef} className="picker-anchor">
            {showPicker && (
              <EmojiPicker
                onPick={(emoji) => {
                  addReaction(message.target, message.id, emoji);
                  setShowPicker(false);
                }}
                onClose={() => setShowPicker(false)}
              />
            )}
            <button
              className="action-btn"
              title="Add reaction"
              aria-label="Add reaction"
              onClick={() => setShowPicker(p => !p)}
            >
              <EmojiAddIcon />
            </button>
          </div>
          <button
            className="action-btn"
            title="Reply"
            aria-label="Reply"
            onClick={() => setReplyingTo(message)}
          >
            <ReplyIcon />
          </button>
          <button
            className="action-btn"
            title="Start thread"
            aria-label="Start thread"
            onClick={handleOpenThread}
          >
            <ThreadBubbleIcon />
          </button>
          <button
            className="action-btn"
            title="Forward message"
            aria-label="Forward message"
            onClick={handleForward}
          >
            <ForwardIcon />
          </button>
          <button
            className={`action-btn ${isBookmarked ? 'action-btn--bookmarked' : ''}`}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark message'}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark message'}
            onClick={handleBookmark}
          >
            <BookmarkIcon filled={isBookmarked} />
          </button>
          <button
            className={`action-btn ${isPinned ? 'action-btn--pinned' : ''}`}
            title={isPinned ? 'Unpin message' : 'Pin message'}
            aria-label={isPinned ? 'Unpin message' : 'Pin message'}
            onClick={handlePin}
          >
            <MsgPinIcon />
          </button>
          {isMe && (
            <>
              <button
                className="action-btn action-btn--edit"
                title="Edit message"
                aria-label="Edit message"
                onClick={startEdit}
              >
                <EditIcon />
              </button>
              <button
                className="action-btn action-btn--delete"
                title="Delete message"
                aria-label="Delete message"
                onClick={handleDelete}
              >
                <DeleteIcon />
              </button>
              {msgLinkUrls.length > 0 && (
                <button
                  className={`action-btn ${suppressedEmbeds.has(message.id) ? 'action-btn--suppressed' : ''}`}
                  title={suppressedEmbeds.has(message.id) ? 'Show embed' : 'Hide embed'}
                  aria-label={suppressedEmbeds.has(message.id) ? 'Show embed' : 'Hide embed'}
                  onClick={() => toggleSuppressEmbed(message.id)}
                >
                  <EmbedToggleIcon suppressed={suppressedEmbeds.has(message.id)} />
                </button>
              )}
            </>
          )}
          <button
            className="action-btn"
            title="More options"
            aria-label="More options"
            type="button"
            onClick={e => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setContextMenu({ x: rect.right, y: rect.bottom });
            }}
          >
            <MoreIcon />
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          message={message}
          isOwnMessage={isMe}
          isPinned={isPinned}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Mini user card — shown on nick / avatar click */}
      {miniCard && (
        <MiniUserCard
          nick={miniCard.nick}
          anchorEl={miniCard.el}
          onClose={() => setMiniCard(null)}
          onOpenProfile={() => {
            openUserProfile(miniCard.nick);
            setMiniCard(null);
          }}
        />
      )}

      <style>{msgStyles}</style>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyInlineFormatting(html: string): string {
  // Input is already HTML-escaped. Apply inline markdown patterns.

  // Inline code `code` (process first to avoid conflicts)
  html = html.replace(/`([^`]+)`/g, '<code class="msg-code">$1</code>');

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Underline __text__ (before italic _ to avoid ambiguity)
  html = html.replace(/__(.+?)__/g, '<u>$1</u>');

  // Italic *text* or _text_
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>');

  // Strikethrough ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Spoiler ||text||
  html = html.replace(/\|\|(.+?)\|\|/g, '<span class="msg-spoiler" tabindex="0" role="button" aria-label="Spoiler, click to reveal">$1</span>');

  // @nick mentions
  html = html.replace(/@([a-zA-Z0-9_\[\]\\^`{|-]+)/g, '<span class="msg-mention">@$1</span>');

  // Masked links: [label](url) — process before bare URLs so the url inside isn't double-linked
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => {
      const safeLabel = label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-link msg-link--masked">${safeLabel}</a>`;
    }
  );

  // URLs
  html = html.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>',
  );

  // Strip any remaining control codes
  html = html.replace(/[\x00-\x1f]/g, '');

  return html;
}

function renderText(text: string): string {
  // 1. Strip IRC control codes first
  const stripped = stripIrcFormatting(text);

  // 2. Check for >>> multiline blockquote (entire message)
  if (stripped.startsWith('>>> ')) {
    const content = applyInlineFormatting(escapeHtml(stripped.slice(4)));
    return `<blockquote class="msg-blockquote msg-blockquote--multi">${content}</blockquote>`;
  }

  const lines = stripped.split('\n');
  const parts: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // H3 (test before H2 and H1 to avoid partial prefix matching)
    if (/^### /.test(line)) {
      parts.push(`<h3 class="msg-h3">${applyInlineFormatting(escapeHtml(line.slice(4)))}</h3>`);
      i++;
    }
    // H2
    else if (/^## /.test(line)) {
      parts.push(`<h2 class="msg-h2">${applyInlineFormatting(escapeHtml(line.slice(3)))}</h2>`);
      i++;
    }
    // H1
    else if (/^# /.test(line)) {
      parts.push(`<h1 class="msg-h1">${applyInlineFormatting(escapeHtml(line.slice(2)))}</h1>`);
      i++;
    }
    // Subtext -#
    else if (/^-# /.test(line)) {
      parts.push(`<span class="msg-subtext">${applyInlineFormatting(escapeHtml(line.slice(3)))}</span>`);
      i++;
    }
    // Blockquote > (accumulate consecutive lines)
    else if (/^> /.test(line)) {
      const qlines: string[] = [];
      while (i < lines.length && /^> /.test(lines[i])) {
        qlines.push(applyInlineFormatting(escapeHtml(lines[i].slice(2))));
        i++;
      }
      parts.push(`<blockquote class="msg-blockquote">${qlines.join('<br>')}</blockquote>`);
    }
    // Unordered list - or *
    else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting(escapeHtml(lines[i].slice(2)))}</li>`);
        i++;
      }
      parts.push(`<ul class="msg-list">${items.join('')}</ul>`);
    }
    // Ordered list 1. 2. etc
    else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting(escapeHtml(lines[i].replace(/^\d+\. /, '')))}</li>`);
        i++;
      }
      parts.push(`<ol class="msg-list msg-list--ordered">${items.join('')}</ol>`);
    }
    // Table: starts with | and next line is |---|
    else if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[-|\s:]+\|/.test(lines[i + 1])) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.+\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse header
      const header = tableLines[0].split('|').slice(1, -1).map(c => c.trim());
      // Skip separator row (index 1)
      const rows = tableLines.slice(2).map(row =>
        row.split('|').slice(1, -1).map(c => c.trim())
      );
      const thead = header.map(h => `<th class="msg-th">${applyInlineFormatting(escapeHtml(h))}</th>`).join('');
      const tbody = rows.map(row =>
        `<tr>${row.map(cell => `<td class="msg-td">${applyInlineFormatting(escapeHtml(cell))}</td>`).join('')}</tr>`
      ).join('');
      parts.push(`<table class="msg-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`);
    }
    // Empty line → paragraph break
    else if (line.trim() === '') {
      parts.push('<br class="msg-para-break">');
      i++;
    }
    // Regular text — accumulate consecutive plain lines
    else {
      const plainLines: string[] = [];
      while (
        i < lines.length &&
        !/^#{1,3} |^-# |^> |^[-*] |^\d+\. /.test(lines[i]) &&
        lines[i].trim() !== ''
      ) {
        plainLines.push(applyInlineFormatting(escapeHtml(lines[i])));
        i++;
      }
      if (plainLines.length > 0) parts.push(plainLines.join('<br>'));
    }
  }

  return parts.join('\n');
}

// ── Event icon SVGs ───────────────────────────────────────────────────────────

const JoinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2zm.5 2v2.5H9v1H6.5V9h-1V7.5H3v-1h2.5V5h1z"/>
  </svg>
);

const PartIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2zm2.5 3.5v1H3.5v-1h5z"/>
  </svg>
);

const QuitIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2zM4.5 4.5l3 3-.7.7-3-3 .7-.7zm3 0l.7.7-3 3-.7-.7 3-3z"/>
  </svg>
);

const KickIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2zm.5 2v2.5l2 1.5-.6.8-2.4-1.8V4h1z"/>
  </svg>
);

const ModeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 2a4 4 0 1 1 0 8A4 4 0 0 1 6 2zM1.5 1L3 2.5l-.7.7L.8 1.7 1.5 1zm9 0l.7.7-1.5 1.5-.7-.7L10.5 1zM6 3a3 3 0 1 0 0 6A3 3 0 0 0 6 3zm.5 1v2.2l1.3 1.3-.7.7-1.6-1.6V4h1z"/>
  </svg>
);

const NickIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M8.5 2.5l1 1-5.5 5.5-1.5.5.5-1.5 5.5-5.5zm.7-.7a1 1 0 0 1 1.4 1.4l-6 6-2.5.8.8-2.5 6-5.7z"/>
  </svg>
);

const InfoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2zm-.5 3.5h1v1h-1v-1zm0 2h1v3h-1V8.5z"/>
  </svg>
);

// ── Event text parser ─────────────────────────────────────────────────────────

type EventKind = 'join' | 'part' | 'quit' | 'kick' | 'mode' | 'nick' | 'info';

interface ParsedEvent {
  kind: EventKind;
  icon: React.ReactNode;
  nick: string;
  action: string;
  reason: string;
}

function parseEventText(text: string, type: string): ParsedEvent {
  // Explicit type-specific messages from IRC events
  // System messages from sysMsg() use type='system' but contain structured text

  // "X joined"
  const joinMatch = text.match(/^(.+?) joined$/);
  if (joinMatch || type === 'join') {
    const nick = joinMatch ? joinMatch[1] : text;
    return { kind: 'join', icon: <JoinIcon />, nick, action: 'joined the channel', reason: '' };
  }

  // "X left (reason)" or "X left"
  const partMatch = text.match(/^(.+?) left(?: \(([^)]+)\))?$/);
  if (partMatch || type === 'part') {
    const nick = partMatch ? partMatch[1] : text;
    const reason = partMatch ? (partMatch[2] ?? '') : '';
    return { kind: 'part', icon: <PartIcon />, nick, action: 'left', reason };
  }

  // "X quit: reason"
  const quitMatch = text.match(/^(.+?) quit(?:: (.+))?$/);
  if (quitMatch || type === 'quit') {
    const nick = quitMatch ? quitMatch[1] : text;
    const reason = quitMatch ? (quitMatch[2] ?? '') : '';
    return { kind: 'quit', icon: <QuitIcon />, nick, action: 'disconnected', reason };
  }

  // "X kicked Y: reason" or "X kicked Y"
  const kickMatch = text.match(/^(.+?) kicked (.+?)(?:: (.+))?$/);
  if (kickMatch || type === 'kick') {
    const nick = kickMatch ? kickMatch[1] : '';
    const target = kickMatch ? kickMatch[2] : text;
    const reason = kickMatch ? (kickMatch[3] ?? '') : '';
    const action = `kicked ${target}`;
    return { kind: 'kick', icon: <KickIcon />, nick, action, reason };
  }

  // "X set mode ..." or "X → Y" (nick change)
  const nickMatch = text.match(/^(.+?) → (.+)$/);
  if (nickMatch || type === 'nick') {
    const oldNick = nickMatch ? nickMatch[1] : text;
    const newNick = nickMatch ? nickMatch[2] : '';
    const action = newNick ? `is now known as ${newNick}` : 'changed nick';
    return { kind: 'nick', icon: <NickIcon />, nick: oldNick, action, reason: '' };
  }

  const modeMatch = text.match(/^(.+?) set mode (.+)$/);
  if (modeMatch || type === 'mode') {
    const nick = modeMatch ? modeMatch[1] : '';
    const modeStr = modeMatch ? modeMatch[2] : text;
    return { kind: 'mode', icon: <ModeIcon />, nick, action: `set mode ${modeStr}`, reason: '' };
  }

  // Fallback: render as-is
  return { kind: 'info', icon: <InfoIcon />, nick: '', action: text, reason: '' };
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const msgStyles = `
  @keyframes msg-slide-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .msg-new {
    animation: msg-slide-in 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .msg-slide-in,
    .msg-new,
    .msg-time,
    .msg-time-compact,
    .msg-grouped-time,
    .msg-reaction-btn,
    .reaction-pill,
    .msg-actions,
    .msg-actions-bar,
    .action-btn,
    .av-pop,
    .msg-inline-edit,
    .msg-jump-highlight {
      animation: none !important;
      transition: none !important;
      transform: none !important;
    }
  }

  .msg-item {
    display: flex;
    gap: 11px;
    padding: 2px 16px;
    position: relative;
    isolation: isolate;
  }
  .msg-item:hover { background: rgba(14,165,233,0.045); }
  .msg-item--highlight {
    background: color-mix(in srgb, var(--gold) 8%, transparent);
    border-left: 3px solid var(--gold);
    padding-left: 13px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 12%, transparent);
  }
  .msg-item--highlight:hover { background: color-mix(in srgb, var(--gold) 12%, transparent); }

  /* Own messages: very subtle warm-blue tint so self-messages stand out slightly */
  .msg-item--self:not(.msg-item--highlight):not(.msg-item--selected) {
    background: rgba(14,165,233,0.022);
  }
  .msg-item--self:not(.msg-item--highlight):not(.msg-item--selected):hover {
    background: rgba(14,165,233,0.06);
  }

  /* Mention highlight: accent left border + faint background when @nick matches */
  .msg-item--mention {
    background: rgba(14,165,233,0.045);
    border-left: 3px solid var(--accent);
    padding-left: 13px;
  }
  .msg-item--mention:hover { background: rgba(14,165,233,0.075); }
  .msg-item--selected {
    background: color-mix(in srgb, var(--accent, #0ea5e9) 8%, transparent);
    border-left: 3px solid var(--accent, #0ea5e9);
    padding-left: 13px;
  }
  .msg-item--selected:hover {
    background: color-mix(in srgb, var(--accent, #0ea5e9) 12%, transparent);
  }

  .msg-body { flex: 1; min-width: 0; }
  .msg-meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; min-height: 18px; }

  .msg-nick {
    font-size: 13px;
    font-weight: 750;
    cursor: pointer;
    letter-spacing: 0;
    line-height: 1.25;
    text-shadow: 0 0 18px var(--accent-glow);
  }
  .msg-nick:hover { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }

  .msg-time {
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
    opacity: 0.62;
    transition: opacity var(--t-fast);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }
  .msg-item:hover .msg-time { opacity: 0.96; }

  .msg-edited { font-size: 10px; color: var(--text-muted); font-style: italic; opacity: 0.72; }

  .bot-badge {
    font-size: 9px;
    font-weight: 800;
    background: rgba(14, 165, 233, 0.12);
    color: var(--accent);
    border: 1px solid var(--accent-border);
    border-radius: 3px;
    padding: 1px 4px;
    margin-left: 4px;
    vertical-align: middle;
    flex-shrink: 0;
  }

  .msg-deleted {
    font-size: 14px; color: var(--text-muted); font-style: italic;
    margin: 0; padding: 0;
    user-select: none;
  }

  .msg-time-compact {
    position: absolute; left: 20px; top: 50%; transform: translateY(-50%);
    font-size: 10px; color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--t-fast);
    pointer-events: none; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .msg-item:hover .msg-time-compact { opacity: 1; }

  /* ── Grouped messages (same sender, within 5 min, same day) ── */
  .msg-item.msg-grouped {
    padding-top: 2px;
    padding-bottom: 2px;
    margin-top: 0;
  }
  .msg-item:not(.msg-grouped) {
    margin-top: 8px;
  }
  .msg-grouped .msg-avatar-col {
    visibility: hidden;
  }
  .msg-grouped .msg-nick-row {
    display: none;
  }
  .msg-grouped-time {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--t-fast);
    font-variant-numeric: tabular-nums;
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    width: 52px;
    text-align: right;
    padding-right: 8px;
    pointer-events: none;
  }
  .msg-item:hover .msg-grouped-time {
    opacity: 1;
  }

  /* Focused highlight (scroll-to-parent) */
  .msg--focused {
    background: rgba(14,165,233,0.12) !important;
    outline: 1px solid rgba(14,165,233,0.35);
    border-radius: 4px;
  }

  .msg-text {
    font-size: var(--msg-font-size, 14px); line-height: 1.52; color: var(--text-primary);
    word-break: break-word; white-space: pre-wrap;
  }

  /* Inline edit */
  .msg-edit-wrap {
    display: flex; flex-direction: column; gap: 6px;
    margin-top: 2px;
  }
  .msg-edit-input {
    width: 100%;
    background: var(--bg-elevated);
    border: 1px solid var(--accent-border);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: 15px;
    line-height: 1.55;
    padding: 8px 12px;
    resize: none;
    outline: none;
    font-family: inherit;
    box-sizing: border-box;
    field-sizing: content;
    min-height: 2lh;
    max-height: 12lh;
  }
  .msg-edit-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(14,165,233,0.18);
  }
  .msg-edit-input--over {
    border-color: var(--danger, #ef4444) !important;
    box-shadow: 0 0 0 2px rgba(239,68,68,0.18) !important;
  }
  .msg-edit-actions {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .msg-edit-hint {
    font-size: 12px; color: var(--text-muted); flex: 1;
  }
  .msg-edit-hint kbd {
    display: inline-flex; align-items: center;
    padding: 0 4px; border-radius: 3px;
    background: var(--bg-overlay); border: 1px solid var(--border-normal);
    font-size: 11px; font-family: inherit; font-weight: 600;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .msg-edit-count {
    font-size: 12px; color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .msg-edit-count--over {
    color: var(--danger, #ef4444); font-weight: 600;
  }
  .msg-edit-btn {
    font-size: 13px; font-weight: 600;
    padding: 4px 12px; border-radius: var(--r-xs);
    border: 1px solid transparent; cursor: pointer;
    font-family: inherit;
    transition: opacity var(--t-fast);
  }
  .msg-edit-btn:hover:not(:disabled) { opacity: 0.85; }
  .msg-edit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .msg-edit-btn--cancel {
    background: var(--bg-elevated);
    border-color: var(--border-normal);
    color: var(--text-secondary);
  }
  .msg-edit-btn--save {
    background: var(--accent);
    color: #fff;
  }

  .msg-code {
    font-family: var(--font-mono);
    font-size: 13px;
    background: var(--bg-deep);
    color: var(--accent-hover);
    padding: 1px 5px 2px;
    border-radius: var(--r-xs);
    border: 1px solid var(--border-subtle);
    line-height: 1.4;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.32);
  }
  .msg-mention {
    color: var(--text-primary);
    background: var(--accent-subtle);
    padding: 0 5px;
    border-radius: var(--r-xs);
    border: 1px solid var(--accent-border);
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 0 14px var(--accent-glow);
  }
  .highlight-word {
    background: var(--gold-subtle);
    color: var(--gold);
    border: 1px solid color-mix(in srgb, var(--gold) 28%, transparent);
    border-radius: var(--r-xs);
    padding: 0 4px;
    font-weight: 750;
    font-style: normal;
    box-shadow: 0 0 16px var(--accent-glow);
  }
  .msg-link {
    color: var(--accent-hover);
    text-decoration: underline;
    text-decoration-color: rgba(14,165,233,0.4);
    text-underline-offset: 2px;
  }
  .msg-link:hover {
    color: var(--gold);
    text-decoration-color: rgba(103,232,249,0.6);
  }
  .msg-link:hover::after {
    content: ' ↗';
    font-size: 10px;
    opacity: 0.6;
    vertical-align: super;
  }
  .msg-link--masked { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .msg-link--masked:hover { color: var(--gold); }

  .msg-blockquote {
    border-left: 3px solid var(--accent-border);
    padding: 6px 10px 6px 12px;
    margin: 6px 0;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-elevated) 34%, transparent);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .msg-blockquote--multi { display: block; }

  .msg-action { font-size: 15px; line-height: 1.55; color: var(--text-secondary); font-style: italic; }
  .msg-action-nick { font-weight: 600; font-style: normal; color: var(--accent); }

  /* Image embeds */
  .msg-embeds { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .msg-embeds--sole { margin-top: 5px; }

  /* Inline image wrapper (inside .msg-text flow) */
  .msg-img-inline-wrap { display: block; margin-top: 8px; }

  /* Reactions */
  .msg-reactions {
    display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
  }
  .reaction-pill {
    display: flex; align-items: center; gap: 5px;
    padding: 2px 9px; border-radius: var(--r-full);
    background: var(--bg-elevated); border: 1px solid var(--border-subtle);
    cursor: pointer; font-size: 13px; color: var(--text-secondary);
    transition: filter var(--t-fast);
    font-family: inherit;
  }
  .reaction-pill:hover {
    border-color: var(--accent-border);
    background: var(--bg-float);
    filter: brightness(1.1);
  }
  .reaction-pill--active {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    color: var(--accent);
  }
  .reaction-pill--active:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .reaction-pill--add { color: var(--text-muted); font-size: 16px; line-height: 1; padding: 2px 6px; }
  .reaction-count { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* Hover actions */
  .msg-actions {
    position: absolute; top: -5px; right: 12px;
    display: flex; align-items: center; gap: 2px;
    background: color-mix(in srgb, var(--bg-overlay) 88%, transparent);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-md);
    padding: 3px 5px;
    opacity: 0; transition: opacity var(--t-fast);
    z-index: 20;
    box-shadow: var(--shadow-lg), 0 0 18px var(--accent-glow);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .msg-item:hover .msg-actions { opacity: 1; }

  /* Smooth slide + scale in for the actions bar on hover */
  .msg-actions-bar {
    opacity: 0;
    transform: translateY(-5px) scale(0.96);
    transform-origin: top right;
    transition: opacity var(--t-fast) var(--ease-out), transform var(--t-normal) var(--ease-spring);
  }
  .msg-item:hover .msg-actions-bar {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  @media (prefers-reduced-motion: reduce) {
    .msg-actions-bar {
      transition: opacity 120ms ease;
      transform: none !important;
    }
  }

  .action-btn {
    width: 28px; height: 28px;
    border: none; background: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted); border-radius: var(--r-xs);
    transition: opacity var(--t-fast), transform var(--t-fast) var(--ease-out);
  }
  .action-btn:hover { background: var(--bg-float); color: var(--text-primary); transform: translateY(-1px); }
  .action-btn:active { transform: translateY(0); opacity: 0.78; }
  .action-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .action-btn--edit:hover  { color: var(--accent); }
  .action-btn--delete:hover { color: var(--danger, #ef4444); }
  .action-btn--pinned { color: var(--gold); }
  .action-btn--pinned:hover { color: var(--gold); background: rgba(232,184,75,0.12); }
  .action-btn--bookmarked { color: var(--gold); }
  .action-btn--bookmarked:hover { color: var(--gold); background: rgba(232,184,75,0.12); }
  .action-btn--suppressed { color: var(--text-muted); opacity: 0.7; }
  .action-btn--suppressed:hover { color: var(--accent); opacity: 1; background: rgba(14,165,233,0.12); }

  /* Thread reply link */
  .msg-thread-link {
    display: inline-flex; align-items: center; gap: 5px;
    margin-top: 4px;
    padding: 3px 8px 3px 4px;
    border: none; background: none; cursor: pointer;
    font-size: 12px; font-weight: 600;
    color: var(--accent);
    border-radius: var(--r-xs);
  }
  .msg-thread-link:hover { background: var(--accent-subtle); }

  /* Thread preview badge */
  .thread-preview-badge {
    display: flex; align-items: center; gap: 6px;
    margin-top: 4px; padding: 3px 8px;
    font-size: 12px; font-weight: 600; color: var(--accent);
    cursor: pointer; border-radius: 6px;
    width: fit-content;
    position: relative;
  }
  .thread-preview-badge:hover { background: var(--bg-elevated); }
  .thread-unread-dot { color: var(--gold); font-size: 16px; line-height: 1; }
  .thread-arrow { color: var(--text-muted); }
  .thread-badge-archived { font-size: 11px; opacity: 0.7; }
  .thread-badge-active-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #22c55e; display: inline-block; margin-left: 2px;
    flex-shrink: 0;
  }

  /* Thread preview popover */
  .thread-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 200;
    width: 240px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-normal);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.45);
    padding: 8px;
    display: flex; flex-direction: column; gap: 6px;
    pointer-events: none;
  }
  .thread-popover-row {
    display: flex; align-items: flex-start; gap: 6px;
  }
  .thread-popover-nick {
    font-size: 11px; font-weight: 700; white-space: nowrap; flex-shrink: 0;
  }
  .thread-popover-text {
    font-size: 11px; color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* Emoji picker */
  .picker-anchor { position: relative; }

  /* Jump-to-message highlight */
  .msg-jump-highlight {
    animation: jump-flash 1.5s ease;
  }
  @keyframes jump-flash {
    0%, 100% { filter: brightness(1); }
    15% { filter: brightness(1.35); }
    85% { filter: brightness(1.16); }
  }
`;

const eventStyles = `
  /* Base event row */
  .msg-event {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 2px 16px;
    min-height: 20px;
    font-size: 11px;
    font-style: italic;
    color: var(--text-muted);
    border-left: 2px solid transparent;
    line-height: 1.4;
    opacity: 0.85;
  }
  .msg-event:hover { background: rgba(14,165,233,0.025); opacity: 1; }

  /* Icon dot */
  .msg-event-dot {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    opacity: 0.8;
  }

  /* Body text */
  .msg-event-body {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-event-nick {
    font-weight: 700;
    font-style: normal;
    color: var(--text-secondary);
  }
  .msg-event-action {
    color: var(--text-muted);
  }
  .msg-event-reason {
    color: var(--text-muted);
    opacity: 0.65;
    font-style: italic;
  }

  /* Timestamp */
  .msg-event-time {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--t-fast);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .msg-event:hover .msg-event-time { opacity: 0.6; }

  /* Join — green accent */
  .msg-event--join {
    border-left-color: rgba(52,211,153,0.35);
  }
  .msg-event--join .msg-event-dot {
    color: var(--status-online);
    border-color: rgba(52,211,153,0.3);
    background: rgba(52,211,153,0.08);
  }
  .msg-event--join .msg-event-nick { color: var(--status-online); }

  /* Part — muted red */
  .msg-event--part {
    border-left-color: rgba(248,113,113,0.2);
  }
  .msg-event--part .msg-event-dot {
    color: rgba(248,113,113,0.7);
    border-color: rgba(248,113,113,0.2);
    background: rgba(248,113,113,0.06);
  }

  /* Quit — muted similar to part */
  .msg-event--quit {
    border-left-color: rgba(248,113,113,0.15);
  }
  .msg-event--quit .msg-event-dot {
    color: rgba(248,113,113,0.5);
    border-color: rgba(248,113,113,0.15);
    background: rgba(248,113,113,0.05);
  }

  /* Kick — orange */
  .msg-event--kick {
    border-left-color: rgba(251,146,60,0.3);
  }
  .msg-event--kick .msg-event-dot {
    color: #fb923c;
    border-color: rgba(251,146,60,0.25);
    background: rgba(251,146,60,0.08);
  }
  .msg-event--kick .msg-event-nick { color: #fb923c; }

  /* Mode — blue accent */
  .msg-event--mode {
    border-left-color: rgba(14,165,233,0.2);
  }
  .msg-event--mode .msg-event-dot {
    color: var(--accent);
    border-color: var(--accent-border);
    background: var(--accent-subtle);
  }
  .msg-event--mode .msg-event-nick { color: var(--accent); }

  /* Nick change — gold */
  .msg-event--nick {
    border-left-color: rgba(103,232,249,0.2);
  }
  .msg-event--nick .msg-event-dot {
    color: var(--gold);
    border-color: rgba(103,232,249,0.2);
    background: rgba(103,232,249,0.06);
  }
  .msg-event--nick .msg-event-nick { color: var(--gold); }

  /* Info — default muted */
  .msg-event--info {
    border-left-color: transparent;
  }
  .msg-event--info .msg-event-dot {
    color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .msg-event-time {
      transition: none !important;
    }
  }
`;

const nickChangeStyles = `
  .msg-nick-change {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 16px;
    font-size: 12px;
    color: var(--text-muted);
    border-left: 2px solid transparent;
  }
  .msg-nick-change:hover { background: rgba(14,165,233,0.025); }
  .msg-nick-change-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(103,232,249,0.08);
    border: 1px solid rgba(103,232,249,0.15);
    color: var(--gold);
    opacity: 0.85;
  }
  .msg-nick-change-old { color: var(--text-secondary); }
  .msg-nick-change-arrow { color: var(--text-muted); }
  .msg-nick-change-new { color: var(--accent); font-weight: 600; }
  .msg-nick-change-time {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--t-fast);
  }
  .msg-nick-change:hover .msg-nick-change-time { opacity: 0.6; }

  @media (prefers-reduced-motion: reduce) {
    .msg-nick-change-time {
      transition: none !important;
    }
  }
`;

const noticeStyles = `
  .msg-notice {
    display: flex; align-items: baseline; gap: 8px;
    padding: 3px 16px; font-size: 14px;
    background: rgba(103,232,249,0.04);
    border-left: 2px solid var(--gold);
  }
  .msg-notice-prefix { font-weight: 600; color: var(--gold); flex-shrink: 0; }
`;

const whisperStyles = `
  .msg-whisper {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 8px 16px; margin: 2px 0;
    background: linear-gradient(90deg, rgba(14,165,233,0.06) 0%, transparent 100%);
    border-left: 2px solid var(--accent);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
    font-size: 14px;
  }
  .msg-whisper-icon { flex-shrink: 0; font-size: 16px; margin-top: 1px; }
  .msg-whisper-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .msg-whisper-label { font-size: 12px; color: var(--accent); font-weight: 500; }
  .msg-whisper-text { color: var(--text-primary); }
`;

const codeBlockStyles = `
  .msg-code-block {
    margin: 9px 0;
    border-radius: var(--r-lg);
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    overflow: hidden;
    max-width: 100%;
    font-size: 13px;
    box-shadow: var(--shadow-md);
  }

  .msg-code-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 6px 12px;
    background: color-mix(in srgb, var(--bg-elevated) 62%, transparent);
    border-bottom: 1px solid var(--border-subtle);
    min-height: 31px;
  }

  .msg-code-lang {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--gold);
    text-transform: lowercase;
    letter-spacing: 0;
    flex: 1;
  }

  .msg-code-copy {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-xs);
    padding: 1px 8px;
    cursor: pointer;
    transition: opacity var(--t-fast);
    white-space: nowrap;
    opacity: 0.4;
  }
  .msg-code-block:hover .msg-code-copy {
    opacity: 1;
  }
  .msg-code-copy:hover {
    color: var(--accent);
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    opacity: 1;
  }

  .msg-code-pre {
    margin: 0;
    padding: 11px 0;
    overflow-x: auto;
    background: transparent;
    scrollbar-width: thin;
    scrollbar-color: var(--border-normal) transparent;
  }
  .msg-code-pre::-webkit-scrollbar { height: 6px; }
  .msg-code-pre::-webkit-scrollbar-track { background: transparent; }
  .msg-code-pre::-webkit-scrollbar-thumb { background: var(--border-normal); border-radius: 3px; }

  .msg-code-table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.58;
  }

  .msg-code-row { vertical-align: top; }

  .msg-code-lineno {
    padding: 0 12px 0 14px;
    color: var(--text-muted);
    user-select: none;
    text-align: right;
    min-width: 2.5em;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid var(--border-subtle);
    opacity: 0.6;
  }

  .msg-code-line {
    padding: 0 14px;
    color: var(--text-primary);
    white-space: pre;
  }

  /* Syntax highlighting tokens */
  .tok-kw  { color: #c678dd; }
  .tok-str { color: #98c379; }
  .tok-cmt { color: #5c6370; font-style: italic; }
  .tok-num { color: #d19a66; }
  .tok-typ { color: #e5c07b; }
  .tok-op  { color: #56b6c2; }

  /* Highlight token aliases (hl-* mirror tok-* for cross-component use) */
  .hl-kw      { color: #7c9fff; font-weight: 600; }
  .hl-str     { color: #98d97e; }
  .hl-comment { color: #6a737d; font-style: italic; }
  .hl-num     { color: #e8b84b; }
  [data-theme="onyx"] .hl-kw { color: #79b8ff; }

  /* Block-level markdown */
  .msg-h1 { font-size: 1.5em; font-weight: 700; line-height: 1.2; margin: 4px 0 2px; color: var(--text-primary); }
  .msg-h2 { font-size: 1.25em; font-weight: 600; line-height: 1.3; margin: 4px 0 2px; color: var(--text-primary); }
  .msg-h3 { font-size: 1.05em; font-weight: 600; line-height: 1.4; margin: 4px 0 2px; color: var(--text-primary); }
  .msg-subtext { font-size: 11px; color: var(--text-muted); line-height: 1.3; display: block; margin-top: 2px; }
  .msg-blockquote {
    border-left: 3px solid var(--accent-border);
    padding: 6px 10px 6px 12px;
    margin: 6px 0;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-elevated) 34%, transparent);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .msg-blockquote--multi { display: block; }
  .msg-list {
    margin: 4px 0 4px 20px;
    padding: 0;
    color: var(--text-primary);
  }
  .msg-list li { margin: 2px 0; }
  .msg-list--ordered { list-style-type: decimal; }

  .msg-spoiler {
    background: var(--text-primary);
    color: transparent;
    border-radius: 3px;
    padding: 0 2px;
    cursor: pointer;
    user-select: none;
    filter: blur(4px);
    transition: filter var(--t-fast);
  }
  .msg-spoiler.revealed,
  .msg-spoiler:focus {
    background: rgba(255,255,255,0.1);
    color: inherit;
    filter: blur(0);
  }

  .msg-table {
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 0.9em;
    max-width: 100%;
    overflow-x: auto;
    display: block;
  }
  .msg-th, .msg-td {
    border: 1px solid var(--border-subtle);
    padding: 4px 10px;
    text-align: left;
  }
  .msg-th {
    background: rgba(255,255,255,0.05);
    font-weight: 600;
  }
  .msg-tr:nth-child(even) .msg-td {
    background: rgba(255,255,255,0.02);
  }

  @media (prefers-reduced-motion: reduce) {
    .msg-code-copy,
    .msg-spoiler {
      transition: none !important;
      filter: none !important;
    }
  }
`;

const imageStyles = `
  .msg-img-anchor {
    display: inline-block;
    text-decoration: none;
    border-radius: var(--r-md);
    overflow: hidden;
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    box-shadow: var(--shadow-sm);
    transition: opacity var(--t-fast), filter var(--t-fast);
    cursor: pointer;
  }
  .msg-img-anchor:hover { opacity: 0.94; filter: brightness(1.06); }
  .msg-img-anchor--full { display: block; }

  .msg-img-placeholder {
    width: 300px;
    max-width: 100%;
    height: 180px;
    background: var(--bg-elevated);
    border-radius: var(--r-md);
    animation: img-shimmer 1.4s ease-in-out infinite;
  }

  @keyframes img-shimmer {
    0%, 100% { opacity: 0.68; filter: brightness(1); }
    50% { opacity: 1; filter: brightness(1.12); }
  }

  .msg-embed-img {
    display: block;
    max-width: min(400px, 100%);
    max-height: 300px;
    border-radius: calc(var(--r-md) - 1px);
    object-fit: contain;
    background: var(--bg-elevated);
    opacity: 0;
    transition: opacity var(--t-normal);
  }
  .msg-embed-img--full {
    max-width: 100%;
    max-height: 360px;
  }
  .msg-embed-img--loaded { opacity: 1; }

  @media (prefers-reduced-motion: reduce) {
    .msg-img-anchor,
    .msg-embed-img {
      transition: none !important;
      filter: none !important;
    }
    .msg-img-placeholder {
      animation: none !important;
      opacity: 0.86;
      filter: none !important;
    }
  }
`;

const spoilerStyles = `
  .msg-spoiler {
    display: inline-flex;
    align-items: center;
    background: var(--bg-overlay);
    border-radius: var(--r-sm);
    padding: 1px 8px;
    cursor: pointer;
    user-select: none;
    color: transparent;
    filter: blur(4px);
    transition: filter var(--t-normal), opacity var(--t-normal);
    border: 1px solid var(--accent-border);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }
  .msg-spoiler:hover:not(.msg-spoiler--revealed) {
    background: var(--bg-overlay);
    filter: blur(3px);
  }
  .msg-spoiler:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .msg-spoiler--revealed {
    color: var(--text-primary);
    background: rgba(14,165,233,0.06);
    border-color: var(--accent-border);
    filter: blur(0);
    box-shadow: none;
  }
  .msg-spoiler-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0;
    text-transform: uppercase;
    filter: blur(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .msg-spoiler {
      transition: none !important;
      filter: none !important;
    }
  }
`;

const collapsedStyles = `
  .msg-collapsed {
    display: flex; align-items: center; gap: 8px;
    padding: 2px 16px;
    font-size: 11px; color: var(--text-muted);
  }
  .msg-collapsed-nick { font-weight: 600; color: var(--text-secondary); }
  .msg-collapsed-show {
    font-size: 10px; color: var(--accent); background: none; border: none;
    cursor: pointer; font-family: inherit; padding: 0;
  }
  .msg-collapsed-show:hover { text-decoration: underline; }
`;

const hiddenMsgStyles = `
  .msg-hidden-wrap {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 8px; margin: 1px 0;
    border-radius: 4px;
    opacity: 0.5;
    cursor: default;
  }
  .msg-hidden-wrap:hover { opacity: 0.8; }
  .msg-hidden-icon { font-size: 13px; filter: grayscale(1); }
  .msg-hidden-text { font-size: 13px; color: var(--text-muted); font-style: italic; }
  .msg-hidden-text strong { color: var(--text-secondary); font-style: normal; }
  .msg-hidden-reveal {
    margin-left: auto; font-size: 12px; color: var(--accent);
    background: none; border: none; cursor: pointer; padding: 2px 6px;
    border-radius: 4px;
  }
  .msg-hidden-reveal:hover { background: rgba(14,165,233,0.1); }
`;

const collapsibleStyles = `
  .collapsible-wrap { position: relative; }

  .collapsible-body--collapsed {
    max-height: 220px;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
    mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
  }

  .collapsible-body--expanded { max-height: none; overflow: visible; }

  .collapsible-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent, #0ea5e9);
    cursor: pointer;
    border: 1px solid var(--accent-border, rgba(14,165,233,0.28));
    background: var(--accent-subtle, rgba(14,165,233,0.08));
    padding: 3px 9px 3px 7px;
    border-radius: var(--r-full, 9999px);
    font-family: inherit;
    margin-top: 6px;
  }
  .collapsible-toggle:hover {
    background: rgba(14,165,233,0.14);
    border-color: var(--accent, #0ea5e9);
  }
  .collapsible-chevron {
    flex-shrink: 0;
    opacity: 0.8;
  }
`;

// ── Icons ──────────────────────────────────────────────────────────────────────

const EmojiAddIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <path d="M7.5 0a7.5 7.5 0 1 0 0 15A7.5 7.5 0 0 0 7.5 0zm0 14a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zm-2.5-7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 9.5c0-.28.22-.5.5-.5h4a.5.5 0 0 1 .38.83A3 3 0 0 1 7.5 11a3 3 0 0 1-2.38-1.17A.5.5 0 0 1 5 9.5z"/>
  </svg>
);

const ReplyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <path d="M6.5 2L1 6.5 6.5 11V8C10 8 12.5 9.5 14 13c0-7-7.5-7-7.5-7V2z"/>
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M9.95.95a1.5 1.5 0 0 1 2.1 2.1L4.5 10.6l-2.8.7.7-2.8L9.95.95zM2 12h10v1H2v-1z"/>
  </svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M5 1h4v1h3v1H2V2h3V1zm1 0v1h2V1H6zM3 4h8l-.8 8H3.8L3 4zm2 1v6h1V5H5zm3 0v6h1V5H8z"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <circle cx="3" cy="7.5" r="1.25"/>
    <circle cx="7.5" cy="7.5" r="1.25"/>
    <circle cx="12" cy="7.5" r="1.25"/>
  </svg>
);

const MsgPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
    <path d="M9.5 1a.5.5 0 0 1 .354.146l4 4a.5.5 0 0 1-.122.805L10.25 7.5l-.25 1.5-3 3-1.5-.5L4 13l-2-2 1.5-1.5-.5-1.5 3-3 1.5-.25 2.005-3.364A.5.5 0 0 1 9.5 1zM9.5 2.207 7.617 5.39a.5.5 0 0 1-.26.213L5.947 6.03l-.37 2.22-2.537 2.537.963.963 2.537-2.537 2.22-.37.427-1.41a.5.5 0 0 1 .213-.26L12.793 5.5 9.5 2.207z"/>
  </svg>
);

const ThreadBubbleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
    <path d="M7.5 1C3.91 1 1 3.6 1 6.75c0 1.7.8 3.23 2.1 4.3L2.5 14l3.2-1.55A7.2 7.2 0 0 0 7.5 12.5C11.09 12.5 14 9.9 14 6.75S11.09 1 7.5 1zm0 1C10.54 2 13 4.14 13 6.75S10.54 11.5 7.5 11.5c-.7 0-1.37-.12-1.98-.34L5.2 11l-1.7.82.42-1.66-.3-.22A5.13 5.13 0 0 1 2 6.75C2 4.14 4.46 2 7.5 2z"/>
  </svg>
);

const ForwardIcon = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.5 3.5L14 7.5l-5.5 4V9C5 9 3 10.5 2 13c0-5.5 3.5-7 6.5-7V3.5z"/>
  </svg>
);

const BookmarkIcon = ({ filled }: { filled: boolean }) =>
  filled ? (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
      <path d="M2 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.777.416L7 10.101l-4.223 2.815A.5.5 0 0 1 2 12.5V2z"/>
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
      <path d="M2 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.777.416L7 10.101l-4.223 2.815A.5.5 0 0 1 2 12.5V2zm1 0v9.566l3.723-2.482a.5.5 0 0 1 .554 0L11 11.566V2H3z"/>
    </svg>
  );

const EmbedToggleIcon = ({ suppressed }: { suppressed: boolean }) =>
  suppressed ? (
    /* eye icon — click to show embed */
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 3C4.5 3 1.5 5.5 1 8c.5 2.5 3.5 5 7 5s6.5-2.5 7-5c-.5-2.5-3.5-5-7-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
    </svg>
  ) : (
    /* eye-slash icon — click to hide embed */
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M2.22 2.22a.75.75 0 0 0 0 1.06L4.54 5.6C3.1 6.53 1.9 7.84 1 8c.9 1.16 2.42 2.6 4.29 3.44l-1.51 1.51a.75.75 0 1 0 1.06 1.06l9-9a.75.75 0 0 0-1.06-1.06L11.36 5.4A9.57 9.57 0 0 0 8 5c-1.6 0-3.11.43-4.36 1.08L2.22 2.22zM8 5c.8 0 1.56.14 2.26.38L9.1 6.54A2.5 2.5 0 0 0 6.54 9.1L5.22 10.42A6.7 6.7 0 0 1 2.25 8C2.93 6.8 5.1 5 8 5zm5.75 3c-.68 1.2-2.85 3-5.75 3-.5 0-.97-.06-1.43-.16l1.14-1.14A2.5 2.5 0 0 0 10.86 7.3l1.14-1.14c.96.46 1.8 1.08 2.5 1.84z"/>
    </svg>
  );
