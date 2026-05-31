'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
  // Future-proofing: multi-image support
  images?: string[];
  currentIndex?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function ImageLightbox({ src, alt = '', onClose, images, currentIndex = 0 }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [activeIndex, setActiveIndex] = useState(currentIndex);
  const [mounted, setMounted] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const touchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Determine the active image source
  const imageList = images && images.length > 0 ? images : [src];
  const activeSrc = imageList[activeIndex] ?? src;
  const hasMultiple = imageList.length > 1;

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Entrance animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasMultiple) {
        setActiveIndex(i => clamp(i - 1, 0, imageList.length - 1));
        resetTransform();
      }
      if (e.key === 'ArrowRight' && hasMultiple) {
        setActiveIndex(i => clamp(i + 1, 0, imageList.length - 1));
        resetTransform();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, hasMultiple, imageList.length, resetTransform]);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(s => clamp(s - e.deltaY * 0.001, 0.5, 3));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }, [scale, offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      resetTransform();
    } else {
      setScale(2);
    }
  }, [scale, resetTransform]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      touchStartRef.current = { dist: Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      ), scale };
    }
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartRef.current) {
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = newDist / touchStartRef.current.dist;
      setScale(clamp(touchStartRef.current.scale * ratio, 0.5, 4));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handlePrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveIndex(i => clamp(i - 1, 0, imageList.length - 1));
    resetTransform();
  }, [imageList.length, resetTransform]);

  const handleNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveIndex(i => clamp(i + 1, 0, imageList.length - 1));
    resetTransform();
  }, [imageList.length, resetTransform]);

  return (
    <div
      className={`lightbox-backdrop ${mounted ? 'lightbox-backdrop--visible' : ''}`}
      onClick={handleBackdropClick}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      role="dialog"
      aria-modal
      aria-label="Image viewer"
    >
      {/* Toolbar */}
      <div className="lightbox-toolbar" onClick={e => e.stopPropagation()}>
        {/* Counter */}
        {hasMultiple && (
          <span className="lightbox-counter">{activeIndex + 1} / {imageList.length}</span>
        )}
        <div style={{ flex: 1 }} />

        {/* Open in new tab */}
        <a
          href={activeSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="lightbox-btn"
          title="Open in new tab"
          aria-label="Open image in new tab"
        >
          <UpRightIcon />
        </a>

        {/* Download */}
        <a
          href={activeSrc}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="lightbox-btn"
          title="Download image"
          aria-label="Download image"
        >
          <DownloadIcon />
        </a>

        {/* Close */}
        <button
          className="lightbox-btn"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close image viewer"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Left navigation arrow */}
      {hasMultiple && activeIndex > 0 && (
        <button
          className="lightbox-nav lightbox-nav--prev"
          onClick={handlePrev}
          aria-label="Previous image"
        >
          <ChevronLeftIcon />
        </button>
      )}

      {/* Image */}
      <div
        className={`lightbox-img-wrap ${mounted ? 'lightbox-img-wrap--visible' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: scale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in' }}
      >
        <img
          ref={imgRef}
          src={activeSrc}
          alt={alt}
          className="lightbox-img"
          style={{
            transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
            transition: isPanning ? 'none' : 'transform 120ms ease-out',
          }}
          draggable={false}
        />
      </div>

      {/* Right navigation arrow */}
      {hasMultiple && activeIndex < imageList.length - 1 && (
        <button
          className="lightbox-nav lightbox-nav--next"
          onClick={handleNext}
          aria-label="Next image"
        >
          <ChevronRightIcon />
        </button>
      )}

      {/* Caption + dot indicators */}
      <div className="lightbox-footer" onClick={e => e.stopPropagation()}>
        {alt && <p className="lightbox-caption">{alt}</p>}
        {hasMultiple && imageList.length <= 12 && (
          <div className="lightbox-dots">
            {imageList.map((_, i) => (
              <button
                key={i}
                className={`lightbox-dot ${i === activeIndex ? 'lightbox-dot--active' : ''}`}
                onClick={() => { setActiveIndex(i); resetTransform(); }}
                aria-label={`Go to image ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l12 12M15 3L3 15" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 2v9m0 0L5 7.5M8.5 11l3.5-3.5" />
      <path d="M2 13h13" />
    </svg>
  );
}

function UpRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h7v7" />
      <path d="M13 3L3 13" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5l-7 6 7 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 5l7 6-7 6" />
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = `
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    /* Heavy blur + near-black tint — premium layered look */
    background: rgba(3, 8, 16, 0.92);
    backdrop-filter: blur(18px) saturate(0.7);
    -webkit-backdrop-filter: blur(18px) saturate(0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .lightbox-backdrop--visible {
    opacity: 1;
  }

  /* Top toolbar — fades in, appears on hover */
  .lightbox-toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 18px;
    background: linear-gradient(to bottom, rgba(3,8,16,0.82) 0%, transparent 100%);
    z-index: 10;
    opacity: 0;
    transition: opacity 200ms ease-out;
  }
  .lightbox-backdrop--visible .lightbox-toolbar { opacity: 0.85; }
  .lightbox-backdrop:hover .lightbox-toolbar { opacity: 1; }

  .lightbox-counter {
    font-size: 12px;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.06em;
    background: rgba(14,165,233,0.12);
    border: 1px solid rgba(14,165,233,0.2);
    padding: 3px 10px;
    border-radius: 999px;
  }

  .lightbox-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: var(--r-sm, 6px);
    padding: 8px;
    color: rgba(255,255,255,0.8);
    cursor: pointer;
    text-decoration: none;
    transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out, transform 80ms;
    flex-shrink: 0;
  }
  .lightbox-btn:hover {
    background: rgba(14,165,233,0.15);
    border-color: rgba(14,165,233,0.3);
    color: #fff;
    transform: scale(1.05);
  }
  .lightbox-btn:active {
    transform: scale(0.96);
  }

  /* Image wrapper — smooth scale-in entrance */
  .lightbox-img-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 90vw;
    max-height: 90vh;
    opacity: 0;
    transform: scale(0.86) translateY(8px);
    transition: opacity 250ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }
  .lightbox-img-wrap--visible {
    opacity: 1;
    transform: scale(1) translateY(0);
  }

  .lightbox-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: var(--r-lg, 12px);
    box-shadow:
      0 40px 100px rgba(0,0,0,0.95),
      0 0 0 1px rgba(14,165,233,0.06),
      0 0 80px rgba(14,165,233,0.04);
    pointer-events: none;
    will-change: transform;
  }

  /* Navigation arrows — clean, accessible, ocean-themed */
  .lightbox-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    background: rgba(6, 16, 29, 0.75);
    border: 1px solid rgba(14,165,233,0.2);
    border-radius: 50%;
    color: rgba(255,255,255,0.9);
    cursor: pointer;
    z-index: 10;
    transition: background 160ms ease-out, transform 160ms cubic-bezier(0.16,1,0.3,1), border-color 160ms ease-out, box-shadow 160ms ease-out;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }
  .lightbox-nav:hover {
    background: rgba(14,165,233,0.15);
    border-color: rgba(14,165,233,0.4);
    box-shadow: 0 4px 20px rgba(14,165,233,0.2), 0 4px 16px rgba(0,0,0,0.5);
    transform: translateY(-50%) scale(1.1);
  }
  .lightbox-nav:active {
    transform: translateY(-50%) scale(0.96);
  }
  .lightbox-nav--prev { left: 20px; }
  .lightbox-nav--next { right: 20px; }

  /* Footer: caption + dots */
  .lightbox-footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 20px 24px 24px;
    background: linear-gradient(to top, rgba(3,8,16,0.75) 0%, transparent 100%);
    z-index: 10;
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease-out;
  }
  .lightbox-backdrop--visible .lightbox-footer { opacity: 0.9; }
  .lightbox-backdrop:hover .lightbox-footer { opacity: 1; }

  .lightbox-caption {
    font-size: 13px;
    color: rgba(223, 240, 255, 0.8);
    text-align: center;
    margin: 0;
    max-width: 600px;
    line-height: 1.5;
    text-shadow: 0 1px 6px rgba(0,0,0,0.8);
    pointer-events: auto;
  }

  .lightbox-dots {
    display: flex;
    gap: 6px;
    pointer-events: auto;
  }

  .lightbox-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: none;
    background: rgba(14,165,233,0.3);
    cursor: pointer;
    padding: 0;
    transition: background 140ms ease-out, transform 140ms ease-out, width 180ms cubic-bezier(0.16,1,0.3,1);
  }
  .lightbox-dot:hover {
    background: rgba(14,165,233,0.7);
    transform: scale(1.2);
  }
  .lightbox-dot--active {
    background: var(--accent, #0ea5e9);
    width: 20px;
    border-radius: 3px;
    box-shadow: 0 0 8px rgba(14,165,233,0.5);
  }

  /* Mobile: bigger tap targets */
  @media (max-width: 640px) {
    .lightbox-nav {
      width: 44px;
      height: 44px;
    }
    .lightbox-nav--prev { left: 12px; }
    .lightbox-nav--next { right: 12px; }
  }
`;
