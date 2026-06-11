'use client';

import { useMemo, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import ImageLightbox from '@/components/ui/ImageLightbox';
import ModalShell from './ModalShell';

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'images' | 'videos';

interface MediaItem {
  url: string;
  type: 'image' | 'video';
  nick: string;
  time: Date;
  msgId: string;
}

interface MonthGroup {
  label: string;
  items: MediaItem[];
}

// ── Regex ──────────────────────────────────────────────────────────────────────

const IMAGE_RE = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?/gi;
const VIDEO_RE = /https?:\/\/\S+\.(?:mp4|webm|mov|ogv)(?:\?\S*)?/gi;

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractMedia(messages: ChatMessage[]): MediaItem[] {
  const items: MediaItem[] = [];
  for (const msg of messages) {
    if (msg.deleted || msg.redacted) continue;
    if (msg.type !== 'msg') continue;

    const imageMatches = [...msg.text.matchAll(IMAGE_RE)];
    const videoMatches = [...msg.text.matchAll(VIDEO_RE)];

    for (const m of imageMatches) {
      items.push({
        url: m[0],
        type: 'image',
        nick: msg.from,
        time: msg.time,
        msgId: msg.id,
      });
    }
    for (const m of videoMatches) {
      items.push({
        url: m[0],
        type: 'video',
        nick: msg.from,
        time: msg.time,
        msgId: msg.id,
      });
    }
  }
  return items.reverse(); // newest first
}

function groupByMonth(items: MediaItem[]): MonthGroup[] {
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    const d = item.time;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return [...groups.entries()].map(([, groupItems]) => ({
    label: new Date(groupItems[0].time).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
    items: groupItems,
  }));
}

const SKELETON_COUNT = 12;

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  nick: string;
  onClose: () => void;
}

