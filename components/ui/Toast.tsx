'use client';

import { useEffect, useCallback, useState, type CSSProperties } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { Toast as ToastType, ToastVariant } from '@/lib/store';

// ── Default durations ─────────────────────────────────────────────────────────

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success:  3000,
  error:    8000,
  warning:  5000,
  info:     4000,
  mention:  6000,
  dm:       6000,
  join:     3000,
  undo:     6000,
};

// ── Accent colors ─────────────────────────────────────────────────────────────

const ACCENT: Record<ToastVariant, string> = {
  success: 'var(--success, #23a55a)',
  error:   'var(--danger, #f04747)',
  warning: 'var(--warning, #f0b232)',
  info:    'var(--info, var(--accent))',
  mention: 'var(--lux, #e8b84b)',
  dm:      'var(--accent)',
  join:    'var(--success, #23a55a)',
  undo:    'var(--text-secondary, #94a3b8)',
};

// ── Icons (inline SVG) ────────────────────────────────────────────────────────

function ToastIcon({ variant }: { variant: ToastVariant }) {
  // Strokes use currentColor so the semantic var() (set via style.color) resolves
  // correctly — var() is not valid in raw SVG presentation attributes.
  const style = { color: ACCENT[variant] };
  switch (variant) {
    case 'success':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'error':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6v5M10 14v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'warning':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <path d="M10 3L18 17H2L10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M10 8v4M10 14v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'info':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 9v5M10 6v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'mention':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M14 10a4 4 0 00-4-4 4 4 0 00-4 4 4 4 0 004 4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'dm':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <path d="M4 4h12a1 1 0 011 1v8a1 1 0 01-1 1H6l-3 3V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'join':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'undo':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={style} aria-hidden>
          <path d="M6 9H4V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 9a7 7 0 107-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

// ── Group collapsed display ───────────────────────────────────────────────────

interface GroupedToast {
  key: string;
  count: number;
  toasts: ToastType[];
}

function groupToasts(toasts: ToastType[]): Array<ToastType | GroupedToast> {
  const grouped: Array<ToastType | GroupedToast> = [];
  const groupMap = new Map<string, ToastType[]>();

  for (const t of toasts) {
    if (t.groupKey) {
      const existing = groupMap.get(t.groupKey);
      if (existing) {
        existing.push(t);
      } else {
        groupMap.set(t.groupKey, [t]);
      }
    } else {
      grouped.push(t);
    }
  }

  for (const [key, items] of groupMap) {
    if (items.length >= 3) {
      grouped.push({ key, count: items.length, toasts: items });
    } else {
      grouped.push(...items);
    }
  }

  return grouped;
}

// ── Individual toast card ─────────────────────────────────────────────────────

function ToastCard({
  toast,
  index,
  total,
  onDismiss,
}: {
  toast: ToastType;
  index: number;
  total: number;
  onDismiss: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const dismiss = useCallback(onDismiss, [onDismiss]);
  const duration = toast.duration ?? DEFAULT_DURATION[toast.variant];
  const accent = ACCENT[toast.variant];

  const handleDismiss = useCallback(() => {
    setIsDismissing(true);
    const t = setTimeout(dismiss, 200);
    return () => clearTimeout(t);
  }, [dismiss]);

  useEffect(() => {
    if (isHovered) return;
    const t = setTimeout(handleDismiss, duration);
    return () => clearTimeout(t);
  }, [toast.id, duration, isHovered, handleDismiss]);

  const isBack = index < total - 1;
  const isSecondFromTop = index === total - 2;

  return (
    <div
      className={`toast-card toast-card--${toast.variant}${isDismissing ? ' toast-card--out' : ''}${isBack ? ' toast-card--back' : ''}`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        '--toast-accent': accent,
        transform: isSecondFromTop ? 'scale(0.97)' : undefined,
        opacity: isBack && !isSecondFromTop ? 0.7 : undefined,
      } as unknown as CSSProperties}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="toast-left-border" style={{ background: accent }} />

      <div className="toast-content">
        <div className="toast-header">
          <span className="toast-icon">
            <ToastIcon variant={toast.variant} />
          </span>
          <span className="toast-title">{toast.title}</span>

          {toast.undoAction && (
            <button
              className="toast-undo"
              style={{ color: accent }}
              onClick={() => {
                toast.undoAction?.();
                handleDismiss();
              }}
            >
              Undo
            </button>
          )}

          <button
            className="toast-close"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {toast.description && (
          <p className="toast-description">{toast.description}</p>
        )}
      </div>

      <div
        className="toast-progress"
        style={{
          background: accent,
          animationDuration: `${duration}ms`,
          animationPlayState: isHovered ? 'paused' : 'running',
        }}
      />

      <style>{`
        .toast-card {
          position: relative;
          display: flex;
          flex-direction: column;
          width: 300px;
          background: var(--elev-tint-2, var(--bg-float));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 48px rgba(0,0,0,.38));
          overflow: hidden;
          pointer-events: all;
          animation: toast-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
          transition: transform var(--t-overlay-out, 200ms) var(--ease-in, cubic-bezier(.7,0,.84,0)),
                      opacity var(--t-overlay-out, 200ms) var(--ease-in, cubic-bezier(.7,0,.84,0)),
                      box-shadow var(--t-surface, 220ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
        }
        .toast-card:hover {
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-3, 0 28px 80px rgba(0,0,0,.48));
        }

        .toast-card--out {
          animation: toast-out 200ms cubic-bezier(0.7, 0, 0.84, 0) both;
        }

        .toast-left-border {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          border-radius: var(--r-sm, 6px) 0 0 var(--r-md, 8px);
          flex-shrink: 0;
        }

        .toast-content {
          padding: var(--sp-3, 12px) var(--sp-3, 12px) var(--sp-2, 8px) var(--sp-5, 20px);
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }

        .toast-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .toast-icon {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          opacity: 0.9;
        }

        .toast-title {
          flex: 1;
          font-size: var(--text-sm, 0.8125rem);
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
          letter-spacing: 0;
        }

        .toast-description {
          font-size: var(--text-xs, 0.75rem);
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 0 0 2px 28px;
          word-break: break-word;
        }

        .toast-undo {
          background: color-mix(in oklch, currentColor 12%, transparent);
          border: none;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: var(--r-xs, 4px) var(--r-sm, 6px) var(--r-xs, 4px) var(--r-md, 8px);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: opacity var(--t-control, 150ms), background var(--t-control, 150ms), transform var(--t-micro, 90ms);
          flex-shrink: 0;
        }
        .toast-undo:hover {
          opacity: 0.85;
          background: color-mix(in oklch, currentColor 20%, transparent);
        }
        .toast-undo:active { transform: translateY(0.5px); }
        .toast-undo:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }

        .toast-close {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          width: 20px;
          height: 20px;
          padding: 0;
          border-radius: var(--r-xs, 4px) var(--r-md, 8px) var(--r-xs, 4px) var(--r-sm, 6px);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.5;
          transition: opacity var(--t-control, 150ms), color var(--t-control, 150ms), background var(--t-control, 150ms), transform var(--t-micro, 90ms);
          flex-shrink: 0;
          position: absolute;
          top: 8px;
          right: 8px;
        }
        .toast-card:hover .toast-close {
          opacity: 1;
        }
        .toast-close:hover {
          opacity: 1;
          color: var(--text-primary);
          background: rgba(255,255,255,0.08);
        }
        .toast-close:active { transform: translateY(0.5px); }
        .toast-close:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }

        .toast-progress {
          height: 1px;
          width: 100%;
          animation: toast-progress linear both;
          flex-shrink: 0;
          transform-origin: left;
          opacity: 0.75;
        }

        @keyframes toast-in {
          from { transform: translate3d(110%, 0, 0); opacity: 0; }
          to   { transform: translate3d(0, 0, 0);    opacity: 1; }
        }
        @keyframes toast-out {
          from { transform: translate3d(0, 0, 0);    opacity: 1; }
          to   { transform: translate3d(110%, 0, 0); opacity: 0; }
        }
        @keyframes toast-progress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .toast-card,
          .toast-card--out,
          .toast-progress {
            animation-duration: 1ms;
            transition-duration: 1ms;
          }
        }
      `}</style>
    </div>
  );
}

// ── Collapsed group card ──────────────────────────────────────────────────────

function GroupCard({
  group,
  onDismissAll,
}: {
  group: GroupedToast;
  onDismissAll: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const dismiss = useCallback(onDismissAll, [onDismissAll]);
  const firstVariant = group.toasts[0]?.variant ?? 'info';
  const accent = ACCENT[firstVariant];

  useEffect(() => {
    const t = setTimeout(() => {
      setIsDismissing(true);
      setTimeout(dismiss, 200);
    }, DEFAULT_DURATION[firstVariant]);
    return () => clearTimeout(t);
  }, [group.key, firstVariant, dismiss]);

  return (
    <div
      className={`toast-group${isDismissing ? ' toast-group--out' : ''}`}
      style={{ '--toast-accent': accent } as CSSProperties & Record<string,string>}
    >
      <div className="toast-group-bar" style={{ background: accent }} />
      <div className="toast-group-content">
        <div className="toast-group-header">
          <span className="toast-icon">
            <ToastIcon variant={firstVariant} />
          </span>
          <span className="toast-group-title">
            {group.count} new notifications
          </span>
          <button
            className="toast-group-expand"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="toast-close"
            onClick={() => { setIsDismissing(true); setTimeout(dismiss, 200); }}
            aria-label="Dismiss all"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {expanded && (
          <div className="toast-group-items">
            {group.toasts.map(t => (
              <div key={t.id} className="toast-group-item">
                <span className="toast-group-item-title">{t.title}</span>
                {t.description && (
                  <span className="toast-group-item-desc">{t.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .toast-group {
          position: relative;
          display: flex;
          flex-direction: column;
          width: 300px;
          background: var(--elev-tint-2, var(--bg-float));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 48px rgba(0,0,0,.38));
          overflow: hidden;
          pointer-events: all;
          animation: toast-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
        }
        .toast-group--out {
          animation: toast-out var(--t-overlay-out, 200ms) var(--ease-in, cubic-bezier(.7,0,.84,0)) both;
        }
        @keyframes toast-in {
          from { transform: translate3d(110%, 0, 0); opacity: 0; }
          to   { transform: translate3d(0, 0, 0);    opacity: 1; }
        }
        @keyframes toast-out {
          from { transform: translate3d(0, 0, 0);    opacity: 1; }
          to   { transform: translate3d(110%, 0, 0); opacity: 0; }
        }
        .toast-group-bar {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 4px;
          border-radius: var(--r-sm, 6px) 0 0 var(--r-md, 8px);
        }
        .toast-group-content {
          padding: 12px 14px 12px 17px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .toast-group-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toast-group-title {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary, #e8e8f0);
        }
        .toast-group-expand {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted, #8888aa);
          padding: 3px;
          border-radius: var(--r-xs, 4px) var(--r-sm, 6px) var(--r-xs, 4px) var(--r-md, 8px);
          display: flex;
          align-items: center;
          transition: color var(--t-control, 150ms), background var(--t-control, 150ms), transform var(--t-micro, 90ms);
        }
        .toast-group-expand:hover { color: var(--text-primary, #e8e8f0); background: color-mix(in srgb, currentColor 8%, transparent); }
        .toast-group-expand:active { transform: translateY(0.5px); }
        .toast-group-expand:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }
        .toast-group-items {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding-left: 28px;
        }
        .toast-group-item {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 4px 0;
          border-top: 1px solid rgba(255,255,255,0.05);
        }
        .toast-group-item-title {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-primary, #e8e8f0);
        }
        .toast-group-item-desc {
          font-size: 11px;
          color: var(--text-muted, #8888aa);
        }
        @media (prefers-reduced-motion: reduce) {
          .toast-group,
          .toast-group--out {
            animation-duration: 1ms;
          }
        }
      `}</style>
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

export default function ToastContainer() {
  const toasts   = useOnyxStore(s => s.toasts);
  const dismiss  = useOnyxStore(s => s.dismissToast);

  const visible = toasts.slice(-5);
  const items   = groupToasts(visible);

  const dismissGroup = useCallback(
    (keys: string[]) => {
      for (const id of keys) dismiss(id);
    },
    [dismiss],
  );

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {items.map((item, index) => {
        if ('count' in item) {
          return (
            <GroupCard
              key={item.key}
              group={item}
              onDismissAll={() => dismissGroup(item.toasts.map(t => t.id))}
            />
          );
        }
        return (
          <ToastCard
            key={item.id}
            toast={item}
            index={index}
            total={items.length}
            onDismiss={() => dismiss(item.id)}
          />
        );
      })}

      <style>{`
        .toast-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-end;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// ── Convenience functions ─────────────────────────────────────────────────────
// These call getState() directly so they work outside React render without
// violating the rules of hooks.

export function showToast(title: string, opts?: Partial<Omit<ToastType, 'id' | 'title'>>) {
  useOnyxStore.getState().addToast({ variant: 'info', title, ...opts });
}

export function showSuccess(title: string, description?: string) {
  useOnyxStore.getState().addToast({ variant: 'success', title, description });
}

export function showError(title: string, description?: string) {
  useOnyxStore.getState().addToast({ variant: 'error', title, description });
}

export function showMention(channel: string, from: string, preview: string) {
  useOnyxStore.getState().addToast({
    variant: 'mention',
    title: `${from} mentioned you in ${channel}`,
    description: preview,
    groupKey: `mention:${channel}`,
  });
}
