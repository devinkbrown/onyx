'use client';

import { useEffect, useMemo, useState } from 'react';

type TegamiDetail = {
  channel: string;
  count: number;
  firstMsgId: string;
};

type OfflineMessagesBannerProps = {
  channel?: string;
  onJump?: (detail: TegamiDetail) => void;
};

function eventKey(detail: TegamiDetail) {
  return `${detail.channel.toLowerCase()}::${detail.firstMsgId}`;
}

export default function OfflineMessagesBanner({ channel, onJump }: OfflineMessagesBannerProps) {
  const [items, setItems] = useState<Map<string, TegamiDetail>>(new Map());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // OCEAN-INTEGRATION: protocol integration emits ocean:tegami with { channel, count, firstMsgId }.
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TegamiDetail>).detail;
      if (!detail?.channel || !detail.firstMsgId || !Number.isFinite(detail.count) || detail.count <= 0) return;
      const key = eventKey(detail);
      setDismissed(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setItems(prev => {
        const next = new Map(prev);
        next.set(detail.channel.toLowerCase(), detail);
        return next;
      });
    };

    window.addEventListener('ocean:tegami', handler);
    return () => window.removeEventListener('ocean:tegami', handler);
  }, []);

  const visibleItems = useMemo(() => {
    const all = [...items.values()].filter(item => !dismissed.has(eventKey(item)));
    if (!channel) return all;
    return all.filter(item => item.channel.toLowerCase() === channel.toLowerCase());
  }, [channel, dismissed, items]);

  if (visibleItems.length === 0) return null;

  const dismiss = (detail: TegamiDetail) => {
    setDismissed(prev => new Set(prev).add(eventKey(detail)));
  };

  const jump = (detail: TegamiDetail) => {
    onJump?.(detail);
    window.dispatchEvent(new CustomEvent('ocean:jump-to-message', { detail: { msgId: detail.firstMsgId, channel: detail.channel } }));
  };

  return (
    <div className="omb-stack" aria-live="polite" data-testid="offline-messages-banner">
      {visibleItems.map(item => (
        <section className="omb-banner" key={eventKey(item)}>
          <span className="omb-icon" aria-hidden>✉</span>
          <button className="omb-jump" type="button" onClick={() => jump(item)}>
            <strong>{item.count}</strong> {item.count === 1 ? 'message' : 'messages'} arrived while you were away — jump to first
          </button>
          <button className="omb-dismiss" type="button" onClick={() => dismiss(item)} aria-label={`Dismiss offline messages for ${item.channel}`}>
            <span aria-hidden>×</span>
          </button>
        </section>
      ))}

      <style>{`
        .omb-stack {
          display: flex;
          flex-direction: column;
          gap: var(--sp-2, 8px);
          width: 100%;
        }
        .omb-banner {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: var(--sp-3, 12px);
          padding: var(--sp-3, 12px) var(--sp-4, 16px);
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-xl, 16px) var(--r-md, 8px);
          background: var(--elev-tint-2, color-mix(in srgb, var(--accent, #0ea5e9) 3%, var(--bg-elevated, #121923)));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.28));
          color: var(--text-primary, #eef4ff);
        }
        .omb-icon {
          color: var(--lux, #d8b96a);
          font-size: var(--text-md, .9375rem);
          line-height: 1;
        }
        .omb-jump {
          min-width: 0;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: var(--text-sm, .8125rem);
          line-height: 1.45;
          text-align: left;
          cursor: pointer;
        }
        .omb-jump strong {
          color: var(--lux, #d8b96a);
          font-variant-numeric: tabular-nums;
        }
        .omb-jump:hover {
          color: var(--text-normal, var(--text-primary, #eef4ff));
          text-decoration: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: 3px;
        }
        .omb-dismiss {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: var(--r-sm, 6px) var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 12px);
          background: color-mix(in srgb, var(--text-muted, #7f8da3) 9%, transparent);
          color: var(--text-muted, #7f8da3);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        .omb-dismiss:hover {
          color: var(--text-primary, #eef4ff);
          background: color-mix(in srgb, var(--text-muted, #7f8da3) 15%, transparent);
        }
        .omb-jump:focus-visible,
        .omb-dismiss:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
        }

        @media (max-width: 520px) {
          .omb-banner {
            align-items: start;
          }
        }
      `}</style>
    </div>
  );
}
