'use client';

import { useState } from 'react';
import { STICKER_PACKS, type Sticker } from '@/lib/stickers';

interface StickerPickerProps {
  onSelect: (sticker: Sticker) => void;
  onClose: () => void;
}

export default function StickerPicker({ onSelect, onClose }: StickerPickerProps) {
  const [activePack, setActivePack] = useState(STICKER_PACKS[0]?.name ?? '');

  const currentPack = STICKER_PACKS.find(p => p.name === activePack) ?? STICKER_PACKS[0];

  return (
    <div className="sp-root" role="dialog" aria-label="Sticker picker">
      {/* Pack selector tabs */}
      <div className="sp-tabs" role="tablist">
        {STICKER_PACKS.map(pack => (
          <button
            key={pack.name}
            role="tab"
            aria-selected={activePack === pack.name}
            className={`sp-tab${activePack === pack.name ? ' sp-tab--active' : ''}`}
            onClick={() => setActivePack(pack.name)}
          >
            {pack.name}
          </button>
        ))}
      </div>

      {/* Sticker grid */}
      <div className="sp-grid" role="grid" aria-label={currentPack?.name}>
        {currentPack?.stickers.map(sticker => (
          <button
            key={sticker.id}
            className="sp-sticker"
            onClick={() => { onSelect(sticker); onClose(); }}
            title={sticker.name}
            role="gridcell"
            aria-label={sticker.name}
          >
            {sticker.url ? (
              <img src={sticker.url} alt={sticker.name} className="sp-img" />
            ) : (
              <span className="sp-emoji" aria-hidden>{sticker.emoji}</span>
            )}
          </button>
        ))}
      </div>

      <style>{`
        .sp-root {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          width: 300px;
          height: 240px;
          display: flex;
          flex-direction: column;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl);
          z-index: 200;
          overflow: hidden;
          animation: sp-enter 140ms var(--ease-out) both;
        }

        @keyframes sp-enter {
          from { opacity: 0; transform: scale(0.94) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ── Tabs ── */
        .sp-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .sp-tabs::-webkit-scrollbar { display: none; }

        .sp-tab {
          flex-shrink: 0;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          transition: color var(--t-fast), border-color var(--t-fast);
          white-space: nowrap;
        }
        .sp-tab:hover { color: var(--text-secondary); }
        .sp-tab--active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }

        /* ── Grid ── */
        .sp-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
          padding: 8px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
          align-content: start;
        }
        .sp-grid::-webkit-scrollbar { width: 4px; }
        .sp-grid::-webkit-scrollbar-thumb {
          background: var(--border-normal);
          border-radius: 2px;
        }

        .sp-sticker {
          width: 60px;
          height: 60px;
          border: 2px solid transparent;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          transition: background var(--t-fast), border-color var(--t-fast), transform var(--t-fast);
        }
        .sp-sticker:hover {
          background: var(--bg-overlay);
          border-color: var(--accent);
          transform: scale(1.1);
          z-index: 1;
        }
        .sp-sticker:active {
          transform: scale(0.96);
        }

        .sp-emoji {
          font-size: 3rem;
          line-height: 1;
          display: block;
        }

        .sp-img {
          width: 48px;
          height: 48px;
          object-fit: contain;
        }
      `}</style>
    </div>
  );
}
