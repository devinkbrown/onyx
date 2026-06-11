'use client';

import { useCallback, useState } from 'react';
import { hasIrcFormatting, parseIrcFormatting } from '@/lib/ircColors';

interface Props {
  text: string;
  className?: string;
}

type IrcSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; lang: string; code: string };

const CODE_FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

function splitCodeFences(text: string): IrcSegment[] {
  const segments: IrcSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  CODE_FENCE_RE.lastIndex = 0;

  while ((match = CODE_FENCE_RE.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'text', content: text.slice(last, match.index) });
    }
    segments.push({
      type: 'code',
      lang: match[1].trim() || 'text',
      code: match[2].replace(/\n$/, ''),
    });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    segments.push({ type: 'text', content: text.slice(last) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

function IrcCodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard support is best-effort.
    }
  }, [code]);

  return (
    <span className="irc-code-block">
      <span className="irc-code-head">
        <span className="irc-code-lang">{lang}</span>
        <button type="button" className="irc-code-copy" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
      </span>
      <code className="irc-code-body">{code || ' '}</code>
    </span>
  );
}

function IrcFormattedText({ text, className }: Props) {
  if (!hasIrcFormatting(text)) {
    return <span className={className}>{text}</span>;
  }

  const spans = parseIrcFormatting(text);

  return (
    <span className={className}>
      {spans.map((span, i) => {
        const decorations = [
          span.underline ? 'underline' : '',
          span.strike ? 'line-through' : '',
        ].filter(Boolean).join(' ');

        return (
          <span
            key={i}
            style={{
              fontWeight: span.bold ? 'bold' : undefined,
              fontStyle: span.italic ? 'italic' : undefined,
              textDecoration: decorations || undefined,
              fontFamily: span.monospace ? 'var(--font-mono)' : undefined,
              color: span.fg ?? undefined,
              background: span.bg ? span.bg : undefined,
              padding: span.bg ? '0 2px' : undefined,
            }}
          >
            {span.text}
          </span>
        );
      })}
    </span>
  );
}

export default function IrcText({ text, className }: Props) {
  const segments = splitCodeFences(text);

  return (
    <span className={className}>
      {segments.map((segment, index) => (
        segment.type === 'code'
          ? <IrcCodeBlock key={index} lang={segment.lang} code={segment.code} />
          : <IrcFormattedText key={index} text={segment.content} />
      ))}
      <style>{`
        .irc-code-block {
          display: block;
          margin: var(--sp-2, 8px) 0;
          border: 1px solid var(--border-normal, rgba(255,255,255,.1));
          border-radius: var(--r-md, 8px);
          background: var(--bg-deep, #07111d);
          overflow: hidden;
          max-width: 100%;
        }
        .irc-code-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--sp-2, 8px);
          padding: 6px var(--sp-3, 12px);
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,.08));
          background: color-mix(in srgb, var(--bg-elevated, #132131) 62%, transparent);
        }
        .irc-code-lang,
        .irc-code-copy,
        .irc-code-body {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .irc-code-lang {
          color: var(--lux, #d8b96a);
          font-size: var(--text-2xs, .6875rem);
          border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 28%, transparent);
          border-radius: var(--r-xs, 4px);
          padding: 1px 7px;
          line-height: 1.5;
        }
        .irc-code-copy {
          color: var(--text-muted, #7aa8c4);
          background: none;
          border: 1px solid var(--border-subtle, rgba(255,255,255,.08));
          border-radius: var(--r-xs, 4px);
          cursor: pointer;
          font-size: var(--text-2xs, .6875rem);
          font-weight: 700;
          padding: 1px 8px;
        }
        .irc-code-copy:hover {
          color: var(--lux, #d8b96a);
          border-color: color-mix(in srgb, var(--lux, #d8b96a) 42%, transparent);
          background: color-mix(in srgb, var(--lux, #d8b96a) 9%, transparent);
        }
        .irc-code-body {
          display: block;
          padding: var(--sp-3, 12px);
          color: var(--text-primary, #dce8f4);
          font-size: var(--text-sm, .8125rem);
          line-height: 1.55;
          white-space: pre;
          overflow-x: auto;
        }
        @media (prefers-reduced-motion: reduce) {
          .irc-code-copy { transition: none !important; }
        }
      `}</style>
    </span>
  );
}
