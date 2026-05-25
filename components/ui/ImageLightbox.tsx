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
  }, [onClose, hasMultiple, imageList.length]);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
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

  const getTouchDist = (e: React.TouchEvent): number => {
    const a = e.touches[0];
    const b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

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

      {/* Dot indicators */}
      {hasMultiple && imageList.length <= 12 && (
        <div className="lightbox-dots" onClick={e => e.stopPropagation()}>
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
    background: rgba(0,0,0,0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 180ms ease-out;
  }
  .lightbox-backdrop--visible {
    opacity: 1;
  }

  .lightbox-toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 12px 16px;
    background: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%);
    z-index: 10;
  }

  .lightbox-counter {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255,255,255,0.8);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .lightbox-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(255,255,255,0.1);
    border: none;
    border-radius: var(--r-sm, 6px);
    padding: 8px;
    color: #fff;
    cursor: pointer;
    text-decoration: none;
    transition: background 120ms ease-out;
    flex-shrink: 0;
  }
  .lightbox-btn:hover {
    background: rgba(255,255,255,0.2);
  }

  .lightbox-img-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 90vw;
    max-height: 90vh;
    opacity: 0;
    transform: scale(0.85);
    transition: opacity 180ms ease-out, transform 180ms ease-out;
    user-select: none;
  }
  .lightbox-img-wrap--visible {
    opacity: 1;
    transform: scale(1);
  }

  .lightbox-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: var(--r-md, 8px);
    box-shadow: 0 24px 64px rgba(0,0,0,0.8);
    pointer-events: none;
    will-change: transform;
  }

  .lightbox-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: rgba(255,255,255,0.1);
    border: none;
    border-radius: 50%;
    color: #fff;
    cursor: pointer;
    z-index: 10;
    transition: background 120ms ease-out, transform 120ms ease-out;
  }
  .lightbox-nav:hover {
    background: rgba(255,255,255,0.2);
    transform: translateY(-50%) scale(1.05);
  }
  .lightbox-nav--prev { left: 20px; }
  .lightbox-nav--next { right: 20px; }

  .lightbox-dots {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    z-index: 10;
  }

  .lightbox-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.35);
    cursor: pointer;
    padding: 0;
    transition: background 120ms ease-out, transform 120ms ease-out;
  }
  .lightbox-dot:hover {
    background: rgba(255,255,255,0.6);
  }
  .lightbox-dot--active {
    background: #fff;
    transform: scale(1.25);
  }
`;
