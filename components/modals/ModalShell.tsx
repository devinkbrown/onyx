'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';
export type ModalVariant = 'center' | 'sheet';

export interface ModalShellProps {
  /** Called after the exit animation finishes (or immediately under reduced motion). */
  onClose: () => void;
  /** Title rendered in the header with the display face. */
  title?: ReactNode;
  /** Optional caps kicker rendered above the title. */
  kicker?: ReactNode;
  /** id applied to the title node and referenced by aria-labelledby. */
  titleId?: string;
  size?: ModalSize;
  /** 'center' (default) floats a card; 'sheet' docks a full-height panel to the right edge. */
  variant?: ModalVariant;
  /** Destructive confirms: paints a danger left-edge bar on the surface. */
  danger?: boolean;
  /** Extra content rendered in the header row, between title and close button. */
  headerExtra?: ReactNode;
  /** Right-aligned action row. Omit to render no footer. */
  footer?: ReactNode;
  children: ReactNode;
  /** Remove default body padding (panels that manage their own layout). */
  flushBody?: boolean;
  /** Allow clicking the scrim to close (default true). */
  closeOnScrim?: boolean;
  /** Render the × close button (default true). */
  showClose?: boolean;
  closeLabel?: string;
  /** Extra class on the surface card for per-modal CSS hooks. */
  className?: string;
  /** data-testid applied to the surface card. */
  testId?: string;
  /** aria-label fallback when no titleId is supplied. */
  ariaLabel?: string;
  /** Focus the card itself instead of its first focusable child. */
  focusSelf?: boolean;
}

const EXIT_MS = 200;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The single lacquered overlay primitive for Ocean's modal fleet.
 *
 * Scrim + blur, elev-3 surface with inset top highlight, 320ms expo-out
 * entry / 200ms ease-in exit (transform + opacity only), focus trap,
 * Escape + scrim-click close, header / body / footer slots.
 */