export default function DMMediaPanel({ nick, onClose }: Props) {
  const messages = useOnyxStore(
    s => s.dms.get(nick.toLowerCase())?.messages ?? null,
  );

  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const allMedia = useMemo(
    () => (messages ? extractMedia(messages) : []),
    [messages],
  );

  const filtered = useMemo(() => {
    let items = allMedia;
    if (filter === 'images') items = items.filter(i => i.type === 'image');
    if (filter === 'videos') items = items.filter(i => i.type === 'video');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        i => i.nick.toLowerCase().includes(q) || i.url.toLowerCase().includes(q),
      );
    }
    return items;
  }, [allMedia, filter, search]);

  const grouped = useMemo(() => groupByMonth(filtered), [filtered]);

  const imageUrls = useMemo(
    () => filtered.filter(i => i.type === 'image').map(i => i.url),
    [filtered],
  );

  const handleCellClick = useCallback(
    (item: MediaItem) => {
      if (item.type === 'image') {
        const idx = imageUrls.indexOf(item.url);
        if (idx !== -1) setLightboxIndex(idx);
      } else {
        window.open(item.url, '_blank', 'noopener,noreferrer');
      }
    },
    [imageUrls],
  );

  const jumpToMessage = useCallback((msgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('ocean:jump-to-message', { detail: { id: msgId } }),
    );
  }, []);

  const loading = messages === null;

  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'images', label: 'Images' },
    { id: 'videos', label: 'Videos' },
  ];

  return (
    <ModalShell
      onClose={onClose}
      variant="sheet"
      size="sm"
      title={<>Media &amp; Files</>}
      kicker={`DM with ${nick}`}
      titleId="dm-media-title"
      closeLabel="Close media panel"
      headerExtra={allMedia.length > 0 ? <span className="dm-media-count">{allMedia.length}</span> : undefined}
      flushBody
    >
      {/* Filter tabs */}
      <div className="dm-media-tabs" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={filter === t.id}
            className={`dm-media-tab${filter === t.id ? ' active' : ''}`}
            onClick={() => setFilter(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="dm-media-search-row">
        <input
          className="dm-media-search"
          type="search"
          placeholder="Search by nick or URL…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search media"
        />
      </div>

      {/* Body */}
      <div className="dm-media-body">
        {loading ? (
          <div className="dm-media-grid dm-media-grid--skeleton">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div key={i} className="dm-media-cell dm-media-skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="dm-media-empty">
            <span className="dm-media-empty-icon" aria-hidden="true">🖼️</span>
            <p>No media yet.</p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.label} className="dm-media-day-group">
              <p className="label-caps dm-media-day-label">{group.label}</p>
              <div className="dm-media-grid">
                {group.items.map((item, i) => (
                  <DMMediaCell
                    key={`${item.msgId}-${i}`}
                    item={item}
                    onClick={() => handleCellClick(item)}
                    onJump={e => jumpToMessage(item.msgId, e)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && imageUrls.length > 0 && (
        <ImageLightbox
          src={imageUrls[lightboxIndex] ?? ''}
          alt="Media"
          images={imageUrls}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <style>{css}</style>
    </ModalShell>
  );
}

// ── Media cell ─────────────────────────────────────────────────────────────────

interface DMMediaCellProps {
  item: MediaItem;
  onClick: () => void;
  onJump: (e: React.MouseEvent) => void;
}

function DMMediaCell({ item, onClick, onJump }: DMMediaCellProps) {
  return (
    <div
      className="dm-media-cell"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${item.type === 'video' ? 'Video' : 'Image'} from ${item.nick}`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      {item.type === 'image' ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={item.url}
          alt={`Shared by ${item.nick}`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="dm-media-video-thumb">
          <video src={item.url} preload="metadata" muted playsInline />
          <span className="dm-media-play-icon" aria-hidden="true">▶</span>
        </div>
      )}

      <div className="dm-media-overlay">
        <button
          className="dm-media-jump-btn"
          title="Jump to message"
          aria-label="Jump to message"
          onClick={onJump}
        >
          <DmJumpIcon />
        </button>
        <span className="dm-media-overlay-nick">{item.nick}</span>
      </div>
    </div>
  );
}

function DmJumpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const css = `
  .dm-media-count {
    font-size: var(--text-2xs, 11px);
    font-weight: 700;
    background: var(--bg-float, var(--bg-elevated));
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 99px;
    padding: 1px 6px;
    line-height: 1.6;
  }

  .dm-media-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 10px 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .dm-media-tab {
    font-size: var(--text-xs, 12px);
    font-weight: 600;
    padding: 4px 10px 7px;
    background: none; border: none; cursor: pointer;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    transition: color var(--t-control, 150ms), border-color var(--t-control, 150ms);
  }
  .dm-media-tab:hover { color: var(--text-secondary); }
  .dm-media-tab.active {
    color: var(--accent);
    border-bottom-color: var(--lux, var(--accent));
  }

  .dm-media-search-row {
    padding: var(--sp-2, 8px) 10px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .dm-media-search {
    width: 100%;
    padding: 5px 10px;
    background: var(--bg-deep);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    color: var(--text-normal);
    font-size: var(--text-xs, 12px);
    outline: none;
    transition: border-color var(--t-control, 150ms);
    box-sizing: border-box;
  }
  .dm-media-search:focus { border-color: var(--accent); }
  .dm-media-search::placeholder { color: var(--text-muted); }

  .dm-media-body {
    padding: var(--sp-2, 8px) 0;
  }

  .dm-media-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: var(--sp-10, 40px) var(--sp-5, 20px);
    text-align: center;
  }
  .dm-media-empty-icon {
    font-size: 32px;
    opacity: 0.4;
    line-height: 1;
  }
  .dm-media-empty p {
    font-size: var(--text-sm, 13px);
    color: var(--text-muted);
    margin: 0;
  }

  .dm-media-day-group {
    margin-bottom: var(--sp-2, 8px);
  }
  .dm-media-day-label {
    padding: var(--sp-2, 8px) var(--sp-3, 12px) var(--sp-1, 4px);
    margin: 0;
  }

  .dm-media-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    padding: 0 4px;
  }
  .dm-media-grid--skeleton {
    padding: var(--sp-2, 8px);
  }

  .dm-media-cell {
    aspect-ratio: 1;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-elevated);
    cursor: pointer;
    position: relative;
  }
  .dm-media-cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .dm-media-cell img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    transition: transform var(--t-surface, 220ms) var(--ease-out, ease);
  }
  .dm-media-cell:hover img { transform: scale(1.06); }

  .dm-media-video-thumb {
    width: 100%; height: 100%;
    position: relative;
    display: flex; align-items: center; justify-content: center;
  }
  .dm-media-video-thumb video {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 200ms;
  }
  .dm-media-cell:hover .dm-media-video-thumb video { transform: scale(1.04); }

  .dm-media-play-icon {
    position: absolute;
    font-size: 16px;
    color: rgba(255,255,255,0.9);
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
    pointer-events: none;
  }

  .dm-media-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.52) 100%);
    opacity: 0;
    transition: opacity 180ms var(--ease-out, ease);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 4px;
  }
  /* expand icon */
  .dm-media-cell::after {
    content: '⤢';
    position: absolute;
    top: 6px;
    right: 7px;
    font-size: 14px;
    color: rgba(255,255,255,0.85);
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
    opacity: 0;
    transition: opacity 180ms ease;
    pointer-events: none;
  }
  .dm-media-cell:hover::after { opacity: 1; }
  .dm-media-cell:hover .dm-media-overlay { opacity: 1; }

  .dm-media-overlay-nick {
    font-size: 9px;
    color: white;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    flex: 1;
    min-width: 0;
  }

  .dm-media-jump-btn {
    width: 18px; height: 18px;
    border-radius: var(--r-xs);
    background: rgba(0,0,0,0.5);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.9);
    padding: 0;
    transition: background var(--t-micro, 90ms);
    flex-shrink: 0;
  }
  .dm-media-jump-btn:hover { background: rgba(0,0,0,0.75); }

  .dm-media-skeleton {
    background: linear-gradient(90deg,
      var(--bg-elevated) 0%,
      var(--bg-float)    45%,
      var(--bg-elevated) 100%);
    background-size: 200% 100%;
    animation: dm-media-shimmer 1.5s ease infinite;
  }
  @keyframes dm-media-shimmer {
    from { background-position: -200% 0; }
    to   { background-position:  200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dm-media-skeleton { animation: none; }
  }
`;
