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
          top: calc(100% + 8px);
          right: 0;
          width: 224px;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.65)), 0 0 0 1px var(--border-subtle);
          padding: 14px;
          z-index: 200;
          display: flex;
          flex-direction: column;
          gap: 10px;
          animation: djp-in 140ms var(--ease-out, ease) both;
        }
        @keyframes djp-in {
          from { opacity: 0; transform: translateY(-4px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);     }
        }

        .djp-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }

        .djp-row {
          display: flex;
          gap: 7px;
          align-items: stretch;
        }

        .djp-input {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          height: 34px;
          padding: 0 10px;
          background: var(--bg-deep);
          color: var(--text-primary);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          outline: none;
          transition: border-color var(--t-fast, 150ms) ease, box-shadow var(--t-fast, 150ms) ease;
          color-scheme: dark;
          font-family: inherit;
        }
        .djp-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }

        .djp-go {
          flex-shrink: 0;
          font-size: 13px;
          font-weight: 600;
          padding: 0 14px;
          height: 34px;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: var(--r-sm);
          cursor: pointer;
          font-family: inherit;
          transition: opacity var(--t-fast, 150ms) ease, box-shadow var(--t-fast, 150ms) ease;
        }
        .djp-go:hover:not(:disabled) {
          opacity: 0.88;
          box-shadow: 0 0 0 3px var(--accent-subtle);
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