export default function ModalShell({
  onClose,
  title,
  kicker,
  titleId,
  size = 'md',
  variant = 'center',
  danger = false,
  headerExtra,
  footer,
  children,
  flushBody = false,
  closeOnScrim = true,
  showClose = true,
  closeLabel = 'Close dialog',
  className,
  testId,
  ariaLabel,
  focusSelf = false,
}: ModalShellProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  useDialogFocus(cardRef, { focusSelf });
  useFocusTrap(cardRef, !focusSelf);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  // Escape closes from anywhere while the dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return (
    <div
      className={`mshell-overlay mshell-ov-${variant}${closing ? ' mshell-closing' : ''}`}
      onClick={e => {
        if (closeOnScrim && e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className={`mshell-card mshell-${variant} mshell-${size}${danger ? ' mshell-danger' : ''}${className ? ` ${className}` : ''}`}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : ariaLabel}
        tabIndex={-1}
        {...(testId ? { 'data-testid': testId } : {})}
      >
        {(title || kicker || headerExtra || showClose) && (
          <header className="mshell-header">
            <div className="mshell-heading">
              {kicker && <span className="mshell-kicker">{kicker}</span>}
              {title && (
                <h2 className="mshell-title" id={titleId}>
                  {title}
                </h2>
              )}
            </div>
            {headerExtra && <div className="mshell-header-extra">{headerExtra}</div>}
            {showClose && (
              <button
                type="button"
                className="mshell-close"
                onClick={requestClose}
                aria-label={closeLabel}
              >
                ×
              </button>
            )}
          </header>
        )}

        <div className={`mshell-body${flushBody ? ' mshell-body-flush' : ''}`}>{children}</div>

        {footer && <footer className="mshell-footer">{footer}</footer>}
      </div>

      <style>{`
        .mshell-overlay {
          position: fixed;
          inset: 0;
          z-index: var(--z-overlay, 200);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--sp-4, 16px);
          background: var(--scrim, rgba(2, 6, 12, 0.65));
          backdrop-filter: blur(var(--glass-blur, 12px));
          -webkit-backdrop-filter: blur(var(--glass-blur, 12px));
          animation: mshell-scrim-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
        }
        .mshell-overlay.mshell-closing {
          animation: mshell-scrim-out var(--t-overlay-out, 200ms) var(--ease-in, cubic-bezier(.7,0,.84,0)) both;
          pointer-events: none;
        }

        .mshell-card {
          position: relative;
          display: flex;
          flex-direction: column;
          background: var(--elev-tint-3, var(--bg-overlay));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-2xl, 20px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
                      var(--elev-shadow-3, 0 28px 80px rgba(0,0,0,.48));
          max-height: min(85vh, 860px);
          max-width: calc(100vw - var(--sp-8, 32px));
          overflow: hidden;
          outline: none;
          animation: mshell-card-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
        }
        .mshell-closing .mshell-card {
          animation: mshell-card-out var(--t-overlay-out, 200ms) var(--ease-in, cubic-bezier(.7,0,.84,0)) both;
        }

        .mshell-sm   { width: 420px; }
        .mshell-md   { width: 560px; }
        .mshell-lg   { width: 760px; }
        .mshell-full {
          width: calc(100vw - var(--sp-12, 48px));
          height: calc(100vh - var(--sp-12, 48px));
          max-height: none;
        }

        /* ── Sheet variant: full-height panel docked right ── */
        .mshell-ov-sheet {
          justify-content: flex-end;
          align-items: stretch;
          padding: 0;
        }
        .mshell-card.mshell-sheet {
          height: 100%;
          max-height: none;
          border-radius: var(--r-2xl, 20px) 0 0 var(--r-2xl, 20px);
          border-right: none;
          animation-name: mshell-sheet-in;
        }
        .mshell-closing .mshell-card.mshell-sheet {
          animation-name: mshell-sheet-out;
        }
        .mshell-sheet.mshell-sm   { width: 340px; }
        .mshell-sheet.mshell-md   { width: 420px; }
        .mshell-sheet.mshell-lg   { width: 560px; }
        .mshell-sheet.mshell-full { width: min(860px, 100vw); }
        @keyframes mshell-sheet-in {
          from { opacity: 0; transform: translateX(48px); }
        }
        @keyframes mshell-sheet-out {
          to { opacity: 0; transform: translateX(32px); }
        }

        .mshell-danger::before {
          content: '';
          position: absolute;
          left: 0;
          top: var(--sp-4, 16px);
          bottom: var(--sp-4, 16px);
          width: 3px;
          border-radius: 0 2px 2px 0;
          background: var(--danger, #f87171);
        }

        .mshell-header {
          display: flex;
          align-items: center;
          gap: var(--sp-3, 12px);
          padding: var(--sp-5, 20px) var(--sp-6, 24px) var(--sp-4, 16px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .mshell-heading {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--sp-1, 4px);
        }
        .mshell-kicker {
          font-size: var(--text-2xs, .6875rem);
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .mshell-title {
          margin: 0;
          font-family: var(--font-display, Georgia, serif);
          font-size: var(--text-xl, 1.25rem);
          font-weight: 600;
          line-height: 1.2;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mshell-header-extra {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          flex-shrink: 0;
        }

        .mshell-close {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: var(--r-md, 8px);
          background: none;
          color: var(--text-muted);
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          transition: color var(--t-control, 150ms), background var(--t-control, 150ms);
        }
        .mshell-close:hover {
          color: var(--text-primary);
          background: var(--elev-tint-1, var(--bg-elevated));
        }
        .mshell-close:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .mshell-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: var(--sp-4, 16px) var(--sp-6, 24px);
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .mshell-body::-webkit-scrollbar { width: 6px; }
        .mshell-body::-webkit-scrollbar-thumb {
          background: var(--border-normal);
          border-radius: 3px;
        }
        .mshell-body-flush { padding: 0; }

        /* Fleet-wide keyboard focus safety net.
           Many modals only restyle :focus border-color on their native fields,
           which leaves keyboard users without a clear focus ring. This gives
           every native form control inside a modal body a visible lacquer ring
           on keyboard focus. Components that paint their own ring (Button,
           FormField, custom controls with .mshell-no-ring) keep their own. */
        .mshell-body :is(input, select, textarea):focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .mshell-body .mshell-no-ring:focus-visible {
          outline: none;
        }

        .mshell-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--sp-3, 12px);
          padding: var(--sp-4, 16px) var(--sp-6, 24px);
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        /* NOTE: entry keyframes intentionally omit the "to" frame so the
           resting state has no transform — a filled identity transform would
           create a containing block and break fixed-position descendants
           (lightboxes, popovers) rendered inside modal bodies. */
        @keyframes mshell-scrim-in  { from { opacity: 0; } }
        @keyframes mshell-scrim-out { to { opacity: 0; } }
        @keyframes mshell-card-in {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
        }
        @keyframes mshell-card-out {
          to { opacity: 0; transform: translateY(8px) scale(0.98); }
        }

        @media (prefers-reduced-motion: reduce) {
          .mshell-overlay,
          .mshell-card,
          .mshell-closing .mshell-card {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
