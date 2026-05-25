'use client';

import { useEffect, useRef } from 'react';

export interface FormatToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onFormat: (before: string, after: string) => void;
  visible: boolean;
}

// ── Button definitions ─────────────────────────────────────────────────────────

interface FmtButton {
  label: string;
  title: string;
  before: string;
  after: string;
  mono?: boolean;
}

const BUTTONS: FmtButton[] = [
  { label: 'B',   title: 'Bold (IRC)',        before: '\x02',   after: '\x02',   mono: false },
  { label: 'I',   title: 'Italic (IRC)',       before: '\x1d',   after: '\x1d',   mono: false },
  { label: 'U̲',   title: 'Underline (IRC)',    before: '\x1f',   after: '\x1f',   mono: false },
  { label: '<>',  title: 'Inline code',        before: '`',      after: '`',      mono: true  },
  { label: '</>', title: 'Code block',         before: '```\n',  after: '\n```',  mono: true  },
  { label: '||',  title: 'Spoiler',            before: '||',     after: '||',     mono: true  },
  { label: '~~',  title: 'Strikethrough',      before: '~~',     after: '~~',     mono: true  },
  { label: '> ',  title: 'Blockquote (line)',  before: '> ',     after: '',       mono: true  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function FormatToolbar({ textareaRef, onFormat, visible }: FormatToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Animate in/out via data attribute
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (visible) {
      el.removeAttribute('data-hidden');
    } else {
      el.setAttribute('data-hidden', '');
    }
  }, [visible]);

  const handleClick = (btn: FmtButton) => {
    onFormat(btn.before, btn.after);
  };

  return (
    <div
      ref={containerRef}
      className="fmt-toolbar"
      aria-label="Text formatting toolbar"
      aria-hidden={!visible}
      data-hidden={visible ? undefined : ''}
    >
      {BUTTONS.map((btn) => (
        <button
          key={btn.title}
          className={`fmt-toolbar-btn${btn.mono ? ' fmt-toolbar-btn--mono' : ''}`}
          title={btn.title}
          aria-label={btn.title}
          tabIndex={visible ? 0 : -1}
          onMouseDown={(e) => {
            // Prevent textarea from losing focus
            e.preventDefault();
            handleClick(btn);
          }}
        >
          {btn.label}
        </button>
      ))}

      <style>{`
        .fmt-toolbar {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 36px;
          padding: 0 6px;
          opacity: 1;
          transform: translateY(0);
          transition: opacity 150ms ease, transform 150ms ease;
          pointer-events: auto;
        }
        .fmt-toolbar[data-hidden] {
          opacity: 0;
          transform: translateY(4px);
          pointer-events: none;
        }
        .fmt-toolbar-btn {
          width: 28px;
          height: 28px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
          transition: color var(--t-fast), background var(--t-fast), border-color var(--t-fast);
          line-height: 1;
          padding: 0;
        }
        .fmt-toolbar-btn--mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          font-weight: 500;
        }
        .fmt-toolbar-btn:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
          border-color: var(--border-muted);
        }
        .fmt-toolbar-btn:active {
          background: var(--accent-subtle);
          color: var(--accent);
          border-color: var(--accent-border);
        }
        @media (max-width: 480px) {
          .fmt-toolbar { display: none; }
        }
      `}</style>
    </div>
  );
}
