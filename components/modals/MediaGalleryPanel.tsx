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

export default function MediaGalleryPanel() {
  const closeMediaGallery = useOnyxStore(s => s.closeMediaGallery);
  const activeView = useOnyxStore(s => s.activeView);
  const channels = useOnyxStore(s => s.channels);
  const dms = useOnyxStore(s => s.dms);

  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const messages = useMemo(() => {
    if (activeView.kind === 'channel') {
      return channels.get(activeView.channel.toLowerCase())?.messages ?? null;
    }
    if (activeView.kind === 'dm') {
      return dms.get(activeView.nick.toLowerCase())?.messages ?? null;
    }
    return null;
  }, [activeView, channels, dms]);

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

  // Flat list of image-only srcs for lightbox navigation
  const imageUrls = useMemo(
    () => filtered.filter(i => i.type === 'image').map(i => i.url),
    [filtered],
  );

  // Map from filtered index → imageUrls index (videos are excluded from lightbox)
  const getLightboxIndexForItem = useCallback(
    (item: MediaItem): number | null => {
      if (item.type !== 'image') return null;
      return imageUrls.indexOf(item.url);
    },
    [imageUrls],
  );

  const handleCellClick = useCallback(
    (item: MediaItem) => {
      if (item.type === 'image') {
        const idx = getLightboxIndexForItem(item);
        if (idx !== null) setLightboxIndex(idx);
      } else {
        window.open(item.url, '_blank', 'noopener,noreferrer');
      }
    },
    [getLightboxIndexForItem],
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
      onClose={closeMediaGallery}
      variant="sheet"
      size="sm"
      title="Media"
      kicker={activeView.kind === 'channel' ? activeView.channel : activeView.kind === 'dm' ? `DM with ${activeView.nick}` : 'Gallery'}
      titleId="mgp-title"
      closeLabel="Close media gallery"
      headerExtra={
        <>
          {allMedia.length > 0 && <span className="mgp-count">{allMedia.length}</span>}
          <div className="mgp-filters" role="tablist">
            {tabs.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={filter === t.id}
                className={`mgp-filter${filter === t.id ? ' active' : ''}`}
                onClick={() => setFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      }
      flushBody
    >
      {/* Search */}
      <div className="mgp-search-row">
        <input
          className="mgp-search"
          type="search"
          placeholder="Search by nick or URL…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search media"
        />
      </div>

      {/* Content */}
      <div className="mgp-content">
        {loading ? (
          <div className="mgp-grid">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div key={i} className="mgp-cell mgp-skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="mgp-empty">
            <span className="mgp-empty-icon" aria-hidden="true">🖼️</span>
            <p>No media yet</p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.label}>
              <p className="label-caps mgp-month-label">{group.label}</p>
              <div className="mgp-grid">
                {group.items.map((item, i) => (
                  <MediaCell
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

interface MediaCellProps {
  item: MediaItem;
  onClick: () => void;
  onJump: (e: React.MouseEvent) => void;
}

function MediaCell({ item, onClick, onJump }: MediaCellProps) {
  return (
    <div
      className="mgp-cell"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${item.type === 'video' ? 'Video' : 'Image'} from ${item.nick}`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      {item.type === 'image' ? (
         
        <img src={item.url} alt={`Shared by ${item.nick}`} loading="lazy" decoding="async" />
      ) : (
        <div className="mgp-video-thumb">
          <video src={item.url} preload="metadata" muted playsInline />
          <span className="mgp-play-icon" aria-hidden="true">▶</span>
        </div>
      )}

      <div className="mgp-overlay">
        <button
          className="mgp-jump-btn"
          title="Jump to message"
          aria-label="Jump to message"
          onClick={onJump}
        >
          <JumpIcon />
        </button>
        <span className="mgp-overlay-nick">{item.nick}</span>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function JumpIcon() {
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
  .mgp-count {
    font-size: var(--text-2xs, 11px);
    font-weight: 700;
    background: var(--bg-float, var(--bg-elevated));
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 99px;
    padding: 1px 6px;
    line-height: 1.6;
  }

  .mgp-filters {
    display: flex;
    gap: 4px;
  }

  .mgp-filter {
    padding: 3px 10px;
    border-radius: 12px;
    font-size: var(--text-xs, 12px);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border-subtle);
    background: none;
    color: var(--text-muted);
    transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms), color var(--t-control, 150ms);
  }
  .mgp-filter:hover { color: var(--text-secondary); }
  .mgp-filter.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .mgp-search-row {
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .mgp-search {
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
  .mgp-search:focus { border-color: var(--accent); }
  .mgp-search::placeholder { color: var(--text-muted); }

  .mgp-content {
    padding: var(--sp-2, 8px);
  }

  .mgp-month-label {
    padding: var(--sp-2, 8px) var(--sp-1, 4px) var(--sp-1, 4px);
    margin: 0;
  }

  .mgp-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    margin-bottom: var(--sp-2, 8px);
  }

  .mgp-cell {
    aspect-ratio: 1;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    border-radius: var(--r-sm);
    background: var(--bg-elevated);
  }
  .mgp-cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .mgp-cell img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    transition: transform var(--t-surface, 220ms) var(--ease-out, ease);
  }
  .mgp-cell:hover img { transform: scale(1.07); }

  /* expand icon */
  .mgp-cell::after {
    content: '⤢';
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 15px;
    color: rgba(255,255,255,0.85);
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
    opacity: 0;
    transition: opacity 180ms ease;
    pointer-events: none;
  }
  .mgp-cell:hover::after { opacity: 1; }

  .mgp-video-thumb {
    width: 100%; height: 100%;
    position: relative;
    display: flex; align-items: center; justify-content: center;
  }
  .mgp-video-thumb video {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 200ms;
  }
  .mgp-cell:hover .mgp-video-thumb video { transform: scale(1.04); }

  .mgp-play-icon {
    position: absolute;
    font-size: 20px;
    color: rgba(255,255,255,0.9);
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
    pointer-events: none;
  }

  .mgp-cell:hover .mgp-overlay { opacity: 1; }

  .mgp-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.4);
    opacity: 0;
    transition: opacity var(--t-control, 150ms);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 4px;
  }

  .mgp-overlay-nick {
    font-size: 10px;
    color: white;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    flex: 1;
    min-width: 0;
  }

  .mgp-jump-btn {
    width: 22px; height: 22px;
    border-radius: var(--r-xs);
    background: rgba(0,0,0,0.5);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.9);
    padding: 0;
    transition: background var(--t-micro, 90ms);
    flex-shrink: 0;
  }
  .mgp-jump-btn:hover { background: rgba(0,0,0,0.75); }

  .mgp-skeleton {
    background: linear-gradient(90deg,
      var(--bg-elevated) 0%,
      var(--bg-float)    45%,
      var(--bg-elevated) 100%);
    background-size: 200% 100%;
    animation: mgp-shimmer 1.5s ease infinite;
  }
  @keyframes mgp-shimmer {
    from { background-position: -200% 0; }
    to   { background-position:  200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mgp-skeleton { animation: none; }
  }

  .mgp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 48px 24px;
    text-align: center;
  }
  .mgp-empty-icon {
    font-size: 36px;
    opacity: 0.4;
    line-height: 1;
  }
  .mgp-empty p {
    font-size: var(--text-sm, 13px);
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }
`;
