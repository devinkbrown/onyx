'use client';

// StickerPicker — browse and send sticker packs
// Stickers are sent as CTCP ACTION with a special marker or as a plain [STICKER:...] format

import { useState } from 'react';

interface Props {
  onPick: (text: string) => void;
  onClose: () => void;
}

interface StickerDef {
  id: string;
  label: string;
  value: string; // the text inserted into the message input
}

interface Pack {
  name: string;
  stickers: StickerDef[];
}

const PACKS: Pack[] = [
  {
    name: 'Ocean Blobs',
    stickers: [
      { id: 'blob-octopus',  label: 'Octopus',    value: '[sticker:blob-octopus]' },
      { id: 'blob-squid',    label: 'Squid',       value: '[sticker:blob-squid]' },
      { id: 'blob-fish',     label: 'Fish',        value: '[sticker:blob-fish]' },
      { id: 'blob-puffer',   label: 'Puffer',      value: '[sticker:blob-puffer]' },
      { id: 'blob-crab',     label: 'Crab',        value: '[sticker:blob-crab]' },
      { id: 'blob-lobster',  label: 'Lobster',     value: '[sticker:blob-lobster]' },
      { id: 'blob-shrimp',   label: 'Shrimp',      value: '[sticker:blob-shrimp]' },
      { id: 'blob-butterfly', label: 'Butterfly',  value: '[sticker:blob-butterfly]' },
    ],
  },
  {
    name: 'Cats',
    stickers: [
      { id: 'cat-grinning',  label: 'Grinning',   value: '😺' },
      { id: 'cat-beaming',   label: 'Beaming',    value: '😸' },
      { id: 'cat-tears',     label: 'Tears',      value: '😹' },
      { id: 'cat-heart',     label: 'Heart Eyes', value: '😻' },
      { id: 'cat-smirk',     label: 'Smirk',      value: '😼' },
      { id: 'cat-kiss',      label: 'Kiss',       value: '😽' },
      { id: 'cat-scream',    label: 'Scream',     value: '🙀' },
      { id: 'cat-pouting',   label: 'Pouting',    value: '😾' },
    ],
  },
  {
    name: 'Memes',
    stickers: [
      { id: 'meme-shrug',    label: 'Shrug',      value: '¯\\_(ツ)_/¯' },
      { id: 'meme-flip',     label: 'Table Flip', value: '(╯°□°）╯︵ ┻━┻' },
      { id: 'meme-unflip',   label: 'Table Set',  value: '┬─┬ノ( º _ ºノ)' },
      { id: 'meme-eyes',     label: 'Eyes',       value: '(•_•)' },
      { id: 'meme-deal',     label: 'Deal',       value: '( •_•)>⌐■-■  (⌐■_■)' },
      { id: 'meme-disapprove', label: 'Disapprove', value: 'ಠ_ಠ' },
      { id: 'meme-bear',     label: 'Bear',       value: 'ʕ•ᴥ•ʔ' },
      { id: 'meme-lenny',    label: 'Lenny',      value: '( ͡° ͜ʖ ͡°)' },
    ],
  },
];

export default function StickerPicker({ onPick, onClose }: Props) {
  const [activePack, setActivePack] = useState(0);

  const pack = PACKS[activePack];

  return (
    <div className="sp-root" role="dialog" aria-label="Sticker picker">
      {/* Tab bar */}
      <div className="sp-tabs" role="tablist" aria-label="Sticker packs">
        {PACKS.map((p, i) => (
          <button
            key={p.name}
            role="tab"
            aria-selected={activePack === i}
            className={`sp-tab${activePack === i ? ' sp-tab--active' : ''}`}
            onClick={() => setActivePack(i)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="sp-grid" role="list" aria-label={`${pack.name} stickers`}>
        {pack.stickers.map(sticker => (
          <button
            key={sticker.id}
            className="sp-sticker"
            role="listitem"
            title={sticker.label}
            aria-label={sticker.label}
            onMouseDown={e => {
              e.preventDefault();
              onPick(sticker.value);
              onClose();
            }}
          >
            <span className="sp-sticker-preview" aria-hidden="true">
              {sticker.value.startsWith('[sticker:') ? sticker.id.replace('blob-', '') : sticker.value}
            </span>
            <span className="sp-sticker-label">{sticker.label}</span>
          </button>
        ))}
      </div>

      <style>{`
        .sp-root {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          width: 320px;
          max-height: 380px;
          display: flex;
          flex-direction: column;
          background: rgba(6, 16, 29, 0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          box-shadow: 0 8px 48px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
          z-index: 200;
          overflow: hidden;
          animation: sp-enter 180ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes sp-enter {
          from { opacity: 0; transform: scale(0.92) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ── Tabs ── */
        .sp-tabs {
          display: flex;
          gap: 0;
          padding: 8px 10px 0;
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 0;
        }

        .sp-tabs::-webkit-scrollbar { display: none; }

        .sp-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          padding: 7px 12px 8px;
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          color: var(--text-muted);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: color 150ms ease, border-color 150ms ease;
          letter-spacing: 0.2px;
        }

        .sp-tab:hover {
          color: var(--text-secondary);
        }

        .sp-tab--active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }

        /* ── Grid ── */
        .sp-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          padding: 10px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(14,165,233,0.15) transparent;
        }

        .sp-grid::-webkit-scrollbar { width: 4px; }
        .sp-grid::-webkit-scrollbar-thumb {
          background: rgba(14,165,233,0.15);
          border-radius: 2px;
        }
        .sp-grid::-webkit-scrollbar-thumb:hover {
          background: rgba(14,165,233,0.3);
        }

        /* ── Sticker tile ── */
        .sp-sticker {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          padding: 8px 4px 6px;
          cursor: pointer;
          transition:
            background 150ms ease,
            border-color 150ms ease,
            transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 120ms ease;
          font-family: inherit;
          min-height: 68px;
        }

        .sp-sticker:hover {
          background: rgba(255,255,255,0.07);
          border-color: rgba(14,165,233,0.25);
          transform: scale(1.06);
          box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        }

        .sp-sticker:active {
          transform: scale(0.96);
        }

        .sp-sticker-preview {
          font-size: 20px;
          line-height: 1.2;
          display: block;
          text-align: center;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sp-sticker-label {
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.2;
        }
      `}</style>
    </div>
  );
}
