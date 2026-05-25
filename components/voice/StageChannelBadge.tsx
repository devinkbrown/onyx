'use client';

import { useOnyxStore } from '@/lib/store';

interface StageChannelBadgeProps {
  channelName: string;
  listenerCount?: number;
}

export default function StageChannelBadge({ channelName, listenerCount = 0 }: StageChannelBadgeProps) {
  const stageChannel = useOnyxStore(s => s.stageChannel);

  const isLive = stageChannel?.toLowerCase() === channelName.toLowerCase();

  if (!isLive) return null;

  return (
    <span className="scb-badge" aria-label={`Stage live · ${listenerCount} listeners`}>
      <span className="scb-dot" aria-hidden />
      LIVE
      {listenerCount > 0 && (
        <span className="scb-count">· {listenerCount}</span>
      )}

      <style>{`
        .scb-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1px 6px;
          border-radius: 10px;
          background: rgba(239, 68, 68, 0.18);
          border: 1px solid rgba(239, 68, 68, 0.35);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #f87171;
          flex-shrink: 0;
          white-space: nowrap;
          line-height: 1.6;
        }

        .scb-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ef4444;
          flex-shrink: 0;
          animation: scb-pulse 1.4s ease-in-out infinite;
        }

        @keyframes scb-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.75); }
        }

        .scb-count {
          font-weight: 500;
          opacity: 0.8;
        }
      `}</style>
    </span>
  );
}
