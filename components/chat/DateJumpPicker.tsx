'use client';

import { useEffect, useRef, useState } from 'react';

interface DateJumpPickerProps {
  onJump: (date: Date) => void;
}

export default function DateJumpPicker({ onJump }: DateJumpPickerProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef  = useRef<HTMLButtonElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  const handleOpen = () => {
    setOpen(v => !v);
  };

  const handleGo = () => {
    if (!value) return;
    const date = new Date(`${value}T00:00:00Z`);
    if (!isNaN(date.getTime())) {
      onJump(date);
      setOpen(false);
      setValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleGo();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="djp-wrap">
      <button
        ref={buttonRef}
        className={`ch-head-btn djp-btn${open ? ' ch-head-btn--active' : ''}`}
        aria-label="Jump to date"
        aria-expanded={open}
        onClick={handleOpen}
        type="button"
      >
        <CalendarIcon />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="djp-popover"
          role="dialog"
          aria-label="Jump to date"
        >
          <p className="djp-label">Jump to date</p>
          <div className="djp-row">
            <input
              ref={inputRef}
              className="djp-input"
              type="date"
              value={value}
              max={today}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Select date"
            />
            <button
              className="djp-go"
              onClick={handleGo}
              disabled={!value}
              type="button"
            >
              Go
            </button>
          </div>
        </div>
      )}

      <style>{`
        .djp-wrap {
          position: relative;
        }

        .djp-btn {
          /* inherits .ch-head-btn styles */
        }

        .djp-popover {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          width: 210px;
          background: var(--bg-float, #1e1e2e);
          border: 1px solid var(--border-normal, rgba(255,255,255,0.1));
          border-radius: var(--r-md, 8px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          padding: 12px;
          z-index: 200;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .djp-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted, #4b4f6a);
          margin: 0;
        }

        .djp-row {
          display: flex;
          gap: 6px;
          align-items: stretch;
        }

        .djp-input {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          padding: 5px 8px;
          background: var(--bg-base, #13131f);
          color: var(--text-primary, #e4e4ef);
          border: 1px solid var(--border-normal, rgba(255,255,255,0.1));
          border-radius: var(--r-sm, 4px);
          outline: none;
          transition: border-color 150ms;
          color-scheme: dark;
        }
        .djp-input:focus {
          border-color: var(--accent, #7c5af5);
          box-shadow: 0 0 0 1px var(--accent-border, rgba(124,90,245,0.3));
        }

        .djp-go {
          flex-shrink: 0;
          font-size: 13px;
          font-weight: 600;
          padding: 5px 12px;
          background: var(--accent, #7c5af5);
          color: #fff;
          border: none;
          border-radius: var(--r-sm, 4px);
          cursor: pointer;
          transition: opacity 150ms;
        }
        .djp-go:hover:not(:disabled) {
          opacity: 0.85;
        }
        .djp-go:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M5 1v3M10 1v3M1.5 6.5h12" />
  </svg>
);
