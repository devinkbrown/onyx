'use client';

/**
 * Whiteboard icon set — crisp, stroke-based SVG glyphs sized to the
 * Deep Lacquer toolbar. All icons inherit `currentColor` so tool state
 * (active / disabled / destructive) drives their tint via CSS.
 */

import type { ReactElement } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function PenIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20l4-1 9.5-9.5a2 2 0 0 0 0-2.8l-.2-.2a2 2 0 0 0-2.8 0L5 16l-1 4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

export function LineIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 19L19 5" />
      <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RectIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </svg>
  );
}

export function CircleIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export function TextIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6h12M12 6v12M9.5 18h5" />
    </svg>
  );
}

export function StickyIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 5h14v9l-5 5H5Z" />
      <path d="M14 19v-5h5" />
    </svg>
  );
}

export function SelectIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 4l6 15 2.2-5.6L19 11Z" />
    </svg>
  );
}

export function EraserIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8.5 18H20" />
      <path d="M16 5.5l3 3a2 2 0 0 1 0 2.8L12 18l-5-5 6.2-7.5a2 2 0 0 1 2.8 0Z" />
      <path d="M7 13l5 5" />
    </svg>
  );
}

export function UndoIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 7L4 11l4 4" />
      <path d="M4 11h10a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

export function RedoIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M16 7l4 4-4 4" />
      <path d="M20 11H10a5 5 0 0 0 0 10h3" />
    </svg>
  );
}

export function FillIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8Z" />
      <path d="M5 11h13" />
      <path d="M20 16c0 1.1-.9 2.5-.9 2.5S18 17.1 18 16a1 1 0 0 1 2 0Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ExportIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

export function TrashIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ZoomInIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="6" />
      <path d="M11 8.5v5M8.5 11h5M20 20l-4.5-4.5" />
    </svg>
  );
}

export function ZoomOutIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="6" />
      <path d="M8.5 11h5M20 20l-4.5-4.5" />
    </svg>
  );
}

export function FitIcon({ size = 18, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    </svg>
  );
}
