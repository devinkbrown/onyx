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
          background: var(--bg-float, #1a2c40);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          border-radius: 12px;
          box-shadow: 0 12px 48px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.4);
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
          padding: 0 8px;
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
        }

        .sp-tabs::-webkit-scrollbar { display: none; }

        .sp-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          color: var(--text-muted, #505880);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: color 150ms ease, border-color 150ms ease;
          letter-spacing: 0.01em;
          position: relative;
          top: 1px;
        }

        .sp-tab:hover {
          color: var(--text-secondary, #a0a8c8);
        }

        .sp-tab--active {
          color: var(--text-primary, #f0f4ff);
          border-bottom-color: var(--accent, #0ea5e9);
        }

        /* ── Grid ── */
        .sp-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          padding: 8px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal, rgba(14,165,233,0.12)) transparent;
        }

        .sp-grid::-webkit-scrollbar { width: 4px; }
        .sp-grid::-webkit-scrollbar-thumb {
          background: var(--border-normal, rgba(14,165,233,0.12));
          border-radius: 2px;
        }
        .sp-grid::-webkit-scrollbar-thumb:hover {
          background: var(--border-subtle, rgba(14,165,233,0.2));
        }

        /* ── Sticker tile — 64px cells ── */
        .sp-sticker {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--border-subtle, rgba(14,165,233,0.06));
          border-radius: 8px;
          padding: 8px 4px 6px;
          cursor: pointer;
          transition:
            background 150ms ease,
            border-color 150ms ease,
            transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 250ms ease;
          font-family: inherit;
          min-height: 64px;
        }

        .sp-sticker:hover {
          background: rgba(255,255,255,0.06);
          border-color: var(--accent-border, rgba(14,165,233,0.25));
          transform: scale(1.15);
          box-shadow: 0 6px 20px rgba(0,0,0,0.4);
          z-index: 1;
          position: relative;
        }

        .sp-sticker:active {
          transform: scale(0.96);
          transition-duration: 100ms;
        }

        .sp-sticker-preview {
          font-size: 22px;
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
          color: var(--text-muted, #505880);
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
