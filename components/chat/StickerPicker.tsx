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
        {!currentPack?.stickers.length ? (
          <div className="sp-empty">
            <span className="sp-empty-icon" aria-hidden>🎭</span>
            <span className="sp-empty-text">No stickers available</span>
          </div>
        ) : currentPack.stickers.map(sticker => (
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
          height: 260px;
          display: flex;
          flex-direction: column;
          background: var(--bg-float, #1a2c40);
          border: 1px solid var(--border-normal, rgba(14,165,233,0.15));
          border-radius: var(--r-lg, 12px);
          box-shadow:
            0 24px 64px rgba(0,0,0,0.75),
            0 0 0 1px rgba(14,165,233,0.1);
          z-index: 200;
          overflow: hidden;
          animation: sp-enter 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        @keyframes sp-enter {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ── Pack tabs ── */
        .sp-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
          padding: 0 4px;
        }
        .sp-tabs::-webkit-scrollbar { display: none; }

        .sp-tab {
          flex-shrink: 0;
          padding: 9px 13px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted, #3d6480);
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          transition: color var(--t-fast, 150ms), border-color var(--t-fast, 150ms);
          white-space: nowrap;
          position: relative;
          bottom: -1px;
        }
        .sp-tab:hover { color: var(--text-secondary, #7aa8c4); }
        .sp-tab--active {
          color: var(--accent, #0ea5e9);
          border-bottom-color: var(--accent, #0ea5e9);
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
          scrollbar-color: var(--border-normal, rgba(14,165,233,0.15)) transparent;
          align-content: start;
        }
        .sp-grid::-webkit-scrollbar { width: 4px; }
        .sp-grid::-webkit-scrollbar-thumb {
          background: var(--border-normal, rgba(14,165,233,0.15));
          border-radius: 2px;
        }

        /* ── Empty state ── */
        .sp-empty {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 32px 16px;
          color: var(--text-muted, #3d6480);
        }
        .sp-empty-icon {
          font-size: 36px;
          line-height: 1;
          filter: grayscale(0.5);
          opacity: 0.7;
        }
        .sp-empty-text {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted, #3d6480);
        }

        /* ── Sticker cells ── */
        .sp-sticker {
          width: 60px;
          height: 60px;
          border: 1px solid transparent;
          background: var(--bg-elevated, #132131);
          border-radius: var(--r-md, 8px);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          transition:
            background var(--t-fast, 150ms),
            border-color var(--t-fast, 150ms),
            transform 120ms cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow var(--t-fast, 150ms);
          position: relative;
        }
        .sp-sticker:hover {
          background: var(--bg-overlay, #213550);
          border-color: var(--accent, #0ea5e9);
          transform: scale(1.12);
          z-index: 1;
          box-shadow: 0 4px 12px rgba(14,165,233,0.2);
        }
        .sp-sticker:active {
          transform: scale(0.95);
          box-shadow: none;
        }

        .sp-emoji {
          font-size: 2.6rem;
          line-height: 1;
          display: block;
          transition: transform 120ms ease;
        }
        .sp-sticker:hover .sp-emoji {
          transform: scale(1.05);
        }

        .sp-img {
          width: 48px;
          height: 48px;
          object-fit: contain;
          transition: transform 120ms ease;
        }
        .sp-sticker:hover .sp-img {
          transform: scale(1.05);
        }
      `}</style>
    </div>
  );
}
