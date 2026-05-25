'use client';

import { hasIrcFormatting, parseIrcFormatting } from '@/lib/ircColors';

interface Props {
  text: string;
  className?: string;
}

export default function IrcText({ text, className }: Props) {
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
