'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  onPick: (url: string) => void;
  onClose: () => void;
}

interface GifItem {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
  height: number; // for masonry sizing
}

interface TenorGif {
  id: string;
  title: string;
  media_formats: {
    gif: { url: string; dims: number[] };
    tinygif: { url: string; dims: number[] };
  };
}

interface TenorResponse {
  results: TenorGif[];
}

const TENOR_KEY = process.env.NEXT_PUBLIC_TENOR_KEY ?? 'LIVDSRZULELA04';
const TENOR_BASE = 'https://tenor.googleapis.com/v2';

const CATEGORIES = [
  { label: 'Trending', query: '' },
  { label: 'Reactions', query: 'reaction' },
  { label: 'Memes', query: 'meme' },
  { label: 'Cute', query: 'cute' },
  { label: 'Anime', query: 'anime' },
  { label: 'Gaming', query: 'gaming' },
  { label: 'Sports', query: 'sports' },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function tenorToGifItem(g: TenorGif): GifItem {
  const dims = g.media_formats?.tinygif?.dims;
  const aspect = dims && dims[0] > 0 ? dims[1] / dims[0] : 1;
  // Each column is ~160px wide; clamp height
  const h = Math.min(Math.max(Math.round(160 * aspect), 90), 240);
  return {
    id: g.id,
    title: g.title ?? '',
    previewUrl: g.media_formats?.tinygif?.url ?? '',
    fullUrl: g.media_formats?.gif?.url ?? '',
    height: h,
  };
}

export default function GifPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeCat, setActiveCat] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const activeFetchRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounce(query, 300);

  const fetchGifs = useCallback(async (q: string, signal: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const url = q
        ? `${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=24&media_filter=gif`
        : `${TENOR_BASE}/featured?key=${TENOR_KEY}&limit=24&media_filter=gif`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Tenor API error: ${res.status}`);
      const data: TenorResponse = await res.json();
      const items = (data.results ?? []).map(tenorToGifItem);
      setGifs(items);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(true);
      setGifs([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  const startFetch = useCallback((q: string) => {
    activeFetchRef.current?.abort();
    const controller = new AbortController();
    activeFetchRef.current = controller;
    void fetchGifs(q, controller.signal).finally(() => {
      if (activeFetchRef.current === controller) activeFetchRef.current = null;
    });
    return controller;
  }, [fetchGifs]);

  useEffect(() => {
    const controller = startFetch(debouncedQuery);
    return () => {
      if (activeFetchRef.current === controller) {
        controller.abort();
        activeFetchRef.current = null;
      }
    };
  }, [debouncedQuery, startFetch]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCatClick = useCallback((idx: number) => {
    setActiveCat(idx);
    setQuery(CATEGORIES[idx].query);
  }, []);

  // Split into two columns for masonry layout
  const [col1, col2] = (() => {
    const a: GifItem[] = [];
    const b: GifItem[] = [];
    let aH = 0;
    let bH = 0;
    for (const g of gifs) {
      if (aH <= bH) { a.push(g); aH += g.height; }
      else { b.push(g); bH += g.height; }
    }
    return [a, b];
  })();

  const showEmpty = !loading && !error && gifs.length === 0;
  const showGrid = !loading && gifs.length > 0;

  return (
    <div className="gp-root" role="dialog" aria-label="GIF picker">
      {/* Search */}
      <div className="gp-header">
        <div className="gp-search-wrap">
          <svg className="gp-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            type="text"
            className="gp-search"
            placeholder="Search GIFs…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveCat(-1); }}
            aria-label="Search GIFs"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="gp-search-clear"
              onClick={() => { setQuery(''); setActiveCat(0); searchRef.current?.focus(); }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category chips */}
      <div className="gp-cats" role="tablist" aria-label="GIF categories">
        {CATEGORIES.map((cat, i) => (
          <button
            key={cat.label}
            role="tab"
            aria-selected={activeCat === i}
            className={`gp-cat-chip${activeCat === i ? ' gp-cat-chip--active' : ''}`}
            onClick={() => handleCatClick(i)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="gp-content">
        {loading && (
          <div className="gp-skeleton-masonry">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="gp-skeleton-item"
                style={{ height: `${90 + (i % 4) * 30}px` }}
              />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="gp-error">
            <span className="gp-error-icon">😔</span>
            <span>Could not load GIFs. Check your connection.</span>
            <button className="gp-retry-btn" onClick={() => startFetch(debouncedQuery)}>
              Try again
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="gp-empty">
            <span className="gp-empty-icon">😔</span>
            <span>No GIFs found for &ldquo;{debouncedQuery}&rdquo;</span>
          </div>
        )}

        {showGrid && (
          <div className="gp-masonry" role="list">
            <div className="gp-masonry-col">
              {col1.map(gif => (
                <GifTile key={gif.id} gif={gif} onPick={onPick} onClose={onClose} />
              ))}
            </div>
            <div className="gp-masonry-col">
              {col2.map(gif => (
                <GifTile key={gif.id} gif={gif} onPick={onPick} onClose={onClose} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="gp-footer">
        <span>Powered by Tenor</span>
      </div>

      <style>{`
        .gp-root {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          width: 360px;
          height: 440px;
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
          animation: gp-enter 180ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes gp-enter {
          from { opacity: 0; transform: scale(0.92) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ── Header / Search ── */
        .gp-header {
          padding: 10px 12px 0;
          flex-shrink: 0;
        }

        .gp-search-wrap {
          position: relative;
        }

        .gp-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 13px;
          height: 13px;
          color: var(--text-muted);
          pointer-events: none;
        }

        .gp-search {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 999px;
          padding: 7px 30px 7px 32px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
          box-sizing: border-box;
          height: 36px;
          font-family: inherit;
        }

        .gp-search:focus {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2.5px var(--accent-glow);
        }

        .gp-search::placeholder {
          color: var(--text-muted);
        }

        .gp-search-clear {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          padding: 0 2px;
          transition: color 150ms ease;
        }

        .gp-search-clear:hover { color: var(--text-primary); }

        /* ── Category chips ── */
        .gp-cats {
          display: flex;
          gap: 5px;
          padding: 8px 12px 0;
          overflow-x: auto;
          flex-shrink: 0;
          scrollbar-width: none;
        }

        .gp-cats::-webkit-scrollbar { display: none; }

        .gp-cat-chip {
          border: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.03);
          border-radius: 999px;
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 100ms ease;
          letter-spacing: 0.2px;
        }

        .gp-cat-chip:hover {
          background: rgba(255,255,255,0.07);
          color: var(--text-primary);
          transform: scale(1.03);
        }

        .gp-cat-chip--active {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          color: var(--accent);
        }

        /* ── Content area ── */
        .gp-content {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
          margin-top: 6px;
        }

        .gp-content::-webkit-scrollbar { width: 4px; }
        .gp-content::-webkit-scrollbar-thumb {
          background: var(--border-normal);
          border-radius: 2px;
        }
        .gp-content::-webkit-scrollbar-thumb:hover {
          background: var(--accent-border);
        }

        /* ── Masonry grid ── */
        .gp-masonry {
          display: flex;
          gap: 5px;
        }

        .gp-masonry-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        /* ── Skeleton ── */
        .gp-skeleton-masonry {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px;
        }

        .gp-skeleton-item {
          border-radius: 10px;
          background: linear-gradient(90deg,
            var(--bg-elevated) 0%,
            var(--bg-float)    45%,
            var(--bg-elevated) 100%);
          background-size: 200% 100%;
          animation: gp-shimmer 1.6s var(--ease-out, ease) infinite;
        }

        @keyframes gp-shimmer {
          from { background-position: -200% 0; }
          to   { background-position:  200% 0; }
        }

        /* ── Trending label ── */
        .gp-trending-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 0 2px 4px;
        }

        /* ── States ── */
        .gp-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 200px;
          color: var(--text-muted);
          font-size: 13px;
        }

        .gp-error-icon, .gp-empty-icon {
          font-size: 28px;
          line-height: 1;
          margin-bottom: 2px;
        }

        .gp-retry-btn {
          border: 1px solid rgba(14,165,233,0.25);
          background: rgba(14,165,233,0.06);
          cursor: pointer;
          border-radius: 999px;
          padding: 5px 16px;
          font-size: 12px;
          color: var(--accent);
          font-family: inherit;
          transition: background 150ms ease;
        }

        .gp-retry-btn:hover { background: rgba(14,165,233,0.12); }

        .gp-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 200px;
          color: var(--text-muted);
          font-size: 13px;
          text-align: center;
          padding: 0 20px;
          line-height: 1.5;
        }

        /* ── Footer ── */
        .gp-footer {
          padding: 4px 12px 5px;
          font-size: 10px;
          color: var(--text-muted);
          text-align: right;
          border-top: 1px solid rgba(14, 165, 233, 0.07);
          flex-shrink: 0;
          letter-spacing: 0.3px;
          opacity: 0.7;
        }

      `}</style>
    </div>
  );
}

// ── GifTile sub-component ────────────────────────────────────────────────────
interface GifTileProps {
  gif: GifItem;
  onPick: (url: string) => void;
  onClose: () => void;
}

function GifTile({ gif, onPick, onClose }: GifTileProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <button
      className="gp-gif-tile"
      role="listitem"
      onClick={() => { onPick(gif.fullUrl); onClose(); }}
      title={gif.title || 'GIF'}
      aria-label={gif.title || 'GIF'}
      style={{ height: `${gif.height}px` }}
    >
      {/* Shimmer placeholder while loading */}
      {!loaded && <div className="gp-gif-placeholder" />}
      <img
        ref={imgRef}
        src={gif.previewUrl}
        alt={gif.title || 'GIF'}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0 }}
      />

      <style>{`
        .gp-gif-tile {
          position: relative;
          border: none;
          background: rgba(255,255,255,0.04);
          border-radius: 10px;
          overflow: hidden;
          cursor: pointer;
          padding: 0;
          width: 100%;
          transition: transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 120ms ease;
          display: block;
        }

        .gp-gif-tile:hover {
          transform: scale(1.03);
          box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px var(--accent-border);
          z-index: 1;
        }

        .gp-gif-tile:active {
          transform: scale(0.97);
        }

        .gp-gif-tile img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: opacity 200ms ease;
        }

        .gp-gif-placeholder {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg,
            var(--bg-elevated) 0%,
            var(--bg-float)    45%,
            var(--bg-elevated) 100%);
          background-size: 200% 100%;
          animation: gp-tile-shimmer 1.6s ease infinite;
          border-radius: 10px;
        }

        @keyframes gp-tile-shimmer {
          from { background-position: -200% 0; }
          to   { background-position:  200% 0; }
        }

        /* ── Play / hover overlay ── */
        .gp-gif-tile::after {
          content: '▶';
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          color: rgba(255,255,255,0.9);
          text-shadow: 0 2px 8px rgba(0,0,0,0.7);
          background: rgba(0,0,0,0.28);
          opacity: 0;
          transition: opacity 150ms ease;
          border-radius: 10px;
        }
        .gp-gif-tile:hover::after {
          opacity: 1;
        }
      `}</style>
    </button>
  );
}
